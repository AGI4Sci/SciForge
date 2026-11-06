import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainRendererCapabilityInvoker, DomainRendererWorkbenchHost } from '@sciforge/domain-sdk/host'
import type { ResearchRecordNode } from '../research-record-contract'
import { openResearchRecordCheckpoint } from './ResearchRecordCheckpoint'

const scope = { runtimeId: 'codex', threadId: 'main-thread', workspaceRoot: '/lab' }
const node = { id: 'round:1', kind: 'round', scope, turnId: 'turn-1' } as ResearchRecordNode
const ref = { versionId: 'artifact-version:exact:2', contentDigest: 'a'.repeat(64) }
function harness(result: unknown) {
  const requests: unknown[] = [], opened: unknown[] = []
  const invoker = { invoke: async (contract: { actionId: string }, input: unknown, context: unknown) => {
    requests.push({ action: contract.actionId, input, context }); return result
  } } as unknown as DomainRendererCapabilityInvoker
  const workbench: DomainRendererWorkbenchHost = { openRightPanel: () => undefined, canOpenResource: () => true, openResource: input => { opened.push(input); return true } }
  return { invoker, workbench, requests, opened }
}

test('round navigation uses exact turn status and expected digest, never latest', async () => {
  const h = harness({ ok: true, value: { ...scope, turnId: 'turn-1', state: 'committed', artifactRef: ref } })
  await openResearchRecordCheckpoint(node, scope, h.invoker, h.workbench)
  assert.deepEqual(h.requests, [{ action: 'research-checkpoints.turn-status', input: { runtimeId: 'codex', threadId: 'main-thread', turnId: 'turn-1' }, context: { workspaceId: '/lab' } }])
  assert.deepEqual(h.opened, [{ sessionId: 'main-thread', resource: { resourceKind: 'artifact-version', resourceId: ref.versionId, integrity: { algorithm: 'sha256', expectedDigest: `sha256:${ref.contentDigest}` } } }])
})

test('unrecorded, pending, failed and conflicting rounds never open another version', async () => {
  for (const state of ['unrecorded', 'pending', 'failed', 'stale-conflict']) {
    const h = harness({ ok: true, value: { ...scope, turnId: 'turn-1', state, error: 'owner failure' } })
    await assert.rejects(openResearchRecordCheckpoint(node, scope, h.invoker, h.workbench))
    assert.equal(h.opened.length, 0)
  }
})

test('missing identity and cross-workspace sources stay unknown without reading another owner', async () => {
  for (const candidate of [{ ...node, scope: undefined }, { ...node, scope: { ...scope, workspaceRoot: '/other' } }]) {
    const h = harness(null)
    await assert.rejects(openResearchRecordCheckpoint(candidate, scope, h.invoker, h.workbench))
    assert.equal(h.requests.length, 0)
    assert.equal(h.opened.length, 0)
  }
})

test('mismatched returned turn is rejected', async () => {
  const h = harness({ ok: true, value: { ...scope, turnId: 'different-turn', state: 'committed', artifactRef: ref } })
  await assert.rejects(openResearchRecordCheckpoint(node, scope, h.invoker, h.workbench), /身份不匹配/)
  assert.equal(h.opened.length, 0)
})

test('a phase resolves its saved round identity before reading that exact turn', async () => {
  const h = harness({ ok: true, value: { ...scope, turnId: 'turn-1', state: 'committed', artifactRef: ref } })
  const invoke = h.invoker.invoke
  const invoker = { ...h.invoker, invoke: (contract: { actionId: string }, input: { nodeId?: string }, context: unknown) => {
    if (contract.actionId === 'evidence-dag.record.view') {
      assert.equal(input.nodeId, node.id); return Promise.resolve({ node })
    }
    return invoke(contract as never, input, context as never)
  } } as DomainRendererCapabilityInvoker
  await openResearchRecordCheckpoint({ ...node, kind: 'phase', recentRound: { id: node.id } as ResearchRecordNode['recentRound'] }, scope, invoker, h.workbench)
  assert.equal(h.opened.length, 1)
})


test('restores the owning session read-only before resource navigation and keeps failed restores explicit', async () => {
  const result = { ok: true, value: { ...scope, turnId: 'turn-1', state: 'committed', artifactRef: ref } }
  for (const available of [true, false]) {
    const h = harness(result)
    const workbench = { ...h.workbench, openSession: async (input: unknown) => {
      assert.deepEqual(input, { ...scope, focusComposer: false, readOnly: true })
      assert.equal(h.opened.length, 0)
      return available
    } }
    if (available) await openResearchRecordCheckpoint(node, scope, h.invoker, workbench)
    else await assert.rejects(openResearchRecordCheckpoint(node, scope, h.invoker, workbench), /所属会话当前不可用/)
    assert.equal(h.opened.length, available ? 1 : 0)
  }
})
