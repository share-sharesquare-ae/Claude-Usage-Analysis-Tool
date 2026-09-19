import asyncio
import hmac
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .models import UsageEvent
from .normalizer import normalize
from .store import PostgresStore
from .websocket import ConnectionManager
from .auth import AdminIdentity, LoginRequest, auth_dependency, session_digest, sign_in

store = PostgresStore(
    settings.database_url,
    settings.database_pool_min_size,
    settings.database_pool_max_size,
)
manager = ConnectionManager()
require_admin = auth_dependency(store)
def is_prompt_event(event: UsageEvent) -> bool:
    name = event.event_name.strip().lower()

    return (
        name == "user_prompt"
        or name.endswith(".user_prompt")
    )


def is_usage_event(event: UsageEvent) -> bool:
    name = event.event_name.strip().lower()
    attributes = event.attributes or {}
    has_hook = any(
        attributes.get(key) not in (None, "")
        for key in (
            "hook_name", "hook.name", "hookName",
            "claude_code.hook_name", "claude.code.hook_name",
        )
    )
    has_plugin = any(
        attributes.get(key) not in (None, "")
        for key in (
            "plugin.name", "plugin_name", "pluginName",
            "claude_code.plugin.name", "claude.code.plugin.name",
        )
    )

    return (
        name == "api_request"
        or name.endswith(".api_request")
        or has_hook
        or has_plugin
    )

def has_valid_model(event: UsageEvent) -> bool:
    model = (event.model or "").strip().lower()

    return model not in {
        "",
        "unknown",
        "unknown model",
        "none",
        "null",
    }

@asynccontextmanager
async def lifespan(_: FastAPI):
    await store.connect()
    try:
        yield
    finally:
        await store.close()


app = FastAPI(title="Claude Usage Backend", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.post("/api/v1/auth/login", response_model=AdminIdentity)
async def login(payload: LoginRequest, response: Response):
    return await sign_in(store, payload, response)


@app.get("/api/v1/auth/me", response_model=AdminIdentity)
async def me(admin: AdminIdentity = Depends(require_admin)):
    return admin


@app.get("/api/v1/auth/session", response_model=AdminIdentity | None)
async def auth_session(
    session: str | None = Cookie(default=None, alias=settings.auth_cookie_name),
):
    """Return the current user without using a 401 for an anonymous browser."""
    if not session:
        return None
    row = await store.get_admin_for_session(session_digest(session))
    if row is None:
        return None
    return AdminIdentity(id=row["id"], email=row["email"], display_name=row["display_name"])


@app.post("/api/v1/auth/logout", status_code=204)
async def logout(
    response: Response,
    session: str | None = Cookie(default=None, alias=settings.auth_cookie_name),
):
    if session:
        await store.delete_admin_session(session_digest(session))
    response.delete_cookie(settings.auth_cookie_name, path="/")


@app.get("/health")
async def health():
    envelope_counts = await store.envelope_counts()
    return {
        "status": "ok",
        "ingestion": "direct_otlp_http_json",
        "otlp_envelopes": envelope_counts,
        "websocket_clients": manager.count,
        "database_connected": store.connected,
        "events": (await store.summary()).events,
        "stored_prompts": await store.prompt_count(),
    }


async def ingest_otlp(
    signal: str,
    request: Request,
    authorization: str | None,
) -> dict[str, dict]:
    expected = f"Bearer {settings.backend_ingest_token}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="invalid authorization")

    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip()
    if content_type != "application/json":
        raise HTTPException(status_code=415, detail="OTLP JSON is required")

    try:
        payload = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid JSON payload") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="OTLP payload must be an object")

    normalized_events = normalize(payload)

    prompt_events = [event for event in normalized_events if is_prompt_event(event)]
    usage_events = [event for event in normalized_events if is_usage_event(event) and has_valid_model(event)]

    inserted = await store.ingest(signal, payload, prompt_events, usage_events)
    for event in inserted:
        await manager.broadcast(event)
    return {"partialSuccess": {}}


@app.post("/v1/logs")
async def ingest_logs(
    request: Request,
    authorization: str | None = Header(default=None),
):
    return await ingest_otlp("logs", request, authorization)


@app.post("/v1/metrics")
async def ingest_metrics(
    request: Request,
    authorization: str | None = Header(default=None),
):
    return await ingest_otlp("metrics", request, authorization)


@app.post("/v1/traces")
async def ingest_traces(
    request: Request,
    authorization: str | None = Header(default=None),
):
    return await ingest_otlp("traces", request, authorization)


@app.get("/api/v1/events")
async def events(
    page_size: int = Query(50, ge=1, le=200),
    cursor_timestamp: datetime | None = None,
    cursor_id: str | None = None,
    service: str | None = None,
    search: str | None = None,
    employee_id: str | None = None,
    event_name: str | None = None,
    _admin: AdminIdentity = Depends(require_admin),
):
    rows, next_timestamp, next_id, has_more = (
        await store.list_paginated(
            page_size=page_size,
            cursor_timestamp=cursor_timestamp,
            cursor_id=cursor_id,
            service=service,
            search=search,
            employee_id=employee_id,
            event_name=event_name,
        )
    )

    return {
        "items": rows,
        "page_size": page_size,
        "has_more": has_more,
        "next_cursor": (
            {
                "timestamp": next_timestamp,
                "id": next_id,
            }
            if has_more
            else None
        ),
    }


@app.get("/api/v1/summary")
async def summary(_admin: AdminIdentity = Depends(require_admin)):
    return await store.summary()


@app.websocket("/ws/usage")
async def usage_socket(websocket: WebSocket):
    origin = websocket.headers.get("origin")
    if origin and origin not in settings.allowed_origins:
        await websocket.close(code=1008)
        return
    session = websocket.cookies.get(settings.auth_cookie_name)
    if not session or await store.get_admin_for_session(session_digest(session)) is None:
        await websocket.close(code=1008)
        return
    await manager.connect(websocket)
    current_summary = await store.summary()
    await websocket.send_json({"type": "connected", "data": {"summary": current_summary.model_dump()}})
    try:
        while True:
            await asyncio.sleep(settings.ws_heartbeat_seconds)
            await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    except RuntimeError:
        pass
    finally:
        await manager.disconnect(websocket)