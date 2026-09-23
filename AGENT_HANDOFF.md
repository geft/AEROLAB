# Agent handoff - AEROLAB security and architecture audit

Canonical rules live in `AGENTS.md`; the audit itself is tracked in
`SECURITY_ARCHITECTURE_PLAN.md`, which ends with a progress log. Read both before
changing anything here.

## Current state

Branch `main`. All audit work is committed; the task list in the plan's progress
log is authoritative. The remaining open item is **item 4 (typed domain and API
boundaries)**, partially done.

Verification as of this handoff - run all four before committing:

```bash
npx tsc --noEmit     # 0 errors
npm run lint         # 0 errors, 131 warnings (tracked backlog)
npm test             # 67 files / 476 tests, all green
npm run i18n:unused  # all 618 dictionary keys referenced
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
| 4. Typed domain and API boundaries | In progress - shared `Activity` contract and typed client exist and cover two slices |
| 5. Weather provenance | Done - `weather_source`, `verifiedAmbientTemperature()`, weather card states |
| 6. Docs and release alignment | Done - README, `AGENTS.md`, `scripts/smoke-packaged.js` |

## Next task: finish item 4

### 1. Extract a service layer so routes stop importing physiology

`src/backend/routes/activities.ts` still imports `athlete-profile`, `zones`,
`coach-summary`, `economy`, `weather`, `training-load` and `best-efforts`;
`routes/profile.ts` computes Tanaka max HR and zones; `routes/thresholds.ts`
computes predictions. Create small services (for example
`src/backend/services/activity-service.ts` and `services/profile-service.ts`)
that own the queries plus those calls, return the typed shapes from
`src/shared/`, and leave the routes as input validation plus response mapping.
Do not build a framework-wide repository abstraction - only the slices that
earn it.

### 2. Move the remaining direct `fetch` call sites onto the typed client

`src/frontend/api/client.ts` already handles parsing, cancellation and stable
error codes. Port the rest one view at a time, adding only the functions you
need:

- `src/frontend/components/ProfileView.tsx` - GET/PATCH `/api/profile`
- `src/frontend/components/OnboardingPage.tsx` - GET/PATCH `/api/profile`, POST `/api/database/restore`
- `src/frontend/components/UploadModal.tsx` - POST `/api/ingest/upload`
- `src/frontend/components/ActivityDetailHeader.tsx` - PATCH `/api/activities/:id` (tags, title)
- `src/frontend/components/StatsView.tsx`, `ProgressView.tsx`, `PeriodProgressView.tsx`, `TrainingLoadCard.tsx` - thresholds, progress history, volume, training load
- `src/frontend/components/DevDiagnosticsDrawer.tsx` - dev-only routes, lowest priority

Every user-visible failure must resolve to one dictionary string through
`ApiRequestError.code`, so no component invents its own HTTP message.

### 3. Close the loop

Update the progress log in `SECURITY_ARCHITECTURE_PLAN.md` when item 4 is done,
and add the new service/client tests next to the existing ones.

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
