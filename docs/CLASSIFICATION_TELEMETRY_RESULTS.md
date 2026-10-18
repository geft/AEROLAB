# Classification telemetry execution results

Implemented October 4, 2026. The refresh revision is
`classification-telemetry-v1`. The evaluation command opens the selected live
database read only; all evaluation and chronological replays use online SQLite
backups in ignored `output/classification/`. The running development application
completed the registered maintenance refresh at 16:51 Singapore time, using the
existing backup, transaction, failure retry and coaching refresh mechanisms.

## Policy

Intensity now uses adjacent observed running intervals, with both endpoints
showing running movement and valid HR. Timer segments and gaps over 15 seconds
break evidence. Missing cadence uses the shared speed fallback where available;
missing both channels remains unknown. Window clipping and linear HR boundary
crossings preserve duration weighting under irregular sampling.

Continuous threshold requires at least 120 seconds of valid running HR, 60% HR
coverage, and 35% threshold exposure. Work reps require 60% valid running HR
coverage. Threshold reps need 50% band exposure, or a mean within 0.5 bpm of the
band floor with at least 25% exposure. The latter preserves threshold controls
at the integer-summary rounding boundary without allowing a peak alone to
certify a rep.

VO2 requires at least two work reps, each with at least 20 seconds and 20% of
the rep above the athlete-relative VO2 boundary, including a continuous 15-second
portion. Reps longer than six minutes retain the more conservative 120-second,
25% exposure requirement, a ten-minute maximum, and repeated recovery structure.
Short-rep lag can qualify through sustained late-rep exposure; unobserved intensity
and elevated recoveries cannot establish VO2. Movement thresholds distinguish
movement only; absolute training pace and watts never decide intensity.

Confidence remains heuristic. Coverage, repeated support, recording gaps, speed
fallback and rep-summary contradictions reduce rule strength. Numeric evidence
stores per-rep means, observed HR seconds, band exposure, sustained VO2 portions,
coverage, fallback indicators and selected policy thresholds. Existing evidence
contracts remain compatible. Automatic predictions and manual intent remain separate.

## Evaluation and transition review

Fixed historical profiles isolate classifier changes; a separate chronological
replay rebuilds threshold calibration, load, tags, segments, and coaching. All
activities replayed without skips or failures. Individual activity identifiers,
dates, heart-rate evidence, and label transitions are retained only in private
evaluation reports.
A second replay yields identical labels and
dependent analyses, excluding generated row IDs and timestamps. SHA-256 comparisons
verify unchanged raw telemetry and original FIT data; override values are unchanged.
Re-evaluation through the shared import analysis pipeline agrees with all replayed
automatic and effective labels. Two replays plus shared-pipeline verification take
approximately 39 seconds on this machine, before integrity hashing overhead.

Evaluation should include race/failure, longer VO2, and threshold intent controls
alongside independent profile matrices and benchmark suites. Synthetic cases
cover easy/recovery, long, tempo, walking, sensor peaks, missing channels, HR lag,
pauses, clock offsets, gaps, and irregular sampling. Intent confirmations do not
imply that automatic predictions can always infer intent. No accuracy percentage
is claimed.

Power remains deferred. Reports should measure active observed coverage, device
manufacturer/product provenance, and per-work/recovery means for optional power
audits. Device metadata alone does not establish the source of individual power
readings. No power or respiration input changes classification or confidence.

The initial pre-refresh comparison is `final.json` and
`final-chronological.json`. The later `settled.json` still compares fixed profiles
to the original baseline; its chronological copy starts from the already
refreshed live database, so it should introduce no further effective label changes.

Development workspace verification: TypeScript passes; ESLint reports zero errors
and warnings; all 1,268 tests across 122 files pass; all 816 dictionary keys are
referenced. The isolated commit also passes all four checks: 1,246 tests across
120 files and all 814 dictionary keys, excluding unrelated pending work.
The final `settled-chronological.json` verifies the full evaluation set, unchanged raw
data and overrides, repeatable dependent analyses, and shared-pipeline agreement.

## Reproduce

Before changing classifier policy, run:

```bash
npm run classification:report -- output/classification/baseline.json
```

After changing policy, use a new destination:

```bash
npm run classification:report -- output/classification/final.json output/classification/baseline.json
```

The command refuses existing database copies. The fixed-profile JSON includes one
row per changed classification, with before/after evidence. The chronological JSON
includes every rebuilt row, transitions, runtime, integrity checks and repeated
replay checks. Reports contain local workout data and remain ignored.
