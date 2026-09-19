import type { ClaudeService, UsageEvent, UsageStatus } from "../types/usage";

type SeedRow = readonly [
  string, string, string, ClaudeService, string, string, string,
  number, number, number, number, number, number, UsageStatus,
];

const rows: SeedRow[] = [
  ["Aarav Mehta","AM","aarav@resolute.ai","Claude Code","ses_7f2a1c","Claude Sonnet 4.5","Refactor the billing reconciliation service",8420,2188,6400,1200,12840,.1842,"success"],
  ["Nisha Verma","NV","nisha@resolute.ai","Cowork","ses_91bd03","Claude Opus 4.1","Synthesize Q3 customer research themes",12480,4510,8900,2100,22120,.4268,"success"],
  ["Rohan Shah","RS","rohan@resolute.ai","Agent","ses_c482f8","Claude Sonnet 4.5","Investigate failed checkout automation",6780,1820,3200,890,9380,.1327,"success"],
  ["Isha Kapoor","IK","isha@resolute.ai","Claude Code","ses_01fa92","Claude Haiku 4.5","Generate API contract tests",3980,1240,1800,440,5290,.0384,"success"],
  ["Dev Malhotra","DM","dev@resolute.ai","Cowork","ses_6de541","Claude Sonnet 4.5","Build an onboarding research brief",9340,3280,7200,1600,18940,.2731,"success"],
  ["Maya Rao","MR","maya@resolute.ai","Agent","ses_2ad774","Claude Sonnet 4.5","Triage the overnight alert queue",5710,980,4100,780,8020,.0948,"error"],
  ["Kabir Singh","KS","kabir@resolute.ai","Claude Code","ses_35ca11","Claude Opus 4.1","Review authentication middleware",14720,3840,11600,2240,19670,.4679,"success"],
  ["Ananya Bose","AB","ananya@resolute.ai","Cowork","ses_a105d2","Claude Haiku 4.5","Summarize sales call follow-ups",2840,760,1200,320,4680,.0291,"success"],
  ["Vikram Joshi","VJ","vikram@resolute.ai","Agent","ses_b3ce09","Claude Sonnet 4.5","Run dependency vulnerability analysis",7820,2420,5200,1080,14330,.1776,"success"],
  ["Sara Khan","SK","sara@resolute.ai","Claude Code","ses_890ee4","Claude Sonnet 4.5","Optimize the analytics query plan",11040,2760,9800,1840,16620,.2315,"success"],
  ["Arjun Nair","AN","arjun@resolute.ai","Cowork","ses_43afd7","Claude Opus 4.1","Prepare the board operations memo",16100,5240,12700,2800,24960,.5318,"success"],
  ["Meera Iyer","MI","meera@resolute.ai","Agent","ses_1fb207","Claude Haiku 4.5","Classify support tickets by urgency",4260,1120,2480,540,7120,.0473,"success"],
];

export const usageEvents: UsageEvent[] = [0, 1, 2].flatMap((dayOffset) =>
  rows.map((row, index) => ({
    id: `evt_${dayOffset}_${String(index + 1).padStart(4, "0")}`,
    timestamp: new Date(Date.UTC(2026, 7, 16 - dayOffset, 12, 42 - index * 17)).toISOString(),
    user: row[0],
    initials: row[1],
    email: row[2],
    source: row[3],
    sessionId: `${row[4]}_${dayOffset + 1}`,
    model: row[5],
    prompt: row[6],
    processOwner: row[0],
    inputTokens: row[7],
    outputTokens: row[8],
    cacheReadTokens: row[9],
    cacheCreateTokens: row[10],
    latencyMs: row[11],
    costUsd: row[12],
    status: row[13],
  })),
);
