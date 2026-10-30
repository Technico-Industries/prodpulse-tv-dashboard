import { LINE_STATUS } from './statusConfig';
import { formatMinutes, formatNumber, formatPercent } from '../utils/formatNumbers';
import styles from './LineStatusCard.module.css';

// One assembly line: name, status, current model, production vs plan,
// achievement, rejections and downtime — values as published by the backend.
// Status is shown by the colour bar AND the icon + word. `stoppedForMinutes`
// is counted locally from the published stop start.
export default function LineStatusCard({ line }) {
  const meta = LINE_STATUS[line.status] ?? LINE_STATUS.idle;
  const Icon = meta.icon;
  const pct = line.achievementPct;
  const hasPlan = line.planToDate != null && line.planToDate > 0;

  let note = line.model ?? 'No model running';
  let noteClass = '';
  if (line.status === 'stopped') {
    note = `${line.stoppedForMinutes != null ? formatMinutes(line.stoppedForMinutes) : 'Stopped'} · ${line.stopLabel ?? 'Reason not recorded'}`;
    noteClass = styles.stopNote;
  } else if (line.outdated) {
    note = 'Awaiting update';
    noteClass = styles.outdated;
  }

  const meta2 = [
    line.rejections != null ? `Rej ${formatNumber(line.rejections)}` : null,
    line.downtimeClosedMinutes != null && line.downtimeClosedMinutes > 0 ? `Down ${formatMinutes(line.downtimeClosedMinutes)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <article
      className={`${styles.card} ${line.status === 'stopped' ? styles.stopped : ''}`}
      style={{ '--status': meta.color }}
      aria-label={`${line.lineName}, ${meta.label}`}
    >
      <span className={styles.name}>{line.lineName}</span>
      <span className={styles.status}>
        <Icon className={styles.statusIcon} aria-hidden />
        {meta.label}
      </span>

      <div className={`${styles.model} ${noteClass}`}>{note}</div>

      <div className={styles.countRow}>
        <span className={styles.count}>{formatNumber(line.goodProduction)}</span>
        {hasPlan && <span className={styles.plan}>/ {formatNumber(line.planToDate)}</span>}
      </div>

      {hasPlan ? (
        <div className={styles.achievement}>
          <div className={styles.track} role="presentation">
            <div className={styles.fill} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
          </div>
          <span className={styles.pct}>{formatPercent(pct, 0)}</span>
        </div>
      ) : (
        <div className={styles.noPlan}>No plan this shift</div>
      )}
      {meta2 && <div className={styles.meta2}>{meta2}</div>}
    </article>
  );
}
