import { describe, expect, it } from 'vitest'
import { planScientificVisual } from './scientific-visual-planner'

describe('scientific visual planner', () => {
  it('locks a deterministic route with no cross-route fallback', () => {
    const result = planScientificVisual({
      task: 'Plot measured response values with confidence intervals.',
      decision: {
        route: 'deterministic_plot',
        rationale: 'The figure contains measured values, axes, and uncertainty.',
        reproducibleInputs: ['data/results.csv', 'confidence interval definition'],
        truthLockedElements: ['all numeric values', 'axis labels', 'confidence intervals']
      }
    })

    expect(result).toMatchObject({
      ok: true,
      routeLocked: true,
      handoff: {
        route: 'deterministic_plot',
        routeLocked: true,
        fallbackPolicy: 'fail_closed'
      },
      execution: {
        route: 'deterministic_plot',
        stages: [
          { tool: 'scientific_plotting_map_data' },
          { tool: 'scientific_plotting_render' },
          { tool: 'visual_artifact_review' }
        ]
      },
      failPolicy: {
        mode: 'fail_closed',
        crossRouteFallback: false,
        routeChangeRequiresNewPlan: true
      }
    })
  })

  it('uses only image execution for a locked generative route', () => {
    const result = planScientificVisual({
      task: 'Create a conceptual illustration of a signaling mechanism.',
      decision: {
        route: 'generative_visual',
        rationale: 'The request is conceptual and needs semantic composition.',
        reproducibleInputs: [],
        truthLockedElements: ['entity names and causal direction']
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.execution.stages.map((stage) => stage.tool)).toEqual([
      'image_generation_prepare',
      'image_generation_render',
      'visual_artifact_review'
    ])
  })

  it('orders deterministic truth before generated composition for hybrid work', () => {
    const result = planScientificVisual({
      task: 'Combine exact benchmark plots with a conceptual architecture overview.',
      decision: {
        route: 'hybrid_composite',
        rationale: 'Exact plots and conceptual composition are both required.',
        reproducibleInputs: ['benchmarks.json'],
        truthLockedElements: ['benchmark values', 'axis labels', 'architecture relationships']
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.execution.stages.map((stage) => stage.id)).toEqual([
      'map_data',
      'render_truth_layer',
      'prepare_composite',
      'compose_visual',
      'review_composite'
    ])
    expect(result.execution.stages.every((stage) => stage.truthLocked)).toBe(true)
  })

  it('rejects deterministic decisions without reproducible inputs', () => {
    expect(planScientificVisual({
      task: 'Plot exact measurements.',
      decision: {
        route: 'deterministic_plot',
        rationale: 'Exact measurements must be plotted.',
        reproducibleInputs: [],
        truthLockedElements: ['measurements']
      }
    })).toEqual({
      ok: false,
      status: 'invalid_decision',
      message: 'decision.reproducibleInputs is required for route=deterministic_plot.'
    })
  })
})
