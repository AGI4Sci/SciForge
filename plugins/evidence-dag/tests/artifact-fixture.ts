import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { syntheticWorkerOwner } from './worker-fixture.js'
import { ArtifactVersionService } from '../../../packages/domains/artifact-versions/src/main/service.js'
const now = () => new Date('2026-07-26T06:00:00.000Z')
/** Real native Artifact Versions service on synthetic disk; NOT a cross-process bridge. */
export async function artifactFixture() {
  const root = await mkdtemp(join(tmpdir(), 'evidence-artifacts-'))
  const workspaceRoot = join(root, 'workspace'); await mkdir(workspaceRoot)
  const bytes = Buffer.from('synthetic evidence artifact')
  await writeFile(join(workspaceRoot, 'result.txt'), bytes)
  const service = new ArtifactVersionService({ userDataDir: join(root, 'host-artifacts'), now })
  const scope = { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot }
  const trace = [{ id: 'claim-1', claimId: 'claim:1', artifact: { locator: 'result.txt', contentDigest: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, kind: 'text' } }]
  const calls: any[] = []
  const extractor = syntheticWorkerOwner(trace[0].id)
  const access = { audience: 'system' as const, callerId: 'synthetic-evidence-owner' }
  const ports = {
    storageRoot: join(root, 'evidence'), identity: { pluginId: 'sciforge-evidence-dag', version: '1.0.0', profileId: 'synthetic' },
    request: async (r: any): Promise<any> => {
      calls.push(structuredClone(r))
      if (r.scope && JSON.stringify(r.scope) !== JSON.stringify(scope)) throw new Error('Synthetic scope not authorized')
      if (r.operation === 'threads.read') return { ...scope, watermark: '7', trace: structuredClone(trace) }
      if (r.operation === 'threads.list') return [scope]
      if (r.operation === 'artifacts.commit') return service.commit(workspaceRoot, r.input, access)
      if (r.operation === 'artifacts.read') return service.read(workspaceRoot, r.input, access)
      if (r.operation === 'artifacts.listEvents') return service.listEvents(workspaceRoot, r.input, access)
      if (r.operation === 'sidecar.extract') return extractor.request('extract', r.input)
      if (r.operation === 'sidecar.close') { await extractor.close(); return { exited: true } }
      throw new Error(`Unsupported ${r.operation}`)
    }, cancel: async () => ({ cancelled: true, quiescent: true }),
  }
  return { root, scope, trace, calls, ports, service, access }
}
