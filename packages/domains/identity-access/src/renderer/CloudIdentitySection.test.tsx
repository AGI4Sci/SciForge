// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudIdentitySnapshot } from '../contract.js'
import { CloudIdentitySection } from './CloudIdentitySection.js'
import { IdentityAccountOverlay } from './IdentityAccountOverlay.js'
import type {
  IdentityProjectionSnapshot,
  IdentityRendererProjection
} from './projection.js'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('CloudIdentitySection', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('requires a selected Local Account before browser login', async () => {
    const projection = projectionFixture(snapshotWith(signedOutCloud()))

    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(CloudIdentitySection, {
        projection,
        localAccountSelected: false,
        openAccount: vi.fn()
      }))
    })

    const login = Array.from(container!.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('cloudSignIn'))
    expect(login).toBeDefined()
    expect(login?.disabled).toBe(true)
    expect(container?.textContent).toContain('cloudLocalAccountRequired')
  })

  it('revokes the active Device only through the domain projection', async () => {
    const revokeCloudDevice = vi.fn(async () => undefined)
    const projection = projectionFixture(snapshotWith(activeCloud()), {
      revokeCloudDevice
    })

    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(CloudIdentitySection, {
        projection,
        localAccountSelected: true,
        openAccount: vi.fn()
      }))
    })
    const revoke = Array.from(container!.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('cloudRevokeDevice'))
    await act(async () => revoke?.click())

    expect(revokeCloudDevice).toHaveBeenCalledWith('dev_CloudDevice0001')
  })

  it('renders Cloud domain and transport errors through one alert each', async () => {
    const cloudError = 'Cloud identity is unavailable.'
    const projection = projectionFixture(snapshotWith({
      ...signedOutCloud(),
      error: {
        source: 'identity',
        code: 'OIDC_PROVIDER_UNAVAILABLE',
        message: cloudError
      }
    }))

    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(IdentityAccountOverlay, {
        projection,
        firstRun: false,
        onClose: vi.fn(),
        openAccount: vi.fn()
      }))
    })

    let alerts = container!.querySelectorAll('[role="alert"]')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.textContent).toBe(cloudError)

    await act(async () => root?.unmount())
    root = null
    const transportError = 'Cloud transport failed.'
    const transportProjection = projectionFixture({
      ...snapshotWith(signedOutCloud()),
      error: transportError
    })
    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(IdentityAccountOverlay, {
        projection: transportProjection,
        firstRun: false,
        onClose: vi.fn(),
        openAccount: vi.fn()
      }))
    })

    alerts = container!.querySelectorAll('[role="alert"]')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.textContent).toBe(transportError)
  })

  it('opens the trusted account portal only after confirmation without invoking cloud logout', async () => {
    const logoutCloud = vi.fn(async () => undefined)
    const openAccount = vi.fn(async (_url: string) => undefined)
    const projection = projectionFixture(snapshotWith(activeCloud()), { logoutCloud })

    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(CloudIdentitySection, {
        projection,
        localAccountSelected: true,
        openAccount
      }))
    })

    const deleteButton = findButton('cloudDeleteAccount')
    expect(deleteButton).toBeDefined()
    await act(async () => deleteButton?.click())
    expect(findButton('cloudDeleteContinue')).toBeDefined()
    expect(openAccount).not.toHaveBeenCalled()

    await act(async () => findButton('cloudDeleteContinue')?.click())
    expect(openAccount).toHaveBeenCalledWith(
      'https://login-test.sciforge.cn/realms/SciForge/account/'
    )
    expect(logoutCloud).not.toHaveBeenCalled()
    expect(String(openAccount.mock.calls[0]?.[0])).not.toContain('usr_')
  })

  it('does not expose account deletion while signed out', async () => {
    const projection = projectionFixture(snapshotWith(signedOutCloud()))

    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(CloudIdentitySection, {
        projection,
        localAccountSelected: true,
        openAccount: vi.fn()
      }))
    })

    expect(findButton('cloudDeleteAccount')).toBeUndefined()
  })

  it('fails closed when the identity issuer cannot produce a trusted account URL', async () => {
    const openAccount = vi.fn()
    const projection = projectionFixture(
      snapshotWith(activeCloud('http://untrusted.example/realms/SciForge'))
    )

    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(CloudIdentitySection, {
        projection,
        localAccountSelected: true,
        openAccount
      }))
    })

    await act(async () => findButton('cloudDeleteAccount')?.click())
    await act(async () => findButton('cloudDeleteContinue')?.click())

    expect(openAccount).not.toHaveBeenCalled()
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe('cloudDeleteUnavailable')
  })

  function findButton(label: string): HTMLButtonElement | undefined {
    return Array.from(container!.querySelectorAll('button'))
      .find((button) => button.textContent?.includes(label)) as HTMLButtonElement | undefined
  }
})

function snapshotWith(cloud: CloudIdentitySnapshot): IdentityProjectionSnapshot {
  return {
    loading: false,
    state: null,
    accounts: [],
    cloud,
    cloudResource: {
      token: `cap_${'a'.repeat(24)}`,
      semanticRevision: cloud.revision,
      expiresAt: '2027-08-21T00:00:00.000Z'
    },
    cloudLoading: false,
    error: null
  }
}

function projectionFixture(
  snapshot: IdentityProjectionSnapshot,
  overrides: Partial<IdentityRendererProjection> = {}
): IdentityRendererProjection {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    load: vi.fn(async () => snapshot),
    createAccount: vi.fn(),
    selectAccount: vi.fn(),
    renameAccount: vi.fn(),
    exitAccount: vi.fn(),
    dismissFirstPrompt: vi.fn(),
    backupAndReset: vi.fn(),
    loginCloud: vi.fn(),
    reauthenticateCloud: vi.fn(),
    logoutCloud: vi.fn(),
    enrollCloudDevice: vi.fn(),
    refreshCloudDevices: vi.fn(),
    revokeCloudDevice: vi.fn(),
    ...overrides
  } as unknown as IdentityRendererProjection
}

function signedOutCloud(): CloudIdentitySnapshot {
  return {
    identity: { state: 'signed-out' },
    device: { state: 'signed-out' },
    devices: [],
    revision: 'cloud-1'
  }
}

function activeCloud(issuer = 'https://login-test.sciforge.cn/realms/SciForge'): CloudIdentitySnapshot {
  const device = {
    deviceId: 'dev_CloudDevice0001',
    displayName: 'Lab Desktop',
    status: 'active' as const,
    platform: { os: 'windows' as const, arch: 'x64' as const, appVersion: '0.2.17' },
    activatedAt: '2026-08-21T00:00:00.000Z'
  }
  return {
    identity: {
      state: 'signed-in',
      user: {
        userId: 'usr_CloudUser000001',
        oidcIdentityId: 'oid_CloudIdent0001',
        issuer,
        subject: 'keycloak-subject-a',
        displayName: 'Cloud Person'
      },
      accessTokenExpiresAt: '2026-08-21T20:00:00.000Z'
    },
    device: { state: 'active', device },
    devices: [device],
    revision: 'cloud-2'
  }
}
