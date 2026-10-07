'use client';

import { useMemo, useSyncExternalStore } from 'react';

const POLL_MS = 5_000;
const MINUTE_MS = 60_000;

/**
 * Shared minute-resolution clock. Subscribers are notified only when the
 * minute changes, so consumers re-render at most once per minute. Polling
 * (rather than one long timeout) also catches up immediately after the
 * device wakes from sleep.
 */
let snapshot = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

const floorToMinute = (timestamp: number) => Math.floor(timestamp / MINUTE_MS) * MINUTE_MS;

function tick() {
  const next = floorToMinute(Date.now());
  if (next === snapshot) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    tick();
    timer = setInterval(tick, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot() {
  if (!snapshot) snapshot = floorToMinute(Date.now());
  return snapshot;
}

/** The server has no meaningful "now" for the user — render the loading shell instead. */
const getServerSnapshot = () => 0;

/** Current time floored to the minute, or `null` during SSR and hydration. */
export function useNow(): Date | null {
  const timestamp = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => (timestamp ? new Date(timestamp) : null), [timestamp]);
}
