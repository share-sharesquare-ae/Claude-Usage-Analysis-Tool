import type { UsageEvent } from "../types/usage";
import { compact, integer } from "../lib/formatters";

interface MetricCardProps {
  label: string;
  value: string;
  note: string;
  tone: string;
}

function MetricCard({ label, value, note, tone }: MetricCardProps) {
  return <article className={`metric ${tone}`}><p>{label}</p><strong>{value}</strong><span>{note}</span></article>;
}

export default function MetricGrid({ events }: { events: UsageEvent[] }) {
  const totals = events.reduce(
    (sum, event) => ({
      input: sum.input + event.inputTokens,
      output: sum.output + event.outputTokens,
      cache: sum.cache + event.cacheReadTokens + event.cacheCreateTokens,
    }),
    { input: 0, output: 0, cache: 0 },
  );
  const users = new Set(events.map((event) => event.email)).size;
  const sessions = new Set(events.map((event) => event.sessionId)).size;

  return (
    <section className="metrics five">
      <MetricCard label="Total users" value={`${users}/50`} note="Employees represented" tone="blue" />
      <MetricCard label="Total sessions" value={integer.format(sessions)} note="Unique Claude sessions" tone="indigo" />
      <MetricCard label="Cache tokens" value={compact.format(totals.cache)} note="Read + create tokens" tone="sky" />
      <MetricCard label="Input tokens" value={compact.format(totals.input)} note="Prompt and context" tone="cyan" />
      <MetricCard label="Output tokens" value={compact.format(totals.output)} note="Generated responses" tone="blue" />
    </section>
  );
}