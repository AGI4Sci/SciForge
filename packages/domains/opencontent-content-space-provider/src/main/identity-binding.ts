import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import type { OpenContentIdentityId } from '@sciforge/domain-opencontent-connector/team-administration-contract'

type IdentityBindingContext = Readonly<{
  principal: PrincipalSnapshot
  providerInstanceRef: string
  currentExternalIdentityId: OpenContentIdentityId
  signal?: AbortSignal
}>

export type OpenContentIdentityBindingPort = Readonly<{
  resolveContentUserIdentity(input: IdentityBindingContext & Readonly<{
    contentUserId: string
  }>): Promise<OpenContentIdentityId>
  resolveExternalIdentityContentUser(input: IdentityBindingContext & Readonly<{
    externalIdentityId: OpenContentIdentityId
  }>): Promise<string>
}>

export class OpenContentIdentityBindingError extends Error {
  readonly code = 'binding_missing' as const

  constructor() {
    super('No verified OpenContent identity binding exists for this Content Space member.')
    this.name = 'OpenContentIdentityBindingError'
  }
}

export function createCurrentPrincipalOpenContentIdentityBinding():
OpenContentIdentityBindingPort {
  return Object.freeze({
    resolveContentUserIdentity: async (input) => {
      if (input.signal?.aborted) throw new DOMException('Operation cancelled.', 'AbortError')
      if (input.contentUserId !== input.principal.subject) {
        throw new OpenContentIdentityBindingError()
      }
      return input.currentExternalIdentityId
    },
    resolveExternalIdentityContentUser: async (input) => {
      if (input.signal?.aborted) throw new DOMException('Operation cancelled.', 'AbortError')
      if (input.externalIdentityId !== input.currentExternalIdentityId) {
        throw new OpenContentIdentityBindingError()
      }
      return input.principal.subject
    }
  })
}
