/* ESLint v9 flat config for TypeScript + React in mixed Node/Electron and Browser environments */

const js = require('@eslint/js');
const globals = require('globals');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const importPlugin = require('eslint-plugin-import');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  // Global ignores
  {
    ignores: ['node_modules/', 'dist/', 'out/', 'coverage/', '.vite/', '.qodo/'],
  },

  // Base TS/React rules (no type-aware rules; fast)
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      import: importPlugin,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // Recommended baselines
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...importPlugin.configs.recommended.rules,

      // Project adjustments
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',

      // Avoid resolver noise (we aren't enabling TS resolver yet)
      'import/no-unresolved': 'off',
      'import/named': 'off',

      // Reasonable TS defaults
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },

  // Node/Electron contexts (main + services)
  {
    files: ['src/main/**/*.{ts,tsx,js}', 'src/services/**/*.{ts,tsx,js}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Browser/React context (renderer)
  {
    files: ['src/renderer/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // Config/build (Node/Electron tooling and bundlers)
  {
    files: ['*.config.{js,cjs,ts,mjs}', 'vite.*.config.{ts,js,cjs,mjs}', 'electron-forge.*.{js,ts,cjs,mjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // TypeScript: disable no-undef (handled by TypeScript)
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-undef': 'off',
    },
  },

  // Tests (enable both node + browser globals to avoid env mismatch)
  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...(globals.jest || {}) },
    },
  },
];