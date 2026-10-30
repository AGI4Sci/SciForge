import { cp, mkdtemp, readFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PythonEvidenceWorker } from '@sciforge/domain-evidence-dag/host/python-worker'
import type { Json } from '@sciforge/domain-evidence-dag/host/ports'
export const syntheticReasoner = async (input: any) => {
  const system = input.messages.find((m: any) => m.role === 'system')?.content ?? ''
  if (system.includes('EDAG-TASK: nli')) return '{"entailment":0.9,"label":"entailment"}'
  if (system.includes('EDAG-TASK: adversarial')) return '{"result":"passed","confidence":0.9,"rationale":"synthetic"}'
  return JSON.stringify({ nodes: [{ tmp_id: 'source', type: 'source_assertion', content: 'Synthetic source.', trace_ref: 't1' }, { tmp_id: 'claim', type: 'claim', content: 'Synthetic claim.', trace_ref: 't1' }], edges: [{ src: 'source', dst: 'claim', rel: 'supports' }] })
}
/** Synthetic unit-fixture reasoning, real packaged worker/extractor; not model acceptance. */
export function syntheticWorkerOwner(traceRef: string) {
  let options: ReturnType<typeof workerOptions> | undefined
  let worker: PythonEvidenceWorker | undefined
  return {
    async request(operation: 'extract' | 'commitSnapshot' | 'readSnapshot' | 'snapshotProducts', input: Json) {
      options ??= workerOptions()
      worker ??= new PythonEvidenceWorker({ ...await options, reasoner: async input => (await syntheticReasoner(input)).replaceAll('t1', traceRef) })
      return worker.request(operation, input)
    },
    async close() { await worker?.close(); worker = undefined },
  }
}
export async function workerOptions() {
  const root = await mkdtemp(join(tmpdir(), 'evidence-worker-'))
  const release = join(root, 'release')
  if (process.env.EVIDENCE_TEST_RELEASE) await cp(process.env.EVIDENCE_TEST_RELEASE, release, { recursive: true })
  else execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build.mjs', import.meta.url)), release], { env: process.env, stdio: 'pipe', windowsHide: true })
  await symlink(fileURLToPath(new URL('../../../node_modules', import.meta.url)), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  for (const part of ['home', 'tmp', 'workspace']) await mkdir(join(root, part))
  const artifacts = JSON.parse(await readFile(join(release, 'artifacts.json'), 'utf8'))
  const executable = execFileSync(process.env.EVIDENCE_BUILD_PYTHON ?? process.env.SCIFORGE_PYTHON_COMMAND ?? (process.platform === 'win32' ? 'python.exe' : 'python3'), ['-I', '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', windowsHide: true }).trim()
  return { root, release, executable, wheelPath: join(release, artifacts.wheel.file), wheelSha256: artifacts.wheel.sha256, storageRoot: join(root, 'threads'), home: join(root, 'home'), tmpDir: join(root, 'tmp'), reasoner: syntheticReasoner }
}
