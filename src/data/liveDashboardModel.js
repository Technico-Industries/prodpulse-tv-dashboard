// Maps the tvDashboard/** aggregate documents (see the backend's
// TV_DASHBOARD_BACKEND_IMPLEMENTATION.md §5) into the view model the
// dashboard components render, and derives the connection state.
//
// Mapping only: every production figure (good production, plan-to-date,
// achievement, rejections, quality, downtime, reasons, trends) is taken as
// published by the Cloud Functions. Nothing is recomputed here, and a value
// the backend did not publish stays null ("—"), never 0.

import { previousDayKeys } from '../utils/productionDay.js';

// The backend rewrites the overview at least every 5 minutes (heartbeat);
// older than this means the pipeline (or this TV's connection) has stopped.
export const STALE_AFTER_MS = 7 * 60 * 1000;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' && v.trim() ? v : null);

// ─── Connection state ────────────────────────────────────────────────────────

export const CONNECTION_LABELS = {
  connecting: 'Connecting…',
  live: 'Live',
  disconnected: 'Disconnected',
  stale: 'Stale data',
  'no-access': 'No access',
  'no-data': 'No data yet',
  'not-configured': 'Not configured',
  demo: 'Demo data',
};

export function generatedAtOf(overview) {
  return num(overview?.generatedAtMs) ?? num(overview?.freshness?.generatedAtMs);
}

// "Live" is earned only by a server-confirmed (not cached) overview snapshot
// whose generation time is recent — never by the browser merely being online.
export function connectionState({ configError = null, feed, online = true, nowMs }) {
  const make = (state, detail = null, extra = {}) => ({
    state,
    label: CONNECTION_LABELS[state],
    detail,
    lastUpdateMs: generatedAtOf(feed?.overview?.data),
    partial: false,
    issues: [],
    ...extra,
  });
  if (configError) return make('not-configured', configError);
  const o = feed.overview;
  if (o.status === 'error' && o.error?.code === 'permission-denied') {
    return make('no-access', 'Firestore rules do not allow reading tvDashboard — retrying');
  }
  if (o.status === 'pending' && !o.data) return online ? make('connecting') : make('disconnected', 'Network offline');
  if (o.status === 'error') return make('disconnected', 'Connection lost — reconnecting');
  if (!online) return make('disconnected', 'Network offline — showing last received data');
  if (o.fromCache) return make('disconnected', 'Reconnecting — showing last received data');
  if (o.status === 'missing') return make('no-data', 'Dashboard data has not been published yet');

  const generatedAtMs = generatedAtOf(o.data);
  const issues = [];
  if (feed.lines.status === 'error') issues.push('line status unavailable');
  else if (feed.lines.fromCache) issues.push('line status reconnecting');
  if (feed.days.status === 'error') issues.push('history unavailable');
  const partial = o.data?.freshness?.complete === false;
  if (partial) issues.push('partially updated');
  if (generatedAtMs == null || nowMs - generatedAtMs > STALE_AFTER_MS) {
    return make('stale', 'Updates have stopped — figures may be out of date', { partial, issues });
  }
  return make('live', null, { partial, issues });
}

// ─── Lines ───────────────────────────────────────────────────────────────────

export function mapLineDoc({ id, data }, overviewDate) {
  const d = data ?? {};
  const f = d.current?.figures ?? {};
  const baseStatus = ['running', 'stopped', 'idle'].includes(d.status) ? d.status : 'idle';
  const dayDate = str(d.day?.productionDate);
  return {
    lineId: str(d.lineId) ?? id,
    lineName: str(d.lineName) ?? id,
    plant: str(d.plant),
    division: str(d.division),
    model: str(d.model),
    baseStatus,
    awaitingEntryFromMs: num(d.awaitingEntryFromMs),
    goodProduction: num(f.goodProduction),
    planToDate: num(f.planToDate),
    achievementPct: num(f.achievementPct),
    rejections: num(f.rejections),
    downtimeClosedMinutes: num(f.downtimeClosedMinutes),
    stopStartMs: num(d.activeStop?.startMs),
    stopLabel: str(d.activeStop?.label),
    // The backend has not refreshed this line for the current production
    // date yet (e.g. its recompute failed) — shown as such, not as current.
    outdated: !!overviewDate && !!dayDate && dayDate !== overviewDate,
    sessionStale: d.current?.sessionStale === true,
  };
}

const byLineName = (a, b) => a.lineName.localeCompare(b.lineName, undefined, { numeric: true, sensitivity: 'base' });

// ─── Weekly trend ────────────────────────────────────────────────────────────

const hasDayContent = (d) => !!d && d.schemaVersion != null && d.totals && typeof d.totals === 'object';

function trendFromDayDoc(dayKey, d) {
  return {
    dayKey,
    available: true,
    final: d.final === true,
    provisional: d.final !== true || d.dirty === true,
    actual: num(d.totals.goodProduction),
    plan: num(d.totals.planToDate),
    rejections: num(d.totals.rejections),
  };
}

const unavailableDay = (dayKey) => ({ dayKey, available: false, final: false, provisional: false, actual: null, plan: null, rejections: null });

// Day documents first (subscribed directly); while they are not loaded (or
// their listener failed) the overview's own weeklyTrend — built by the
// backend from the same day documents — is used. A day neither has is
// unavailable, never zero.
export function mapWeeklyTrend(overview, days) {
  const dates = days?.dates?.length ? days.dates : isDayKey(overview?.productionDate) ? previousDayKeys(overview.productionDate, 7) : [];
  const fromOverview = new Map((overview?.weeklyTrend ?? []).map((p) => [p.productionDate, p]));
  const daysLoaded = days?.status === 'ready';
  return dates.map((dayKey) => {
    const doc = days?.byDate?.[dayKey];
    if (hasDayContent(doc)) return trendFromDayDoc(dayKey, doc);
    if (daysLoaded) return unavailableDay(dayKey);
    const p = fromOverview.get(dayKey);
    if (p?.available) {
      return {
        dayKey, available: true, final: p.final === true, provisional: p.final !== true,
        actual: num(p.goodProduction), plan: num(p.planToDate), rejections: num(p.rejections),
      };
    }
    return unavailableDay(dayKey);
  });
}

const isDayKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// ─── Whole view ──────────────────────────────────────────────────────────────

const shiftBlock = (s) => ({
  goodProduction: num(s?.goodProduction),
  achievementPct: num(s?.achievementPct),
  rejections: num(s?.rejections),
  downtimeMinutes: num(s?.downtimeClosedMinutes),
});

const reasons = (list) => (Array.isArray(list) ? list : [])
  .map((r) => ({ reason: str(r?.label) ?? str(r?.reason) ?? 'Unspecified', minutes: num(r?.minutes) ?? 0, occurrences: null }));

// null until an overview document has been received.
export function buildLiveView(feed) {
  const o = feed?.overview?.data;
  if (!o) return null;
  const k = o.kpis ?? {};
  const lines = (feed.lines?.docs ?? []).map((doc) => mapLineDoc(doc, o.productionDate)).sort(byLineName);
  return {
    mode: 'live',
    title: 'Assembly',
    productionDate: str(o.productionDate),
    currentShift: o.currentShift === 'B' ? 'B' : o.currentShift === 'A' ? 'A' : null,
    operationalState: str(o.operationalState),
    kpis: {
      goodProduction: num(k.goodProduction),
      planToDate: num(k.planToDate),
      achievementPct: num(k.achievementPct),
      rejections: num(k.rejections),
      qualityPct: num(k.qualityPct),
      downtimeClosedMinutes: num(k.downtimeClosedMinutes),
      activeStops: (Array.isArray(k.activeStops) ? k.activeStops : [])
        .filter((s) => num(s?.startMs) != null)
        .map((s) => ({ lineId: str(s.lineId), startMs: s.startMs, label: str(s.label) })),
    },
    linesStatus: feed.lines?.status === 'error' ? 'error' : feed.lines?.status === 'ready' ? 'ready' : 'pending',
    lines,
    weeklyTrend: mapWeeklyTrend(o, feed.days),
    shiftComparison: {
      label: o.shiftComparison?.productionDate ? `Production day ${o.shiftComparison.productionDate}` : 'Current production day',
      productionDate: str(o.shiftComparison?.productionDate),
      A: shiftBlock(o.shiftComparison?.A),
      B: shiftBlock(o.shiftComparison?.B),
    },
    downtimeReasons: reasons(o.downtimeReasons),
  };
}
