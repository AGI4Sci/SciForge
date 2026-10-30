import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(root, '../..')
const outdir = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'dist')
await mkdir(outdir, { recursive: true })
const result = await build({
  absWorkingDir: root, entryPoints: {
    main: 'src/dsh-adapter.ts', core: 'src/core.ts', runtime: 'src/runtime.ts', static: 'src/static-adapter.ts',
    ports: resolve(repo, 'packages/domains/evidence-dag/src/host/ports.ts'),
    'python-worker': resolve(repo, 'packages/domains/evidence-dag/src/host/python-worker.ts'),
    'host-provider': resolve(repo, 'packages/domains/evidence-dag/src/host/host-provider.ts'),
    'production-service': resolve(repo, 'packages/domains/evidence-dag/src/host/production-service.ts')
  },
  outdir, outExtension: { '.js': '.mjs' }, bundle: true, splitting: true, platform: 'node', target: 'node22', format: 'esm',
  minify: true, sourcemap: false, legalComments: 'none', metafile: true,
  external: ['zod', '@deepseek-ai/dsh-tools'],
  alias: { '@sciforge/domain-artifact-versions/contract': resolve(repo, 'packages/domains/artifact-versions/src/contract.ts'), '@sciforge/domain-sdk/contract': resolve(repo, 'packages/domain-sdk/src/contract.ts') },
})
for (const input of Object.keys(result.metafile.inputs)) {
  if (/(^|\/)src\/(main|renderer|shared)\//.test(input) && !input.includes('packages/domains/evidence-dag/')) throw new Error(`Forbidden Host-private build input ${input}`)
  if (input.includes('artifact-version-static-ports') || input.includes('domain-sdk/src/host')) throw new Error(`Forbidden Host Context input ${input}`)
}
execFileSync(process.env.EVIDENCE_BUILD_PYTHON ?? process.env.SCIFORGE_PYTHON_COMMAND ?? (process.platform === 'win32' ? 'python.exe' : 'python3'), [resolve(root, 'scripts/build-wheel.py'), resolve(repo, 'packages/domains/evidence-dag/python'), outdir], { stdio: 'inherit', windowsHide: true })
const wheelFile = 'sciforge_evidence_dag-1.0.0-py3-none-any.whl'
const wheel = await readFile(resolve(outdir, wheelFile))
const hashes = {}
for (const filename of Object.keys(result.metafile.outputs)) {
  const bytes = await readFile(resolve(root, filename)); hashes[filename.split('/').at(-1)] = createHash('sha256').update(bytes).digest('hex')
}
await writeFile(resolve(outdir, 'artifacts.json'), JSON.stringify({ version: '1.0.0', dsh: '0.2.0-rc.2', esm: hashes, wheel: { file: wheelFile, sha256: createHash('sha256').update(wheel).digest('hex') }, external: { zod: '4.4.3', '@deepseek-ai/dsh-tools': '0.2.0-rc.2', '@deepseek-ai/cordis': '4.0.4' } }, null, 2) + '\n')
console.log(`Built Evidence DAG ESM + wheel in ${outdir}`)
