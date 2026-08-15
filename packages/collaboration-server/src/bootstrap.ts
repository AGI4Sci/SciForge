import { once } from 'node:events'
import type { Server } from 'node:http'

import { createCollaborationHttpServer, type ProviderDirectory } from './api.js'
import { AuthenticationService } from './auth.js'
import { isCollaborationDatabaseReady } from './migrations.js'
import { PostgresCollaborationRepository, type SqlPool } from './postgres.js'
import type { CollaborationProviderRuntime } from './provider-runtime.js'
import type { CollaborationRepository } from './repository.js'
import { CollaborationService } from './service.js'
import { CollaborationWebSocketHub } from './websocket.js'

export type CollaborationServerRuntimeOptions = {
  pool: SqlPool
  host: string
  port: number
  basePath?: string
  allowedOrigins?: readonly string[]
  providers?: ProviderDirectory
  providerRuntimeFactory?: (context: Readonly<{
    repository: CollaborationRepository
    service: CollaborationService
    authentication: AuthenticationService
  }>) => Promise<CollaborationProviderRuntime>
  now?: () => Date
}

export type CollaborationServerRuntime = {
  readonly service: CollaborationService
  readonly authentication: AuthenticationService
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
  const authentication = new AuthenticationService(repository, options.now)
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
  const httpServer = createCollaborationHttpServer({ service, authentication,
    readiness: () => isCollaborationDatabaseReady(options.pool), providers: providerDirectory,
    basePath: options.basePath, now: options.now })
  webSocketHub.attach(httpServer, { authentication, basePath: options.basePath,
    allowedOrigins: options.allowedOrigins, now: options.now })
  let started = false
  let stopped = false
  let starting: Promise<{ host: string; port: number }> | undefined
  return {
    service,
    authentication,
    httpServer,
    async start() {
      if (stopped) throw new Error('Collaboration server runtime was already stopped.')
      starting ??= (async () => {
        if (options.providerRuntimeFactory && !providerRuntime) {
          providerRuntime = await options.providerRuntimeFactory({ repository, service, authentication })
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
