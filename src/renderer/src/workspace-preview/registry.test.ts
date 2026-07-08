import { describe, expect, it } from 'vitest'
import {
  LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS,
  WORKSPACE_PREVIEW_AGENT_ACCESS,
  workspacePreviewPluginManifestSchema
} from '@shared/workspace-preview'
import {
  CORE_RENDERER_WORKSPACE_PREVIEW_PLUGIN_DESCRIPTORS,
  DEFAULT_RENDERER_WORKSPACE_PREVIEW_PLUGIN_DESCRIPTORS,
  DECK_WORKSPACE_PREVIEW_PLUGIN_ID,
  DOCX_WORKSPACE_PREVIEW_PLUGIN_ID,
  HTML_WORKSPACE_PREVIEW_PLUGIN_ID,
  IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID,
  LEGACY_WORKSPACE_PREVIEW_PLUGIN_ID,
  MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
  PDF_WORKSPACE_PREVIEW_PLUGIN_ID,
  TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID,
  TEXT_WORKSPACE_PREVIEW_PLUGIN_ID,
  createRendererWorkspacePreviewRegistry
} from './registry'

describe('renderer workspace preview registry', () => {
  it('registers core preview descriptors against the shared manifest contract', () => {
    const ids = CORE_RENDERER_WORKSPACE_PREVIEW_PLUGIN_DESCRIPTORS.map((descriptor) => descriptor.manifest.id)

    expect(ids).toEqual(expect.arrayContaining([
      LEGACY_WORKSPACE_PREVIEW_PLUGIN_ID,
      TEXT_WORKSPACE_PREVIEW_PLUGIN_ID,
      MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
      HTML_WORKSPACE_PREVIEW_PLUGIN_ID,
      IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID,
      PDF_WORKSPACE_PREVIEW_PLUGIN_ID,
      DOCX_WORKSPACE_PREVIEW_PLUGIN_ID,
      TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID,
      DECK_WORKSPACE_PREVIEW_PLUGIN_ID
    ]))

    for (const descriptor of DEFAULT_RENDERER_WORKSPACE_PREVIEW_PLUGIN_DESCRIPTORS) {
      const manifest = workspacePreviewPluginManifestSchema.parse(descriptor.manifest)
      expect(manifest.capabilities.agent).toEqual(WORKSPACE_PREVIEW_AGENT_ACCESS)
    }
  })

  it('keeps renderer manifest exports aligned with source-copy support', () => {
    const registry = createRendererWorkspacePreviewRegistry()

    expect(registry.get(TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID)?.manifest.capabilities.export).toEqual(['csv', 'tsv'])
    expect(registry.get(TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID)?.manifest.capabilities.export).not.toContain('xlsx')
    expect(registry.get('molecular')?.manifest.capabilities.export).not.toEqual(expect.arrayContaining(['png', 'session']))
    expect(registry.get('omics-matrix')?.manifest.capabilities.export).not.toContain('csv')
    expect(registry.get('bioimaging')?.manifest.capabilities.export).not.toEqual(expect.arrayContaining(['png', 'roi']))
    expect(registry.get('proteomics-spectra')?.manifest.capabilities.export).not.toContain('csv')
    expect(registry.get('molecular')?.manifest.capabilities.annotations).toBeUndefined()
    expect(registry.get('sequence-genomics')?.manifest.capabilities.annotations).toBeUndefined()
    expect(registry.get('bioimaging')?.manifest.capabilities.annotations).toBeUndefined()
    expect(registry.get('proteomics-spectra')?.manifest.capabilities.annotations).toBeUndefined()
  })

  it('wraps shared life-science manifests without changing their ids', () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const sharedIds = LIFE_SCIENCE_PREVIEW_PLUGIN_MANIFESTS.map((manifest) => manifest.id)

    for (const id of sharedIds) {
      expect(registry.get(id)).toMatchObject({
        kind: 'life-science',
        source: 'shared-life-science',
        manifest: { id }
      })
    }
  })

  it('resolves renderer-core and life-science formats before falling back to legacy', () => {
    const registry = createRendererWorkspacePreviewRegistry()

    expect(registry.resolve({ path: 'notes.TXT' })?.manifest.id).toBe(TEXT_WORKSPACE_PREVIEW_PLUGIN_ID)
    expect(registry.resolve({ path: 'README.md' })?.manifest.id).toBe(MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID)
    expect(registry.resolve({ path: 'report.html' })?.manifest.id).toBe(HTML_WORKSPACE_PREVIEW_PLUGIN_ID)
    expect(registry.resolve({ path: 'figure.PNG' })?.manifest.id).toBe(IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID)
    expect(registry.resolve({ path: 'paper.pdf' })?.manifest.id).toBe(PDF_WORKSPACE_PREVIEW_PLUGIN_ID)
    expect(registry.resolve({ path: 'paper.docx' })?.manifest.id).toBe(DOCX_WORKSPACE_PREVIEW_PLUGIN_ID)
    expect(registry.resolve({ path: 'samples.csv' })?.manifest.id).toBe(TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID)
    expect(registry.resolve({ path: 'records.ndjson' })?.manifest.id).toBe(TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID)
    expect(registry.resolve({ path: 'talk.pptx' })?.manifest.id).toBe(DECK_WORKSPACE_PREVIEW_PLUGIN_ID)
    expect(registry.resolve({ path: 'legacy.ppt' })).toBeNull()
    expect(registry.resolve({ path: 'protein.pdb' })?.manifest.id).toBe('molecular')

    expect(registry.resolve({ path: 'opaque.unknown' })).toBeNull()
    expect(registry.resolve({ path: 'opaque.unknown', includeFallback: true })?.manifest.id).toBe(
      LEGACY_WORKSPACE_PREVIEW_PLUGIN_ID
    )
  })

  it('does not fallback deferred non-life-science scientific formats to legacy', () => {
    const registry = createRendererWorkspacePreviewRegistry()

    expect(registry.resolve({ path: 'mesh.vtk', includeFallback: true })).toBeNull()
  })
})
