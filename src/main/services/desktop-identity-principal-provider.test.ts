import { describe, expect, it, vi } from 'vitest'
import type { DesktopIdentityStatus } from '../../shared/desktop-identity'
import { DesktopIdentityPrincipalProvider } from './desktop-identity-principal-provider'

describe('DesktopIdentityPrincipalProvider', () => {
  it('publishes the canonical SciForge userId as the cloud Host Principal', () => {
    const source = identitySource()
    const provider = new DesktopIdentityPrincipalProvider(source, 'installation-device-1')
    const listener = vi.fn()
    provider.subscribe(listener)

    expect(provider.snapshot()).toEqual({ identityVersion: 0, principal: null })

    source.publish(signedIn('subject-a', '2026-08-19T12:05:00.000Z'))
    expect(provider.current()).toEqual({
      authority: 'sciforge-cloud',
      subject: 'usr_CloudUser000001',
      assurance: 'cloud-authenticated',
      deviceId: 'installation-device-1',
      identityVersion: 1
    })
    expect(listener).toHaveBeenLastCalledWith({
      identityVersion: 1,
      principal: provider.current()
    })

    source.publish(signedIn('subject-a', '2026-08-19T12:10:00.000Z'))
    expect(provider.snapshot().identityVersion).toBe(2)

    source.publish({ state: 'signed-out' })
    expect(provider.snapshot()).toEqual({ identityVersion: 3, principal: null })
    provider.close()
  })

  it('does not expose display attributes as Principal identifiers', () => {
    const source = identitySource(signedIn('stable-subject', '2026-08-19T12:05:00.000Z'))
    const provider = new DesktopIdentityPrincipalProvider(source, 'installation-device-2')

    expect(provider.current()).toMatchObject({
      subject: 'usr_CloudUser000001',
      assurance: 'cloud-authenticated'
    })
    expect(JSON.stringify(provider.current())).not.toContain('person@example.com')
    provider.close()
  })
})

function signedIn(subject: string, accessTokenExpiresAt: string): DesktopIdentityStatus {
  return {
    state: 'signed-in',
    user: {
      userId: 'usr_CloudUser000001',
      externalIdentityId: 'xid_CloudIdent0001',
      issuer: 'https://login-test.sciforge.cn/realms/SciForge',
      subject,
      displayName: 'Cloud Person',
      email: 'person@example.com'
    },
    accessTokenExpiresAt
  }
}

function identitySource(initial: DesktopIdentityStatus = { state: 'signed-out' }) {
  let status = initial
  const listeners = new Set<(next: DesktopIdentityStatus) => void>()
  return {
    getStatus: () => status,
    subscribe: (listener: (next: DesktopIdentityStatus) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish: (next: DesktopIdentityStatus) => {
      status = next
      for (const listener of listeners) listener(next)
    }
  }
}
