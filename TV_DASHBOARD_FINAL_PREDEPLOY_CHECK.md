# ProdPulse Assembly TV Dashboard — Final Pre-Deployment Check

| | |
|---|---|
| **Date** | 2026-10-30 |
| **ProdPulse repo** | `C:\Users\prate\Technico Management\technico-management`, branch `main`, HEAD `5c458d0` (uncommitted working tree) |
| **TV dashboard** | `C:\Users\prate\Technico Management\prodpulse-tv-dashboard` (not a git repository) |
| **Firebase** | project `technico-industries-ltd`, Firestore `(default)`, Native, Standard, **asia-south1** |
| **Method** | Read-only review. Builds and runtime checks were done into a scratch folder. No deploy, no rules change, no Firestore access, no commit. Secrets and `.env` contents were not read or printed. |
| **Previous documents** | `PRODPULSE_BACKEND_INTEGRATION_AUDIT.md`, `TV_DASHBOARD_BACKEND_IMPLEMENTATION.md`, `TV_DASHBOARD_PREDEPLOY_REVIEW.md`, `TV_DASHBOARD_FIRESTORE_RULES_PROPOSAL.txt` |

**Legend:**
- **PASS**: verified.
- **WARNING**: acceptable, but act or accept consciously.
- **BLOCKER**: must be resolved first.

---

## 1. Timezone verification — PASS

**Where the timezone lives.** There is **no `src/utils/timezone.ts`**. The timezone module is **`functions/src/timezone.ts`** (committed, unmodified):
```ts
export const DEFAULT_PRODUCTION_TIMEZONE = 'Asia/Kolkata';
export function applyProductionTimezone(env = process.env) {
  const tz = env.PRODUCTION_TIMEZONE?.trim() || DEFAULT_PRODUCTION_TIMEZONE;
  process.env.TZ = tz;
  return tz;
}
applyProductionTimezone();
```
- **The fallback is correct.** An unset or blank `PRODUCTION_TIMEZONE` yields `Asia/Kolkata` (`?.trim() || default`).
- **It runs before any date code:**
  - `functions/src/index.ts` imports `./timezone` as its first statement.
  - `functions/src/tvDashboard/functions.ts` imports `../timezone` first as well.
  - The esbuild CJS bundle keeps that order. The shared helpers compute no dates at module load.
- **`src/utils/productionDay.ts`** (committed, unmodified): `PRODUCTION_DAY_CUTOVER_MINUTES = 6*60+30`. `productionDayKeyFor` uses local time, i.e. Asia/Kolkata after the fallback.

**Empirical proof.** The checks were run in a Node process **started in UTC** (as Cloud Functions are), with `PRODUCTION_TIMEZONE` unset, using the real modules:

| Instant | Result | Expected |
|---|---|---|
| process start | `TZ=UTC` → after import `process.env.TZ = Asia/Kolkata` | Asia/Kolkata ✅ |
| 06:29 IST, 23 Oct | 2026-10-22, Shift B | ✅ |
| 06:30 IST, 23 Oct | 2026-10-23, Shift A | ✅ cutover 06:30 IST |
| 07:00 IST (Shift A start) | 2026-10-23, Shift A | ✅ |
| 18:59 IST | 2026-10-23, Shift A | ✅ |
| 19:00 IST (Shift B start) | 2026-10-23, Shift B | ✅ |
| 23:59 IST | 2026-10-23, Shift B | ✅ |
| 02:00 IST, 24 Oct (Shift B after midnight) | 2026-10-23, Shift B | ✅ overnight B keeps its night |
| 05:30 IST, 24 Oct (UTC date already 24th) | 2026-10-23, Shift B | ✅ |
| Legacy Shift B session (no `productionDate`), started 19:05 IST | 2026-10-23 | ✅ via `resolveSessionProductionDate` |

- **Test suite in UTC:** the full TV backend suite (`functions/test/tvDashboard.test.ts`) also passes in a `TZ=UTC` process: **41/41**.
- **Bundle in UTC:** the built bundle, loaded in a UTC process, sets `process.env.TZ = Asia/Kolkata`.

**Schedules:** `tvDashboardDaily` is `45 6 * * *` with `timeZone: Asia/Kolkata`, and `tvDashboardOverview` is `every 1 minutes` with `Asia/Kolkata`. They use the constant `DEFAULT_PRODUCTION_TIMEZONE`, which is **independent of the env file**. Both are read from the built endpoints.

**Region:** all seven TV functions are `region: ["asia-south1"]` (read from the built endpoints). `prodPulseAI` has **no region set**, so it stays on the `us-central1` default. Its built endpoint is **byte-identical** to the existing `functions/lib` build.

**No change needed:** the fallback is correct.

**WARNING 1.1:** if `PRODUCTION_TIMEZONE` is ever set to anything other than `Asia/Kolkata`, production dates follow it but the two schedules still run on Asia/Kolkata. Leave it unset, or set it to `Asia/Kolkata`.

---

## 2. `src/utils/supervisorHandover.ts` — dependency and commit scope

### Why the TV backend imports it
`functions/src/tvDashboard/core.ts` and `service.ts` use four of its functions:
- `parseRunningSession`: reads a session the same way the app does, including `resolveSessionProductionDate` (overnight Shift B / legacy dates).
- `currentModel`: the part currently running.
- `slotEntryStatuses` and `sessionNowAbs`: the "awaiting entry" moment.

Re-implementing these would duplicate canonical logic, which is why it is imported.

### Is it required for a reproducible backend build? — **Yes (BLOCKER B1)**
- **The functions bundle contains 23 source files** (esbuild metafile). **7 of them are not committed:**

| Status | File | Part of |
|---|---|---|
| `M` | `functions/src/index.ts` (+3 lines: `export * from './tvDashboard/functions'`) | TV backend |
| `??` | `functions/src/tvDashboard/core.ts`, `functions.ts`, `service.ts`, `store.ts` | TV backend |
| `??` | `src/utils/supervisorHandover.ts` | handover feature (needed by TV backend) |
| `M` | `src/utils/prodPulseAI.ts` | Prod AI mobile feature (bundled because `prodPulseAI`'s code imports it) |

- **Why the backend can't be rebuilt from git:** a clean checkout of `5c458d0` contains none of the TV backend. A checkout of the TV backend without `supervisorHandover.ts` **fails to build** (missing module).
- **What the minimum backend commit needs:** `supervisorHandover.ts` imports only **committed, unmodified** helpers: `./lineEfficiency`, `./productionSchedule`, `./productionDay`. Nothing in committed HEAD imports it. **Committing it on its own is therefore safe for the current app.** It adds an unused (for HEAD) pure module, and the backend gets a reproducible build.

### The unfinished features in the working tree (precise map)

**A. Supervisor handover / Running Lines** (the feature `supervisorHandover.ts` belongs to):

| Status | File | Role / dependency |
|---|---|---|
| `??` | `src/utils/supervisorHandover.ts` | Pure logic. **Required by the TV backend.** |
| `??` | `scripts/testSupervisorHandover.ts` | Its tests (33 pass). **Imports `src/screens/RunningLinesScreen.tsx`**, so it cannot be committed without that screen. |
| `??` | `src/screens/RunningLinesScreen.tsx` | New "Running Lines" page |
| `M` | `src/screens/RecordProductionScreen.tsx` (~298 changed lines) | Shared-session handover (`recorderIdentity`, `syncAttributionFields`, `splitCreateOnlyFields`, opening a line's existing session). **Also contains feature B**: it imports `src/utils/slotSaveButton.ts`. |
| `M` | `src/screens/SupervisorOverviewScreen.tsx` | Contributor/handover filtering |
| `M` | `src/components/AdminDashboardPager.tsx` | Adds `SupervisorDashboardPager` (overview → Running Lines). **Also contains feature C** (floating `ProdAIButton` overlay on the admin pager). |
| `M` | `src/screens/DashboardScreen.tsx` | Uses `SupervisorDashboardPager` |
| `M` | `App.tsx` | `RecordProduction` route params `{ lineId?, requestedAt? }` (open a running line) |
| `M` | `package.json` | Scripts `test:supervisor-handover` (A) **and** `test:slot-save-button` (B) |

**B. Slot Save button** (entangled with A through `RecordProductionScreen.tsx`):

| Status | File | Notes |
|---|---|---|
| `??` | `src/utils/slotSaveButton.ts` | Tests: `scripts/testSlotSaveButton.ts` (11 pass) |
| `??` | `scripts/testSlotSaveButton.ts` | |

**C. Prod AI on mobile / popup** (independent of A, but entangled through `AdminDashboardPager.tsx`):

| Status | File |
|---|---|
| `M` | `src/components/ProdAIButton.tsx`, `src/components/ProdAIPanel.tsx`, `src/screens/AIAssistantScreen.tsx`, `src/screens/AdminOverviewScreen.tsx`, `src/screens/LineEfficiencyOverviewScreen.tsx`, `src/screens/LiveQualityLinesScreen.tsx`, `src/screens/QualityOverviewScreen.tsx`, `src/utils/prodAIPanelLayout.ts`, `src/utils/prodPulseAI.ts` (enables android/ios), `src/utils/prodPulseAIExcelExport.ts`, `functions/test/prodPulseAI.test.ts` |

`scripts/testProdAIPanel.ts` passes (9 tests).

**D. Release / docs:** `M app.json` (Android `versionCode` 30 → 31); `?? PRODPULSE_TV_DASHBOARD_AUDIT.md` (an earlier audit document, not created by this work).

**E. TV backend** (this project): `M functions/src/index.ts`; `?? functions/src/tvDashboard/{core,functions,service,store}.ts`; `?? functions/test/tvDashboard.test.ts`.

### Are A/B/C safe and complete enough to commit?
- **Tests pass:** handover 33, slot save 11, Prod AI panel 9, `prodPulseAI` 37, cors 8.
- **No markers:** no TODO/FIXME/HACK in the new files.
- **App typecheck** (`tsc --noEmit`, root tsconfig): **3 errors, all pre-existing in committed code** (verified with `git blame`). None comes from the uncommitted work:
  - `App.tsx:206` (StatusBar `backgroundColor` prop);
  - `RecordProductionScreen.tsx:4391` (`JSX` namespace);
  - `src/services/firebase.ts:2` (`getReactNativePersistence` typing).
- **The three features are entangled at file level:**
  - `RecordProductionScreen.tsx` mixes A and B.
  - `AdminDashboardPager.tsx` mixes A and C.
  - `package.json` mixes A and B.
- **Committing A alone** therefore also requires B (`slotSaveButton.ts`) and accepts C's pager overlay hunk, or a hunk-level split.
- **Functional readiness of A/B/C on devices** (mobile app behaviour) was **not** verified by this review. It needs the owner's app QA.

### Would unrelated or unfinished changes be deployed?
- **Mobile screens (A, B, C, D):** no. They are not part of the functions bundle and nothing here deploys the app.
- **`src/utils/prodPulseAI.ts` (C) — WARNING 2.1:** it **is** inside the functions bundle that the scoped TV deploy uploads, but only as code reachable from `prodPulseAI`. The scoped command does **not** update the `prodPulseAI` service, so no behaviour changes. Any **unscoped** deploy would redeploy `prodPulseAI` with this uncommitted change.

### Recommended commit split (owner decision; nothing was committed)
1. **Backend commit (minimum for deployment):**
   - `src/utils/supervisorHandover.ts`
   - `functions/src/index.ts`
   - `functions/src/tvDashboard/core.ts`, `functions.ts`, `service.ts`, `store.ts`
   - `functions/test/tvDashboard.test.ts`

   Do **not** include `scripts/testSupervisorHandover.ts`; it needs `RunningLinesScreen.tsx`.
2. **Later, separately, after app QA:** feature A (rest), B, C and D, split at hunk level where files are shared.

---

## 3. Backend deployment readiness

| Check | Result |
|---|---|
| Exactly seven TV functions exported | **PASS**: bundle exports 8 = `prodPulseAI` + `tvDashboardOnActiveSession`, `tvDashboardOnProductionRecord`, `tvDashboardOnShiftSummary`, `tvDashboardOnEndedSession`, `tvDashboardOnProductionLine`, `tvDashboardOverview`, `tvDashboardDaily`. No non-function exports. |
| All seven in `asia-south1` | **PASS**: `region: ["asia-south1"]` on all seven built endpoints. The Firestore triggers target database `(default)`. |
| Schedules | **PASS**: overview `every 1 minutes` and daily `45 6 * * *`, both `Asia/Kolkata`, `concurrency: 1`, `maxInstances: 1`. |
| Deploy command cannot include `prodPulseAI` | **PASS**: the command in §5 lists the seven names explicitly; `prodPulseAI` is not in the filter. |
| `prodPulseAI` unchanged | **PASS**: built endpoint byte-identical to the existing `functions/lib` build. `functions/src` changes are limited to the 3 appended lines in `index.ts`. `functions/lib` was not rebuilt or touched. |
| Canonical helpers reused | **PASS**: `src/utils/productionDay`, `productionSchedule`, `lineEfficiency` (`dedupeSlotRecords`, `efficiencyOf`), `qualityMetrics` (`counterQuality`), `downtime` (`collectDowntimeIntervals`), `modelPartProduction`, `supervisorHandover`. All are unmodified, except `supervisorHandover` (untracked, see B1). |
| Backend writes only the read model | **PASS**: every write is a transaction or batch on `tvDashboard/assembly`, `…/lines/{id}` or `…/days/{date}`. Production collections are only read (`.get()`, no transactions on them). |
| No raw production data to the TV | **PASS**: sanitised line, day and overview docs (allow-listed fields; a test seeds names, codes, UIDs, emails, device IDs and notes and proves none leak). |
| TV frontend reads only `tvDashboard/assembly/**` | **PASS**: one `onSnapshot` call site. The paths are `tvDashboard/assembly`, `tvDashboard/assembly/lines` and `tvDashboard/assembly/days`. TV tests 19/19, including the boundary tests "only tvDashboard/assembly/** is subscribed" and "no raw production collection, write API, Auth or Admin SDK in src/". |
| Mobile app / production data unmodified | **PASS**: no screen, helper, constant or rules change by this work. Production documents are never written. The app keeps reading and writing exactly as before. |
| Tests | **PASS**: TV backend 41/41 (also in UTC); helper suites unchanged and passing; TV frontend 19/19. |
| Typecheck / build | **PASS**: functions `tsc` 0 errors; functions bundle builds (128 KB); TV `vite build` succeeds. |
| Client writes prohibited | **PASS (proposal)**: `allow write: if false` for the TV paths. **WARNING 3.1:** `allow write: if false` cannot override a broader existing rule that allows writes (rules combine with OR). The exported Console rules must be checked for a recursive `match /{document=**}` write grant. |
| Public reads limited to `tvDashboard/assembly/**` | **WARNING 3.2: the proposal is broader.** `TV_DASHBOARD_FIRESTORE_RULES_PROPOSAL.txt` uses `match /tvDashboard/{document=**}`, i.e. all of `tvDashboard/**`. It should be narrowed (see §7). |
| Firebase CLI | **WARNING 3.3:** `firebase-tools` is not installed in the repo, so use `npx firebase-tools` (needs `login` with deploy rights). The first deploy may ask to enable Eventarc, Pub/Sub and Cloud Scheduler for asia-south1. |

---

## 4. Remaining blockers

| # | Blocker | Blocks | Resolution (owner) |
|---|---|---|---|
| **B1** | TV backend source and its dependency are **uncommitted**: `functions/src/index.ts` (M), `functions/src/tvDashboard/*.ts` (??), `functions/test/tvDashboard.test.ts` (??), `src/utils/supervisorHandover.ts` (??). Deploying from this working tree is not reproducible or auditable. | **Function deployment** | Commit the backend set in §2 ("Backend commit"), then deploy from that commit. |
| **G1** | Current Console Firestore rules not exported or reviewed; TV read rule not published. | **TV go-live** (not the function deploy) | §7 |
| **G2** | Rules proposal is broader than `tvDashboard/assembly/**`, and its option B (App Check) is mis-described. | **TV go-live** | §7 |

Everything else checked is PASS or an accepted WARNING.

---

## 5. Scoped deployment command — **do not run until B1 is resolved**

Run from the ProdPulse repo root (`technico-management`, where `firebase.json` is). Predeploy builds the bundle automatically.

```bash
npx firebase-tools deploy --project technico-industries-ltd --only functions:tvDashboardOnActiveSession,functions:tvDashboardOnProductionRecord,functions:tvDashboardOnShiftSummary,functions:tvDashboardOnEndedSession,functions:tvDashboardOnProductionLine,functions:tvDashboardOverview,functions:tvDashboardDaily
```

Before confirming, check the CLI's plan:
- it lists exactly these 7 functions;
- all are in **asia-south1**;
- **`prodPulseAI` is not listed**. If it is, abort.

**Never** use `npx firebase-tools deploy`, `--only functions` or `npm --prefix functions run deploy` for this.

After deploying:
- `tvDashboard/assembly.freshness.generatedAtMs` should advance every minute with `complete: true`.
- All 7 weekly days should become `available` within about 10 minutes.
- Watch the `[tvDashboard]` logs for `… failed`.

## 6. Rollback command — **not executed**

```bash
npx firebase-tools functions:delete tvDashboardOnActiveSession tvDashboardOnProductionRecord tvDashboardOnShiftSummary tvDashboardOnEndedSession tvDashboardOnProductionLine tvDashboardOverview tvDashboardDaily --region asia-south1 --project technico-industries-ltd
```

This deletes the seven functions and their Cloud Scheduler jobs. `prodPulseAI`, the mobile app and all production data are untouched.

**Optional, ⚠️ destructive to the dashboard read model only:**
- **What it deletes:** `tvDashboard/assembly` and every line, day and overview document under it.
- **What it does not touch:** production collections.

```bash
npx firebase-tools firestore:delete tvDashboard/assembly --recursive --project technico-industries-ltd
```

---

## 7. Firestore rules review still required before public go-live

1. **Export the current Console rules** into version control and review them:
   - Are unauthenticated reads of `productionLines`, `activeSessions`, `productionRecords`, `shiftSummaries`, `endedSessions`, `lineBreakdowns`, `users` and `operators` denied? They must be.
   - Does any broad rule (e.g. `match /{document=**}`) grant writes that would also cover `tvDashboard`?
2. **Narrow the public rule to exactly `tvDashboard/assembly/**`.** The explicit two-block form works in both rules versions:
   ```
   match /tvDashboard/assembly {
     allow read: if true;
     allow write: if false;
   }
   match /tvDashboard/assembly/{document=**} {
     allow read: if true;
     allow write: if false;
   }
   ```
3. **Fix option B in `TV_DASHBOARD_FIRESTORE_RULES_PROPOSAL.txt`.** App Check enforcement is project-wide per service and would also apply to the mobile app.
4. **Accept the public-data exposure explicitly.** Anyone with the project ID will be able to read every Assembly line's name, plant, model, production, plan, achievement, rejections, downtime and stop category, plus daily and weekly totals. No personal data is included.
5. **Test in the Rules Playground,** then publish **only** this addition. Until then the TV shows "No access" (by design, no fallback data).

---

## Status

# NOT READY — BLOCKERS REMAIN

- **For function deployment:** **B1**. Commit the TV backend files and `src/utils/supervisorHandover.ts` (see §2), then deploy from that commit with the scoped command in §5.
- **For public TV go-live, additionally:** **G1 / G2** (rules export and review, a narrowed rule, the corrected proposal).

Everything else (timezone fallback, regions, schedules, exports, `prodPulseAI` isolation, canonical helpers, sanitisation, frontend data boundary, tests and builds) passed.
