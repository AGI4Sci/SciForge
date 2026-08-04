import {
  workspaceHostModelAccessLeaseSchema,
  workspaceHostModelAccessLeaseStateSchema,
  type WorkspaceHostModelAccessProvider
} from '@sciforge/domain-sdk/workspace-host'
import type {
  WorkspaceModelRouterBridgeLeaseProvider
} from '@sciforge/workspace-egress'

import {
  getModelAccessSettings,
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1
} from '../../shared/app-settings'

type MaybePromise<Value> = Value | Promise<Value>

export type ApplicationWorkspaceModelAccessProviderOptions = Readonly<{
  loadSettings(): MaybePromise<AppSettingsV1>
  bridge: WorkspaceModelRouterBridgeLeaseProvider
}>

/**
 * Converts Desktop-owned Model Router settings into short-lived,
 * workspace-scoped bridge leases. Static runtime keys never cross the public
 * Workspace Host provider boundary.
 */
export function createApplicationWorkspaceModelAccessProvider(
  options: ApplicationWorkspaceModelAccessProviderOptions
): WorkspaceHostModelAccessProvider {
  return Object.freeze({
    acquire: async (input) => {
      const settings = await options.loadSettings()
      if (getModelAccessSettings(settings)?.mode !== 'api') return null

      const router = resolveRuntimeModelRouterSettings(settings)
      if (
        !router.baseUrl.trim() ||
        !router.apiKey.trim() ||
        !router.model.trim()
      ) return null

      const lease = await options.bridge.acquireModelRouterBridge({
        workspaceId: input.workspaceId,
        upstreamBaseUrl: router.baseUrl.trim(),
        runtimeKey: router.apiKey.trim(),
        ...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs })
      }, input.signal ? { routeSignal: input.signal } : undefined)

      return workspaceHostModelAccessLeaseSchema.parse({
        leaseId: lease.leaseId,
        workspaceId: lease.workspaceId,
        endpoint: {
          protocol: lease.endpoint.protocol,
          host: lease.endpoint.host,
          port: lease.endpoint.port,
          basePath: lease.endpoint.basePath
        },
        authorization: {
          scheme: lease.authorization.scheme,
          token: lease.authorization.token
        },
        issuedAt: lease.issuedAt,
        expiresAt: lease.expiresAt
      })
    },
    heartbeat: async (input) => {
      const state = await options.bridge.heartbeatModelRouterBridge(input)
      return workspaceHostModelAccessLeaseStateSchema.parse({
        workspaceId: state.workspaceId,
        leaseId: state.leaseId,
        expiresAt: state.expiresAt
      })
    },
    revoke: (input) => options.bridge.revokeModelRouterBridge(input)
  })
}
