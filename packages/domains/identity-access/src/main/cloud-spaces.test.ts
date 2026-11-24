import { describe, expect, it, vi } from 'vitest'
import { createCloudSpaceSession, ensureCloudSpace, listCloudSpaces } from './cloud-spaces.js'
import type { WithCloudTransportLease } from './cloud-authority.js'

const spaceId = `spc_${'a'.repeat(32)}`
const space = () => ({ spaceId, scope: { kind: 'personal' as const, ownerUserId: 'usr_one' }, status: 'ready' as const,
  revision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
const grant = () => ({ spaceId, editorUrl: 'https://space.example/', bootstrapUrl: 'https://space.example/_sciforge/session',
  bootstrapCode: 'x'.repeat(40), expiresAt: new Date(Date.now() + 60_000).toISOString() })
function setup(response: Response, assertCurrent = vi.fn()) {
  const fetch = vi.fn(async () => response)
  let signal: AbortSignal | undefined
  const lease: WithCloudTransportLease = async (operation, options) => {
    signal = options?.signal
    signal?.throwIfAborted()
    return operation({ fetch, assertCurrent, userId: 'usr_one' })
  }
  return { fetch, lease, signal: () => signal }
}

describe('cloud space authority transport', () => {
  it('lists only the canonical route and rejects foreign personal spaces or duplicate identities', async () => {
    const fixture = setup(Response.json({ spaces: [space()] }))
    expect(await listCloudSpaces(fixture.lease)).toEqual({ spaces: [space()] })
    expect(fixture.fetch).toHaveBeenCalledWith('/v1/cloud-spaces', { method: 'GET', headers: { accept: 'application/json' } })
    for (const spaces of [[{ ...space(), scope: { kind: 'personal', ownerUserId: 'usr_other' } }], [space(), space()]]) {
      await expect(listCloudSpaces(setup(Response.json({ spaces })).lease)).rejects.toMatchObject({ code: 'cloud_response_invalid' })
    }
  })

  it('ensures personal and project scopes without implicit session creation', async () => {
    const personal = setup(Response.json({ space: { ...space(), status: 'queued' } }, { status: 202 }))
    expect(await ensureCloudSpace({ scope: { kind: 'personal' } }, personal.lease)).toMatchObject({ space: { status: 'queued' } })
    expect(personal.fetch).toHaveBeenCalledWith('/v1/cloud-spaces', expect.objectContaining({
      method: 'POST', body: '{"scope":{"kind":"personal"}}'
    }))
    const project = setup(Response.json({ space: { ...space(), scope: { kind: 'project', projectId: 'prj_one' } } }))
    await ensureCloudSpace({ scope: { kind: 'project', projectId: 'prj_one' }, retryFailed: true }, project.lease)
    expect(project.fetch).toHaveBeenCalledWith('/v1/cloud-spaces', expect.objectContaining({
      body: '{"scope":{"kind":"project","projectId":"prj_one"},"retryFailed":true}'
    }))
  })

  it('rejects mismatched ensure scope, project, owner, and invalid requests before issuing HTTP', async () => {
    for (const scope of [{ kind: 'personal', ownerUserId: 'usr_one' }, { kind: 'project', projectId: 'prj_other' }]) {
      await expect(ensureCloudSpace({ scope: { kind: 'project', projectId: 'prj_one' } },
        setup(Response.json({ space: { ...space(), scope } })).lease)).rejects.toMatchObject({ code: 'cloud_response_invalid' })
    }
    await expect(ensureCloudSpace({ scope: { kind: 'personal' } }, setup(Response.json({ space: {
      ...space(), scope: { kind: 'personal', ownerUserId: 'usr_other' }
    } })).lease)).rejects.toMatchObject({ code: 'cloud_response_invalid' })
    const fixture = setup(Response.json({ space: space() }))
    expect(() => ensureCloudSpace({ scope: { kind: 'personal', ownerUserId: 'usr_other' } } as never, fixture.lease)).toThrow()
    expect(fixture.fetch).not.toHaveBeenCalled()
  })

  it('requests canonical main-only session grants bound to the exact space', async () => {
    const value = grant(), fixture = setup(Response.json(value))
    expect(await createCloudSpaceSession({ spaceId }, fixture.lease)).toEqual(value)
    expect(fixture.fetch).toHaveBeenCalledWith('/v1/cloud-spaces/sessions', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ spaceId })
    }))
    for (const altered of [{ spaceId: `spc_${'b'.repeat(32)}` }, { expiresAt: '2000-01-01T00:00:00.000Z' },
      { bootstrapUrl: 'https://other.example/_sciforge/session' }]) {
      await expect(createCloudSpaceSession({ spaceId }, setup(Response.json({ ...grant(), ...altered })).lease))
        .rejects.toMatchObject({ code: 'cloud_response_invalid' })
    }
  })

  it('maps only the safe not-ready code and never reflects secret-bearing errors', async () => {
    for (const status of [401, 403, 503]) {
      await expect(createCloudSpaceSession({ spaceId }, setup(new Response('SECRET', { status })).lease))
        .rejects.toMatchObject({ code: status === 503 ? 'cloud_unavailable' : 'cloud_rejected', message: expect.not.stringContaining('SECRET') })
    }
    await expect(createCloudSpaceSession({ spaceId }, setup(Response.json({ error: {
      code: 'space_not_ready', message: 'SECRET'
    } }, { status: 409 })).lease)).rejects.toMatchObject({ code: 'space_not_ready', message: expect.not.stringContaining('SECRET') })
  })

  it('bounds response bodies and validates malformed responses', async () => {
    await expect(createCloudSpaceSession({ spaceId }, setup(new Response('x'.repeat(16_385))).lease))
      .rejects.toMatchObject({ code: 'cloud_response_invalid' })
    await expect(listCloudSpaces(setup(new Response('x'.repeat(1_048_577))).lease))
      .rejects.toMatchObject({ code: 'cloud_response_invalid' })
    await expect(ensureCloudSpace({ scope: { kind: 'personal' } }, setup(Response.json({ space: space(), token: 'SECRET' })).lease))
      .rejects.toMatchObject({ code: 'cloud_response_invalid' })
  })

  it('rechecks the identity lease before releasing data', async () => {
    let checks = 0
    const fixture = setup(Response.json(grant()), vi.fn(() => { if (++checks === 7) throw new Error('identity changed') }))
    await expect(createCloudSpaceSession({ spaceId }, fixture.lease)).rejects.toThrow('identity changed')
  })

  it('propagates caller cancellation and imposes a thirty-second deadline', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const fixture = setup(Response.json({ spaces: [] }))
      await listCloudSpaces(fixture.lease, { signal: controller.signal })
      expect(fixture.signal()?.aborted).toBe(false)
      controller.abort()
      expect(fixture.signal()?.aborted).toBe(true)
      const aborted = setup(Response.json(grant()))
      await expect(createCloudSpaceSession({ spaceId }, aborted.lease, { signal: controller.signal })).rejects.toBeDefined()
      expect(aborted.fetch).not.toHaveBeenCalled()
      // Node's AbortSignal timeout is independent of fake timers; inspect the
      // real deadline constructor so the test does not wait for thirty seconds.
      const timeout = vi.spyOn(AbortSignal, 'timeout')
      await listCloudSpaces(setup(Response.json({ spaces: [] })).lease)
      expect(timeout).toHaveBeenCalledWith(30_000)
      timeout.mockRestore()
    } finally { vi.useRealTimers() }
  })
})
