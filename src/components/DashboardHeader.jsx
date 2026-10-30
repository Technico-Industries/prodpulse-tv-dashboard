import { Activity } from 'lucide-react';
import ConnectionStatus from './ConnectionStatus';
import { formatClock, formatDayKey } from '../utils/formatNumbers';
import styles from './DashboardHeader.module.css';

// Production date, shift and operational state come from the backend
// (server-side 06:30 Asia/Kolkata production day), never from the TV clock.
export default function DashboardHeader({ title, productionDate, currentShift, operationalState, now, connection, banner = null }) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <div className={styles.logo}>
          <Activity className={styles.logoIcon} aria-hidden />
        </div>
        <div>
          <div className={styles.product}>ProdPulse</div>
          <h1 className={styles.title}>{title} Dashboard</h1>
        </div>
      </div>

      {banner && <div className={styles.center}>{banner}</div>}

      <div className={styles.meta}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Production date</span>
          <span className={styles.fieldValue}>{productionDate ? formatDayKey(productionDate) : '—'}</span>
        </div>
        <div className={styles.divider} aria-hidden />
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Shift</span>
          <span className={styles.fieldValue}>{currentShift ? `Shift ${currentShift}` : '—'}</span>
          {operationalState === 'no_active_sessions' && <span className={styles.fieldNote}>No lines running</span>}
        </div>
        <div className={styles.divider} aria-hidden />
        <ConnectionStatus connection={connection} />
        <time className={styles.clock} dateTime={new Date(now).toISOString()}>{formatClock(now)}</time>
      </div>
    </header>
  );
}
