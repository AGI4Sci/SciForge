import { describe, expect, it, vi } from 'vitest'
import {
  WorkspaceEgressService,
  type WorkspaceModelRouterBridgeLease,
  type WorkspaceModelRouterBridgeLeaseProvider
} from '@sciforge/workspace-egress'

import type { AppSettingsV1 } from '../../shared/app-settings'
import { createApplicationWorkspaceModelAccessProvider } from './model-access'

const WORKSPACE_ID = 'ssh_whs_authorized_workspace'
const LEASE_TOKEN = 'sciforge-workspace-model-token-0123456789'

function settings(
  mode: 'api' | 'coding-plan' | undefined,
  overrides: Readonly<{
    baseUrl?: string
    runtimeApiKey?: string
    publicModelAlias?: string
  }> = {}
): AppSettingsV1 {
  return {
    ...(mode
      ? { modelAccess: { mode, planAdapterId: mode === 'coding-plan' ? 'codex' : '' } }
      : {}),
    modelRouter: {
      baseUrl: overrides.baseUrl ?? 'http://127.0.0.1:3892/v1',
      runtimeApiKey: overrides.runtimeApiKey ?? 'desktop-static-runtime-key',
      publicModelAlias: overrides.publicModelAlias ?? 'sciforge-router'
    }
  } as AppSettingsV1
}

function bridge(): WorkspaceModelRouterBridgeLeaseProvider {
  const acquireModelRouterBridge:
    WorkspaceModelRouterBridgeLeaseProvider['acquireModelRouterBridge'] = vi.fn(
      async ({ workspaceId }): Promise<WorkspaceModelRouterBridgeLease> => ({
        protocol: 'sciforge.workspace-model-router-bridge.v1',
        leaseId: 'lease-1',
        workspaceId,
        endpoint: {
          protocol: 'http',
          host: '127.0.0.1',
          port: 41_001,
          basePath: '/v1'
        },
        authorization: {
          scheme: 'bearer',
          token: LEASE_TOKEN
        },
        issuedAt: '2026-07-30T00:00:00.000Z',
        expiresAt: '2026-07-30T00:01:00.000Z'
      })
    )
  return {
    acquireModelRouterBridge,
    heartbeatModelRouterBridge: vi.fn(async ({ workspaceId, leaseId }) => ({
      workspaceId,
      leaseId,
      expiresAt: '2026-07-30T00:02:00.000Z'
    })),
    revokeModelRouterBridge: vi.fn()
  }
}

describe('application Workspace Host model access', () => {
  it('mints a scoped bridge lease while keeping the Desktop runtime key private', async () => {
    const modelRouterBridge = bridge()
    const routeController = new AbortController()
    const provider = createApplicationWorkspaceModelAccessProvider({
      loadSettings: () => settings('api'),
      bridge: modelRouterBridge
    })

    const lease = await provider.acquire({
      workspaceId: WORKSPACE_ID,
      ttlMs: 30_000,
      signal: routeController.signal
    })

    expect(modelRouterBridge.acquireModelRouterBridge).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      upstreamBaseUrl: 'http://127.0.0.1:3892/v1',
      runtimeKey: 'desktop-static-runtime-key',
      ttlMs: 30_000
    }, {
      routeSignal: routeController.signal
    })
    expect(lease).toEqual({
      leaseId: 'lease-1',
      workspaceId: WORKSPACE_ID,
      endpoint: {
        protocol: 'http',
        host: '127.0.0.1',
        port: 41_001,
        basePath: '/v1'
      },
      authorization: {
        scheme: 'bearer',
        token: LEASE_TOKEN
      },
      issuedAt: '2026-07-30T00:00:00.000Z',
      expiresAt: '2026-07-30T00:01:00.000Z'
    })
    expect(JSON.stringify(lease)).not.toContain('desktop-static-runtime-key')
    expect(lease).not.toHaveProperty('protocol')
  })

  it.each([
    ['missing mode', settings(undefined)],
    ['Coding Plan', settings('coding-plan')],
    ['missing runtime key', settings('api', { runtimeApiKey: '' })]
  ])('fails closed for %s', async (_label, current) => {
    const modelRouterBridge = bridge()
    const provider = createApplicationWorkspaceModelAccessProvider({
      loadSettings: () => current,
      bridge: modelRouterBridge
    })

    await expect(provider.acquire({
      workspaceId: WORKSPACE_ID
    })).resolves.toBeNull()
    expect(modelRouterBridge.acquireModelRouterBridge).not.toHaveBeenCalled()
  })

  it('maps heartbeat and revoke without reading settings or widening credentials', async () => {
    const modelRouterBridge = bridge()
    const loadSettings = vi.fn(() => settings('api'))
    const provider = createApplicationWorkspaceModelAccessProvider({
      loadSettings,
      bridge: modelRouterBridge
    })
    const input = {
      workspaceId: WORKSPACE_ID,
      leaseId: 'lease-1',
      token: LEASE_TOKEN
    }

    await expect(provider.heartbeat({
      ...input,
      ttlMs: 45_000
    })).resolves.toEqual({
      workspaceId: WORKSPACE_ID,
      leaseId: 'lease-1',
      expiresAt: '2026-07-30T00:02:00.000Z'
    })
    await provider.revoke(input)

    expect(modelRouterBridge.heartbeatModelRouterBridge).toHaveBeenCalledWith({
      ...input,
      ttlMs: 45_000
    })
    expect(modelRouterBridge.revokeModelRouterBridge).toHaveBeenCalledWith(input)
    expect(loadSettings).not.toHaveBeenCalled()
  })

  it('revokes the production bridge lease when its owning Workspace Host route closes', async () => {
    const service = new WorkspaceEgressService({
      routeResolver: {
        resolve: () => {
          throw new Error('General egress is unavailable in this composition.')
        }
      },
      modelRouterBridgeProbe: async () => true
    })
    const routeController = new AbortController()
    const provider = createApplicationWorkspaceModelAccessProvider({
      loadSettings: () => settings('api'),
      bridge: service
    })
    try {
      const lease = await provider.acquire({
        workspaceId: WORKSPACE_ID,
        signal: routeController.signal
      })
      if (!lease) throw new Error('expected a Model Router bridge lease')

      routeController.abort('Workspace Host session closed.')

      await expect(provider.heartbeat({
        workspaceId: lease.workspaceId,
        leaseId: lease.leaseId,
        token: lease.authorization.token
      })).rejects.toMatchObject({
        code: 'route_unavailable',
        retryable: true
      })
    } finally {
      await service.close()
    }
  })
})
