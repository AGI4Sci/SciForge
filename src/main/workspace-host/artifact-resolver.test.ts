import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_HOST_ARTIFACT_ENTRYPOINT,
  WORKSPACE_HOST_ARTIFACT_MANIFEST_NAME,
  resolveWorkspaceHostArtifactDirectory
} from '@sciforge/workspace-host/artifact'

import {
  resolveApplicationWorkspaceHostArtifact,
  resolveApplicationWorkspaceHostArtifactBaseDirectory
} from './artifact-resolver'

describe('resolveApplicationWorkspaceHostArtifact', () => {
  it('resolves source and packaged artifact bases without domain-private paths', () => {
    expect(resolveApplicationWorkspaceHostArtifactBaseDirectory({
      isPackaged: false,
      appPath: '/workspace/SciForge',
      resourcesPath: '/Applications/SciForge.app/Contents/Resources'
    })).toBe(resolve(
      '/workspace/SciForge/packages/workers/workspace-host/artifacts'
    ))
    expect(resolveApplicationWorkspaceHostArtifactBaseDirectory({
      isPackaged: true,
      appPath: '/Applications/SciForge.app/Contents/Resources/app.asar',
      resourcesPath: '/Applications/SciForge.app/Contents/Resources'
    })).toBe(resolve('/Applications/SciForge.app/Contents/Resources'))
  })

  it('uses the public artifact resolver and verifies every declared file', async () => {
    const baseDirectory = await mkdtemp(join(tmpdir(), 'sciforge-workspace-host-artifact-'))
    const directory = resolveWorkspaceHostArtifactDirectory(baseDirectory)
    await mkdir(directory, { recursive: true })
    const content = Buffer.from('console.log("workspace host")\n')
    await writeFile(join(directory, WORKSPACE_HOST_ARTIFACT_ENTRYPOINT), content)
    await chmod(join(directory, WORKSPACE_HOST_ARTIFACT_ENTRYPOINT), 0o700)
    const manifest = {
      schemaVersion: 1,
      protocolVersion: 1,
      serverVersion: '1.0.0',
      platform: 'linux',
      arch: 'x64',
      runtime: 'bundled-node@22.18.0',
      entrypoint: WORKSPACE_HOST_ARTIFACT_ENTRYPOINT,
      files: [{
        path: WORKSPACE_HOST_ARTIFACT_ENTRYPOINT,
        sha256: createHash('sha256').update(content).digest('hex'),
        sizeBytes: content.byteLength,
        executable: true
      }],
      readinessProbes: []
    }
    await writeFile(
      join(directory, WORKSPACE_HOST_ARTIFACT_MANIFEST_NAME),
      JSON.stringify(manifest)
    )

    await expect(resolveApplicationWorkspaceHostArtifact({ baseDirectory }))
      .resolves.toEqual({
        directory,
        manifest: {
          ...manifest,
          contributions: []
        }
      })
  })

  it('fails closed when artifact integrity does not match', async () => {
    const baseDirectory = await mkdtemp(join(tmpdir(), 'sciforge-workspace-host-invalid-'))
    const directory = resolveWorkspaceHostArtifactDirectory(baseDirectory)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, WORKSPACE_HOST_ARTIFACT_ENTRYPOINT), 'invalid')
    await chmod(join(directory, WORKSPACE_HOST_ARTIFACT_ENTRYPOINT), 0o700)
    await writeFile(
      join(directory, WORKSPACE_HOST_ARTIFACT_MANIFEST_NAME),
      JSON.stringify({
        schemaVersion: 1,
        protocolVersion: 1,
        serverVersion: '1.0.0',
        platform: 'linux',
        arch: 'x64',
        runtime: 'bundled-node@22.18.0',
        entrypoint: WORKSPACE_HOST_ARTIFACT_ENTRYPOINT,
        files: [{
          path: WORKSPACE_HOST_ARTIFACT_ENTRYPOINT,
          sha256: '0'.repeat(64),
          sizeBytes: 7,
          executable: true
        }],
        readinessProbes: []
      })
    )

    await expect(resolveApplicationWorkspaceHostArtifact({ baseDirectory }))
      .rejects.toThrow(/digest mismatch/u)
  })
})
