import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type {
  WorkspacePreviewFileState,
  WorkspacePreviewModality,
  WorkspacePreviewProvider,
  WorkspacePreviewSession
} from '@sciforge/domain-sdk/workspace-preview'
import type { DomainWorkspaceServerHost } from '@sciforge/domain-sdk/workspace-server'
import { describe, expect, it } from 'vitest'
import {
  LIFE_SCIENCE_WORKSPACE_PREVIEW_MANIFESTS_BY_PLUGIN_ID
} from '../contract.js'
import {
  LIFE_SCIENCE_PREVIEW_TEXT_READ_LIMIT_BYTES
} from '../backend/providers.js'
import { createDomainMainEntry } from '../main/index.js'
import { createDomainWorkspaceServerEntry } from './index.js'

const mainHost = {
  getUserDataDir: () => '/tmp/sciforge-life-science-preview-workspace-server-test',
  defineCapability: (value: unknown) => value
} satisfies DomainMainHost

const workspaceServerHost = {
  log: () => undefined
} satisfies DomainWorkspaceServerHost

describe('Life Science Preview workspace-server entry', () => {
  it('publishes provider parity with the local main process from the same canonical contracts', () => {
    const main = createDomainMainEntry(mainHost)
    const remote = createDomainWorkspaceServerEntry(workspaceServerHost)

    expect(remote.contributions.map(({ id }) => id))
      .toEqual(main.contributions.map(({ id }) => id))
    expect(remote.contributions.map(({ contract }) => contract))
      .toEqual(main.contributions.map(({ contract }) => contract))

    for (const [index, contribution] of remote.contributions.entries()) {
      const localValue = providerValue(main.contributions[index]?.value)
      const remoteValue = providerValue(contribution.value)
      expect(remoteValue.manifest).toBe(localValue.manifest)
      expect(remoteValue.provider.pluginId).toBe(localValue.provider.pluginId)
      expect(providerOperations(remoteValue.provider)).toEqual(
        providerOperations(localValue.provider)
      )
    }
  })

  it('returns the same bounded sequence observation from main and workspace-server providers', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-life-preview-remote-parity-'))
    const path = join(workspaceRoot, 'sequence.fasta')
    const source = ['>sequence-1', 'ACGTACGTACGT'].join('\n')

    try {
      await writeFile(path, source, 'utf8')
      const manifest = LIFE_SCIENCE_WORKSPACE_PREVIEW_MANIFESTS_BY_PLUGIN_ID['sequence-genomics']
      const file: WorkspacePreviewFileState = {
        workspaceRoot,
        path,
        relativePath: 'sequence.fasta',
        size: Buffer.byteLength(source)
      }
      const input = {
        manifest,
        file,
        session: createSession(manifest.id, manifest.modality, file)
      }
      const main = createDomainMainEntry(mainHost)
      const remote = createDomainWorkspaceServerEntry(workspaceServerHost)
      const localProvider = providerFor(main.contributions, 'sequence-genomics')
      const remoteProvider = providerFor(remote.contributions, 'sequence-genomics')

      const [localObservation, remoteObservation] = await Promise.all([
        localProvider.observe?.(input),
        remoteProvider.observe?.(input)
      ])

      expect(remoteObservation).toEqual(localObservation)
      expect(remoteObservation).toMatchObject({
        ok: true,
        bytesRead: Buffer.byteLength(source),
        truncated: false
      })
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('reads only the bounded prefix of a large remote scientific source', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-life-preview-remote-bounds-'))
    const path = join(workspaceRoot, 'large.fasta')
    const source = `>large\n${'A'.repeat(LIFE_SCIENCE_PREVIEW_TEXT_READ_LIMIT_BYTES + 256)}`

    try {
      await writeFile(path, source, 'utf8')
      const manifest = LIFE_SCIENCE_WORKSPACE_PREVIEW_MANIFESTS_BY_PLUGIN_ID['sequence-genomics']
      const file: WorkspacePreviewFileState = {
        workspaceRoot,
        path,
        relativePath: 'large.fasta',
        size: Buffer.byteLength(source)
      }
      const remote = createDomainWorkspaceServerEntry(workspaceServerHost)
      const provider = providerFor(remote.contributions, manifest.id)
      const observation = await provider.observe?.({
        manifest,
        file,
        session: createSession(manifest.id, manifest.modality, file)
      })

      expect(observation).toMatchObject({
        ok: true,
        bytesRead: LIFE_SCIENCE_PREVIEW_TEXT_READ_LIMIT_BYTES,
        truncated: true
      })
      expect(file.size).toBeGreaterThan(LIFE_SCIENCE_PREVIEW_TEXT_READ_LIMIT_BYTES)
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})

function providerFor(
  contributions: readonly Readonly<{ value: unknown }>[],
  pluginId: string
): WorkspacePreviewProvider {
  const match = contributions
    .map(({ value }) => providerValue(value))
    .find(({ provider }) => provider.pluginId === pluginId)
  if (!match) throw new Error(`Missing Life Science Preview provider ${pluginId}.`)
  return match.provider
}

function providerValue(value: unknown): Readonly<{
  manifest: { id: string }
  provider: WorkspacePreviewProvider
}> {
  if (!value || typeof value !== 'object' ||
      !('manifest' in value) || !('provider' in value)) {
    throw new Error('Invalid Life Science Preview provider contribution.')
  }
  return value as ReturnType<typeof providerValue>
}

function providerOperations(provider: WorkspacePreviewProvider): string[] {
  return [
    'validateFile',
    'observe',
    'invokeAction',
    'prepareArtifact',
    'renderVisual',
    'applyEdit',
    'exportPreview',
    'invokeHostAction'
  ].filter((operation) => typeof provider[operation as keyof WorkspacePreviewProvider] === 'function')
}

function createSession(
  pluginId: string,
  modality: WorkspacePreviewModality,
  file: WorkspacePreviewFileState
): WorkspacePreviewSession {
  return {
    id: `session-${pluginId}`,
    pluginId,
    workspaceRoot: file.workspaceRoot,
    path: file.path,
    modality,
    mode: 'preview',
    openedAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z'
  }
}
