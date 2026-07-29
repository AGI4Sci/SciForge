import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_MULTI_AGENT_CHILD_TIMEOUT_MS,
  DEFAULT_MULTI_AGENT_TIMEOUT_HANDSHAKE_MS,
  DEFAULT_MULTI_AGENT_TIMEOUT_SUMMARY_GRACE_MS,
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
    childTimeoutMs: DEFAULT_MULTI_AGENT_CHILD_TIMEOUT_MS,
    timeoutHandshakeMs: DEFAULT_MULTI_AGENT_TIMEOUT_HANDSHAKE_MS,
    timeoutSummaryGraceMs: DEFAULT_MULTI_AGENT_TIMEOUT_SUMMARY_GRACE_MS,
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
  assert.equal(MultiAgentErrorCode.parse('timeout'), 'timeout')
  assert.throws(() => MultiAgentErrorCode.parse('provider_api_key_missing'))
})
