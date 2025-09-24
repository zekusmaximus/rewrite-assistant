// @ts-expect-error - vitest/config types may not be properly resolved
const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'src/**/__tests__/**/*.{test,spec}.{ts,tsx}',
    ],
    globals: true,
    setupFiles: ['vitest.setup.ts'],
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'build/**',
        'coverage/**',
        'out/**',
        '.vite/',
        '.qodo/',
        '**/*.d.ts',
        '**/*.config.{js,cjs,ts,mjs}',
        'vite.*.config.{ts,js,cjs,mjs}',
        'electron-forge.*.{js,ts,cjs,mjs}',
        '**/__tests__/**',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
  },
});