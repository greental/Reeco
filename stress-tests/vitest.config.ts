import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    hookTimeout: 45_000,
    testTimeout: 180_000,
    reporters: ['verbose'],
    include: ['stress-tests/**/*.ts'],
    exclude: ['stress-tests/helpers/**', 'stress-tests/vitest.config.ts'],
    sequence: {
      concurrent: false,
    },
  },
});