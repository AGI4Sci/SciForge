// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DomainRendererHost,
  DomainWorkbenchToggleGlobalOverlayInput
} from '@sciforge/domain-sdk/host'
import {
  IDENTITY_CAPABILITY_IDS,
  type CloudIdentitySnapshot,
  type IdentityAvailableState
} from '../contract.js'
import { AccountSidebarSection } from './AccountSidebarSection.js'
import { createDomainRendererEntry } from './index.js'
import { identityI18nResourceContribution } from './messages.js'
import type {
  IdentityProjectionSnapshot,
  IdentityRendererProjection
} from './projection.js'
import { AccountUsageProjection } from './usage.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const mountedRoots = new Set<Readonly<{ root: Root; container: HTMLElement }>>()

beforeEach(() => {
  vi.stubGlobal('sciforge', {
    agentRuntime: { usage: vi.fn(async () => ({ supported: false })) }
  })
})

afterEach(async () => {
  for (const mounted of mountedRoots) {
    await act(async () => mounted.root.unmount())
    mounted.container.remove()
  }
  mountedRoots.clear()
  vi.unstubAllGlobals()
})

describe('Account sidebar section', () => {
  it('shows the signed-in Local Account and opens the account overlay', async () => {
    const onOpenAccount = vi.fn()
    const onOpenCloud = vi.fn()
    const mounted = await mountSection({
      projection: projectionFixture(snapshotWith(activeCloud(), aliceState())),
      onOpenAccount,
      onOpenCloud
    })

    expect(mounted.container.textContent).toContain('Alice')
    expect(mounted.container.textContent).toContain('Local Account')

    await click(buttonByLabel(mounted.container, 'Open account'))
    expect(onOpenAccount).toHaveBeenCalledOnce()
    expect(onOpenCloud).not.toHaveBeenCalled()
  })

  it('shows the Cloud account and its device connection state', async () => {
    const mounted = await mountSection({
      projection: projectionFixture(snapshotWith(activeCloud(), aliceState()))
    })

    expect(mounted.container.textContent).toContain('Cloud Person')
    expect(mounted.container.textContent).toContain('This Desktop is connected')
  })

  it('shows a quiet message when Cloud is signed out', async () => {
    const mounted = await mountSection({
      projection: projectionFixture(snapshotWith(signedOutCloud(), aliceState()))
    })

    expect(mounted.container.textContent).toContain('Not signed in to Cloud')
  })

  it('renders today and recent token usage from the Agent Runtime daily query', async () => {
    const usage = vi.fn(async () => ({
      supported: true,
      groupBy: 'day',
      from: '2026-10-30',
      to: '2026-11-05',
      timezone: 'UTC',
      buckets: [
        { date: '2026-11-04', totalTokens: 900, costUsd: 0.25 },
        { date: '2026-11-05', totalTokens: 1_234, costUsd: 0.5 }
      ],
      totals: { totalTokens: 45_678, costUsd: 1.2345 }
    }))
    vi.stubGlobal('sciforge', { agentRuntime: { usage } })
    const mounted = await mountSection({
      projection: projectionFixture(snapshotWith(activeCloud(), aliceState()))
    })

    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain('45.7k')
    })
    expect(usage).toHaveBeenCalledOnce()
    expect(usage).toHaveBeenCalledWith({
      groupBy: 'day',
      from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
      to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
      timezone: expect.any(String)
    })
    expect(mounted.container.textContent).toContain('1.2k')
    expect(mounted.container.textContent).toContain('$0.5000')
    expect(mounted.container.textContent).toContain('$1.23')
    expect(mounted.container.textContent).toContain('Last 7 days')
  })

  it('keeps unsupported usage quiet and non-blocking', async () => {
    vi.stubGlobal('sciforge', {
      agentRuntime: { usage: vi.fn(async () => ({ supported: false })) }
    })
    const mounted = await mountSection({
      projection: projectionFixture(snapshotWith(activeCloud(), aliceState()))
    })

    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain('Usage data is unavailable.')
    })
    expect(mounted.container.querySelector('[role="alert"]')).toBeNull()
  })

  it('opens the account overlay through the host global-overlay extension point', async () => {
    const toggleGlobalOverlay = vi.fn()
    const mounted = await mountEntrySection(toggleGlobalOverlay)

    await click(buttonByLabel(mounted.container, 'Open account'))
    expect(toggleGlobalOverlay).toHaveBeenCalledWith({
      contributionId: 'identity-access.account-overlay',
      sessionId: 'thread-1',
      open: true
    })

    toggleGlobalOverlay.mockClear()
    await click(buttonByLabel(mounted.container, 'Open cloud account'))
    expect(toggleGlobalOverlay).toHaveBeenCalledWith({
      contributionId: 'identity-access.account-overlay',
      sessionId: 'thread-1',
      open: true,
      activation: { revision: 1, payload: { section: 'cloud' } }
    })
  })
})

async function mountSection(input: Readonly<{
  projection: IdentityRendererProjection
  onOpenAccount?: () => void
  onOpenCloud?: () => void
}>): Promise<Readonly<{ root: Root; container: HTMLElement }>> {
  const i18n = await identityI18n()
  const usage = new AccountUsageProjection()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const mounted = { root, container }
  mountedRoots.add(mounted)
  await act(async () => {
    root.render(
      createElement(I18nextProvider, { i18n },
        createElement(AccountSidebarSection, {
          projection: input.projection,
          usage,
          onOpenAccount: input.onOpenAccount ?? vi.fn(),
          onOpenCloud: input.onOpenCloud ?? vi.fn()
        })
      )
    )
    await tick()
    await tick()
  })
  return mounted
}

async function mountEntrySection(
  toggleGlobalOverlay: (input: DomainWorkbenchToggleGlobalOverlayInput) => void
): Promise<Readonly<{ root: Root; container: HTMLElement }>> {
  const entry = createDomainRendererEntry(rendererHost(toggleGlobalOverlay))
  const navigation = entry.contributions.find(({ kind, contract }) =>
    kind === 'renderer.extension' &&
    (contract as Readonly<{ location?: string }>).location === 'workbench.navigation-section'
  )?.value as Readonly<{
    render(context: Readonly<Record<string, unknown>>): ReactElement
  }> | undefined
  if (!navigation) throw new Error('Account navigation section contribution is unavailable.')
  const i18n = await identityI18n()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const mounted = { root, container }
  mountedRoots.add(mounted)
  await act(async () => {
    root.render(
      createElement(I18nextProvider, { i18n },
        navigation.render({
          active: true,
          className: 'w-full',
          session: { id: 'thread-1' },
          sessions: [],
          selectSession: vi.fn()
        })
      )
    )
    await tick()
    await tick()
  })
  return mounted
}

async function identityI18n(): Promise<I18n> {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { identity: identityI18nResourceContribution.resources.en }
    },
    defaultNS: 'identity',
    interpolation: { escapeValue: false }
  })
  return i18n
}

function aliceState(): IdentityAvailableState {
  return {
    status: 'available',
    identityVersion: 1,
    currentAccount: {
      userId: 'c07f29ee-801d-4cf3-90ef-96c56c65de21',
      username: 'Alice',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z'
    },
    accountCount: 1,
    firstPromptDismissed: true
  }
}

function snapshotWith(
  cloud: CloudIdentitySnapshot,
  state: IdentityAvailableState
): IdentityProjectionSnapshot {
  return {
    loading: false,
    state,
    accounts: state.currentAccount ? [state.currentAccount] : [],
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
  snapshot: IdentityProjectionSnapshot
): IdentityRendererProjection {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    load: vi.fn(async () => snapshot)
  } as unknown as IdentityRendererProjection
}

function rendererHost(
  toggleGlobalOverlay: (input: DomainWorkbenchToggleGlobalOverlayInput) => void
): DomainRendererHost {
  const cloudResource = {
    token: `cap_${'a'.repeat(24)}`,
    semanticRevision: 'cloud-2',
    expiresAt: '2027-08-21T00:00:00.000Z'
  }
  const cloudSnapshot = activeCloud()
  return {
    capabilityInvoker: {
      observe: vi.fn(async () => ({
        resource: cloudResource,
        resourceRef: `res_${'b'.repeat(24)}`,
        resourceKind: 'identity.cloud-session',
        semanticRevision: 'cloud-2',
        observedAt: '2026-08-21T00:00:00.000Z',
        state: cloudSnapshot
      } as never)),
      invoke: vi.fn(async (contract) => {
        if (contract.actionId === IDENTITY_CAPABILITY_IDS.cloudInspect) {
          return { snapshot: cloudSnapshot, resource: cloudResource } as never
        }
        if (contract.actionId === IDENTITY_CAPABILITY_IDS.listAccounts) {
          const state = aliceState()
          return {
            state,
            accounts: state.currentAccount ? [state.currentAccount] : []
          } as never
        }
        throw new Error(`Unexpected action ${contract.actionId}`)
      })
    },
    openExternal: vi.fn(),
    workbench: {
      openRightPanel: vi.fn(),
      toggleGlobalOverlay
    }
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

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.getAttribute('aria-label') === label)
  expect(button, `Missing button: ${label}`).toBeInstanceOf(HTMLButtonElement)
  return button as HTMLButtonElement
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await tick()
    await tick()
  })
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
