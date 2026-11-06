import { describe, expect, it } from 'vitest'
import { MultiAgentChildRunRecord, type MultiAgentChildRunPage } from '../../../../packages/workers/multi-agent/src'
import { renderSubagentContext, SUBAGENT_CONTEXT_MAX_BYTES } from './subagent-context'

function child(id: string, fields: Partial<MultiAgentChildRunRecord> = {}): MultiAgentChildRunRecord {
  return MultiAgentChildRunRecord.parse({
    id, parentThreadId: 'parent', parentTurnId: 'turn', prompt: 'Research',
    status: 'completed', createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:01Z',
    ...fields
  })
}

function page(records: MultiAgentChildRunRecord[]): MultiAgentChildRunPage {
  return { records, nextCursor: null, historyTruncated: false }
}

function payload(text: string) {
  return JSON.parse(text.split('\n').at(-1)!)
}

describe('automatic subagent context budget', () => {
  it('does not replay completed output even when one summary fills the model window', () => {
    const records = page([child('report', {
      summary: 'FULL_REPORT'.repeat(100_000),
      progress: { message: 'old progress', updatedAt: 'now' },
      transcript: [{ id: 'result', kind: 'assistant_message', text: 'PRIVATE_TRANSCRIPT' }],
      error: { code: 'child_failed', message: 'PRIVATE_ERROR' }
    })])
    const text = renderSubagentContext(records)
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(SUBAGENT_CONTEXT_MAX_BYTES)
    expect(text).not.toMatch(/FULL_REPORT|old progress|PRIVATE_TRANSCRIPT|PRIVATE_ERROR/)
    expect(payload(text)).toEqual({ children: [{ childId: 'report', status: 'completed', updatedAt: '2026-11-05T00:00:01Z' }], partial: false })
    expect(renderSubagentContext(records)).toBe(text)
  })

  it('bounds the complete escaped UTF-8 packet and keeps live work first', () => {
    const text = renderSubagentContext(page([
      child('live', { status: 'running', progress: { currentAction: '正在处理🧪'.repeat(25), updatedAt: 'now' } }),
      ...Array.from({ length: 100 }, (_, i) => child(`child-${i}`, { label: '\u0000\n"🧪研究'.repeat(100) }))
    ]))
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(SUBAGENT_CONTEXT_MAX_BYTES)
    const data = payload(text)
    expect(data.partial).toBe(true)
    expect(data.children[0]).toMatchObject({ childId: 'live', status: 'running' })
    expect(Buffer.byteLength(data.children[0].progress)).toBeLessThanOrEqual(240)
    expect(text).not.toContain('\ufffd')
    expect(text).toContain('subagent_status({})')
  })

  it('does not truncate identities or forward cursors past omitted records', () => {
    const text = renderSubagentContext({
      ...page([child('oversized-id'.repeat(1000)), child('retrievable')]),
      nextCursor: 'cursor-after-both-children', historyTruncated: true
    })
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(SUBAGENT_CONTEXT_MAX_BYTES)
    expect(payload(text)).toMatchObject({ children: [{ childId: 'retrievable' }], partial: true })
    expect(text).not.toContain('cursor-after-both-children')
    expect(text).not.toContain('oversized-id')
  })

  it('leaves sessions without children untouched', () => {
    expect(renderSubagentContext(page([]))).toBe('')
  })
})
