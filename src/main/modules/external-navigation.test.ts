import { describe, expect, it, vi } from 'vitest'
import {
  DomainExternalNavigationError
} from '@sciforge/domain-sdk/external-navigation'
import { samePrincipalSnapshot, type PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import { HostExternalNavigationService } from './external-navigation'
import type {
  HostResourceGrantCaller,
  HostResourceGrantInvocation
} from './host-resource-grants'

const principalV1 = Object.freeze({
  authority: 'sciforge.local-identity',
  subject: 'person-1',
  assurance: 'local-selection' as const,
  deviceId: 'installation-1',
  identityVersion: 1
})

const principalV2 = Object.freeze({ ...principalV1, identityVersion: 2 })

describe('Host external navigation targets', () => {
  it('opens only an owner/caller/Principal-bound one-shot HTTPS handle', async () => {
    const openExternal = vi.fn(async () => undefined)
    let currentPrincipal: PrincipalSnapshot | undefined = principalV1
    const service = createService(openExternal, () => currentPrincipal)
    const caller = grantCaller('window:7', principalV1)
    let invocation: HostResourceGrantInvocation | undefined = invocationFor(caller)
    const port = service.forOwner('domain.content-space', () => invocation)
    const target = port.issueTarget({
      url: 'https://content.example/portal/file-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    expect(target).not.toHaveProperty('url')

    const otherOwner = service.forOwner('domain.other', () => invocation)
    await expect(otherOwner.openTarget({ handle: target.handle }))
      .rejects.toMatchObject({ code: 'target_unavailable' })
    expect(openExternal).not.toHaveBeenCalled()
    await port.openTarget({ handle: target.handle })
    expect(openExternal).toHaveBeenCalledWith('https://content.example/portal/file-1')
    await expect(port.openTarget({ handle: target.handle }))
      .rejects.toMatchObject({ code: 'target_unavailable' })

    const wrongCallerTarget = port.issueTarget({
      url: 'https://content.example/portal/file-2',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    invocation = invocationFor(grantCaller('window:8', principalV1))
    await expect(port.openTarget({ handle: wrongCallerTarget.handle }))
      .rejects.toMatchObject({ code: 'target_unavailable' })
    invocation = invocationFor(caller)
    await port.openTarget({ handle: wrongCallerTarget.handle })

    const oldPrincipal = port.issueTarget({
      url: 'https://content.example/portal/file-3',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    currentPrincipal = principalV2
    invocation = invocationFor(grantCaller('window:7', principalV2))
    await expect(port.openTarget({ handle: oldPrincipal.handle }))
      .rejects.toMatchObject({ code: 'principal_changed' })
    currentPrincipal = principalV1
    invocation = invocationFor(caller)
    await expect(port.openTarget({ handle: oldPrincipal.handle }))
      .rejects.toMatchObject({ code: 'target_unavailable' })
  })

  it('requires an active invocation and reauthorizes immediately before opening', async () => {
    const openExternal = vi.fn(async () => undefined)
    let currentPrincipal: PrincipalSnapshot | undefined = principalV1
    const service = createService(openExternal, () => currentPrincipal)
    const caller = grantCaller('window:7', principalV1)
    let invocation: HostResourceGrantInvocation | undefined = invocationFor(caller)
    const port = service.forOwner('domain.content-space', () => invocation)
    const target = port.issueTarget({
      url: 'https://content.example/portal/file-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    currentPrincipal = principalV2
    await expect(port.openTarget({ handle: target.handle }))
      .rejects.toMatchObject({ code: 'principal_changed' })
    expect(openExternal).not.toHaveBeenCalled()
    currentPrincipal = principalV1
    await expect(port.openTarget({ handle: target.handle }))
      .rejects.toMatchObject({ code: 'target_unavailable' })

    invocation = undefined
    expect(() => port.issueTarget({
      url: 'https://content.example/portal/file-2',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })).toThrow('active capability invocation')
  })

  it('rejects unsafe targets and bounds both TTL and capacity', async () => {
    let now = new Date('2026-08-16T10:00:00.000Z')
    const openExternal = vi.fn(async () => undefined)
    const service = new HostExternalNavigationService({
      openExternal,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      now: () => now,
      maxTargets: 1
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    for (const url of [
      'http://content.example/portal',
      'https:////content.example/portal',
      'https://@content.example/portal',
      'https://user:secret@content.example/portal',
      'https://content.example/portal#',
      'https://content.example/portal#access-token',
      'https://content.example/portal\\alternate-parser',
      'file:///private/tmp/secret',
      `https://content.example/${'a'.repeat(4_096)}`
    ]) {
      expect(() => port.issueTarget({
        url,
        expiresAt: '2026-08-16T10:01:00.000Z'
      })).toThrow(DomainExternalNavigationError)
    }
    expect(() => port.issueTarget({
      url: 'https://content.example/portal',
      expiresAt: '2026-08-16T11:00:00.000Z'
    })).toThrow(DomainExternalNavigationError)
    for (const expiresAt of [
      'not-a-date',
      '2026-08-16T09:59:59.000Z',
      '2026-08-16T10:00:00.000Z'
    ]) {
      expect(() => port.issueTarget({
        url: 'https://content.example/portal',
        expiresAt
      })).toThrow(DomainExternalNavigationError)
    }

    const first = port.issueTarget({
      url: 'https://content.example/portal/one',
      expiresAt: '2026-08-16T10:01:00.000Z'
    })
    expect(() => port.issueTarget({
      url: 'https://content.example/portal/two',
      expiresAt: '2026-08-16T10:01:00.000Z'
    })).toThrowError(expect.objectContaining({ code: 'capacity_exceeded' }))
    now = new Date('2026-08-16T10:02:00.000Z')
    await expect(port.openTarget({ handle: first.handle }))
      .rejects.toMatchObject({ code: 'target_unavailable' })
    expect(openExternal).not.toHaveBeenCalled()
    expect(() => port.issueTarget({
      url: 'https://content.example/portal/after-expiry',
      expiresAt: '2026-08-16T10:03:00.000Z'
    })).not.toThrow()
  })

  it('keeps an exact signed HTTPS query behind the opaque renderer handle', async () => {
    const openExternal = vi.fn(async () => undefined)
    const service = createService(openExternal, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    const url = 'https://content.example:443/portal/%2fraw?signature=a%2Bb%2Fc&expires=60'
    const target = port.issueTarget({
      url,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    expect(target).not.toHaveProperty('url')
    expect(JSON.stringify(target)).not.toContain('signature')
    await port.openTarget({ handle: target.handle })
    expect(openExternal).toHaveBeenCalledWith(url)
  })

  it('does not consume or dispatch a target cancelled before OS handoff', async () => {
    const openExternal = vi.fn(async () => undefined)
    const service = createService(openExternal, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    const target = port.issueTarget({
      url: 'https://content.example/portal/file-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    const controller = new AbortController()
    controller.abort()
    await expect(port.openTarget({ handle: target.handle, signal: controller.signal }))
      .rejects.toMatchObject({ code: 'cancelled' })
    expect(openExternal).not.toHaveBeenCalled()

    await port.openTarget({ handle: target.handle })
    expect(openExternal).toHaveBeenCalledTimes(1)
  })

  it('reports an unknown one-shot outcome when cancellation arrives during OS handoff', async () => {
    const entered = deferred()
    const release = deferred()
    const openExternal = vi.fn(async () => {
      entered.resolve()
      await release.promise
    })
    const service = createService(openExternal, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    const target = port.issueTarget({
      url: 'https://content.example/portal/file-1?signature=opaque',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    const controller = new AbortController()
    const opening = port.openTarget({ handle: target.handle, signal: controller.signal })
    await entered.promise
    controller.abort()
    release.resolve()

    await expect(opening).rejects.toMatchObject({ code: 'outcome_unknown' })
    await expect(port.openTarget({ handle: target.handle }))
      .rejects.toMatchObject({ code: 'target_unavailable' })
  })

  it('reports an unknown one-shot outcome when the Principal changes during OS handoff', async () => {
    const entered = deferred()
    const release = deferred()
    let currentPrincipal: PrincipalSnapshot | undefined = principalV1
    const openExternal = vi.fn(async () => {
      entered.resolve()
      await release.promise
    })
    const service = createService(openExternal, () => currentPrincipal)
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    const target = port.issueTarget({
      url: 'https://content.example/portal/file-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    const opening = port.openTarget({ handle: target.handle })
    await entered.promise
    currentPrincipal = principalV2
    release.resolve()

    await expect(opening).rejects.toMatchObject({ code: 'outcome_unknown' })
    await expect(port.openTarget({ handle: target.handle }))
      .rejects.toMatchObject({ code: 'target_unavailable' })
  })

  it('counts an in-flight OS handoff against the bounded target capacity', async () => {
    const entered = deferred()
    const release = deferred()
    const service = new HostExternalNavigationService({
      openExternal: async () => {
        entered.resolve()
        await release.promise
      },
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      maxTargets: 1
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    const target = port.issueTarget({
      url: 'https://content.example/portal/file-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    const opening = port.openTarget({ handle: target.handle })
    try {
      await entered.promise
      expect(() => port.issueTarget({
        url: 'https://content.example/portal/file-2',
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      })).toThrowError(expect.objectContaining({ code: 'capacity_exceeded' }))

      release.resolve()
      await opening
      expect(() => port.issueTarget({
        url: 'https://content.example/portal/file-2',
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      })).not.toThrow()
    } finally {
      release.resolve()
      await opening.catch(() => undefined)
    }
  })

  it('does not allow retry after the operating system opener fails', async () => {
    const service = createService(async () => {
      throw new Error('browser unavailable')
    }, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    const target = port.issueTarget({
      url: 'https://content.example/portal/file-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    await expect(port.openTarget({ handle: target.handle }))
      .rejects.toMatchObject({ code: 'open_failed' })
    await expect(port.openTarget({ handle: target.handle }))
      .rejects.toMatchObject({ code: 'target_unavailable' })
  })
})

function createService(
  openExternal: (url: string) => Promise<void>,
  current: () => PrincipalSnapshot | undefined
): HostExternalNavigationService {
  return new HostExternalNavigationService({
    openExternal,
    isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, current())
  })
}

function grantCaller(callerId: string, principal: PrincipalSnapshot): HostResourceGrantCaller {
  return Object.freeze({ callerId, principal })
}

function invocationFor(caller: HostResourceGrantCaller): HostResourceGrantInvocation {
  return Object.freeze({ caller: Object.freeze({ ...caller }) })
}

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
  let resolve!: () => void
  const promise = new Promise<void>((accepted) => {
    resolve = accepted
  })
  return Object.freeze({ promise, resolve })
}
