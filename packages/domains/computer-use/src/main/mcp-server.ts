import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  COMPUTER_USE_INVOCATION_HEADER,
  computerUseArgumentDigest,
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
  computerUseToolInputSchema,
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

type ComputerUseEffect = 'read-only' | 'mutation' | 'run'

const DEFAULT_TIMEOUT_MS = 600_000
const MAX_MUTATION_LEDGER_ENTRIES = 4_096

type MutationLedgerEntry = {
  tool: string
  argumentDigest: string
  result: Promise<ComputerUseToolResult>
}

type MutationLedger = Map<string, MutationLedgerEntry>

type MutationDispatch = {
  tool: string
  requestId: string
}

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
  const mutationLedger: MutationLedger = new Map()
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
    config, '/computer-use/capabilities', 'GET', undefined, extra.signal, 'read-only'
  ))

  server.registerTool(COMPUTER_USE_LIST_TARGETS_TOOL_NAME, {
    description: 'List redacted Computer Use targets exposed by configured providers.',
    inputSchema: computerUseEmptyInputSchema,
    annotations: { title: 'Computer use targets', readOnlyHint: true }
  }, async (_args, extra) => callComputerUseServiceEndpoint(
    config, '/computer-use/targets', 'GET', undefined, extra.signal, 'read-only'
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
      mutationLedger,
      '/computer-use/sessions/bind',
      'computer_use_bind_target',
      parsed.data,
      extra._meta,
      extra.signal
    )
  })

  server.registerTool(COMPUTER_USE_MCP_TOOL_NAME, {
    description: [
      'Perform one bounded structured semantic action in a pre-bound browser-cdp Session.',
      'The required semanticAction supports observe, click, and bounded click/type/press/scroll sequences.',
      'expectedRevision rejects stale observations before dispatch; deadlineMs is a real execution deadline.',
      'instruction is optional audit context only and never invokes a planner. Instruction-only input is rejected.'
    ].join(' '),
    inputSchema: computerUseToolInputSchema,
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
      const instructionOnly = args && typeof args === 'object' && 'instruction' in args && !('semanticAction' in args)
      return errorToolResult(
        instructionOnly ? 'UNSUPPORTED_LEGACY_INSTRUCTION' : 'INVALID_ARGUMENT',
        instructionOnly
          ? 'instruction-only Computer Use is unsupported; provide semanticAction'
          : 'invalid structured Computer Use input'
      )
    }
    return callComputerUseService(config, mutationLedger, parsed.data, extra._meta, extra.signal)
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
      mutationLedger,
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
  effect: ComputerUseEffect,
  invocationProof?: string,
  mutation?: MutationDispatch
): Promise<ComputerUseToolResult> {
  const controller = new AbortController()
  const unlink = linkAbortSignal(signal, controller)
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  let endpoint: string
  try {
    endpoint = trustedLoopbackEndpoint(config.serviceUrl, path)
  } catch (error) {
    clearTimeout(timeout)
    unlink()
    return unavailableToolResult(error, controller.signal.aborted)
  }
  if (controller.signal.aborted) {
    clearTimeout(timeout)
    unlink()
    return unavailableToolResult(undefined, true)
  }
  try {
    const response = await fetch(endpoint, {
      method,
      headers: jsonHeaders(config.serviceToken, invocationProof),
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
      redirect: 'error'
    })
    const payload = await response.json().catch(() => null)
    if (!isServiceResponse(payload)) {
      return mutation
        ? unknownMutationOutcomeToolResult(
            mutation,
            `computer-use service returned an invalid JSON response (HTTP ${response.status})`
          )
        : errorToolResult('BAD_RESPONSE', `computer-use service returned an invalid JSON response (HTTP ${response.status})`)
    }
    return serviceResponseToToolResult(response, payload, effect)
  } catch (error) {
    return mutation && !isConnectionRefused(error)
      ? unknownMutationOutcomeToolResult(
          mutation,
          mutationFailureMessage(error, controller.signal.aborted)
        )
      : unavailableToolResult(error, controller.signal.aborted)
  } finally {
    clearTimeout(timeout)
    unlink()
  }
}

async function callAuthorizedComputerUseEndpoint(
  config: ComputerUseServiceConfig,
  mutationLedger: MutationLedger,
  path: string,
  tool: string,
  body: Record<string, unknown>,
  meta: Record<string, unknown> | undefined,
  signal: AbortSignal
): Promise<ComputerUseToolResult> {
  try {
    const authorization = authorizeMutation(config, tool, body, meta)
    return dispatchAuthorizedMutation(
      mutationLedger,
      authorization,
      () => callComputerUseServiceEndpoint(
        config,
        path,
        'POST',
        authorization.body,
        signal,
        'mutation',
        authorization.proof,
        { tool, requestId: authorization.requestId }
      )
    )
  } catch (error) {
    return proofErrorToolResult(error)
  }
}

async function callComputerUseService(
  config: ComputerUseServiceConfig,
  mutationLedger: MutationLedger,
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
      meta
    )
  } catch (error) {
    return proofErrorToolResult(error)
  }
  return dispatchAuthorizedMutation(
    mutationLedger,
    authorization,
    () => dispatchComputerUseRun(config, authorization, meta, signal)
  )
}

async function dispatchComputerUseRun(
  config: ComputerUseServiceConfig,
  authorization: AuthorizedMutation,
  meta: Record<string, unknown> | undefined,
  signal: AbortSignal
): Promise<ComputerUseToolResult> {
  const requestId = authorization.requestId
  const controller = new AbortController()
  const unlink = linkAbortSignal(signal, controller)
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  const cancel = (): void => {
    try {
      const cancelAuthorization = authorizeMutation(
        config,
        'computer_use_cancel',
        { requestId },
        meta,
        requestId
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

  let endpoint: string
  try {
    endpoint = trustedLoopbackEndpoint(config.serviceUrl, '/computer-use/run')
  } catch (error) {
    clearTimeout(timeout)
    controller.signal.removeEventListener('abort', cancel)
    unlink()
    return unavailableToolResult(error, controller.signal.aborted)
  }
  if (controller.signal.aborted) {
    clearTimeout(timeout)
    controller.signal.removeEventListener('abort', cancel)
    unlink()
    return unavailableToolResult(undefined, true)
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: jsonHeaders(config.serviceToken, authorization.proof),
      body: JSON.stringify(authorization.body),
      signal: controller.signal,
      redirect: 'error'
    })
    const payload = await response.json().catch(() => null)
    if (!isServiceResponse(payload)) {
      return unknownMutationOutcomeToolResult(
        { tool: COMPUTER_USE_MCP_TOOL_NAME, requestId },
        `computer-use service returned an invalid JSON response (HTTP ${response.status})`
      )
    }
    return serviceResponseToToolResult(response, payload, 'run')
  } catch (error) {
    return isConnectionRefused(error)
      ? unavailableToolResult(error, controller.signal.aborted)
      : unknownMutationOutcomeToolResult(
          { tool: COMPUTER_USE_MCP_TOOL_NAME, requestId },
          mutationFailureMessage(error, controller.signal.aborted)
        )
  } finally {
    clearTimeout(timeout)
    controller.signal.removeEventListener('abort', cancel)
    unlink()
  }
}

function serviceResponseToToolResult(
  response: Response,
  record: Record<string, unknown>,
  effect: ComputerUseEffect
): ComputerUseToolResult {
  const summary = typeof record.summary === 'string' && record.summary.trim()
    ? record.summary
    : response.ok
      ? 'computer-use request completed'
      : `computer-use failed (HTTP ${response.status})`
  return {
    content: [{ type: 'text', text: summary }],
    structuredContent: { ...record, changed: computerUseStateChanged(record, effect) },
    ...(record.ok === false || !response.ok ? { isError: true as const } : {})
  }
}

function computerUseStateChanged(
  record: Record<string, unknown>,
  effect: ComputerUseEffect
): boolean {
  if (effect === 'read-only') return false
  const data = recordValue(record.data)
  const error = recordValue(record.error)
  const details = recordValue(error?.details)
  if (effect === 'run') {
    return data?.executed === true || details?.executed === true ||
      details?.mayHaveTakenEffect === true || error?.code === 'ACTION_OUTCOME_UNKNOWN'
  }
  return record.ok === true || error?.code === 'CANCEL_PENDING' ||
    details?.mayHaveTakenEffect === true
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function isServiceResponse(value: unknown): value is Record<string, unknown> {
  return Boolean(recordValue(value)) && typeof (value as Record<string, unknown>).ok === 'boolean'
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
  requestId: string
  ledgerIdentity?: string
  tool: string
  argumentDigest: string
}

function authorizeMutation(
  config: ComputerUseServiceConfig,
  tool: string,
  body: Record<string, unknown>,
  meta: Record<string, unknown> | undefined,
  requestId?: string
): AuthorizedMutation {
  const argumentDigest = computerUseArgumentDigest(body)
  if ((config.invocationProofMode ?? 'required') === 'legacy') {
    const resolvedRequestId = requestId ?? `mcp-cua-${randomUUID()}`
    return {
      body: {
        ...body,
        ...(tool === COMPUTER_USE_MCP_TOOL_NAME ? { requestId: resolvedRequestId } : {})
      },
      requestId: resolvedRequestId,
      tool,
      argumentDigest
    }
  }
  const trusted = parseTrustedComputerUseInvocation(meta)
  requireConfirmedInvocation(trusted)
  const ledgerIdentity = [
    trusted.runtimeId,
    trusted.threadId,
    trusted.turnId,
    trusted.invocationId
  ].join('\0')
  const resolvedRequestId = requestId ?? stableMutationRequestId(
    ledgerIdentity,
    tool,
    argumentDigest
  )
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
    proof: encodeComputerUseInvocationProof(proof),
    requestId: proof.requestId,
    ledgerIdentity,
    tool,
    argumentDigest
  }
}

function dispatchAuthorizedMutation(
  ledger: MutationLedger,
  authorization: AuthorizedMutation,
  dispatch: () => Promise<ComputerUseToolResult>
): Promise<ComputerUseToolResult> {
  const identity = authorization.ledgerIdentity
  if (!identity) return dispatch()
  const existing = ledger.get(identity)
  if (existing) {
    if (existing.tool !== authorization.tool || existing.argumentDigest !== authorization.argumentDigest) {
      return Promise.resolve(errorToolResult(
        'INVOCATION_IDENTITY_MISMATCH',
        'Computer Use invocation ID was already used with a different mutation.'
      ))
    }
    return existing.result
  }
  if (ledger.size >= MAX_MUTATION_LEDGER_ENTRIES) {
    return Promise.resolve(errorToolResult(
      'INVOCATION_LEDGER_CAPACITY',
      'Computer Use invocation ledger is at capacity; refusing an untracked mutation.'
    ))
  }
  const result = Promise.resolve().then(dispatch)
  ledger.set(identity, {
    tool: authorization.tool,
    argumentDigest: authorization.argumentDigest,
    result
  })
  return result
}

function stableMutationRequestId(identity: string, tool: string, argumentDigest: string): string {
  return `mcp-cua-${computerUseArgumentDigest({ identity, tool, argumentDigest })}`
}

function requireConfirmedInvocation(
  trusted: TrustedComputerUseInvocation | null
): asserts trusted is TrustedComputerUseInvocation & {
  approval: 'confirmation'
  invocationId: string
  turnId: string
} {
  if (!trusted || trusted.approval !== 'confirmation' || !trusted.invocationId || !trusted.turnId) {
    throw new InvocationProofError(
      'APPROVAL_PROOF_REQUIRED',
      'Computer Use mutation requires one trusted, confirmed turn invocation.'
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

function unknownMutationOutcomeToolResult(
  mutation: MutationDispatch,
  cause: string
): ComputerUseToolResult {
  const message = [
    `Computer Use ${mutation.tool} was dispatched but its final result is unknown.`,
    'Observe the current target/session state before deciding whether to issue a new mutation.',
    cause
  ].join(' ')
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: {
      ok: false,
      changed: true,
      error: {
        code: 'ACTION_OUTCOME_UNKNOWN',
        message,
        retryable: false,
        details: {
          requestId: mutation.requestId,
          tool: mutation.tool,
          mayHaveTakenEffect: true
        }
      }
    },
    isError: true
  }
}

function unavailableToolResult(error: unknown, aborted: boolean): ComputerUseToolResult {
  return errorToolResult(
    'UNAVAILABLE',
    aborted
      ? 'computer-use call was cancelled before dispatch'
      : `computer-use call failed before dispatch: ${safeErrorMessage(error)}`
  )
}

function mutationFailureMessage(error: unknown, aborted: boolean): string {
  return aborted
    ? 'The response was lost after the call timed out or was cancelled.'
    : `The response was lost after dispatch: ${safeErrorMessage(error)}`
}

function isConnectionRefused(error: unknown): boolean {
  const safePreDispatchCodes = new Set([
    'ECONNREFUSED',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETDOWN',
    'ENETUNREACH',
    'ENOTFOUND'
  ])
  let current: unknown = error
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const record = current as { code?: unknown; cause?: unknown }
    if (typeof record.code === 'string' && safePreDispatchCodes.has(record.code)) return true
    current = record.cause
  }
  return false
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'unknown error')
}

function errorToolResult(code: string, message: string): ComputerUseToolResult {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { ok: false, changed: false, error: { code, message } },
    isError: true
  }
}
