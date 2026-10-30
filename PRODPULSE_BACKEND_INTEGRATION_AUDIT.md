# ProdPulse Backend Integration Audit — Assembly TV Dashboard (Phase 2)

| | |
|---|---|
| **Audit date** | 2026-10-30 |
| **Audited repository** | `C:\Users\prate\Technico Management\technico-management` (located from the parent directory) |
| **Git state at audit** | branch `main`, HEAD `5c458d0`, with **pre-existing** uncommitted changes (18 modified, 6 untracked files) — the audit read the working tree as it stands |
| **Method** | Read-only source inspection. No Firestore access, no Firebase CLI, no builds, tests or installs in that repository. Secrets (`functions/.env.*`, `functions/.secret.local`, `scripts/serviceAccountKey.json`, web API key values) were not read. |
| **Result** | No files in the ProdPulse repository were created, modified or deleted (verified with a before/after git snapshot — see §13). |

### How to read this document

- **[VERIFIED]**: read directly in source, with a file reference (`path:line`).
- **[RECOMMENDATION]**: a design proposal by this audit.
- **[UNKNOWN]** / **[ASSUMPTION]**: cannot be established from the repository. Needs confirmation.

> Note: an earlier, broader audit file `PRODPULSE_TV_DASHBOARD_AUDIT.md` already exists (untracked) in the
> ProdPulse repository root. This audit did not create or change it. Its security section (§7)
> agrees with the findings below; nothing in this document is taken from it without re-checking the source.

---

## 1. Files inspected

**Configuration / functions**
- `.firebaserc`, `firebase.json`, `package.json` (scripts only)
- `functions/package.json`, `functions/build.mjs`, `functions/tsconfig.json`
- `functions/src/index.ts`, `functions/src/options.ts`, `functions/src/timezone.ts`, `functions/src/dataSource.ts`
- `functions/README.md` (rules note only)
- `src/services/firebase.ts` (structure only, key values redacted)

**Shared calculation utilities (all in `src/utils/`)**
- `productionDay.ts`, `productionSchedule.ts`, `modelPartProduction.ts` (lines 1–300), `lineEfficiency.ts`,
  `qualityMetrics.ts`, `downtime.ts`, `supervisorHandover.ts`, `endProduction.ts`,
  `rejectionCount.ts`, `rejectionDate.ts`, `productionDraft.ts` (record ID + session state types)

**Writers / readers (targeted sections only)**
- `src/screens/RecordProductionScreen.tsx` — session create/sync, slot saves, Finalize, stops, breakdowns
- `src/screens/RegisterLineScreen.tsx`, `src/screens/ManageLinesScreen.tsx` — `productionLines`
- `src/screens/GenerateReportScreen.tsx`, `KPIAnalysisScreen.tsx`, `PlanVsActualRecordScreen.tsx`, `AdminOverviewScreen.tsx` — legacy field aliases, Assembly matching
- `src/screens/LineEfficiencyOverviewScreen.tsx`, `RunningLinesScreen.tsx`, `LiveQualityLinesScreen.tsx`, `DashboardScreen.tsx` — existing live listeners
- `src/services/productionRecordQueries.ts`, `src/services/downtimeSources.ts`
- `src/constants/lineOptions.ts`

---

## 2. Firebase project and Cloud Functions architecture

| Item | Finding | Ref |
|---|---|---|
| Project | `technico-industries-ltd` (single default project) | `.firebaserc` [VERIFIED] |
| Client SDK | Firebase JS SDK `^12.16.0`, Expo `~57.0.25`. Client uses Auth, Firestore, Functions | `package.json`, `src/services/firebase.ts` [VERIFIED] |
| Functions codebase | One codebase `default`, source `functions/`, runtime `nodejs22`, predeploy `npm --prefix functions run build` | `firebase.json` [VERIFIED] |
| Build | esbuild bundles `functions/src/index.ts` **together with the app's `../src/utils` and `../src/constants`** into `lib/index.js` ("so the backend runs exactly the production-date, de-duplication and metric code the app runs"). npm packages stay external. | `functions/build.mjs:1-17` [VERIFIED] |
| Dependencies | `firebase-admin ^14.5.0`, `firebase-functions ^7.4.0` (v2 API), `@google/genai` | `functions/package.json` [VERIFIED] |
| Deployed functions | **Exactly one:** `prodPulseAI` — an `onCall` (HTTPS callable) Gemini assistant. **No Firestore triggers, no scheduled functions, no aggregation, no dashboard read model.** | `functions/src/index.ts:33` [VERIFIED] |
| Callable options | CORS allow-list, 90 s timeout, 512 MiB, `maxInstances: 3`, `concurrency: 20`. **No `region` set** → default region. | `functions/src/options.ts` [VERIFIED] |
| Timezone | Backend pins `process.env.TZ` to `PRODUCTION_TIMEZONE` or **`Asia/Kolkata`** before any date maths (production dates are computed in local time). `index.ts` imports `./timezone` first. | `functions/src/timezone.ts`, `functions/src/index.ts:9` [VERIFIED] |
| Data access pattern | `dataSource.ts` is read-only, fixed collection names and query shapes. `productionRecords` are read by `productionDate` range **plus** a legacy `createdAt` window, merged with `selectRecordsInProductionRange`. Capped at 20,000 docs per query. | `functions/src/dataSource.ts:62-108` [VERIFIED] |
| Deploy script | `npm run deploy` = `firebase deploy --only functions:prodPulseAI` (deliberately scoped to one function). | `functions/package.json:13` [VERIFIED] |
| Firestore rules | **No `firestore.rules` file in the repository and no `firestore` section in `firebase.json`.** Rules are managed outside this repo (Firebase Console, presumably). | repo search, `firebase.json` [VERIFIED absence] |
| Firestore indexes | No `firestore.indexes.json`. The app's queries use single-field ranges/equalities only (comments say so explicitly). | `productionRecordQueries.ts:24-26` [VERIFIED] |
| Admin SDK and rules | "The Admin SDK bypasses Firestore Security Rules" | `functions/README.md:141` [VERIFIED] |

**Implication [RECOMMENDATION]:** a TV aggregation function fits the existing pattern exactly. Add it to the same
`functions/src/index.ts` codebase and import the shared `src/utils` helpers (bundled by esbuild). Never
re-implement the formulas.

---

## 3. Collection schemas (from the code that writes them)

All schemas below come from **writer code**. Firestore data itself was not queried, so older documents may
lack newer fields (the readers' defaults are noted).

### 3.1 `productionLines/{autoId}` — line master data

| Field | Type / values | Ref |
|---|---|---|
| `plant` | `'Bawal 1'` \| `'Bawal 2'` (picker) | `RegisterLineScreen.tsx:175-182`, `lineOptions.ts:1` |
| `workshop` | `'Assembly Shop'` \| `'Welding Shop'` \| `'Plating Shop'` \| `'Press Shop'` | `lineOptions.ts:2` |
| `division` | `'Side Door'`, `'S. Jack'`, `'RR Center'`, `'Break Pedal'`, `'Hood Hinge'`, `'Back Door'`, `'Non-MSIL'`, `'Count Cable'` (required on registration) | `lineOptions.ts:3`, `RegisterLineScreen.tsx:134` |
| `lineName` | trimmed string | |
| `parts[]` | `{ name: string, cycleTimeSeconds: number > 0 }`. **The array index is the "part index" used everywhere else.** | `RegisterLineScreen.tsx:157-159` |
| `createdBy`, `createdAt` / `updatedBy`, `updatedAt` | uid / server timestamp | |

- **Hard delete:** lines are removed with `deleteDoc` (`ManageLinesScreen.tsx:101`). There is no `active` flag. A deleted line can still appear in records and live sessions. [VERIFIED]
- **Legacy aliases** honoured by the app's readers [VERIFIED, `GenerateReportScreen.tsx:400-410`; same in 6 other screens]:
  `plant ← location`, `workshop ← shop`, `division ← unit`, `lineName ← lineNumber ← name`,
  `parts ← models ← partsList`, part `name ← partName`.

### 3.2 `activeSessions/{lineId}` — one live session per running line

Document ID = line ID. Created by **Start Production** (`RecordProductionScreen.tsx:2531-2567`) and updated by every
debounced sync (`sessionPayload`, `RecordProductionScreen.tsx:2005-2065`):

| Group | Fields |
|---|---|
| Identity / location | `lineId`, `lineName`, `plant`, `workshop`, `division` (copied from the line at start) |
| Shift | `shift` (`'A'`/`'B'`), `otHours`, **`productionDate`** (pinned at create, never in update payload), `productionStartMinutesAbs`, `productionStartedAt` |
| Plan | `plannedProductionTotal` = **full-shift plan** (`shiftPlannedTotal`, all visible slots × the selected part's cycle time, incl. OT) |
| Part | `selectedPartIndex` (index into `productionLines.parts`), `changeovers` (map by slot) |
| Slot inputs | `producedBySlot`, `producedSegment` (`'<slot>:before'/'<slot>:after'`), `rejectionsBySlot`, `lossReasonBySlot`, `savedSlotIndices`, `deletedSlotIndices`, `deletedSlotBackups` |
| Stops | `stopsBySlot: { [slot]: StopEvent[] }`, **`lineStopped`** (true if any stop is running), `stopsSummaryBySlot`, `totalDowntimeMinutes` (rounded to whole minutes at write time) |
| Rejections | `totalRejections` (Σ `rejectionsBySlot`, **includes unsaved slots**) |
| People (sensitive) | `supervisorName`, `supervisorCode`, `supervisorUid`, `operators[]` (`name`, `code`), `updatedBy {uid, deviceId, name}`, `contributorUids[]` |
| Sync | `sessionInstanceId`, `revision`, `syncConflicts`, `clientUpdatedAtMs`, `startedAt`, `updatedAt` |

`StopEvent` = `{ id?: 'stop-<startMs>', reason, startAbs (epoch ms), endAbs?, durationMinutes?, running?, breakdownDocId? }`
(`RecordProductionScreen.tsx:175-187`, `downtime.ts:20-30`).

**Lifecycle [VERIFIED]:** deleted at **Finalize** (transaction, only if `revision` unchanged — `RecordProductionScreen.tsx:3031-3045`)
or archived and deleted by an admin **End Production** (`endProduction.ts:148-171`).

### 3.3 `productionRecords/{id}` — one saved hourly slot (or changeover half)

**ID [VERIFIED]:** deterministic `pr|{productionDate}|{lineId}|{shift}|{slotIndex}|{segment}`, each part URI-encoded,
segment `full`/`before`/`after` (`productionDraft.ts:43-47`). **Legacy records have auto IDs** and are found by query
(`RecordProductionScreen.tsx:300-331`).

Fields (`RecordProductionScreen.tsx:2804-2866`, `2882-2920`):
`shift`, `plant`, `workshop`, `division`, `lineId`, `lineName`, `productionDate`, `partName`, `cycleTimeSeconds`,
`slotIndex`, `slotLabel`, `slotStartMinutesAbs`, `slotEndMinutesAbs`, `hourStartMinutesAbs`, `slotDurationMinutes`,
`productiveMinutes`, **`expectedParts`**, **`producedThisSlot`**, `lossParts`, `lossTimeMinutes`, `lossReasonCode`,
`lossReasonLabel`, `lossReasonNote`, **`rejections`**, `stopEvents[]` (per-window shares), `changeoverInfo` and
`partSegment` (split slots only), `operators[]`, `supervisor`, `sessionSupervisor`, `createdBy` (create only),
`createdAt` (create only), `updatedAt`.

- Writes are **upserts** (`setDoc`, merge on update). A slot that changes shape deletes its superseded records
  (`removeSupersededProductionRecords`, `RecordProductionScreen.tsx:365-380`). [VERIFIED]
- Legacy: records without `productionDate` (dated by `createdAt`), and records without numeric `rejections`. [VERIFIED]

### 3.4 `shiftSummaries/{lineId}_{productionDate}_{shift}` — written once at Finalize

Fields (`RecordProductionScreen.tsx:2741-2770`, `setDoc(..., { merge: true })`): `lineId`, `lineName`, `plant`,
`workshop`, `division`, `shift`, `productionDate`, **`plannedProductionTotal`**, **`actualProductionTotal`**,
`partPlannedTotals {partName: target}`, `downtimeIntervals[] {stopId, slotIndex, reason, startAbs, endAbs, durationMinutes}`,
`totalDowntimeMinutes`, `supervisor`, `sessionSupervisor`, `finalizedAt`.

> ⚠️ **Same field name, different meaning [VERIFIED]:** `shiftSummaries.plannedProductionTotal` is computed by
> `computeShiftTotals()` (`RecordProductionScreen.tsx:2688-2712`), i.e. Σ expected parts of **only the slots with entered
> production**. That is a plan-to-date at finalize. `activeSessions.plannedProductionTotal` is the **full-shift plan**.
> Do not mix them.

> ⚠️ **Only the last session [VERIFIED]:** the summary ID is per line + date + shift and the write merges. A second
> session of the same line/date/shift replaces the totals (acknowledged in `downtime.ts:238-240`).

### 3.5 `endedSessions/{es|lineId|instance}` — admin-ended session archive

A full copy of the `activeSessions` doc plus `sessionInstance`, `sessionStatus: 'ended'`, `endReason: 'admin_end'`,
`archivedFrom`, `endedAt`, `endedAtClientMs`, `endedBy {uid, name, email, role}` (`endProduction.ts:119-133`).
**Unsaved slots of an ended session are NOT submitted as production** (`endProduction.ts:17-21`). [VERIFIED]

### 3.6 `lineBreakdowns/{autoId}` — maintenance stops only

Created only when a stop's reason is `'maintenance'` (`RecordProductionScreen.tsx:3294`):
`lineId`, `lineName`, `plant`, `workshop`, `division`, `slotLabel`, `active: true`, `reportedBy {uid, name}`,
`startedAt`, `resolvedAt: null`, `fixedBy: null` (`RecordProductionScreen.tsx:3335-3346`).
Closed on Resume with `active: false, resolvedAt, resolvedBy` (`:3420-3426`), or on Finalize with `active: false, resolvedAt, fixedBy`
(`:2937-2946`). These writes are best-effort (failures only alert). The Technician dashboard listens on `where('active','==',true)`
(`DashboardScreen.tsx:277`). [VERIFIED]

**[RECOMMENDATION]** Do **not** use `lineBreakdowns` as the source of line stop status. It covers only maintenance stops
and can be left stale. Use `activeSessions.lineStopped` / `stopsBySlot`.

---

## 4. Answers — A. Assembly scope

| Question | Answer |
|---|---|
| Fields identifying Assembly lines | `productionLines.workshop` (current value **`'Assembly Shop'`**). Records, sessions and summaries carry a **copy** of `workshop` taken from the line at write time. [VERIFIED] |
| How the app matches Assembly | Case-insensitive **substring**: `w.toLowerCase().includes('assembly')` (`AdminOverviewScreen.tsx:183`, `GenerateReportScreen.tsx:230`, `RecordProductionScreen.tsx:760`, and others). [VERIFIED] |
| Legacy values | Code comments document legacy **`'Assembly'`** (vs `'Assembly Shop'`) and **`'S.Jack'`** (vs `'S. Jack'`) in older records (`KPIAnalysisScreen.tsx:373-376`, `PlanVsActualRecordScreen.tsx:133`), plus the field aliases in §3.1. [VERIFIED as code comments; actual frequency in data UNKNOWN] |
| Bawal 1 / Bawal 2 | Stored as the literal strings `'Bawal 1'` / `'Bawal 2'` in `plant` (`lineOptions.ts:1`). There is no plant ID. [VERIFIED] Legacy alias `location`. |
| Reliable metadata resolution | The app's established rule (`modelPartProduction.resolveLineFields`, `:178-191`; "same fix Generate Report applies"): **take plant/workshop/division/lineName from the `productionLines` doc by `lineId`, falling back to the record's own copy** (older sessions wrote `null` location — bug fix noted at `RecordProductionScreen.tsx:2020-2025`). [VERIFIED] |

**[RECOMMENDATION]**
- **Scope matching:** decide which lines are in scope from **`productionLines`** (normalising the aliases), not from record copies. Use the same `includes('assembly')` rule so legacy `'Assembly'` lines are included.
- **Unregistered lines:** also include any `activeSessions` doc whose own `workshop` matches but whose line is no longer registered. This mirrors `buildLineCards` (`lineEfficiency.ts:276-283`).
- **Plant matching:** avoid the app's loose *substring* matching for plants. `'bawal1'` vs `'bawal2'` happen to be safe, but substring matching is fragile. Match plants exactly after trim and lowercase.

---

## 5. Answers — B. Production calculations

| Question | Verified answer |
|---|---|
| **De-duplication** | `lineEfficiency.dedupeSlotRecords(records)` (`:202-239`) operates on the records of **one session (line + productionDate + shift)**. For each slot and segment it keeps the canonical-ID record if present, else the earliest-created one. When a slot has both shapes (`full` and `before`/`after`), it keeps the shape with the latest `updatedAt`. Records without `slotIndex` are kept as they are. Wrappers: `recordsForSession(session, records)` (`:244-254`, used by live screens); `modelPartProduction.dedupeProductionRecords(records)` (`:199-216`, multi-session, groups by `lineId|day|shift`, returns `{kept, duplicates}`). |
| **Good production** | `Σ producedThisSlot` over de-duplicated records. `producedThisSlot` **is good output**; nothing subtracts rejections ("There is no 'net good = produced − rejected'") — `qualityMetrics.ts:15-23`, `modelPartProduction.ts:20-29`. |
| **Plan-to-date** | `Σ expectedParts` of the **saved** de-duplicated records of the session (`supervisorHandover.ts:27-32`, `efficiencyOf` `lineEfficiency.ts:72-81`). Each `expectedParts = floor(productiveMinutes × 60 / cycleTimeSeconds)` (`productionSchedule.expectedPartsFor`, `:250-253`), where `productiveMinutes` is the **scheduled** productive time (breaks, startup reserve, changeovers and fixed-hour caps removed — `buildSlots`). **Stops do not reduce the plan** (`RecordProductionScreen.tsx:2793-2799`). |
| **Full-shift plan** | `activeSessions.plannedProductionTotal` (`supervisorHandover` exposes it as `shiftPlan`). |
| **Achievement / efficiency** | `efficiencyOf`: `round1(Σ produced / Σ expected × 100)`, **null when plan = 0** (shown "—", never 0 % or ∞) — `lineEfficiency.ts:9-13, 72-81`. Never an average of slot percentages. Existing bands: >90 excellent, 75–90 warning, 50–75 poor, <50 critical (`:36-41`). |
| **Rejections** | `Σ productionRecords.rejections` (the per-slot counter) over the same de-duplicated records. **`rejectionRecords` (Record Rejection screen) is never added**, because it may log the same parts (`qualityMetrics.ts:8-13`). Records without a numeric `rejections` are legacy: `counterQuality` excludes them, while `buildRunningLineCards` / Model-Part treat them as 0. |
| **Quality %** | `computeQuality(good, rejected)`: `inspected = good + rejected`; `rejectionPct = round1(rejected / inspected × 100)`; `qualityPct = round1(100 − rejectionPct)`. Null if rejections are unknown or `inspected = 0` (`qualityMetrics.ts:44-63`). Set-level: `counterQuality(records)` (`:83-100`). |
| **Current model** | `supervisorHandover.currentModel(session, line.parts, nowAbs, records)` (`:213-224`) gives the part of the latest started changeover, else `selectedPartIndex`, else the newest saved record's `partName`. |

**Helpers the backend should reuse (all pure, no React/Firebase imports — verified):**

| Helper | File | Use |
|---|---|---|
| `selectRecordsInProductionRange`, `legacyCreatedAtWindow`, `recordProductionDayKey`, `timestampToMillis`, `isProductionDayKey`, `addDaysToKey` | `productionDay.ts` | Load records for a production date (incl. legacy) |
| `resolveSessionProductionDate`, `productionDayKeyFor`, `millisToProductionDayMinute` | `productionDay.ts` | Session date; current production day |
| `dedupeSlotRecords`, `recordsForSession`, `efficiencyOf`, `currentStop`, `formatStopReason`, `buildLineCards` | `lineEfficiency.ts` | Per-line live figures and status |
| `parseRunningSession`, `buildRunningLineCards`, `currentModel`, `slotEntryStatuses`, `sessionNowAbs` | `supervisorHandover.ts` | Running card incl. shift plan, model, rejections |
| `computeQuality`, `counterQuality` | `qualityMetrics.ts` | Quality / rejection % |
| `mapProductionRecord`, `resolveLineFields`, `dedupeProductionRecords` | `modelPartProduction.ts` | Multi-day aggregation (weekly trend) |
| `collectDowntimeIntervals`, `totalDowntimeMinutes`, `downtimeByReason`, `downtimeBySession`, `lineDowntimeSummary`, `sessionSourceFromDoc`, `summarySourceFromDoc` | `downtime.ts` | All downtime |
| `buildSlots`, `shiftWindow`, `expectedPartsFor` | `productionSchedule.ts` | Shift windows |

The functions bundle already imports `../../src/utils/productionDay` (`dataSource.ts:16-21`), which proves the import path works.

**[ASSUMPTION — needs your confirmation]:**
- **TV "Good production" scope:** the existing live screens (Line Efficiency, Running Lines) count **saved slots only**. Values typed into an unsaved slot (`activeSessions.producedBySlot`) are not production until saved or finalized. The TV should follow the same rule unless you decide otherwise.
- **Rejection source:** the same applies to rejections. Do not use `activeSessions.totalRejections`, which includes unsaved slots.

---

## 6. Answers — C. Downtime

| Question | Verified answer |
|---|---|
| **Open vs closed stops** | `StopEvent.running: true` with no `endAbs` = **open**. Closed = `running: false` + `endAbs` + `durationMinutes`. `startAbs`/`endAbs` are **epoch ms** (despite the name). `activeSessions.lineStopped` = any stop running (`downtime.ts:20-30, 57-59`; `endProduction.ts:67-77`). |
| **Where stops live** | In full: `activeSessions.stopsBySlot` (live), `endedSessions.stopsBySlot` (admin-ended), `shiftSummaries.downtimeIntervals` (finalized). In shares: `productionRecords.stopEvents` (only the part inside a **saved** slot's window, as at save time) — `downtime.ts:221-244`. |
| **Authoritative calculation** | `collectDowntimeIntervals({records, activeSessions, endedSessions, shiftSummaries}, nowMs)` (`downtime.ts:287-364`). Per session key `lineId\|productionDate\|shift`, each stop is counted **once, in full**, from the first full source (live → ended → summary). Record shares are used only for stops no full source has. Then `totalDowntimeMinutes`, `downtimeByReason`, `downtimeBySession`. Used by Admin Overview and Generate Report; the loader is `services/downtimeSources.fetchDowntimeSourcesForDateRange`. |
| **Per live line** | `lineDowntimeSummary(stopsBySlot, nowMs)` → `{totalMinutes, currentStopMinutes, currentStopStartMs, stopCount}` (`downtime.ts:168-190`). Current stop reason: `lineEfficiency.currentStop(session)`. |
| **Duplicate stop IDs** | A stable ID is `stop.id ?? 'stop-<startAbs>'` (`stopIdOf`, `downtime.ts:49-51`). Every summing helper keeps a `seen` set, so the same interval appearing in several slots, retried writes or several devices is counted once. Record events without any ID count only when the session has no full source. |
| **Reason values** | Raw lowercase strings from `STOP_REASONS`: `maintenance`, `changeover`, `quality`, `material shortage`, `no operator`, `storage issue`, `training`, `5s`, `meeting`, `pokayoke checktime`, `gauge/fixture maintenance`, `no production plan`, `power cut`, `machine pm` (`RecordProductionScreen.tsx:385-400`). Missing reason → `'Unspecified'`. Display via `formatStopReason`. *(Separate concept: slot **loss reasons** A–K, `lossReasonCode/Label` on records — not downtime.)* |
| **Display rounding** | `formatDowntimeMinutes` (<60 → one decimal "4.2 min"; else "1h 5m") — `downtime.ts:390-398`. |

> ⚠️ **Stale comment [VERIFIED]:** `saveShiftSummary` says "reports total downtime from productionRecords' stopEvents"
> (`RecordProductionScreen.tsx:2725-2728`), but `downtime.ts` (newer) *does* use `shiftSummaries.downtimeIntervals` as a
> full source. Follow `downtime.ts`.

**Refreshing active downtime [RECOMMENDATION]:**
- **Store the stop start, not a counter.** The aggregate should carry **`currentStopStartMs`** for each stopped line, plus the closed-stop minutes. The TV adds `now − currentStopStartMs` locally every second, the same way the app works ("elapsed time is always `now - startAbs`", `downtime.ts:5-9`).
- **Never write elapsed time to Firestore every second or minute.**
- **Correct for clock skew:** publish a server `generatedAt` and have the TV estimate its own clock offset.

---

## 7. Answers — D. Time and shifts [all VERIFIED]

| Rule | Value | Ref |
|---|---|---|
| Production-day cutover | **06:30 local**. Before 06:30 belongs to the previous day's key `YYYY-MM-DD` | `productionDay.ts:9-22` |
| Shift A | **07:00 – 15:30** (+ `otHours`). Breaks 09:30–09:40, lunch 12:15–12:45, 14:00–14:10. 10-min startup reserve. Fixed 50-min caps at 7–8, 9–10, 14–15 and 17–18 | `productionSchedule.ts:19-33, 57-74` |
| Shift B | **19:00 – 03:30** (+ `otHours`), in a +1440 "absolute minute" frame. Dinner 21:45–22:15, tea 01:30–01:40, rejection clearance 03:20–03:30 (no OT) or OT tea 04:30–04:40 (with OT) | `productionSchedule.ts:21-55` |
| Overnight Shift B | `productionDate` is **pinned when Start Production creates the session** and never re-derived. Every slot save, Finalize, summary and stop uses it. Resolution order is stored date → pinned screen date → `startedAt` → *never `Date.now()`* (`resolveSessionProductionDate`). Legacy records with no `productionDate` use the cutover for Shift B, otherwise the calendar day of `createdAt` (`recordProductionDayKey`). | `productionDay.ts:76-80, 109-130`; `RecordProductionScreen.tsx:2091-2097` |
| Timezone | Device-local in the app. Backend pins `Asia/Kolkata` | `functions/src/timezone.ts` |
| Gap | No shift runs 15:30 (+OT) – 19:00, or after Shift B (+OT) until 06:30 | derived |

**Functions to reuse:** `productionDayKeyFor`, `resolveSessionProductionDate`, `recordProductionDayKey`,
`legacyCreatedAtWindow`, `selectRecordsInProductionRange` (productionDay.ts); `shiftWindow`, `buildSlots`
(productionSchedule.ts).

**[RECOMMENDATION]**
- **Server owns shift and date.** The TV should not decide the current shift or production date from its own clock. The aggregate publishes `productionDate`, `currentShift` (from running sessions, else from the schedule) and `generatedAt`.
- **Replace the prototype's clock logic.** The prototype's `utils/productionDay.js` "between shifts" logic is a placeholder.

**[UNKNOWN]**
- **Maximum `otHours`:** with large OT, Shift B could approach the 06:30 cutover.
- **Between-shift label:** what the TV should show between shifts (last shift? "No shift running"?).

---

## 8. Answers — E. Live updates

### 8.1 Documents that change during production [VERIFIED]

| Document | When it is written | Frequency |
|---|---|---|
| `activeSessions/{lineId}` | Start; **every input change, debounced 1.2 s** (`SESSION_SAVE_DEBOUNCE_MS = 1200`, `RecordProductionScreen.tsx:267, 2290-2310`); every Stop/Resume; retries 5 s → 60 s; delete at Finalize/End | **High**: bursts during data entry; several devices may sync the same line |
| `productionRecords/*` | Each **Save Slot** (1–2 docs + possible superseded deletes); **Finalize** writes all unsaved slots | Medium: about one burst per line per hour, a bigger burst at Finalize |
| `shiftSummaries/*` | Once per Finalize | Low |
| `endedSessions/*` | Admin End Production | Rare |
| `lineBreakdowns/*` | Maintenance stop start / resume / finalize | Low |
| `productionLines/*` | Admin register / edit / delete | Rare |

### 8.2 Trigger risks
- **`activeSessions` triggers would fire on every keystroke burst.** About 50 Assembly lines in data entry means many invocations per minute, and many writes change nothing the TV shows (typed but unsaved quantities, operators, loss reasons, sync metadata).
- **A single summary document cannot take a write from every trigger.** Firestore sustains about **1 write/second per document**, so 50 lines updating one `tvDashboard/assembly` doc would contend.
- **Triggers are at-least-once and unordered** (Firestore v2 `onDocumentWritten`), so increment-style counters drift.
- **Finalize causes a burst:** many `productionRecords` writes, then the summary, then the session delete, within seconds.

### 8.3 Recommended aggregation strategy [RECOMMENDATION]

1. **Recompute, never increment.** Every update recomputes the affected line from source using the shared helpers, so a duplicate or out-of-order event is harmless (idempotent).
2. **Use per-line docs as the fan-in point.** An `onDocumentWritten` trigger on `activeSessions/{lineId}` and on `productionRecords/{id}` (plus `shiftSummaries`, `endedSessions`, `productionLines`) resolves the line and checks Assembly scope (exiting early otherwise). It then reads that line's session and its records for that `productionDate` + `shift` (equality query, about 10–30 docs) and rewrites **one line doc**, but **only if the sanitised projection changed** (compare a hash or JSON). Typing an unsaved quantity then usually causes **no write**.
   - In the `activeSessions` trigger, exit early when no TV-relevant field changed: compare `lineStopped`, the stop IDs/state in `stopsBySlot`, `savedSlotIndices`, `selectedPartIndex`, `changeovers`, `plannedProductionTotal`, `shift`, `productionDate`.
3. **Summary roll-up on a schedule.** An `onSchedule` job every 1 minute reads the line docs (≤ ~60 reads), recomputes `tvDashboard/assembly` and writes only if it changed. This isolates the single-doc write limit and caps summary writes at 1/min.
4. **Day docs:** recompute `days/{productionDate}` (per shift: good, plan, rejections, downtime, downtime by reason) when a `shiftSummaries` or `productionRecords` write touches that date, debounced through the same 1-minute job (dirty-date marker). Load records with `selectRecordsInProductionRange` and dedupe with `dedupeProductionRecords`.
5. **Reconciliation:** an hourly or nightly scheduled full rebuild of today, yesterday and the 7-day trend. This repairs missed events and handles line metadata edits.
6. **Code organisation:**
   - Pin `Asia/Kolkata` (import `./timezone` first).
   - Set an explicit `region` matching the Firestore location.
   - Use a separate deploy target, e.g. `firebase deploy --only functions:tvDashboard*`, because `npm run deploy` deploys only `prodPulseAI`.

**Rough cost comparison [ASSUMPTION, order of magnitude]:**
- **Polling everything every minute:** reading all of today's records (~1,000+ docs) every minute is about 1.5–2 M reads/day.
- **Event-driven (recommended):** per-line recompute plus a 1-minute roll-up is typically tens of thousands of reads/day.

### 8.4 Finalized and admin-ended sessions [VERIFIED behaviour → RECOMMENDATION]
- **Finalize:** writes the unsaved slots to `productionRecords`, writes `shiftSummaries`, then deletes `activeSessions/{lineId}`. The line becomes **Idle** on the TV; its shift figures remain in the day doc from records and the summary.
  - **[RECOMMENDATION]** Recompute the line on the **session delete** event too (`onDocumentWritten` with no after-data).
- **Admin End Production:** archives to `endedSessions` and deletes the session. **Unsaved slots are not production.**
  - **[RECOMMENDATION]** Production figures come from saved `productionRecords` only. Downtime includes the archived `stopsBySlot` (already handled by `collectDowntimeIntervals`). The line becomes Idle.
- **Statuses:** the app has a third live state, `awaiting_entry` (`supervisorHandover.ts:167-179`), meaning a slot has ended unsaved.
  - **[QUESTION]** The TV has Running / Stopped / Idle only. Show it as Running, or add a flag?

---

## 9. Answers — F. Security

| Finding | Status |
|---|---|
| **Rules are not in the repo**, so their current content is **unknown**. | [VERIFIED absence] |
| The client reads `productionLines`, `activeSessions`, `productionRecords` (whole collections / date queries) directly, so the rules must allow at least **authenticated** reads of these. Whether **unauthenticated** reads are currently denied cannot be determined from code. | [UNKNOWN — check in Console] |
| Raw collections contain personal and operational data: operator names/codes, supervisor names/codes/UIDs, `updatedBy.deviceId`, `contributorUids`, `endedBy.email`, loss notes, sync conflicts. | [VERIFIED §3] |
| Firestore rules are **not filters**: a public rule on `productionRecords` could not be limited to "today + Assembly + safe fields". | [VERIFIED — Firestore behaviour] |
| Admin SDK functions bypass rules, so an aggregator can read raw data and write a sanitised projection without any change to existing rules. | [VERIFIED `functions/README.md:141`] |

**Can a public TV read only sanitised aggregates? Yes, with one additive rule [RECOMMENDATION]:**

```
// Proposed — NOT applied. Add only after exporting and reviewing the current Console rules.
match /tvDashboard/{document=**} {
  allow read: if true;     // or: if request.auth != null && request.auth.token.tv == true
  allow write: if false;   // only the Admin SDK (Cloud Function) writes here
}
```

- **Existing collections are untouched:** Firestore `allow` rules combine with OR per path, so a `match` on `tvDashboard` grants nothing on other collections.
- **Before adding it:**
  1. Export the current rules from the Console into version control.
  2. Confirm that unauthenticated reads of `productionRecords`, `activeSessions`, `users` and `operators` are already denied. If they are not, that is a pre-existing exposure to fix first.
- **Sanitisation contract:** aggregate docs contain **no person names, codes, UIDs, emails, device IDs, operator lists or free-text notes**. They contain only line names, division, plant, model/part names, counts, minutes, stop-reason labels and timestamps.
- **Hardening options (if even aggregates must not be world-readable):**
  - (a) a dedicated TV account or custom claim `tv: true`;
  - (b) Anonymous Auth plus App Check, restricted to the TV origin.
  - **[QUESTION]** Is a fully public URL acceptable? Production figures would be readable by anyone with the project ID.

---

## 10. Evaluation of the proposed design (`tvDashboard/assembly` + `tvDashboard/assembly/days/{productionDate}`)

| Aspect | Verdict |
|---|---|
| Separate, sanitised read model written by a function | ✅ Sound. It fits the existing pattern (Admin SDK + bundled shared utils) and the security constraints. |
| Path shape | ✅ Valid. `tvDashboard` (collection) / `assembly` (doc) / `days` (subcollection) / `{productionDate}` (doc). One recursive rule covers both. |
| Single summary doc for all live line state | ⚠️ **Change.** It would take a write from every relevant line event, against the ~1 write/s per-doc limit. **Add `tvDashboard/assembly/lines/{lineId}`** (per-line live docs, written by triggers) and roll the summary up on a 1-minute schedule. The TV listens to the summary doc plus the `lines` subcollection (≤ ~60 small docs), or the summary can embed a compact `lines[]` array written by the roll-up job (keep it well under the 1 MiB doc limit; ~50 lines is roughly 15–25 KB). |
| Plant scope | ⚠️ **Decide.** Two plants (`Bawal 1`, `Bawal 2`) share `workshop: 'Assembly Shop'`. Either one doc per plant (`tvDashboard/assembly-bawal-1`) or one doc with a `plant` field per line and per-plant totals. |
| Weekly trend | ✅ Read the last 7 `days` docs (`orderBy(documentId) desc, limit 8` excluding today, or explicit IDs). Day doc values must come from **de-duplicated `productionRecords`** (authoritative), not `shiftSummaries`, which hold only the last session per line/shift and a plan-to-date. |
| Live stop timers | ⚠️ Store `currentStopStartMs` and compute elapsed time on the TV (see §6). |
| Shift A vs B | ✅ Per-shift blocks inside each day doc. |
| Downtime reasons | ✅ `downtimeByReason(collectDowntimeIntervals(...))` per day / shift. Use raw reason keys and display labels via `formatStopReason`. |
| Versioning | ➕ Add `schemaVersion`, `generatedAt` (server), `sourceWatermark` (latest source `updatedAt` seen). |
| Backfill | ➕ Add a callable or one-off scheduled run that builds today and the last 7 days on first deploy. |

### 10.1 Proposed aggregate schemas [RECOMMENDATION — draft]

**`tvDashboard/assembly`** (summary, written by 1-min roll-up)
```js
{
  schemaVersion: 1,
  scope: { workshop: 'Assembly Shop', plants: ['Bawal 1', 'Bawal 2'] },   // or one doc per plant
  productionDate: '2026-10-30',          // server-resolved (Asia/Kolkata, 06:30 cutover)
  currentShift: 'A' | 'B' | null,        // null between shifts
  generatedAt: Timestamp,                // server time; TV derives clock offset
  sourceWatermark: Timestamp,
  kpis: {                                // current shift, saved slots only (to confirm)
    goodProduction, planToDate, shiftPlan,
    achievementPct,                      // efficiencyOf → round1, null if no plan
    rejections, qualityPct, rejectionPct,// computeQuality
    downtimeClosedMinutes,               // closed stops
    stoppedLines: [{ lineId, currentStopStartMs }]  // TV adds live elapsed
  },
  statusCounts: { running, stopped, idle },
  downtimeByReason: [{ reason, label, minutes }],   // current shift
  lines: [ /* optional compact copy of lines/* for one-listener TVs */ ]
}
```

**`tvDashboard/assembly/lines/{lineId}`** (per-line, written by triggers)
```js
{
  lineId, lineName, plant, division,     // from productionLines (aliases resolved)
  status: 'running' | 'stopped' | 'idle',
  awaitingEntry: boolean,                // app's awaiting_entry state (if wanted)
  model: string | null,                  // currentModel()
  productionDate, shift,
  goodProduction, planToDate, shiftPlan, achievementPct,
  rejections,
  downtimeClosedMinutes,
  currentStopStartMs: number | null,
  currentStopReason: string | null,      // formatted label, no free text
  updatedAt: Timestamp
}
```

**`tvDashboard/assembly/days/{productionDate}`** (per day, written by roll-up / reconciliation)
```js
{
  productionDate, final: boolean,        // true once both shifts are finalized/ended and past cutover
  shifts: {
    A: { goodProduction, plan, achievementPct, rejections, qualityPct, downtimeMinutes,
         downtimeByReason: [{ reason, label, minutes }] },
    B: { ...same }
  },
  totals: { goodProduction, plan, achievementPct, rejections, downtimeMinutes },
  generatedAt: Timestamp
}
```

> **To decide:** for `days.plan`, use **Σ `expectedParts` of saved records** (consistent with reports and achievement), or
> **Σ full-shift plans**? These differ when a shift is not fully recorded.

---

## 11. Risks, unknowns and open questions

### Risks
| # | Risk | Mitigation |
|---|---|---|
| R1 | **Current Console rules unknown.** They may already allow broad reads, or a careless edit may break the app. | Export the rules into version control first; review; add only the `tvDashboard` block. |
| R2 | `activeSessions` write churn drives function invocations and cost. | Early-exit on irrelevant changes; write-if-changed; 1-min roll-up. |
| R3 | Single-doc write contention. | Per-line docs plus a scheduled roll-up. |
| R4 | Legacy data: missing `productionDate`, `rejections`, location fields, alias field names, `'Assembly'` vs `'Assembly Shop'`. | Reuse `recordProductionDayKey`, `counterQuality` semantics, `resolveLineFields`, alias normalisation and the `includes('assembly')` rule. |
| R5 | `shiftSummaries` reflects only the last session per line/date/shift, and its `plannedProductionTotal` is a plan-to-date. | Use de-duplicated `productionRecords` for production; use summaries only as a downtime source via `collectDowntimeIntervals`. |
| R6 | Deleted lines (hard delete) still have records and sessions. | Include sessions on unregistered lines (`buildLineCards` rule); use record copies for metadata. |
| R7 | Timezone / clock: functions default to UTC; TV clocks drift. | Import `./timezone`; publish server `generatedAt`. |
| R8 | Deploying with `firebase deploy --only functions` (unscoped) would redeploy `prodPulseAI`. | Scoped deploy targets for the new functions. |
| R9 | Region mismatch between the new triggers and the Firestore database location. | Confirm the database location; set `region` explicitly. |
| R10 | Multiple devices syncing one session cause repeated trigger events. | Idempotent recompute + write-if-changed. |
| R11 | The audited code includes **uncommitted working-tree changes** (e.g. `RecordProductionScreen.tsx` modified; `supervisorHandover.ts` untracked). | Re-verify these helpers once committed, before building on them. |

### Unknowns / questions requiring confirmation
1. **Rules:** may the current Console rules be exported and reviewed? Are unauthenticated reads of raw collections denied today?
2. **Public access:** is a fully public read of the TV aggregates acceptable, or should the TV use a dedicated account or App Check?
3. **Plant scope:** one TV for both plants, or one per plant?
4. **Live figures:** saved slots only (consistent with the app's live screens), or also unsaved typed quantities?
5. **Rejections:** confirm the slot counter (`productionRecords.rejections`) is the only source, and that `rejectionRecords` is excluded.
6. **Plan basis** for the weekly trend and day docs: Σ `expectedParts` of saved slots vs full-shift plan.
7. **Statuses:** how to show `awaiting_entry`; should "maintenance" / "quality hold" badges (`stoppedBadge`) appear on the TV?
8. **Between shifts:** what the TV shows (last shift's figures, or a "No shift running" state).
9. **Firestore database location / functions region**, and whether Blaze billing is enabled (required for triggers and schedules).
10. **Max overtime** per shift (interaction with the 06:30 cutover for Shift B).
11. **Line count:** how many Assembly lines exist per plant (the prototype assumes ~50).
12. **Data quality:** how many legacy docs still carry `'Assembly'`, alias fields, or lack `productionDate` / `rejections`? This can only be measured with a read-only data check, which was not done in this audit.

---

## 12. Proposed implementation order (next phase, not started)

1. Export and review the current Firestore rules (no change).
2. Confirm the open questions in §11.
3. Add the aggregator functions under `functions/src/tvDashboard/` with unit tests against the shared helpers, using the existing `scripts/test*.ts` style (`testLineEfficiency`, `testDowntime`, `testShiftBOvernight` already cover the helpers).
4. Run them in the emulator against seeded data; backfill; deploy with a scoped target.
5. Add the `tvDashboard` read rule.
6. Switch the TV's `useDashboardData` to `onSnapshot` on the aggregate docs (shape mapping only).

---

## 13. Read-only confirmation for the ProdPulse repository

- **Snapshot before the audit:** `git --no-optional-locks status --porcelain --untracked-files=all`, a SHA-256 of `git diff HEAD`, and SHA-256 hashes of all untracked files. The same snapshot was taken after the audit and compared (result reported in the session summary).
- **Only read-only commands ran in that repository:** `cat`, `sed -n`, `grep`, `awk`, `wc`, `ls`, `node -e` reading `package.json`, and git status/diff/rev-parse with `--no-optional-locks`.
- **Not done:** no installs, builds, tests, deploys, Firebase CLI or Firestore access.
- This document lives in the TV dashboard repository only.
