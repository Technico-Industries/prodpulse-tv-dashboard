import { CircleCheck, Gauge, Timer, TriangleAlert } from 'lucide-react';
import { DemoTag } from './Panel';
import { formatMinutes, formatNumber, formatPercent } from '../utils/formatNumbers';
import styles from './KPISection.module.css';

function KPICard({ label, icon: Icon, value, unit, footer, demo, alert = false, children }) {
  return (
    <div className={`${styles.card} ${alert ? styles.alert : ''}`}>
      <div className={styles.top}>
        <span className={styles.label}>
          {label}
          {demo && <DemoTag />}
        </span>
        <Icon className={styles.icon} aria-hidden />
      </div>
      <div className={styles.valueRow}>
        <span className={styles.value}>{value}</span>
        {unit && <span className={styles.unit}>{unit}</span>}
      </div>
      {children}
      <div className={styles.footer}>{footer}</div>
    </div>
  );
}

// Current-shift KPIs exactly as published by the backend (live) or the demo
// data. Unknown values show "—", never 0. Achievement has no good/bad
// colouring until the plant's thresholds are agreed.
export default function KPISection({ kpis, shift, downtimeMinutes, stoppedCount, demo }) {
  const { goodProduction, planToDate, achievementPct, rejections, qualityPct } = kpis;
  const unit = (v) => (v == null ? null : 'pcs');
  return (
    <div className={styles.grid}>
      <KPICard label="Good production" icon={CircleCheck} value={formatNumber(goodProduction)} unit={unit(goodProduction)} demo={demo}
        footer={<>Plan to date <strong>{formatNumber(planToDate)}</strong>{shift ? <> · Shift {shift}</> : null}</>} />

      <KPICard label="Target achievement" icon={Gauge} value={formatPercent(achievementPct)} demo={demo}
        footer={achievementPct == null ? 'No plan to date yet' : 'Good production vs plan to date'}>
        <div className={styles.track} role="presentation">
          <div className={styles.fill} style={{ width: `${Math.min(100, achievementPct ?? 0)}%` }} />
        </div>
      </KPICard>

      <KPICard label="Rejections" icon={TriangleAlert} value={formatNumber(rejections)} unit={unit(rejections)} demo={demo}
        footer={qualityPct == null ? 'Current shift' : <>Quality <strong>{formatPercent(qualityPct)}</strong> · current shift</>} />

      <KPICard label="Downtime" icon={Timer} value={formatMinutes(downtimeMinutes)} demo={demo} alert={stoppedCount > 0}
        footer={stoppedCount
          ? <span className={styles.stoppedText}>{stoppedCount} line{stoppedCount === 1 ? '' : 's'} stopped now</span>
          : 'No lines stopped'} />
    </div>
  );
}
