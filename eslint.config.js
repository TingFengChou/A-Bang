// ESLint（flat config）：Node 端（core、server、mcp、scripts、test）與瀏覽器端（public）分開設定
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'dist/', 'test/screenshots/', 'docs/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      eqeqeq: ['error', 'smart'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['public/**/*.js', 'scripts/demo-setup.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } },
  },
  {
    // Playwright 的 page.waitForFunction 等回呼在瀏覽器裡執行
    files: ['scripts/e2e.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
