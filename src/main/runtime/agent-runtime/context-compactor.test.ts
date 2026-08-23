import { describe, expect, it } from 'vitest'
import type { AgentRuntimeItem } from '../../../shared/agent-runtime-contract'
import { AgentRuntimeContextCompactor } from './context-compactor'

function item(id: string, kind: AgentRuntimeItem['kind'], text: string): AgentRuntimeItem {
  return { id, kind, text, status: 'completed' }
}

describe('AgentRuntimeContextCompactor', () => {
  it('plans normal, aggressive, and force compaction from thresholds', () => {
    const compactor = new AgentRuntimeContextCompactor({
      softThreshold: 10,
      hardThreshold: 20
    })
    const history = [item('u1', 'user_message', 'x'.repeat(24))]

    expect(compactor.planCompaction([item('tiny', 'user_message', 'short')])).toBeNull()
    expect(compactor.planCompaction(history)).toMatchObject({
      mode: 'normal',
      keepRecent: 4
    })
    expect(compactor.planCompaction(history, { promptTokens: 16 })).toMatchObject({
      mode: 'aggressive',
      keepRecent: 2
    })
    expect(compactor.planCompaction(history, { promptTokens: 24 })).toMatchObject({
      mode: 'force',
      keepRecent: 1
    })
    expect(compactor.planCompaction([item('tiny', 'user_message', 'short')], { promptTokens: 12 })).toMatchObject({
      mode: 'normal',
      keepRecent: 4
    })
  })

  it('compacts older runtime items while preserving frozen prefix and recent tail', () => {
    const compactor = new AgentRuntimeContextCompactor({
      softThreshold: 10,
      hardThreshold: 20
    })
    const history = [
      item('system-1', 'system', 'Constraint: keep the public API stable.'),
      item('u1', 'user_message', 'Start the migration.'),
      item('a1', 'assistant_message', 'Mapped the old runtime.'),
      item('t1', 'tool', 'rg agent-runtime'),
      item('u2', 'user_message', 'Keep going.')
    ]

    const result = compactor.compact({
      threadId: 'thread-1',
      turnId: 'turn-1',
      history,
      mode: 'force',
      keepRecent: 1,
      frozenItemCount: 1,
      pinnedConstraints: ['Constraint: keep the public API stable.']
    })

    expect(result.effectiveItems.map((entry) => entry.id)).toEqual([
      'system-1',
      expect.stringContaining('compaction_turn-1_'),
      'u2'
    ])
    expect(result.summaryItem.summary).toContain('Pinned constraints')
    expect(result.summaryItem.summary).toContain('Start the migration.')
    expect(result.summaryItem.summary).toContain('Compaction digest marker:')
    expect(result.replacedTokens).toBeGreaterThan(0)
    expect(result.sourceDigest).toEqual(expect.any(String))
    expect(result.digestMarker).toContain('runtime:compaction_digest')
    expect(result.sourceItemIds).toEqual(['u1', 'a1', 't1'])
    expect(result.sourceItemIds).not.toContain('system-1')
  })

  it('uses a model summary override while still appending a digest marker', () => {
    const compactor = new AgentRuntimeContextCompactor()

    const result = compactor.compact({
      threadId: 'thread-1',
      turnId: 'turn-1',
      history: [
        item('u1', 'user_message', 'Investigate the issue.'),
        item('a1', 'assistant_message', 'Found the root cause.')
      ],
      keepRecent: 1,
      summaryOverride: 'Model generated summary.'
    })

    expect(result.summaryItem.summary).toContain('Model generated summary.')
    expect(result.summaryItem.summary).toContain('Compaction digest marker:')
    expect(result.sourceItemIds).toEqual(['u1'])
  })

  it('does not split an emoji that lands on the text clipping boundary', () => {
    const compactor = new AgentRuntimeContextCompactor()
    const prefix = 'a'.repeat(356)

    const result = compactor.compact({
      threadId: 'thread-emoji-boundary',
      turnId: 'turn-emoji-boundary',
      history: [
        item('u1', 'user_message', `${prefix}😀${'b'.repeat(10)}`),
        item('a1', 'assistant_message', 'Recent answer stays in the tail.')
      ],
      keepRecent: 1
    })

    expect(result.summaryItem.summary).toContain(`- User: ${prefix}...`)
    expect(result.summaryItem.summary).not.toContain('😀')
    expect(hasLoneSurrogate(result.summaryItem.summary)).toBe(false)
  })

  it('keeps trailing unfinished tool items out of compaction', () => {
    const compactor = new AgentRuntimeContextCompactor()
    const pendingTool: AgentRuntimeItem = {
      id: 'tool-pending',
      kind: 'tool',
      summary: 'still running',
      status: 'pending'
    }

    const result = compactor.compact({
      threadId: 'thread-1',
      turnId: 'turn-1',
      history: [
        item('u1', 'user_message', 'First request.'),
        item('a1', 'assistant_message', 'Initial answer.'),
        pendingTool
      ],
      keepRecent: 1
    })

    expect(result.effectiveItems).not.toContain(pendingTool)
    expect(result.sourceItemIds).toEqual(['u1'])
  })

  it('leaves short histories unchanged as a noop compaction', () => {
    const compactor = new AgentRuntimeContextCompactor()
    const history = [item('u1', 'user_message', 'Only one item.')]

    const result = compactor.compact({
      threadId: 'thread-1',
      turnId: 'turn-1',
      history
    })

    expect(result.effectiveItems).toEqual(history)
    expect(result.replacedTokens).toBe(0)
    expect(result.summaryItem.summary).toBe('no compaction needed')
    expect(result.sourceDigest).toBeUndefined()
  })
})

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}
