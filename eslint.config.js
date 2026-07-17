// Flat ESLint config (ESLint v9+). Advisory only — scoped to the modular
// backend and tests so the legacy codebase and static HTML are never blocked.
// Install locally with: npm i -D eslint  (from the BACKEND/ folder or root)
'use strict';

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      'BACKEND/PUBLIC/**',
      'BACKEND/src/legacy/**',
      'dist/**',
      'build/**',
      'out/**',
      'seed/**',
      'ios_app_demo/**',
      'mobile-qc/**',
      'DESKTOP_APP/**',
      '**/*.min.js',
    ],
  },
  {
    files: ['BACKEND/src/**/*.js', 'BACKEND/tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'writable',
        require: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
      eqeqeq: ['warn', 'smart'],
      'no-var': 'warn',
      'prefer-const': 'warn',
    },
  },
];
