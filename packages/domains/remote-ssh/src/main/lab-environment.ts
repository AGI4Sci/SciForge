import type {
  RemoteSshLab,
  RemoteSshLabEnvironmentConfig,
  RemoteSshLabEnvironmentLocatorConfig,
  RemoteSshLabEnvironmentOpenConsoleResult,
  RemoteSshLabEnvironmentProvider as RemoteSshLabEnvironmentProviderId,
  RemoteSshLabEnvironmentResult
} from '../contract.js'

export type RemoteSshProxyEndpoint = Readonly<{
  host: '127.0.0.1'
  port: number
}>

export type RemoteSshProxyEndpointOptions = Readonly<{
  startIfStopped?: boolean
  signal?: AbortSignal
}>

export interface RemoteSshLabEnvironmentProvider {
  readonly provider: RemoteSshLabEnvironmentProviderId
  close(): void
  canonicalize(
    environment: RemoteSshLabEnvironmentLocatorConfig
  ): Promise<RemoteSshLabEnvironmentConfig>
  get(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentResult>
  ensure(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentResult>
  openConsole(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentOpenConsoleResult>
  stop(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentResult>
  remove(lab: RemoteSshLab): Promise<void>
  proxyEndpoint(
    lab: RemoteSshLab,
    options?: RemoteSshProxyEndpointOptions
  ): Promise<RemoteSshProxyEndpoint>
}

export interface RemoteSshLabEnvironmentManager {
  close(): void
  canonicalize(
    environment: RemoteSshLabEnvironmentLocatorConfig
  ): Promise<RemoteSshLabEnvironmentConfig>
  get(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentResult>
  ensure(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentResult>
  openConsole(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentOpenConsoleResult>
  stop(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentResult>
  remove(lab: RemoteSshLab): Promise<void>
  proxyEndpoint(
    lab: RemoteSshLab,
    options?: RemoteSshProxyEndpointOptions
  ): Promise<RemoteSshProxyEndpoint>
}

export class RoutingRemoteSshLabEnvironmentManager
implements RemoteSshLabEnvironmentManager {
  private readonly providers: ReadonlyMap<
    RemoteSshLabEnvironmentProviderId,
    RemoteSshLabEnvironmentProvider
  >
  private readonly labOperations = new Map<string, Promise<void>>()
  private closed = false

  constructor(providers: readonly RemoteSshLabEnvironmentProvider[]) {
    const indexed = new Map<
      RemoteSshLabEnvironmentProviderId,
      RemoteSshLabEnvironmentProvider
    >()
    for (const provider of providers) {
      if (indexed.has(provider.provider)) {
        throw new Error(
          `Duplicate Remote SSH lab environment provider: ${provider.provider}`
        )
      }
      indexed.set(provider.provider, provider)
    }
    this.providers = indexed
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const provider of this.providers.values()) provider.close()
    this.labOperations.clear()
  }

  canonicalize(
    environment: RemoteSshLabEnvironmentLocatorConfig
  ): Promise<RemoteSshLabEnvironmentConfig> {
    if (this.closed) {
      return Promise.reject(new Error('Remote SSH lab environment manager is closed.'))
    }
    return this.providerForEnvironment(environment).canonicalize(environment)
  }

  get(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentResult> {
    return this.runSerial(lab, (provider) => provider.get(lab))
  }

  ensure(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentResult> {
    return this.runSerial(lab, (provider) => provider.ensure(lab))
  }

  openConsole(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentOpenConsoleResult> {
    return this.runSerial(lab, (provider) => provider.openConsole(lab))
  }

  stop(lab: RemoteSshLab): Promise<RemoteSshLabEnvironmentResult> {
    return this.runSerial(lab, (provider) => provider.stop(lab))
  }

  remove(lab: RemoteSshLab): Promise<void> {
    return this.runSerial(lab, (provider) => provider.remove(lab))
  }

  proxyEndpoint(
    lab: RemoteSshLab,
    options?: RemoteSshProxyEndpointOptions
  ): Promise<RemoteSshProxyEndpoint> {
    return this.runSerial(lab, (provider) => provider.proxyEndpoint(lab, options))
  }

  private providerFor(lab: RemoteSshLab): RemoteSshLabEnvironmentProvider {
    return this.providerForEnvironment(lab.environment, lab.id)
  }

  private providerForEnvironment(
    environment: RemoteSshLabEnvironmentLocatorConfig,
    labId?: string
  ): RemoteSshLabEnvironmentProvider {
    const providerId = environment.provider
    const provider = this.providers.get(providerId)
    if (!provider) {
      throw new Error(
        labId
          ? `Remote SSH lab ${labId} requires unavailable environment provider: ${providerId}`
          : `Remote SSH configuration requires unavailable environment provider: ${providerId}`
      )
    }
    return provider
  }

  private runSerial<Value>(
    lab: RemoteSshLab,
    operation: (provider: RemoteSshLabEnvironmentProvider) => Promise<Value>
  ): Promise<Value> {
    if (this.closed) {
      return Promise.reject(new Error('Remote SSH lab environment manager is closed.'))
    }
    const previous = this.labOperations.get(lab.id) ?? Promise.resolve()
    const current = previous
      .catch(() => undefined)
      .then(() => {
        if (this.closed) {
          throw new Error('Remote SSH lab environment manager is closed.')
        }
        return operation(this.providerFor(lab))
      })
    const tracked = current.then(
      () => undefined,
      () => undefined
    ).finally(() => {
      if (this.labOperations.get(lab.id) === tracked) {
        this.labOperations.delete(lab.id)
      }
    })
    this.labOperations.set(lab.id, tracked)
    return current
  }
}
