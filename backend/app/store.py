from __future__ import annotations

import json
import hashlib
from typing import Any

import asyncpg
from datetime import datetime

from .models import Summary, UsageEvent

class PostgresStore:
    def __init__(self, database_url: str, min_pool_size: int = 1, max_pool_size: int = 10):
        self._database_url = database_url
        self._min_pool_size = min_pool_size
        self._max_pool_size = max_pool_size
        self._pool: asyncpg.Pool | None = None

    @property
    def connected(self) -> bool:
        return self._pool is not None

    async def connect(self) -> None:
        if self._pool is not None:
            return
        self._pool = await asyncpg.create_pool(
            self._database_url,
            min_size=self._min_pool_size,
            max_size=self._max_pool_size,
            command_timeout=30,
        )
        async with self._pool.acquire() as connection:
            await connection.execute(
                """
                CREATE TABLE IF NOT EXISTS usage_events (
                    id TEXT PRIMARY KEY,
                    event_timestamp TEXT,
                    signal TEXT NOT NULL,
                    event_name TEXT NOT NULL,
                    service TEXT,
                    session_id TEXT,
                    prompt_id TEXT,
                    request_id TEXT,
                    employee_id TEXT,
                    employee_email TEXT,
                    department TEXT,
                    model TEXT,
                    input_tokens BIGINT NOT NULL DEFAULT 0,
                    output_tokens BIGINT NOT NULL DEFAULT 0,
                    cache_read_tokens BIGINT NOT NULL DEFAULT 0,
                    cache_creation_tokens BIGINT NOT NULL DEFAULT 0,
                    cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
                    duration_ms DOUBLE PRECISION,
                    success BOOLEAN,
                    payload JSONB NOT NULL,
                    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS otlp_envelopes (
                    id BIGSERIAL PRIMARY KEY,
                    content_hash TEXT NOT NULL UNIQUE,
                    signal TEXT NOT NULL,
                    payload JSONB NOT NULL,
                    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS user_prompts (
                    id TEXT PRIMARY KEY,
                    event_timestamp TEXT,
                    prompt_id TEXT,
                    session_id TEXT,
                    employee_id TEXT,
                    employee_email TEXT,
                    user_prompt TEXT NOT NULL,
                    process_owner TEXT,
                    payload JSONB NOT NULL,
                    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS admin_users (
                    id BIGSERIAL PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    display_name TEXT,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_login_at TIMESTAMPTZ
                );
                CREATE TABLE IF NOT EXISTS admin_sessions (
                    token_hash TEXT PRIMARY KEY,
                    admin_user_id BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
                    expires_at TIMESTAMPTZ NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx
                    ON admin_sessions (expires_at);
                ALTER TABLE usage_events
                    ADD COLUMN IF NOT EXISTS user_prompt TEXT;
                ALTER TABLE usage_events
                    ADD COLUMN IF NOT EXISTS process_owner TEXT;
                CREATE INDEX IF NOT EXISTS user_prompts_prompt_id_idx
                    ON user_prompts (prompt_id, received_at DESC);
                CREATE INDEX IF NOT EXISTS user_prompts_session_id_idx
                    ON user_prompts (session_id, received_at DESC);
                CREATE INDEX IF NOT EXISTS otlp_envelopes_signal_received_idx
                    ON otlp_envelopes (signal, received_at DESC);
                CREATE INDEX IF NOT EXISTS usage_events_ingested_at_idx
                    ON usage_events (ingested_at DESC);
                CREATE INDEX IF NOT EXISTS usage_events_service_idx
                    ON usage_events (service);
                CREATE INDEX IF NOT EXISTS usage_events_employee_id_idx
                    ON usage_events (employee_id);
                CREATE INDEX IF NOT EXISTS usage_events_event_name_idx
                    ON usage_events (event_name);
                CREATE INDEX IF NOT EXISTS usage_events_session_id_idx
                    ON usage_events (session_id);

                -- Cursor/keyset pagination index.
                CREATE INDEX IF NOT EXISTS usage_events_cursor_idx
                    ON usage_events (ingested_at DESC, id DESC);

                -- Helps service-filtered cursor pagination.
                CREATE INDEX IF NOT EXISTS usage_events_service_cursor_idx
                    ON usage_events (service, ingested_at DESC, id DESC);

                CREATE INDEX IF NOT EXISTS usage_events_model_idx
                    ON usage_events (model);
                """
            )

    async def get_admin_by_email(self, email: str):
        return await self._require_pool().fetchrow(
            """SELECT id, email, password_hash, display_name, is_active
               FROM admin_users WHERE email = $1""",
            email.lower(),
        )

    async def create_admin(self, email: str, password_hash: str, display_name: str | None = None) -> None:
        await self._require_pool().execute(
            """INSERT INTO admin_users (email, password_hash, display_name)
               VALUES ($1, $2, $3)
               ON CONFLICT (email) DO UPDATE SET
                   password_hash = EXCLUDED.password_hash,
                   display_name = COALESCE(EXCLUDED.display_name, admin_users.display_name),
                   is_active = TRUE""",
            email.lower(), password_hash, display_name,
        )

    async def create_admin_session(self, token_hash: str, admin_user_id: int, expires_at: datetime) -> None:
        async with self._require_pool().acquire() as connection:
            async with connection.transaction():
                await connection.execute("DELETE FROM admin_sessions WHERE expires_at <= NOW()")
                await connection.execute(
                    "INSERT INTO admin_sessions (token_hash, admin_user_id, expires_at) VALUES ($1, $2, $3)",
                    token_hash, admin_user_id, expires_at,
                )
                await connection.execute(
                    "UPDATE admin_users SET last_login_at = NOW() WHERE id = $1", admin_user_id
                )

    async def get_admin_for_session(self, token_hash: str):
        return await self._require_pool().fetchrow(
            """SELECT u.id, u.email, u.display_name
               FROM admin_sessions s
               JOIN admin_users u ON u.id = s.admin_user_id
               WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.is_active = TRUE""",
            token_hash,
        )

    async def delete_admin_session(self, token_hash: str) -> None:
        await self._require_pool().execute(
            "DELETE FROM admin_sessions WHERE token_hash = $1", token_hash
        )

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    def _require_pool(self) -> asyncpg.Pool:
        if self._pool is None:
            raise RuntimeError("PostgreSQL store is not connected")
        return self._pool

    async def add(self, event: UsageEvent) -> bool:
        # Defense in depth: never persist usage rows without a valid model.
        model = (event.model or "").strip().lower()
        if model in {"", "unknown", "unknown model", "none", "null"}:
            return False

        payload = event.model_dump(mode="json")
        result = await self._require_pool().execute(
            """
            INSERT INTO usage_events (
                id, event_timestamp, signal, event_name, service, session_id,
                prompt_id, request_id, employee_id, employee_email, department,
                model, input_tokens, output_tokens, cache_read_tokens,
                cache_creation_tokens, cost_usd, duration_ms, success, payload
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb
            )
            ON CONFLICT (id) DO NOTHING
            """,
            event.id, event.timestamp, event.signal, event.event_name,
            event.service, event.session_id, event.prompt_id, event.request_id,
            event.employee_id, event.employee_email, event.department, event.model,
            event.input_tokens, event.output_tokens, event.cache_read_tokens,
            event.cache_creation_tokens, event.cost_usd, event.duration_ms,
            event.success, json.dumps(payload),
        )
        return result == "INSERT 0 1"

    async def ingest(
        self,
        signal: str,
        payload: dict[str, Any],
        prompts: list[UsageEvent],
        events: list[UsageEvent],
    ) -> list[UsageEvent]:
        serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        content_hash = hashlib.sha256(
            f"{signal}:".encode() + serialized.encode()
        ).hexdigest()
        inserted: list[UsageEvent] = []

        async with self._require_pool().acquire() as connection:
            async with connection.transaction():
                envelope_result = await connection.execute(
                    """
                    INSERT INTO otlp_envelopes (content_hash, signal, payload)
                    VALUES ($1, $2, $3::jsonb)
                    ON CONFLICT (content_hash) DO NOTHING
                    """,
                    content_hash,
                    signal,
                    serialized,
                )
                if envelope_result != "INSERT 0 1":
                    return inserted

                for prompt in prompts:
                    prompt.signal = signal
                    inserted.extend(
                        await self._save_prompt_with_connection(connection, prompt)
                    )

                for event in events:
                    event.signal = signal
                    await self._enrich_with_prompt(connection, event)
                    if await self._add_with_connection(connection, event):
                        inserted.append(event)
        return inserted

    async def _save_prompt_with_connection(
        self,
        connection: asyncpg.Connection,
        event: UsageEvent,
    ) -> list[UsageEvent]:
        if not event.user_prompt:
            return []
        payload = json.dumps(event.model_dump(mode="json"))
        await connection.execute(
            """
            INSERT INTO user_prompts (
                id, event_timestamp, prompt_id, session_id, employee_id,
                employee_email, user_prompt, process_owner, payload
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
            ON CONFLICT (id) DO UPDATE SET
                user_prompt = EXCLUDED.user_prompt,
                process_owner = COALESCE(EXCLUDED.process_owner, user_prompts.process_owner),
                payload = EXCLUDED.payload
            """,
            event.id, event.timestamp, event.prompt_id, event.session_id,
            event.employee_id, event.employee_email, event.user_prompt,
            event.process_owner, payload,
        )

        repaired = await connection.fetch(
            """
            UPDATE usage_events
            SET user_prompt = $1,
                process_owner = COALESCE(process_owner, $2),
                payload = CASE
                    WHEN COALESCE(process_owner, $2) IS NULL THEN
                        jsonb_set(payload, '{user_prompt}', to_jsonb($1::text), true)
                    ELSE jsonb_set(
                        jsonb_set(payload, '{user_prompt}', to_jsonb($1::text), true),
                        '{process_owner}',
                        to_jsonb(COALESCE(process_owner, $2)::text), true
                    )
                END
            WHERE user_prompt IS NULL
              AND (
                    ($3::text IS NOT NULL AND prompt_id = $3)
                    OR ($3::text IS NULL AND $4::text IS NOT NULL
                        AND prompt_id IS NULL AND session_id = $4)
              )
            RETURNING payload
            """,
            event.user_prompt, event.process_owner, event.prompt_id, event.session_id,
        )
        return [
            UsageEvent.model_validate(json.loads(row["payload"]))
            for row in repaired
        ]

    async def _enrich_with_prompt(
        self,
        connection: asyncpg.Connection,
        event: UsageEvent,
    ) -> None:
        if event.user_prompt:
            return
        record = await connection.fetchrow(
            """
            SELECT user_prompt, process_owner
            FROM user_prompts
            WHERE ($1::text IS NOT NULL AND prompt_id = $1)
               OR ($1::text IS NULL AND $2::text IS NOT NULL AND session_id = $2)
            ORDER BY
                CASE WHEN $1::text IS NOT NULL AND prompt_id = $1 THEN 0 ELSE 1 END,
                received_at DESC
            LIMIT 1
            """,
            event.prompt_id, event.session_id,
        )
        if record is None:
            return
        event.user_prompt = record["user_prompt"]
        event.process_owner = event.process_owner or record["process_owner"]
        event.attributes["user_prompt"] = event.user_prompt
        if event.process_owner:
            event.attributes["process_owner"] = event.process_owner

    async def _add_with_connection(
        self,
        connection: asyncpg.Connection,
        event: UsageEvent,
    ) -> bool:
        model = (event.model or "").strip().lower()

        if model in {
            "",
            "unknown",
            "unknown model",
            "none",
            "null",
        }:
            return False

        payload = json.dumps(event.model_dump(mode="json"))

        result = await connection.execute(
            """
            INSERT INTO usage_events (
                id, event_timestamp, signal, event_name, service, session_id,
                prompt_id, request_id, employee_id, employee_email, department,
                model, input_tokens, output_tokens, cache_read_tokens,
                cache_creation_tokens, cost_usd, duration_ms, success,
                user_prompt, process_owner, payload
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19,
                $20, $21, $22::jsonb
            )
            ON CONFLICT (id) DO NOTHING
            """,
            event.id,
            event.timestamp,
            event.signal,
            event.event_name,
            event.service,
            event.session_id,
            event.prompt_id,
            event.request_id,
            event.employee_id,
            event.employee_email,
            event.department,
            event.model,
            event.input_tokens,
            event.output_tokens,
            event.cache_read_tokens,
            event.cache_creation_tokens,
            event.cost_usd,
            event.duration_ms,
            event.success,
            event.user_prompt,
            event.process_owner,
            payload,
        )

        return result == "INSERT 0 1"

    async def prompt_count(self) -> int:
        value = await self._require_pool().fetchval("SELECT COUNT(*) FROM user_prompts")
        return int(value or 0)

    async def envelope_counts(self) -> dict[str, int]:
        records = await self._require_pool().fetch(
            "SELECT signal, COUNT(*) AS count FROM otlp_envelopes GROUP BY signal"
        )
        return {record["signal"]: int(record["count"]) for record in records}

    async def list(
        self,
        *,
        limit: int,
        offset: int,
        service: str | None = None,
        employee_id: str | None = None,
        event_name: str | None = None,
    ) -> tuple[list[UsageEvent], int]:
        conditions: list[str] = []
        values: list[Any] = []
        for column, value in (
            ("service", service),
            ("employee_id", employee_id),
            ("event_name", event_name),
        ):
            if value is not None:
                values.append(value)
                conditions.append(f"{column} = ${len(values)}")

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        pool = self._require_pool()
        total = await pool.fetchval(f"SELECT COUNT(*) FROM usage_events {where}", *values)
        records = await pool.fetch(
            f"""
            SELECT payload FROM usage_events {where}
            ORDER BY ingested_at DESC, id DESC
            LIMIT ${len(values) + 1} OFFSET ${len(values) + 2}
            """,
            *values, limit, offset,
        )
        rows = [UsageEvent.model_validate(json.loads(record["payload"])) for record in records]
        return rows, int(total or 0)


    async def list_paginated(
        self,
        *,
        page_size: int,
        cursor_timestamp: str | datetime | None = None,
        cursor_id: str | None = None,
        service: str | None = None,
        search: str | None = None,
        employee_id: str | None = None,
        event_name: str | None = None,
    ) -> tuple[list[UsageEvent], str | None, str | None, bool]:
        """
        Keyset/cursor pagination for large datasets.

        Returns:
            rows,
            next_cursor_timestamp,
            next_cursor_id,
            has_more

        The ordering is deterministic because (ingested_at, id) is used
        both for ORDER BY and as the cursor.
        """
        if page_size < 1 or page_size > 200:
            raise ValueError("page_size must be between 1 and 200")

        # A cursor must be complete; using only half of it can create
        # duplicates or missing rows.
        if (cursor_timestamp is None) != (cursor_id is None):
            raise ValueError(
                "cursor_timestamp and cursor_id must be provided together"
            )

        conditions: list[str] = []
        values: list[Any] = []

        # Frontend-friendly service labels are intentionally accepted here.
        # This keeps App.tsx/api.ts from needing to know the raw OTLP service name.
        if service and service.strip():
            service_value = service.strip().lower()

            if service_value in {"claude code", "code"}:
                service_pattern = "%code%"
            elif service_value == "cowork":
                service_pattern = "%cowork%"
            elif service_value == "agent":
                service_pattern = "%agent%"
            else:
                service_pattern = f"%{service_value}%"

            values.append(service_pattern)
            conditions.append(
                f"LOWER(COALESCE(service, '')) LIKE ${len(values)}"
            )

        if employee_id and employee_id.strip():
            values.append(employee_id.strip())
            conditions.append(f"employee_id = ${len(values)}")

        if event_name and event_name.strip():
            values.append(event_name.strip())
            conditions.append(f"event_name = ${len(values)}")

        # Server-side search must happen BEFORE pagination.
        if search and search.strip():
            values.append(f"%{search.strip()}%")
            search_position = len(values)

            conditions.append(
                f"""(
                    COALESCE(employee_email, '') ILIKE ${search_position}
                    OR COALESCE(employee_id, '') ILIKE ${search_position}
                    OR COALESCE(model, '') ILIKE ${search_position}
                    OR COALESCE(session_id, '') ILIKE ${search_position}
                    OR COALESCE(user_prompt, '') ILIKE ${search_position}
                    OR COALESCE(process_owner, '') ILIKE ${search_position}
                )"""
            )

        if cursor_timestamp is not None and cursor_id is not None:
            if isinstance(cursor_timestamp, str):
                cursor_datetime = datetime.fromisoformat(
                    cursor_timestamp.replace("Z", "+00:00")
                )
            else:
                cursor_datetime = cursor_timestamp

            values.append(cursor_datetime)
            timestamp_position = len(values)

            values.append(cursor_id)
            id_position = len(values)

            conditions.append(
                f"""(
                    ingested_at < ${timestamp_position}
                    OR (
                        ingested_at = ${timestamp_position}
                        AND id < ${id_position}
                    )
                )"""
            )
        where_clause = (
            f"WHERE {' AND '.join(conditions)}"
            if conditions
            else ""
        )

        # Fetch one extra row only to determine whether Next should be enabled.
        values.append(page_size + 1)
        limit_position = len(values)

        records = await self._require_pool().fetch(
            f"""
            SELECT payload, ingested_at, id
            FROM usage_events
            {where_clause}
            ORDER BY ingested_at DESC, id DESC
            LIMIT ${limit_position}
            """,
            *values,
        )

        has_more = len(records) > page_size
        page_records = records[:page_size]

        rows = [
            UsageEvent.model_validate(json.loads(record["payload"]))
            for record in page_records
        ]

        if not page_records:
            return rows, None, None, False

        last = page_records[-1]

        return (
            rows,
            last["ingested_at"].isoformat(),
            last["id"],
            has_more,
        )

    async def summary(self) -> Summary:
        row = await self._require_pool().fetchrow(
            """
            SELECT COUNT(*) AS events,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
                COALESCE(SUM(cost_usd), 0) AS cost_usd
            FROM usage_events
            """
        )
        input_tokens = int(row["input_tokens"])
        output_tokens = int(row["output_tokens"])
        cache_read_tokens = int(row["cache_read_tokens"])
        cache_creation_tokens = int(row["cache_creation_tokens"])
        return Summary(
            events=int(row["events"]),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_tokens=cache_read_tokens,
            cache_creation_tokens=cache_creation_tokens,
            total_tokens=input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens,
            cost_usd=round(float(row["cost_usd"]), 8),
        )
