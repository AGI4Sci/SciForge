import { describe, expect, it } from 'vitest'
import type { AgentRuntimeAdapterContext } from '../agent-runtime/adapter'
import type { ClaudeCodeRuntimeService } from './claude-code-service'
import { createClaudeCodeAgentRuntimeAdapter } from './claude-code-agent-runtime-adapter'

describe('createClaudeCodeAgentRuntimeAdapter', () => {
  it('seeds Claude pre-dispatch governance from Host-owned typed turn metadata', async () => {
    const received: unknown[] = []
    const adapter = createClaudeCodeAgentRuntimeAdapter({
      startTurn: async (input: unknown) => {
        received.push(input)
        return {
          ok: true,
          threadId: 'thread-seeded-governance',
          turnId: 'turn-seeded-governance',
          userMessageItemId: 'user-seeded-governance'
        }
      }
    } as unknown as ClaudeCodeRuntimeService)
    const ctx = {
      settings: {},
      turnGovernanceSnapshot: {
        ownedVisualToolsAvailable: true,
        nativeVisualProofChainPending: true
      }
    } as AgentRuntimeAdapterContext

    await adapter.startTurn(ctx, {
      runtimeId: 'claude',
      threadId: 'thread-seeded-governance',
      text: 'Host prepared text',
      workspace: '/tmp/workspace',
      allowedTools: ['sciforge_discover']
    })

    expect(received).toEqual([expect.objectContaining({
      threadId: 'thread-seeded-governance',
      allowedTools: ['sciforge_discover'],
      ownedVisualToolsAvailable: true,
      nativeVisualProofChainPending: true
    })])
  })

  it('forwards workspace file references to the Claude runtime service', async () => {
    const received: unknown[] = []
    const adapter = createClaudeCodeAgentRuntimeAdapter({
      startTurn: async (input: unknown) => {
        received.push(input)
        return {
          ok: true,
          threadId: 'thread-file-references',
          turnId: 'turn-file-references',
          userMessageItemId: 'user-file-references'
        }
      }
    } as unknown as ClaudeCodeRuntimeService)
    const ctx = { settings: {} } as AgentRuntimeAdapterContext

    await adapter.startTurn(ctx, {
      runtimeId: 'claude',
      threadId: 'thread-file-references',
      text: 'Review the attached sources.',
      workspace: '/tmp/workspace',
      fileReferences: [{
        path: 'papers/source.pdf',
        relativePath: 'papers/source.pdf',
        name: 'source.pdf',
        kind: 'pdf',
        mimeType: 'application/pdf'
      }]
    })

    expect(received).toEqual([expect.objectContaining({
      text: 'Review the attached sources.',
      fileReferences: [{
        path: 'papers/source.pdf',
        relativePath: 'papers/source.pdf',
        name: 'source.pdf',
        kind: 'pdf',
        mimeType: 'application/pdf'
      }]
    })])
  })

  it('forwards Host-owned turn governance snapshots without interpreting them', async () => {
    const received: unknown[] = []
    const adapter = createClaudeCodeAgentRuntimeAdapter({
      updateTurnGovernanceSnapshot: (input: unknown) => {
        received.push(input)
      }
    } as unknown as ClaudeCodeRuntimeService)
    const ctx = { settings: {} } as AgentRuntimeAdapterContext
    const input = {
      runtimeId: 'claude' as const,
      threadId: 'thread-governance',
      turnId: 'turn-governance',
      snapshot: {
        ownedVisualToolsAvailable: true,
        nativeVisualProofChainPending: true
      }
    }

    await adapter.updateTurnGovernanceSnapshot?.(ctx, input)

    expect(received).toEqual([input])
  })

  it('leaves Computer Use discovery to the managed capability broker', async () => {
    const adapter = createClaudeCodeAgentRuntimeAdapter({
      runtimeInfo: async () => ({
        command: 'claude',
        model: 'sciforge-router'
      })
    } as unknown as ClaudeCodeRuntimeService)
    const ctx = { settings: {} } as AgentRuntimeAdapterContext

    await expect(adapter.capabilities(ctx)).resolves.toMatchObject({
      runtimeId: 'claude',
      tools: {
        mcp: { available: false },
        computerUse: {
          available: false,
          reason: 'Computer Use is exposed through the managed capability broker.'
        }
      }
    })
    await expect(adapter.auxiliary?.(ctx, {
      operation: 'getToolDiagnostics'
    })).resolves.toMatchObject({ mcpServers: [] })
    await expect(adapter.auxiliary?.(ctx, {
      operation: 'getRuntimeInfo'
    })).resolves.toMatchObject({
      capabilities: {
        mcp: {
          computerUse: {
            enabled: false,
            available: false
          }
        }
      }
    })
  })

  it('honors shared subagent capability settings', async () => {
    const adapter = createClaudeCodeAgentRuntimeAdapter({
      runtimeInfo: async () => ({
        command: 'claude',
        model: 'sciforge-router'
      })
    } as unknown as ClaudeCodeRuntimeService)
    const ctx = {
      settings: {
        agentCapabilities: {
          subagents: {
            enabled: false,
            maxParallel: 2
          }
        }
      }
    } as AgentRuntimeAdapterContext

    await expect(adapter.capabilities(ctx)).resolves.toMatchObject({
      tools: {
        subagents: {
          available: false,
          maxParallel: 2
        }
      }
    })
    await expect(adapter.auxiliary?.(ctx, {
      operation: 'getRuntimeInfo'
    })).resolves.toMatchObject({
      capabilities: {
        subagents: {
          available: false,
          maxParallel: 2
        }
      }
    })
  })

  it('reports memory as unavailable without failing listMemories diagnostics', async () => {
    const adapter = createClaudeCodeAgentRuntimeAdapter({
      runtimeInfo: async () => ({
        command: 'claude',
        model: 'sciforge-router'
      })
    } as unknown as ClaudeCodeRuntimeService)
    const ctx = { settings: {} } as AgentRuntimeAdapterContext

    await expect(adapter.capabilities(ctx)).resolves.toMatchObject({
      runtimeId: 'claude',
      storage: {
        memory: { available: false }
      }
    })
    await expect(adapter.auxiliary?.(ctx, {
      operation: 'getRuntimeInfo'
    })).resolves.toMatchObject({
      host: 'claude-code',
      command: 'claude',
      model: 'sciforge-router',
      capabilities: {
        attachments: { available: false },
        web: {
          fetch: { available: false },
          search: { available: false }
        },
        memory: { available: false }
      }
    })
    await expect(adapter.auxiliary?.(ctx, {
      operation: 'listMemories',
      payload: { options: { workspace: '/tmp/project', includeDeleted: false } }
    })).resolves.toEqual([])
    await expect(adapter.auxiliary?.(ctx, {
      operation: 'updateMemory',
      payload: { memoryId: 'mem_1', patch: { disabled: true } }
    })).rejects.toThrow(/does not support memory operations/)
  })
})
