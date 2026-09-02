import { resolve } from 'path'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const repositoryRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  assetsInclude: ['**/*.bcmap'],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'node',
    setupFiles: [resolve(repositoryRoot, 'scripts/vitest.setup.ts')],
    include: ['src/**/*.test.{ts,tsx}'],
    maxWorkers: Math.max(1, Math.min(4, availableParallelism()))
  }
})
