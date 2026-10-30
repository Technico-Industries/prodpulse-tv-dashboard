import { Bar, CartesianGrid, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TrendingUp } from 'lucide-react';
import Panel, { LegendItem } from './Panel';
import { AXIS_TICK, ChartTooltip, DayTick, GRID_STROKE, dayStatusRow, trendSubtitle } from './chartParts';
import { SERIES } from './statusConfig';
import { formatCompact, formatDayKey, formatNumber } from '../utils/formatNumbers';

// Weekly actual production (bars) vs plan (dashed line), one axis.
export default function ProductionTrendChart({ data, demo }) {
  return (
    <Panel
      title="Production trend"
      icon={TrendingUp}
      subtitle={trendSubtitle('actual vs plan', data)}
      demo={demo}
      right={
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <LegendItem color={SERIES.primary} label="Actual" />
          <LegendItem color={SERIES.plan} label="Plan" dashed />
        </div>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: 4, left: -6, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis dataKey="dayKey" tick={<DayTick />} height={42} interval={0} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
          <YAxis tickFormatter={formatCompact} tick={AXIS_TICK} axisLine={false} tickLine={false} width={54} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={
              <ChartTooltip
                title={(d) => formatDayKey(d.dayKey, { year: false })}
                rows={(d) => [
                  { label: 'Actual', value: formatNumber(d.actual), color: SERIES.primary },
                  { label: 'Plan', value: formatNumber(d.plan), color: SERIES.plan },
                  dayStatusRow(d),
                ]}
              />
            }
          />
          <Bar dataKey="actual" name="Actual" fill={SERIES.primary} radius={[4, 4, 0, 0]} maxBarSize={52} isAnimationActive={false}>
            {/* Inside the bar top, so labels never collide with the plan line */}
            <LabelList dataKey="actual" position="insideTop" offset={10} formatter={formatCompact} fill="#ffffff" fontSize={14} fontWeight={700} />
          </Bar>
          <Line dataKey="plan" name="Plan" stroke={SERIES.plan} strokeWidth={2} strokeDasharray="6 4"
            dot={{ r: 4, fill: '#151515', stroke: SERIES.plan, strokeWidth: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  );
}
