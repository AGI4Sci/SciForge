import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CAPABILITY_RUNTIME_BRIDGE_MAX_FILE_BYTES,
  CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES,
  CAPABILITY_RUNTIME_BRIDGE_VERSION,
  atomicWriteCapabilityRuntimeBridgeJson,
  capabilityRuntimeBridgePaths,
  capabilityRuntimeBridgeRequestPath,
  capabilityRuntimeBridgeResponsePath,
  parseCapabilityRuntimeBridgeRequest,
  signCapabilityRuntimeBridgeCatalog,
  signCapabilityRuntimeBridgeResponse,
  type CapabilityRuntimeBridgeError,
  type CapabilityRuntimeBridgeToolDefinition
} from '../local-runtime-package-contract'
import {
  CapabilityAgentToolError,
  type CapabilityAgentToolSurface
} from './agent-tools'

const DEFAULT_POLL_INTERVAL_MS = 25
const DEFAULT_CALL_TIMEOUT_MS = 30_000

export type CapabilityRuntimeBridgeLaunchConfig = Readonly<{
  rootDir: string
  authSecret: string
  timeoutMs: number
}>

export type CapabilityRuntimeBridgeOptions = Readonly<{
  rootDir: string
  surface: Pick<CapabilityAgentToolSurface, 'tools' | 'call'>
  capabilityIds: () => readonly string[]
  authSecret?: string
  callTimeoutMs?: number
  pollIntervalMs?: number
  now?: () => Date
}>

/**
 * A narrow authenticated transport into the one in-process capability
 * surface. It owns no capability registry, provider, or domain behavior.
 */
export class CapabilityRuntimeBridge {
  readonly #rootDir: string
  readonly #surface: Pick<CapabilityAgentToolSurface, 'tools' | 'call'>
  readonly #capabilityIds: () => readonly string[]
  readonly #authSecret: string
  readonly #callTimeoutMs: number
  readonly #pollIntervalMs: number
  readonly #now: () => Date
  readonly #processing = new Set<string>()
  #timer: ReturnType<typeof setInterval> | null = null
  #scanPromise: Promise<void> | null = null

  constructor(options: CapabilityRuntimeBridgeOptions) {
    this.#rootDir = options.rootDir
    this.#surface = options.surface
    this.#capabilityIds = options.capabilityIds
    this.#authSecret = options.authSecret ?? randomBytes(32).toString('base64url')
    this.#callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.#now = options.now ?? (() => new Date())
  }

  launchConfig(): CapabilityRuntimeBridgeLaunchConfig {
    return {
      rootDir: this.#rootDir,
      authSecret: this.#authSecret,
      timeoutMs: this.#callTimeoutMs
    }
  }

  async start(): Promise<void> {
    if (this.#timer) return
    const paths = capabilityRuntimeBridgePaths(this.#rootDir)
    await mkdir(paths.requests, { recursive: true, mode: 0o700 })
    await mkdir(paths.responses, { recursive: true, mode: 0o700 })
    await Promise.all([this.#clearDirectory(paths.requests), this.#clearDirectory(paths.responses)])
    await this.#publishCatalog()
    this.#timer = setInterval(() => void this.#scan(), this.#pollIntervalMs)
    this.#timer.unref?.()
    await this.#scan()
  }

  async close(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
    await this.#scanPromise?.catch(() => undefined)
  }

  async #publishCatalog(): Promise<void> {
    const definitions = this.#surface.tools()
    const names = definitions.map((tool) => tool.name)
    if (names.length !== CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES.length ||
        CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES.some((name) => !names.includes(name))) {
      throw new Error('Capability runtime bridge requires exactly the four SciForge meta-tools.')
    }
    const catalog = signCapabilityRuntimeBridgeCatalog(this.#authSecret, {
      version: CAPABILITY_RUNTIME_BRIDGE_VERSION,
      generatedAt: this.#now().toISOString(),
      capabilityIds: [...new Set(this.#capabilityIds())].sort(),
      tools: definitions.map((tool): CapabilityRuntimeBridgeToolDefinition => ({
        type: tool.type,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    })
    await atomicWriteCapabilityRuntimeBridgeJson(
      capabilityRuntimeBridgePaths(this.#rootDir).catalog,
      catalog
    )
  }

  async #scan(): Promise<void> {
    if (this.#scanPromise) return this.#scanPromise
    this.#scanPromise = this.#scanOnce().finally(() => {
      this.#scanPromise = null
    })
    return this.#scanPromise
  }

  async #scanOnce(): Promise<void> {
    const directory = capabilityRuntimeBridgePaths(this.#rootDir).requests
    const entries = await readdir(directory).catch(() => [])
    await Promise.all(entries
      .filter((name) => /^[A-Za-z0-9_-]{16,128}\.json$/u.test(name))
      .map((name) => this.#processRequest(name.slice(0, -5))))
  }

  async #processRequest(requestIdFromPath: string): Promise<void> {
    if (this.#processing.has(requestIdFromPath)) return
    this.#processing.add(requestIdFromPath)
    const requestPath = capabilityRuntimeBridgeRequestPath(this.#rootDir, requestIdFromPath)
    try {
      const requestStat = await stat(requestPath)
      if (requestStat.size > CAPABILITY_RUNTIME_BRIDGE_MAX_FILE_BYTES) {
        throw Object.assign(new Error('Capability bridge request is too large.'), { code: 'bridge_request_too_large' })
      }
      const raw = JSON.parse(await readFile(requestPath, 'utf8')) as unknown
      const request = parseCapabilityRuntimeBridgeRequest(raw, this.#authSecret, this.#now().getTime())
      if (request.requestId !== requestIdFromPath) {
        throw Object.assign(new Error('Capability bridge request path does not match its signed payload.'), {
          code: 'bridge_request_mismatch'
        })
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.#callTimeoutMs)
      timeout.unref?.()
      try {
        const called = await boundedCall(
          this.#surface.call({
            name: request.tool,
            arguments: request.arguments,
            context: {
              ...request.context,
              runtimeId: 'sciforge'
            }
          }, { signal: controller.signal }),
          this.#callTimeoutMs,
          controller
        )
        await this.#writeResponse(request.requestId, { ok: true, value: called.value })
      } finally {
        clearTimeout(timeout)
      }
    } catch (error) {
      await this.#writeResponse(requestIdFromPath, {
        ok: false,
        error: structuredBridgeError(error)
      }).catch(() => undefined)
    } finally {
      await rm(requestPath, { force: true }).catch(() => undefined)
      this.#processing.delete(requestIdFromPath)
    }
  }

  async #writeResponse(
    requestId: string,
    result: { ok: true; value: unknown } | { ok: false; error: CapabilityRuntimeBridgeError }
  ): Promise<void> {
    const response = signCapabilityRuntimeBridgeResponse(this.#authSecret, {
      version: CAPABILITY_RUNTIME_BRIDGE_VERSION,
      requestId,
      completedAt: this.#now().toISOString(),
      result
    })
    await atomicWriteCapabilityRuntimeBridgeJson(
      capabilityRuntimeBridgeResponsePath(this.#rootDir, requestId),
      response
    )
  }

  async #clearDirectory(directory: string): Promise<void> {
    const entries = await readdir(directory).catch(() => [])
    await Promise.all(entries.map((entry) => rm(join(directory, entry), { force: true, recursive: true })))
  }
}

async function boundedCall<T>(
  task: Promise<T>,
  timeoutMs: number,
  controller: AbortController
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(Object.assign(new Error('Capability bridge call timed out.'), { code: 'bridge_timeout' }))
    }, timeoutMs)
    timer.unref?.()
  })
  try {
    return await Promise.race([task, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function structuredBridgeError(error: unknown): CapabilityRuntimeBridgeError {
  const code = error instanceof CapabilityAgentToolError
    ? error.code
    : typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : 'capability_bridge_call_failed'
  const message = error instanceof Error ? error.message : 'Capability bridge call failed.'
  return {
    code,
    message: message.slice(0, 1_000),
    retryable: code === 'bridge_timeout' || code === 'capability_bridge_unavailable'
  }
}
