import { ArrowLeftRight } from 'lucide-react';
import Panel, { LegendItem } from './Panel';
import { SERIES } from './statusConfig';
import { formatMinutes, formatNumber, formatPercent } from '../utils/formatNumbers';
import styles from './ShiftComparison.module.css';

// Shift A vs Shift B as published (live: the backend's current production
// day; demo: the last full day). Achievement comes with the data — it is not
// recomputed here. Bars are scaled per metric; a missing value has no bar.
export default function ShiftComparison({ comparison, demo }) {
  const { A, B, label } = comparison;
  const metrics = [
    { label: 'Good production', a: A.goodProduction, b: B.goodProduction, fmt: formatNumber },
    { label: 'Target achievement', a: A.achievementPct, b: B.achievementPct, fmt: (v) => formatPercent(v), max: 100 },
    { label: 'Rejections', a: A.rejections, b: B.rejections, fmt: formatNumber },
    { label: 'Downtime', a: A.downtimeMinutes, b: B.downtimeMinutes, fmt: formatMinutes },
  ];

  return (
    <Panel
      title="Shift A vs Shift B"
      icon={ArrowLeftRight}
      subtitle={label}
      demo={demo}
      right={
        <div className={styles.legend}>
          <LegendItem color={SERIES.primary} label="Shift A" />
          <LegendItem color={SERIES.secondary} label="Shift B" />
        </div>
      }
      bodyClassName={styles.body}
    >
      {metrics.map((m) => {
        const max = Math.max(m.max ?? 0, m.a || 0, m.b || 0) || 1;
        return (
          <div key={m.label} className={styles.metric}>
            <div className={styles.metricLabel}>{m.label}</div>
            {[['A', m.a, SERIES.primary], ['B', m.b, SERIES.secondary]].map(([shift, v, color]) => (
              <div key={shift} className={styles.row}>
                <span className={styles.shift}>{shift}</span>
                <span className={styles.track}>
                  {v != null && <span className={styles.fill} style={{ width: `${((v || 0) / max) * 100}%`, background: color }} />}
                </span>
                <span className={styles.value}>{m.fmt(v)}</span>
              </div>
            ))}
          </div>
        );
      })}
    </Panel>
  );
}
