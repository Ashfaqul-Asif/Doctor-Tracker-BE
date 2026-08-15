import { defineConfig } from 'vitest/config';

export default defineConfig({
  /**
   * An inline (empty) PostCSS config stops Vite searching parent directories.
   * Without it, an unrelated postcss.config.js higher up in the filesystem gets
   * picked up and fails the run before any test executes. This is a backend
   * project — there is no CSS to process at all.
   */
  css: { postcss: {} },

  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // mongodb-memory-server downloads a binary on first run, and replica-set
    // elections plus transaction tests are slow to start.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Each file gets its own in-memory server; running them in parallel multiplies
    // memory use and slows elections more than it saves.
    fileParallelism: false,
  },
});
