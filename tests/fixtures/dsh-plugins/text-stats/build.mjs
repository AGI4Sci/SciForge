/**
 * Builds the self-contained ESM entrypoint at dist/main.js.
 *
 * `@deepseek-ai/*` stays external: the host runner pins those specifiers to the
 * approved deployment copies. Everything else (this plugin's own code) is inlined,
 * so the artifact has no runtime dependency on repository sources — that is what
 * makes it installable into a user profile.
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