import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  WORKSPACE_PREVIEW_MAX_DOMAIN_JSON_DEPTH,
  WORKSPACE_PREVIEW_MAX_DOMAIN_JSON_NODES,
  WORKSPACE_PREVIEW_MAX_DOMAIN_JSON_OBJECT_KEYS,
  WORKSPACE_PREVIEW_MAX_PLUGIN_METADATA_STRING_CHARS,
  knownWorkspacePreviewModalitySchema,
  normalizePreviewManifest,
  workspaceObservationSchema,
  workspacePreviewJsonValueSchema,
  workspacePreviewManifestsEqual,
  workspacePreviewModalitySchema,
  workspacePreviewPluginManifestSchema,
  workspaceStructuredSelectionSchema
} from './workspace-preview.js'

describe('workspace preview public domain contract', () => {
  it('normalizes one canonical manifest and detects semantic drift', () => {
    const manifest = normalizePreviewManifest(workspacePreviewPluginManifestSchema.parse({
      contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      id: 'fixture-preview',
      displayName: 'Fixture Preview',
      version: '1.0.0',
      modality: 'fixture.imaging',
      lifecycle: 'hybrid',
      priority: 500,
      extensions: ['VTK'],
      mimeTypes: ['Application/X-Fixture; charset=utf-8'],
      capabilities: {
        preview: true,
        edit: false,
        inspect: true,
        structuredSelection: false
      }
    }))

    assert.deepEqual(manifest.extensions, ['.vtk'])
    assert.deepEqual(manifest.mimeTypes, ['application/x-fixture'])
    assert.equal(workspacePreviewManifestsEqual(manifest, { ...manifest }), true)
    assert.equal(workspacePreviewManifestsEqual(manifest, {
      ...manifest,
      displayName: 'Drifted Preview'
    }), false)
  })

  it('keeps life-science wire values behind namespaced domain extensions', () => {
    const legacyModalities = ['molecular', 'sequence', 'omics', 'bioimaging', 'spectra']
    const legacySelections = [
      { kind: 'molecular', chains: ['A'] },
      { kind: 'sequence', ranges: [{ start: 1, end: 2 }] },
      { kind: 'omics', matrixIds: ['matrix-1'] },
      { kind: 'bioimaging', roiIds: ['roi-1'] },
      { kind: 'spectra', ranges: [{ xStart: 1, xEnd: 2 }] }
    ]

    for (const modality of legacyModalities) {
      assert.equal(knownWorkspacePreviewModalitySchema.safeParse(modality).success, false)
      assert.equal(workspacePreviewModalitySchema.safeParse(modality).success, false)
    }
    for (const selection of legacySelections) {
      assert.equal(workspaceStructuredSelectionSchema.safeParse(selection).success, false)
    }

    const baseObservation = {
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: { path: '/workspace/domain.data' },
      view: {
        pluginId: 'fixture-preview',
        modality: 'fixture.imaging',
        mode: 'inspect',
        title: 'domain.data'
      },
      actions: []
    }
    for (const field of legacyModalities) {
      assert.equal(workspaceObservationSchema.safeParse({
        ...baseObservation,
        [field]: {}
      }).success, false)
    }
  })

  it('round-trips namespaced domain selection and observation metadata', () => {
    const selection = workspaceStructuredSelectionSchema.parse({
      kind: 'domain',
      selectionType: 'sciforge.life-science-preview.molecular.selection',
      data: {
        schemaVersion: 2,
        chains: ['A'],
        residues: [{ chain: 'A', index: 42 }]
      }
    })
    const observation = workspaceObservationSchema.parse({
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: { path: '/workspace/protein.pdb' },
      view: {
        pluginId: 'molecular',
        modality: 'sciforge.life-science-preview.molecular',
        mode: 'inspect',
        title: 'protein.pdb'
      },
      selection,
      pluginMetadata: [{
        source: 'plugin-metadata',
        metadataKind: 'sciforge.life-science-preview.molecular.observation',
        mimeType: 'application/vnd.sciforge.life-science.molecular+json',
        metadataOnly: true,
        containsPixels: false,
        data: {
          schemaVersion: 2,
          modelCount: 1,
          chains: ['A', 'B']
        },
        selection,
        actions: ['molecular.workbench']
      }],
      actions: ['molecular.workbench']
    })

    assert.deepEqual(observation.selection, selection)
    assert.deepEqual(observation.pluginMetadata?.[0]?.data, {
      schemaVersion: 2,
      modelCount: 1,
      chains: ['A', 'B']
    })
  })

  it('enforces every bounded JSON dimension used by domain wire payloads', () => {
    let tooDeep: unknown = null
    for (let depth = 0; depth <= WORKSPACE_PREVIEW_MAX_DOMAIN_JSON_DEPTH; depth += 1) {
      tooDeep = { nested: tooDeep }
    }
    const tooManyNodes = Array.from(
      { length: 1_000 },
      () => Array.from({ length: 10 }, () => null)
    )
    const tooManyKeys = Object.fromEntries(Array.from(
      { length: WORKSPACE_PREVIEW_MAX_DOMAIN_JSON_OBJECT_KEYS + 1 },
      (_, index) => [`key${index}`, null]
    ))

    assert.throws(() => workspacePreviewJsonValueSchema.parse(tooDeep), /exceeds depth/)
    assert.throws(() => workspacePreviewJsonValueSchema.parse(tooManyNodes), new RegExp(`exceeds ${WORKSPACE_PREVIEW_MAX_DOMAIN_JSON_NODES} nodes`))
    assert.throws(() => workspacePreviewJsonValueSchema.parse(tooManyKeys), new RegExp(`exceeds ${WORKSPACE_PREVIEW_MAX_DOMAIN_JSON_OBJECT_KEYS} keys`))
    assert.throws(() => workspacePreviewJsonValueSchema.parse('x'.repeat(
      WORKSPACE_PREVIEW_MAX_PLUGIN_METADATA_STRING_CHARS + 1
    )))
  })
})
