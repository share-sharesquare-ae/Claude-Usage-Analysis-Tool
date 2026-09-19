import type { ExportLimit, ExportRange, UsageEvent } from "../types/usage";
import { istDateKey, istDateTime, istDayNumber } from "./formatters";

export function rowsForRange(rows: UsageEvent[], range: ExportRange): UsageEvent[] {
  const today = new Date();
  const todayDay = istDayNumber(today);
  const currentKey = istDateKey.format(today);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekdayName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
  }).format(today);
  const monday = todayDay - ((dayNames.indexOf(weekdayName) + 6) % 7);

  return rows.filter((row) => {
    const date = new Date(row.timestamp);
    const day = istDayNumber(date);
    if (range === "today") return day === todayDay;
    if (range === "yesterday") return day === todayDay - 1;
    if (range === "week") return day >= monday && day <= todayDay;
    return istDateKey.format(date).slice(0, 7) === currentKey.slice(0, 7);
  });
}

export function downloadUsageCsv(rows: UsageEvent[], range: ExportRange, limit: ExportLimit): void {
  const ranged = rowsForRange(rows, range).sort(
    (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
  );
  const selected = limit === "all" ? ranged : ranged.slice(0, Number(limit));
  const fields: Array<keyof UsageEvent> = [
    "user", "email", "source", "sessionId", "model", "prompt",
    "inputTokens", "outputTokens", "cacheReadTokens", "cacheCreateTokens",
    "latencyMs", "costUsd", "status",
  ];
  const quote = (value: unknown): string => `"${String(value).replaceAll('"', '""')}"`;
  const lines = [
    ["date_time_ist", ...fields].join(","),
    ...selected.map((row) => [
      quote(istDateTime.format(new Date(row.timestamp))),
      ...fields.map((field) => quote(row[field])),
    ].join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `resolute-claude-usage-${range}-${limit}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}