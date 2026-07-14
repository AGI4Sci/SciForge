import { describe, expect, it, vi } from 'vitest'
import type {
  AgentRuntimeCapabilities,
  AgentRuntimeEvent
} from '../../../shared/agent-runtime-contract'
import type { RuntimeGuardSettingsV1 } from '../../../shared/app-settings'
import { RuntimeGovernanceSupervisor } from './governance'

const baseCapabilities = {
  runtimeId: 'codex',
  guard: {
    toolStorm: 'observe',
    toolBudget: 'unsupported',
    stuckDetection: 'unsupported'
  }
} as AgentRuntimeCapabilities

const strictBudgetSettings: RuntimeGuardSettingsV1 = {
  toolStorm: {
    enabled: true,
    windowSize: 8,
    threshold: 2
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
        guard: 'toolStorm',
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
      text: expect.stringMatching(/tool_timeout.*workspace read timed out.*no successful terminal executor receipt observed/u)
    }))
    expect(controls.publishSyntheticEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'runtime_status',
      message: expect.stringContaining('asked the model to recover'),
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
      code: 'runtime_tool_storm_interrupted',
      message: expect.stringContaining('could not be recovered')
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
