import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'src/**/__tests__/**/*.{ts,tsx}',
    ],
    globals: true,
    setupFiles: ['vitest.setup.ts'],
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
  },
});