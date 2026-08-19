"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  getTimelineCache,
  isTimelineCacheFresh,
  setTimelineCache,
} from "./timeline-cache";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface FetchPageResult<T> {
  items: T[];
  hasMore: boolean;
}

// Set to true whenever the user traverses history (browser back/forward). The
// scroll position is only restored after such traversals — entering a feed
// through the sidebar or a tab switch should always start at the top.
let restoredOnHistoryTraversal = false;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    restoredOnHistoryTraversal = true;
  });
}

function scrollToStatusAnchor(anchorId: string | null, fallbackY: number) {
  const apply = () => {
    if (anchorId) {
      const el = document.querySelector<HTMLElement>(`[data-status-id="${CSS.escape(anchorId)}"]`);
      if (el) {
        window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top);
        return;
      }
    }
    if (fallbackY > 0) window.scrollTo(0, fallbackY);
  };
  requestAnimationFrame(() => requestAnimationFrame(apply));
}

// Restore the window scroll position, defending against Next.js scrolling to
// the top again right after our restore (its scroll handler runs in the layout
// phase of the navigation, potentially after ours).
function restoreScroll(y: number) {
  if (y <= 0) return;
  const apply = () => window.scrollTo(0, y);
  requestAnimationFrame(() => requestAnimationFrame(apply));
  let reapplied = false;
  const guard = () => {
    if (reapplied) return;
    if (window.scrollY === 0) {
      reapplied = true;
      apply();
      window.removeEventListener("scroll", guard);
    }
  };
  window.addEventListener("scroll", guard);
  setTimeout(() => window.removeEventListener("scroll", guard), 1000);
}

export function useTimelineCache<T extends { id: string }>(
  key: string,
  fetchPage: (maxId?: string) => Promise<FetchPageResult<T>>
): {
  statuses: T[];
  setStatuses: Dispatch<SetStateAction<T[]>>;
  loading: boolean;
  setLoading: Dispatch<SetStateAction<boolean>>;
  loadingMore: boolean;
  setLoadingMore: Dispatch<SetStateAction<boolean>>;
  hasMore: boolean;
  setHasMore: Dispatch<SetStateAction<boolean>>;
  seenIdsRef: RefObject<Set<string>>;
  loadMore: () => void;
  refresh: () => Promise<void>;
} {
  const initial = getTimelineCache<T>(key);
  const [statuses, setStatuses] = useState<T[]>(initial?.items ?? []);
  const [loading, setLoading] = useState(!initial?.ready);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initial?.hasMore ?? true);
  const seenIdsRef = useRef<Set<string>>(new Set(initial?.seenIds ?? []));

  const keyRef = useRef(key);
  const fetchPageRef = useRef(fetchPage);
  const statusesRef = useRef(statuses);
  const hasMoreRef = useRef(hasMore);
  const loadingMoreRef = useRef(loadingMore);

  // Keep the latest values available to stable callbacks without re-creating them
  useEffect(() => {
    keyRef.current = key;
    fetchPageRef.current = fetchPage;
    statusesRef.current = statuses;
    hasMoreRef.current = hasMore;
    loadingMoreRef.current = loadingMore;
  }, [key, fetchPage, statuses, hasMore, loadingMore]);

  // Loads the first page, or restores a cached feed for the active key. Runs on
  // mount and whenever the key changes (e.g. switching local/federated tabs).
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (cancelled) return;
      const restore = restoredOnHistoryTraversal;
      restoredOnHistoryTraversal = false;
      const cached = getTimelineCache<T>(key);

      if (cached?.ready && isTimelineCacheFresh(cached)) {
        seenIdsRef.current = new Set(cached.seenIds);
        setStatuses(cached.items);
        setHasMore(cached.hasMore);
        setLoading(false);
        if (restore) restoreScroll(cached.scrollY);
        return;
      }

      if (cached) {
        seenIdsRef.current = new Set(cached.seenIds);
        setStatuses(cached.items);
        setHasMore(cached.hasMore);
        setLoading(false);
        if (restore) restoreScroll(cached.scrollY);
      } else {
        seenIdsRef.current = new Set();
        setStatuses([]);
        setHasMore(true);
        setLoading(true);
      }

      const anchorId = restore ? (cached?.items[0]?.id ?? null) : null;
      const fallbackY = restore ? (cached?.scrollY ?? 0) : 0;
      (async () => {
        try {
          const result = await fetchPageRef.current();
          if (cancelled) return;
          setStatuses((prev) => {
            const known = new Set(prev.map((s) => s.id));
            const freshTop = result.items.filter((s) => !known.has(s.id));
            const merged = prev.length > 0 && result.items.length > 0 ? [...freshTop, ...prev] : result.items;
            seenIdsRef.current = new Set(merged.map((s) => s.id));
            setTimelineCache(key, {
              items: merged,
              hasMore: result.hasMore,
              seenIds: [...seenIdsRef.current],
              scrollY: cached?.scrollY ?? 0,
              fetchedAt: Date.now(),
              ready: true,
            });
            return merged;
          });
          setHasMore(result.hasMore);
          setLoading(false);
          if (restore) scrollToStatusAnchor(anchorId, fallbackY);
        } catch {
          if (!cancelled) setLoading(false);
        }
      })();
    };
    Promise.resolve().then(load);
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Track the window scroll position so it survives unmount (navigation away).
  // useLayoutEffect ensures the cleanup runs during the layout phase — before
  // Next.js scrolls the window to the top on navigation — so the position of
  // the feed is captured before it is clobbered.
  useIsomorphicLayoutEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const entry = getTimelineCache(keyRef.current);
        if (entry) entry.scrollY = window.scrollY;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      const entry = getTimelineCache(keyRef.current);
      if (entry && window.scrollY > 0) entry.scrollY = window.scrollY;
    };
  }, []);

  // Keep the cache in sync with the live statuses (streaming, favs, edits…).
  useEffect(() => {
    const prev = getTimelineCache<T>(key);
    setTimelineCache(key, {
      items: statuses,
      hasMore,
      seenIds: [...seenIdsRef.current],
      scrollY: prev?.scrollY ?? 0,
      fetchedAt: prev?.fetchedAt ?? Date.now(),
      ready: prev?.ready ?? false,
    });
  }, [key, statuses, hasMore]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    const lastId = statusesRef.current[statusesRef.current.length - 1]?.id;
    if (!lastId) return;
    setLoadingMore(true);
    try {
      const result = await fetchPageRef.current(lastId);
      if (result.items.length === 0) {
        setHasMore(false);
        return;
      }
      setStatuses((prev) => {
        const known = new Set(prev.map((s) => s.id));
        const fresh = result.items.filter((s) => !known.has(s.id));
        for (const s of fresh) seenIdsRef.current.add(s.id);
        return [...prev, ...fresh];
      });
      setHasMore(result.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [setLoadingMore, setStatuses, setHasMore]);

  const refresh = useCallback(async () => {
    try {
      const result = await fetchPageRef.current();
      seenIdsRef.current = new Set(result.items.map((s) => s.id));
      setStatuses(result.items);
      setHasMore(result.hasMore);
      setLoading(false);
      setTimelineCache(keyRef.current, {
        items: result.items,
        hasMore: result.hasMore,
        seenIds: [...seenIdsRef.current],
        scrollY: 0,
        fetchedAt: Date.now(),
        ready: true,
      });
    } catch {
      setLoading(false);
    }
  }, [setStatuses, setHasMore, setLoading]);

  return {
    statuses,
    setStatuses,
    loading,
    setLoading,
    loadingMore,
    setLoadingMore,
    hasMore,
    setHasMore,
    seenIdsRef,
    loadMore,
    refresh,
  };
}