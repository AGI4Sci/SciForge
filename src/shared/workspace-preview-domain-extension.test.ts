import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_PREVIEW_MAX_DOMAIN_JSON_DEPTH,
  WORKSPACE_PREVIEW_MAX_DOMAIN_JSON_NODES,
  WORKSPACE_PREVIEW_MAX_DOMAIN_JSON_OBJECT_KEYS,
  WORKSPACE_PREVIEW_MAX_PLUGIN_METADATA_STRING_CHARS,
  knownWorkspacePreviewModalitySchema,
  workspaceObservationSchema,
  workspacePreviewEditOperationSchema,
  workspacePreviewJsonValueSchema,
  workspacePreviewModalitySchema,
  workspaceStructuredSelectionSchema
} from './workspace-preview'

describe('workspace preview domain extension payloads', () => {
  it('keeps host modalities and requires namespaced identifiers for domain modalities', () => {
    expect(knownWorkspacePreviewModalitySchema.parse('document')).toBe('document')
    expect(workspacePreviewModalitySchema.parse('materials.crystal')).toBe('materials.crystal')
    expect(() => workspacePreviewModalitySchema.parse('custom')).toThrow()
    for (const legacy of ['molecular', 'sequence', 'omics', 'bioimaging', 'spectra']) {
      expect(workspacePreviewModalitySchema.safeParse(legacy).success).toBe(false)
    }
  })

  it('round-trips bounded domain selection, observation metadata, and edit JSON', () => {
    const selection = workspaceStructuredSelectionSchema.parse({
      kind: 'domain',
      selectionType: 'sciforge.life-science-preview.sequence.selection',
      data: {
        schemaVersion: 2,
        sequenceId: 'chr1',
        ranges: [{ start: 100, end: 120, strand: '+' }]
      }
    })
    expect(selection).toMatchObject({
      kind: 'domain',
      selectionType: 'sciforge.life-science-preview.sequence.selection'
    })
    expect(workspaceObservationSchema.parse({
      schemaVersion: 1,
      file: { path: '/workspace/variants.vcf' },
      view: {
        pluginId: 'sequence-genomics',
        modality: 'sciforge.life-science-preview.sequence',
        mode: 'inspect',
        title: 'variants.vcf'
      },
      selection,
      pluginMetadata: [{
        source: 'plugin-metadata',
        metadataKind: 'sciforge.life-science-preview.sequence.observation',
        metadataOnly: true,
        containsPixels: false,
        data: {
          schemaVersion: 2,
          sequenceCount: 1,
          totalLength: 248_956_422
        },
        selection
      }],
      actions: ['sequence.search']
    })).toMatchObject({
      view: { modality: 'sciforge.life-science-preview.sequence' },
      selection,
      pluginMetadata: [{
        data: { schemaVersion: 2, sequenceCount: 1 }
      }]
    })
    expect(workspacePreviewEditOperationSchema.parse({
      kind: 'domain.applyEdit',
      path: '/workspace/crystal.cif',
      operationType: 'materials.replace-site',
      data: { site: 2, element: 'Si' }
    })).toMatchObject({ kind: 'domain.applyEdit', operationType: 'materials.replace-site' })
    expect(workspaceStructuredSelectionSchema.parse({
      kind: 'text',
      ranges: [{ startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }]
    })).toMatchObject({ kind: 'text' })
  })

  it('rejects legacy life-science selections and observation fields', () => {
    const legacySelections = [
      { kind: 'molecular', chains: ['A'] },
      { kind: 'sequence', ranges: [{ start: 100, end: 120 }] },
      { kind: 'omics', matrixIds: ['matrix-1'] },
      { kind: 'bioimaging', roiIds: ['roi-1'] },
      { kind: 'spectra', ranges: [{ xStart: 1, xEnd: 2 }] }
    ]
    const observation = {
      schemaVersion: 1,
      file: { path: '/workspace/domain.data' },
      view: {
        pluginId: 'domain-fixture',
        modality: 'fixture.domain',
        mode: 'inspect',
        title: 'domain.data'
      },
      actions: []
    }

    for (const selection of legacySelections) {
      expect(workspaceStructuredSelectionSchema.safeParse(selection).success).toBe(false)
    }
    for (const field of ['molecular', 'sequence', 'omics', 'bioimaging', 'spectra']) {
      expect(workspaceObservationSchema.safeParse({
        ...observation,
        [field]: {}
      }).success).toBe(false)
    }
  })

  it('rejects JSON beyond domain depth, node, key, and string bounds', () => {
    let value: unknown = null
    for (let depth = 0; depth <= WORKSPACE_PREVIEW_MAX_DOMAIN_JSON_DEPTH; depth += 1) {
      value = { nested: value }
    }
    expect(() => workspacePreviewJsonValueSchema.parse(value)).toThrow(/exceeds depth/)

    const tooManyNodes = Array.from(
      { length: 1_000 },
      () => Array.from({ length: 10 }, () => null)
    )
    expect(() => workspacePreviewJsonValueSchema.parse(tooManyNodes)).toThrow(
      new RegExp(`exceeds ${WORKSPACE_PREVIEW_MAX_DOMAIN_JSON_NODES} nodes`)
    )

    const tooManyKeys = Object.fromEntries(Array.from(
      { length: WORKSPACE_PREVIEW_MAX_DOMAIN_JSON_OBJECT_KEYS + 1 },
      (_, index) => [`key${index}`, null]
    ))
    expect(() => workspacePreviewJsonValueSchema.parse(tooManyKeys)).toThrow(
      new RegExp(`exceeds ${WORKSPACE_PREVIEW_MAX_DOMAIN_JSON_OBJECT_KEYS} keys`)
    )
    expect(() => workspacePreviewJsonValueSchema.parse(
      'x'.repeat(WORKSPACE_PREVIEW_MAX_PLUGIN_METADATA_STRING_CHARS + 1)
    )).toThrow()
  })
})
