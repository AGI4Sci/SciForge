import { describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeId } from '@shared/app-settings'
import type { ChatBlock, NormalizedThread } from '../agent/types'
import type { ChatState } from './chat-store-types'
import {
  findReusableEmptyThreadId,
  hasPendingRuntimeWork,
  rememberProviderThreadRuntime,
  settlePendingRuntimeWorkAfterCompletion,
  settlePendingRuntimeWorkAfterInterrupt,
  threadSnapshotLooksRunning,
  upsertUserBlock
} from './chat-store-runtime-helpers'

function thread(id: string, hasUserMessage?: boolean): NormalizedThread {
  return {
    id,
    runtimeId: 'codex',
    title: id,
    updatedAt: '2026-06-11T00:00:00.000Z',
    model: 'gpt-5',
    mode: 'agent',
    workspace: '/workspace/sciforge',
    ...(hasUserMessage === undefined ? {} : { hasUserMessage })
  }
}

describe('rememberProviderThreadRuntime', () => {
  function provider() {
    return {
      rememberThreadRuntime: vi.fn<(threadId: string, runtimeId?: AgentRuntimeId) => void>()
    }
  }

  it('remembers the thread runtime when the store has a concrete runtime id', () => {
    const p = provider()

    rememberProviderThreadRuntime(p, ' codex-thread ', [{ id: 'codex-thread', runtimeId: 'codex' }])

    expect(p.rememberThreadRuntime).toHaveBeenCalledWith('codex-thread', 'codex')
  })

  it('does not invent a SciForge runtime for a thread missing a runtime id', () => {
    const p = provider()

    rememberProviderThreadRuntime(p, 'legacy-thread', [{ id: 'legacy-thread', runtimeId: undefined }])

    expect(p.rememberThreadRuntime).not.toHaveBeenCalled()
  })

  it('does not invent a SciForge runtime for an unknown thread id', () => {
    const p = provider()

    rememberProviderThreadRuntime(p, 'missing-thread', [{ id: 'known-thread', runtimeId: 'sciforge' }])

    expect(p.rememberThreadRuntime).not.toHaveBeenCalled()
  })
})

describe('upsertUserBlock', () => {
  it('preserves the runtime turn identity on the canonical user block', () => {
    const blocks = upsertUserBlock([], {
      itemId: 'user-1',
      turnId: 'turn-1',
      text: 'hello'
    })

    expect(blocks).toEqual([
      expect.objectContaining({ kind: 'user', id: 'user-1', turnId: 'turn-1' })
    ])
  })
})

describe('findReusableEmptyThreadId', () => {
  it('uses list summary metadata and does not treat unknown history as empty', () => {
    const state = {
      activeThreadId: null,
      blocks: [],
      threads: [
        thread('used-thread', true),
        thread('legacy-unknown'),
        thread('empty-thread', false)
      ]
    } as unknown as ChatState

    expect(findReusableEmptyThreadId(state, '/workspace/sciforge')).toBe('empty-thread')
  })
})

describe('chat-store-runtime-helpers compaction state', () => {
  it('keeps the thread busy while a compaction item is running', () => {
    const runningCompaction: ChatBlock = {
      kind: 'compaction',
      id: 'compact-running',
      summary: 'Compacting context',
      status: 'running'
    }
    const completedCompaction: ChatBlock = {
      kind: 'compaction',
      id: 'compact-completed',
      summary: 'Compacted context',
      status: 'success'
    }

    expect(hasPendingRuntimeWork(runningCompaction)).toBe(true)
    expect(hasPendingRuntimeWork(completedCompaction)).toBe(false)
    expect(threadSnapshotLooksRunning([runningCompaction])).toBe(true)
    expect(threadSnapshotLooksRunning([completedCompaction])).toBe(false)
  })

  it('trusts an explicit idle thread status over stale pending blocks', () => {
    const staleTool: ChatBlock = {
      kind: 'tool',
      id: 'tool-stale',
      summary: 'Old tool',
      status: 'running',
      toolKind: 'tool_call'
    }

    expect(threadSnapshotLooksRunning([staleTool], 'idle')).toBe(false)
    expect(threadSnapshotLooksRunning([staleTool], 'aborted')).toBe(false)
    expect(threadSnapshotLooksRunning([staleTool], 'running')).toBe(true)
    expect(threadSnapshotLooksRunning([staleTool])).toBe(true)
  })

  it('recognizes every shared active runtime state as still running', () => {
    for (const status of [
      'starting',
      'running',
      'in_progress',
      'queued',
      'started',
      'reconnecting',
      'tool_waiting',
      'stream_recovering',
      'completing',
      'pending',
      'steered'
    ]) {
      expect(threadSnapshotLooksRunning([], status), status).toBe(true)
    }
  })

  it('settles local pending work after a successful interrupt', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'tool-running',
        summary: 'Running tool',
        status: 'running',
        toolKind: 'tool_call'
      },
      {
        kind: 'approval',
        id: 'approval-pending',
        approvalId: 'approval-1',
        summary: 'Needs approval',
        status: 'pending'
      },
      {
        kind: 'user_input',
        id: 'input-pending',
        requestId: 'input-1',
        questions: [],
        status: 'pending'
      },
      {
        kind: 'tool',
        id: 'tool-success',
        summary: 'Done',
        status: 'success',
        toolKind: 'tool_call'
      }
    ]

    const settled = settlePendingRuntimeWorkAfterInterrupt(blocks)

    expect(settled.map((block) => ('status' in block ? block.status : ''))).toEqual([
      'error',
      'error',
      'cancelled',
      'success'
    ])
    expect(settled.some(hasPendingRuntimeWork)).toBe(false)
  })

  it('settles local pending work after a completed turn without marking tools as failed', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'tool-running',
        summary: 'Running tool',
        status: 'running',
        toolKind: 'tool_call'
      },
      {
        kind: 'review',
        id: 'review-running',
        title: 'Review',
        status: 'running'
      },
      {
        kind: 'user_input',
        id: 'input-pending',
        requestId: 'input-1',
        questions: [],
        status: 'pending'
      }
    ]

    const settled = settlePendingRuntimeWorkAfterCompletion(blocks)

    expect(settled.map((block) => ('status' in block ? block.status : ''))).toEqual([
      'success',
      'success',
      'cancelled'
    ])
    expect(settled.some(hasPendingRuntimeWork)).toBe(false)
  })
})
