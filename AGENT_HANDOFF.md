# Agent handoff - AEROLAB security and architecture audit

Canonical rules live in `AGENTS.md`; the audit itself is tracked in
`SECURITY_ARCHITECTURE_PLAN.md`, which ends with a progress log. Read both before
changing anything here.

## Current state

Branch `main`. The task list in the plan's progress log is authoritative. The
remaining open item is **item 4 (typed domain and API boundaries)**, partially
done.

Verification as of this handoff - run all four before committing:

```bash
npx tsc --noEmit     # 0 errors
npm run lint         # 0 errors (warnings are a tracked backlog)
npm test             # 69 files / 482 tests, all green
npm run i18n:unused  # all 635 dictionary keys referenced
```

Both smoke modes pass against real backends:

```bash
node scripts/smoke-packaged.js --dev   # tsx development entry (bundles the worker on startup)
npm run build:all && npm run smoke:packaged
```

## Done

| Plan item | State |
| --- | --- |
| 1. Explicit, recoverable migrations | Mostly done - `src/backend/db/migrations.ts`; remaining: move the idempotent `ALTER TABLE` column list out of `src/backend/db/client.ts` into checkpointed migrations |
| 2. Storage service apart from routes | Done - `src/backend/db/storage.ts`, `src/backend/db/path.ts` |
| 3. Derived work off the request path | Done - `src/backend/jobs/maintenance.ts`, `maintenance-worker.ts` |
| 4. Typed domain and API boundaries | In progress - service extraction and frontend client migration are complete; ingestion and row typing remain |
| 5. Weather provenance | Done - `weather_source`, `verifiedAmbientTemperature()`, weather card states |
| 6. Docs and release alignment | Done - README, `AGENTS.md`, `scripts/smoke-packaged.js` |

## Next task: finish item 4

The service extraction and frontend fetch migration described in the earlier
handoff are complete. `src/backend/routes/{activities,profile,thresholds}.ts`
now delegate to `src/backend/services/`, and the only direct frontend `fetch`
call is inside `src/frontend/api/client.ts`. The client handles JSON failures,
cancellation, network failures, and stable codes. UI errors use
`src/frontend/api/errors.ts` and the bilingual dictionaries. Focused tests live
in `tests/unit/{activity-service,api-client}.test.ts`.

### 1. Tighten the ingestion and row boundaries

`src/backend/ingestion/csv-parser.ts` already defines parsed metadata and
records; `fit-parser.ts` now types decoded numeric messages and requires a
valid start timestamp. `src/backend/services/{activity,profile,thresholds}-service.ts`
still cast database rows through `any`. Define database row shapes, validate
untrusted values at entry, and use explicit conversions to the existing shared
API response contracts. Keep the current wire format and local SQLite model.

### 2. Tighten request inputs and failure mapping

`ProfileUpdateInput` is still a loose `Record<string, unknown>`, and the
service accepts arbitrary body properties before filtering. Give route inputs
explicit shapes and validate them before service calls. Check response
mapping for missing activities and malformed rows. Keep every user-visible
failure in the dictionaries through `ApiRequestError.code`.

### 3. Close the loop

Update the progress log in `SECURITY_ARCHITECTURE_PLAN.md` when the remaining
type boundaries are verified, and add focused parser/row tests.

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
