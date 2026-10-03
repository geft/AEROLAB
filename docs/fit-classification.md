# FIT telemetry and classification

Implemented October 3, 2026. Local database audit: 339 runs, including 196 with
FIT metadata from February 2, 2026 onward. Earlier runs keep telemetry-only
detection; availability is checked per activity rather than by a date cutoff.

## Incorporated

- Timer start/stop events annotate a separate analysis copy of the records.
  Paused HR cannot contribute to classification zone occupancy or recovery
  exposure, and a pause breaks continuous race evidence and interval detection.
  Explicit timer pauses also contribute to the saved pause breakdown.
  Original records and FIT bytes remain available for export.
- UTC event/lap timestamps are aligned with exported local record timestamps,
  accounting for the UTC offset and a delayed first sample. Whole-second FIT
  timestamps can overlap fractional lap durations by less than a second;
  those boundaries are clipped rather than rejected.
- Recorded active/recovery/rest/warmup/cooldown laps refine interval boundaries
  only when record-level running and profile-relative HR validate quality work.
  Repeated work needs an explicit recovery; a single sustained bout needs a
  warmup/cooldown. All-active distance autolaps cannot manufacture repetitions.
  Pauses and missing records still split the trace. Invalid/incomplete lap data
  falls back to telemetry detection.
- Once quality structure is validated, lower-HR active repetitions are retained
  so late fade and missed stimulus remain visible. Existing detected strides
  inside warmups/recoveries are preserved. HR and the historical athlete profile
  still determine threshold, VO2, race, easy, and recovery labels.
- Valid measured step length and vertical ratio now take precedence in interval
  summaries, with derived values as fallback. These describe running dynamics;
  they do not independently determine workout intensity.
- Import and chronological replay use the same FIT analysis. The
  `fit-structure-v1` migration backs up and replays existing histories once;
  manual labels and failed-workout overrides retain precedence.

FIT timer events represent recording state; lap intensity represents workout
structure. See Garmin's [activity-file documentation](https://developer.garmin.com/fit/articles/file-types/activity.html)
and [workout intensity documentation](https://developer.garmin.com/fit/articles/file-types/workout.html).

## Other stored telemetry

The audit found 204,499 records with measured step length and vertical ratio.
Power, respiration rate, and core temperature had zero populated records.
The replay query now includes all additional typed telemetry columns so these
fields remain available for future analysis without reading large raw FIT JSON.

| Telemetry | Current use / refinement decision |
| --- | --- |
| Cadence + fractional cadence | Native FIT import already combines and converts cadence into steps/minute. Do not add the fraction a second time. Cadence continues to distinguish running, walking, and strides. |
| Ground contact time + vertical oscillation | Already support movement detection and economy/interval summaries. Retain those uses. |
| Step length + vertical ratio | Measured values now refine interval summaries; keep derived fallback for older runs. No universal intensity cutoffs. |
| Ground contact balance | Preserved and restored to replay. Candidate for within-run form trends with sufficient coverage; no workout label rule added. |
| Running power | Preserved and restored to replay. Future candidate for relative work/recovery contrast after data and device provenance are available; no absolute watt thresholds or HR replacement added. |
| Respiration rate | Preserved and restored to replay. Needs valid coverage and an athlete baseline before it can corroborate sustained effort. No rule added with an empty dataset. |
| Core temperature | Preserved and restored to replay. Potential heat-context input; no intensity correction added with an empty dataset. |
| Ambient temperature + elevation/GPS | Already available to existing analysis. Sensor exposure, terrain, and weather can affect effort; adding an HR correction requires separate calibration and validation. |
| Workout steps + lap workout-step indexes | Preserved in FIT metadata. Lap intensity supplies observed structure now; planned targets could later improve intent/adherence reporting without treating the plan as completed work. |
| Device, developer fields, HRV, training effect | Preserved metadata. Future provenance/context inputs; proprietary summary scores and workout HRV do not replace the local physiological classifier. |

Timer-aware analysis now also reaches training load, continuous/rep calibration,
coaching and query fallbacks. Speed repair operates on an analysis copy and cannot
cross a recording gap or timer segment. Historical detail charts use the same
workout-date HR profile as coaching. Raw export telemetry remains untouched.

## Verification

Regression coverage checks timezone alignment, delayed first samples, short and
long pauses, continuous-race breaks, HR lag, ordinary/easy laps, fractional lap
boundaries, failed late reps, measured dynamics fallback, manual overrides,
raw-record retention, and repeatable import/replay. Real history is also replayed
on a database copy before applying the final algorithm to the selected database.
