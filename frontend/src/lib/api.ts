import type { ClaudeService, UsageEvent, UsageStatus } from "../types/usage";

const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

function defaultWebSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/usage`;
}

export const WS_URL = import.meta.env.VITE_WS_URL || defaultWebSocketUrl();

type Attributes = Record<string, unknown>;

export interface BackendUsageEvent {
  id: string;
  timestamp: string | null;
  event_name: string;
  service: string | null;
  session_id: string | null;
  employee_id: string | null;
  employee_email: string | null;
  model: string | null;
  user_prompt?: string | null;
  process_owner?: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  duration_ms: number | null;
  success: boolean | null;
  attributes?: Attributes;
}

export interface UsageSocketFrame {
  type: "connected" | "usage.event" | "ping" | "pong";
  data?: BackendUsageEvent | Record<string, unknown>;
}

function attribute(event: BackendUsageEvent, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = event.attributes?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function serviceName(raw: string | null): ClaudeService {
  const value = (raw || "").toLowerCase();
  if (value.includes("cowork")) return "Cowork";
  if (value.includes("agent")) return "Agent";
  return "Claude Code";
}

function initials(name: string): string {
  return name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "").join("") || "?";
}

export function mapUsageEvent(event: BackendUsageEvent): UsageEvent {
  const email = event.employee_email || attribute(event, "user.email", "employee.email") || "Unknown";
  const user = attribute(event, "employee.name", "employee_name", "user.name")
    || (email.includes("@") ? email.split("@")[0].replace(/[._-]+/g, " ") : event.employee_id)
    || "Unknown user";
  const status: UsageStatus = event.success === false ? "error" : "success";
  const prompt = event.user_prompt
    || attribute(event, "user_prompt", "user.prompt", "prompt", "prompt.content")
    || "Prompt unavailable";
  const processOwner = event.process_owner
    || attribute(
      event,
      "process.owner",
      "process.owner.name",
      "process_owner",
      "owner.name",
    )
    || "Unknown owner";

  return {
    id: event.id,
    timestamp: event.timestamp || new Date().toISOString(),
    user,
    initials: initials(user),
    email,
    source: serviceName(event.service),
    sessionId: event.session_id || "No session ID",
    model: event.model || "Unknown model",
    prompt,
    processOwner,
    inputTokens: Number(event.input_tokens || 0),
    outputTokens: Number(event.output_tokens || 0),
    cacheReadTokens: Number(event.cache_read_tokens || 0),
    cacheCreateTokens: Number(event.cache_creation_tokens || 0),
    latencyMs: Number(event.duration_ms || 0),
    costUsd: Number(event.cost_usd || 0),
    status,
  };
}

export interface UsageCursor {
  timestamp: string;
  id: string;
}

export interface UsagePage {
  items: UsageEvent[];
  pageSize: number;
  hasMore: boolean;
  nextCursor: UsageCursor | null;
}

export interface UsageFilters {
  search?: string;
  service?: string;
}

export async function fetchUsageEvents(
  pageSize: number,
  cursor?: UsageCursor | null,
  filters?: UsageFilters,
  signal?: AbortSignal,
): Promise<UsagePage> {
  const params =
    new URLSearchParams({
      page_size:
        String(pageSize),
    });

  if (cursor) {
    params.set(
      "cursor_timestamp",
      cursor.timestamp,
    );

    params.set(
      "cursor_id",
      cursor.id,
    );
  }

  if (
    filters?.search?.trim()
  ) {
    params.set(
      "search",
      filters.search.trim(),
    );
  }

  if (
    filters?.service &&
    filters.service !==
      "All services"
  ) {
    params.set(
      "service",
      filters.service,
    );
  }

  const response =
    await fetch(
      `${API_URL}/api/v1/events?${params.toString()}`,
      {
        signal,
        credentials:
          "include",
      },
    );

  if (!response.ok) {
    throw new Error(
      `Failed to load events: ${response.status}`,
    );
  }

  const payload =
    await response.json();

  return {
    items:
      payload.items.map(
        mapUsageEvent,
      ),

    pageSize:
      payload.page_size,

    hasMore:
      payload.has_more,

    nextCursor:
      payload.next_cursor,
  };
}