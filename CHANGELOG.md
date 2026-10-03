# Changelog

## 1.3.0 — 2026-10-03

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
- Improve chart interactions, coaching explanations, translation coverage, and analysis consistency across imports and replays.

## Release notes workflow

The release workflow copies the latest entry above into the GitHub release and also generates GitHub history notes automatically. Keep the latest entry at the top; when publishing a new version, rename its heading to the version and date, then start a new Unreleased entry for subsequent work. Product-facing explanations are reviewed here because commit titles alone cannot reliably describe user-visible changes.
