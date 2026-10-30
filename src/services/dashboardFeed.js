// Realtime feed of the TV dashboard: three Firestore listeners on the
// tvDashboard/** aggregates and nothing else.
//
//   overview  doc         tvDashboard/assembly
//   lines     collection  tvDashboard/assembly/lines
//   days      query       tvDashboard/assembly/days, document IDs in the 7
//                         production dates before the overview's productionDate
//                         (re-subscribed when the server's date rolls over)
//
// Firestore functions are injected (`fs`) so the feed is unit-tested with
// fakes. Listeners use includeMetadataChanges so a loss of connection shows
// up as `fromCache: true`. Firestore ends a listener after an error, so each
// one is re-attached with back-off; a permission error (rules not published
// yet) is retried slowly. stop() detaches everything and clears every timer.

import { DAYS_COLLECTION, LINES_COLLECTION, OVERVIEW_DOC } from './dashboardPaths.js';
import { previousDayKeys } from '../utils/productionDay.js';

export const WEEKLY_DAYS = 7;
export const RETRY_DELAYS_MS = [5000, 10000, 30000, 60000];
export const PERMISSION_RETRY_MS = 60000;

const isDayKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function initialFeedState() {
  return {
    // status: pending | ready | missing | error
    overview: { status: 'pending', data: null, fromCache: false, error: null, receivedAtMs: null },
    lines: { status: 'pending', docs: [], fromCache: false, error: null, receivedAtMs: null },
    // status: idle (no date yet) | pending | ready | error
    days: { status: 'idle', dates: [], byDate: {}, fromCache: false, error: null, receivedAtMs: null },
  };
}

export function createDashboardFeed({ db, fs, onChange, now = () => Date.now(), timers = globalThis }) {
  let state = initialFeedState();
  let stopped = false;
  const unsubs = { overview: null, lines: null, days: null };
  const retryTimers = { overview: null, lines: null, days: null };
  const failures = { overview: 0, lines: 0, days: 0 };
  let daysFor = null; // production date the days listener belongs to

  const set = (part, patch) => {
    if (stopped) return;
    state = { ...state, [part]: { ...state[part], ...patch } };
    onChange(state);
  };

  const errorInfo = (e) => ({ code: e?.code ?? 'unknown', message: e?.message ?? String(e) });

  function detach(part) {
    if (unsubs[part]) unsubs[part]();
    unsubs[part] = null;
    if (retryTimers[part]) timers.clearTimeout(retryTimers[part]);
    retryTimers[part] = null;
  }

  function listen(part, target, onNext, restart) {
    unsubs[part] = fs.onSnapshot(
      target,
      { includeMetadataChanges: true },
      (snap) => {
        if (stopped) return;
        failures[part] = 0;
        onNext(snap);
      },
      (error) => {
        if (stopped) return;
        unsubs[part] = null; // Firestore has already ended this listener
        set(part, { status: 'error', error: errorInfo(error) });
        const delay = error?.code === 'permission-denied'
          ? PERMISSION_RETRY_MS
          : RETRY_DELAYS_MS[Math.min(failures[part], RETRY_DELAYS_MS.length - 1)];
        failures[part]++;
        retryTimers[part] = timers.setTimeout(() => {
          retryTimers[part] = null;
          if (!stopped) restart();
        }, delay);
      }
    );
  }

  function startOverview() {
    listen('overview', fs.doc(db, OVERVIEW_DOC), (snap) => {
      const fromCache = !!snap.metadata?.fromCache;
      const exists = snap.exists();
      // A missing doc is only "missing" when the server said so; from the
      // cache it just means nothing has been received yet.
      const status = exists ? 'ready' : fromCache ? (state.overview.data ? 'ready' : 'pending') : 'missing';
      set('overview', {
        status,
        data: exists ? snap.data() : fromCache ? state.overview.data : null,
        fromCache,
        error: null,
        receivedAtMs: fromCache ? state.overview.receivedAtMs : now(),
      });
      if (exists) ensureDays(snap.data()?.productionDate);
    }, startOverview);
  }

  function startLines() {
    listen('lines', fs.collection(db, LINES_COLLECTION), (snap) => {
      const fromCache = !!snap.metadata?.fromCache;
      set('lines', {
        status: 'ready',
        docs: snap.docs.map((d) => ({ id: d.id, data: d.data() })),
        fromCache,
        error: null,
        receivedAtMs: fromCache ? state.lines.receivedAtMs : now(),
      });
    }, startLines);
  }

  function startDays() {
    const dates = state.days.dates;
    if (!dates.length) return;
    const q = fs.query(
      fs.collection(db, DAYS_COLLECTION),
      fs.where(fs.documentId(), '>=', dates[0]),
      fs.where(fs.documentId(), '<=', dates[dates.length - 1])
    );
    listen('days', q, (snap) => {
      const byDate = {};
      snap.docs.forEach((d) => { byDate[d.id] = d.data(); });
      const fromCache = !!snap.metadata?.fromCache;
      set('days', { status: 'ready', byDate, fromCache, error: null, receivedAtMs: fromCache ? state.days.receivedAtMs : now() });
    }, startDays);
  }

  function ensureDays(productionDate) {
    if (!isDayKey(productionDate) || productionDate === daysFor) return;
    daysFor = productionDate;
    detach('days');
    failures.days = 0;
    set('days', { status: 'pending', dates: previousDayKeys(productionDate, WEEKLY_DAYS), byDate: {}, fromCache: false, error: null });
    startDays();
  }

  startOverview();
  startLines();

  return {
    getState: () => state,
    stop() {
      stopped = true;
      detach('overview');
      detach('lines');
      detach('days');
    },
  };
}
