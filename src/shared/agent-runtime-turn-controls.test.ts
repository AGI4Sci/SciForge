/**
 * The runtime turn-control matrix is a fact table: these tests pin the observed
 * interfaces and make sure default capabilities carry it (so every adapter
 * inherits the correct per-runtime values without hand-wiring).
 */
import { describe, expect, it } from 'vitest'
import {
  AGENT_RUNTIME_TURN_CONTROLS,
  agentRuntimeTurnControls
} from './agent-runtime-turn-controls'
import { createDefaultAgentRuntimeCapabilities } from './agent-runtime-contract'

describe('agent runtime turn-control matrix', () => {
  it('matches the observed interfaces of the four runtimes', () => {
    expect(agentRuntimeTurnControls('codex')).toEqual({
      model: 'turn',
      reasoningLevel: 'turn',
      reasoningOff: true,
      serviceTier: 'turn'
    })
    expect(agentRuntimeTurnControls('claude')).toEqual({
      model: 'session',
      reasoningLevel: 'turn',
      reasoningOff: true,
      serviceTier: 'unsupported'
    })
    expect(agentRuntimeTurnControls('dsh')).toEqual({
      model: 'session',
      reasoningLevel: 'unsupported',
      reasoningOff: false,
      serviceTier: 'unsupported'
    })
    expect(agentRuntimeTurnControls('pi')).toEqual({
      model: 'session',
      reasoningLevel: 'unsupported',
      reasoningOff: false,
      serviceTier: 'unsupported'
    })
  })

  it('off is only claimed where an off state is actually transmittable', () => {
    // Claude maps off → thinking:{type:'disabled'}; codex transmits
    // `reasoning.effort:"off"` verbatim (real-wire probe); dsh/pi have no
    // reasoning channel at all.
    expect(AGENT_RUNTIME_TURN_CONTROLS.claude.reasoningOff).toBe(true)
    expect(AGENT_RUNTIME_TURN_CONTROLS.codex.reasoningOff).toBe(true)
    for (const id of ['dsh', 'pi'] as const) {
      expect(AGENT_RUNTIME_TURN_CONTROLS[id].reasoningOff).toBe(false)
    }
  })

  it('default capabilities carry the matrix for every runtime', () => {
    for (const id of ['codex', 'claude', 'dsh', 'pi'] as const) {
      const capabilities = createDefaultAgentRuntimeCapabilities({
        runtimeId: id,
        transport: 'jsonrpc_stdio'
      })
      expect(capabilities.turnControls).toEqual(AGENT_RUNTIME_TURN_CONTROLS[id])
    }
  })

  it('the matrix is frozen data, not mutable state', () => {
    expect(Object.isFrozen(AGENT_RUNTIME_TURN_CONTROLS)).toBe(true)
    for (const id of ['codex', 'claude', 'dsh', 'pi'] as const) {
      expect(Object.isFrozen(AGENT_RUNTIME_TURN_CONTROLS[id])).toBe(true)
    }
  })
})