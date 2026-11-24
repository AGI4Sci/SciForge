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
        localAccountSelected: false
      }))
    })

    const login = Array.from(container!.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('cloudSignIn'))
    expect(login).toBeDefined()
    expect(login?.disabled).toBe(true)
    expect(container?.textContent).toContain('cloudLocalAccountRequired')
  })

  it('keeps login visibly pending until the command settles even if the observed state is idle', async () => {
    let rejectLogin!: (reason: Error) => void
    const loginCloud = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectLogin = reject
    }))
    const projection = projectionFixture(snapshotWith(signedOutCloud()), { loginCloud })
    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(CloudIdentitySection, { projection, localAccountSelected: true }))
    })
    const login = Array.from(container!.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('cloudSignIn'))!
    await act(async () => login.click())
    expect(login.disabled).toBe(true)
    expect(login.textContent).toContain('cloudSigningIn')
    expect(container!.querySelector('[role="status"]')?.textContent).toBe('cloudSignInProgress')
    await act(async () => login.click())
    expect(loginCloud).toHaveBeenCalledTimes(1)
    await act(async () => rejectLogin(new Error('Login request timed out')))
    expect(login.disabled).toBe(false)
    expect(login.textContent).toContain('cloudSignIn')
    expect(container!.querySelector('[role="status"]')).toBeNull()
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
        localAccountSelected: true
      }))
    })
    const revoke = Array.from(container!.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('cloudRevokeDevice'))
    await act(async () => revoke?.click())

    expect(revokeCloudDevice).toHaveBeenCalledWith('dev_CloudDevice0001')
  })

  it('explains missing Cloud configuration and offers its settings entry', async () => {
    const projection = projectionFixture(snapshotWith({
      ...signedOutCloud(),
      error: {
        source: 'identity',
        code: 'OIDC_CONFIGURATION_ERROR',
        message: 'SciForge Cloud is not configured.'
      }
    }))

    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(CloudIdentitySection, {
        projection,
        localAccountSelected: true
      }))
    })

    const alert = container!.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe('cloudErrorConfiguration')
    const configure = Array.from(container!.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('cloudSettingsOpen'))
    expect(configure).toBeDefined()

    await act(async () => configure?.click())
    await act(async () => undefined)

    expect(container!.textContent).toContain('cloudSettingsTitle')
    expect(container!.textContent).toContain('cloudSettingsMissing')
    // The form labels both fields; the cloudSettingsField* keys only appear in
    // the missing-field list when the projection reports what is absent.
    expect(container!.textContent).toContain('cloudSettingsOidcIssuer')
    expect(container!.textContent).toContain('cloudSettingsCloudBaseUrl')

    await act(async () => {
      const save = Array.from(container!.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('save'))
      save?.click()
    })
    expect(projection.configureCloud).toHaveBeenCalled()
  })

  it.each([
    ['discovery', 'cloudErrorStageDiscovery', 'UND_ERR_CONNECT_TIMEOUT'],
    ['token exchange', 'cloudErrorStageTokenExchange', 'ECONNRESET'],
    ['signing keys', 'cloudErrorStageSigningKeys', 'TimeoutError']
  ])('offers collapsed safe diagnostics for %s without replacing the friendly message', async (stage, stageKey, code) => {
    const projection = projectionFixture(snapshotWith({
      ...signedOutCloud(),
      error: {
        source: 'identity',
        code: 'OIDC_PROVIDER_UNAVAILABLE',
        message: `Cannot reach the SciForge login service (${stage}: network request timed out [${code}]).`
      }
    }))
    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(CloudIdentitySection, { projection, localAccountSelected: true }))
    })
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe('cloudErrorProviderUnavailable')
    const details = container!.querySelector('details')!
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toBe('cloudErrorDetails')
    await act(async () => { details.open = true })
    expect(details.textContent).toContain('OIDC_PROVIDER_UNAVAILABLE')
    expect(details.textContent).toContain(stageKey)
    expect(details.textContent).toContain(code)
    expect(details.textContent).not.toContain('Cannot reach the SciForge')
  })

  it('extracts only bounded allowlisted diagnostic values, never upstream text', async () => {
    const projection = projectionFixture(snapshotWith({
      ...signedOutCloud(),
      error: {
        source: 'identity',
        code: 'OIDC_PROVIDER_UNAVAILABLE',
        message: 'Cannot reach the SciForge login service (discovery: Bearer private-token https://private.example/?code=secret [NOT_SAFE] [ECONNRESET]; connection timed out [UND_ERR_CONNECT_TIMEOUT]).'
      }
    }))
    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(CloudIdentitySection, { projection, localAccountSelected: true }))
    })
    const text = container!.textContent!
    expect(text).toContain('ECONNRESET, UND_ERR_CONNECT_TIMEOUT')
    for (const secret of ['Bearer', 'private-token', 'private.example', 'secret', 'NOT_SAFE']) {
      expect(container!.innerHTML).not.toContain(secret)
    }
  })

  it.each([
    ['OIDC_TOKEN_INVALID', 'https://private.example/token?secret=abcdef'],
    ['OIDC_CALLBACK_INVALID', 'Bearer private-token'],
    ['OIDC_PROVIDER_UNAVAILABLE', 'Cannot reach the SciForge login service (unknown stage: secret [ECONNRESET]).'],
    ['OIDC_PROVIDER_UNAVAILABLE', `Cannot reach the SciForge login service (discovery: ${'x'.repeat(1001)} [ECONNRESET]).`]
  ] as const)('hides arbitrary %s messages and leaves only the known OIDC code', async (code, message) => {
    const projection = projectionFixture(snapshotWith({
      ...signedOutCloud(), error: { source: 'identity', code, message }
    }))
    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(CloudIdentitySection, { projection, localAccountSelected: true }))
    })
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe(
      code === 'OIDC_PROVIDER_UNAVAILABLE' ? 'cloudErrorProviderUnavailable' : 'cloudErrorGeneric'
    )
    const details = container!.querySelector('details')!
    expect(details.textContent).toContain(code)
    expect(details.textContent).not.toContain('cloudErrorStage:')
    expect(details.textContent).not.toContain('ECONNRESET')
    expect(container!.innerHTML).not.toContain(message)
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
        onClose: vi.fn()
      }))
    })

    let alerts = container!.querySelectorAll('[role="alert"]')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.textContent).toBe('cloudErrorProviderUnavailable')

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
        onClose: vi.fn()
      }))
    })

    alerts = container!.querySelectorAll('[role="alert"]')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.textContent).toBe(transportError)
  })
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
    inspectCloudConfiguration: vi.fn(async () => cloudConfigurationFixture()),
    configureCloud: vi.fn(async () => cloudConfigurationFixture()),
    ...overrides
  } as unknown as IdentityRendererProjection
}

function cloudConfigurationFixture() {
  return {
    configured: false,
    oidcIssuer: null,
    cloudBaseUrl: null,
    source: { oidcIssuer: null, cloudBaseUrl: null },
    missing: ['oidcIssuer', 'cloudBaseUrl'] as const,
    invalid: [] as const,
    storage: 'available' as const
  }
}

function signedOutCloud(): CloudIdentitySnapshot {
  return {
    identity: { state: 'signed-out' },
    device: { state: 'signed-out' },
    devices: [],
    revision: 'cloud-1'
  }
}

function activeCloud(): CloudIdentitySnapshot {
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
        issuer: 'https://login-test.sciforge.cn/realms/SciForge',
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
