import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  CAPABILITY_AGENT_TOOL_NAMES,
  createCapabilityAgentToolSurface
} from '../../capabilities/agent-tools'
import type { AgentRuntimeToolSurface } from '../agent-runtime/agent-tool-surface'
import {
  createClaudeCodeAgentToolTransport,
  type ClaudeCodeAgentToolTransportDependencies
} from './claude-code-agent-tool-transport'

describe('Claude Code agent tool transport', () => {
  it('exposes the shared capability surface as one shallow in-process MCP server', () => {
    const surface = createCapabilityAgentToolSurface({
      broker: unusedBroker(),
      resolveCaller: () => ({ callerId: 'agent:test', audience: 'agent' })
    })
    const captured: Array<Parameters<NonNullable<ClaudeCodeAgentToolTransportDependencies['createServer']>>[0]> = []

    createClaudeCodeAgentToolTransport({
      surface,
      context: { runtimeId: 'claude', threadId: 'thread-1', turnId: 'turn-1', workspaceId: '/workspace' }
    }, {
      createServer: (options) => {
        captured.push(options)
        return { type: 'sdk', name: options.name, instance: {} } as never
      }
    })

    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      name: 'sciforge_runtime_tools',
      version: '1.0.0',
      alwaysLoad: true
    })
    const tools = captured[0]!.tools ?? []
    expect(tools.map((entry) => entry.name)).toEqual(Object.values(CAPABILITY_AGENT_TOOL_NAMES))

    for (const entry of tools) {
      const schema = z.toJSONSchema(z.object(entry.inputSchema), { target: 'draft-07' })
      expect(maxObjectDepth(schema)).toBeLessThanOrEqual(8)
    }
    const invoke = tools.find((entry) => entry.name === CAPABILITY_AGENT_TOOL_NAMES.invoke)
    expect(Object.keys(invoke?.inputSchema ?? {})).toEqual(['operationRef', 'resourceRef', 'input'])
  })

  it('forwards protocol and runtime context and maps the response to CallToolResult', async () => {
    const call = vi.fn(async () => ({
      tool: CAPABILITY_AGENT_TOOL_NAMES.discover,
      value: [{ operationRef: 'op_test', title: 'Search' }]
    }))
    const surface: AgentRuntimeToolSurface = {
      tools: () => [{
        type: 'function',
        name: CAPABILITY_AGENT_TOOL_NAMES.discover,
        description: 'Discover operations.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } }
        }
      }],
      call
    }
    let handler: ((args: Record<string, unknown>, extra: unknown) => Promise<unknown>) | undefined
    createClaudeCodeAgentToolTransport({
      surface,
      context: {
        runtimeId: 'claude-next',
        threadId: 'thread-2',
        turnId: 'turn-2',
        workspaceId: '/workspace-2'
      }
    }, {
      createServer: (options) => {
        handler = options.tools?.[0]?.handler
        return { type: 'sdk', name: options.name, instance: {} } as never
      }
    })
    const controller = new AbortController()

    const result = await handler?.({ text: 'paper' }, { requestId: 42, signal: controller.signal })

    expect(call).toHaveBeenCalledWith({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'paper' },
      context: {
        requestId: 42,
        runtimeId: 'claude-next',
        threadId: 'thread-2',
        turnId: 'turn-2',
        workspaceId: '/workspace-2',
        callId: '42'
      }
    }, { signal: controller.signal })
    expect(result).toEqual({
      content: [{
        type: 'text',
        text: JSON.stringify([{ operationRef: 'op_test', title: 'Search' }], null, 2)
      }],
      structuredContent: {
        tool: CAPABILITY_AGENT_TOOL_NAMES.discover,
        value: [{ operationRef: 'op_test', title: 'Search' }]
      }
    })
  })

  it('returns tool failures as MCP error results', async () => {
    const surface: AgentRuntimeToolSurface = {
      tools: () => [{
        type: 'function',
        name: CAPABILITY_AGENT_TOOL_NAMES.observe,
        description: 'Observe a resource.',
        inputSchema: { type: 'object', properties: {} }
      }],
      call: async () => {
        throw Object.assign(new Error('The resource reference expired.'), {
          code: 'unknown_resource_ref',
          failureClass: 'stale_resource',
          retryable: false,
          providerStage: 'evidence_validation',
          resourceIdentity: 'resource:expired',
          recovery: {
            action: 'reobserve',
            instruction: 'Observe the current resource before invoking another operation.'
          }
        })
      }
    }
    let handler: ((args: Record<string, unknown>, extra: unknown) => Promise<unknown>) | undefined
    createClaudeCodeAgentToolTransport({
      surface,
      context: { runtimeId: 'claude', requestId: 'turn-request' }
    }, {
      createServer: (options) => {
        handler = options.tools?.[0]?.handler
        return { type: 'sdk', name: options.name, instance: {} } as never
      }
    })

    await expect(handler?.({}, {})).resolves.toEqual({
      content: [{
        type: 'text',
        text: JSON.stringify({
          tool: CAPABILITY_AGENT_TOOL_NAMES.observe,
          status: 'failed',
          error: {
            code: 'unknown_resource_ref',
            message: 'The resource reference expired.',
            failureClass: 'stale_resource',
            retryable: false,
            providerStage: 'evidence_validation',
            resourceIdentity: 'resource:expired',
            recovery: {
              action: 'reobserve',
              instruction: 'Observe the current resource before invoking another operation.'
            }
          }
        }, null, 2)
      }],
      structuredContent: {
        error: {
          code: 'unknown_resource_ref',
          message: 'The resource reference expired.',
          failureClass: 'stale_resource',
          retryable: false,
          providerStage: 'evidence_validation',
          resourceIdentity: 'resource:expired',
          recoveryGuidance: 'Observe the current resource before invoking another operation.'
        }
      },
      isError: true
    })
  })
})

function unusedBroker() {
  return {
    discover: async () => [],
    observe: async () => { throw new Error('unused') },
    bindResourceRef: async () => { throw new Error('unused') },
    invoke: async () => { throw new Error('unused') },
    listEvents: async () => []
  }
}

function maxObjectDepth(value: unknown, depth = 0): number {
  if (!value || typeof value !== 'object') return depth
  if (Array.isArray(value)) {
    return value.reduce((maximum, entry) => Math.max(maximum, maxObjectDepth(entry, depth + 1)), depth)
  }
  return Object.values(value).reduce(
    (maximum, entry) => Math.max(maximum, maxObjectDepth(entry, depth + 1)),
    depth
  )
}
