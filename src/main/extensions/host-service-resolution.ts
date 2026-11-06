import {
  resolvePluginAdapterContract,
  type HostServiceClientFactory,
  type HostServiceProvider,
  type PluginAdapterContract
} from '@sciforge/plugin-sdk'

export type HostServiceResolution = Readonly<{
  resolveHostServiceProviders(packageName: string, version: string, generation: number): Readonly<Record<string, HostServiceProvider>> | undefined
  resolveHostServiceClients(packageName: string, version: string, generation: number): readonly HostServiceClientFactory[]
  hostServiceIds: readonly string[]
}>

type HostServiceResolver = Readonly<{
  resolve(packageName: string, version: string, generation: number): Readonly<Record<string, HostServiceProvider>> | undefined
  resolveClients(packageName: string, version: string, generation: number): readonly HostServiceClientFactory[]
  serviceIds: readonly string[]
}>

/** Keep every service for an identity; duplicate providers/clients fail closed. */
export function mergeHostServiceResolutions(...inputs: readonly (HostServiceResolution | HostServiceResolver)[]): HostServiceResolution {
  const resolutions = inputs.map(input => 'resolve' in input ? {
    resolveHostServiceProviders: input.resolve.bind(input),
    resolveHostServiceClients: input.resolveClients.bind(input),
    hostServiceIds: input.serviceIds
  } : input)
  return Object.freeze({
    resolveHostServiceProviders(packageName: string, version: string, generation: number) {
      const providers: Record<string, HostServiceProvider> = Object.create(null)
      for (const resolution of resolutions) {
        for (const [serviceId, provider] of Object.entries(resolution.resolveHostServiceProviders(packageName, version, generation) ?? {})) {
          if (Object.hasOwn(providers, serviceId)) throw new Error(`Conflicting Host service provider: ${serviceId}.`)
          providers[serviceId] = provider
        }
      }
      return Object.keys(providers).length ? Object.freeze(providers) : undefined
    },
    resolveHostServiceClients(packageName: string, version: string, generation: number) {
      const clients = new Map<string, HostServiceClientFactory>()
      for (const resolution of resolutions) {
        for (const client of resolution.resolveHostServiceClients(packageName, version, generation)) {
          if (clients.has(client.serviceId)) throw new Error(`Conflicting Host service client: ${client.serviceId}.`)
          clients.set(client.serviceId, client)
        }
      }
      return Object.freeze([...clients.values()])
    },
    hostServiceIds: Object.freeze([...new Set(resolutions.flatMap(resolution => resolution.hostServiceIds))])
  })
}

/** Re-read the corresponding Host contract view on every call, including revocation. */
export function createReadGrantedHostServicePorts(
  readContracts: () => ReadonlyMap<string, PluginAdapterContract> | undefined
): (identity: Readonly<{ packageName: string; version: string }>) => readonly string[] | undefined {
  return ({ packageName, version }) => {
    const contract = resolvePluginAdapterContract(readContracts(), packageName, version)
    const authorization = contract?.dshAuthorization
    if (contract?.approved !== true || authorization?.packageName !== packageName || authorization.packageVersion !== version) return undefined
    // Generation is authenticated by the Runtime Host request's authority lease,
    // not a second counter in the package/version approval contract.
    return authorization.ports
  }
}
