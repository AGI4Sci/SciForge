import type { IncomingMessage } from 'node:http'

import type { AgentActor, UserActor } from './actor.js'

/**
 * The narrow result of the server-owned network authentication boundary.
 * Callers receive actor facts; bearer material remains inside the implementation.
 */
export type CollaborationRequestActorResolver = Readonly<{
  resolveRequestActor(request: IncomingMessage): Promise<UserActor | AgentActor>
}>
