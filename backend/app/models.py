from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class UsageEvent(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    timestamp: str | None = None
    signal: str = "logs"
    event_name: str = "unknown"
    service: str | None = None
    session_id: str | None = None
    prompt_id: str | None = None
    request_id: str | None = None
    employee_id: str | None = None
    employee_email: str | None = None
    department: str | None = None
    model: str | None = None
    user_prompt: str | None = None
    process_owner: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    cost_usd: float = 0.0
    duration_ms: float | None = None
    success: bool | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)


class Summary(BaseModel):
    events: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_creation_tokens: int
    total_tokens: int
    cost_usd: float