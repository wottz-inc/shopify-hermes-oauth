import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      reporter: ['text', 'lcov'],
    },
    exclude: ['dist/**', 'node_modules/**'],
    globals: false,
    include: ['test/**/*.test.ts'],
  },
});
