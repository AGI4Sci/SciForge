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
})
