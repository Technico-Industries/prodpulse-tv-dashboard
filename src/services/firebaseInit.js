// Firebase client initialisation. Read-only usage: only Firestore is
// initialised — no Auth, no Functions, no Admin SDK (which must never run in
// a browser). Initialising does not contact the network; listeners do.

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

export function initFirebase(config) {
  // Reuse the app if it is already initialised (Vite HMR re-runs modules).
  const app = getApps().length ? getApp() : initializeApp(config);
  return { app, db: getFirestore(app) };
}
