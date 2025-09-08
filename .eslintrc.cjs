/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: {
    react: { version: 'detect' },
    'import/resolver': {
      node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] }
    }
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier'
  ],
  env: {
    es2022: true,
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'out/',
    'coverage/',
    '.vite/',
    '.qodo/'
  ],
  rules: {
    // Using TypeScript, so these React prop-type rules are unnecessary
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',

    // Rely on TS for import resolution to avoid false positives without extra resolvers
    'import/no-unresolved': 'off',
    'import/named': 'off',

    // Reasonable TS defaults
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-module-boundary-types': 'off'
  },
  overrides: [
    // Node/Electron contexts
    {
      files: ['src/main/**/*.{ts,tsx}', 'src/services/**/*.{ts,tsx}'],
      env: { node: true }
    },
    // Browser/React context
    {
      files: ['src/renderer/**/*.{ts,tsx}'],
      env: { browser: true }
    },
    // Tests can run in jsdom/node; enable both to avoid env mismatch warnings
    {
      files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
      env: { jest: true, node: true, browser: true }
    }
  ]
};