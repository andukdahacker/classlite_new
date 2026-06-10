import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Story 1.7a AC5 — raw hex literals are banned in TSX/TS source. The
// design system requires every color to flow through --cl-* tokens.
//
// Pattern note: unanchored so embedded hex in Tailwind arbitrary classes
// (`bg-[#1a1f2e]`) and CSS-in-JS template strings (`color: #1a1f2e`) are
// caught — anchored `^...$` only matched literals whose entire value was
// the hex, which silently bypassed both common smuggling paths.
// Token-presence + lint-fixture files are exempted via the overrides block
// below; that override is scoped to no-restricted-syntax ONLY so the rest
// of ESLint (react-hooks, typescript-eslint, react-refresh) still applies.
const RAW_HEX_LITERAL = '#[0-9a-fA-F]{3,8}\\b'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=/${RAW_HEX_LITERAL}/]`,
          message:
            'Raw hex colors are forbidden. Use a --cl-* design token. Tokens live in src/tokens.css.',
        },
        {
          selector: `TemplateElement[value.raw=/${RAW_HEX_LITERAL}/]`,
          message:
            'Raw hex colors are forbidden. Use a --cl-* design token. Tokens live in src/tokens.css.',
        },
      ],
    },
  },
  {
    // shadcn-generated primitives intentionally co-export variants alongside
    // the component (per FW-7 + R41 — never hand-edit). The react-refresh
    // mixed-export warning is incompatible with that template; suppressing
    // here keeps the lint clean without modifying generated files.
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Narrow override for the only legitimate raw-hex consumers in the tree:
    // the AC1 token-presence test parses hex values from tokens.css and the
    // AC5 lint fixtures intentionally hold bad-hex bait. Disable JUST the
    // raw-hex rule — all other ESLint coverage (react-hooks, ts-eslint,
    // floating-promises, etc.) continues to apply to these files.
    files: [
      'src/test/design-tokens/**/*.{ts,tsx}',
      'src/test/lint-fixtures/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // Story 1.7b AC8 — single network entry point. Raw fetch / axios in
    // features or hooks bypasses the apiFetch envelope-unwrap + 401
    // silent-refresh contract. The lib/ tier (api-fetch.ts, auth-refresh.ts)
    // is the only legitimate consumer of raw `fetch`; it lives outside this
    // scope by construction so no override block is needed.
    files: ['src/features/**/*.{ts,tsx}', 'src/hooks/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            "Direct fetch is forbidden in features/hooks. Use apiFetch from '@/lib/api-fetch'.",
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'axios',
              message:
                "axios is forbidden. Use apiFetch from '@/lib/api-fetch' — TanStack Query owns server state.",
            },
          ],
        },
      ],
    },
  },
])
