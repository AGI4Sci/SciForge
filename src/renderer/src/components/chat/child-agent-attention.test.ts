import { describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeChild } from '@shared/agent-runtime-contract'
import type { ChatBlock } from '../../agent/types'
import {
  buildChildAgentAttentionSummary,
  loadChildAgentAttentionTree
} from './child-agent-attention'

function child(input: Partial<AgentRuntimeChild> & Pick<AgentRuntimeChild, 'id' | 'parentThreadId'>): AgentRuntimeChild {
  return {
    runtimeId: 'codex',
    kind: 'agent',
    status: 'completed',
    ...input
  }
}

function snapshot(threadId: string, blocks: ChatBlock[], threadStatus?: string) {
  return { threadId, blocks, threadStatus }
}

describe('buildChildAgentAttentionSummary', () => {
  it('finds real pending interactions at arbitrary child depth and returns a navigation path', () => {
    const summary = buildChildAgentAttentionSummary({
      rootThreadId: 'root',
      rootLabel: 'Main',
      children: [
        child({
          id: 'research-call',
          parentThreadId: 'root',
          label: 'Research',
          openAsThreadRef: { threadId: 'research' }
        }),
        child({
          id: 'review-call',
          parentThreadId: 'research',
          label: 'Review',
          openAsThreadRef: { threadId: 'review' }
        }),
        child({
          id: 'experiment-call',
          parentThreadId: 'review',
          label: 'Experiment',
          status: 'running',
          openAsThreadRef: { threadId: 'experiment' }
        })
      ],
      snapshots: {
        experiment: snapshot('experiment', [
          {
            kind: 'user_input',
            id: 'question-1',
            requestId: 'request-1',
            status: 'pending',
            questions: [{ header: 'Dataset', id: 'dataset', question: 'Which dataset?', options: [] }]
          }
        ], 'running')
      }
    })

    expect(summary.primaryTarget).toMatchObject({
      childId: 'experiment-call',
      threadId: 'experiment',
      attention: 'waiting_user_input',
      waitingUserInputBlockIds: ['question-1']
    })
    expect(summary.primaryTarget?.path).toEqual([
      { threadId: 'root', label: 'Main' },
      { threadId: 'research', label: 'Research' },
      { threadId: 'review', label: 'Review' },
      { threadId: 'experiment', label: 'Experiment' }
    ])
    expect(summary.counts).toMatchObject({ total: 3, waitingUserInput: 1, running: 1 })
  })

  it('does not guess that a running child needs user input without a pending block', () => {
    const summary = buildChildAgentAttentionSummary({
      rootThreadId: 'root',
      children: [child({
        id: 'running-call',
        parentThreadId: 'root',
        status: 'running',
        openAsThreadRef: { threadId: 'running-thread' }
      })],
      snapshots: { 'running-thread': snapshot('running-thread', [], 'running') }
    })

    expect(summary.primaryTarget?.attention).toBe('running')
    expect(summary.counts.waitingUserInput).toBe(0)
    expect(summary.counts.waitingApproval).toBe(0)
  })

  it('prioritizes pending input, approval, failure, unread, then running', () => {
    const children = [
      ['running', 'running'],
      ['unread', 'completed'],
      ['failed', 'failed'],
      ['approval', 'running'],
      ['input', 'running']
    ].map(([id, status]) => child({
      id,
      parentThreadId: 'root',
      status: status as AgentRuntimeChild['status'],
      openAsThreadRef: { threadId: id }
    }))
    const summary = buildChildAgentAttentionSummary({
      rootThreadId: 'root',
      children,
      unreadThreadIds: { unread: true },
      snapshots: {
        approval: snapshot('approval', [{
          kind: 'approval',
          id: 'approval-block',
          approvalId: 'approval-1',
          summary: 'Run command',
          status: 'pending'
        }]),
        input: snapshot('input', [{
          kind: 'user_input',
          id: 'input-block',
          requestId: 'input-1',
          questions: [],
          status: 'pending'
        }])
      }
    })

    expect(summary.actionableTargets.map((target) => target.attention)).toEqual([
      'waiting_user_input',
      'waiting_approval',
      'failed',
      'unread',
      'running'
    ])
  })

  it('deduplicates runtime and native child records by their open thread identity', () => {
    const summary = buildChildAgentAttentionSummary({
      rootThreadId: 'root',
      children: [
        child({ id: 'call-1', parentThreadId: 'root', label: 'Worker', openAsThreadRef: { threadId: 'worker' } }),
        child({ id: 'worker', parentThreadId: 'root', label: 'Worker', openAsThreadRef: { threadId: 'worker' } })
      ]
    })
    expect(summary.targets).toHaveLength(1)
  })

  it('breaks cycles in malformed runtime child graphs', () => {
    const summary = buildChildAgentAttentionSummary({
      rootThreadId: 'root',
      children: [
        child({ id: 'a', parentThreadId: 'root', openAsThreadRef: { threadId: 'a' } }),
        child({ id: 'root-again', parentThreadId: 'a', openAsThreadRef: { threadId: 'root' } })
      ]
    })
    expect(summary.targets).toHaveLength(2)
  })
})

describe('loadChildAgentAttentionTree', () => {
  it('loads all reachable levels and normalized blocks for actionable attention', async () => {
    const listThreadChildren = vi.fn(async (threadId: string) => ({
      children: threadId === 'root'
        ? [child({ id: 'a-call', parentThreadId: 'root', openAsThreadRef: { threadId: 'a' } })]
        : threadId === 'a'
          ? [child({ id: 'b-call', parentThreadId: 'a', openAsThreadRef: { threadId: 'b' } })]
          : []
    }))
    const getThreadDetail = vi.fn(async (threadId: string) => ({
      blocks: threadId === 'b'
        ? [{ kind: 'approval', id: 'approval', approvalId: 'approval', summary: 'Approve', status: 'pending' } as ChatBlock]
        : [],
      threadStatus: 'running'
    }))
    const rememberThreadRuntime = vi.fn()

    const loaded = await loadChildAgentAttentionTree({
      rootThreadId: 'root',
      source: { listThreadChildren, getThreadDetail, rememberThreadRuntime }
    })

    expect(listThreadChildren.mock.calls.map(([threadId]) => threadId)).toEqual(['root', 'a', 'b'])
    expect(getThreadDetail.mock.calls.map(([threadId]) => threadId)).toEqual(['a', 'b'])
    expect(loaded.snapshots.b.blocks).toHaveLength(1)
    expect(loaded.degraded).toBe(false)
    expect(rememberThreadRuntime).toHaveBeenCalledTimes(2)
  })

  it('returns partial data and diagnostics when a detail read fails', async () => {
    const loaded = await loadChildAgentAttentionTree({
      rootThreadId: 'root',
      source: {
        listThreadChildren: async (threadId) => ({ children: threadId === 'root'
          ? [child({ id: 'a', parentThreadId: 'root', openAsThreadRef: { threadId: 'a' } })]
          : [] }),
        getThreadDetail: async () => { throw new Error('not readable') }
      }
    })

    expect(loaded.children).toHaveLength(1)
    expect(loaded.degraded).toBe(true)
    expect(loaded.errors).toEqual([{ threadId: 'a', operation: 'detail', message: 'not readable' }])
  })
})
