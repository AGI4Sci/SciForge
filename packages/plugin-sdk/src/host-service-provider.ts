/** Trusted runner-local factory. Its configuration is Host-owned, not plugin input. */
export type HostServiceClientFactory = Readonly<{
  serviceId: string
  modulePath: string
  exportName: string
  config: Readonly<Record<string, unknown>>
}>

export type HostServiceCancellation = Readonly<{
  /** Cancellation observed before provider settlement, not rollback of effects. */
  cancelled: boolean
  quiescent: boolean
}>

export type HostServiceHandle = Readonly<{
  requestId: string
  result: Promise<unknown>
  cancel: () => Promise<HostServiceCancellation>
}>

/** Runner-local client: there is deliberately no caller/scope/authority argument. */
export type HostServiceClient = Readonly<{
  request: (serviceId: string, operation: string, input: unknown) => HostServiceHandle
}>

/** Host-only facts. None of these fields are accepted as child authorization. */
export type HostServiceOwner = Readonly<{
  connectionId: string
  pluginId: string
  packageName: string
  version: string
  generation: number
  invocationId: string
  authority: Readonly<Record<string, unknown>>
}>

/** Supplied only by trusted Host invocation composition, never plugin config. */
export type HostServiceInvocation = Readonly<{
  authority: Readonly<Record<string, unknown>>
  services: readonly string[]
  /** Live Host lease; never cloned or sent to the runner. */
  assertCurrent?: () => void
}>

export type HostServiceRequest = Readonly<{
  requestId: string
  serviceId: string
  operation: string
  input: unknown
  owner: HostServiceOwner
  signal: AbortSignal
  assertCurrent?: () => void
}>

export type HostServiceProvider = Readonly<{
  /** Must authorize the Host-bound owner and the requested operation/input. */
  authorize: (request: HostServiceRequest) => void | Promise<void>
  /** Releases provider-owned resources when the extension child is gone or disposed. */
  dispose?: (owner: HostServiceOwner) => void | Promise<void>
  operations: Readonly<Record<string, (request: HostServiceRequest) => unknown | Promise<unknown>>>
}>

/** Immutable provider composition. No child registration or domain-specific routing. */
export class HostServiceProviderRegistry {
  readonly #providers: ReadonlyMap<string, HostServiceProvider>
  readonly #disposals = new Map<string, { done: Set<string>, inFlight: Map<string, Promise<void>> }>()

  constructor(providers: Readonly<Record<string, HostServiceProvider>>) {
    this.#providers = new Map(Object.entries(providers).map(([id, provider]) => {
      if (!id || id !== id.trim() || typeof provider.authorize !== 'function') throw new TypeError('Invalid Host service provider.')
      const operations = Object.freeze(Object.fromEntries(Object.entries(provider.operations).map(([operation, handler]) => {
        if (!operation || operation !== operation.trim() || typeof handler !== 'function') throw new TypeError('Invalid Host service operation.')
        return [operation, handler]
      })))
      return [id, Object.freeze({ authorize: provider.authorize, ...(provider.dispose ? { dispose: provider.dispose } : {}), operations })]
    }))
  }

  get serviceIds(): readonly string[] { return Object.freeze([...this.#providers.keys()]) }

  async dispose(owner: HostServiceOwner): Promise<void> {
    const key = `${owner.connectionId}\u0000${owner.pluginId}\u0000${owner.packageName}\u0000${owner.version}\u0000${owner.generation}`
    const state = this.#disposals.get(key) ?? { done: new Set<string>(), inFlight: new Map<string, Promise<void>>() }
    this.#disposals.set(key, state)
    let failed = false
    let firstFailure: unknown
    for (const [serviceId, provider] of this.#providers) {
      if (!provider.dispose || state.done.has(serviceId)) continue
      let attempt = state.inFlight.get(serviceId)
      if (!attempt) {
        attempt = Promise.resolve().then(() => provider.dispose!(owner)).then(() => undefined)
        state.inFlight.set(serviceId, attempt)
        attempt.finally(() => {
          if (state.inFlight.get(serviceId) === attempt) state.inFlight.delete(serviceId)
        }).catch(() => undefined)
      }
      try {
        await attempt
        state.done.add(serviceId)
      } catch (error) {
        failed = true
        if (firstFailure === undefined) firstFailure = error
      }
    }
    if (failed) throw firstFailure
  }

  async dispatch(request: HostServiceRequest): Promise<unknown> {
    const provider = this.#providers.get(request.serviceId)
    const handler = provider && Object.hasOwn(provider.operations, request.operation) ? provider.operations[request.operation] : undefined
    if (!provider || !handler) throw new Error('Host service or operation is unavailable.')
    request.assertCurrent?.()
    request.signal.throwIfAborted()
    await provider.authorize(request)
    // Cancellation during asynchronous authorization must not dispatch effects.
    request.signal.throwIfAborted()
    request.assertCurrent?.()
    const result = await handler(request)
    request.assertCurrent?.()
    return result
  }
}
