export const SCIENTIFIC_VISUAL_ROUTES = [
  'deterministic_plot',
  'generative_visual',
  'hybrid_composite'
] as const

export type ScientificVisualRoute = typeof SCIENTIFIC_VISUAL_ROUTES[number]

export type ScientificVisualDecision = {
  route: ScientificVisualRoute
  rationale: string
  reproducibleInputs: string[]
  truthLockedElements: string[]
}

export type ScientificVisualPlanRequest = {
  workspaceRoot?: string
  task: string
  action?: 'create' | 'revision'
  visualDocumentId?: string
  reviewPacketPath?: string
  sourceArtifacts?: string[]
  decision: ScientificVisualDecision
}

export type ScientificVisualExecutionStage = {
  id: string
  tool: string
  purpose: string
  consumes: string[]
  produces: string[]
  truthLocked: boolean
}

export type ScientificVisualPlanResult =
  | {
      ok: true
      task: string
      action: 'create' | 'revision'
      context: {
        workspaceRoot?: string
        visualDocumentId?: string
        reviewPacketPath?: string
        sourceArtifacts: string[]
      }
      decision: ScientificVisualDecision
      handoff: ScientificVisualDecision & {
        routeLocked: true
        fallbackPolicy: 'fail_closed'
      }
      routeLocked: true
      execution: {
        route: ScientificVisualRoute
        stages: ScientificVisualExecutionStage[]
      }
      failPolicy: {
        mode: 'fail_closed'
        crossRouteFallback: false
        sameRouteRetry: { allowed: true; maxAttemptsPerStage: 2 }
        routeChangeRequiresNewPlan: true
        preserveCompletedStageArtifacts: true
        failureStatus: 'route_failed'
      }
    }
  | { ok: false; status: 'invalid_decision'; message: string }

export function planScientificVisual(request: ScientificVisualPlanRequest): ScientificVisualPlanResult {
  const task = request.task.trim()
  if (!task) return invalidDecision('task is required.')
  const decision = normalizeDecision(request.decision)
  const action = request.action ?? 'create'
  if (!decision.rationale) return invalidDecision('decision.rationale is required.')
  if (decision.truthLockedElements.length === 0) {
    return invalidDecision('decision.truthLockedElements must identify at least one fact or visual constraint that renderers may not change.')
  }
  if (
    (decision.route === 'deterministic_plot' || decision.route === 'hybrid_composite') &&
    decision.reproducibleInputs.length === 0
  ) {
    return invalidDecision(`decision.reproducibleInputs is required for route=${decision.route}.`)
  }

  return {
    ok: true,
    task,
    action,
    context: {
      ...(request.workspaceRoot?.trim() ? { workspaceRoot: request.workspaceRoot.trim() } : {}),
      ...(request.visualDocumentId?.trim() ? { visualDocumentId: request.visualDocumentId.trim() } : {}),
      ...(request.reviewPacketPath?.trim() ? { reviewPacketPath: request.reviewPacketPath.trim() } : {}),
      sourceArtifacts: uniqueNonEmpty(request.sourceArtifacts ?? [])
    },
    decision,
    handoff: {
      ...decision,
      routeLocked: true,
      fallbackPolicy: 'fail_closed'
    },
    routeLocked: true,
    execution: { route: decision.route, stages: executionStages(decision.route) },
    failPolicy: {
      mode: 'fail_closed',
      crossRouteFallback: false,
      sameRouteRetry: { allowed: true, maxAttemptsPerStage: 2 },
      routeChangeRequiresNewPlan: true,
      preserveCompletedStageArtifacts: true,
      failureStatus: 'route_failed'
    }
  }
}

function normalizeDecision(decision: ScientificVisualDecision): ScientificVisualDecision {
  return {
    route: decision.route,
    rationale: decision.rationale.trim(),
    reproducibleInputs: uniqueNonEmpty(decision.reproducibleInputs),
    truthLockedElements: uniqueNonEmpty(decision.truthLockedElements)
  }
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function invalidDecision(message: string): ScientificVisualPlanResult {
  return { ok: false, status: 'invalid_decision', message }
}

function executionStages(route: ScientificVisualRoute): ScientificVisualExecutionStage[] {
  if (route === 'deterministic_plot') {
    return [
      stage('map_data', 'scientific_plotting_map_data', 'Map declared reproducible inputs into a controlled render request.', ['reproducibleInputs', 'truthLockedElements'], ['controlledRenderRequest']),
      stage('render_plot', 'scientific_plotting_render', 'Render the exact data-backed scientific plot.', ['controlledRenderRequest'], ['plotArtifact', 'plotManifest']),
      stage('review_plot', 'visual_artifact_review', 'Semantically inspect the rendered artifact against the task and locked scientific truth.', ['plotArtifact', 'plotManifest', 'task', 'truthLockedElements'], ['reviewResult'])
    ]
  }
  if (route === 'generative_visual') {
    return [
      stage('prepare_visual', 'image_generation_prepare', 'Prepare a downstream render recipe without changing the locked scientific-visual route.', ['task', 'truthLockedElements'], ['imageRenderRecipe']),
      stage('render_visual', 'image_generation_render', 'Generate the semantic or conceptual visual under the declared truth locks.', ['imageRenderRecipe', 'truthLockedElements'], ['generatedArtifact', 'generatedManifest']),
      stage('review_visual', 'visual_artifact_review', 'Semantically inspect the generated visual against the task and locked truth before completion.', ['generatedArtifact', 'generatedManifest', 'task', 'truthLockedElements'], ['reviewResult'])
    ]
  }
  return [
    stage('map_data', 'scientific_plotting_map_data', 'Map every quantitative component from reproducible inputs.', ['reproducibleInputs', 'truthLockedElements'], ['controlledRenderRequest']),
    stage('render_truth_layer', 'scientific_plotting_render', 'Render deterministic data panels as the source of scientific truth.', ['controlledRenderRequest'], ['controlledArtifacts', 'controlledManifests']),
    stage('prepare_composite', 'image_generation_prepare', 'Prepare a downstream composition recipe from the locked route and controlled truth artifacts.', ['task', 'controlledArtifacts', 'controlledManifests', 'truthLockedElements'], ['imageRenderRecipe']),
    stage('compose_visual', 'image_generation_render', 'Compose the conceptual visual around controlled artifacts without redrawing truth-locked content.', ['imageRenderRecipe', 'controlledArtifacts', 'controlledManifests', 'truthLockedElements'], ['compositeArtifact', 'compositeManifest']),
    stage('review_composite', 'visual_artifact_review', 'Semantically inspect the composite against its controlled sources and locked truth before completion.', ['compositeArtifact', 'compositeManifest', 'controlledArtifacts', 'task', 'truthLockedElements'], ['reviewResult'])
  ]
}

function stage(id: string, tool: string, purpose: string, consumes: string[], produces: string[]): ScientificVisualExecutionStage {
  return { id, tool, purpose, consumes, produces, truthLocked: true }
}
