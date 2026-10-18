# Confirmed workout regression policy

Confirmed workout labels describe intended effort at the fitness level at the
time. They provide evaluation ground truth, not date-specific production rules.
Personal activity identifiers, workout dates, telemetry, and performance profiles
belong in private evaluation data rather than public documentation.

Regression coverage should include failed race attempts, longer VO2 repetitions,
threshold controls, and disagreements between confirmed intent and automatic
classification. Use synthetic examples for public fixtures.

## Known automatic inference limitations

Longer VO2 repetitions can qualify when two separate reps of up to ten minutes
spend at least two minutes and 25% of their duration at or above 91% of max HR.
This permits longer reps without interpreting isolated peaks as VO2. A brief
running dip must not invent another recovery or repetition.

VO2 evidence must also exceed the athlete's LT2 training band. A high
threshold-to-max-HR ratio must not make ordinary threshold work qualify as VO2.
The independent synthetic profile suite covers six max/rest combinations,
three LT2 states, two recording densities and two speed scales (216 scenarios),
plus a fixed-max-HR threshold-shift case. These are mechanical safeguards,
not validation against independent real athletes.

### Historical LT1/LT2 support

Import, chronological replay, historical zones and coaching now resolve the
thresholds available **strictly before** each workout. Each replayed activity
commits its analysis and subsequent calibration together. Its own observation,
future observations and equivalent timestamps at the same instant cannot decide
its label. Backfilled or corrected imports also replay affected later workouts
inside the import transaction. A calibration failure rolls that transaction back.

LT1 and LT2 each use up to five usable observations from the preceding 45 days,
weighted by confidence and recency. If none are recent, the last three prior
observations remain the historical fallback. Without usable history, thresholds
are explicitly estimated from independent max/resting HR; cached current LT fields
cannot rewrite old workouts. Max/resting HR remain the athlete's current baseline,
not a reconstructed historical measurement. Old retained observations can be stale.

Workout-derived observations are rebuilt from qualifying early sustained work;
confirmed failures cannot calibrate thresholds. Dated external observations have
separate provenance and survive replay without a source workout. The synthetic
history fixtures use this provenance to represent known starting thresholds;
they do not claim those thresholds were inferred from test workouts.

`tests/integration/historical-fitness.test.ts` covers rising and falling LT1/LT2
at fixed max HR, import/replay/coaching agreement, historical zone refresh and
volume fallback, backfills and corrections, rejected observations, mixed timestamp
formats, failed-source exclusion, and transactional rollback. The recording suite
checks 1/5/15-second and uneven samples, larger unobserved gaps and sensor failures.
No individual date, fixed training pace or athlete-specific exception enters the
production classifier.

This supplies a causal estimate of contemporaneous fitness, not laboratory
measurement or proof of real-world classification accuracy. Easy running far below
LT1 cannot reveal a newly lower LT1, and HR without planned intent may not distinguish
an unsuccessful VO2 workout from achieved threshold stimulus. Independent athletes
and dated measured thresholds remain needed for accuracy validation.

Automatic predictions can disagree with confirmed intent when observed HR does
not establish the intended stimulus. Preserve confirmed labels independently;
a fixed-baseline regression profile is not a measured historical profile.

Confirmed intent therefore takes precedence in `run_type`; `auto_run_type` retains
the classifier's independent prediction. `manual_run_type` makes confirmation
persistent even when the automatic prediction temporarily agrees. A confirmed
failure is retained separately and excluded from threshold calibration. Reanalysis
must not erase these confirmations or pretend they were inferred from telemetry.

Future classifier work should evaluate these cases alongside easy, threshold and
race controls and independent athletes. Do not loosen an HR gate just to pass this
small set or use improving absolute pace as an intensity label. Within-run speed
contrast can help find boundaries; the threshold/VO2 intensity decision uses HR
and structure. Planned intent and achieved physiological stimulus may differ.
