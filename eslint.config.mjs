// Lint for CI: only rules that catch real bugs (undefined names, duplicate keys, unreachable code,
// bad typeof strings...). Style is not checked. Run: npx eslint@9 .
import globals from 'globals';
export default [
  { ignores: ['vendor/**', 'dist/**', 'src-tauri/**', '**/node_modules/**', 'server/.wrangler/**', 'assets/**'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, ...globals.worker, ...globals.node } },
    rules: {
      'no-undef': 'error', 'no-dupe-keys': 'error', 'no-dupe-args': 'error', 'no-unreachable': 'error', 'valid-typeof': 'error',
      'no-func-assign': 'error', 'no-import-assign': 'error', 'no-const-assign': 'error', 'no-self-assign': 'error',
      'no-unsafe-negation': 'error', 'no-dupe-else-if': 'error', 'no-duplicate-case': 'error', 'use-isnan': 'error',
    },
  },
  { files: ['server/src/**/*.js'], languageOptions: { globals: { WebSocketPair: 'readonly', WebSocketRequestResponsePair: 'readonly' } } },
];
