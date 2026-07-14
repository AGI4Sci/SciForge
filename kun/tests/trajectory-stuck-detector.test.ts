import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../src/contracts/items.js'
import {
  TrajectoryStuckDetector,
  detectTrajectoryStuck
} from '../src/loop/trajectory-stuck-detector.js'

const THREAD_ID = 'thread_1'
const TURN_ID = 'turn_1'
const CREATED_AT = '2026-07-10T00:00:00.000Z'

describe('trajectory stuck detector', () => {
  it('detects four identical action and observation pairs by default', () => {
    const three = trajectory([
      step('grep', { pattern: 'same' }, { matches: [] }, 1),
      step('grep', { pattern: 'same' }, { matches: [] }, 2),
      step('grep', { pattern: 'same' }, { matches: [] }, 3)
    ])
    expect(detectTrajectoryStuck(three)).toMatchObject({ stuck: false })

    const result = detectTrajectoryStuck([
      ...three,
      ...step('grep', { pattern: 'same' }, { matches: [] }, 4)
    ])
    expect(result).toMatchObject({
      stuck: true,
      kind: 'repeated_action_observation',
      count: 4
    })
  })

  it('detects three consecutive failures of the same action even when errors vary', () => {
    const items = trajectory([
      step('bash', { command: 'npm test' }, { error: 'exit 1' }, 1, true),
      step('bash', { command: 'npm test' }, { error: 'exit 2' }, 2, true),
      step('bash', { command: 'npm test' }, { error: 'timeout' }, 3, true)
    ])

    expect(new TrajectoryStuckDetector().inspect(items)).toMatchObject({
      stuck: true,
      kind: 'repeated_action_error',
      count: 3
    })
  })

  it('detects a six-step A/B alternating trajectory', () => {
    const a = (index: number) => step('grep', { pattern: 'alpha' }, { matches: [] }, index)
    const b = (index: number) => step('grep', { pattern: 'beta' }, { matches: [] }, index)
    const result = detectTrajectoryStuck(trajectory([
      a(1), b(2), a(3), b(4), a(5), b(6)
    ]))

    expect(result).toMatchObject({
      stuck: true,
      kind: 'alternating_action_observation',
      count: 6
    })
  })

  it('does not detect an alternating pattern when the trailing sequence is broken', () => {
    const items = trajectory([
      step('grep', { pattern: 'a' }, { matches: [] }, 1),
      step('grep', { pattern: 'b' }, { matches: [] }, 2),
      step('grep', { pattern: 'a' }, { matches: [] }, 3),
      step('grep', { pattern: 'c' }, { matches: [] }, 4),
      step('grep', { pattern: 'a' }, { matches: [] }, 5),
      step('grep', { pattern: 'b' }, { matches: [] }, 6)
    ])
    expect(detectTrajectoryStuck(items)).toMatchObject({ stuck: false })
  })

  it('uses a bounded item window', () => {
    const repeated = trajectory([
      step('grep', { pattern: 'old' }, { matches: [] }, 1),
      step('grep', { pattern: 'old' }, { matches: [] }, 2),
      step('grep', { pattern: 'old' }, { matches: [] }, 3),
      step('grep', { pattern: 'old' }, { matches: [] }, 4)
    ])
    const later = trajectory([
      step('grep', { pattern: 'new-1' }, { matches: ['1'] }, 5),
      step('grep', { pattern: 'new-2' }, { matches: ['2'] }, 6)
    ])

    expect(detectTrajectoryStuck([...repeated, ...later], { maxItems: 4 })).toEqual({
      stuck: false,
      inspectedPairs: 2
    })
  })

  it('recognizes relative and absolute aliases and fully covered overlapping reads', () => {
    const items = trajectory([
      readStep('src/a.ts', '/repo/src/a.ts', 1, 100, 1),
      readStep('/repo/src/./a.ts', '/repo/src/a.ts', 20, 40, 2),
      readStep('./src/a.ts', '/repo/src/a.ts', 25, 30, 3)
    ])

    expect(detectTrajectoryStuck(items, { workspace: '/repo' })).toMatchObject({
      stuck: true,
      kind: 'redundant_read',
      redundantRead: {
        path: '/repo/src/a.ts',
        startLine: 25,
        endLine: 30
      }
    })
  })

  it('combines prior ranges but allows a partially overlapping read that adds coverage', () => {
    const addsCoverage = trajectory([
      readStep('a.ts', '/repo/a.ts', 1, 50, 1),
      readStep('a.ts', '/repo/a.ts', 40, 70, 2)
    ])
    expect(detectTrajectoryStuck(addsCoverage, { workspace: '/repo' })).toMatchObject({ stuck: false })

    const coveredByUnion = trajectory([
      readStep('a.ts', '/repo/a.ts', 1, 20, 1),
      readStep('a.ts', '/repo/a.ts', 21, 40, 2),
      readStep('a.ts', '/repo/a.ts', 10, 30, 3)
    ])
    expect(detectTrajectoryStuck(coveredByUnion, {
      workspace: '/repo',
      redundantReadThreshold: 1
    })).toMatchObject({
      stuck: true,
      kind: 'redundant_read'
    })
  })

  it('resets read coverage after a successful mutation of the same path', () => {
    const items = trajectory([
      readStep('a.ts', '/repo/a.ts', 1, 50, 1),
      step('edit', { path: './a.ts', oldText: 'a', newText: 'b' }, {
        path: '/repo/a.ts',
        bytes_written: 10
      }, 2, false, 'file_change'),
      readStep('/repo/a.ts', '/repo/a.ts', 1, 50, 3)
    ])

    expect(detectTrajectoryStuck(items, { workspace: '/repo' })).toMatchObject({ stuck: false })
  })

  it('does not reset read coverage after a failed mutation', () => {
    const items = trajectory([
      readStep('a.ts', '/repo/a.ts', 1, 50, 1),
      step('edit', { path: 'a.ts', oldText: 'missing', newText: 'b' }, {
        error: 'old text not found'
      }, 2, true, 'file_change'),
      readStep('./a.ts', '/repo/a.ts', 1, 50, 3)
    ])

    expect(detectTrajectoryStuck(items, {
      workspace: '/repo',
      redundantReadThreshold: 1
    })).toMatchObject({
      stuck: true,
      kind: 'redundant_read'
    })
  })

  it('resets covered ranges when the read tool reports a new file version', () => {
    const initial = readStep('a.ts', '/repo/a.ts', 1, 50, 1)
    const changed = readStep('./a.ts', '/repo/a.ts', 1, 50, 2)
    const initialResult = initial.find((item) => item.kind === 'tool_result')
    const changedResult = changed.find((item) => item.kind === 'tool_result')
    if (initialResult?.kind !== 'tool_result' || changedResult?.kind !== 'tool_result') {
      throw new Error('expected read results')
    }
    initialResult.output = { ...(initialResult.output as object), content_sha256: 'version-a' }
    changedResult.output = { ...(changedResult.output as object), content_sha256: 'version-b' }

    expect(detectTrajectoryStuck([...initial, ...changed], {
      workspace: '/repo',
      redundantReadThreshold: 1
    })).toMatchObject({ stuck: false })
  })

  it('only flags unversioned reads when the exact range and observation repeat', () => {
    const unchanged = [1, 2, 3].flatMap((index) => {
      const items = readStep('a.ts', '/repo/a.ts', 1, 20, index)
      const result = items.find((item) => item.kind === 'tool_result')
      if (result?.kind === 'tool_result') {
        const output = { ...(result.output as Record<string, unknown>) }
        delete output.content_sha256
        result.output = output
      }
      return items
    })
    expect(detectTrajectoryStuck(unchanged, { workspace: '/repo' })).toMatchObject({
      stuck: true,
      kind: 'redundant_read',
      count: 2
    })

    const changed = [1, 2, 3].flatMap((index) => {
      const items = readStep('a.ts', '/repo/a.ts', 1, 20, index)
      const result = items.find((item) => item.kind === 'tool_result')
      if (result?.kind === 'tool_result') {
        const output: Record<string, unknown> = {
          ...(result.output as Record<string, unknown>),
          content: `external version ${index}`
        }
        delete output.content_sha256
        result.output = output
      }
      return items
    })
    expect(detectTrajectoryStuck(changed, { workspace: '/repo' })).toMatchObject({
      stuck: false
    })
  })

  it('does not collide unversioned reads whose large content changes only in the middle', () => {
    const head = 'h'.repeat(2_048)
    const tail = 't'.repeat(2_048)
    const items = ['a', 'b', 'c'].flatMap((middle, index) => {
      const read = readStep('large.ts', '/repo/large.ts', 1, 200, index + 1)
      const result = read.find((item) => item.kind === 'tool_result')
      if (result?.kind === 'tool_result') {
        const output: Record<string, unknown> = {
          ...(result.output as Record<string, unknown>),
          content: `${head}${middle.repeat(1_024)}${tail}`
        }
        delete output.content_sha256
        result.output = output
      }
      return read
    })

    expect(detectTrajectoryStuck(items, { workspace: '/repo' })).toMatchObject({ stuck: false })
  })

  it('ignores repeated bash session-control polling', () => {
    const items = trajectory([
      step('bash', { action: 'poll', sessionId: 7 }, { output: '' }, 1),
      step('bash', { action: 'poll', sessionId: 7 }, { output: '' }, 2),
      step('bash', { action: 'poll', sessionId: 7 }, { output: '' }, 3),
      step('bash', { action: 'poll', sessionId: 7 }, { output: '' }, 4)
    ])

    expect(detectTrajectoryStuck(items)).toEqual({ stuck: false, inspectedPairs: 0 })
  })

  it('does not combine tool pairs across turns', () => {
    const oldTurn = trajectory([
      step('grep', { pattern: 'same' }, { matches: [] }, 1),
      step('grep', { pattern: 'same' }, { matches: [] }, 2),
      step('grep', { pattern: 'same' }, { matches: [] }, 3)
    ])
    const latest = step('grep', { pattern: 'same' }, { matches: [] }, 4)
      .map((item) => ({ ...item, turnId: 'turn_2' })) as TurnItem[]

    expect(detectTrajectoryStuck([...oldTurn, ...latest])).toEqual({
      stuck: false,
      inspectedPairs: 1
    })
  })

  it('starts a fresh trajectory after mid-turn user steering', () => {
    const beforeSteering = trajectory([
      step('grep', { pattern: 'same' }, { matches: [] }, 1),
      step('grep', { pattern: 'same' }, { matches: [] }, 2),
      step('grep', { pattern: 'same' }, { matches: [] }, 3)
    ])
    const steering: TurnItem = {
      id: 'item_steering',
      threadId: THREAD_ID,
      turnId: TURN_ID,
      role: 'user',
      status: 'completed',
      createdAt: CREATED_AT,
      kind: 'user_message',
      text: 'Use a different approach.'
    }
    const afterSteering = step('grep', { pattern: 'same' }, { matches: [] }, 4)

    expect(detectTrajectoryStuck([...beforeSteering, steering, ...afterSteering])).toEqual({
      stuck: false,
      inspectedPairs: 1
    })
  })

  it('keeps trajectory evidence across compaction summaries', () => {
    const beforeCompaction = trajectory([
      step('grep', { pattern: 'same' }, { matches: [] }, 1),
      step('grep', { pattern: 'same' }, { matches: [] }, 2),
      step('grep', { pattern: 'same' }, { matches: [] }, 3)
    ])
    const compaction: TurnItem = {
      id: 'compaction_1',
      threadId: THREAD_ID,
      turnId: TURN_ID,
      role: 'system',
      status: 'completed',
      createdAt: CREATED_AT,
      kind: 'compaction',
      summary: 'Earlier work was compacted.',
      replacedTokens: 100,
      pinnedConstraints: []
    }

    expect(detectTrajectoryStuck([
      ...beforeCompaction,
      compaction,
      ...step('grep', { pattern: 'same' }, { matches: [] }, 4)
    ])).toMatchObject({
      stuck: true,
      kind: 'repeated_action_observation',
      count: 4
    })
  })
})

function trajectory(steps: TurnItem[][]): TurnItem[] {
  return steps.flat()
}

function readStep(
  argumentPath: string,
  outputPath: string,
  startLine: number,
  endLine: number,
  index: number
): TurnItem[] {
  return step('read', {
    path: argumentPath,
    offset: startLine,
    limit: endLine - startLine + 1
  }, {
    path: outputPath,
    relative_path: outputPath.replace(/^\/repo\/?/, ''),
    content: `lines ${startLine}-${endLine}`,
    content_sha256: 'stable-version',
    start_line: startLine,
    end_line: endLine,
    total_lines: 200,
    truncated: false
  }, index)
}

function step(
  toolName: string,
  args: Record<string, unknown>,
  output: unknown,
  index = 1,
  isError = false,
  toolKind: 'tool_call' | 'command_execution' | 'file_change' = 'tool_call'
): TurnItem[] {
  const callId = `call_${index}`
  return [
    {
      id: `item_call_${index}`,
      threadId: THREAD_ID,
      turnId: TURN_ID,
      role: 'assistant',
      status: 'completed',
      createdAt: CREATED_AT,
      kind: 'tool_call',
      toolName,
      callId,
      toolKind,
      arguments: args
    },
    {
      id: `item_result_${index}`,
      threadId: THREAD_ID,
      turnId: TURN_ID,
      role: 'tool',
      status: isError ? 'failed' : 'completed',
      createdAt: CREATED_AT,
      kind: 'tool_result',
      toolName,
      callId,
      toolKind,
      output,
      isError
    }
  ]
}
