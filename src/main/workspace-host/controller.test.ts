import { describe, expect, it, vi } from 'vitest'
import { DOMAIN_PACKAGE_CONTRACT_VERSION } from '@sciforge/domain-sdk'
import {
  MAIN_WORKSPACE_HOST_PROVIDER_CONTRIBUTION_KIND,
  WORKSPACE_HOST_OPERATIONS,
  WORKSPACE_HOST_PROTOCOL_VERSION,
  type WorkspaceHostClient,
  type WorkspaceHostProvider,
  type WorkspaceHostSession
} from '@sciforge/domain-sdk/workspace-host'

import { DomainModuleCatalog } from '../modules/catalog'
import { WorkspaceHostProviderRegistry } from '../modules/workspace-host-contributions'
import { RemoteWorkspaceController } from './controller'
import { WorkspaceHostSessionManager } from './session-manager'

function attachedSession(): WorkspaceHostSession {
  return {
    protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
    serverVersion: '1.0.0',
    serverInstanceId: 'server-1',
    sessionId: 'session-1',
    lifecycleMode: 'persistent-daemon',
    locator: {
      contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      hostSessionId: 'session-1',
      path: '/cluster/project'
    },
    platform: { os: 'linux', architecture: 'x64' },
    capabilities: [
      WORKSPACE_HOST_OPERATIONS.directoryList,
      WORKSPACE_HOST_OPERATIONS.fileRead,
      WORKSPACE_HOST_OPERATIONS.processCreate,
      WORKSPACE_HOST_OPERATIONS.versionControlStatus,
      WORKSPACE_HOST_OPERATIONS.runtimeInvoke,
      WORKSPACE_HOST_OPERATIONS.previewInvoke
    ].map((operation) => ({
      operation,
      version: '1.0.0',
      maxRequestBytes: 1024,
      maxResponseBytes: 1024
    })),
    contributions: [],
    eventSequence: 0,
    replay: { earliestSequence: 0, latestSequence: 0 },
    egress: { mode: 'local', status: 'ready' }
  }
}

function controllerHarness() {
  const session = attachedSession()
  const client: WorkspaceHostClient = {
    getSession: () => session,
    request: vi.fn(async (_operation, payload) => payload) as WorkspaceHostClient['request'],
    subscribe: vi.fn(() => () => undefined),
    acknowledge: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => session),
    close: vi.fn(async () => undefined)
  }
  const provider: WorkspaceHostProvider = {
    attach: vi.fn(async () => client)
  }
  const catalog = new DomainModuleCatalog()
  catalog.registerModule({
    definition: {
      contractVersion: DOMAIN_PACKAGE_CONTRACT_VERSION,
      kind: 'trusted-compile-time',
      packageName: '@fixture/workspace-host',
      module: {
        id: 'fixture.workspace-host',
        displayName: 'Fixture Cluster',
        version: '1.0.0',
        hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
        priority: 1
      },
      entrypoints: [{
        process: 'main',
        export: './main',
        contributions: [{
          id: 'fixture.workspace-host.provider',
          kind: MAIN_WORKSPACE_HOST_PROVIDER_CONTRIBUTION_KIND,
          priority: 1
        }]
      }]
    },
    contributions: [{
      id: 'fixture.workspace-host.provider',
      kind: MAIN_WORKSPACE_HOST_PROVIDER_CONTRIBUTION_KIND,
      value: provider
    }]
  })
  const sessions = new WorkspaceHostSessionManager(
    new WorkspaceHostProviderRegistry(catalog),
    { wait: vi.fn(async () => undefined) }
  )
  return {
    client,
    provider,
    sessions,
    controller: new RemoteWorkspaceController(sessions, {
      now: () => new Date('2026-07-30T00:00:00.000Z')
    })
  }
}

describe('RemoteWorkspaceController', () => {
  it('lists only attached sessions and keeps authorization identities out of snapshots', async () => {
    const { controller, provider } = controllerHarness()
    expect(controller.list()).toEqual([])

    const snapshot = await controller.attach({
      providerId: 'fixture.workspace-host.provider',
      authorizedSessionId: 'authorized-session-secret'
    })

    expect(provider.attach).toHaveBeenCalledWith({
      authorizedSessionId: 'authorized-session-secret'
    }, expect.anything())
    expect(snapshot).toMatchObject({
      activeWorkspaceHostId: 'session-1',
      workspaces: [{
        workspaceHostId: 'session-1',
        displayLabel: 'Fixture Cluster',
        workspacePathLabel: '/cluster/project',
        lifecycleMode: 'persistent-daemon',
        phase: 'ready',
        selectedEgressRouteId: 'local',
        capabilities: {
          files: true,
          terminal: true,
          git: true,
          runtime: true,
          scientificPreview: true
        }
      }],
      updatedAt: '2026-07-30T00:00:00.000Z'
    })
    expect(JSON.stringify(snapshot)).not.toContain('authorized-session-secret')
  })

  it('selects, reconnects, and closes attached sessions by opaque session identity', async () => {
    const { controller, client } = controllerHarness()
    await controller.attach({
      providerId: 'fixture.workspace-host.provider',
      authorizedSessionId: 'authorized-session-1'
    })

    expect(controller.select({ sessionId: null })).not.toHaveProperty(
      'activeWorkspaceHostId'
    )
    expect(controller.select({ sessionId: 'session-1' }).activeWorkspaceHostId)
      .toBe('session-1')
    await controller.reconnect({ sessionId: 'session-1' })
    expect(client.reconnect).toHaveBeenCalledWith({
      lastAcknowledgedSequence: 0,
      signal: expect.any(AbortSignal)
    })
    const closed = await controller.close({ sessionId: 'session-1' })
    expect(closed.workspaces).toEqual([])
    expect(client.close).toHaveBeenCalled()
  })
})
