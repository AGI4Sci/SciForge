import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  startComputerUseAgentModelBridge,
  type ComputerUseAgentModelBridge
} from './computer-use-agent-model-bridge'

let bridge: ComputerUseAgentModelBridge | null = null

afterEach(async () => {
  await bridge?.close()
  bridge = null
})

describe('Computer Use agent model bridge', () => {
  it('runs a tool-free hidden Codex plan with bounded in-memory screenshots', async () => {
    const run = vi.fn(async () => ({
      text: 'Action: click Settings\n<tool_call>{"name":"computer_use","arguments":{"action":"left_click","coordinate":[10,20]}}</tool_call>',
      threadId: 'hidden-1'
    }))
    bridge = await startComputerUseAgentModelBridge({
      agentExecution: { run },
      workspaceRoot: 'C:\\workspace'
    })
    const response = await fetch(`${bridge.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bridge.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        stream: false,
        instructions: 'Return an action.',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Click Settings.' },
            { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }
          ]
        }]
      })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      output_text: expect.stringContaining('click Settings')
    })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      allowedTools: [],
      mode: 'plan',
      imageUrls: ['data:image/png;base64,AAAA']
    }))
  })

  it('rejects unauthenticated and non-image requests before Agent execution', async () => {
    const run = vi.fn(async () => ({ text: 'unused' }))
    bridge = await startComputerUseAgentModelBridge({
      agentExecution: { run },
      workspaceRoot: 'C:\\workspace'
    })
    const unauthorized = await fetch(`${bridge.baseUrl}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    })
    expect(unauthorized.status).toBe(401)

    const missingImage = await fetch(`${bridge.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bridge.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ input: [{ role: 'user', content: [] }] })
    })
    expect(missingImage.status).toBe(502)
    expect(run).not.toHaveBeenCalled()
  })

  it('plans a trusted semantic observation as a forced Responses function call', async () => {
    const run = vi.fn(async () => ({
      text: JSON.stringify({
        name: 'computer_use',
        arguments: { action: 'write', elementToken: 'uia-token:editor', text: 'alpha' }
      }),
      threadId: 'hidden-semantic-1'
    }))
    bridge = await startComputerUseAgentModelBridge({
      agentExecution: { run },
      workspaceRoot: 'C:\\workspace'
    })
    const response = await fetch(`${bridge.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bridge.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        stream: false,
        metadata: {
          sciforge_observation_mode: 'semantic',
          sciforge_semantic_observation: {
            targetId: 'uia:42:100:abc',
            revision: 7,
            semanticTree: [{ elementToken: 'uia-token:editor', name: 'Editor' }]
          }
        },
        input: [{
          role: 'user',
          content: [{
            type: 'input_text',
            text: 'Semantic tree: [{"elementToken":"uia-token:editor"}]'
          }]
        }],
        tools: [{
          type: 'function',
          name: 'computer_use',
          parameters: {
            type: 'object',
            properties: { action: { type: 'string' } },
            required: ['action']
          }
        }],
        tool_choice: { type: 'function', name: 'computer_use' }
      })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      output: [{
        type: 'function_call',
        name: 'computer_use',
        arguments: JSON.stringify({
          action: 'write',
          elementToken: 'uia-token:editor',
          text: 'alpha'
        })
      }]
    })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      allowedTools: [],
      imageUrls: [],
      canonicalObservation: {
        kind: 'target-semantic-tree',
        targetId: 'uia:42:100:abc',
        revision: '7',
        semanticTree: [{ elementToken: 'uia-token:editor', name: 'Editor' }]
      },
      prompt: expect.stringContaining('canonical target-bound observation')
    }))
  })

  it('rejects a semantic marker without a bounded target observation', async () => {
    const run = vi.fn(async () => ({ text: 'unused' }))
    bridge = await startComputerUseAgentModelBridge({
      agentExecution: { run },
      workspaceRoot: 'C:\\workspace'
    })
    const response = await fetch(`${bridge.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bridge.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        metadata: { sciforge_observation_mode: 'semantic' },
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'unbound tree' }] }]
      })
    })

    expect(response.status).toBe(502)
    expect(run).not.toHaveBeenCalled()
  })
})
