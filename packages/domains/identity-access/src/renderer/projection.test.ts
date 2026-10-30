import { describe, expect, it, vi } from 'vitest'
import type {
  CloudIdentitySnapshot,
  IdentityAvailableState
} from '../contract.js'
import type { IdentityRendererClient } from './client.js'
import { IdentityRendererProjection } from './projection.js'

const signedOut = {
  status: 'available' as const,
  identityVersion: 0,
  currentAccount: null,
  accountCount: 0,
  firstPromptDismissed: false
}

const cloudSignedOut: CloudIdentitySnapshot = {
  identity: { state: 'signed-out' },
  device: { state: 'signed-out' },
  devices: [],
  revision: 'cloud-1'
}

const cloudResource = {
  token: `cap_${'a'.repeat(24)}`,
  semanticRevision: 'cloud-1',
  expiresAt: '2027-08-21T00:00:00.000Z'
}

describe('IdentityRendererProjection', () => {
  it('keeps a non-authoritative capability-backed projection without local persistence', async () => {
    const client: IdentityRendererClient = clientFixture({
      listAccounts: vi.fn(async () => ({ state: signedOut, accounts: [] })),
      inspect: vi.fn(async () => signedOut)
    })
    const projection = new IdentityRendererProjection(client)
    const listener = vi.fn()
    const dispose = projection.subscribe(listener)
    await projection.load()
    expect(projection.getSnapshot()).toEqual({
      loading: false,
      state: signedOut,
      accounts: [],
      cloud: cloudSignedOut,
      cloudResource,
      cloudLoading: false,
      error: null
    })
    expect(client.listAccounts).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalled()
    dispose()
    projection.dispose()
  })

  it('refreshes restored/switch/exit state from main and surfaces rename conflicts', async () => {
    const alice = {
      userId: 'c07f29ee-801d-4cf3-90ef-96c56c65de21',
      username: 'Alice',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z'
    }
    let state: IdentityAvailableState = {
      ...signedOut,
      identityVersion: 1,
      accountCount: 1,
      currentAccount: alice
    }
    const client: IdentityRendererClient = clientFixture({
      listAccounts: vi.fn(async () => ({ state, accounts: [alice] })),
      selectAccount: vi.fn(async () => state),
      renameAccount: vi.fn(async () => { throw new Error('username conflict') }),
      exitAccount: vi.fn(async () => {
        state = { ...state, identityVersion: 2, currentAccount: null }
        return state
      }),
      dismissFirstPrompt: vi.fn(async () => state),
      inspect: vi.fn(async () => state)
    })
    const projection = new IdentityRendererProjection(client)
    await projection.load()
    expect(projection.getSnapshot().state).toMatchObject({ currentAccount: { username: 'Alice' } })
    await expect(projection.renameAccount(alice.userId, 'ALICE')).rejects.toThrow('username conflict')
    expect(projection.getSnapshot().error).toContain('username conflict')
    await projection.exitAccount()
    expect(projection.getSnapshot().state).toMatchObject({ currentAccount: null, identityVersion: 2 })
  })

  it('retains a committed account creation when the post-write list refresh fails', async () => {
    const account = {
      userId: '9c5c66c8-64ba-4485-8fee-3449d84d26c7',
      username: 'Alice',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z'
    }
    const committed: IdentityAvailableState = {
      ...signedOut,
      identityVersion: 1,
      accountCount: 1,
      currentAccount: account
    }
    const client: IdentityRendererClient = clientFixture({
      inspect: vi.fn(async () => committed),
      listAccounts: vi.fn(async () => { throw new Error('refresh failed') }),
      createAccount: vi.fn(async () => committed)
    })
    const projection = new IdentityRendererProjection(client)

    await expect(projection.createAccount('Alice')).resolves.toBeUndefined()

    expect(client.createAccount).toHaveBeenCalledOnce()
    expect(client.listAccounts).toHaveBeenCalledOnce()
    expect(projection.getSnapshot()).toMatchObject({
      loading: false,
      state: committed,
      error: 'refresh failed'
    })
  })

  it('recovers unavailable state only through backup-and-reset and retains the backup path', async () => {
    const unavailable = {
      status: 'unavailable' as const,
      reason: 'integrity-failed' as const,
      recoveryAvailable: true
    }
    const recovered = { ...signedOut, identityVersion: 1, firstPromptDismissed: false }
    const client: IdentityRendererClient = clientFixture({
      listAccounts: vi.fn(async () => ({ state: unavailable, accounts: [] })),
      backupAndReset: vi.fn(async () => ({
        state: recovered,
        backupPath: '/backup/identity.sqlite'
      })),
      inspect: vi.fn(async () => unavailable)
    })
    const projection = new IdentityRendererProjection(client)
    await projection.load()
    await expect(projection.backupAndReset('RESET LOCAL IDENTITY'))
      .resolves.toBe('/backup/identity.sqlite')
    expect(projection.getSnapshot()).toMatchObject({ state: recovered, accounts: [], error: null })
  })

  it('refreshes on provider changes and ignores an older observation that rejects late', async () => {
    const older = deferred<Awaited<ReturnType<IdentityRendererClient['observeCloud']>>>()
    const updatedCloud: CloudIdentitySnapshot = {
      ...cloudSignedOut,
      revision: 'cloud-2'
    }
    const updatedResource = {
      ...cloudResource,
      semanticRevision: 'cloud-2'
    }
    let notifyChange: (() => void) | undefined
    let observeCount = 0
    const observeCloud = vi.fn(() => {
      observeCount += 1
      if (observeCount === 1) {
        return Promise.resolve({
          resource: cloudResource,
          resourceRef: `res_${'b'.repeat(24)}`,
          resourceKind: 'identity.cloud-session',
          semanticRevision: 'cloud-1',
          observedAt: '2026-08-21T00:00:00.000Z',
          state: cloudSignedOut
        })
      }
      if (observeCount === 2) return older.promise
      return Promise.resolve({
        resource: updatedResource,
        resourceRef: `res_${'b'.repeat(24)}`,
        resourceKind: 'identity.cloud-session',
        semanticRevision: 'cloud-2',
        observedAt: '2026-08-21T00:00:01.000Z',
        state: updatedCloud
      })
    })
    const client = clientFixture({
      observeCloud,
      subscribeCloud: vi.fn(async (_resourceRef, listener) => {
        notifyChange = listener
        return vi.fn()
      })
    })
    const projection = new IdentityRendererProjection(client)

    await projection.load()
    await vi.waitFor(() => expect(observeCloud).toHaveBeenCalledTimes(2))
    notifyChange?.()
    await vi.waitFor(() => expect(projection.getSnapshot()).toMatchObject({
      cloud: { revision: 'cloud-2' },
      cloudResource: { semanticRevision: 'cloud-2' },
      error: null
    }))

    older.reject(new Error('stale observation failed'))
    await Promise.resolve()
    await Promise.resolve()
    expect(projection.getSnapshot()).toMatchObject({
      cloud: { revision: 'cloud-2' },
      cloudResource: { semanticRevision: 'cloud-2' },
      error: null
    })
    projection.dispose()
  })

  it('re-inspects after a global mutation without accepting its response as renderer authority', async () => {
    const mutation = deferred<CloudIdentitySnapshot>()
    const providerCloud: CloudIdentitySnapshot = {
      ...cloudSignedOut,
      revision: 'cloud-2'
    }
    const inspectedCloud: CloudIdentitySnapshot = {
      ...cloudSignedOut,
      revision: 'cloud-3'
    }
    const inspectedResource = {
      ...cloudResource,
      token: `cap_${'c'.repeat(24)}`,
      semanticRevision: 'cloud-3'
    }
    let notifyChange: (() => void) | undefined
    let observeCount = 0
    const inspectCloud = vi.fn()
      .mockResolvedValueOnce({ snapshot: cloudSignedOut, resource: cloudResource })
      .mockResolvedValueOnce({ snapshot: inspectedCloud, resource: inspectedResource })
    const client = clientFixture({
      inspectCloud,
      loginCloud: vi.fn(() => mutation.promise),
      observeCloud: vi.fn(async (resource) => {
        observeCount += 1
        const reissued = resource.semanticRevision === 'cloud-3'
        const updated = !reissued && observeCount > 2
        return {
          resource: updated ? { ...resource, semanticRevision: 'cloud-2' } : resource,
          resourceRef: `res_${'b'.repeat(24)}`,
          resourceKind: 'identity.cloud-session',
          semanticRevision: updated ? 'cloud-2' : resource.semanticRevision,
          observedAt: '2026-08-21T00:00:00.000Z',
          state: reissued ? inspectedCloud : updated ? providerCloud : cloudSignedOut
        }
      }),
      subscribeCloud: vi.fn(async (_resourceRef, listener) => {
        notifyChange = listener
        return vi.fn()
      })
    })
    const projection = new IdentityRendererProjection(client)
    const observedRevisions: string[] = []
    projection.subscribe(() => {
      const revision = projection.getSnapshot().cloud?.revision
      if (revision) observedRevisions.push(revision)
    })

    await projection.load()
    await vi.waitFor(() => expect(notifyChange).toBeTypeOf('function'))
    const login = projection.loginCloud()
    notifyChange?.()
    await vi.waitFor(() => expect(projection.getSnapshot().cloud?.revision).toBe('cloud-2'))

    mutation.resolve({ ...cloudSignedOut, revision: 'mutation-response' })
    await login

    expect(client.loginCloud).toHaveBeenCalledWith()
    expect(inspectCloud).toHaveBeenCalledTimes(2)
    expect(observedRevisions).not.toContain('mutation-response')
    expect(projection.getSnapshot()).toMatchObject({
      cloud: { revision: 'cloud-3' },
      cloudResource: {
        token: inspectedResource.token,
        semanticRevision: 'cloud-3'
      },
      cloudLoading: false,
      error: null
    })
    projection.dispose()
  })

  it('ignores an older global mutation response after a newer mutation has re-inspected', async () => {
    const older = deferred<CloudIdentitySnapshot>()
    const newer = deferred<CloudIdentitySnapshot>()
    const currentCloud: CloudIdentitySnapshot = {
      ...cloudSignedOut,
      revision: 'cloud-current'
    }
    const currentResource = {
      ...cloudResource,
      token: `cap_${'d'.repeat(24)}`,
      semanticRevision: 'cloud-current'
    }
    const inspectCloud = vi.fn()
      .mockResolvedValueOnce({ snapshot: cloudSignedOut, resource: cloudResource })
      .mockResolvedValueOnce({ snapshot: currentCloud, resource: currentResource })
    const client = clientFixture({
      inspectCloud,
      refreshCloudDevices: vi.fn(() => older.promise),
      logoutCloud: vi.fn(() => newer.promise),
      observeCloud: vi.fn(async (resource) => ({
        resource,
        resourceRef: `res_${'b'.repeat(24)}`,
        resourceKind: 'identity.cloud-session',
        semanticRevision: resource.semanticRevision,
        observedAt: '2026-08-21T00:00:00.000Z',
        state: resource.semanticRevision === 'cloud-current' ? currentCloud : cloudSignedOut
      }))
    })
    const projection = new IdentityRendererProjection(client)

    await projection.load()
    const oldRefresh = projection.refreshCloudDevices()
    const currentLogout = projection.logoutCloud()
    newer.resolve({ ...cloudSignedOut, revision: 'newer-response' })
    await currentLogout
    older.resolve({ ...cloudSignedOut, revision: 'older-response' })
    await oldRefresh

    expect(client.refreshCloudDevices).toHaveBeenCalledWith()
    expect(client.logoutCloud).toHaveBeenCalledWith()
    expect(inspectCloud).toHaveBeenCalledTimes(2)
    expect(projection.getSnapshot()).toMatchObject({
      cloud: { revision: 'cloud-current' },
      cloudResource: { token: currentResource.token },
      error: null
    })
    projection.dispose()
  })

  it('does not let a deferred initial inspection replace a newer re-issued resource', async () => {
    const initialInspection = deferred<Awaited<ReturnType<IdentityRendererClient['inspectCloud']>>>()
    const currentCloud: CloudIdentitySnapshot = {
      ...cloudSignedOut,
      revision: 'cloud-current'
    }
    const currentResource = {
      ...cloudResource,
      token: `cap_${'e'.repeat(24)}`,
      semanticRevision: 'cloud-current'
    }
    const inspectCloud = vi.fn()
      .mockImplementationOnce(() => initialInspection.promise)
      .mockResolvedValueOnce({ snapshot: currentCloud, resource: currentResource })
    const observeCloud = vi.fn(async (resource) => ({
      resource,
      resourceRef: `res_${'b'.repeat(24)}`,
      resourceKind: 'identity.cloud-session',
      semanticRevision: resource.semanticRevision,
      observedAt: '2026-08-21T00:00:00.000Z',
      state: resource.semanticRevision === 'cloud-current' ? currentCloud : cloudSignedOut
    }))
    const client = clientFixture({ inspectCloud, observeCloud })
    const projection = new IdentityRendererProjection(client)

    const loading = projection.load()
    await vi.waitFor(() => expect(inspectCloud).toHaveBeenCalledOnce())
    await projection.refreshCloudDevices()
    initialInspection.resolve({ snapshot: cloudSignedOut, resource: cloudResource })
    await loading
    await vi.waitFor(() => expect(projection.getSnapshot().cloud?.revision).toBe('cloud-current'))

    expect(inspectCloud).toHaveBeenCalledTimes(2)
    expect(observeCloud).not.toHaveBeenCalledWith(cloudResource)
    expect(projection.getSnapshot()).toMatchObject({
      cloud: { revision: 'cloud-current' },
      cloudResource: { token: currentResource.token }
    })
    projection.dispose()
  })

  it('does not observe or subscribe when an initial inspection resolves after disposal', async () => {
    const initialInspection = deferred<Awaited<ReturnType<IdentityRendererClient['inspectCloud']>>>()
    const observeCloud = vi.fn<IdentityRendererClient['observeCloud']>()
    const subscribeCloud = vi.fn<NonNullable<IdentityRendererClient['subscribeCloud']>>()
    const client = clientFixture({
      inspectCloud: vi.fn(() => initialInspection.promise),
      observeCloud,
      subscribeCloud
    })
    const projection = new IdentityRendererProjection(client)
    const listener = vi.fn()
    projection.subscribe(listener)

    const loading = projection.load()
    projection.dispose()
    initialInspection.resolve({ snapshot: cloudSignedOut, resource: cloudResource })
    await loading

    expect(observeCloud).not.toHaveBeenCalled()
    expect(subscribeCloud).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledOnce()
  })

  it('keeps Cloud domain errors in the Cloud snapshot and transport failures in projection error', async () => {
    const cloudWithError: CloudIdentitySnapshot = {
      ...cloudSignedOut,
      error: {
        source: 'identity',
        code: 'OIDC_PROVIDER_UNAVAILABLE',
        message: 'Cloud identity is unavailable.'
      }
    }
    const domainProjection = new IdentityRendererProjection(clientFixture({
      inspectCloud: vi.fn(async () => ({
        snapshot: cloudWithError,
        resource: cloudResource
      })),
      observeCloud: vi.fn(async () => ({
        resource: cloudResource,
        resourceRef: `res_${'b'.repeat(24)}`,
        resourceKind: 'identity.cloud-session',
        semanticRevision: 'cloud-1',
        observedAt: '2026-08-21T00:00:00.000Z',
        state: cloudWithError
      }))
    }))

    await domainProjection.load()
    await vi.waitFor(() => expect(domainProjection.getSnapshot()).toMatchObject({
      cloud: { error: { message: 'Cloud identity is unavailable.' } },
      error: null
    }))
    domainProjection.dispose()

    const transportProjection = new IdentityRendererProjection(clientFixture({
      inspectCloud: vi.fn(async () => {
        throw new Error('Cloud transport failed.')
      })
    }))
    await transportProjection.load()
    expect(transportProjection.getSnapshot()).toMatchObject({
      cloud: null,
      error: 'Cloud transport failed.'
    })
    transportProjection.dispose()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function clientFixture(
  overrides: Partial<IdentityRendererClient> = {}
): IdentityRendererClient {
  return {
    inspect: vi.fn(async () => signedOut),
    listAccounts: vi.fn(async () => ({ state: signedOut, accounts: [] })),
    createAccount: vi.fn(),
    selectAccount: vi.fn(),
    renameAccount: vi.fn(),
    exitAccount: vi.fn(),
    dismissFirstPrompt: vi.fn(),
    backupAndReset: vi.fn(),
    inspectCloud: vi.fn(async () => ({
      snapshot: cloudSignedOut,
      resource: cloudResource
    })),
    observeCloud: vi.fn(async () => ({
      resource: cloudResource,
      resourceRef: `res_${'b'.repeat(24)}`,
      resourceKind: 'identity.cloud-session',
      semanticRevision: 'cloud-1',
      observedAt: '2026-08-21T00:00:00.000Z',
      state: cloudSignedOut
    })),
    loginCloud: vi.fn(async () => cloudSignedOut),
    reauthenticateCloud: vi.fn(async () => cloudSignedOut),
    logoutCloud: vi.fn(async () => cloudSignedOut),
    enrollCloudDevice: vi.fn(async () => cloudSignedOut),
    refreshCloudDevices: vi.fn(async () => cloudSignedOut),
    revokeCloudDevice: vi.fn(async () => cloudSignedOut),
    ...overrides
  }
}
