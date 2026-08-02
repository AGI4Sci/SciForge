import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DelegateTaskInput,
  MULTI_AGENT_CONTRACT_VERSION,
  MultiAgentChildRunRecord,
  MultiAgentErrorCode,
  MultiAgentRuntimeConfig
} from './contract.js'

test('runtime config and child run records apply contract defaults', () => {
  assert.deepEqual(MultiAgentRuntimeConfig.parse({}), {
    enabled: true,
    maxParallel: 2,
    maxChildren: 16,
    maxTranscriptEntries: 1000
  })

  const record = MultiAgentChildRunRecord.parse({
    id: 'child-1',
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Summarize the notes',
    status: 'queued',
    createdAt: '2026-06-27T00:00:00.000Z',
    updatedAt: '2026-06-27T00:00:00.000Z'
  })

  assert.equal(record.contractVersion, MULTI_AGENT_CONTRACT_VERSION)
  assert.deepEqual(record.usage, {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  })
  assert.deepEqual(record.transcript, [])
})

test('contract schemas are strict and expose stable error codes', () => {
  assert.throws(() => DelegateTaskInput.parse({
    prompt: 'Do work',
    runtimeSpecificFlag: true
  }))
  assert.throws(() => MultiAgentErrorCode.parse('timeout'))
  assert.throws(() => MultiAgentErrorCode.parse('provider_api_key_missing'))
})
