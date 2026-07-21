import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_PREVIEW_FIRST_PARTY_IMAGE_EXPORT_FORMATS,
  WORKSPACE_PREVIEW_FIRST_PARTY_MARKDOWN_MIME_TYPES,
  WORKSPACE_PREVIEW_FIRST_PARTY_PDF_MIME_TYPES,
  WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_EXTENSIONS,
  WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_MIME_TYPES
} from '../../../shared/workspace-preview'
import {
  createWorkspacePreviewRegistry,
  defaultWorkspacePreviewManifests
} from './registry'

describe('WorkspacePreviewRegistry', () => {
  it('routes mature document and image formats through final plugin identities', () => {
    const registry = createWorkspacePreviewRegistry()

    expect(registry.resolve({ path: 'notes.md' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'markdown', modality: 'document' }
    })
    expect(registry.resolve({ path: 'paper.pdf' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'pdf', modality: 'document' }
    })
    expect(registry.resolve({ path: 'figure.png' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'image', modality: 'image' }
    })
  })

  it('routes planned tabular, deck, and life-science formats through the new plugin contract', () => {
    const registry = createWorkspacePreviewRegistry()

    expect(registry.resolve({ path: 'notes.txt' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'text', modality: 'text' }
    })
    expect(registry.resolve({ path: '.env' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'text', modality: 'text' }
    })
    expect(registry.resolve({ path: '.env.local' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'text', modality: 'text' }
    })
    expect(registry.resolve({ path: 'script.py' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'text', modality: 'text' }
    })
    expect(registry.resolve({ path: 'script', mimeType: 'text/x-python; charset=utf-8' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'text', modality: 'text' }
    })
    expect(registry.resolve({ path: 'paper.tex' })).toMatchObject({
      status: 'matched',
      manifest: { id: 'text', modality: 'text' }
    })
    expect(registry.resolve({ path: 'refs.bib' })).toMatchObject({
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

  it('routes passive biology companion indexes without treating them as editable text', () => {
    const registry = createWorkspacePreviewRegistry()
    for (const path of ['reference.fa.fai', 'reference.fa.gz.gzi', 'variants.vcf.gz.tbi', 'variants.vcf.gz.csi']) {
      expect(registry.resolve({ path })).toMatchObject({
        status: 'matched',
        manifest: {
          id: 'biology-index-transport',
          modality: 'unknown',
          capabilities: {
            edit: false,
            structuredSelection: false
          }
        }
      })
    }
  })

  it('falls back to the text plugin only when requested', () => {
    const registry = createWorkspacePreviewRegistry()

    expect(registry.resolve({ path: 'unknown.custom' })).toMatchObject({
      status: 'fallback',
      manifest: { id: 'text' }
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
    expect(ids).toContain('tabular')
    expect(ids).toContain('molecular')
    expect(ids.some((id) => id.startsWith('legacy-'))).toBe(false)
  })

  it('does not declare conversion exports that the generic host cannot fulfill', () => {
    const manifests = new Map(defaultWorkspacePreviewManifests().map((manifest) => [manifest.id, manifest]))

    expect(manifests.get('markdown')?.capabilities.annotations).toBe(true)
    expect(manifests.get('markdown')?.capabilities.export).toEqual(['markdown', 'sidecar'])
    expect(manifests.get('markdown')?.capabilities.export).not.toContain('html')
    expect(manifests.get('pdf')?.capabilities.export).toEqual(['pdf', 'sidecar', 'annotated-pdf'])
    expect(manifests.get('tabular')?.capabilities.export).toEqual(['csv', 'tsv'])
    expect(manifests.get('tabular')?.capabilities.export).not.toContain('xlsx')
    expect(manifests.get('image')?.capabilities.edit).toBe(false)
    expect(manifests.get('image')?.capabilities.structuredSelection).toBe(false)
    expect(manifests.get('tabular')?.extensions).toEqual(['.csv', '.tsv', '.jsonl', '.ndjson', '.xlsx'])
    expect(manifests.get('tabular')?.extensions).not.toEqual(expect.arrayContaining([
      '.xls',
      '.parquet',
      '.feather',
      '.arrow'
    ]))
    expect(manifests.get('molecular')?.capabilities.export).not.toEqual(expect.arrayContaining(['png', 'session']))
    expect(manifests.get('omics-matrix')?.capabilities.export).not.toContain('csv')
    expect(manifests.get('bioimaging')?.capabilities.export).not.toEqual(expect.arrayContaining(['png', 'roi']))
    expect(manifests.get('proteomics-spectra')?.capabilities.export).not.toContain('csv')
    expect(manifests.get('molecular')?.capabilities.annotations).toBeUndefined()
    expect(manifests.get('sequence-genomics')?.capabilities.annotations).toBeUndefined()
    expect(manifests.get('bioimaging')?.capabilities.annotations).toBeUndefined()
    expect(manifests.get('proteomics-spectra')?.capabilities.annotations).toBeUndefined()
  })

  it('keeps first-party core manifest surfaces aligned with shared constants', () => {
    const manifests = new Map(defaultWorkspacePreviewManifests().map((manifest) => [manifest.id, manifest]))

    expect(manifests.get('text')?.extensions).toEqual([...WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_EXTENSIONS])
    expect(manifests.get('text')?.mimeTypes).toEqual([...WORKSPACE_PREVIEW_FIRST_PARTY_TEXT_MIME_TYPES])
    expect(manifests.get('text')?.extensions).not.toContain('.jsonl')
    expect(manifests.get('markdown')?.mimeTypes).toEqual([...WORKSPACE_PREVIEW_FIRST_PARTY_MARKDOWN_MIME_TYPES])
    expect(manifests.get('pdf')?.mimeTypes).toEqual([...WORKSPACE_PREVIEW_FIRST_PARTY_PDF_MIME_TYPES])
    expect(manifests.get('image')?.capabilities.export).toEqual([...WORKSPACE_PREVIEW_FIRST_PARTY_IMAGE_EXPORT_FORMATS])
  })
})
