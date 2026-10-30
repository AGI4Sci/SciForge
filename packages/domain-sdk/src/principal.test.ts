import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'
import {
  definePrincipalContextSnapshot,
  definePrincipalSnapshot,
  isDomainMainPrincipalProvider,
  samePrincipalContextSnapshot,
  samePrincipalSnapshot
} from './principal.js'

const principal = {
  authority: 'sciforge.identity-access',
  subject: 'usr_local-alice.01',
  assurance: 'local-selection' as const,
  deviceId: 'installation-01',
  identityVersion: 7
}

describe('Principal contracts', () => {
  it('accepts namespaced opaque subjects without assuming a provider-specific ID format', () => {
    const snapshot = definePrincipalSnapshot(principal)

    assert.deepEqual(snapshot, principal)
    assert.equal(Object.isFrozen(snapshot), true)
    assert.doesNotThrow(() => definePrincipalSnapshot({
      ...principal,
      subject: 'c07f29ee-801d-4cf3-90ef-96c56c65de21'
    }))
  })

  it('rejects non-canonical, unbounded, control-bearing, and extended envelopes', () => {
    for (const subject of ['', ' alice', 'alice ', 'alice\nadmin', 'x'.repeat(257)]) {
      assert.throws(
        () => definePrincipalSnapshot({ ...principal, subject }),
        z.ZodError
      )
    }
    assert.throws(
      () => definePrincipalSnapshot({ ...principal, credential: 'secret' } as never),
      z.ZodError
    )
    assert.throws(
      () => definePrincipalSnapshot({
        ...principal,
        identityVersion: Number.MAX_SAFE_INTEGER + 1
      }),
      z.ZodError
    )
  })

  it('binds the current Principal to the exact context identity version', () => {
    const context = definePrincipalContextSnapshot({
      identityVersion: principal.identityVersion,
      principal
    })

    assert.equal(Object.isFrozen(context), true)
    assert.throws(
      () => definePrincipalContextSnapshot({ identityVersion: 8, principal }),
      z.ZodError
    )
  })

  it('compares every authorization-relevant Principal field', () => {
    assert.equal(samePrincipalSnapshot(principal, { ...principal }), true)
    assert.equal(samePrincipalSnapshot(principal, { ...principal, authority: 'remote.example' }), false)
    assert.equal(samePrincipalSnapshot(principal, { ...principal, subject: 'usr_local-bob' }), false)
    assert.equal(samePrincipalSnapshot(principal, { ...principal, identityVersion: 8 }), false)
    assert.equal(samePrincipalSnapshot(principal, { ...principal, deviceId: 'installation-02' }), false)
    assert.equal(samePrincipalSnapshot(undefined, undefined), true)
    assert.equal(samePrincipalSnapshot(principal, undefined), false)
  })

  it('compares signed-in and signed-out Principal context revisions exactly', () => {
    const signedIn = { identityVersion: 7, principal }
    const signedOutV1 = { identityVersion: 1, principal: null }
    const signedOutV3 = { identityVersion: 3, principal: null }

    assert.equal(samePrincipalContextSnapshot(signedIn, { ...signedIn }), true)
    assert.equal(samePrincipalContextSnapshot(signedOutV1, { ...signedOutV1 }), true)
    assert.equal(samePrincipalContextSnapshot(signedOutV1, signedOutV3), false)
    assert.equal(samePrincipalContextSnapshot(signedIn, signedOutV3), false)
    assert.equal(samePrincipalContextSnapshot(undefined, undefined), true)
    assert.equal(samePrincipalContextSnapshot(signedOutV1, undefined), false)
  })

  it('recognizes only the minimal Principal provider surface', () => {
    const provider = {
      current: () => principal,
      snapshot: () => ({ identityVersion: 7, principal }),
      subscribe: () => () => undefined
    }

    assert.equal(isDomainMainPrincipalProvider(provider), true)
    assert.equal(isDomainMainPrincipalProvider({ ...provider, fallback: true }), false)
    assert.equal(isDomainMainPrincipalProvider({ ...provider, current: principal }), false)
  })
})
