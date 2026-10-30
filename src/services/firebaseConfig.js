// Public Firebase Web SDK configuration, read from Vite env variables.
// Pure (no SDK import) so it can be unit-tested.

export const FIREBASE_ENV_KEYS = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID',
};

const REQUIRED = ['apiKey', 'authDomain', 'projectId', 'appId'];

export function readFirebaseConfig(env = {}) {
  const config = {};
  for (const [key, envName] of Object.entries(FIREBASE_ENV_KEYS)) {
    const v = env[envName];
    if (typeof v === 'string' && v.trim()) config[key] = v.trim();
  }
  const missing = REQUIRED.filter((k) => !config[k]).map((k) => FIREBASE_ENV_KEYS[k]);
  return { config, missing };
}

// 'live' unless explicitly set to 'demo'. Demo data is never a fallback.
export function readDashboardMode(env = {}) {
  return env.VITE_DASHBOARD_MODE === 'demo' ? 'demo' : 'live';
}
