import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import { createGroupTurnsMemo, groupTurns, sameTurnContent, stableTurnKey } from './message-timeline-turns'

describe('message timeline turns', () => {
  it('uses stable ids for user and assistant-only turns', () => {
    const blocks: ChatBlock[] = [
      { kind: 'assistant', id: 'assistant_intro', text: 'Welcome' },
      { kind: 'user', id: 'user_1', text: 'Hello' },
      { kind: 'assistant', id: 'assistant_1', text: 'Hi' }
    ]

    const turns = groupTurns(blocks)

    expect(stableTurnKey(turns[0], 0)).toBe('assistant_intro')
    expect(stableTurnKey(turns[1], 1)).toBe('user_1')
  })

  it('treats rebuilt turn arrays as the same content when block references are unchanged', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_1', text: 'Hello' },
      { kind: 'assistant', id: 'assistant_1', text: 'Hi' }
    ]

    const first = groupTurns(blocks)[0]
    const second = groupTurns(blocks)[0]

    expect(first).not.toBe(second)
    expect(sameTurnContent(first, second)).toBe(true)
  })

  it('detects updates to a block inside an otherwise stable turn', () => {
    const firstBlocks: ChatBlock[] = [
      { kind: 'user', id: 'user_1', text: 'Hello' },
      { kind: 'assistant', id: 'assistant_1', text: 'Hi' }
    ]
    const nextBlocks: ChatBlock[] = [
      firstBlocks[0],
      { kind: 'assistant', id: 'assistant_1', text: 'Hi again' }
    ]

    expect(sameTurnContent(groupTurns(firstBlocks)[0], groupTurns(nextBlocks)[0])).toBe(false)
  })

  it('incremental memo matches groupTurns and reuses untouched prefix turns', () => {
    const memo = createGroupTurnsMemo()
    const user1: ChatBlock = { kind: 'user', id: 'user_1', text: 'One' }
    const assistant1: ChatBlock = { kind: 'assistant', id: 'assistant_1', text: 'First' }
    const user2: ChatBlock = { kind: 'user', id: 'user_2', text: 'Two' }
    const tool1: ChatBlock = { kind: 'tool', id: 'tool_1', summary: 'Read', status: 'running' }

    const first = memo([user1, assistant1, user2, tool1])
    expect(first).toEqual(groupTurns([user1, assistant1, user2, tool1]))

    // Live tool output replaces the trailing tool block in place.
    const tool1Streaming: ChatBlock = { kind: 'tool', id: 'tool_1', summary: 'Read', status: 'running', detail: 'chunk' }
    const second = memo([user1, assistant1, user2, tool1Streaming])

    expect(second).toEqual(groupTurns([user1, assistant1, user2, tool1Streaming]))
    expect(second[0]).toBe(first[0])
    expect(second[1]).not.toBe(first[1])

    // A fresh user turn appended afterwards still reuses everything before it.
    const user3: ChatBlock = { kind: 'user', id: 'user_3', text: 'Three' }
    const third = memo([user1, assistant1, user2, tool1Streaming, user3])
    expect(third).toEqual(groupTurns([user1, assistant1, user2, tool1Streaming, user3]))
    expect(third[0]).toBe(first[0])
    expect(third[1]).toBe(second[1])
  })

  it('incremental memo extends the open tail turn on append instead of splitting it', () => {
    const memo = createGroupTurnsMemo()
    const user1: ChatBlock = { kind: 'user', id: 'user_1', text: 'One' }
    const assistant1: ChatBlock = { kind: 'assistant', id: 'assistant_1', text: 'First' }
    memo([user1, assistant1])

    const tool1: ChatBlock = { kind: 'tool', id: 'tool_1', summary: 'Read', status: 'running' }
    const next = memo([user1, assistant1, tool1])

    expect(next).toHaveLength(1)
    expect(next[0].blocks.map((block) => block.id)).toEqual(['assistant_1', 'tool_1'])
    expect(next[0]).toEqual(groupTurns([user1, assistant1, tool1])[0])
  })

  it('incremental memo returns the same turn array for an unchanged blocks reference', () => {
    const memo = createGroupTurnsMemo()
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_1', text: 'One' },
      { kind: 'assistant', id: 'assistant_1', text: 'First' }
    ]
    const first = memo(blocks)
    expect(memo(blocks)).toBe(first)
  })
})
