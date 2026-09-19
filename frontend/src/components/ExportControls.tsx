import type { ExportLimit, ExportRange, UsageEvent } from "../types/usage";
import { downloadUsageCsv, rowsForRange } from "../lib/exportCsv";

interface Props {
  rows: UsageEvent[];
  range: ExportRange;
  limit: ExportLimit;
  onRangeChange: (range: ExportRange) => void;
  onLimitChange: (limit: ExportLimit) => void;
}

export default function ExportControls({ rows, range, limit, onRangeChange, onLimitChange }: Props) {
  const available = rowsForRange(rows, range).length;
  const ready = Math.min(available, limit === "all" ? available : Number(limit));

  return (
    <div className="export-bar">
      <strong>CSV export</strong>
      <label>Period
        <select value={range} onChange={(event) => onRangeChange(event.target.value as ExportRange)}>
          <option value="today">Today</option><option value="yesterday">Yesterday</option>
          <option value="week">This week</option><option value="month">This month</option>
        </select>
      </label>
      <label>Rows
        <select value={limit} onChange={(event) => onLimitChange(event.target.value as ExportLimit)}>
          <option value="50">Up to 50</option><option value="100">Up to 100</option><option value="all">All rows</option>
        </select>
      </label>
      <span>{ready} rows ready</span>
      <button className="export" onClick={() => downloadUsageCsv(rows, range, limit)} disabled={!available}>↓ Download CSV</button>
    </div>
  );
}