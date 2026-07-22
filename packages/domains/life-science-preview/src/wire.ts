import { z } from 'zod'
import {
  workspacePreviewJsonValueSchema,
  workspacePreviewPluginMetadataItemSchema,
  workspaceStructuredSelectionSchema,
  type WorkspaceObservation,
  type WorkspacePreviewEditOperation,
  type WorkspacePreviewPluginMetadataItem,
  type WorkspaceStructuredSelection
} from '@sciforge/domain-sdk/workspace-preview'

/** Breaking package-owned wire generation. No v1/legacy decoder is intentionally provided. */
export const LIFE_SCIENCE_WORKSPACE_PREVIEW_WIRE_VERSION = 2 as const
/** Keeps worst-case multi-array envelopes below the SDK's 10,000-node JSON bound. */
export const LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS = 256

export const LIFE_SCIENCE_WORKSPACE_PREVIEW_MODALITIES = Object.freeze({
  molecular: 'sciforge.life-science-preview.molecular',
  sequence: 'sciforge.life-science-preview.sequence',
  omics: 'sciforge.life-science-preview.omics',
  bioimaging: 'sciforge.life-science-preview.bioimaging',
  spectra: 'sciforge.life-science-preview.spectra'
} as const)

export const LIFE_SCIENCE_WORKSPACE_PREVIEW_SELECTION_TYPES = Object.freeze({
  molecular: 'sciforge.life-science-preview.molecular.selection',
  sequence: 'sciforge.life-science-preview.sequence.selection',
  omics: 'sciforge.life-science-preview.omics.selection',
  bioimaging: 'sciforge.life-science-preview.bioimaging.selection',
  spectra: 'sciforge.life-science-preview.spectra.selection'
} as const)

export const LIFE_SCIENCE_WORKSPACE_PREVIEW_OBSERVATION_METADATA_KINDS = Object.freeze({
  molecular: 'sciforge.life-science-preview.molecular.observation',
  sequence: 'sciforge.life-science-preview.sequence.observation',
  omics: 'sciforge.life-science-preview.omics.observation',
  bioimaging: 'sciforge.life-science-preview.bioimaging.observation',
  spectra: 'sciforge.life-science-preview.spectra.observation'
} as const)

export type LifeScienceWorkspacePreviewKind = keyof typeof LIFE_SCIENCE_WORKSPACE_PREVIEW_MODALITIES

const idSchema = z.string().trim().min(1).max(256)
const optionalShortStringSchema = z.string().trim().max(256).optional()

export const lifeScienceMolecularSelectionSchema = z.object({
  kind: z.literal('molecular'),
  chains: z.array(z.string().trim().min(1).max(64)).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  residues: z.array(z.object({
    chain: z.string().trim().max(64).optional(),
    index: z.number().int().min(0),
    insertionCode: z.string().trim().max(8).optional(),
    name: z.string().trim().max(32).optional()
  }).strict()).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  atoms: z.array(z.object({
    id: z.string().trim().max(128).optional(),
    index: z.number().int().min(0).optional(),
    element: z.string().trim().max(8).optional()
  }).strict()).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  ligands: z.array(z.string().trim().min(1).max(64)).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional()
}).strict()

export const lifeScienceSequenceSelectionSchema = z.object({
  kind: z.literal('sequence'),
  sequenceId: idSchema.optional(),
  ranges: z.array(z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    strand: z.enum(['+', '-']).optional()
  }).strict()).min(1).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS),
  features: z.array(z.object({
    id: idSchema.optional(),
    type: z.string().trim().min(1).max(128),
    start: z.number().int().min(0),
    end: z.number().int().min(0)
  }).strict()).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional()
}).strict()

export const lifeScienceOmicsSelectionSchema = z.object({
  kind: z.literal('omics'),
  matrixIds: z.array(idSchema).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  obsKeys: z.array(idSchema).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  varKeys: z.array(idSchema).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  embeddings: z.array(idSchema).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  ranges: z.array(z.object({
    matrixId: idSchema,
    matrixName: optionalShortStringSchema,
    axis: z.enum(['obs', 'var', 'row', 'column']),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    axisLength: z.number().int().min(0).optional(),
    clipped: z.boolean().optional()
  }).strict()).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional()
}).strict()

export const lifeScienceBioimagingSelectionSchema = z.object({
  kind: z.literal('bioimaging'),
  roiIds: z.array(idSchema).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  channels: z.array(z.string().trim().min(1).max(128)).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  regions: z.array(z.object({
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    z: z.number().finite().nonnegative().optional(),
    t: z.number().finite().nonnegative().optional()
  }).strict()).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional()
}).strict()

export const lifeScienceSpectraSelectionSchema = z.object({
  kind: z.literal('spectra'),
  ranges: z.array(z.object({
    xStart: z.number().finite(),
    xEnd: z.number().finite(),
    yStart: z.number().finite().optional(),
    yEnd: z.number().finite().optional()
  }).strict()).min(1).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS),
  peaks: z.array(z.object({
    mz: z.number().finite().optional(),
    intensity: z.number().finite().optional(),
    label: z.string().trim().max(128).optional()
  }).strict()).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional()
}).strict()

export const lifeScienceStructuredSelectionSchema = z.discriminatedUnion('kind', [
  lifeScienceMolecularSelectionSchema,
  lifeScienceSequenceSelectionSchema,
  lifeScienceOmicsSelectionSchema,
  lifeScienceBioimagingSelectionSchema,
  lifeScienceSpectraSelectionSchema
])

export type LifeScienceStructuredSelection = z.infer<typeof lifeScienceStructuredSelectionSchema>

const wireSelectionVariant = <Kind extends LifeScienceWorkspacePreviewKind>(
  kind: Kind,
  selectionSchema: z.ZodType<Extract<LifeScienceStructuredSelection, { kind: Kind }>>
) => z.object({
  kind: z.literal('domain'),
  selectionType: z.literal(LIFE_SCIENCE_WORKSPACE_PREVIEW_SELECTION_TYPES[kind]),
  data: z.object({
    wireVersion: z.literal(LIFE_SCIENCE_WORKSPACE_PREVIEW_WIRE_VERSION),
    selection: selectionSchema
  }).strict()
}).strict()

export const lifeScienceWireSelectionSchema = z.union([
  wireSelectionVariant('molecular', lifeScienceMolecularSelectionSchema),
  wireSelectionVariant('sequence', lifeScienceSequenceSelectionSchema),
  wireSelectionVariant('omics', lifeScienceOmicsSelectionSchema),
  wireSelectionVariant('bioimaging', lifeScienceBioimagingSelectionSchema),
  wireSelectionVariant('spectra', lifeScienceSpectraSelectionSchema)
])

export function encodeLifeScienceSelection(
  selection: LifeScienceStructuredSelection
): WorkspaceStructuredSelection {
  const parsed = lifeScienceStructuredSelectionSchema.parse(selection)
  return workspaceStructuredSelectionSchema.parse({
    kind: 'domain',
    selectionType: LIFE_SCIENCE_WORKSPACE_PREVIEW_SELECTION_TYPES[parsed.kind],
    data: {
      wireVersion: LIFE_SCIENCE_WORKSPACE_PREVIEW_WIRE_VERSION,
      selection: parsed
    }
  })
}

export function decodeLifeScienceSelection(
  selection: WorkspaceStructuredSelection | unknown
): LifeScienceStructuredSelection | null {
  const parsed = lifeScienceWireSelectionSchema.safeParse(selection)
  return parsed.success ? parsed.data.data.selection : null
}

export const lifeScienceMolecularObservationSchema = z.object({
  modelCount: z.number().int().nonnegative().optional(),
  chains: z.array(z.string().trim().min(1).max(64)).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  ligands: z.array(z.string().trim().min(1).max(128)).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  representations: z.array(z.string().trim().min(1).max(128)).max(64).optional(),
  truncatedItems: z.boolean().optional()
}).strict()

export const lifeScienceSequenceObservationReferenceSchema = z.object({
  id: idSchema,
  sequenceLength: z.number().int().nonnegative().optional(),
  featureCount: z.number().int().nonnegative().optional(),
  intervalCount: z.number().int().nonnegative().optional(),
  variantCount: z.number().int().nonnegative().optional()
}).strict()

export const lifeScienceSequenceObservationFeatureSchema = z.object({
  id: idSchema.optional(),
  reference: idSchema,
  type: z.string().trim().min(1).max(128),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  strand: z.enum(['+', '-']).optional()
}).strict()

export const lifeScienceSequenceObservationIndexedRangeSchema = z.object({
  kind: z.enum(['sequence', 'read', 'reference', 'feature', 'interval', 'variant']),
  reference: idSchema,
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  id: idSchema.optional(),
  type: z.string().trim().min(1).max(128).optional(),
  strand: z.enum(['+', '-']).optional()
}).strict()

export const lifeScienceSequenceObservationSchema = z.object({
  sequenceCount: z.number().int().nonnegative().optional(),
  totalLength: z.number().int().nonnegative().optional(),
  alphabet: z.enum(['dna', 'rna', 'protein', 'unknown']).optional(),
  references: z.array(lifeScienceSequenceObservationReferenceSchema).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  features: z.array(lifeScienceSequenceObservationFeatureSchema).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  indexedRanges: z.array(lifeScienceSequenceObservationIndexedRangeSchema).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  truncatedRecords: z.boolean().optional(),
  truncatedReferences: z.boolean().optional()
}).strict()

export const lifeScienceOmicsObservationSchema = z.object({
  format: z.string().trim().min(1).max(64).optional(),
  matrixShape: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(),
  matrixIds: z.array(idSchema).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  observationCount: z.number().int().nonnegative().optional(),
  variableCount: z.number().int().nonnegative().optional(),
  obsKeys: z.array(idSchema).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  varKeys: z.array(idSchema).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  embeddings: z.array(z.string().trim().min(1).max(128)).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  metadataKeys: z.array(idSchema).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  truncatedItems: z.boolean().optional()
}).strict()

export const lifeScienceBioimagingObservationSchema = z.object({
  format: z.string().trim().min(1).max(64).optional(),
  detectedBy: z.string().trim().min(1).max(64).optional(),
  byteLength: z.number().int().nonnegative().optional(),
  channels: z.array(z.string().trim().min(1).max(128)).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  dimensions: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    z: z.number().int().positive().optional(),
    t: z.number().int().positive().optional()
  }).strict().optional(),
  tilePlan: z.object({
    status: z.string().trim().min(1).max(64).optional(),
    source: z.string().trim().min(1).max(128).optional(),
    levelCount: z.number().int().nonnegative().optional(),
    tileSize: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive()
    }).strict().optional(),
    pixelDecoding: z.boolean().optional(),
    tileRendererImplemented: z.boolean().optional()
  }).strict().optional(),
  truncatedItems: z.boolean().optional()
}).strict()

const numericRangeSchema = z.object({
  min: z.number().finite(),
  max: z.number().finite()
}).strict()

export const lifeScienceSpectraObservationSchema = z.object({
  format: z.string().trim().min(1).max(64).optional(),
  spectrumCount: z.number().int().nonnegative().optional(),
  peakCount: z.number().int().nonnegative().optional(),
  scanCount: z.number().int().nonnegative().optional(),
  xAxis: z.string().trim().max(128).optional(),
  mzRange: numericRangeSchema.optional(),
  intensityRange: numericRangeSchema.optional(),
  sampledPeaks: z.array(z.object({
    mz: z.number().finite(),
    intensity: z.number().finite(),
    label: z.string().trim().max(128).optional(),
    spectrumIndex: z.number().int().nonnegative().optional(),
    scanIndex: z.number().int().nonnegative().optional(),
    peakIndex: z.number().int().nonnegative().optional()
  }).strict()).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  scanMarkers: z.array(z.object({
    index: z.number().int().nonnegative(),
    id: z.string().trim().max(1000).optional(),
    scanNumber: z.string().trim().max(1000).optional(),
    msLevel: z.string().trim().max(1000).optional(),
    peakCount: z.number().int().nonnegative().optional(),
    mzRange: numericRangeSchema.optional(),
    intensityRange: numericRangeSchema.optional()
  }).strict()).max(LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS).optional(),
  truncatedItems: z.boolean().optional()
}).strict()

export type LifeScienceMolecularObservation = z.infer<typeof lifeScienceMolecularObservationSchema>
export type LifeScienceSequenceObservation = z.infer<typeof lifeScienceSequenceObservationSchema>
export type LifeScienceOmicsObservation = z.infer<typeof lifeScienceOmicsObservationSchema>
export type LifeScienceBioimagingObservation = z.infer<typeof lifeScienceBioimagingObservationSchema>
export type LifeScienceSpectraObservation = z.infer<typeof lifeScienceSpectraObservationSchema>

export type LifeScienceObservationByKind = Readonly<{
  molecular: LifeScienceMolecularObservation
  sequence: LifeScienceSequenceObservation
  omics: LifeScienceOmicsObservation
  bioimaging: LifeScienceBioimagingObservation
  spectra: LifeScienceSpectraObservation
}>

/** The single runtime boundary that bounds package observation arrays before generic JSON validation. */
export function sanitizeLifeScienceObservation<Kind extends LifeScienceWorkspacePreviewKind>(
  kind: Kind,
  observation: LifeScienceObservationByKind[Kind]
): LifeScienceObservationByKind[Kind] {
  switch (kind) {
    case 'molecular': {
      const value = observation as LifeScienceMolecularObservation
      const truncated = value.truncatedItems || exceedsWireLimit(value.chains) || exceedsWireLimit(value.ligands)
      return {
        ...value,
        ...(value.chains ? { chains: value.chains.slice(0, LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS) } : {}),
        ...(value.ligands ? { ligands: value.ligands.slice(0, LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS) } : {}),
        ...(truncated ? { truncatedItems: true } : {})
      } as LifeScienceObservationByKind[Kind]
    }
    case 'sequence': {
      const value = observation as LifeScienceSequenceObservation
      return {
        ...value,
        ...(value.references ? { references: value.references.slice(0, LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS) } : {}),
        ...(value.features ? { features: value.features.slice(0, LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS) } : {}),
        ...(value.indexedRanges ? { indexedRanges: value.indexedRanges.slice(0, LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS) } : {}),
        ...(value.truncatedReferences || exceedsWireLimit(value.references) ? { truncatedReferences: true } : {}),
        ...(value.truncatedRecords || exceedsWireLimit(value.features) || exceedsWireLimit(value.indexedRanges)
          ? { truncatedRecords: true }
          : {})
      } as LifeScienceObservationByKind[Kind]
    }
    case 'omics': {
      const value = observation as LifeScienceOmicsObservation
      const truncated = value.truncatedItems || [
        value.matrixIds,
        value.obsKeys,
        value.varKeys,
        value.embeddings,
        value.metadataKeys
      ].some(exceedsWireLimit)
      return {
        ...value,
        ...(value.matrixIds ? { matrixIds: value.matrixIds.slice(0, LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS) } : {}),
        ...(value.obsKeys ? { obsKeys: value.obsKeys.slice(0, LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS) } : {}),
        ...(value.varKeys ? { varKeys: value.varKeys.slice(0, LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS) } : {}),
        ...(value.embeddings ? { embeddings: value.embeddings.slice(0, LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS) } : {}),
        ...(value.metadataKeys ? { metadataKeys: value.metadataKeys.slice(0, LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS) } : {}),
        ...(truncated ? { truncatedItems: true } : {})
      } as LifeScienceObservationByKind[Kind]
    }
    case 'bioimaging': {
      const value = observation as LifeScienceBioimagingObservation
      return {
        ...value,
        ...(value.channels ? { channels: value.channels.slice(0, LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS) } : {}),
        ...(value.truncatedItems || exceedsWireLimit(value.channels) ? { truncatedItems: true } : {})
      } as LifeScienceObservationByKind[Kind]
    }
    case 'spectra': {
      const value = observation as LifeScienceSpectraObservation
      return {
        ...value,
        ...(value.sampledPeaks ? { sampledPeaks: value.sampledPeaks.slice(0, LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS) } : {}),
        ...(value.scanMarkers ? { scanMarkers: value.scanMarkers.slice(0, LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS) } : {}),
        ...(value.truncatedItems || exceedsWireLimit(value.sampledPeaks) || exceedsWireLimit(value.scanMarkers)
          ? { truncatedItems: true }
          : {})
      } as LifeScienceObservationByKind[Kind]
    }
  }
}

const observationEnvelopeVariant = <Kind extends LifeScienceWorkspacePreviewKind>(
  kind: Kind,
  observationSchema: z.ZodType<LifeScienceObservationByKind[Kind]>
) => z.object({
  wireVersion: z.literal(LIFE_SCIENCE_WORKSPACE_PREVIEW_WIRE_VERSION),
  kind: z.literal(kind),
  observation: observationSchema
}).strict()

export const lifeScienceObservationEnvelopeSchema = z.union([
  observationEnvelopeVariant('molecular', lifeScienceMolecularObservationSchema),
  observationEnvelopeVariant('sequence', lifeScienceSequenceObservationSchema),
  observationEnvelopeVariant('omics', lifeScienceOmicsObservationSchema),
  observationEnvelopeVariant('bioimaging', lifeScienceBioimagingObservationSchema),
  observationEnvelopeVariant('spectra', lifeScienceSpectraObservationSchema)
])

export type LifeScienceObservationEnvelope = z.infer<typeof lifeScienceObservationEnvelopeSchema>

export function encodeLifeScienceObservationMetadata<Kind extends LifeScienceWorkspacePreviewKind>(
  kind: Kind,
  observation: LifeScienceObservationByKind[Kind]
): WorkspacePreviewPluginMetadataItem {
  const sanitizedObservation = sanitizeLifeScienceObservation(kind, observation)
  const envelope = lifeScienceObservationEnvelopeSchema.parse({
    wireVersion: LIFE_SCIENCE_WORKSPACE_PREVIEW_WIRE_VERSION,
    kind,
    observation: sanitizedObservation
  })
  return workspacePreviewPluginMetadataItemSchema.parse({
    source: 'plugin-metadata',
    metadataKind: LIFE_SCIENCE_WORKSPACE_PREVIEW_OBSERVATION_METADATA_KINDS[kind],
    mimeType: 'application/vnd.sciforge.life-science-preview.observation+json',
    metadataOnly: true,
    containsPixels: false,
    pixelDecoding: false,
    data: envelope
  })
}

export function decodeLifeScienceObservationMetadata(
  item: WorkspacePreviewPluginMetadataItem | unknown
): LifeScienceObservationEnvelope | null {
  const parsedItem = workspacePreviewPluginMetadataItemSchema.safeParse(item)
  if (!parsedItem.success) return null
  const envelope = lifeScienceObservationEnvelopeSchema.safeParse(parsedItem.data.data)
  if (!envelope.success) return null
  return LIFE_SCIENCE_WORKSPACE_PREVIEW_OBSERVATION_METADATA_KINDS[envelope.data.kind] === parsedItem.data.metadataKind
    ? envelope.data
    : null
}

type LifeScienceObservationView = Omit<WorkspaceObservation['view'], 'modality'> & {
  modality: WorkspaceObservation['view']['modality'] | LifeScienceWorkspacePreviewKind
}

export type LifeScienceWorkspaceObservation = Omit<WorkspaceObservation, 'view' | 'selection'> & {
  view: LifeScienceObservationView
  selection?: LifeScienceStructuredSelection
  molecular?: LifeScienceMolecularObservation
  sequence?: LifeScienceSequenceObservation
  omics?: LifeScienceOmicsObservation
  bioimaging?: LifeScienceBioimagingObservation
  spectra?: LifeScienceSpectraObservation
}

export function decodeLifeScienceWorkspaceObservation(
  observation: WorkspaceObservation | null
): LifeScienceWorkspaceObservation | null {
  if (!observation) return null
  const expectedKind = lifeScienceKindForPluginId(observation.view.pluginId)
  if (!expectedKind) return observation as LifeScienceWorkspaceObservation
  const envelope = observation.pluginMetadata
    ?.map(decodeLifeScienceObservationMetadata)
    .find((candidate): candidate is LifeScienceObservationEnvelope => candidate?.kind === expectedKind)
  const selection = decodeLifeScienceSelection(observation.selection)
  const { selection: _wireSelection, ...observationWithoutSelection } = observation
  const base = {
    ...observationWithoutSelection,
    view: { ...observation.view, modality: expectedKind },
    ...(selection?.kind === expectedKind ? { selection } : {})
  }
  if (!envelope) return base
  switch (envelope.kind) {
    case 'molecular': return { ...base, molecular: envelope.observation }
    case 'sequence': return { ...base, sequence: envelope.observation }
    case 'omics': return { ...base, omics: envelope.observation }
    case 'bioimaging': return { ...base, bioimaging: envelope.observation }
    case 'spectra': return { ...base, spectra: envelope.observation }
  }
}

export type LifeScienceWorkspacePreviewSetSelectionOperation = Readonly<{
  kind: 'workspace.setSelection'
  path: string
  selection: LifeScienceStructuredSelection
}>

export type LifeScienceWorkspacePreviewEditOperation =
  | Exclude<WorkspacePreviewEditOperation, { kind: 'workspace.setSelection' }>
  | LifeScienceWorkspacePreviewSetSelectionOperation

export function encodeLifeScienceEditOperation(
  operation: LifeScienceWorkspacePreviewEditOperation
): WorkspacePreviewEditOperation {
  if (operation.kind === 'workspace.setSelection') {
    return {
      ...operation,
      selection: encodeLifeScienceSelection(operation.selection)
    }
  }
  if (
    operation.kind === 'domain.applyEdit' &&
    operation.operationType === 'sciforge.life-science-preview.molecular.set-selection' &&
    isRecord(operation.data)
  ) {
    const selection = lifeScienceStructuredSelectionSchema.safeParse(operation.data.selection)
    if (selection.success) {
      return {
        ...operation,
        data: workspacePreviewJsonValueSchema.parse({
          ...operation.data,
          selection: encodeLifeScienceSelection(selection.data)
        })
      }
    }
  }
  return operation
}

/** Converts worker-owned legacy selection objects before an action result crosses the host boundary. */
export function encodeLifeScienceSelectionsInValue(value: unknown): unknown {
  const selection = lifeScienceStructuredSelectionSchema.safeParse(value)
  if (selection.success) return encodeLifeScienceSelection(selection.data)
  if (Array.isArray(value)) return value.map(encodeLifeScienceSelectionsInValue)
  if (!isRecord(value)) return value
  if (isLifeScienceSelectionKind(value.kind)) {
    throw new Error(
      `Life Science ${value.kind} selection does not satisfy the bounded v2 wire contract.`
    )
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, candidate]) => [key, encodeLifeScienceSelectionsInValue(candidate)])
  )
}

/** Decodes only v2 domain selections immediately before calling a package-owned worker. */
export function decodeLifeScienceSelectionsInValue(value: unknown): unknown {
  const selection = decodeLifeScienceSelection(value)
  if (selection) return selection
  if (Array.isArray(value)) return value.map(decodeLifeScienceSelectionsInValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, candidate]) => [key, decodeLifeScienceSelectionsInValue(candidate)])
  )
}

export function lifeScienceKindForPluginId(pluginId: string): LifeScienceWorkspacePreviewKind | null {
  switch (pluginId) {
    case 'molecular': return 'molecular'
    case 'sequence-genomics': return 'sequence'
    case 'omics-matrix': return 'omics'
    case 'bioimaging': return 'bioimaging'
    case 'proteomics-spectra': return 'spectra'
    default: return null
  }
}

export function isLifeScienceWireSelectionForKind<Kind extends LifeScienceWorkspacePreviewKind>(
  selection: WorkspaceStructuredSelection | undefined,
  kind: Kind
): selection is WorkspaceStructuredSelection & { kind: 'domain' } {
  return selection?.kind === 'domain' &&
    String(selection.selectionType) === LIFE_SCIENCE_WORKSPACE_PREVIEW_SELECTION_TYPES[kind] &&
    decodeLifeScienceSelection(selection)?.kind === kind
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function exceedsWireLimit(value: readonly unknown[] | undefined): boolean {
  return (value?.length ?? 0) > LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS
}

function isLifeScienceSelectionKind(value: unknown): value is LifeScienceWorkspacePreviewKind {
  return value === 'molecular' || value === 'sequence' || value === 'omics' ||
    value === 'bioimaging' || value === 'spectra'
}
