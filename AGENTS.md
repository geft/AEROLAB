# AGENTS.md — AEROLAB project rules

Canonical rule file for AI agents working in this repository.
`.clinerules` points here; keep all rules in this one file.

## Verification before every commit

```bash
npx tsc --noEmit     # must be 0 errors
npm run lint         # must be 0 errors (warnings are a tracked backlog)
npm test             # 67 files / 476 tests, all green
npm run i18n:unused  # must report every dictionary key as referenced
```

## i18n and user-facing strings

All UI copy is bilingual (English + 简体中文) and lives in dictionaries, exactly
like Android's `values/` and `values-zh/` resource folders.

- **Never** write an inline language conditional (`language === 'zh' ? 'a' : 'b'`,
  or locale picking like `toLocaleDateString('zh-CN')`). This pattern is banned.
- Add every user-facing string to **all three** files:
  - `src/frontend/i18n/types.ts` — the typed key (`Translations` interface)
  - `src/frontend/i18n/en.ts` — English value
  - `src/frontend/i18n/zh.ts` — Chinese value
- Read copy through the hook: `const { t, format, plural, formatDate } = useTranslation();`
  - plain string: `t.namespace.key`
  - interpolation: `format(t.namespace.key, { count, pace })` with `{token}` placeholders
  - counts: `plural(n, t.namespace.somePluralForms)` — uses `Intl.PluralRules`
  - dates/times: `formatDate(value, { month: 'short', year: 'numeric' })` — never
    `toLocaleDateString`/`toLocaleDateString` with a hardcoded locale
- Locale identifiers live only in `LOCALES` (`i18n/types.ts`). Adding a language
  must be a one-line change there plus one dictionary file.
- English text coming from the API is the English source of truth: ship an empty
  `Record<string, string>` override map in `en.ts` and populate it in `zh.ts`,
  rather than moving the API strings into the client.
- **Never hardcode a run stat or computed metric** in a component (no literal
  `'82% Low / 18% High'`, no magic threshold numbers in JSX). Derive it from the
  API payload or a shared helper so it cannot drift from the backend.

## Text formatting (chat and UI copy)

- No LaTeX anywhere — not in chat replies, code comments, or UI strings. The chat
  and UI render GitHub-Flavored Markdown without KaTeX, so `$...$` prints broken.
- Use plain Unicode text: `55 bpm`, `2.5%`, `132 - 145 bpm`, `< 132 bpm`,
  `>= 175 spm`, `~167 bpm`.

## GitHub

Use the `gh` CLI for all GitHub work — do not guess URLs or hand-craft API calls.

```bash
gh pr list / gh pr create / gh pr view <n>
gh run list --limit 5
gh run watch <id>
gh workflow run release.yml      # rebuild + publish the Windows installer
gh release list / gh release view <tag>
```

## Repo conventions

- Local-first: the app must work fully offline; never require a cloud service.
- One SQLite database in WAL mode. Development defaults to `data/runs.db`;
  the database may be selected outside the app in Settings. Never commit `data/**`,
  `*.db`, `dist*/`, `release/`, `coverage/` or any `*.exe` (all gitignored).
- Line endings are LF everywhere (see `.gitattributes`).
- Conventional Commits: `feat(scope):`, `fix(scope):`, `chore(scope):`, `test:`.
- Developer tooling (`/api/dev/*`, the diagnostics drawer, the floating dev
  button) is development-only and must never ship in a release build.
