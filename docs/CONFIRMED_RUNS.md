# Athlete-confirmed workout regression data

Confirmed by the athlete on October 2, 2026, during the algorithm review follow-up.
These labels describe workout intent at the fitness level at that time. They are
ground truth for evaluation, not hardcoded date exceptions in production code.

| Local workout date | Confirmed label | Extra ground truth | Activity ID |
| --- | --- | --- | --- |
| July 5, 2025, 21:24 | Race / time trial | Poor, failed time trial attempt; not easy. The separate 21:09 warmup is not this case. | `garmin_3611393439_1120656269` |
| November 27, 2025 | VO2 intervals | **Three** actual intervals; a brief dip in the final rep is not a fourth recovery. | `garmin_3611393439_1133178573` |
| April 30, 2026 | VO2 intervals | VO2 at the fitness level at that time. | `garmin_3611393439_1146484256` |
| May 14, 2026 | VO2 intervals | VO2 at the fitness level at that time. | `garmin_3611393439_1147693479` |
| May 21, 2026 | Threshold | Correct threshold label; retain as a control against overclassifying VO2. | `garmin_3611393439_1148295667` |
| September 10, 2026 | Threshold | Three 15-minute reps, average pace about 4:40/km. Pace is descriptive, not a required training pace. | `24309364037` |

## Reusable fixture

`tests/fixtures/confirmed-runs.json` contains the original sparse elapsed-time,
HR, cadence, speed, distance, stance and vertical-oscillation samples plus workout
metadata and expected labels. GPS, weather, source filenames and athlete identity
are omitted. No resampling or synthetic HR ramps were added. The typed loader is
`tests/fixtures/confirmed-runs.ts`. The independent replay profile is max HR 203,
resting HR 54, baseline LT1 151 and LT2 176. LT1/LT2 here are estimates, not
historically measured thresholds for every workout.

`tests/integration/confirmed-runs.test.ts` exercises actual detection, confirmed
label persistence through repeated replay, coaching and failed-benchmark exclusion.
It also checks the three-rep November segmentation and the two threshold controls.

## Known automatic inference limitations

November now automatically qualifies as VO2: two separate reps of up to ten
minutes spend at least
two minutes and 25% of their duration at or above 91% of max HR. This permits
longer reps without interpreting isolated peaks as VO2. Its final short running
dip is merged, retaining three actual reps.

VO2 evidence must also exceed the athlete's LT2 training band. A high
threshold-to-max-HR ratio must not make ordinary threshold work qualify as VO2.
The independent synthetic profile suite covers six max/rest combinations,
three LT2 states, two recording densities and two speed scales (216 scenarios),
plus a fixed-max-HR threshold-shift case. These are mechanical safeguards,
not validation against independent real athletes.

### Historical classification limitation

The threshold tracker smooths dated LT1/LT2 observations, but full DB replay
currently freezes one independent HRR baseline for classification, then rebuilds
calibrations afterwards. This prevents leakage from the final cached profile but
does **not** classify each workout with its contemporaneous LT1/LT2. Import uses
the current profile. Changes in threshold HR over time are therefore only
partially supported end to end. Historical coaching also uses the current profile.

A complete fix needs chronological, reproducible replay: classify from reliable
observations strictly before the workout, calibrate afterwards, and fall back to
an explicitly estimated baseline when historical evidence is missing. It must
exclude the current workout and future observations from its own classification,
preserve confirmed intent, and test both rising and falling thresholds at fixed
max HR. Changing threshold estimates does not itself validate their accuracy.

April's longer bouts do not meet that sustained evidence test in two reps.
May 14's work averages of 168–170 bpm and peaks of 179–183 bpm do not
clear the fixed replay threshold/VO2 gates. July's failed attempt peaks at only
178 bpm and lacks sustained near-maximal evidence required for automatic race
inference. Whole-session averages further dilute work with warmup and recovery.

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
