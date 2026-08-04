import { describe, expect, it, vi } from 'vitest'
import type { RemoteSshTargetHandle } from '../contract.js'
import {
  normalizedRemoteWorkspaceRoot,
  openRemoteSshWorkspace,
  parseRemoteWorkspaceEgressAllowlist,
  type RemoteSshWorkspaceEgressRequest
} from './remote-workspace-flow.js'

const workspaceResource: RemoteSshTargetHandle = {
  token: 'cap_workspace_1234567890abcdefghij',
  semanticRevision: 'workspace-target-r1',
  expiresAt: '2026-07-31T00:00:00.000Z'
}

const egressResource: RemoteSshTargetHandle = {
  token: 'cap_egress_1234567890abcdefghijkl',
  semanticRevision: 'egress-target-r1',
  expiresAt: '2026-07-31T00:00:00.000Z'
}

const confirmation = {
  approval: { mode: 'confirmation' as const }
}

const allowlist = {
  rules: [{ host: 'api.example.org', ports: [443, 8_443] }]
}

describe('Remote SSH workspace opening flow', () => {
  it('accepts only bounded absolute normalized POSIX roots', () => {
    expect(normalizedRemoteWorkspaceRoot(' /cluster/project ')).toBe('/cluster/project')
    expect(normalizedRemoteWorkspaceRoot('/')).toBe('/')
    for (const invalid of [
      '',
      'cluster/project',
      '/cluster//project',
      '/cluster/./project',
      '/cluster/../project',
      String.raw`C:\cluster\project`,
      `/${'a'.repeat(4_096)}`
    ]) {
      expect(normalizedRemoteWorkspaceRoot(invalid)).toBeNull()
    }
  })

  it('parses explicit canonical egress destinations and rejects broad or ambiguous rules', () => {
    expect(parseRemoteWorkspaceEgressAllowlist([
      'api.example.org:443,8443',
      '10.20.30.40:443'
    ].join('\n'))).toEqual({
      rules: [
        { host: 'api.example.org', ports: [443, 8_443] },
        { host: '10.20.30.40', ports: [443] }
      ]
    })
    for (const invalid of [
      '',
      '*.example.org:443',
      'API.example.org:443',
      'https://api.example.org:443',
      'api.example.org',
      'api.example.org:0',
      'api.example.org:65536',
      'api.example.org:443,443',
      'api.example.org:443\napi.example.org:8443'
    ]) {
      expect(parseRemoteWorkspaceEgressAllowlist(invalid)).toBeNull()
    }
  })

  it.each([
    ['none', { mode: 'none' }],
    ['local', { mode: 'local', allowlist }]
  ] as const satisfies ReadonlyArray<readonly [string, RemoteSshWorkspaceEgressRequest]>)(
    'authorizes and opens a workspace with %s egress without creating a CPU egress session',
    async (mode, egress) => {
      const openEgressSession = vi.fn()
      const openWorkspaceHostSession = vi.fn(async () => ({
        providerId: 'remote-ssh.workspace-host-provider' as const,
        authorizedSessionId: 'ssh_whs_123456789012345678901234'
      }))
      const openRemoteSession = vi.fn(async () => undefined)

      const result = await openRemoteSshWorkspace({
        capabilityClient: {
          openEgressSession,
          openWorkspaceHostSession
        },
        workspaceId: '/local/workspace',
        workspaceTargetId: 'gpu-a',
        workspaceTargetResource: workspaceResource,
        workspaceRoot: ' /cluster/project ',
        egress,
        confirmation,
        openRemoteSession
      })

      expect(openEgressSession).not.toHaveBeenCalled()
      expect(openWorkspaceHostSession).toHaveBeenCalledWith(
        workspaceResource,
        {
          workspaceRoot: '/cluster/project',
          egress
        },
        '/local/workspace',
        confirmation
      )
      expect(openRemoteSession).toHaveBeenCalledWith({
        providerId: 'remote-ssh.workspace-host-provider',
        authorizedSessionId: 'ssh_whs_123456789012345678901234'
      })
      expect(result).toEqual({
        targetId: 'gpu-a',
        workspaceRoot: '/cluster/project',
        egressMode: egress.mode
      })
    }
  )

  it('authorizes the CPU egress first and retains no opaque authorization identity', async () => {
    const calls: string[] = []
    const openEgressSession = vi.fn(async () => {
      calls.push('authorize-egress')
      return {
        authorizedSessionId: 'ssh_egs_123456789012345678901234',
        expiresAt: '2026-07-31T00:00:00.000Z'
      }
    })
    const openWorkspaceHostSession = vi.fn(async () => {
      calls.push('authorize-workspace')
      return {
        providerId: 'remote-ssh.workspace-host-provider' as const,
        authorizedSessionId: 'ssh_whs_123456789012345678901234'
      }
    })
    const openRemoteSession = vi.fn(async () => {
      calls.push('open-host')
    })

    const result = await openRemoteSshWorkspace({
      capabilityClient: {
        openEgressSession,
        openWorkspaceHostSession
      },
      workspaceId: '/local/workspace',
      workspaceTargetId: 'gpu-a',
      workspaceTargetResource: workspaceResource,
      workspaceRoot: '/cluster/project',
      egress: {
        mode: 'remote-target',
        targetId: 'cpu-egress',
        resource: egressResource,
        allowlist
      },
      confirmation,
      openRemoteSession
    })

    expect(calls).toEqual(['authorize-egress', 'authorize-workspace', 'open-host'])
    expect(openEgressSession).toHaveBeenCalledWith(
      egressResource,
      '/local/workspace',
      confirmation
    )
    expect(openWorkspaceHostSession).toHaveBeenCalledWith(
      workspaceResource,
      {
        workspaceRoot: '/cluster/project',
        egress: {
          mode: 'remote-target',
          authorizedSessionId: 'ssh_egs_123456789012345678901234',
          allowlist
        }
      },
      '/local/workspace',
      confirmation
    )
    expect(JSON.stringify(result)).not.toMatch(
      /ssh_(?:egs|whs)_|alias|endpoint|credential|token/iu
    )
  })

  it('rejects using the workspace target as its own remote egress before authorization', async () => {
    const openEgressSession = vi.fn()
    const openWorkspaceHostSession = vi.fn()

    await expect(openRemoteSshWorkspace({
      capabilityClient: {
        openEgressSession,
        openWorkspaceHostSession
      },
      workspaceId: '/local/workspace',
      workspaceTargetId: 'gpu-a',
      workspaceTargetResource: workspaceResource,
      workspaceRoot: '/cluster/project',
      egress: {
        mode: 'remote-target',
        targetId: 'gpu-a',
        resource: workspaceResource,
        allowlist
      },
      confirmation,
      openRemoteSession: vi.fn()
    })).rejects.toThrow('another authorized target')

    expect(openEgressSession).not.toHaveBeenCalled()
    expect(openWorkspaceHostSession).not.toHaveBeenCalled()
  })
})
