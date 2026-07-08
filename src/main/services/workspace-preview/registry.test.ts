import { describe, expect, it } from 'vitest'
import {
  createWorkspacePreviewRegistry,
  defaultWorkspacePreviewManifests
} from './registry'

describe('WorkspacePreviewRegistry', () => {
  it('routes legacy preview formats without touching the old preview panel', () => {
    const registry = createWorkspacePreviewRegistry()

    expect(registry.resolve({ path: 'notes.md' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'legacy-markdown' }
    })
    expect(registry.resolve({ path: 'paper.pdf' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'legacy-pdf' }
    })
    expect(registry.resolve({ path: 'figure.png' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'legacy-image' }
    })
  })

  it('routes planned tabular, deck, and life-science formats through the new plugin contract', () => {
    const registry = createWorkspacePreviewRegistry()

    expect(registry.resolve({ path: 'notes.txt' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'text', modality: 'text' }
    })
    expect(registry.resolve({ path: 'samples.csv' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'tabular', modality: 'tabular' }
    })
    expect(registry.resolve({ path: 'records.ndjson' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'tabular', modality: 'tabular' }
    })
    expect(registry.resolve({ path: 'talk.pptx' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'deck', modality: 'deck' }
    })
    expect(registry.resolve({ path: 'legacy.ppt', fallbackToText: false })).toMatchObject({
      status: 'unsupported',
      path: 'legacy.ppt'
    })
    expect(registry.resolve({
      path: 'legacy.bin',
      mimeType: 'application/vnd.ms-powerpoint',
      fallbackToText: false
    })).toMatchObject({
      status: 'unsupported',
      path: 'legacy.bin',
      mimeType: 'application/vnd.ms-powerpoint'
    })
    expect(registry.resolve({ path: 'protein.mmcif' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'molecular', modality: 'molecular' }
    })
  })

  it('falls back to legacy text only when requested', () => {
    const registry = createWorkspacePreviewRegistry()

    expect(registry.resolve({ path: 'unknown.custom' })).toMatchObject({
      status: 'fallback',
      manifest: { id: 'legacy-text' }
    })
    expect(registry.resolve({ path: 'unknown.custom', fallbackToText: false })).toMatchObject({
      status: 'unsupported',
      path: 'unknown.custom'
    })
  })

  it('does not silently fallback deferred non-life-science scientific formats to text', () => {
    const registry = createWorkspacePreviewRegistry()

    expect(registry.resolve({ path: 'mesh.vtk' })).toMatchObject({
      status: 'deferred',
      extension: '.vtk'
    })
  })

  it('keeps the default manifest set deterministic and unique', () => {
    const ids = defaultWorkspacePreviewManifests().map((manifest) => manifest.id)

    expect(ids).toEqual([...new Set(ids)])
    expect(ids).toContain('text')
    expect(ids).toContain('legacy-text')
    expect(ids).toContain('tabular')
    expect(ids).toContain('molecular')
  })

  it('does not declare conversion exports that the generic host cannot fulfill', () => {
    const manifests = new Map(defaultWorkspacePreviewManifests().map((manifest) => [manifest.id, manifest]))

    expect(manifests.get('tabular')?.capabilities.export).toEqual(['csv', 'tsv'])
    expect(manifests.get('tabular')?.capabilities.export).not.toContain('xlsx')
    expect(manifests.get('molecular')?.capabilities.export).not.toEqual(expect.arrayContaining(['png', 'session']))
    expect(manifests.get('omics-matrix')?.capabilities.export).not.toContain('csv')
    expect(manifests.get('bioimaging')?.capabilities.export).not.toEqual(expect.arrayContaining(['png', 'roi']))
    expect(manifests.get('proteomics-spectra')?.capabilities.export).not.toContain('csv')
    expect(manifests.get('molecular')?.capabilities.annotations).toBeUndefined()
    expect(manifests.get('sequence-genomics')?.capabilities.annotations).toBeUndefined()
    expect(manifests.get('bioimaging')?.capabilities.annotations).toBeUndefined()
    expect(manifests.get('proteomics-spectra')?.capabilities.annotations).toBeUndefined()
  })
})
