/**
 * The static Anchored Comments tests are Vitest suites. They move here
 * byte-for-byte, so the plugin keeps a real Vitest runner for them while the
 * plugin-owned suites (source fidelity, parity, host loading, hot-plug) stay on
 * `node:test` and share the built artifact.
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig({
  root: repositoryRoot,
  test: {
    environment: 'node',
    include: ['plugins/anchored-comments/src/core/**/*.test.ts'],
    maxWorkers: 2,
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
})