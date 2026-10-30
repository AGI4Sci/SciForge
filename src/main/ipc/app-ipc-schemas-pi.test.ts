import { describe, expect, it } from 'vitest'
import {
  settingsPatchSchema,
  agentRuntimeConnectPayloadSchema,
  agentRuntimeStartThreadPayloadSchema,
  agentRuntimeStartTurnPayloadSchema,
  agentRuntimeEventSubscribePayloadSchema,
  agentRuntimeTurnTargetPayloadSchema
} from './app-ipc-schemas'

describe('Pi through the public IPC validation boundary', () => {
  it('accepts the settings payload sent by the actual Pi selection card', () => {
    const payload = {
      activeAgentRuntime: 'pi',
      agents: { pi: { command: 'C:\\tools\\pi.cmd', executablePath: 'C:\\tools\\pi.cmd' } }
    }
    expect(settingsPatchSchema.parse(payload)).toEqual(payload)
  })
  it.each([
    [agentRuntimeConnectPayloadSchema, { runtimeId: 'pi' }],
    [agentRuntimeStartThreadPayloadSchema, { runtimeId: 'pi', workspace: '/owned/workspace' }],
    [agentRuntimeStartTurnPayloadSchema, { runtimeId: 'pi', threadId: 'session', text: 'hello' }],
    [agentRuntimeEventSubscribePayloadSchema, { runtimeId: 'pi', threadId: 'session' }],
    [agentRuntimeTurnTargetPayloadSchema, { runtimeId: 'pi', threadId: 'session', turnId: 'turn' }]
  ] as const)('accepts Pi for a neutral runtime operation %#', (schema, payload) => {
    expect(schema.safeParse(payload).success).toBe(true)
  })
  it('retains strict settings fields and rejects unknown Pi keys', () => {
    expect(settingsPatchSchema.safeParse({ agents: { pi: { command: 'pi', extraArgs: ['--unsafe'] } } }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ agents: { pi: { command: 'pi' }, unknownRuntime: {} } }).success).toBe(false)
  })
  it('accepts the full settings snapshot shape the settings view persists (empty executablePath)', () => {
    // The settings view saves the whole form, whose Pi defaults carry
    // executablePath: ''. Rejecting the empty string broke every save.
    const payload = { agents: { pi: { command: 'pi', executablePath: '' } } }
    expect(settingsPatchSchema.parse(payload)).toEqual(payload)
  })
  it('accepts computer-use runtimeEnabled with Pi hard-disabled (full snapshot save)', () => {
    // The full form carries computerUse.runtimeEnabled.pi = false; the strict
    // schema must accept it or every settings save fails with "Unrecognized key".
    const payload = { computerUse: { enabled: true, runtimeEnabled: { codex: true, claude: true, dsh: false, pi: false } } }
    expect(settingsPatchSchema.parse(payload)).toEqual(payload)
  })
  it('keeps computer use unavailable for Pi', () => {
    expect(settingsPatchSchema.safeParse({ computerUse: { runtimeEnabled: { pi: true } } }).success).toBe(false)
  })
  it('accepts Pi thread ids in scheduled task payloads', () => {
    const payload = { schedule: { tasks: [{ agentThreadIds: { pi: 'thread-1' } }] } }
    expect(settingsPatchSchema.safeParse(payload).success).toBe(true)
  })
})
