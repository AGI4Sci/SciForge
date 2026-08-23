import { describe, expect, it } from 'vitest'

import { openContentIdentityIdSchema } from '@sciforge/domain-opencontent-connector/team-administration-contract'

import {
  OpenContentIdentityBindingError,
  createCurrentPrincipalOpenContentIdentityBinding
} from './identity-binding.js'

const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'local-account-a',
  assurance: 'local-selection' as const,
  deviceId: 'test-device',
  identityVersion: 1
})
const externalIdentityId = openContentIdentityIdSchema.parse(42)
const context = Object.freeze({
  principal,
  providerInstanceRef: 'opencontent-test',
  currentExternalIdentityId: externalIdentityId
})

describe('default OpenContent identity binding', () => {
  it('maps only the current Host Principal to the verified current external identity', async () => {
    const identities = createCurrentPrincipalOpenContentIdentityBinding()

    await expect(identities.resolveContentUserIdentity({
      ...context,
      contentUserId: principal.subject
    })).resolves.toBe(externalIdentityId)
    await expect(identities.resolveExternalIdentityContentUser({
      ...context,
      externalIdentityId
    })).resolves.toBe(principal.subject)
  })

  it('returns a typed missing-binding failure for every non-current identity', async () => {
    const identities = createCurrentPrincipalOpenContentIdentityBinding()

    await expect(identities.resolveContentUserIdentity({
      ...context,
      contentUserId: 'scientist@example.test'
    })).rejects.toBeInstanceOf(OpenContentIdentityBindingError)
    await expect(identities.resolveExternalIdentityContentUser({
      ...context,
      externalIdentityId: openContentIdentityIdSchema.parse(43)
    })).rejects.toMatchObject({ code: 'binding_missing' })
  })
})
