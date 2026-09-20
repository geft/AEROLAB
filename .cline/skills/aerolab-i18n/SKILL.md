---
name: aerolab-i18n
description: Use when adding, changing or migrating user-facing text in the AEROLAB React frontend, when ESLint reports i18next/no-literal-string or aerolab/no-hardcoded-metric-text, or when a run statistic or label must be displayed. Applies the key-based dictionary workflow across types.ts/en.ts/zh.ts, the Intl formatting helpers, and the dead-key checker.
---

# AEROLAB localization workflow

AEROLAB is bilingual (English + 简体中文). All UI copy lives in dictionaries, the
same way Android keeps `values/` and `values-zh/`. There is **never** an inline
language conditional in a component.

## The three files

| File | Role |
| --- | --- |
| `src/frontend/i18n/types.ts` | Typed key surface — the `Translations` interface |
| `src/frontend/i18n/en.ts` | English values (must satisfy `Translations`) |
| `src/frontend/i18n/zh.ts` | Chinese values (must satisfy `Translations`) |

Adding a string means editing **all three**. `tsc` fails if they diverge, which
is the safety net.

## Steps

1. Read the component and collect every user-facing string, including
   `placeholder`, `title`, `aria-label` and `alt` attributes.
2. Pick or create a namespace in `types.ts` (prefer an existing one).
3. Add the key to `types.ts`, then the English value to `en.ts`, then the Chinese
   value to `zh.ts`. Match the existing tone and terminology in `zh.ts`
   (for example 训练负荷, 最适区间, 乳酸阈值) rather than inventing new wording.
4. Read it in the component via the hook:

```tsx
const { t, format, plural, formatDate } = useTranslation();

t.namespace.key                                              // plain
format(t.namespace.template, { count, pace })                 // {token} interpolation
plural(count, t.namespace.somePluralForms)                    // Intl.PluralRules
formatDate(row.start_time, { month: 'short', day: 'numeric' }) // locale-aware date
```

## Hard rules

- Never write `language === 'zh' ? … : …`. If you are tempted, the string belongs
  in the dictionary.
- Never hardcode a locale (`'zh-CN'`, `'en-US'`) in a component. Locales live in
  `LOCALES` (`i18n/types.ts`). Get one from `useTranslation().locale`.
- Never hardcode a run statistic or threshold. Derive it from the API payload or a
  shared helper so it cannot drift from the backend. `'82% Low / 18% High'` as a
  literal is a bug; so is a magic `0.8`/`1.3` in JSX.
- English copy that comes from the API is the English source of truth. Ship an
  empty `Record<string, string>` override map in `en.ts` and populate it in
  `zh.ts`; do not move the API strings into the client.
- Text from `t.*` must not be pushed through `toLocaleDateString` or a manual
  string replace for translation purposes.

## Templates, plurals and inline markup

- Interpolation uses `{token}` placeholders and the `format()` helper. Do not use
  template literals to glue translated fragments together: word order differs in
  Chinese.
- Counts use `plural(count, { one, other })` so `Intl.PluralRules` picks the form.
  Chinese has a single `other` category, so both forms are usually identical —
  that is expected.
- When a sentence wraps inline `<b>`/`<code>` markup, split the sentence into
  numbered fragments in the dictionary (`whatIsP1`, `whatIsBoldMargin`,
  `whatIsP2`, …) and interleave them in JSX. Do not concatenate inside a ternary.

## Verification

```bash
npx tsc --noEmit            # dictionary keys must stay in sync
npm run lint                # flags hardcoded labels and hardcoded run stats
npm run i18n:unused         # fails if a dictionary key is never referenced
npm test                    # 54 files / 364 tests
```

`npm run i18n:unused` is the guard against orphaned keys: after removing a
feature, prune its keys rather than leaving them behind. It understands dynamic
indexing such as `t.runTypes[run.run_type]`, so those keys are not flagged.

English output must stay byte-identical when you are only moving an existing
hardcoded string into the dictionary — that is what keeps the UI test suite
green.
