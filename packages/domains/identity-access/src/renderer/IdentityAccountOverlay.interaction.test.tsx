// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  IDENTITY_CAPABILITY_IDS,
  IdentityValidationError,
  type CloudIdentitySnapshot,
  type IdentityAvailableState,
  type LocalAccount
} from '../contract.js'
import { createDomainRendererEntry } from './index.js'
import { identityI18nResourceContribution } from './messages.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const mountedRoots = new Set<Readonly<{
  root: Root
  container: HTMLElement
}>>()

afterEach(async () => {
  for (const mounted of mountedRoots) {
    await act(async () => mounted.root.unmount())
    mounted.container.remove()
  }
  mountedRoots.clear()
  vi.unstubAllGlobals()
})

describe('Identity Account overlay interaction', () => {
  it('creates the first account after an in-overlay confirmation without a native modal', async () => {
    const nativeConfirm = vi.fn(() => true)
    vi.stubGlobal('confirm', nativeConfirm)
    const fixture = identityFixture()
    const mounted = await mountIdentityOverlay(fixture.host)

    const username = mounted.container.querySelector<HTMLInputElement>('#identity-new-username')
    expect(username).toBeInstanceOf(HTMLInputElement)
    await setInputValue(username!, 'Alice')
    await click(buttonByText(mounted.container, 'Create account'))

    expect(nativeConfirm).not.toHaveBeenCalled()
    expect(fixture.createAccount).not.toHaveBeenCalled()
    expect(mounted.container.textContent).toContain(
      'Create a new Local Account with this display name?'
    )
    expect(mounted.container.textContent).toContain('Alice')

    await click(buttonByText(mounted.container, 'Cancel'))

    expect(fixture.createAccount).not.toHaveBeenCalled()
    expect(mounted.container.textContent).not.toContain(
      'Create a new Local Account with this display name?'
    )
    expect(username?.value).toBe('Alice')

    await click(buttonByText(mounted.container, 'Create account'))
    const confirmCreation = buttonByText(mounted.container, 'Confirm creation')
    await act(async () => {
      confirmCreation.click()
      confirmCreation.click()
      await tick()
      await tick()
    })

    expect(fixture.createAccount).toHaveBeenCalledOnce()
    expect(fixture.createAccount).toHaveBeenCalledWith('Alice')
    expect(username?.value).toBe('')
    expect(mounted.container.textContent).toContain('Alice')
  })

  it('keeps explicit confirmation after a pre-dispatch create rejection without retrying', async () => {
    const fixture = identityFixture({ createError: new Error('create rejected') })
    const mounted = await mountIdentityOverlay(fixture.host)
    const username = mounted.container.querySelector<HTMLInputElement>('#identity-new-username')!

    await setInputValue(username, 'Alice')
    await click(buttonByText(mounted.container, 'Create account'))
    await click(buttonByText(mounted.container, 'Confirm creation'))

    expect(fixture.createAccount).toHaveBeenCalledOnce()
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toContain('create rejected')
    expect(mounted.container.textContent).toContain(
      'Create a new Local Account with this display name?'
    )
    expect(username.value).toBe('Alice')
  })

  it('closes confirmation after commit when only the post-write refresh fails', async () => {
    const fixture = identityFixture({ refreshErrorAfterCreate: new Error('refresh failed') })
    const mounted = await mountIdentityOverlay(fixture.host)
    const username = mounted.container.querySelector<HTMLInputElement>('#identity-new-username')!

    await setInputValue(username, 'Alice')
    await click(buttonByText(mounted.container, 'Create account'))
    await click(buttonByText(mounted.container, 'Confirm creation'))

    expect(fixture.createAccount).toHaveBeenCalledOnce()
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toContain('refresh failed')
    expect(mounted.container.textContent).not.toContain(
      'Create a new Local Account with this display name?'
    )
    expect(username.value).toBe('')
    expect(mounted.container.textContent).toContain('Alice')
  })

  it('renders an icon-only close button with an accessible name, focuses it and closes the dialog', async () => {
    const fixture = identityFixture()
    const onClose = vi.fn()
    const mounted = await mountIdentityOverlay(fixture.host, { onClose })

    const dialog = mounted.container.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).toBeInstanceOf(HTMLElement)
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('data-native-view-occluder')).toBe('true')
    expect(dialog?.getAttribute('aria-labelledby')).toBe('identity-account-title')
    expect(mounted.container.querySelector('#identity-account-title')?.textContent).toBe('Local Account')

    const closeButton = mounted.container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')
    expect(closeButton).toBeInstanceOf(HTMLButtonElement)
    expect(closeButton?.textContent?.trim()).toBe('')
    expect(closeButton?.className).toContain('h-8')
    expect(closeButton?.className).toContain('w-8')
    expect(closeButton?.tabIndex).toBe(0)
    expect(document.activeElement).toBe(closeButton)

    await click(closeButton!)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes the dialog when Escape is pressed inside it', async () => {
    const fixture = identityFixture()
    const onClose = vi.fn()
    const mounted = await mountIdentityOverlay(fixture.host, { onClose })
    const dialog = mounted.container.querySelector<HTMLElement>('[role="dialog"]')

    await act(async () => {
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await tick()
    })

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('marks the current Local Account and keeps switch, rename and exit on the same projection handlers', async () => {
    const alice = localAccount('usr_alice_0001', 'Alice')
    const bob = localAccount('usr_bob_0001', 'Bob')
    const fixture = identityFixture({ accounts: [alice, bob], currentUserId: alice.userId })
    const mounted = await mountIdentityOverlay(fixture.host)

    const rows = [...mounted.container.querySelectorAll<HTMLElement>('[data-identity-account-row]')]
    expect(rows).toHaveLength(2)
    const currentRow = rows.find((row) => row.getAttribute('aria-current') === 'true')
    expect(currentRow?.textContent).toContain('Alice')
    expect(currentRow?.textContent).toContain('Current account')
    expect(currentRow?.className).toContain('border-accent')

    const bobRow = rows.find((row) => row.textContent?.includes('Bob'))
    expect(bobRow).toBeInstanceOf(HTMLElement)
    expect(bobRow?.getAttribute('aria-current')).toBeNull()
    await click(buttonByText(bobRow!, 'Select'))
    expect(fixture.selectAccount).toHaveBeenCalledWith(bob.userId)

    const aliceRow = [...mounted.container.querySelectorAll<HTMLElement>('[data-identity-account-row]')]
      .find((row) => row.textContent?.includes('Alice'))
    expect(aliceRow).toBeInstanceOf(HTMLElement)
    expect(mounted.container.querySelector('button[aria-label="Delete account Alice"]'))
      .toBeInstanceOf(HTMLButtonElement)
    expect(mounted.container.querySelector('button[aria-label="Delete account Bob"]'))
      .toBeInstanceOf(HTMLButtonElement)
    await click(buttonByText(aliceRow!, 'Edit name'))
    const renameInput = aliceRow!.querySelector<HTMLInputElement>('input')
    expect(renameInput).toBeInstanceOf(HTMLInputElement)
    await setInputValue(renameInput!, 'Alice Cooper')
    await click(buttonByText(aliceRow!, 'Save'))
    expect(fixture.renameAccount).toHaveBeenCalledWith(alice.userId, 'Alice Cooper')

    await click(buttonByText(mounted.container, 'Exit account'))
    expect(fixture.exitAccount).toHaveBeenCalledOnce()
  })

  it('shows the connected Cloud Device state for a signed-in Cloud account', async () => {
    const alice = localAccount('usr_alice_0001', 'Alice')
    const fixture = identityFixture({
      accounts: [alice],
      currentUserId: alice.userId,
      cloud: activeCloud()
    })
    const mounted = await mountIdentityOverlay(fixture.host)

    await vi.waitFor(() => {
      expect(buttonByTextOrNull(mounted.container, 'Sign out')).toBeInstanceOf(HTMLButtonElement)
    })
    expect(mounted.container.textContent).toContain('This Desktop is connected')
    expect(mounted.container.textContent).toContain('Cloud Person')

    const email = [...mounted.container.querySelectorAll('p')]
      .find((element) => element.textContent === 'cloud.person@test.sciforge.cn')
    expect(email?.className).toContain('text-muted-foreground')
  })

  it('shows the disconnected Cloud Device state for a revoked Device', async () => {
    const alice = localAccount('usr_alice_0001', 'Alice')
    const fixture = identityFixture({
      accounts: [alice],
      currentUserId: alice.userId,
      cloud: revokedCloud()
    })
    const mounted = await mountIdentityOverlay(fixture.host)

    await vi.waitFor(() => {
      expect(buttonByTextOrNull(mounted.container, 'Sign out')).toBeInstanceOf(HTMLButtonElement)
    })
    expect(mounted.container.textContent).toContain('This Desktop is disconnected')
  })

  it('keeps the Cloud device and session actions on the same projection handlers', async () => {
    const alice = localAccount('usr_alice_0001', 'Alice')
    const fixture = identityFixture({
      accounts: [alice],
      currentUserId: alice.userId,
      cloud: activeCloud()
    })
    const mounted = await mountIdentityOverlay(fixture.host)

    await vi.waitFor(() => {
      expect(buttonByTextOrNull(mounted.container, 'Sign out')).toBeInstanceOf(HTMLButtonElement)
    })

    await click(buttonByText(mounted.container, 'Disconnect this Desktop'))
    expect(fixture.revokeCloudDevice).toHaveBeenCalledWith('dev_CloudDevice0001')

    await click(buttonByText(mounted.container, 'Sign in again'))
    expect(fixture.reauthenticateCloud).toHaveBeenCalledOnce()

    await click(buttonByText(mounted.container, 'Sign out'))
    expect(fixture.logoutCloud).toHaveBeenCalledOnce()

    await click(buttonByText(mounted.container, 'Exit account'))
    expect(fixture.exitAccount).toHaveBeenCalledOnce()
  })

  it('renders Cloud sign out as a solid danger button in the device action row', async () => {
    const alice = localAccount('usr_alice_0001', 'Alice')
    const fixture = identityFixture({
      accounts: [alice],
      currentUserId: alice.userId,
      cloud: activeCloud()
    })
    const mounted = await mountIdentityOverlay(fixture.host)

    await vi.waitFor(() => {
      expect(buttonByTextOrNull(mounted.container, 'Sign out')).toBeInstanceOf(HTMLButtonElement)
    })

    const signOut = buttonByText(mounted.container, 'Sign out')
    expect(signOut.className).toContain('bg-ds-danger')
    expect(signOut.className).toContain('text-white')
    expect(signOut.className).toContain('border-transparent')
    expect(signOut.disabled).toBe(false)
    // Sign out shares the row with re-authenticate and sits directly after it.
    const reauthenticate = buttonByText(mounted.container, 'Sign in again')
    expect(signOut.parentElement).toBe(reauthenticate.parentElement)
    expect(signOut.className).not.toContain('w-full')
    const siblings = [...(signOut.parentElement?.children ?? [])]
    expect(siblings.indexOf(signOut)).toBe(siblings.indexOf(reauthenticate) + 1)
  })

  it('deletes a Local Account after an inline confirmation', async () => {
    const alice = localAccount('usr_alice_0001', 'Alice')
    const bob = localAccount('usr_bob_0001', 'Bob')
    const fixture = identityFixture({ accounts: [alice, bob], currentUserId: alice.userId })
    const mounted = await mountIdentityOverlay(fixture.host)

    const bobRow = [...mounted.container.querySelectorAll<HTMLElement>('[data-identity-account-row]')]
      .find((row) => row.textContent?.includes('Bob'))
    expect(bobRow).toBeInstanceOf(HTMLElement)
    await click(bobRow!.querySelector<HTMLButtonElement>('button[aria-label="Delete account Bob"]')!)

    expect(mounted.container.textContent).toContain(
      'Delete the Local Account "Bob" and its local attribution data? This cannot be undone.'
    )
    expect(fixture.deleteAccount).not.toHaveBeenCalled()

    await click(buttonByText(mounted.container, 'Delete account'))

    await vi.waitFor(() => {
      expect(fixture.deleteAccount).toHaveBeenCalledWith(bob.userId)
      expect(mounted.container.querySelectorAll('[data-identity-account-row]')).toHaveLength(1)
    })
    const remainingRows = [...mounted.container.querySelectorAll<HTMLElement>('[data-identity-account-row]')]
    expect(remainingRows).toHaveLength(1)
    expect(remainingRows[0]?.textContent).toContain('Alice')
    expect(remainingRows[0]?.textContent).not.toContain('Bob')
    expect(remainingRows[0]?.getAttribute('aria-current')).toBe('true')
  })

  it('deletes the current Local Account and lets the identity move the selection', async () => {
    const alice = localAccount('usr_alice_0001', 'Alice')
    const bob = localAccount('usr_bob_0001', 'Bob')
    const fixture = identityFixture({ accounts: [alice, bob], currentUserId: alice.userId })
    const mounted = await mountIdentityOverlay(fixture.host)

    const aliceRow = [...mounted.container.querySelectorAll<HTMLElement>('[data-identity-account-row]')]
      .find((row) => row.textContent?.includes('Alice'))
    expect(aliceRow).toBeInstanceOf(HTMLElement)
    await click(aliceRow!.querySelector<HTMLButtonElement>('button[aria-label="Delete account Alice"]')!)
    await click(buttonByText(mounted.container, 'Delete account'))

    await vi.waitFor(() => {
      expect(fixture.deleteAccount).toHaveBeenCalledWith(alice.userId)
      const rows = [...mounted.container.querySelectorAll<HTMLElement>('[data-identity-account-row]')]
      expect(rows).toHaveLength(1)
      expect(rows[0]?.textContent).toContain('Bob')
      expect(rows[0]?.getAttribute('aria-current')).toBe('true')
    })
  })

  it('keeps the row and surfaces a delete failure', async () => {
    const alice = localAccount('usr_alice_0001', 'Alice')
    const fixture = identityFixture({
      accounts: [alice],
      currentUserId: alice.userId,
      deleteError: new IdentityValidationError('account-not-found', 'Local Account was not found.')
    })
    const mounted = await mountIdentityOverlay(fixture.host)

    await click(mounted.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Delete account Alice"]'
    )!)
    await click(buttonByText(mounted.container, 'Delete account'))

    await vi.waitFor(() => {
      expect(mounted.container.querySelector('[role="alert"]')?.textContent)
        .toContain('Local Account was not found.')
    })
    expect(mounted.container.querySelectorAll('[data-identity-account-row]')).toHaveLength(1)
    expect(fixture.deleteAccount).toHaveBeenCalledWith(alice.userId)
  })
})

const CLOUD_DEVICE = Object.freeze({
  deviceId: 'dev_CloudDevice0001',
  displayName: 'Lab Desktop',
  platform: { os: 'windows' as const, arch: 'x64' as const, appVersion: '0.2.17' },
  activatedAt: '2026-08-21T00:00:00.000Z'
})

function cloudUser() {
  return {
    userId: 'usr_CloudUser000001',
    oidcIdentityId: 'oid_CloudIdent0001',
    issuer: 'https://login-test.sciforge.cn/realms/SciForge',
    subject: 'keycloak-subject-a',
    displayName: 'Cloud Person',
    email: 'cloud.person@test.sciforge.cn'
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
  const device = { ...CLOUD_DEVICE, status: 'active' as const }
  return {
    identity: {
      state: 'signed-in',
      user: cloudUser(),
      accessTokenExpiresAt: '2026-08-21T20:00:00.000Z'
    },
    device: { state: 'active', device },
    devices: [device],
    revision: 'cloud-2'
  }
}

function revokedCloud(): CloudIdentitySnapshot {
  const device = { ...CLOUD_DEVICE, status: 'revoked' as const }
  return {
    identity: {
      state: 'signed-in',
      user: cloudUser(),
      accessTokenExpiresAt: '2026-08-21T20:00:00.000Z'
    },
    device: { state: 'revoked', device },
    devices: [device],
    revision: 'cloud-3'
  }
}

function localAccount(userId: string, username: string): LocalAccount {
  return {
    userId,
    username,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z'
  }
}

function identityFixture(options: Readonly<{
  createError?: Error
  refreshErrorAfterCreate?: Error
  deleteError?: Error
  accounts?: readonly LocalAccount[]
  currentUserId?: string | null
  cloud?: CloudIdentitySnapshot
}> = {}) {
  const accounts: LocalAccount[] = [...(options.accounts ?? [])]
  const cloud = options.cloud ?? signedOutCloud()
  let state: IdentityAvailableState = {
    status: 'available',
    identityVersion: accounts.length > 0 ? 1 : 0,
    currentAccount: accounts.find((account) => account.userId === options.currentUserId) ?? null,
    accountCount: accounts.length,
    firstPromptDismissed: accounts.length > 0
  }
  const createAccount = vi.fn(async (username: string) => {
    if (options.createError) throw options.createError
    const created = localAccount('usr_created_0001', username)
    accounts.push(created)
    state = {
      ...state,
      identityVersion: state.identityVersion + 1,
      currentAccount: created,
      accountCount: accounts.length
    }
    return state
  })
  const selectAccount = vi.fn(async (userId: string) => {
    state = {
      ...state,
      identityVersion: state.identityVersion + 1,
      currentAccount: accounts.find((account) => account.userId === userId) ?? null
    }
    return state
  })
  const renameAccount = vi.fn(async (userId: string, username: string) => {
    const index = accounts.findIndex((account) => account.userId === userId)
    if (index >= 0) {
      accounts[index] = { ...accounts[index]!, username }
      if (state.currentAccount?.userId === userId) {
        state = { ...state, currentAccount: accounts[index]! }
      }
    }
    state = { ...state, identityVersion: state.identityVersion + 1 }
    return state
  })
  const exitAccount = vi.fn(async () => {
    state = { ...state, identityVersion: state.identityVersion + 1, currentAccount: null }
    return state
  })
  const deleteAccount = vi.fn(async (accountId: string) => {
    if (options.deleteError) throw options.deleteError
    const index = accounts.findIndex((account) => account.userId === accountId)
    if (index < 0) {
      throw new IdentityValidationError('account-not-found', 'Local Account was not found.')
    }
    const wasCurrent = state.currentAccount?.userId === accountId
    accounts.splice(index, 1)
    state = {
      ...state,
      identityVersion: state.identityVersion + 1,
      currentAccount: wasCurrent ? accounts[0] ?? null : state.currentAccount,
      accountCount: accounts.length
    }
    return state
  })
  const logoutCloud = vi.fn(async () => cloud)
  const reauthenticateCloud = vi.fn(async () => cloud)
  const revokeCloudDevice = vi.fn(async (_deviceId: string) => cloud)
  const resource = () => ({
    token: `cap_${'a'.repeat(24)}`,
    semanticRevision: cloud.revision,
    expiresAt: '2027-08-21T00:00:00.000Z'
  })
  const host: DomainRendererHost = {
    capabilityInvoker: {
      observe: vi.fn(async () => ({
        resource: resource(),
        resourceRef: `res_${'b'.repeat(24)}`,
        resourceKind: 'identity.cloud-session',
        semanticRevision: cloud.revision,
        observedAt: '2026-08-21T00:00:00.000Z',
        state: cloud
      }) as never),
      invoke: vi.fn(async (contract, input) => {
        switch (contract.actionId) {
          case IDENTITY_CAPABILITY_IDS.listAccounts:
            if (state.accountCount > 0 && options.refreshErrorAfterCreate) {
              throw options.refreshErrorAfterCreate
            }
            return { state, accounts } as never
          case IDENTITY_CAPABILITY_IDS.createAccount:
            return await createAccount((input as { username: string }).username) as never
          case IDENTITY_CAPABILITY_IDS.selectAccount:
            return await selectAccount((input as { userId: string }).userId) as never
          case IDENTITY_CAPABILITY_IDS.renameAccount:
            return await renameAccount(
              (input as { userId: string }).userId,
              (input as { username: string }).username
            ) as never
          case IDENTITY_CAPABILITY_IDS.exitAccount:
            return await exitAccount() as never
          case IDENTITY_CAPABILITY_IDS.deleteAccount:
            return await deleteAccount((input as { accountId: string }).accountId) as never
          case IDENTITY_CAPABILITY_IDS.cloudInspect:
            return { snapshot: cloud, resource: resource() } as never
          case IDENTITY_CAPABILITY_IDS.cloudLogout:
            return await logoutCloud() as never
          case IDENTITY_CAPABILITY_IDS.cloudReauthenticate:
            return await reauthenticateCloud() as never
          case IDENTITY_CAPABILITY_IDS.cloudRevokeDevice:
            return await revokeCloudDevice((input as { deviceId: string }).deviceId) as never
          default:
            throw new Error(`Unexpected Identity action ${contract.actionId}`)
        }
      })
    },
    openExternal: vi.fn(),
    workbench: {
      openRightPanel: vi.fn(),
      toggleGlobalOverlay: vi.fn()
    }
  }
  return {
    host,
    createAccount,
    selectAccount,
    renameAccount,
    deleteAccount,
    exitAccount,
    logoutCloud,
    reauthenticateCloud,
    revokeCloudDevice
  }
}

async function mountIdentityOverlay(
  host: DomainRendererHost,
  options: Readonly<{ onClose?: () => void }> = {}
) {
  const entry = createDomainRendererEntry(host)
  const overlay = entry.contributions.find(
    (contribution) => contribution.kind === 'renderer.workbench-global-overlay'
  )?.value as { render(context: { onClose: () => void }): React.ReactElement } | undefined
  if (!overlay) throw new Error('Identity overlay contribution is unavailable.')
  const onClose = options.onClose ?? vi.fn()
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
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const mounted = { root, container }
  mountedRoots.add(mounted)
  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        {overlay.render({ onClose })}
      </I18nextProvider>
    )
    await tick()
    await tick()
  })
  return { ...mounted, onClose }
}

function buttonByTextOrNull(container: HTMLElement, text: string): HTMLButtonElement | null {
  return [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === text) ?? null
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = buttonByTextOrNull(container, text)
  expect(button, `Missing button: ${text}`).toBeInstanceOf(HTMLButtonElement)
  return button as HTMLButtonElement
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    expect(setter).toBeTypeOf('function')
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
  })
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
