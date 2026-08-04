import { describe, expect, it, vi } from 'vitest'
import {
  prepareRemoteWorkspaceServerLifecycle
} from './workspace-server-lifecycle.js'
import type {
  RemoteWorkspaceServerDeploymentPlan,
  RemoteWorkspaceServerDeploymentTransport
} from './workspace-server-deployment.js'

const plan: RemoteWorkspaceServerDeploymentPlan = {
  installKey: '1.0.0-1-aabbccddeeff0011',
  installDirectory: '.sciforge/server/1.0.0-1-aabbccddeeff0011',
  entrypointPath: '.sciforge/server/1.0.0-1-aabbccddeeff0011/server',
  manifestPath: '.sciforge/server/1.0.0-1-aabbccddeeff0011/manifest.json',
  stagingDirectory: '.sciforge/server/.staging/unused'
}

describe('Remote Workspace server lifecycle', () => {
  it('reports a truthful connection-session fallback when daemon sockets are unsupported', async () => {
    const commands: string[] = []
    const transport = fakeTransport(async (script) => {
      commands.push(script)
      if (script.includes('printf')) return ok('/home/researcher\n')
      return ok(JSON.stringify({
        supported: false,
        reason: 'Unix socket path is too long.'
      }))
    })

    await expect(prepareRemoteWorkspaceServerLifecycle({
      transport,
      plan,
      workspaceRoot: '/cluster/project'
    })).resolves.toEqual({
      mode: 'connection-session',
      fallbackReason: 'Unix socket path is too long.'
    })
    expect(commands).toHaveLength(2)
    expect(commands[1]).toContain("'probe-daemon'")
  })

  it('starts and reuses the package daemon with one stable absolute runtime directory', async () => {
    const commands: string[] = []
    const transport = fakeTransport(async (script) => {
      commands.push(script)
      if (script.includes('printf')) return ok('/home/researcher\n')
      if (script.includes('probe-daemon')) return ok('{"supported":true}\n')
      return ok(JSON.stringify({
        sessionId: 'session-daemon',
        socketPath: '/home/researcher/.sciforge/runtime/workspace-a.sock',
        lifecycle: 'persistent-daemon',
        reused: true
      }))
    })

    await expect(prepareRemoteWorkspaceServerLifecycle({
      transport,
      plan,
      workspaceRoot: '/cluster/project'
    })).resolves.toEqual({
      mode: 'persistent-daemon',
      runtimeDirectory: '/home/researcher/.sciforge/runtime'
    })
    expect(commands).toHaveLength(3)
    expect(commands[1]).toContain("'probe-daemon'")
    expect(commands[2]).toContain("'start-daemon'")
    const runtimeArgs = commands.slice(1).map((script) => {
      const match = /--runtime-dir-base64' '([A-Za-z0-9_-]+)'/.exec(script)
      expect(match).not.toBeNull()
      return Buffer.from(match![1]!, 'base64url').toString('utf8')
    })
    expect(runtimeArgs).toEqual([
      '/home/researcher/.sciforge/runtime',
      '/home/researcher/.sciforge/runtime'
    ])
    expect(commands[2]).not.toContain('/cluster/project')
  })

  it('fails closed on malformed successful daemon output', async () => {
    const transport = fakeTransport(async (script) =>
      script.includes('printf') ? ok('/home/researcher\n') : ok('{}\n')
    )
    await expect(prepareRemoteWorkspaceServerLifecycle({
      transport,
      plan,
      workspaceRoot: '/cluster/project'
    })).rejects.toMatchObject({
      code: 'workspace_server_incompatible'
    })
  })
})

function fakeTransport(
  runCommand: RemoteWorkspaceServerDeploymentTransport['runCommand']
): RemoteWorkspaceServerDeploymentTransport {
  return {
    runCommand: vi.fn(runCommand),
    uploadFile: vi.fn(async () => ok(''))
  }
}

function ok(stdout: string) {
  return { exitCode: 0, stdout, stderr: '', timedOut: false }
}
