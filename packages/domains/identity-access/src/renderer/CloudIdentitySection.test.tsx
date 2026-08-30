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
      }))
    })

    alerts = container!.querySelectorAll('[role="alert"]')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.textContent).toBe(transportError)
  })

  it('invokes account deletion only after confirmation without invoking cloud logout', async () => {
    const logoutCloud = vi.fn(async () => undefined)
    const openCloudAccountDeletion = vi.fn(async () => undefined)
    const projection = projectionFixture(snapshotWith(activeCloud()), {
      logoutCloud,
      openCloudAccountDeletion
    })

    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(CloudIdentitySection, {
        projection,
        localAccountSelected: true,
      }))
    })

    const deleteButton = findButton('cloudDeleteAccount')
    expect(deleteButton).toBeDefined()
    await act(async () => deleteButton?.click())
    expect(findButton('cloudDeleteContinue')).toBeDefined()
    expect(openCloudAccountDeletion).not.toHaveBeenCalled()

    await act(async () => findButton('cloudDeleteContinue')?.click())
    expect(openCloudAccountDeletion).toHaveBeenCalledOnce()
    expect(logoutCloud).not.toHaveBeenCalled()
  })

  it('does not expose account deletion while signed out', async () => {
    const projection = projectionFixture(snapshotWith(signedOutCloud()))

    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(CloudIdentitySection, {
        projection,
        localAccountSelected: true,
      }))
    })

    expect(findButton('cloudDeleteAccount')).toBeUndefined()
  })

  it('surfaces a trusted account URL failure from the Identity capability', async () => {
    const openCloudAccountDeletion = vi.fn(async () => {
      throw new Error('The configured Keycloak issuer must be a clean HTTPS URL.')
    })
    const projection = projectionFixture(
      snapshotWith(activeCloud({ issuer: 'http://untrusted.example/realms/SciForge' })),
      { openCloudAccountDeletion }
    )

    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(CloudIdentitySection, {
        projection,
        localAccountSelected: true,
      }))
    })

    await act(async () => findButton('cloudDeleteAccount')?.click())
    await act(async () => findButton('cloudDeleteContinue')?.click())

    expect(openCloudAccountDeletion).toHaveBeenCalledOnce()
    expect(container!.querySelector('[role="alert"]')?.textContent)
      .toContain('clean HTTPS URL')
  })

  it('invalidates a pending confirmation when the Cloud identity or Device changes', async () => {
    const firstProjection = projectionFixture(snapshotWith(activeCloud()))
    const secondOpen = vi.fn(async () => undefined)
    const secondProjection = projectionFixture(
      snapshotWith(activeCloud({
        userId: 'usr_CloudUser000002',
        subject: 'keycloak-subject-b',
        deviceId: 'dev_CloudDevice0002',
        revision: 'cloud-3'
      })),
      { openCloudAccountDeletion: secondOpen }
    )

    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(CloudIdentitySection, {
        projection: firstProjection,
        localAccountSelected: true
      }))
    })
    await act(async () => findButton('cloudDeleteAccount')?.click())
    expect(findButton('cloudDeleteContinue')).toBeDefined()

    await act(async () => {
      root?.render(createElement(CloudIdentitySection, {
        projection: secondProjection,
        localAccountSelected: true
      }))
    })

    expect(findButton('cloudDeleteContinue')).toBeUndefined()
    expect(container!.textContent).toContain('cloudDeleteIdentityChanged')
    expect(secondOpen).not.toHaveBeenCalled()
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
    openCloudAccountDeletion: vi.fn(async () => undefined),
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

function activeCloud(options: Readonly<{
  issuer?: string
  userId?: string
  subject?: string
  deviceId?: string
  revision?: string
}> = {}): CloudIdentitySnapshot {
  const device = {
    deviceId: options.deviceId ?? 'dev_CloudDevice0001',
    displayName: 'Lab Desktop',
    status: 'active' as const,
    platform: { os: 'windows' as const, arch: 'x64' as const, appVersion: '0.2.17' },
    activatedAt: '2026-08-21T00:00:00.000Z'
  }
  return {
    identity: {
      state: 'signed-in',
      user: {
        userId: options.userId ?? 'usr_CloudUser000001',
        oidcIdentityId: 'oid_CloudIdent0001',
        issuer: options.issuer ?? 'https://login-test.sciforge.cn/realms/SciForge',
        subject: options.subject ?? 'keycloak-subject-a',
        displayName: 'Cloud Person'
      },
      accessTokenExpiresAt: '2026-08-21T20:00:00.000Z'
    },
    device: { state: 'active', device },
    devices: [device],
    revision: options.revision ?? 'cloud-2'
  }
}
