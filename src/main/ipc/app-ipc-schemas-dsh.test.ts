import { describe, expect, it } from 'vitest'
import {
  settingsPatchSchema,
  agentRuntimeConnectPayloadSchema,
  agentRuntimeStartThreadPayloadSchema,
  agentRuntimeStartTurnPayloadSchema,
  agentRuntimeEventSubscribePayloadSchema,
  agentRuntimeApprovalResolvePayloadSchema,
  agentRuntimeTurnTargetPayloadSchema
} from './app-ipc-schemas'

describe('DSH through the public IPC validation boundary', () => {
  it('accepts the settings payload sent by the actual DSH selection card', () => {
    const payload = { activeAgentRuntime: 'dsh', agents: { dsh: { command: 'dsh' } } }
    expect(settingsPatchSchema.parse(payload)).toEqual(payload)
  })
  it.each([
    [agentRuntimeConnectPayloadSchema, { runtimeId: 'dsh' }],
    [agentRuntimeConnectPayloadSchema, { runtimeId: 'dsh' }],
    [agentRuntimeStartThreadPayloadSchema, { runtimeId: 'dsh', workspace: '/owned/workspace' }],
    [agentRuntimeStartTurnPayloadSchema, { runtimeId: 'dsh', threadId: 'session', text: 'hello' }],
    [agentRuntimeEventSubscribePayloadSchema, { runtimeId: 'dsh', threadId: 'session' }],
    [agentRuntimeApprovalResolvePayloadSchema, { runtimeId: 'dsh', threadId: 'session', approvalId: 'approval', decision: 'denied' }],
    [agentRuntimeTurnTargetPayloadSchema, { runtimeId: 'dsh', threadId: 'session', turnId: 'turn' }]
  ] as const)('accepts DSH for a neutral runtime operation %#', (schema, payload) => {
    expect(schema.safeParse(payload).success).toBe(true)
  })
  it('accepts persisted disabled DSH computer-use state without enabling an unsupported capability', () => {
    expect(settingsPatchSchema.safeParse({ computerUse: { runtimeEnabled: { dsh: false } } }).success).toBe(true)
    expect(settingsPatchSchema.safeParse({ computerUse: { runtimeEnabled: { dsh: true } } }).success).toBe(false)
  })
  it('accepts the reviewed command-execution switch and rejects a non-boolean', () => {
    expect(settingsPatchSchema.parse({ agents: { dsh: { commandExecution: true } } }))
      .toEqual({ agents: { dsh: { commandExecution: true } } })
    expect(settingsPatchSchema.parse({ agents: { dsh: { commandExecution: false } } }))
      .toEqual({ agents: { dsh: { commandExecution: false } } })
    expect(settingsPatchSchema.safeParse({ agents: { dsh: { commandExecution: 'yes' } } }).success).toBe(false)
  })
  it('accepts the full settings snapshot shape the settings view persists', () => {
    // The settings view saves the whole form; the DSH section always carries
    // executablePath/selectedModel/reasoningEffort (empty-string defaults).
    // Rejecting them made every full-form save fail with "Unrecognized keys".
    const payload = {
      activeAgentRuntime: 'dsh',
      agents: { dsh: { command: 'dsh', executablePath: '', selectedModel: '', reasoningEffort: '' } }
    }
    expect(settingsPatchSchema.parse(payload)).toEqual(payload)
    expect(
      settingsPatchSchema.safeParse({
        agents: { dsh: { executablePath: 'C:\\tools\\dsh.exe', selectedModel: 'deepseek-v4', reasoningEffort: 'high' } }
      }).success
    ).toBe(true)
  })
  it('retains strict settings fields and rejects historical or unknown runtime identities', () => {
    expect(settingsPatchSchema.safeParse({ agents: { dsh: { command: 'dsh', extraArgs: ['--unsafe'] } } }).success).toBe(false)
    for (const runtimeId of ['deepseek', 'deepseek-runtime', 'unknown']) {
      expect(agentRuntimeConnectPayloadSchema.safeParse({ runtimeId }).success).toBe(false)
    }
  })
})
