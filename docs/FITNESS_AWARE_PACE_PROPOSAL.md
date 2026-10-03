# Proposal: pace display and analysis as fitness changes

Status: proposed; no runtime changes implemented by this document.
Date: 2026-10-03.

## Problem and intended behavior

A pace is neither invalid nor a workout type by itself. Sub-3:00/km can be a
valid short stride today and sustained threshold pace after years of training.
The app must support both, as well as slower runners, walking recoveries and
years of imported history. Today's fitness must not redefine old workouts.

Separate three decisions: whether telemetry is usable, how to display it, and
what the effort means. Fitness informs the third decision and optional chart
guides; it must not be a hard ceiling on recorded speed.

## Current behavior observed in the code

| Area | Current behavior | Implication |
| --- | --- | --- |
| Run chart, `src/frontend/components/CanvasRunChart.tsx` | Finds its pace range only from samples between 180 and 600 sec/km, with speed greater than 1 m/s; draws faster/slower samples clamped to that range. Falls back to 240–360 sec/km and 100–170 bpm without usable data. | Valid strides and slow running can be flattened; fallback axes imply measurements that are absent. |
| Threshold chart, `src/frontend/components/ThresholdTrendsChart.tsx` | Uses observed thresholds when available, otherwise fixed pace/HR ranges. | Empty charts can suggest an athlete-specific range without evidence. |
| Interval detector, `src/backend/ingestion/interval-detector.ts` | Uses within-session speed contrast, duration, cadence, recovery, FIT laps and a historical stride pace anchor. | Already avoids identifying strides from an absolute sub-3:00/km rule. Preserve this foundation. |
| Pace anchor, `src/backend/physiology/threshold-tracker.ts` | Uses prior LT2 calibration and recent threshold/VO2 work; selects the faster available anchor. | Quality-rep pace is a stride comparison aid, not necessarily LT2. Its source and age matter. |
| Classifier, `src/backend/ingestion/classifier.ts` | Quality intensity uses athlete-relative HR and structure rather than a fixed training pace. | Chart cleanup should not introduce an absolute pace rule into classification. |
| Threshold history, `src/shared/threshold-trend.ts` | Selects dated observations; historical callers can require evidence strictly before the run. Older evidence remains a fallback when recent evidence is absent. | Supports fitness changes, but stale evidence must not look current. |
| HR baseline, `src/backend/physiology/athlete-profile.ts` | Automatic max HR uses qualifying observed peaks across stored activities; RHR is a single profile value. | Historical baseline assumptions are distinct from dated LT1/LT2 calibration. |

## Proposed changes

### 1. Validate samples without imposing a training pace

Keep raw speed, HR, distance and timestamps unchanged. Invalid numerical values,
negative speed, timer pauses and unobserved gaps must not produce running effort.
Zero speed represents stopping; it does not have a finite sec/km pace.

For suspicious speed spikes, consider elapsed-time continuity, neighbouring
samples and distance change where available. Assess speed before converting to
pace, since pace becomes unstable near zero speed. A short burst alone is not
proof of a spike: a real stride can be brief. Corroborating cadence and distance
can support it, but missing cadence must not automatically reject it.

Use conservative, explainable quality flags. Where evidence is ambiguous, retain
the sample and flag uncertainty rather than silently deleting it. Distance and
speed can share a sensor source, so agreement is supporting evidence rather than
an independent guarantee. Any broad sensor sanity bounds should be named,
documented constants, separate from fitness and session-type thresholds.

### 2. Scale charts from the activity

Derive the pace and HR axes from usable samples in the selected activity, with
padding and a minimum span for nearly constant values. Include valid fast strides
and slow recoveries. Do not gate axis eligibility at 3:00/km or 10:00/km, and do
not clamp valid points to an unrelated range.

Do not use a whole-run percentile cutoff as a validity filter: genuine strides
may occupy very little recording time. If robust scaling is later needed for
readability, visibly identify points outside the selected view and provide a
full-range view. Exact recorded values remain available in the readout.

Break the plotted line at invalid samples, pauses and long gaps rather than
connecting across them. Walking remains visible as movement; it need not be
treated as running for physiological analysis. Use existing movement/timer
evidence instead of a new personal minimum running speed.

When no usable pace or HR exists, omit that metric's ticks and line and show
localized unavailable copy. Apply the same empty-data policy to the threshold
chart. A shared frontend helper should own range calculation so drawing,
selection markers and readouts use consistent sample eligibility.

### 3. Use fitness effective at the workout date for interpretation

Keep dated LT1/LT2 estimates as physiological context. Optional pace/HR guides
on an activity chart should come from the historical context selected for that
activity, not the current profile. Expose source, observation date, confidence
and whether evidence is stale or a baseline assumption. Do not invent a pace
anchor when history is missing.

Retain relative speed contrast and temporal structure in stride detection.
Use short duration, burst/recovery sequence and supporting movement telemetry
to distinguish a stride from sustained work. HR lag means a brief stride need
not reach threshold HR. A historical pace anchor can support the comparison;
it must not independently assign a workout type or veto clearly supported
structure when the anchor is stale or uncertain.

Keep sustained threshold/VO2 classification based on duration, recoveries and
athlete-relative HR evidence. Sustained sub-3:00/km work should not become a
stride merely because it is fast. An isolated stride within an easy run should
not make the entire run a threshold or VO2 workout. Athlete-confirmed intent
continues to take precedence while preserving the independent prediction.

### 4. Support bulk historical imports with explicit baseline assumptions

Persist a batch, then rebuild affected analysis chronologically from the earliest
changed activity using the existing history-rebuild coordinator. Apply stable
ordering to equal timestamps; one workout's new calibration must not classify
itself or a same-time peer. Re-importing older data should refresh dependent
later results while preserving confirmations and external measurements.

Separate dated workout-derived thresholds from baseline assumptions. Importing
years of history must not require manually entering years of RHR measurements.
Use the configured RHR as an assumed baseline where dated values are absent.
Optional dated RHR updates can be added later; a new measurement applies from
its effective date, whereas a correction explicitly permits historical replay.
Do not infer RHR from the lowest HR recorded during a run.

Keep automatic max HR as an observed-peak estimate, not a claim that an athlete's
true maximum changed whenever a higher peak appeared. An initial easy run is
insufficient evidence for a low maximum. For incomplete historical baselines,
retain an explicit retrospective assumption using the configured automatic
observed-peak estimate, or a manual baseline, with the existing provisional
fallback when neither is available. This can use later evidence for the baseline;
it must be disclosed and must not import future LT1/LT2 calibrations into old runs.
Fully dated max-HR measurements are optional future work, not required for chart
cleanup. The existing all-history replay policy for baseline corrections remains
until dated baseline support is implemented.

## Scope and implementation order

1. Replace chart pace gates, clamping and invented empty-data axes. Add a small
   range/eligibility helper and bilingual unavailable states. No DB migration or
   classification replay is needed for presentation-only changes.
2. Add conservative telemetry quality handling only where actual spike cases
   justify it. Keep original records exportable. If analysis eligibility changes,
   version the derived analysis and replay through the existing coordinator.
3. Expose historical fitness provenance to charts and analysis explanations.
   Prefer extending the existing historical context/API payload over separate
   client-side reconstruction. Snapshot exports need compatible optional fields
   or an explicit schema migration if the contract becomes mandatory.
4. Audit stale pace-anchor behavior and adjust stride interpretation only when
   fixtures demonstrate a failure. Optional dated RHR support follows later.

Everything remains offline in the existing application and SQLite database.
This proposal does not require new services, automatic RHR ingestion, or changes
to the current LT1/LT2 physiological formulas.

## Acceptance cases and verification

| Case | Expected result |
| --- | --- |
| Easy run with valid 2:45/km strides | Fast bursts are visible at their actual pace; supported bursts are strides; the session remains easy when sustained quality evidence is absent. |
| Sustained 2:45/km threshold work years later | Actual pace is visible; duration, structure and contemporary HR context support threshold classification. No absolute stride-speed rule applies. |
| Same speed, different fitness histories | Displayed measurement is identical; interpretation can differ with dated context and effort structure. |
| Running slower than 10:00/km and walking recovery | Valid movement remains visible without a fabricated 4:00–6:00/km axis. |
| Single GPS spike versus genuine brief stride | A corroborated stride survives; an unsupported spike is flagged without changing raw data. |
| Paused timer, sparse samples or missing HR/pace | No line bridges unobserved time; absent metrics show unavailable rather than invented values. |
| Years of history imported in reverse order or multiple batches | Final derived results match chronological import under the same baseline assumptions. |
| Older activity added or corrected | Affected later history is rebuilt; confirmations and external measurements survive. |
| RHR 55 → 54 bpm | Existing baseline mode works; optional future dated mode preserves each effective value without requiring daily logging. |

Use focused helper, canvas UI and analysis tests, plus bulk-import/replay
integration fixtures. Verify chart behavior with fast strides, slow movement,
constant pace and absent data in both languages. Before any implementation
commit, run TypeScript, lint, the full test suite and the unused-i18n check as
required by AGENTS.md.

The main tradeoff is readability: including genuine slow recoveries widens the
axis. Start with truthful full-range display; add a clearly labelled zoom only
if real examples show that it is needed. A fitness-based hard filter is rejected
because it would discard the very improvement the app is intended to track.
