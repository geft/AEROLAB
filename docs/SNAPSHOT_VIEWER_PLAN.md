# Read-only phone snapshot plan

## Goal

Provide a phone-friendly, read-only copy of AEROLAB that can be hosted as a static Vercel deployment, while the desktop app remains the source of truth and continues to use its local SQLite database. Updating the hosted copy is an explicit export and deploy; no live database or database credentials are hosted.

## Design

- Add an explicit app target/mode (`desktop` or `snapshot`), selected at build time or through a validated runtime config. Do not infer it from the user agent, screen size, or URL heuristics.
- Keep the existing desktop build and its database/API behavior intact.
- Add a snapshot export command that reads the active database with a consistent SQLite snapshot and writes a versioned, read-only JSON read model to an ignored generated-artifact directory. Include a schema version and export timestamp. Do not include the `.db` file, API/session secrets, or other credentials in the deployment artifact.
- Build the snapshot frontend against the same view components where practical, using a snapshot-backed API client that serves only the exported data. Preserve the existing list, detail, profile, threshold, progress, stats, volume, training-load, and best-effort read views. Precompute or export the response shapes needed by supported filters so the viewer does not need server-side database queries.
- Make the export data allowlist explicit. Review activity notes, workout centroid coordinates, profile information, and detailed telemetry as potentially sensitive. The export must omit fields not needed by the phone viewer; deployment must use access protection appropriate for personal run data. A client-side password prompt alone is not access control because the JSON ships to the browser.
- Treat desktop as the only mode allowed to invoke database/API mutations. Snapshot mode has no write UI, does not import desktop-only modules or onboarding flows, and has no mutation API. On any backend that serves snapshot mode, reject non-GET/HEAD requests by default and do not mount write routers. UI hiding is usability; server/deployment enforcement is the security boundary.
- Keep local-only presentation preferences such as theme, language, and font scale if they remain stored only in that phone browser; they must not write to the exported data or a backend.

## Implementation phases

1. **Inventory and contracts**
   - Enumerate every UI mutation and API route. Current mutation surfaces include activity `PATCH` and weather-refresh `POST`; profile `PATCH`; ingest settings, folder selection/scan/upload `POST`; database location, backup settings/creation, restore, and folder/file selection `POST`; and the development test-error route. Include any system mutation routes in the audit.
   - Record the GET response shapes used by Browse, Progress, Stats, Profile, and their filters. Use these as the snapshot format's initial contract.
   - Decide the minimum useful exported fields and access-protection configuration before deploying any real personal data.

2. **Snapshot generation**
   - Add a script/command to export a consistent view from the currently configured database. It must fail clearly if the database is missing, invalid, or mid-operation.
   - Serialize only allowlisted read data, include schema version and generated-at metadata, and write atomically so an interrupted export cannot leave a partial artifact.
   - Add a validation step that checks required sections, IDs, dates, and schema version before a build/deploy can consume the artifact.

3. **Snapshot frontend and responsive viewer**
   - Add an explicit snapshot build target with a snapshot-backed read client; do not silently change the desktop client.
   - Use existing dashboard views where their data contracts fit. Make unsupported controls unavailable in snapshot mode and show snapshot freshness metadata so users can tell how current the copy is.
   - Hide/remove all database-writing and external-action controls in snapshot mode: import/upload, Garmin scan/configuration, onboarding/profile setup and save, activity type/note editing, weather refresh, restore, backup creation/settings, database-location controls, and developer diagnostics. Remove Settings if it has no read-only snapshot purpose; expose only useful read-only metadata instead.
   - Do not rely on hiding buttons alone: do not load mutation components or mutation-capable client modules into the snapshot entrypoint where feasible.

4. **Read-only enforcement and deployment workflow**
   - Keep the snapshot deployment static and without a database connection. If a server/API is introduced later, allowlist read routes and deny all mutation verbs by default in snapshot mode; retain the existing local-session protections for desktop mode.
   - Add export/build/deploy commands and document the manual refresh flow: update desktop data, export, validate, build snapshot, deploy. Never commit generated personal data or add the SQLite database to Vercel build inputs.
   - Configure deployment access protection before uploading real personal data. Verify that unauthenticated requests cannot retrieve the HTML, JSON data, static chunks, or source maps. If the chosen Vercel plan cannot protect all artifacts, choose a hosting/access-control approach that can.

5. **Tests and verification**
   - Exporter unit tests: allowlisted fields only, sensitive/credential fields omitted, schema version and timestamp present, stable IDs, empty database behavior, invalid DB failure, and atomic output on failure.
   - Snapshot client contract tests: every supported read route/query returns the expected compatible response; unknown schema versions and missing required data fail with a clear error.
   - Snapshot-mode UI tests: assert import, scan, profile-save, activity-edit, weather-refresh, restore, backup-write, database-location, onboarding, and dev controls are absent; assert Browse/Progress/Stats/read-only Profile and detail views still render.
   - Backend security tests, if a backend is used by either target: mutation verbs/routes are unavailable in snapshot mode (including direct requests that bypass the UI), while desktop mode retains its current write behavior.
   - Add a phone-size browser test for navigation and activity detail, plus a deployment-artifact check that rejects `.db` files, credentials, unallowlisted fields, and mutation endpoints.
   - Before merging, run the repository's required checks from `AGENTS.md`: `npx tsc --noEmit`, `npm run lint`, `npm test`, and `npm run i18n:unused`.

## Acceptance criteria

- A user can export the active desktop database and produce a static deployment artifact without a database service or database credential.
- The phone snapshot opens the exported run history and read views on mobile dimensions and clearly reports when it was generated.
- The snapshot deployment exposes no write-capable controls or write-capable API, even when requests are made directly.
- The desktop app retains its existing import, editing, restore, backup, and settings workflows.
- Generated personal data is ignored by Git and the deployment is access-protected before real data is uploaded.
- The tests cover export correctness, read-only enforcement, mobile rendering, and artifact privacy.

## Open implementation choice

The exact export shape should be settled during the contract-inventory phase. Prefer a compact precomputed read model matching existing view/API contracts over copying SQLite or reimplementing all analytics in the browser. Keep the file format versioned so future exports can change without silently breaking older viewers.
