/**
 * Builds the self-contained ESM entrypoint at dist/main.js.
 * `@deepseek-ai/*` runtime packages stay external: the host runner pins their
 * resolution to the approved deployment copies. `@napi-rs/canvas` is a native
 * addon and must stay external too — esbuild cannot bundle `.node` binaries;
 * the runner child process resolves it from the repository node_modules
 * (G4 evidence: tests/host-loading.test.ts renders a real PNG in the isolated
 * process). zod, the `@sciforge/*` TypeScript source packages and the plugin
 * core are inlined so the artifact has no runtime dependency on repository
 * sources.
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

await build({
  entryPoints: [fileURLToPath(new URL('./src/dsh-adapter/index.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@deepseek-ai/*', '@napi-rs/canvas'],
  outfile: fileURLToPath(new URL('./dist/main.js', import.meta.url)),
  logLevel: 'warning'
})
