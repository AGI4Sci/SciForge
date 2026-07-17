import { describe, expect, it } from 'vitest'
import {
  ExecutionGovernorCore,
  normalizeExecutionAttempt,
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

  it('escalates broker failures across opaque invocation variants', () => {
    const governor = new ExecutionGovernorCore({ semanticFailureThreshold: 2 })
    const first = attempt('sciforge_invoke', {
      operationRef: 'op_surface_12345678901234567890',
      resourceRef: 'res_pdf_comments_12345678901234567890',
      requestId: 'request_a'
    })
    const second = attempt('sciforge_invoke', {
      operationRef: 'op_surface_12345678901234567890',
      resourceRef: 'res_pdf_comments_12345678901234567890',
      requestId: 'request_b'
    })
    const third = attempt('sciforge_invoke', {
      operationRef: 'op_surface_12345678901234567890',
      resourceRef: 'res_pdf_comments_12345678901234567890',
      requestId: 'request_c'
    })

    expect(normalizeExecutionAttempt(first).semanticFingerprint)
      .toBe(normalizeExecutionAttempt(second).semanticFingerprint)
    expect(governor.inspectAttempt(first).action).toBe('allow')
    expect(governor.recordReceipt(first.callId, {
      status: 'error',
      output: { error: { code: 'unknown_resource_ref' } }
    }).decision.action).toBe('allow')
    expect(governor.inspectAttempt(second).action).toBe('allow')
    expect(governor.recordReceipt(second.callId, {
      status: 'error',
      output: { error: { code: 'unknown_resource_ref' } }
    }).decision).toMatchObject({ action: 'steer', code: 'semantic_failure_retry' })
    expect(governor.inspectAttempt(third)).toMatchObject({
      action: 'deny',
      code: 'semantic_failure_exhausted'
    })
  })

  it('does not combine distinct structured patch errors into one failure streak', () => {
    const governor = new ExecutionGovernorCore({
      semanticFailureThreshold: 2,
      workspace: '/tmp/workspace'
    })
    const multiFile = attempt('gui_workspace_apply_patch', {
      path: 'paper/report.tex',
      patch: 'multi-file patch'
    })
    const invalidFormat = attempt('gui_workspace_apply_patch', {
      path: 'paper/report.tex',
      patch: 'invalid-format patch'
    })
    const staleContext = attempt('gui_workspace_apply_patch', {
      path: 'paper/report.tex',
      patch: 'stale-context patch'
    })
    const staleContextRetry = attempt('gui_workspace_apply_patch', {
      path: 'paper/report.tex',
      patch: 'smaller stale-context patch'
    })
    const afterRepeatedStaleContext = attempt('gui_workspace_apply_patch', {
      path: 'paper/report.tex',
      patch: 'latest-context patch'
    })

    expect(governor.inspectAttempt(multiFile).action).toBe('allow')
    expect(governor.recordReceipt(multiFile.callId, {
      status: 'error',
      errorCode: 'patch_multiple_files',
      failureClass: 'invalid_arguments'
    }).decision.action).toBe('allow')

    expect(governor.inspectAttempt(invalidFormat).action).toBe('allow')
    expect(governor.recordReceipt(invalidFormat.callId, {
      status: 'error',
      errorCode: 'patch_invalid_format',
      failureClass: 'invalid_arguments'
    }).decision.action).toBe('allow')

    expect(governor.inspectAttempt(staleContext).action).toBe('allow')
    expect(governor.recordReceipt(staleContext.callId, {
      status: 'error',
      errorCode: 'patch_context_mismatch',
      failureClass: 'stale_resource'
    }).decision.action).toBe('allow')

    expect(governor.inspectAttempt(staleContextRetry).action).toBe('allow')
    expect(governor.recordReceipt(staleContextRetry.callId, {
      status: 'error',
      errorCode: 'patch_context_mismatch',
      failureClass: 'stale_resource'
    }).decision).toMatchObject({
      action: 'steer',
      code: 'semantic_failure_retry',
      guidance: expect.stringContaining('Re-read the exact target file')
    })

    expect(governor.inspectAttempt(afterRepeatedStaleContext)).toMatchObject({
      action: 'deny',
      code: 'semantic_failure_exhausted',
      reason: expect.stringContaining('patch_context_mismatch')
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
      output: { content: 'page one', start_line: 1, end_line: 10 }
    }).evidenceGained).toBe(true)
    expect(governor.inspectAttempt(second).action).toBe('allow')
    expect(governor.recordReceipt(second.callId, {
      status: 'success',
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
        output: { image: 'same-trusted-frame' }
      }).decision.action).toBe('allow')
    }
  })

  it('records successful receipts without output as non-crashing evidence', () => {
    const governor = new ExecutionGovernorCore()
    const call = attempt('executor', {})

    expect(governor.inspectAttempt(call).action).toBe('allow')
    expect(governor.recordReceipt(call.callId, { status: 'success' })).toMatchObject({
      evidenceGained: true,
      duplicateResult: false,
      receipt: { status: 'success' }
    })
  })
})
