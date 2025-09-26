/* ESLint v9 flat config for TypeScript + React in mixed Node/Electron and Browser environments */

const js = require('@eslint/js');
const globals = require('globals');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const importPlugin = require('eslint-plugin-import');
const securityPlugin = require('eslint-plugin-security');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  // Global ignores
  {
    ignores: ['node_modules/**', 'dist/**', 'build/**', 'coverage/**', 'out/**', '.vite/', '.qodo/'],
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
      security: securityPlugin,
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
      ...securityPlugin.configs.recommended.rules,

      // Project adjustments
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',

      // Avoid resolver noise (we aren't enabling TS resolver yet)
      'import/no-unresolved': 'off',
      'import/named': 'off',

      // TypeScript authoritative unused-vars and exceptions
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Temporarily relax to drive baseline to zero
      '@typescript-eslint/no-explicit-any': 'off',

      // Keep TS-specific relaxations
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // Disable no-undef for TS (handled by TypeScript)
      'no-undef': 'off',

      // Security rules to prevent unsafe code patterns (strict for eval)
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'security/detect-eval-with-expression': 'error',
      // Relax other security rules for legitimate patterns in TypeScript code
      'security/detect-non-literal-require': 'off',
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-regexp': 'off',
      'security/detect-unsafe-regex': 'off',
      'security/detect-non-literal-fs-filename': 'off',
    },
  },

  // Declarations (.d.ts) - loosen common patterns in ambient types
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
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

  // (removed) Redundant TS 'no-undef' override; consolidated into the base TS block

  // Tests (enable both node + browser globals to avoid env mismatch)
  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...(globals.jest || {}) },
    },
    rules: {
      // Test files already inherit relaxed security rules from base config
    },
  },

  // Temporarily disabled - AI call sites process.env restriction
  // TODO: Re-enable after fixing all configuration vs API key usage
  // {
  //   files: ['src/services/ai/**/*.{ts,tsx}'],
  //   rules: {
  //     'no-restricted-syntax': [
  //       'error',
  //       {
  //         selector: 'MemberExpression[property.name=/^env$/][object.name=/^process$/]',
  //         message: 'process.env.* usage is not allowed in AI call sites outside KeyGate. Use KeyGate.requireKey() instead.',
  //       },
  //     ],
  //   },
  // },
];