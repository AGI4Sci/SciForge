import { describe, expect, it, vi } from 'vitest'
import type {
  AgentRuntimeCapabilities,
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
    exactRepeatThreshold: 2,
    semanticFailureThreshold: 2
  }
}

describe('RuntimeGovernanceSupervisor', () => {
  it('steers repeated tool calls at the configured threshold', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    for (let index = 1; index <= 2; index += 1) {
      supervisor.observe(toolEvent(index), baseCapabilities, strictBudgetSettings, controls)
    }
    await Promise.resolve()

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
  })

  it('supplies failure context and continues after one extra repeat', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    for (let index = 1; index <= 3; index += 1) {
      supervisor.observe(toolEvent(index), baseCapabilities, strictBudgetSettings, controls)
    }
    await Promise.resolve()

    expect(controls.interruptTurn).not.toHaveBeenCalled()
    expect(controls.steerTurn).toHaveBeenLastCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      text: expect.stringMatching(/repeated identical arguments 3 times.*distinct, verifiable action/u)
    }))
    expect(controls.publishSyntheticEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'runtime_status',
      message: expect.stringContaining('requested recovery'),
      metadata: expect.objectContaining({
        level: 'recovery',
        recoveryAttempt: 1,
        family: 'tool_call:lookup'
      })
    }))
  })

  it('interrupts only after bounded recovery attempts keep repeating', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    for (let index = 1; index <= 9; index += 1) {
      supervisor.observe(toolEvent(index), baseCapabilities, strictBudgetSettings, controls)
    }
    await Promise.resolve()

    expect(controls.steerTurn).toHaveBeenCalledTimes(3)
    expect(controls.interruptTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      discard: false
    }))
    expect(controls.publishSyntheticEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      code: 'runtime_execution_interrupted',
      message: expect.stringContaining('repeated identical arguments')
    }))
  })

  it('reports successful receipts accurately while still detecting no-progress repetition', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    supervisor.observe(toolEvent(1), baseCapabilities, strictBudgetSettings, controls)
    supervisor.observe(toolReceiptEvent(1, 'success'), baseCapabilities, strictBudgetSettings, controls)
    supervisor.observe(toolEvent(2), baseCapabilities, strictBudgetSettings, controls)
    await Promise.resolve()

    expect(controls.steerTurn).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringMatching(/failure class: none.*lookup completed/u)
    }))
    expect(controls.steerTurn).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.not.stringContaining('no terminal executor receipt')
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
      text: expect.stringMatching(/unknown_resource_ref.*sciforge_discover.*surface\.inspect/u)
    }))

    supervisor.observe(capabilityInvokeEvent(3), baseCapabilities, strictBudgetSettings, controls)
    await Promise.resolve()
    expect(controls.interruptTurn).toHaveBeenCalled()
  })

  it('denies OS GUI automation when the capability registry advertises surface.inspect', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = {
      ...controlsSpy(),
      ownedSurfaceInspectionAvailable: true
    }

    supervisor.observe(shellGuiFallbackEvent(), baseCapabilities, strictBudgetSettings, controls)
    await Promise.resolve()

    expect(controls.interruptTurn).toHaveBeenCalled()
    expect(controls.publishSyntheticEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      code: 'runtime_execution_policy_denied',
      detail: expect.stringContaining('sciforge_discover')
    }))
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

function toolReceiptEvent(index: number, status: 'success' | 'error'): AgentRuntimeEvent {
  return {
    kind: 'tool_event',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: `tool-${index}`,
    status,
    toolKind: 'tool_call',
    summary: 'lookup',
    detail: status === 'success' ? 'lookup completed' : 'lookup failed',
    meta: {
      toolName: 'lookup',
      callId: `call-${index}`
    }
  }
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
): Extract<AgentRuntimeEvent, { kind: 'tool_event' }> {
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
        resourceRef: 'res_surface_12345678901234567890'
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
    meta: {
      ...capabilityInvokeEvent(index).meta,
      errorCode: 'unknown_resource_ref',
      failureClass: 'stale_resource',
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
