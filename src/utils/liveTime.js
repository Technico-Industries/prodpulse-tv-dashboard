// Display-time helpers for values the backend publishes as a moment rather
// than a running number (so the TV counts them locally, once a second).

// Minutes since a published stop start; never negative.
export function elapsedMinutes(startMs, nowMs) {
  return Number.isFinite(startMs) ? Math.max(0, (nowMs - startMs) / 60000) : 0;
}

// Published closed downtime plus every running stop up to now.
export function downtimeNow(closedMinutes, activeStops, nowMs) {
  const closed = Number.isFinite(closedMinutes) ? closedMinutes : 0;
  return (activeStops ?? []).reduce((s, st) => s + elapsedMinutes(st.startMs, nowMs), closed);
}

// Line status shown on the TV: a running line becomes "awaiting entry" from
// the moment the backend published (end of its earliest unsaved slot).
export function lineDisplayStatus(line, nowMs) {
  if (line.baseStatus === 'running' && Number.isFinite(line.awaitingEntryFromMs) && nowMs >= line.awaitingEntryFromMs) {
    return 'awaiting_entry';
  }
  return ['running', 'stopped', 'idle'].includes(line.baseStatus) ? line.baseStatus : 'idle';
}
