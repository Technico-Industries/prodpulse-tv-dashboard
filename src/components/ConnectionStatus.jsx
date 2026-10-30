import { CircleAlert, Clock3, Database, LoaderCircle, Lock, Radio, WifiOff } from 'lucide-react';
import { formatClock } from '../utils/formatNumbers';
import styles from './ConnectionStatus.module.css';

const LOOK = {
  connecting: { color: 'var(--muted)', icon: LoaderCircle },
  live: { color: 'var(--status-running)', icon: Radio },
  disconnected: { color: 'var(--status-stopped)', icon: WifiOff },
  stale: { color: 'var(--status-awaiting)', icon: Clock3 },
  'no-access': { color: 'var(--status-stopped)', icon: Lock },
  'no-data': { color: 'var(--muted)', icon: Database },
  'not-configured': { color: 'var(--status-stopped)', icon: CircleAlert },
  demo: { color: 'var(--demo)', icon: Database },
};

// Data-source / freshness indicator for the header. The second line is the
// time of the last successful aggregate update (the backend's generatedAtMs).
export default function ConnectionStatus({ connection }) {
  const look = LOOK[connection.state] ?? LOOK.disconnected;
  const Icon = look.icon;
  const detail = connection.state === 'demo'
    ? 'Not connected'
    : connection.lastUpdateMs
      ? `Updated ${formatClock(connection.lastUpdateMs)}`
      : connection.state === 'connecting' ? 'Waiting for data' : 'No update received';

  return (
    <div className={styles.pill} style={{ borderColor: look.color }} role="status" aria-live="polite">
      <span className={styles.dot} style={{ background: look.color }} aria-hidden />
      <Icon className={styles.icon} style={{ color: look.color }} aria-hidden />
      <div>
        <div className={styles.label}>{connection.label}</div>
        <div className={styles.detail}>{detail}</div>
      </div>
    </div>
  );
}
