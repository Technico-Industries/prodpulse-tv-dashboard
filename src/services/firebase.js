// Firebase for the TV dashboard: the SAME project and (default) Firestore
// database as the ProdPulse app (technico-industries-ltd), configured from
// Vite env variables (.env.local). The browser only ever READS the
// tvDashboard/** aggregate documents — see services/dashboardPaths.js.
//
// In demo mode nothing is initialised.

import { readDashboardMode, readFirebaseConfig } from './firebaseConfig';
import { initFirebase } from './firebaseInit';

export const dashboardMode = readDashboardMode(import.meta.env);

const { config, missing } = readFirebaseConfig(import.meta.env);

// Non-null when live mode cannot start; shown on screen instead of data.
export const firebaseConfigError =
  dashboardMode === 'live' && missing.length
    ? `Firebase is not configured: missing ${missing.join(', ')} in .env.local`
    : null;

const initialised = dashboardMode === 'live' && !firebaseConfigError ? initFirebase(config) : null;

export const app = initialised?.app ?? null;
export const db = initialised?.db ?? null;
