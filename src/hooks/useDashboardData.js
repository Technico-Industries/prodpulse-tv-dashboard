import { useEffect, useMemo, useState } from 'react';
import { collection, doc, documentId, onSnapshot, query, where } from 'firebase/firestore';
import { db, dashboardMode, firebaseConfigError } from '../services/firebase';
import { createDashboardFeed, initialFeedState } from '../services/dashboardFeed';
import { buildLiveView, connectionState, CONNECTION_LABELS } from '../data/liveDashboardModel';
import { buildDemoView } from '../data/demoDashboardModel';
import { advanceDemoData, createDemoDashboard } from '../data/mockDashboardData';

// The Firestore functions the feed may use — reads only.
const firestoreReads = { collection, doc, documentId, onSnapshot, query, where };

const DEMO_UPDATE_MS = 10000;

// The dashboard's single data entry point.
//   live (default): realtime listeners on the tvDashboard/** aggregates only.
//                   Missing or failed data is shown as such — never replaced
//                   with demo data.
//   demo:           VITE_DASHBOARD_MODE=demo — built-in demonstration data.
// Returns { mode, view, connection }; view is null until live data arrives.
export function useDashboardData(nowMs, online) {
  return dashboardMode === 'demo' ? useDemoData() : useLiveData(nowMs, online);
}

function useLiveData(nowMs, online) {
  const [feed, setFeed] = useState(initialFeedState);

  useEffect(() => {
    if (!db) return undefined;
    const live = createDashboardFeed({ db, fs: firestoreReads, onChange: setFeed });
    return () => live.stop(); // detaches every listener and retry timer
  }, []);

  const view = useMemo(() => buildLiveView(feed), [feed]);
  const connection = connectionState({ configError: firebaseConfigError, feed, online, nowMs });
  return { mode: 'live', view, connection };
}

function useDemoData() {
  const [data, setData] = useState(() => createDemoDashboard());
  useEffect(() => {
    const id = setInterval(() => setData((d) => advanceDemoData(d, Date.now(), DEMO_UPDATE_MS)), DEMO_UPDATE_MS);
    return () => clearInterval(id);
  }, []);
  const view = useMemo(() => buildDemoView(data), [data]);
  return {
    mode: 'demo',
    view,
    connection: { state: 'demo', label: CONNECTION_LABELS.demo, detail: 'Not connected', lastUpdateMs: data.updatedAtMs, partial: false, issues: [] },
  };
}
