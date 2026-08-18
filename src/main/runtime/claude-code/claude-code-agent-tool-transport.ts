import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type {
  AgentRuntimeToolDefinition,
  AgentRuntimeToolSessionContext,
  AgentRuntimeToolSurface
} from '../agent-runtime/agent-tool-surface'
import { modelVisibleAgentRuntimeToolFailure } from '../agent-runtime/agent-tool-surface'

const DEFAULT_SERVER_NAME = 'sciforge_runtime_tools'
const DEFAULT_SERVER_VERSION = '1.0.0'

export type ClaudeCodeAgentToolTransportOptions = Readonly<{
  surface: AgentRuntimeToolSurface
  context: AgentRuntimeToolSessionContext
  serverName?: string
  serverVersion?: string
}>

type ClaudeSdkMcpServerFactory = (
  options: Parameters<typeof createSdkMcpServer>[0]
) => McpSdkServerConfigWithInstance

export type ClaudeCodeAgentToolTransportDependencies = Readonly<{
  createServer?: ClaudeSdkMcpServerFactory
}>

/** Maps the shared runtime tool contract to Claude's in-process MCP protocol. */
export function createClaudeCodeAgentToolTransport(
  options: ClaudeCodeAgentToolTransportOptions,
  dependencies: ClaudeCodeAgentToolTransportDependencies = {}
): McpSdkServerConfigWithInstance {
  const createServer = dependencies.createServer ?? createSdkMcpServer
  let generatedRequestId = 0
  const tools = options.surface.tools().map((definition) => tool(
    definition.name,
    definition.description,
    topLevelZodShape(definition),
    async (argumentsValue, extra) => {
      const protocolRequestId = requestIdFromExtra(extra)
      const signal = abortSignalFromExtra(extra)
      const requestId = protocolRequestId
        ?? options.context.requestId
        ?? `${options.context.runtimeId}:${options.context.turnId ?? options.context.threadId ?? 'session'}:${++generatedRequestId}`
      try {
        const result = await options.surface.call({
          name: definition.name,
          arguments: argumentsValue,
          context: {
            requestId,
            runtimeId: options.context.runtimeId,
            ...(options.context.threadId ? { threadId: options.context.threadId } : {}),
            ...(options.context.turnId ? { turnId: options.context.turnId } : {}),
            ...(options.context.workspaceId ? { workspaceId: options.context.workspaceId } : {}),
            callId: String(protocolRequestId ?? requestId)
          }
        }, signal ? { signal } : {})
        return successfulToolResult(result.tool, result.value)
      } catch (error) {
        return failedToolResult(definition.name, error)
      }
    }
  ))

  return createServer({
    name: options.serverName?.trim() || DEFAULT_SERVER_NAME,
    version: options.serverVersion?.trim() || DEFAULT_SERVER_VERSION,
    alwaysLoad: true,
    tools
  })
}

function topLevelZodShape(
  definition: AgentRuntimeToolDefinition
): Record<string, z.ZodType> {
  const properties = recordValue(definition.inputSchema.properties)
  const required = new Set(Array.isArray(definition.inputSchema.required)
    ? definition.inputSchema.required.filter((entry): entry is string => typeof entry === 'string')
    : [])
  return Object.fromEntries(Object.entries(properties).map(([name, schemaValue]) => {
    const schema = recordValue(schemaValue)
    let value = shallowZodValue(schema)
    if (typeof schema.description === 'string' && schema.description.trim()) {
      value = value.describe(schema.description)
    }
    if (!required.has(name)) value = value.optional()
    return [name, value]
  }))
}

function shallowZodValue(schema: Record<string, unknown>): z.ZodType {
  const enumSchema = primitiveEnumSchema(schema.enum)
  if (enumSchema) return enumSchema
  const type = typeof schema.type === 'string' ? schema.type : ''
  switch (type) {
    case 'string':
      return z.string()
    case 'integer':
      return z.number().int()
    case 'number':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'array': {
      const items = recordValue(schema.items)
      return z.array(primitiveZodValue(items))
    }
    case 'object':
      return z.record(z.string(), z.unknown())
    case 'null':
      return z.null()
    default:
      return z.unknown()
  }
}

function primitiveZodValue(schema: Record<string, unknown>): z.ZodType {
  const enumSchema = primitiveEnumSchema(schema.enum)
  if (enumSchema) return enumSchema
  switch (schema.type) {
    case 'string':
      return z.string()
    case 'integer':
      return z.number().int()
    case 'number':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'null':
      return z.null()
    default:
      return z.unknown()
  }
}

function primitiveEnumSchema(value: unknown): z.ZodType | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return null
  if (!value.every((entry) => (
    typeof entry === 'string'
    || typeof entry === 'number'
    || typeof entry === 'boolean'
    || entry === null
  ))) return null
  const literals = value.map((entry) => z.literal(entry as string | number | boolean | null))
  return literals.length === 1
    ? literals[0]!
    : z.union(literals as [z.ZodLiteral, z.ZodLiteral, ...z.ZodLiteral[]])
}

function successfulToolResult(toolName: string, value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: stringifyToolValue(value) }],
    structuredContent: { tool: toolName, value }
  }
}

function failedToolResult(toolName: string, error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error)
  const code = errorCode(error)
  const record = recordValue(error)
  const metadata = {
    code,
    message,
    ...(typeof record.failureClass === 'string' ? { failureClass: record.failureClass } : {}),
    ...(typeof record.retryable === 'boolean' ? { retryable: record.retryable } : {}),
    ...(typeof record.recoveryGuidance === 'string'
      ? { recoveryGuidance: record.recoveryGuidance }
      : typeof recordValue(record.recovery).instruction === 'string'
        ? { recoveryGuidance: recordValue(record.recovery).instruction }
        : {}),
    ...(typeof record.providerStage === 'string' ? { providerStage: record.providerStage } : {}),
    ...(typeof record.resourceIdentity === 'string' ? { resourceIdentity: record.resourceIdentity } : {}),
    ...(typeof record.evidenceDelta === 'boolean' ? { evidenceDelta: record.evidenceDelta } : {}),
    ...(typeof record.stateChanged === 'boolean' ? { stateChanged: record.stateChanged } : {})
  }
  return {
    content: [{ type: 'text', text: modelVisibleAgentRuntimeToolFailure(toolName, error) }],
    structuredContent: { error: metadata },
    isError: true
  }
}

function stringifyToolValue(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2)
  return serialized === undefined ? String(value) : serialized
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'runtime_tool_error'
  const code = String(error.code).trim()
  return code || 'runtime_tool_error'
}

function requestIdFromExtra(extra: unknown): string | number | undefined {
  const requestId = recordValue(extra).requestId
  return typeof requestId === 'string' || typeof requestId === 'number' ? requestId : undefined
}

function abortSignalFromExtra(extra: unknown): AbortSignal | undefined {
  const signal = recordValue(extra).signal
  return isAbortSignal(signal) ? signal : undefined
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (!value || typeof value !== 'object') return false
  return 'aborted' in value
    && typeof value.aborted === 'boolean'
    && 'addEventListener' in value
    && typeof value.addEventListener === 'function'
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export type ClaudeCodeSdkAgentToolDefinition = SdkMcpToolDefinition<any>
