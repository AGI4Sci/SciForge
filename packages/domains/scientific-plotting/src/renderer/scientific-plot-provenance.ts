import { z } from 'zod'
import type {
  ArtifactVersionListV1,
  ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import {
  dataSourceRefSchema,
  derivedTableReceiptSchema,
  scientificPlotEnvironmentV1Schema,
  scientificPlotExecutionV1Schema,
  scientificPlotMatplotlibParametersV1Schema,
  scientificPlotTransformationV1Schema,
  scientificPlottingLabelsSchema,
  scientificPlottingTemplateSchema,
  statisticalDefinitionV1Schema
} from '../contract.js'
import type { ScientificPlottingCapabilityClient } from './scientific-plotting-capability-client.js'

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const pathSchema = z.string().trim().min(1).max(8_192)

const scientificPlotRecipeProjectionSchema = z.object({
  schemaVersion: z.literal(1),
  recipeId: z.string().startsWith('plot-recipe:'),
  figureId: z.string().trim().min(1),
  template: scientificPlottingTemplateSchema,
  dataHash: sha256Schema,
  labels: scientificPlottingLabelsSchema,
  dataSources: z.array(dataSourceRefSchema),
  derivedTables: z.array(derivedTableReceiptSchema),
  transformations: z.array(scientificPlotTransformationV1Schema),
  statistics: statisticalDefinitionV1Schema.optional(),
  style: z.object({
    resolvedSpec: z.unknown(),
    resolvedSpecHash: sha256Schema,
    styleProfileId: z.string().optional(),
    styleSpecPath: pathSchema.optional(),
    referencePath: pathSchema.optional()
  }).passthrough(),
  render: z.object({
    outputScale: z.number().min(1).max(4),
    matplotlib: scientificPlotMatplotlibParametersV1Schema.optional(),
    autoRepair: z.object({
      enabled: z.boolean(),
      maxAttempts: z.union([z.literal(0), z.literal(1)]),
      minOverall: z.number().optional()
    }).passthrough(),
    reviewTask: z.string().optional()
  }).passthrough(),
  environment: scientificPlotEnvironmentV1Schema,
  execution: scientificPlotExecutionV1Schema,
  reproducibilityMode: z.enum(['standard', 'reproducible']),
  provenanceWarnings: z.array(z.string())
}).passthrough()

export const scientificPlotManifestProjectionSchema = z.object({
  version: z.literal(1),
  renderer: z.literal('sciforge-scientific-plotting-mcp'),
  rendererVersion: z.string().trim().min(1),
  tool: z.literal('scientific_plotting_render'),
  template: scientificPlottingTemplateSchema,
  createdAt: z.string().trim().min(1),
  plotVersionId: z.string().trim().min(1),
  requestHash: sha256Schema,
  recipePath: pathSchema,
  codePath: pathSchema.optional(),
  recipe: scientificPlotRecipeProjectionSchema,
  outputPath: pathSchema,
  outputHash: sha256Schema,
  outputScale: z.number().min(1).max(4).optional(),
  attempts: z.array(z.object({
    attempt: z.number().int().positive(),
    outputPath: pathSchema,
    outputHash: sha256Schema,
    executedAt: z.string().trim().min(1),
    repaired: z.boolean(),
    review: z.unknown().optional(),
    rcParamsPatch: z.record(z.string(), z.union([
      z.string(),
      z.number(),
      z.boolean()
    ])).optional(),
    rendererDiagnostics: z.unknown().optional(),
    warnings: z.array(z.string())
  }).passthrough()),
  finalReview: z.unknown().optional(),
  warnings: z.array(z.string())
}).passthrough()

export type ScientificPlotManifestProjection = z.infer<
  typeof scientificPlotManifestProjectionSchema
>
type HistoryItem = ArtifactVersionListV1['items'][number]

export type ScientificPlotProvenanceRecord = Readonly<{
  manifest: ScientificPlotManifestProjection
  manifestPath: string
  manifestItem: HistoryItem
  manifestRef: ArtifactVersionRefV1
  recipeRef?: ArtifactVersionRefV1
  codeRef?: ArtifactVersionRefV1
  figureRef?: ArtifactVersionRefV1
  derivedDataRef?: ArtifactVersionRefV1
  logRef?: ArtifactVersionRefV1
  currentFigureVersionId?: string
}>

export type ScientificPlotProvenanceLoadResult = Readonly<{
  records: readonly ScientificPlotProvenanceRecord[]
  issues: readonly string[]
}>

export async function loadScientificPlotProvenance(
  client: ScientificPlottingCapabilityClient,
  workspaceRoot: string
): Promise<ScientificPlotProvenanceLoadResult> {
  const listed = await client.listArtifactVersions(workspaceRoot, { limit: 500 })
  if (!listed.ok) throw new Error(listed.issue.message)

  const allItems = listed.value.items
  const itemByVersionId = new Map(allItems.map((item) => [item.version.versionId, item]))
  const manifestItems = allItems
    .filter((item) => item.artifact.kind === 'scientific-plot-render-manifest')
    .sort((left, right) => right.version.createdAt.localeCompare(left.version.createdAt))
    .slice(0, 100)

  const loaded = await Promise.all(manifestItems.map(async (manifestItem) => {
    const read = await client.readArtifactVersion(workspaceRoot, {
      versionId: manifestItem.version.versionId,
      maxBytes: 16 * 1024 * 1024
    })
    if (!read.ok) {
      return { issue: `${manifestItem.version.versionId}: ${read.issue.message}` } as const
    }
    const parsed = parseScientificPlotManifest(read.value.dataBase64)
    if (!parsed.ok) {
      return { issue: `${manifestItem.version.versionId}: ${parsed.message}` } as const
    }

    const recipeRef = dependencyRef(manifestItem, 'recipe')
    const codeRef = dependencyRef(manifestItem, 'code')
    const figureRef = dependencyRef(manifestItem, 'figure')
    const recipeItem = recipeRef ? itemByVersionId.get(recipeRef.versionId) : undefined
    const derivedDataRef = recipeItem ? dependencyRef(recipeItem, 'derived-data') : undefined
    const logItem = allItems.find((item) => (
      item.artifact.kind === 'scientific-plot-render-log' &&
      item.version.metadata.plotVersionId === parsed.value.plotVersionId
    ))
    const metadataManifestPath = manifestItem.version.metadata.manifestPath
    const manifestPath = typeof metadataManifestPath === 'string'
      ? metadataManifestPath
      : ''
    if (!manifestPath) {
      return {
        issue: `${manifestItem.version.versionId}: exact manifest has no rerun path metadata.`
      } as const
    }

    return {
      record: {
        manifest: parsed.value,
        manifestPath,
        manifestItem,
        manifestRef: manifestItem.ref,
        ...(recipeRef ? { recipeRef } : {}),
        ...(codeRef ? { codeRef } : {}),
        ...(figureRef ? { figureRef } : {}),
        ...(derivedDataRef ? { derivedDataRef } : {}),
        ...(logItem ? { logRef: logItem.ref } : {}),
        ...(figureRef
          ? {
              currentFigureVersionId: itemByVersionId.get(figureRef.versionId)
                ?.artifact.currentVersionId ?? figureRef.versionId
            }
          : {})
      } satisfies ScientificPlotProvenanceRecord
    } as const
  }))

  const records: ScientificPlotProvenanceRecord[] = []
  const issues: string[] = []
  for (const entry of loaded) {
    if ('record' in entry && entry.record) records.push(entry.record)
    if ('issue' in entry && entry.issue) issues.push(entry.issue)
  }
  return { records, issues }
}

export function parseScientificPlotManifest(dataBase64: string):
  | Readonly<{ ok: true; value: ScientificPlotManifestProjection }>
  | Readonly<{ ok: false; message: string }> {
  try {
    const bytes = decodeBase64(dataBase64)
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    const parsed = scientificPlotManifestProjectionSchema.safeParse(value)
    if (!parsed.success) {
      return { ok: false, message: 'snapshot is not a valid Scientific Plot render manifest.' }
    }
    return { ok: true, value: parsed.data }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

function dependencyRef(item: HistoryItem, role: string): ArtifactVersionRefV1 | undefined {
  return item.version.dependencies.find((dependency) => dependency.role === role)?.target
}

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
