import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS } from './shared/workspace-preview'
import {
  WORKSPACE_PREVIEW_CORE_MANIFEST_OWNER_ID,
  WorkspacePreviewRegistry
} from './main/services/workspace-preview/registry'
import {
  createBuiltInWorkspacePreviewPluginRegistrations
} from './renderer/src/workspace-preview/built-in-plugin-contributions'
import { createRendererWorkspacePreviewRegistry } from './renderer/src/workspace-preview/registry'

vi.mock('./renderer/src/workspace-preview/PdfWorkspaceViewer', () => ({
  PdfWorkspaceViewer: () => null
}))

describe('workspace preview manifest parity', () => {
  it('uses the shared canonical manifests in both process layers', () => {
    const rendererRegistry = createBuiltInRegistry()
    const mainRegistry = createMainRegistry()
    const canonicalById = new Map(
      DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS.map((manifest) => [manifest.id, manifest])
    )
    const mainById = new Map(mainRegistry.list().map(({ manifest }) => [manifest.id, manifest]))
    const rendererIds = rendererRegistry.list().map((descriptor) => descriptor.manifest.id)
    const mainIds = mainRegistry.list().map(({ manifest }) => manifest.id)

    expect(rendererIds).toEqual([...new Set(rendererIds)])
    expect(mainIds).toEqual([...new Set(mainIds)])
    for (const descriptor of rendererRegistry.list()) {
      expect(descriptor.manifest).toBe(canonicalById.get(descriptor.manifest.id))
      expect(descriptor.manifest).toEqual(mainById.get(descriptor.manifest.id))
    }
  })

  it('uses the same manifest precedence in both process layers', () => {
    const rendererRegistry = createBuiltInRegistry()
    const mainRegistry = createMainRegistry()
    const cases = [
      { path: 'README.md', mimeType: 'text/html' },
      { path: 'paper.docx', mimeType: 'application/pdf' },
      {
        path: 'samples.csv',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      },
      { path: 'figure.png', mimeType: 'text/markdown' },
      { path: 'protein.pdb', mimeType: 'text/markdown' },
      { path: 'opaque.unknown' }
    ]

    for (const input of cases) {
      const mainRoute = mainRegistry.resolve({ ...input, fallbackToText: false })
      const mainPluginId = mainRoute.status === 'matched'
        ? mainRoute.manifest.id
        : null
      expect(rendererRegistry.resolve(input)?.manifest.id ?? null).toBe(mainPluginId)
    }
  })
})

function createBuiltInRegistry() {
  return createRendererWorkspacePreviewRegistry({
    registrations: createBuiltInWorkspacePreviewPluginRegistrations()
  })
}

function createMainRegistry() {
  return new WorkspacePreviewRegistry(DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS.map((manifest) => ({
    ownerId: WORKSPACE_PREVIEW_CORE_MANIFEST_OWNER_ID,
    manifest
  })))
}
