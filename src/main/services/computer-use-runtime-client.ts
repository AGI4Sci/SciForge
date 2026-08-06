import {
  computerUseCapabilitiesEnvelopeSchema,
  computerUseStatusEnvelopeSchema,
  type ComputerUseSidecarRuntimeStatus
} from '../../shared/computer-use-contract'
import { atomicWriteAppDataJsonAtPath } from './app-data-store'

export type ComputerUseRuntimeConnection = 'online' | 'offline' | 'stale'

export type ComputerUseRuntimeView = {
  connection: ComputerUseRuntimeConnection
  stale: boolean
  lastSuccessAt: string | null
  lastStatusError: string | null
  serverInstanceId: string | null
  generation: number | null
  updatedAt: string
  protocolVersion: 2 | null
  approvalProof: 'legacy-trust-boundary' | 'invocation-proof-v1' | 'unavailable'
  lifecycleState: 'running' | 'stopping' | 'stopped' | 'unknown'
  backends: ComputerUseSidecarRuntimeStatus['backends']
  counts: ComputerUseSidecarRuntimeStatus['registry']['counts']
  active: ComputerUseSidecarRuntimeStatus['active']
  cleanupPending: ComputerUseSidecarRuntimeStatus['cleanupPending']
  recentRejections: ComputerUseSidecarRuntimeStatus['recentRejections']
  reaper: ComputerUseSidecarRuntimeStatus['reaper'] | null
}

type FetchLike = typeof fetch

export type ComputerUseRuntimeClientOptions = {
  baseUrl: string
  token?: string
  timeoutMs?: number
  cachePath?: string
  fetchImpl?: FetchLike
  now?: () => Date
  writeCache?: (path: string, value: unknown) => Promise<void>
}

const EMPTY_COUNTS: ComputerUseRuntimeView['counts'] = {
  sessions: 0,
  requests: 0,
  activeLeases: 0,
  tombstones: 0,
  releasedLeaseTombstones: 0
}

export class ComputerUseRuntimeClient {
  private readonly baseUrl: URL
  private readonly token: string
  private readonly timeoutMs: number
  private readonly cachePath?: string
  private readonly fetchImpl: FetchLike
  private readonly now: () => Date
  private readonly writeCache: (path: string, value: unknown) => Promise<void>
  private lastAccepted: ComputerUseRuntimeView | null = null

  constructor(options: ComputerUseRuntimeClientOptions) {
    this.baseUrl = trustedLoopbackUrl(options.baseUrl)
    this.token = options.token?.trim() ?? ''
    this.timeoutMs = boundedTimeout(options.timeoutMs)
    this.cachePath = options.cachePath
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? (() => new Date())
    this.writeCache = options.writeCache ?? ((path, value) =>
      atomicWriteAppDataJsonAtPath(path, value, { trailingNewline: true }))
  }

  async refresh(): Promise<ComputerUseRuntimeView> {
    try {
      const [statusEnvelope, capabilitiesEnvelope] = await Promise.all([
        this.get('/computer-use/status', computerUseStatusEnvelopeSchema),
        this.get('/computer-use/capabilities', computerUseCapabilitiesEnvelopeSchema)
      ])
      const status = statusEnvelope.data
      const capabilities = capabilitiesEnvelope.data
      if (status.approvalProof !== capabilities.approvalProof) {
        throw new Error('Computer Use status/capabilities approval proof mismatch.')
      }
      const last = this.lastAccepted
      if (
        last?.serverInstanceId === status.serverInstanceId &&
        last.generation !== null &&
        status.registry.generation < last.generation
      ) {
        return this.offlineView('Computer Use status generation regressed.', true)
      }
      const acceptedAt = this.now().toISOString()
      const view: ComputerUseRuntimeView = {
        connection: 'online',
        stale: false,
        lastSuccessAt: acceptedAt,
        lastStatusError: null,
        serverInstanceId: status.serverInstanceId,
        generation: status.registry.generation,
        updatedAt: status.updatedAt,
        protocolVersion: status.protocolVersion,
        approvalProof: status.approvalProof,
        lifecycleState: status.lifecycleState,
        backends: capabilities.backends,
        counts: status.registry.counts,
        active: status.active,
        cleanupPending: status.cleanupPending,
        recentRejections: status.recentRejections,
        reaper: status.reaper
      }
      this.lastAccepted = view
      if (this.cachePath) {
        await this.writeCache(this.cachePath, { version: 2, runtime: view })
      }
      return view
    } catch (error) {
      return this.offlineView(safeStatusError(error), this.lastAccepted !== null)
    }
  }

  private offlineView(message: string, stale: boolean): ComputerUseRuntimeView {
    const last = this.lastAccepted
    return {
      connection: stale ? 'stale' : 'offline',
      stale,
      lastSuccessAt: last?.lastSuccessAt ?? null,
      lastStatusError: message,
      serverInstanceId: last?.serverInstanceId ?? null,
      generation: last?.generation ?? null,
      updatedAt: this.now().toISOString(),
      protocolVersion: last?.protocolVersion ?? null,
      approvalProof: last?.approvalProof ?? 'unavailable',
      lifecycleState: 'unknown',
      backends: (last?.backends ?? []).map((backend) => ({
        ...backend,
        available: false,
        reason: 'Sidecar status is stale or offline.'
      })),
      counts: { ...EMPTY_COUNTS },
      active: [],
      cleanupPending: [],
      recentRejections: last?.recentRejections ?? [],
      reaper: null
    }
  }

  private async get<T>(path: string, schema: { parse: (value: unknown) => T }): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(new URL(path, this.baseUrl).toString(), {
        method: 'GET',
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined,
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`Computer Use sidecar returned HTTP ${response.status}.`)
      return schema.parse(await response.json())
    } finally {
      clearTimeout(timer)
    }
  }
}

function trustedLoopbackUrl(value: string): URL {
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
    throw new Error('Computer Use runtime status URL must use trusted loopback HTTP.')
  }
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return 2_000
  if (!Number.isInteger(value) || value < 100 || value > 30_000) {
    throw new Error('Computer Use runtime status timeout must be 100..30000ms.')
  }
  return value
}

function safeStatusError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n]+/g, ' ').slice(0, 512) || 'Computer Use status is unavailable.'
}
