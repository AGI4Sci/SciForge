import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  WORKSPACE_HOST_ARTIFACT_ENTRYPOINT,
  WORKSPACE_HOST_ARTIFACT_NODE_EXECUTABLE,
  WORKSPACE_HOST_ARTIFACT_SERVER_MODULE,
  WORKSPACE_HOST_CODEX_EXECUTABLE,
  buildWorkspaceHostArtifactManifest,
  requireWorkspaceHostBundledCodexExecutable,
  stageWorkspaceHostCodexCohort,
  stageWorkspaceHostNodeRuntime,
  verifyWorkspaceHostArtifact
} from './artifact.js'

describe('Workspace Host artifact manifest', () => {
  it('builds and verifies deterministic file digests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sciforge-host-artifact-'))
    try {
      const entrypoint = join(directory, WORKSPACE_HOST_ARTIFACT_ENTRYPOINT)
      const serverModule = join(directory, WORKSPACE_HOST_ARTIFACT_SERVER_MODULE)
      await writeFile(entrypoint, '#!/bin/sh\nexit 0\n')
      await chmod(entrypoint, 0o700)
      await writeFile(serverModule, 'export {}\n')
      await chmod(serverModule, 0o600)
      const manifest = await buildWorkspaceHostArtifactManifest(directory, {
        files: [{
          path: WORKSPACE_HOST_ARTIFACT_ENTRYPOINT,
          executable: true
        }, {
          path: WORKSPACE_HOST_ARTIFACT_SERVER_MODULE,
          executable: false
        }]
      })
      assert.equal(manifest.entrypoint, WORKSPACE_HOST_ARTIFACT_ENTRYPOINT)
      assert.equal(manifest.protocolVersion, 1)
      assert.equal(manifest.runtime, 'bundled-node@22.18.0')
      assert.equal(manifest.files[0]?.executable, true)
      assert.equal(manifest.files[1]?.executable, false)
      await verifyWorkspaceHostArtifact({ directory, manifest })

      await writeFile(entrypoint, 'tampered')
      await assert.rejects(
        verifyWorkspaceHostArtifact({ directory, manifest }),
        /mismatch/
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('stages only the fixed executable Linux x64 Node runtime and license', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-host-node-runtime-'))
    const packageDirectory = join(root, 'package')
    const artifactDirectory = join(root, 'artifact')
    try {
      await mkdir(join(packageDirectory, 'bin'), { recursive: true })
      await mkdir(artifactDirectory, { recursive: true })
      await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({
        name: 'node-linux-x64',
        version: 'v22.18.0'
      }))
      await writeFile(join(packageDirectory, 'LICENSE'), 'Node license\n')
      const elf = Buffer.alloc(64)
      elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1])
      elf.writeUInt16LE(0x3e, 18)
      await writeFile(join(packageDirectory, 'bin/node'), elf)
      await chmod(join(packageDirectory, 'bin/node'), 0o600)

      const files = await stageWorkspaceHostNodeRuntime(
        packageDirectory,
        artifactDirectory
      )
      assert.deepEqual(files, [{
        path: 'runtime/node',
        executable: true
      }, {
        path: 'runtime/LICENSE',
        executable: false
      }])
      if (process.platform !== 'win32') {
        assert.equal(
          (await statMode(join(
            artifactDirectory,
            WORKSPACE_HOST_ARTIFACT_NODE_EXECUTABLE
          ))),
          0o700
        )
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('stages the complete fixed official Codex cohort and requires its absolute executable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-host-codex-cohort-'))
    const packageDirectory = join(root, 'package')
    const artifactDirectory = join(root, 'artifact')
    try {
      const vendorDirectory = join(
        packageDirectory,
        'vendor/x86_64-unknown-linux-musl'
      )
      await mkdir(join(vendorDirectory, 'bin'), { recursive: true })
      await mkdir(join(vendorDirectory, 'codex-path'), { recursive: true })
      await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({
        name: '@openai/codex',
        version: '0.146.0-linux-x64',
        license: 'Apache-2.0'
      }))
      await writeFile(join(packageDirectory, 'README.md'), 'Codex\n')
      const licensePath = join(root, 'codex-LICENSE')
      await writeFile(licensePath, 'Apache License\nVersion 2.0\n')
      await writeFile(join(vendorDirectory, 'bin/codex'), 'codex')
      await writeFile(
        join(vendorDirectory, 'bin/codex-code-mode-host'),
        'code mode'
      )
      await writeFile(join(vendorDirectory, 'codex-path/rg'), 'rg')
      await writeFile(join(vendorDirectory, 'codex-package.json'), '{}')
      await chmod(join(vendorDirectory, 'bin/codex'), 0o600)
      await chmod(join(vendorDirectory, 'bin/codex-code-mode-host'), 0o600)
      await chmod(join(vendorDirectory, 'codex-path/rg'), 0o600)
      await mkdir(artifactDirectory, { recursive: true })
      await writeFile(
        join(artifactDirectory, WORKSPACE_HOST_ARTIFACT_ENTRYPOINT),
        '#!/usr/bin/env node\n'
      )
      await chmod(
        join(artifactDirectory, WORKSPACE_HOST_ARTIFACT_ENTRYPOINT),
        0o700
      )

      const codexFiles = await stageWorkspaceHostCodexCohort(
        packageDirectory,
        licensePath,
        artifactDirectory
      )
      assert.deepEqual(codexFiles.map((file) => file.path), [
        'codex/bin/codex',
        'codex/bin/codex-code-mode-host',
        'codex/codex-package.json',
        'codex/codex-path/rg',
        'codex/LICENSE',
        'codex/package.json',
        'codex/README.md'
      ])
      assert.equal(
        await requireWorkspaceHostBundledCodexExecutable(artifactDirectory),
        join(artifactDirectory, WORKSPACE_HOST_CODEX_EXECUTABLE)
      )

      const manifest = await buildWorkspaceHostArtifactManifest(
        artifactDirectory,
        {
          files: [{
            path: WORKSPACE_HOST_ARTIFACT_ENTRYPOINT,
            executable: true
          }, ...codexFiles],
          readinessProbes: [{
            id: 'codex',
            executablePath: WORKSPACE_HOST_CODEX_EXECUTABLE,
            arguments: ['--version'],
            expectedStdout: 'codex-cli 0.146.0'
          }]
        }
      )
      assert.equal(
        manifest.files.find((file) =>
          file.path === WORKSPACE_HOST_CODEX_EXECUTABLE
        )?.executable,
        true
      )
      await verifyWorkspaceHostArtifact({
        directory: artifactDirectory,
        manifest
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

async function statMode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777
}
