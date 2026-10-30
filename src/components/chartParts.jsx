// Shared Recharts pieces: axis styling, a two-line day tick and a tooltip.
// A TV has no pointer, so charts also carry direct value labels; the
// tooltip is for anyone viewing on a desktop.

export const AXIS_TICK = { fill: '#a0a0a0', fontSize: 14 };
export const GRID_STROKE = '#2a2a2a';

// "Fri" over "23" for a production-day key "YYYY-MM-DD".
export function DayTick({ x, y, payload }) {
  const [yr, m, d] = payload.value.split('-').map(Number);
  const weekday = new Date(yr, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short' });
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={15} textAnchor="middle" fill="#a0a0a0" fontSize={14}>{weekday}</text>
      <text dy={32} textAnchor="middle" fill="#ffffff" fontSize={14} fontWeight={600}>{d}</text>
    </g>
  );
}

// Subtitle for the weekly charts: unavailable days are never drawn as zero,
// so say how many there are; not-yet-final days are flagged as provisional.
export function trendSubtitle(what, data) {
  const missing = data.filter((d) => d.available === false).length;
  const provisional = data.filter((d) => d.available !== false && d.provisional).length;
  return [
    `7 days · ${what}`,
    missing ? `${missing} unavailable` : null,
    provisional ? `${provisional} provisional` : null,
  ].filter(Boolean).join(' · ');
}

export function dayStatusRow(d) {
  if (d.available === false) return { label: 'Status', value: 'Not available' };
  return { label: 'Status', value: d.provisional ? 'Provisional' : 'Final' };
}

const tooltipBox = {
  background: '#1d1d1d',
  border: '1px solid #2a2a2a',
  borderRadius: 8,
  padding: '10px 14px',
  fontSize: 14,
  minWidth: 180,
};

export function ChartTooltip({ active, payload, title, rows }) {
  if (!active || !payload?.length) return null;
  const datum = payload[0].payload;
  return (
    <div style={tooltipBox}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{title(datum)}</div>
      {rows(datum).map((r) => (
        <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
          <span style={{ color: '#a0a0a0', display: 'flex', alignItems: 'center', gap: 8 }}>
            {r.color && <span style={{ width: 10, height: 10, borderRadius: 2, background: r.color }} />}
            {r.label}
          </span>
          <span>{r.value}</span>
        </div>
      ))}
    </div>
  );
}
