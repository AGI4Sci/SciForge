import { describe, expect, it } from 'vitest'
import {
  claimNextWorkMessage,
  completeWorkMessage,
  createWorkMessageQueue,
  enqueueWorkMessage,
  normalizeWorkMessageQueueState,
  peekNextWorkMessage,
  releaseWorkMessage,
  workMessageQueueSize
} from './work-message-queue'

describe('work message queue', () => {
  it('keeps messages for one work FIFO while isolating other work', () => {
    let state = createWorkMessageQueue<string>()
    state = enqueueWorkMessage(state, {
      id: 'user-1', workId: 'work-a', kind: 'user', payload: 'first', enqueuedAt: 1
    }).state
    state = enqueueWorkMessage(state, {
      id: 'verify-1', workId: 'work-a', kind: 'verification', payload: 'verify', enqueuedAt: 2
    }).state
    state = enqueueWorkMessage(state, {
      id: 'user-2', workId: 'work-b', kind: 'user', payload: 'other', enqueuedAt: 3
    }).state

    expect(peekNextWorkMessage(state, 'work-a')?.id).toBe('verify-1')
    expect(peekNextWorkMessage(state, 'work-b')?.id).toBe('user-2')
    expect(workMessageQueueSize(state, 'work-a')).toBe(2)
  })

  it('allows only one active provider turn per work and resumes after release', () => {
    let state = createWorkMessageQueue<string>()
    state = enqueueWorkMessage(state, {
      id: 'continuation-1', workId: 'work-a', kind: 'continuation', payload: 'one'
    }).state
    state = enqueueWorkMessage(state, {
      id: 'continuation-2', workId: 'work-a', kind: 'continuation', payload: 'two'
    }).state
    const claimed = claimNextWorkMessage(state, 'work-a')
    expect(claimed.message?.id).toBe('continuation-1')
    expect(peekNextWorkMessage(claimed.state, 'work-a')).toBeUndefined()

    state = releaseWorkMessage(claimed.state, 'work-a', claimed.message!.id)
    expect(peekNextWorkMessage(state, 'work-a')?.id).toBe('continuation-1')
    const retried = claimNextWorkMessage(state, 'work-a')
    state = completeWorkMessage(retried.state, 'work-a', retried.message!.id)
    expect(peekNextWorkMessage(state, 'work-a')?.id).toBe('continuation-2')
  })

  it('deduplicates retries by idempotency key, including after completion', () => {
    let state = createWorkMessageQueue<string>()
    const first = enqueueWorkMessage(state, {
      id: 'continuation-1',
      workId: 'work-a',
      kind: 'continuation',
      payload: 'same',
      idempotencyKey: 'work-a:attempt-1'
    })
    state = first.state
    const duplicate = enqueueWorkMessage(state, {
      id: 'different-id',
      workId: 'work-a',
      kind: 'continuation',
      payload: 'same',
      idempotencyKey: 'work-a:attempt-1'
    })
    expect(duplicate.accepted).toBe(false)
    expect(duplicate.message.id).toBe('continuation-1')

    state = claimNextWorkMessage(state, 'work-a').state
    state = completeWorkMessage(state, 'work-a', 'continuation-1')
    const replay = enqueueWorkMessage(state, {
      id: 'replayed-id',
      workId: 'work-a',
      kind: 'continuation',
      payload: 'same',
      idempotencyKey: 'work-a:attempt-1'
    })
    expect(replay.accepted).toBe(false)
    expect(workMessageQueueSize(replay.state, 'work-a')).toBe(0)
  })

  it('rejects blank work and message identifiers', () => {
    const state = createWorkMessageQueue()
    expect(() => enqueueWorkMessage(state, {
      id: ' ', workId: 'work-a', kind: 'user', payload: null
    })).toThrow(/message id/u)
    expect(() => peekNextWorkMessage(state, ' ')).toThrow(/Work id/u)
  })

  it('hydrates queue records written before idempotency maps existed', () => {
    const hydrated = normalizeWorkMessageQueueState({
      nextSequence: 0,
      messages: [{
        id: 'old', workId: 'work-a', kind: 'user', sequence: 4, enqueuedAt: 1, payload: 'old'
      }]
    })
    expect(hydrated.nextSequence).toBe(5)
    expect(hydrated.settledMessageIds).toEqual({})
    expect(hydrated.settledIdempotencyKeys).toEqual({})
  })
})
