import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  ArtifactVersionDependencyRefV1,
  ArtifactVersionListV1,
  ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import type { ScientificPlottingCapabilityClient } from './scientific-plotting-capability-client.js'
import {
  loadScientificPlotProvenance,
  parseScientificPlotManifest,
  scientificPlotRerunAvailability
} from './scientific-plot-provenance.js'

const DIGEST = 'a'.repeat(64)
const CREATED_AT = '2026-08-06T01:00:00.000Z'
const ACCESS = {
  visibility: 'workspace' as const,
  principals: [],
  allowExport: true
}

test('loads exact plot manifest, recipe, figure, data, and log refs from Artifact Versions', async () => {
  const derived = historyItem('scientific-plot-derived-data', 'derived', [])
  const recipe = historyItem('scientific-plot-recipe', 'recipe', [dependency('derived-data', derived.ref)])
  const code = historyItem('scientific-plot-code', 'code-v1', [dependency('recipe', recipe.ref)], {
    metadata: { codePath: '.sciforge/plots/figure-v1.render.py' }
  })
  const figure = historyItem('scientific-plot', 'figure-v1', [dependency('recipe', recipe.ref), dependency('code', code.ref)], {
    currentVersionId: 'artifact-version:figure-v2'
  })
  const manifest = historyItem(
    'scientific-plot-render-manifest',
    'manifest',
    [dependency('recipe', recipe.ref), dependency('figure', figure.ref), dependency('code', code.ref)],
    { metadata: { manifestPath: '.sciforge/plots/figure-v1.manifest.json' } }
  )
  const log = historyItem('scientific-plot-render-log', 'log', [], {
    metadata: { plotVersionId: 'plot-v1' }
  })
  const source = historyItem('dataset', 'input-v1', [], {
    byteLength: 10,
    mediaType: 'text/csv',
    artifactId: 'artifact:input'
  })
  const items = [manifest, recipe, figure, code, derived, source, log]
  const encodedManifest = Buffer.from(JSON.stringify(plotManifest()), 'utf8').toString('base64')
  const client: ScientificPlottingCapabilityClient = {
    listArtifactVersions: async () => ({ ok: true, value: { items } }),
    readArtifactVersion: async (_workspaceRoot, input) => input.versionId === manifest.ref.versionId
      ? {
          ok: true,
          value: {
            artifact: manifest.artifact,
            version: manifest.version,
            ref: manifest.ref,
            dataBase64: encodedManifest
          }
        }
      : { ok: false, issue: { code: 'version-not-found', message: 'not found' } },
    materializeArtifactVersion: async () => ({ ok: false, issue: { code: 'io-failure', message: 'not used' } }),
    rerun: async () => ({
      ok: false,
      status: 'version_read_failed',
      message: 'not used',
      provenanceBreakpoints: [{
        schemaVersion: 1,
        code: 'exact-rerun-failed',
        stage: 'baseline',
        message: 'not used',
        retryable: false
      }]
    }),
    compare: async () => ({
      ok: false,
      status: 'manifest_read_failed',
      message: 'not used'
    })
  }

  const result = await loadScientificPlotProvenance(client, '/workspace')
  assert.equal(result.issues.length, 0)
  assert.equal(result.records.length, 1)
  const parsed = parseScientificPlotManifest(encodedManifest)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const record = result.records[0]
  assert.ok(record)
  assert.deepEqual(record.manifest, parsed.value)
  assert.equal(record.manifestPath, '.sciforge/plots/figure-v1.manifest.json')
  assert.equal(record.manifestItem, manifest)
  assert.equal(record.manifestRef, manifest.ref)
  assert.equal(record.recipeRef, recipe.ref)
  assert.equal(record.codeRef, code.ref)
  assert.equal(record.figureRef, figure.ref)
  assert.equal(record.derivedDataRef, derived.ref)
  assert.equal(record.logRef, log.ref)
  assert.equal(record.currentFigureVersionId, 'artifact-version:figure-v2')
  assert.equal(record.figureStatus, 'available')
  assert.deepEqual(record.supportingVersions.map(({ ref }) => ref.versionId), [
    manifest.ref.versionId,
    recipe.ref.versionId,
    derived.ref.versionId,
    code.ref.versionId,
    source.ref.versionId,
    log.ref.versionId
  ])
  assert.ok(record.supportingVersions.every(({ status }) => status === 'available'))
})

test('retains missing and restricted dependency states instead of dropping the Figure', async () => {
  const derived = historyItem('scientific-plot-derived-data', 'derived', [])
  const recipe = historyItem('scientific-plot-recipe', 'recipe', [dependency('derived-data', derived.ref)])
  const code = historyItem('scientific-plot-code', 'code-v1', [dependency('recipe', recipe.ref)])
  const figure = historyItem('scientific-plot', 'figure-v1', [dependency('recipe', recipe.ref), dependency('code', code.ref)])
  const manifest = historyItem(
    'scientific-plot-render-manifest',
    'manifest',
    [dependency('recipe', recipe.ref), dependency('figure', figure.ref), dependency('code', code.ref)],
    { metadata: { manifestPath: '.sciforge/plots/figure.manifest.json' } }
  )
  const parsedManifest = plotManifest() as Record<string, unknown>
  const parsedRecipe = parsedManifest.recipe as Record<string, unknown>
  const dataSources = parsedRecipe.dataSources as Array<Record<string, unknown>>
  const sourceRef = dataSources[0]?.artifactVersion as ArtifactVersionRefV1
  const restrictedRef = { ...sourceRef, accessPolicy: { visibility: 'restricted' as const, principals: ['user:owner'], allowExport: false } }
  dataSources[0] = { ...dataSources[0], artifactVersion: restrictedRef, sha256: restrictedRef.contentDigest }
  dataSources.push({
    ...dataSources[0],
    sourceId: 'missing-input',
    artifactVersion: { ...sourceRef, artifactId: 'artifact:missing-input', versionId: 'artifact-version:missing-input' },
    sha256: sourceRef.contentDigest
  })
  const encodedManifest = Buffer.from(JSON.stringify(parsedManifest), 'utf8').toString('base64')
  const client = provenanceClient([manifest, recipe, figure, code, derived], manifest, encodedManifest)

  const result = await loadScientificPlotProvenance(client, '/workspace')
  assert.equal(result.records.length, 1)
  assert.ok(result.issues.some((issue) => issue.includes('not present in the authorized Version listing')))
  assert.ok(result.issues.some((issue) => issue.includes('access is restricted')))
  const record = result.records[0]!
  assert.equal(record.figureStatus, 'available')
  assert.equal(record.supportingVersions.find(({ ref }) => ref.versionId === sourceRef.versionId)?.status, 'restricted')
  assert.equal(scientificPlotRerunAvailability(record).allowed, false)
})

test('disables rerun for a legacy Version without a committed Code Artifact', async () => {
  const recipe = historyItem('scientific-plot-recipe', 'recipe', [])
  const figure = historyItem('scientific-plot', 'figure-v1', [dependency('recipe', recipe.ref)])
  const manifest = historyItem(
    'scientific-plot-render-manifest',
    'manifest',
    [dependency('recipe', recipe.ref), dependency('figure', figure.ref)],
    { metadata: { manifestPath: '.sciforge/plots/legacy.manifest.json' } }
  )
  const encodedManifest = Buffer.from(JSON.stringify(plotManifest()), 'utf8').toString('base64')
  const client = provenanceClient([manifest, recipe, figure], manifest, encodedManifest)
  const result = await loadScientificPlotProvenance(client, '/workspace')
  assert.equal(result.records.length, 1)
  const availability = scientificPlotRerunAvailability(result.records[0]!)
  assert.equal(availability.allowed, false)
  assert.match(availability.reason, /committed executable Code Artifact/)
})

test('rejects malformed bytes instead of presenting incomplete provenance as ready', () => {
  const malformed = Buffer.from(JSON.stringify({
    version: 1,
    renderer: 'sciforge-scientific-plotting-mcp',
    tool: 'scientific_plotting_render'
  }), 'utf8').toString('base64')
  assert.deepEqual(parseScientificPlotManifest(malformed), {
    ok: false,
    message: 'snapshot is not a valid Scientific Plot render manifest.'
  })
})

test('rejects model-only receipts from the Scientific Plotting projection', () => {
  const manifest = plotManifest() as Record<string, unknown>
  const recipe = manifest.recipe as Record<string, unknown>
  recipe.visualPlan = { route: 'model' }
  const encoded = Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64')

  assert.deepEqual(parseScientificPlotManifest(encoded), {
    ok: false,
    message: 'snapshot is a model-only image receipt; inspect it through Image Generation and Visual Review.'
  })
})

function historyItem(
  kind: string,
  stem: string,
  dependencies: ArtifactVersionDependencyRefV1[],
  options: Readonly<{
    currentVersionId?: string
    metadata?: Record<string, string>
    byteLength?: number
    mediaType?: string
    artifactId?: string
    versionId?: string
  }> = {}
): ArtifactVersionListV1['items'][number] {
  const artifactId = options.artifactId ?? `artifact:${stem}`
  const versionId = options.versionId ?? `artifact-version:${stem}`
  const ref: ArtifactVersionRefV1 = {
    artifactId,
    versionId,
    contentDigest: DIGEST,
    byteLength: options.byteLength ?? 42,
    mediaType: options.mediaType ?? (kind === 'scientific-plot'
      ? 'image/png'
      : kind === 'scientific-plot-code' ? 'text/x-python' : 'application/json'),
    availability: 'available',
    retention: 'snapshot',
    accessPolicy: ACCESS
  }
  return {
    artifact: {
      artifactId,
      kind,
      label: stem,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      currentVersionId: options.currentVersionId ?? versionId,
      versionCount: options.currentVersionId ? 2 : 1
    },
    version: {
      schemaVersion: 1,
      versionId,
      artifactId,
      sequence: 1,
      transactionId: `artifact-commit:${stem}`,
      createdAt: CREATED_AT,
      intent: 'save',
      storage: {
        mode: 'snapshot',
        contentDigest: DIGEST,
        byteLength: options.byteLength ?? 42,
        mediaType: ref.mediaType
      },
      dependencies,
      accessPolicy: ACCESS,
      metadata: options.metadata ?? {}
    },
    ref
  }
}

function provenanceClient(
  items: ArtifactVersionListV1['items'],
  manifest: ArtifactVersionListV1['items'][number],
  encodedManifest: string
): ScientificPlottingCapabilityClient {
  return {
    listArtifactVersions: async () => ({ ok: true, value: { items } }),
    readArtifactVersion: async (_workspaceRoot, input) => input.versionId === manifest.ref.versionId
      ? {
          ok: true,
          value: {
            artifact: manifest.artifact,
            version: manifest.version,
            ref: manifest.ref,
            dataBase64: encodedManifest
          }
        }
      : { ok: false, issue: { code: 'version-not-found', message: 'not found' } },
    materializeArtifactVersion: async () => ({ ok: false, issue: { code: 'io-failure', message: 'not used' } }),
    rerun: async () => ({
      ok: false,
      status: 'version_read_failed',
      message: 'not used',
      provenanceBreakpoints: [{
        schemaVersion: 1,
        code: 'exact-rerun-failed',
        stage: 'baseline',
        message: 'not used',
        retryable: false
      }]
    }),
    compare: async () => ({ ok: false, status: 'manifest_read_failed', message: 'not used' })
  }
}

function dependency(role: string, target: ArtifactVersionRefV1): ArtifactVersionDependencyRefV1 {
  return { role, required: true, target }
}

function plotManifest(): unknown {
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
