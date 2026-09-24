# Security and architecture audit plan

## Goal and boundaries

Keep AEROLAB local-first, offline-capable, and backed by one SQLite database. The database path is a per-build preference and can point outside the app. Development and desktop builds may independently select the same file; neither configures the other. Weather remains optional: Garmin temperature is retained as device-sensor data, while ambient temperature and humidity come only from an explicit user-requested lookup.

This plan separates protections already implemented from the remaining architectural work. It does not propose a cloud service, a second database, or a wholesale rewrite.

## Completed foundation

| Area | Current state | Evidence |
| --- | --- | --- |
| Local browser boundary | Loopback Host and Origin checks; packaged API session from a one-time launch URL; development Vite origin allowed | `src/backend/server.ts`, `scripts/launch-chrome-app.js`, `tests/integration/local-session.test.ts` |
| Input limits | FIT declared record length checked before parsing; route-specific JSON limits; bounded binary restore | `src/backend/ingestion/fit-parser.ts`, `src/backend/server.ts`, `src/backend/routes/database.ts` |
| Weather privacy | No automatic lookup on import or startup; ambient lookup is an explicit workout action; Garmin sensor temperature remains distinct | `src/backend/physiology/weather.ts`, `src/frontend/components/browse/ActivityWeatherCard.tsx` |
| Database location | Per-build location preference outside the app, selected in Settings; consistent SQLite copy for a new file | `src/backend/db/path.ts`, `src/frontend/components/DatabaseLocation.tsx`, `tests/integration/database-location.test.ts` |
| Release checks | TypeScript, lint, tests, and i18n checks before packaging; publishing permission confined to the publish job | `.github/workflows/release.yml` |

## Remaining work, in delivery order

### 1. Make database migrations explicit and recoverable — P1

**Why:** `src/backend/db/client.ts` opens the connection, extends schema, backfills derived values, deduplicates, realigns, cleans legacy tables, and optimizes the database. The current `user_version = 1` marker covers several separate operations. A later change or partial failure is hard to identify and retry independently.

**Work:**

1. Move schema changes and data backfills into named, ordered migrations. Record each completed migration in SQLite and give every migration a clear transaction boundary. Keep the existing database readable throughout the transition.
2. Take a SQLite snapshot before a migration that rewrites existing activity data. Report failure with the migration name and preserve the last good database.
3. Leave `getDatabase()` responsible for selecting and opening the file. Move optional derived-data refreshes out of connection initialization.

**Done when:** a fresh database, an older fixture, and an interrupted migration fixture all open predictably; rerunning startup does not repeat completed work; a failed migration is visible and retryable without data loss.

### 2. Separate database file operations from HTTP routes — P1

**Why:** `src/backend/routes/database.ts` currently combines backup policy, native pickers, file-path validation, download, restore, location changes, and HTTP responses. Restore and location changes need one consistent rule for the active connection and its WAL files.

**Work:**

1. Extract a database storage service for snapshot, validate, copy, restore, and location selection. Keep routes as input validation and response mapping.
2. Define typed results and stable error codes for invalid files, busy databases, path changes, and insufficient disk space. Map them to both UI dictionaries.
3. Serialize destructive database operations. Ensure restore or relocation cannot race another restore or a long maintenance write; preserve rollback and safety snapshots.

**Done when:** the same service is exercised through API integration tests for valid files, corrupt files, existing destinations, interrupted copy/restore, and WAL-backed databases; no route computes a database path independently of the active connection.

### 3. Move long derived-data work out of request handling — P1

**Why:** `better-sqlite3` calls are synchronous. Initial backfill, realignment, coach-summary synchronization, and large imports can block the local API even though they are not needed to answer an ordinary status request.

**Work:**

1. Measure startup, import, restore, and realignment on representative small and large databases before changing behavior.
2. Keep essential schema migration at startup, but run optional recomputation in a single local worker or job process with a one-writer policy. Persist progress and outcome locally so an interrupted job can resume or be retried.
3. Have affected routes return job status rather than hold a request open. Show progress and errors in the UI without exposing developer-only diagnostics in release builds.

**Done when:** status and browsing remain responsive during a large recomputation; duplicate requests do not launch competing writers; restart after interruption has a deterministic recovery path. No cloud queue is introduced.

### 4. Establish typed domain and API boundaries — P2

**Why:** database rows, parser output, and coach calculations pass through many `any` values. Frontend components also call `fetch` directly and interpret errors separately. This makes schema and API changes difficult to audit.

**Work:**

1. Start with the ingestion-to-activity pipeline. Define typed raw record, normalized record, database row, and API response shapes with explicit conversion functions. Validate untrusted FIT, CSV, and request data at entry points.
2. Extract one thin activity service from `routes/activities.ts` and one backup/location service from `routes/database.ts`; avoid a framework-wide repository abstraction until the slices prove useful.
3. Add a small typed frontend API client for response parsing, cancellation, and stable error codes. Refactor the database settings UI first, then the activity views. Keep all displayed copy in the English and Chinese dictionaries.

**Done when:** the chosen slices have no untyped payload handoffs, routes contain no physiological calculations, and frontend error handling uses one consistent contract.

### 5. Consolidate optional weather provenance — P2

**Why:** Garmin device temperature and fetched ambient weather have different meanings. Heat scoring must never silently treat one as the other.

**Work:** store or expose source, observation time, and availability for temperature values; keep ambient lookup opt-in; provide a clear UI state when only the device reading exists. Review existing rows during migration so unknown historical values are not relabeled as ambient.

**Done when:** import and offline use never make a weather request; heat scoring uses ambient data only when present; tests cover device-only, ambient-only, both, and neither.

### 6. Keep documentation and release behavior aligned — P2

**Why:** some older README and `AGENTS.md` text still describes `data/runs.db` as the only location. A local release needs the same database and session behavior that development tests cover.

**Work:** update path and backup guidance; add a packaged-app smoke test that launches with a temporary profile and database, checks session-gated API access, verifies the selected database, and closes cleanly. Keep developer routes absent from the packaged bundle.

**Done when:** documentation matches the Settings flow and defaults, and the release smoke test verifies the built artifact rather than only source modules.

## Progress log

Current working tree, verified together: `npx tsc --noEmit` 0 errors,
`npm run lint -- --quiet` 0 errors (warnings remain in the tracked backlog),
`npm test` 69 files / 482 tests green, `npm run i18n:unused` reports all 635
dictionary keys referenced. Both smoke modes pass against real backends:
`node scripts/smoke-packaged.js --dev` (tsx development entry) and
`npm run smoke:packaged` (bundled `dist-backend/server.cjs`).

| Item | Status | Evidence |
| --- | --- | --- |
| 1. Explicit, recoverable migrations | Mostly done | `src/backend/db/migrations.ts`: named checkpoints in `schema_migrations`, one transaction per migration, a `VACUUM INTO` safety snapshot before the first data-rewriting change, and `user_version >= 1` preserved as the legacy marker; `tests/unit/migrations.test.ts`. Remaining: the idempotent `ALTER TABLE` column additions still live inline in `src/backend/db/client.ts` and re-run on every open instead of being checkpointed. |
| 2. Storage service apart from routes | Done | `src/backend/db/storage.ts` owns snapshot, validate, copy and restore plus the one-operation-at-a-time guard; `src/backend/routes/database.ts` keeps input validation and stable error codes (`INVALID_DATABASE`, `INVALID_FOLDER`, `LOCATION_CHANGED`, `DATABASE_PATH_OVERRIDE`) that `DatabaseLocation.tsx` maps to dictionary copy; `tests/integration/database-location.test.ts`, `tests/integration/database-backup.test.ts`. |
| 3. Derived work off the request path | Done | `src/backend/jobs/maintenance.ts` runs one worker at a time, queues a profile recompute rather than starting a second writer, and persists status to `maintenance-status.json` (a stale `running` reads back as `interrupted`, so the next launch retries); schema setup stays synchronous in `getDatabase()` behind `AEROLAB_DEFER_MIGRATIONS=1`; `GET /api/system/maintenance` and the `DatabaseLocation` progress copy surface it; the development entry bundles the worker on startup so `.ts` imports resolve inside worker threads. |
| 4. Typed domain and API boundaries | In progress | `src/backend/services/{activity,profile,thresholds}-service.ts` now own the queries and physiological calculations; their routes no longer import `physiology/*`. All frontend API calls go through `src/frontend/api/client.ts`, with coded errors resolved through bilingual copy. Shared response shapes and focused client/service tests cover these slices. FIT decoded messages now have numeric fields and reject invalid or missing start timestamps. Remaining: replace loose database-row `any` values with validated row conversions, and tighten service request inputs and result mappings before declaring the boundary fully typed. |
| 5. Weather provenance | Done | `activities.weather_source` records Open-Meteo fetches; `verifiedAmbientTemperature()` keeps unknown legacy rows out of heat scoring; `ActivityWeatherCard` renders verified ambient, device-only, both and unverified-stored states from dictionary copy; `tests/unit/weather-provenance.test.ts` and `tests/ui/weather-card.test.tsx` cover device-only, ambient-only, both, neither and the legacy unverified row; import and startup still make no weather request. |
| 6. Docs and release alignment | Done | README documents the Settings database-location flow, per-build preferences, `npm run db:location`, the 5-snapshot rotation and the 256 MB restore limit; `AGENTS.md` no longer claims `data/runs.db` is the only location; `scripts/smoke-packaged.js` launches the built backend with a temporary profile and database, asserts session gating (401, then a bootstrap cookie), the opened database path, the startup and profile maintenance jobs, absent developer routes in production, and a clean shutdown. |

Next delivery step: finish item 4's ingestion and database-row typing. The
database storage service is already in `src/backend/db/storage.ts`; the route
and frontend client migrations are complete.

## Delivery gates

- Make each numbered item a reviewable change with a data-migration note when persistent data changes.
- Before every commit, run `npx tsc --noEmit`, `npm run lint` with zero errors, `npm test`, and `npm run i18n:unused` as required by `AGENTS.md`.
- For file-moving or restore changes, test with disposable SQLite fixtures, including a WAL-backed database. Never use the user's workout database as a test fixture.
- Preserve local-only operation and the existing single-database model throughout.
