import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  ExecutionGovernorCore,
  createExecutionReceipt,
  executionOutcomeFromValue,
  normalizeExecutionAttempt,
  normalizeExecutionReceipt,
  type ExecutionAttemptInput
} from './index.js'

let sequence = 0

function attempt(
  toolName: string,
  argumentsValue: Record<string, unknown>,
  overrides: Partial<ExecutionAttemptInput> = {}
): ExecutionAttemptInput {
  return {
    callId: `call_${sequence += 1}`,
    toolName,
    arguments: argumentsValue,
    ...overrides
  }
}

describe('ExecutionGovernorCore', () => {
  it('steers the third exact repeat and denies the fourth', () => {
    const governor = new ExecutionGovernorCore()

    expect(governor.inspectAttempt(attempt('echo', { value: 'same' })).action).toBe('allow')
    expect(governor.inspectAttempt(attempt('echo', { value: 'same' })).action).toBe('allow')
    expect(governor.inspectAttempt(attempt('echo', { value: 'same' }))).toMatchObject({
      action: 'steer',
      code: 'exact_repeat'
    })
    expect(governor.inspectAttempt(attempt('echo', { value: 'same' }))).toMatchObject({
      action: 'deny',
      code: 'exact_repeat'
    })
  })

  it('steers at the retry threshold and denies only after the next actual failure receipt', () => {
    const governor = new ExecutionGovernorCore({ semanticFailureThreshold: 2 })
    const first = attempt('executor', { operation: 'inspect', requestId: 'request_a' })
    const second = attempt('executor', { operation: 'inspect', requestId: 'request_b' })
    const third = attempt('executor', { operation: 'inspect', requestId: 'request_c' })

    expect(normalizeExecutionAttempt(first).semanticFingerprint)
      .toBe(normalizeExecutionAttempt(second).semanticFingerprint)
    expect(governor.inspectAttempt(first).action).toBe('allow')
    expect(governor.recordReceipt(first.callId, {
      status: 'error',
      outcome: 'retryable_error',
      exitCode: 7,
      errorCode: 'executor_rejected',
      detail: 'input could not be processed'
    }).decision.action).toBe('allow')
    expect(governor.inspectAttempt(second).action).toBe('allow')
    const retryDecision = governor.recordReceipt(second.callId, {
      status: 'error',
      outcome: 'retryable_error',
      exitCode: 7,
      errorCode: 'executor_rejected',
      detail: 'input could not be processed'
    }).decision
    expect(retryDecision).toMatchObject({
      action: 'steer',
      code: 'semantic_failure_retry',
      guidance: expect.stringMatching(/outcome=retryable_error.*exitCode=7.*different semantic strategy/u)
    })
    expect(retryDecision.guidance).not.toContain('input could not be processed')
    expect(governor.inspectAttempt(third).action).toBe('allow')
    expect(governor.recordReceipt(third.callId, {
      status: 'error',
      outcome: 'retryable_error',
      exitCode: 7,
      errorCode: 'executor_rejected'
    }).decision).toMatchObject({ action: 'deny', code: 'semantic_failure_exhausted' })
  })

  it('does not exhaust on late failures dispatched before the recovery steer', () => {
    const governor = new ExecutionGovernorCore({ semanticFailureThreshold: 2 })
    const dispatched = ['first', 'second', 'third'].map((requestId) => attempt('executor', {
      operation: 'inspect',
      requestId
    }))
    for (const call of dispatched) {
      expect(governor.inspectAttempt(call).action).toBe('allow')
    }

    expect(governor.recordReceipt(dispatched[0]!.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    }).decision.action).toBe('allow')
    expect(governor.recordReceipt(dispatched[1]!.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    }).decision).toMatchObject({ action: 'steer', code: 'semantic_failure_retry' })
    expect(governor.recordReceipt(dispatched[2]!.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    }).decision.action).toBe('allow')

    const recovery = attempt('executor', { operation: 'inspect', requestId: 'recovery' })
    expect(governor.inspectAttempt(recovery).action).toBe('allow')
    expect(governor.recordReceipt(recovery.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    }).decision).toMatchObject({ action: 'deny', code: 'semantic_failure_exhausted' })
  })

  it('deduplicates replayed terminal receipts by call id', () => {
    const governor = new ExecutionGovernorCore({ semanticFailureThreshold: 2 })
    const first = attempt('executor', { operation: 'inspect', requestId: 'first' })
    const second = attempt('executor', { operation: 'inspect', requestId: 'second' })

    governor.inspectAttempt(first)
    const firstResult = governor.recordReceipt(first.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    })
    expect(governor.recordReceipt(first.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    })).toBe(firstResult)
    governor.inspectAttempt(second)
    expect(governor.recordReceipt(second.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    }).decision).toMatchObject({ action: 'steer', code: 'semantic_failure_retry' })

    governor.reset()
    expect(governor.recordReceipt(first.callId, {
      status: 'error',
      outcome: 'fatal_error',
      errorCode: 'policy_violation'
    }).decision).toMatchObject({ action: 'deny', code: 'fatal_error' })
  })

  it('tracks interleaved semantic failure scopes independently', () => {
    const governor = new ExecutionGovernorCore({ semanticFailureThreshold: 2 })
    const a1 = attempt('executor', { operation: 'a', requestId: 'a1' })
    const a2 = attempt('executor', { operation: 'a', requestId: 'a2' })
    const a3 = attempt('executor', { operation: 'a', requestId: 'a3' })
    const b1 = attempt('executor', { operation: 'b', requestId: 'b1' })
    const b2 = attempt('executor', { operation: 'b', requestId: 'b2' })
    const b3 = attempt('executor', { operation: 'b', requestId: 'b3' })

    for (const call of [a1, a2, a3, b1, b2, b3]) {
      expect(governor.inspectAttempt(call).action).toBe('allow')
    }
    expect(governor.recordReceipt(b1.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    }).decision.action).toBe('allow')
    expect(governor.recordReceipt(a1.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    }).decision.action).toBe('allow')
    expect(governor.recordReceipt(b2.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    }).decision).toMatchObject({ action: 'steer', code: 'semantic_failure_retry' })
    expect(governor.recordReceipt(a2.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    }).decision).toMatchObject({ action: 'steer', code: 'semantic_failure_retry' })
    expect(governor.recordReceipt(b3.callId, {
      status: 'success',
      outcome: 'progress',
      output: { recovered: true }
    }).decision.action).toBe('allow')
    expect(governor.recordReceipt(a3.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    }).decision.action).toBe('allow')

    const a4 = attempt('executor', { operation: 'a', requestId: 'a4' })
    expect(governor.inspectAttempt(a4).action).toBe('allow')
    expect(governor.recordReceipt(a4.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    }).decision).toMatchObject({ action: 'deny', code: 'semantic_failure_exhausted' })
  })

  it('allows a semantically different recovery action after steering', () => {
    const governor = new ExecutionGovernorCore({ semanticFailureThreshold: 2 })
    const first = attempt('executor', { strategy: 'primary', requestId: 'request_a' })
    const second = attempt('executor', { strategy: 'primary', requestId: 'request_b' })
    const recovery = attempt('executor', { strategy: 'alternate', requestId: 'request_c' })

    for (const call of [first, second]) {
      expect(governor.inspectAttempt(call).action).toBe('allow')
      governor.recordReceipt(call.callId, {
        status: 'error',
        outcome: 'retryable_error',
        failureClass: 'execution_error',
        errorCode: 'operation_failed'
      })
    }
    expect(governor.inspectAttempt(recovery).action).toBe('allow')
    expect(governor.recordReceipt(recovery.callId, {
      status: 'error',
      outcome: 'retryable_error',
      failureClass: 'execution_error',
      errorCode: 'operation_failed'
    }).decision.action).toBe('allow')
  })

  it('keeps structured failures scoped to each semantic strategy', () => {
    const governor = new ExecutionGovernorCore({
      semanticFailureThreshold: 2,
      workspace: '/tmp/workspace'
    })
    const primary = attempt('executor', { path: 'shared.data', strategy: 'primary' })
    const secondary = attempt('executor', { path: 'shared.data', strategy: 'secondary' })
    const primaryRetry = attempt('executor', {
      path: 'shared.data',
      strategy: 'primary',
      requestId: 'retry'
    })

    expect(governor.inspectAttempt(primary).action).toBe('allow')
    expect(governor.recordReceipt(primary.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'worker_timeout',
      failureClass: 'timeout'
    }).decision.action).toBe('allow')
    expect(governor.inspectAttempt(secondary).action).toBe('allow')
    expect(governor.recordReceipt(secondary.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'worker_timeout',
      failureClass: 'timeout'
    }).decision.action).toBe('allow')
    expect(governor.inspectAttempt(primaryRetry).action).toBe('allow')
    expect(governor.recordReceipt(primaryRetry.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'worker_timeout',
      failureClass: 'timeout'
    }).decision).toMatchObject({ action: 'steer', code: 'semantic_failure_retry' })
  })

  it('keeps explicit no-evidence failures scoped to the semantic action', () => {
    const governor = new ExecutionGovernorCore({ semanticFailureThreshold: 2 })
    const firstStrategy = attempt('executor', { strategy: 'first' })
    const secondStrategy = attempt('executor', { strategy: 'second' })
    const secondRetry = attempt('executor', { strategy: 'second', requestId: 'retry' })

    expect(governor.inspectAttempt(firstStrategy).action).toBe('allow')
    expect(governor.recordReceipt(firstStrategy.callId, {
      status: 'success',
      outcome: 'retryable_error',
      failureClass: 'no_evidence_delta'
    }).decision.action).toBe('allow')
    expect(governor.inspectAttempt(secondStrategy).action).toBe('allow')
    expect(governor.recordReceipt(secondStrategy.callId, {
      status: 'success',
      outcome: 'retryable_error',
      failureClass: 'no_evidence_delta'
    }).decision.action).toBe('allow')
    expect(governor.inspectAttempt(secondRetry).action).toBe('allow')
    expect(governor.recordReceipt(secondRetry.callId, {
      status: 'success',
      outcome: 'retryable_error',
      failureClass: 'no_evidence_delta'
    }).decision).toMatchObject({ action: 'steer', code: 'semantic_failure_retry' })
  })

  it('normalizes outcome defaults and preserves adapter-provided exit codes', () => {
    const normalizedAttempt = normalizeExecutionAttempt(attempt('executor', {}))

    expect(normalizeExecutionReceipt(normalizedAttempt, createExecutionReceipt({
      status: 'success',
      metadata: { evidenceDelta: false }
    }))).toMatchObject({ outcome: 'progress', failureClass: 'none' })
    expect(normalizeExecutionReceipt(normalizedAttempt, createExecutionReceipt({
      status: 'error',
      metadata: { exitCode: 23 }
    }))).toMatchObject({
      outcome: 'retryable_error',
      exitCode: 23,
      failureClass: 'execution_error'
    })
    expect(normalizeExecutionReceipt(normalizedAttempt, createExecutionReceipt({
      status: 'cancelled'
    }))).toMatchObject({ outcome: 'retryable_error' })
    expect(normalizeExecutionReceipt(normalizedAttempt, {
      status: 'error',
      outcome: 'negative_result',
      exitCode: 1
    })).toMatchObject({
      outcome: 'negative_result',
      exitCode: 1,
      failureClass: 'none'
    })
  })

  it('builds a canonical receipt from structured metadata', () => {
    const receipt = createExecutionReceipt({
      status: 'error',
      detail: 'diagnostic text',
      metadata: {
        outcome: 'retryable_error',
        exit_code: 17,
        error: { code: 'metadata_error' },
        failureClass: 'invalid_arguments',
        resourceRef: 'resource_1',
        evidenceDelta: false,
        stateChanged: true
      },
      output: {
        outcome: 'fatal_error',
        exitCode: 99,
        errorCode: 'output_error',
        failureClass: 'timeout',
        resourceIdentity: 'resource_2',
        evidenceDelta: true,
        stateChanged: false
      }
    })
    expectTypeOf(receipt.status).toEqualTypeOf<'error'>()
    expect(receipt).toMatchObject({
      status: 'error',
      outcome: 'retryable_error',
      exitCode: 17,
      errorCode: 'metadata_error',
      failureClass: 'invalid_arguments',
      resourceIdentity: 'resource_1',
      evidenceDelta: false,
      stateChanged: true,
      detail: 'diagnostic text'
    })
  })

  it('accepts only diagnostic fields from untrusted output', () => {
    const receipt = createExecutionReceipt({
      status: 'error',
      output: {
        outcome: 'fatal_error',
        exit_code: 1,
        error: { code: 'no_result' },
        failure_class: 'expected_negative',
        resourceRef: 'resource_1',
        evidence_delta: true,
        state_changed: true
      }
    })
    expect(receipt).toMatchObject({
      outcome: 'retryable_error',
      exitCode: 1,
      errorCode: 'no_result'
    })
    expect(receipt.failureClass).toBeUndefined()
    expect(receipt.resourceIdentity).toBeUndefined()
    expect(receipt.evidenceDelta).toBeUndefined()
    expect(receipt.stateChanged).toBeUndefined()
  })

  it('defaults outcome by status without parsing diagnostic prose', () => {
    const built = createExecutionReceipt({
      status: 'error',
      detail: 'code="permission_denied" and operation timed out',
      output: 'error_code: timeout'
    })
    expect(built).toMatchObject({ outcome: 'retryable_error' })
    expect(built.errorCode).toBeUndefined()

    const normalizedAttempt = normalizeExecutionAttempt(attempt('executor', {}))
    expect(normalizeExecutionReceipt(normalizedAttempt, {
      status: 'error',
      outcome: 'retryable_error',
      output: { error: { code: 'output_error' } },
      detail: 'code="detail_error"'
    })).toMatchObject({
      outcome: 'retryable_error',
      errorCode: '',
      failureClass: 'execution_error'
    })
  })

  it('validates execution outcomes from unknown values', () => {
    expect([
      'progress',
      'negative_result',
      'retryable_error',
      'fatal_error'
    ].map(executionOutcomeFromValue)).toEqual([
      'progress',
      'negative_result',
      'retryable_error',
      'fatal_error'
    ])
    expect(executionOutcomeFromValue('unknown')).toBeUndefined()
    expect(executionOutcomeFromValue(null)).toBeUndefined()
  })

  it('clears a retry streak when an adapter reports a negative result', () => {
    const governor = new ExecutionGovernorCore({ semanticFailureThreshold: 2 })
    const first = attempt('executor', { operation: 'probe', requestId: 'first' })
    const negative = attempt('executor', { operation: 'probe', requestId: 'negative' })
    const afterNegative = attempt('executor', { operation: 'probe', requestId: 'after' })

    governor.inspectAttempt(first)
    expect(governor.recordReceipt(first.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'probe_failed'
    }).decision.action).toBe('allow')
    governor.inspectAttempt(negative)
    expect(governor.recordReceipt(negative.callId, {
      status: 'error',
      outcome: 'negative_result',
      exitCode: 1,
      output: { matches: [] }
    })).toMatchObject({
      evidenceGained: true,
      receipt: { outcome: 'negative_result', exitCode: 1 },
      decision: { action: 'allow' }
    })
    governor.inspectAttempt(afterNegative)
    expect(governor.recordReceipt(afterNegative.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'probe_failed'
    }).decision.action).toBe('allow')
  })

  it('does not convert successful duplicate results into semantic failures', () => {
    const governor = new ExecutionGovernorCore({ semanticFailureThreshold: 2 })
    const first = attempt('executor', { operation: 'observe', requestId: 'first' })
    const second = attempt('executor', { operation: 'observe', requestId: 'second' })

    governor.inspectAttempt(first)
    expect(governor.recordReceipt(first.callId, {
      status: 'success',
      outcome: 'progress',
      output: { value: 'unchanged' }
    })).toMatchObject({ evidenceGained: true, decision: { action: 'allow' } })
    governor.inspectAttempt(second)
    expect(governor.recordReceipt(second.callId, {
      status: 'success',
      outcome: 'progress',
      output: { value: 'unchanged' }
    })).toMatchObject({
      evidenceGained: false,
      duplicateResult: true,
      receipt: { outcome: 'progress', evidenceDelta: false },
      decision: { action: 'allow' }
    })
  })

  it('allows repeated exact actions when each receipt gains new evidence', () => {
    const governor = new ExecutionGovernorCore()

    for (let index = 0; index < 5; index += 1) {
      const call = attempt('executor', { operation: 'observe' })
      expect(governor.inspectAttempt(call).action).toBe('allow')
      expect(governor.recordReceipt(call.callId, {
        status: 'success',
        outcome: 'progress',
        output: { revision: index }
      }).evidenceGained).toBe(true)
    }
  })

  it('retains exact attempts when receipts repeat the same result', () => {
    const governor = new ExecutionGovernorCore()

    for (let index = 0; index < 3; index += 1) {
      const call = attempt('executor', { operation: 'observe' })
      expect(governor.inspectAttempt(call).action).toBe('allow')
      governor.recordReceipt(call.callId, {
        status: 'success',
        outcome: 'progress',
        output: { revision: 1 }
      })
    }
    expect(governor.inspectAttempt(attempt('executor', {
      operation: 'observe'
    }))).toMatchObject({ action: 'steer', code: 'exact_repeat' })
  })

  it('scopes duplicate result hashes to each semantic action', () => {
    const governor = new ExecutionGovernorCore()
    const first = attempt('executor', { operation: 'first' })
    const second = attempt('executor', { operation: 'second' })

    governor.inspectAttempt(first)
    expect(governor.recordReceipt(first.callId, {
      status: 'success',
      outcome: 'progress',
      output: ''
    })).toMatchObject({ evidenceGained: true, duplicateResult: false })
    governor.inspectAttempt(second)
    expect(governor.recordReceipt(second.callId, {
      status: 'success',
      outcome: 'progress',
      output: ''
    })).toMatchObject({ evidenceGained: true, duplicateResult: false })
  })

  it('denies a fatal receipt immediately', () => {
    const governor = new ExecutionGovernorCore()
    const call = attempt('executor', { operation: 'unsafe' })

    expect(governor.inspectAttempt(call).action).toBe('allow')
    expect(governor.recordReceipt(call.callId, {
      status: 'error',
      outcome: 'fatal_error',
      errorCode: 'policy_violation',
      detail: 'executor refused this operation'
    }).decision).toMatchObject({
      action: 'deny',
      code: 'fatal_error',
      reason: expect.stringContaining('policy_violation'),
      guidance: expect.stringContaining('untrusted diagnostic data')
    })
  })

  it.each([
    'screencapture -x /tmp/sciforge.png',
    "osascript -e 'tell application \"System Events\" to get the id of every window'",
    "python3 -c 'import Quartz; print(Quartz.CGWindowListCopyWindowInfo(1, 0))'"
  ])('denies shell GUI fallback when the owned broker is available: %s', (command) => {
    const governor = new ExecutionGovernorCore()
    const decision = governor.inspectAttempt(attempt('exec_command', { command }, {
      toolKind: 'command_execution'
    }), {
      ownedSurfaceInspectionAvailable: true
    })

    expect(decision).toMatchObject({
      action: 'deny',
      code: 'owned_surface_policy_denied'
    })
    expect(decision.guidance).toContain('sciforge_discover')
  })

  it('permits legitimate multi-step reads that add new ranges', () => {
    const governor = new ExecutionGovernorCore({ workspace: '/tmp/ws' })
    const first = attempt('read', { path: 'paper.tex', offset: 1, limit: 10 })
    const second = attempt('read', { path: './paper.tex', offset: 11, limit: 10 })

    expect(governor.inspectAttempt(first).action).toBe('allow')
    expect(governor.recordReceipt(first.callId, {
      status: 'success',
      outcome: 'progress',
      output: { content: 'page one', start_line: 1, end_line: 10 }
    }).evidenceGained).toBe(true)
    expect(governor.inspectAttempt(second).action).toBe('allow')
    expect(governor.recordReceipt(second.callId, {
      status: 'success',
      outcome: 'progress',
      output: { content: 'page two', start_line: 11, end_line: 20 }
    }).decision.action).toBe('allow')
  })

  it('does not suppress trusted computer-use screenshots', () => {
    const governor = new ExecutionGovernorCore()
    for (let index = 0; index < 5; index += 1) {
      const screenshot = attempt('computer_use', { action: 'screenshot' }, {
        metadata: { server: 'gui_owl_computer_use' }
      })
      expect(governor.inspectAttempt(screenshot).action).toBe('allow')
      expect(governor.recordReceipt(screenshot.callId, {
        status: 'success',
        outcome: 'progress',
        output: { image: 'same-trusted-frame' }
      }).decision.action).toBe('allow')
    }
  })

  it('records successful receipts without output as non-crashing evidence', () => {
    const governor = new ExecutionGovernorCore()
    const call = attempt('executor', {})

    expect(governor.inspectAttempt(call).action).toBe('allow')
    expect(governor.recordReceipt(call.callId, {
      status: 'success',
      outcome: 'progress'
    })).toMatchObject({
      evidenceGained: true,
      duplicateResult: false,
      receipt: { status: 'success' }
    })
  })
})
