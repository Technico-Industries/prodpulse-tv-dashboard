// Tests for the TV dashboard's Firebase integration — Node's built-in runner:
//   npm test      (node --test tests/)
// Firestore is faked (in-memory listeners, scripted snapshots, fake timers);
// nothing connects to Firebase and nothing is written anywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readDashboardMode, readFirebaseConfig } from '../src/services/firebaseConfig.js';
import { initFirebase } from '../src/services/firebaseInit.js';
import { createDashboardFeed, initialFeedState, PERMISSION_RETRY_MS, RETRY_DELAYS_MS } from '../src/services/dashboardFeed.js';
import { DAYS_COLLECTION, LINES_COLLECTION, OVERVIEW_DOC, isDashboardPath } from '../src/services/dashboardPaths.js';
import { STALE_AFTER_MS, buildLiveView, connectionState, mapWeeklyTrend } from '../src/data/liveDashboardModel.js';
import { downtimeNow, elapsedMinutes, lineDisplayStatus } from '../src/utils/liveTime.js';
import { nextPage, pageCountFor, pageSlice } from '../src/utils/pagination.js';

// ─── Fakes ───────────────────────────────────────────────────────────────────

function fakeFirestore() {
  const listeners = [];
  const fs = {
    doc: (_db, path) => ({ kind: 'doc', path }),
    collection: (_db, path) => ({ kind: 'collection', path }),
    documentId: () => '__name__',
    where: (field, op, value) => ({ field, op, value }),
    query: (coll, ...constraints) => ({ kind: 'query', path: coll.path, constraints }),
    onSnapshot: (target, opts, next, onError) => {
      // Like Firestore: a listener that reports an error has ended.
      const l = { target, opts, next, active: true, error: (e) => { l.active = false; onError(e); } };
      listeners.push(l);
      return () => { l.active = false; };
    },
  };
  const active = (path) => listeners.filter((l) => l.active && l.target.path === path);
  return { fs, listeners, active, last: (path) => active(path).at(-1) };
}

function fakeTimers() {
  let n = 0;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => { pending.set(++n, { fn, ms }); return n; },
    clearTimeout: (id) => { pending.delete(id); },
    pending,
    runAll() { const all = [...pending.values()]; pending.clear(); all.forEach((t) => t.fn()); },
  };
}

const docSnap = (data, fromCache = false) => ({ exists: () => data != null, data: () => data, metadata: { fromCache } });
const querySnap = (docs, fromCache = false) => ({ docs: docs.map((d) => ({ id: d.id, data: () => d.data })), metadata: { fromCache } });

const T0 = Date.UTC(2026, 9, 23, 4, 30); // fixed "now" for the tests
const fig = (o = {}) => ({
  recordCount: 2, goodProduction: 0, planToDate: 0, achievementPct: null, rejections: 0,
  quality: { goodParts: 0, rejectedParts: 0, countedRecords: 0, legacyRecords: 0 }, qualityPct: null, rejectionPct: null,
  downtimeClosedMinutes: 0, downtimeByReason: [], ...o,
});

function overviewDoc(o = {}) {
  return {
    schemaVersion: 1,
    productionDate: '2026-10-23',
    currentShift: 'A',
    operationalState: 'production',
    kpis: {
      productionDate: '2026-10-23', shift: 'A', goodProduction: 285, planToDate: 320, achievementPct: 89.1,
      rejections: 3, qualityPct: 99, rejectionPct: 1, downtimeClosedMinutes: 10,
      activeStops: [{ lineId: 'L1', startMs: T0 - 15 * 60000, reason: 'quality', label: 'Quality' }],
    },
    lineCounts: { total: 2, running: 1, stopped: 1, idle: 0, awaitingEntry: 0 },
    weeklyTrend: [
      { productionDate: '2026-10-22', available: true, final: true, goodProduction: 300, planToDate: 320, achievementPct: 93.8, rejections: 5, qualityPct: 98.4 },
      { productionDate: '2026-10-21', available: false, final: false, goodProduction: null, planToDate: null, achievementPct: null, rejections: null, qualityPct: null },
    ],
    shiftComparison: { productionDate: '2026-10-23', A: fig({ goodProduction: 285, planToDate: 320, achievementPct: 89.1, rejections: 3, downtimeClosedMinutes: 10 }), B: fig() },
    downtimeReasons: [{ reason: 'quality', label: 'Quality', minutes: 25 }],
    generatedAtMs: T0 - 30_000,
    freshness: { generatedAtMs: T0 - 30_000, complete: true, failedLines: [], failedDays: [] },
    ...o,
  };
}

const lineDoc = (id, o = {}) => ({
  id,
  data: {
    schemaVersion: 1, lineId: id, lineName: id, plant: 'Bawal 1', workshop: 'Assembly Shop', division: 'Side Door', registered: true,
    status: 'running', awaitingEntryFromMs: null, model: 'Hinge LH',
    current: { productionDate: '2026-10-23', shift: 'A', shiftPlan: 900, sessionStale: false, figures: fig({ goodProduction: 190, planToDate: 220, achievementPct: 86.4, rejections: 2, downtimeClosedMinutes: 10 }) },
    activeStop: null,
    day: { productionDate: '2026-10-23', shifts: { A: fig(), B: fig() } },
    ...o,
  },
});

const dayDoc = (id, o = {}) => ({ id, data: { schemaVersion: 1, productionDate: id, final: true, dirty: false, totals: fig({ goodProduction: 300, planToDate: 320, rejections: 5 }), ...o } });

function startFeed() {
  const ff = fakeFirestore();
  const timers = fakeTimers();
  const states = [];
  const feed = createDashboardFeed({ db: {}, fs: ff.fs, onChange: (s) => states.push(s), now: () => T0, timers });
  return { ff, timers, feed, states, state: () => feed.getState() };
}

// ─── 1. Firebase initialisation ──────────────────────────────────────────────

test('1. config: read from VITE_ env, missing keys reported, demo only when explicit', () => {
  const env = {
    VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_AUTH_DOMAIN: 'technico-industries-ltd.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'technico-industries-ltd',
    VITE_FIREBASE_STORAGE_BUCKET: 'technico-industries-ltd.firebasestorage.app', VITE_FIREBASE_MESSAGING_SENDER_ID: '281455614052', VITE_FIREBASE_APP_ID: '1:281455614052:web:x',
  };
  const ok = readFirebaseConfig(env);
  assert.deepEqual(ok.missing, []);
  assert.equal(ok.config.projectId, 'technico-industries-ltd');
  assert.deepEqual(readFirebaseConfig({ VITE_FIREBASE_PROJECT_ID: 'p' }).missing, ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_APP_ID']);
  assert.equal(readDashboardMode({}), 'live');
  assert.equal(readDashboardMode({ VITE_DASHBOARD_MODE: 'demo' }), 'demo');
  assert.equal(readDashboardMode({ VITE_DASHBOARD_MODE: 'anything' }), 'live');
});

test('1. initFirebase: Firestore of the configured project, existing app reused (no network until a listener)', () => {
  const config = { apiKey: 'test-key', authDomain: 'x.firebaseapp.com', projectId: 'technico-industries-ltd', appId: '1:1:web:1' };
  const a = initFirebase(config);
  const b = initFirebase(config);
  assert.equal(a.app, b.app);
  assert.equal(a.db, b.db);
  assert.equal(a.app.options.projectId, 'technico-industries-ltd');
  assert.equal(a.db.app, a.app);
});

// ─── 2–4. Listeners ──────────────────────────────────────────────────────────

test('2. overview listener: subscribed to tvDashboard/assembly with metadata changes; live once confirmed by the server', () => {
  const { ff, state } = startFeed();
  const l = ff.last(OVERVIEW_DOC);
  assert.ok(l);
  assert.deepEqual(l.opts, { includeMetadataChanges: true });
  assert.equal(connectionState({ feed: state(), online: true, nowMs: T0 }).state, 'connecting');
  l.next(docSnap(overviewDoc()));
  const c = connectionState({ feed: state(), online: true, nowMs: T0 });
  assert.deepEqual([c.state, c.label, c.lastUpdateMs], ['live', 'Live', T0 - 30_000]);
  const view = buildLiveView(state());
  assert.deepEqual([view.productionDate, view.currentShift, view.kpis.goodProduction, view.kpis.achievementPct, view.kpis.qualityPct], ['2026-10-23', 'A', 285, 89.1, 99]);
  assert.deepEqual(view.downtimeReasons, [{ reason: 'Quality', minutes: 25, occurrences: null }]);
  assert.deepEqual(view.shiftComparison.A, { goodProduction: 285, achievementPct: 89.1, rejections: 3, downtimeMinutes: 10 });
});

test('3. lines listener: collection tvDashboard/assembly/lines mapped to cards, natural name order, backend values only', () => {
  const { ff, state } = startFeed();
  ff.last(OVERVIEW_DOC).next(docSnap(overviewDoc()));
  ff.last(LINES_COLLECTION).next(querySnap([
    lineDoc('SD-10'),
    lineDoc('SD-02', { status: 'stopped', activeStop: { startMs: T0 - 600000, reason: 'quality', label: 'Quality' } }),
    lineDoc('SD-01', { status: 'idle', model: null, current: { productionDate: '2026-10-23', shift: 'A', figures: fig({ goodProduction: 0, planToDate: 0, achievementPct: null }) } }),
  ]));
  const view = buildLiveView(state());
  assert.deepEqual(view.lines.map((l) => l.lineName), ['SD-01', 'SD-02', 'SD-10']);
  const [idle, stopped, running] = view.lines;
  assert.deepEqual([idle.baseStatus, idle.achievementPct], ['idle', null]);
  assert.deepEqual([stopped.baseStatus, stopped.stopStartMs, stopped.stopLabel], ['stopped', T0 - 600000, 'Quality']);
  assert.deepEqual([running.goodProduction, running.planToDate, running.achievementPct, running.rejections, running.downtimeClosedMinutes], [190, 220, 86.4, 2, 10]);
  assert.equal(view.linesStatus, 'ready');
});

test('4. day listener: 7 production dates before the SERVER date, range on document id, re-subscribed on rollover', () => {
  const { ff, state } = startFeed();
  assert.equal(ff.active(DAYS_COLLECTION).length, 0); // nothing until the server date is known
  ff.last(OVERVIEW_DOC).next(docSnap(overviewDoc()));
  const q = ff.last(DAYS_COLLECTION);
  assert.equal(q.target.kind, 'query');
  assert.deepEqual(q.target.constraints, [{ field: '__name__', op: '>=', value: '2026-10-16' }, { field: '__name__', op: '<=', value: '2026-10-22' }]);
  q.next(querySnap([dayDoc('2026-10-22'), dayDoc('2026-10-20', { final: false }), { id: '2026-10-19', data: { productionDate: '2026-10-19', dirty: true } }]));
  const trend = buildLiveView(state()).weeklyTrend;
  const by = Object.fromEntries(trend.map((d) => [d.dayKey, d]));
  assert.equal(trend.length, 7);
  assert.deepEqual([by['2026-10-22'].available, by['2026-10-22'].actual, by['2026-10-22'].final], [true, 300, true]);
  assert.deepEqual([by['2026-10-20'].available, by['2026-10-20'].provisional], [true, true]);
  assert.deepEqual([by['2026-10-19'].available, by['2026-10-19'].actual], [false, null]); // dirty placeholder without content
  assert.deepEqual([by['2026-10-21'].available, by['2026-10-21'].actual, by['2026-10-21'].plan], [false, null, null]); // no doc → not zero
  // Same date again: no re-subscription. New server date: old listener detached, new range.
  ff.last(OVERVIEW_DOC).next(docSnap(overviewDoc({ generatedAtMs: T0 })));
  assert.equal(ff.active(DAYS_COLLECTION).length, 1);
  ff.last(OVERVIEW_DOC).next(docSnap(overviewDoc({ productionDate: '2026-10-24' })));
  assert.equal(ff.active(DAYS_COLLECTION).length, 1);
  assert.equal(q.active, false);
  assert.equal(ff.last(DAYS_COLLECTION).target.constraints[1].value, '2026-10-23');
});

test('4. weekly trend falls back to the overview while day docs are not loaded; never zero-fills', () => {
  const trend = mapWeeklyTrend(overviewDoc(), { status: 'pending', dates: [], byDate: {} });
  const by = Object.fromEntries(trend.map((d) => [d.dayKey, d]));
  assert.deepEqual([by['2026-10-22'].available, by['2026-10-22'].actual], [true, 300]);
  assert.deepEqual([by['2026-10-21'].available, by['2026-10-21'].actual], [false, null]);
  assert.deepEqual([by['2026-10-18'].available, by['2026-10-18'].rejections], [false, null]);
});

// ─── 5. Cleanup ──────────────────────────────────────────────────────────────

test('5. stop(): every listener detached, pending retries cleared, no further updates', () => {
  const { ff, timers, feed, states } = startFeed();
  ff.last(OVERVIEW_DOC).next(docSnap(overviewDoc()));
  ff.last(LINES_COLLECTION).error({ code: 'unavailable', message: 'x' }); // schedules a retry
  assert.equal(timers.pending.size, 1);
  const before = states.length;
  feed.stop();
  assert.equal(ff.listeners.filter((l) => l.active).length, 0);
  assert.equal(timers.pending.size, 0);
  ff.listeners.forEach((l) => l.next?.(docSnap(overviewDoc())));
  assert.equal(states.length, before);
});

// ─── 6. Loading and error states ─────────────────────────────────────────────

test('6. permission denied → "No access", retried slowly; other errors → "Disconnected", retried with back-off', () => {
  const { ff, timers, state } = startFeed();
  ff.last(OVERVIEW_DOC).error({ code: 'permission-denied', message: 'Missing or insufficient permissions.' });
  assert.equal(connectionState({ feed: state(), online: true, nowMs: T0 }).state, 'no-access');
  assert.deepEqual([...timers.pending.values()].map((t) => t.ms), [PERMISSION_RETRY_MS]);
  timers.runAll(); // rules published meanwhile → listener re-attached
  assert.equal(ff.active(OVERVIEW_DOC).length, 1);
  ff.last(OVERVIEW_DOC).next(docSnap(overviewDoc()));
  assert.equal(connectionState({ feed: state(), online: true, nowMs: T0 }).state, 'live');
  ff.last(OVERVIEW_DOC).error({ code: 'unavailable', message: 'down' });
  assert.equal(connectionState({ feed: state(), online: true, nowMs: T0 }).state, 'disconnected');
  assert.ok(buildLiveView(state()), 'last data is kept while reconnecting');
  assert.deepEqual([...timers.pending.values()].map((t) => t.ms), [RETRY_DELAYS_MS[0]]);
});

test('6. not configured / connecting / lines error states', () => {
  const feed = initialFeedState();
  assert.equal(connectionState({ configError: 'missing VITE_FIREBASE_API_KEY', feed, online: true, nowMs: T0 }).state, 'not-configured');
  assert.equal(connectionState({ feed, online: true, nowMs: T0 }).label, 'Connecting…');
  const withLinesError = { ...feed, overview: { status: 'ready', data: overviewDoc(), fromCache: false }, lines: { status: 'error', docs: [], error: { code: 'unavailable' } } };
  const c = connectionState({ feed: withLinesError, online: true, nowMs: T0 });
  assert.equal(c.state, 'live');
  assert.deepEqual(c.issues, ['line status unavailable']);
  assert.equal(buildLiveView(withLinesError).linesStatus, 'error');
});

// ─── 7. Network disconnection / reconnection ─────────────────────────────────

test('7. cached snapshot (connection lost) → Disconnected with last data; server snapshot again → Live', () => {
  const { ff, state } = startFeed();
  ff.last(OVERVIEW_DOC).next(docSnap(overviewDoc()));
  ff.last(OVERVIEW_DOC).next(docSnap(overviewDoc(), true));
  assert.equal(connectionState({ feed: state(), online: true, nowMs: T0 }).state, 'disconnected');
  assert.equal(buildLiveView(state()).kpis.goodProduction, 285);
  ff.last(OVERVIEW_DOC).next(docSnap(overviewDoc()));
  assert.equal(connectionState({ feed: state(), online: true, nowMs: T0 }).state, 'live');
  // Browser offline is reported, but online alone never makes it Live.
  assert.equal(connectionState({ feed: state(), online: false, nowMs: T0 }).state, 'disconnected');
  assert.equal(connectionState({ feed: initialFeedState(), online: true, nowMs: T0 }).state, 'connecting');
});

// ─── 8. Missing aggregate documents ──────────────────────────────────────────

test('8. missing overview → "No data yet" and no view; a cached miss is not treated as missing', () => {
  const { ff, state } = startFeed();
  ff.last(OVERVIEW_DOC).next(docSnap(null, true));
  assert.equal(connectionState({ feed: state(), online: true, nowMs: T0 }).state, 'connecting');
  ff.last(OVERVIEW_DOC).next(docSnap(null));
  assert.equal(connectionState({ feed: state(), online: true, nowMs: T0 }).state, 'no-data');
  assert.equal(buildLiveView(state()), null);
  assert.equal(ff.active(DAYS_COLLECTION).length, 0);
});

test('8. empty line collection and partially-built history are shown as such', () => {
  const { ff, state } = startFeed();
  ff.last(OVERVIEW_DOC).next(docSnap(overviewDoc({ freshness: { generatedAtMs: T0, complete: false, failedLines: ['L9'], failedDays: ['2026-10-21'] }, generatedAtMs: T0 })));
  ff.last(LINES_COLLECTION).next(querySnap([]));
  ff.last(DAYS_COLLECTION).next(querySnap([dayDoc('2026-10-22')]));
  const view = buildLiveView(state());
  assert.deepEqual([view.lines.length, view.linesStatus], [0, 'ready']);
  assert.equal(view.weeklyTrend.filter((d) => d.available).length, 1);
  const c = connectionState({ feed: state(), online: true, nowMs: T0 });
  assert.deepEqual([c.state, c.partial, c.issues], ['live', true, ['partially updated']]);
});

test('8. a line doc not refreshed for the current production date is flagged, not shown as current', () => {
  const { ff, state } = startFeed();
  ff.last(OVERVIEW_DOC).next(docSnap(overviewDoc()));
  ff.last(LINES_COLLECTION).next(querySnap([lineDoc('L1', { day: { productionDate: '2026-10-22', shifts: {} } })]));
  assert.equal(buildLiveView(state()).lines[0].outdated, true);
});

// ─── 9. Stale data ───────────────────────────────────────────────────────────

test('9. stale detection from the backend generation time', () => {
  const feedAt = (generatedAtMs) => ({ ...initialFeedState(), overview: { status: 'ready', data: overviewDoc({ generatedAtMs, freshness: { generatedAtMs } }), fromCache: false } });
  assert.equal(connectionState({ feed: feedAt(T0 - 5 * 60000), online: true, nowMs: T0 }).state, 'live'); // within heartbeat
  assert.equal(connectionState({ feed: feedAt(T0 - STALE_AFTER_MS - 1000), online: true, nowMs: T0 }).state, 'stale');
  assert.equal(connectionState({ feed: feedAt(null), online: true, nowMs: T0 }).state, 'stale');
  const s = connectionState({ feed: feedAt(T0 - 3600000), online: true, nowMs: T0 });
  assert.deepEqual([s.label, s.lastUpdateMs], ['Stale data', T0 - 3600000]);
});

// ─── 10. Active downtime timer ───────────────────────────────────────────────

test('10. active downtime: published closed minutes + local elapsed time of running stops', () => {
  assert.equal(elapsedMinutes(T0 - 90_000, T0), 1.5);
  assert.equal(elapsedMinutes(T0 + 60_000, T0), 0); // TV clock behind → never negative
  const stops = [{ startMs: T0 - 15 * 60000 }, { startMs: T0 - 5 * 60000 }];
  assert.equal(downtimeNow(10, stops, T0), 30);
  assert.equal(downtimeNow(10, stops, T0 + 60_000), 32); // grows every minute without new data
  assert.equal(downtimeNow(null, [], T0), 0);
});

test('10. awaiting entry starts at the published moment; stopped wins', () => {
  const line = { baseStatus: 'running', awaitingEntryFromMs: T0 };
  assert.equal(lineDisplayStatus(line, T0 - 1), 'running');
  assert.equal(lineDisplayStatus(line, T0), 'awaiting_entry');
  assert.equal(lineDisplayStatus({ baseStatus: 'stopped', awaitingEntryFromMs: T0 - 1 }, T0), 'stopped');
  assert.equal(lineDisplayStatus({ baseStatus: 'weird' }, T0), 'idle');
});

// ─── 11. Line pagination ─────────────────────────────────────────────────────

test('11. pagination: 20 cards per page, 15 s rotation cycles through every page', () => {
  const lines = Array.from({ length: 50 }, (_, i) => i);
  assert.equal(pageCountFor(50, 20), 3);
  assert.deepEqual(pageSlice(lines, 20, 2).items, lines.slice(40, 50));
  assert.equal(pageSlice(lines, 20, 9).page, 2); // clamped when lines disappear
  let p = 0;
  const seen = [];
  for (let i = 0; i < 4; i++) { seen.push(p); p = nextPage(p, 3); }
  assert.deepEqual(seen, [0, 1, 2, 0]);
  assert.equal(nextPage(0, 1), 0);
  assert.equal(pageCountFor(0, 20), 1);
});

// ─── Data-access boundary ────────────────────────────────────────────────────

test('only tvDashboard/assembly/** is subscribed', () => {
  const { ff } = startFeed();
  ff.last(OVERVIEW_DOC).next(docSnap(overviewDoc()));
  assert.ok(ff.listeners.length >= 3);
  for (const l of ff.listeners) assert.ok(isDashboardPath(l.target.path), l.target.path);
});

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(jsx?|tsx?)$/.test(f) ? [p] : [];
  });
}

test('no raw production collection, write API, Auth or Admin SDK anywhere in src/', () => {
  const raw = /['"`](productionLines|activeSessions|productionRecords|shiftSummaries|endedSessions|lineBreakdowns|users|operators|rejectionRecords)['"`/]/;
  const writes = /\b(setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\b/;
  const forbiddenImports = /from ['"](firebase\/auth|firebase\/functions|firebase-admin[^'"]*)['"]/;
  for (const file of sourceFiles(join(import.meta.dirname, '..', 'src'))) {
    const code = readFileSync(file, 'utf8');
    assert.ok(!raw.test(code), `raw collection referenced in ${file}`);
    assert.ok(!writes.test(code), `write API referenced in ${file}`);
    assert.ok(!forbiddenImports.test(code), `auth/functions/admin import in ${file}`);
  }
});
