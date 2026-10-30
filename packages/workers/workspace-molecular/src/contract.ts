import { z } from 'zod'

export const WORKSPACE_MOLECULAR_CONTRACT_VERSION = 1
export const WORKSPACE_PREVIEW_CONTRACT_VERSION = 1
export const WORKSPACE_MOLECULAR_PLUGIN_ID = 'molecular'
export const WORKSPACE_MOLECULAR_MAX_TEXT_CHARS = 2_000_000
export const WORKSPACE_MOLECULAR_MAX_ITEMS = 10_000
export const WORKSPACE_MOLECULAR_MAX_VISIBLE_TEXT_CHARS = 200_000
export const WORKSPACE_MOLECULAR_MAX_WARNINGS = 20

export const WORKSPACE_MOLECULAR_ACTIONS = [
  'molecular.preview',
  'molecular.workbench'
] as const

const pathSchema = z.string().trim().min(1).max(4096)
const optionalPathSchema = z.string().trim().max(4096).optional()
const boundedWarningSchema = z.string().trim().min(1).max(1000)
const boundedAtomIdSchema = z.string().trim().min(1).max(128)
const boundedAtomNameSchema = z.string().trim().max(64)
const boundedChainIdSchema = z.string().trim().min(1).max(64)
const optionalChainIdSchema = z.string().trim().max(64).optional()
const boundedResidueNameSchema = z.string().trim().min(1).max(32)
const optionalResidueNameSchema = z.string().trim().max(32).optional()
const boundedLigandNameSchema = z.string().trim().min(1).max(64)
const boundedElementSchema = z.string().trim().min(1).max(8)
const optionalElementSchema = z.string().trim().max(8).optional()

export const workspaceMolecularFormatSchema = z.enum([
  'auto',
  'pdb',
  'cif',
  'mmcif',
  'sdf',
  'mol',
  'mol2',
  'xyz',
  'xtc',
  'dcd',
  'trr',
  'mrc',
  'ccp4'
])
export const workspaceMolecularResolvedFormatSchema = z.enum([
  'pdb',
  'cif',
  'mmcif',
  'sdf',
  'mol',
  'mol2',
  'xyz',
  'xtc',
  'dcd',
  'trr',
  'mrc',
  'ccp4',
  'unknown'
])

export const workspaceMolecularPreviewInputSchema = z.object({
  text: z.string().max(WORKSPACE_MOLECULAR_MAX_TEXT_CHARS),
  format: workspaceMolecularFormatSchema.default('auto'),
  includeObservation: z.boolean().default(true),
  path: optionalPathSchema,
  workspaceRoot: optionalPathSchema,
  mimeType: z.string().trim().max(128).optional(),
  size: z.number().finite().nonnegative().optional(),
  mtimeMs: z.number().finite().nonnegative().optional()
}).strict()

export const workspaceMolecularCoordinateSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite()
}).strict()

export const workspaceMolecularAtomSummarySchema = z.object({
  index: z.number().int().nonnegative(),
  id: boundedAtomIdSchema.optional(),
  name: boundedAtomNameSchema.optional(),
  element: boundedElementSchema.optional(),
  chain: optionalChainIdSchema,
  residueName: optionalResidueNameSchema,
  residueIndex: z.number().int().nonnegative().optional(),
  moleculeIndex: z.number().int().nonnegative().optional(),
  coordinates: workspaceMolecularCoordinateSchema.optional()
}).strict()

export const workspaceMolecularResidueSummarySchema = z.object({
  chain: z.string().trim().max(64),
  index: z.number().int().nonnegative(),
  insertionCode: z.string().trim().max(8).optional(),
  name: z.string().trim().max(32),
  atomCount: z.number().int().nonnegative(),
  moleculeIndex: z.number().int().nonnegative().optional(),
  ligand: z.boolean().optional()
}).strict()

export const workspaceMolecularChainSummarySchema = z.object({
  id: boundedChainIdSchema,
  atomCount: z.number().int().nonnegative(),
  residueCount: z.number().int().nonnegative(),
  ligandCount: z.number().int().nonnegative()
}).strict()

export const workspaceMolecularLigandSummarySchema = z.object({
  name: boundedLigandNameSchema,
  atomCount: z.number().int().nonnegative(),
  residueCount: z.number().int().nonnegative(),
  chain: z.string().trim().max(64).optional(),
  moleculeIndex: z.number().int().nonnegative().optional()
}).strict()

export const workspaceMolecularMoleculeSummarySchema = z.object({
  index: z.number().int().nonnegative(),
  title: z.string().trim().max(256).optional(),
  type: z.string().trim().max(64).optional(),
  chargeType: z.string().trim().max(64).optional(),
  atomCount: z.number().int().nonnegative(),
  bondCount: z.number().int().nonnegative().optional(),
  substructureCount: z.number().int().nonnegative().optional(),
  formula: z.string().trim().max(256).optional()
}).strict()

export const workspaceMolecularElementCountSchema = z.object({
  element: boundedElementSchema,
  count: z.number().int().nonnegative()
}).strict()

export const workspaceMolecularAtomSelectorSchema = z.object({
  id: boundedAtomIdSchema.optional(),
  index: z.number().int().min(0).optional(),
  element: optionalElementSchema
}).strict().superRefine((input, context) => {
  if (!input.id && input.index === undefined && !input.element) {
    context.addIssue({
      code: 'custom',
      message: 'atom selector must include id, index, or element'
    })
  }
})

export const workspaceMolecularResidueSelectorSchema = z.object({
  chain: optionalChainIdSchema,
  index: z.number().int().min(0).optional(),
  insertionCode: z.string().trim().max(8).optional(),
  name: optionalResidueNameSchema,
  moleculeIndex: z.number().int().nonnegative().optional()
}).strict().superRefine((input, context) => {
  if (!input.chain && input.index === undefined && !input.insertionCode && !input.name && input.moleculeIndex === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'residue selector must include chain, index, insertionCode, name, or moleculeIndex'
    })
  }
})

export const workspaceMolecularSelectionSchema = z.object({
  kind: z.literal('molecular'),
  chains: z.array(boundedChainIdSchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS).optional(),
  residues: z.array(z.object({
    chain: optionalChainIdSchema,
    index: z.number().int().min(0),
    insertionCode: z.string().trim().max(8).optional(),
    name: optionalResidueNameSchema
  }).strict()).max(WORKSPACE_MOLECULAR_MAX_ITEMS).optional(),
  atoms: z.array(workspaceMolecularAtomSelectorSchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS).optional(),
  ligands: z.array(boundedLigandNameSchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS).optional()
}).strict()

export const workspaceMolecularObservationSchema = z.object({
  schemaVersion: z.literal(WORKSPACE_PREVIEW_CONTRACT_VERSION),
  file: z.object({
    path: pathSchema,
    workspaceRoot: optionalPathSchema,
    mimeType: z.string().trim().max(128).optional(),
    size: z.number().finite().nonnegative().optional(),
    mtimeMs: z.number().finite().nonnegative().optional()
  }).strict(),
  view: z.object({
    pluginId: z.literal(WORKSPACE_MOLECULAR_PLUGIN_ID),
    modality: z.literal('molecular'),
    mode: z.literal('preview'),
    title: z.string().trim().min(1).max(512)
  }).strict(),
  selection: workspaceMolecularSelectionSchema.optional(),
  visibleText: z.string().max(WORKSPACE_MOLECULAR_MAX_VISIBLE_TEXT_CHARS).optional(),
  molecular: z.object({
    modelCount: z.number().int().nonnegative().optional(),
    chains: z.array(z.string().trim().min(1).max(64)).max(WORKSPACE_MOLECULAR_MAX_ITEMS).optional(),
    ligands: z.array(z.string().trim().min(1).max(128)).max(WORKSPACE_MOLECULAR_MAX_ITEMS).optional(),
    representations: z.array(z.string().trim().min(1).max(128)).max(64).optional()
  }).strict(),
  annotations: z.array(z.object({
    id: z.string().trim().min(1).max(256),
    kind: z.string().trim().min(1).max(128),
    summary: z.string().trim().max(1000).optional()
  }).strict()).max(WORKSPACE_MOLECULAR_MAX_ITEMS).optional(),
  actions: z.array(z.string().trim().min(1).max(128)).max(256)
}).strict()

export const workspaceMolecularPreviewResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_MOLECULAR_CONTRACT_VERSION),
  format: workspaceMolecularResolvedFormatSchema,
  atomCount: z.number().int().nonnegative(),
  residueCount: z.number().int().nonnegative(),
  chainCount: z.number().int().nonnegative(),
  ligandCount: z.number().int().nonnegative(),
  moleculeCount: z.number().int().nonnegative(),
  modelCount: z.number().int().nonnegative(),
  chainIds: z.array(z.string().trim().min(1).max(64)).max(WORKSPACE_MOLECULAR_MAX_ITEMS),
  ligands: z.array(z.string().trim().min(1).max(128)).max(WORKSPACE_MOLECULAR_MAX_ITEMS),
  atoms: z.array(workspaceMolecularAtomSummarySchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS),
  residues: z.array(workspaceMolecularResidueSummarySchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS),
  chains: z.array(workspaceMolecularChainSummarySchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS),
  ligandSummaries: z.array(workspaceMolecularLigandSummarySchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS),
  molecules: z.array(workspaceMolecularMoleculeSummarySchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS),
  elementCounts: z.array(workspaceMolecularElementCountSchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS),
  warnings: z.array(boundedWarningSchema).max(WORKSPACE_MOLECULAR_MAX_WARNINGS),
  observation: workspaceMolecularObservationSchema.optional()
}).strict()

export const workspaceMolecularSelectionRequestSchema = z.object({
  chains: z.array(boundedChainIdSchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS).default([]),
  residues: z.array(workspaceMolecularResidueSelectorSchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS).default([]),
  ligands: z.array(boundedLigandNameSchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS).default([]),
  atoms: z.array(workspaceMolecularAtomSelectorSchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS).default([])
}).strict().superRefine((input, context) => {
  if (input.chains.length === 0 && input.residues.length === 0 && input.ligands.length === 0 && input.atoms.length === 0) {
    context.addIssue({
      code: 'custom',
      message: 'selection input must include at least one chain, residue, ligand, or atom selector'
    })
  }
})

export const workspaceMolecularAtomReferenceSchema = z.object({
  id: boundedAtomIdSchema.optional(),
  index: z.number().int().min(0).optional()
}).strict().superRefine((input, context) => {
  if (!input.id && input.index === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'atom reference must include id or index'
    })
  }
})

export const workspaceMolecularMeasurementKindSchema = z.enum(['distance', 'angle', 'dihedral'])

export const workspaceMolecularMeasurementRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('distance'),
    atoms: z.tuple([workspaceMolecularAtomReferenceSchema, workspaceMolecularAtomReferenceSchema])
  }).strict(),
  z.object({
    kind: z.literal('angle'),
    atoms: z.tuple([
      workspaceMolecularAtomReferenceSchema,
      workspaceMolecularAtomReferenceSchema,
      workspaceMolecularAtomReferenceSchema
    ])
  }).strict(),
  z.object({
    kind: z.literal('dihedral'),
    atoms: z.tuple([
      workspaceMolecularAtomReferenceSchema,
      workspaceMolecularAtomReferenceSchema,
      workspaceMolecularAtomReferenceSchema,
      workspaceMolecularAtomReferenceSchema
    ])
  }).strict()
])

export const workspaceMolecularMeasurementStateSchema = z.object({
  kind: workspaceMolecularMeasurementKindSchema,
  coordinateAvailable: z.boolean(),
  atoms: z.array(workspaceMolecularAtomSummarySchema).max(4),
  selection: workspaceMolecularSelectionSchema,
  value: z.number().finite().optional(),
  unit: z.enum(['angstrom', 'degree']),
  warnings: z.array(boundedWarningSchema).max(WORKSPACE_MOLECULAR_MAX_WARNINGS).optional()
}).strict()

export const workspaceMolecularWorkbenchStateSchema = z.object({
  selection: workspaceMolecularSelectionSchema.optional(),
  measurement: workspaceMolecularMeasurementStateSchema.optional()
}).strict()

export const workspaceMolecularWorkbenchInputSchema = z.object({
  preview: workspaceMolecularPreviewResultSchema,
  selection: workspaceMolecularSelectionRequestSchema.optional(),
  measurement: workspaceMolecularMeasurementRequestSchema.optional()
}).strict().superRefine((input, context) => {
  if (!input.selection && !input.measurement) {
    context.addIssue({
      code: 'custom',
      message: 'workbench input must include selection or measurement'
    })
  }
})

export const workspaceMolecularWorkbenchResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_MOLECULAR_CONTRACT_VERSION),
  atomCount: z.number().int().nonnegative(),
  residueCount: z.number().int().nonnegative(),
  chainCount: z.number().int().nonnegative(),
  ligandCount: z.number().int().nonnegative(),
  atoms: z.array(workspaceMolecularAtomSummarySchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS),
  residues: z.array(workspaceMolecularResidueSummarySchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS),
  chains: z.array(workspaceMolecularChainSummarySchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS),
  ligands: z.array(workspaceMolecularLigandSummarySchema).max(WORKSPACE_MOLECULAR_MAX_ITEMS),
  state: workspaceMolecularWorkbenchStateSchema,
  visibleText: z.string().max(WORKSPACE_MOLECULAR_MAX_VISIBLE_TEXT_CHARS).optional(),
  warnings: z.array(boundedWarningSchema).max(WORKSPACE_MOLECULAR_MAX_WARNINGS)
}).strict()

export type WorkspaceMolecularFormat = z.infer<typeof workspaceMolecularFormatSchema>
export type WorkspaceMolecularResolvedFormat = z.infer<typeof workspaceMolecularResolvedFormatSchema>
export type WorkspaceMolecularPreviewInput = z.input<typeof workspaceMolecularPreviewInputSchema>
export type NormalizedWorkspaceMolecularPreviewInput = z.output<typeof workspaceMolecularPreviewInputSchema>
export type WorkspaceMolecularCoordinate = z.infer<typeof workspaceMolecularCoordinateSchema>
export type WorkspaceMolecularAtomSummary = z.infer<typeof workspaceMolecularAtomSummarySchema>
export type WorkspaceMolecularResidueSummary = z.infer<typeof workspaceMolecularResidueSummarySchema>
export type WorkspaceMolecularChainSummary = z.infer<typeof workspaceMolecularChainSummarySchema>
export type WorkspaceMolecularLigandSummary = z.infer<typeof workspaceMolecularLigandSummarySchema>
export type WorkspaceMolecularMoleculeSummary = z.infer<typeof workspaceMolecularMoleculeSummarySchema>
export type WorkspaceMolecularElementCount = z.infer<typeof workspaceMolecularElementCountSchema>
export type WorkspaceMolecularAtomSelector = z.input<typeof workspaceMolecularAtomSelectorSchema>
export type NormalizedWorkspaceMolecularAtomSelector = z.output<typeof workspaceMolecularAtomSelectorSchema>
export type WorkspaceMolecularResidueSelector = z.input<typeof workspaceMolecularResidueSelectorSchema>
export type NormalizedWorkspaceMolecularResidueSelector = z.output<typeof workspaceMolecularResidueSelectorSchema>
export type WorkspaceMolecularSelection = z.infer<typeof workspaceMolecularSelectionSchema>
export type WorkspaceMolecularObservation = z.infer<typeof workspaceMolecularObservationSchema>
export type WorkspaceMolecularPreviewResult = z.infer<typeof workspaceMolecularPreviewResultSchema>
export type WorkspaceMolecularSelectionRequest = z.input<typeof workspaceMolecularSelectionRequestSchema>
export type NormalizedWorkspaceMolecularSelectionRequest = z.output<typeof workspaceMolecularSelectionRequestSchema>
export type WorkspaceMolecularAtomReference = z.input<typeof workspaceMolecularAtomReferenceSchema>
export type NormalizedWorkspaceMolecularAtomReference = z.output<typeof workspaceMolecularAtomReferenceSchema>
export type WorkspaceMolecularMeasurementKind = z.infer<typeof workspaceMolecularMeasurementKindSchema>
export type WorkspaceMolecularMeasurementRequest = z.input<typeof workspaceMolecularMeasurementRequestSchema>
export type NormalizedWorkspaceMolecularMeasurementRequest = z.output<typeof workspaceMolecularMeasurementRequestSchema>
export type WorkspaceMolecularMeasurementState = z.infer<typeof workspaceMolecularMeasurementStateSchema>
export type WorkspaceMolecularWorkbenchState = z.infer<typeof workspaceMolecularWorkbenchStateSchema>
export type WorkspaceMolecularWorkbenchInput = z.input<typeof workspaceMolecularWorkbenchInputSchema>
export type NormalizedWorkspaceMolecularWorkbenchInput = z.output<typeof workspaceMolecularWorkbenchInputSchema>
export type WorkspaceMolecularWorkbenchResult = z.infer<typeof workspaceMolecularWorkbenchResultSchema>
