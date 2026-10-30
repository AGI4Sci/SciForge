import { it, expect } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ArtifactVersionService } from '../../../packages/domains/artifact-versions/src/main/service.js'
import { EvidenceRuntime } from '../src/runtime.js'
const now = () => new Date('2026-07-26T06:00:00.000Z')
import { artifactFixture } from './artifact-fixture.js'
it('pins real immutable artifact refs, persists lifecycle cursor/receipts and resumes after the old cursor', async () => {
  const f = await artifactFixture()
  const runtime = new EvidenceRuntime(f.ports, { now })
  await runtime.start()
  await runtime.update(f.scope)
  const persisted = JSON.parse(await readFile(join(f.ports.storageRoot, 'deltas.json'), 'utf8'))
  const projection = persisted.chains[0].records[0].payload.trace[0].evidenceArtifactVersions
  expect(projection?.status).toBe('ready')
  expect(projection.versions[0].ref.contentDigest).toBe(f.trace[0].artifact.contentDigest)
  await runtime.pollArtifactEvents(f.scope)
  const lifecycle = JSON.parse(await readFile(join(f.ports.storageRoot, 'artifact-version-lifecycle.json'), 'utf8'))
  expect(lifecycle.workspaces[0].cursor).toBeGreaterThan(0)
  expect(lifecycle.receipts[0].deltaDigests).toHaveLength(1)
  await runtime.close()
  f.calls.length = 0
  const restart = new EvidenceRuntime(f.ports, { now })
  await restart.start()
  await restart.pollArtifactEvents(f.scope)
  expect(f.calls.find(r => r.operation === 'artifacts.listEvents').input.afterSequence).toBe(lifecycle.workspaces[0].cursor)
  await restart.close()
})
