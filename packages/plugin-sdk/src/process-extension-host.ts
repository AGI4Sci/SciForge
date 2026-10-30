import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { existsSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import {
  WORKSPACE_PREVIEW_PROTOCOL,
  WORKSPACE_PREVIEW_TIMEOUT_MS,
  WORKSPACE_PREVIEW_METHODS,
  workspacePreviewWireRequestSchema,
  type WorkspacePreviewMethod
} from './workspace-preview-channel.js'
import { HostServiceProviderRegistry, type HostServiceInvocation, type HostServiceOwner } from './host-service-provider.js'
export * from './host-service-provider.js'

export type RemoteCapabilityDescriptor = Readonly<Record<string, unknown> & { id: string }>
/** Host-only profile/package binding; never accepted from a plugin manifest/config. */
export type DshStorageGrant = Readonly<{ profileRoot: string; packageName: string }>
/** Effects that may be granted to a DSH tool by the Host. */
export type DshToolEffect = 'read' | 'compute' | 'workspace-write' | 'external-write' | 'destructive'
/** Exact host-owned grants, never plugin metadata. */
export type DshToolGrants = Readonly<Record<string, Readonly<{ id: string; effect: DshToolEffect; /** Explicit Host-only opt-in for reusable cross-session read resources. */ readResource?: 'workspace' }>>>

/** The only ordinary Session identity that crosses the extension process boundary. */
export type DshOrdinarySessionIdentity = Readonly<{
  runtimeId: string
  threadId: string
  sessionId: string
}>

/** Host-captured caller data; the runner must not derive or overwrite these fields. */
export type DshCallerContext = Readonly<Record<string, unknown>>

/** Serializable invocation facts passed to the child and to Host authorization. */
export type DshInvocationContext = Readonly<{
  caller: DshCallerContext
  ordinarySession: DshOrdinarySessionIdentity
  /** Original caller context values, preserved without deriving or overwriting fields. */
  context: DshCallerContext
}>

/** Trusted child-local resolver entrypoint supplied by Host composition. */
export type DshChildAgentResolver = Readonly<{
  path: string
}>

export type DshToolAuthorizationRequest = Readonly<{
  packageName: string
  version: string
  generation: number
  capabilityId: string
  effect: DshToolEffect
  caller: DshCallerContext
  ordinarySession: DshOrdinarySessionIdentity
  context: DshCallerContext
}>

/** Wire protocol of the Host ports bridge; the runner envelopes every plugin request. */
export const HOST_PORTS_PROTOCOL = 'sciforge-host-ports.v1' as const
/** Identity bound by the Host to the extension process; plugin-supplied values are discarded. */
export type HostPortsIdentity = Readonly<{ pluginId: string; version: string }>
/** Host-facing ports request after wire validation and Host identity binding. */
export type HostPortsRequest = Readonly<{
  protocol: typeof HOST_PORTS_PROTOCOL
  requestId: string
  identity: HostPortsIdentity
  caller?: Readonly<Record<string, unknown>>
  operation: string
  scope?: Readonly<Record<string, unknown>>
  input: unknown
}>
/** Structured ports result; error codes are preserved across the process boundary. */
export type HostPortsResult = Readonly<
  | { ok: true; value: unknown }
  | { ok: false; error: Readonly<{ code: string; message: string }> }
>

function normalizeHostPortsResult(result: unknown): HostPortsResult {
  if (result && typeof result === 'object') {
    const candidate = result as { ok?: unknown; value?: unknown; error?: unknown }
    if (candidate.ok === true) return { ok: true, value: candidate.value ?? null }
    const error = candidate.error as { code?: unknown; message?: unknown } | undefined
    if (candidate.ok === false && error && typeof error === 'object') {
      const code = typeof error.code === 'string' && error.code ? error.code : 'execution_failed'
      const message = typeof error.message === 'string' && error.message ? error.message : 'Host ports request failed.'
      return { ok: false, error: { code, message } }
    }
  }
  return { ok: false, error: { code: 'execution_failed', message: 'Host ports handler returned a malformed result.' } }
}

const hostPortWireRequestSchema = z.object({
  protocol: z.literal(HOST_PORTS_PROTOCOL),
  requestId: z.string().trim().min(1).max(128),
  /** Accepted but never trusted; the runtime binds connection identity before authorization. */
  identity: z.unknown().optional(),
  caller: z.record(z.string(), z.json()).optional(),
  operation: z.string().trim().min(1).max(256),
  scope: z.record(z.string(), z.json()).optional(),
  input: z.json()
}).strict()

const dshIdentityPartSchema = z.string().min(1).max(1024).refine((value) => value === value.trim(), {
  message: 'Cross-process DSH identities must not contain surrounding whitespace.',
})
const dshJsonObjectSchema = z.record(z.string(), z.json())
/** Public serializable schema for the ordinary Session identity. */
export const dshOrdinarySessionIdentitySchema = z.object({
  runtimeId: dshIdentityPartSchema,
  threadId: dshIdentityPartSchema,
  sessionId: dshIdentityPartSchema,
}).strict().readonly()
/** Public serializable schema for the Host-captured invocation envelope. */
export const dshInvocationContextSchema = z.object({
  caller: dshJsonObjectSchema,
  ordinarySession: dshOrdinarySessionIdentitySchema,
  context: dshJsonObjectSchema,
}).strict().readonly()

function cloneInvocationSnapshot<T>(value: T, ancestors = new Set<object>()): T {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object' || ancestors.has(value)) throw new TypeError('Expected acyclic plain JSON values.')
  const array = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Expected plain JSON objects or arrays.')
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (array) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(descriptors, index)) throw new TypeError('Sparse arrays are not lossless JSON.')
    }
  }
  const snapshot = (array ? [] : {}) as T
  ancestors.add(value)
  try {
    for (const key of Reflect.ownKeys(descriptors)) {
      if (array && key === 'length') continue
      if (typeof key !== 'string') throw new TypeError('Symbol properties are not lossless JSON.')
      const descriptor = descriptors[key]
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('Expected enumerable JSON data properties.')
      }
      // Defining own data properties retains __proto__ without invoking its setter.
      Object.defineProperty(snapshot, key, {
        value: cloneInvocationSnapshot(descriptor.value, ancestors),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return Object.freeze(snapshot)
  } finally {
    ancestors.delete(value)
  }
}

export type ProcessExtensionSnapshot = Readonly<{
  pluginId: string
  packageName: string
  version: string
  generation: number
  state: 'starting' | 'active' | 'deactivating' | 'disabled' | 'disposed' | 'failed'
  pid?: number
  capabilityIds: readonly string[]
  privateStorage?: true
  error?: string
  diagnostics?: readonly string[]
}>

export class ProcessExtensionHostError extends Error {
  readonly code: 'startup_failed' | 'request_failed' | 'request_timeout' | 'request_cancelled' | 'stale_generation' | 'runtime_crashed'

  constructor(code: ProcessExtensionHostError['code'], message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ProcessExtensionHostError'
    this.code = code
  }
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  cleanup: () => void
}

type RuntimeOptions = Readonly<{
  hostServices?: HostServiceProviderRegistry
  isHostServiceCurrent?: () => boolean
  pluginId: string
  packageName: string
  version: string
  generation: number
  entryPath: string
  /** Finite readiness, lifecycle and discovery deadline; also the legacy invocation default. */
  timeoutMs?: number
  /**
   * Host-initiated workspace-preview calls budget. Defaults to
   * WORKSPACE_PREVIEW_TIMEOUT_MS (30s); tests inject a short value to cover
   * the request_timeout path without stalling (mutation-check gap #7).
   */
  previewTimeoutMs?: number
  /** Host-owned business invocation deadline. Omitted preserves timeoutMs (default 5000). */
  invokeTimeoutMs?: number
  dshToolGrants?: DshToolGrants
  serviceClients?: readonly import('./host-service-provider.js').HostServiceClientFactory[]
  dshConfig?: Readonly<Record<string, unknown>>
  dshStorage?: DshStorageGrant
  dshAgentResolver?: DshChildAgentResolver
  /**
   * Host-vendored bare dependencies for installed plugins (native addons and
   * similar). Specifiers in `packages` resolve from `baseUrl`'s deployment
   * directory instead of the plugin directory; omitted keeps the previous
   * behaviour of resolving everything relative to the plugin entry.
   */
  pluginRuntimeDeps?: Readonly<{ packages: readonly string[]; baseUrl: string }>
  /**
   * Explicit, host-approved environment for the plugin child process. The child
   * is otherwise spawned with no ambient environment; this is an allowlist of
   * runtime prerequisites a plugin needs (for example the interpreter a
   * scientific engine should call), never ambient forwarding.
   */
  pluginRuntimeEnv?: Readonly<Record<string, string>>
  authorizeDshTool?: (request: DshToolAuthorizationRequest) => void | Promise<void>
  onCapabilitiesChanged?: (runtime: ProcessExtensionRuntime) => void
  onPortsRequest?: (request: HostPortsRequest, boundWorkspace: string | undefined) => Promise<HostPortsResult>
  onPortsCancel?: (requestId: string) => Promise<void>
}>

function validateTimeoutOption(field: 'timeoutMs' | 'invokeTimeoutMs', value: number | undefined): number | undefined {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 2_147_483_647)) {
    throw new RangeError(`${field} must be an integer between 1 and 2147483647 milliseconds.`)
  }
  return value
}

/** One isolated Node/Electron-as-Node process for one plugin generation. */
export class ProcessExtensionRuntime {
  readonly #connectionId = randomUUID()
  readonly #serviceOwners = new Map<string, { owner: HostServiceOwner; services: readonly string[]; assertCurrent?: () => void }>()
  readonly #serviceRequests = new Map<string, { invocationId: string; controller: AbortController; settled: Promise<void> }>()
  readonly #seenServiceRequests = new Set<string>()
  readonly #options: RuntimeOptions
  readonly #previewTimeoutMs: number
  readonly #pending = new Map<string, Pending>()
  #child: ChildProcess | undefined
  #state: ProcessExtensionSnapshot['state'] = 'starting'
  #capabilities: readonly RemoteCapabilityDescriptor[] = []
  #error: string | undefined
  #diagnostics: readonly string[] = []
  #snapshotRevision = 0
  #cleanupPending = false
  #deactivation: Promise<ProcessExtensionSnapshot> | undefined
  #hostServiceDisposal: Promise<void> | undefined
  #hostServicesDisposed = false

  constructor(options: RuntimeOptions) {
    for (const field of ['timeoutMs', 'invokeTimeoutMs'] as const) validateTimeoutOption(field, options[field])
    this.#options = options
    const previewTimeoutMs = options.previewTimeoutMs
    this.#previewTimeoutMs = typeof previewTimeoutMs === 'number' && Number.isFinite(previewTimeoutMs) && previewTimeoutMs > 0
      ? previewTimeoutMs
      : WORKSPACE_PREVIEW_TIMEOUT_MS
  }

  get snapshot(): ProcessExtensionSnapshot {
    return Object.freeze({
      pluginId: this.#options.pluginId,
      packageName: this.#options.packageName,
      version: this.#options.version,
      generation: this.#options.generation,
      state: this.#state,
      ...(this.#child?.pid ? { pid: this.#child.pid } : {}),
      capabilityIds: Object.freeze(this.#capabilities.map(({ id }) => id)),
      ...(this.#options.dshStorage ? { privateStorage: true as const } : {}),
      ...(this.#error !== undefined ? { error: this.#error } : {}),
      ...(this.#diagnostics.length ? { diagnostics: this.#diagnostics } : {})
    })
  }

  get capabilityDescriptors(): readonly RemoteCapabilityDescriptor[] {
    return this.#capabilities
  }

  async activate(): Promise<ProcessExtensionSnapshot> {
    if (this.#state === 'active') return this.snapshot
    const bundledRunnerPath = fileURLToPath(new URL('./process-extension-runner.mjs', import.meta.url))
    const runnerPath = [
      resolve(process.cwd(), 'packages/plugin-sdk/src/process-extension-runner.mjs'),
      bundledRunnerPath
    ].find((candidate) => existsSync(candidate)) ?? bundledRunnerPath
    // A plugin child that dies before readiness normally leaves no trace: its
    // stderr is discarded. Setting SCIFORGE_PLUGIN_RUNTIME_STDERR=<file> (host
    // process env only; never forwarded to the child) captures that output so a
    // failure is diagnosable. Off by default, so nothing changes for users.
    const stderrLogPath = process.env.SCIFORGE_PLUGIN_RUNTIME_STDERR?.trim()
    const child = spawn(process.execPath, [
      runnerPath,
      this.#options.entryPath,
      String(this.#options.generation),
      ...(this.#options.pluginRuntimeDeps
        ? [JSON.stringify({
            packages: [...this.#options.pluginRuntimeDeps.packages],
            baseUrl: this.#options.pluginRuntimeDeps.baseUrl
          })]
        : [])
    ], {
      // JSON IPC drops array own extras; V8 IPC preserves the admitted JSON facts.
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', stderrLogPath ? 'pipe' : 'ignore', 'ipc'],
      // The executable and entrypoint are absolute. Do not forward ambient
      // credentials, proxy configuration, HOME, PATH or Node preload hooks.
      // This is environment isolation, not an OS filesystem/network sandbox.
      // `pluginRuntimeEnv` is the one exception: an explicit, host-approved
      // allowlist of runtime prerequisites a plugin needs (for example the
      // interpreter a scientific engine should call), never ambient forwarding.
      env: { ELECTRON_RUN_AS_NODE: '1', ...(this.#options.pluginRuntimeEnv ?? {}) }
    })
    this.#child = child
    if (stderrLogPath) {
      const target = stderrLogPath
      child.stderr?.on('data', (chunk: Buffer) => {
        try {
          appendFileSync(target, `[${new Date().toISOString()}] ${this.#options.packageName}: ${String(chunk).slice(0, 4_000)}`)
        } catch {
          // Diagnostics must never break activation.
        }
      })
    }
    child.on('message', (message) => this.#onMessage(message))
    child.on('exit', (code, signal) => this.#onExit(code, signal))
    child.on('error', (error) => this.#fail(error))
    try {
      await this.#waitUntilReady()
      const descriptors = await this.#request('activate', { serviceClients: this.#options.serviceClients ?? [], dshToolGrants: this.#options.dshToolGrants ?? {}, dshConfig: this.#options.dshConfig ?? {}, dshStorage: this.#options.dshStorage, dshAgentResolver: this.#options.dshAgentResolver, packageName: this.#options.packageName })
      const snapshot = descriptors as { descriptors?: RemoteCapabilityDescriptor[]; revision?: number; diagnostics?: string[] }
      const diagnostics = [...snapshot.diagnostics ?? []]
      this.#capabilities = this.#validateDescriptors(Array.isArray(descriptors) ? descriptors : snapshot.descriptors ?? [], diagnostics, true)
      this.#snapshotRevision = snapshot.revision ?? 0
      this.#diagnostics = Object.freeze(diagnostics)
      this.#state = 'active'
      return this.snapshot
    } catch (error) {
      this.#state = 'failed'
      this.#error = error instanceof Error ? error.message : String(error)
      this.#terminate()
      throw new ProcessExtensionHostError('startup_failed', this.#error, { cause: error })
    }
  }

  async invoke(id: string, input: unknown, generation = this.#options.generation, signal?: AbortSignal, revision?: number, invocation?: DshInvocationContext, hostServices?: HostServiceInvocation): Promise<unknown> {
    hostServices?.assertCurrent?.()
    const serviceAdmission = hostServices === undefined ? undefined : {
      ...cloneInvocationSnapshot({ authority: hostServices.authority, services: hostServices.services }),
      ...(hostServices.assertCurrent ? { assertCurrent: hostServices.assertCurrent } : {}),
    }
    if (serviceAdmission && this.#options.isHostServiceCurrent?.() === false) {
      throw new ProcessExtensionHostError('stale_generation', 'Host service generation is not current.')
    }
    let snapshot: DshInvocationContext | undefined
    if (invocation !== undefined) {
      try {
        snapshot = cloneInvocationSnapshot(invocation)
      } catch (error) {
        throw new ProcessExtensionHostError('request_failed', 'Cross-process DSH invocation context is not lossless JSON.', { cause: error })
      }
      // Keep the schema's envelope/identity checks, but never dispatch its lossy
      // reconstructed data: authorization and IPC must share the original facts.
      if (!dshInvocationContextSchema.safeParse(snapshot).success) {
        throw new ProcessExtensionHostError('request_failed', 'Cross-process DSH invocation context is not lossless JSON.')
      }
    }
    this.#assertCurrent(generation)
    const current = this.#capabilities.find((descriptor) => descriptor.id === id)
    const expectedRevision = revision ?? current?.runtimeRevision
    if (revision !== undefined && current?.runtimeRevision !== revision) throw new ProcessExtensionHostError('stale_generation', 'Capability descriptor revision is stale.')
    const isDshTool = Array.isArray(current?.tags) && current.tags.includes('dsh-tool')
    if (isDshTool && (current?.effect !== 'compute' || current.scope !== 'global') && invocation === undefined && !(serviceAdmission?.assertCurrent && this.#options.serviceClients?.length)) {
      throw new ProcessExtensionHostError('request_failed', 'DSH ordinary Session invocation envelope is required.')
    }
    if (snapshot !== undefined) {
      if (!current || !Array.isArray(current.tags) || !current.tags.includes('dsh-tool')) {
        throw new ProcessExtensionHostError('request_failed', 'Invocation context is only supported for a DSH tool capability.')
      }
      const authorize = this.#options.authorizeDshTool
      if (authorize === undefined) {
        throw new ProcessExtensionHostError('request_failed', 'Host DSH tool authorization is unavailable.')
      }
      try {
        await authorize(Object.freeze({
          packageName: this.#options.packageName,
          version: this.#options.version,
          generation: this.#options.generation,
          capabilityId: id,
          effect: current.effect as DshToolEffect,
          caller: snapshot.caller,
          ordinarySession: snapshot.ordinarySession,
          context: snapshot.context,
        }))
      } catch (error) {
        throw new ProcessExtensionHostError('request_failed', error instanceof Error ? error.message : String(error), { cause: error })
      }
    }
    this.#assertCurrent(generation)
    return this.#request('invoke', { id, input, revision: expectedRevision, ...(snapshot ? { invocation: snapshot } : {}), ...(serviceAdmission ? { hostServices: true } : {}) }, signal, serviceAdmission)
  }

  async managedDiscover(generation = this.#options.generation): Promise<unknown> {
    this.#assertCurrent(generation)
    return this.#request('managed-discover')
  }

  async managedInvoke(operation: string, input?: unknown, generation = this.#options.generation): Promise<unknown> {
    this.#assertCurrent(generation)
    return this.#request('managed-invoke', { operation, input })
  }

  async workflowInvoke(operation: string, input?: unknown, generation = this.#options.generation): Promise<unknown> {
    this.#assertCurrent(generation)
    return this.#request('workflow-invoke', { operation, input })
  }

  async syntheticSession(input: unknown, generation = this.#options.generation): Promise<unknown> {
    this.#assertCurrent(generation)
    return this.#request('synthetic-session', input)
  }

  async rendererContributions(generation = this.#options.generation): Promise<unknown> {
    this.#assertCurrent(generation)
    return this.#request('renderer-contributions')
  }

  /**
   * Lists the workspace-preview slot contributions the plugin cached at
   * activation (gap-1b host-initiated preview channel). Governance layers 1
   * (contract slot allowlist) and 3 (workspace) are enforced by the Host
   * consumer before and after this call; the runtime binds identity (layer 2).
   */
  async workspacePreviewSlots(generation = this.#options.generation): Promise<unknown> {
    this.#assertCurrent(generation)
    return this.#request('preview-slots')
  }

  /**
   * One host-initiated workspace-preview provider call. The wire envelope is
   * schema-checked before dispatch; render-time calls use the 30s preview
   * budget instead of the default request timeout.
   */
  async workspacePreviewRequest(
    slotId: string,
    method: WorkspacePreviewMethod,
    workspaceRoot: string,
    input: unknown,
    generation = this.#options.generation
  ): Promise<unknown> {
    this.#assertCurrent(generation)
    if (!WORKSPACE_PREVIEW_METHODS.includes(method)) {
      throw new ProcessExtensionHostError('request_failed', `Workspace preview method ${String(method)} is not supported.`)
    }
    const envelope = workspacePreviewWireRequestSchema.safeParse({
      protocol: WORKSPACE_PREVIEW_PROTOCOL,
      requestId: randomUUID(),
      slotId,
      method,
      workspaceRoot,
      input: input ?? null
    })
    if (!envelope.success) {
      throw new ProcessExtensionHostError('request_failed', `Workspace preview request is malformed: ${envelope.error.message}`)
    }
    return this.#request('preview', envelope.data, undefined, undefined, this.#previewTimeoutMs)
  }

  async deactivate(): Promise<ProcessExtensionSnapshot> {
    if (this.#deactivation) return this.#deactivation
    // The child lifecycle and Host-provider lifecycle are independent. A crash
    // may have fenced the child while admitted providers still own real work.
    if ((this.#state !== 'active' && !this.#cleanupPending) || !this.#child?.connected) {
      this.revokeHostServices()
      await this.waitForServiceQuiescence()
      await this.#disposeHostServices()
      return this.snapshot
    }
    this.#cleanupPending = true
    this.#state = 'deactivating'
    for (const id of this.#serviceOwners.keys()) this.#closeServiceOwner(id)
    const attempt = (async () => {
      try {
        await this.#request('deactivate', {}, undefined, this.#options.serviceClients?.length ? { authority: { lifecycle: 'deactivate' }, services: this.#options.serviceClients.map(item => item.serviceId) } : undefined)
        await this.waitForServiceQuiescence()
        this.#cleanupPending = false
        this.#error = undefined
        this.#state = 'disabled'
        return this.snapshot
      } catch (error) {
        // Retain cleanup ownership, never execution permission: the child fence
        // stays closed even if rollback restores this generation as the owner.
        this.#state = 'failed'
        this.#error = error instanceof Error ? error.message : String(error)
        throw error
      }
    })()
    this.#deactivation = attempt
    try {
      return await attempt
    } finally {
      if (this.#deactivation === attempt) this.#deactivation = undefined
    }
  }

  async unregister(): Promise<ProcessExtensionSnapshot> {
    if (this.#state === 'active' || this.#state === 'disabled' || this.#state === 'deactivating') {
      await this.#request('unregister')
    }
    this.#capabilities = []
    return this.snapshot
  }

  async dispose(): Promise<ProcessExtensionSnapshot> {
    if (this.#state === 'disposed') return this.snapshot
    let failure: unknown
    let failed = false
    if (this.#state === 'active' || this.#cleanupPending) {
      try {
        await this.deactivate()
      } catch (error) {
        // Always tear down the process even when a plugin refuses to drain;
        // callers can still observe the failure after resources are released.
        failed = true
        failure = error
      }
    }
    try {
      await this.unregister()
    } catch (error) {
      failed = true
      failure ??= error
    }
    if (this.#child?.connected) await this.#request('dispose').catch((error) => { failed = true; failure ??= error })
    await this.waitForServiceQuiescence()
    let hostFailure = false
    try {
      await this.#disposeHostServices()
    } catch (error) {
      hostFailure = true
      failed = true
      failure ??= error
    }
    this.#state = hostFailure ? 'failed' : 'disposed'
    this.#terminate()
    if (failed) throw failure
    return this.snapshot
  }

  rejectStale(generation: number): void {
    this.#assertCurrent(generation)
  }

  async #disposeHostServices(): Promise<void> {
    if (!this.#options.hostServices || this.#hostServicesDisposed) return
    if (this.#hostServiceDisposal) return this.#hostServiceDisposal
    const attempt = this.#options.hostServices.dispose(Object.freeze({
      connectionId: this.#connectionId,
      pluginId: this.#options.pluginId,
      packageName: this.#options.packageName,
      version: this.#options.version,
      generation: this.#options.generation,
      invocationId: `${this.#connectionId}:dispose`,
      authority: Object.freeze({ lifecycle: 'dispose' }),
    }))
    this.#hostServiceDisposal = attempt
    try {
      await attempt
      this.#hostServicesDisposed = true
    } finally {
      if (!this.#hostServicesDisposed && this.#hostServiceDisposal === attempt) this.#hostServiceDisposal = undefined
    }
  }

  #assertCurrent(generation: number): void {
    if (generation !== this.#options.generation || this.#state !== 'active') {
      throw new ProcessExtensionHostError(
        'stale_generation',
        `Plugin ${this.#options.packageName} generation ${generation} is stale.`
      )
    }
  }

  async #waitUntilReady(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Extension process did not become ready.')), this.#timeoutMs())
      const onMessage = (message: unknown) => {
        if (!message || typeof message !== 'object' || (message as { type?: unknown }).type !== 'ready') return
        clearTimeout(timeout)
        this.#child?.off('message', onMessage)
        resolve()
      }
      this.#child?.on('message', onMessage)
      this.#child?.once('exit', () => {
        clearTimeout(timeout)
        reject(new Error('Extension process exited before readiness.'))
      })
    })
  }

  async #request(command: string, payload?: unknown, signal?: AbortSignal, serviceAdmission?: HostServiceInvocation, timeoutMs?: number): Promise<unknown> {
    const child = this.#child
    if (!child?.connected) throw new ProcessExtensionHostError('runtime_crashed', 'Extension process is not connected.')
    if (signal?.aborted) throw new ProcessExtensionHostError('request_cancelled', 'Extension request cancelled before dispatch.')
    const requestId = randomUUID()
    if (serviceAdmission) this.#serviceOwners.set(requestId, {
      owner: Object.freeze({ connectionId: this.#connectionId, pluginId: this.#options.pluginId,
        packageName: this.#options.packageName, version: this.#options.version, generation: this.#options.generation,
        invocationId: requestId, authority: serviceAdmission.authority }),
      services: serviceAdmission.services,
      assertCurrent: serviceAdmission.assertCurrent,
    })
    return new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', onAbort)
      const cancel = (error: ProcessExtensionHostError) => {
        const pending = this.#pending.get(requestId)
        if (!pending) return
        clearTimeout(pending.timer)
        cleanup()
        // Own terminal settlement before abort callbacks or late child replies.
        this.#pending.delete(requestId)
        this.#closeServiceOwner(requestId)
        // Legacy timeout is not explicit cancellation; preserve its child work.
        if ((serviceAdmission || error.code === 'request_cancelled') && child.connected) {
          child.send({ type: 'cancel', requestId }, () => undefined)
        }
        // Cancellation is a request, not proof the real provider has stopped.
        void (serviceAdmission
          ? this.#waitForServiceInvocationQuiescence(requestId)
          : Promise.resolve()
        ).then(() => reject(error))
      }
      const onAbort = () => cancel(new ProcessExtensionHostError('request_cancelled', 'Extension request explicitly cancelled.'))
      const timer = setTimeout(() => {
        cancel(new ProcessExtensionHostError('request_timeout', `Extension command ${command} timed out.`))
      }, timeoutMs ?? this.#timeoutMs(command))
      this.#pending.set(requestId, { resolve, reject, timer, cleanup })
      signal?.addEventListener('abort', onAbort, { once: true })
      child.send({ type: 'request', requestId, command, payload }, (error) => {
        if (!error) return
        this.#closeServiceOwner(requestId)
        clearTimeout(timer)
        cleanup()
        this.#pending.delete(requestId)
        reject(new ProcessExtensionHostError('request_failed', error.message, { cause: error }))
      })
    })
  }

  #onMessage(message: unknown): void {
    if (!message || typeof message !== 'object') return
    const response = message as { type?: string; requestId?: string; ok?: boolean; result?: unknown; error?: { message?: string; code?: string } }
    if (response.type === 'service-request') {
      this.#handleServiceRequest(message)
      return
    }
    if (response.type === 'service-cancel') {
      const task = response.requestId ? this.#serviceRequests.get(response.requestId) : undefined
      task?.controller.abort(new Error('Host service request cancelled.'))
      // The normal response is the cancellation ACK, sent only after actual settlement.
      return
    }
    if (response.type === 'capabilities' && this.#state === 'active') {
      const update = message as { generation?: number; revision?: number; descriptors?: RemoteCapabilityDescriptor[]; diagnostics?: string[] }
      if (update.generation !== this.#options.generation || !Array.isArray(update.descriptors)) return
      if (!Number.isSafeInteger(update.revision) || update.revision! <= this.#snapshotRevision) return
      this.#snapshotRevision = update.revision!
      const diagnostics = Array.isArray(update.diagnostics) ? update.diagnostics.filter((value) => typeof value === 'string') : []
      const descriptors = this.#validateDescriptors(update.descriptors, diagnostics, false)
      // Even unchanged official notifications must recheck mutable host grants.
      // ContributionHost retains identical authorized definitions during reconciliation.
      this.#diagnostics = Object.freeze(diagnostics)
      this.#capabilities = Object.freeze(descriptors)
      this.#options.onCapabilitiesChanged?.(this)
      return
    }
    if (response.type === 'crash') {
      this.#fail(new Error(response.error?.message ?? 'Extension process crashed.'))
      return
    }
    if (response.type === 'ports-request') {
      this.#handlePortsRequest(message as { requestId?: unknown; request?: unknown; boundWorkspace?: unknown })
      return
    }
    if (response.type === 'ports-cancel') {
      const cancel = this.#options.onPortsCancel
      if (cancel && typeof (message as { requestId?: unknown }).requestId === 'string') {
        Promise.resolve(cancel((message as { requestId: string }).requestId)).catch(() => undefined)
      }
      return
    }
    if (response.type !== 'response' || !response.requestId) return
    this.#closeServiceOwner(response.requestId)
    const pending = this.#pending.get(response.requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    pending.cleanup()
    this.#pending.delete(response.requestId)
    if (response.ok) pending.resolve(response.result)
    else {
      const hostError = new ProcessExtensionHostError('request_failed', response.error?.message ?? 'Extension request failed.')
      // Runner-side structured codes (e.g. workspace preview governance
      // denials) are preserved alongside the host-side request_failed code.
      const childCode = typeof response.error?.code === 'string' && response.error.code ? response.error.code : undefined
      if (childCode) (hostError as ProcessExtensionHostError & { childCode?: string }).childCode = childCode
      pending.reject(hostError)
    }
  }

  /** Actual provider settlement, not an abort request or child-process exit. */
  async waitForServiceQuiescence(): Promise<void> {
    while (this.#serviceRequests.size) await Promise.all([...this.#serviceRequests.values()].map((task) => task.settled))
  }

  async #waitForServiceInvocationQuiescence(invocationId: string): Promise<void> {
    while (true) {
      const tasks = [...this.#serviceRequests.values()].filter((task) => task.invocationId === invocationId)
      if (!tasks.length) return
      await Promise.all(tasks.map((task) => task.settled))
    }
  }

  /** Fence existing service owners synchronously at Host generation publication. */
  revokeHostServices(): void {
    for (const id of this.#serviceOwners.keys()) this.#closeServiceOwner(id)
  }

  #closeServiceOwner(invocationId: string): void {
    this.#serviceOwners.delete(invocationId)
    for (const task of this.#serviceRequests.values()) {
      if (task.invocationId === invocationId) task.controller.abort(new Error('Host invocation authority closed.'))
    }
  }

  #handleServiceRequest(message: unknown): void {
    const child = this.#child
    const respond = (requestId: string, result: HostPortsResult) => {
      if (child?.connected) child.send({ type: 'service-response', requestId, ...result }, () => undefined)
    }
    const rawId = (message as { requestId?: unknown }).requestId
    // Invalid duplicates must not manufacture settlement of an existing task.
    if (typeof rawId === 'string' && this.#seenServiceRequests.has(rawId)) return
    const schema = z.object({ type: z.literal('service-request'), requestId: z.string().uuid(),
      invocationId: z.string().uuid(), serviceId: z.string().min(1).max(256),
      operation: z.string().min(1).max(256), input: z.unknown() }).strict()
    const parsed = schema.safeParse(message)
    if (!parsed.success) {
      if (typeof rawId === 'string') respond(rawId, { ok: false, error: { code: 'invalid_request', message: 'Malformed Host service request.' } })
      return
    }
    const wire = parsed.data
    this.#seenServiceRequests.add(wire.requestId)
    const binding = this.#serviceOwners.get(wire.invocationId)
    const registry = this.#options.hostServices
    if (!binding || (this.#state !== 'active' && !(this.#state === 'deactivating' && binding.owner.authority.lifecycle === 'deactivate')) || (this.#options.isHostServiceCurrent?.() === false && binding.owner.authority.lifecycle !== 'deactivate') || !registry || !binding.services.includes(wire.serviceId)) {
      respond(wire.requestId, { ok: false, error: { code: 'service_denied', message: 'No live Host service invocation grant.' } })
      return
    }
    let input: unknown
    try { input = cloneInvocationSnapshot((message as { input: unknown }).input) } catch {
      respond(wire.requestId, { ok: false, error: { code: 'invalid_request', message: 'Host service input must be lossless JSON.' } })
      return
    }
    const controller = new AbortController()
    const request = Object.freeze({ requestId: wire.requestId, serviceId: wire.serviceId,
      operation: wire.operation, input, owner: binding.owner, signal: controller.signal,
      ...(binding.assertCurrent ? { assertCurrent: binding.assertCurrent } : {}) })
    const settled = Promise.resolve().then(() => registry.dispatch(request)).then((value) => {
      const snapshot = cloneInvocationSnapshot(value)
      respond(wire.requestId, controller.signal.aborted
        ? { ok: false, error: { code: 'cancelled', message: 'Host service settled after cancellation; effects may have occurred.' } }
        : { ok: true, value: snapshot })
    }).catch((error: unknown) => respond(wire.requestId, { ok: false, error: {
      code: controller.signal.aborted ? 'cancelled' : 'service_failed',
      message: error instanceof Error ? error.message : String(error),
    } })).finally(() => { this.#serviceRequests.delete(wire.requestId) })
    this.#serviceRequests.set(wire.requestId, { invocationId: wire.invocationId, controller, settled })
  }

  #handlePortsRequest(wire: { requestId?: unknown; request?: unknown; boundWorkspace?: unknown }): void {
    const child = this.#child
    const requestId = typeof wire.requestId === 'string' && wire.requestId.length > 0 ? wire.requestId : 'invalid'
    const respond = (result: HostPortsResult) => {
      if (child?.connected) child.send({ type: 'ports-response', requestId, ...result }, () => undefined)
    }
    const parsed = hostPortWireRequestSchema.safeParse(wire.request)
    if (!parsed.success) {
      respond({ ok: false, error: { code: 'invalid_request', message: 'Host ports request envelope is malformed.' } })
      return
    }
    const handler = this.#options.onPortsRequest
    if (!handler) {
      respond({ ok: false, error: { code: 'ports_unavailable', message: 'Host ports bridge is not available for this extension.' } })
      return
    }
    const boundWorkspace = typeof wire.boundWorkspace === 'string' && wire.boundWorkspace.length > 0 ? wire.boundWorkspace : undefined
    // Identity is bound to this connection here; a plugin-supplied identity is
    // never forwarded to Host authorization or execution.
    const request = Object.freeze({
      ...parsed.data,
      identity: Object.freeze({ pluginId: this.#options.packageName, version: this.#options.version })
    })
    Promise.resolve()
      .then(() => handler(request, boundWorkspace))
      .then((result) => respond(normalizeHostPortsResult(result)))
      .catch((error: unknown) => respond({
        ok: false,
        error: { code: 'execution_failed', message: error instanceof Error ? error.message : String(error) }
      }))
  }

  #validateDescriptors(descriptors: readonly RemoteCapabilityDescriptor[], diagnostics: string[], initial: boolean): readonly RemoteCapabilityDescriptor[] {
    const counts = new Map<string, number>()
    for (const descriptor of descriptors) counts.set(descriptor?.id, (counts.get(descriptor?.id) ?? 0) + 1)
    return Object.freeze(descriptors.filter((descriptor) => {
      try {
        if (!descriptor || typeof descriptor.id !== 'string' || counts.get(descriptor.id) !== 1) throw new Error('duplicate or invalid capability ID')
        z.json().parse(descriptor)
        // Native entrypoints keep their existing contract. DSH projections use
        // the same strict transport checks at activation and on every change.
        if (!initial || (Array.isArray(descriptor.tags) && descriptor.tags.includes('dsh-tool'))) {
          z.fromJSONSchema(descriptor.inputSchema as never)
          z.fromJSONSchema(descriptor.outputSchema as never)
          const validEffect = ['read', 'compute', 'workspace-write', 'external-write', 'destructive'].includes(descriptor.effect as string)
          const validScope = ['global', 'workspace', 'resource'].includes(descriptor.scope as string)
          if (!Number.isSafeInteger(descriptor.runtimeRevision) || (descriptor.runtimeRevision as number) <= 0 || !validScope || !validEffect || !Array.isArray(descriptor.tags) || !descriptor.tags.includes('dsh-tool')) throw new Error('invalid dynamic DSH effect descriptor')
        }
        return true
      } catch (error) {
        if (initial) throw error
        diagnostics.push(`Rejected invalid dynamic descriptor: ${error instanceof Error ? error.message : String(error)}`)
        return false
      }
    }))
  }

  #onExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#state !== 'disposed') {
      this.#state = 'failed'
      this.#error = `Extension process exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`
    }
    this.#capabilities = []
    this.#options.onCapabilitiesChanged?.(this)
    this.#rejectPending(new ProcessExtensionHostError('runtime_crashed', this.#error ?? 'Extension process exited.'))
    this.#child = undefined
  }

  #fail(error: Error): void {
    this.#state = 'failed'
    this.#error = error.message
    this.#capabilities = []
    this.#options.onCapabilitiesChanged?.(this)
    this.#rejectPending(new ProcessExtensionHostError('runtime_crashed', error.message, { cause: error }))
  }

  #rejectPending(error: Error): void {
    for (const id of this.#serviceOwners.keys()) this.#closeServiceOwner(id)
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.cleanup()
      pending.reject(error)
    }
    this.#pending.clear()
  }

  #terminate(): void {
    for (const id of this.#serviceOwners.keys()) this.#closeServiceOwner(id)
    const child = this.#child
    if (!child) return
    this.#child = undefined
    if (child.connected) child.disconnect()
    if (!child.killed) child.kill('SIGTERM')
  }

  #timeoutMs(command?: string): number {
    const businessInvocation = command === 'invoke' || command === 'managed-invoke' || command === 'workflow-invoke' || command === 'synthetic-session'
    return (businessInvocation ? this.#options.invokeTimeoutMs : undefined) ?? this.#options.timeoutMs ?? 5_000
  }
}

/** Atomic process-generation replacement with rollback to the previous runtime. */
export class ProcessExtensionHost {
  /** Trusted composition policy for aggregate business work; lifecycle stays on timeoutMs. */
  readonly #invokeTimeoutMs: number | undefined
  readonly #resolveHostServices?: (packageName: string, version: string, generation: number) => HostServiceProviderRegistry | undefined
  readonly #active = new Map<string, ProcessExtensionRuntime>()
  readonly #pending = new Map<string, ProcessExtensionRuntime>()
  readonly #preparing = new Map<string, { runtime: ProcessExtensionRuntime; cancelled: boolean; settled: Promise<void> }>()
  readonly #disposing = new Map<string, Promise<ProcessExtensionSnapshot | undefined>>()
  readonly #cleanupOwners = new Map<string, Set<ProcessExtensionRuntime>>()
  readonly #committedPrevious = new Map<string, ProcessExtensionRuntime>()
  readonly #generations = new Map<string, number>()
  readonly #onCapabilitiesChanged?: (runtime: ProcessExtensionRuntime) => void
  readonly #resolveDshToolGrants?: (packageName: string, version: string) => DshToolGrants
  readonly #resolveDshStorage?: (packageName: string, version: string) => DshStorageGrant | undefined
  readonly #resolveServiceClients?: (packageName: string, version: string, generation: number) => readonly import('./host-service-provider.js').HostServiceClientFactory[]
  readonly #resolveDshConfig?: (packageName: string, version: string) => Readonly<Record<string, unknown>>
  readonly #authorizeDshTool?: (request: DshToolAuthorizationRequest) => void | Promise<void>
  readonly #pluginRuntimeDeps?: Readonly<{ packages: readonly string[]; baseUrl: string }>
  readonly #pluginRuntimeEnv?: Readonly<Record<string, string>>
  /** Host-wide ordinary Agent resolver for plugin tool invocations. */
  readonly #dshAgentResolver?: Readonly<{ path: string }>

  constructor(options: Readonly<{ invokeTimeoutMs?: number; resolveServiceClients?: (packageName: string, version: string, generation: number) => readonly import('./host-service-provider.js').HostServiceClientFactory[]; hostServices?: HostServiceProviderRegistry; resolveHostServices?: (packageName: string, version: string, generation: number) => HostServiceProviderRegistry | undefined; onCapabilitiesChanged?: (runtime: ProcessExtensionRuntime) => void; resolveDshStorage?: (packageName: string, version: string) => DshStorageGrant | undefined; resolveDshToolGrants?: (packageName: string, version: string) => DshToolGrants; resolveDshConfig?: (packageName: string, version: string) => Readonly<Record<string, unknown>>; pluginRuntimeDeps?: Readonly<{ packages: readonly string[]; baseUrl: string }>; pluginRuntimeEnv?: Readonly<Record<string, string>>; dshAgentResolver?: Readonly<{ path: string }>; authorizeDshTool?: (request: DshToolAuthorizationRequest) => void | Promise<void> }> = {}) {
    this.#pluginRuntimeDeps = options.pluginRuntimeDeps
    this.#pluginRuntimeEnv = options.pluginRuntimeEnv
    this.#dshAgentResolver = options.dshAgentResolver
    this.#invokeTimeoutMs = validateTimeoutOption('invokeTimeoutMs', options.invokeTimeoutMs)
    this.#resolveHostServices = options.resolveHostServices ?? (options.hostServices ? () => options.hostServices : undefined)
    this.#resolveServiceClients = options.resolveServiceClients
    this.#onCapabilitiesChanged = options.onCapabilitiesChanged
    this.#resolveDshToolGrants = options.resolveDshToolGrants
    this.#resolveDshConfig = options.resolveDshConfig
    this.#resolveDshStorage = options.resolveDshStorage
    this.#authorizeDshTool = options.authorizeDshTool
  }

  snapshot(packageName: string): ProcessExtensionSnapshot | undefined {
    return this.#active.get(packageName)?.snapshot
  }

  runtime(packageName: string): ProcessExtensionRuntime | undefined {
    return this.#active.get(packageName)
  }

  /** The currently prepared (candidate) runtime for a plugin, if any. */
  pending(packageName: string): ProcessExtensionRuntime | undefined {
    return this.#pending.get(packageName)
  }

  async prepare(options: Omit<RuntimeOptions, 'generation'>): Promise<ProcessExtensionSnapshot> {
    if (this.#pending.has(options.packageName) || this.#preparing.has(options.packageName) || this.#disposing.has(options.packageName) || this.#cleanupOwners.has(options.packageName)) {
      throw new ProcessExtensionHostError('request_failed', `Plugin ${options.packageName} already has a preparing/prepared replacement or disposal in progress.`)
    }
    const dshStorage = this.#resolveDshStorage ? this.#resolveDshStorage(options.packageName, options.version) : options.dshStorage
    if ((dshStorage || this.#active.get(options.packageName)?.snapshot.privateStorage) &&
      (this.#active.has(options.packageName) || this.#committedPrevious.has(options.packageName))) {
      throw new ProcessExtensionHostError('request_failed', 'Private storage requires restart; an active generation must drain before another opens its medium.')
    }
    const requestedInvokeTimeoutMs = validateTimeoutOption('invokeTimeoutMs', options.invokeTimeoutMs)
    // Reserve every attempted owner generation before activation. Failed prepares
    // still consume their identity; reusing it can bind a retry to a disposed
    // domain service owner.
    const generation = (this.#generations.get(options.packageName) ?? 0) + 1
    this.#generations.set(options.packageName, generation)
    const candidate = new ProcessExtensionRuntime({ ...options, generation,
      invokeTimeoutMs: this.#invokeTimeoutMs === undefined
        ? requestedInvokeTimeoutMs
        : Math.min(this.#invokeTimeoutMs, requestedInvokeTimeoutMs ?? this.#invokeTimeoutMs),
      hostServices: this.#resolveHostServices?.(options.packageName, options.version, generation),
      isHostServiceCurrent: (): boolean => this.#active.get(options.packageName) === candidate,
      dshStorage,
      onCapabilitiesChanged: (runtime) => {
        if (this.#active.get(options.packageName) === runtime) this.#onCapabilitiesChanged?.(runtime)
      },
      serviceClients: this.#resolveServiceClients?.(options.packageName, options.version, generation) ?? options.serviceClients,
      dshConfig: this.#resolveDshConfig?.(options.packageName, options.version) ?? options.dshConfig,
      authorizeDshTool: this.#authorizeDshTool,
      dshAgentResolver: options.dshAgentResolver ?? this.#dshAgentResolver,
      dshToolGrants: this.#resolveDshToolGrants?.(options.packageName, options.version) ?? options.dshToolGrants,
      pluginRuntimeDeps: options.pluginRuntimeDeps ?? this.#pluginRuntimeDeps,
      pluginRuntimeEnv: options.pluginRuntimeEnv ?? this.#pluginRuntimeEnv })
    // Reserve ownership synchronously, before activation yields to another prepare.
    let settle!: () => void
    const preparing = { runtime: candidate, cancelled: false, settled: new Promise<void>((resolve) => { settle = resolve }) }
    this.#preparing.set(options.packageName, preparing)
    try {
      await candidate.activate()
      if (preparing.cancelled) throw new ProcessExtensionHostError('request_cancelled', 'Extension preparation was cancelled by disposal.')
      this.#pending.set(options.packageName, candidate)
      return candidate.snapshot
    } catch (error) {
      try {
        await candidate.dispose()
      } catch {
        const owned = this.#cleanupOwners.get(options.packageName) ?? new Set<ProcessExtensionRuntime>()
        owned.add(candidate)
        this.#cleanupOwners.set(options.packageName, owned)
      }
      throw error
    } finally {
      this.#preparing.delete(options.packageName)
      settle()
    }
  }

  async commit(packageName: string): Promise<ProcessExtensionSnapshot> {
    const candidate = this.#pending.get(packageName)
    if (!candidate) throw new ProcessExtensionHostError('request_failed', `Plugin ${packageName} has no prepared replacement.`)
    const previous = this.#active.get(packageName)
    previous?.revokeHostServices()
    this.#pending.delete(packageName)
    this.#active.set(packageName, candidate)
    this.#generations.set(packageName, candidate.snapshot.generation)
    if (previous) this.#committedPrevious.set(packageName, previous)
    this.#onCapabilitiesChanged?.(candidate)
    return candidate.snapshot
  }

  /** Finalize a committed replacement only after the host has finished its external registrations. */
  async finalizeCommit(packageName: string): Promise<ProcessExtensionSnapshot | undefined> {
    const previous = this.#committedPrevious.get(packageName)
    if (!previous) return this.#active.get(packageName)?.snapshot
    // Drain before disposing; failure retains the previous cleanup owner,
    // but rollback must preserve its failed, non-executable state.
    await previous.deactivate()
    await previous.dispose()
    this.#committedPrevious.delete(packageName)
    return this.#active.get(packageName)?.snapshot
  }

  /** Restore the previous generation after a post-commit failure. */
  async rollbackCommitted(packageName: string): Promise<ProcessExtensionSnapshot | undefined> {
    const previous = this.#committedPrevious.get(packageName)
    const candidate = this.#active.get(packageName)
    if (!previous || !candidate) return undefined
    candidate.revokeHostServices()
    this.#active.set(packageName, previous)
    this.#committedPrevious.delete(packageName)
    this.#onCapabilitiesChanged?.(previous)
    await candidate.dispose().catch(() => {
      const owned = this.#cleanupOwners.get(packageName) ?? new Set<ProcessExtensionRuntime>()
      owned.add(candidate)
      this.#cleanupOwners.set(packageName, owned)
      return undefined
    })
    return previous.snapshot
  }

  async rollbackPrepared(packageName: string): Promise<ProcessExtensionSnapshot | undefined> {
    return this.#withDisposal(packageName, async () => {
      const preparing = this.#preparing.get(packageName)
      if (preparing) {
        preparing.cancelled = true
        // Prepare owns activation and candidate cleanup; do not race its RPCs.
        await preparing.settled
      }
      const candidate = this.#pending.get(packageName)
      if (!candidate) return undefined
      this.#pending.delete(packageName)
      try {
        return await candidate.dispose()
      } catch (error) {
        const owned = this.#cleanupOwners.get(packageName) ?? new Set<ProcessExtensionRuntime>()
        owned.add(candidate)
        this.#cleanupOwners.set(packageName, owned)
        throw error
      }
    })
  }

  async replace(options: Omit<RuntimeOptions, 'generation'>): Promise<ProcessExtensionSnapshot> {
    await this.prepare(options)
    const snapshot = await this.commit(options.packageName)
    await this.finalizeCommit(options.packageName)
    return snapshot
  }

  /** Dispose every runtime owned by this host, independent of discovery visibility. */
  async disposeAll(): Promise<void> {
    const packageNames = new Set([...this.#active.keys(), ...this.#pending.keys(), ...this.#preparing.keys(), ...this.#disposing.keys(), ...this.#committedPrevious.keys(), ...this.#cleanupOwners.keys()])
    const results = await Promise.allSettled([...packageNames].map((packageName) => this.dispose(packageName)))
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }

  async dispose(packageName: string): Promise<ProcessExtensionSnapshot | undefined> {
    return this.#withDisposal(packageName, async () => {
      const preparing = this.#preparing.get(packageName)
      if (preparing) {
        preparing.cancelled = true
        // Let activation settle (or hit its timeout), then prepare tears down its
        // actual child before releasing ownership. Never race dispose RPC with activate.
        await preparing.settled
      }
      const runtime = this.#active.get(packageName)
      const owned = this.#cleanupOwners.get(packageName) ?? new Set<ProcessExtensionRuntime>()
      for (const item of [runtime, this.#pending.get(packageName), this.#committedPrevious.get(packageName)]) {
        if (item) owned.add(item)
      }
      // Retire execution admission, but keep cleanup ownership until each real
      // disposer succeeds. A rejected disposal must remain publicly retryable.
      this.#cleanupOwners.set(packageName, owned)
      for (const item of owned) item.revokeHostServices()
      this.#active.delete(packageName)
      this.#pending.delete(packageName)
      this.#committedPrevious.delete(packageName)
      const results = await Promise.allSettled([...owned].map(async (item) => {
        await item.dispose()
        owned.delete(item)
      }))
      if (!owned.size) this.#cleanupOwners.delete(packageName)
      const failure = results.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
      return runtime?.snapshot
    })
  }

  async #withDisposal(packageName: string, operation: () => Promise<ProcessExtensionSnapshot | undefined>): Promise<ProcessExtensionSnapshot | undefined> {
    const existing = this.#disposing.get(packageName)
    // Serialize teardown callers without letting an earlier rollback hide active
    // or committed-previous ownership from a later disposeAll.
    const disposal = existing ? existing.catch(() => undefined).then(operation) : operation()
    this.#disposing.set(packageName, disposal)
    try {
      return await disposal
    } finally {
      if (this.#disposing.get(packageName) === disposal) this.#disposing.delete(packageName)
    }
  }
}
