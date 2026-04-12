import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run each file in its own worker to isolate DB state between integration tests
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: false },
    },
    // Global environment — individual test files may override via vi.mock
    env: {
      NODE_ENV: 'test',
    },
    // Global setup: sets env vars once before any test file loads
    globalSetup: './tests/setup/global-setup.js',
    // Per-file setup: imported into every test worker
    setupFiles: ['./tests/setup/test-setup.js'],
    // Generous timeouts for integration tests that wait on DB queries
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Separate reporters for unit vs integration to keep CI output readable
    reporters: process.env.CI ? ['verbose'] : ['default'],
  },
});
