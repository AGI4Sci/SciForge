import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  workspaceObservationSchema,
  workspacePreviewEditOperationSchema,
  workspacePreviewExtensionIdSchema,
  workspacePreviewPluginMetadataItemSchema,
  workspaceStructuredSelectionSchema,
  type WorkspaceObservation,
  type WorkspacePreviewFileState,
  type WorkspacePreviewSession
} from '@sciforge/domain-sdk/workspace-preview'
import { LIFE_SCIENCE_WORKSPACE_PREVIEW_MANIFESTS_BY_PLUGIN_ID } from './contract.js'
import {
  LIFE_SCIENCE_WORKSPACE_PREVIEW_OBSERVATION_METADATA_KINDS,
  LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS,
  LIFE_SCIENCE_WORKSPACE_PREVIEW_WIRE_VERSION,
  decodeLifeScienceObservationMetadata,
  decodeLifeScienceSelection,
  decodeLifeScienceSelectionsInValue,
  decodeLifeScienceWorkspaceObservation,
  encodeLifeScienceEditOperation,
  encodeLifeScienceObservationMetadata,
  encodeLifeScienceSelection,
  encodeLifeScienceSelectionsInValue,
  type LifeScienceObservationByKind,
  type LifeScienceStructuredSelection,
  type LifeScienceWorkspacePreviewKind
} from './wire.js'
import {
  LIFE_SCIENCE_MOLECULAR_SELECTION_OPERATION_TYPE,
  createLifeScienceWorkspacePreviewProvider
} from './backend/providers.js'

const selectionCases: readonly LifeScienceStructuredSelection[] = [
  { kind: 'molecular', chains: ['A'], ligands: ['ATP'] },
  { kind: 'sequence', sequenceId: 'chr1', ranges: [{ start: 4, end: 12, strand: '+' }] },
  {
    kind: 'omics',
    matrixIds: ['counts'],
    ranges: [{ matrixId: 'counts', axis: 'obs', start: 2, end: 8 }]
  },
  {
    kind: 'bioimaging',
    channels: ['DAPI'],
    regions: [{ x: 1, y: 2, width: 30, height: 40, z: 3 }]
  },
  {
    kind: 'spectra',
    ranges: [{ xStart: 100, xEnd: 250 }],
    peaks: [{ mz: 150.5, intensity: 42, label: 'target' }]
  }
]

const observationCases: ReadonlyArray<{
  kind: LifeScienceWorkspacePreviewKind
  observation: LifeScienceObservationByKind[LifeScienceWorkspacePreviewKind]
}> = [
  {
    kind: 'molecular',
    observation: { modelCount: 1, chains: ['A', 'B'], ligands: ['ATP'], representations: ['cartoon'] }
  },
  {
    kind: 'sequence',
    observation: {
      sequenceCount: 1,
      totalLength: 12,
      alphabet: 'dna',
      references: [{ id: 'chr1', sequenceLength: 12 }],
      features: [{ id: 'gene-1', reference: 'chr1', type: 'gene', start: 1, end: 10 }]
    }
  },
  {
    kind: 'omics',
    observation: {
      format: 'h5ad',
      matrixShape: [10, 20],
      matrixIds: ['counts'],
      obsKeys: ['cell_type'],
      embeddings: ['X_umap']
    }
  },
  {
    kind: 'bioimaging',
    observation: {
      format: 'ome-tiff',
      channels: ['DAPI', 'FITC'],
      dimensions: { width: 512, height: 256, z: 4 },
      tilePlan: { status: 'ready', levelCount: 3, pixelDecoding: true }
    }
  },
  {
    kind: 'spectra',
    observation: {
      format: 'mzml',
      spectrumCount: 2,
      peakCount: 3,
      mzRange: { min: 100, max: 1200 },
      sampledPeaks: [{ mz: 123.4, intensity: 99 }]
    }
  }
]

describe('Life Science Preview wire v2', () => {
  it.each(selectionCases)('roundtrips the $kind structured selection through the generic domain branch', (selection) => {
    const encoded = encodeLifeScienceSelection(selection)

    expect(workspaceStructuredSelectionSchema.parse(encoded)).toEqual(encoded)
    expect(encoded.kind).toBe('domain')
    expect(decodeLifeScienceSelection(encoded)).toEqual(selection)
  })

  it.each(observationCases)('roundtrips $kind observation metadata through a bounded envelope', ({ kind, observation }) => {
    const item = encodeObservation(kind, observation)

    expect(workspacePreviewPluginMetadataItemSchema.parse(item)).toEqual(item)
    expect(item.selection).toBeUndefined()
    expect(item.actions).toBeUndefined()
    expect(decodeLifeScienceObservationMetadata(item)).toEqual({
      wireVersion: LIFE_SCIENCE_WORKSPACE_PREVIEW_WIRE_VERSION,
      kind,
      observation
    })
  })

  it('rejects mismatched metadata kinds, wire versions, and legacy selections', () => {
    const item = encodeLifeScienceObservationMetadata('molecular', {
      modelCount: 1,
      chains: ['A']
    })
    const data = recordOf(item.data)

    expect(decodeLifeScienceObservationMetadata({
      ...item,
      metadataKind: LIFE_SCIENCE_WORKSPACE_PREVIEW_OBSERVATION_METADATA_KINDS.omics
    })).toBeNull()
    expect(decodeLifeScienceObservationMetadata({
      ...item,
      data: { ...data, wireVersion: 1 }
    })).toBeNull()
    expect(decodeLifeScienceSelection({ kind: 'molecular', chains: ['A'] })).toBeNull()
  })

  it('rejects old top-level life-science observations in the core schema', () => {
    const legacyObservation = {
      ...minimalCoreObservation(),
      molecular: { modelCount: 1, chains: ['A'] }
    }

    expect(workspaceObservationSchema.safeParse(legacyObservation).success).toBe(false)
  })

  it('enforces package bounds while keeping a worst-case envelope inside the core JSON bound', () => {
    expect(() => encodeLifeScienceSelection({
      kind: 'molecular',
      chains: Array.from({ length: LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS + 1 }, (_, index) => `C${index}`)
    })).toThrow()
    const boundedMolecular = decodeLifeScienceObservationMetadata(encodeLifeScienceObservationMetadata('molecular', {
      chains: Array.from({ length: LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS + 1 }, (_, index) => `C${index}`)
    }))
    expect(boundedMolecular?.kind === 'molecular' ? boundedMolecular.observation.chains : undefined)
      .toHaveLength(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS)
    expect(boundedMolecular?.kind === 'molecular' ? boundedMolecular.observation.truncatedItems : undefined)
      .toBe(true)

    const observation = worstCaseSequenceObservation()
    const item = encodeLifeScienceObservationMetadata('sequence', observation)
    const decoded = decodeLifeScienceObservationMetadata(item)

    expect(workspacePreviewPluginMetadataItemSchema.parse(item)).toEqual(item)
    expect(decoded?.observation).toEqual(observation)
    expect(decoded?.kind === 'sequence' ? decoded.observation.features : undefined).toHaveLength(
      LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS
    )
  })

  it('emits a core-valid provider observation and restores the package-owned facade', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-life-wire-'))
    const path = join(workspaceRoot, 'sample.pdb')
    const pdb = [
      'ATOM      1  N   ALA A   1      11.104  13.207   9.104  1.00 20.00           N',
      'ATOM      2  CA  ALA A   1      12.560  13.207   9.104  1.00 20.00           C',
      'HETATM    3  P   ATP A 101      14.000  13.207   9.104  1.00 20.00           P',
      'END'
    ].join('\n')

    try {
      await writeFile(path, pdb, 'utf8')
      const manifest = LIFE_SCIENCE_WORKSPACE_PREVIEW_MANIFESTS_BY_PLUGIN_ID.molecular
      const file: WorkspacePreviewFileState = {
        workspaceRoot,
        path,
        relativePath: 'sample.pdb',
        size: Buffer.byteLength(pdb)
      }
      const session = createSession(manifest.id, manifest.modality, file)
      const provider = createLifeScienceWorkspacePreviewProvider(manifest)
      const result = await provider.observe?.({ manifest, file, session })

      expect(result?.ok).toBe(true)
      if (!result?.ok) return
      const observation = workspaceObservationSchema.parse(result.observation)
      const facade = decodeLifeScienceWorkspaceObservation(observation)

      expect('molecular' in observation).toBe(false)
      expect(observation.view.modality).toBe('sciforge.life-science-preview.molecular')
      expect(observation.pluginMetadata?.length).toBeGreaterThan(0)
      expect(facade?.view.modality).toBe('molecular')
      expect(facade?.molecular).toMatchObject({ modelCount: 1, chains: ['A'] })
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('bounds oversized worker observations at the provider boundary and reports truncation', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-life-wire-large-'))
    const path = join(workspaceRoot, 'large.mgf')
    const peaks = Array.from(
      { length: LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS + 1 },
      (_, index) => `${100 + index / 10} ${index + 1}`
    )
    const mgf = ['BEGIN IONS', 'TITLE=large-spectrum', 'PEPMASS=500.2', ...peaks, 'END IONS'].join('\n')

    try {
      await writeFile(path, mgf, 'utf8')
      const manifest = LIFE_SCIENCE_WORKSPACE_PREVIEW_MANIFESTS_BY_PLUGIN_ID['proteomics-spectra']
      const file: WorkspacePreviewFileState = {
        workspaceRoot,
        path,
        relativePath: 'large.mgf',
        size: Buffer.byteLength(mgf)
      }
      const provider = createLifeScienceWorkspacePreviewProvider(manifest)
      const result = await provider.observe?.({
        manifest,
        file,
        session: createSession(manifest.id, manifest.modality, file)
      })

      expect(result?.ok).toBe(true)
      if (!result?.ok) return
      const observation = workspaceObservationSchema.parse(result.observation)
      const facade = decodeLifeScienceWorkspaceObservation(observation)

      expect(facade?.spectra?.sampledPeaks).toHaveLength(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS)
      expect(facade?.spectra?.truncatedItems).toBe(true)
      expect(facade?.spectra?.peakCount).toBe(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS + 1)
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('adapts edit selections and nested action-result selections in both directions', async () => {
    const molecularSelection = selectionCases[0]
    const sequenceSelection = selectionCases[1]
    const localOperation = {
      kind: 'domain.applyEdit' as const,
      path: '/workspace/sample.pdb',
      operationType: workspacePreviewExtensionIdSchema.parse(LIFE_SCIENCE_MOLECULAR_SELECTION_OPERATION_TYPE),
      data: { selection: molecularSelection }
    }
    const encodedOperation = encodeLifeScienceEditOperation(localOperation)
    const parsedOperation = workspacePreviewEditOperationSchema.parse(encodedOperation)

    expect(parsedOperation.kind).toBe('domain.applyEdit')
    if (parsedOperation.kind !== 'domain.applyEdit') return
    expect(decodeLifeScienceSelection(recordOf(parsedOperation.data).selection)).toEqual(molecularSelection)

    const manifest = LIFE_SCIENCE_WORKSPACE_PREVIEW_MANIFESTS_BY_PLUGIN_ID.molecular
    const file: WorkspacePreviewFileState = {
      workspaceRoot: '/workspace',
      path: '/workspace/sample.pdb',
      relativePath: 'sample.pdb'
    }
    const provider = createLifeScienceWorkspacePreviewProvider(manifest)
    const applied = await provider.applyEdit?.({
      manifest,
      file,
      session: createSession(manifest.id, manifest.modality, file),
      operation: parsedOperation,
      now: '2026-07-22T00:00:01.000Z'
    })

    expect(applied?.ok).toBe(true)
    if (applied?.ok) {
      expect(decodeLifeScienceSelection(applied.session.selection)).toEqual(molecularSelection)
    }

    const workerResult = {
      selection: molecularSelection,
      nested: [{ selection: sequenceSelection }]
    }
    const wireResult = encodeLifeScienceSelectionsInValue(workerResult)
    const wireRecord = recordOf(wireResult)

    expect(workspaceStructuredSelectionSchema.parse(wireRecord.selection).kind).toBe('domain')
    expect(decodeLifeScienceSelectionsInValue(wireResult)).toEqual(workerResult)
  })
})

function encodeObservation(
  kind: LifeScienceWorkspacePreviewKind,
  observation: LifeScienceObservationByKind[LifeScienceWorkspacePreviewKind]
) {
  return encodeLifeScienceObservationMetadata(kind, observation)
}

function worstCaseSequenceObservation(): LifeScienceObservationByKind['sequence'] {
  const itemCount = LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS
  return {
    sequenceCount: 1,
    totalLength: itemCount * 10,
    alphabet: 'dna',
    references: Array.from({ length: itemCount }, (_, index) => ({
      id: `reference-${index}`,
      sequenceLength: itemCount * 10,
      featureCount: itemCount,
      intervalCount: itemCount,
      variantCount: itemCount
    })),
    features: Array.from({ length: itemCount }, (_, index) => ({
      id: `feature-${index}`,
      reference: `reference-${index}`,
      type: 'gene',
      start: index * 10,
      end: index * 10 + 9,
      strand: '+' as const
    })),
    indexedRanges: Array.from({ length: itemCount }, (_, index) => ({
      kind: 'feature' as const,
      reference: `reference-${index}`,
      start: index * 10,
      end: index * 10 + 9,
      id: `range-${index}`,
      type: 'gene',
      strand: '+' as const
    })),
    truncatedRecords: false,
    truncatedReferences: false
  }
}

function minimalCoreObservation(): WorkspaceObservation {
  return workspaceObservationSchema.parse({
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: { path: '/workspace/sample.pdb', workspaceRoot: '/workspace' },
    view: {
      pluginId: 'molecular',
      modality: workspacePreviewExtensionIdSchema.parse('sciforge.life-science-preview.molecular'),
      mode: 'preview',
      title: 'sample.pdb'
    },
    actions: []
  })
}

function createSession(
  pluginId: string,
  modality: WorkspacePreviewSession['modality'],
  file: WorkspacePreviewFileState
): WorkspacePreviewSession {
  return {
    id: 'life-wire-session',
    pluginId,
    workspaceRoot: file.workspaceRoot,
    path: file.path,
    modality,
    mode: 'preview',
    openedAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z'
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Expected an object.')
  }
  return value as Record<string, unknown>
}
