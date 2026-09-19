export type ClaudeService = "Claude Code" | "Cowork" | "Agent";
export type UsageStatus = "success" | "error";
export type ConnectionState = "demo" | "connecting" | "live" | "offline";
export type ExportRange = "today" | "yesterday" | "week" | "month";
export type ExportLimit = "50" | "100" | "all";

export interface UsageEvent {
  id: string;
  timestamp: string;
  user: string;
  initials: string;
  email: string;
  source: ClaudeService;
  sessionId: string;
  model: string;
  prompt: string;
  processOwner: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  latencyMs: number;
  costUsd: number;
  status: UsageStatus;
}

export interface DailyUsage {
  key: string;
  label: string;
  tokens: number;
  cost: number;
}

export interface ServiceCost {
  name: ClaudeService;
  value: number;
}

export interface UsageBreakdown {
  name: string;
  tokens: number;
  events: number;
  cost: number;
}