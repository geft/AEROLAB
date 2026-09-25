# Agent handoff - AEROLAB security and architecture audit

Canonical rules live in `AGENTS.md`; the audit itself is tracked in
`SECURITY_ARCHITECTURE_PLAN.md`, which ends with a progress log. Read both before
changing anything here.

## Current state

Branch `main`. The task list in the plan's progress log is authoritative. Items
1 and 4 are complete for the remaining work recorded in the prior handoff.

Verification for the latest migration and row-boundary delivery (2026-09-25):

```bash
npx tsc --noEmit     # 0 errors
npm run lint         # 0 errors (warnings are a tracked backlog)
# focused tests: 7 files / 49 tests, all green
npm run i18n:unused  # all 651 dictionary keys referenced
```

The full test suite and packaged smoke modes were not rerun for this delivery.
Earlier smoke results are retained in the plan's progress log.

## Done

| Plan item | State |
| --- | --- |
| 1. Explicit, recoverable migrations | Done - essential schema column additions and legacy `notes` removal run under `schema-columns-v1` in `src/backend/db/client.ts` |
| 2. Storage service apart from routes | Done - `src/backend/db/storage.ts`, `src/backend/db/path.ts` |
| 3. Derived work off the request path | Done - `src/backend/jobs/maintenance.ts`, `maintenance-worker.ts` |
| 4. Typed domain and API boundaries | Done for the planned slices - parser, request, activity, progress, volume, coach-summary, and threshold rows use validated conversions |
| 5. Weather provenance | Done - `weather_source`, `verifiedAmbientTemperature()`, weather card states |
| 6. Docs and release alignment | Done - README, `AGENTS.md`, `scripts/smoke-packaged.js` |

## Latest delivery: items 1 and 4

The service extraction and frontend fetch migration described in the earlier
handoff are complete. `src/backend/routes/{activities,profile,thresholds}.ts`
now delegate to `src/backend/services/`, and the only direct frontend `fetch`
call is inside `src/frontend/api/client.ts`. The client handles JSON failures,
cancellation, network failures, and stable codes. UI errors use
`src/frontend/api/errors.ts` and the bilingual dictionaries. Focused tests live
in `tests/unit/{activity-service,api-client}.test.ts`.

### Completed: checkpointed schema additions and query row boundaries

`src/backend/db/client.ts` now applies old-schema column additions and the
legacy `notes` drop once under `schema-columns-v1`. Progress, volume,
coach-summary, activity-detail, and threshold queries validate SQLite values
before aggregation, persisted-summary mapping, or threshold calculations. The
current wire format and local SQLite model are preserved.

### Completed: request and failure boundaries

Profile and activity PATCH inputs reject unknown or malformed fields before
service calls. Missing activity updates return `ERR_ACTIVITY_NOT_FOUND`, and
user-visible failures resolve through bilingual dictionary copy via stable
error codes.

Focused tests cover the migration checkpoint and malformed progress, volume,
coach-summary, and threshold query rows. The plan progress log records the
verification run and current 651-key translation check.

### 3. Close the loop

The progress log in `SECURITY_ARCHITECTURE_PLAN.md` is current. Before any
commit, run the four verification commands required by `AGENTS.md`.

## Tooling gotchas (learned the hard way)

- The shell is Windows PowerShell. `rg` is **not** installed - use
  `Select-String`, or the editor's code search.
- Single commands are killed at roughly 30 seconds. `npm test` needs ~40s, so
  run it detached and poll the log:
  `Start-Process -FilePath "node" -ArgumentList "node_modules/vitest/vitest.mjs","run" -RedirectStandardOutput "$env:TEMP\aerolab-test.log" -NoNewWindow`
- Vitest 4 has no `basic` reporter; pass no `--reporter` flag (omit it) or use `dot`.
- `better-sqlite3` is synchronous. Never put a full-history recomputation back
  into a request handler - schedule it through `src/backend/jobs/maintenance.ts`.
- The maintenance worker is a separate thread: in development,
  `maintenance.ts` bundles `maintenance-worker.ts` with esbuild on first start
  (`dist-backend/maintenance-worker-dev.cjs`). Plain `.ts` imports inside a
  worker thread fail, so keep the bundling step if you touch worker loading.
- i18n: every new user-facing string needs the key in
  `src/frontend/i18n/types.ts` plus values in `en.ts` and `zh.ts`. No inline
  language conditionals and no hardcoded dates - use `formatDate`.
- Tests must use disposable SQLite fixtures, including a WAL-backed one. Never
  point a test at the real workout database.
- Do not commit `data/**`, `*.db`, `dist*/`, `release/`, `coverage/` or `*.exe`;
  all are gitignored, and line endings are LF.
- Conventional Commits only: `feat(scope):`, `fix(scope):`, `chore(scope):`, `test:`.
- `core.autocrlf=true` is configured globally on this machine while
  `.gitattributes` forces LF. `git status` can therefore report `M` for a file
  that is byte-identical to HEAD. Confirm before "fixing" anything with
  `git hash-object --path=<file> <file>` against `git rev-parse HEAD:<file>`; when
  the two hashes match, `git diff` is empty and there is nothing to commit.
