import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import {
  DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND,
  type DomainCapabilityEvalContribution,
  type DomainCapabilityEvalFixture,
  type DomainCapabilityEvalObservedInvocation,
  type DomainCapabilityEvalOracleResult,
  type DomainCapabilityEvalRunContext
} from '@sciforge/domain-sdk/capability-eval'
import {
  scientificPlottingCompareResultSchema,
  scientificPlottingMapDataResultSchema,
  scientificPlottingRenderResultSchema,
  scientificPlottingRerunResultSchema,
  SCIENTIFIC_PLOTTING_CAPABILITY_IDS,
  scientificPlottingStatusResultSchema,
  type ScientificPlottingCompareResult,
  type ScientificPlottingDataMappingResult,
  type ScientificPlottingRenderResult,
  type ScientificPlottingRerunResult
} from './contract.js'
import { SCIENTIFIC_PLOTTING_DOMAIN_MODULE_ID } from './definition.js'

export const SCIENTIFIC_PLOTTING_CAPABILITY_EVAL_KIND = MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND
export const SCIENTIFIC_PLOTTING_STATUS_EVAL_CASE_ID = 'scientific-plotting-status-local-fixture'
export const SCIENTIFIC_PLOTTING_WORKFLOW_EVAL_CASE_ID = 'scientific-plotting-workflow-local-fixture'
export const SCIENTIFIC_PLOTTING_CORE_RENDER_EVAL_CASE_ID = 'core-plot-render'
export const SCIENTIFIC_PLOTTING_WORKFLOW_INPUT_PATH = 'fixtures/scientific-plotting-input.json'

const SCIENTIFIC_PLOTTING_ROUTING_PROFILES: Readonly<Record<string, string>> = Object.freeze({
  'natural-routing.plot.status': SCIENTIFIC_PLOTTING_STATUS_EVAL_CASE_ID,
  'natural-routing.plot.workflow': SCIENTIFIC_PLOTTING_WORKFLOW_EVAL_CASE_ID,
  'core.plot.status': SCIENTIFIC_PLOTTING_STATUS_EVAL_CASE_ID,
  'core.plot.render': SCIENTIFIC_PLOTTING_CORE_RENDER_EVAL_CASE_ID,
  'core.plot.workflow': SCIENTIFIC_PLOTTING_WORKFLOW_EVAL_CASE_ID
})

const SCIENTIFIC_PLOTTING_WORKFLOW_INPUT = {
  task: 'Render a reproducible line chart from deterministic observations.',
  data: {
    x: [0, 1, 2, 3],
    y: [0.2, 0.5, 0.4, 0.8]
  },
  template: 'line',
  figureId: 'capability-eval-line-fixture'
} as const

export const SCIENTIFIC_PLOTTING_CAPABILITY_EVAL_CONTRIBUTION: DomainCapabilityEvalContribution = Object.freeze({
  moduleId: SCIENTIFIC_PLOTTING_DOMAIN_MODULE_ID,
  contractVersion: DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  actionIds: Object.values(SCIENTIFIC_PLOTTING_CAPABILITY_IDS),
  evaluationActionIds: Object.values(SCIENTIFIC_PLOTTING_CAPABILITY_IDS),
  prepare: prepareScientificPlottingEvaluationFixture,
  inspect: inspectScientificPlottingEvaluation
})

async function prepareScientificPlottingEvaluationFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture | undefined> {
  const caseId = scientificPlottingEvaluationCaseId(context)
  if (caseId === SCIENTIFIC_PLOTTING_STATUS_EVAL_CASE_ID) {
    return {
      fixtureId: 'scientific-plotting.status.v1',
      paths: [],
      metadata: { expectedAction: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.status }
    }
  }
  if (caseId !== SCIENTIFIC_PLOTTING_WORKFLOW_EVAL_CASE_ID && caseId !== SCIENTIFIC_PLOTTING_CORE_RENDER_EVAL_CASE_ID) return undefined
  const inputPath = resolve(context.workspaceDirectory, SCIENTIFIC_PLOTTING_WORKFLOW_INPUT_PATH)
  await mkdir(dirname(inputPath), { recursive: true })
  await writeFile(inputPath, `${JSON.stringify(SCIENTIFIC_PLOTTING_WORKFLOW_INPUT, null, 2)}\n`, 'utf8')
  return {
    fixtureId: `scientific-plotting.${caseId}.v1`,
    paths: [SCIENTIFIC_PLOTTING_WORKFLOW_INPUT_PATH],
    metadata: {
      inputPath: SCIENTIFIC_PLOTTING_WORKFLOW_INPUT_PATH,
      expectedTemplate: SCIENTIFIC_PLOTTING_WORKFLOW_INPUT.template,
      expectedPointCount: SCIENTIFIC_PLOTTING_WORKFLOW_INPUT.data.x.length
    }
  }
}

async function inspectScientificPlottingEvaluation(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  fixture?: DomainCapabilityEvalFixture
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult | undefined> {
  const caseId = scientificPlottingEvaluationCaseId(input.context)
  const normalizedInput = { ...input, context: { ...input.context, caseId } }
  if (caseId === SCIENTIFIC_PLOTTING_STATUS_EVAL_CASE_ID) {
    return inspectStatus(normalizedInput.invocations)
  }
  if (caseId === SCIENTIFIC_PLOTTING_CORE_RENDER_EVAL_CASE_ID) {
    return inspectRender(normalizedInput)
  }
  if (caseId !== SCIENTIFIC_PLOTTING_WORKFLOW_EVAL_CASE_ID) return undefined
  return inspectWorkflow(normalizedInput)
}

async function inspectRender(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  fixture?: DomainCapabilityEvalFixture
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  const invocation = [...input.invocations].reverse().find(({ actionId }) =>
    actionId === SCIENTIFIC_PLOTTING_CAPABILITY_IDS.render
  )
  const rendered = parseSuccessful<ScientificPlottingRenderResult>(
    invocation,
    scientificPlottingRenderResultSchema
  )
  if (!rendered || !rendered.ok || !(await verifyRenderFiles(input.context.workspaceDirectory, rendered))) {
    return workflowFailure('Scientific Plotting render output failed its package schema or workspace artifact readback.')
  }
  return {
    taskSuccess: true,
    finalState: {
      rendered: true,
      outputPath: rendered.outputPath,
      manifestPath: rendered.manifestPath,
      recipePath: rendered.recipePath
    },
    evidence: ['Independently read the rendered PNG, manifest, and recipe within the isolated workspace.'],
    verifiedActions: [SCIENTIFIC_PLOTTING_CAPABILITY_IDS.render]
  }
}

function scientificPlottingEvaluationCaseId(context: DomainCapabilityEvalRunContext): string {
  return context.fixtureProfile && SCIENTIFIC_PLOTTING_ROUTING_PROFILES[context.fixtureProfile]
    ? SCIENTIFIC_PLOTTING_ROUTING_PROFILES[context.fixtureProfile]
    : context.caseId
}

function inspectStatus(
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
): DomainCapabilityEvalOracleResult {
  const invocation = invocations.find(({ actionId }) => actionId === SCIENTIFIC_PLOTTING_CAPABILITY_IDS.status)
  if (!invocation?.success) {
    return { taskSuccess: false, evidence: ['Scientific Plotting status did not complete successfully.'], verifiedActions: [] }
  }
  const parsed = scientificPlottingStatusResultSchema.safeParse(unwrapOutput(invocation.output))
  if (!parsed.success || !parsed.data.ok) {
    return { taskSuccess: false, evidence: ['Scientific Plotting status did not satisfy its package contract.'], verifiedActions: [] }
  }
  const rendererReady = parsed.data.renderer.kind === 'matplotlib'
  const workspaceOnly = parsed.data.outputPolicy.writesOnlyInsideWorkspace
  if (!rendererReady || !workspaceOnly || parsed.data.serverName !== 'scientific_plotting') {
    return { taskSuccess: false, evidence: ['Scientific Plotting status did not report the governed renderer and workspace policy.'], verifiedActions: [] }
  }
  return {
    taskSuccess: true,
    finalState: {
      serverName: parsed.data.serverName,
      renderer: parsed.data.renderer.kind,
      rendererAvailable: parsed.data.renderer.available,
      supportedTemplates: parsed.data.supportedTemplates,
      writesOnlyInsideWorkspace: parsed.data.outputPolicy.writesOnlyInsideWorkspace
    },
    evidence: ['Independently validated Scientific Plotting status, renderer kind, supported templates, and workspace-only output policy.'],
    verifiedActions: [SCIENTIFIC_PLOTTING_CAPABILITY_IDS.status]
  }
}

async function inspectWorkflow(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  fixture?: DomainCapabilityEvalFixture
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult> {
  try {
    const inputPath = fixtureInputPath(input.fixture)
    const fixtureContent = await readJsonWithinWorkspace(input.context.workspaceDirectory, inputPath)
    if (!isRecord(fixtureContent) || fixtureContent.figureId !== SCIENTIFIC_PLOTTING_WORKFLOW_INPUT.figureId) {
      return workflowFailure('Scientific Plotting evaluation fixture was not independently readable.')
    }

    const byAction = new Map(input.invocations.map((invocation) => [invocation.actionId, invocation]))
    const mapped = parseSuccessful<ScientificPlottingDataMappingResult>(
      byAction.get(SCIENTIFIC_PLOTTING_CAPABILITY_IDS.mapData),
      scientificPlottingMapDataResultSchema
    )
    if (!mapped || !mapped.ok || mapped.selectedTemplate !== SCIENTIFIC_PLOTTING_WORKFLOW_INPUT.template ||
        mapped.dataSummary.pointCount !== SCIENTIFIC_PLOTTING_WORKFLOW_INPUT.data.x.length) {
      return workflowFailure('Scientific Plotting map-data output failed its package schema or deterministic point-count contract.')
    }

    const rendered = parseSuccessful<ScientificPlottingRenderResult>(
      byAction.get(SCIENTIFIC_PLOTTING_CAPABILITY_IDS.render),
      scientificPlottingRenderResultSchema
    )
    if (!rendered || !rendered.ok || !(await verifyRenderFiles(input.context.workspaceDirectory, rendered))) {
      return workflowFailure('Scientific Plotting render output failed its package schema or workspace artifact readback.')
    }

    const rerunOutput = parseSuccessful<ScientificPlottingRerunResult>(
      byAction.get(SCIENTIFIC_PLOTTING_CAPABILITY_IDS.rerun),
      scientificPlottingRerunResultSchema
    )
    if (!rerunOutput || !rerunOutput.ok || rerunOutput.reproductionRelation !== 'replicates' ||
        !(await verifyRenderFiles(input.context.workspaceDirectory, rerunOutput.render))) {
      return workflowFailure('Scientific Plotting rerun did not prove exact reproduction and artifact readback.')
    }

    const compared = parseSuccessful<ScientificPlottingCompareResult>(
      byAction.get(SCIENTIFIC_PLOTTING_CAPABILITY_IDS.compare),
      scientificPlottingCompareResultSchema
    )
    if (!compared || !compared.ok || !compared.comparison.dataEquivalent ||
        !compared.comparison.statisticsEquivalent || !compared.comparison.sourcesEquivalent) {
      return workflowFailure('Scientific Plotting compare did not prove data, statistics and source equivalence.')
    }

    return {
      taskSuccess: true,
      finalState: {
        mappedTemplate: mapped.selectedTemplate,
        pointCount: mapped.dataSummary.pointCount,
        renderArtifactsRead: true,
        rerunRelation: rerunOutput.reproductionRelation,
        compareDataEquivalent: compared.comparison.dataEquivalent,
        compareStatisticsEquivalent: compared.comparison.statisticsEquivalent,
        compareSourcesEquivalent: compared.comparison.sourcesEquivalent
      },
      evidence: [
        'Independently validated map-data template selection and point count.',
        'Independently read the rendered and rerun PNG, recipe and manifest files within the isolated workspace.',
        'Independently validated exact rerun relation and compare equivalence for data, statistics and sources.'
      ],
      verifiedActions: [
        SCIENTIFIC_PLOTTING_CAPABILITY_IDS.mapData,
        SCIENTIFIC_PLOTTING_CAPABILITY_IDS.render,
        SCIENTIFIC_PLOTTING_CAPABILITY_IDS.rerun,
        SCIENTIFIC_PLOTTING_CAPABILITY_IDS.compare
      ]
    }
  } catch (error) {
    return workflowFailure(`Scientific Plotting independent readback failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function fixtureInputPath(fixture?: DomainCapabilityEvalFixture): string {
  const metadata = fixture?.metadata
  if (isRecord(metadata) && typeof metadata.inputPath === 'string') return metadata.inputPath
  return SCIENTIFIC_PLOTTING_WORKFLOW_INPUT_PATH
}

function parseSuccessful<T>(
  invocation: DomainCapabilityEvalObservedInvocation | undefined,
  schema: { safeParse(value: unknown): { success: boolean; data?: T } }
): T | undefined {
  if (!invocation?.success) return undefined
  const parsed = schema.safeParse(unwrapOutput(invocation.output))
  return parsed.success ? parsed.data : undefined
}

async function verifyRenderFiles(
  workspaceDirectory: string,
  output: unknown
): Promise<boolean> {
  if (!isRecord(output)) return false
  const outputPath = output.outputPath
  const manifestPath = output.manifestPath
  const recipePath = output.recipePath
  if (typeof outputPath !== 'string' || typeof manifestPath !== 'string' || typeof recipePath !== 'string') return false
  const [outputBytes, manifest, recipe] = await Promise.all([
    readBytesWithinWorkspace(workspaceDirectory, outputPath),
    readJsonWithinWorkspace(workspaceDirectory, manifestPath),
    readJsonWithinWorkspace(workspaceDirectory, recipePath)
  ])
  return outputBytes.length > 8 &&
    outputBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    isRecord(manifest) && isRecord(recipe)
}

async function readJsonWithinWorkspace(workspaceDirectory: string, filePath: string): Promise<unknown> {
  const content = await readFile(resolveWorkspacePath(workspaceDirectory, filePath), 'utf8')
  return JSON.parse(content)
}

async function readBytesWithinWorkspace(workspaceDirectory: string, filePath: string): Promise<Buffer> {
  return readFile(resolveWorkspacePath(workspaceDirectory, filePath))
}

function resolveWorkspacePath(workspaceDirectory: string, filePath: string): string {
  const candidate = resolve(workspaceDirectory, filePath)
  const relativePath = relative(resolve(workspaceDirectory), candidate)
  if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith('../')) {
    throw new Error(`Scientific Plotting evaluation output escaped workspace: ${filePath}`)
  }
  return candidate
}

function workflowFailure(message: string): DomainCapabilityEvalOracleResult {
  return { taskSuccess: false, evidence: [message], verifiedActions: [] }
}

function unwrapOutput(output: unknown): unknown {
  if (!isRecord(output)) return output
  for (const key of ['scientificPlotting', 'scientific-plotting', 'result']) {
    const nested = output[key]
    if (isRecord(nested)) return nested
  }
  return output
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
