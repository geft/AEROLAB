# Changelog

## 1.5.7 — 2026-11-03

### Analysis

- Keep a stride that ends in a walk. The burst was found and promoted, then discarded by the recovery check, which measured promptness from the last sample above stride pace: slowing from 5 m/s to a walk takes ten seconds and belongs to the stride. On the 3 Nov easy run that demoted a 26 s surge to ordinary work and absorbed it into a 77-minute recovery block. Promptness is now measured from the moment the athlete stopped running.
- Keep that check working across a stopped watch. Timer segments are analysed one at a time, so a stride that ended where the timer was stopped could not see the walking recorded in the next segment. The recovery check now reads the whole recording, while a work block still never spans an unobserved gap.
- Bound LT1 promotions and report a settled range. The aerobic reference took the longest bout of an effort, which on a long run is its most drifted part, and a promotion could lift LT1 by any amount below LT2 - 2. LT1 is now promoted from the low end of a settled range, requires a 10 bpm gap below a measured LT2, and moves at most 3 bpm unless a second confirmation period inside the 42-day window supports the jump.

### Browse

- Stop calling an easy run a warm-up. A run with no work rep and no stride is one segment, so it is both first and last and the warm-up rule claimed all of it, reporting 77 minutes as a warm-up. Warm-up and cool-down now require a work or stride segment to warm up for, and the segment names come from the dictionaries in both languages.

### Storage and speed

- Compact fragmented databases automatically. Imports wrote wide record rows with the raw FIT JSON and then cleared the column, leaving free space that only a full VACUUM reclaims; the fields worth keeping are now archived from the returned row ids, so new imports never create that space. The maintenance worker compacts a file of at least 64 MB when at least 15% is reclaimable, and the app shows an indeterminate status while it rewrites. Verified on a 586 MB copy: 2.1 s and 384 MB reclaimed.
- Export the history in seconds instead of minutes. The export resolved each run's thresholds as of its own date, which re-derived the whole history's threshold evidence and aerobic observations for every activity: 359 activities meant 359 identical passes. Both caches are now reused across an export, which cannot change the database anyway. 265 s becomes 27 s.

## 1.5.6 — 2026-11-02

### Speed

- Replay the history in seconds instead of minutes. A full realign spent almost all of its time recomputing threshold evidence rather than analysing: aerobic assessments reloaded and re-observed every run inside the 180-day window on each call, and the cache was keyed by the as-of window so it missed on every activity. Both caches now key on what actually determines the value, and decoded records are reused inside a declared batch. Measured on a 359-activity, 586 MB history: 17m35s to 21.7s, with identical stored results. The replay also reports phase timings and throttled progress with a per-activity rate and an ETA.

## 1.5.5 — 2026-11-01

### Analysis

- Detect a sustained effort that a recording break cuts in two. Contrast was measured separately inside each recording fragment, so a block split by a pause or a lost sample had no warmup or cooldown to compare against and was filed entirely as recovery: a 23 km long run with 17 km at marathon pace reported 27 seconds of work and was graded off-target as an aerobic over-intensity failure. The baseline now belongs to the session, while blocks still never span an unobserved gap.
- Classify a run of two hours or more that carries a sustained block between LT1 and the LT2 band as a marathon-pace long run rather than a tempo session, so it keeps its place in the long-run record and is graded on the block. The `Marathon Pace` tag, already in the tag vocabulary and read by the coach, is now derived from the recording instead of never being produced.

## 1.5.4 — 2026-10-27

### Garmin Connect sync

- Skip manually logged activities instead of reporting a sync error. A manual entry has no recording, so Garmin serves a session-only FIT with zero samples; the sync now lists it as **No file** and advances the backfill cursor past it without downloading anything.

### Key storage

- Encrypt the saved Garmin API key at rest with Windows DPAPI through a new `AEROLAB.Secret.exe` helper, so the credential file only works for the Windows account that saved it. Keys saved by earlier builds are encrypted in place on the next read.
- Report an undecryptable key in **Settings → Garmin Connect** and keep the ciphertext instead of deleting it, so a password reset or a copied profile cannot silently discard the key.
- Refuse to package a build without the helper, which would otherwise fall back to storing the key in plaintext.

## 1.5.3 — 2026-10-27

### In-app updates

- Add **Settings → Software Updates**: it shows the running build, checks GitHub Releases on demand and links to the release page.
- Add a **Check for updates on startup and install them automatically** option, enabled by default. A newer release is downloaded and verified against its published SHA-256 checksum, then the packaged launcher closes the window, runs the installer silently and relaunches AEROLAB.
- Keep a manual fallback: a build without the packaged launcher only reports the available version and links to GitHub, and every release publishes a `.sha256` file beside its installer.
- Fix the generic **Garmin sync failed** error. The installed build was older than the shared database schema, so its import path queried a column the newer migration had removed; this release matches the current schema.
- Keep the Garmin sync action and credentials panel out of snapshot builds, so read-only snapshots never expose or run the sync flow.
- Show full dates as `YYYY-MM-DD` in both languages instead of the unseparated `YYYYMMDD` form.
- Classify repeated upper-aerobic work reps as tempo sessions instead of off-target easy runs, and refresh saved analyses once when the app upgrades.
- Remove manual FIT/ZIP upload and Downloads folder scanning. Garmin Connect sync and the local import CLI remain the supported ways to add runs.
- Stop storing profile notes the app never read: shoe rotation, weekly schedule, race goals, home location, favourite route, body measurements, VO2 max and HR metric. The schema, `PATCH /api/profile` and existing databases now keep only the values that drive analysis.

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
