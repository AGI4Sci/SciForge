import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  COMPUTER_USE_INVOCATION_HEADER,
  createComputerUseInvocationProof,
  encodeComputerUseInvocationProof,
  parseTrustedComputerUseInvocation,
  type TrustedComputerUseInvocation
} from './services/computer-use-invocation-proof'
import {
  computerUseBindTargetInputSchema,
  computerUseEmptyInputSchema,
  computerUseReleaseSessionInputSchema,
  computerUseRunInputSchema,
  type ComputerUseRunInput
} from '../contract'
import {
  COMPUTER_USE_BIND_TARGET_TOOL_NAME,
  COMPUTER_USE_GET_CAPABILITIES_TOOL_NAME,
  COMPUTER_USE_LIST_TARGETS_TOOL_NAME,
  COMPUTER_USE_MCP_LAUNCH_FLAG,
  COMPUTER_USE_RELEASE_SESSION_TOOL_NAME,
  GUI_COMPUTER_USE_MCP_SERVER_NAME,
  COMPUTER_USE_MCP_TOOL_NAME
} from './mcp-config'
import { trustedLoopbackEndpoint, trustedLoopbackOrigin } from './trusted-loopback-url'

type ComputerUseToolResult = CallToolResult & {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: true
}

type ComputerUseServiceConfig = {
  serviceUrl: string
  serviceToken: string
  timeoutMs: number
  invocationSecret?: string
  invocationProofMode?: 'required' | 'legacy'
  invocationProofTtlMs?: number
}

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

  server.registerTool(COMPUTER_USE_GET_CAPABILITIES_TOOL_NAME, {
    description: 'Return the Computer Use protocol and backend capability status.',
    inputSchema: computerUseEmptyInputSchema,
    annotations: { title: 'Computer use capabilities', readOnlyHint: true }
  }, async (_args, extra) => callComputerUseServiceEndpoint(
    config, '/computer-use/capabilities', 'GET', undefined, extra.signal
  ))

  server.registerTool(COMPUTER_USE_LIST_TARGETS_TOOL_NAME, {
    description: 'List redacted Computer Use targets exposed by configured providers.',
    inputSchema: computerUseEmptyInputSchema,
    annotations: { title: 'Computer use targets', readOnlyHint: true }
  }, async (_args, extra) => callComputerUseServiceEndpoint(
    config, '/computer-use/targets', 'GET', undefined, extra.signal
  ))

  server.registerTool(COMPUTER_USE_BIND_TARGET_TOOL_NAME, {
    description: 'Bind an immutable target to a local runtime-owned session.',
    inputSchema: computerUseBindTargetInputSchema,
    annotations: { title: 'Bind computer-use target', readOnlyHint: false }
  }, async (args, extra) => {
    const parsed = computerUseBindTargetInputSchema.safeParse(args)
    if (!parsed.success) return errorToolResult('INVALID_ARGUMENT', 'invalid target binding')
    return callAuthorizedComputerUseEndpoint(
      config,
      '/computer-use/sessions/bind',
      'computer_use_bind_target',
      parsed.data,
      extra._meta,
      extra.signal
    )
  })

  server.registerTool(COMPUTER_USE_MCP_TOOL_NAME, {
    description: [
      'Control the user\'s real desktop to complete one GUI task through the SciForge GUI-Owl computer-use sidecar.',
      'Provide one clear natural-language instruction. The sidecar observes the screen, plans, grounds coordinates,',
      'and executes only after host approval. For exact accessible controls, semanticAction provides a deterministic',
      'target-scoped observation/readback, browser click, or bounded Windows UIA Pattern sequence, without host-global',
      'input. UIA sequence steps are write/invoke/toggle and require role plus name or automationId. Use parallel with 2-8 different pre-bound',
      'sessions when tasks must overlap under one approval; each child keeps its own request, channel, lease, and result.',
      'Each parallel child is authoritative for requestedIsolation and allowDegraded; matching top-level copies are accepted',
      'as redundant assertions. Top-level queueIfBusy and deadlineMs are batch defaults that children may override.',
      'Returns a ServiceResult trace and optional answer.'
    ].join(' '),
    inputSchema: computerUseRunInputSchema,
    annotations: {
      title: 'Computer use',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  }, async (args, extra) => {
    const parsed = computerUseRunInputSchema.safeParse(args)
    if (!parsed.success) {
      return errorToolResult('INVALID_ARGUMENT', 'instruction is required')
    }
    return callComputerUseService(config, parsed.data, extra._meta, extra.signal)
  })

  server.registerTool(COMPUTER_USE_RELEASE_SESSION_TOOL_NAME, {
    description: 'Cancel active work and release a Computer Use session.',
    inputSchema: computerUseReleaseSessionInputSchema,
    annotations: { title: 'Release computer-use session', readOnlyHint: false }
  }, async (args, extra) => {
    const parsed = computerUseReleaseSessionInputSchema.safeParse(args)
    if (!parsed.success) return errorToolResult('INVALID_ARGUMENT', 'invalid session release')
    return callAuthorizedComputerUseEndpoint(
      config,
      '/computer-use/sessions/release',
      'computer_use_release_session',
      parsed.data,
      extra._meta,
      extra.signal
    )
  })

  return server
}

export function resolveComputerUseServiceConfig(
  env: NodeJS.ProcessEnv = process.env
): ComputerUseServiceConfig | null {
  const serviceUrl = (env.SCIFORGE_CUA_SERVICE_URL ?? '').trim()
  if (!serviceUrl) return null
  const serviceToken = (
    env.SCIFORGE_CUA_SERVICE_TOKEN ??
    env.CUA_SERVICE_TOKEN ??
    ''
  ).trim()
  const timeout = Number(env.SCIFORGE_CUA_SERVICE_TIMEOUT_MS)
  return {
    serviceUrl: trustedLoopbackOrigin(serviceUrl).origin,
    serviceToken,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    invocationSecret: (env.SCIFORGE_CUA_INVOCATION_SECRET ?? '').trim(),
    invocationProofMode: env.CUA_INVOCATION_PROOF_MODE === 'legacy' ? 'legacy' : 'required',
    invocationProofTtlMs: resolveProofTtlMs(env.SCIFORGE_CUA_INVOCATION_PROOF_TTL_MS)
  }
}

async function callComputerUseServiceEndpoint(
  config: ComputerUseServiceConfig,
  path: string,
  method: 'GET' | 'POST',
  body: Record<string, unknown> | undefined,
  signal: AbortSignal,
  invocationProof?: string
): Promise<ComputerUseToolResult> {
  const controller = new AbortController()
  const unlink = linkAbortSignal(signal, controller)
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const response = await fetch(trustedLoopbackEndpoint(config.serviceUrl, path), {
      method,
      headers: jsonHeaders(config.serviceToken, invocationProof),
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
      redirect: 'error'
    })
    const payload = await response.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return errorToolResult('BAD_RESPONSE', `computer-use service returned non-JSON (HTTP ${response.status})`)
    }
    return serviceResponseToToolResult(response, payload as Record<string, unknown>)
  } catch (error) {
    return errorToolResult(
      'UNAVAILABLE',
      controller.signal.aborted
        ? 'computer-use call timed out or was cancelled'
        : `computer-use call failed: ${error instanceof Error ? error.message : String(error)}`
    )
  } finally {
    clearTimeout(timeout)
    unlink()
  }
}

async function callAuthorizedComputerUseEndpoint(
  config: ComputerUseServiceConfig,
  path: string,
  tool: string,
  body: Record<string, unknown>,
  meta: Record<string, unknown> | undefined,
  signal: AbortSignal
): Promise<ComputerUseToolResult> {
  try {
    const authorization = authorizeMutation(config, tool, body, meta)
    return callComputerUseServiceEndpoint(
      config,
      path,
      'POST',
      authorization.body,
      signal,
      authorization.proof
    )
  } catch (error) {
    return proofErrorToolResult(error)
  }
}

async function callComputerUseService(
  config: ComputerUseServiceConfig,
  input: ComputerUseRunInput,
  meta: Record<string, unknown> | undefined,
  signal: AbortSignal
): Promise<ComputerUseToolResult> {
  const argumentsForProof = { ...input, execute: true }
  let authorization: AuthorizedMutation
  try {
    authorization = authorizeMutation(
      config,
      COMPUTER_USE_MCP_TOOL_NAME,
      argumentsForProof,
      meta,
      `mcp-cua-${randomUUID()}`
    )
  } catch (error) {
    return proofErrorToolResult(error)
  }
  const requestId = String(authorization.body.requestId)
  const controller = new AbortController()
  const unlink = linkAbortSignal(signal, controller)
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  const cancel = (): void => {
    try {
      const cancelAuthorization = authorizeMutation(
        config,
        'computer_use_cancel',
        { requestId },
        meta
      )
      void fetch(trustedLoopbackEndpoint(config.serviceUrl, '/computer-use/cancel'), {
        method: 'POST',
        headers: jsonHeaders(config.serviceToken, cancelAuthorization.proof),
        body: JSON.stringify(cancelAuthorization.body),
        redirect: 'error'
      }).catch(() => undefined)
    } catch {
      // The original call still aborts. Status will expose cleanup pending if
      // a separately authorized cancellation could not be sent.
    }
  }
  controller.signal.addEventListener('abort', cancel, { once: true })

  try {
    const response = await fetch(trustedLoopbackEndpoint(config.serviceUrl, '/computer-use/run'), {
      method: 'POST',
      headers: jsonHeaders(config.serviceToken, authorization.proof),
      body: JSON.stringify(authorization.body),
      signal: controller.signal,
      redirect: 'error'
    })
    const payload = await response.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return errorToolResult('BAD_RESPONSE', `computer-use service returned non-JSON (HTTP ${response.status})`)
    }
    return serviceResponseToToolResult(response, payload as Record<string, unknown>)
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

function serviceResponseToToolResult(
  response: Response,
  record: Record<string, unknown>
): ComputerUseToolResult {
  const summary = typeof record.summary === 'string' && record.summary.trim()
    ? record.summary
    : response.ok
      ? 'computer-use request completed'
      : `computer-use failed (HTTP ${response.status})`
  return {
    content: [{ type: 'text', text: summary }],
    structuredContent: record,
    ...(record.ok === false || !response.ok ? { isError: true as const } : {})
  }
}

function jsonHeaders(serviceToken: string, invocationProof?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
    ...(invocationProof ? { [COMPUTER_USE_INVOCATION_HEADER]: invocationProof } : {})
  }
}

type AuthorizedMutation = {
  body: Record<string, unknown>
  proof?: string
}

function authorizeMutation(
  config: ComputerUseServiceConfig,
  tool: string,
  body: Record<string, unknown>,
  meta: Record<string, unknown> | undefined,
  requestId?: string
): AuthorizedMutation {
  const resolvedRequestId = requestId ?? `mcp-cua-${randomUUID()}`
  if ((config.invocationProofMode ?? 'required') === 'legacy') {
    return {
      body: {
        ...body,
        ...(tool === COMPUTER_USE_MCP_TOOL_NAME ? { approve: true, requestId: resolvedRequestId } : {})
      }
    }
  }
  const trusted = parseTrustedComputerUseInvocation(meta)
  requireConfirmedInvocation(trusted)
  const secret = config.invocationSecret ?? ''
  if (!secret) throw new InvocationProofError(
    'APPROVAL_PROOF_REQUIRED',
    'Computer Use invocation proof is required but its signing secret is unavailable.'
  )
  const proof = createComputerUseInvocationProof({
    secret,
    trusted,
    tool,
    arguments: body,
    requestId: resolvedRequestId,
    ttlMs: config.invocationProofTtlMs ?? 30_000
  })
  return {
    body: {
      ...body,
      ...(tool === COMPUTER_USE_MCP_TOOL_NAME ? { requestId: proof.requestId } : {})
    },
    proof: encodeComputerUseInvocationProof(proof)
  }
}

function requireConfirmedInvocation(
  trusted: TrustedComputerUseInvocation | null
): asserts trusted is TrustedComputerUseInvocation & { approval: 'confirmation'; invocationId: string } {
  if (!trusted || trusted.approval !== 'confirmation' || !trusted.invocationId) {
    throw new InvocationProofError(
      'APPROVAL_PROOF_REQUIRED',
      'Computer Use mutation requires one trusted, confirmed invocation.'
    )
  }
}

class InvocationProofError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'InvocationProofError'
  }
}

function proofErrorToolResult(error: unknown): ComputerUseToolResult {
  return error instanceof InvocationProofError
    ? errorToolResult(error.code, error.message)
    : errorToolResult(
        'APPROVAL_PROOF_INVALID',
        error instanceof Error ? error.message : 'Computer Use invocation proof is invalid.'
      )
}

function resolveProofTtlMs(raw: string | undefined): number {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 && value <= 300_000 ? value : 30_000
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
