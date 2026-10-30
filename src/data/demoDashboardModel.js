// Maps the built-in DEMONSTRATION data (mockDashboardData.js) into the same
// view model as the live data, for VITE_DASHBOARD_MODE=demo only. The
// provisional formulas in utils/metrics.js are used here — never in live mode.

import { achievementPct, sumBy } from '../utils/metrics';

const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

export function buildDemoView(data) {
  const lines = data.lines.map((l) => ({
    lineId: l.lineId,
    lineName: l.lineName,
    plant: null,
    division: null,
    model: l.model,
    baseStatus: l.status,
    awaitingEntryFromMs: null,
    goodProduction: l.goodProduction,
    planToDate: l.planToDate,
    achievementPct: round1(achievementPct(l.goodProduction, l.planToDate)),
    rejections: l.rejections,
    downtimeClosedMinutes: null,
    stopStartMs: l.stoppedSinceMs,
    stopLabel: l.stopReason,
    outdated: false,
    sessionStale: false,
  }));
  const good = sumBy(data.lines, 'goodProduction');
  const plan = sumBy(data.lines, 'planToDate');
  const shift = (s) => ({
    goodProduction: s.goodProduction,
    achievementPct: round1(achievementPct(s.goodProduction, s.plan)),
    rejections: s.rejections,
    downtimeMinutes: s.downtimeMinutes,
  });
  return {
    mode: 'demo',
    title: data.title,
    productionDate: data.productionDate,
    currentShift: data.currentShift,
    operationalState: 'production',
    kpis: {
      goodProduction: good,
      planToDate: plan,
      achievementPct: round1(achievementPct(good, plan)),
      rejections: sumBy(data.lines, 'rejections'),
      qualityPct: null,
      downtimeClosedMinutes: data.closedDowntimeMinutes,
      activeStops: data.lines.filter((l) => l.status === 'stopped' && l.stoppedSinceMs).map((l) => ({ lineId: l.lineId, startMs: l.stoppedSinceMs, label: l.stopReason })),
    },
    linesStatus: 'ready',
    lines,
    weeklyTrend: data.weeklyTrend.map((d) => ({ ...d, available: true, final: true, provisional: false })),
    shiftComparison: { label: `Full shifts · ${data.shiftComparison.dayKey}`, productionDate: data.shiftComparison.dayKey, A: shift(data.shiftComparison.A), B: shift(data.shiftComparison.B) },
    downtimeReasons: data.downtimeReasons,
  };
}
