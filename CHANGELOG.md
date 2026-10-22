# Changelog

## Unreleased

- Keep the Garmin sync action and credentials panel out of snapshot builds, so read-only snapshots never expose or run the sync flow.

## 1.5.0 — 2026-10-22

### Garmin Connect sync

- Add a **Sync with Garmin** action to the header. It downloads original FIT files from Garmin Connect in batches of 10, importing newer runs first and then backfilling older history without gaps.
- Keep the Garmin Personal API key out of the database. Configure it in Settings, or provide `GARMIN_API_KEY` through the environment. `GARMIN_API_KEY_EXPIRY` supplies the expiry date for the one-month warning without creating a credentials file.
- Resume safely after failures or rate limits: the backfill cursor only advances past activities that were fully processed, so retries do not skip runs.
- Show sync progress, per-activity results, and bilingual key and expiry guidance in English and Chinese.

## 1.4.1 — 2026-10-09

### Run–walk evidence

- Show usable run–walk observations as hollow supporting markers alongside accepted threshold trends, including evidence that has not yet established an estimate. Default the trend to all history, show running-only metrics and lower confidence on selection, and format full dates as YYYYMMDD in both languages.

- Retain usable run–walk LT1 evidence at lower confidence. Measure settled running sections independently of walking recoveries, compare recovery patterns across sessions, and require three sessions to establish an estimate or four to update one. Recovery-assisted estimates cannot replace continuous-running or external-test evidence. Preserve original observations and label accepted run–walk estimates in English and Chinese.

## 1.4.0 — 2026-10-05

### Threshold evidence and aerobic pace gap

- Separate individual aerobic and threshold observations from accepted LT1/LT2 pace estimates. Inconclusive runs retain the last supported value instead of pulling it toward slower easy-run paces.
- Require two comparable independent efforts to establish or improve an estimate, and three to accept a slower pace. Check heart-rate comparability and available sensor temperature; do not invent weather corrections when information is missing.
- Keep the LT1 heart-rate ceiling independent of ordinary workout averages so easier runs cannot repeatedly lower it. Dated external tests remain authoritative, and HR-only tests preserve previously supported pace evidence and its date.
- Screen historical evidence using continuous telemetry, warmup exclusion, pace stability, terrain, and cardiac drift. LT2 interval summaries alone, interrupted reps, and long recoveries cannot establish an accepted threshold.
- Show supported, held, stale, and insufficient-evidence states with evidence dates and supporting effort counts. Historical trend estimates use only observations available at that date; original observations and telemetry remain intact.
- Replace fixed aerobic-gap fitness grades with an explicitly estimated LT1–LT2 pace difference. Keep synthetic LT2 prediction fallbacks out of accepted threshold cards and pace-gap calculations.
- Display pace units once in the bilingual gap explanation.
- Refresh stale coaching summaries against the revised threshold policy when viewed. Add regression coverage for corroboration, declines, recovery runs, telemetry interruptions, external tests, and database rollback safety.

## 1.3.0 — 2026-10-04

### Phone snapshots

- Use MessagePack with gzip level 9 and compact metric arrays for smaller snapshots.
- Sample chart telemetry every 30 seconds while preserving short efforts, interval boundaries, stops, and chart extrema. Analysis, splits, and coaching summaries retain their original detail.
- Remove unused telemetry and desktop CSV export metadata from phone snapshots; CSV export remains available on desktop.
- Load and decode snapshots in a worker with a linear progress bar and download percentages when the transfer size is known.
- Cache snapshots and the complete app shell so phone shortcuts reopen offline, including previously unvisited tabs.
- Use elapsed time for chart positions and touch readouts with unevenly sampled telemetry.
- Adopt binary snapshots exclusively; regenerate older JSON snapshots before deploying this viewer.

### Desktop and analysis

- Compress stored FIT data losslessly and checkpoint the SQLite WAL automatically.
- Add weekly startup database snapshots and improve background FIT/ZIP imports.
- Improve workout classification using FIT laps, timer events, time-weighted telemetry, and individual thresholds; add Tempo filtering and a 100-minute long-run cutoff.
- Use running-only heart-rate exposure so walking, standing, pauses, and recording gaps cannot distort classification. Require sustained high-intensity evidence inside repeated work reps for VO2 labels, and adjust confidence for coverage and contradictory evidence.
- Refresh historical classification and dependent coaching while preserving confirmed labels and original telemetry. Validate replay and threshold classification against a private evaluation set.
- Improve chart interactions, coaching explanations, translation coverage, and analysis consistency across imports and replays.

## Release notes workflow

The release workflow copies the latest entry above into the GitHub release and also generates GitHub history notes automatically. Keep the latest entry at the top; when publishing a new version, rename its heading to the version and date, then start a new Unreleased entry for subsequent work. Product-facing explanations are reviewed here because commit titles alone cannot reliably describe user-visible changes.
