import { describe, expect, it, vi } from 'vitest'
import { createDomainMainEntry } from './main.js'
import { definitionBytes, sha256 } from './derive.js'
import { knowledgeResourceSchema } from './resource-contract.js'

const resource = knowledgeResourceSchema.parse({ schemaVersion: 1, name: 'Data', aliases: [], identifiers: [], description: 'Test',
  dataTypes: ['image'], processingLevel: 'unknown', locations: [], access: { mode: 'unknown', evidenceIds: [] }, paperLinks: [], evidence: [], checks: [] })
const context = { caller: { workspaceId: '/w' } }
function capabilities(invoke: unknown) {
  const entry = createDomainMainEntry({ defineCapability: (definition: unknown) => definition, capabilities: { invoke } } as never)
  return (entry.contributions[0]!.value as { createDefinitions(): Array<{ id: string; handler(input: unknown, context: unknown): Promise<{ output: unknown }> }> }).createDefinitions()
}
const read = (kind = 'knowledge-net.resource', artifactId = 'a1') => ({ ok: true, value: {
  artifact: { artifactId, kind }, version: { versionId: 'v1', storage: { mode: 'snapshot', contentDigest: sha256(definitionBytes(resource)) } },
  dataBase64: definitionBytes(resource).toString('base64')
} })

describe('resource capabilities', () => {
  it('creates through canonical commit with stable request bytes and no event scan', async () => {
    const invoke = vi.fn(async (_contract: unknown, input: any) => ({ ok: true, value: { versions: [{ artifact: { artifactId: 'a1' },
      version: { versionId: 'v1', storage: { mode: 'snapshot', contentDigest: sha256(Buffer.from(input.candidates[0].content.dataBase64, 'base64')) } } }] } }))
    const commit = capabilities(invoke).find((def) => def.id === 'knowledge-net.resource.commit')!
    expect(commit).toBeDefined()
    const input = { operationId: 'create-resource-1', expectedVersionId: null, resource }
    expect((await commit.handler(input, context)).output).toEqual({ resourceId: 'a1', versionId: 'v1', contentDigest: sha256(definitionBytes(resource)) })
    await commit.handler(input, context)
    expect(invoke.mock.calls[0]).toEqual(invoke.mock.calls[1])
    expect(invoke.mock.calls[0]![1].candidates[0]).toMatchObject({ candidateId: 'resource', kind: 'knowledge-net.resource', expectedCurrentVersionId: null })
  })
  it('validates supplied historical baseline and lets underlying commit decide stale/replay', async () => {
    const invoke = vi.fn(async (_contract: unknown, input: any) => 'candidates' in input
      ? { ok: false, issue: { code: 'stale-base', message: 'Changed' } } : read())
    const commit = capabilities(invoke).find((def) => def.id === 'knowledge-net.resource.commit')!
    await expect(commit.handler({ operationId: 'update-resource-1', resourceId: 'a1', expectedVersionId: 'v1', resource }, context)).rejects.toThrow(/stale_base/)
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[0]![1]).toMatchObject({ versionId: 'v1' })
  })
  it('rejects baseline belonging to another kind or identity before committing', async () => {
    for (const baseline of [read('other.kind'), read('knowledge-net.resource', 'a2')]) {
      const invoke = vi.fn(async () => baseline)
      const commit = capabilities(invoke).find((def) => def.id === 'knowledge-net.resource.commit')!
      await expect(commit.handler({ operationId: 'update-resource-2', resourceId: 'a1', expectedVersionId: 'v1', resource }, context)).rejects.toThrow(/invalid_input/)
      expect(invoke).toHaveBeenCalledTimes(1)
    }
  })
  it('fails closed when authorization is revoked', async () => {
    const invoke = vi.fn()
    const commit = capabilities(invoke).find((def) => def.id === 'knowledge-net.resource.commit')!
    await expect(commit.handler({ operationId: 'create-resource-2', expectedVersionId: null, resource },
      { ...context, assertPrincipalCurrent: () => { throw new Error('revoked') } })).rejects.toThrow('revoked')
    expect(invoke).not.toHaveBeenCalled()
  })
  it('rejects removed historical evidence and propagates unreadable baselines', async () => {
    const original = { ...resource, evidence: [{ evidenceId: 'e1', url: 'https://example.org/', quote: 'Source', observedAt: '2026-11-20T00:00:00Z', actorLabel: 'test' }] }
    const baseline = read()
    baseline.value.dataBase64 = definitionBytes(original).toString('base64')
    baseline.value.version.storage.contentDigest = sha256(definitionBytes(original))
    const invoke = vi.fn(async () => baseline)
    const commit = capabilities(invoke).find((def) => def.id === 'knowledge-net.resource.commit')!
    await expect(commit.handler({ operationId: 'update-resource-3', resourceId: 'a1', expectedVersionId: 'v1', resource }, context)).rejects.toThrow(/unchanged prefix/)
    expect(invoke).toHaveBeenCalledTimes(1)
    const unavailable = capabilities(async () => ({ ok: false, issue: { code: 'content-unavailable', message: 'Missing bytes' } })).find((def) => def.id === 'knowledge-net.resource.commit')!
    await expect(unavailable.handler({ operationId: 'update-resource-4', resourceId: 'a1', expectedVersionId: 'v1', resource }, context)).rejects.toThrow(/content_unavailable/)
  })
})
