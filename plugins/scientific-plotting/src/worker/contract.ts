import { z } from 'zod'



import { SCIENTIFIC_PLOTTING_TEMPLATES, type ScientificPlottingDataMappingResult, type ScientificPlottingRenderResult, type ScientificPlottingStatusResult } from './types.js'



const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

const pathSchema = z.string().trim().min(1).max(8_192)

const identifierSchema = z.string().trim().min(1).max(256)


export const scientificPlottingTemplateSchema = z.enum(SCIENTIFIC_PLOTTING_TEMPLATES)

export const dataSourceRefSchema = z.object({ schemaVersion: z.literal(1), sourceId: identifierSchema, kind: z.literal('inline'), locator: z.string().min(1).max(8192), sha256: sha256Schema, datasetVersion: z.string().optional(), mediaType: z.string().optional(), selection: z.object({ sheet: z.string().optional(), columns: z.array(z.string()).optional(), rowFilter: z.string().optional() }).strict().optional() }).strict()



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

export const scientificPlotEnvironmentV1Schema = z.object({ schemaVersion: z.literal(1), pythonVersion: z.string(), packages: z.record(z.string(), z.string()) }).strict()


export const scientificPlotExecutionV1Schema = z.object({ schemaVersion: z.literal(1), renderer: z.literal('scientific-figures-matplotlib'), rendererVersion: z.string(), rendererCodeSha256: sha256Schema, codePath: z.literal('code.py'), inputsPath: z.literal('inputs.json'), timeoutMs: z.number().int().positive().max(60000) }).strict()



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

export const scientificPlotRecipeV1Schema = z.object({ schemaVersion: z.literal(1), recipeId: z.string().startsWith('plot-recipe:'), figureId: identifierSchema, generationId: identifierSchema,
 template: scientificPlottingTemplateSchema, dataHash: sha256Schema, labels: scientificPlottingLabelsSchema,
 dataSources: z.array(dataSourceRefSchema), derivedTables: z.array(derivedTableReceiptSchema), transformations: z.array(scientificPlotTransformationV1Schema), statistics: statisticalDefinitionV1Schema.optional(),
 style: z.object({ resolvedSpec: figureStyleSpecSchema, resolvedSpecHash: sha256Schema, styleProfileId: identifierSchema.optional() }).strict(),
 render: z.object({ outputScale: z.number().min(1).max(4), matplotlib: scientificPlotMatplotlibParametersV1Schema }).strict(), environment: scientificPlotEnvironmentV1Schema, execution: scientificPlotExecutionV1Schema,
 reproducibilityMode: z.enum(['standard','reproducible']), provenanceWarnings: z.array(z.string()) }).strict()

const commonPlotRequestShape = {
 workspaceRoot: pathSchema, documentId: z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).refine(v => v !== '.' && v !== '..'),
 generationId: z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).refine(v => v !== '.' && v !== '..'), data: z.unknown(),
 reproducibilityMode: z.enum(['standard','reproducible']).optional(), dataSources: z.array(dataSourceRefSchema).min(1).max(1024).optional(),
 derivedTableReceipts: z.array(derivedTableReceiptSchema).max(1024).optional(), transformations: z.array(scientificPlotTransformationV1Schema).max(1024).optional(),
 statistics: statisticalDefinitionV1Schema.optional(), provenanceWarnings: z.array(z.string().max(4000)).max(256).optional(),
 labels: scientificPlottingLabelsSchema.optional(), styleSpec: figureStyleSpecSchema.optional(), styleProfileId: identifierSchema.optional(),
 figureId: z.string().max(120).optional(), outputScale: z.number().min(1).max(4).optional(), reviewTask: z.string().max(16000).optional()
} as const

export const scientificPlottingMapDataRequestSchema = z.object({ ...commonPlotRequestShape, task: z.string().trim().min(1).max(16000), templateHint: scientificPlottingTemplateSchema.optional() }).strict()


export const scientificPlottingRenderRequestSchema = z.object({ ...commonPlotRequestShape, template: scientificPlottingTemplateSchema, matplotlib: scientificPlotMatplotlibParametersV1Schema.optional() }).strict()


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

export const scientificPlottingRenderResultSchema: z.ZodType<ScientificPlottingRenderResult> = z.discriminatedUnion('ok', [
 z.object({ ok: z.literal(true), status: z.literal('rendered'), imageBytes: z.instanceof(Uint8Array), mediaType: z.literal('image/png'), imageHash: sha256Schema,
 width: z.number().int().positive(), height: z.number().int().positive(), recipe: scientificPlotRecipeV1Schema, code: z.string(), inputs: z.unknown(),
 paths: z.object({ recipe: z.string(), code: z.string(), inputs: z.string() }).strict(), rendererDiagnostics: rendererDiagnosticsSchema.optional(), warnings: z.array(z.string()) }).strict(),
 z.object({ ok: z.literal(false), status: z.enum(['invalid_request','invalid_workspace','renderer_unavailable','render_failed']), message: z.string(), stderrTail: z.string().optional(), warnings: z.array(z.string()) }).strict()
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


const scientificPlottingTemplateGuideSchema = z.object({
  template: scientificPlottingTemplateSchema,
  useWhen: z.array(z.string().trim().min(1).max(4_000)).max(256),
  avoidWhen: z.array(z.string().trim().min(1).max(4_000)).max(256),
  expectedData: z.array(z.string().trim().min(1).max(4_000)).max(256),
  modelSelectionHint: z.string().trim().min(1).max(4_000)
}).strict()

export const scientificPlottingStatusResultSchema: z.ZodType<ScientificPlottingStatusResult> = z.object({ ok: z.literal(true), serverName: z.literal('scientific_plotting'), version: z.string(), renderer: z.object({ kind: z.literal('matplotlib'), available: z.boolean(), version: z.string().optional(), message: z.string().optional() }).strict(), supportedTemplates: z.array(scientificPlottingTemplateSchema), templateGuides: z.array(scientificPlottingTemplateGuideSchema), outputPolicy: z.object({ sourceRelativeDir: z.string(), returnsImageBytes: z.literal(true), persistsImages: z.literal(false) }).strict(), degraded: z.boolean(), guardrails: z.array(z.string()) }).strict()



export type DataSourceRefContract = z.infer<typeof dataSourceRefSchema>

export type DerivedTableReceiptContract = z.infer<typeof derivedTableReceiptSchema>

export type StatisticalDefinitionV1Contract = z.infer<typeof statisticalDefinitionV1Schema>

export type ScientificPlotRecipeV1Contract = z.infer<typeof scientificPlotRecipeV1Schema>

export type ScientificPlottingMapDataInput = z.infer<typeof scientificPlottingMapDataRequestSchema>

export type ScientificPlottingRenderInput = z.infer<typeof scientificPlottingRenderRequestSchema>

export { SCIENTIFIC_PLOTTING_TEMPLATES } from './types.js'
export type * from './types.js'
