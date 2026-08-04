import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import {
  createRemoteWorkspaceServerDeploymentPlan,
  deploymentUploadTimeoutMilliseconds,
  ensureRemoteWorkspaceServerDeployed,
  parseRemoteWorkspaceServerPlatform,
  RemoteWorkspaceSshError,
  verifyRemoteWorkspaceServerArtifact,
  type RemoteWorkspaceServerArtifact,
  type RemoteWorkspaceServerArtifactManifest,
  type RemoteWorkspaceServerDeploymentTransport
} from './workspace-server-deployment.js'

describe('Remote Workspace server deployment', () => {
  it('accepts only Linux x64 probes', () => {
    expect(parseRemoteWorkspaceServerPlatform('Linux\nx86_64\n')).toEqual({
      platform: 'linux',
      arch: 'x64'
    })
    expect(() => parseRemoteWorkspaceServerPlatform('Linux\naarch64\n'))
      .toThrowError(expect.objectContaining({
        code: 'workspace_server_platform_unsupported'
      }))
    expect(() => parseRemoteWorkspaceServerPlatform('Darwin\nx86_64\n'))
      .toThrow(RemoteWorkspaceSshError)
  })

  it('scales large artifact upload deadlines for slow VPN links', () => {
    expect(deploymentUploadTimeoutMilliseconds(1_024)).toBe(5 * 60_000)
    expect(deploymentUploadTimeoutMilliseconds(311 * 1_024 * 1_024))
      .toBeGreaterThan(30 * 60_000)
    expect(deploymentUploadTimeoutMilliseconds(Number.MAX_SAFE_INTEGER))
      .toBe(2 * 60 * 60_000)
  })

  it('verifies local file size and digest before producing a versioned plan', async () => {
    const artifact = await createArtifact()
    await expect(verifyRemoteWorkspaceServerArtifact(artifact)).resolves.toEqual(artifact.manifest)

    const plan = createRemoteWorkspaceServerDeploymentPlan(artifact.manifest, '12345678')
    expect(plan.installDirectory).toMatch(
      /^\.sciforge\/server\/1\.2\.3-1-[a-f0-9]{16}$/
    )
    expect(plan.entrypointPath).toBe(`${plan.installDirectory}/workspace-host`)
    expect(plan.stagingDirectory).toBe(
      `.sciforge/server/.staging/${plan.installKey}-12345678`
    )

    await writeFile(join(artifact.directory, 'workspace-host'), 'tampered', 'utf8')
    await expect(verifyRemoteWorkspaceServerArtifact(artifact)).rejects.toMatchObject({
      code: 'workspace_server_artifact_invalid'
    })
  })

  it('probes, uploads, remotely verifies digests, and atomically installs', async () => {
    const artifact = await createArtifact()
    const commands: string[] = []
    const uploads: Array<{ localPath: string; remotePath: string }> = []
    const transport: RemoteWorkspaceServerDeploymentTransport = {
      runCommand: vi.fn(async (script) => {
        commands.push(script)
        return {
          exitCode: 0,
          stdout: script.startsWith('uname')
            ? 'Linux\nx86_64\n'
            : script.includes('codex/bin/codex')
              ? 'codex-cli 0.146.0\n'
              : '',
          stderr: '',
          timedOut: false
        }
      }),
      uploadFile: vi.fn(async (localPath, remotePath) => {
        uploads.push({ localPath, remotePath })
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
      })
    }

    const plan = await ensureRemoteWorkspaceServerDeployed({ artifact, transport })

    expect(uploads.map(({ remotePath }) => remotePath)).toEqual([
      `${plan.stagingDirectory}/workspace-host`,
      `${plan.stagingDirectory}/server.mjs`,
      `${plan.stagingDirectory}/codex/bin/codex`,
      `${plan.stagingDirectory}/manifest.json`
    ])
    expect(commands).toHaveLength(5)
    expect(commands[2]).toContain(`${plan.stagingDirectory}/codex/bin`)
    expect(commands[3]).toContain(artifact.manifest.files[0]!.sha256)
    expect(commands[3]).toContain(
      `chmod 700 "$HOME/${plan.stagingDirectory}/codex/bin/codex"`
    )
    expect(commands[3]).toContain(
      `chmod 600 "$HOME/${plan.stagingDirectory}/server.mjs"`
    )
    expect(commands[3]).toContain(`mv "$HOME/${plan.stagingDirectory}"`)
    expect(commands[4]).toContain(
      `exec "$HOME/${plan.installDirectory}/codex/bin/codex" '--version'`
    )
    expect(commands.join('\n')).not.toContain(artifact.directory)
  })

  it('reuses a verified cohort without uploads and reinstalls a damaged cohort', async () => {
    const artifact = await createArtifact()
    let installed = false
    const uploads: string[] = []
    const transport: RemoteWorkspaceServerDeploymentTransport = {
      runCommand: vi.fn(async (script) => {
        if (script.startsWith('uname')) {
          return { exitCode: 0, stdout: 'Linux\nx86_64\n', stderr: '', timedOut: false }
        }
        if (script.includes('SCIFORGE_WORKSPACE_HOST_INSTALLED')) {
          return installed
            ? {
                exitCode: 0,
                stdout: 'SCIFORGE_WORKSPACE_HOST_INSTALLED\n',
                stderr: '',
                timedOut: false
              }
            : { exitCode: 1, stdout: '', stderr: '', timedOut: false }
        }
        if (script.includes('.replaced')) installed = true
        if (script.includes('codex/bin/codex')) {
          return {
            exitCode: 0,
            stdout: 'codex-cli 0.146.0\n',
            stderr: '',
            timedOut: false
          }
        }
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
      }),
      uploadFile: vi.fn(async (_localPath, remotePath) => {
        uploads.push(remotePath)
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
      })
    }

    await ensureRemoteWorkspaceServerDeployed({ artifact, transport })
    expect(uploads).toHaveLength(4)

    await ensureRemoteWorkspaceServerDeployed({ artifact, transport })
    expect(uploads).toHaveLength(4)

    installed = false
    await ensureRemoteWorkspaceServerDeployed({ artifact, transport })
    expect(uploads).toHaveLength(8)
  })

  it('fails stably when the installed runtime cohort is incompatible', async () => {
    const artifact = await createArtifact()
    const transport: RemoteWorkspaceServerDeploymentTransport = {
      runCommand: vi.fn(async (script) => ({
        exitCode: 0,
        stdout: script.startsWith('uname')
          ? 'Linux\nx86_64\n'
          : script.includes('codex/bin/codex')
            ? 'codex-cli 0.145.0\n'
            : '',
        stderr: '',
        timedOut: false
      })),
      uploadFile: vi.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false
      }))
    }

    await expect(ensureRemoteWorkspaceServerDeployed({ artifact, transport }))
      .rejects.toMatchObject({
        code: 'workspace_server_incompatible',
        retryable: false,
        message: 'Workspace server runtime is unavailable or incompatible: codex.'
      })
  })
})

async function createArtifact(): Promise<RemoteWorkspaceServerArtifact> {
  const directory = await mkdtemp(join(tmpdir(), 'remote-workspace-server-'))
  const wrapper = '#!/bin/sh\nexec "$(dirname "$0")/runtime/node" "$(dirname "$0")/server.mjs" "$@"\n'
  const wrapperBuffer = Buffer.from(wrapper)
  const serverBuffer = Buffer.from('export const server = true\n')
  const codex = '#!/bin/sh\nprintf "codex-cli 0.146.0\\\\n"\n'
  const codexBuffer = Buffer.from(codex)
  await mkdir(join(directory, 'codex/bin'), { recursive: true })
  await writeFile(join(directory, 'workspace-host'), wrapperBuffer)
  await writeFile(join(directory, 'server.mjs'), serverBuffer)
  await writeFile(join(directory, 'codex/bin/codex'), codexBuffer)
  await chmod(join(directory, 'workspace-host'), 0o700)
  await chmod(join(directory, 'codex/bin/codex'), 0o700)
  const manifest: RemoteWorkspaceServerArtifactManifest = {
    schemaVersion: 1,
    protocolVersion: 1,
    serverVersion: '1.2.3',
    platform: 'linux',
    arch: 'x64',
    runtime: 'bundled-node@22.18.0',
    entrypoint: 'workspace-host',
    contributions: [],
    files: [{
      path: 'workspace-host',
      sha256: createHash('sha256').update(wrapperBuffer).digest('hex'),
      sizeBytes: wrapperBuffer.byteLength,
      executable: true
    }, {
      path: 'server.mjs',
      sha256: createHash('sha256').update(serverBuffer).digest('hex'),
      sizeBytes: serverBuffer.byteLength,
      executable: false
    }, {
      path: 'codex/bin/codex',
      sha256: createHash('sha256').update(codexBuffer).digest('hex'),
      sizeBytes: codexBuffer.byteLength,
      executable: true
    }],
    readinessProbes: [{
      id: 'codex',
      executablePath: 'codex/bin/codex',
      arguments: ['--version'],
      expectedStdout: 'codex-cli 0.146.0'
    }]
  }
  const manifestPath = join(directory, 'manifest.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8')
  return { directory, manifest }
}
