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

  it('routes an annotated generative revision directly through non-destructive packet editing', () => {
    const result = planScientificVisual({
      task: 'Apply the reviewer annotations to the existing conceptual figure.',
      action: 'revision',
      visualDocumentId: 'visual-1',
      reviewPacketPath: '.sciforge/visual-documents/visual-1/review-packet.json',
      sourceArtifacts: ['figures/existing.png'],
      decision: {
        route: 'generative_visual',
        rationale: 'The requested changes are conceptual and localized.',
        reproducibleInputs: [],
        truthLockedElements: ['unannotated pixels', 'labels', 'relationships']
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.execution.stages).toMatchObject([
      {
        id: 'edit_visual',
        tool: 'image_generation_edit_from_visual_review_packet',
        consumes: expect.arrayContaining(['reviewPacketPath', 'sourceArtifacts', 'truthLockedElements'])
      },
      { id: 'review_visual', tool: 'visual_artifact_review' }
    ])
    expect(result.execution.stages.map((stage) => stage.tool)).not.toContain('image_generation_render')
    expect(result.execution.stages.map((stage) => stage.tool)).not.toContain('image_generation_prepare')
  })

  it('routes an annotated hybrid revision through the same packet-edit workflow', () => {
    const result = planScientificVisual({
      task: 'Restyle one annotated conceptual region while preserving exact plotted values.',
      action: 'revision',
      reviewPacketPath: '.sciforge/visual-documents/visual-2/review-packet.json',
      sourceArtifacts: ['figures/mixed-figure.png'],
      decision: {
        route: 'hybrid_composite',
        rationale: 'The raster mixes exact scientific marks with conceptual composition.',
        reproducibleInputs: ['data/results.csv'],
        truthLockedElements: ['plot values', 'axis labels', 'unannotated regions']
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.execution.stages.map((stage) => stage.tool)).toEqual([
      'image_generation_edit_from_visual_review_packet',
      'visual_artifact_review'
    ])
  })

  it.each(['generative_visual', 'hybrid_composite'] as const)(
    'fails closed when a %s revision omits the visual review packet',
    (route) => {
      expect(planScientificVisual({
        task: 'Revise an existing raster.',
        action: 'revision',
        sourceArtifacts: ['figures/existing.png'],
        decision: {
          route,
          rationale: 'The requested revision needs semantic image editing.',
          reproducibleInputs: route === 'hybrid_composite' ? ['data/results.csv'] : [],
          truthLockedElements: ['source content outside annotated regions']
        }
      })).toEqual({
        ok: false,
        status: 'invalid_decision',
        message: `reviewPacketPath is required for action=revision and route=${route}; annotated raster revisions must use the non-destructive visual-review edit workflow.`
      })
    }
  )

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
