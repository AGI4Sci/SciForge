import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { createDomainMainEntry } from '@sciforge/domain-artifact-versions/main'
import { createArtifactVersionCommitPortV1, createArtifactVersionEventListPortV1, createArtifactVersionReadPortV1 } from '@sciforge/domain-artifact-versions/contract'
import { deriveKnowledgeState } from './derive.js'

it('uses real owner pagination, bounded version reads, and refuses an unproven event prefix', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'kn-owner-boundary-')))
  const entry = createDomainMainEntry({ defineCapability: (definition: unknown) => definition } as never)
  const lifecycle = entry.contributions.find((c) => c.kind === 'main.runtime-lifecycle')!.value as any
  const dispose = await lifecycle.activate({ userDataDir: root })
  const factory = entry.contributions.find((c) => c.kind === 'main.capability-factory')!.value as any
  const definitions = factory.createDefinitions() as any[]
  const invoker = { invoke: async (contract: any, input: unknown) => {
    const definition = definitions.find((d) => d.id === contract.actionId)!
    return (await definition.handler(input, { caller: { audience: 'agent', callerId: 'agent:knowledge-owner-test', workspaceId: root } })).output
  } } as never
  const commit = createArtifactVersionCommitPortV1(invoker, root)
  const eventPort = createArtifactVersionEventListPortV1(invoker, root)
  const readPort = createArtifactVersionReadPortV1(invoker, root)
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, paperId: 'fixture', concepts: [{ term: 'Observed', definition: 'Exact sealed source.' }] })).toString('base64')
  try {
    for (let batch = 0; batch < 8; batch++) {
      expect((await commit.commit({
        idempotencyKey: `owner-boundary-batch-${batch}`,
        candidates: Array.from({ length: 126 }, (_, i) => ({
          candidateId: `fixture-${batch}-${i}`, expectedCurrentVersionId: null,
          kind: 'knowledge-net.record', intent: 'save' as const,
          content: { mode: 'snapshot' as const, mediaType: 'application/json', dataBase64: bytes }
        }))
      })).ok).toBe(true)
      if (batch === 3) {
        // 504 actual current versions require pagination. Use a low read budget to
        // test the same production boundary without 500 repeated disk-index reads.
        const state = await deriveKnowledgeState({ eventPort, readPort, limit: 1 })
        expect(state.provenance).toMatchObject({ coverage: 'partial', coverageReasons: ['version_limit'], versionsScanned: 1 })
        expect(state.provenance.eventsScanned).toBe(1008)
        expect(state.index.concepts).toHaveLength(1)
      }
    }
    const prefix = await deriveKnowledgeState({ eventPort, readPort })
    expect(prefix.provenance).toMatchObject({ coverage: 'partial', coverageReasons: ['event_limit'], eventsScanned: 2000, versionsScanned: 0 })
    expect(prefix.index.concepts).toEqual([])
  } finally {
    await dispose()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
  }
}, 60_000)
