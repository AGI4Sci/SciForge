import { randomUUID, createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDomainMainEntry, type ArtifactVersionsCapabilityFactory, type ArtifactVersionsCapabilityOptions } from '@sciforge/domain-artifact-versions/main'
import type { ArtifactVersionDescribeInputV2, ArtifactVersionDescribeResultV2, ArtifactVersionCommitInputV1, ArtifactVersionCommitResultV1, ArtifactVersionReadInputV1, ArtifactVersionReadResultV1, ArtifactVersionListInputV1, ArtifactVersionListV1, ArtifactVersionMaterializeInputV1, ArtifactVersionMaterializeReceiptV1, ArtifactVersionResultV1 } from '@sciforge/domain-artifact-versions/contract'
import type { ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'
const DIGEST = 'a'.repeat(64)
const CREATED_AT = '2026-08-06T01:00:00.000Z'
const ACCESS = { visibility: 'workspace' as const, principals: [], allowExport: true }
export const actor = { audience: 'ui' as const, callerId: 'figure-binding-test' }
const snapshot = (bytes: string | Buffer, mediaType: string) => ({ mode: 'snapshot' as const, dataBase64: Buffer.from(bytes).toString('base64'), mediaType })
const dependency = (role: string, candidateId: string) => ({ role, required: true, target: { kind: 'candidate' as const, candidateId } })
export async function fixture() {
  const directory = join(process.env.SCIFORGE_PLOT_TEST_OUTPUT || join(tmpdir(), 'sciforge-figure-binding'), '图 来源 ' + randomUUID())
  const workspace = join(directory, '工作 区')
  await mkdir(workspace, { recursive: true })
  const entry = createDomainMainEntry<ArtifactVersionsCapabilityOptions>({ defineCapability: (definition: ArtifactVersionsCapabilityOptions) => definition } as never)
  const factory = entry.contributions.find(item => item.kind === 'main.capability-factory')!.value as ArtifactVersionsCapabilityFactory<ArtifactVersionsCapabilityOptions>
  const lifecycle = entry.contributions.find(item => item.kind === 'main.runtime-lifecycle')!.value as { activate(context: unknown): Promise<() => void | Promise<void>> }
  const dispose = await lifecycle.activate({ userDataDir: join(directory, 'owner-data') })
  const definitions = new Map(factory.createDefinitions().map(definition => [definition.id, definition]))
  const invoke = async <T>(root: string, id: string, input: unknown, access = actor): Promise<T> => {
    const definition = definitions.get(id)
    if (!definition) throw new Error('Capability is unavailable: ' + id)
    return (await definition.handler(input, { caller: { ...access, workspaceId: root } })).output as T
  }
  const service = {
    describe: (root: string, input: ArtifactVersionDescribeInputV2, access = actor) => invoke<ArtifactVersionDescribeResultV2>(root, 'artifact-versions.describe-v2', input, access),
    commit: (root: string, input: ArtifactVersionCommitInputV1, access = actor) => invoke<ArtifactVersionCommitResultV1>(root, 'artifact-versions.commit', input, access),
    read: (root: string, input: ArtifactVersionReadInputV1, access = actor) => invoke<ArtifactVersionReadResultV1>(root, 'artifact-versions.read', input, access),
    listV1: (root: string, input: ArtifactVersionListInputV1, access = actor) => invoke<ArtifactVersionResultV1<ArtifactVersionListV1>>(root, 'artifact-versions.list', input, access),
    materialize: (root: string, input: ArtifactVersionMaterializeInputV1, access = actor) => invoke<ArtifactVersionResultV1<ArtifactVersionMaterializeReceiptV1>>(root, 'artifact-versions.materialize', input, access)
  }
  return { directory, workspace, service, dispose, invoke }
}
export async function commitPlot(context: Awaited<ReturnType<typeof fixture>>, revision: number, previous?: ArtifactVersionRefV1, dataPadding = 0) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64')
  const code = '# fixed renderer version ' + revision + '\nprint("synthetic test only")\n'
  const data = JSON.stringify({ revision, value: revision * 10, ...(dataPadding ? { padding: 'x'.repeat(dataPadding) } : {}) })
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
  if (dataPadding) await writeFile(join(context.workspace, 'large-data.json'), data)
  const dataContent = dataPadding ? { mode: 'reference' as const, locator: 'workspace:large-data.json', contentDigest: hash(data), byteLength: Buffer.byteLength(data), mediaType: 'application/json', availability: 'available' as const } : snapshot(data, 'application/json')
  const manifest = plotManifest()
  manifest.plotVersionId = 'plot-' + revision
  manifest.outputPath = '图表/同名 figure.png'
  manifest.outputHash = hash(png)
  manifest.recipe.dataSources = []
  manifest.recipe.execution.rendererCodeSha256 = hash(code)
  manifest.recipe.execution.cwd = context.workspace
  const result = await context.service.commit(context.workspace, { idempotencyKey: 'bound-plot-' + revision, candidates: [
    { candidateId: 'data', expectedCurrentVersionId: null, kind: 'scientific-plot-derived-data', intent: 'save', content: dataContent },
    { candidateId: 'recipe', expectedCurrentVersionId: null, kind: 'scientific-plot-recipe', intent: 'save', content: snapshot(JSON.stringify(manifest.recipe), 'application/json'), dependencies: [dependency('derived-data','data')] },
    { candidateId: 'code', expectedCurrentVersionId: null, kind: 'scientific-plot-code', intent: 'save', content: snapshot(code, 'text/x-python'), dependencies: [dependency('recipe','recipe')] },
    { candidateId: 'figure', ...(previous ? { artifactId: previous.artifactId } : {}), expectedCurrentVersionId: previous?.versionId ?? null, kind: 'scientific-plot', label: 'Same filename', intent: 'save', content: snapshot(png, 'image/png'), dependencies: [dependency('recipe','recipe'),dependency('code','code')] },
    { candidateId: 'manifest', expectedCurrentVersionId: null, kind: 'scientific-plot-render-manifest', intent: 'save', content: snapshot(JSON.stringify(manifest), 'application/json'), dependencies: [dependency('recipe','recipe'),dependency('code','code'),dependency('figure','figure')], metadata: { manifestPath: '图表/同名 manifest.json' } },
    { candidateId: 'log', expectedCurrentVersionId: null, kind: 'scientific-plot-render-log', intent: 'save', content: snapshot(JSON.stringify({ attempts: [{ outcome: 'failed' }, { outcome: 'succeeded' }] }), 'application/json'), dependencies: [dependency('figure','figure')] }
  ] }, actor)
  if (!result.ok) throw new Error(result.issue.message)
  const ref = (id: string) => result.value.versions.find(item => item.candidateId === id)!.ref
  return { figure: ref('figure'), manifest: ref('manifest'), code: ref('code'), data: ref('data'), rawCode: code, rawData: data }
}
export function plotManifest() {
  const sourceRef: ArtifactVersionRefV1 = {
    artifactId: 'artifact:input',
    versionId: 'artifact-version:input-v1',
    contentDigest: DIGEST,
    byteLength: 10,
    mediaType: 'text/csv',
    availability: 'available',
    retention: 'snapshot',
    accessPolicy: ACCESS
  }
  return {
    version: 1,
    renderer: 'sciforge-scientific-plotting-mcp',
    rendererVersion: '1.0.0',
    tool: 'scientific_plotting_render',
    template: 'box-violin',
    createdAt: CREATED_AT,
    plotVersionId: 'plot-v1',
    requestHash: DIGEST,
    recipePath: '.sciforge/plots/figure.recipe.json',
    codePath: '.sciforge/plots/figure-v1.render.py',
    outputPath: '.sciforge/plots/figure.png',
    outputHash: DIGEST,
    recipe: {
      schemaVersion: 1,
      recipeId: `plot-recipe:${DIGEST}`,
      figureId: 'figure',
      template: 'box-violin',
      dataHash: DIGEST,
      labels: { title: 'Treatment response', x: 'Group', y: 'Response' },
      dataSources: [{
        schemaVersion: 1,
        sourceId: 'treatment-response',
        locator: 'snapshot:artifact-version:input-v1',
        sha256: DIGEST,
        mediaType: 'text/csv',
        kind: 'artifact-version',
        artifactVersion: sourceRef
      }],
      derivedTables: [{
        schemaVersion: 1,
        receiptId: 'derived-table-1',
        inputSourceIds: ['treatment-response'],
        operation: 'identity',
        inputHash: DIGEST,
        outputHash: DIGEST,
        transformationIds: ['transform-1'],
        rowCount: 6,
        columnCount: 2,
        warnings: []
      }],
      transformations: [{
        schemaVersion: 1,
        transformationId: 'transform-1',
        kind: 'identity',
        description: 'Use the pinned source rows without implicit aggregation.',
        parameters: {},
        inputHash: DIGEST,
        outputHash: DIGEST
      }],
      statistics: {
        schemaVersion: 1,
        estimator: 'raw',
        missingValues: 'reject',
        sampleUnit: 'biological replicate',
        seed: 7
      },
      style: { resolvedSpec: {}, resolvedSpecHash: DIGEST },
      render: {
        outputScale: 1,
        matplotlib: {
          schemaVersion: 1,
          rcParams: { 'figure.dpi': 100 },
          palette: ['#336699']
        },
        autoRepair: { enabled: false, maxAttempts: 0 }
      },
      environment: {
        schemaVersion: 1,
        pythonCommand: 'python3',
        pythonExecutable: '/usr/bin/python3',
        pythonVersion: '3.12',
        platform: 'darwin-arm64',
        packages: { matplotlib: '3.9.0' },
        fontFingerprint: DIGEST,
        environmentDigest: DIGEST
      },
      execution: {
        schemaVersion: 1,
        renderer: 'sciforge-scientific-plotting-mcp',
        rendererVersion: '1.0.0',
        rendererCodeSha256: DIGEST,
        command: ['python3', '<sciforge-scientific-plot-code-artifact>'],
        cwd: '/workspace',
        timeoutMs: 30_000
      },
      reproducibilityMode: 'reproducible',
      provenanceWarnings: []
    },
    attempts: [],
    finalReview: { ok: true },
    warnings: []
  }
}
