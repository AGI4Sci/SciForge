import { it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { readFile, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
it('builds precompiled ESM and an importable wheel that does not depend on adjacent Python source', async () => {
  const build = new URL('../scripts/build.mjs', import.meta.url)
  expect(existsSync(build), 'independent artifact build must exist').toBe(true)
  const release = await mkdtemp(join(tmpdir(), 'evidence-build-'))
  execFileSync(process.execPath, [fileURLToPath(build), release], { env: process.env, stdio: 'pipe', windowsHide: true })
  expect(existsSync(join(release, 'static.mjs')), 'precompiled static entry is independently consumable').toBe(true)
  expect(existsSync(join(release, 'python-worker.mjs')), 'approved executor component is precompiled').toBe(true)
  const entry = await readFile(join(release, 'main.mjs'), 'utf8')
  expect(entry).not.toContain('DomainMainRuntimeLifecycleContext')
  expect(entry).not.toContain('packages/domains/')
  expect(entry).not.toContain('/Users/')
  const manifest = JSON.parse(await readFile(join(release, 'artifacts.json'), 'utf8'))
  const wheel = join(release, manifest.wheel.file)
  expect(createHash('sha256').update(await readFile(wheel)).digest('hex')).toBe(manifest.wheel.sha256)
  const cwd = await mkdtemp(join(tmpdir(), 'evidence-wheel-'))
  const out = execFileSync(process.env.EVIDENCE_BUILD_PYTHON!, ['-I', '-c', 'import sys;sys.path.insert(0,sys.argv[1]);import evidence_dag;from evidence_dag.service import Engine;print(evidence_dag.__version__)', wheel], { cwd, env: process.env, windowsHide: true }).toString().trim()
  expect(out).toBe('1.0.0')
})
