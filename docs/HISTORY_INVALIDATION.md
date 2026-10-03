# History invalidation policy

`application/analysis/rebuild-history.ts` owns affected-range selection and strict chronological rebuilding. It includes workouts at the same timestamp, retains external measurements and athlete confirmations, removes affected workout-derived observations, then rebuilds classification, tags, intervals, splits, calibration, load/zones, profile caches and coaching.

| Change | Refresh scope |
| --- | --- |
| Raw import correction or moved workout date | From the earliest old/new date, within the import transaction |
| Batch import/backfill | From the earliest changed date, once after all successful file writes |
| Confirmed workout type or failed-workout status | Edited workout and later history, within the edit transaction |
| Baseline HR/demographic change | All workout history, in the existing profile-maintenance worker |
| Cosmetic title/tags | Edited workout coaching only; no physiological replay |
| Fetched weather refresh | Edited workout and all later coaching, in the weather-write transaction; no physiological replay |
| Other profile fields | Coaching refresh through the existing profile-maintenance worker |

Strict corrections roll back the complete affected analysis when replay or final profile/coaching synchronization fails. Standalone maintenance retains the realigner's existing best-effort mode. Empty affected ranges perform no replay. The background profile job reports errors through existing maintenance status; its analysis transaction does not undo the previously saved profile input.

Existing no-telemetry/very-short-recording skip behavior is retained. The coordinator removes obsolete affected workout calibrations even when their source cannot be reconstructed. Timer-aware analysis is shared by physiological consumers. Weather refresh updates dependent coaching atomically, including the recent-weather baseline; a dependent-summary failure rolls back the weather write. This does not add automatic weather lookups.
