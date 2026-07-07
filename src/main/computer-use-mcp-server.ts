import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  COMPUTER_USE_MCP_LAUNCH_FLAG,
  GUI_COMPUTER_USE_MCP_SERVER_NAME,
  COMPUTER_USE_MCP_TOOL_NAME
} from './computer-use-mcp-config'

type ComputerUseToolResult = CallToolResult & {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: true
}

type ComputerUseServiceConfig = {
  serviceUrl: string
  serviceToken: string
  timeoutMs: number
}

const computerUseInputSchema = z.object({
  instruction: z.string().trim().min(1).max(16_384)
}).strict()

const DEFAULT_TIMEOUT_MS = 600_000

export type StartComputerUseMcpServerOptions = {
  transport?: Transport
  env?: NodeJS.ProcessEnv
}

export async function runComputerUseMcpServerFromArgv(
  argv: string[],
  options: StartComputerUseMcpServerOptions = {}
): Promise<boolean> {
  if (!argv.includes(COMPUTER_USE_MCP_LAUNCH_FLAG)) return false
  await startComputerUseMcpServer(options)
  return true
}

export async function startComputerUseMcpServer(
  options: StartComputerUseMcpServerOptions = {}
): Promise<void> {
  const server = createComputerUseMcpServer(resolveComputerUseServiceConfig(options.env ?? process.env))
  const transport = options.transport ?? new StdioServerTransport()
  await server.connect(transport)
}

export function createComputerUseMcpServer(
  config: ComputerUseServiceConfig | null = resolveComputerUseServiceConfig()
): McpServer {
  const server = new McpServer(
    { name: GUI_COMPUTER_USE_MCP_SERVER_NAME, version: '0.1.0' },
    { capabilities: { logging: {} } }
  )

  if (!config) return server

  server.registerTool(COMPUTER_USE_MCP_TOOL_NAME, {
    description: [
      'Control the user\'s real desktop to complete one GUI task through the SciForge GUI-Owl computer-use sidecar.',
      'Provide one clear natural-language instruction. The sidecar observes the screen, plans, grounds coordinates,',
      'and executes only after host approval. Returns a ServiceResult trace and optional answer; verify the result.'
    ].join(' '),
    inputSchema: computerUseInputSchema,
    annotations: {
      title: 'Computer use',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  }, async (args, extra) => {
    const parsed = computerUseInputSchema.safeParse(args)
    if (!parsed.success) {
      return errorToolResult('INVALID_ARGUMENT', 'instruction is required')
    }
    return callComputerUseService(config, parsed.data.instruction, extra.signal)
  })

  return server
}

export function resolveComputerUseServiceConfig(
  env: NodeJS.ProcessEnv = process.env
): ComputerUseServiceConfig | null {
  const serviceUrl = (env.SCIFORGE_CUA_SERVICE_URL ?? '').trim().replace(/\/+$/, '')
  if (!serviceUrl) return null
  const serviceToken = (
    env.SCIFORGE_CUA_SERVICE_TOKEN ??
    env.CUA_SERVICE_TOKEN ??
    ''
  ).trim()
  const timeout = Number(env.SCIFORGE_CUA_SERVICE_TIMEOUT_MS)
  return {
    serviceUrl,
    serviceToken,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS
  }
}

async function callComputerUseService(
  config: ComputerUseServiceConfig,
  instruction: string,
  signal: AbortSignal
): Promise<ComputerUseToolResult> {
  const requestId = `mcp-cua-${randomUUID()}`
  const controller = new AbortController()
  const unlink = linkAbortSignal(signal, controller)
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  const cancel = (): void => {
    void fetch(`${config.serviceUrl}/computer-use/cancel`, {
      method: 'POST',
      headers: jsonHeaders(config.serviceToken),
      body: JSON.stringify({ requestId })
    }).catch(() => undefined)
  }
  controller.signal.addEventListener('abort', cancel, { once: true })

  try {
    const response = await fetch(`${config.serviceUrl}/computer-use/run`, {
      method: 'POST',
      headers: jsonHeaders(config.serviceToken),
      body: JSON.stringify({ instruction, execute: true, approve: true, requestId }),
      signal: controller.signal
    })
    const payload = await response.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return errorToolResult('BAD_RESPONSE', `computer-use service returned non-JSON (HTTP ${response.status})`)
    }
    const record = payload as Record<string, unknown>
    const summary = typeof record.summary === 'string' && record.summary.trim()
      ? record.summary
      : response.ok
        ? 'computer-use run completed'
        : `computer-use failed (HTTP ${response.status})`
    return {
      content: [{ type: 'text', text: summary }],
      structuredContent: record,
      ...(record.ok === false || !response.ok ? { isError: true as const } : {})
    }
  } catch (error) {
    return errorToolResult(
      'UNAVAILABLE',
      controller.signal.aborted
        ? 'computer-use call timed out or was cancelled'
        : `computer-use call failed: ${error instanceof Error ? error.message : String(error)}`
    )
  } finally {
    clearTimeout(timeout)
    controller.signal.removeEventListener('abort', cancel)
    unlink()
  }
}

function jsonHeaders(serviceToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {})
  }
}

function linkAbortSignal(signal: AbortSignal, controller: AbortController): () => void {
  if (signal.aborted) {
    controller.abort(signal.reason)
    return () => undefined
  }
  const abort = (): void => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  return () => signal.removeEventListener('abort', abort)
}

function errorToolResult(code: string, message: string): ComputerUseToolResult {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { ok: false, error: { code, message } },
    isError: true
  }
}
