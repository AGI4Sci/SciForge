/**
 * Stage-one fixture runtime context for the DSH adapter.
 *
 * - `agentThreads.read` is config-driven: the host passes recorded session
 *   details through `dshConfig.sessions` (`{ [threadId]: detail }`) so the
 *   plugin can be activated and exercised end-to-end before the host
 *   capability bridge for plugins exists (plugins/GAPS.md, G1).
 * - `capabilities` is fail-closed: any invoke throws the G1 bridge error.
 *   Flows that commit/read Artifact Versions or list Git Checkpoints are
 *   verified in-process by the parity tests against the static module.
 * - `turnEvents` delivers no events (G2): the required before-turn barrier
 *   exists so activation honors the static fail-closed contract, but no turn
 *   boundaries or artifact events arrive until the host forwards them.
 * - `enablement` is static-on: a loaded plugin is an enabled module.
 */
import type {
  DomainAgentThreadDetail,
  DomainMainDurableTurnBoundarySnapshot
} from '@sciforge/domain-sdk/host'
import { z } from 'zod'
import type { ResearchCheckpointRuntimeContext } from '../ports/context.js'

export const researchCheckpointFixtureSessionsSchema = z.record(z.string(), z.unknown())

export type ResearchCheckpointFixtureSessions = z.infer<typeof researchCheckpointFixtureSessionsSchema>

const G1_BRIDGE_ERROR =
  'Host capability bridge is not available to plugins yet (plugins/GAPS.md, G1).'

const EMPTY_BOUNDARY_SNAPSHOT: DomainMainDurableTurnBoundarySnapshot = Object.freeze({
  issuerEpoch: 'fixture',
  nextDeliveryAttemptOrdinal: 1,
  retiredThroughOrdinal: 0,
  retiredOrdinalRanges: Object.freeze([]),
  owners: Object.freeze([])
})

export function createFixtureAgentThreads(
  sessions: ResearchCheckpointFixtureSessions
): ResearchCheckpointRuntimeContext['agentThreads'] {
  return Object.freeze({
    read: async ({ threadId }) => {
      const detail = sessions[threadId]
      if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
        throw new Error(`Research Checkpoints fixture has no session '${threadId}'.`)
      }
      return detail as DomainAgentThreadDetail
    }
  })
}

export function createUnavailableCapabilities(): ResearchCheckpointRuntimeContext['capabilities'] {
  const fail = (): never => {
    throw new Error(G1_BRIDGE_ERROR)
  }
  return Object.freeze({
    invoke: async () => fail(),
    createApprovedBatch: () => fail()
  })
}

export function createNoEventTurnEvents(): NonNullable<ResearchCheckpointRuntimeContext['turnEvents']> {
  return Object.freeze({
    subscribe: () => async () => {},
    subscribeRequiredBeforeTurn: () => async () => {},
    readDurableTurnBoundarySnapshot: async () => EMPTY_BOUNDARY_SNAPSHOT
  })
}

export function createFixtureEnablement(): ResearchCheckpointRuntimeContext['enablement'] {
  return Object.freeze({
    isEnabled: () => true,
    subscribe: () => async () => {}
  })
}

export function createFixtureRuntimeContext(
  options: Readonly<{
    sessions: ResearchCheckpointFixtureSessions
    signal: AbortSignal
  }>
): ResearchCheckpointRuntimeContext {
  return Object.freeze({
    agentThreads: createFixtureAgentThreads(options.sessions),
    turnEvents: createNoEventTurnEvents(),
    capabilities: createUnavailableCapabilities(),
    enablement: createFixtureEnablement(),
    signal: options.signal
  })
}
