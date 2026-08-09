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

  it('allows one retry, then denies argument and token variants before execution', () => {
    const governor = new ExecutionGovernorCore()
    const stableMetadata = {
      objective: 'inspect-current-surface',
      resourceIdentity: 'surface:thread-1'
    }
    const first = attempt('executor', {
      operation: 'inspect',
      strategy: 'primary',
      token: 'token_a'
    }, stableMetadata)
    const retry = attempt('executor', {
      operation: 'inspect',
      strategy: 'alternate',
      token: 'token_b'
    }, stableMetadata)
    const laterVariant = attempt('executor', {
      operation: 'inspect',
      prompt: 'try with different wording',
      token: 'token_c'
    }, stableMetadata)

    expect(normalizeExecutionAttempt(first).semanticFingerprint)
      .not.toBe(normalizeExecutionAttempt(retry).semanticFingerprint)
    expect(normalizeExecutionAttempt(first).objective)
      .toBe(normalizeExecutionAttempt(retry).objective)
    expect(governor.inspectAttempt(first).action).toBe('allow')
    const retryDecision = governor.recordReceipt(first.callId, {
      status: 'error',
      outcome: 'retryable_error',
      retryable: true,
      exitCode: 7,
      errorCode: 'executor_rejected',
      failureClass: 'invalid_arguments',
      recoveryGuidance: 'Refresh the canonical surface binding.',
      providerStage: 'vision_translation',
      detail: 'input could not be processed'
    }).decision
    expect(retryDecision).toMatchObject({
      action: 'steer',
      code: 'semantic_failure_retry',
      guidance: expect.stringMatching(/one available retry.*executor_rejected/u)
    })
    expect(retryDecision.guidance).toContain('Refresh the canonical surface binding.')
    expect(retryDecision.guidance).not.toContain('input could not be processed')

    expect(governor.inspectAttempt(retry).action).toBe('allow')
    const exhausted = governor.recordReceipt(retry.callId, {
      status: 'error',
      outcome: 'retryable_error',
      retryable: true,
      errorCode: 'executor_rejected',
      failureClass: 'invalid_arguments',
      providerStage: 'text_reasoning'
    }).decision
    expect(exhausted).toMatchObject({
      action: 'deny',
      code: 'semantic_failure_exhausted'
    })
    expect(exhausted.reason).toContain('exhausted its one retry')
    expect(exhausted.reason).toContain('No retries remain')
    expect(exhausted.reason).not.toContain('One retry is available')
    expect(exhausted.guidance).toContain('retry budget is exhausted')
    expect(exhausted.guidance).toContain('Refresh the canonical surface binding.')
    expect(exhausted.guidance).not.toContain('one available retry')

    const deniedVariant = governor.inspectAttempt(laterVariant)
    expect(deniedVariant).toMatchObject({
      action: 'deny',
      code: 'semantic_failure_exhausted',
      reason: exhausted.reason,
      guidance: exhausted.guidance
    })
  })

  it('opens a circuit and steers once for a non-retryable semantic failure', () => {
    const governor = new ExecutionGovernorCore()
    const metadata = {
      objective: 'inspect-current-surface',
      resourceIdentity: 'surface:thread-1'
    }
    const first = attempt('sciforge_look', {
      sourceRef: 'source_token_a',
      task: 'Inspect the surface.'
    }, { metadata })
    const variant = attempt('sciforge_look', {
      sourceRef: 'source_token_b',
      task: 'Please inspect the same surface another way.'
    }, { metadata })

    expect(governor.inspectAttempt(first).action).toBe('allow')
    const failed = governor.recordReceipt(first.callId, {
      status: 'error',
      outcome: 'retryable_error',
      retryable: false,
      errorCode: 'visual_layout_owner_changed',
      failureClass: 'layout_unavailable',
      recoveryGuidance: 'Return to the bound task before requesting visual evidence.'
    }).decision
    expect(failed).toMatchObject({
      action: 'steer',
      code: 'semantic_failure_stop'
    })
    expect(failed.guidance).toContain('Do not retry')
    expect(failed.guidance).toContain('Report the blocker')
    expect(governor.inspectAttempt(variant)).toMatchObject({
      action: 'deny',
      code: 'semantic_failure_exhausted',
      guidance: failed.guidance
    })
  })

  it('exhausts the retry when its receipt explicitly reports no evidence or state change', () => {
    const governor = new ExecutionGovernorCore()
    const first = attempt('executor', { operation: 'inspect', token: 'first' })
    const retry = attempt('executor', { operation: 'inspect', token: 'second' })

    governor.inspectAttempt(first)
    expect(governor.recordReceipt(first.callId, {
      status: 'error',
      outcome: 'retryable_error',
      retryable: true,
      errorCode: 'temporary_failure'
    }).decision.action).toBe('steer')
    expect(governor.inspectAttempt(retry).action).toBe('allow')
    expect(governor.recordReceipt(retry.callId, {
      status: 'success',
      outcome: 'progress',
      evidenceDelta: false,
      stateChanged: false,
      output: { unchanged: true }
    }).decision).toMatchObject({
      action: 'deny',
      code: 'semantic_failure_exhausted'
    })
    expect(governor.inspectAttempt(
      attempt('executor', { operation: 'inspect', token: 'third' })
    )).toMatchObject({ action: 'deny', code: 'semantic_failure_exhausted' })
  })

  it('keeps distinct read ranges valid when one range has a non-retryable failure', () => {
    const governor = new ExecutionGovernorCore({ workspace: '/tmp/workspace' })
    const failedRange = attempt('read', {
      path: 'paper.md',
      offset: 1,
      limit: 20
    })
    const nextRange = attempt('read', {
      path: './paper.md',
      offset: 21,
      limit: 20
    })

    expect(governor.inspectAttempt(failedRange).action).toBe('allow')
    expect(governor.recordReceipt(failedRange.callId, {
      status: 'error',
      outcome: 'retryable_error',
      retryable: false,
      errorCode: 'range_unavailable'
    }).decision).toMatchObject({
      action: 'steer',
      code: 'semantic_failure_stop'
    })
    expect(governor.inspectAttempt(nextRange).action).toBe('allow')
  })

  it('unwraps shell -lc commands and scopes read ranges and searches independently', () => {
    const firstRange = normalizeExecutionAttempt(attempt('exec_command', {
      cmd: `/bin/zsh -lc "sed -n '295,320p' /tmp/paper.txt && echo ====="`
    }, {
      toolKind: 'command_execution',
      metadata: { cwd: '/tmp/workspace' }
    }))
    const secondRange = normalizeExecutionAttempt(attempt('exec_command', {
      cmd: `/bin/zsh -lc "sed -n '700,730p' /tmp/paper.txt && echo =====SECTION====="`
    }, {
      toolKind: 'command_execution',
      metadata: { cwd: '/tmp/workspace' }
    }))
    const search = normalizeExecutionAttempt(attempt('exec_command', {
      cmd: `/bin/zsh -lc 'rg -n "DeepScaleR|AIME" /tmp/paper.txt | head -40'`
    }, {
      toolKind: 'command_execution',
      metadata: { cwd: '/tmp/workspace' }
    }))

    expect(firstRange).toMatchObject({
      family: 'command_execution:shell/read-file',
      objective: 'command_execution:shell/read-file:range:295:320',
      resourceIdentity: 'path:/tmp/paper.txt'
    })
    expect(secondRange).toMatchObject({
      family: 'command_execution:shell/read-file',
      objective: 'command_execution:shell/read-file:range:700:730',
      resourceIdentity: 'path:/tmp/paper.txt'
    })
    expect(search).toMatchObject({
      family: 'command_execution:shell/search',
      resourceIdentity: 'path:/tmp/paper.txt'
    })
    expect(search.objective).toMatch(/^command_execution:shell\/search:query:[a-f0-9]{16}$/u)
  })

  it('treats substantive partial output from a failed command as new evidence', () => {
    const governor = new ExecutionGovernorCore()
    const call = attempt('exec_command', {
      cmd: `/bin/zsh -lc "sed -n '1,20p' /tmp/paper.txt && echo ====="`
    }, { toolKind: 'command_execution' })

    expect(governor.inspectAttempt(call).action).toBe('allow')
    expect(governor.recordReceipt(call.callId, {
      status: 'error',
      outcome: 'retryable_error',
      exitCode: 1,
      output: 'Experimental setup\nModels and training details\nzsh:1: ==== not found'
    })).toMatchObject({
      evidenceGained: true,
      duplicateResult: false,
      receipt: { evidenceDelta: true },
      decision: { action: 'allow' }
    })
  })

  it('settles a parallel recovery batch before exhausting its retry circuit', () => {
    const governor = new ExecutionGovernorCore()
    const first = attempt('executor', { operation: 'inspect', strategy: 'primary' })
    const failedRecovery = attempt('executor', { operation: 'inspect', strategy: 'range' })
    const successfulRecovery = attempt('executor', { operation: 'inspect', strategy: 'search' })

    governor.inspectAttempt(first)
    expect(governor.recordReceipt(first.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    }).decision).toMatchObject({ action: 'steer', code: 'semantic_failure_retry' })

    expect(governor.inspectAttempt(failedRecovery).action).toBe('allow')
    expect(governor.inspectAttempt(successfulRecovery).action).toBe('allow')
    expect(governor.recordReceipt(failedRecovery.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    }).decision.action).toBe('allow')
    expect(governor.recordReceipt(successfulRecovery.callId, {
      status: 'success',
      outcome: 'progress',
      output: { matches: ['new evidence'] }
    }).decision.action).toBe('allow')
    expect(governor.inspectAttempt(
      attempt('executor', { operation: 'inspect', strategy: 'after-recovery' })
    ).action).toBe('allow')
  })

  it('does not exhaust on late failures dispatched before the recovery steer', () => {
    const governor = new ExecutionGovernorCore()
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
    }).decision).toMatchObject({ action: 'steer', code: 'semantic_failure_retry' })
    expect(governor.recordReceipt(dispatched[1]!.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    }).decision.action).toBe('allow')
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
    const governor = new ExecutionGovernorCore()
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
    }).decision).toMatchObject({ action: 'deny', code: 'semantic_failure_exhausted' })

    governor.reset()
    expect(governor.recordReceipt(first.callId, {
      status: 'error',
      outcome: 'fatal_error',
      errorCode: 'policy_violation'
    }).decision).toMatchObject({ action: 'deny', code: 'fatal_error' })
  })

  it('tracks interleaved objectives independently', () => {
    const governor = new ExecutionGovernorCore()
    const a1 = attempt('executor', { operation: 'a', strategy: 'first' })
    const a2 = attempt('executor', { operation: 'a', strategy: 'second' })
    const b1 = attempt('executor', { operation: 'b', strategy: 'first' })
    const b2 = attempt('executor', { operation: 'b', strategy: 'second' })

    for (const call of [a1, b1]) {
      expect(governor.inspectAttempt(call).action).toBe('allow')
      expect(governor.recordReceipt(call.callId, {
        status: 'error',
        outcome: 'retryable_error',
        errorCode: 'operation_failed'
      }).decision).toMatchObject({ action: 'steer', code: 'semantic_failure_retry' })
    }
    expect(governor.inspectAttempt(a2).action).toBe('allow')
    expect(governor.inspectAttempt(b2).action).toBe('allow')
    expect(governor.recordReceipt(a2.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'operation_failed'
    }).decision).toMatchObject({ action: 'deny', code: 'semantic_failure_exhausted' })
    expect(governor.recordReceipt(b2.callId, {
      status: 'success',
      outcome: 'progress',
      evidenceDelta: true,
      output: { recovered: true }
    }).decision.action).toBe('allow')

    expect(governor.inspectAttempt(
      attempt('executor', { operation: 'a', strategy: 'third' })
    )).toMatchObject({ action: 'deny', code: 'semantic_failure_exhausted' })
    expect(governor.inspectAttempt(
      attempt('executor', { operation: 'b', strategy: 'third' })
    ).action).toBe('allow')
  })

  it('clears a circuit when a recovery action adds evidence for the resource', () => {
    const governor = new ExecutionGovernorCore()
    const resourceIdentity = 'resource:document-1'
    const failed = attempt('sciforge_look', {
      sourceRef: 'source_token_a'
    }, {
      metadata: {
        objective: 'inspect-document',
        resourceIdentity
      }
    })
    expect(governor.inspectAttempt(failed).action).toBe('allow')
    expect(governor.recordReceipt(failed.callId, {
      status: 'error',
      outcome: 'retryable_error',
      retryable: false,
      errorCode: 'visual_layout_refresh_timeout',
      failureClass: 'layout_unavailable'
    }).decision).toMatchObject({
      action: 'steer',
      code: 'semantic_failure_stop'
    })

    const refresh = attempt('sciforge_observe', {
      resourceRef: 'resource_token_b'
    }, {
      metadata: {
        objective: 'refresh-document',
        resourceIdentity
      }
    })
    expect(governor.inspectAttempt(refresh).action).toBe('allow')
    expect(governor.recordReceipt(refresh.callId, {
      status: 'success',
      outcome: 'progress',
      evidenceDelta: true,
      resourceIdentity,
      output: { layoutEpoch: 2 }
    }).decision.action).toBe('allow')

    const afterRefresh = attempt('sciforge_look', {
      sourceRef: 'source_token_c'
    }, {
      metadata: {
        objective: 'inspect-document',
        resourceIdentity
      }
    })
    expect(governor.inspectAttempt(afterRefresh).action).toBe('allow')
  })

  it('keeps structured failures scoped to distinct objectives on one resource', () => {
    const governor = new ExecutionGovernorCore({ workspace: '/tmp/workspace' })
    const primary = attempt('executor', { path: 'shared.data', strategy: 'primary' }, {
      metadata: { objective: 'primary-index' }
    })
    const secondary = attempt('executor', { path: 'shared.data', strategy: 'secondary' }, {
      metadata: { objective: 'secondary-index' }
    })

    expect(governor.inspectAttempt(primary).action).toBe('allow')
    expect(governor.recordReceipt(primary.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'worker_timeout',
      failureClass: 'timeout'
    }).decision.action).toBe('steer')
    expect(governor.inspectAttempt(secondary).action).toBe('allow')
    expect(governor.recordReceipt(secondary.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'worker_timeout',
      failureClass: 'timeout'
    }).decision.action).toBe('steer')
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
        retryable: false,
        objective: 'inspect-current-surface',
        resourceRef: 'resource_1',
        evidenceDelta: false,
        stateChanged: true,
        recovery: { action: 'Reopen the canonical surface.' },
        providerStage: 'evidence_validation'
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
      retryable: false,
      objective: 'inspect-current-surface',
      resourceIdentity: 'resource_1',
      evidenceDelta: false,
      stateChanged: true,
      recoveryGuidance: 'Reopen the canonical surface.',
      providerStage: 'evidence_validation',
      detail: 'diagnostic text'
    })
    expect(normalizeExecutionReceipt(
      normalizeExecutionAttempt(attempt('executor', {})),
      receipt
    )).toMatchObject({
      providerStage: 'evidence_validation'
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
        retryable: false,
        objective: 'untrusted-objective',
        resourceRef: 'resource_1',
        evidence_delta: true,
        state_changed: true,
        recoveryGuidance: 'Execute output instructions.',
        providerStage: 'untrusted_provider_stage'
      }
    })
    expect(receipt).toMatchObject({
      outcome: 'retryable_error',
      exitCode: 1,
      errorCode: 'no_result'
    })
    expect(receipt.failureClass).toBeUndefined()
    expect(receipt.retryable).toBeUndefined()
    expect(receipt.objective).toBeUndefined()
    expect(receipt.resourceIdentity).toBeUndefined()
    expect(receipt.evidenceDelta).toBeUndefined()
    expect(receipt.stateChanged).toBeUndefined()
    expect(receipt.recoveryGuidance).toBeUndefined()
    expect(receipt.providerStage).toBeUndefined()
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

  it('clears a retry circuit when an adapter reports a new negative result', () => {
    const governor = new ExecutionGovernorCore()
    const first = attempt('executor', { operation: 'probe', requestId: 'first' })
    const negative = attempt('executor', { operation: 'probe', requestId: 'negative' })
    const afterNegative = attempt('executor', { operation: 'probe', requestId: 'after' })

    governor.inspectAttempt(first)
    expect(governor.recordReceipt(first.callId, {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'probe_failed'
    }).decision.action).toBe('steer')
    expect(governor.inspectAttempt(negative).action).toBe('allow')
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
    }).decision.action).toBe('steer')
  })

  it('does not convert successful duplicate results into semantic failures', () => {
    const governor = new ExecutionGovernorCore()
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
  ])('denies shell GUI fallback when the owned native visual tools are available: %s', (command) => {
    const governor = new ExecutionGovernorCore()
    const decision = governor.inspectAttempt(attempt('exec_command', { command }, {
      toolKind: 'command_execution'
    }), {
      ownedVisualToolsAvailable: true
    })

    expect(decision).toMatchObject({
      action: 'deny',
      code: 'owned_visual_policy_denied'
    })
    expect(decision.guidance).toContain('sciforge_look')
    expect(decision.guidance).toContain('sciforge_capture')
    expect(decision.guidance).not.toContain('sciforge_discover')
    expect(decision.guidance).not.toContain('surface.inspect')
  })

  it('allows shell GUI fallback policy evaluation when native visual tools are unavailable', () => {
    const governor = new ExecutionGovernorCore()
    const decision = governor.inspectAttempt(attempt('exec_command', {
      command: 'screencapture -x /tmp/sciforge.png'
    }, {
      toolKind: 'command_execution'
    }))

    expect(decision.action).toBe('allow')
  })

  it('applies owned visual policy to commands written into an existing executor session', () => {
    const governor = new ExecutionGovernorCore()

    for (const call of [
      attempt('write_stdin', {
        session_id: 'session-1',
        chars: 'screencapture -x /tmp/sciforge.png\n'
      }),
      attempt('Bash', {
        action: 'write',
        session_id: 'session-1',
        chars: 'screencapture -x /tmp/sciforge.png\n'
      })
    ]) {
      expect(governor.inspectAttempt(call, {
        ownedVisualToolsAvailable: true
      })).toMatchObject({
        action: 'deny',
        code: 'owned_visual_policy_denied',
        attempt: {
          family: 'command_execution:os-gui-automation',
          toolKind: 'command_execution'
        }
      })
    }
  })

  it('classifies native look as a read and native capture as a mutating local-write family', () => {
    const look = normalizeExecutionAttempt(attempt('sciforge_look', {
      sourceRef: 'artifact_12345678901234567890',
      task: 'Inspect this image.'
    }))
    const capture = normalizeExecutionAttempt(attempt('sciforge_capture', {
      snapshotRef: 'snapshot_12345678901234567890',
      regionRef: 'region_12345678901234567890',
      purpose: 'workspace-asset'
    }))

    expect(look).toMatchObject({
      family: 'tool_call:visual.look',
      resourceIdentity: 'visual:artifact_12345678901234567890',
      mutating: false
    })
    expect(capture).toMatchObject({
      family: 'tool_call:visual.capture',
      resourceIdentity: 'visual:region_12345678901234567890',
      mutating: true
    })

    expect(normalizeExecutionReceipt(capture, {
      status: 'success',
      outcome: 'progress'
    })).toMatchObject({
      family: 'tool_call:visual.capture',
      stateChanged: true
    })
  })

  it('allows only the native look and capture tools through the pending visual proof path', () => {
    const governor = new ExecutionGovernorCore()
    const context = { nativeVisualProofChainPending: true }
    const look = attempt('sciforge_look', {
      sourceRef: 'artifact_12345678901234567890',
      task: 'Inspect this visual.'
    })
    const capture = attempt('sciforge_capture', {
      snapshotRef: 'snapshot_12345678901234567890',
      purpose: 'workspace-asset'
    })

    expect(governor.inspectAttempt(look, context)).toMatchObject({
      action: 'allow',
      attempt: {
        family: 'tool_call:visual.look',
        mutating: false
      }
    })
    expect(governor.inspectAttempt(capture, context)).toMatchObject({
      action: 'allow',
      attempt: {
        family: 'tool_call:visual.capture',
        mutating: true
      }
    })
  })

  it.each(['view_image', 'functions.view_image', 'ViewImage'])(
    'rejects %s while the native visual proof chain is pending',
    (toolName) => {
      const governor = new ExecutionGovernorCore()
      const decision = governor.inspectAttempt(attempt(toolName, {
        path: '/tmp/unattested.png'
      }), {
        nativeVisualProofChainPending: true
      })

      expect(decision).toMatchObject({
        action: 'deny',
        code: 'native_visual_proof_chain_required',
        reason: expect.stringContaining('native visual proof chain')
      })
      expect(decision.guidance).toContain('sciforge_look')
      expect(decision.guidance).toContain('sciforge_capture')
      expect(decision.guidance).toContain('view_image')
    }
  )

  it.each([
    { toolName: 'exec_command', command: 'file .sciforge/visual-assets/figure.png' },
    { toolName: 'local_shell', command: 'python3 inspect_pixels.py' }
  ])(
    'rejects command execution as a pending visual proof bypass: $toolName',
    ({ toolName, command }) => {
      const governor = new ExecutionGovernorCore()
      const decision = governor.inspectAttempt(attempt(toolName, {
        command
      }, {
        toolKind: 'command_execution'
      }), {
        nativeVisualProofChainPending: true
      })

      expect(decision).toMatchObject({
        action: 'deny',
        code: 'native_visual_proof_chain_required',
        attempt: { toolKind: 'command_execution' }
      })
      expect(decision.guidance).toContain('typed native visual proofs')
    }
  )

  it('routes existing executor session controls through the pending visual governor', () => {
    const governor = new ExecutionGovernorCore()
    const context = { nativeVisualProofChainPending: true }

    for (const call of [
      attempt('Bash', {
        action: 'write',
        session_id: 'session-1',
        chars: 'python3 inspect_pixels.py\n'
      }),
      attempt('Bash', {
        action: 'poll',
        session_id: 'session-1'
      }),
      attempt('write_stdin', {
        session_id: 'session-1',
        chars: 'python3 inspect_pixels.py\n'
      }),
      attempt('functions.write_stdin', {
        session_id: 'session-1'
      })
    ]) {
      expect(governor.inspectAttempt(call, context)).toMatchObject({
        action: 'deny',
        code: 'native_visual_proof_chain_required',
        attempt: { toolKind: 'command_execution' }
      })
    }

    expect(governor.inspectAttempt(attempt('Bash', {
      action: 'stop',
      session_id: 'session-1'
    }), context)).toMatchObject({
      action: 'allow',
      attempt: { toolKind: 'command_execution' }
    })
  })

  it('preserves ordinary view_image and command execution behavior without a pending proof chain', () => {
    const governor = new ExecutionGovernorCore()

    expect(governor.inspectAttempt(attempt('view_image', {
      path: '/tmp/reference.png'
    })).action).toBe('allow')
    expect(governor.inspectAttempt(attempt('exec_command', {
      command: 'node --version'
    }, {
      toolKind: 'command_execution'
    })).action).toBe('allow')
    expect(governor.inspectAttempt(attempt('write_stdin', {
      session_id: 'session-1',
      chars: 'echo continue\n'
    }))).toMatchObject({
      action: 'allow',
      attempt: { toolKind: 'command_execution' }
    })
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
