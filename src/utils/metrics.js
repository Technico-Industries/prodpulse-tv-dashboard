// Display-only metrics for the prototype.
//
// PROVISIONAL: these are simple placeholder formulas so the UI has numbers
// to show. They are NOT the authoritative ProdPulse definitions — when
// Firebase is integrated, achievement, rejection and downtime figures should
// come from (or be confirmed against) the ProdPulse mobile app's own logic.

// Good production as a percentage of plan-to-date.
export function achievementPct(good, plan) {
  return plan > 0 ? (good / plan) * 100 : NaN;
}

export function sumBy(items, key) {
  return items.reduce((s, it) => s + (Number(it[key]) || 0), 0);
}

export function countByStatus(lines) {
  const counts = { running: 0, stopped: 0, idle: 0 };
  lines.forEach((l) => { counts[l.status] = (counts[l.status] ?? 0) + 1; });
  return counts;
}

// Lines currently stopped, longest stop first.
export function currentlyStopped(lines, nowMs) {
  return lines
    .filter((l) => l.status === 'stopped')
    .map((l) => ({ ...l, stoppedForMinutes: l.stoppedSinceMs ? (nowMs - l.stoppedSinceMs) / 60000 : 0 }))
    .sort((a, b) => b.stoppedForMinutes - a.stoppedForMinutes);
}
