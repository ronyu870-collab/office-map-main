import { configDefaults, defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // This uploader uses node:test and is run explicitly by Verify.
    exclude: [...configDefaults.exclude, 'scripts/building-photos/*.test.mjs'],
    // Existing property suites allow individual fast-check assertions up to 10s.
    // Keep the Vitest case budget above that inner timeout so CI does not abort
    // a valid property run at the framework's 5s default boundary.
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
