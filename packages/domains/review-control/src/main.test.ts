import { describe, expect, it } from 'vitest'
import { context, definitions, receipt, recordingInvoker } from './test-support.js'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createDomainMainEntry as createArtifactEntry } from '@sciforge/domain-artifact-versions/main'
import { ARTIFACT_VERSIONS_CAPABILITY_IDS, artifactVersionListResultV1Schema, artifactVersionReadResultV1Schema } from '@sciforge/domain-artifact-versions/contract'
import type { DomainMainHost, DomainMainRuntimeLifecycleContribution, DomainMainSystemCapabilityInvoker } from '@sciforge/domain-sdk/host'
import { reviewReceiptCommitResultSchema } from './contract.js'

describe('review capabilities', () => {
  it('declares three workspace capabilities with specified effects and approval', () => {
    expect(definitions().map(({ id, effect, approval, scope }) => ({ id, effect, approval, scope }))).toEqual([
      { id: 'review.receipt.commit', effect: 'workspace-write', approval: 'none', scope: 'workspace' },
      { id: 'review.suggest', effect: 'read', approval: 'none', scope: 'workspace' },
      { id: 'review.coverage', effect: 'read', approval: 'none', scope: 'workspace' }
    ])
  })
  it.each([undefined, '', '   '])('rejects all handlers without workspace identity: %s', async (workspaceId) => {
    for (const definition of definitions()) {
      await expect(definition.handler({}, { caller: { workspaceId } })).rejects.toThrow(/workspace-scoped caller/)
    }
  })
  it('rejects commit without the Artifact Versions host', async () => {
    await expect(definitions()[0]!.handler({ operationId: 'operation-001', receipt }, context))
      .rejects.toThrow(/Artifact Versions/)
  })
  it('commits exactly one review.receipt candidate through the public port', async () => {
    const { calls, invoker } = recordingInvoker()
    await definitions(invoker)[0]!.handler({ operationId: 'operation-001', receipt }, context)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ effect: 'workspace-write', input: {
      idempotencyKey: 'review/receipt:operation-001',
      candidates: [{ kind: 'review.receipt', expectedCurrentVersionId: null }]
    }, options: { workspaceId: context.caller.workspaceId, idempotencyKey: 'review/receipt:operation-001' } })
    expect(calls[0]!.input.candidates).toHaveLength(1)
  })
  it('reuses the same persistence idempotency key for a repeated operation', async () => {
    const { calls, invoker } = recordingInvoker()
    const commit = definitions(invoker)[0]!
    await commit.handler({ operationId: 'operation-001', receipt }, context)
    await commit.handler({ operationId: 'operation-001', receipt }, context)
    expect(calls.map((call) => call.input.idempotencyKey)).toEqual([
      'review/receipt:operation-001', 'review/receipt:operation-001'
    ])
  })
  it('uses distinct persistence keys for different operations', async () => {
    const { calls, invoker } = recordingInvoker()
    const commit = definitions(invoker)[0]!
    for (const operationId of ['operation-001', 'operation-002']) await commit.handler({ operationId, receipt }, context)
    expect(new Set(calls.map((call) => call.input.idempotencyKey)).size).toBe(2)
  })
  it('does not write after cancellation', async () => {
    const { calls, invoker } = recordingInvoker()
    await expect(definitions(invoker)[0]!.handler({ operationId: 'operation-001', receipt }, {
      ...context, signal: AbortSignal.abort()
    })).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
  it('does not write after principal revocation', async () => {
    const { calls, invoker } = recordingInvoker()
    await expect(definitions(invoker)[0]!.handler({ operationId: 'operation-001', receipt }, {
      ...context, assertPrincipalCurrent: () => { throw new Error('Principal revoked') }
    })).rejects.toThrow('Principal revoked')
    expect(calls).toHaveLength(0)
  })
  it.each(['failure', 'empty', 'digest', 'retention', 'extra'])('rejects invalid commit response: %s', async (mode) => {
    const invoker = { invoke: async () => mode === 'failure'
      ? { ok: false, issue: { message: 'synthetic-private-sentinel' } }
      : { ok: true, value: { versions: mode === 'empty' ? [] : Array.from({ length: mode === 'extra' ? 2 : 1 }, () => ({
        artifact: { artifactId: 'artifact:test' },
        version: { versionId: 'artifact-version:test', storage: {
          mode: mode === 'retention' ? 'reference' : 'snapshot',
          contentDigest: mode === 'digest' ? 'bad' : createHash('sha256').update(JSON.stringify(receipt)).digest('hex')
        } }
      })) } }
    } as unknown as NonNullable<DomainMainHost['capabilities']>
    await expect(definitions(invoker)[0]!.handler({ operationId: 'operation-001', receipt }, context)).rejects.toThrow()
  })
  it.todo('asserts audiences against the approved review-control specification')
  it.todo('verifies two appended receipts form a valid chain once chain ownership and hashing are specified')
})

// Uses only the Artifact Versions package's public main and contract entrypoints.
// This adapter validates both sides of the port; it is not the application Broker.
async function persistedFixture() {
  const root = await mkdtemp(join(tmpdir(), 'review-control-contract-'))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const entry = createArtifactEntry({
    getUserDataDir: () => root, defineCapability: (definition: unknown) => definition
  } as unknown as DomainMainHost)
  const lifecycle = entry.contributions.find((item) => item.kind === 'main.runtime-lifecycle')!.value as DomainMainRuntimeLifecycleContribution
  const dispose = await lifecycle.activate({ userDataDir: root } as Parameters<typeof lifecycle.activate>[0])
  const factory = entry.contributions.find((item) => item.kind === 'main.capability-factory')!.value as {
    createDefinitions(): ReadonlyArray<{ id: string; handler(input: unknown, context: unknown): Promise<{ output: unknown }> }>
  }
  const artifacts = factory.createDefinitions()
  const calls: string[] = []
  const invoker: DomainMainSystemCapabilityInvoker = {
    invoke: async (contract, input, options) => {
      calls.push(contract.actionId)
      const handler = artifacts.find((item) => item.id === contract.actionId)!
      const result = await handler.handler(contract.inputSchema.parse(input), {
        caller: { audience: 'system', callerId: 'review-control:contract-test', workspaceId: options?.workspaceId }
      })
      return contract.outputSchema.parse(result.output)
    }
  } as DomainMainSystemCapabilityInvoker
  const invokeArtifact = async (id: string, input: unknown) => (await artifacts.find((item) => item.id === id)!.handler(input, {
    caller: { audience: 'system', callerId: 'review-control:contract-test', workspaceId: workspace }
  })).output
  return { workspace, calls, invoker, invokeArtifact, async close() {
    if (typeof dispose === 'function') await dispose()
    await rm(root, { recursive: true, force: true })
  } }
}

describe('public Artifact Versions persistence path', () => {
  it('persists one version for repeated operations, including after recreating the review entry', async () => {
    const fixture = await persistedFixture()
    try {
      const caller = { caller: { workspaceId: fixture.workspace } }
      const input = { operationId: 'persistent-operation-001', receipt }
      const first = await definitions(fixture.invoker)[0]!.handler(input, caller)
      const second = await definitions(fixture.invoker)[0]!.handler(input, caller)
      expect(second).toEqual(first)
      expect(fixture.calls).toHaveLength(2)
      const list = artifactVersionListResultV1Schema.parse(await fixture.invokeArtifact(ARTIFACT_VERSIONS_CAPABILITY_IDS.list, {}))
      expect(list.ok).toBe(true)
      if (!list.ok) throw new Error('List failed')
      expect(list.value.items).toHaveLength(1)
      const committed = reviewReceiptCommitResultSchema.parse(first.output)
      expect(committed.contentDigest).toMatch(/^[a-f0-9]{64}$/)
      const read = artifactVersionReadResultV1Schema.parse(await fixture.invokeArtifact(ARTIFACT_VERSIONS_CAPABILITY_IDS.read, { versionId: committed.versionId }))
      if (!read.ok) throw new Error('Read failed')
      expect(JSON.parse(Buffer.from(read.value.dataBase64, 'base64').toString('utf8'))).toEqual(receipt)
    } finally { await fixture.close() }
  })
  it('persists distinct operations and rejects conflicting replay without changing the original', async () => {
    const fixture = await persistedFixture()
    try {
      const caller = { caller: { workspaceId: fixture.workspace } }
      const commit = definitions(fixture.invoker)[0]!
      await commit.handler({ operationId: 'persistent-operation-001', receipt }, caller)
      await commit.handler({ operationId: 'persistent-operation-002', receipt: { ...receipt, verdict: 'corrected' } }, caller)
      await expect(commit.handler({ operationId: 'persistent-operation-001', receipt: { ...receipt, verdict: 'rejected' } }, caller)).rejects.toThrow()
      const list = artifactVersionListResultV1Schema.parse(await fixture.invokeArtifact(ARTIFACT_VERSIONS_CAPABILITY_IDS.list, {}))
      if (!list.ok) throw new Error('List failed')
      expect(list.value.items).toHaveLength(2)
      const verdicts: string[] = []
      for (const item of list.value.items) {
        const read = artifactVersionReadResultV1Schema.parse(await fixture.invokeArtifact(ARTIFACT_VERSIONS_CAPABILITY_IDS.read, { versionId: item.version.versionId }))
        if (!read.ok) throw new Error('Read failed')
        verdicts.push(JSON.parse(Buffer.from(read.value.dataBase64, 'base64').toString('utf8')).verdict)
      }
      expect(verdicts.sort()).toEqual(['accepted', 'corrected'])
    } finally { await fixture.close() }
  })
  it('isolates the same operation key across workspaces', async () => {
    const fixture = await persistedFixture()
    try {
      const secondWorkspace = join(fixture.workspace, 'second')
      await mkdir(secondWorkspace)
      const commit = definitions(fixture.invoker)[0]!
      const input = { operationId: 'persistent-operation-001', receipt }
      const first = await commit.handler(input, { caller: { workspaceId: fixture.workspace } })
      const second = await commit.handler(input, { caller: { workspaceId: secondWorkspace } })
      expect(reviewReceiptCommitResultSchema.parse(first.output).versionId)
        .not.toEqual(reviewReceiptCommitResultSchema.parse(second.output).versionId)
    } finally { await fixture.close() }
  })
})
