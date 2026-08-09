import { z } from 'zod'
import {
  artifactVersionCommitResultV1Schema,
  artifactVersionRefV1Schema
} from '@sciforge/domain-artifact-versions/contract'
import type { VisualScene } from '@sciforge/image-generation/visual-scene'
import {
  SCIENTIFIC_PLOTTING_TEMPLATES,
  type ScientificPlottingCompareResult,
  type ScientificPlottingDataMappingResult,
  type ScientificPlottingRenderResult,
  type ScientificPlottingRerunResult,
  type ScientificPlottingStatusResult
} from './types.js'

export { SCIENTIFIC_PLOTTING_TEMPLATES } from './types.js'
export type * from './types.js'

export const SCIENTIFIC_SKILLS_MCP_FLAG = '--scientific-skills-mcp-server'
export const SCIENTIFIC_PLOTTING_MCP_FLAG = '--scientific-plotting-mcp-server'

export const SCIENTIFIC_SKILLS_TOOL_SIDE_EFFECTS = {
  scientific_skills_status: 'read',
  scientific_skills_search: 'read',
  scientific_skills_read: 'read',
  scientific_skills_plan: 'read'
} as const

export const SCIENTIFIC_PLOTTING_TOOL_SIDE_EFFECTS = {
  scientific_plotting_style_profiles: 'read',
  scientific_plotting_composite: 'controlled-write',
  scientific_plotting_prepare_reference: 'controlled-write',
  scientific_plotting_review_packet: 'controlled-write'
} as const

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const pathSchema = z.string().trim().min(1).max(8_192)
const identifierSchema = z.string().trim().min(1).max(256)
export const scientificPlottingOperationIdSchema = z.string()
  .trim()
  .min(16)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'operationId contains unsafe characters.')

export const scientificPlottingTemplateSchema = z.enum(SCIENTIFIC_PLOTTING_TEMPLATES)

const normalizedCoordinateSchema = z.number().finite().min(0).max(1)
const visualScenePrimitiveStyleShape = {
  fill: z.string().trim().min(1).max(120).optional(),
  stroke: z.string().trim().min(1).max(120).optional(),
  strokeWidth: z.number().finite().nonnegative().max(64).optional(),
  opacity: normalizedCoordinateSchema.optional(),
  z: z.number().finite().optional()
} as const

const visualScenePointSchema = z.object({
  x: normalizedCoordinateSchema,
  y: normalizedCoordinateSchema
}).strict()

const visualScenePrimitiveSchema = z.union([
  z.object({
    id: identifierSchema,
    type: z.enum(['rectangle', 'ellipse', 'triangle']),
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
    width: normalizedCoordinateSchema.gt(0),
    height: normalizedCoordinateSchema.gt(0),
    ...visualScenePrimitiveStyleShape
  }).strict(),
  z.object({
    id: identifierSchema,
    type: z.literal('circle'),
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
    radius: normalizedCoordinateSchema.gt(0),
    ...visualScenePrimitiveStyleShape
  }).strict(),
  z.object({
    id: identifierSchema,
    type: z.literal('polygon'),
    points: z.array(visualScenePointSchema).min(3).max(256),
    ...visualScenePrimitiveStyleShape
  }).strict(),
  z.object({
    id: identifierSchema,
    type: z.enum(['line', 'arrow']),
    x1: normalizedCoordinateSchema,
    y1: normalizedCoordinateSchema,
    x2: normalizedCoordinateSchema,
    y2: normalizedCoordinateSchema,
    ...visualScenePrimitiveStyleShape
  }).strict(),
  z.object({
    id: identifierSchema,
    type: z.literal('text'),
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
    text: z.string().trim().min(1).max(4_000),
    fontSize: z.number().finite().positive().max(256).optional(),
    textColor: z.string().trim().min(1).max(120).optional(),
    horizontalAlign: z.enum(['left', 'center', 'right']).optional(),
    verticalAlign: z.enum(['top', 'center', 'bottom']).optional(),
    ...visualScenePrimitiveStyleShape
  }).strict(),
  z.object({
    id: identifierSchema,
    type: z.literal('image'),
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
    width: normalizedCoordinateSchema.gt(0),
    height: normalizedCoordinateSchema.gt(0),
    prompt: z.string().trim().min(1).max(8_000),
    sourceArtifact: pathSchema.optional(),
    ...visualScenePrimitiveStyleShape
  }).strict()
])

export const scientificPlottingVisualSceneSchema: z.ZodType<VisualScene> = z.object({
  version: z.literal(1),
  coordinateSystem: z.literal('normalized'),
  canvas: z.object({
    width: z.number().finite().positive().max(16_384),
    height: z.number().finite().positive().max(16_384),
    background: z.string().trim().min(1).max(120).optional()
  }).strict(),
  layers: z.array(z.object({
    id: identifierSchema,
    owner: z.enum(['code', 'model']),
    z: z.number().finite().optional(),
    primitives: z.array(visualScenePrimitiveSchema).max(500)
  }).strict()).min(1).max(64)
}).strict().superRefine((scene, context) => {
  const ids = new Set<string>()
  let primitiveCount = 0
  scene.layers.forEach((layer, layerIndex) => {
    if (ids.has(layer.id)) {
      context.addIssue({
        code: 'custom',
        path: ['layers', layerIndex, 'id'],
        message: `Duplicate VisualScene id: ${layer.id}`
      })
    }
    ids.add(layer.id)
    primitiveCount += layer.primitives.length
    layer.primitives.forEach((primitive, primitiveIndex) => {
      if (ids.has(primitive.id)) {
        context.addIssue({
          code: 'custom',
          path: ['layers', layerIndex, 'primitives', primitiveIndex, 'id'],
          message: `Duplicate VisualScene id: ${primitive.id}`
        })
      }
      ids.add(primitive.id)
    })
  })
  if (primitiveCount === 0 || primitiveCount > 500) {
    context.addIssue({
      code: 'custom',
      path: ['layers'],
      message: 'VisualScene must contain between 1 and 500 primitives in total.'
    })
  }
})

export const controlledPlottingPlanSchema = z.object({
  planId: z.string().trim().min(1).max(160),
  route: z.enum(['code', 'hybrid']),
  routeLocked: z.literal(true),
  rationale: z.string().trim().min(1).max(2_000),
  sourceArtifacts: z.array(pathSchema).max(64),
  reproducibleInputs: z.array(z.string().trim().min(1).max(1_000)).max(64),
  inlineSpecification: z.string().trim().min(1).max(16_000).optional(),
  structuredData: z.unknown().optional(),
  scene: scientificPlottingVisualSceneSchema.optional(),
  lockedElements: z.array(z.string().trim().min(1).max(1_000)).max(64),
  modelOwnedElements: z.array(z.string().trim().min(1).max(1_000)).max(64),
  contextStatus: z.enum(['ready', 'budget_exhausted']),
  contextStopReason: z.enum([
    'sufficient',
    'policy_closed',
    'round_limit',
    'cost_limit',
    'token_limit',
    'elapsed_time_limit',
    'no_information_gain'
  ]),
  contextEvidenceIds: z.array(z.string().trim().min(1).max(160)).max(128),
  unresolvedContext: z.array(z.string().trim().min(1).max(2_000)).max(64),
  releaseCeiling: z.enum(['publication_ready', 'draft_ready']),
  fallbackPolicy: z.literal('fail_closed')
}).strict()

const dataSourceSelectionSchema = z.object({
  sheet: z.string().trim().min(1).max(512).optional(),
  columns: z.array(z.string().trim().min(1).max(512)).max(10_000).optional(),
  rowFilter: z.string().trim().min(1).max(16_000).optional()
}).strict()

const dataSourceBaseShape = {
  schemaVersion: z.literal(1),
  sourceId: identifierSchema,
  locator: pathSchema,
  sha256: sha256Schema,
  datasetVersion: z.string().trim().min(1).max(512).optional(),
  mediaType: z.string().trim().min(1).max(256).optional(),
  selection: dataSourceSelectionSchema.optional()
} as const

export const dataSourceRefSchema = z.discriminatedUnion('kind', [
  z.object({ ...dataSourceBaseShape, kind: z.literal('workspace-file') }).strict(),
  z.object({ ...dataSourceBaseShape, kind: z.literal('inline') }).strict(),
  z.object({
    ...dataSourceBaseShape,
    kind: z.literal('artifact-version'),
    artifactVersion: artifactVersionRefV1Schema
  }).strict()
]).superRefine((source, context) => {
  if (source.kind === 'artifact-version' && source.sha256 !== source.artifactVersion.contentDigest) {
    context.addIssue({
      code: 'custom',
      path: ['sha256'],
      message: 'sha256 must equal artifactVersion.contentDigest.'
    })
  }
})

export const scientificPlotTransformationV1Schema = z.object({
  schemaVersion: z.literal(1),
  transformationId: identifierSchema,
  kind: z.enum([
    'identity',
    'tabular-map',
    'matrix-map',
    'vector-map',
    'scene-map',
    'group-aggregate',
    'caller-supplied'
  ]),
  description: z.string().trim().min(1).max(8_000),
  parameters: z.record(z.string(), z.unknown()),
  inputHash: sha256Schema,
  outputHash: sha256Schema
}).strict()

export const derivedTableReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  receiptId: identifierSchema,
  inputSourceIds: z.array(identifierSchema).min(1).max(1_024),
  operation: scientificPlotTransformationV1Schema.shape.kind,
  inputHash: sha256Schema,
  outputHash: sha256Schema,
  transformationIds: z.array(identifierSchema).min(1).max(1_024),
  rowCount: z.number().int().nonnegative().optional(),
  columnCount: z.number().int().nonnegative().optional(),
  columns: z.array(z.string().trim().min(1).max(512)).max(10_000).optional(),
  warnings: z.array(z.string().trim().min(1).max(4_000)).max(256)
}).strict()

export const statisticalResultRefV1Schema = z.object({
  sourceId: identifierSchema,
  locator: pathSchema,
  sha256: sha256Schema,
  resultKey: z.string().trim().min(1).max(512).optional()
}).strict()

export const statisticalDefinitionV1Schema = z.object({
  schemaVersion: z.literal(1),
  estimator: z.enum(['none', 'raw', 'mean', 'median', 'count', 'density']),
  aggregation: z.object({
    method: z.enum(['none', 'mean', 'median', 'sum', 'count']),
    groupBy: z.array(z.string().trim().min(1).max(512)).max(128)
  }).strict().optional(),
  uncertainty: z.object({
    kind: z.enum(['sd', 'sem', 'ci']),
    confidenceLevel: z.number().gt(0).lt(1).optional(),
    sourceColumn: z.string().trim().min(1).max(512).optional(),
    suppliedBy: z.enum(['source', 'computed'])
  }).strict().superRefine((uncertainty, context) => {
    if (uncertainty.kind === 'ci' && uncertainty.confidenceLevel === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['confidenceLevel'],
        message: 'CI uncertainty requires confidenceLevel.'
      })
    }
    if (uncertainty.kind !== 'ci' && uncertainty.confidenceLevel !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['confidenceLevel'],
        message: 'confidenceLevel is only valid for CI uncertainty.'
      })
    }
  }).optional(),
  comparisons: z.array(z.object({
    comparisonId: identifierSchema,
    groups: z.tuple([z.string().trim().min(1), z.string().trim().min(1)]),
    test: z.string().trim().min(1).max(512),
    alternative: z.enum(['two-sided', 'less', 'greater']),
    correction: z.string().trim().min(1).max(512).optional(),
    alpha: z.number().gt(0).lt(1).optional(),
    resultRef: statisticalResultRefV1Schema
  }).strict()).max(1_024).optional(),
  missingValues: z.enum(['reject', 'drop', 'explicit']),
  sampleUnit: z.string().trim().min(1).max(512).optional(),
  seed: z.number().int().safe().optional(),
  notes: z.array(z.string().trim().min(1).max(4_000)).max(256).optional()
}).strict()

export const scientificPlotEnvironmentV1Schema = z.object({
  schemaVersion: z.literal(1),
  pythonCommand: z.string().trim().min(1).max(4_096),
  pythonExecutable: pathSchema,
  pythonVersion: z.string().trim().min(1).max(512),
  platform: z.string().trim().min(1).max(2_000),
  packages: z.record(z.string().trim().min(1).max(256), z.string().trim().min(1).max(512)),
  fontFingerprint: sha256Schema,
  environmentDigest: sha256Schema
}).strict()

export const scientificPlotExecutionV1Schema = z.object({
  schemaVersion: z.literal(1),
  renderer: z.literal('sciforge-scientific-plotting-mcp'),
  rendererVersion: z.string().trim().min(1).max(256),
  rendererCodeSha256: sha256Schema,
  command: z.array(z.string().max(8_192)).min(1).max(64),
  cwd: pathSchema,
  timeoutMs: z.number().int().positive().max(10 * 60_000)
}).strict()

const matplotlibRcParamValueSchema = z.union([z.string(), z.number().finite(), z.boolean()])

export const scientificPlotMatplotlibParametersV1Schema = z.object({
  schemaVersion: z.literal(1),
  rcParams: z.record(z.string().trim().min(1).max(256), matplotlibRcParamValueSchema),
  palette: z.array(z.string().trim().min(1).max(128)).min(1).max(256),
  heatmapCmap: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('named'),
      name: z.string().trim().min(1).max(256)
    }).strict(),
    z.object({
      kind: z.literal('linear-segmented'),
      name: z.enum(['sciforge_style_heatmap', 'sciforge_attention_map']),
      colors: z.array(z.string().trim().min(1).max(128)).min(2).max(256)
    }).strict()
  ]).optional()
}).strict()

export const scientificPlottingLabelsSchema = z.object({
  title: z.string().trim().max(300).optional(),
  x: z.string().trim().max(200).optional(),
  y: z.string().trim().max(200).optional(),
  legend: z.boolean().optional(),
  panel: z.string().trim().max(16).optional()
}).strict()

const boundedScoreSchema = z.number().finite().min(0).max(1)
const finiteNonnegativeSchema = z.number().finite().nonnegative()

export const figureStyleSpecSchema = z.object({
  version: z.literal(1),
  source: z.object({
    path: pathSchema,
    type: z.enum(['image', 'pdf']),
    figureId: identifierSchema.optional(),
    notes: z.string().trim().min(1).max(8_000).optional()
  }).strict(),
  canvas: z.object({
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    aspectRatio: z.number().finite().positive(),
    background: z.string().trim().min(1).max(120)
  }).strict(),
  palette: z.object({
    colors: z.array(z.string().trim().min(1).max(120)).min(1).max(256),
    background: z.string().trim().min(1).max(120),
    ink: z.string().trim().min(1).max(120),
    accent: z.array(z.string().trim().min(1).max(120)).max(256),
    colorMode: z.enum(['monochrome', 'limited', 'multi-hue'])
  }).strict(),
  typography: z.object({
    fontFamily: z.string().trim().min(1).max(512),
    axisSize: z.number().finite().positive(),
    labelSize: z.number().finite().positive(),
    titleSize: z.number().finite().positive(),
    weight: z.enum(['regular', 'medium', 'bold'])
  }).strict(),
  layout: z.object({
    panelGrid: z.string().trim().min(1).max(256),
    panelLabels: z.enum(['none', 'A/B/C', 'a/b/c', 'numeric', 'unknown']),
    margin: z.object({
      left: finiteNonnegativeSchema,
      right: finiteNonnegativeSchema,
      top: finiteNonnegativeSchema,
      bottom: finiteNonnegativeSchema
    }).strict(),
    gutter: z.enum(['compact', 'balanced', 'spacious'])
  }).strict(),
  axes: z.object({
    spine: z.enum(['none', 'left-bottom', 'box', 'minimal', 'unknown']),
    tickDirection: z.enum(['in', 'out', 'none', 'unknown']),
    grid: z.boolean(),
    gridTone: z.enum(['none', 'light', 'medium']),
    gridColor: z.string().trim().min(1).max(120),
    gridAlpha: boundedScoreSchema,
    gridLineWidth: finiteNonnegativeSchema
  }).strict(),
  marks: z.object({
    lineWidth: finiteNonnegativeSchema,
    markerSize: finiteNonnegativeSchema,
    errorBarStyle: z.enum(['none', 'caps', 'unknown']),
    density: z.enum(['sparse', 'balanced', 'dense'])
  }).strict(),
  annotations: z.object({
    significance: z.enum(['none', 'stars', 'brackets', 'unknown']),
    legend: z.enum(['none', 'frameless', 'boxed', 'unknown'])
  }).strict(),
  export: z.object({
    formats: z.array(z.enum(['pdf', 'svg', 'png'])).min(1).max(3),
    dpi: z.number().int().positive().max(10_000),
    transparent: z.boolean()
  }).strict(),
  confidence: z.object({
    overall: boundedScoreSchema,
    palette: boundedScoreSchema,
    layout: boundedScoreSchema,
    axes: boundedScoreSchema,
    typography: boundedScoreSchema
  }).strict()
}).strict()

const scientificPlottingReferenceProfileSchema = z.object({
  kind: z.enum(['chart', 'matrix', 'schematic', 'mixed', 'unknown']),
  recommendedTemplate: scientificPlottingTemplateSchema,
  confidence: boundedScoreSchema,
  detectedTraits: z.object({
    aspect: z.enum(['wide', 'tall', 'balanced']),
    background: z.enum(['light', 'dark', 'mid']),
    axes: z.enum(['measured', 'minimal', 'none', 'unknown']),
    grid: z.enum(['none', 'light', 'medium']),
    markDensity: z.enum(['sparse', 'balanced', 'dense']),
    colorMode: z.enum(['monochrome', 'limited', 'multi-hue']),
    panelGrid: z.string().trim().min(1).max(256),
    textSignals: z.array(scientificPlottingTemplateSchema).max(SCIENTIFIC_PLOTTING_TEMPLATES.length)
  }).strict().optional(),
  reasons: z.array(z.string().trim().min(1).max(4_000)).max(256),
  risks: z.array(z.string().trim().min(1).max(4_000)).max(256)
}).strict()

const scientificPlottingTemplateAdviceSchema = z.object({
  selectedTemplate: scientificPlottingTemplateSchema,
  referenceRecommendedTemplate: scientificPlottingTemplateSchema.optional(),
  compatible: z.boolean(),
  severity: z.enum(['info', 'warning']),
  messages: z.array(z.string().trim().min(1).max(4_000)).max(256),
  nextActions: z.array(z.string().trim().min(1).max(4_000)).max(256)
}).strict()

const scientificPlottingStyleProfileSummarySchema = z.object({
  id: identifierSchema,
  name: z.string().trim().min(1).max(512),
  venue: z.string().trim().min(1).max(512),
  sourceLabel: z.string().trim().min(1).max(1_000),
  description: z.string().trim().min(1).max(8_000),
  recommendedTemplates: z.array(scientificPlottingTemplateSchema).max(SCIENTIFIC_PLOTTING_TEMPLATES.length),
  tags: z.array(z.string().trim().min(1).max(256)).max(256),
  styleSpec: figureStyleSpecSchema.optional(),
  referenceProfile: scientificPlottingReferenceProfileSchema,
  cautions: z.array(z.string().trim().min(1).max(4_000)).max(256)
}).strict()

const scientificPlottingStyleProfileMatchSchema = z.object({
  profileId: identifierSchema,
  profile: scientificPlottingStyleProfileSummarySchema,
  score: boundedScoreSchema,
  reasons: z.array(z.string().trim().min(1).max(4_000)).max(256),
  cautions: z.array(z.string().trim().min(1).max(4_000)).max(256)
}).strict()

export const scientificPlotRecipeV1Schema = z.object({
  schemaVersion: z.literal(1),
  recipeId: z.string().startsWith('plot-recipe:'),
  figureId: identifierSchema,
  template: scientificPlottingTemplateSchema,
  data: z.unknown(),
  dataHash: sha256Schema,
  labels: scientificPlottingLabelsSchema,
  visualPlan: controlledPlottingPlanSchema,
  dataSources: z.array(dataSourceRefSchema).min(1).max(1_024),
  derivedTables: z.array(derivedTableReceiptSchema).min(1).max(1_024),
  transformations: z.array(scientificPlotTransformationV1Schema).min(1).max(1_024),
  statistics: statisticalDefinitionV1Schema.optional(),
  style: z.object({
    resolvedSpec: figureStyleSpecSchema,
    resolvedSpecHash: sha256Schema,
    styleProfileId: identifierSchema.optional(),
    styleSpecPath: pathSchema.optional(),
    referencePath: pathSchema.optional()
  }).strict(),
  render: z.object({
    outputScale: z.number().min(1).max(4),
    // Optional for manifests produced before concrete Matplotlib parameters
    // became part of ScientificPlotRecipeV1. New recipes always include it.
    matplotlib: scientificPlotMatplotlibParametersV1Schema.optional(),
    autoRepair: z.object({
      enabled: z.boolean(),
      maxAttempts: z.union([z.literal(0), z.literal(1)]),
      minOverall: z.number().min(0.5).max(0.98).optional()
    }).strict(),
    reviewTask: z.string().trim().min(1).max(16_000).optional()
  }).strict(),
  environment: scientificPlotEnvironmentV1Schema,
  execution: scientificPlotExecutionV1Schema,
  reproducibilityMode: z.enum(['standard', 'reproducible']),
  provenanceWarnings: z.array(z.string().trim().min(1).max(4_000)).max(256)
}).strict()

export const scientificPlotVersioningRequestV1Schema = z.object({
  artifactId: z.string().trim().startsWith('artifact:').optional(),
  expectedCurrentVersionId: z.string().trim().startsWith('artifact-version:').nullable().optional(),
  intent: z.enum(['save', 'observe', 'rerun', 'restore', 'import']).optional()
}).strict().superRefine((versioning, context) => {
  if (versioning.artifactId && versioning.expectedCurrentVersionId === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['expectedCurrentVersionId'],
      message: 'Existing plot artifacts require expectedCurrentVersionId.'
    })
  }
  if (!versioning.artifactId && versioning.expectedCurrentVersionId != null) {
    context.addIssue({
      code: 'custom',
      path: ['expectedCurrentVersionId'],
      message: 'New plot artifacts cannot declare an expected current version.'
    })
  }
})

const autoRepairSchema = z.object({
  enabled: z.boolean().optional(),
  maxAttempts: z.union([z.literal(0), z.literal(1)]).optional(),
  minOverall: z.number().min(0.5).max(0.98).optional()
}).strict()

const commonPlotRequestShape = {
  workspaceRoot: pathSchema.optional(),
  operationId: scientificPlottingOperationIdSchema,
  visualPlan: controlledPlottingPlanSchema,
  data: z.unknown(),
  reproducibilityMode: z.enum(['standard', 'reproducible']).optional(),
  dataSources: z.array(dataSourceRefSchema).min(1).max(1_024).optional(),
  derivedTableReceipts: z.array(derivedTableReceiptSchema).max(1_024).optional(),
  transformations: z.array(scientificPlotTransformationV1Schema).max(1_024).optional(),
  statistics: statisticalDefinitionV1Schema.optional(),
  provenanceWarnings: z.array(z.string().trim().min(1).max(4_000)).max(256).optional(),
  versioning: scientificPlotVersioningRequestV1Schema.optional(),
  labels: scientificPlottingLabelsSchema.optional(),
  styleSpec: figureStyleSpecSchema.optional(),
  styleSpecPath: pathSchema.optional(),
  styleProfileId: identifierSchema.optional(),
  referencePath: pathSchema.optional(),
  reviewReferencePath: pathSchema.optional(),
  figureId: z.string().trim().min(1).max(120).optional(),
  outputDir: pathSchema.optional(),
  outputScale: z.number().min(1).max(4).optional(),
  visualDocumentId: identifierSchema.optional(),
  runtimeId: identifierSchema.optional(),
  threadId: identifierSchema.optional(),
  autoRepair: autoRepairSchema.optional()
} as const

function validateEvidenceRoutingPair(
  value: { runtimeId?: string; threadId?: string },
  context: z.RefinementCtx
): void {
  if (Boolean(value.runtimeId) === Boolean(value.threadId)) return
  context.addIssue({
    code: 'custom',
    path: value.runtimeId ? ['threadId'] : ['runtimeId'],
    message: 'runtimeId and threadId must be supplied together for Evidence delivery.'
  })
}

export const scientificPlottingMapDataRequestSchema = z.object({
  ...commonPlotRequestShape,
  task: z.string().trim().min(1).max(16_000),
  templateHint: scientificPlottingTemplateSchema.optional()
}).strict().superRefine(validateEvidenceRoutingPair)

export const scientificPlottingRenderRequestSchema = z.object({
  ...commonPlotRequestShape,
  template: scientificPlottingTemplateSchema,
  matplotlib: scientificPlotMatplotlibParametersV1Schema.optional(),
  reviewTask: z.string().trim().min(1).max(16_000).optional()
}).strict().superRefine(validateEvidenceRoutingPair)

export const scientificPlottingRerunRequestSchema = z.object({
  workspaceRoot: pathSchema.optional(),
  operationId: scientificPlottingOperationIdSchema,
  baselineFigureVersionRef: artifactVersionRefV1Schema,
  recipeVersionRef: artifactVersionRefV1Schema,
  expectedCurrentVersionId: z.string().trim().startsWith('artifact-version:'),
  runtimeId: identifierSchema.optional(),
  threadId: identifierSchema.optional()
}).strict().superRefine(validateEvidenceRoutingPair)

export const scientificPlottingCompareRequestSchema = z.object({
  workspaceRoot: pathSchema.optional(),
  baselineManifestVersionRef: artifactVersionRefV1Schema,
  candidateManifestVersionRef: artifactVersionRefV1Schema
}).strict()

const plottingComparisonSchema = z.object({
  exactOutput: z.boolean(),
  recipeEquivalent: z.boolean(),
  dataEquivalent: z.boolean(),
  sourcesEquivalent: z.boolean(),
  transformationsEquivalent: z.boolean(),
  statisticsEquivalent: z.boolean(),
  styleEquivalent: z.boolean(),
  environmentEquivalent: z.boolean(),
  changedSections: z.array(z.enum([
    'output',
    'recipe',
    'data',
    'sources',
    'transformations',
    'statistics',
    'style',
    'environment'
  ]))
}).strict()

const versionCommitReceiptSchema = z.object({
  contract: z.literal('artifact-versions.commit'),
  candidateIds: z.object({
    derivedData: z.string(),
    recipe: z.string(),
    figure: z.string(),
    renderManifest: z.string(),
    attemptLog: z.string()
  }).strict(),
  result: artifactVersionCommitResultV1Schema
}).strict()

const visualStyleSimilarityMetricSchema = z.object({
  overall: boundedScoreSchema,
  palette: boundedScoreSchema,
  background: boundedScoreSchema,
  axes: boundedScoreSchema,
  grid: boundedScoreSchema,
  layout: boundedScoreSchema,
  marks: boundedScoreSchema,
  typography: boundedScoreSchema.optional(),
  warnings: z.array(z.string().trim().min(1).max(4_000)).max(256)
}).strict()

const visualStyleExtractDiagnosticsSchema = z.object({
  analyzedAt: z.iso.datetime({ offset: true }),
  sampledPixels: z.number().int().nonnegative(),
  foregroundRatio: boundedScoreSchema,
  darkPixelRatio: boundedScoreSchema,
  chromaRatio: boundedScoreSchema,
  warnings: z.array(z.string().trim().min(1).max(4_000)).max(256)
}).strict()

const scientificPlottingReviewSuccessSchema = z.object({
  ok: z.literal(true),
  metric: visualStyleSimilarityMetricSchema,
  issues: z.array(z.object({
    id: z.enum(['background', 'palette', 'axes', 'grid', 'layout', 'marks', 'typography', 'diagnostics']),
    severity: z.enum(['info', 'warning', 'error']),
    metric: z.enum(['overall', 'palette', 'background', 'axes', 'grid', 'layout', 'marks', 'typography']).optional(),
    score: boundedScoreSchema.optional(),
    message: z.string().trim().min(1).max(4_000),
    autoRepairable: z.boolean()
  }).strict()).max(256),
  repairSuggestion: z.object({
    shouldRerender: z.boolean(),
    reason: z.string().trim().min(1).max(4_000),
    rcParamsPatch: z.record(z.string().trim().min(1).max(256), matplotlibRcParamValueSchema),
    palette: z.array(z.string().trim().min(1).max(128)).min(1).max(256).optional(),
    layoutHints: z.array(z.string().trim().min(1).max(4_000)).max(256),
    guardrails: z.array(z.string().trim().min(1).max(4_000)).max(256)
  }).strict(),
  diagnostics: z.object({
    reference: visualStyleExtractDiagnosticsSchema,
    output: visualStyleExtractDiagnosticsSchema
  }).strict(),
  template: scientificPlottingTemplateSchema.optional(),
  referenceProfile: scientificPlottingReferenceProfileSchema.optional(),
  templateAdvice: scientificPlottingTemplateAdviceSchema.optional()
}).strict()

const scientificPlottingReviewResultSchema = z.discriminatedUnion('ok', [
  scientificPlottingReviewSuccessSchema,
  z.object({
    ok: z.literal(false),
    message: z.string().trim().min(1).max(8_000)
  }).strict()
])

const rendererDiagnosticsSchema = z.object({
  fontFallback: z.object({ cjk: z.string().nullable() }).strict().optional(),
  legendPlacement: z.enum(['inside', 'outside-right', 'none']).optional(),
  barOrientation: z.enum(['vertical', 'horizontal']).optional(),
  barColorMode: z.enum(['series', 'per-bar']).optional(),
  categoryLabelRotation: z.number().finite().optional(),
  savefigPadInches: finiteNonnegativeSchema.optional(),
  multiPanelCount: z.number().int().nonnegative().optional(),
  schematicNodeCount: z.number().int().nonnegative().optional(),
  schematicEdgeCount: z.number().int().nonnegative().optional(),
  schematicPrimitiveCount: z.number().int().nonnegative().optional(),
  schematicExplicitPositions: z.boolean().optional(),
  typography: z.object({
    titleSize: z.number().finite().positive(),
    labelSize: z.number().finite().positive(),
    tickSize: z.number().finite().positive(),
    legendSize: z.number().finite().positive(),
    panelSize: z.number().finite().positive(),
    publicationClampApplied: z.boolean()
  }).strict().optional(),
  layoutQuality: z.object({
    legendItemCount: z.number().int().nonnegative(),
    legendColumnCount: z.number().int().nonnegative(),
    legendOutsidePlot: z.boolean(),
    legendOverlapRisk: z.enum(['none', 'low', 'medium', 'high']),
    textOverflowRisk: z.enum(['none', 'low', 'medium', 'high']),
    panelLabelAdjusted: z.boolean(),
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(256)
  }).strict().optional(),
  layoutNotes: z.array(z.string().trim().min(1).max(4_000)).max(256)
}).strict()

const scientificPlottingAttemptSchema = z.object({
  attempt: z.number().int().positive(),
  outputPath: pathSchema,
  outputHash: sha256Schema,
  executedAt: z.iso.datetime({ offset: true }),
  repaired: z.boolean(),
  review: scientificPlottingReviewResultSchema.optional(),
  rcParamsPatch: z.record(z.string().trim().min(1).max(256), matplotlibRcParamValueSchema).optional(),
  rendererDiagnostics: rendererDiagnosticsSchema.optional(),
  warnings: z.array(z.string().trim().min(1).max(4_000)).max(256)
}).strict()

const scientificPlotEvidenceArtifactV1Schema = z.object({
  kind: z.string().trim().min(1).max(256),
  locator: pathSchema,
  contentDigest: sha256Schema,
  size: z.number().int().nonnegative(),
  mediaType: z.string().trim().min(1).max(256).optional(),
  retention: artifactVersionRefV1Schema.shape.retention,
  accessPolicy: artifactVersionRefV1Schema.shape.accessPolicy,
  artifactVersionRef: artifactVersionRefV1Schema
}).strict()

export const scientificPlotEvidenceLineageV1Schema = z.object({
  activity: z.object({
    id: identifierSchema,
    type: z.literal('analysis_run'),
    name: z.string().trim().min(1).max(1_000),
    status: z.literal('completed'),
    parameters: z.record(z.string().trim().min(1).max(256), z.unknown()),
    stochastic: z.boolean().optional(),
    randomSeed: z.number().int().safe().optional()
  }).strict(),
  inputs: z.array(z.object({
    id: identifierSchema,
    type: z.literal('dataset_version'),
    name: z.string().trim().min(1).max(1_000),
    artifact: scientificPlotEvidenceArtifactV1Schema.optional(),
    provenanceBreakpoint: z.string().trim().min(1).max(4_000).optional()
  }).strict()).max(1_024),
  software: z.array(z.object({
    id: identifierSchema,
    type: z.literal('software_version'),
    name: z.string().trim().min(1).max(1_000),
    version: z.string().trim().min(1).max(512).optional(),
    contentDigest: sha256Schema
  }).strict()).max(1_024),
  environment: z.object({
    id: identifierSchema,
    type: z.literal('environment'),
    name: z.string().trim().min(1).max(1_000),
    contentDigest: sha256Schema,
    pythonVersion: z.string().trim().min(1).max(512),
    packages: z.record(z.string().trim().min(1).max(256), z.string().trim().min(1).max(512)),
    fontFingerprint: sha256Schema
  }).strict(),
  logs: z.array(z.object({
    id: identifierSchema,
    type: z.literal('artifact'),
    name: z.string().trim().min(1).max(1_000),
    artifact: scientificPlotEvidenceArtifactV1Schema
  }).strict()).max(1_024),
  outputs: z.array(z.object({
    id: identifierSchema,
    type: z.enum(['artifact', 'dataset_version']),
    name: z.string().trim().min(1).max(1_000),
    artifact: scientificPlotEvidenceArtifactV1Schema
  }).strict()).max(1_024),
  relations: z.array(z.object({
    src: identifierSchema,
    dst: identifierSchema,
    rel: z.enum(['replicates', 'fails_to_replicate', 'derived_from'])
  }).strict()).max(4_096)
}).strict()

export const scientificPlotEvidenceCommitRefsV1Schema = z.object({
  derivedData: artifactVersionRefV1Schema,
  recipe: artifactVersionRefV1Schema,
  figure: artifactVersionRefV1Schema,
  renderManifest: artifactVersionRefV1Schema,
  attemptLog: artifactVersionRefV1Schema
}).strict()

export const scientificPlotEvidenceOutboxReceiptV1Schema = z.object({
  schemaVersion: z.literal(1),
  producer: z.literal('scientific-plotting'),
  operationId: scientificPlottingOperationIdSchema,
  state: z.literal('pending'),
  createdAt: z.iso.datetime({ offset: true }),
  runtimeId: identifierSchema.optional(),
  threadId: identifierSchema.optional(),
  commitRefs: scientificPlotEvidenceCommitRefsV1Schema,
  evidenceLineage: scientificPlotEvidenceLineageV1Schema
}).strict().superRefine(validateEvidenceRoutingPair)

export const scientificPlottingOperationReceiptV1Schema = z.object({
  schemaVersion: z.literal(1),
  producer: z.literal('scientific-plotting'),
  operationId: scientificPlottingOperationIdSchema,
  requestHash: sha256Schema,
  state: z.enum(['prepared', 'complete']),
  createdAt: z.iso.datetime({ offset: true }),
  plotVersionId: identifierSchema,
  manifestPath: pathSchema,
  preCommitManifestPath: pathSchema,
  preparedDigests: z.object({
    derivedData: sha256Schema,
    recipe: sha256Schema,
    figure: sha256Schema,
    renderManifest: sha256Schema,
    attemptLog: sha256Schema
  }).strict()
}).strict()

export const scientificPlotEvidenceDeliveryV1Schema = z.object({
  state: z.enum(['pending', 'enqueued', 'failed']),
  receiptPath: pathSchema,
  message: z.string().trim().min(1).max(8_000).optional()
}).strict()

export const scientificPlotEvidenceEnqueueReceiptV1Schema = z.object({
  schemaVersion: z.literal(1),
  consumer: z.literal('evidence-dag'),
  producer: z.literal('scientific-plotting'),
  operationId: scientificPlottingOperationIdSchema,
  state: z.literal('enqueued'),
  createdAt: z.iso.datetime({ offset: true }),
  runtimeId: identifierSchema,
  threadId: identifierSchema,
  jobId: identifierSchema,
  sourceDigest: sha256Schema
}).strict()

export const scientificPlotProvenanceBreakpointV1Schema = z.object({
  schemaVersion: z.literal(1),
  code: z.enum([
    'artifact-version-capability-unavailable',
    'artifact-version-unavailable',
    'artifact-version-access-denied',
    'artifact-version-digest-mismatch',
    'recipe-link-mismatch',
    'environment-unavailable',
    'render-failed',
    'artifact-version-commit-failed',
    'exact-rerun-failed'
  ]),
  stage: z.enum(['baseline', 'input', 'environment', 'render', 'commit']),
  message: z.string().trim().min(1).max(8_000),
  retryable: z.boolean(),
  artifactVersionRef: artifactVersionRefV1Schema.optional()
}).strict()

const scientificPlottingRenderSuccessSchema = z.object({
  ok: z.literal(true),
  status: z.enum(['rendered', 'repaired', 'review_failed']),
  outputPath: pathSchema,
  manifestPath: pathSchema,
  recipePath: pathSchema,
  operationId: scientificPlottingOperationIdSchema,
  plotVersionId: identifierSchema,
  recipe: scientificPlotRecipeV1Schema,
  artifactManifestPath: pathSchema.optional(),
  versionCommit: versionCommitReceiptSchema.optional(),
  evidenceLineage: scientificPlotEvidenceLineageV1Schema.optional(),
  evidenceDelivery: scientificPlotEvidenceDeliveryV1Schema.optional(),
  attempts: z.array(scientificPlottingAttemptSchema).min(1).max(2),
  review: scientificPlottingReviewResultSchema.optional(),
  referenceProfile: scientificPlottingReferenceProfileSchema.optional(),
  templateAdvice: scientificPlottingTemplateAdviceSchema.optional(),
  styleProfileId: identifierSchema.optional(),
  styleProfile: scientificPlottingStyleProfileSummarySchema.optional(),
  warnings: z.array(z.string().trim().min(1).max(4_000)).max(256)
}).strict()

const scientificPlottingRenderFailureSchema = z.object({
  ok: z.literal(false),
  status: z.enum([
    'invalid_request',
    'invalid_workspace',
    'renderer_unavailable',
    'render_failed',
    'review_failed'
  ]),
  message: z.string().trim().min(1).max(8_000),
  stdoutTail: z.string().max(64_000).optional(),
  stderrTail: z.string().max(64_000).optional(),
  warnings: z.array(z.string().trim().min(1).max(4_000)).max(256).optional()
}).strict()

export const scientificPlottingRenderResultSchema: z.ZodType<ScientificPlottingRenderResult> = z.discriminatedUnion('ok', [
  scientificPlottingRenderSuccessSchema,
  scientificPlottingRenderFailureSchema
])

const scientificPlottingMappedRenderRequestSchema = scientificPlottingRenderRequestSchema.safeExtend({
  workspaceRoot: pathSchema
})

export const scientificPlottingMapDataResultSchema: z.ZodType<ScientificPlottingDataMappingResult> = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    status: z.literal('mapped'),
    selectedTemplate: scientificPlottingTemplateSchema,
    confidence: boundedScoreSchema,
    renderRequest: scientificPlottingMappedRenderRequestSchema,
    referenceProfile: scientificPlottingReferenceProfileSchema.optional(),
    templateAdvice: scientificPlottingTemplateAdviceSchema.optional(),
    styleProfileId: identifierSchema.optional(),
    styleProfile: scientificPlottingStyleProfileSummarySchema.optional(),
    styleProfileMatches: z.array(scientificPlottingStyleProfileMatchSchema).max(256).optional(),
    dataSummary: z.object({
      inputShape: z.enum(['template-ready', 'tabular', 'matrix', 'vector', 'multi-panel', 'network', 'unknown']),
      rowCount: z.number().int().nonnegative().optional(),
      columnCount: z.number().int().nonnegative().optional(),
      numericColumns: z.array(z.string().trim().min(1).max(512)).max(10_000).optional(),
      categoricalColumns: z.array(z.string().trim().min(1).max(512)).max(10_000).optional(),
      seriesCount: z.number().int().nonnegative().optional(),
      groupCount: z.number().int().nonnegative().optional(),
      pointCount: z.number().int().nonnegative().optional(),
      matrixShape: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional()
    }).strict(),
    mappingBasis: z.object({
      taskSignals: z.array(scientificPlottingTemplateSchema).max(SCIENTIFIC_PLOTTING_TEMPLATES.length),
      dataSignals: z.array(scientificPlottingTemplateSchema).max(SCIENTIFIC_PLOTTING_TEMPLATES.length),
      selectedBy: z.enum(['templateHint', 'dataShape', 'task', 'referenceProfile']),
      reasons: z.array(z.string().trim().min(1).max(4_000)).max(256)
    }).strict(),
    alternatives: z.array(z.object({
      template: scientificPlottingTemplateSchema,
      confidence: boundedScoreSchema,
      reason: z.string().trim().min(1).max(4_000)
    }).strict()).max(SCIENTIFIC_PLOTTING_TEMPLATES.length),
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(256),
    guardrails: z.array(z.string().trim().min(1).max(4_000)).max(256)
  }).strict(),
  z.object({
    ok: z.literal(false),
    status: z.enum(['needs_clarification', 'invalid_request', 'invalid_workspace']),
    message: z.string().trim().min(1).max(8_000),
    missingInputs: z.array(z.string().trim().min(1).max(4_000)).max(256),
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(256)
  }).strict()
])

export const scientificPlottingCompareResultSchema: z.ZodType<ScientificPlottingCompareResult> = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    status: z.literal('compared'),
    baselineManifestVersionRef: artifactVersionRefV1Schema,
    candidateManifestVersionRef: artifactVersionRefV1Schema,
    comparison: plottingComparisonSchema
  }).strict(),
  z.object({
    ok: z.literal(false),
    status: z.enum(['invalid_workspace', 'version_read_failed', 'manifest_read_failed']),
    message: z.string().trim().min(1).max(8_000)
  }).strict()
])

export const scientificPlottingRerunResultSchema: z.ZodType<ScientificPlottingRerunResult> = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    status: z.literal('rerun_complete'),
    baselineFigureVersionRef: artifactVersionRefV1Schema,
    recipeVersionRef: artifactVersionRefV1Schema,
    render: scientificPlottingRenderSuccessSchema,
    comparison: plottingComparisonSchema,
    reproductionRelation: z.enum(['replicates', 'fails_to_replicate']),
    evidenceLineage: scientificPlotEvidenceLineageV1Schema.optional(),
    evidenceDelivery: scientificPlotEvidenceDeliveryV1Schema.optional()
  }).strict(),
  z.object({
    ok: z.literal(false),
    status: z.enum(['invalid_workspace', 'version_read_failed', 'rerun_failed']),
    message: z.string().trim().min(1).max(8_000),
    render: scientificPlottingRenderFailureSchema.optional(),
    provenanceBreakpoints: z.array(scientificPlotProvenanceBreakpointV1Schema).min(1).max(64)
  }).strict()
])

const scientificPlottingTemplateGuideSchema = z.object({
  template: scientificPlottingTemplateSchema,
  useWhen: z.array(z.string().trim().min(1).max(4_000)).max(256),
  avoidWhen: z.array(z.string().trim().min(1).max(4_000)).max(256),
  expectedData: z.array(z.string().trim().min(1).max(4_000)).max(256),
  modelSelectionHint: z.string().trim().min(1).max(4_000)
}).strict()

export const scientificPlottingStatusResultSchema: z.ZodType<ScientificPlottingStatusResult> = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    serverName: z.literal('scientific_plotting'),
    version: z.string().trim().min(1).max(256),
    renderer: z.object({
      kind: z.literal('matplotlib'),
      pythonCommand: z.string().trim().min(1).max(4_096),
      available: z.boolean(),
      version: z.string().trim().min(1).max(512).optional(),
      message: z.string().trim().min(1).max(8_000).optional()
    }).strict(),
    referencePreparation: z.object({
      imageCrop: z.literal(true),
      pdfCrop: z.object({
        available: z.boolean(),
        command: z.string().trim().min(1).max(4_096),
        message: z.string().trim().min(1).max(8_000).optional()
      }).strict(),
      defaultRelativeDir: z.literal('.sciforge/figure-references')
    }).strict(),
    reviewPackets: z.object({
      defaultRelativeDir: z.literal('.sciforge/figure-reviews'),
      readsRenderManifests: z.literal(true),
      writesMarkdownAndJson: z.literal(true)
    }).strict(),
    styleProfiles: z.object({
      builtIn: z.number().int().nonnegative(),
      acceptsStyleProfileId: z.literal(true),
      defaultProfileIds: z.array(identifierSchema).max(1_000)
    }).strict(),
    supportedTemplates: z.array(scientificPlottingTemplateSchema).max(SCIENTIFIC_PLOTTING_TEMPLATES.length),
    templateGuides: z.array(scientificPlottingTemplateGuideSchema).max(SCIENTIFIC_PLOTTING_TEMPLATES.length),
    outputPolicy: z.object({
      defaultRelativeDir: pathSchema,
      writesOnlyInsideWorkspace: z.literal(true),
      formats: z.tuple([z.literal('png')])
    }).strict(),
    degraded: z.boolean(),
    guardrails: z.array(z.string().trim().min(1).max(4_000)).max(256)
  }).strict(),
  z.object({
    ok: z.literal(false),
    message: z.string().trim().min(1).max(8_000)
  }).strict()
])

export type DataSourceRefContract = z.infer<typeof dataSourceRefSchema>
export type DerivedTableReceiptContract = z.infer<typeof derivedTableReceiptSchema>
export type StatisticalDefinitionV1Contract = z.infer<typeof statisticalDefinitionV1Schema>
export type ScientificPlotRecipeV1Contract = z.infer<typeof scientificPlotRecipeV1Schema>
export type ScientificPlottingMapDataInput = z.infer<typeof scientificPlottingMapDataRequestSchema>
export type ScientificPlottingRenderInput = z.infer<typeof scientificPlottingRenderRequestSchema>
export type ScientificPlottingRerunInput = z.infer<typeof scientificPlottingRerunRequestSchema>
export type ScientificPlottingCompareInput = z.infer<typeof scientificPlottingCompareRequestSchema>
