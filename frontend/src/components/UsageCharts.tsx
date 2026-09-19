import { useState, type ReactNode } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";
import type { DailyUsage, UsageBreakdown } from "../types/usage";
import { compact, integer } from "../lib/formatters";

const BLUE = "#1268d7";
const CATEGORY_COLORS = ["#0d47a1", "#1976d2", "#64b5f6", "#26a69a", "#5c65cf", "#90a4ae"];
const SERVICE_COLORS: Record<string, string> = { Cowork: "#16899c", Code: "#1268d7", Agent: "#5c65cf" };
const USER_COLORS = ["#1268d7", "#16899c", "#5c65cf", "#d97706", "#dc2626", "#059669", "#9333ea", "#0891b2", "#be123c", "#4d7c0f", "#7c3aed", "#0f766e"];
const decimal = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function Panel({ title, kicker, children }: { title: string; kicker: string; children: ReactNode }) {
  return <article className="panel"><div className="panel-head"><p className="kicker">{kicker}</p><h2>{title}</h2></div>{children}</article>;
}

type UserUsage = UsageBreakdown & { email: string; processOwner: string };
type DepartmentUsage = UsageBreakdown & { members: UserUsage[] };
type ClickableUsage = UsageBreakdown & { email?: string; processOwner?: string; members?: UserUsage[] };

function BreakdownChart({ data, labelWidth = 130, colors, onSelect, valueLabel = "Tokens", decimalValues = false }: {
  data: ClickableUsage[];
  labelWidth?: number;
  colors?: Record<string, string> | string[];
  onSelect?: (item: ClickableUsage) => void;
  valueLabel?: string;
  decimalValues?: boolean;
}) {
  const height = Math.max(240, data.length * 40 + 54);
  const colorFor = (item: UsageBreakdown, index: number) => Array.isArray(colors)
    ? colors[index % colors.length]
    : colors?.[item.name] ?? BLUE;

  return <div className="breakdown-chart report-breakdown">
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 28, top: 16, bottom: 8 }}>
        <CartesianGrid horizontal={false} stroke="#e3ebf6" />
        <XAxis type="number" axisLine={false} tickLine={false} tickFormatter={(value: number) => compact.format(value)} />
        <YAxis dataKey="name" type="category" width={labelWidth} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#315779" }} interval={0} />
        <Tooltip formatter={(value) => [decimalValues ? decimal.format(Number(value)) : integer.format(Number(value)), valueLabel]} contentStyle={{ borderRadius: 8, borderColor: "#dce7f3" }} />
        <Bar
          dataKey="tokens"
          barSize={20}
          radius={[0, 6, 6, 0]}
          className={onSelect ? "clickable-chart-bar" : undefined}
          onClick={onSelect ? (entry: unknown) => {
            const value = entry as ClickableUsage & { payload?: ClickableUsage };
            onSelect(value.payload ?? value);
          } : undefined}
        >
          {data.map((item, index) => <Cell key={item.name} fill={colorFor(item, index)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    {!data.length && <div className="chart-empty">No data available.</div>}
  </div>;
}

function UserDetail({ user }: { user: UserUsage | null }) {
  if (!user) return <p className="chart-drilldown-hint">Select a bar to see the user email and process owner.</p>;
  return <div className="chart-drilldown user-drilldown">
    <div><span>Email</span><strong>{user.email}</strong></div>
    <div><span>Process owner</span><strong>{user.processOwner}</strong></div>
    <div><span>Tokens</span><strong>{integer.format(user.tokens)}</strong></div>
    <div><span>Events</span><strong>{integer.format(user.events)}</strong></div>
  </div>;
}

function DepartmentDetail({ department }: { department: DepartmentUsage | null }) {
  if (!department) return <p className="chart-drilldown-hint">Select a department bar to see its users and process owners.</p>;
  return <div className="department-drilldown">
    <div className="department-drilldown-title"><strong>{department.name}</strong><span>{department.members.length} user{department.members.length === 1 ? "" : "s"}</span></div>
    {department.members.length ? department.members.map((member) => <div className="department-member" key={member.email}>
      <span><b>{member.email}</b><small>{member.processOwner}</small></span>
      <strong>{compact.format(member.tokens)} tokens</strong>
    </div>) : <p>No identified users in this department for the latest month.</p>}
  </div>;
}

interface Props {
  daily: DailyUsage[];
  departmentUsage: DepartmentUsage[];
  claudeServices: UsageBreakdown[];
  weeklyUserUsage: UserUsage[];
  monthlyUserUsage: UserUsage[];
  monthlyDailyUserUsage: {
    days: Array<Record<string, string | number>>;
    users: Array<{ key: string; email: string; processOwner: string }>;
  };
  modelUsage: UsageBreakdown[];
  pluginUsage: UsageBreakdown[];
  connectorUsage: UsageBreakdown[];
}

function DailyUserDotChart({ data }: { data: Props["monthlyDailyUserUsage"] }) {
  if (!data.users.length) return <div className="chart-empty">No user activity is available for the latest month.</div>;
  return <ResponsiveContainer width="100%" height={440}>
    <ScatterChart margin={{ left: 2, right: 24, top: 22, bottom: 32 }}>
      <CartesianGrid stroke="#e3ebf6" />
      <XAxis dataKey="date" type="category" name="Date" allowDuplicatedCategory={false} angle={-35} textAnchor="end" height={58} tick={{ fontSize: 10 }} />
      <YAxis dataKey="tokens" type="number" name="Usage" tickFormatter={(value: number) => compact.format(value)} />
      <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(value, name) => [integer.format(Number(value)), name === "Usage" ? "Tokens" : name]} contentStyle={{ borderRadius: 8, borderColor: "#dce7f3" }} />
      <Legend wrapperStyle={{ fontSize: 10 }} />
      {data.users.map((user, index) => <Scatter
        key={user.key}
        name={`${user.processOwner} · ${user.email}`}
        fill={USER_COLORS[index % USER_COLORS.length]}
        data={data.days.map((day) => ({ date: day.date, tokens: Number(day[user.key] || 0) })).filter((point) => point.tokens > 0)}
      />)}
    </ScatterChart>
  </ResponsiveContainer>;
}

export default function UsageCharts({ daily, departmentUsage, claudeServices, weeklyUserUsage, monthlyUserUsage, monthlyDailyUserUsage, modelUsage, pluginUsage, connectorUsage }: Props) {
  const [selectedDepartment, setSelectedDepartment] = useState<DepartmentUsage | null>(null);
  const [selectedWeeklyUser, setSelectedWeeklyUser] = useState<UserUsage | null>(null);
  const [selectedMonthlyUser, setSelectedMonthlyUser] = useState<UserUsage | null>(null);

  return <section className="report-chart-grid">
    <Panel title="Monthly usage by department" kicker="Latest month · click a department">
      <BreakdownChart data={departmentUsage} labelWidth={145} colors={CATEGORY_COLORS} onSelect={(item) => setSelectedDepartment(item as DepartmentUsage)} />
      <DepartmentDetail department={selectedDepartment} />
    </Panel>
    <Panel title="Claude service usage" kicker="Cowork · Code · Agent">
      <BreakdownChart data={claudeServices} labelWidth={78} colors={SERVICE_COLORS} />
    </Panel>
    <Panel title="Weekly user usage" kicker="Latest week · email and process owner · click a user">
      <BreakdownChart data={weeklyUserUsage} labelWidth={210} onSelect={(item) => setSelectedWeeklyUser(item as UserUsage)} />
      <UserDetail user={selectedWeeklyUser} />
    </Panel>
    <Panel title="Monthly user usage" kicker="Latest month · email and process owner · click a user">
      <BreakdownChart data={monthlyUserUsage} labelWidth={210} onSelect={(item) => setSelectedMonthlyUser(item as UserUsage)} />
      <UserDetail user={selectedMonthlyUser} />
    </Panel>
    <Panel title="Daily usage by user" kicker="Latest month · every user · every day · IST">
      <DailyUserDotChart data={monthlyDailyUserUsage} />
    </Panel>
    {/* <Panel title="Skills & plugins" kicker="Average executions per active day · IST">
      <BreakdownChart data={pluginUsage} labelWidth={180} colors={CATEGORY_COLORS} valueLabel="Average executions/day" decimalValues />
    </Panel> */}
    {/* <Panel title="Connectors" kicker="Average executions per active day · IST">
      <BreakdownChart data={connectorUsage} labelWidth={180} colors={CATEGORY_COLORS} valueLabel="Average executions/day" decimalValues />
    </Panel> */}
    <Panel title="Model usage" kicker="Top 10 · total tokens">
      <BreakdownChart data={modelUsage} labelWidth={130} colors={["#5c65cf", "#1268d7", "#16899c"]} />
    </Panel>
    <Panel title="Daily token usage" kicker="India Standard Time">
      <ResponsiveContainer width="100%" height={294}>
        <AreaChart data={daily} margin={{ left: -12, right: 18, top: 26, bottom: 8 }}>
          <defs><linearGradient id="dailyReportFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={BLUE} stopOpacity=".3" /><stop offset="1" stopColor={BLUE} stopOpacity="0" /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="#e3ebf6" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis axisLine={false} tickLine={false} tickFormatter={(value: number) => compact.format(value)} />
          <Tooltip formatter={(value) => [integer.format(Number(value)), "Tokens"]} contentStyle={{ borderRadius: 8, borderColor: "#dce7f3" }} />
          <Area dataKey="tokens" stroke={BLUE} strokeWidth={2.5} fill="url(#dailyReportFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  </section>;
}
