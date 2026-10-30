import { CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ShieldAlert } from 'lucide-react';
import Panel from './Panel';
import { AXIS_TICK, ChartTooltip, DayTick, GRID_STROKE, dayStatusRow, trendSubtitle } from './chartParts';
import { SERIES } from './statusConfig';
import { formatDayKey, formatNumber } from '../utils/formatNumbers';

// Single series, so the title names it and no legend box is needed.
export default function RejectionTrendChart({ data, demo }) {
  return (
    <Panel title="Rejection trend" icon={ShieldAlert} subtitle={trendSubtitle('rejected pcs', data)} demo={demo}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 28, right: 20, left: -6, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis dataKey="dayKey" tick={<DayTick />} height={42} interval={0} padding={{ left: 16, right: 16 }}
            axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={54} allowDecimals={false} domain={[0, 'auto']} />
          <Tooltip
            cursor={{ stroke: '#3a3a3a' }}
            content={
              <ChartTooltip
                title={(d) => formatDayKey(d.dayKey, { year: false })}
                rows={(d) => [{ label: 'Rejections', value: formatNumber(d.rejections), color: SERIES.primary }, dayStatusRow(d)]}
              />
            }
          />
          <Line dataKey="rejections" name="Rejections" stroke={SERIES.primary} strokeWidth={2.5}
            dot={{ r: 5, fill: SERIES.primary, stroke: '#151515', strokeWidth: 2 }} isAnimationActive={false}>
            <LabelList dataKey="rejections" position="top" offset={12} formatter={formatNumber} fill="#ffffff" fontSize={14} fontWeight={600} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  );
}
