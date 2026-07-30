import { describe, expect, it } from 'vitest'
import { RemoteSshEgressAuthorizationStore } from './egress-authorization.js'

describe('Remote SSH egress authorization store', () => {
  it('binds an opaque identity to one workspace and target revision', () => {
    const store = new RemoteSshEgressAuthorizationStore(
      () => new Date('2026-07-30T00:00:00.000Z')
    )
    const output = store.authorize({
      workspaceId: '/workspace',
      targetId: 'cpu-egress',
      targetRevision: 'target-r1'
    })

    expect(JSON.stringify(output)).not.toContain('cpu-egress')
    expect(store.acquire(output.authorizedSessionId, '/workspace')).toMatchObject({
      workspaceId: '/workspace',
      targetId: 'cpu-egress',
      targetRevision: 'target-r1'
    })
    expect(() => store.acquire(output.authorizedSessionId, '/other'))
      .toThrow(/another workspace/i)
  })

  it('expires only before use and pins an acquired route until explicit revoke', () => {
    let now = new Date('2026-07-30T00:00:00.000Z')
    const store = new RemoteSshEgressAuthorizationStore(() => now, 1_000)
    const unused = store.authorize({
      workspaceId: '/workspace',
      targetId: 'cpu-egress',
      targetRevision: 'target-r1'
    })
    const active = store.authorize({
      workspaceId: '/workspace',
      targetId: 'cpu-egress',
      targetRevision: 'target-r1'
    })
    store.acquire(active.authorizedSessionId, '/workspace')
    now = new Date('2026-07-30T00:00:01.001Z')

    expect(() => store.acquire(unused.authorizedSessionId, '/workspace'))
      .toThrow(/expired/i)
    expect(store.requireActive(active.authorizedSessionId, '/workspace').targetId)
      .toBe('cpu-egress')
    store.revoke(active.authorizedSessionId)
    expect(() => store.requireActive(active.authorizedSessionId, '/workspace'))
      .toThrow(/no longer active/i)
  })
})
