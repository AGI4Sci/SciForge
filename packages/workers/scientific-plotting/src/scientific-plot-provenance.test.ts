import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  artifactVersionAccessPolicyV1Schema,
  type ArtifactVersionCommitInputV1,
  type ArtifactVersionCommitPortV1,
  type ArtifactVersionReadPortV1,
  type ArtifactVersionReadV1,
  type ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import { dataSourceRefSchema } from './contract'
import {
  getScientificPlottingStatus,
  mapScientificPlottingData,
  renderScientificPlot
} from './scientific-plotting-engine'
import { createScientificPlottingService } from './service'
import type { VisualProductionHandoff } from './types'

const CONTROLLED_PLAN: VisualProductionHandoff = {
  planId: 'provenance-test-plan',
  route: 'code',
  routeLocked: true,
  rationale: 'Exercise the deterministic plotting and provenance path.',
  sourceArtifacts: [],
  reproducibleInputs: ['content-bound fixture'],
  lockedElements: ['data', 'labels', 'statistics'],
  modelOwnedElements: [],
  contextStatus: 'ready',
  contextStopReason: 'sufficient',
  contextEvidenceIds: [],
  unresolvedContext: [],
  releaseCeiling: 'publication_ready',
  fallbackPolicy: 'fail_closed'
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function workspaceAccessPolicy() {
  const withMaterialization = {
    visibility: 'workspace' as const,
    principals: [],
    allowExport: true,
    allowMaterialize: true
  }
  return artifactVersionAccessPolicyV1Schema.safeParse(withMaterialization).success
    ? withMaterialization
    : {
        visibility: 'workspace' as const,
        principals: [],
        allowExport: true
      }
}

async function tempWorkspace(): Promise<string> {
  const root = join(tmpdir(), `scientific-plot-provenance-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(root, { recursive: true })
  return root
}

function createRecordingArtifactPorts(calls: ArtifactVersionCommitInputV1[]): {
  commitPort: ArtifactVersionCommitPortV1
  readPort: ArtifactVersionReadPortV1
  seed(ref: ArtifactVersionRefV1, bytes: Buffer, kind: string): void
  tamper(ref: ArtifactVersionRefV1, bytes: Buffer): void
} {
  const versions = new Map<string, ArtifactVersionReadV1>()
  const commitPort: ArtifactVersionCommitPortV1 = {
    async commit(input) {
      calls.push(input)
      const transactionId = `artifact-commit:plot-test-${calls.length}`
      const committedAt = new Date().toISOString()
      const refs = new Map<string, ArtifactVersionRefV1>()
      for (const candidate of input.candidates) {
        if (candidate.content.mode !== 'snapshot') throw new Error('Plot commits must use generated snapshots.')
        const bytes = Buffer.from(candidate.content.dataBase64, 'base64')
        const contentDigest = createHash('sha256').update(bytes).digest('hex')
        const artifactId = candidate.artifactId ?? `artifact:${candidate.candidateId}`
        refs.set(candidate.candidateId, {
          artifactId,
          versionId: `artifact-version:${candidate.candidateId}:${calls.length}`,
          contentDigest,
          byteLength: bytes.byteLength,
          ...(candidate.content.mediaType ? { mediaType: candidate.content.mediaType } : {}),
          availability: 'available',
          retention: 'snapshot',
          accessPolicy: candidate.accessPolicy ?? workspaceAccessPolicy()
        })
      }
      const committedVersions = input.candidates.map((candidate) => {
        const ref = refs.get(candidate.candidateId)!
        const dependencies = (candidate.dependencies ?? []).map((dependency) => ({
          role: dependency.role,
          required: dependency.required ?? true,
          target: dependency.target.kind === 'version'
            ? dependency.target.ref
            : refs.get(dependency.target.candidateId)!
        }))
        return {
          candidateId: candidate.candidateId,
          artifact: {
            artifactId: ref.artifactId,
            kind: candidate.kind,
            ...(candidate.label ? { label: candidate.label } : {}),
            createdAt: committedAt,
            updatedAt: committedAt,
            currentVersionId: ref.versionId,
            versionCount: candidate.artifactId ? 2 : 1
          },
          version: {
            schemaVersion: 1 as const,
            versionId: ref.versionId,
            artifactId: ref.artifactId,
            sequence: 1,
            transactionId,
            createdAt: committedAt,
            intent: candidate.intent,
            storage: {
              mode: 'snapshot' as const,
              contentDigest: ref.contentDigest,
              byteLength: ref.byteLength,
              ...(ref.mediaType ? { mediaType: ref.mediaType } : {})
            },
            dependencies,
            accessPolicy: ref.accessPolicy,
            metadata: candidate.metadata ?? {}
          },
          ref
        }
      })
      committedVersions.forEach((item) => {
        const candidate = input.candidates.find((value) => value.candidateId === item.candidateId)!
        if (candidate.content.mode !== 'snapshot') throw new Error('Expected snapshot content.')
        versions.set(item.ref.versionId, {
          artifact: item.artifact,
          version: item.version,
          ref: item.ref,
          dataBase64: candidate.content.dataBase64
        })
      })
      return {
        ok: true as const,
        value: {
          transactionId,
          committedAt,
          idempotentReplay: false,
          versions: committedVersions,
          events: []
        }
      }
    }
  }
  return {
    commitPort,
    readPort: {
      read: async ({ versionId }) => {
        const value = versions.get(versionId)
        return value
          ? { ok: true, value }
          : { ok: false, issue: { code: 'not-found', message: `Missing ${versionId}` } }
      }
    },
    seed: (ref, bytes, kind) => {
      const now = new Date().toISOString()
      const artifact = {
        artifactId: ref.artifactId,
        kind,
        createdAt: now,
        updatedAt: now,
        currentVersionId: ref.versionId,
        versionCount: 1
      }
      versions.set(ref.versionId, {
        artifact,
        version: {
          schemaVersion: 1,
          versionId: ref.versionId,
          artifactId: ref.artifactId,
          sequence: 1,
          transactionId: 'artifact-commit:seed',
          createdAt: now,
          intent: 'save',
          storage: {
            mode: 'snapshot',
            contentDigest: ref.contentDigest,
            byteLength: ref.byteLength,
            ...(ref.mediaType ? { mediaType: ref.mediaType } : {})
          },
          dependencies: [],
          accessPolicy: ref.accessPolicy,
          metadata: {}
        },
        ref,
        dataBase64: bytes.toString('base64')
      })
    },
    tamper: (ref, bytes) => {
      const existing = versions.get(ref.versionId)
      if (!existing) throw new Error(`Missing fixture version ${ref.versionId}`)
      // Deliberately leave ref/storage.contentDigest untouched: this models
      // corruption in the immutable store and exercises the read-time guard.
      versions.set(ref.versionId, {
        ...existing,
        dataBase64: bytes.toString('base64')
      })
    }
  }
}

describe('scientific plotting provenance and versions', () => {
  it('fails closed on duplicate aggregation and keeps SD, SEM, and CI distinct', async () => {
    const workspace = await tempWorkspace()
    try {
      const duplicate = await mapScientificPlottingData({
        operationId: 'test:provenance:map:duplicate:1',
        workspaceRoot: workspace,
        visualPlan: CONTROLLED_PLAN,
        task: 'Bar chart of score by group.',
        templateHint: 'bar',
        reproducibilityMode: 'reproducible',
        data: {
          rows: [
            { group: 'A', score: 1 },
            { group: 'A', score: 3 },
            { group: 'B', score: 2 },
            { group: 'B', score: 4 }
          ]
        }
      })
      expect(duplicate).toMatchObject({
        ok: false,
        status: 'needs_clarification',
        message: expect.stringContaining('explicit matching statistics.aggregation')
      })

      const declared = await mapScientificPlottingData({
        operationId: 'test:provenance:map:declared:01',
        workspaceRoot: workspace,
        visualPlan: CONTROLLED_PLAN,
        task: 'Bar chart of score by group.',
        templateHint: 'bar',
        reproducibilityMode: 'reproducible',
        statistics: {
          schemaVersion: 1,
          estimator: 'mean',
          aggregation: { method: 'mean', groupBy: ['group'] },
          missingValues: 'reject'
        },
        data: {
          rows: [
            { group: 'A', score: 1 },
            { group: 'A', score: 3 },
            { group: 'B', score: 2 },
            { group: 'B', score: 4 }
          ]
        }
      })
      expect(declared).toMatchObject({
        ok: true,
        renderRequest: {
          data: {
            categories: ['A', 'B'],
            series: [{ values: [2, 3] }]
          },
          statistics: {
            aggregation: { method: 'mean', groupBy: ['group'] }
          }
        }
      })

      const mismatch = await mapScientificPlottingData({
        operationId: 'test:provenance:map:mismatch:01',
        workspaceRoot: workspace,
        visualPlan: CONTROLLED_PLAN,
        task: 'Error-bar chart of score by group.',
        templateHint: 'errorbar-bar',
        reproducibilityMode: 'reproducible',
        statistics: {
          schemaVersion: 1,
          estimator: 'mean',
          uncertainty: { kind: 'sd', sourceColumn: 'sem', suppliedBy: 'source' },
          missingValues: 'reject'
        },
        data: {
          rows: [
            { group: 'A', score: 1, sem: 0.1 },
            { group: 'B', score: 2, sem: 0.2 }
          ]
        }
      })
      expect(mismatch).toMatchObject({
        ok: false,
        status: 'invalid_request',
        message: expect.stringContaining('conflicts with column sem')
      })

      const ambiguous = await mapScientificPlottingData({
        operationId: 'test:provenance:map:ambiguous:1',
        workspaceRoot: workspace,
        visualPlan: CONTROLLED_PLAN,
        task: 'Error-bar chart of score by group.',
        templateHint: 'errorbar-bar',
        reproducibilityMode: 'reproducible',
        data: {
          rows: [
            { group: 'A', score: 1, error: 0.1 },
            { group: 'B', score: 2, error: 0.2 }
          ]
        }
      })
      expect(ambiguous).toMatchObject({
        ok: false,
        status: 'needs_clarification',
        message: expect.stringContaining('SD, SEM, or CI')
      })

      const ciWithoutLevel = await mapScientificPlottingData({
        operationId: 'test:provenance:map:ci-level:01',
        workspaceRoot: workspace,
        visualPlan: CONTROLLED_PLAN,
        task: 'Confidence-interval chart of score by group.',
        templateHint: 'errorbar-bar',
        reproducibilityMode: 'reproducible',
        statistics: {
          schemaVersion: 1,
          estimator: 'mean',
          uncertainty: { kind: 'ci', sourceColumn: 'ci', suppliedBy: 'source' },
          missingValues: 'reject'
        },
        data: {
          rows: [
            { group: 'A', score: 1, ci: 0.1 },
            { group: 'B', score: 2, ci: 0.2 }
          ]
        }
      })
      expect(ciWithoutLevel).toMatchObject({
        ok: false,
        status: 'needs_clarification',
        message: expect.stringContaining('confidenceLevel')
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects significance labels without a content-bound statistical result', async () => {
    const workspace = await tempWorkspace()
    try {
      const data = {
        categories: ['A', 'B'],
        series: [{ values: [1, 2] }],
        comparisons: [{ from: 'A', to: 'B', label: '**' }]
      }
      const result = await renderScientificPlot({
        operationId: 'test:provenance:render:significance',
        workspaceRoot: workspace,
        visualPlan: CONTROLLED_PLAN,
        template: 'bar',
        data,
        reproducibilityMode: 'reproducible',
        dataSources: [{
          schemaVersion: 1,
          sourceId: 'inline-plot-data',
          kind: 'inline',
          locator: 'fixture:inline',
          sha256: hashJson(data),
          mediaType: 'application/json'
        }],
        statistics: {
          schemaVersion: 1,
          estimator: 'mean',
          missingValues: 'reject'
        }
      })
      expect(result).toMatchObject({
        ok: false,
        status: 'invalid_request',
        message: expect.stringContaining('requires a statistics.comparisons resultRef')
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('atomically snapshots the complete render lineage and reruns by the figure candidate', async () => {
    const status = await getScientificPlottingStatus()
    if (!status.ok || !status.renderer.available) {
      expect(status.ok && status.degraded).toBe(true)
      return
    }
    const workspace = await tempWorkspace()
    const commitCalls: ArtifactVersionCommitInputV1[] = []
    const artifactPorts = createRecordingArtifactPorts(commitCalls)
    const service = createScientificPlottingService({
      artifactVersionCommitPort: artifactPorts.commitPort,
      artifactVersionReadPort: artifactPorts.readPort
    })
    try {
      const data = {
        series: [{ name: 'Observed', x: [1, 2, 3], y: [0.2, 0.4, 0.8] }]
      }
      const dataBytes = Buffer.from(canonicalJson(data), 'utf8')
      const dataHash = createHash('sha256').update(dataBytes).digest('hex')
      const upstreamRef: ArtifactVersionRefV1 = {
        artifactId: 'artifact:fixture-data',
        versionId: 'artifact-version:fixture-data-v1',
        contentDigest: dataHash,
        byteLength: dataBytes.byteLength,
        mediaType: 'application/json',
        availability: 'available',
        retention: 'snapshot',
        accessPolicy: workspaceAccessPolicy()
      }
      artifactPorts.seed(upstreamRef, dataBytes, 'dataset')
      expect(dataSourceRefSchema.safeParse({
        schemaVersion: 1,
        sourceId: 'fixture-data-v1',
        kind: 'artifact-version',
        locator: 'artifact-version:fixture-data-v1',
        sha256: dataHash,
        mediaType: 'application/json',
        artifactVersion: upstreamRef
      }).success).toBe(true)

      const first = await service.render({
        operationId: 'test:provenance:render:versioned-v1',
        workspaceRoot: workspace,
        visualPlan: CONTROLLED_PLAN,
        template: 'line',
        figureId: 'versioned-line',
        data,
        reproducibilityMode: 'reproducible',
        dataSources: [{
          schemaVersion: 1,
          sourceId: 'fixture-data-v1',
          kind: 'artifact-version',
          locator: upstreamRef.versionId,
          sha256: dataHash,
          mediaType: 'application/json',
          artifactVersion: upstreamRef
        }]
      })
      expect(first).toMatchObject({
        ok: true,
        recipe: {
          dataHash,
          reproducibilityMode: 'reproducible',
          render: {
            matplotlib: {
              schemaVersion: 1,
              rcParams: expect.objectContaining({ 'savefig.dpi': expect.any(Number) }),
              palette: expect.any(Array)
            }
          },
          environment: { environmentDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
          execution: { rendererCodeSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }
        },
        versionCommit: {
          candidateIds: {
            derivedData: expect.any(String),
            recipe: expect.any(String),
            code: expect.any(String),
            figure: expect.any(String),
            renderManifest: expect.any(String),
            attemptLog: expect.any(String)
          }
        },
        evidenceLineage: {
          activity: {
            type: 'analysis_run',
            status: 'completed',
            parameters: {
              dataHash,
              rendererCodeSha256: expect.stringMatching(/^[a-f0-9]{64}$/)
            }
          },
          inputs: [{
            type: 'dataset_version',
            artifact: { artifactVersionRef: upstreamRef }
          }],
          environment: {
            type: 'environment',
            contentDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
          },
          logs: [{ artifact: { artifactVersionRef: expect.any(Object) } }],
          outputs: expect.arrayContaining([
            expect.objectContaining({ name: 'Scientific figure' })
          ])
        }
      })
      if (!first.ok || !first.versionCommit) return
      expect(first.outputPath).toContain(`/versioned-line/versions/${first.plotVersionId}/`)
      expect(first.codePath).toContain(`${first.plotVersionId}/versioned-line.render.py`)
      expect(await readFile(first.codePath!, 'utf8')).toContain('matplotlib')
      expect(commitCalls).toHaveLength(1)
      const committed = commitCalls[0]!
      expect(committed.candidates).toHaveLength(6)
      expect(committed.candidates.every((candidate) => candidate.content.mode === 'snapshot')).toBe(true)
      const derivedCandidate = committed.candidates.find((candidate) => candidate.candidateId === first.versionCommit!.candidateIds.derivedData)!
      expect(derivedCandidate.dependencies?.[0]).toEqual({
        role: 'input-1',
        required: true,
        target: { kind: 'version', ref: upstreamRef }
      })
      const figureCandidate = committed.candidates.find((candidate) => candidate.candidateId === first.versionCommit!.candidateIds.figure)!
      expect(figureCandidate.artifactId).toBeUndefined()
      expect(figureCandidate.content.mode).toBe('snapshot')
      expect(figureCandidate.dependencies?.some((dependency) => dependency.role === 'code')).toBe(true)
      const codeCandidate = committed.candidates.find((candidate) => candidate.candidateId === first.versionCommit!.candidateIds.code)!
      expect(codeCandidate.kind).toBe('scientific-plot-code')
      expect(codeCandidate.content.mode).toBe('snapshot')
      const committedCodeReceipt = first.versionCommit.result.ok
        ? first.versionCommit.result.value.versions.find((item) => item.candidateId === first.versionCommit!.candidateIds.code)
        : undefined
      expect(committedCodeReceipt).toBeDefined()
      if (codeCandidate.content.mode === 'snapshot') {
        const codeBytes = Buffer.from(codeCandidate.content.dataBase64, 'base64')
        expect(codeBytes.toString('utf8')).toContain('matplotlib')
        expect(committedCodeReceipt?.ref.contentDigest).toBe(createHash('sha256').update(codeBytes).digest('hex'))
        expect(committedCodeReceipt?.ref.mediaType).toBe('text/x-python')
        expect(codeCandidate.metadata).toMatchObject({
          codePath: first.codePath,
          codeSha256: committedCodeReceipt?.ref.contentDigest
        })
      }
      const manifestCandidate = committed.candidates.find((candidate) => candidate.candidateId === first.versionCommit!.candidateIds.renderManifest)!
      if (manifestCandidate.content.mode !== 'snapshot') throw new Error('Expected manifest snapshot.')
      const committedManifest = JSON.parse(Buffer.from(manifestCandidate.content.dataBase64, 'base64').toString('utf8')) as Record<string, unknown>
      expect(committedManifest.versionCommit).toBeUndefined()
      expect(committedManifest.evidenceLineage).toBeUndefined()
      const exportedManifest = JSON.parse(await readFile(first.manifestPath, 'utf8')) as Record<string, unknown>
      expect(exportedManifest.versionCommit).toBeDefined()
      expect(exportedManifest.evidenceLineage).toBeDefined()

      const firstFigureReceipt = first.versionCommit.result.ok
        ? first.versionCommit.result.value.versions.find((item) => item.candidateId === first.versionCommit!.candidateIds.figure)
        : undefined
      const firstRecipeReceipt = first.versionCommit.result.ok
        ? first.versionCommit.result.value.versions.find((item) => item.candidateId === first.versionCommit!.candidateIds.recipe)
        : undefined
      expect(firstFigureReceipt).toBeDefined()
      expect(firstRecipeReceipt).toBeDefined()
      const firstCodeReceipt = first.versionCommit.result.ok
        ? first.versionCommit.result.value.versions.find((item) => item.candidateId === first.versionCommit!.candidateIds.code)
        : undefined
      expect(firstCodeReceipt).toBeDefined()
      if (!firstFigureReceipt || !firstRecipeReceipt || !firstCodeReceipt || !first.codePath) return
      const immutableCode = await readFile(first.codePath)
      const tamperedCode = Buffer.from(`${immutableCode.toString('utf8')}\n# tampered immutable snapshot\n`, 'utf8')
      artifactPorts.tamper(firstCodeReceipt.ref, tamperedCode)
      const tamperedRerun = await service.rerun({
        operationId: 'test:provenance:rerun:tampered-code-v1',
        workspaceRoot: workspace,
        baselineFigureVersionRef: firstFigureReceipt.ref,
        recipeVersionRef: firstRecipeReceipt.ref,
        expectedCurrentVersionId: firstFigureReceipt.ref.versionId
      })
      expect(tamperedRerun).toMatchObject({
        ok: false,
        status: 'version_read_failed',
        provenanceBreakpoints: [expect.objectContaining({
          code: 'artifact-version-digest-mismatch',
          stage: 'input'
        })]
      })
      // Restore the fixture's immutable bytes so the following assertion
      // proves local codePath edits do not affect a healthy rerun.
      artifactPorts.tamper(firstCodeReceipt.ref, immutableCode)
      await writeFile(first.codePath, '# local edit must not affect an immutable rerun\n', 'utf8')
      await Promise.all([first.outputPath, first.manifestPath, first.recipePath].map(
        (path) => rm(path, { force: true })
      ))
      const rerun = await service.rerun({
        operationId: 'test:provenance:rerun:versioned-v1',
        workspaceRoot: workspace,
        baselineFigureVersionRef: firstFigureReceipt.ref,
        recipeVersionRef: firstRecipeReceipt.ref,
        expectedCurrentVersionId: firstFigureReceipt.ref.versionId
      })
      expect(rerun).toMatchObject({
        ok: true,
        status: 'rerun_complete',
        reproductionRelation: 'replicates',
        comparison: {
          recipeEquivalent: true,
          dataEquivalent: true,
          sourcesEquivalent: true,
          transformationsEquivalent: true,
          statisticsEquivalent: true,
          styleEquivalent: true
        }
      })
      if (!rerun.ok) return
      expect(rerun.render.codePath).toBeDefined()
      expect(await readFile(rerun.render.codePath!)).toEqual(immutableCode)
      expect(rerun.reproductionRelation).toBe(
        rerun.comparison.exactOutput ? 'replicates' : 'fails_to_replicate'
      )
      expect(rerun.evidenceLineage?.activity.id).not.toBe(first.evidenceLineage?.activity.id)
      expect(rerun.evidenceLineage?.relations).toContainEqual({
        src: rerun.evidenceLineage?.activity.id,
        dst: first.evidenceLineage?.activity.id,
        rel: rerun.reproductionRelation
      })
      expect(commitCalls).toHaveLength(2)
      const rerunFigure = commitCalls[1]!.candidates.find((candidate) => candidate.candidateId.includes('plot-figure:'))!
      expect(rerunFigure.artifactId).toBe(firstFigureReceipt?.ref.artifactId)
      expect(rerunFigure.expectedCurrentVersionId).toBe(firstFigureReceipt?.ref.versionId)

    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 120_000)

  it('recovers a lost commit response with exact prepared bytes and one ArtifactVersion transaction', async () => {
    const status = await getScientificPlottingStatus()
    if (!status.ok || !status.renderer.available) return
    const workspace = await tempWorkspace()
    const committedInputs: ArtifactVersionCommitInputV1[] = []
    const artifactPorts = createRecordingArtifactPorts(committedInputs)
    const transportInputs: ArtifactVersionCommitInputV1[] = []
    let durableResult: Awaited<ReturnType<ArtifactVersionCommitPortV1['commit']>> | undefined
    const lossyCommitPort: ArtifactVersionCommitPortV1 = {
      commit: async (input) => {
        transportInputs.push(structuredClone(input))
        if (!durableResult) {
          durableResult = await artifactPorts.commitPort.commit(input)
          throw new Error('simulated ArtifactVersion commit response loss')
        }
        return durableResult
      }
    }
    const service = createScientificPlottingService({
      artifactVersionCommitPort: lossyCommitPort,
      artifactVersionReadPort: artifactPorts.readPort
    })
    const operationId = 'test:recovery:lost-response:0001'
    const request = {
      workspaceRoot: workspace,
      operationId,
      visualPlan: CONTROLLED_PLAN,
      template: 'line' as const,
      figureId: 'lost-response-line',
      data: { series: [{ name: 'A', x: [1, 2], y: [3, 4] }] },
      runtimeId: 'runtime-recovery',
      threadId: 'thread-recovery'
    }
    try {
      const lost = await service.render(request)
      expect(lost).toMatchObject({ ok: false })
      if (lost.ok) throw new Error('Expected the first transport response to be lost.')
      expect(lost.message).toContain('response loss')

      const conflicting = await service.render({
        ...request,
        labels: { title: 'A different logical request' }
      })
      expect(conflicting).toMatchObject({
        ok: false,
        message: expect.stringContaining('already used for a different plotting request')
      })

      const recovered = await service.render(request)
      expect(recovered).toMatchObject({
        ok: true,
        operationId,
        evidenceDelivery: { state: 'pending' }
      })
      if (!recovered.ok) return
      expect(committedInputs).toHaveLength(1)
      expect(transportInputs).toHaveLength(2)
      expect(canonicalJson(transportInputs[1])).toBe(canonicalJson(transportInputs[0]))
      expect(transportInputs[0]?.idempotencyKey).toBe(`scientific-plot:${operationId}`)

      const fileName = `${createHash('sha256').update(operationId).digest('hex')}.json`
      const outboxPath = join(
        workspace,
        '.sciforge',
        'evidence-dag',
        'inbox',
        'scientific-plotting',
        fileName
      )
      const outboxBytes = await readFile(outboxPath)
      const outbox = JSON.parse(outboxBytes.toString('utf8')) as Record<string, unknown>
      expect(outbox).toMatchObject({
        schemaVersion: 1,
        producer: 'scientific-plotting',
        operationId,
        state: 'pending',
        runtimeId: 'runtime-recovery',
        threadId: 'thread-recovery',
        commitRefs: {
          figure: expect.objectContaining({ versionId: expect.stringContaining('artifact-version:') })
        },
        evidenceLineage: {
          activity: expect.objectContaining({ type: 'analysis_run' })
        }
      })
      const deliveryPath = join(
        workspace,
        '.sciforge',
        'evidence-dag',
        'delivery-receipts',
        'scientific-plotting',
        fileName
      )
      await mkdir(join(deliveryPath, '..'), { recursive: true })
      await writeFile(deliveryPath, `${JSON.stringify({
        schemaVersion: 1,
        consumer: 'evidence-dag',
        producer: 'scientific-plotting',
        operationId,
        state: 'enqueued',
        createdAt: new Date().toISOString(),
        runtimeId: 'runtime-recovery',
        threadId: 'thread-recovery',
        jobId: 'evidence-job-recovery',
        sourceDigest: createHash('sha256').update(outboxBytes).digest('hex')
      }, null, 2)}\n`, 'utf8')

      const replay = await service.render(request)
      expect(replay).toMatchObject({
        ok: true,
        plotVersionId: recovered.plotVersionId,
        versionCommit: recovered.versionCommit,
        evidenceDelivery: { state: 'enqueued' }
      })
      if (replay.ok && replay.evidenceDelivery.receiptPath) {
        expect(await realpath(replay.evidenceDelivery.receiptPath)).toBe(await realpath(deliveryPath))
      }
      expect(transportInputs).toHaveLength(2)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 120_000)

  it('fails closed when prepared bytes are changed before commit recovery', async () => {
    const status = await getScientificPlottingStatus()
    if (!status.ok || !status.renderer.available) return
    const workspace = await tempWorkspace()
    const committedInputs: ArtifactVersionCommitInputV1[] = []
    const artifactPorts = createRecordingArtifactPorts(committedInputs)
    let durableResult: Awaited<ReturnType<ArtifactVersionCommitPortV1['commit']>> | undefined
    const lossyCommitPort: ArtifactVersionCommitPortV1 = {
      commit: async (input) => {
        if (!durableResult) {
          durableResult = await artifactPorts.commitPort.commit(input)
          throw new Error('simulated response loss before local completion')
        }
        return durableResult
      }
    }
    const service = createScientificPlottingService({
      artifactVersionCommitPort: lossyCommitPort,
      artifactVersionReadPort: artifactPorts.readPort
    })
    const operationId = 'test:recovery:tampered-bytes:0001'
    const request = {
      workspaceRoot: workspace,
      operationId,
      visualPlan: CONTROLLED_PLAN,
      template: 'line' as const,
      figureId: 'tampered-line',
      data: { series: [{ name: 'A', x: [1, 2], y: [1, 2] }] }
    }
    try {
      expect((await service.render(request)).ok).toBe(false)
      const receiptName = `${createHash('sha256').update(operationId).digest('hex')}.json`
      const operationReceipt = JSON.parse(await readFile(join(
        workspace,
        '.sciforge',
        'scientific-plotting',
        'operations',
        receiptName
      ), 'utf8')) as { preCommitManifestPath: string }
      const preparedManifest = JSON.parse(
        await readFile(operationReceipt.preCommitManifestPath, 'utf8')
      ) as { outputPath: string }
      await writeFile(preparedManifest.outputPath, Buffer.from('tampered figure bytes'))
      const recovered = await service.render(request)
      expect(recovered).toMatchObject({
        ok: false,
        message: expect.stringContaining('figure bytes were changed')
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 120_000)

  it('rejects unversioned formal reproducible inputs and emits typed rerun breakpoints', async () => {
    const workspace = await tempWorkspace()
    const commitCalls: ArtifactVersionCommitInputV1[] = []
    const artifactPorts = createRecordingArtifactPorts(commitCalls)
    const data = { series: [{ name: 'A', x: [1], y: [2] }] }
    try {
      const formal = await renderScientificPlot({
        workspaceRoot: workspace,
        operationId: 'test:formal:unversioned-input:01',
        visualPlan: CONTROLLED_PLAN,
        template: 'line',
        data,
        reproducibilityMode: 'reproducible',
        dataSources: [{
          schemaVersion: 1,
          sourceId: 'inline-unversioned',
          kind: 'inline',
          locator: 'inline:test',
          sha256: hashJson(data),
          mediaType: 'application/json'
        }]
      }, { artifactVersionCommitPort: artifactPorts.commitPort })
      expect(formal).toMatchObject({
        ok: false,
        message: expect.stringContaining('require pinned ArtifactVersionRefV1 inputs')
      })
      expect(commitCalls).toHaveLength(0)

      const unavailable = await createScientificPlottingService().rerun({
        workspaceRoot: workspace,
        operationId: 'test:rerun:missing-capability:01',
        baselineFigureVersionRef: {
          artifactId: 'artifact:missing-figure',
          versionId: 'artifact-version:missing-figure',
          contentDigest: 'a'.repeat(64),
          byteLength: 1,
          mediaType: 'image/png',
          availability: 'available',
          retention: 'snapshot',
          accessPolicy: workspaceAccessPolicy()
        },
        recipeVersionRef: {
          artifactId: 'artifact:missing-recipe',
          versionId: 'artifact-version:missing-recipe',
          contentDigest: 'b'.repeat(64),
          byteLength: 1,
          mediaType: 'application/json',
          availability: 'available',
          retention: 'snapshot',
          accessPolicy: workspaceAccessPolicy()
        },
        expectedCurrentVersionId: 'artifact-version:missing-figure'
      })
      expect(unavailable).toMatchObject({
        ok: false,
        status: 'version_read_failed',
        provenanceBreakpoints: [{
          schemaVersion: 1,
          code: 'artifact-version-capability-unavailable',
          stage: 'baseline',
          retryable: true
        }]
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('does not follow a .sciforge symlink when writing operation or Evidence receipts', async () => {
    const status = await getScientificPlottingStatus()
    if (!status.ok || !status.renderer.available) return
    const workspace = await tempWorkspace()
    const external = await tempWorkspace()
    const commitCalls: ArtifactVersionCommitInputV1[] = []
    const artifactPorts = createRecordingArtifactPorts(commitCalls)
    try {
      await symlink(external, join(workspace, '.sciforge'))
      const result = await renderScientificPlot({
        workspaceRoot: workspace,
        operationId: 'test:security:symlink-receipt:01',
        visualPlan: CONTROLLED_PLAN,
        template: 'line',
        figureId: 'symlink-safe',
        outputDir: 'safe-figures',
        data: { series: [{ name: 'A', x: [1], y: [2] }] }
      }, { artifactVersionCommitPort: artifactPorts.commitPort })
      expect(result).toMatchObject({
        ok: false,
        message: expect.stringContaining('receipt directory escapes the workspace')
      })
      expect(await readdir(external)).toEqual([])
      expect(commitCalls).toHaveLength(0)
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
    }
  }, 120_000)
})
