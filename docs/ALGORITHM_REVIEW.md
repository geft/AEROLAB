# Algorithm review — 2026-10-01

Reviewed the distance-based best efforts and splits, running economy,
training-load integration and decay, threshold smoothing and calibration,
workout detection/classification, prescription inference, and race prediction
code. This was a source and numerical-regression review; it did not validate
physiological estimates against laboratory measurements or race outcomes.

## Implemented improvements

| Algorithm | Confirmed problem | Change |
| --- | --- | --- |
| Best efforts | Selecting the first recorded point beyond the target charged for extra distance. Checking only recorded starts also missed windows ending at a recorded point. | Interpolate both start-anchored and finish-anchored windows using two linear scans. Preserve elapsed pause time and separate invalid readings, time reversals and distance resets. Use telemetry with two or more points instead of requiring six. |
| Distance splits | Advancing to the sample after a split discarded the connecting interval. Boundaries overshot 1 km and sparse traces could produce a fabricated 1 m lap. | Divide each original interval at exact distance boundaries. Preserve its distance and elapsed time, handle multiple boundaries in one interval, and omit empty laps. Derive pace from distance/time; integrate sensor averages over elapsed time, with linear interpolation between valid endpoints. |
| Training status | Chronic load was seeded at zero at a date determined by chart length. Identical steady training produced current chronic load 354 for a 7-day chart and 451 for a 180-day chart. Older load disappeared prematurely. | Aggregate all past training by day in SQLite and seed the chart with exactly decayed older contributions. Materialize only the required timeline. Use one application clock and exclude future calendar days. Make the recent-activity baseline gate independent of chart length. |
| Rolling thresholds | `confidence || 0.85` converted zero-confidence evidence to 85% confidence. Rejected entries could consume the five-observation window. Non-finite pace could propagate into results. | Reject unusable HR/confidence/date evidence before selecting observations, preserve real confidence weights, and omit invalid pace while retaining valid HR evidence. Parse each observation date once. |

The distance algorithms assume linear movement between valid samples; this
improves boundary calculations without reconstructing unrecorded accelerations.
Best-effort scanning remains O(n). Split processing is O(n + emitted splits).
Both share the same distance-trace validation helper. They deliberately break
the trace at missing distance/time, non-increasing time, or decreasing distance;
partial split fragments may therefore appear on damaged recordings.

## Follow-up implementation

All five remaining implementation opportunities were addressed in the follow-up:

| Area | Implemented change |
| --- | --- |
| Economy and adaptive warm-up | Integrate sensor values over adjacent observed intervals. Compute efficiency and meters per beat from paired speed/HR evidence; split the body by observed running duration, including partial intervals at the midpoint. Express noise guard, warm-up windows and scan cap in active seconds. Avoid comparing HR across pauses or sensor gaps. Return the half-run efficiency values. Remove the fabricated first second and stop capping long missing intervals into invented running time. |
| Interval detection and LT2 | Replace sample admission gates, empirical percentiles, burst shares, walking counts and sensor averages with duration-weighted evidence. Split traces at invalid/reversed time or recording gaps. Accept normal smart-recording intervals through 15 seconds in stride and race recovery checks. LT2 strips acceleration/HR ramps by time, integrates clipped linear evidence, and requires at least 80% speed and HR coverage after each ramp. Use stored interval summaries only when records are absent, rather than treating damaged telemetry as absent. |
| Prediction evidence | Keep the existing distance factors and pace conversions. Only dated 5 km evidence from the preceding 90 days can replace calibrated LT2, and it must be at least as recent as the calibration. Undated profile PBs can seed estimated predictions but cannot replace calibrated LT2. Bound the recent-run fallback to the same period, exclude future evidence, and handle local/offset timestamps consistently. Return prediction source, benchmark source/date/activity, and whether that benchmark was used in the API. |
| Best-effort provenance | Add an explicit measured/estimated source to each result. Show bilingual labels and explanations for interpolated measured segments versus whole-activity mean-pace estimates. Older offline snapshots without this field remain supported without claiming either source. |
| Training-load interpretation | Describe the existing calculation as scaled Banister TRIMP in source comments and both UI dictionaries; remove claims of a calibrated Firstbeat/Garmin EPOC equivalent. Numerical load values are unchanged. |

The 15-second observation limit, 80% calibration coverage and 90-day benchmark
freshness window are explicit evidence policies, not laboratory-calibrated
physiological constants. Sensor integration assumes linear values between valid
endpoints; movement transitions use the current sample's state. Missing
intervals provide no evidence, and no algorithm can recover a short stride that
a device did not record. Time-based processing reduces density bias while
preserving the existing stride duration/distance gates and recovery requirement.

The race pace model has not been changed or validated against held-out real
performances. That remains a prerequisite for future changes to distance
factors, benchmark-to-LT2 conversion, or physiological VO2 estimates. This
follow-up improves evidence selection and provenance without claiming greater
predictive accuracy or device EPOC equivalence.

## Verification and stored data

Regression tests cover exact boundaries, sparse samples, pauses, distance
resets, invalid telemetry, weighted split statistics, short/long chart agreement,
older-load decay, future days, and rejected threshold evidence. The best-effort
implementation also matches an independent exhaustive interpolation reference
on 40 deterministic irregular traces containing stationary plateaus.

Required checks: `npx tsc --noEmit`, `npm run lint`, `npm test`, and
`npm run i18n:unused`.

The initial review passed 86 test files / 706 tests. Follow-up regression
coverage includes 1-second, 5/10/15-second and uneven recording densities;
threshold/VO2/stride benchmark fixtures; paused and missing-sensor traces;
sparse 5-minute LT2 reps; stale/future/undated benchmarks; same-day local/ISO
timestamps; measured/estimated provenance; and bilingual UI labels.

Final follow-up checks passed: 88 test files / 722 tests, zero TypeScript
errors, zero lint errors (115 existing warnings), and all 733 dictionary keys
referenced. `git diff --check` also passed.

Best efforts, prediction evidence, training status, and threshold smoothing are
calculated on reads. Economy, kilometre splits, detected intervals and calibration
are stored during import/reanalysis, so existing activities need reanalysis to
acquire the corrected stored metrics. These changes do not automatically mutate
the user's database. The existing `npm run realign` command backs up the selected
database before recomputing all activity analysis, including classification and
calibration; it is broader than a split-only refresh.

## Athlete-confirmed historical cases (October 2, 2026)

The [confirmed-workout policy](CONFIRMED_RUNS.md) covers failed race attempts,
longer VO2 repetitions, and threshold controls. Keep personal evaluation data
private. Confirmed intent survives replay and force reimport; the independent
automatic prediction remains available. Confirmed failures do not supply
threshold calibrations.

Longer VO2 bouts of up to ten minutes can qualify when two separate reps each spend at least 120
seconds and 25% of their duration at or above 91% of athlete max HR. This is an
explicit evidence policy, not a validated physiological boundary; it avoids a
six-minute duration ceiling and does not infer VO2 from isolated peaks. A brief
running dip before a shorter finishing portion no longer invents another rep.
Workout intent still requires confirmation where recorded HR cannot support
automatic inference.


## Date-specific fitness and regression expansion (October 2, 2026)

The historical threshold contract and known inference limits are documented in
[CONFIRMED_RUNS.md](CONFIRMED_RUNS.md). Import, replay and coaching share a strict
prior-evidence lookup. Replay rebuilds calibration immediately after each activity,
and import backfills/corrections atomically refresh affected later workouts. The
`historical-fitness-v1` migration applies this once to existing databases with a
pre-migration safety snapshot; subsequent opens do not replay unchanged history.

The additional 30 tests cover both directions of LT1/LT2 change at stable max HR,
causality, mixed timestamp formats, backfilled/corrected imports, repeat/partial
replay, historical coaching/zones/volume, rejected and corrupt observations,
failed calibration rollback, migration persistence, and recording-density/gap
behavior. Normal 15-second samples now count fully in training load and zones;
larger gaps and invalid HR do not supply invented duration or LT2 evidence.

Private database replay completed without failed or skipped activities. Repeating
the replay on a backup reproduced labels, calibrations, stored zones, and
coaching while retaining confirmations. Individual activity dates, performance
details, and label transitions are retained only in private evaluation reports.

Changed algorithm predictions are not newly confirmed ground truth. Preserve
confirmed intent and independent automatic labels so disagreements remain
visible rather than being presented as classification accuracy.

Verification: 92 test files / 981 tests, zero TypeScript errors, zero lint errors
(115 existing warnings), all 733 dictionary keys referenced, and `git diff --check`.
