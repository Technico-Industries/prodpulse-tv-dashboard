# ProdPulse TV Dashboard Backend — Pre-Deployment Review

| | |
|---|---|
| **Date** | 2026-10-30 |
| **Scope** | `technico-management/functions/src/tvDashboard/{core,store,service,functions}.ts`, `functions/test/tvDashboard.test.ts`, the 3-line addition to `functions/src/index.ts`, and `TV_DASHBOARD_BACKEND_IMPLEMENTATION.md` / `TV_DASHBOARD_FIRESTORE_RULES_PROPOSAL.txt` |
| **Method** | Read-only. No source file changed, nothing deployed, no Firebase/Firestore access, no rules touched, nothing committed. Secrets and `.env*` files were not opened. |
| **Repo state** | HEAD `5c458d0`. Working tree identical to the end of Phase 3 (status, diff and untracked-file hashes compared at the start and end of the review). |

**Legend:**
- **PASS**: verified, no action needed.
- **WARNING**: safe to deploy, but should be addressed or consciously accepted.
- **BLOCKER**: must be resolved before deploying (or, where stated, before TV go-live).

## Summary

| # | Area | Result |
|---|---|---|
| 1 | Exported functions | PASS |
| 2 | Trigger filters / irrelevant `activeSessions` writes | PASS, 2 WARNINGS |
| 3 | Concurrency and stale-computation protection | PASS, 3 WARNINGS |
| 4 | Per-line and overview aggregation consistency | PASS, 3 WARNINGS |
| 5 | Daily finalisation and historical days | PASS, 1 WARNING |
| 6 | Error handling and retries | **1 BLOCKER**, 2 WARNINGS |
| 7 | Sensitive fields | PASS |
| 8 | Untracked `supervisorHandover.ts` | **1 BLOCKER** |
| 9 | Firestore database region | **1 BLOCKER** |
| 10 | TV authentication | **BLOCKER for TV go-live** (not for function deploy), 2 WARNINGS |
| 11 | Deployment and rollback commands | PASS, 3 WARNINGS |
| 12 | `prodPulseAI` unaffected | PASS, 1 WARNING |

**Overall: not ready to deploy.** Three blockers apply to the function deploy (6.1, 8.1, 9.1); one more applies before the TV goes live (10.1). The exact actions are in §13.

---

## 1. Exported functions — **PASS**

The built bundle (identical esbuild config, output in a scratch folder) exports exactly these 8 endpoints:

| Export | Type | Filter / schedule |
|---|---|---|
| `prodPulseAI` | callable | unchanged |
| `tvDashboardOnActiveSession` | Firestore `onDocumentWritten` | `activeSessions/{lineId}`, database `(default)` |
| `tvDashboardOnProductionRecord` | Firestore `onDocumentWritten` | `productionRecords/{recordId}` |
| `tvDashboardOnShiftSummary` | Firestore `onDocumentWritten` | `shiftSummaries/{summaryId}` |
| `tvDashboardOnEndedSession` | Firestore `onDocumentWritten` | `endedSessions/{sessionId}` |
| `tvDashboardOnProductionLine` | Firestore `onDocumentWritten` | `productionLines/{lineId}` |
| `tvDashboardOverview` | `onSchedule` | `every 1 minutes`, `Asia/Kolkata` |
| `tvDashboardDaily` | `onSchedule` | `45 6 * * *`, `Asia/Kolkata` |

- **PASS:** `tvDashboard/functions.ts` exports only these 7 constants. `export *` from `index.ts` therefore adds nothing else to the deploy surface.
- **PASS:** the names are unique, under the length limit, and do not collide with `prodPulseAI`.

## 2. Trigger filters

- **PASS: irrelevant `activeSessions` writes are ignored before any read.**
  - **How it works:** `impactOfWrite` compares `sessionProjection(before)` with `sessionProjection(after)`. The projection covers location fields, `shift`, `productionDate`, `startedAt`, `otHours`, `productionStartMinutesAbs`, `plannedProductionTotal`, `selectedPartIndex`, `changeovers`, `savedSlotIndices`, `deletedSlotIndices`, `lineStopped`, and each stop's id, start, end, duration, running flag and reason.
  - **Ignored fields:** the sync fields that change on every keystroke: `producedBySlot`, `producedSegment`, `rejectionsBySlot`, `lossReasonBySlot`, `operators`, `revision`, `updatedBy`, `contributorUids`, `clientUpdatedAtMs`, `syncConflicts`, `deletedSlotBackups`, `updatedAt`, and the cached `totalDowntimeMinutes`, `totalRejections`, `stopsSummaryBySlot`.
  - **The cached total is excluded on purpose:** `totalDowntimeMinutes` grows on every sync while a stop runs.
  - **Covered by a test:** "activeSessions writes that only change unsaved inputs / sync metadata trigger nothing".
- **PASS:** every field that can change the read model is in the projection. Saved production arrives through `productionRecords` triggers; slot saves change `savedSlotIndices`; stops change `stopsBySlot` and `lineStopped`.
- **WARNING 2.1: invocations still happen.** Each ignored write is still one function invocation (no Firestore reads), roughly one per 1.2-second sync burst per line. This is cheap but visible in metrics. Firestore triggers cannot filter on fields server-side.
- **WARNING 2.2: no early exit for non-Assembly lines.**
  - **What happens:** writes on Welding, Press and Plating lines (records, sessions, summaries, lines) run the full `recomputeLine`: 2 doc reads, a records query, 2 summary gets, an ended-sessions query and a transactional read, ending in `noop`.
  - **The sweep has the same issue:** the 15-minute sweep also recomputes every active session of every workshop, plus lines with no workshop.
  - **Impact:** cost only, not correctness.
  - **Suggested fix:** read the line doc first and return early when neither it nor the source copy is Assembly.

## 3. Concurrency and stale-computation protection

- **PASS: per-document serialisation across instances.** Every read-model write runs in a Firestore transaction on that read-model document (`commitLine`, `commitDay`, `commitOverview`). Admin SDK transactions lock the document they read, so writers on different instances serialise on it, with automatic retries. `markDaysDirty` (a merge write outside a transaction) conflicts with a concurrent `commitDay` transaction, which then retries and sees the flag. No transaction touches production collections, so the app's writes are never blocked.
- **PASS: the stale guard rejects older computations.**
  - **Rule:** `decideWrite` refuses a computation whose `computedAtMs` (taken before its source reads) is older than the stored one. A newer delete cannot be undone by an older write, and vice versa.
  - **Convergence:** every source write produces its own trigger event, whose computation starts after that write commits, so the last computation always sees the final source state.
  - **Covered by a test:** "stale computation never overwrites a newer one (lines, days, overview)".
- **WARNING 3.1: ordering relies on wall clocks and start time.**
  - **Clocks:** `computedAtMs` comes from each instance's clock. Google's clocks are tightly synchronised, but sub-millisecond ties or skew can mis-order two computations that start almost together.
  - **Slow reads:** a computation that started earlier but issued its reads later is treated as older, even if it read newer data.
  - **Mitigation:** the next event for that line, and the 15-minute sweep, re-derive the line from source.
  - **Verdict:** acceptable for a display read model; documented.
- **WARNING 3.2: overlapping overview runs on one instance.**
  - **Cause:** `tvDashboardOverview` sets `maxInstances: 1` but leaves `concurrency` at its default. In firebase-functions 7.4 that default is **80 when `cpu ≥ 1`**, and `cpu` defaults to 1 for ≤ 2 GB (`v2/options.d.ts`).
  - **Effect:** a run that exceeds 60 seconds (a full sweep plus a day rebuild) can overlap with the next run inside the same instance. The generation guard keeps the result correct, but the overlapping runs duplicate reads (two sweeps, or two rebuilds of the same day).
  - **Suggested fix:** add `concurrency: 1` to the overview and daily schedules.
- **WARNING 3.3: an "unchanged" result does not advance `computedAtMs`** (avoiding writes is intentional). The guard therefore compares against the last *changing* write, not the last computation. This is covered by the same convergence argument as 3.1.

## 4. Per-line and overview aggregation consistency

- **PASS: the same formulas everywhere.**
  - Per-line, today's day doc, the overview KPIs and past days all go through `computeShiftFigures`.
  - That function uses `dedupeSlotRecords`, `efficiencyOf`, `counterQuality` and `collectDowntimeIntervals`.
  - Totals re-use the same helpers through pseudo-records.
  - **Covered by a test:** "summing lines equals the helpers over the union of their records" proves the per-line sums equal the helpers over the union of the records.
- **PASS:** KPIs come from `today.shifts[currentShift]`, which is the sum of the line docs' `day` blocks for the dashboard date. Line docs still on an earlier date are excluded from the sum and recomputed in the same run.
- **PASS:** running-stop minutes are never stored in closed downtime. The TV adds `now − startMs`, and the overview's reason list adds them up to `generatedAtMs`. There is no double count (tested).
- **WARNING 4.1: not one atomic snapshot.** The overview sums line docs that were computed at different moments; it is not a single consistent snapshot of the sources. `freshness.oldestLineComputedAtMs` and `staleLineDocs` expose this. A line affected by a lost event can lag up to 15 minutes (sweep interval).
- **WARNING 4.2: two record-selection paths.** Today's line docs query `productionRecords` by `lineId` + `productionDate` equality, while past days use the legacy-aware reader (productionDate + `createdAt` window). Records without `productionDate` are therefore counted for past days but not for today. The current app always writes `productionDate`, so the impact is expected to be nil.
- **WARNING 4.3: `lineCount` means different things.** In live day docs it counts all Assembly line docs (including idle lines); in rebuilt days it counts lines with any data that day. It is cosmetic and not shown by the TV, but should be documented or aligned.

## 5. Daily finalisation and historical days

- **PASS: the production day follows the app's rules.**
  - Dates use `productionDayKeyFor` with the 06:30 Asia/Kolkata cutover.
  - The daily job (06:45) rebuilds `addDaysToKey(today, −1)`.
  - Overnight Shift B keeps its pinned date (tested).
- **PASS: days are only finalised from complete data.**
  - **Final rule:** a past day is `final` only when it is before today *and* no Assembly session of that date is still open. A shift running past the cutover keeps the day non-final, and it is re-checked every 10 minutes.
  - **Protection:** live line sums can never overwrite a final day (`protectFinal`). Only a full rebuild from sources may.
  - **Late edits:** an edit to a day inside the 7-day window sets `dirty`, which forces a rebuild. The flag is cleared only by a rebuild that started after it was set (tested).
- **PASS: no invented data.** Missing days are `available: false` until they are built from real sources: one per minute, newest first, all 7 within about 7 minutes.
- **WARNING 5.1: limits of the past-day rebuild.**
  - **Workshop scope:** a rebuild reads every workshop's records for that day through the existing reader, which throws `DataLimitError` above 20,000 docs per query.
  - **Dirty-flag churn:** while a session from yesterday is still open and changing, every relevant change marks yesterday dirty, so it is rebuilt every minute (about one day of reads per minute).
  - **Old days:** days older than the 7-day window are never maintained, by design.

## 6. Error handling and retries

- **BLOCKER 6.1: one failure stops the whole overview.**
  - **Line failures:** `runOverview` recomputes lines in batches with `Promise.all` and has **no per-line `try/catch`**. One line that throws aborts the whole run. Causes include a malformed legacy document, a query rejected because indexing is exempted, or a transient read error.
  - **Day failures:** a failing `rebuildDay` (for example `DataLimitError`, or a missing index) also aborts the run.
  - **Effect:** today's day doc and the overview are not updated. If the failure is persistent, the TV freezes on stale data until someone intervenes. Freshness would show it, but nothing would heal it.
  - **Fix (code change, approval needed):**
    1. Wrap each `recomputeLine` and `rebuildDay` call in `runOverview` in its own `try/catch`.
    2. Log the failure and record it in `freshness` (e.g. `failedLines`, `failedDays`).
    3. Still commit today's day doc and the overview.
    4. Add a unit test with a source that throws for one line.
- **WARNING 6.2: trigger failures are swallowed.** Trigger errors are caught and logged, not rethrown, and retries are off. A failed event is repaired only by the next event for that line or the 15-minute sweep. This is acceptable, but add a log-based alert on `[tvDashboard] … failed` and on the overview's error logs.
- **WARNING 6.3: event bursts are throttled.** With `maxInstances: 10` × concurrency 80, bursts (shift-end Finalize across many lines) are absorbed, but events beyond capacity are delayed by platform back-off. The scheduled functions use `retryCount: 0` (overview; the next minute retries naturally) and `retryCount: 2` (daily). PASS for the schedules.

## 7. Sensitive fields — **PASS**

- **Line docs:**
  - **Allowed fields:** `schemaVersion, lineId, lineName, plant, workshop, division, registered, status, awaitingEntryFromMs, model, current, activeStop, day` plus `contentHash, computedAtMs, updatedAtMs`.
  - **Nested values:** `current` and `day` contain only numbers, dates, shift codes and sanitised reason keys/labels.
- **Day and overview docs:** numeric figures, dates, plant names and sanitised reasons only.
- **Stop reasons:** limited to the fixed Stop-picker list. Anything else becomes `other`, so free text such as a typed name cannot pass through.
- **Never read into output:** `supervisor*`, `sessionSupervisor`, `createdBy`, `operators`, `updatedBy`, `contributorUids`, `endedBy` (including email), `deviceId`, `lossReason*`, `remarks`, `syncConflicts`, `deletedSlotBackups`.
- **Test evidence:** the sanitisation test seeds names, employee codes, UIDs, a device ID, an email and private notes into sessions, records and ended archives. It asserts that none of them appears in any line, day or overview document, and that line docs carry exactly the allow-listed fields.
- **Logs:** they contain line IDs, decisions, dates and error messages only.

## 8. Untracked `src/utils/supervisorHandover.ts` (not committed — inspected only)

| Item | Finding |
|---|---|
| Git status | **Untracked**; absent from HEAD. 318 lines, last modified 2026-10-28. |
| Imports | `./lineEfficiency` (`EfficiencyRecord`, `efficiencyOf`, `recordsForSession`), `./productionSchedule` (`ShiftCode`, `TimeInterval`, `buildSlots`), `./productionDay` (`isProductionDayKey`, `millisToProductionDayMinute`, `resolveSessionProductionDate`, `timestampToMillis`). All committed, pure, no React/Firebase. |
| Exports (20) | Session parsing (`parseRunningSession`), slot entry states (`slotEntryStatuses`, `sessionNowAbs`), running-line cards (`buildRunningLineCards`, `currentModel`, status labels/colours), handover helpers (`isHandover`, `recorderIdentity`, `syncAttributionFields`, `isSupervisorsSession`, `splitCreateOnlyFields`). |
| Used by the TV backend | `parseRunningSession`, `currentModel`, `slotEntryStatuses`, `sessionNowAbs` (core.ts, service.ts); the test also uses `buildRunningLineCards` as the reference for awaiting-entry. |
| Other importers (working tree) | `RecordProductionScreen.tsx` (modified), `SupervisorOverviewScreen.tsx` (modified), `RunningLinesScreen.tsx` (untracked), `scripts/testSupervisorHandover.ts` (untracked). It belongs to a larger uncommitted "Running Lines / supervisor handover" feature. |
| Tests | `scripts/testSupervisorHandover.ts`: 33 passed (Phase 3). |

- **BLOCKER 8.1: the deploy would bundle uncommitted code.**
  - **What gets deployed:** whatever `supervisorHandover.ts` contains in the working tree at deploy time, because `build.mjs` bundles from the working tree.
  - **Reproducibility:** a deploy from any other checkout (CI, another PC) **fails to build**, because the module is not in git.
  - **Behaviour drift:** while the feature is unfinished, changes to `parseRunningSession` / `currentModel` / `slotEntryStatuses` (status rules, session parsing) silently change the TV's live status, model and awaiting-entry figures. Losing the file breaks the backend.
  - **Required:** the owner commits this file (the review did not). Ideally commit it together with its feature, or at least commit it in a reviewed state before deploying.

## 9. Firestore database region

- **BLOCKER 9.1: the Firestore database location cannot be established from local configuration.**
  - **Evidence checked:** `.firebaserc` (project only), `firebase.json` (no `firestore` section, no region), `functions/src` (no `region` option anywhere), `src/services/firebase.ts` (`storageBucket: technico-industries-ltd.firebasestorage.app`, which does not encode a location), and a repo-wide search of non-secret files for `nam5|eur3|us-central|asia-south|europe-west|region|locationId`.
  - **Functions region evidence:** `prodPulseAI` is deployed in **`us-central1`**. The client hard-codes `https://us-central1-${projectId}.cloudfunctions.net/prodPulseAI` (`src/services/prodPulseAI.ts:31-33`) and uses `getFunctions(app)` with the default region.
  - **Risk:** the new functions also default to `us-central1`. 2nd-gen Firestore triggers must be deployable for the database's location. If the database is, for example, in `asia-south1`, the trigger deploy will be rejected or need an explicit matching `region`.
  - **Not harmful:** a rejected deploy does no damage, but this must be confirmed first.
  - **How to confirm (read-only, run by the owner):**
    - Firebase Console → Firestore Database → (default) → *Location*, or
    - `npx firebase-tools firestore:databases:get "(default)" --project technico-industries-ltd`.
  - **If it is not `nam5` / `us-central1`:** add `region: '<compatible region>'` to `TRIGGER_OPTIONS` (and preferably to the schedules) in `tvDashboard/functions.ts`. Re-run the tests and the build.

## 10. TV authentication alternatives

The proposal lists: (A) dedicated TV account with a custom claim, (B) Anonymous Auth + App Check, (C) any signed-in user, and the default `allow read: if true`.

- **BLOCKER 10.1 (TV go-live, not function deploy): no access model chosen, rules not exported.**
  - **Effect today:** without a published rule for `tvDashboard/**`, the TV cannot read the aggregates. The functions can be deployed and verified in the Console without it.
  - **Status:** the current Console rules are still unexported and unreviewed.
- **WARNING 10.2: option B is mis-described in the proposal.**
  - **Why:** App Check enforcement for Cloud Firestore is a **project-wide, per-service switch**; it cannot be enabled for `tvDashboard` only. Enabling it would reject the ProdPulse mobile and web apps unless they also integrate App Check.
  - **Fix:** remove B from the proposal or rewrite it.
- **WARNING 10.3: a signed-in TV account inherits whatever "signed-in" grants today.**
  - **Why:** the app reads `activeSessions`, `productionLines` and `productionRecords` as an ordinary signed-in user. If the existing rules are `request.auth != null`, a TV account (option A or C) could also read **raw production data, including personal fields**.

**Recommended least-privilege design (option A, hardened):**
1. **Create a dedicated Firebase Auth user** for the TV (e.g. `tv-assembly@…`), with **no `users/{uid}` profile**, so the app grants it no role. Set a custom claim `tvDashboard: true` once with an admin-run Admin SDK script.
2. **Rule** (additive):
   ```
   match /tvDashboard/{document=**} {
     allow read: if request.auth != null && request.auth.token.tvDashboard == true;
     allow write: if false;
   }
   ```
3. **Make sure that account can read nothing else.** Review the exported rules. If production collections allow any signed-in user, add `&& request.auth.token.tvDashboard != true` to those reads, or (better) require a real role from `users/{uid}`. **This modifies existing rules** and needs explicit approval and testing in the Rules Playground.
4. **Sign the TV in once** (custom token from an admin-only script, or email/password entered at setup). The SDK keeps the refresh token in browser storage. To revoke: disable the user or `revokeRefreshTokens(uid)`.
5. **Do not grant write access anywhere.** The functions write with the Admin SDK.

If the business accepts that aggregate performance data is world-readable, `allow read: if true` remains the simplest. It holds no credential on the TV, but it **exposes the data to anyone with the project ID**, which is not least-privilege.

## 11. Deployment and rollback commands in `TV_DASHBOARD_BACKEND_IMPLEMENTATION.md`

- **PASS:** the deploy filter lists exactly the 7 exported names: `functions:tvDashboardOnActiveSession,…,functions:tvDashboardDaily`. The `--only functions:<name>,…` syntax is valid with the single `default` codebase. `firebase.json` predeploy (`npm --prefix "$RESOURCE_DIR" run build`) rebuilds `functions/lib/index.js` (git-ignored) before upload.
- **PASS:** the rollback `firebase functions:delete <7 names> --project technico-industries-ltd` is valid and also removes the Cloud Scheduler jobs. It asks for confirmation unless `--force` is given.
- **WARNING 11.1: the CLI is not installed locally.** `firebase-tools` is in neither `node_modules` nor `package.json`, so a bare `firebase` command may not exist on this machine. The repo's README uses `npx firebase …`. Use:
  ```bash
  npx firebase-tools deploy --project technico-industries-ltd --only functions:tvDashboardOnActiveSession,functions:tvDashboardOnProductionRecord,functions:tvDashboardOnShiftSummary,functions:tvDashboardOnEndedSession,functions:tvDashboardOnProductionLine,functions:tvDashboardOverview,functions:tvDashboardDaily
  ```
- **WARNING 11.2: deploy prompts.**
  - **Parameters:** the CLI resolves the codebase's parameters (`GEMINI_MODEL`, a `defineString` with a default) and may prompt. Keep the existing value; per the README, answer with a model ID, never the key.
  - **APIs:** the first deploy of Firestore triggers and schedules may ask to enable Eventarc, Pub/Sub and Cloud Scheduler.
  - **Timezone override:** the schedules hard-code `Asia/Kolkata`, but date logic honours a `PRODUCTION_TIMEZONE` override. Confirm `functions/.env.technico-industries-ltd` does not override it (this review did not open it).
- **WARNING 11.3: the rollback leaves the read model behind.** It omits read-model cleanup. Add the optional, destructive-to-the-read-model-only command:
  ```bash
  npx firebase-tools firestore:delete tvDashboard/assembly --recursive --project technico-industries-ltd
  ```
  Also prefer `npx firebase-tools functions:delete …` over a bare `firebase`.
- **Note:** `"every 1 minutes"` is App Engine cron syntax, which Cloud Scheduler accepts. `"* * * * *"` is the unambiguous equivalent if you prefer it.

## 12. `prodPulseAI` is not replaced or altered — **PASS** (with one WARNING)

- **PASS: the source change is additive.** The only change to existing code is 3 appended lines in `functions/src/index.ts` (`git diff`: +3/−0).
- **PASS: the endpoint is identical.** `prodPulseAI`'s built deploy endpoint (`__endpoint`) is identical to the existing `functions/lib` build.
- **PASS: a scoped deploy leaves it alone.** A deploy restricted with `--only functions:tvDashboard…` creates or updates only those 7 services. `prodPulseAI`'s Cloud Run service, secret binding (`GEMINI_API_KEY`) and configuration are not redeployed or touched.
- **Note: shared bundle.** The new functions share the bundle with `prodPulseAI`. The next time `prodPulseAI` is deployed it also loads the TV module at cold start, which defines functions only (Firestore is initialised lazily), so the overhead is minimal.
- **WARNING 12.1: an unscoped deploy would push uncommitted `prodPulseAI` changes.** `prodPulseAI` bundles `src/utils/prodPulseAI.ts`, which has **uncommitted modifications**. Running `firebase deploy`, `--only functions`, or `npm run deploy` would redeploy `prodPulseAI` with those changes. Always use the scoped command in 11.1.

---

## 13. Outstanding actions before deployment

**Must do (blockers):**
1. **Isolate failures in `runOverview` (BLOCKER 6.1).** Per-line and per-day `try/catch`, failures recorded in `freshness`, plus a unit test. This is a code change in `functions/src/tvDashboard/service.ts` and needs your approval.
2. **Commit `src/utils/supervisorHandover.ts` in a reviewed state (BLOCKER 8.1),** ideally with its feature files. The owner does this; this review did not commit anything.
3. **Confirm the Firestore database location (BLOCKER 9.1)** using the Console or `npx firebase-tools firestore:databases:get "(default)" --project technico-industries-ltd`. If it is not `nam5`/`us-central1`, set a matching `region` in `tvDashboard/functions.ts` (code change, approval needed), then re-run the tests and build.

**Should do (recommended before deploy):**

4. **Add `concurrency: 1`** to `tvDashboardOverview` and `tvDashboardDaily` (WARNING 3.2).
5. **Exit early for non-Assembly lines** in `recomputeLine`, and narrow the sweep to Assembly sessions (WARNING 2.2).
6. **Confirm the `functions/.env.technico-industries-ltd` values,** checked by the owner: no `PRODUCTION_TIMEZONE` override (or `Asia/Kolkata`), and `GEMINI_MODEL` set so the deploy doesn't prompt (WARNING 11.2).
7. **Update `TV_DASHBOARD_BACKEND_IMPLEMENTATION.md`:** use `npx firebase-tools`, add the read-model cleanup command, and link this review (WARNINGS 11.1, 11.3).

**Before TV go-live:**

8. **Export the current Console rules** and choose the access model. Recommended: the dedicated TV account with a `tvDashboard` claim (§10).
9. **Correct option B in `TV_DASHBOARD_FIRESTORE_RULES_PROPOSAL.txt`** (WARNING 10.2).
10. **Verify the TV identity cannot read production collections** (WARNING 10.3). Any change to existing rules needs explicit approval.
11. **Publish only the reviewed `tvDashboard` rule.**

**At deploy time:**

12. **Use only the scoped command (§11.1).** Never run an unscoped deploy while `src/utils/prodPulseAI.ts` is uncommitted (WARNING 12.1).
13. **After deploying:**
    1. Watch the `[tvDashboard]` logs.
    2. Confirm `tvDashboard/assembly.freshness.generatedAtMs` advances every minute.
    3. Confirm all 7 `weeklyTrend` days become `available` within about 10 minutes.
    4. Add log-based alerts for trigger and overview failures (WARNING 6.2).
14. **Then** switch the TV app's `useDashboardData` to the aggregate documents.

**Rollback (prepared, not run):**

```bash
npx firebase-tools functions:delete tvDashboardOnActiveSession tvDashboardOnProductionRecord tvDashboardOnShiftSummary tvDashboardOnEndedSession tvDashboardOnProductionLine tvDashboardOverview tvDashboardDaily --project technico-industries-ltd
```

Optionally, remove the read model too (affects `tvDashboard/**` only):

```bash
npx firebase-tools firestore:delete tvDashboard/assembly --recursive --project technico-industries-ltd
```
