// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SciForgeApi } from '@shared/sciforge-api'
import type {
  DesktopDeviceStatus,
  DesktopIdentityStatus
} from '@shared/desktop-identity'
import i18n from '../../i18n'
import { DesktopIdentityControl } from './DesktopIdentityControl'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('DesktopIdentityControl', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    Reflect.deleteProperty(window, 'sciforge')
    vi.restoreAllMocks()
    root = null
    container = null
  })

  it('applies live main-process status and ignores a stale initial query', async () => {
    let identityListener: ((status: DesktopIdentityStatus) => void) | undefined
    let deviceListener: ((status: DesktopDeviceStatus) => void) | undefined
    let resolveInitialStatus: ((status: DesktopIdentityStatus) => void) | undefined
    const initialStatus = new Promise<DesktopIdentityStatus>((resolve) => {
      resolveInitialStatus = resolve
    })
    const stopIdentity = vi.fn()
    const stopDevice = vi.fn()
    const identity = {
      getStatus: vi.fn(() => initialStatus),
      login: vi.fn(),
      reauthenticate: vi.fn(),
      logout: vi.fn(),
      onStatusChanged: (listener: (status: DesktopIdentityStatus) => void) => {
        identityListener = listener
        return stopIdentity
      },
      getDeviceStatus: vi.fn(async (): Promise<DesktopDeviceStatus> => ({ state: 'signed-out' })),
      onDeviceStatusChanged: (listener: (status: DesktopDeviceStatus) => void) => {
        deviceListener = listener
        return stopDevice
      },
      listDevices: vi.fn(),
      enrollDevice: vi.fn(),
      refreshDevices: vi.fn(),
      revokeDevice: vi.fn()
    }
    Object.assign(window, {
      sciforge: { identity } as unknown as SciForgeApi
    })

    await act(async () => {
      root = createRoot(container!)
      root.render(createElement(DesktopIdentityControl))
    })
    expect(container?.querySelector('button')?.getAttribute('aria-label')).toBe('Sign in')

    await act(async () => {
      identityListener?.(signedInStatus())
    })
    expect(container?.textContent).toContain('Cloud Person')

    await act(async () => {
      resolveInitialStatus?.({ state: 'signed-out' })
      await initialStatus
    })
    expect(container?.textContent).toContain('Cloud Person')

    await act(async () => {
      deviceListener?.({ state: 'not-enrolled' })
      identityListener?.({ state: 'signed-out' })
    })
    expect(container?.querySelector('button')?.getAttribute('aria-label')).toBe('Sign in')

    await act(async () => root?.unmount())
    root = null
    expect(stopIdentity).toHaveBeenCalledOnce()
    expect(stopDevice).toHaveBeenCalledOnce()
  })
})

function signedInStatus(): DesktopIdentityStatus {
  return {
    state: 'signed-in',
    user: {
      userId: 'usr_CloudUser000001',
      oidcIdentityId: 'oid_CloudIdent0001',
      issuer: 'https://login-test.sciforge.cn/realms/SciForge',
      subject: 'keycloak-subject-a',
      displayName: 'Cloud Person'
    },
    accessTokenExpiresAt: '2026-08-20T20:00:00.000Z'
  }
}
