// Production-day and shift helpers.
//
// Mirrors the rules in the mobile app (technico-management/src/utils/
// productionDay.ts and productionSchedule.ts) so the TV labels a record the
// same way the app stores it:
//   • a production day runs 6:30 AM → next day 6:30 AM, keyed "YYYY-MM-DD"
//     (the `productionDate` field on productionRecords, activeSessions,
//     shiftSummaries)
//   • Shift A starts 7:00 AM, Shift B starts 7:00 PM (shift field 'A' | 'B')

export const PRODUCTION_DAY_CUTOVER_MINUTES = 6 * 60 + 30;
const SHIFT_B_START_MINUTES = 19 * 60;

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function productionDayKeyFor(epochMs) {
  const d = new Date(epochMs);
  if (d.getHours() * 60 + d.getMinutes() < PRODUCTION_DAY_CUTOVER_MINUTES) {
    d.setDate(d.getDate() - 1);
  }
  return dateKey(d);
}

// The shift whose window the given instant falls in. Between shifts (and in
// overtime) this returns the shift that most recently started.
export function currentShiftFor(epochMs) {
  const d = new Date(epochMs);
  const minutes = d.getHours() * 60 + d.getMinutes();
  return minutes >= PRODUCTION_DAY_CUTOVER_MINUTES && minutes < SHIFT_B_START_MINUTES ? 'A' : 'B';
}

// The `count` production-day keys before `key`, oldest first.
export function previousDayKeys(key, count) {
  const [y, m, d] = key.split('-').map(Number);
  const out = [];
  for (let i = count; i >= 1; i--) out.push(dateKey(new Date(y, m - 1, d - i)));
  return out;
}
