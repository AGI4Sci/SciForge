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
})
