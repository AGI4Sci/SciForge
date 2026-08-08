import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  ArtifactVersionCommitInputV1,
  ArtifactVersionCommitPortV1,
  ArtifactVersionCommitResultV1,
  ArtifactVersionReadInputV1,
  ArtifactVersionReadPortV1,
  ArtifactVersionReadResultV1,
  ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import { ARTIFACT_VERSIONS_CAPABILITY_IDS } from '@sciforge/domain-artifact-versions/contract'
import {
  createDomainMainEntry as createArtifactVersionsDomainMainEntry,
  type ArtifactVersionsCapabilityFactory,
  type ArtifactVersionsCapabilityOptions
} from '@sciforge/domain-artifact-versions/main'
import {
  scientificPlottingCompareResultSchema,
  scientificPlottingMapDataResultSchema,
  scientificPlottingRenderResultSchema,
  scientificPlottingRerunResultSchema,
  scientificPlottingStatusResultSchema,
  scientificPlottingVisualSceneSchema
} from './contract'
import { createScientificPlottingService } from './service'
import type { ScientificPlottingRenderResult, VisualProductionHandoff } from './types'

const PLAN: VisualProductionHandoff = {
  planId: 'plot-contract-test',
  route: 'code',
  routeLocked: true,
  rationale: 'Exercise the exact public plotting capability contracts.',
  sourceArtifacts: [],
  reproducibleInputs: ['inline line-series fixture'],
  lockedElements: ['data', 'labels'],
  modelOwnedElements: [],
  contextStatus: 'ready',
  contextStopReason: 'sufficient',
  contextEvidenceIds: [],
  unresolvedContext: [],
  releaseCeiling: 'publication_ready',
  fallbackPolicy: 'fail_closed'
}
const ACCESS = { audience: 'system' as const, callerId: 'scientific-plotting-contract-test' }

type ArtifactCapabilityHarness = Readonly<{
  commit(workspaceRoot: string, input: ArtifactVersionCommitInputV1): Promise<ArtifactVersionCommitResultV1>
  read(workspaceRoot: string, input: ArtifactVersionReadInputV1): Promise<ArtifactVersionReadResultV1>
  dispose(): Promise<void>
}>

async function createArtifactCapabilityHarness(userDataDir: string): Promise<ArtifactCapabilityHarness> {
  const entry = createArtifactVersionsDomainMainEntry<ArtifactVersionsCapabilityOptions>({
    defineCapability: (definition: ArtifactVersionsCapabilityOptions) => definition
  } as never)
  const factory = entry.contributions.find(
    ({ kind }) => kind === 'main.capability-factory'
  )?.value as ArtifactVersionsCapabilityFactory<ArtifactVersionsCapabilityOptions> | undefined
  const lifecycle = entry.contributions.find(
    ({ kind }) => kind === 'main.runtime-lifecycle'
  )?.value as { activate(context: unknown): Promise<() => void | Promise<void>> } | undefined
  if (!factory || !lifecycle) throw new Error('Artifact Versions broker fixture is incomplete.')
  const dispose = await lifecycle.activate({ userDataDir })
  const definitions = new Map(factory.createDefinitions().map((definition) => [definition.id, definition]))
  const invoke = async <T>(workspaceRoot: string, capabilityId: string, input: unknown): Promise<T> => {
    const definition = definitions.get(capabilityId)
    if (!definition) throw new Error(`Missing Artifact Versions capability ${capabilityId}.`)
    const result = await definition.handler(input, {
      caller: { ...ACCESS, workspaceId: workspaceRoot }
    })
    return result.output as T
  }
  return {
    commit: (workspaceRoot, input) => invoke(workspaceRoot, ARTIFACT_VERSIONS_CAPABILITY_IDS.commit, input),
    read: (workspaceRoot, input) => invoke(workspaceRoot, ARTIFACT_VERSIONS_CAPABILITY_IDS.read, input),
    dispose: async () => { await dispose() }
  }
}

describe('scientific plotting public capability schemas', () => {
  it('accepts real success/failure results and rejects malformed discriminated branches', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'scientific-plot-contract-'))
    const artifactVersions = await createArtifactCapabilityHarness(
      join(workspaceRoot, '.artifact-version-test-data')
    )
    try {
      const service = createScientificPlottingService({
        artifactVersionCommitPort: commitPort(artifactVersions, workspaceRoot),
        artifactVersionReadPort: readPort(artifactVersions, workspaceRoot)
      })

      const status = await service.status()
      expect(scientificPlottingStatusResultSchema.safeParse(status).success).toBe(true)
      expect(scientificPlottingStatusResultSchema.safeParse({
        ...status,
        ok: true,
        renderer: undefined
      }).success).toBe(false)

      const mapped = await service.mapData({
        workspaceRoot,
        operationId: 'test:contract:map:line:000001',
        visualPlan: PLAN,
        task: 'Plot the measured response over ordered time.',
        data: [
          { time: 0, response: 1, group: 'A' },
          { time: 1, response: 2, group: 'A' }
        ],
        templateHint: 'line'
      })
      expect(mapped.ok, JSON.stringify(mapped)).toBe(true)
      expect(scientificPlottingMapDataResultSchema.safeParse(mapped).success).toBe(true)
      expect(scientificPlottingMapDataResultSchema.safeParse({
        ok: true,
        status: 'mapped',
        selectedTemplate: 'line',
        confidence: 1
      }).success).toBe(false)
      if (!mapped.ok) return

      const rendered = await service.render({
        ...mapped.renderRequest,
        figureId: 'contract-line'
      })
      expect(scientificPlottingRenderResultSchema.safeParse(rendered).success).toBe(true)
      if (!rendered.ok) {
        expect(rendered.status).toBe('renderer_unavailable')
        return
      }
      expect(scientificPlottingRenderResultSchema.safeParse({
        ...rendered,
        attempts: 'malformed'
      }).success).toBe(false)

      const refs = committedPlotRefs(rendered)
      const compared = await service.compare({
        workspaceRoot,
        baselineManifestVersionRef: refs.manifest,
        candidateManifestVersionRef: refs.manifest
      })
      expect(compared.ok, JSON.stringify(compared)).toBe(true)
      expect(scientificPlottingCompareResultSchema.safeParse(compared).success).toBe(true)
      expect(scientificPlottingCompareResultSchema.safeParse({
        ...compared,
        comparison: { exactOutput: true }
      }).success).toBe(false)

      const rerun = await service.rerun({
        workspaceRoot,
        operationId: 'test:contract:rerun:line:0001',
        baselineFigureVersionRef: refs.figure,
        recipeVersionRef: refs.recipe,
        expectedCurrentVersionId: refs.figure.versionId
      })
      expect(rerun.ok).toBe(true)
      expect(scientificPlottingRerunResultSchema.safeParse(rerun).success).toBe(true)
      expect(scientificPlottingRerunResultSchema.safeParse({
        ...rerun,
        reproductionRelation: 'unverified'
      }).success).toBe(false)

      const failedCompare = await createScientificPlottingService().compare({
        workspaceRoot,
        baselineManifestVersionRef: refs.manifest,
        candidateManifestVersionRef: refs.manifest
      })
      expect(failedCompare).toMatchObject({ ok: false, status: 'version_read_failed' })
      expect(scientificPlottingCompareResultSchema.safeParse(failedCompare).success).toBe(true)
      expect(scientificPlottingRenderResultSchema.safeParse({
        ok: false,
        status: 'not-a-render-status',
        message: 'malformed'
      }).success).toBe(false)
    } finally {
      await artifactVersions.dispose()
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  }, 120_000)

  it('represents VisualScene structurally and enforces global identity/count constraints', () => {
    const scene = {
      version: 1 as const,
      coordinateSystem: 'normalized' as const,
      canvas: { width: 1, height: 1, background: '#fff' },
      layers: [{
        id: 'truth-layer',
        owner: 'code' as const,
        primitives: [{
          id: 'truth-label',
          type: 'text' as const,
          x: 0.5,
          y: 0.5,
          text: 'Measured response'
        }]
      }]
    }
    expect(scientificPlottingVisualSceneSchema.safeParse(scene).success).toBe(true)
    expect(scientificPlottingVisualSceneSchema.safeParse({
      ...scene,
      layers: [{
        ...scene.layers[0],
        id: 'truth-label'
      }]
    }).success).toBe(false)
    expect(scientificPlottingVisualSceneSchema.safeParse({
      ...scene,
      layers: [{ ...scene.layers[0], primitives: [] }]
    }).success).toBe(false)
  })
})

function committedPlotRefs(
  rendered: Extract<ScientificPlottingRenderResult, { ok: true }>
): Readonly<{
  figure: ArtifactVersionRefV1
  recipe: ArtifactVersionRefV1
  manifest: ArtifactVersionRefV1
}> {
  const commit = rendered.versionCommit
  expect(commit).toBeDefined()
  if (!commit?.result.ok) throw new Error(commit?.result.issue.message ?? 'Missing version commit.')
  const byCandidate = new Map(commit.result.value.versions.map((item) => [item.candidateId, item.ref]))
  const figure = byCandidate.get(commit.candidateIds.figure)
  const recipe = byCandidate.get(commit.candidateIds.recipe)
  const manifest = byCandidate.get(commit.candidateIds.renderManifest)
  if (!figure || !recipe || !manifest) throw new Error('Plot version receipt is incomplete.')
  return { figure, recipe, manifest }
}

function commitPort(
  service: ArtifactCapabilityHarness,
  workspaceRoot: string
): ArtifactVersionCommitPortV1 {
  return Object.freeze({
    commit: (input) => service.commit(workspaceRoot, input)
  })
}

function readPort(
  service: ArtifactCapabilityHarness,
  workspaceRoot: string
): ArtifactVersionReadPortV1 {
  return Object.freeze({
    read: (input) => service.read(workspaceRoot, input)
  })
}
