import { useEffect, useState } from "react";

import {
  fetchUsageEvents,
  WS_URL,
} from "../lib/api";

import type {
  UsageCursor,
  UsageSocketFrame,
} from "../lib/api";

import type {
  ConnectionState,
  UsageEvent,
} from "../types/usage";

interface UseUsageStreamOptions {
  query: string;
  source: string;
  pageSize?: number;
}

interface UseUsageStreamResult {
  events: UsageEvent[];
  connection: ConnectionState;

  page: number;
  hasMore: boolean;
  loading: boolean;

  pendingEvents: number;

  nextPage: () => void;
  previousPage: () => void;
  refreshLatest: () => void;
}

export function useUsageStream({
  query = "",
  source = "All services",
  pageSize = 100,
}: Partial<UseUsageStreamOptions> = {}): UseUsageStreamResult {
  const [events, setEvents] =
    useState<UsageEvent[]>([]);

  const [connection, setConnection] =
    useState<ConnectionState>("connecting");

  const [loading, setLoading] =
    useState(false);

  const [page, setPage] =
    useState(1);

  /*
   * cursors[0] = null => first page
   * cursors[1] = cursor required for page 2
   * cursors[2] = cursor required for page 3
   */
  const [cursors, setCursors] =
    useState<Array<UsageCursor | null>>([
      null,
    ]);

  const [nextCursor, setNextCursor] =
    useState<UsageCursor | null>(null);

  const [hasMore, setHasMore] =
    useState(false);

  /*
   * WebSocket events must NOT be directly inserted
   * into a cursor-paginated page.
   *
   * We only notify the user that new records exist.
   */
  const [pendingEvents, setPendingEvents] =
    useState(0);

  const [refreshKey, setRefreshKey] =
    useState(0);

  /*
   * Avoid hitting PostgreSQL on every keystroke.
   */
  const [debouncedQuery, setDebouncedQuery] =
    useState(query);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 300);

    return () =>
      window.clearTimeout(timer);
  }, [query]);

  /*
   * If search/service changes, old cursors are invalid.
   * Start again from page 1.
   */
  useEffect(() => {
    setPage(1);
    setCursors([null]);
    setNextCursor(null);
    setHasMore(false);
  }, [
    debouncedQuery,
    source,
    pageSize,
  ]);

  const cursor =
    cursors[page - 1] ?? null;

  /*
   * REST pagination effect.
   *
   * This effect changes when:
   * - page changes
   * - cursor changes
   * - filter changes
   * - manual refresh happens
   *
   * WebSocket is intentionally NOT created here.
   */
  useEffect(() => {
    const controller =
      new AbortController();

    setLoading(true);

    fetchUsageEvents(
      pageSize,
      cursor,
      {
        search: debouncedQuery,
        service: source,
      },
      controller.signal,
    )
      .then((response) => {
        if (controller.signal.aborted) {
          return;
        }

        setEvents(response.items);

        setHasMore(
          response.hasMore,
        );

        setNextCursor(
          response.nextCursor,
        );
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(
            "Failed to load OTLP history",
            error,
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [
    page,
    pageSize,
    cursor?.timestamp,
    cursor?.id,
    debouncedQuery,
    source,
    refreshKey,
  ]);

  /*
   * ONE persistent WebSocket connection.
   *
   * Changing page must NOT reconnect WebSocket.
   */
  useEffect(() => {
    let socket:
      | WebSocket
      | undefined;

    let reconnectTimer:
      | number
      | undefined;

    let stopped = false;

    let reconnectDelay = 1000;

    const connect = () => {
      if (stopped) {
        return;
      }

      setConnection(
        "connecting",
      );

      socket =
        new WebSocket(
          WS_URL,
        );

      socket.onopen = () => {
        reconnectDelay = 1000;

        setConnection(
          "live",
        );
      };

      socket.onmessage = (
        message:
          MessageEvent<string>,
      ) => {
        try {
          const frame =
            JSON.parse(
              message.data,
            ) as UsageSocketFrame;

          if (
            frame.type !==
              "usage.event" ||
            !frame.data
          ) {
            return;
          }

          /*
           * IMPORTANT:
           *
           * Do NOT do:
           *
           * setEvents([
           *   event,
           *   ...events,
           * ])
           *
           * That breaks cursor
           * pagination boundaries.
           */
          setPendingEvents(
            (current) =>
              current + 1,
          );
        } catch (error) {
          console.error(
            "Ignored malformed usage WebSocket frame",
            error,
          );
        }
      };

      socket.onerror =
        () => {
          socket?.close();
        };

      socket.onclose =
        () => {
          if (stopped) {
            return;
          }

          setConnection(
            "offline",
          );

          reconnectTimer =
            window.setTimeout(
              connect,
              reconnectDelay,
            );

          reconnectDelay =
            Math.min(
              reconnectDelay *
                2,
              30_000,
            );
        };
    };

    connect();

    return () => {
      stopped = true;

      if (
        reconnectTimer
      ) {
        window.clearTimeout(
          reconnectTimer,
        );
      }

      if (
        socket?.readyState ===
        WebSocket.OPEN
      ) {
        socket.close(
          1000,
          "Component unmounted",
        );
      } else {
        socket?.close();
      }
    };
  }, []);

  const nextPage = () => {
    if (
      !hasMore ||
      !nextCursor
    ) {
      return;
    }

    setCursors(
      (current) => {
        const updated =
          [...current];

        /*
         * Current page 1 stores
         * page-2 cursor at index 1.
         */
        updated[page] =
          nextCursor;

        return updated;
      },
    );

    setPage(
      (current) =>
        current + 1,
    );
  };

  const previousPage =
    () => {
      setPage(
        (current) =>
          Math.max(
            1,
            current - 1,
          ),
      );
    };

  const refreshLatest =
    () => {
      /*
       * Reset cursor chain completely.
       */
      setPage(1);
      setCursors([null]);
      setNextCursor(null);
      setHasMore(false);

      setPendingEvents(0);

      /*
       * Forces page 1 to fetch even
       * if already on page 1.
       */
      setRefreshKey(
        (current) =>
          current + 1,
      );
    };

  return {
    events,
    connection,

    page,
    hasMore,
    loading,

    pendingEvents,

    nextPage,
    previousPage,
    refreshLatest,
  };
}