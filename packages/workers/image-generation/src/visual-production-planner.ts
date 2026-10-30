import {
  normalizeVisualScene,
  visualSceneOwners,
  type VisualScene
} from './visual-scene.js'

export const VISUAL_PRODUCTION_ROUTES = ['code', 'model', 'hybrid'] as const

export type VisualProductionRoute = typeof VISUAL_PRODUCTION_ROUTES[number]

export type VisualContextQuestion = {
  id: string
  question: string
  priority: 'required' | 'optional'
  status: 'open' | 'resolved'
}

export type VisualContextEvidence = {
  id: string
  source: string
  summary: string
  questionIds: string[]
}

export type VisualContextBudget = {
  maxRounds: number
  maxCostUnits: number
  maxTokens: number
  maxElapsedMs: number
}

export type VisualContextUsage = {
  rounds: number
  costUnits: number
  tokens: number
  elapsedMs: number
  consecutiveNoProgressRounds: number
}

export type VisualProductionRequirements = {
  lockedElements: string[]
  modelOwnedElements: string[]
  reproducibleInputs: string[]
  inlineSpecification?: string
  structuredData?: unknown
  scene?: VisualScene
}

export type VisualProductionHandoff = {
  planId: string
  route: VisualProductionRoute
  routeLocked: true
  rationale: string
  sourceArtifacts: string[]
  reproducibleInputs: string[]
  inlineSpecification?: string
  structuredData?: unknown
  scene?: VisualScene
  lockedElements: string[]
  modelOwnedElements: string[]
  contextStatus: 'ready' | 'budget_exhausted'
  contextStopReason: VisualContextStopReason
  contextEvidenceIds: string[]
  unresolvedContext: string[]
  releaseCeiling: 'publication_ready' | 'draft_ready'
  fallbackPolicy: 'fail_closed'
}

export type VisualGenerateRequest = {
  workspaceRoot?: string
  task: string
  action?: 'create' | 'revision'
  visualDocumentId?: string
  reviewPacketPath?: string
  sourceArtifacts?: string[]
  requirements: VisualProductionRequirements
  context?: {
    policy?: 'auto' | 'closed'
    questions?: VisualContextQuestion[]
    evidence?: VisualContextEvidence[]
    usage?: Partial<VisualContextUsage>
  }
  budget?: Partial<VisualContextBudget>
}

export type VisualProductionExecutionTool =
  | 'sciforge_discover'
  | 'sciforge_invoke'
  | 'scientific_plotting_composite'
  | 'image_generation_prepare'
  | 'image_generation_render'
  | 'image_generation_edit_from_visual_review_packet'
  | 'image_generation_review_candidate'

export type VisualProductionExecutionStage = {
  id: string
  tool: VisualProductionExecutionTool
  purpose: string
  consumes: string[]
  produces: string[]
  capabilityId?: 'scientific-plotting.map-data' | 'scientific-plotting.render'
  locked: boolean
}

export type VisualGenerateResult =
  | {
      ok: true
      status: 'needs_context'
      task: string
      action: 'create' | 'revision'
      context: VisualContextSummary
      nextAction: {
        tool: 'research_search'
        questions: VisualContextQuestion[]
      }
      routeLocked: false
    }
  | {
      ok: true
      status: 'ready' | 'budget_exhausted'
      task: string
      action: 'create' | 'revision'
      context: VisualContextSummary
      handoff: VisualProductionHandoff
      routeLocked: true
      execution: {
        route: VisualProductionRoute
        stages: VisualProductionExecutionStage[]
        nextCall: {
          tool: VisualProductionExecutionTool
          arguments: Record<string, unknown>
        }
      }
      failPolicy: {
        mode: 'fail_closed'
        crossRouteFallback: false
        sameRouteRetry: { allowed: true; maxAttemptsPerStage: 2; reuseOperationId: true }
        routeChangeRequiresNewPlan: true
        preserveCompletedStageArtifacts: true
        failureStatus: 'route_failed'
      }
    }
  | {
      ok: false
      status: 'invalid_request'
      message: string
    }

export type VisualContextStopReason =
  | 'sufficient'
  | 'policy_closed'
  | 'round_limit'
  | 'cost_limit'
  | 'token_limit'
  | 'elapsed_time_limit'
  | 'no_information_gain'

export type VisualContextSummary = {
  sufficient: boolean
  stopReason?: VisualContextStopReason
  reachedLimits: Array<'rounds' | 'cost' | 'tokens' | 'elapsed'>
  unresolvedQuestions: VisualContextQuestion[]
  evidence: VisualContextEvidence[]
  budget: VisualContextBudget
  usage: VisualContextUsage
}

const DEFAULT_CONTEXT_BUDGET: VisualContextBudget = {
  maxRounds: 4,
  maxCostUnits: 100,
  maxTokens: 40_000,
  maxElapsedMs: 180_000
}

const EMPTY_CONTEXT_USAGE: VisualContextUsage = {
  rounds: 0,
  costUnits: 0,
  tokens: 0,
  elapsedMs: 0,
  consecutiveNoProgressRounds: 0
}

export function planVisualProduction(request: VisualGenerateRequest): VisualGenerateResult {
  const task = request.task.trim()
  if (!task) return invalidRequest('task is required.')

  let requirements: VisualProductionRequirements
  try {
    requirements = normalizeRequirements(request.requirements)
  } catch (error) {
    return invalidRequest(error instanceof Error ? error.message : String(error))
  }
  const action = request.action ?? 'create'
  const reviewPacketPath = request.reviewPacketPath?.trim()
  const context = summarizeContext(request)

  if (!context.sufficient && !context.stopReason) {
    return {
      ok: true,
      status: 'needs_context',
      task,
      action,
      context,
      nextAction: {
        tool: 'research_search',
        questions: context.unresolvedQuestions.filter((question) => question.priority === 'required')
      },
      routeLocked: false
    }
  }

  if (requirements.lockedElements.length === 0 && requirements.modelOwnedElements.length === 0 && !requirements.scene) {
    return invalidRequest('requirements must declare lockedElements or modelOwnedElements.')
  }
  const route = selectRoute(requirements)
  if (
    (route === 'code' || route === 'hybrid')
    && requirements.lockedElements.length === 0
    && !requirements.scene?.layers.some((layer) => layer.owner === 'code')
  ) {
    return invalidRequest(`requirements.lockedElements is required for route=${route}.`)
  }
  if (action === 'revision' && route !== 'code' && !reviewPacketPath) {
    return invalidRequest(`reviewPacketPath is required for action=revision and route=${route}.`)
  }

  const contextStatus = context.sufficient ? 'ready' : 'budget_exhausted'
  const sourceArtifacts = uniqueStrings(request.sourceArtifacts ?? [])
  const contextStopReason = context.stopReason ?? 'sufficient'
  const handoff: VisualProductionHandoff = {
    planId: stablePlanId({ task, action, route, requirements, sourceArtifacts, context }),
    route,
    routeLocked: true,
    rationale: routeRationale(route),
    sourceArtifacts,
    reproducibleInputs: requirements.reproducibleInputs,
    ...((requirements.inlineSpecification || requirements.reproducibleInputs.length === 0)
      ? { inlineSpecification: requirements.inlineSpecification || task }
      : {}),
    ...(requirements.structuredData !== undefined ? { structuredData: requirements.structuredData } : {}),
    ...(requirements.scene ? { scene: requirements.scene } : {}),
    lockedElements: requirements.lockedElements,
    modelOwnedElements: requirements.modelOwnedElements,
    contextStatus,
    contextStopReason,
    contextEvidenceIds: context.evidence.map((item) => item.id),
    unresolvedContext: context.unresolvedQuestions.map((question) => question.question),
    releaseCeiling: context.sufficient ? 'publication_ready' : 'draft_ready',
    fallbackPolicy: 'fail_closed'
  }

  return {
    ok: true,
    status: context.sufficient ? 'ready' : 'budget_exhausted',
    task,
    action,
    context,
    handoff,
    routeLocked: true,
    execution: {
      route,
      stages: executionStages(route, action),
      nextCall: firstExecutionCall(request, task, action, handoff)
    },
    failPolicy: {
      mode: 'fail_closed',
      crossRouteFallback: false,
      sameRouteRetry: { allowed: true, maxAttemptsPerStage: 2, reuseOperationId: true },
      routeChangeRequiresNewPlan: true,
      preserveCompletedStageArtifacts: true,
      failureStatus: 'route_failed'
    }
  }
}

function firstExecutionCall(
  request: VisualGenerateRequest,
  task: string,
  action: 'create' | 'revision',
  handoff: VisualProductionHandoff
): { tool: VisualProductionExecutionTool; arguments: Record<string, unknown> } {
  const workspaceRoot = request.workspaceRoot
  if (action === 'revision' && handoff.route !== 'code') {
    return {
      tool: 'image_generation_edit_from_visual_review_packet',
      arguments: {
        workspaceRoot,
        visualPlan: handoff,
        reviewPacketPath: request.reviewPacketPath
      }
    }
  }
  if (handoff.route === 'model') {
    return {
      tool: 'image_generation_prepare',
      arguments: { workspaceRoot, task, visualPlan: handoff }
    }
  }
  return {
    tool: 'sciforge_discover',
    arguments: {
      capabilityId: 'scientific-plotting.map-data',
      includeSchema: true,
      limit: 1
    }
  }
}

function summarizeContext(request: VisualGenerateRequest): VisualContextSummary {
  const questions = uniqueQuestions(request.context?.questions ?? [])
  const evidence = uniqueEvidence(request.context?.evidence ?? [])
  const budget = normalizeBudget(request.budget)
  const usage = normalizeUsage(request.context?.usage)
  const evidenceQuestionIds = new Set(evidence.flatMap((item) => item.questionIds))
  const unresolvedQuestions = questions.filter((question) => (
    question.priority === 'required'
    && (question.status !== 'resolved' || !evidenceQuestionIds.has(question.id))
  ))
  const sufficient = unresolvedQuestions.length === 0
  const reachedLimits = contextLimits(budget, usage)
  const terminalReason = sufficient
    ? 'sufficient' as const
    : request.context?.policy === 'closed'
      ? 'policy_closed' as const
      : stopReason(reachedLimits, usage)
  return {
    sufficient,
    ...(terminalReason ? { stopReason: terminalReason } : {}),
    reachedLimits,
    unresolvedQuestions,
    evidence,
    budget,
    usage
  }
}

function contextLimits(
  budget: VisualContextBudget,
  usage: VisualContextUsage
): VisualContextSummary['reachedLimits'] {
  return [
    ...(usage.rounds >= budget.maxRounds ? ['rounds' as const] : []),
    ...(usage.costUnits >= budget.maxCostUnits ? ['cost' as const] : []),
    ...(usage.tokens >= budget.maxTokens ? ['tokens' as const] : []),
    ...(usage.elapsedMs >= budget.maxElapsedMs ? ['elapsed' as const] : [])
  ]
}

function stopReason(
  reachedLimits: VisualContextSummary['reachedLimits'],
  usage: VisualContextUsage
): VisualContextStopReason | undefined {
  if (reachedLimits.includes('rounds')) return 'round_limit'
  if (reachedLimits.includes('cost')) return 'cost_limit'
  if (reachedLimits.includes('tokens')) return 'token_limit'
  if (reachedLimits.includes('elapsed')) return 'elapsed_time_limit'
  if (usage.consecutiveNoProgressRounds >= 2) return 'no_information_gain'
  return undefined
}

function selectRoute(requirements: VisualProductionRequirements): VisualProductionRoute {
  const owners = requirements.scene ? visualSceneOwners(requirements.scene) : new Set()
  // Reproducible inputs do not by themselves imply code ownership. A
  // model-owned figure can be replayable when its effective prompt, public
  // model version, and generation parameters are captured as its recipe.
  const exactnessRequired = requirements.lockedElements.length > 0 || owners.has('code')
  const generativeValue = requirements.modelOwnedElements.length > 0 || owners.has('model')
  if (exactnessRequired && generativeValue) return 'hybrid'
  if (exactnessRequired) return 'code'
  if (generativeValue) return 'model'
  throw new Error('requirements must declare lockedElements or modelOwnedElements.')
}

function routeRationale(route: VisualProductionRoute): string {
  if (route === 'code') return 'Exact, auditable, or reproducible elements dominate, so code owns the rendered artifact.'
  if (route === 'model') return 'No exact elements require deterministic ownership and generative visual value dominates.'
  return 'Code owns exact elements while the image model owns the explicitly declared visual-expression layer.'
}

function executionStages(route: VisualProductionRoute, action: 'create' | 'revision'): VisualProductionExecutionStage[] {
  if (action === 'revision' && route !== 'code') {
    return [
      stage('edit_visual', 'image_generation_edit_from_visual_review_packet', 'Apply normalized review annotations without replacing the source.', ['reviewPacketPath', 'sourceArtifacts', 'handoff'], ['editedArtifact', 'editedManifest']),
      stage('review_visual', 'image_generation_review_candidate', 'Run manifest-bound candidate and release QA against the handoff and artifact hash.', ['editedArtifact', 'editedManifest', 'handoff'], ['reviewResult'])
    ]
  }
  if (route === 'code') {
    return [
      stage('discover_map_data', 'sciforge_discover', 'Discover the governed scientific plotting data-mapping capability.', ['handoff'], ['mapDataOperation'], 'scientific-plotting.map-data'),
      stage('map_data', 'sciforge_invoke', 'Map reproducible files or inline structured data with a caller-persisted operationId into a controlled code render request.', ['mapDataOperation', 'operationId', 'handoff', 'reproducibleInputs|inlineSpecification|structuredData'], ['controlledRenderRequest'], 'scientific-plotting.map-data'),
      stage('discover_render', 'sciforge_discover', 'Discover the governed versioned scientific plotting render capability.', ['controlledRenderRequest'], ['renderOperation'], 'scientific-plotting.render'),
      stage('render_code', 'sciforge_invoke', 'Render and version exact elements through the capability broker, reusing the same operationId on transport retries.', ['renderOperation', 'operationId', 'controlledRenderRequest', 'handoff'], ['renderedArtifact', 'renderedManifest', 'artifactVersionRefs', 'evidenceLineage', 'evidenceDelivery'], 'scientific-plotting.render'),
      stage('review_visual', 'image_generation_review_candidate', 'Run manifest-bound candidate and release QA against the handoff and artifact hash.', ['renderedArtifact', 'renderedManifest', 'handoff'], ['reviewResult'])
    ]
  }
  if (route === 'model') {
    return [
      stage('prepare_model', 'image_generation_prepare', 'Prepare the model-owned visual layer from the locked handoff.', ['task', 'handoff'], ['imageRenderRecipe']),
      stage('render_model', 'image_generation_render', 'Render the model-owned visual layer and persist the effective prompt, public model version, generation parameters, and replay recipe.', ['imageRenderRecipe', 'handoff'], ['renderedArtifact', 'renderedManifest', 'modelExecution']),
      stage('review_visual', 'image_generation_review_candidate', 'Run manifest-bound candidate and release QA against the handoff and artifact hash.', ['renderedArtifact', 'renderedManifest', 'modelExecution', 'handoff'], ['reviewResult'])
    ]
  }
  return [
    stage('discover_map_truth', 'sciforge_discover', 'Discover the governed scientific plotting data-mapping capability.', ['handoff'], ['mapDataOperation'], 'scientific-plotting.map-data'),
    stage('map_truth', 'sciforge_invoke', 'Map reproducible files or inline structured data for the code-owned truth layer with a caller-persisted operationId.', ['mapDataOperation', 'operationId', 'handoff', 'reproducibleInputs|inlineSpecification|structuredData'], ['controlledRenderRequest'], 'scientific-plotting.map-data'),
    stage('discover_render_truth', 'sciforge_discover', 'Discover the governed versioned scientific plotting render capability.', ['controlledRenderRequest'], ['renderOperation'], 'scientific-plotting.render'),
    stage('render_truth', 'sciforge_invoke', 'Render and version the code-owned truth layer through the capability broker, reusing the same operationId on transport retries.', ['renderOperation', 'operationId', 'controlledRenderRequest', 'handoff'], ['truthArtifact', 'truthManifest', 'artifactVersionRefs', 'evidenceLineage', 'evidenceDelivery'], 'scientific-plotting.render'),
    stage('prepare_model', 'image_generation_prepare', 'Prepare the model-owned visual layer around controlled artifacts.', ['task', 'truthArtifact', 'truthManifest', 'handoff'], ['imageRenderRecipe']),
    stage('render_visual', 'image_generation_render', 'Render only the model-owned visual layer around controlled artifacts.', ['imageRenderRecipe', 'truthArtifact', 'truthManifest', 'handoff'], ['visualLayerArtifact', 'visualLayerManifest']),
    stage('deterministic_composite', 'scientific_plotting_composite', 'Composite the code-owned truth layer over the model-owned visual layer without redrawing locked elements.', ['truthArtifact', 'truthManifest', 'visualLayerArtifact', 'visualLayerManifest', 'handoff'], ['compositeArtifact', 'compositeManifest']),
    stage('review_visual', 'image_generation_review_candidate', 'Run manifest-bound candidate and release QA against the handoff and artifact hash.', ['compositeArtifact', 'compositeManifest', 'handoff'], ['reviewResult'])
  ]
}

function stablePlanId(value: unknown): string {
  const input = JSON.stringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `visual-plan-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function stage(
  id: string,
  tool: VisualProductionExecutionTool,
  purpose: string,
  consumes: string[],
  produces: string[],
  capabilityId?: VisualProductionExecutionStage['capabilityId']
): VisualProductionExecutionStage {
  return { id, tool, purpose, consumes, produces, ...(capabilityId ? { capabilityId } : {}), locked: true }
}

function normalizeRequirements(value: VisualProductionRequirements): VisualProductionRequirements {
  if (value.scene !== undefined && value.structuredData !== undefined) {
    throw new Error('requirements.scene and requirements.structuredData are mutually exclusive; use scene for visual geometry and structuredData for chart data.')
  }
  return {
    lockedElements: uniqueStrings(value.lockedElements),
    modelOwnedElements: uniqueStrings(value.modelOwnedElements),
    reproducibleInputs: uniqueStrings(value.reproducibleInputs),
    ...(value.inlineSpecification?.trim()
      ? { inlineSpecification: value.inlineSpecification.trim() }
      : {}),
    ...(value.structuredData !== undefined ? { structuredData: value.structuredData } : {}),
    ...(value.scene !== undefined ? { scene: normalizeVisualScene(value.scene) } : {})
  }
}

function normalizeBudget(value: Partial<VisualContextBudget> | undefined): VisualContextBudget {
  return {
    maxRounds: positiveNumber(value?.maxRounds, DEFAULT_CONTEXT_BUDGET.maxRounds),
    maxCostUnits: positiveNumber(value?.maxCostUnits, DEFAULT_CONTEXT_BUDGET.maxCostUnits),
    maxTokens: positiveNumber(value?.maxTokens, DEFAULT_CONTEXT_BUDGET.maxTokens),
    maxElapsedMs: positiveNumber(value?.maxElapsedMs, DEFAULT_CONTEXT_BUDGET.maxElapsedMs)
  }
}

function normalizeUsage(value: Partial<VisualContextUsage> | undefined): VisualContextUsage {
  return {
    rounds: nonNegativeNumber(value?.rounds, EMPTY_CONTEXT_USAGE.rounds),
    costUnits: nonNegativeNumber(value?.costUnits, EMPTY_CONTEXT_USAGE.costUnits),
    tokens: nonNegativeNumber(value?.tokens, EMPTY_CONTEXT_USAGE.tokens),
    elapsedMs: nonNegativeNumber(value?.elapsedMs, EMPTY_CONTEXT_USAGE.elapsedMs),
    consecutiveNoProgressRounds: nonNegativeNumber(value?.consecutiveNoProgressRounds, EMPTY_CONTEXT_USAGE.consecutiveNoProgressRounds)
  }
}

function uniqueQuestions(values: VisualContextQuestion[]): VisualContextQuestion[] {
  const seen = new Set<string>()
  return values.flatMap((value) => {
    const id = value.id.trim()
    const question = value.question.trim()
    if (!id || !question || seen.has(id)) return []
    seen.add(id)
    return [{ ...value, id, question }]
  })
}

function uniqueEvidence(values: VisualContextEvidence[]): VisualContextEvidence[] {
  const evidenceById = new Map<string, VisualContextEvidence>()
  for (const value of values) {
    const id = value.id.trim()
    const source = value.source.trim()
    const summary = value.summary.trim()
    if (!id || !source || !summary) continue
    const existing = evidenceById.get(id)
    evidenceById.set(id, existing
      ? { ...existing, questionIds: uniqueStrings([...existing.questionIds, ...value.questionIds]) }
      : { id, source, summary, questionIds: uniqueStrings(value.questionIds) })
  }
  return [...evidenceById.values()]
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegativeNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function invalidRequest(message: string): Extract<VisualGenerateResult, { ok: false }> {
  return { ok: false, status: 'invalid_request', message }
}
