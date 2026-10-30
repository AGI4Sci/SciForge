import { describe, expect, it } from 'vitest'
import type { CapabilityJsonValue } from '../../shared/capability-broker'
import { evaluateCase, evaluateDiscovery, evaluateExpectedFailure, evaluateToolUsage } from './evaluators'
import { evalCaseSchema, type EvalTrace } from './schema'

const trace = (overrides: Partial<EvalTrace> = {}): EvalTrace => ({
  discoveredActions: ['paper-radar.search'],
  selectedActions: [{
    actionId: 'paper-radar.search',
    args: { query: 'AlphaFold 3' },
    success: true,
    retryCount: 0,
    latencyMs: 10,
    sequence: 2
  }],
  invocations: [{
    actionId: 'paper-radar.search',
    args: { query: 'AlphaFold 3' },
    success: true,
    retryCount: 0,
    latencyMs: 10,
    sequence: 2
  }],
  authorizationEvents: [],
  toolCalls: 1,
  retryCount: 0,
  latencyMs: 10,
  taskSuccess: true,
  ...overrides
})

function evalCase(expected: Record<string, unknown>) {
  return evalCaseSchema.parse({
    id: 'paper-search',
    query: 'Search Paper Radar',
    expected: {
      domain: 'paper-radar',
      mustDiscover: ['paper-radar.search'],
      requiredActions: ['paper-radar.search'],
      allowedActions: ['paper-radar.search'],
      ...expected
    }
  })
}

describe('capability evaluators', () => {
  it('passes a correct action, discovery, arguments, and task', () => {
    const result = evaluateCase(evalCase({
      authorization: { 'paper-radar.search': 'allow' },
      invocation: { 'paper-radar.search': { success: true } },
      arguments: {
        'paper-radar.search': {
          required: ['query'],
          types: { query: 'string' },
          values: { query: 'AlphaFold 3' }
        }
      },
      taskSuccess: true
    }), { trace: trace() })
    expect(result.passed).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('fails on wrong action and missing required action', () => {
    const wrong = trace({
      domain: 'scientific-compute',
      selectedActions: [{
        actionId: 'scientific-compute.status',
        args: {},
        success: true,
        retryCount: 0,
        latencyMs: 1
      }],
      invocations: [{
        actionId: 'scientific-compute.status',
        args: {},
        success: true,
        retryCount: 0,
        latencyMs: 1
      }]
    })
    const result = evaluateCase(evalCase({
      authorization: { 'paper-radar.search': 'allow' },
      invocation: { 'paper-radar.search': { success: true } }
    }), { trace: wrong })
    expect(result.passed).toBe(false)
    expect(result.failures.map((failure) => failure.type)).toEqual(expect.arrayContaining([
      'wrong_domain',
      'wrong_action',
      'invocation_missing'
    ]))
  })

  it('fails when a forbidden action is called', () => {
    const forbidden: EvalTrace = trace({
      selectedActions: [{
        actionId: 'paper-radar.sync-arxiv',
        args: {},
        success: false,
        errorCode: 'approval_denied',
        retryCount: 0,
        latencyMs: 1
      }],
      invocations: [{
        actionId: 'paper-radar.sync-arxiv',
        args: {},
        success: false,
        errorCode: 'approval_denied',
        retryCount: 0,
        latencyMs: 1
      }]
    })
    const result = evaluateCase(evalCase({
      requiredActions: [],
      allowedActions: ['paper-radar.search'],
      forbiddenActions: ['paper-radar.sync-arxiv'],
      authorization: { 'paper-radar.sync-arxiv': 'deny' },
      invocation: { 'paper-radar.sync-arxiv': { success: false, errorCode: 'approval_denied' } },
      taskSuccess: false
    }), { trace: forbidden })
    expect(result.failures.map((failure) => failure.type)).toContain('forbidden_action')
  })

  it('treats an explicit capability allow-list violation as a hard failure', () => {
    const result = evaluateCase(evalCase({
      requiredActions: [],
      expectedActions: ['paper-radar.search'],
      allowedActions: ['paper-radar.search'],
      taskSuccess: true
    }), { trace: trace({
      selectedActions: [{
        actionId: 'paper-radar.rank', args: {}, success: true,
        retryCount: 0, latencyMs: 1
      }],
      invocations: [{
        actionId: 'paper-radar.rank', args: {}, success: true,
        retryCount: 0, latencyMs: 1
      }]
    }) })
    expect(result.outcome).toBe('FAIL')
    expect(result.failures.map((failure) => failure.type)).toContain('wrong_action')
  })

  it('keeps discovery with opaque candidate identity inconclusive', () => {
    const parsed = evalCase({
      mustDiscover: ['paper-radar.search']
    })
    const result = evaluateDiscovery(parsed, trace({
      discoveredActions: [],
      discoveryEvidenceStatus: 'partial'
    }))
    expect(result.score).toBe(0)
    expect(result.failures).toEqual([expect.objectContaining({ type: 'trace_unsupported' })])
  })

  it('observes unlisted runtime tools without penalizing an open tool contract', () => {
    const result = evaluateToolUsage(evalCase({}), trace({
      toolCallDetails: [{
        callId: 'terminal-1',
        toolName: 'exec_command',
        status: 'success',
        sequence: 1
      }]
    }))
    expect(result.score).toBe(1)
    expect(result.failures).toEqual([])
  })

  it('does not double-count an expected capability failure as a protocol-tool failure', () => {
    const parsed = evalCaseSchema.parse({
      id: 'approval-denied-tool',
      query: 'Attempt a confirmation that is denied',
      expected: {
        requiredActions: ['paper-radar.profiles.save'],
        allowedActions: ['paper-radar.profiles.save']
      },
      expectedFailure: {
        actionId: 'paper-radar.profiles.save',
        errorCode: 'approval_denied',
        handling: 'reported'
      }
    })
    const result = evaluateToolUsage(parsed, trace({
      toolCallDetails: [{
        callId: 'invoke-1',
        toolName: 'sciforge_invoke',
        actionId: 'paper-radar.profiles.save',
        status: 'error',
        errorCode: 'approval_denied',
        sequence: 3
      }]
    }))
    expect(result.score).toBe(1)
    expect(result.failures).toEqual([])
  })

  it('enforces a runtime tool allow-list only when one is declared', () => {
    const result = evaluateToolUsage(evalCase({
      tools: {
        required: [],
        allowed: ['sciforge_discover'],
        forbidden: [],
        unnecessary: []
      }
    }), trace({
      toolCallDetails: [{
        callId: 'terminal-1',
        toolName: 'exec_command',
        status: 'success',
        sequence: 1
      }]
    }))
    expect(result.failures.map((failure) => failure.type)).toContain('unexpected_tool')
  })

  it('calculates discovery recall without penalizing extra discovered actions', () => {
    const result = evaluateDiscovery(evalCase({
      mustDiscover: ['paper-radar.search', 'paper-radar.rank']
    }), trace({ discoveredActions: ['paper-radar.search', 'paper-radar.rank', 'paper-radar.digest'] }))
    expect(result.score).toBe(1)
    expect(result.failures).toEqual([])
  })

  it('scores a cross-domain workflow without requiring an unlisted call order', () => {
    const workflow = evalCaseSchema.parse({
      id: 'cross-domain-workflow',
      query: 'Find papers and prepare plot data',
      workflowType: 'cross-domain',
      expected: {
        requiredDomains: ['paper-radar', 'scientific-plotting'],
        mustDiscover: ['paper-radar.search', 'scientific-plotting.map-data'],
        requiredActions: ['paper-radar.search', 'scientific-plotting.map-data'],
        allowedActions: ['paper-radar.search', 'scientific-plotting.map-data'],
        taskSuccess: true
      },
      expectedFinalState: {
        assertions: [{ path: 'plotData', operator: 'exists' }]
      }
    })
    const invocations = [
      {
        actionId: 'scientific-plotting.map-data', args: {}, success: true,
        retryCount: 0, latencyMs: 10, sequence: 1
      },
      {
        actionId: 'paper-radar.search', args: {}, success: true,
        retryCount: 0, latencyMs: 10, sequence: 2
      }
    ]
    const result = evaluateCase(workflow, { trace: trace({
      domain: 'scientific-plotting',
      domains: ['scientific-plotting', 'paper-radar'],
      discoveredActions: ['scientific-plotting.map-data', 'paper-radar.search'],
      selectedActions: invocations,
      invocations,
      finalState: { plotData: { rows: 3 } },
      taskSuccess: true
    }) })
    expect(result.passed).toBe(true)
    expect(result.scores.routing).toBe(1)
    expect(result.failures).toEqual([])
  })

  it('requires one action from an explicitly declared alternative group', () => {
    const workflow = evalCaseSchema.parse({
      id: 'alternative-path',
      query: 'Prepare the paper result',
      workflowType: 'multi-step',
      expected: {
        requiredActions: ['paper-radar.search'],
        alternativeActionGroups: [['paper-radar.rank', 'paper-radar.digest']],
        allowedActions: ['paper-radar.search', 'paper-radar.rank', 'paper-radar.digest']
      }
    })
    const search = {
      actionId: 'paper-radar.search', args: {}, success: true,
      retryCount: 0, latencyMs: 1
    }
    const missing = evaluateCase(workflow, { trace: trace({
      selectedActions: [search], invocations: [search]
    }) })
    expect(missing.failures.map((failure) => failure.type)).toContain('missing_alternative_action')
    const digest = {
      actionId: 'paper-radar.digest', args: {}, success: true,
      retryCount: 0, latencyMs: 1
    }
    const satisfied = evaluateCase(workflow, { trace: trace({
      selectedActions: [search, digest], invocations: [search, digest]
    }) })
    expect(satisfied.failures).toEqual([])
  })

  it('checks ordering and explicitly declared unnecessary actions only', () => {
    const workflow = evalCaseSchema.parse({
      id: 'ordered-workflow',
      query: 'Run the workflow',
      workflowType: 'multi-step',
      expected: {
        requiredActions: ['paper-radar.search', 'paper-radar.rank'],
        allowedActions: ['paper-radar.search', 'paper-radar.rank', 'scientific-compute.status'],
        unnecessaryActions: ['scientific-compute.status'],
        ordering: [{ before: 'paper-radar.search', after: 'paper-radar.rank' }],
        taskSuccess: true
      }
    })
    const invocations = [
      { actionId: 'paper-radar.rank', args: {}, success: true, retryCount: 0, latencyMs: 1, sequence: 1 },
      { actionId: 'paper-radar.search', args: {}, success: true, retryCount: 0, latencyMs: 1, sequence: 2 },
      { actionId: 'scientific-compute.status', args: {}, success: true, retryCount: 0, latencyMs: 1, sequence: 3 }
    ]
    const result = evaluateCase(workflow, { trace: trace({
      discoveredActions: [], selectedActions: invocations, invocations, taskSuccess: true
    }) })
    expect(result.failures.map((failure) => failure.type)).toEqual(expect.arrayContaining([
      'ordering_mismatch',
      'unnecessary_action'
    ]))
  })

  it('detects authorization mismatch and invocation failure', () => {
    const result = evaluateCase(evalCase({
      authorization: { 'paper-radar.search': 'confirmation' },
      invocation: { 'paper-radar.search': { success: false, errorCode: 'provider_unavailable' } },
      taskSuccess: false
    }), { trace: trace({
      invocations: [{
        actionId: 'paper-radar.search',
        args: { query: 'AlphaFold 3' },
        success: false,
        errorCode: 'provider_unavailable',
        retryCount: 1,
        latencyMs: 30
      }],
      selectedActions: [{
        actionId: 'paper-radar.search',
        args: { query: 'AlphaFold 3' },
        success: false,
        errorCode: 'provider_unavailable',
        retryCount: 1,
        latencyMs: 30
      }],
      retryCount: 1,
      latencyMs: 30,
      taskSuccess: false
    }) })
    expect(result.failures.map((failure) => failure.type)).toContain('authorization_mismatch')
    expect(result.scores.invocation).toBe(1)
  })

  it('separates an expected provider failure from evaluator failure', () => {
    const expectedFailure = evalCaseSchema.parse({
      ...evalCase({
        authorization: { 'paper-radar.search': 'allow' },
        invocation: { 'paper-radar.search': { success: false, errorCode: 'provider_unavailable' } },
        taskSuccess: false
      }),
      expectedFailure: {
        actionId: 'paper-radar.search',
        errorCode: 'provider_unavailable',
        handling: 'reported'
      }
    })
    const result = evaluateCase(expectedFailure, {
      trace: trace({
        invocations: [{
          actionId: 'paper-radar.search',
          args: { query: 'AlphaFold 3' },
          success: false,
          errorCode: 'provider_unavailable',
          retryCount: 0,
          latencyMs: 10,
          sequence: 2
        }],
        selectedActions: [{
          actionId: 'paper-radar.search',
          args: { query: 'AlphaFold 3' },
          success: false,
          errorCode: 'provider_unavailable',
          retryCount: 0,
          latencyMs: 10,
          sequence: 2
        }],
        taskSuccess: false
      })
    })
    expect(result.passed).toBe(true)
    expect(result.expectedFailureHandling).toBe('passed')
    expect(result.failures).toEqual([])
  })

  it('keeps an unresolved first invocation inconclusive even when a later action succeeds', () => {
    const routingCase = evalCaseSchema.parse({
      id: 'routing-unresolved-first',
      query: 'Find the relevant paper',
      semanticsVersion: 'semantics-v2',
      taskType: 'routing',
      evaluationDimensions: ['action_selection', 'invocation'],
      expected: {
        domain: 'paper-radar',
        mustDiscover: [],
        expectedActions: ['paper-radar.search'],
        invocation: { 'paper-radar.search': { success: true } }
      }
    })
    const result = evaluateCase(routingCase, {
      trace: trace({
        selectedActions: [
          { operationRef: 'op_unknown', args: { query: 'Find the relevant paper' }, success: false, outcome: 'unknown', retryCount: 0, latencyMs: null },
          { actionId: 'paper-radar.search', args: { query: 'Find the relevant paper' }, success: true, outcome: 'success', retryCount: 0, latencyMs: 1 }
        ],
        invocations: [
          { operationRef: 'op_unknown', args: { query: 'Find the relevant paper' }, success: false, outcome: 'unknown', retryCount: 0, latencyMs: null },
          { actionId: 'paper-radar.search', args: { query: 'Find the relevant paper' }, success: true, outcome: 'success', retryCount: 0, latencyMs: 1 }
        ],
        unresolvedActionCount: 1,
        domain: undefined
      })
    })
    expect(result.outcome).toBe('INCONCLUSIVE')
    expect(result.passed).toBe(false)
    expect(result.failures.map((failure) => failure.type)).toEqual(['trace_unsupported', 'trace_unsupported'])
    expect(result.dimensionResults?.action_selection?.status).toBe('INCONCLUSIVE')
  })

  it('requires a later success for recovered expected failures', () => {
    const expectedFailure = evalCaseSchema.parse({
      ...evalCase({
        authorization: { 'paper-radar.search': 'allow' },
        invocation: { 'paper-radar.search': { success: true } },
        taskSuccess: true
      }),
      expectedFailure: {
        actionId: 'paper-radar.search',
        errorCode: 'provider_unavailable',
        handling: 'recovered'
      }
    })
    const result = evaluateCase(expectedFailure, {
      trace: trace({
        invocations: [{
          actionId: 'paper-radar.search',
          args: { query: 'AlphaFold 3' },
          success: false,
          errorCode: 'provider_unavailable',
          retryCount: 0,
          latencyMs: 10,
          sequence: 2
        }],
        selectedActions: [{
          actionId: 'paper-radar.search',
          args: { query: 'AlphaFold 3' },
          success: false,
          errorCode: 'provider_unavailable',
          retryCount: 0,
          latencyMs: 10,
          sequence: 2
        }]
      })
    })
    expect(result.passed).toBe(false)
    expect(result.expectedFailureHandling).toBe('failed')
    expect(result.failures.map((failure) => failure.type)).toContain('expected_failure_mismatch')
  })

  it('checks nested final-state values with deterministic rubric support', () => {
    const result = evaluateCase(evalCase({
      requiredActions: [],
      allowedActions: [],
      taskSuccess: true
    }), {
      trace: trace({
        discoveredActions: [],
        selectedActions: [],
        invocations: [],
        finalState: { artifact: { path: 'result.csv', rows: 4 } } as CapabilityJsonValue
      })
    })
    const withAssertions = evalCaseSchema.parse({
      ...evalCase({ requiredActions: [], allowedActions: [], taskSuccess: true }),
      expectedFinalState: { assertions: [{ path: 'artifact.rows', operator: 'equals', value: 4 }] },
      rubric: [{
        id: 'row-count',
        description: 'At least four rows',
        type: 'deterministic',
        weight: 1,
        assertion: { path: 'artifact.rows', operator: 'equals', value: 4 }
      }]
    })
    const asserted = evaluateCase(withAssertions, {
      trace: trace({
        discoveredActions: [],
        selectedActions: [],
        invocations: [],
        finalState: { artifact: { path: 'result.csv', rows: 4 } } as CapabilityJsonValue
      })
    })
    expect(result.scores.finalState).toBe(1)
    expect(asserted.scores.finalState).toBe(1)
    expect(asserted.scores.rubric).toBe(1)
  })

  it('reports unsupported LLM rubrics without treating them as a scored pass', () => {
    const unsupported = evalCaseSchema.parse({
      ...evalCase({ requiredActions: [], allowedActions: [], taskSuccess: true }),
      rubric: [{
        id: 'quality-judge',
        description: 'Judge the quality of the result',
        type: 'llm_judge',
        weight: 1
      }]
    })
    const result = evaluateCase(unsupported, { trace: trace() })
    expect(result.passed).toBe(false)
    expect(result.outcome).toBe('INCONCLUSIVE')
    expect(result.rubric).toMatchObject([{ id: 'quality-judge', status: 'unsupported', score: 0 }])
    expect(result.scores.rubric).toBe(0)
  })

  it('scores an LLM rubric from an explicit judge result', () => {
    const judged = evalCaseSchema.parse({
      ...evalCase({ requiredActions: [], allowedActions: [], taskSuccess: true }),
      rubric: [{
        id: 'quality-judge',
        description: 'The answer is grounded and complete.',
        type: 'llm_judge',
        weight: 1,
        maxScore: 1,
        threshold: 0.7
      }]
    })
    const result = evaluateCase(judged, {
      trace: trace({
        llmJudgeResults: [{
          rubricId: 'quality-judge',
          score: 0.9,
          evidence: 'The answer cites the observed result.',
          model: 'judge-fixture-v1'
        }]
      })
    })
    expect(result.passed).toBe(true)
    expect(result.rubric).toMatchObject([{
      id: 'quality-judge',
      status: 'passed',
      score: 0.9,
      model: 'judge-fixture-v1'
    }])
    expect(result.scores.rubric).toBe(0.9)
  })

  it('uses a human calibration override when one is supplied', () => {
    const judged = evalCaseSchema.parse({
      ...evalCase({ requiredActions: [], allowedActions: [], taskSuccess: true }),
      rubric: [{
        id: 'quality-judge',
        description: 'The answer is grounded and complete.',
        type: 'llm_judge',
        weight: 1,
        maxScore: 1,
        threshold: 0.7
      }]
    })
    const result = evaluateCase(judged, {
      trace: trace({
        llmJudgeResults: [{
          rubricId: 'quality-judge',
          score: 0.9,
          model: 'judge-fixture-v1',
          humanCalibration: {
            reviewer: 'reviewer-1',
            score: 0.6,
            rationale: 'The answer omits one required citation.',
            reviewedAt: '2026-09-20T00:00:00Z'
          }
        }]
      })
    })
    expect(result.passed).toBe(false)
    expect(result.rubric).toMatchObject([{
      id: 'quality-judge',
      status: 'failed',
      score: 0.6,
      rawScore: 0.9,
      calibratedBy: 'reviewer-1',
      calibratedAt: '2026-09-20T00:00:00Z'
    }])
  })

  it('does not infer task success from a completed turn lifecycle', () => {
    const result = evaluateCase(evalCase({ taskSuccess: true }), {
      trace: trace({ taskSuccess: undefined, executionStatus: 'completed' })
    })
    expect(result.passed).toBe(false)
    expect(result.failures.map((failure) => failure.type)).toContain('trace_unsupported')
  })

  it('marks missing final-state evidence as inconclusive rather than a product failure', () => {
    const parsed = evalCase({
      requiredActions: [],
      allowedActions: [],
      taskSuccess: true
    })
    const withFinalState = evalCaseSchema.parse({
      ...parsed,
      expectedFinalState: { assertions: [{ path: 'artifact', operator: 'exists' }] }
    })
    const result = evaluateCase(withFinalState, { trace: trace({ finalState: undefined }) })
    expect(result.outcome).toBe('INCONCLUSIVE')
    expect(result.failures.map((failure) => failure.type)).toContain('trace_unsupported')
  })

  it('reports non-capability runtime tools and their failures separately', () => {
    const result = evaluateCase(evalCase({ taskSuccess: true }), {
      trace: trace({
        toolCalls: 2,
        capabilityToolCalls: 1,
        toolCallDetails: [
          {
            callId: 'capability-call',
            toolName: 'sciforge_invoke',
            actionId: 'paper-radar.search',
            status: 'success',
            sequence: 1
          },
          {
            callId: 'terminal-call',
            toolName: 'exec_command',
            status: 'error',
            errorCode: 'command_failed',
            sequence: 2
          }
        ]
      })
    })
    expect(result.failures.map((failure) => failure.type)).toEqual(['tool_failure'])
  })

  it('allows a non-capability tool only when the case contract names it', () => {
    const parsed = evalCaseSchema.parse({
      id: 'tool-contract',
      query: 'Run the approved analysis',
      expected: {
        requiredActions: [],
        allowedActions: [],
        tools: { allowed: ['python'] }
      }
    })
    const result = evaluateToolUsage(parsed, trace({
      toolCallDetails: [{
        callId: 'python-call',
        toolName: 'python',
        status: 'success',
        sequence: 1
      }]
    }))
    expect(result.score).toBe(1)
    expect(result.failures).toEqual([])
  })

  it('does not pass a required runtime tool when the trace is empty', () => {
    const parsed = evalCaseSchema.parse({
      id: 'required-tool-missing',
      query: 'Create the requested artifact',
      expected: {
        requiredActions: [],
        allowedActions: [],
        tools: { required: ['python'] }
      }
    })
    const result = evaluateToolUsage(parsed, trace({ toolCallDetails: [] }))
    expect(result.score).toBe(0)
    expect(result.failures.map((failure) => failure.type)).toContain('missing_tool')
  })

  it('applies forbidden runtime-tool rules to protocol tools too', () => {
    const parsed = evalCaseSchema.parse({
      id: 'forbidden-protocol-tool',
      query: 'Do not discover capabilities',
      expected: {
        requiredActions: [],
        allowedActions: [],
        tools: { forbidden: ['sciforge_discover'] }
      }
    })
    const result = evaluateToolUsage(parsed, trace({
      toolCallDetails: [{
        callId: 'discover-1', toolName: 'sciforge_discover', status: 'success', sequence: 1
      }]
    }))
    expect(result.failures.map((failure) => failure.type)).toContain('forbidden_tool')
  })

  it('checks arguments for every logical invocation instead of only the last one', () => {
    const parsed = evalCase({
      arguments: {
        'paper-radar.search': {
          required: ['query'],
          values: { query: 'AlphaFold 3' }
        }
      }
    })
    const first = {
      actionId: 'paper-radar.search', args: { query: 'wrong' }, success: true,
      retryCount: 0, latencyMs: 1, logicalInvocationId: 'call-1', sequence: 1
    }
    const second = {
      actionId: 'paper-radar.search', args: { query: 'AlphaFold 3' }, success: true,
      retryCount: 0, latencyMs: 1, logicalInvocationId: 'call-2', sequence: 2
    }
    const result = evaluateCase(parsed, { trace: trace({
      selectedActions: [first, second], invocations: [first, second]
    }) })
    expect(result.scores.arguments).toBe(0.75)
    expect(result.failures.map((failure) => failure.type)).toContain('argument_mismatch')
  })

  it('checks authorization before each logical invocation', () => {
    const parsed = evalCase({ authorization: { 'paper-radar.search': 'confirmation' } })
    const first = {
      actionId: 'paper-radar.search', args: {}, success: true,
      retryCount: 0, latencyMs: 1, logicalInvocationId: 'call-1', sequence: 1
    }
    const second = {
      actionId: 'paper-radar.search', args: {}, success: true,
      retryCount: 0, latencyMs: 1, logicalInvocationId: 'call-2', sequence: 4
    }
    const result = evaluateCase(parsed, { trace: trace({
      selectedActions: [first, second], invocations: [first, second], authorizationEvents: [
        { actionId: 'paper-radar.search', status: 'requested', sequence: 2 },
        { actionId: 'paper-radar.search', status: 'allowed', sequence: 3 }
      ]
    }) })
    expect(result.scores.authorization).toBe(0)
    expect(result.failures.map((failure) => failure.type)).toEqual(expect.arrayContaining([
      'authorization_mismatch', 'authorization_order'
    ]))
  })

  it('uses the terminal capability result for live confirmation ordering', () => {
    const parsed = evalCase({ authorization: { 'paper-radar.search': 'confirmation' } })
    const invocation = {
      actionId: 'paper-radar.search', args: {}, success: true,
      retryCount: 0, latencyMs: 1, logicalInvocationId: 'call-1', sequence: 1,
      authorizationSequence: 4
    }
    const result = evaluateCase(parsed, { trace: trace({
      selectedActions: [invocation], invocations: [invocation], authorizationEvents: [
        { actionId: 'paper-radar.search', status: 'requested', sequence: 2 },
        { actionId: 'paper-radar.search', status: 'allowed', sequence: 3 }
      ]
    }) })
    expect(result.scores.authorization).toBe(1)
    expect(result.failures).toEqual([])
  })

  it('accepts an injected approval denial for a confirmation expected failure', () => {
    const parsed = evalCaseSchema.parse({
      ...evalCase({
        authorization: { 'paper-radar.search': 'confirmation' },
        invocation: { 'paper-radar.search': { success: false, errorCode: 'approval_denied' } },
        taskSuccess: false
      }),
      expectedFailure: {
        actionId: 'paper-radar.search',
        errorCode: 'approval_denied',
        handling: 'reported'
      }
    })
    const invocation = {
      actionId: 'paper-radar.search',
      args: { query: 'AlphaFold 3' },
      success: false,
      errorCode: 'approval_denied',
      retryCount: 0,
      latencyMs: 1,
      sequence: 3,
      authorizationSequence: 4
    }
    const result = evaluateCase(parsed, { trace: trace({
      selectedActions: [invocation],
      invocations: [invocation],
      authorizationEvents: [
        { actionId: 'paper-radar.search', status: 'requested', mode: 'confirmation', sequence: 1 },
        { actionId: 'paper-radar.search', status: 'denied', sequence: 2 }
      ],
      taskSuccess: false
    }) })
    expect(result.passed).toBe(true)
    expect(result.expectedFailureHandling).toBe('passed')
    expect(result.failures).toEqual([])
  })

  it('accepts an independent package oracle for artifact/state correctness', () => {
    const parsed = evalCaseSchema.parse({
      ...evalCase({}),
      semanticsVersion: 'semantics-v2',
      taskType: 'end_to_end',
      evaluationDimensions: ['artifact_state_correctness']
    })
    const result = evaluateCase(parsed, { trace: trace({
      finalState: { approvalDenied: true, sideEffectFree: true },
      finalStateSource: 'inspector',
      evidenceStatus: 'complete',
      evidence: ['Package-owned state oracle verified the denied action was side-effect free.'],
      verifiedActionIds: ['paper-radar.search'],
      verifiedDimensions: ['artifact_state_correctness']
    }) })
    expect(result.dimensionResults?.artifact_state_correctness).toMatchObject({ status: 'PASS', score: 1 })
    expect(result.outcome).toBe('PASS')
  })

  it('does not infer artifact/state correctness from inspector evidence alone', () => {
    const parsed = evalCaseSchema.parse({
      ...evalCase({}),
      semanticsVersion: 'semantics-v2',
      taskType: 'end_to_end',
      evaluationDimensions: ['artifact_state_correctness']
    })
    const result = evaluateCase(parsed, { trace: trace({
      finalState: { approvalDenied: true, sideEffectFree: true },
      finalStateSource: 'inspector',
      evidenceStatus: 'complete',
      evidence: ['The inspector returned a state snapshot.'],
      verifiedActionIds: ['paper-radar.search']
    }) })
    expect(result.dimensionResults?.artifact_state_correctness).toMatchObject({ status: 'INCONCLUSIVE', score: 0 })
    expect(result.dimensionResults?.artifact_state_correctness?.failures).toEqual([
      expect.objectContaining({ type: 'trace_unsupported' })
    ])
  })

  it('does not let a package dimension claim bypass a concrete artifact contract', () => {
    const parsed = evalCaseSchema.parse({
      ...evalCase({}),
      semanticsVersion: 'semantics-v2',
      taskType: 'end_to_end',
      evaluationDimensions: ['artifact_state_correctness'],
      expectedFinalState: {
        assertions: [],
        artifacts: [{ path: 'result.json', exists: true }],
        dataLineage: []
      }
    })
    const result = evaluateCase(parsed, { trace: trace({
      finalState: { sideEffectFree: true },
      finalStateSource: 'inspector',
      evidenceStatus: 'complete',
      evidence: ['The package oracle declared the dimension verified.'],
      verifiedActionIds: ['paper-radar.search'],
      verifiedDimensions: ['artifact_state_correctness']
    }) })
    expect(result.dimensionResults?.artifact_state_correctness).toMatchObject({ status: 'FAIL', score: 0 })
    expect(result.dimensionResults?.artifact_state_correctness?.failures).toEqual([
      expect.objectContaining({ type: 'final_state_mismatch' })
    ])
  })

  it('accepts a resolved confirmation for an allow expectation', () => {
    const parsed = evalCase({ authorization: { 'paper-radar.search': 'allow' } })
    const invocation = {
      actionId: 'paper-radar.search', args: {}, success: true,
      retryCount: 0, latencyMs: 1, logicalInvocationId: 'call-1',
      authorizationSequence: 4
    }
    const result = evaluateCase(parsed, { trace: trace({
      selectedActions: [invocation], invocations: [invocation], authorizationEvents: [
        { actionId: 'paper-radar.search', status: 'requested', sequence: 2 },
        { actionId: 'paper-radar.search', status: 'allowed', sequence: 3 }
      ]
    }) })
    expect(result.scores.authorization).toBe(1)
    expect(result.failures).toEqual([])
  })

  it('recognizes a provider failure recovered within one logical invocation', () => {
    const parsed = evalCaseSchema.parse({
      id: 'retry-recovery',
      query: 'Recover the provider call',
      expected: { requiredActions: [], allowedActions: [] },
      expectedFailure: {
        actionId: 'paper-radar.search', errorCode: 'timeout', handling: 'recovered'
      }
    })
    const result = evaluateExpectedFailure(parsed, trace({
      invocations: [{
        actionId: 'paper-radar.search', args: {}, success: true,
        providerAttempts: [
          { attempt: 1, success: false, errorCode: 'timeout', latencyMs: 10 },
          { attempt: 2, success: true, latencyMs: 10 }
        ],
        retryCount: 1, latencyMs: 20
      }]
    }))
    expect(result.score).toBe(1)
    expect(result.failures).toEqual([])
  })

  it('treats acceptable actions as equivalent selection evidence in semantics-v2', () => {
    const parsed = evalCaseSchema.parse({
      id: 'intent-routing-acceptable',
      query: 'Find the relevant papers',
      semanticsVersion: 'semantics-v2',
      taskType: 'routing',
      evaluationDimensions: ['action_selection'],
      expected: {
        expectedActions: ['paper-radar.search'],
        acceptableActions: ['paper-radar.rank']
      }
    })
    const result = evaluateCase(parsed, { trace: trace({
      discoveredActions: ['paper-radar.rank'],
      selectedActions: [{ ...trace().selectedActions[0]!, actionId: 'paper-radar.rank' }],
      invocations: [{ ...trace().invocations[0]!, actionId: 'paper-radar.rank' }]
    }) })
    expect(result.passed).toBe(true)
    expect(result.dimensionResults?.action_selection?.status).toBe('PASS')
    expect(result.expected.expectedActions).toEqual(['paper-radar.search'])
    expect(result.expected.acceptableActions).toEqual(['paper-radar.rank'])
  })

  it('scores routing against the first task-directed action instead of a later correction', () => {
    const parsed = evalCaseSchema.parse({
      id: 'intent-routing-first-action',
      query: 'Find the relevant papers',
      semanticsVersion: 'semantics-v2',
      taskType: 'routing',
      evaluationDimensions: ['action_selection', 'arguments', 'invocation'],
      expected: {
        expectedActions: ['paper-radar.search'],
        invocation: { 'paper-radar.search': { success: true } },
        arguments: { 'paper-radar.search': { required: ['query'] } }
      }
    })
    const firstWrong = { ...trace().invocations[0]!, actionId: 'paper-radar.rank', success: false }
    const laterCorrect = { ...trace().invocations[0]!, actionId: 'paper-radar.search', success: true }
    const result = evaluateCase(parsed, { trace: trace({
      selectedActions: [firstWrong, laterCorrect],
      invocations: [firstWrong, laterCorrect]
    }) })
    expect(result.passed).toBe(false)
    expect(result.failures.map((item) => item.type)).toEqual(expect.arrayContaining([
      'wrong_action',
      'invocation_missing',
      'argument_mismatch'
    ]))
  })

  it('checks later invocations for explicit routing policy constraints', () => {
    const parsed = evalCaseSchema.parse({
      id: 'intent-routing-policy-after-selection',
      query: 'Find the relevant papers without synchronizing sources',
      semanticsVersion: 'semantics-v2',
      taskType: 'routing',
      evaluationDimensions: ['action_selection'],
      expected: {
        expectedActions: ['paper-radar.search'],
        requiredActions: ['paper-radar.search'],
        forbiddenActions: ['paper-radar.sync-arxiv']
      }
    })
    const selected = trace().invocations[0]!
    const forbidden = { ...selected, actionId: 'paper-radar.sync-arxiv', success: false }
    const result = evaluateCase(parsed, { trace: trace({
      selectedActions: [selected, forbidden],
      invocations: [selected, forbidden]
    }) })
    expect(result.failures.map((item) => item.type)).toContain('forbidden_action')
    expect(result.failures.map((item) => item.type)).not.toContain('wrong_action')
  })

  it('keeps E2E preferred-action misses diagnostic when the task succeeds', () => {
    const parsed = evalCaseSchema.parse({
      id: 'intent-e2e-alternative-path',
      query: 'Complete the research task',
      semanticsVersion: 'semantics-v2',
      taskType: 'end_to_end',
      evaluationDimensions: ['action_selection', 'task_completion', 'result_correctness'],
      expected: { expectedActions: ['paper-radar.search'], taskSuccess: true },
      expectedFinalState: { assertions: [{ path: 'answer', operator: 'exists' }] }
    })
    const result = evaluateCase(parsed, { trace: trace({
      selectedActions: [{ ...trace().selectedActions[0]!, actionId: 'paper-radar.rank' }],
      invocations: [{ ...trace().invocations[0]!, actionId: 'paper-radar.rank' }],
      finalState: { answer: 'completed' },
      taskSuccess: true
    }) })
    expect(result.passed).toBe(true)
    expect(result.outcome).toBe('PASS')
    expect(result.diagnostics?.map((item) => item.type)).toContain('wrong_action')
    expect(result.failures).toEqual([])
  })

  it('reports undeclared dimensions as N/A instead of a passing score', () => {
    const parsed = evalCaseSchema.parse({
      id: 'intent-na-dimensions',
      query: 'Use the selected capability',
      semanticsVersion: 'semantics-v2',
      taskType: 'routing',
      evaluationDimensions: ['action_selection'],
      expected: { expectedActions: ['paper-radar.search'] }
    })
    const result = evaluateCase(parsed, { trace: trace() })
    expect(result.dimensionResults?.action_selection?.status).toBe('PASS')
    expect(result.dimensionResults?.arguments?.status).toBe('N/A')
    expect(result.dimensionResults?.task_completion?.status).toBe('N/A')
  })

  it('evaluates no-tool behavior without requiring a capability call', () => {
    const parsed = evalCaseSchema.parse({
      id: 'intent-no-tool',
      query: 'What is the boiling point of water?',
      semanticsVersion: 'semantics-v2',
      taskType: 'routing',
      evaluationDimensions: ['behavior'],
      expectedBehavior: 'no_tool',
      expected: {}
    })
    const result = evaluateCase(parsed, { trace: trace({
      discoveredActions: [],
      selectedActions: [],
      invocations: [],
      toolCalls: 0,
      taskSuccess: undefined
    }) })
    expect(result.passed).toBe(true)
    expect(result.expectedBehavior).toBe('no_tool')
    expect(result.dimensionResults?.behavior?.status).toBe('PASS')
  })

  it('requires an explicit observed behavior when clarification cannot be inferred', () => {
    const parsed = evalCaseSchema.parse({
      id: 'intent-clarify',
      query: 'Run the analysis',
      semanticsVersion: 'semantics-v2',
      taskType: 'routing',
      evaluationDimensions: ['behavior'],
      expectedBehavior: 'clarify',
      expected: {}
    })
    const result = evaluateCase(parsed, { trace: trace({
      discoveredActions: [], selectedActions: [], invocations: [], toolCalls: 0, taskSuccess: undefined
    }) })
    expect(result.passed).toBe(false)
    expect(result.failures.map((item) => item.type)).toContain('trace_unsupported')
  })
})
