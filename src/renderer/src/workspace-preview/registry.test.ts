import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS,
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspacePreviewPluginManifest,
  workspacePreviewPluginManifestSchema
} from '@shared/workspace-preview'
import {
  WORKSPACE_PREVIEW_CORE_MANIFEST_OWNER_ID,
  WorkspacePreviewRegistry
} from '../../../main/services/workspace-preview/registry'
import { createBuiltInWorkspacePreviewPluginRegistrations } from './built-in-plugin-contributions'
import { createRendererWorkspacePreviewRegistry } from './registry'

vi.mock('./PdfWorkspaceViewer', () => ({ PdfWorkspaceViewer: () => null }))

describe('renderer workspace preview contribution registry', () => {
  it('registers one complete built-in contribution per renderer manifest', () => {
    const registry = createBuiltInRegistry()
    const ids = registry.list().map((descriptor) => descriptor.manifest.id)

    expect(ids).toEqual([...new Set(ids)])
    expect(ids).toEqual(expect.arrayContaining([
      'text',
      'markdown',
      'html',
      'image',
      'pdf',
      'docx',
      'tabular',
      'deck'
    ]))
    for (const descriptor of registry.list()) {
      expect(workspacePreviewPluginManifestSchema.parse(descriptor.manifest)).toBeTruthy()
      expect(descriptor.contribution.manifest).toBe(descriptor.manifest)
      expect(typeof descriptor.contribution.render).toBe('function')
    }
  })

  it('references canonical manifests and stays in parity with the main registry', () => {
    const rendererRegistry = createBuiltInRegistry()
    const mainById = new Map(
      new WorkspacePreviewRegistry(DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS.map((manifest) => ({
        ownerId: WORKSPACE_PREVIEW_CORE_MANIFEST_OWNER_ID,
        manifest
      })))
        .list().map(({ manifest }) => [manifest.id, manifest])
    )
    const canonicalById = new Map(DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS.map((manifest) => [manifest.id, manifest]))

    for (const descriptor of rendererRegistry.list()) {
      expect(descriptor.manifest).toBe(canonicalById.get(descriptor.manifest.id))
      expect(descriptor.manifest).toEqual(mainById.get(descriptor.manifest.id))
    }
  })

  it('uses canonical manifest precedence without a renderer fallback path', () => {
    const registry = createBuiltInRegistry()

    expect(registry.resolve({ path: 'README.md', mimeType: 'text/html' })?.manifest.id).toBe('markdown')
    expect(registry.resolve({ path: 'paper.docx', mimeType: 'application/pdf' })?.manifest.id).toBe('pdf')
    expect(registry.resolve({ path: 'protein.pdb', mimeType: 'text/markdown' })?.manifest.id).toBe('markdown')
    expect(registry.resolve({ path: 'opaque.unknown' })).toBeNull()
    expect(registry.resolve({ path: 'mesh.vtk' })).toBeNull()
  })

  it('atomically registers and disposes a package-owned renderer and action', () => {
    const manifest: WorkspacePreviewPluginManifest = {
      contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      id: 'custom-domain',
      displayName: 'Custom Domain',
      version: '1.0.0',
      modality: 'unknown',
      lifecycle: 'renderer',
      priority: 100,
      extensions: ['.custom'],
      mimeTypes: [],
      capabilities: {
        preview: true,
        edit: false,
        inspect: true,
        structuredSelection: false
      }
    }
    const contribution = {
      manifest,
      render: () => createElement('div'),
      actions: [{
        id: 'custom-domain.inspect',
        label: 'Inspect Custom Domain',
        run: async () => ({ ok: true as const, kind: 'ui' as const, actionId: 'custom-domain.inspect' })
      }]
    }
    const registry = createRendererWorkspacePreviewRegistry()
    const registration = registry.register('custom-package', contribution)

    expect(registry.get(manifest.id)?.contribution).toBe(contribution)
    expect(registry.getAction(manifest.id, 'custom-domain.inspect')).toBe(contribution.actions[0])
    expect(() => registry.register('duplicate-package', contribution)).toThrow(/already registered/)

    registration.dispose()
    registration.dispose()
    expect(registry.get(manifest.id)).toBeNull()
    expect(registry.getAction(manifest.id, 'custom-domain.inspect')).toBeNull()
  })

  it('rejects a batch without partial registration when a plugin repeats an action id', () => {
    const manifests: WorkspacePreviewPluginManifest[] = ['one', 'two'].map((id) => ({
      contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      id,
      displayName: id,
      version: '1.0.0',
      modality: 'unknown',
      lifecycle: 'renderer',
      priority: 1,
      extensions: [`.${id}`],
      mimeTypes: [],
      capabilities: { preview: true, edit: false, inspect: false, structuredSelection: false }
    }))
    const registry = createRendererWorkspacePreviewRegistry()
    const action = {
      id: 'shared.action',
      label: 'Shared',
      run: async () => ({ ok: true as const, kind: 'ui' as const, actionId: 'shared.action' })
    }

    expect(() => registry.registerMany(manifests.map((manifest, index) => ({
      ownerId: manifest.id,
      contribution: {
        manifest,
        render: () => createElement('div'),
        actions: index === 1 ? [action, action] : [action]
      }
    })))).toThrow(/action contribution/)
    expect(registry.list()).toEqual([])
  })

  it('scopes the same action id independently to each plugin', () => {
    const manifests: WorkspacePreviewPluginManifest[] = ['one', 'two'].map((id) => ({
      contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      id,
      displayName: id,
      version: '1.0.0',
      modality: 'unknown',
      lifecycle: 'renderer',
      priority: 1,
      extensions: [`.${id}`],
      mimeTypes: [],
      capabilities: { preview: true, edit: false, inspect: false, structuredSelection: false }
    }))
    const actions = manifests.map((manifest) => ({
      id: 'shared.action',
      label: `Shared ${manifest.id}`,
      run: async () => ({ ok: true as const, kind: 'ui' as const, actionId: 'shared.action' })
    }))
    const registry = createRendererWorkspacePreviewRegistry()

    registry.registerMany(manifests.map((manifest, index) => ({
      ownerId: manifest.id,
      contribution: {
        manifest,
        render: () => createElement('div'),
        actions: [actions[index]]
      }
    })))

    expect(registry.getAction('one', 'shared.action')).toBe(actions[0])
    expect(registry.getAction('two', 'shared.action')).toBe(actions[1])
  })
})

function createBuiltInRegistry() {
  return createRendererWorkspacePreviewRegistry({
    registrations: createBuiltInWorkspacePreviewPluginRegistrations()
  })
}
