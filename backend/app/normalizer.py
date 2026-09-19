import hashlib
from datetime import datetime, timezone
from typing import Any, Iterable

from .models import UsageEvent


PRIVATE_KEYS = {
    "response", "body", "tool_input", "tool_parameters",
    "tool.parameters", "tool.result", "assistant_response",
}


def _value(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    for key in ("stringValue", "intValue", "doubleValue", "boolValue", "bytesValue"):
        if key in value:
            raw = value[key]
            if key == "intValue":
                try:
                    return int(raw)
                except (TypeError, ValueError):
                    return 0
            return raw
    if "arrayValue" in value:
        return [_value(v) for v in value["arrayValue"].get("values", [])]
    if "kvlistValue" in value:
        return _attrs(value["kvlistValue"].get("values", []))
    return value


def _attrs(items: Any) -> dict[str, Any]:
    if isinstance(items, dict):
        return {str(k): _value(v) for k, v in items.items() if str(k).lower() not in PRIVATE_KEYS}
    result: dict[str, Any] = {}
    for item in items or []:
        key = str(item.get("key", ""))
        if key and key.lower() not in PRIVATE_KEYS:
            result[key] = _value(item.get("value"))
    return result


def _pick(attrs: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in attrs and attrs[key] not in (None, ""):
            return attrs[key]
    return default


def _number(value: Any, kind: type = int) -> Any:
    try:
        return kind(value or 0)
    except (TypeError, ValueError):
        return kind(0)


def _text(value: Any) -> str | None:
    value = _value(value)
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, list):
        parts = [_text(item) for item in value]
        text = "\n".join(part for part in parts if part)
        return text or None
    if isinstance(value, dict):
        for key in ("text", "prompt", "content", "message"):
            if key in value:
                text = _text(value[key])
                if text:
                    return text
    return None


def _timestamp(record: dict[str, Any]) -> str | None:
    raw = record.get("timeUnixNano") or record.get("observedTimeUnixNano")
    if raw:
        try:
            return datetime.fromtimestamp(int(raw) / 1_000_000_000, timezone.utc).isoformat()
        except (ValueError, TypeError, OSError):
            pass
    return record.get("timestamp")


def _records(payload: dict[str, Any]) -> Iterable[tuple[dict[str, Any], dict[str, Any]]]:
    roots = payload.get("resourceLogs") or payload.get("resource_logs") or []
    for root in roots:
        resource = _attrs(root.get("resource", {}).get("attributes", []))
        scopes = root.get("scopeLogs") or root.get("scope_logs") or []
        for scope in scopes:
            records = scope.get("logRecords") or scope.get("log_records") or []
            for record in records:
                yield resource, record


def normalize(payload: dict[str, Any]) -> list[UsageEvent]:
    # Accept an already-normalized event as well as Collector OTLP/JSON envelopes.
    if "event_name" in payload or "event.name" in payload:
        pairs = [({}, payload)]
    else:
        pairs = list(_records(payload))

    output: list[UsageEvent] = []
    for resource, record in pairs:
        attrs = {**resource, **_attrs(record.get("attributes", []))}
        if record is payload:
            attrs = {**_attrs(payload), **_attrs(payload.get("attributes", {}))}

        event_name = str(_pick(attrs, "event.name", "event_name", "name", default="unknown"))
        user_prompt = _pick(
            attrs,
            "user_prompt",
            "user.prompt",
            "prompt",
            "prompt.content",
        )
        if not user_prompt and "user_prompt" in event_name.lower():
            user_prompt = _text(record.get("body"))
        identity = "|".join(str(x or "") for x in (
            _pick(attrs, "request.id", "request_id"),
            _pick(attrs, "prompt.id", "prompt_id"),
            _pick(attrs, "session.id", "session_id"),
            event_name, _timestamp(record),
        ))
        event_id = str(_pick(attrs, "event.id", "id") or hashlib.sha256(identity.encode()).hexdigest()[:32])

        # Keep plugin and hook telemetry under stable keys for the dashboard.
        # Different OTLP producers may emit flattened, snake_case, camelCase,
        # or Claude-specific attribute names.
        hook_name = _pick(
            attrs,
            "hook_name",
            "hook.name",
            "hookName",
            "claude_code.hook_name",
            "claude.code.hook_name",
        )
        plugin_name = _pick(
            attrs,
            "plugin.name",
            "plugin_name",
            "pluginName",
            "claude_code.plugin.name",
            "claude.code.plugin.name",
        )
        if hook_name not in (None, ""):
            attrs["hook_name"] = str(hook_name).strip()
        if plugin_name not in (None, ""):
            attrs["plugin.name"] = str(plugin_name).strip()

        output.append(UsageEvent(
            id=event_id,
            timestamp=_timestamp(record),
            event_name=event_name,
            service=_pick(attrs, "service.name", "service"),
            session_id=_pick(attrs, "session.id", "session_id"),
            prompt_id=_pick(attrs, "prompt.id", "prompt_id"),
            request_id=_pick(attrs, "request.id", "request_id"),
            employee_id=_pick(attrs, "employee.id", "employee_id", "user.account_id"),
            employee_email=_pick(attrs, "employee.email", "employee_email", "user.email"),
            department=_pick(attrs, "department"),
            model=_pick(attrs, "model", "model.name"),
            user_prompt=user_prompt,
            process_owner=_pick(
                attrs,
                "process.owner",
                "process.owner.name",
                "process_owner",
                "owner.name",
            ),
            input_tokens=_number(_pick(attrs, "input_tokens", "input.tokens")),
            output_tokens=_number(_pick(attrs, "output_tokens", "output.tokens")),
            cache_read_tokens=_number(_pick(attrs, "cache_read_tokens", "cache.read_tokens")),
            cache_creation_tokens=_number(_pick(attrs, "cache_creation_tokens", "cache.creation_tokens")),
            cost_usd=_number(_pick(attrs, "cost_usd", "cost.usd"), float),
            duration_ms=_number(_pick(attrs, "duration_ms", "duration.ms"), float) or None,
            success=_pick(attrs, "success"),
            attributes=attrs,
        ))
    return output
