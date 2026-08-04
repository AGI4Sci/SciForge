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
        text: `${request.runtimeId}:${request.mode ?? 'agent'}`,
        threadId: 'thread-1'
      })
    }

    const request = domainMainAgentExecutionRequestSchema.parse({
      runtimeId: 'codex',
      prompt: 'Implement the reviewed workflow.',
      workspaceRoot: '/workspace/project',
      model: 'frontier',
      reasoningEffort: 'high',
      mode: 'agent',
      signal: controller.signal
    })

    assert.deepEqual(await host.run(request), {
      text: 'codex:agent',
      threadId: 'thread-1'
    })
  })

  it('defaults execution mode and rejects host-private or unbounded fields', () => {
    assert.deepEqual(domainMainAgentExecutionRequestSchema.parse({
      runtimeId: 'sciforge',
      prompt: 'Continue.',
      workspaceRoot: '/workspace'
    }), {
      runtimeId: 'sciforge',
      prompt: 'Continue.',
      workspaceRoot: '/workspace',
      mode: 'agent'
    })

    assert.throws(() => domainMainAgentExecutionRequestSchema.parse({
      runtimeId: 'sciforge',
      prompt: 'Continue.',
      workspaceRoot: '/workspace',
      privateThreadStore: {}
    }), z.ZodError)
  })

  it('keeps the result envelope minimal and strict', () => {
    assert.deepEqual(domainMainAgentExecutionResultSchema.parse({
      text: 'Done.',
      threadId: 'thread-1'
    }), {
      text: 'Done.',
      threadId: 'thread-1'
    })
    assert.throws(() => domainMainAgentExecutionResultSchema.parse({
      text: 'Done.',
      providerResponse: {}
    }), z.ZodError)
  })
})
