import type { InboxRecipient } from './model.js'

export type InboxAvailabilityNotifier = {
  notifyInboxAvailable(recipient: InboxRecipient, latestSequence: number): void | Promise<void>
}

export type AgentAuthorityDisconnectNotifier = {
  disconnectAgentAuthority(agentId: string): void | Promise<void>
}

/**
 * The production Cloud runtime supports both durable-Inbox hints and immediate
 * transport fencing. Tests that exercise only service persistence may supply
 * the narrower Inbox notifier.
 */
export type CollaborationServiceNotifier = InboxAvailabilityNotifier &
  Partial<AgentAuthorityDisconnectNotifier>

export type CollaborationRuntimeNotifier = InboxAvailabilityNotifier &
  AgentAuthorityDisconnectNotifier
