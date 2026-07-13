import { describe, expect, it } from 'vitest'
import { planVisualProduction, type VisualGenerateRequest } from './visual-production-planner'

function request(overrides: Partial<VisualGenerateRequest> = {}): VisualGenerateRequest {
  return {
    task: 'Create a clear visual explanation.',
    requirements: {
      lockedElements: [],
      modelOwnedElements: ['composition and visual style'],
      reproducibleInputs: []
    },
    ...overrides
  }
}

describe('visual production planner', () => {
  it('requests targeted context before selecting a route', () => {
    const result = planVisualProduction(request({
      context: {
        questions: [
          { id: 'q1', question: 'Which standard defines the required symbols?', priority: 'required', status: 'open' },
          { id: 'q2', question: 'Which color palette is preferred?', priority: 'optional', status: 'open' }
        ]
      }
    }))

    expect(result).toMatchObject({
      ok: true,
      status: 'needs_context',
      routeLocked: false,
      nextAction: {
        tool: 'research_search',
        questions: [{ id: 'q1' }]
      }
    })
  })

  it('resolves a question only when structured evidence supports its id', () => {
    const unresolved = planVisualProduction(request({
      context: {
        questions: [{ id: 'q1', question: 'What value should be shown?', priority: 'required', status: 'resolved' }]
      }
    }))
    expect(unresolved).toMatchObject({ ok: true, status: 'needs_context' })

    const ready = planVisualProduction(request({
      context: {
        questions: [{ id: 'q1', question: 'What value should be shown?', priority: 'required', status: 'resolved' }],
        evidence: [{ id: 'source-1', source: 'results.csv', summary: 'The measured value is 42.', questionIds: ['q1'] }]
      }
    }))
    expect(ready).toMatchObject({ ok: true, status: 'ready', routeLocked: true })
  })

  it('deduplicates evidence and records all budget limits reached', () => {
    const result = planVisualProduction(request({
      context: {
        questions: [{ id: 'q1', question: 'Which value is current?', priority: 'required', status: 'open' }],
        evidence: [
          { id: 'source-1', source: 'a', summary: 'first', questionIds: [] },
          { id: 'source-1', source: 'b', summary: 'duplicate', questionIds: [] }
        ],
        usage: { rounds: 4, costUnits: 100, tokens: 40_000, elapsedMs: 180_000 }
      }
    }))

    expect(result).toMatchObject({
      ok: true,
      status: 'budget_exhausted',
      context: {
        stopReason: 'round_limit',
        reachedLimits: ['rounds', 'cost', 'tokens', 'elapsed'],
        evidence: [{ id: 'source-1' }]
      },
      handoff: { releaseCeiling: 'draft_ready' }
    })
  })

  it('stops after two no-progress rounds and still schedules unified review', () => {
    const result = planVisualProduction(request({
      context: {
        questions: [{ id: 'q1', question: 'Which comparison is authoritative?', priority: 'required', status: 'open' }],
        usage: { rounds: 2, consecutiveNoProgressRounds: 2 }
      }
    }))

    expect(result).toMatchObject({
      ok: true,
      status: 'budget_exhausted',
      context: { stopReason: 'no_information_gain' },
      handoff: { contextStopReason: 'no_information_gain', releaseCeiling: 'draft_ready' }
    })
    if (!result.ok || result.status === 'needs_context') return
    expect(result.execution.stages.at(-1)?.tool).toBe('visual_artifact_review')
  })

  it('allows a closed context policy to create only a reviewable draft', () => {
    const result = planVisualProduction(request({
      context: {
        policy: 'closed',
        questions: [{ id: 'q1', question: 'What source supports this claim?', priority: 'required', status: 'open' }]
      }
    }))

    expect(result).toMatchObject({
      ok: true,
      status: 'budget_exhausted',
      context: { stopReason: 'policy_closed' },
      handoff: { contextStatus: 'budget_exhausted', releaseCeiling: 'draft_ready' }
    })
  })

  it.each([
    {
      route: 'code',
      requirements: { lockedElements: ['numeric values'], modelOwnedElements: [], reproducibleInputs: ['results.csv'] },
      tools: ['scientific_plotting_map_data', 'scientific_plotting_render', 'visual_artifact_review']
    },
    {
      route: 'model',
      requirements: { lockedElements: [], modelOwnedElements: ['illustrative composition'], reproducibleInputs: [] },
      tools: ['image_generation_prepare', 'image_generation_render', 'visual_artifact_review']
    }
  ] as const)('locks the $route route without a cross-route fallback', ({ route, requirements, tools }) => {
    const result = planVisualProduction(request({ requirements: { ...requirements } }))
    expect(result).toMatchObject({
      ok: true,
      status: 'ready',
      handoff: { route, routeLocked: true, fallbackPolicy: 'fail_closed' },
      failPolicy: { crossRouteFallback: false, routeChangeRequiresNewPlan: true }
    })
    if (!result.ok || result.status === 'needs_context') return
    expect(result.execution.stages.map((stage) => stage.tool)).toEqual(tools)
  })

  it('uses deterministic truth and final composite stages for hybrid work', () => {
    const result = planVisualProduction(request({
      sourceArtifacts: ['reference-layout.png'],
      requirements: {
        lockedElements: ['plot values', 'labels'],
        modelOwnedElements: ['background illustration'],
        reproducibleInputs: ['results.csv']
      }
    }))

    expect(result).toMatchObject({
      ok: true,
      status: 'ready',
      handoff: {
        route: 'hybrid',
        sourceArtifacts: ['reference-layout.png'],
        releaseCeiling: 'publication_ready'
      }
    })
    if (!result.ok || result.status === 'needs_context') return
    expect(result.execution.stages.map((stage) => stage.id)).toEqual([
      'map_truth',
      'render_truth',
      'prepare_model',
      'render_visual',
      'deterministic_composite',
      'review_visual'
    ])
    expect(result.execution.stages.at(-1)?.tool).toBe('visual_artifact_review')
  })

  it('produces a stable plan id for the same normalized request', () => {
    const first = planVisualProduction(request({ sourceArtifacts: [' reference.png ', 'reference.png'] }))
    const second = planVisualProduction(request({ sourceArtifacts: ['reference.png'] }))
    if (!first.ok || first.status === 'needs_context' || !second.ok || second.status === 'needs_context') return
    expect(first.handoff.planId).toBe(second.handoff.planId)
  })
})
