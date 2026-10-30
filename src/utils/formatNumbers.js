// Display formatting. Indian digit grouping (1,23,456) matches the plant.

const intFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function formatNumber(value) {
  return Number.isFinite(value) ? intFmt.format(Math.round(value)) : '—';
}

// 48230 → "48.2k" — chart labels where space is tight
export function formatCompact(value) {
  if (!Number.isFinite(value)) return '—';
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));
}

export function formatPercent(value, digits = 1) {
  return Number.isFinite(value) ? `${value.toFixed(digits)}%` : '—';
}

// 205 → "3h 25m", 42 → "42m"
export function formatMinutes(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) return '—';
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

export function formatClock(epochMs) {
  return new Date(epochMs).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

// "2026-10-29" → "Thu, 29 Oct 2026"
export function formatDayKey(key, { year = true } = {}) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', ...(year ? { year: 'numeric' } : {}),
  });
}
