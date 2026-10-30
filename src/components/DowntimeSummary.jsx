import { OctagonX, Timer } from 'lucide-react';
import Panel from './Panel';
import { formatMinutes } from '../utils/formatNumbers';
import styles from './DowntimeSummary.module.css';

const MAX_REASONS = 5;
// Longest stops only; every stopped line is also flagged in the line grid.
const MAX_STOPPED_CHIPS = 2;

// Downtime by reason (largest first) plus the lines that are stopped right now.
export default function DowntimeSummary({ reasons, stoppedLines, demo }) {
  const sorted = [...reasons].sort((a, b) => b.minutes - a.minutes).slice(0, MAX_REASONS);
  const max = Math.max(1, ...sorted.map((r) => r.minutes));

  return (
    <Panel title="Downtime reasons" icon={Timer} subtitle="Current shift · minutes lost by reason" demo={demo}
      bodyClassName={styles.body}>
      <ul className={styles.list}>
        {sorted.length === 0 && <li className={styles.none}>No downtime recorded this shift</li>}
        {sorted.map((r) => (
          <li key={r.reason} className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.reason}>{r.reason}</span>
              <span className={styles.minutes}>
                {formatMinutes(r.minutes)}
                {r.occurrences != null && <span className={styles.times}>{r.occurrences} stop{r.occurrences === 1 ? '' : 's'}</span>}
              </span>
            </div>
            <span className={styles.track}>
              <span className={styles.fill} style={{ width: `${(r.minutes / max) * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>

      <div className={styles.stoppedRow}>
        <span className={styles.stoppedLabel}>
          <OctagonX className={styles.stoppedIcon} aria-hidden />
          Stopped now
        </span>
        {stoppedLines.length === 0 ? (
          <span className={styles.none}>None</span>
        ) : (
          <>
            {stoppedLines.slice(0, MAX_STOPPED_CHIPS).map((l) => (
              <span key={l.lineId} className={styles.chip}>
                {l.lineName} <span className={styles.chipTime}>{formatMinutes(l.stoppedForMinutes)}</span>
              </span>
            ))}
            {stoppedLines.length > MAX_STOPPED_CHIPS && (
              <span className={styles.more}>+{stoppedLines.length - MAX_STOPPED_CHIPS} more</span>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
