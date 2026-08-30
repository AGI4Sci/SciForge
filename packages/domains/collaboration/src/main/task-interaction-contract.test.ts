import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  localTaskInteractionEventSchema,
  localTaskInteractionStateSchema,
  transitionLocalTaskInteractionState,
  type LocalTaskInteractionEvent,
  type LocalTaskInteractionState
} from './task-interaction-contract.js'

test('local interaction transitions model human participation without reviving Cloud failures', () => {
  let state: LocalTaskInteractionState = 'idle'
  state = apply(state, 'execution-started')
  state = apply(state, 'human-needed')
  state = apply(state, 'intervention-queued')
  state = apply(state, 'await-cloud')
  state = apply(state, 'cloud-applied')
  assert.equal(state, 'running')

  state = apply(state, 'pause-local')
  assert.equal(state, 'paused_local')
  state = apply(state, 'resume-local')
  assert.equal(state, 'running')
  state = apply(state, 'execution-failed')
  assert.equal(state, 'blocked_cloud')

  // A repeated failure notification is safe to replay, but a normal
  // execution-start event cannot turn this fenced execution back into running.
  assert.equal(apply(state, 'execution-failed'), 'blocked_cloud')
  assert.throws(
    () => apply(state, 'execution-started'),
    /cannot transition from blocked_cloud on execution-started/u
  )
})

test('local interaction transitions permit a queued recovery intent, but require Cloud acknowledgement', () => {
  let state: LocalTaskInteractionState = 'blocked_cloud'
  state = apply(state, 'intervention-queued')
  assert.equal(state, 'intervention_queued')
  state = apply(state, 'await-cloud')
  assert.equal(state, 'awaiting_cloud')
  state = apply(state, 'cloud-rejected')
  assert.equal(state, 'blocked_cloud')
  assert.throws(
    () => apply(state, 'cloud-applied'),
    /cannot transition from blocked_cloud on cloud-applied/u
  )
})

test('event and state schemas fail closed on malformed controller input', () => {
  assert.equal(localTaskInteractionStateSchema.safeParse('running').success, true)
  assert.equal(localTaskInteractionStateSchema.safeParse('failed').success, false)
  assert.equal(localTaskInteractionEventSchema.safeParse({ type: 'pause-local' }).success, true)
  assert.equal(localTaskInteractionEventSchema.safeParse({ type: 'pause-local', taskId: 'extra' }).success, false)
  assert.throws(
    () => transitionLocalTaskInteractionState('running', { type: 'unknown' } as never),
    /Invalid discriminator value/u
  )
})

function apply(
  state: LocalTaskInteractionState,
  type: LocalTaskInteractionEvent['type']
): LocalTaskInteractionState {
  return transitionLocalTaskInteractionState(state, { type } as LocalTaskInteractionEvent)
}
