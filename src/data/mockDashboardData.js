// ═══════════════════════════════════════════════════════════════════════════
//  DEMONSTRATION DATA — NOT REAL PRODUCTION VALUES
// ═══════════════════════════════════════════════════════════════════════════
// Everything in this file is invented so the TV layout can be built and
// reviewed before Firebase integration. Line names, models, counts, plans,
// rejections, downtime and reasons are placeholders and must not be read as
// plant figures. The UI marks every panel fed from here with a "DEMO" tag.
//
// A seeded random generator keeps the same values on every reload;
// advanceDemoData() adds small increments so live updates can be seen.

import { productionDayKeyFor, currentShiftFor, previousDayKeys } from '../utils/productionDay';

export const IS_DEMO_DATA = true;

function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Placeholder line groups (prefix, line count, demo model names).
const DEMO_GROUPS = [
  { prefix: 'SD', count: 8, models: ['Door Hinge LH', 'Door Hinge RH', 'Check Link'] },
  { prefix: 'SJ', count: 6, models: ['Screw Jack', 'Jack Handle'] },
  { prefix: 'RC', count: 6, models: ['Center Bracket', 'RR Center Assy'] },
  { prefix: 'BP', count: 7, models: ['Brake Pedal', 'Clutch Pedal'] },
  { prefix: 'HH', count: 7, models: ['Hood Hinge LH', 'Hood Hinge RH'] },
  { prefix: 'BD', count: 6, models: ['Back Door Hinge', 'Back Door Stay'] },
  { prefix: 'NM', count: 5, models: ['Seat Bracket', 'Bracket Assy'] },
  { prefix: 'CC', count: 5, models: ['Counter Cable'] },
];

const DEMO_STOP_REASONS = ['Machine breakdown', 'Material shortage', 'Fixture issue', 'Quality hold', 'Tool change', 'Power fluctuation'];

// Fixed positions so every status is always visible in the demo.
const STOPPED_AT = new Set([3, 11, 22, 37]);
const IDLE_AT = new Set([9, 18, 31, 44, 49]);

// Demo "hours into the current shift" — fixed so values look mid-shift.
const DEMO_HOURS_ELAPSED = 5.5;

export function createDemoDashboard(nowMs = Date.now()) {
  const rand = seededRandom(20261030);
  const productionDate = productionDayKeyFor(nowMs);

  const lines = [];
  let n = 0;
  DEMO_GROUPS.forEach((group) => {
    for (let i = 1; i <= group.count; i++, n++) {
      const status = STOPPED_AT.has(n) ? 'stopped' : IDLE_AT.has(n) ? 'idle' : 'running';
      const ratePerHour = 40 + Math.round(rand() * 50);
      const pace = 0.78 + rand() * 0.24;
      const planToDate = status === 'idle' ? 0 : Math.round(ratePerHour * DEMO_HOURS_ELAPSED);
      lines.push({
        lineId: `demo-${group.prefix}-${i}`,
        lineName: `${group.prefix}-${String(i).padStart(2, '0')}`,
        model: status === 'idle' ? null : group.models[Math.floor(rand() * group.models.length)],
        status,
        goodProduction: Math.round(planToDate * Math.min(pace, 1.04)),
        planToDate,
        rejections: status === 'idle' ? 0 : Math.round(planToDate * (0.002 + rand() * 0.012)),
        stoppedSinceMs: status === 'stopped' ? nowMs - Math.round((4 + rand() * 70) * 60000) : null,
        stopReason: status === 'stopped' ? DEMO_STOP_REASONS[Math.floor(rand() * DEMO_STOP_REASONS.length)] : null,
        // demo-only simulation parameters
        _ratePerHour: ratePerHour,
        _pace: pace,
      });
    }
  });

  const weeklyTrend = previousDayKeys(productionDate, 7).map((dayKey) => {
    const plan = 46000 + Math.round(rand() * 5000);
    const actual = Math.round(plan * (0.86 + rand() * 0.13));
    return { dayKey, plan, actual, rejections: Math.round(actual * (0.004 + rand() * 0.006)) };
  });

  const downtimeReasons = DEMO_STOP_REASONS.map((reason) => ({
    reason,
    minutes: Math.round(10 + rand() * 150),
    occurrences: 1 + Math.floor(rand() * 9),
  }));

  const demoShift = (share, pace) => {
    const plan = Math.round(weeklyTrend[6].plan * share);
    const goodProduction = Math.round(plan * pace);
    return {
      goodProduction,
      plan,
      rejections: Math.round(goodProduction * (0.004 + rand() * 0.005)),
      downtimeMinutes: Math.round(180 + rand() * 260),
    };
  };

  return {
    isDemo: IS_DEMO_DATA,
    title: 'Assembly',
    productionDate,
    currentShift: currentShiftFor(nowMs),
    updatedAtMs: nowMs,
    // Closed downtime this shift (minutes); running stops are added live.
    closedDowntimeMinutes: 412,
    lines,
    weeklyTrend,
    downtimeReasons,
    shiftComparison: {
      dayKey: weeklyTrend[6].dayKey,
      A: demoShift(0.53, 0.95),
      B: demoShift(0.47, 0.89),
    },
  };
}

// One simulated update: running lines add a few parts and plan time.
export function advanceDemoData(data, nowMs, intervalMs) {
  const hours = intervalMs / 3600000;
  return {
    ...data,
    updatedAtMs: nowMs,
    lines: data.lines.map((l) => {
      if (l.status !== 'running') return l;
      return {
        ...l,
        planToDate: l.planToDate + l._ratePerHour * hours,
        goodProduction: l.goodProduction + l._ratePerHour * hours * l._pace * (0.6 + Math.random() * 0.8),
        rejections: l.rejections + (Math.random() < 0.05 ? 1 : 0),
      };
    }),
  };
}
