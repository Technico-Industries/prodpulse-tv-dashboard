import { useMemo } from 'react';
import { CircleAlert, Clock3, Database, LoaderCircle, Lock, WifiOff } from 'lucide-react';
import DashboardHeader from '../components/DashboardHeader';
import KPISection from '../components/KPISection';
import ProductionTrendChart from '../components/ProductionTrendChart';
import RejectionTrendChart from '../components/RejectionTrendChart';
import AssemblyLineGrid from '../components/AssemblyLineGrid';
import ShiftComparison from '../components/ShiftComparison';
import DowntimeSummary from '../components/DowntimeSummary';
import { useDashboardData } from '../hooks/useDashboardData';
import { useClock } from '../hooks/useClock';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { downtimeNow, elapsedMinutes, lineDisplayStatus } from '../utils/liveTime';
import { formatClock } from '../utils/formatNumbers';
import styles from './AssemblyDashboard.module.css';

const SCREEN_ICONS = { connecting: LoaderCircle, 'no-access': Lock, 'no-data': Database, 'not-configured': CircleAlert, disconnected: WifiOff, stale: Clock3 };

// Shown instead of the dashboard until a first overview document arrives.
function StatusScreen({ connection, now }) {
  const Icon = SCREEN_ICONS[connection.state] ?? CircleAlert;
  return (
    <div className={styles.statusScreen}>
      <Icon className={`${styles.statusIcon} ${connection.state === 'connecting' ? styles.spin : ''}`} aria-hidden />
      <div className={styles.statusTitle}>ProdPulse · Assembly Dashboard</div>
      <div className={styles.statusLabel}>{connection.label}</div>
      {connection.detail && <div className={styles.statusDetail}>{connection.detail}</div>}
      <div className={styles.statusClock}>{formatClock(now)}</div>
    </div>
  );
}

// Visible on the TV whenever the figures cannot be trusted to be current.
// Sits in the header's free space, so the dashboard keeps its full height.
function FreshnessBanner({ connection }) {
  const bad = ['stale', 'disconnected', 'no-access'].includes(connection.state);
  if (!bad && !connection.partial && !connection.issues.length) return null;
  const at = connection.lastUpdateMs ? formatClock(connection.lastUpdateMs) : null;
  let text;
  if (connection.state === 'stale') text = `Stale data — no update since ${at ?? 'start'}. Figures may be out of date.`;
  else if (bad) text = `${connection.label} — ${at ? `showing data from ${at}` : 'no data received'}. Reconnecting…`;
  else text = `Partially updated (${connection.issues.join(', ')})${at ? ` — last update ${at}` : ''}.`;
  return (
    <div className={`${styles.banner} ${bad ? styles.bannerBad : styles.bannerWarn}`} role="alert">
      {text}
    </div>
  );
}

// Assembly TV screen. From 1600px wide (designed at 1920×1080) everything
// fits the viewport with no scrolling; narrower screens stack and scroll.
export default function AssemblyDashboard() {
  const now = useClock(1000);
  const online = useOnlineStatus();
  const { mode, view, connection } = useDashboardData(now, online);
  const demo = mode === 'demo';

  // Per-second display values from published moments (no production maths):
  // a line's status (awaiting entry starts at a published instant) and the
  // running stop timers.
  const lines = useMemo(
    () => (view?.lines ?? []).map((l) => {
      const status = lineDisplayStatus(l, now);
      return { ...l, status, stoppedForMinutes: status === 'stopped' && l.stopStartMs ? elapsedMinutes(l.stopStartMs, now) : null };
    }),
    [view, now]
  );

  if (!view) return <StatusScreen connection={connection} now={now} />;

  const stoppedLines = lines
    .filter((l) => l.status === 'stopped')
    .sort((a, b) => (b.stoppedForMinutes ?? 0) - (a.stoppedForMinutes ?? 0));

  return (
    <div className={styles.page}>
      <DashboardHeader
        title={view.title}
        productionDate={view.productionDate}
        currentShift={view.currentShift}
        operationalState={view.operationalState}
        now={now}
        connection={connection}
        banner={<FreshnessBanner connection={connection} />}
      />

      <KPISection
        kpis={view.kpis}
        shift={view.currentShift}
        downtimeMinutes={downtimeNow(view.kpis.downtimeClosedMinutes, view.kpis.activeStops, now)}
        stoppedCount={stoppedLines.length}
        demo={demo}
      />

      <main className={styles.main}>
        <div className={styles.lines}>
          <AssemblyLineGrid lines={lines} status={view.linesStatus} demo={demo} />
        </div>

        <div className={styles.side}>
          <ProductionTrendChart data={view.weeklyTrend} demo={demo} />
          <RejectionTrendChart data={view.weeklyTrend} demo={demo} />
          {/* Bottom section */}
          <DowntimeSummary reasons={view.downtimeReasons} stoppedLines={stoppedLines} demo={demo} />
          <ShiftComparison comparison={view.shiftComparison} demo={demo} />
        </div>
      </main>
    </div>
  );
}
