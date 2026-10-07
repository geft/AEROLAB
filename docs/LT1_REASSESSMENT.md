# LT1 reassessment from workout evidence

The LT1 working range is an estimate. It must not exclude a stable higher-HR
effort from reassessment merely because that effort exceeds the old range.
Sustained performance and low HR drift provide indirect evidence, but cannot
independently identify the first lactate threshold.

The thresholds API now returns `currentThresholds.lt1Assessment`. The assessment
reads telemetry for all long runs, plus easy and tempo sessions lasting at least
an hour. Failed workouts are excluded. It considers the preceding 180 days and
excludes future workouts for historical reads. No persisted calibration row is
required. Results are cached by database revision and date bounds.

## Observation screening

- Use observed adjacent intervals with valid HR and speed, respecting FIT timer
  segments and recording gaps. Weight values by time rather than sample count.
- Exclude the first and last ten minutes and the first minute of each running
  bout. Whole-bout comparisons retain the early HR response.
- Prefer a continuous settled bout lasting at least 30 minutes. Assess speed
  variation, terrain and first-half versus second-half speed/HR decoupling.
- Otherwise, evaluate at least two comparable settled running bouts of at least
  five minutes each and at least 15 minutes combined. Walking and settling time
  are excluded from pace and HR; they contribute to the recovery fraction.
  Recording gaps and timer pauses cannot masquerade as recovery evidence.
- Choose the longest qualifying continuous bout or the assisted group with the
  most running time, rather than the highest HR or the smallest local drift.
  A comparable earlier bout showing materially lower strain prevents selecting
  a late higher-HR plateau as fresh evidence.

The 5% decoupling bound, 10% speed-variation bound, 30 m/km terrain screen,
30% recovery bound and duration gates are conservative product rules, not
validated lactate-test cutoffs. They need independent-athlete validation.

## Corroboration and presentation

Three independent sessions with HR within 3 bpm and pace within 3% in a 42-day
window can establish a **stable-running reference**. Recovery-assisted sessions
can contribute, and their provenance remains visible. Lower-HR slower runs
contribute to the usable evidence count without reducing the reference. A
reference retains its age; corroboration older than 45 days is explicitly old.
Each activity contributes at most one observation.

A recent higher-HR faster effort beyond the corroborated reference appears as
a **candidate awaiting corroboration**. It does not automatically become a new
LT1 or Zone 2 ceiling. Recent endurance evidence, the older stable-running
reference and the accepted LT1 pace date are separate concepts.

Corroborated references now update the working LT1 HR and pace, including older
references whose age and lower confidence remain visible. A single candidate
cannot update working zones. A later external test takes precedence, and a
reference cannot exceed LT2 minus 2 bpm or lower a stronger accepted LT1.
Recovery-assisted references have confidence capped at 0.65; continuous references
use 0.8. These are product confidence scores, not probabilities.

The displayed working ceiling uses the accepted point estimate rather than
retaining a contradictory older range. Profile synchronization uses that point
and places Zone 3 one bpm above it. LT2 is unchanged. API reads remain read-only.
Historical coaching uses only strictly preceding evidence, excludes its own
activity, and falls back to independent baseline HR rather than today's saved
working range. The analysis revision marks old coaching for refresh.

The `aerobic-reference-v1` upgrade refreshes the preceding 180 days' stored zone
durations, training load and coaching together, using each workout's preceding
evidence. Older coaching refreshes on demand. Startup maintenance runs it once
after a safety backup, then refreshes the activity list.
It preserves workout classifications and calibration rows. This prevents stale
list verdicts from changing only when a workout is opened. The reassessment panel
uses separate reference and candidate cards, readable dates and an expandable
method explanation.

The derived-only refresh freezes threshold and aerobic observations for its
synchronous batch and discards those snapshots afterward, including on failure.
It reads shared evidence telemetry once, while historical date filtering still
runs for each workout. Snapshot callers must leave telemetry, classifications,
calibrations and profile fields unchanged. Ordinary API caches retain database
revision and transaction invalidation.

## Validation

Regression coverage includes independent corroboration, one-run candidates,
slow-run support, duplicate and future sources, older-reference freshness,
recovery provenance, time weighting, gaps, timer pauses, strain, speed and
terrain screens, database cache invalidation and rollback, read-only API
behavior, and UI wording. A read-only replay against the user's configured
database provides an additional behavior check; personal data is not a fixture.
