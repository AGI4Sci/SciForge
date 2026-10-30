/**
 * The runtime-context seam of Research Checkpoints: exactly the members of
 * the host's `DomainMainRuntimeLifecycleContext` that the runtime consumes,
 * expressed with the SDK's own member types so any host-shaped implementation
 * (production bridge or test fixture) stays structurally compatible.
 *
 * - `agentThreads.read` — session detail reads (thread boundary checks and
 *   legacy preview/import transcript projection).
 * - `turnEvents` — the required before-turn barrier, after-turn lease
 *   settlement and the durable boundary snapshot (G2: the runner has no event
 *   push channel; the stage-one DSH adapter supplies a no-event fixture).
 * - `capabilities` — the host system capability invoker backing
 *   artifact-versions commit/read/list/restoreAsNew and git-checkpoints list
 *   (G1: the runner has no child-to-parent call channel yet; the stage-one
 *   adapter supplies a fail-closed fixture).
 * - `enablement` / `signal` — lifecycle gating identical to the static host.
 */
import type {
  DomainMainAgentThreadsHost,
  DomainMainModuleEnablement,
  DomainMainRuntimeDisposer,
  DomainMainSystemCapabilityInvoker,
  DomainMainTurnLifecycleEventsHost
} from '@sciforge/domain-sdk/host'

export type ResearchCheckpointRuntimeContext = Readonly<{
  agentThreads: Pick<DomainMainAgentThreadsHost, 'read'>
  turnEvents?: Pick<
    DomainMainTurnLifecycleEventsHost,
    'subscribe' | 'subscribeRequiredBeforeTurn' | 'readDurableTurnBoundarySnapshot'
  >
  capabilities: DomainMainSystemCapabilityInvoker
  enablement: DomainMainModuleEnablement
  signal: AbortSignal
}>

export type { DomainMainRuntimeDisposer }
