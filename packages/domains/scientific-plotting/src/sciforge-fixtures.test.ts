import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import type {
  ArtifactVersionBundleExportInputV1,
  ArtifactVersionBundleImportInputV1,
  ArtifactVersionBundleImportReceiptV1,
  ArtifactVersionBundleReceiptV1,
  ArtifactVersionCommitInputV1,
  ArtifactVersionCommitPortV1,
  ArtifactVersionCommitResultV1,
  ArtifactVersionListInputV1,
  ArtifactVersionListV1,
  ArtifactVersionReadInputV1,
  ArtifactVersionReadPortV1,
  ArtifactVersionReadResultV1,
  ArtifactVersionRefV1,
  ArtifactVersionResultV1
} from '@sciforge/domain-artifact-versions/contract'
import { ARTIFACT_VERSIONS_CAPABILITY_IDS } from '@sciforge/domain-artifact-versions/contract'
import {
  createDomainMainEntry as createArtifactVersionsDomainMainEntry,
  type ArtifactVersionsCapabilityFactory,
  type ArtifactVersionsCapabilityOptions
} from '@sciforge/domain-artifact-versions/main'
import {
  createScientificPlottingService,
  type ScientificPlottingService
} from '@sciforge/scientific-plotting/service'
import type {
  DataSourceRef,
  DerivedTableReceipt,
  ScientificPlottingRenderResult,
  ScientificPlotTransformationV1,
  VisualProductionHandoff
} from '@sciforge/scientific-plotting/contract'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const PLAN: VisualProductionHandoff = {
  planId: 'sciforge-provenance-fixture',
  route: 'code',
  routeLocked: true,
  rationale: 'Verify reproducible plotting with content-bound scientific inputs.',
  sourceArtifacts: [],
  reproducibleInputs: ['pinned fixture versions'],
  lockedElements: ['data', 'statistics', 'labels'],
  modelOwnedElements: [],
  contextStatus: 'ready',
  contextStopReason: 'sufficient',
  contextEvidenceIds: [],
  unresolvedContext: [],
  releaseCeiling: 'publication_ready',
  fallbackPolicy: 'fail_closed'
}
const ACCESS = { audience: 'system' as const, callerId: 'scientific-plotting-fixture' }

type ArtifactVersionCapabilityHarness = Readonly<{
  commit(
    workspaceRoot: string,
    input: ArtifactVersionCommitInputV1,
    access?: typeof ACCESS
  ): Promise<ArtifactVersionCommitResultV1>
  read(
    workspaceRoot: string,
    input: ArtifactVersionReadInputV1,
    access?: typeof ACCESS
  ): Promise<ArtifactVersionReadResultV1>
  list(
    workspaceRoot: string,
    input: ArtifactVersionListInputV1,
    access?: typeof ACCESS
  ): Promise<ArtifactVersionResultV1<ArtifactVersionListV1>>
  exportBundle(
    workspaceRoot: string,
    input: ArtifactVersionBundleExportInputV1,
    access?: typeof ACCESS
  ): Promise<ArtifactVersionResultV1<ArtifactVersionBundleReceiptV1>>
  importBundle(
    workspaceRoot: string,
    input: ArtifactVersionBundleImportInputV1,
    access?: typeof ACCESS
  ): Promise<ArtifactVersionResultV1<ArtifactVersionBundleImportReceiptV1>>
  dispose(): Promise<void>
}>

async function createArtifactVersionCapabilityHarness(
  userDataDir: string
): Promise<ArtifactVersionCapabilityHarness> {
  const entry = createArtifactVersionsDomainMainEntry<ArtifactVersionsCapabilityOptions>({
    defineCapability: (definition: ArtifactVersionsCapabilityOptions) => definition
  } as never)
  const factory = entry.contributions.find(
    ({ kind }) => kind === 'main.capability-factory'
  )?.value as ArtifactVersionsCapabilityFactory<ArtifactVersionsCapabilityOptions> | undefined
  const lifecycle = entry.contributions.find(
    ({ kind }) => kind === 'main.runtime-lifecycle'
  )?.value as { activate(context: unknown): Promise<() => void | Promise<void>> } | undefined
  assert.ok(factory, 'Artifact Versions capability factory contribution is required.')
  assert.ok(lifecycle, 'Artifact Versions lifecycle contribution is required.')
  const dispose = await lifecycle.activate({ userDataDir })
  const definitions = new Map(factory.createDefinitions().map((definition) => [definition.id, definition]))
  const invoke = async <T>(workspaceRoot: string, id: string, input: unknown): Promise<T> => {
    const definition = definitions.get(id)
    assert.ok(definition, `Missing Artifact Versions capability ${id}`)
    const result = await definition.handler(input, {
      caller: { ...ACCESS, workspaceId: workspaceRoot }
    })
    return result.output as T
  }
  return {
    commit: (workspaceRoot, input) => invoke(
      workspaceRoot,
      ARTIFACT_VERSIONS_CAPABILITY_IDS.commit,
      input
    ),
    read: (workspaceRoot, input) => invoke(
      workspaceRoot,
      ARTIFACT_VERSIONS_CAPABILITY_IDS.read,
      input
    ),
    list: (workspaceRoot, input) => invoke(
      workspaceRoot,
      ARTIFACT_VERSIONS_CAPABILITY_IDS.list,
      input
    ),
    exportBundle: (workspaceRoot, input) => invoke(
      workspaceRoot,
      ARTIFACT_VERSIONS_CAPABILITY_IDS.exportBundle,
      input
    ),
    importBundle: (workspaceRoot, input) => invoke(
      workspaceRoot,
      ARTIFACT_VERSIONS_CAPABILITY_IDS.importBundle,
      input
    ),
    dispose: async () => { await dispose() }
  }
}

test('fixture: treatment-response keeps data/statistics fixed across style v2 and exact rerun', {
  timeout: 120_000
}, async (context) => {
  if (!await rendererAvailable(createScientificPlottingService())) {
    context.skip('Matplotlib renderer is unavailable in this environment.')
    return
  }
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-treatment-response-'))
  const cleanWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-treatment-clean-room-'))
  const artifactVersions = await createArtifactVersionCapabilityHarness(
    join(workspace, '.artifact-version-test-data')
  )
  try {
    const service = createScientificPlottingService({
      artifactVersionCommitPort: commitPort(artifactVersions, workspace),
      artifactVersionReadPort: readPort(artifactVersions, workspace)
    })
    const csv = await readFile(join(FIXTURES, 'treatment-response.csv'))
    const rows = parseDelimited(csv.toString('utf8'), ',')
    const data = {
      groups: ['Control', 'Treatment'].map((name) => ({
        name,
        values: rows
          .filter((row) => row.group === name)
          .map((row) => Number(row.response))
      })),
      mode: 'violin',
      showPoints: true
    }
    const sourceHash = sha256(csv)
    const sourceRef = await persistFixtureArtifact(artifactVersions, workspace, {
      candidateId: 'fixture:treatment-response:v1',
      kind: 'dataset',
      label: 'treatment-response.csv',
      bytes: csv,
      mediaType: 'text/csv'
    })
    const dataHash = hashJson(data)
    const transformation: ScientificPlotTransformationV1 = {
      schemaVersion: 1,
      transformationId: 'treatment-csv-to-groups',
      kind: 'tabular-map',
      description: 'Group raw treatment-response observations without aggregation.',
      parameters: { groupColumn: 'group', valueColumn: 'response' },
      inputHash: sourceHash,
      outputHash: dataHash
    }
    const receipt: DerivedTableReceipt = {
      schemaVersion: 1,
      receiptId: 'treatment-grouped-values',
      inputSourceIds: ['treatment-response-csv'],
      operation: 'tabular-map',
      inputHash: sourceHash,
      outputHash: dataHash,
      transformationIds: [transformation.transformationId],
      rowCount: rows.length,
      columnCount: 3,
      columns: ['sample', 'group', 'response'],
      warnings: []
    }
    const common = {
      workspaceRoot: workspace,
      visualPlan: PLAN,
      template: 'box-violin' as const,
      figureId: 'treatment-response',
      data,
      reproducibilityMode: 'reproducible' as const,
      dataSources: [{
        schemaVersion: 1 as const,
        sourceId: 'treatment-response-csv',
        kind: 'artifact-version' as const,
        locator: `snapshot:${sourceRef.versionId}`,
        sha256: sourceHash,
        mediaType: 'text/csv',
        artifactVersion: sourceRef
      }],
      transformations: [transformation],
      derivedTableReceipts: [receipt],
      statistics: {
        schemaVersion: 1 as const,
        estimator: 'raw' as const,
        missingValues: 'reject' as const,
        sampleUnit: 'biological sample'
      },
      labels: { title: 'Treatment response', y: 'Response' }
    }
    const v1 = await service.render({
      ...common,
      operationId: 'fixture:treatment:render:v1',
      styleProfileId: 'nature-publication-light'
    })
    assert.equal(v1.ok, true, JSON.stringify(v1))
    if (!v1.ok) return
    const v1Versions = plotVersionRefs(v1)
    const v1Figure = v1Versions.figure
    const v2 = await service.render({
      ...common,
      operationId: 'fixture:treatment:render:v2',
      styleProfileId: 'cell-systems-statistical',
      versioning: {
        artifactId: v1Figure.artifactId,
        expectedCurrentVersionId: v1Figure.versionId,
        intent: 'save'
      }
    })
    assert.equal(v2.ok, true, JSON.stringify(v2))
    if (!v2.ok) return
    const v2Figure = figureVersionRef(v2)
    const styleComparison = await service.compare({
      workspaceRoot: workspace,
      baselineManifestVersionRef: v1Versions.manifest,
      candidateManifestVersionRef: plotVersionRefs(v2).manifest
    })
    assert.equal(styleComparison.ok, true, JSON.stringify(styleComparison))
    if (styleComparison.ok) {
      assert.equal(styleComparison.comparison.dataEquivalent, true)
      assert.equal(styleComparison.comparison.statisticsEquivalent, true)
      assert.equal(styleComparison.comparison.sourcesEquivalent, true)
      assert.equal(styleComparison.comparison.styleEquivalent, false)
      assert.ok(styleComparison.comparison.changedSections.includes('style'))
    }
    await Promise.all([v1.outputPath, v1.manifestPath, v1.recipePath].map(
      (path) => rm(path, { force: true })
    ))
    const rerun = await service.rerun({
      workspaceRoot: workspace,
      operationId: 'fixture:treatment:rerun:v1',
      baselineFigureVersionRef: v1Versions.figure,
      recipeVersionRef: v1Versions.recipe,
      expectedCurrentVersionId: v2Figure.versionId
    })
    assert.equal(rerun.ok, true, JSON.stringify(rerun))
    if (rerun.ok) {
      assert.equal(rerun.comparison.exactOutput, true)
      assert.equal(rerun.reproductionRelation, 'replicates')
      assert.equal(rerun.comparison.dataEquivalent, true)
      assert.equal(rerun.comparison.statisticsEquivalent, true)
      assert.equal(rerun.reproductionRelation, 'replicates')
    }
    const history = await artifactVersions.list(workspace, { artifactId: v1Figure.artifactId }, ACCESS)
    assert.equal(history.ok, true, JSON.stringify(history))
    if (history.ok) assert.equal(history.value.items.length, 3)

    const exported = await artifactVersions.exportBundle(workspace, {
      idempotencyKey: 'fixture:treatment:bundle:v1',
      versionIds: [v1Figure.versionId],
      destinationPath: 'exports/treatment-v1.artifact-bundle.json'
    }, ACCESS)
    assert.equal(exported.ok, true, JSON.stringify(exported))
    if (!exported.ok) return
    await mkdir(join(cleanWorkspace, 'imports'), { recursive: true })
    await copyFile(
      join(workspace, exported.value.path),
      join(cleanWorkspace, 'imports', 'treatment-v1.artifact-bundle.json')
    )
    const imported = await artifactVersions.importBundle(cleanWorkspace, {
      idempotencyKey: 'fixture:treatment:import:v1',
      bundlePath: 'imports/treatment-v1.artifact-bundle.json',
      conflictPolicy: 'reject'
    }, ACCESS)
    assert.equal(imported.ok, true, JSON.stringify(imported))
    if (!imported.ok) return
    assert.equal(imported.value.versionIdMap[v1Figure.versionId], v1Figure.versionId)
    assert.equal(imported.value.versionIdMap[v1Versions.recipe.versionId], v1Versions.recipe.versionId)
    const cleanService = createScientificPlottingService({
      artifactVersionCommitPort: commitPort(artifactVersions, cleanWorkspace),
      artifactVersionReadPort: readPort(artifactVersions, cleanWorkspace)
    })
    const cleanRerun = await cleanService.rerun({
      workspaceRoot: cleanWorkspace,
      operationId: 'fixture:treatment:clean-rerun:v1',
      baselineFigureVersionRef: v1Versions.figure,
      recipeVersionRef: v1Versions.recipe,
      expectedCurrentVersionId: v1Versions.figure.versionId
    })
    assert.equal(cleanRerun.ok, true, JSON.stringify(cleanRerun))
    if (cleanRerun.ok) {
      assert.equal(cleanRerun.comparison.exactOutput, true)
      assert.equal(cleanRerun.reproductionRelation, 'replicates')
    }
  } finally {
    await artifactVersions.dispose()
    if (process.env.SCIFORGE_KEEP_FIXTURE_WORKSPACE === '1') {
      context.diagnostic(`retained fixture workspace: ${workspace}`)
    } else {
      await rm(workspace, { recursive: true, force: true })
      await rm(cleanWorkspace, { recursive: true, force: true })
    }
  }
})

test('fixture: single-cell v1 remains rerunnable after matrix v2 and extractor failures close safely', {
  timeout: 120_000
}, async (context) => {
  if (!await rendererAvailable(createScientificPlottingService())) {
    context.skip('Matplotlib renderer is unavailable in this environment.')
    return
  }
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-single-cell-'))
  const artifactVersions = await createArtifactVersionCapabilityHarness(
    join(workspace, '.artifact-version-test-data')
  )
  try {
    const service = createScientificPlottingService({
      artifactVersionCommitPort: commitPort(artifactVersions, workspace),
      artifactVersionReadPort: readPort(artifactVersions, workspace)
    })
    const v1Sources = await persistSingleCellSources(artifactVersions, workspace, 'v1')
    const v1Chain = await singleCellChain('v1', v1Sources)
    const v1 = await service.render({
      workspaceRoot: workspace,
      operationId: 'fixture:single-cell:render:v1',
      visualPlan: PLAN,
      template: 'heatmap',
      figureId: 'marker-expression',
      data: v1Chain.data,
      reproducibilityMode: 'reproducible',
      dataSources: v1Chain.sources,
      transformations: v1Chain.transformations,
      derivedTableReceipts: v1Chain.receipts,
      statistics: { schemaVersion: 1, estimator: 'none', missingValues: 'reject' },
      labels: { title: 'Marker expression v1' }
    })
    assert.equal(v1.ok, true, JSON.stringify(v1))
    if (!v1.ok) return
    const v1Versions = plotVersionRefs(v1)
    const v1Figure = v1Versions.figure
    assert.deepEqual(v1.recipe.render.matplotlib?.heatmapCmap, {
      kind: 'named',
      name: 'cividis'
    })
    const v2Sources = await persistSingleCellSources(
      artifactVersions,
      workspace,
      'v2',
      v1Sources
    )
    const v2Chain = await singleCellChain('v2', v2Sources)
    const v2 = await service.render({
      workspaceRoot: workspace,
      operationId: 'fixture:single-cell:render:v2',
      visualPlan: PLAN,
      template: 'heatmap',
      figureId: 'marker-expression',
      data: v2Chain.data,
      reproducibilityMode: 'reproducible',
      dataSources: v2Chain.sources,
      transformations: v2Chain.transformations,
      derivedTableReceipts: v2Chain.receipts,
      statistics: { schemaVersion: 1, estimator: 'none', missingValues: 'reject' },
      labels: { title: 'Marker expression v2' },
      versioning: {
        artifactId: v1Figure.artifactId,
        expectedCurrentVersionId: v1Figure.versionId,
        intent: 'save'
      }
    })
    assert.equal(v2.ok, true, JSON.stringify(v2))
    if (!v2.ok) return
    const v2Figure = figureVersionRef(v2)
    const changed = await service.compare({
      workspaceRoot: workspace,
      baselineManifestVersionRef: v1Versions.manifest,
      candidateManifestVersionRef: plotVersionRefs(v2).manifest
    })
    assert.equal(changed.ok, true, JSON.stringify(changed))
    if (changed.ok) {
      assert.equal(changed.comparison.dataEquivalent, false)
      assert.equal(changed.comparison.sourcesEquivalent, false)
      assert.ok(changed.comparison.changedSections.includes('sources'))
    }
    await Promise.all([v1.outputPath, v1.manifestPath, v1.recipePath].map(
      (path) => rm(path, { force: true })
    ))
    const oldRerun = await service.rerun({
      workspaceRoot: workspace,
      operationId: 'fixture:single-cell:rerun:v1',
      baselineFigureVersionRef: v1Versions.figure,
      recipeVersionRef: v1Versions.recipe,
      expectedCurrentVersionId: v2Figure.versionId
    })
    assert.equal(oldRerun.ok, true, JSON.stringify(oldRerun))
    if (oldRerun.ok) {
      assert.equal(oldRerun.comparison.exactOutput, true, JSON.stringify(oldRerun.comparison))
      assert.equal(oldRerun.reproductionRelation, 'replicates')
      assert.equal(oldRerun.comparison.sourcesEquivalent, true)
      assert.deepEqual(oldRerun.render.recipe.render.matplotlib?.heatmapCmap, {
        kind: 'named',
        name: 'cividis'
      })
      const rerunSource = oldRerun.render.recipe.dataSources[0]
      assert.equal(rerunSource?.kind, 'artifact-version')
      if (rerunSource?.kind === 'artifact-version') {
        assert.equal(
          rerunSource.artifactVersion.versionId,
          v1Chain.sources[0]?.artifactVersion.versionId
        )
      }
    }
    const history = await artifactVersions.list(workspace, { artifactId: v1Figure.artifactId }, ACCESS)
    assert.equal(history.ok, true, JSON.stringify(history))
    if (history.ok) assert.equal(history.value.items.length, 3)

    const h5adBytes = await readFile(join(FIXTURES, 'single-cell', 'unsupported.h5ad'))
    const h5adPath = join(workspace, 'unsupported.h5ad')
    await writeFile(h5adPath, h5adBytes)
    const failed = await service.render({
      workspaceRoot: workspace,
      operationId: 'fixture:single-cell:h5ad-failure',
      visualPlan: PLAN,
      template: 'heatmap',
      data: v1Chain.data,
      reproducibilityMode: 'reproducible',
      dataSources: [{
        schemaVersion: 1,
        sourceId: 'unverified-h5ad',
        kind: 'workspace-file',
        locator: h5adPath,
        sha256: '0'.repeat(64),
        mediaType: 'application/x-hdf5'
      }],
      transformations: [{
        schemaVersion: 1,
        transformationId: 'missing-h5ad-extractor',
        kind: 'caller-supplied',
        description: 'A missing domain extractor must never silently substitute data.',
        parameters: { extractor: 'unavailable' },
        inputHash: '0'.repeat(64),
        outputHash: hashJson(v1Chain.data)
      }],
      statistics: { schemaVersion: 1, estimator: 'none', missingValues: 'reject' }
    })
    assert.equal(failed.ok, false)
    if (!failed.ok) assert.match(failed.message, /pinned ArtifactVersionRefV1|hash mismatch/u)
  } finally {
    await artifactVersions.dispose()
    if (process.env.SCIFORGE_KEEP_FIXTURE_WORKSPACE === '1') {
      context.diagnostic(`retained fixture workspace: ${workspace}`)
    } else {
      await rm(workspace, { recursive: true, force: true })
    }
  }
})

async function rendererAvailable(service: ScientificPlottingService): Promise<boolean> {
  const status = await service.status()
  return status.ok && status.renderer.available
}

type SingleCellSourceRefs = Readonly<{
  matrix: ArtifactVersionRefV1
  features: ArtifactVersionRefV1
  barcodes: ArtifactVersionRefV1
  markerSummary: ArtifactVersionRefV1
}>

async function singleCellChain(
  version: 'v1' | 'v2',
  refs: SingleCellSourceRefs
): Promise<{
  data: { matrix: number[][]; xLabels: string[]; yLabels: string[] }
  sources: Extract<DataSourceRef, { kind: 'artifact-version' }>[]
  transformations: ScientificPlotTransformationV1[]
  receipts: DerivedTableReceipt[]
}> {
  const directory = join(FIXTURES, 'single-cell')
  const entries = await Promise.all([
    readFile(join(directory, `matrix-${version}.mtx`)),
    readFile(join(directory, 'features.tsv')),
    readFile(join(directory, 'barcodes.tsv')),
    readFile(join(directory, `marker-summary-${version}.tsv`))
  ])
  const names = [`matrix-${version}`, 'features-v1', 'barcodes-v1', `marker-summary-${version}`]
  const mediaTypes = ['text/plain', 'text/tab-separated-values', 'text/tab-separated-values', 'text/tab-separated-values']
  const sourceRefs = [refs.matrix, refs.features, refs.barcodes, refs.markerSummary]
  const sources = entries.map((bytes, index) => {
    assert.equal(sourceRefs[index]!.contentDigest, sha256(bytes))
    return artifactSource(names[index]!, sourceRefs[index]!, mediaTypes[index]!)
  })
  const markerRows = parseDelimited(entries[3]!.toString('utf8'), '\t')
  const columns = Object.keys(markerRows[0] ?? {}).filter((column) => column !== 'marker')
  const data = {
    matrix: markerRows.map((row) => columns.map((column) => Number(row[column]))),
    xLabels: columns,
    yLabels: markerRows.map((row) => row.marker!)
  }
  const combinedRawHash = hashJson(sources.slice(0, 3).map((source) => source.sha256))
  const markerHash = sources[3]!.sha256
  const dataHash = hashJson(data)
  const transformations: ScientificPlotTransformationV1[] = [{
    schemaVersion: 1,
    transformationId: `omics-analysis-${version}`,
    kind: 'caller-supplied',
    description: 'Domain omics analysis creates the pinned marker summary table.',
    parameters: { analysisRun: `omics-run-${version}` },
    inputHash: combinedRawHash,
    outputHash: markerHash
  }, {
    schemaVersion: 1,
    transformationId: `marker-heatmap-map-${version}`,
    kind: 'matrix-map',
    description: 'Map the marker summary table into heatmap matrix and labels.',
    parameters: { rowKey: 'marker', columns },
    inputHash: markerHash,
    outputHash: dataHash
  }]
  const receipts: DerivedTableReceipt[] = [{
    schemaVersion: 1,
    receiptId: `marker-summary-receipt-${version}`,
    inputSourceIds: sources.slice(0, 3).map((source) => source.sourceId),
    operation: 'caller-supplied',
    inputHash: combinedRawHash,
    outputHash: markerHash,
    transformationIds: [transformations[0]!.transformationId],
    rowCount: markerRows.length,
    columnCount: columns.length + 1,
    columns: ['marker', ...columns],
    warnings: []
  }, {
    schemaVersion: 1,
    receiptId: `heatmap-table-receipt-${version}`,
    inputSourceIds: [sources[3]!.sourceId],
    operation: 'matrix-map',
    inputHash: markerHash,
    outputHash: dataHash,
    transformationIds: [transformations[1]!.transformationId],
    rowCount: markerRows.length,
    columnCount: columns.length,
    columns,
    warnings: []
  }]
  return { data, sources, transformations, receipts }
}

function artifactSource(
  sourceId: string,
  artifactVersion: ArtifactVersionRefV1,
  mediaType: string
): Extract<DataSourceRef, { kind: 'artifact-version' }> {
  return {
    schemaVersion: 1,
    sourceId,
    kind: 'artifact-version',
    locator: `snapshot:${artifactVersion.versionId}`,
    sha256: artifactVersion.contentDigest,
    mediaType,
    artifactVersion
  }
}

function commitPort(
  service: ArtifactVersionCapabilityHarness,
  workspaceRoot: string
): ArtifactVersionCommitPortV1 {
  return {
    commit: async (input) => service.commit(workspaceRoot, input, ACCESS)
  }
}

function readPort(
  service: ArtifactVersionCapabilityHarness,
  workspaceRoot: string
): ArtifactVersionReadPortV1 {
  return {
    read: async (input) => service.read(workspaceRoot, input, ACCESS)
  }
}

async function persistFixtureArtifact(
  service: ArtifactVersionCapabilityHarness,
  workspaceRoot: string,
  input: Readonly<{
    candidateId: string
    kind: string
    label: string
    bytes: Buffer
    mediaType: string
    previous?: ArtifactVersionRefV1
  }>
): Promise<ArtifactVersionRefV1> {
  const result = await service.commit(workspaceRoot, {
    idempotencyKey: `${input.candidateId}:${sha256(input.bytes)}`,
    candidates: [{
      candidateId: input.candidateId,
      ...(input.previous ? { artifactId: input.previous.artifactId } : {}),
      expectedCurrentVersionId: input.previous?.versionId ?? null,
      kind: input.kind,
      label: input.label,
      intent: 'save',
      content: {
        mode: 'snapshot',
        dataBase64: input.bytes.toString('base64'),
        mediaType: input.mediaType
      },
      accessPolicy: {
        visibility: 'workspace',
        principals: [],
        allowExport: true
      }
    }]
  }, ACCESS)
  if (!result.ok) assert.fail(result.issue.message)
  const committed = result.value.versions.find((item) => item.candidateId === input.candidateId)
  assert.ok(committed, `Missing committed candidate ${input.candidateId}`)
  return committed.ref
}

async function persistSingleCellSources(
  service: ArtifactVersionCapabilityHarness,
  workspaceRoot: string,
  version: 'v1' | 'v2',
  previous?: SingleCellSourceRefs
): Promise<SingleCellSourceRefs> {
  const directory = join(FIXTURES, 'single-cell')
  const matrix = await persistFixtureArtifact(service, workspaceRoot, {
    candidateId: `fixture:single-cell:matrix:${version}`,
    kind: 'dataset',
    label: `single-cell matrix ${version}`,
    bytes: await readFile(join(directory, `matrix-${version}.mtx`)),
    mediaType: 'text/plain',
    ...(previous ? { previous: previous.matrix } : {})
  })
  const markerSummary = await persistFixtureArtifact(service, workspaceRoot, {
    candidateId: `fixture:single-cell:marker-summary:${version}`,
    kind: 'dataset',
    label: `marker summary ${version}`,
    bytes: await readFile(join(directory, `marker-summary-${version}.tsv`)),
    mediaType: 'text/tab-separated-values',
    ...(previous ? { previous: previous.markerSummary } : {})
  })
  const features = previous?.features ?? await persistFixtureArtifact(service, workspaceRoot, {
    candidateId: 'fixture:single-cell:features:v1',
    kind: 'dataset',
    label: 'single-cell features',
    bytes: await readFile(join(directory, 'features.tsv')),
    mediaType: 'text/tab-separated-values'
  })
  const barcodes = previous?.barcodes ?? await persistFixtureArtifact(service, workspaceRoot, {
    candidateId: 'fixture:single-cell:barcodes:v1',
    kind: 'dataset',
    label: 'single-cell barcodes',
    bytes: await readFile(join(directory, 'barcodes.tsv')),
    mediaType: 'text/tab-separated-values'
  })
  return { matrix, features, barcodes, markerSummary }
}

function figureVersionRef(
  render: Extract<ScientificPlottingRenderResult, { ok: true }>
): ArtifactVersionRefV1 {
  return plotVersionRefs(render).figure
}

function plotVersionRefs(
  render: Extract<ScientificPlottingRenderResult, { ok: true }>
): Readonly<{
  figure: ArtifactVersionRefV1
  recipe: ArtifactVersionRefV1
  manifest: ArtifactVersionRefV1
}> {
  const commit = render.versionCommit
  assert.ok(commit, 'Expected a formal ArtifactVersion commit for the rendered figure.')
  if (!commit.result.ok) assert.fail(commit.result.issue.message)
  const byCandidateId = new Map(commit.result.value.versions.map((item) => [item.candidateId, item]))
  const figure = byCandidateId.get(commit.candidateIds.figure)
  const recipe = byCandidateId.get(commit.candidateIds.recipe)
  const manifest = byCandidateId.get(commit.candidateIds.renderManifest)
  assert.ok(figure, 'ArtifactVersion receipt is missing the Figure candidate.')
  assert.ok(recipe, 'ArtifactVersion receipt is missing the recipe candidate.')
  assert.ok(manifest, 'ArtifactVersion receipt is missing the render-manifest candidate.')
  return { figure: figure.ref, recipe: recipe.ref, manifest: manifest.ref }
}

function parseDelimited(text: string, delimiter: ',' | '\t'): Array<Record<string, string>> {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/u)
  const headers = headerLine?.split(delimiter) ?? []
  return lines.map((line) => Object.fromEntries(
    line.split(delimiter).map((value, index) => [headers[index]!, value])
  ))
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}
