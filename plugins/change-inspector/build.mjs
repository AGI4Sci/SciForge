/**
 * Builds the self-contained ESM entrypoint at dist/main.js.
 * `@deepseek-ai/*` runtime packages stay external: the host runner pins their
 * resolution to the approved deployment copies. zod and the plugin core are
 * inlined so the artifact has no runtime dependency on repository sources.
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

await build({
  entryPoints: [fileURLToPath(new URL('./src/dsh-adapter/index.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@deepseek-ai/*'],
  outfile: fileURLToPath(new URL('./dist/main.js', import.meta.url)),
  logLevel: 'warning'
})
