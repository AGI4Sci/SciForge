import { describe, expect, it, vi } from 'vitest'
import type {
  AgentRuntimeCapabilities,
  AgentRuntimeExecutionReceipt,
  AgentRuntimeEvent
} from '../../../shared/agent-runtime-contract'
import type { RuntimeGuardSettingsV1 } from '../../../shared/app-settings'
import { RuntimeGovernanceSupervisor } from './governance'

const baseCapabilities = {
  runtimeId: 'codex',
  guard: { execution: 'observe' }
} as AgentRuntimeCapabilities

const strictBudgetSettings: RuntimeGuardSettingsV1 = {
  execution: {
    enabled: true,
    windowSize: 8,
    exactRepeatThreshold: 3,
    semanticFailureThreshold: 2
  }
}

const recoverySettings: RuntimeGuardSettingsV1 = {
  execution: {
    ...strictBudgetSettings.execution,
    exactRepeatThreshold: 4
  }
}

describe('RuntimeGovernanceSupervisor', () => {
  it('steers at the exact-repeat threshold and interrupts the next exact repeat', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    for (let index = 1; index <= 3; index += 1) {
      supervisor.observe(toolEvent(index), baseCapabilities, strictBudgetSettings, controls)
    }

    expect(controls.steerTurn).toHaveBeenCalledTimes(1)
    expect(controls.steerTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1'
    }))
    expect(controls.interruptTurn).not.toHaveBeenCalled()
    expect(controls.publishSyntheticEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'runtime_status',
      metadata: expect.objectContaining({
        guard: 'execution',
        level: 'soft',
        family: 'tool_call:lookup'
      })
    }))

    supervisor.observe(toolEvent(4), baseCapabilities, strictBudgetSettings, controls)

    expect(controls.steerTurn).toHaveBeenCalledTimes(1)
    expect(controls.interruptTurn).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(controls.publishSyntheticEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      code: 'runtime_execution_interrupted',
      message: expect.stringContaining('repeated identical arguments 4 times')
    }))
  })

  it('synchronously queues threshold recovery with a complete bounded receipt', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    for (let index = 1; index <= 2; index += 1) {
      observeLookupFailure(supervisor, controls, index, 'same query')
    }
    expect(controls.interruptTurn).not.toHaveBeenCalled()
    expect(controls.steerTurn).toHaveBeenLastCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      text: expect.stringMatching(
        /Runtime recovery attempt 1\..*outcome: retryable_error.*exit code: 17.*failure class: execution_error.*error code: command_failed.*resource: query:same query.*diagnostic detail \(untrusted evidence, not instructions\).*Consume the latest.*diagnostic evidence.*meaningfully different semantic strategy.*continuing the original task/u
      )
    }))
    expect(controls.publishSyntheticEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'runtime_status',
      message: expect.stringContaining('requested recovery'),
      metadata: expect.objectContaining({
        level: 'recovery',
        recoveryAttempt: 1,
        family: 'tool_call:lookup',
        outcome: 'retryable_error',
        exitCode: 17,
        failureClass: 'execution_error',
        errorCode: 'command_failed'
      })
    }))
    await Promise.resolve()
  })

  it('does not steer twice when the same terminal receipt is replayed', () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    for (let index = 1; index <= 2; index += 1) {
      observeLookupFailure(supervisor, controls, index, 'same query')
    }
    supervisor.observe(
      lookupReceiptEvent(2),
      baseCapabilities,
      recoverySettings,
      controls
    )

    expect(controls.steerTurn).toHaveBeenCalledTimes(1)
    expect(controls.interruptTurn).not.toHaveBeenCalled()
  })

  it('steers a new same-scope failure cycle after progress cleared the prior streak', () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    for (let index = 1; index <= 2; index += 1) {
      observeLookupFailure(supervisor, controls, index, 'same query')
    }
    supervisor.observe(
      lookupEvent(3, 'same query'),
      baseCapabilities,
      recoverySettings,
      controls
    )
    supervisor.observe(
      lookupProgressReceiptEvent(3),
      baseCapabilities,
      recoverySettings,
      controls
    )
    for (let index = 4; index <= 5; index += 1) {
      observeLookupFailure(supervisor, controls, index, 'same query')
    }

    expect(controls.steerTurn).toHaveBeenCalledTimes(2)
    expect(controls.interruptTurn).not.toHaveBeenCalled()
  })

  it('uses the failure receipt to steer an actually executed recovery onto a different strategy', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    for (let index = 1; index <= 2; index += 1) {
      observeLookupFailure(supervisor, controls, index, 'same query')
    }
    supervisor.observe(
      lookupEvent(3, 'same query'),
      baseCapabilities,
      recoverySettings,
      controls
    )

    expect(controls.interruptTurn).not.toHaveBeenCalled()

    supervisor.observe(
      lookupReceiptEvent(3),
      baseCapabilities,
      recoverySettings,
      controls
    )
    await Promise.resolve()

    expect(controls.interruptTurn).not.toHaveBeenCalled()
    expect(controls.steerTurn).toHaveBeenCalledTimes(2)
    expect(controls.steerTurn).toHaveBeenLastCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      text: expect.stringMatching(
        /Runtime recovery attempt 2\..*diagnostic detail.*lookup command failed.*Abandon the failed semantic operation.*different capability, tool family, or evidence path.*continue the original task/u
      )
    }))
    expect(controls.publishSyntheticEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'runtime_status',
      metadata: expect.objectContaining({
        level: 'recovery',
        recoveryAttempt: 2,
        errorCode: 'command_failed'
      })
    }))
  })

  it('does not count a late pre-steer receipt as a failed recovery action', () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    for (let index = 1; index <= 3; index += 1) {
      supervisor.observe(
        lookupEvent(index, 'same query'),
        baseCapabilities,
        recoverySettings,
        controls
      )
    }
    supervisor.observe(
      lookupReceiptEvent(1),
      baseCapabilities,
      recoverySettings,
      controls
    )
    supervisor.observe(
      lookupReceiptEvent(2),
      baseCapabilities,
      recoverySettings,
      controls
    )

    expect(controls.steerTurn).toHaveBeenCalledTimes(1)
    expect(controls.interruptTurn).not.toHaveBeenCalled()

    supervisor.observe(
      lookupReceiptEvent(3),
      baseCapabilities,
      recoverySettings,
      controls
    )

    expect(controls.steerTurn).toHaveBeenCalledTimes(1)
    expect(controls.interruptTurn).not.toHaveBeenCalled()

    supervisor.observe(
      lookupEvent(4, 'same query'),
      baseCapabilities,
      recoverySettings,
      controls
    )
    supervisor.observe(
      lookupReceiptEvent(4),
      baseCapabilities,
      recoverySettings,
      controls
    )

    expect(controls.steerTurn).toHaveBeenCalledTimes(2)
    expect(controls.interruptTurn).not.toHaveBeenCalled()
  })

  it('interrupts only after the structured semantic recovery budget is exhausted', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()
    const semanticOnlySettings: RuntimeGuardSettingsV1 = {
      execution: {
        ...recoverySettings.execution,
        exactRepeatThreshold: 99
      }
    }

    for (let index = 1; index <= 5; index += 1) {
      supervisor.observe(
        lookupEvent(index, 'same query'),
        baseCapabilities,
        semanticOnlySettings,
        controls
      )
      supervisor.observe(
        lookupReceiptEvent(index),
        baseCapabilities,
        semanticOnlySettings,
        controls
      )
    }
    await Promise.resolve()

    expect(controls.steerTurn).toHaveBeenCalledTimes(3)
    const recoveryInputs = controls.steerTurn.mock.calls as unknown as Array<[{ text: string }]>
    expect(recoveryInputs.map(([input]) => input.text)).toEqual([
      expect.stringContaining('Runtime recovery attempt 1.'),
      expect.stringContaining('Runtime recovery attempt 2.'),
      expect.stringContaining('Runtime recovery attempt 3.')
    ])
    expect(controls.interruptTurn).toHaveBeenCalledTimes(1)
    expect(controls.publishSyntheticEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      code: 'runtime_execution_interrupted'
    }))
  })

  it('allows a semantically different recovery action after steering', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    for (let index = 1; index <= 2; index += 1) {
      observeLookupFailure(supervisor, controls, index, 'same query')
    }
    const steeringCount = controls.steerTurn.mock.calls.length

    supervisor.observe(
      lookupEvent(3, 'different query'),
      baseCapabilities,
      recoverySettings,
      controls
    )
    supervisor.observe(
      lookupReceiptEvent(3),
      baseCapabilities,
      recoverySettings,
      controls
    )

    expect(controls.steerTurn).toHaveBeenCalledTimes(steeringCount)
    expect(controls.interruptTurn).not.toHaveBeenCalled()
  })

  it('consumes the canonical receipt and ignores conflicting metadata', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    observeLookupFailure(supervisor, controls, 1, 'same query')
    supervisor.observe(
      lookupEvent(2, 'same query'),
      baseCapabilities,
      recoverySettings,
      controls
    )
    supervisor.observe(
      lookupReceiptEvent(2, {
        outcome: 'negative_result',
        exitCode: 1
      }),
      baseCapabilities,
      recoverySettings,
      controls
    )
    observeLookupFailure(supervisor, controls, 3, 'same query')

    expect(controls.steerTurn).not.toHaveBeenCalled()
    expect(controls.interruptTurn).not.toHaveBeenCalled()
  })

  it('interrupts an explicit fatal receipt and preserves its diagnostic metadata', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    supervisor.observe(
      lookupEvent(1, 'fatal query'),
      baseCapabilities,
      recoverySettings,
      controls
    )
    supervisor.observe(
      lookupReceiptEvent(1, {
        outcome: 'fatal_error',
        exitCode: 126,
        failureClass: 'permission_denied'
      }),
      baseCapabilities,
      recoverySettings,
      controls
    )
    await Promise.resolve()

    expect(controls.steerTurn).not.toHaveBeenCalled()
    expect(controls.interruptTurn).toHaveBeenCalled()
    expect(controls.publishSyntheticEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'runtime_status',
      metadata: expect.objectContaining({
        level: 'hard',
        code: 'fatal_error',
        outcome: 'fatal_error',
        exitCode: 126,
        failureClass: 'permission_denied'
      })
    }))
  })

  it('steers history-only shell arguments immediately without waiting for the storm threshold', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    supervisor.observe(historyPlaceholderEvent(1), baseCapabilities, strictBudgetSettings, controls)
    await Promise.resolve()

    expect(controls.steerTurn).toHaveBeenCalledTimes(1)
    expect(controls.steerTurn).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('compressed history metadata, not an executable action')
    }))
    expect(controls.publishSyntheticEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'runtime_status',
      metadata: expect.objectContaining({
        guard: 'toolArgumentHygiene',
        level: 'recovery',
        recoveryAttempt: 1,
        family: 'command_execution:shell/history-placeholder'
      })
    }))
    expect(controls.interruptTurn).not.toHaveBeenCalled()
  })

  it('interrupts a history-only argument after targeted recovery is ignored twice', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    for (let index = 1; index <= 3; index += 1) {
      supervisor.observe(historyPlaceholderEvent(index), baseCapabilities, strictBudgetSettings, controls)
    }
    await Promise.resolve()

    expect(controls.steerTurn).toHaveBeenCalledTimes(2)
    expect(controls.interruptTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      discard: false
    }))
    expect(controls.publishSyntheticEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      code: 'runtime_history_hygiene_replay'
    }))
  })

  it('escalates structured broker failures across opaque argument variants', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    for (let index = 1; index <= 2; index += 1) {
      supervisor.observe(capabilityInvokeEvent(index), baseCapabilities, strictBudgetSettings, controls)
      supervisor.observe(capabilityInvokeReceipt(index), baseCapabilities, strictBudgetSettings, controls)
    }
    await Promise.resolve()

    expect(controls.steerTurn).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringMatching(
        /outcome: retryable_error.*failure class: stale_resource.*unknown_resource_ref.*untrusted evidence.*meaningfully different semantic strategy/u
      )
    }))

    supervisor.observe(capabilityInvokeEvent(3), baseCapabilities, strictBudgetSettings, controls)
    expect(controls.interruptTurn).not.toHaveBeenCalled()

    supervisor.observe(capabilityInvokeReceipt(3), baseCapabilities, strictBudgetSettings, controls)
    await Promise.resolve()
    expect(controls.interruptTurn).not.toHaveBeenCalled()
    expect(controls.steerTurn).toHaveBeenCalledTimes(2)
    expect(controls.steerTurn).toHaveBeenLastCalledWith(expect.objectContaining({
      text: expect.stringMatching(
        /unknown_resource_ref.*Abandon the failed semantic operation.*different capability, tool family, or evidence path/u
      )
    }))
  })

  it('denies OS GUI automation when the native visual tools are available', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = {
      ...controlsSpy(),
      ownedVisualToolsAvailable: true
    }

    supervisor.observe(shellGuiFallbackEvent(), baseCapabilities, strictBudgetSettings, controls)
    await Promise.resolve()

    expect(controls.interruptTurn).toHaveBeenCalled()
    expect(controls.publishSyntheticEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      code: 'runtime_execution_policy_denied',
      detail: expect.stringContaining('sciforge_look')
    }))
    expect(controls.publishSyntheticEvent).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.stringContaining('sciforge_capture')
    }))
    const published = controls.publishSyntheticEvent.mock.calls
      .map(([event]) => event)
      .find((event) => event.kind === 'error' && event.code === 'runtime_execution_policy_denied')
    expect(published?.kind === 'error' ? published.detail : undefined).not.toContain('sciforge_discover')
    expect(published?.kind === 'error' ? published.detail : undefined).not.toContain('surface.inspect')
  })

  it('does not infer native visual availability from broker capability descriptors', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    supervisor.observe(shellGuiFallbackEvent(), {
      ...baseCapabilities,
      capabilityDescriptors: [{
        id: 'ui.visibleContext',
        channel: 'host_service',
        available: true
      }]
    }, strictBudgetSettings, controls)
    await Promise.resolve()

    expect(controls.interruptTurn).not.toHaveBeenCalled()
    expect(controls.publishSyntheticEvent).not.toHaveBeenCalled()
  })
})

function controlsSpy(governanceProfile?: 'remote_guard') {
  return {
    governanceProfile,
    steerTurn: vi.fn(async () => undefined),
    interruptTurn: vi.fn(async () => undefined),
    publishSyntheticEvent: vi.fn(async (event: AgentRuntimeEvent) => event)
  }
}

function toolEvent(index: number): AgentRuntimeEvent {
  return {
    kind: 'tool_event',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: `tool-${index}`,
    status: 'running',
    toolKind: 'tool_call',
    summary: 'lookup',
    detail: 'workspace read timed out',
    errorCode: 'tool_timeout',
    meta: {
      toolName: 'lookup',
      callId: `call-${index}`,
      arguments: { query: 'q' }
    }
  }
}

function lookupEvent(index: number, query: string): AgentRuntimeEvent {
  return {
    kind: 'tool_event',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: `tool-${index}`,
    status: 'running',
    toolKind: 'tool_call',
    summary: 'lookup',
    detail: 'lookup running',
    meta: {
      toolName: 'lookup',
      callId: `call-${index}`,
      arguments: {
        query,
        requestId: `request-${index}`
      }
    }
  }
}

function lookupReceiptEvent(
  index: number,
  overrides: Partial<Omit<AgentRuntimeExecutionReceipt, 'status'>> = {}
): AgentRuntimeEvent {
  return {
    kind: 'tool_event',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: `tool-${index}`,
    status: 'error',
    toolKind: 'tool_call',
    summary: 'lookup',
    detail: 'lookup command failed; retry the exact same call',
    errorCode: 'command_failed',
    receipt: {
      status: 'error',
      outcome: 'retryable_error',
      exitCode: 17,
      errorCode: 'command_failed',
      failureClass: 'execution_error',
      resourceIdentity: 'query:same query',
      detail: 'lookup command failed; retry the exact same call',
      ...overrides
    },
    meta: {
      toolName: 'lookup',
      callId: `call-${index}`,
      outcome: 'fatal_error',
      exitCode: 255,
      failureClass: 'misleading_metadata',
      resourceIdentity: 'ignored:metadata'
    }
  }
}

function lookupProgressReceiptEvent(index: number): AgentRuntimeEvent {
  return {
    kind: 'tool_event',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: `tool-${index}`,
    status: 'success',
    toolKind: 'tool_call',
    summary: 'lookup',
    detail: 'lookup completed with new evidence',
    receipt: {
      status: 'success',
      outcome: 'progress',
      output: { result: 'new evidence' },
      evidenceDelta: true,
      detail: 'lookup completed with new evidence'
    },
    meta: {
      toolName: 'lookup',
      callId: `call-${index}`
    }
  }
}

function observeLookupFailure(
  supervisor: RuntimeGovernanceSupervisor,
  controls: ReturnType<typeof controlsSpy>,
  index: number,
  query: string
): void {
  supervisor.observe(lookupEvent(index, query), baseCapabilities, recoverySettings, controls)
  supervisor.observe(lookupReceiptEvent(index), baseCapabilities, recoverySettings, controls)
}

function historyPlaceholderEvent(index: number): AgentRuntimeEvent {
  const command =
    'false # sciforge history metadata only; prior shell command omitted; do not execute or reuse; create a fresh smaller command'
  return {
    kind: 'tool_event',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: `history-tool-${index}`,
    status: 'running',
    toolKind: 'command_execution',
    summary: command,
    detail: `/bin/zsh -lc '${command}'`,
    meta: {
      toolName: 'local_shell',
      callId: `history-call-${index}`,
      command: '/bin/zsh',
      arguments: {
        cmd: '/bin/zsh',
        args: ['-lc', command],
        max_output_tokens: index * 100
      }
    }
  }
}

function capabilityInvokeEvent(
  index: number
): Extract<Extract<AgentRuntimeEvent, { kind: 'tool_event' }>, { status: 'running' }> {
  return {
    kind: 'tool_event',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: `invoke-${index}`,
    status: 'running',
    toolKind: 'tool_call',
    toolName: 'sciforge_invoke',
    meta: {
      callId: `invoke-${index}`,
      toolName: 'sciforge_invoke',
      arguments: {
        operationRef: 'op_surface_12345678901234567890',
        resourceRef: 'res_surface_12345678901234567890',
        invocationId: `invocation-${index}`
      }
    }
  }
}

function capabilityInvokeReceipt(
  index: number
): Extract<AgentRuntimeEvent, { kind: 'tool_event' }> {
  return {
    ...capabilityInvokeEvent(index),
    status: 'error',
    errorCode: 'unknown_resource_ref',
    detail: 'The opaque resource reference is no longer known.',
    receipt: {
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'unknown_resource_ref',
      failureClass: 'stale_resource',
      resourceIdentity: 'res_surface_12345678901234567890',
      output: { error: { code: 'unknown_resource_ref' } },
      detail: 'The opaque resource reference is no longer known.'
    },
    meta: {
      ...capabilityInvokeEvent(index).meta,
      errorCode: 'unknown_resource_ref',
      failureClass: 'stale_resource',
      outcome: 'retryable_error',
      resourceIdentity: 'res_surface_12345678901234567890',
      structuredContent: {
        error: { code: 'unknown_resource_ref' }
      }
    }
  }
}

function shellGuiFallbackEvent(): Extract<AgentRuntimeEvent, { kind: 'tool_event' }> {
  return {
    kind: 'tool_event',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'shell-gui-fallback',
    status: 'running',
    toolKind: 'command_execution',
    toolName: 'exec_command',
    meta: {
      callId: 'shell-gui-fallback',
      toolName: 'exec_command',
      arguments: { command: 'screencapture -x /tmp/sciforge.png' }
    }
  }
}
