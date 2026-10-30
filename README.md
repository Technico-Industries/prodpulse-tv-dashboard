# ProdPulse Assembly TV Dashboard

Read-only Assembly production dashboard for a factory TV that stays open
all day. Dark industrial control-room design, built for **1920 × 1080**.

It uses the **same Firebase project and Firestore database as the ProdPulse
app** (`technico-industries-ltd`, `(default)`, `asia-south1`). It reads
**only the sanitised aggregate documents** published by the ProdPulse Cloud
Functions (`functions/src/tvDashboard` in the ProdPulse repo). It never reads
production collections and never recreates production calculations.

Stack: React 19 · JavaScript/JSX · Vite 7 · plain CSS + CSS Modules ·
Recharts 3 · Lucide React · Firebase JS SDK 12 (Firestore only: no Auth,
no Functions, no Admin SDK).

## Run locally

Requires Node.js 20.19+ (tested on Node 24).

```bash
cd "C:\Users\prate\Technico Management\prodpulse-tv-dashboard"
npm install
npm run dev        # http://localhost:5180 (also reachable on the LAN)
npm test           # unit tests (Node's built-in runner, Firestore faked)
npm run build      # production build -> dist/
npm run preview    # serve dist/ locally
```

On the TV, open the page full screen (F11 / kiosk mode). The TV's clock
should be accurate (NTP): stop timers and the stale-data check compare it
with server timestamps.

## Configuration (`.env.local`, git-ignored)

Copy `.env.example` to `.env.local`.

| Variable | Meaning |
|---|---|
| `VITE_FIREBASE_API_KEY`, `…_AUTH_DOMAIN`, `…_PROJECT_ID`, `…_STORAGE_BUCKET`, `…_MESSAGING_SENDER_ID`, `…_APP_ID` | Public Firebase **web** config of the ProdPulse project. These are the same values as the app's `src/services/firebase.ts`. They identify the project; they are not secrets. |
| `VITE_DASHBOARD_MODE` | `live` (default) or `demo` (built-in demonstration data, no Firebase). |
| `VITE_LINE_PAGE_SECONDS` | Seconds per line-grid page (default 15). |

Anything prefixed `VITE_` is bundled into the browser. **Never** put Gemini
keys, service-account / Admin SDK credentials or private keys here.

## Data access (browser)

| Listener (`onSnapshot`) | Path | Used for |
|---|---|---|
| Document | `tvDashboard/assembly` | Production date, shift, operational state, KPIs, Shift A vs B, downtime reasons, freshness |
| Collection | `tvDashboard/assembly/lines` | Line cards: status, model, production, plan, achievement, rejections, downtime, active stop |
| Query (document-ID range) | `tvDashboard/assembly/days/{productionDate}` | 7-day production and rejection trends |

That is the complete list (`src/services/dashboardPaths.js`); a unit test
fails if any source file references a production collection or a write API.

### How the data is handled

- **Days and dates:** the day documents subscribed are the 7 production dates before the **server's** `productionDate`. They are re-subscribed when it rolls over at 06:30 Asia/Kolkata.
- **Unavailable days:** a day without a document is shown as a gap ("unavailable"), never as zero. Days that are not final are labelled provisional.
- **Values as published:** every figure is used exactly as the backend publishes it (`src/data/liveDashboardModel.js` only maps fields). A value the backend did not publish shows "—".
- **Active stops:** the backend publishes each stop's start time. The TV adds the elapsed time locally every second, both on the cards and in the Downtime KPI.
- **Awaiting entry:** a running line shows "Awaiting entry" from the published `awaitingEntryFromMs`.
- **Outdated line docs:** a line doc not yet refreshed for the current production date is marked "Awaiting update".

### Connection states

| Header badge | When |
|---|---|
| Connecting… | No overview received yet |
| Live | A **server-confirmed** overview whose `generatedAtMs` is under 7 minutes old (the backend's heartbeat is 5 minutes). Never set merely because the browser is online. |
| Disconnected | Listener error or offline. The last received data stays on screen. Listeners are re-attached with back-off. |
| Stale data | No new generation for more than 7 minutes |
| No access | Firestore rules deny reading `tvDashboard` (retried every 60 s) |
| No data yet | `tvDashboard/assembly` does not exist (backend not deployed or not run yet) |
| Not configured | `.env.local` is incomplete |

Stale, disconnected and partially-updated states also show a banner in the
header with the time of the last successful update. Until the first overview
arrives, a full-screen status page is shown. **Demo data is never used as a
fallback.**

## Public read-only access — not yet enabled

The owner chose a public read-only dashboard. The intended rule (**not
published**; the current Console rules must be exported and reviewed first,
see `TV_DASHBOARD_FIRESTORE_RULES_PROPOSAL.txt`):

```
match /tvDashboard/{document=**} {
  allow read: if true;
  allow write: if false;
}
```

**What becomes public:**
- **Everything under `tvDashboard/**`** becomes readable by anyone who knows the project ID (it is in every web build). That includes per-line names, plants, models, production, plan, achievement, rejections, downtime and stop categories, plus the daily and weekly totals.
- **No personal data** is published there (supervisors, operators, UIDs, notes).
- **Production collections must never be made public.**

**Until the rule and the backend functions are deployed,** live mode shows "No access" or "No data yet", by design.

## Structure

```text
src/
├── services/  firebase.js (env → app/db), firebaseConfig.js, firebaseInit.js,
│              dashboardPaths.js (the only paths read), dashboardFeed.js (listeners)
├── data/      liveDashboardModel.js (aggregate docs → view, connection state),
│              demoDashboardModel.js + mockDashboardData.js (demo mode only)
├── hooks/     useDashboardData (live | demo), useClock, useOnlineStatus, usePageRotation
├── utils/     liveTime.js (stop timers, awaiting entry), pagination.js,
│              formatNumbers.js, metrics.js (demo-only provisional formulas), productionDay.js
├── components/ … unchanged look; render the view model
└── pages/AssemblyDashboard.jsx
tests/dashboard.test.js
```

Backend documentation (in this folder): `PRODPULSE_BACKEND_INTEGRATION_AUDIT.md`,
`TV_DASHBOARD_BACKEND_IMPLEMENTATION.md`, `TV_DASHBOARD_PREDEPLOY_REVIEW.md`,
`TV_DASHBOARD_FIRESTORE_RULES_PROPOSAL.txt`.
