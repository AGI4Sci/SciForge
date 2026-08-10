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
      allowedTools: ['sciforge_discover', 'sciforge_invoke'],
      interaction: 'reviewable',
      mode: 'agent',
      signal: controller.signal
    })

    assert.deepEqual(await host.run(request), {
      text: 'codex:agent',
      threadId: 'thread-1'
    })
  })

  it('defaults execution mode, inherits the active runtime, and rejects host-private fields', () => {
    assert.deepEqual(domainMainAgentExecutionRequestSchema.parse({
      prompt: 'Continue.',
      workspaceRoot: '/workspace'
    }), {
      prompt: 'Continue.',
      workspaceRoot: '/workspace',
      interaction: 'background',
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

  it('accepts an explicit empty tool policy and rejects duplicate names', () => {
    assert.deepEqual(domainMainAgentExecutionRequestSchema.parse({
      prompt: 'Work without tools.',
      workspaceRoot: '/workspace',
      allowedTools: []
    }).allowedTools, [])
    assert.throws(() => domainMainAgentExecutionRequestSchema.parse({
      prompt: 'Work.',
      workspaceRoot: '/workspace',
      allowedTools: ['sciforge_invoke', 'sciforge_invoke']
    }), z.ZodError)
  })
})
