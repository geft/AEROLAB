# Telemetry-based classification improvement plan

Written and updated October 4, 2026. Status: implemented and replay-validated on a
database copy. See [execution results](CLASSIFICATION_TELEMETRY_RESULTS.md).

## Objective

Improve workout labels using observed running intensity and rep structure.
Reduce classifications driven by walking/standing HR, isolated sensor peaks,
or summary averages that disagree with the trace. Keep import and historical
replay consistent, preserve athlete-confirmed labels, and remain fully offline.

This extends [FIT telemetry and classification](fit-classification.md). Timer
annotations, lap-assisted segmentation, and historical HR profiles already
exist; the work below refines how the classifier evaluates their evidence.

## Available data

Evaluate available heart rate, cadence, speed, ground-contact time, altitude,
running power, respiration, FIT metadata, and original FIT files. Keep personal
dataset sizes and channel-coverage counts in private evaluation reports. Heart
rate supports athlete-relative intensity; cadence, speed, and ground-contact time
support movement and segmentation. Altitude provides terrain context. Optional
power and respiration require sufficient coverage and separate validation.

Presence is not completeness. Measure observed duration and usable coverage per
activity and per rep before relying on a channel. Reimporting all activities
does not make missing readings, device artifacts, or recording gaps valid data.
Saved FIT metadata also does not guarantee usable timer events or prescribed
work/recovery laps. Keep telemetry-only segmentation when that structure is absent.

Audit device provenance, usable duration, and work/recovery contrast before
adding an optional corroborating signal. Keep the initial HR/structure improvements
independent of power availability; do not introduce absolute watt targets.

## Implementation sequence

### 1. Establish a reproducible baseline

- Add a development replay report using the shared `prepareAnalysisContext`
  and `analyzeWorkout` pipeline, rather than a second classifier implementation.
- Evaluate a consistent database copy. Record current automatic labels, effective
  labels, rule IDs, confidence, historical profiles, interval boundaries, and
  channel coverage. Keep reports and database copies in ignored output paths.
- Run fixed-profile comparisons first to isolate classifier changes. Separately
  run chronological replay to measure changes propagated through threshold
  calibration, training load, tags, and coaching.
- Select a small reviewed evaluation set covering easy/recovery, long runs,
  tempo, threshold, VO2, races, run/walk, pauses, and poor sensor coverage.
  Keep some examples out of threshold tuning. Existing automatic labels are
  a comparison baseline, not ground truth; confirmed intent and observed
  execution can also differ.

Deliverable: a baseline report and a transition report format with one row per
changed classification and the measurements that explain it.

### 2. Use running-only intensity evidence

Primary files: `src/backend/ingestion/classifier.ts`,
`src/backend/physiology/economy.ts`, and
`src/backend/physiology/time-series.ts`.

- Extract or extend shared movement/HR exposure calculations. Reuse the existing
  running-evidence policy instead of introducing different movement thresholds
  for classification and economy.
- Measure running time, valid running-HR time, mean running HR, threshold-band
  time, and VO2-band time from adjacent observed intervals. Integrate boundary
  crossings and clip time to the relevant window.
- Exclude timer pauses, stationary samples, walking, invalid HR, and unobserved
  gaps from intensity evidence. Missing cadence must remain unknown; use the
  established speed fallback when justified.
- Replace whole-session occupancy in continuous threshold and quality-intensity
  decisions with running-only exposure. Retain whole-session measurements as
  context and keep duration-based endurance rules independent of intensity.
- Record coverage and fallback use in `ClassificationEvidence.measurements`.
  Preserve conservative behavior when running intensity cannot be established.

Acceptance: adding a stationary high-HR tail cannot turn an aerobic run into
threshold work; adding low-HR walking cannot dilute genuine running intensity.
Dense and sparse recordings of the same effort produce equivalent decisions.

### 3. Verify quality work inside each rep

Primary files: `src/backend/ingestion/classifier.ts` and
`src/backend/ingestion/interval-detector.ts`.

- Build per-rep exposure using the detected work window, including usable HR
  coverage, threshold/VO2 seconds, and the sustained portion of the effort.
  Boundaries must respect FIT timer segments and observed gaps.
- Use sustained exposure across repeated work reps to corroborate VO2 labels.
  A single peak, or elevated HR exclusively in recoveries, cannot certify a
  VO2 stimulus. Retain recovery HR as context for lag and recovery behavior.
- Account for short-rep HR lag through repeated structure and within-run
  speed/cadence contrast. Low early HR alone must not imply a failed workout;
  structure alone must not certify VO2 when intensity is unobserved.
- Preserve existing lap validation: explicit work/recovery structure can refine
  boundaries, while ordinary distance autolaps cannot manufacture repetitions.
- Validate any sustained-duration/occupancy thresholds on the reviewed set.
  Keep thresholds named and shared, with boundary tests. Do not introduce fixed
  pace, watt, cadence, or ground-contact cutoffs as workout-intensity targets.

Acceptance: threshold reps with brief high-HR spikes remain threshold; repeated
VO2 bouts with sustained exposure remain VO2; warmup strides and recovery HR
cannot supply the work set's stimulus evidence. Warmup/cooldown must not hide
continuous tempo. Preserve existing continuous-race and high-LT2-profile cases.

### 4. Make confidence reflect evidence quality

Primary files: `src/backend/ingestion/classifier.ts` and
`src/shared/contracts/classification.ts`.

- Keep confidence explicitly heuristic, not a calibrated probability.
- Adjust rule strength using usable HR/movement coverage, support across reps,
  segmentation reliability, and contradictory evidence. Do not penalize missing
  power or respiration, which are not required classification inputs.
- Persist the contributing measurements, selected thresholds, and fallback
  indicators using the existing evidence contract where possible. Add contract
  fields only if the existing numeric measurements cannot represent a real need.
- Keep automatic predictions separate from confirmed intent. Lower confidence
  must never erase or replace a manual label or failed-workout override.
- If explanations are surfaced in the UI, use backend message IDs and the
  English/Chinese dictionary conventions; avoid inline language conditionals.

Acceptance: missing/contradictory evidence cannot retain the same high confidence
as complete, consistent evidence. Serialized evidence round-trips through the API
and remains compatible with older saved summaries.

### 5. Validate and roll out

- Extend classifier/profile/robustness tests and import/replay integration tests.
  Cover irregular sampling, timer pauses, missing channels, clock offsets,
  sensor spikes, boundary crossings, HR lag, elevated recoveries, walking,
  terrain variation, manual overrides, and raw-record preservation.
- Replay the full evaluation set on a database copy. Review every label transition
  with its rule and trace measurements; explain intended changes and resolve
  regressions before rollout. Do not optimize for more quality-session labels.
- Verify held-out reviewed cases, import/replay agreement, repeatable replay,
  and acceptable replay runtime. Report counts and limitations rather than an
  accuracy percentage without trustworthy reference labels.
- Bump `ANALYSIS_REVISION` and register one derived-analysis upgrade after the
  final policy is settled. Use the existing backup, maintenance, chronological
  realignment, and failure-retry mechanisms; refresh dependent coaching too.
- Run `npx tsc --noEmit`, `npm run lint`, `npm test`, and
  `npm run i18n:unused` before every implementation commit.

## Boundaries and completion

No cloud model, new dependency, raw-telemetry rewrite, or new workout category
is required. Defer power/respiration rules, terrain-based HR corrections, and
fitness prediction until their data and calibration support a separate proposal.
Telemetry can describe execution; it cannot establish race intent, prescribed
targets, or why an athlete stopped without additional evidence.

The work is complete when the revised rules pass the regression suite, all
historical transitions are explainable, import and replay agree, overrides and
raw exports survive, and the versioned refresh updates dependent analyses.
