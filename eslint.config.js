import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import i18next from 'eslint-plugin-i18next';
import unusedImports from 'eslint-plugin-unused-imports';

/**
 * Local rule: flag hardcoded run statistics / metric copy in components.
 *
 * Complements `i18next/no-literal-string` by catching numeric metric text that
 * has no dictionary key behind it, e.g. `82% Low / 18% High`, `145 bpm`,
 * `5:20/km`. Metrics must come from the API payload or a shared helper so they
 * cannot silently drift from the backend.
 */
const METRIC_TEXT = /(\d+(?:\.\d+)?\s*%)|(\d+\s*(?:bpm|spm|km|mi|kg|min|sec)\b)|(\d+:\d{2})/i;

/** CSS values legitimately contain percentages and units — they are not run stats. */
const CSS_LIKE = /[();]|(?:rgba?|gradient|minmax|calc|translate|rotate|scale|var|url)\s*\(|\b(?:px|fr|rem|em|vh|vw|auto|important)\b/i;

/**
 * Treat something as a hardcoded statistic only when it carries a metric pattern
 * *and* real words, so `"100%"` in a style object is ignored while
 * `"82% Low / 18% High"` is flagged.
 */
function looksLikeStat(text) {
  return METRIC_TEXT.test(text) && /[a-z]{2,}/i.test(text) && !CSS_LIKE.test(text);
}

const localRules = {
  rules: {
    'no-hardcoded-metric-text': {
      meta: {
        type: 'problem',
        docs: { description: 'Disallow hardcoded run statistics in UI copy' },
        schema: [],
        messages: {
          hardcodedMetric:
            'Hardcoded metric text "{{text}}". Derive run stats from the API payload or a shared helper, or move the copy into the i18n dictionaries.'
        }
      },
      create(context) {
        // Track whether we are inside a JSX `style={{...}}` attribute, where
        // percentages and units are layout values rather than user-facing copy.
        let styleDepth = 0;

        function check(node, raw) {
          if (styleDepth > 0) return;
          const text = String(raw).trim();
          if (!text || !looksLikeStat(text)) return;
          context.report({ node, messageId: 'hardcodedMetric', data: { text: text.slice(0, 60) } });
        }

        return {
          JSXAttribute(node) {
            if (node.name && node.name.name === 'style') styleDepth++;
          },
          'JSXAttribute:exit'(node) {
            if (node.name && node.name.name === 'style') styleDepth--;
          },
          JSXText(node) {
            check(node, node.value);
          },
          Literal(node) {
            if (typeof node.value === 'string') check(node, node.value);
          },
          TemplateElement(node) {
            check(node, node.value.raw);
          }
        };
      }
    }
  }
};

/** Units, symbols and brand tokens that are legitimately language-neutral. */
const NEUTRAL_TEXT = [
  '^[\\s\\d.,:%+\\-–—/()·•×★☆◆◇°²³]+$',
  '^(km|m|mi|kg|cm|mm|ms|sec|min|hrs?|bpm|spm|rpm|w|kj|kcal|ef|lt1|lt2|vo2|vdot|acwr|hrr|hr|pb|pr|gps|csv|fit|gpx|tcx|sqlite|ok|id)$',
  '^(AEROLAB|EF|VO2|LT1|LT2|ACWR|HRR|GPS|CSV|FIT|PRs?|GPX|TCX)$',
  '^(en|zh|en-US|zh-CN)$',
  '^[A-Z]$',
  '^(—|·|•|★|☆|✓|×|→|←|◆|◇)$'
];

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-snapshot/**',
      'dist-backend/**',
      'release/**',
      'coverage/**',
      'node_modules/**',
      'scratch/**',
      'data/**',
      '*.config.js',
      '*.config.ts',
      'scripts/**'
    ]
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Baseline: the pre-existing backlog is surfaced as warnings so `npm run lint`
  // stays a useful, non-blocking signal. Burn the backlog down over time, then
  // promote these rules back to 'error'.
  {
    plugins: { 'unused-imports': unusedImports },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // The dedicated plugin is auto-fixable (`npm run lint:fix` strips dead
      // imports), so use it instead of the non-fixable core rule for imports.
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'warn',
      'unused-imports/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
      ],
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      // Empty catch blocks hide real failures (audit finding: silent migrations).
      // Intentional ignores must be annotated with a comment inside the block.
      'no-empty': 'error',
      'no-useless-escape': 'warn',
      'no-control-regex': 'warn',
      'no-constant-condition': 'warn',
      'no-cond-assign': 'warn'
    }
  },

  // Frontend: React hooks correctness plus local rules.
  {
    files: ['src/frontend/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, aerolab: localRules },
    rules: {
      ...(reactHooks.configs.recommended?.rules ?? {}),
      'react-hooks/exhaustive-deps': 'warn',
      // Hook ordering/effect issues are real bugs, but part of the existing
      // backlog; keep them visible as warnings rather than blocking lint.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'aerolab/no-hardcoded-metric-text': 'warn'
    }
  },

  // Components must not hardcode user-facing copy: it belongs in the i18n
  // dictionaries so both English and Chinese stay in sync.
  {
    files: ['src/frontend/components/**/*.tsx', 'src/frontend/App.tsx'],
    // The diagnostics drawer is developer tooling that never ships, so it is
    // intentionally English-only and exempt from the localization rule.
    ignores: ['src/frontend/components/DevDiagnosticsDrawer.tsx'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'warn',
        {
          mode: 'jsx-text-only',
          'jsx-attributes': { include: [] },
          words: { exclude: NEUTRAL_TEXT },
          message:
            'Hardcoded user-facing text. Add a key to src/frontend/i18n/{types,en,zh}.ts and read it via t.*'
        }
      ]
    }
  },

  // Backend + shared code has no i18n requirement.
  {
    files: ['src/backend/**/*.ts', 'src/shared/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },

  // i18n dictionaries are the one place literal copy is expected.
  {
    files: ['src/frontend/i18n/**/*.ts'],
    rules: {
      'i18next/no-literal-string': 'off',
      'aerolab/no-hardcoded-metric-text': 'off'
    }
  },

  // Formatters build unit strings such as "5:20/km" by design, and version.ts is
  // build metadata — neither is hardcoded run statistics.
  {
    files: ['src/frontend/utils/**/*.ts', 'src/frontend/version.ts'],
    rules: {
      'aerolab/no-hardcoded-metric-text': 'off'
    }
  },

  // Tests may use `any` freely for mocks.
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
);
