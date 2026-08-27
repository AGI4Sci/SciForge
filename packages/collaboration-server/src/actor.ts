import { fail } from './errors.js'
import type { InboxRecipient } from './model.js'

/** Non-secret, authorization-ready facts about an authenticated principal. */
export type SystemActor = { kind: 'system'; actorKey: string }
export type OidcUserActor = {
  kind: 'user'
  authentication: 'oidc'
  actorKey: string
  userId: string
  identityId: string
  issuer: string
  subject: string
  authTime: number
  expiresAt: number
  assurance: 'verified' | 'strong'
}
export type UserActor = OidcUserActor
export type HumanEndpointActor = {
  kind: 'human_endpoint'
  actorKey: string
  userId: string
  humanEndpointId: string
  assurance: 'verified' | 'strong'
}
export type AgentActor = {
  kind: 'agent_device'
  actorKey: string
  userId: string
  agentId: string
  deviceId: string
  credentialId: string
  credentialGeneration?: number
  assurance: 'device'
}
export type AuthContext = SystemActor | UserActor | HumanEndpointActor | AgentActor

export function actorInboxRecipient(actor: AuthContext): InboxRecipient {
  switch (actor.kind) {
    case 'system': return fail('permission_denied', 'The system actor has no inbox.')
    case 'user': return { kind: 'user', id: actor.userId }
    case 'human_endpoint': return { kind: 'human_endpoint', id: actor.humanEndpointId }
    case 'agent_device': return { kind: 'agent', id: actor.agentId }
  }
}
