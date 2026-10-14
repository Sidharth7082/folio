"use client";

import { useMemo, useSyncExternalStore } from "react";

import { readerStore, type ReaderState, type ReadingProgress } from "./store";

/** Full reader state, re-rendering only when persisted data changes. */
export function useReaderState(): ReaderState {
  return useSyncExternalStore(
    readerStore.subscribe,
    readerStore.getSnapshot,
    readerStore.getServerSnapshot,
  );
}

/** True once client-side storage has been read; use to avoid SSR mismatches. */
export function useHydrated(): boolean {
  return useReaderState().hydrated;
}

export function useReaderSettings() {
  return useReaderState().settings;
}

export function useLibrary(): string[] {
  return useReaderState().library;
}

export function useIsInLibrary(slug: string): boolean {
  return useReaderState().library.includes(slug);
}

export function useProgress(slug: string): ReadingProgress | null {
  return useReaderState().progress[slug] ?? null;
}

/** Recently read entries, newest first. */
export function useContinueReading(limit = 6): ReadingProgress[] {
  const progress = useReaderState().progress;
  return useMemo(
    () =>
      Object.values(progress)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit),
    [progress, limit],
  );
}
