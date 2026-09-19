import { useMemo, useState } from "react";

import ExportControls from "./components/ExportControls";
import Header from "./components/Header";
import MetricGrid from "./components/MetricGrid";
import UsageCharts from "./components/UsageCharts";
import UsageTable from "./components/UsageTable";

import { useUsageStream } from "./hooks/useUsageStream";

import {
  istDateKey,
  istDateLabel,
  istDateTime,
} from "./lib/formatters";

import type {
  DailyUsage,
  ExportLimit,
  ExportRange,
  UsageBreakdown,
  UsageEvent,
} from "./types/usage";

import "./index.css";


function usageBreakdown(
  events: UsageEvent[],
  value: (event: UsageEvent) => string,
): UsageBreakdown[] {
  const grouped =
    new Map<string, UsageBreakdown>();

  for (const event of events) {
    const name =
      value(event).trim() || "Unknown";

    const item =
      grouped.get(name) ?? {
        name,
        tokens: 0,
        events: 0,
        cost: 0,
      };

    item.tokens +=
      event.inputTokens +
      event.outputTokens +
      event.cacheReadTokens +
      event.cacheCreateTokens;

    item.events += 1;
    item.cost += event.costUsd;

    grouped.set(name, item);
  }

  return Array.from(grouped.values())
    .sort(
      (a, b) =>
        b.tokens - a.tokens ||
        b.events - a.events,
    )
    .slice(0, 10);
}


function eventTextField(
  event: UsageEvent,
  field: "plugin" | "hook",
): string {
  const raw =
    event as unknown as Record<
      string,
      unknown
    >;

  const attributes =
    (
      raw.attributes &&
      typeof raw.attributes === "object"
        ? raw.attributes
        : {}
    ) as Record<string, unknown>;

  const plugin =
    (
      raw.plugin &&
      typeof raw.plugin === "object"
        ? raw.plugin
        : {}
    ) as Record<string, unknown>;

  const candidates =
    field === "plugin"
      ? [
          raw["plugin.name"],
          raw.pluginName,
          raw.plugin_name,
          plugin.name,
          attributes["plugin.name"],
          attributes.plugin_name,
        ]
      : [
          raw.hook_name,
          raw.hookName,
          raw["hook.name"],
          attributes.hook_name,
          attributes["hook.name"],
        ];

  const found =
    candidates.find(
      (value) =>
        typeof value === "string" &&
        value.trim(),
    );

  return typeof found === "string"
    ? found.trim()
    : "";
}


function normalizedEventName(
  event: UsageEvent,
): string {
  const raw =
    event as unknown as Record<
      string,
      unknown
    >;

  const value =
    raw.eventName ??
    raw.event_name;

  return typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
}


function averageDailyUsageBreakdown(
  events: UsageEvent[],
  value: (event: UsageEvent) => string,
): UsageBreakdown[] {
  const grouped =
    new Map<
      string,
      {
        events: number;
        dates: Set<string>;
      }
    >();

  for (const event of events) {
    const name = value(event);

    if (!name) continue;

    const item =
      grouped.get(name) ?? {
        events: 0,
        dates: new Set<string>(),
      };

    item.events += 1;

    if (event.timestamp) {
      item.dates.add(
        istDateKey.format(
          new Date(event.timestamp),
        ),
      );
    }

    grouped.set(name, item);
  }

  return Array.from(
    grouped,
    ([name, item]) => ({
      name,
      tokens:
        item.events /
        Math.max(
          item.dates.size,
          1,
        ),
      events: item.events,
      cost: 0,
    }),
  ).sort(
    (a, b) =>
      b.tokens - a.tokens,
  );
}


type UserUsage =
  UsageBreakdown & {
    email: string;
    processOwner: string;
  };


type DepartmentUsage =
  UsageBreakdown & {
    members: UserUsage[];
  };


type MonthlyUserSeries = {
  days: Array<
    Record<string, string | number>
  >;

  users: Array<{
    key: string;
    email: string;
    processOwner: string;
  }>;
};


function totalTokens(
  event: UsageEvent,
): number {
  return (
    event.inputTokens +
    event.outputTokens +
    event.cacheReadTokens +
    event.cacheCreateTokens
  );
}


function periodKey(
  timestamp: string,
  period: "week" | "month",
): string {
  const sourceDate =
    new Date(timestamp);

  const istDate =
    new Date(
      sourceDate.getTime() +
        330 * 60 * 1000,
    );

  if (period === "month") {
    return `${istDate.getUTCFullYear()}-${String(
      istDate.getUTCMonth() + 1,
    ).padStart(2, "0")}`;
  }

  const dayFromMonday =
    (istDate.getUTCDay() + 6) %
    7;

  return new Date(
    Date.UTC(
      istDate.getUTCFullYear(),
      istDate.getUTCMonth(),
      istDate.getUTCDate() -
        dayFromMonday,
    ),
  )
    .toISOString()
    .slice(0, 10);
}


function emailLocalPart(
  email: string,
): string {
  return (
    email || "unknown"
  ).split("@")[0];
}


function usageForLatestPeriod(
  events: UsageEvent[],
  period: "week" | "month",
): UserUsage[] {
  if (!events.length) {
    return [];
  }

  const latest =
    events.reduce(
      (value, event) =>
        Date.parse(
          event.timestamp,
        ) >
        Date.parse(
          value.timestamp,
        )
          ? event
          : value,
    );

  const latestKey =
    periodKey(
      latest.timestamp,
      period,
    );

  const grouped =
    new Map<
      string,
      UserUsage
    >();

  for (
    const event of events.filter(
      (item) =>
        periodKey(
          item.timestamp,
          period,
        ) === latestKey,
    )
  ) {
    const email =
      event.email?.trim() ||
      "unknown";

    const processOwner =
      event.processOwner?.trim() ||
      "Unassigned";

    const label =
      `${emailLocalPart(email)} · ${processOwner}`;

    const item =
      grouped.get(email) ?? {
        name: label,
        email,
        processOwner,
        tokens: 0,
        events: 0,
        cost: 0,
      };

    item.tokens +=
      totalTokens(event);

    item.events += 1;
    item.cost += event.costUsd;

    grouped.set(
      email,
      item,
    );
  }

  return Array.from(
    grouped.values(),
  ).sort(
    (a, b) =>
      b.tokens - a.tokens ||
      b.events - a.events,
  );
}


function latestMonthDailyUserUsage(
  events: UsageEvent[],
): MonthlyUserSeries {
  if (!events.length) {
    return {
      days: [],
      users: [],
    };
  }

  const latest =
    events.reduce(
      (value, event) =>
        Date.parse(
          event.timestamp,
        ) >
        Date.parse(
          value.timestamp,
        )
          ? event
          : value,
    );

  const latestMonth =
    periodKey(
      latest.timestamp,
      "month",
    );

  const monthEvents =
    events.filter(
      (event) =>
        periodKey(
          event.timestamp,
          "month",
        ) === latestMonth,
    );

  const userDetails =
    new Map<
      string,
      {
        email: string;
        processOwner: string;
      }
    >();

  for (
    const event of monthEvents
  ) {
    const email =
      event.email?.trim() ||
      "unknown";

    userDetails.set(
      email,
      {
        email,
        processOwner:
          event.processOwner?.trim() ||
          "Unassigned",
      },
    );
  }

  const users =
    Array.from(
      userDetails.values(),
    )
      .sort(
        (a, b) =>
          a.email.localeCompare(
            b.email,
          ),
      )
      .map(
        (
          user,
          index,
        ) => ({
          key: `user_${index}`,
          ...user,
        }),
      );

  const userKeyByEmail =
    new Map(
      users.map(
        (user) => [
          user.email,
          user.key,
        ],
      ),
    );

  const [year, month] =
    latestMonth
      .split("-")
      .map(Number);

  const latestIst =
    new Date(
      new Date(
        latest.timestamp,
      ).getTime() +
        330 * 60 * 1000,
    );

  const lastDay =
    latestIst.getUTCDate();

  const days =
    Array.from(
      {
        length: lastDay,
      },
      (_, index) => {
        const dayNumber =
          index + 1;

        const dateKey =
          `${year}-${String(
            month,
          ).padStart(
            2,
            "0",
          )}-${String(
            dayNumber,
          ).padStart(
            2,
            "0",
          )}`;

        const row:
          Record<
            string,
            string | number
          > = {
          date: dateKey,
          label: String(
            dayNumber,
          ).padStart(
            2,
            "0",
          ),
        };

        for (
          const user of users
        ) {
          row[user.key] = 0;
        }

        return row;
      },
    );

  for (
    const event of monthEvents
  ) {
    const eventIst =
      new Date(
        new Date(
          event.timestamp,
        ).getTime() +
          330 * 60 * 1000,
      );

    const row =
      days[
        eventIst.getUTCDate() -
          1
      ];

    const userKey =
      userKeyByEmail.get(
        event.email?.trim() ||
          "unknown",
      );

    if (
      row &&
      userKey
    ) {
      row[userKey] =
        Number(
          row[userKey] || 0,
        ) +
        totalTokens(event);
    }
  }

  return {
    days,
    users,
  };
}


const DEPARTMENT_EMAIL_MATCHES =
  [
    {
      name: "HairDrama",
      matches: [
        "hairdrama",
      ],
    },

    {
      name:
        "Research Investment",
      matches: [
        "research",
      ],
    },

    {
      name:
        "Leads Investment",
      matches: [
        "leads investment",
        "leads",
      ],
    },

    {
      name:
        "Operations Investment",
      matches: [
        "operations investment",
        "operations",
      ],
    },

    {
      name:
        "Data Analytics",

      matches: [
        "data analytics & automation",
        "dataanalytics",
        "dataanlytics",
        "automation",
        "shashank",
        "jay",
      ],
    },

    {
      name: "IT",
      matches: [
        "it",
        "sanjeev",
        "indira",
      ],
    },

    {
      name: "HR",
      matches: [
        "hr",
        "human",
      ],
    },

    {
      name:
        "ShareSquare",
      matches: [
        "sharesquare",
      ],
    },

    {
      name: "Finance",
      matches: [
        "finance",
        "dilip",
      ],
    },
  ] as const;


const DEPARTMENT_GROUPS = [
  ...DEPARTMENT_EMAIL_MATCHES.map(
    ({ name }) => name,
  ),
  "Other",
];


function departmentGroup(
  event: UsageEvent,
): string {
  const email =
    (
      event.email || ""
    )
      .trim()
      .toLowerCase();

  return (
    DEPARTMENT_EMAIL_MATCHES.find(
      ({ matches }) =>
        matches.some(
          (
            departmentName,
          ) =>
            email.includes(
              departmentName.toLowerCase(),
            ),
        ),
    )?.name ?? "Other"
  );
}


function latestMonthDepartmentUsage(
  events: UsageEvent[],
): DepartmentUsage[] {
  const groups =
    DEPARTMENT_GROUPS;

  const latestKey =
    events.length
      ? periodKey(
          events.reduce(
            (
              value,
              event,
            ) =>
              Date.parse(
                event.timestamp,
              ) >
              Date.parse(
                value.timestamp,
              )
                ? event
                : value,
          ).timestamp,
          "month",
        )
      : "";

  const totals =
    new Map(
      groups.map(
        (name) => [
          name,
          {
            name,
            tokens: 0,
            events: 0,
            cost: 0,
            members:
              [] as UserUsage[],
          },
        ],
      ),
    );

  const members =
    new Map(
      groups.map(
        (name) => [
          name,
          new Map<
            string,
            UserUsage
          >(),
        ],
      ),
    );

  for (
    const event of events.filter(
      (item) =>
        periodKey(
          item.timestamp,
          "month",
        ) === latestKey,
    )
  ) {
    const name =
      departmentGroup(event);

    const item =
      totals.get(name)!;

    item.tokens +=
      totalTokens(event);

    item.events += 1;
    item.cost +=
      event.costUsd;

    const email =
      event.email?.trim() ||
      "unknown";

    const processOwner =
      event.processOwner?.trim() ||
      "Unassigned";

    const memberMap =
      members.get(name)!;

    const member =
      memberMap.get(email) ?? {
        name:
          `${emailLocalPart(email)} · ${processOwner}`,

        email,
        processOwner,

        tokens: 0,
        events: 0,
        cost: 0,
      };

    member.tokens +=
      totalTokens(event);

    member.events += 1;
    member.cost +=
      event.costUsd;

    memberMap.set(
      email,
      member,
    );
  }

  return groups.map(
    (name) => ({
      ...totals.get(name)!,

      members:
        Array.from(
          members
            .get(name)!
            .values(),
        ).sort(
          (a, b) =>
            b.tokens -
            a.tokens,
        ),
    }),
  );
}


function serviceUsage(
  events: UsageEvent[],
): UsageBreakdown[] {
  const names = [
    "Cowork",
    "Code",
    "Agent",
  ];

  const totals =
    new Map(
      names.map(
        (name) => [
          name,
          {
            name,
            tokens: 0,
            events: 0,
            cost: 0,
          },
        ],
      ),
    );

  for (
    const event of events
  ) {
    const name =
      event.source ===
      "Claude Code"
        ? "Code"
        : event.source;

    const item =
      totals.get(name);

    if (!item) {
      continue;
    }

    item.tokens +=
      totalTokens(event);

    item.events += 1;
    item.cost +=
      event.costUsd;
  }

  return names.map(
    (name) =>
      totals.get(name)!,
  );
}


export default function App() {
  /*
   * Search/filter state must exist before
   * useUsageStream so it can send them
   * to the backend.
   */
  const [
    query,
    setQuery,
  ] = useState("");

  const [
    source,
    setSource,
  ] = useState(
    "All services",
  );

  /*
   * IMPORTANT:
   *
   * page/hasMore/nextPage/previousPage now
   * come from the cursor-pagination hook.
   *
   * There is no second local page state.
   */
  const {
    events,
    connection,
    page,
    hasMore,
    loading,
    nextPage,
    previousPage,
    refreshLatest,
  } = useUsageStream({
    query,
    source,
    pageSize: 100,
  });

  const [
    expanded,
    setExpanded,
  ] =
    useState<
      string | null
    >(null);

  const [
    exportRange,
    setExportRange,
  ] =
    useState<ExportRange>(
      "today",
    );

  const [
    exportLimit,
    setExportLimit,
  ] =
    useState<ExportLimit>(
      "50",
    );

  /*
   * Keeping your existing frontend filtering.
   * This preserves your current behaviour
   * with minimum changes.
   */
  const filtered =
    useMemo(() => {
      const needle =
        query
          .trim()
          .toLowerCase();

      return events
        .filter(
          (event) => {
            const matchesService =
              source ===
                "All services" ||
              event.source ===
                source;

            const searchable =
              [
                event.user,
                event.email,
                event.processOwner,
                event.sessionId,
                event.model,
                event.prompt,
                event.source,

                istDateTime.format(
                  new Date(
                    event.timestamp,
                  ),
                ),

                istDateLabel.format(
                  new Date(
                    event.timestamp,
                  ),
                ),
              ]
                .join(" ")
                .toLowerCase();

            return (
              matchesService &&
              (
                !needle ||
                searchable.includes(
                  needle,
                )
              )
            );
          },
        )
        .sort(
          (a, b) =>
            Date.parse(
              b.timestamp,
            ) -
            Date.parse(
              a.timestamp,
            ),
        );
    }, [
      events,
      query,
      source,
    ]);


  /*
   * Existing graph logic preserved.
   *
   * No analyticsEvents change here.
   */
  const daily =
    useMemo<
      DailyUsage[]
    >(() => {
      const grouped =
        new Map<
          string,
          DailyUsage
        >();

      for (
        const event of events
      ) {
        const key =
          istDateKey.format(
            new Date(
              event.timestamp,
            ),
          );

        const day =
          grouped.get(key) ?? {
            key,

            label:
              istDateLabel.format(
                new Date(
                  event.timestamp,
                ),
              ),

            tokens: 0,
            cost: 0,
          };

        day.tokens +=
          event.inputTokens +
          event.outputTokens +
          event.cacheReadTokens +
          event.cacheCreateTokens;

        day.cost +=
          event.costUsd;

        grouped.set(
          key,
          day,
        );
      }

      return Array.from(
        grouped.values(),
      ).sort(
        (a, b) =>
          a.key.localeCompare(
            b.key,
          ),
      );
    }, [events]);


  const departmentUsage =
    useMemo(
      () =>
        latestMonthDepartmentUsage(
          events,
        ),
      [events],
    );


  const claudeServices =
    useMemo(
      () =>
        serviceUsage(
          events,
        ),
      [events],
    );


  const weeklyUserUsage =
    useMemo(
      () =>
        usageForLatestPeriod(
          events,
          "week",
        ),
      [events],
    );


  const monthlyUserUsage =
    useMemo(
      () =>
        usageForLatestPeriod(
          events,
          "month",
        ),
      [events],
    );


  const monthlyDailyUserUsage =
    useMemo(
      () =>
        latestMonthDailyUserUsage(
          events,
        ),
      [events],
    );


  const modelUsage =
    useMemo(
      () =>
        usageBreakdown(
          events,
          (event) =>
            event.model,
        ),
      [events],
    );


  const pluginUsage =
    useMemo(
      () =>
        averageDailyUsageBreakdown(
          events,
          (event) =>
            eventTextField(
              event,
              "plugin",
            ),
        ),
      [events],
    );


  const connectorUsage =
    useMemo(
      () =>
        averageDailyUsageBreakdown(
          events.filter(
            (event) =>
              normalizedEventName(
                event,
              ) ===
              "hook_execution_complete",
          ),

          (event) =>
            eventTextField(
              event,
              "hook",
            ),
        ),
      [events],
    );


  /*
   * Keep the existing UsageTable interface
   * so you do not need a large table rewrite.
   *
   * Because backend pagination is cursor based,
   * we expose only:
   *
   * current page
   * previous page
   * next page
   *
   * If backend says hasMore=true,
   * totalPages temporarily becomes page + 1.
   */
  const visiblePages =
    hasMore
      ? page + 1
      : page;


  const handlePageChange =
    (
      requestedPage:
        number,
    ) => {
      /*
       * Existing table's "first" button.
       */
      if (
        requestedPage ===
          1 &&
        page > 1
      ) {
        refreshLatest();
        return;
      }

      /*
       * Next cursor page.
       */
      if (
        requestedPage >
          page &&
        hasMore &&
        !loading
      ) {
        nextPage();
        return;
      }

      /*
       * Previous cursor page.
       */
      if (
        requestedPage <
          page &&
        page > 1 &&
        !loading
      ) {
        previousPage();
      }
    };


  return (
    <main>
      <Header
        connection={
          connection
        }
      />

      <div className="wrap dashboard-wrap">

        <MetricGrid
          events={
            filtered
          }
        />


        <UsageCharts
          daily={daily}

          departmentUsage={
            departmentUsage
          }

          claudeServices={
            claudeServices
          }

          weeklyUserUsage={
            weeklyUserUsage
          }

          monthlyUserUsage={
            monthlyUserUsage
          }

          monthlyDailyUserUsage={
            monthlyDailyUserUsage
          }

          modelUsage={
            modelUsage
          }

          pluginUsage={
            pluginUsage
          }

          connectorUsage={
            connectorUsage
          }
        />


        <section className="panel table-panel">

          <div className="toolbar">

            <div>
              <p className="kicker">
                Prompt and session stream · IST
              </p>

              <h2>
                Usage records
              </h2>

              <small>
                {filtered.length}
                {" "}
                matching OTLP events
                {" · "}
                Page {page}
                {hasMore
                  ? " · more records available"
                  : ""}
              </small>
            </div>


            <div className="filters">

              <label className="search">
                ⌕

                <input
                  value={
                    query
                  }

                  onChange={(
                    event,
                  ) =>
                    setQuery(
                      event
                        .target
                        .value,
                    )
                  }

                  placeholder="Search user, owner, session, model, prompt or service…"

                  aria-label="Search usage records"
                />
              </label>


              <select
                value={
                  source
                }

                onChange={(
                  event,
                ) =>
                  setSource(
                    event
                      .target
                      .value,
                  )
                }

                aria-label="Filter table by service"
              >
                <option>
                  All services
                </option>

                <option>
                  Claude Code
                </option>

                <option>
                  Cowork
                </option>

                <option>
                  Agent
                </option>

              </select>

            </div>

          </div>


          <ExportControls
            rows={
              filtered
            }

            range={
              exportRange
            }

            limit={
              exportLimit
            }

            onRangeChange={
              setExportRange
            }

            onLimitChange={
              setExportLimit
            }
          />


          <UsageTable
            rows={
              filtered
            }

            selectedDateLabel={
              `Page ${page}`
            }

            page={
              page
            }

            totalPages={
              visiblePages
            }

            onPageChange={
              handlePageChange
            }

            expanded={
              expanded
            }

            onExpandedChange={
              setExpanded
            }
          />

        </section>


        <footer>
          <span>
            Cost values are estimates until reconciled against provider billing.
          </span>

          <span>
            All dates and times shown in IST
          </span>
        </footer>

      </div>
    </main>
  );
}