import { resolve } from 'path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const repositoryRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'node',
    setupFiles: [resolve(repositoryRoot, 'scripts/vitest.setup.ts')],
    include: ['src/**/*.test.{ts,tsx}']
  }
})
