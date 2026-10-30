# ProdPulse Assembly TV Dashboard — Backend Implementation (Phase 3)

| | |
|---|---|
| **Date** | 2026-10-30 |
| **Code location** | ProdPulse repo `C:\Users\prate\Technico Management\technico-management` → `functions/src/tvDashboard/` |
| **Status** | Implemented, built and unit-tested locally. Approved pre-deploy fixes applied (see below). **Not deployed. No rules changed. No Firestore reads or writes against the live project.** |
| **Builds on** | `PRODPULSE_BACKEND_INTEGRATION_AUDIT.md` (this workspace) |
| **Pre-deploy review** | `TV_DASHBOARD_PREDEPLOY_REVIEW.md` (this workspace). Read it before deploying: it lists the remaining blockers and the outstanding actions (§13). |

### Changes after the pre-deploy review (2026-10-30)

| Review item | Change |
|---|---|
| BLOCKER 6.1: one failure stopped the overview | `runOverview` attempts every line recompute and every day rebuild on its own. A failure is logged (`[tvDashboard] line recompute failed` / `day rebuild failed` / `day commit failed` / `sweep listing failed`) and listed in `freshness.failedLines` / `failedDays` (plus `sweepFailed`, `complete`). The overview, today's day doc and all other lines/days are still written. A failed line keeps its last good doc (or has none); a failed day shows as `available: false`. Neither is ever reported as zero. A day that keeps failing no longer starves the others: after a failure the next due day is tried (≤ 2 attempts, ≤ 1 rebuild per run). Trigger handling (`handleSourceWrite`) also isolates "mark dirty" from each line recompute. |
| WARNING 3.2: overlapping schedule runs | `concurrency: 1` on `tvDashboardOverview` and `tvDashboardDaily`. |
| WARNING 2.2: reads for other workshops | `recomputeLine` decides scope from the line doc (legacy aliases included) and then the session copy (new `workshopScope` in `core.ts`, same precedence as `computeLineDoc`). Another workshop costs one read (two when the line doc has no workshop), plus the guarded removal of any stale read-model doc. A line whose workshop is unknown is never excluded early: the record/summary copies still decide. The 15-minute sweep now skips lines and sessions of other workshops. |
| WARNINGS 11.1 / 11.3: commands | Commands below use `npx firebase-tools`; the optional read-model cleanup is added (destructive to the read model only). |
| BLOCKER 9.1: Firestore location unknown | **Resolved.** The owner confirmed `(default)` is Firestore Native, Standard edition, in **`asia-south1`**. All seven TV dashboard functions now set `region: 'asia-south1'` (see §3). `prodPulseAI` is unchanged and stays in `us-central1`. |

Still open from the review:
- blocker 8.1 (commit `supervisorHandover.ts`);
- blocker 10.1 (TV access model/rules before go-live);
- confirming there is no `PRODUCTION_TIMEZONE` override (§8);
- the warnings it lists.

---

## 1. Files

**New (ProdPulse repo):**

| File | Purpose |
|---|---|
| `functions/src/tvDashboard/core.ts` | Pure logic: Assembly scope, line metadata, per-line/day/overview computation (through the app's helpers), sanitising, change detection, stale-write guard, trigger impact |
| `functions/src/tvDashboard/store.ts` | `TvSources` (read-only source access) and `TvStore` (read-model persistence) interfaces, their Firestore implementations, and the pure `plan*Commit` rules both stores apply |
| `functions/src/tvDashboard/service.ts` | Orchestration: `recomputeLine`, `handleSourceWrite`, `rebuildDay`, `finalizePreviousDay`, `runOverview` |
| `functions/src/tvDashboard/functions.ts` | Cloud Functions v2 definitions (5 Firestore triggers, 2 schedules) |
| `functions/test/tvDashboard.test.ts` | 41 unit tests, with Firebase fully mocked (incl. failure injection and per-call read logging) |

**Changed (ProdPulse repo), additive only:** `functions/src/index.ts`, +3 lines at the end:
```ts
// Assembly TV dashboard read model (tvDashboard/assembly…) — additive, see
// tvDashboard/functions.ts. Does not change prodPulseAI.
export * from './tvDashboard/functions';
```

**New (this workspace):** this document and `TV_DASHBOARD_FIRESTORE_RULES_PROPOSAL.txt`.

**Not changed:**
- `prodPulseAI` and its options;
- `functions/package.json`, `build.mjs`, `tsconfig.json`, `firebase.json`;
- any `src/utils` helper, screen, constant or existing test;
- Firestore rules;
- the pre-existing uncommitted files in the repo.

---

## 2. Architecture

```
 source writes (app)                      Cloud Functions                         read model (public, sanitised)
 ───────────────────                      ───────────────                         ──────────────────────────────
 activeSessions/{lineId}     ─┐
 productionRecords/{id}      ─┤  onDocumentWritten ─► handleSourceWrite ─► recomputeLine ─► tvDashboard/assembly/lines/{lineId}
 shiftSummaries/{id}         ─┤   (5 triggers)          (impact filter)     (one line,          (write only if changed,
 endedSessions/{id}          ─┤                                              from source)         never older over newer)
 productionLines/{lineId}    ─┘                    └─► markDaysDirty ────────────────────────► tvDashboard/assembly/days/{date}.dirty

 every 1 min (Asia/Kolkata) ─► runOverview: lines rolled to a new date (full sweep every 15 min)
                                ─► today's day doc  = Σ line docs        ─► tvDashboard/assembly/days/{today}
                                ─► ≤1 past day rebuilt from all sources  ─► tvDashboard/assembly/days/{date} (final)
                                ─► overview                              ─► tvDashboard/assembly
 06:45 daily (Asia/Kolkata)  ─► finalizePreviousDay: rebuild the date that ended at 06:30
```

- **The TV reads only `tvDashboard/**`.** It never touches production collections.
- **Source collections are only read.** No transaction touches them, so the app's writes are never blocked or retried because of the dashboard.
- **Every read-model write is a transaction on the read-model doc,** decided by a pure plan function. These are covered by unit tests:
  - **Stale guard:** each computation records `computedAtMs`, taken *before* its source reads. A doc written by a computation that started later is never overwritten. Firestore reads are strongly consistent, so the later computation saw data at least as new.
  - **Unchanged = no write:** a SHA-256 hash of the sanitised content is stored. Identical content is not rewritten.
  - **Final days are protected:** a finalised day doc is never replaced by live line sums; only a full rebuild from sources may replace it.
  - **Dirty flags:** the flag is cleared only by a rebuild that started after it was set.
- **Recompute, never increment.** Triggers are at-least-once and unordered, so every event re-derives the affected line from source (idempotent).

---

## 3. Functions

| Export | Trigger | Options | Does |
|---|---|---|---|
| `tvDashboardOnActiveSession` | `activeSessions/{lineId}` written | 256 MiB, 60 s, maxInstances 10 | Recomputes the line, **only if a TV-relevant field changed** (`sessionProjection`). Typing unsaved quantities, rejections or operators, and sync metadata, causes **no** recompute. |
| `tvDashboardOnProductionRecord` | `productionRecords/{recordId}` | same | Recomputes the record's line; marks the day dirty if it is a past date inside the 7-day window |
| `tvDashboardOnShiftSummary` | `shiftSummaries/{summaryId}` | same | same |
| `tvDashboardOnEndedSession` | `endedSessions/{sessionId}` | same | same |
| `tvDashboardOnProductionLine` | `productionLines/{lineId}` | same | Recomputes on rename, move or delete |
| `tvDashboardOverview` | schedule `every 1 minutes`, `Asia/Kolkata` | 512 MiB, 240 s, maxInstances 1, **concurrency 1**, retries 0 | Overview + today's day doc + ≤1 past day; full line sweep every 15 min (Assembly / unscopable lines only); each line and day isolated |
| `tvDashboardDaily` | schedule `45 6 * * *`, `Asia/Kolkata` | 512 MiB, 300 s, maxInstances 1, **concurrency 1**, retries 2 | Rebuilds the production date that ended at the 06:30 cutover |

- **Early exit for other workshops:** every trigger reads the line doc first. A line of another workshop exits after 1–2 reads, without session, record, summary or ended-session reads.
- **Trigger errors are logged, not rethrown.** Within one event, each affected line and the dirty-day marking are attempted independently and failures are logged with the `[tvDashboard]` prefix. The trigger then logs the event as failed. Trigger retries are off by default, and the 15-minute sweep re-derives every line anyway.
- **Overview job isolation:** a failing line, day or sweep listing never prevents the overview from being written. See `freshness.failedLines`, `failedDays`, `sweepFailed`, `complete`.
- **Region: `asia-south1` for all seven TV dashboard functions.** This is the location of the `(default)` Firestore database (Firestore Native, Standard edition, confirmed by the owner).
  - **Where it is set:** in `functions/src/tvDashboard/functions.ts`, a module-local `TV_REGION = 'asia-south1'` is applied to `TRIGGER_OPTIONS` (the five Firestore triggers) and to both schedules (`tvDashboardOverview`, `tvDashboardDaily`). The schedules' Cloud Scheduler jobs are created in the same region.
  - **What this gives you:** the triggers run where their Firestore events originate, and every read and write of the functions stays in-region.
  - **`prodPulseAI` is not affected.** The region is set per function, **not** through `setGlobalOptions`, so `prodPulseAI` keeps its own default region, **`us-central1`**. The app's client calls it at `https://us-central1-<project>.cloudfunctions.net/prodPulseAI`.
  - **Verified:** the built bundle reports `region: ["asia-south1"]` for the 7 TV functions, and no region for `prodPulseAI`.
- **Timezone:**
  - `functions.ts` imports `../timezone` first, and `index.ts` already imports it before everything, so `productionDayKeyFor` uses Asia/Kolkata.
  - The schedules use `DEFAULT_PRODUCTION_TIMEZONE` (`Asia/Kolkata`). If `PRODUCTION_TIMEZONE` is ever overridden in `functions/.env`, update the schedules to match.

---

## 4. Business logic (all through existing helpers)

| Figure | Implementation | Helper(s) reused |
|---|---|---|
| Assembly scope | Resolved workshop `.toLowerCase().includes('assembly')`; Bawal 1 and Bawal 2 both included | mirrors `isAssemblyWorkshop` in the app's screens (not exported from a util) |
| Line metadata | `productionLines` first (legacy aliases `location/shop/unit/lineNumber/name/models/partsList/partName`), copies on session/records/summaries fill gaps | rule of `modelPartProduction.resolveLineFields`; aliases mirror the screens' readers |
| One record per slot | Per line + production date + shift | `lineEfficiency.dedupeSlotRecords`, `modelPartProduction.mapProductionRecord`, `dayKeyOf` |
| Good production / plan-to-date / achievement | Σ `producedThisSlot` / Σ `expectedParts` of saved slots; round1; `null` without plan | `lineEfficiency.efficiencyOf` |
| Rejections | Σ `productionRecords.rejections` (legacy records add 0, as `buildRunningLineCards` sums them). **`rejectionRecords` never read** (no source method exists) | — |
| Quality % / rejection % | Legacy records (no counter) excluded; only-legacy → `null` | `qualityMetrics.counterQuality` |
| Totals across lines | Each line's sums passed back through `efficiencyOf` / `counterQuality` / `downtimeByReason` as pseudo-records. A test proves this equals the helpers over the union of all records | same helpers |
| Downtime | Per line + date + shift from live session, ended archives, shift summaries and record shares, each stop ID once; closed vs running split | `downtime.collectDowntimeIntervals`, `totalDowntimeMinutes`, `downtimeByReason`, `sessionSourceFromDoc`, `summarySourceFromDoc`, `lineDowntimeSummary`, `stopDurationMinutes` |
| Active stop | `startMs` published; the TV adds `now − startMs` | `lineDowntimeSummary`, `lineEfficiency.currentStop` |
| Stop reason | Fixed Stop-picker list (mirrored from `RecordProductionScreen` `STOP_REASONS`); anything else → `"other"` | `lineEfficiency.formatStopReason` |
| Current model | Latest started changeover's part, else starting part, else newest record | `supervisorHandover.currentModel` |
| Running / stopped / awaiting entry | `lineStopped` → stopped; `awaitingEntryFromMs` = end of earliest unsaved slot (a test proves it matches `buildRunningLineCards`) | `parseRunningSession`, `slotEntryStatuses`, `productionSchedule.buildSlots` |
| Production date | 06:30 cutover; sessions keep their pinned date (overnight Shift B); legacy records via `createdAt` | `productionDayKeyFor`, `resolveSessionProductionDate` (via `parseRunningSession`), `recordProductionDayKey`, `selectRecordsInProductionRange`, `legacyCreatedAtWindow` |

**Never used:**
- **For production:** `activeSessions.totalDowntimeMinutes`, `stopsSummaryBySlot`, `totalRejections`, `producedBySlot` (unsaved typed values), `shiftSummaries.plannedProductionTotal` and `actualProductionTotal`.
- **For downtime:** shift summaries contribute only through `collectDowntimeIntervals`.

**Plan fields:** the line doc's `current.shiftPlan` is `activeSessions.plannedProductionTotal` (the **full-shift** plan), labelled separately from `planToDate`.

**Dashboard shift context (display rule, not a production formula):** from the 06:30 cutover until 19:00 the overview shows Shift A; from 19:00 until the next cutover it shows Shift B. Between shifts the TV therefore keeps showing the shift that just ran. Every figure still belongs to the date and shift stored on its source documents.

---

## 5. Data schema

All docs carry `schemaVersion: 1`. Line and day docs also carry `contentHash`, `computedAtMs` and `updatedAtMs`; the overview carries `contentHash`, `generatedAtMs` and `freshness`. All times are epoch ms.

**`ShiftFigures`** (used throughout):
```js
{ recordCount, goodProduction, planToDate, achievementPct /* null = no plan */,
  rejections, quality: { goodParts, rejectedParts, countedRecords, legacyRecords },
  qualityPct, rejectionPct /* null = unknown */,
  downtimeClosedMinutes, downtimeByReason: [{ reason, label, minutes }] }
```

### `tvDashboard/assembly/lines/{lineId}`
```js
{ schemaVersion, lineId, lineName, plant, workshop, division, registered,
  status: 'running' | 'stopped' | 'idle',
  awaitingEntryFromMs,        // running line is "awaiting entry" from this instant (null = none)
  model,                      // current part/model name
  current: { productionDate, shift, shiftPlan /* full-shift plan or null */, sessionStale, figures: ShiftFigures },
  activeStop: { startMs, reason, label } | null,
  day: { productionDate /* dashboard date */, shifts: { A: ShiftFigures, B: ShiftFigures } },
  contentHash, computedAtMs, updatedAtMs }
```
- **Display status:** `stopped` > (`running` and `now ≥ awaitingEntryFromMs` → `awaiting_entry`) > `running` > `idle`.
- **Unregistered lines:** a line removed from `productionLines` is kept (`registered: false`) while it has a live session or records on the dashboard date. Otherwise its doc is deleted.

### `tvDashboard/assembly/days/{productionDate}`
```js
{ schemaVersion, productionDate, final, source: 'lines' | 'sources', lineCount,
  shifts: { A: ShiftFigures, B: ShiftFigures }, totals: ShiftFigures,
  dirty, dirtyAtMs, contentHash, computedAtMs, updatedAtMs }
```
- **Today:** `source: 'lines'`, never final.
- **Past dates:** rebuilt from **all** sources (including legacy records via the `createdAt` window), `source: 'sources'`. They are `final` once no Assembly session of that date is still open.
- **Late edits:** a source write on a past date inside the window sets `dirty`, and the date is rebuilt.

### `tvDashboard/assembly` (overview)
```js
{ schemaVersion, scope: { workshopMatch: 'assembly', plants: ['Bawal 1','Bawal 2'] },
  productionDate, currentShift, operationalState: 'production' | 'no_active_sessions',
  kpis: { productionDate, shift, goodProduction, planToDate, achievementPct, rejections, qualityPct, rejectionPct,
          downtimeClosedMinutes, activeStops: [{ lineId, startMs, reason, label }] },
  lineCounts: { total, running, stopped, idle, awaitingEntry },
  weeklyTrend: [{ productionDate, available, final, goodProduction, planToDate, achievementPct, rejections, qualityPct }],  // 7 previous days
  shiftComparison: { productionDate, A: ShiftFigures, B: ShiftFigures },   // today
  downtimeReasons: [{ reason, label, minutes }],                           // current shift, running stops up to generatedAt
  contentHash, generatedAtMs,
  freshness: { generatedAtMs, heartbeatMs,
               complete,            // false if any line / day / the sweep listing failed this run
               lineDocCount, linesRecomputed /* successful */, failedLines /* line ids */,
               daysRebuilt, failedDays /* dates, shown as unavailable */, sweepFailed,
               staleLineDocs, oldestLineComputedAtMs, newestLineUpdatedAtMs } }
```
- **What the TV should show on failure:** when `freshness.complete` is false, show "data partially updated". The figures still exclude the failed lines and days rather than counting them as zero.
- **Write cadence:** the overview is written when its content changes, or at least every 5 minutes (heartbeat).
- **Staleness:** the TV should treat `generatedAtMs` older than ~6 minutes as stale.
- **Missing days are never invented:** a day without a doc is `available: false`. Days are back-filled from sources at one per minute, newest first, so all 7 exist within ~7 minutes of the first run.

### Sanitisation
- **No personal data:** a unit test seeds supervisor/operator names, codes, UIDs, emails, device IDs and private notes into every source, then asserts that none of them appear anywhere in the line, day or overview docs.
- **Fixed field set:** the same test asserts that line docs contain exactly the allow-listed fields (`LINE_DOC_FIELDS`).

---

## 6. Cost and volume (order of magnitude)

- **Per line recompute:** 2 doc reads, 1 records query (~10–40 docs), 2 summary gets, 1 ended-sessions query, and ≤1 transactional write, only if the content changed.
- **Triggers:** `activeSessions` events that only carry typing or sync metadata exit before any read. Writes on other workshops' lines cost 1–2 reads (early exit). Finalize bursts (~20 record writes) recompute the line ~20 times, each idempotent; most end as `unchanged`.
- **Overview job:**
  - every run: ~60 line-doc reads, 7 day-doc reads and ≤3 writes per minute;
  - every 15 minutes: a full sweep (all lines + sessions + per-line queries, roughly 2–3k reads);
  - when a day is rebuilt: about one day of records (~1–2k reads).
- **Estimate:** roughly 0.3–0.6 M reads/day at ~50 active lines. This is far below polling all records every minute (~2 M/day).

---

## 7. Security

- **Admin SDK:** the functions write with the Admin SDK, which bypasses rules. No rule change is needed for the backend itself.
- **TV access:** the TV needs **read** access to `tvDashboard/**` only. See `TV_DASHBOARD_FIRESTORE_RULES_PROPOSAL.txt`, an additive snippet that is **not applied**. It explains first exporting and reviewing the current Console rules, and what becomes public: aggregate factory performance data by line and model, but no personal data.
- **Production collections:** they must not be made readable for the TV.

---

## 8. Build, test, deploy

**Local checks (done, nothing deployed):**
```bash
cd technico-management/functions
npx tsc --noEmit -p tsconfig.json          # 0 errors (whole functions project)
npx tsx test/tvDashboard.test.ts           # 41 passed
npm test                                   # prodPulseAI 37 passed, cors 8 passed
cd .. && npm run test:production-day && npm run test:schedule && npm run test:shift-b-overnight \
  && npm run test:line-efficiency && npm run test:quality && npm run test:live-quality \
  && npm run test:downtime && npm run test:report-downtime && npm run test:model-part \
  && npm run test:supervisor-handover && npm run test:end-production   # all passed
```

**Build:**
- `npm --prefix functions run build`, which every `npx firebase-tools deploy` also runs as predeploy (`firebase.json`). It writes `functions/lib/index.js`.
- After the review fixes and the region change, the identical esbuild config was run into a scratch folder instead. It produced a 128.0 KB bundle exporting `prodPulseAI` plus the 7 `tvDashboard*` functions (8 exports, all Cloud Functions). The 7 TV functions show `region: ["asia-south1"]`; both schedules show `concurrency=1` and `timeZone: Asia/Kolkata`.
- The bundled `prodPulseAI` deploy endpoint is identical to the existing `functions/lib` build.

The Firebase CLI is **not** installed in this repo (`firebase-tools` is in neither `node_modules` nor `package.json`), so every command below uses `npx firebase-tools`.

**Deploy (when approved, not run):**
1. Resolve the remaining items in `TV_DASHBOARD_PREDEPLOY_REVIEW.md` §13:
   - **Firestore location: done.** It is `asia-south1`, and the functions are set to it (§3). To re-check (read-only):
     ```bash
     npx firebase-tools firestore:databases:get "(default)" --project technico-industries-ltd
     ```
   - **Commit `src/utils/supervisorHandover.ts`** (§9).
   - **Owner-confirmed values for `functions/.env.technico-industries-ltd`:**
     - `GEMINI_MODEL=gemini-3.5-flash-lite` is set.
     - `PRODPULSE_WEB_ORIGINS` includes `https://prodpulse-seven.vercel.app/`. The trailing slash is harmless: `cors.ts` strips it.
   - **Still to confirm:** that the file has **no `PRODUCTION_TIMEZONE`** entry, or that it is `Asia/Kolkata`. The schedules use `Asia/Kolkata`.
2. Deploy **only** the new functions. **Never** run an unscoped `deploy`, `--only functions` or `npm run deploy` while `src/utils/prodPulseAI.ts` has uncommitted changes. Those would redeploy `prodPulseAI`; this command does not touch it:
   ```bash
   npx firebase-tools deploy --project technico-industries-ltd --only functions:tvDashboardOnActiveSession,functions:tvDashboardOnProductionRecord,functions:tvDashboardOnShiftSummary,functions:tvDashboardOnEndedSession,functions:tvDashboardOnProductionLine,functions:tvDashboardOverview,functions:tvDashboardDaily
   ```
   - **APIs:** the first deploy may prompt to enable the Eventarc, Cloud Scheduler and Pub/Sub APIs.
   - **Parameters:** `GEMINI_MODEL` is already set in the project env file, so no parameter prompt is expected. If one appears, keep the existing model ID, never the key.
   - **Region:** the deploy plan should list the 7 functions in **`asia-south1`**, and must **not** list `prodPulseAI`. If it does, stop.
3. **Watch the logs** (`[tvDashboard] …`):
   - `tvDashboard/assembly.freshness.generatedAtMs` should advance every minute, with `complete: true`.
   - All 7 `weeklyTrend` days should become `available` within about 10 minutes.
   - Add log-based alerts on `[tvDashboard] … failed`.
4. **Only then** review and publish the rules addition, and switch the TV app's `useDashboardData` to `onSnapshot` on `tvDashboard/assembly` and `tvDashboard/assembly/lines`.

**Rollback:** removes the 7 functions and their Cloud Scheduler jobs. `prodPulseAI` and all production data are untouched.
```bash
npx firebase-tools functions:delete tvDashboardOnActiveSession tvDashboardOnProductionRecord tvDashboardOnShiftSummary tvDashboardOnEndedSession tvDashboardOnProductionLine tvDashboardOverview tvDashboardDaily --project technico-industries-ltd
```

**Optional read-model cleanup: ⚠️ DESTRUCTIVE to the dashboard read model.**
- **What it deletes:** `tvDashboard/assembly` and everything under it (all line docs, day docs and the overview) permanently.
- **What it does not touch:** production collections are not affected.
- **Effect:** the TV shows no data until the functions are redeployed and rebuild it (about 10 minutes for the overview and the 7-day trend).
- **Run it only deliberately, after rolling back:**

```bash
npx firebase-tools firestore:delete tvDashboard/assembly --recursive --project technico-industries-ltd
```

---

## 9. Dependencies on uncommitted code, audit differences, open items

**Uncommitted source relied upon:**
- **`src/utils/supervisorHandover.ts` is untracked.** It provides `parseRunningSession`, `currentModel`, `slotEntryStatuses` and `sessionNowAbs`. The esbuild bundle includes whatever is in the working tree at deploy time. It must be committed, and must not be changed incompatibly, before deploying. Its own test (`scripts/testSupervisorHandover.ts`, also untracked) passes.
- **All other helpers used are committed and unmodified:** `productionDay`, `productionSchedule`, `lineEfficiency`, `qualityMetrics`, `downtime`, `modelPartProduction`, `productionDraft`, and the functions `dataSource` and `timezone`.

**Audit vs source:**
- No conflict was found; the source was unchanged since the audit (verified by git snapshot).
- **Refinements made during implementation:**
  - "Awaiting entry" is time-based, so it is published as `awaitingEntryFromMs` instead of being rewritten every minute.
  - Per-line docs also carry the dashboard date's A/B shift figures, so today's day doc and the overview can be summed from ≤60 small docs instead of re-reading all records every minute.

**Mirrored constants (drift risk):**
- **`isAssemblyWorkshop`, the line-field aliases and `STOP_REASONS` exist only inside screens,** not in `src/utils`, so they are mirrored in `core.ts`. If the app changes them, update `core.ts`.
- **Why not move them:** moving them into a shared util would change canonical/app code, which needs approval.

**Open decisions (defaults implemented, easy to change):**
1. **Public read vs signed-in TV:** see the rules proposal.
2. **Live figures:** saved slots only, as in the app's live screens.
3. **Between shifts:** the overview shows the shift that just ran until 19:00 / 06:30.
4. **Weekly trend:** the 7 *previous* production days. Today is in `kpis` and `shiftComparison`.
5. **Plant scope:** one combined Assembly view with a per-line `plant`. Per-plant totals are not split out yet.
6. **Region:** see §3.

**Known limitations:**
- **Unattributable records:** records without a `lineId` can't be scoped and are skipped (counted internally).
- **Legacy sessions without a date:** a session with neither `productionDate` nor `startedAt` shows as running/stopped, but its figures can't be placed on a day.
- **Indexes:** the per-line queries use equality filters on two fields (`lineId`, `productionDate`), which Firestore serves by merging automatic single-field indexes. If those fields have been exempted from indexing, the function logs a "requires an index" error with a link to create one.
