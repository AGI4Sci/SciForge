/**
 * Host integration for the workspace-preview contribution channel (gap-1b
 * reference implementation): a real fixture plugin (kind workspace-preview)
 * activates through the real DevelopmentExternalPluginService, registers its
 * slot into a collecting sink, and serves governed provider calls from its
 * child process. Covers the three-layer negatives end to end.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PluginAdapterContract } from '@sciforge/plugin-sdk'
import { DevelopmentExternalPluginService } from './development-external-plugins'
import type { WorkspacePreviewPluginRegistrationInput } from '../services/workspace-preview/composition'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ))
})

const name = 'preview-probe-plugin'
const dshRuntimeVersion = '0.2.0-rc.2'

const manifest = {
  contractVersion: 1,
  id: 'probe-slot',
  displayName: 'Probe Slot',
  version: '1.0.0',
  modality: 'unknown',
  lifecycle: 'worker',
  priority: 500,
  extensions: ['.probe'],
  mimeTypes: [],
  capabilities: { preview: true, edit: false, inspect: true, structuredSelection: false }
}

const fixtureMain = `
const manifest = ${JSON.stringify(manifest)}
export async function activate() {}
export async function deactivate() {}
export async function dispose() {}
export function getWorkspacePreviewProviders() {
  return [{
    slotId: 'probe-slot',
    artifactKinds: ['thumbnail'],
    manifest,
    provider: {
      observe: async (input) => ({
        ok: true,
        bytesRead: 1,
        truncated: false,
        observation: {
          schemaVersion: 1,
          file: { path: input.file.path, workspaceRoot: input.file.workspaceRoot },
          view: { pluginId: 'probe-slot', modality: 'unknown', mode: input.session.mode, title: 'probe' },
          actions: ['observe']
        },
        echo: { workspaceRoot: input.file.workspaceRoot, pluginId: input.manifest.id }
      }),
      prepareArtifact: async (input) => ({
        ok: true,
        kind: input.request.kind,
        mimeType: 'image/png',
        bytes: new Uint8Array([137, 80, 78, 71, 13]),
        thumbnail: { width: input.request.width, height: input.request.height },
        bytesRead: 5,
        truncated: false
      }),
      applyEdit: async () => null
    }
  }]
}
`

type SyncedState = Readonly<{
  root: string
  service: DevelopmentExternalPluginService
  syncs: Map<string, WorkspacePreviewPluginRegistrationInput[]>
  lastSync: (packageName: string) => WorkspacePreviewPluginRegistrationInput[] | undefined
}>

async function createPreviewFixture(options: Readonly<{
  approved?: boolean
  declaredSlots?: readonly unknown[]
  main?: string
}> = {}): Promise<SyncedState> {
  const root = await mkdtemp(join(tmpdir(), 'workspace-preview-channel-'))
  temporaryDirectories.push(root)
  const plugin = join(root, 'plugins', name)
  await mkdir(plugin, { recursive: true })
  await writeFile(join(plugin, 'package.json'), JSON.stringify({
    name, version: '1.0.0', private: true, type: 'module',
    exports: { '.': './main.js' },
    dsh: { bundle: { patch: './patch.yml' } }
  }))
  await writeFile(join(plugin, 'patch.yml'), '[]')
  await writeFile(join(plugin, 'sciforge.adapter.json'), JSON.stringify({
    schemaVersion: 1, kind: 'workspace-preview', namespace: 'previewprobe', hostApiRange: '^1.0.0',
    permissions: [], reloadPolicy: 'live',
    previewSlots: options.declaredSlots ?? [{ slotId: 'probe-slot', artifactKinds: ['thumbnail'] }]
  }))
  await writeFile(join(plugin, 'main.js'), options.main ?? fixtureMain)
  const contract: PluginAdapterContract = {
    hostApiRange: '^1.0.0', permissions: [], approved: options.approved ?? true,
    dshAuthorization: { packageName: name, packageVersion: '1.0.0', dshRuntimeVersion }
  }
  const service = new DevelopmentExternalPluginService({
    root: join(root, 'plugins'),
    userDataPath: join(root, 'data'),
    hostApiVersion: '1.0.0',
    dshRuntimeVersion,
    adapterContracts: new Map([[name, contract]])
  })
  await service.initialize()
  const syncs = new Map<string, WorkspacePreviewPluginRegistrationInput[]>()
  service.setWorkspacePreviewSink({
    sync: (packageName, plugins) => {
      if (!plugins?.length) syncs.delete(packageName)
      else syncs.set(packageName, [...plugins])
    }
  })
  return {
    root,
    service,
    syncs,
    lastSync: (packageName) => syncs.get(packageName)
  }
}

const observationInput = {
  session: {
    id: 's1', pluginId: 'probe-slot', workspaceRoot: '/ws/target', path: '/ws/target/a.probe',
    modality: 'unknown', mode: 'preview', openedAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z'
  },
  manifest,
  file: { workspaceRoot: '/ws/target', path: '/ws/target/a.probe' }
}

describe('development plugin workspace-preview channel', () => {
  it('registers declared slots into the sink and round-trips governed provider calls', async () => {
    const fixture = await createPreviewFixture()
    try {
      await fixture.service.setEnabled(name, true)
      const synced = fixture.lastSync(name)
      expect(synced).toHaveLength(1)
      const registration = synced![0]!
      expect(registration.ownerId).toBe(name)
      expect(registration.manifest.id).toBe('probe-slot')
      expect(registration.provider.pluginId).toBe('probe-slot')

      const observed = await registration.provider.observe!(observationInput as never)
      expect(observed.ok).toBe(true)
      if (!observed.ok) return
      expect((observed as unknown as { echo: { workspaceRoot: string; pluginId: string } }).echo)
        .toEqual({ workspaceRoot: '/ws/target', pluginId: 'probe-slot' })

      const artifact = await registration.provider.prepareArtifact!({
        ...observationInput,
        request: { kind: 'thumbnail', width: 4, height: 4 }
      } as never)
      expect(artifact.ok).toBe(true)
      if (!artifact.ok) return
      expect([...(artifact as { bytes: Uint8Array }).bytes]).toEqual([137, 80, 78, 71, 13])

      const edit = await registration.provider.applyEdit!({
        ...observationInput,
        now: '2026-10-17T00:00:00.000Z',
        operation: { kind: 'workspace.setSelection', path: '/ws/target/a.probe', selection: { kind: 'text', ranges: [] } }
      } as never)
      expect(edit).toBeNull()
    } finally {
      await fixture.service.dispose()
    }
  })

  it('denies artifact kinds the declared slot does not list, fail-closed as a provider result', async () => {
    const fixture = await createPreviewFixture()
    try {
      await fixture.service.setEnabled(name, true)
      const registration = fixture.lastSync(name)![0]!
      const denied = await registration.provider.prepareArtifact!({
        ...observationInput,
        request: { kind: 'tile', level: 0, x: 0, y: 0, width: 2, height: 2 }
      } as never)
      expect(denied.ok).toBe(false)
      if (denied.ok) return
      expect(denied.message).toContain('unsupported_artifact')
    } finally {
      await fixture.service.dispose()
    }
  })

  it('denies calls without a file workspace before any IPC', async () => {
    const fixture = await createPreviewFixture()
    try {
      await fixture.service.setEnabled(name, true)
      const registration = fixture.lastSync(name)![0]!
      const denied = await registration.provider.observe!({
        ...observationInput,
        file: { path: '/ws/target/a.probe' }
      } as never)
      expect(denied.ok).toBe(false)
      if (denied.ok) return
      expect(denied.message).toContain('without a file workspace')
    } finally {
      await fixture.service.dispose()
    }
  })

  it('rejects activation when the plugin returns a slot the declaration does not name', async () => {
    const fixture = await createPreviewFixture({
      declaredSlots: [{ slotId: 'other-slot', artifactKinds: ['thumbnail'] }]
    })
    try {
      await expect(fixture.service.setEnabled(name, true)).rejects.toThrow(/does not name/)
      expect(fixture.lastSync(name)).toBeUndefined()
    } finally {
      await fixture.service.dispose()
    }
  })

  it('rejects activation when the plugin returns an undeclared artifact kind', async () => {
    const main = fixtureMain.replace(
      "artifactKinds: ['thumbnail'],",
      "artifactKinds: ['thumbnail', 'tile'],"
    )
    const fixture = await createPreviewFixture({ main })
    try {
      await expect(fixture.service.setEnabled(name, true)).rejects.toThrow(/undeclared artifact kind/)
      expect(fixture.lastSync(name)).toBeUndefined()
    } finally {
      await fixture.service.dispose()
    }
  })

  it('rejects activation without an approved exact-version contract and unregisters on disable', async () => {
    const fixture = await createPreviewFixture({ approved: false })
    try {
      await expect(fixture.service.setEnabled(name, true)).rejects.toThrow(/approved exact-version|DSH authorization must approve/)
      expect(fixture.lastSync(name)).toBeUndefined()

      const approved = await createPreviewFixture()
      try {
        await approved.service.setEnabled(name, true)
        expect(approved.lastSync(name)).toHaveLength(1)
        await approved.service.setEnabled(name, false)
        expect(approved.lastSync(name)).toBeUndefined()
      } finally {
        await approved.service.dispose()
      }
    } finally {
      await fixture.service.dispose()
    }
  })
})
