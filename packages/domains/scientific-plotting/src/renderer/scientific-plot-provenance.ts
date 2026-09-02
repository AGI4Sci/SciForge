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

export type ScientificPlotDependencyStatus =
  | 'available'
  | 'missing'
  | 'restricted'
  | 'unavailable'

export type ScientificPlotSupportingVersion = Readonly<{
  ref: ArtifactVersionRefV1
  roles: readonly string[]
  status: ScientificPlotDependencyStatus
  item?: HistoryItem
  issue?: string
}>

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
  figureStatus: ScientificPlotDependencyStatus
  figureIssue?: string
  supportingVersions: readonly ScientificPlotSupportingVersion[]
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
    const logItems = allItems.filter((item) => (
      item.artifact.kind === 'scientific-plot-render-log' &&
      item.version.metadata.plotVersionId === parsed.value.plotVersionId
    ))
    const logItem = logItems[0]
    const metadataManifestPath = manifestItem.version.metadata.manifestPath
    const manifestPath = typeof metadataManifestPath === 'string'
      ? metadataManifestPath
      : ''
    if (!manifestPath) {
      return {
        issue: `${manifestItem.version.versionId}: exact manifest has no rerun path metadata.`
      } as const
    }

    const dependencies = collectDependencyClosure({
      manifestItem,
      recipe: parsed.value.recipe,
      recipeRef,
      codeRef,
      figureRef,
      logItems,
      itemByVersionId
    })
    const figureDependency = figureRef
      ? dependencies.find((dependency) => sameArtifactVersionRef(dependency.ref, figureRef))
      : undefined
    const supportingVersions = dependencies
      .filter((dependency) => !figureRef || !sameArtifactVersionRef(dependency.ref, figureRef))
      .map(toSupportingVersion)

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
        figureStatus: figureDependency?.status ?? (figureRef ? 'missing' : 'unavailable'),
        ...(figureDependency?.issue ? { figureIssue: figureDependency.issue } : {}),
        supportingVersions,
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
    if ('record' in entry && entry.record) {
      records.push(entry.record)
      if (entry.record.figureIssue) {
        issues.push(`${entry.record.figureRef?.versionId ?? entry.record.manifestRef.versionId}: ${entry.record.figureIssue}`)
      }
      for (const dependency of entry.record.supportingVersions) {
        if (dependency.issue) {
          issues.push(`${dependency.ref.versionId}: ${dependency.issue}`)
        }
      }
    }
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
    // Model-owned images have a different owner and lifecycle: Image
    // Generation writes the replay receipt and Visual Review performs the
    // human-gated Artifact Version acceptance. Scientific Plotting only
    // presents formal code/hybrid render manifests.
    if (plotRoute(parsed.data.recipe.visualPlan) === 'model') {
      return {
        ok: false,
        message: 'snapshot is a model-only image receipt; inspect it through Image Generation and Visual Review.'
      }
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

type DependencyProjection = Readonly<{
  ref: ArtifactVersionRefV1
  roles: readonly string[]
  status: ScientificPlotDependencyStatus
  item?: HistoryItem
  issue?: string
}>

function collectDependencyClosure(input: Readonly<{
  manifestItem: HistoryItem
  recipe: ScientificPlotManifestProjection['recipe']
  recipeRef?: ArtifactVersionRefV1
  codeRef?: ArtifactVersionRefV1
  figureRef?: ArtifactVersionRefV1
  logItems: readonly HistoryItem[]
  itemByVersionId: ReadonlyMap<string, HistoryItem>
}>): DependencyProjection[] {
  const entries = new Map<string, { ref: ArtifactVersionRefV1; roles: Set<string> }>()
  const visited = new Set<string>()

  const add = (ref: ArtifactVersionRefV1, role: string): void => {
    const key = artifactVersionRefKey(ref)
    const entry = entries.get(key)
    if (entry) {
      entry.roles.add(role)
      return
    }
    entries.set(key, { ref, roles: new Set([role]) })
  }

  const visit = (ref: ArtifactVersionRefV1, role: string): void => {
    add(ref, role)
    const key = artifactVersionRefKey(ref)
    if (visited.has(key)) return
    visited.add(key)
    const item = input.itemByVersionId.get(ref.versionId)
    if (!item) return
    for (const dependency of item.version.dependencies) {
      visit(dependency.target, `${role}.${dependency.role}`)
    }
  }

  visit(input.manifestItem.ref, 'manifest')
  for (const dependency of input.manifestItem.version.dependencies) {
    visit(dependency.target, `manifest.${dependency.role}`)
  }
  for (const source of input.recipe.dataSources) {
    if (source.kind === 'artifact-version') {
      visit(source.artifactVersion, `recipe.data-source.${source.sourceId}`)
    }
  }
  if (input.recipeRef) visit(input.recipeRef, 'recipe')
  if (input.codeRef) visit(input.codeRef, 'code')
  if (input.figureRef) visit(input.figureRef, 'figure')
  for (const [index, logItem] of input.logItems.entries()) {
    visit(logItem.ref, `render-log.${index + 1}`)
  }

  return [...entries.values()].map((entry) => {
    const item = input.itemByVersionId.get(entry.ref.versionId)
    const assessed = assessDependency(entry.ref, item)
    return {
      ref: entry.ref,
      roles: [...entry.roles].sort(),
      status: assessed.status,
      ...(item ? { item } : {}),
      ...(assessed.issue ? { issue: assessed.issue } : {})
    }
  })
}

function toSupportingVersion(dependency: DependencyProjection): ScientificPlotSupportingVersion {
  return dependency
}

function assessDependency(
  ref: ArtifactVersionRefV1,
  item: HistoryItem | undefined
): Readonly<{ status: ScientificPlotDependencyStatus; issue?: string }> {
  if (ref.accessPolicy.visibility === 'restricted') {
    return { status: 'restricted', issue: 'Artifact Version access is restricted.' }
  }
  if (ref.availability === 'missing') {
    return { status: 'missing', issue: 'Artifact Version content is marked missing.' }
  }
  if (ref.availability === 'remote') {
    return { status: 'unavailable', issue: 'Artifact Version content is remote and unavailable in this workspace.' }
  }
  if (!item) {
    return { status: 'missing', issue: 'Exact Artifact Version is not present in the authorized Version listing.' }
  }
  if (!sameArtifactVersionRef(ref, item.ref)) {
    return { status: 'unavailable', issue: 'The listed Artifact Version ref does not match the dependency ref.' }
  }
  return { status: 'available' }
}

function sameArtifactVersionRef(left: ArtifactVersionRefV1, right: ArtifactVersionRefV1): boolean {
  return artifactVersionRefKey(left) === artifactVersionRefKey(right)
}

function artifactVersionRefKey(ref: ArtifactVersionRefV1): string {
  return JSON.stringify([
    ref.artifactId,
    ref.versionId,
    ref.contentDigest,
    ref.byteLength,
    ref.mediaType ?? null,
    ref.availability,
    ref.retention,
    ref.accessPolicy.visibility,
    ref.accessPolicy.principals,
    ref.accessPolicy.allowExport
  ])
}

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function plotRoute(value: unknown): 'code' | 'model' | 'hybrid' | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const route = (value as { route?: unknown }).route
  return route === 'code' || route === 'model' || route === 'hybrid' ? route : undefined
}

export function scientificPlotRerunAvailability(
  record: ScientificPlotProvenanceRecord
): Readonly<{ allowed: boolean; reason: string }> {
  const route = plotRoute(record.manifest.recipe.visualPlan)
  if (route === 'model') {
    return { allowed: false, reason: 'Model-owned receipts are replayable through Image Generation, not Scientific Plotting rerun.' }
  }
  if (!record.figureRef || !record.recipeRef || !record.currentFigureVersionId) {
    return { allowed: false, reason: 'The exact Figure, Recipe, or current Version reference is missing.' }
  }
  if (!record.codeRef) {
    return { allowed: false, reason: 'This historical Version has no committed executable Code Artifact.' }
  }
  if (record.figureStatus !== 'available') {
    return { allowed: false, reason: record.figureIssue ?? 'The exact Figure Version is unavailable.' }
  }
  const unavailable = record.supportingVersions.find((dependency) => dependency.status !== 'available')
  if (unavailable) {
    return {
      allowed: false,
      reason: unavailable.issue ?? `Supporting Artifact Version ${unavailable.ref.versionId} is ${unavailable.status}.`
    }
  }
  return { allowed: true, reason: '' }
}
