import { describe, expect, it, vi } from 'vitest'
import type {
  PrincipalContextSnapshot,
  PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'
import type { DomainModuleCatalog } from './modules/catalog.js'
import { HostPrincipalContext } from './principal-context.js'

const principal: PrincipalSnapshot = {
  authority: 'sciforge.identity-access',
  subject: 'usr_local-alice',
  assurance: 'local-selection',
  deviceId: 'installation-01',
  identityVersion: 2
}

function catalog(values: readonly unknown[]): DomainModuleCatalog {
  return {
    listContributions: () => values.map((value, index) => ({
      value,
      owner: { moduleId: `fixture.${index}`, moduleVersion: '1.0.0' },
      declaration: {
        id: `fixture.${index}.principal`,
        kind: 'main.principal-provider',
        priority: 1
      }
    }))
  } as unknown as DomainModuleCatalog
}

describe('Host Principal context', () => {
  it('treats a missing provider as signed out and rejects ambiguous authorities', () => {
    expect(new HostPrincipalContext(catalog([])).snapshot()).toEqual({
      identityVersion: 0,
      principal: null
    })
    const provider = {
      current: () => principal,
      snapshot: () => ({ identityVersion: 2, principal }),
      subscribe: () => () => undefined
    }

    expect(() => new HostPrincipalContext(catalog([provider, provider])))
      .toThrow(/expected zero or one/u)
  })

  it('validates every live read from the selected provider', () => {
    const provider = {
      current: () => principal,
      snapshot: () => ({ identityVersion: 2, principal }),
      subscribe: () => () => undefined
    }
    const context = new HostPrincipalContext(catalog([provider]))

    expect(context.current()).toEqual(principal)
    expect(context.snapshot()).toEqual({ identityVersion: 2, principal })

    const forged = new HostPrincipalContext(catalog([{
      ...provider,
      current: () => ({ ...principal, token: 'secret' })
    }]))
    expect(() => forged.current()).toThrow()

    const inconsistent = new HostPrincipalContext(catalog([{
      ...provider,
      snapshot: () => ({
        identityVersion: 2,
        principal: { ...principal, subject: 'usr_local-bob' }
      })
    }]))
    expect(() => inconsistent.current()).toThrow(/inconsistent/u)
  })

  it('ignores duplicate and stale notifications and returns the provider disposer', () => {
    let publish: ((snapshot: PrincipalContextSnapshot) => void) | undefined
    const disposeProvider = vi.fn()
    const provider = {
      current: () => principal,
      snapshot: () => ({ identityVersion: 2, principal }),
      subscribe: (listener: (snapshot: PrincipalContextSnapshot) => void) => {
        publish = listener
        return disposeProvider
      }
    }
    const context = new HostPrincipalContext(catalog([provider]))
    const listener = vi.fn()
    const dispose = context.subscribe(listener)

    publish?.({ identityVersion: 2, principal })
    publish?.({ identityVersion: 2, principal })
    publish?.({ identityVersion: 1, principal: null })
    publish?.({ identityVersion: 3, principal: null })

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenLastCalledWith({
      identityVersion: 3,
      principal: null
    })
    dispose()
    expect(disposeProvider).toHaveBeenCalledOnce()
  })

  it('fails closed on malformed provider notifications', () => {
    let publish: ((snapshot: PrincipalContextSnapshot) => void) | undefined
    const provider = {
      current: () => principal,
      snapshot: () => ({ identityVersion: 2, principal }),
      subscribe: (listener: (snapshot: PrincipalContextSnapshot) => void) => {
        publish = listener
        return () => undefined
      }
    }
    const context = new HostPrincipalContext(catalog([provider]))
    context.subscribe(() => undefined)

    expect(() => publish?.({
      identityVersion: 4,
      principal: { ...principal, identityVersion: 3 }
    })).toThrow()
  })
})
