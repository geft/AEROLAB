# Test Coverage Improvement Plan

## Baseline

Captured on 2026-09-26 with `npm run test:coverage`:

- 72 Vitest files passed; 506 tests passed.
- Lines: 83.66%; statements: 81.75%; functions: 80.99%; branches: 70.8%.
- The 15 Playwright visual tests are excluded from Vitest instrumentation. They verify rendered layouts and screenshots, but do not increase the coverage percentages below.

Prioritize untested behavior and failure paths over raising percentages by exercising trivial lines.

## Priorities

### 1. Background maintenance job — highest risk

Target: `src/backend/jobs/maintenance.ts` (7.54% lines; 6.25% branches).

- Add a focused unit suite with a temporary database-config/status directory and a mocked worker. Avoid starting a real worker in unit tests.
- Cover status reads: no status file, valid saved status, persisted `running` reported as `interrupted`, and unreadable or invalid status JSON falling back safely.
- Cover worker startup: development bundle succeeds, bundle command throws, worker bundle is missing, and status is persisted as failed.
- Cover worker lifecycle: complete message and callback, failed message, worker error, and exit before completion becoming interrupted.
- Cover queued profile recomputes: requests arriving while a worker runs are coalesced, `baselineChanged` is retained, and the queued task starts after exit.
- Cover `isMaintenanceRunning()` while a worker is active and while a task is queued.
- Add only narrow dependency seams (worker factory, bundle step, or status-file path) if module mocking cannot make these cases deterministic.

**Exit target:** at least 85% line and 70% branch coverage for this module, with each status transition asserted.

### 2. Error translation and small data utilities

Targets: `src/frontend/api/errors.ts` (21.05% lines), `src/frontend/utils/errors.ts` (33.33%), and `src/frontend/utils/sessionCsv.ts` (37.5%).

- Make `apiErrorMessage` table-driven: cover every supported API error code, both generic codes, unknown API codes, and non-`ApiRequestError` values using the fallback.
- Cover `errorMessage` for a populated `Error`, empty-message `Error`, non-empty and whitespace-only strings, `null`, and other thrown values.
- Expand `sessionToCsv` cases for optional metadata defaults, newline cleanup, null telemetry cells, empty records, and multiple records with the stable header and trailing newline.
- Test `downloadSessionCsv` behavior with mocked `URL.createObjectURL`, anchor click/removal, filename sanitization, and URL revocation.

**Exit target:** at least 90% line and 80% branch coverage for these small helpers.

### 3. Telemetry chart behavior

Target: `src/frontend/components/CanvasRunChart.tsx` (22.62% lines; 8.42% branches).

- Add component tests with a controlled canvas 2D context mock for the main drawing paths, empty records, nullable fields, and data with missing heart-rate, pace, or altitude ranges.
- Cover pointer hover and leave behavior, displayed values, and resize-driven redraws.
- Add or extend a Playwright interaction test in addition to the existing screenshot snapshots: verify that a real browser draws the chart and shows the expected tooltip on hover. Keep deterministic fixture data.
- Keep canvas API mocking limited to the test setup; do not make production chart code more complex just to satisfy coverage.

**Exit target:** at least 70% line and 50% branch coverage, plus one real-browser tooltip assertion.

### 4. Backup and database-location flows

Targets: `BackupManagementPanel.tsx` (43.52% lines) and `DatabaseLocation.tsx` (47.5%).

- Add component tests for initial status loading, failed status retrieval, backup success/failure, backup-setting save success/failure, and refreshed status after an operation.
- Cover restore from a snapshot and from a selected file: user confirmation, success callback, rejection, and server failure.
- Cover database-location selection and both save choices (copy a new database/use an existing one), including confirmation cancellation and representative server error codes.
- Cover the maintenance `running`, `failed`, and `interrupted` messages in Settings.
- Assert outcomes and retry/callback behavior; keep visual snapshots focused on layout rather than duplicating every API state.

**Exit target:** at least 75% line and 60% branch coverage in both components.

### 5. Garmin import and scan flows

Targets: `GarminScanModal.tsx` (43.75% lines) and `GarminImportPanel.tsx` (52.94%).

- Add UI tests for scanning, mixed imported/duplicate/non-running/error results, empty results, request failure, retry, and closing the dialog.
- Cover saved import-folder loading, unavailable folders, choosing a folder, successful save, save failure, and disabling save when the value is unchanged or blank.
- Keep existing desktop/mobile screenshots; use assertions for states and actions that screenshots cannot validate.

**Exit target:** at least 75% line and 60% branch coverage in both components.

## Execution order

1. Add maintenance-job tests and helper error-path tests.
2. Strengthen CSV export tests.
3. Add chart component and browser interaction coverage.
4. Add backup/database-location UI state tests.
5. Add Garmin import/scan UI state tests.
6. Re-run coverage and review uncovered branches for meaningful missed behavior.

## Completion checks

- `npm run test:coverage` passes and reports at least 86% overall line coverage and 75% overall branch coverage.
- Every targeted module reaches its exit target, or any remaining uncovered code is documented as unreachable/platform-specific with a reason.
- `npm run test:visual` remains green; visual-only checks are not counted toward Vitest coverage goals.
- `npx tsc --noEmit`, `npm run lint`, and `npm run i18n:unused` pass.
- New tests remain local-first and deterministic: no network access, user database, wall-clock dependency, or real background worker in unit tests.
