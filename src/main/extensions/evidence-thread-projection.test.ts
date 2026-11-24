import { projectAgentRuntimeThreadSnapshot } from '../runtime/agent-runtime/thread-wire-projection'
import { describe, expect, it } from 'vitest'
import type { AgentRuntimeItem, AgentRuntimeThreadSnapshot } from '../../shared/agent-runtime-contract'

const scope = { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: '/owned/workspace' }

function snapshot(items: AgentRuntimeItem[]): AgentRuntimeThreadSnapshot {
  return {
    id: scope.threadId, runtimeId: 'codex', workspace: scope.workspaceRoot,
    title: 'Projection', updatedAt: '2026-10-18T00:00:00Z', latestSeq: 119,
    turns: [{ id: 'turn-1', threadId: scope.threadId, status: 'completed', items }]
  }
}

// The generic agentThreads Host service uses this canonical lossless projection.
async function readProjection(detail: AgentRuntimeThreadSnapshot) {
  return projectAgentRuntimeThreadSnapshot(detail, scope)
}

describe('canonical agent thread wire projection', () => {
  it.each([
    ['undefined metadata', { detail: undefined }], ['array undefined', [undefined]],
    ['NaN', NaN], ['infinity', Infinity], ['bigint', 1n],
    ['function', () => 1], ['symbol', Symbol('invalid')],
    ['date', new Date('2026-10-18')], ['map', new Map()], ['set', new Set()],
    ['sparse array', new Array(1)],
    ['cycle', (() => { const value: Record<string, unknown> = {}; value.self = value; return value })()],
    ['non-enumerable', Object.defineProperty({}, 'hidden', { value: 1 })],
    ['symbol key', { [Symbol('hidden')]: 1 }],
    ['array extra', Object.assign([], { extra: 1 })],
    ['unknown item field', undefined]
  ])('rejects non-JSON %s without dropping unknown values', async (name, value) => {
    const item = { id: 'bad', kind: 'tool', ...(name === 'unknown item field' ? { futureField: value } : { meta: { value } }) }
    await expect(readProjection(snapshot([item as AgentRuntimeItem]))).rejects.toThrow(/lossless acyclic plain JSON/)
  })

  it('rejects accessors without executing them', async () => {
    let reads = 0
    const item = Object.defineProperty({ id: 'bad', kind: 'tool' }, 'detail', {
      enumerable: true, get() { reads++; return undefined }
    }) as AgentRuntimeItem
    await expect(readProjection(snapshot([item]))).rejects.toThrow(/plain JSON/)
    expect(reads).toBe(0)
  })

  it('preserves legal future fields, shared references, null, false, signed zero and own __proto__ without mutation', async () => {
    const shared = { value: [null, false, '', -0, 0] }
    const meta = JSON.parse('{"__proto__":{"safe":true}}')
    Object.assign(meta, { first: shared, second: shared })
    const item = { id: 'tool', kind: 'tool' as const, meta, futureField: { nested: ['kept'] } }
    const detail = snapshot([item])
    detail.turns.push({ id: 'turn-2', threadId: scope.threadId, status: 'completed' })
    const result = await readProjection(detail)
    expect(result.trace).toStrictEqual([item])
    const projectedMeta = result.trace[0].meta as { first: { value: unknown[] }; second: { value: unknown[] } }
    expect(Object.hasOwn(projectedMeta, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(projectedMeta)).toBe(Object.prototype)
    expect(projectedMeta).not.toBe(meta)
    expect(Object.is(projectedMeta.first.value[3], -0)).toBe(true)
    projectedMeta.first.value.push('changed')
    expect(shared.value).toHaveLength(5)
  })

  it.each([
    { runtimeId: 'claude' as const }, { id: 'foreign-thread' },
    { workspace: '/foreign/workspace' }, { workspace: undefined }, { workspace: '' },
    { workspace: ' /owned/workspace ' }
  ])('rejects a snapshot whose actual identity does not match the caller: %j', async change => {
    await expect(readProjection({ ...snapshot([]), ...change })).rejects.toThrow(/scope mismatch/i)
  })

  it('omits only declared optional item and completion-receipt fields', async () => {
    const receipt = {
      contractVersion: 'completion-receipt.v1' as const, receiptId: 'r1', kind: 'visual.look' as const,
      status: 'satisfied' as const, issuer: 'host', callId: 'call', subjectRef: 'subject',
      relatedRefs: undefined, parentReceiptIds: undefined, attestation: undefined, sha256: undefined,
      createdAt: '2026-10-18T00:00:00Z'
    }
    const item: AgentRuntimeItem = {
      id: 'optional', kind: 'tool', turnId: undefined, text: undefined, summary: undefined,
      status: undefined, toolKind: undefined, effects: undefined, completionReceipts: [receipt],
      detail: undefined, detailArtifact: undefined, outputStatus: undefined, meta: undefined,
      createdAt: undefined, principal: undefined, principalContext: undefined
    }
    const result = await readProjection(snapshot([item]))
    expect(Object.keys(result.trace[0])).toEqual(['id', 'kind', 'completionReceipts'])
    expect(result.trace[0].completionReceipts).toStrictEqual([{
      contractVersion: receipt.contractVersion, receiptId: receipt.receiptId, kind: receipt.kind,
      status: receipt.status, issuer: receipt.issuer, callId: receipt.callId,
      subjectRef: receipt.subjectRef, createdAt: receipt.createdAt
    }])
    expect(Object.hasOwn(receipt, 'sha256')).toBe(true)
  })

  it('omits absent optional timeline fields while preserving real-shaped nested tool receipts and order', async () => {
    const receiptText = '{"content":[{"type":"text","text":"{\\"receipt\\":{\\"exitCode\\":0,\\"stdout\\":\\"measured\\"}}"}]}'
    const items: AgentRuntimeItem[] = [
      { id: 'user', kind: 'user_message', text: 'inspect', detail: undefined },
      { id: 'tool', turnId: 'turn-1', kind: 'tool', toolKind: 'tool_call', status: 'success',
        detail: receiptText, summary: undefined, meta: { result: { content: [{ type: 'text', text: receiptText }], receipt: { paths: ['a', 'b'], exitCode: 0 } } } },
      { id: 'final', kind: 'assistant_message', text: 'done', detail: undefined }
    ]
    const detail = snapshot(items)
    const result = await readProjection(detail)
    expect(result).toStrictEqual(JSON.parse(JSON.stringify(result)))
    expect(result.trace.map(item => item.id)).toEqual(['user', 'tool', 'final'])
    expect(result.trace[0]).toEqual({ id: 'user', kind: 'user_message', text: 'inspect' })
    expect(result.trace[1].detail).toBe(receiptText)
    expect(result.trace[1].meta).toStrictEqual(items[1].meta)
    expect(result.trace[1]).not.toBe(items[1])
    expect(result.trace[1].meta).not.toBe(items[1].meta)
    expect(Object.hasOwn(items[0], 'detail')).toBe(true)
    expect(result).toMatchObject({ ...scope, watermark: '119' })
  })
})
