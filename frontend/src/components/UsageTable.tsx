import type { UsageEvent } from "../types/usage";
import { currency, integer, istDateTime } from "../lib/formatters";

function Detail({ label, value }: { label: string; value: string }) {
  return <p><span>{label}</span><b>{value}</b></p>;
}

function EventRow({ event, open, onToggle }: { event: UsageEvent; open: boolean; onToggle: () => void }) {
  return <>
    <tr className={open ? "selected" : ""}>
      <td><div className="user-text"><b>{event.user}</b><small>{event.sessionId}</small></div></td>
      <td className="email-cell">{event.email || "—"}</td>
      <td className="ist-time">{istDateTime.format(new Date(event.timestamp))}</td>
      <td><em className={`tag ${event.source.toLowerCase().replace(" ", "-")}`}>{event.source}</em></td>
      <td>{event.model}</td>
      <td>{integer.format(event.inputTokens)}</td>
      <td>{integer.format(event.outputTokens)}</td>
      <td>{integer.format(event.cacheReadTokens)}</td>
      <td>{integer.format(event.cacheCreateTokens)}</td>
      <td className="cost">{currency.format(event.costUsd)}</td>
      <td><em className={`status ${event.status}`}>{event.status}</em></td>
      <td><button className="expand" onClick={onToggle} aria-label={`${open ? "Hide" : "Show"} details for ${event.user}`}>{open ? "−" : "+"}</button></td>
    </tr>
    {open && <tr className="details"><td colSpan={12}><div>
      <Detail label="User prompt" value={event.prompt || "Prompt unavailable"} />
      <Detail label="Process owner" value={event.processOwner || "Unknown owner"} />
      <Detail label="Date and time (IST)" value={istDateTime.format(new Date(event.timestamp))} />
      <Detail label="Latency" value={`${integer.format(event.latencyMs)} ms`} />
      <Detail label="Total tokens" value={integer.format(event.inputTokens + event.outputTokens + event.cacheReadTokens + event.cacheCreateTokens)} />
      <Detail label="User email" value={event.email} />
      <Detail label="Event ID" value={event.id} />
    </div></td></tr>}
  </>;
}

interface Props {
  rows: UsageEvent[];
  selectedDateLabel: string;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  expanded: string | null;
  onExpandedChange: (id: string | null) => void;
}

export default function UsageTable({
  rows, selectedDateLabel, page, totalPages, onPageChange, expanded, onExpandedChange,
}: Props) {
  const totals = rows.reduce((sum, event) => ({
    input: sum.input + event.inputTokens,
    output: sum.output + event.outputTokens,
    cacheRead: sum.cacheRead + event.cacheReadTokens,
    cacheCreate: sum.cacheCreate + event.cacheCreateTokens,
    cost: sum.cost + event.costUsd,
  }), { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cost: 0 });
  const totalTokens = totals.input + totals.output + totals.cacheRead + totals.cacheCreate;

  return <>
    {rows.length > 0 && <div className="day-summary">
      <div><span>Page</span><strong>{page}</strong></div>
      <div><span>Prompts</span><strong>{integer.format(rows.length)}</strong></div>
      <div><span>Total tokens</span><strong>{integer.format(totalTokens)}</strong></div>
      <div><span>Total cost</span><strong>{currency.format(totals.cost)}</strong></div>
    </div>}
    <div className="table-scroll" aria-label="Scrollable usage records">
      <table>
        <thead><tr><th>User / session</th><th>User email</th><th>Date & time (IST)</th><th>Service</th><th>Model</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache create</th><th>Cost</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map((event) => <EventRow key={event.id} event={event} open={expanded === event.id} onToggle={() => onExpandedChange(expanded === event.id ? null : event.id)} />)}</tbody>
        {rows.length > 0 && <tfoot><tr>
          <td colSpan={5}>{selectedDateLabel} total ({rows.length} prompt{rows.length === 1 ? "" : "s"})</td>
          <td>{integer.format(totals.input)}</td>
          <td>{integer.format(totals.output)}</td>
          <td>{integer.format(totals.cacheRead)}</td>
          <td>{integer.format(totals.cacheCreate)}</td>
          <td className="cost">{currency.format(totals.cost)}</td>
          <td colSpan={2}>—</td>
        </tr></tfoot>}
      </table>
      {!rows.length && <div className="empty">No usage records match this search.</div>}
    </div>
    <div className="pagination date-pagination">
      <span>{totalPages === 0 ? "0 dates" : `${selectedDateLabel} · ${rows.length} prompt${rows.length === 1 ? "" : "s"}`}</span>
      <div>
        <button disabled={page <= 1 || totalPages === 0} onClick={() => onPageChange(1)} aria-label="First date">First</button>
        <button disabled={page <= 1 || totalPages === 0} onClick={() => onPageChange(page - 1)} aria-label="Newer date">←</button>
        <strong>{totalPages === 0 ? "Day 0 of 0" : `Day ${page} of ${totalPages}`}</strong>
        <button disabled={page >= totalPages || totalPages === 0} onClick={() => onPageChange(page + 1)} aria-label="Older date">→</button>
        <button disabled={page >= totalPages || totalPages === 0} onClick={() => onPageChange(totalPages)} aria-label="Last date">Last</button>
      </div>
    </div>
  </>;
}