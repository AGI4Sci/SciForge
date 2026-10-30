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
    expect(result.execution.stages.at(-1)?.tool).toBe('image_generation_review_candidate')
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
      tools: ['sciforge_discover', 'sciforge_invoke', 'sciforge_discover', 'sciforge_invoke', 'image_generation_review_candidate']
    },
    {
      route: 'model',
      requirements: { lockedElements: [], modelOwnedElements: ['illustrative composition'], reproducibleInputs: [] },
      tools: ['image_generation_prepare', 'image_generation_render', 'image_generation_review_candidate']
    }
  ] as const)('locks the $route route without a cross-route fallback', ({ route, requirements, tools }) => {
    const result = planVisualProduction(request({ requirements: { ...requirements } }))
    expect(result).toMatchObject({
      ok: true,
      status: 'ready',
      handoff: { route, routeLocked: true, fallbackPolicy: 'fail_closed' },
      failPolicy: {
        crossRouteFallback: false,
        routeChangeRequiresNewPlan: true,
        sameRouteRetry: { reuseOperationId: true }
      }
    })
    if (!result.ok || result.status === 'needs_context') return
    expect(result.execution.stages.map((stage) => stage.tool)).toEqual(tools)
    if (route === 'code') {
      expect(result.execution.stages.find(({ id }) => id === 'map_data')?.consumes).toContain('operationId')
      expect(result.execution.stages.find(({ id }) => id === 'render_code')?.produces).toContain('evidenceDelivery')
    }
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
      'discover_map_truth',
      'map_truth',
      'discover_render_truth',
      'render_truth',
      'prepare_model',
      'render_visual',
      'deterministic_composite',
      'review_visual'
    ])
    expect(result.execution.stages.at(-1)?.tool).toBe('image_generation_review_candidate')
  })

  it('keeps model-owned figures on the model route when reproducibility comes from a pinned prompt recipe', () => {
    const result = planVisualProduction(request({
      requirements: {
        lockedElements: [],
        modelOwnedElements: ['the complete illustrative composition'],
        reproducibleInputs: ['prompt:cell-cycle-v2', 'model:sciforge-router']
      }
    }))

    expect(result).toMatchObject({
      ok: true,
      status: 'ready',
      handoff: { route: 'model', routeLocked: true },
      execution: {
        stages: [
          { id: 'prepare_model' },
          {
            id: 'render_model',
            produces: expect.arrayContaining(['renderedManifest', 'modelExecution'])
          },
          {
            id: 'review_visual',
            consumes: expect.arrayContaining(['modelExecution'])
          }
        ]
      }
    })
  })

  it('treats a self-contained exact brief as an inline reproducible specification', () => {
    const structuredData = {
      categories: ['A', 'B'],
      series: [{ values: [1, 2] }]
    }
    const result = planVisualProduction(request({
      workspaceRoot: '/workspace',
      task: 'Draw an exact vector scene from the declared locked elements.',
      requirements: {
        lockedElements: ['all geometry, labels, and colors'],
        modelOwnedElements: [],
        reproducibleInputs: [],
        structuredData
      }
    }))

    expect(result).toMatchObject({
      ok: true,
      status: 'ready',
      handoff: {
        route: 'code',
        inlineSpecification: 'Draw an exact vector scene from the declared locked elements.'
      },
      execution: {
        nextCall: {
          tool: 'sciforge_discover',
          arguments: {
            capabilityId: 'scientific-plotting.map-data',
            includeSchema: true,
            limit: 1
          }
        }
      }
    })
  })

  it('uses one normalized scene to lock hybrid ownership and the first executor', () => {
    const scene = {
      version: 1 as const,
      coordinateSystem: 'normalized' as const,
      canvas: { width: 1600, height: 900, background: '#ffffff' },
      layers: [
        {
          id: 'truth',
          owner: 'code' as const,
          primitives: [
            { id: 'label', type: 'text' as const, x: 0.25, y: 0.5, text: 'Exact label' }
          ]
        },
        {
          id: 'illustration',
          owner: 'model' as const,
          primitives: [
            { id: 'texture', type: 'image' as const, x: 0.75, y: 0.5, width: 0.4, height: 0.8, prompt: 'Subtle biological texture' }
          ]
        }
      ]
    }
    const result = planVisualProduction(request({
      workspaceRoot: '/workspace',
      requirements: {
        lockedElements: [],
        modelOwnedElements: [],
        reproducibleInputs: [],
        scene
      }
    }))

    expect(result).toMatchObject({
      ok: true,
      status: 'ready',
      handoff: { route: 'hybrid', scene },
      execution: {
        nextCall: {
          tool: 'sciforge_discover',
          arguments: {
            capabilityId: 'scientific-plotting.map-data',
            includeSchema: true,
            limit: 1
          }
        }
      }
    })
  })

  it('rejects competing scene and chart-data representations', () => {
    expect(planVisualProduction(request({
      requirements: {
        lockedElements: ['geometry'],
        modelOwnedElements: [],
        reproducibleInputs: [],
        structuredData: { values: [1, 2] },
        scene: {
          version: 1,
          coordinateSystem: 'normalized',
          canvas: { width: 100, height: 100 },
          layers: [{
            id: 'truth',
            owner: 'code',
            primitives: [{ id: 'dot', type: 'circle', x: 0.5, y: 0.5, radius: 0.1 }]
          }]
        }
      }
    }))).toMatchObject({
      ok: false,
      status: 'invalid_request',
      message: expect.stringContaining('mutually exclusive')
    })
  })

  it('rejects an ownership-free request instead of silently defaulting to code', () => {
    expect(planVisualProduction(request({
      requirements: { lockedElements: [], modelOwnedElements: [], reproducibleInputs: [] }
    }))).toMatchObject({
      ok: false,
      status: 'invalid_request',
      message: expect.stringContaining('lockedElements or modelOwnedElements')
    })
  })

  it('produces a stable plan id for the same normalized request', () => {
    const first = planVisualProduction(request({ sourceArtifacts: [' reference.png ', 'reference.png'] }))
    const second = planVisualProduction(request({ sourceArtifacts: ['reference.png'] }))
    if (!first.ok || first.status === 'needs_context' || !second.ok || second.status === 'needs_context') return
    expect(first.handoff.planId).toBe(second.handoff.planId)
  })
})
