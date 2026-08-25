import { once } from 'node:events'
import type { Server } from 'node:http'

import { createCollaborationHttpServer, type ProviderDirectory } from './api.js'
import { AuthenticationService, StrictOidcUserResolver } from './auth.js'
import { IdentityService } from './identity-service.js'
import { isCollaborationDatabaseReady } from './migrations.js'
import { OidcAccessTokenVerifier } from './oidc.js'
import { PostgresCollaborationRepository, type SqlPool } from './postgres.js'
import type { CollaborationProviderRuntime, ProviderRuntimeAuthentication } from './provider-runtime.js'
import type { CollaborationRepository } from './repository.js'
import { CollaborationService } from './service.js'
import { CollaborationWebSocketHub } from './websocket.js'

export type CollaborationServerOidcConfiguration = Readonly<{
  issuer: string
  audience?: string
  allowedAuthorizedParties?: readonly string[]
  allowInsecureLoopback?: boolean
  requestTimeoutMs?: number
  maxResponseBytes?: number
  defaultCacheTtlMs?: number
  maxCacheTtlMs?: number
  unknownKidRefreshCooldownMs?: number
  clockToleranceSeconds?: number
}>

export type CollaborationServerRuntimeOptions = {
  pool: SqlPool
  host: string
  port: number
  basePath?: string
  allowedOrigins?: readonly string[]
  oidc?: CollaborationServerOidcConfiguration
  providers?: ProviderDirectory
  providerRuntimeFactory?: (context: Readonly<{
    repository: CollaborationRepository
    service: CollaborationService
    providerIdentityResolver: ProviderRuntimeAuthentication
  }>) => Promise<CollaborationProviderRuntime>
  now?: () => Date
}

export type CollaborationServerRuntime = {
  readonly service: CollaborationService
  readonly identities: IdentityService
  readonly httpServer: Server
  start(): Promise<{ host: string; port: number }>
  stop(): Promise<void>
}

export function createCollaborationServerRuntime(options: CollaborationServerRuntimeOptions): CollaborationServerRuntime {
  if (options.providers && options.providerRuntimeFactory) {
    throw new Error('Configure either a provider directory or a provider runtime factory, not both.')
  }
  const repository = new PostgresCollaborationRepository(options.pool)
  const webSocketHub = new CollaborationWebSocketHub()
  const service = new CollaborationService({ repository, notifier: webSocketHub, now: options.now })
  const identities = new IdentityService(repository, options.now)
  const oidc = options.oidc
    ? new StrictOidcUserResolver(new OidcAccessTokenVerifier({ ...options.oidc, now: options.now }), identities)
    : undefined
  const authentication = new AuthenticationService(repository, options.now, oidc)
  let providerRuntime: CollaborationProviderRuntime | undefined
  const providerDirectory: ProviderDirectory | undefined = options.providerRuntimeFactory
    ? {
        contracts: () => providerRuntime?.contracts() ?? [],
        listLocators: async (input) => {
          if (!providerRuntime) throw new Error('Provider runtime has not started.')
          return providerRuntime.listLocators(input)
        }
      }
    : options.providers
  const httpServer = createCollaborationHttpServer({ service, authentication, identities,
    readiness: () => isCollaborationDatabaseReady(options.pool), providers: providerDirectory,
    basePath: options.basePath })
  webSocketHub.attach(httpServer, { authentication, basePath: options.basePath,
    allowedOrigins: options.allowedOrigins, now: options.now })
  let started = false
  let stopped = false
  let starting: Promise<{ host: string; port: number }> | undefined
  return {
    service,
    identities,
    httpServer,
    async start() {
      if (stopped) throw new Error('Collaboration server runtime was already stopped.')
      starting ??= (async () => {
        if (options.providerRuntimeFactory && !providerRuntime) {
          providerRuntime = await options.providerRuntimeFactory({
            repository,
            service,
            providerIdentityResolver: authentication
          })
          await providerRuntime.start()
        }
        if (!started) {
          httpServer.listen(options.port, options.host)
          await once(httpServer, 'listening')
          started = true
        }
        const address = httpServer.address()
        if (!address || typeof address === 'string') throw new Error('Collaboration server did not expose a TCP address.')
        return { host: options.host, port: address.port }
      })()
      return starting
    },
    async stop() {
      if (stopped) return
      stopped = true
      if (started) {
        const closed = once(httpServer, 'close')
        httpServer.close()
        await providerRuntime?.stop()
        await webSocketHub.close()
        await closed
      } else {
        await providerRuntime?.stop()
        await webSocketHub.close()
      }
      await repository.close()
    }
  }
}
