import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'

import {
  domainMainAgentExecutionRequestSchema,
  domainMainAgentExecutionResultSchema,
  type DomainMainAgentExecutionHost
} from './agent-execution.js'

describe('agent execution host contract', () => {
  it('accepts bounded process-neutral execution options and cancellation', async () => {
    const controller = new AbortController()
    const host: DomainMainAgentExecutionHost = {
      run: async (request) => ({
        runtimeId: request.runtimeId ?? 'codex',
        threadId: request.threadId ?? 'thread-1',
        turnId: 'turn-1',
        state: 'completed',
        text: `${request.runtimeId}:${request.mode ?? 'agent'}`,
      })
    }

    const request = domainMainAgentExecutionRequestSchema.parse({
      runtimeId: 'codex',
      prompt: 'Implement the reviewed workflow.',
      workspaceRoot: '/workspace/project',
      model: 'frontier',
      reasoningEffort: 'high',
      allowedTools: ['sciforge_discover', 'sciforge_invoke'],
      interaction: 'reviewable',
      mode: 'agent',
      signal: controller.signal
    })

    assert.deepEqual(await host.run(request), {
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      state: 'completed',
      text: 'codex:agent',
    })
  })

  it('defaults execution mode, permits an unbound new thread, and rejects host-private fields', () => {
    assert.deepEqual(domainMainAgentExecutionRequestSchema.parse({
      prompt: 'Continue.'
    }), {
      prompt: 'Continue.',
      interaction: 'background',
      mode: 'agent'
    })

    assert.throws(() => domainMainAgentExecutionRequestSchema.parse({
      runtimeId: 'sciforge',
      prompt: 'Continue.',
      privateThreadStore: {}
    }), z.ZodError)
  })

  it('continues only an explicit runtime/thread pair with a stable directive identity', () => {
    assert.deepEqual(domainMainAgentExecutionRequestSchema.parse({
      runtimeId: 'codex',
      threadId: 'thread-existing',
      clientDirectiveId: 'projection:receipt-1',
      prompt: 'Continue the same logical session.',
      metadata: { origin: 'remote', sender: 'user-1' },
      workspaceRoot: '/workspace/project'
    }), {
      runtimeId: 'codex',
      threadId: 'thread-existing',
      clientDirectiveId: 'projection:receipt-1',
      prompt: 'Continue the same logical session.',
      metadata: { origin: 'remote', sender: 'user-1' },
      workspaceRoot: '/workspace/project',
      interaction: 'background',
      mode: 'agent'
    })
    assert.throws(() => domainMainAgentExecutionRequestSchema.parse({
      threadId: 'thread-without-runtime',
      prompt: 'Ambiguous continuation.'
    }), z.ZodError)
    assert.throws(() => domainMainAgentExecutionRequestSchema.parse({
      runtimeId: 'codex',
      clientDirectiveId: 'contains spaces',
      prompt: 'Invalid identity.'
    }), z.ZodError)
  })

  it('keeps the result envelope minimal and strict', () => {
    assert.deepEqual(domainMainAgentExecutionResultSchema.parse({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      state: 'completed',
      text: 'Done.',
    }), {
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      state: 'completed',
      text: 'Done.',
    })
    assert.throws(() => domainMainAgentExecutionResultSchema.parse({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      state: 'completed',
      text: 'Done.',
      providerResponse: {}
    }), z.ZodError)
  })

  it('accepts an explicit empty tool policy and rejects duplicate names', () => {
    assert.deepEqual(domainMainAgentExecutionRequestSchema.parse({
      prompt: 'Work without tools.',
      allowedTools: []
    }).allowedTools, [])
    assert.throws(() => domainMainAgentExecutionRequestSchema.parse({
      prompt: 'Work.',
      allowedTools: ['sciforge_invoke', 'sciforge_invoke']
    }), z.ZodError)
  })
})
