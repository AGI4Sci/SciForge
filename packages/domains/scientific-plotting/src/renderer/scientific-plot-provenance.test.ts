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
  parseScientificPlotManifest
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
  const figure = historyItem('scientific-plot', 'figure-v1', [dependency('recipe', recipe.ref)], {
    currentVersionId: 'artifact-version:figure-v2'
  })
  const manifest = historyItem(
    'scientific-plot-render-manifest',
    'manifest',
    [dependency('recipe', recipe.ref), dependency('figure', figure.ref)],
    { metadata: { manifestPath: '.sciforge/plots/figure-v1.manifest.json' } }
  )
  const log = historyItem('scientific-plot-render-log', 'log', [], {
    metadata: { plotVersionId: 'plot-v1' }
  })
  const items = [manifest, recipe, figure, derived, log]
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
  assert.deepEqual(result.records[0], {
    manifest: parsed.value,
    manifestPath: '.sciforge/plots/figure-v1.manifest.json',
    manifestItem: manifest,
    manifestRef: manifest.ref,
    recipeRef: recipe.ref,
    figureRef: figure.ref,
    derivedDataRef: derived.ref,
    logRef: log.ref,
    currentFigureVersionId: 'artifact-version:figure-v2'
  })
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

function historyItem(
  kind: string,
  stem: string,
  dependencies: ArtifactVersionDependencyRefV1[],
  options: Readonly<{
    currentVersionId?: string
    metadata?: Record<string, string>
  }> = {}
): ArtifactVersionListV1['items'][number] {
  const artifactId = `artifact:${stem}`
  const versionId = `artifact-version:${stem}`
  const ref: ArtifactVersionRefV1 = {
    artifactId,
    versionId,
    contentDigest: DIGEST,
    byteLength: 42,
    mediaType: kind === 'scientific-plot' ? 'image/png' : 'application/json',
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
        byteLength: 42,
        mediaType: ref.mediaType
      },
      dependencies,
      accessPolicy: ACCESS,
      metadata: options.metadata ?? {}
    },
    ref
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
        command: ['python3', '-c', '<renderer>'],
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
