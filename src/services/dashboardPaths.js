// The ONLY Firestore paths the TV dashboard reads. They are the sanitised
// aggregates published by the ProdPulse Cloud Functions (functions/src/
// tvDashboard). Raw production collections (productionLines, activeSessions,
// productionRecords, shiftSummaries, endedSessions, lineBreakdowns, users …)
// are never read from the browser.

export const TV_ROOT = 'tvDashboard';
export const OVERVIEW_DOC = 'tvDashboard/assembly';
export const LINES_COLLECTION = 'tvDashboard/assembly/lines';
export const DAYS_COLLECTION = 'tvDashboard/assembly/days';

export function isDashboardPath(path) {
  return path === OVERVIEW_DOC || path.startsWith(`${OVERVIEW_DOC}/`);
}
