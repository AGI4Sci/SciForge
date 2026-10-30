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