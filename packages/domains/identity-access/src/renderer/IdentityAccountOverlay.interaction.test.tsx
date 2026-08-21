// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  IDENTITY_CAPABILITY_IDS,
  type IdentityAvailableState
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
})

function identityFixture(options: Readonly<{
  createError?: Error
  refreshErrorAfterCreate?: Error
}> = {}) {
  const account = {
    userId: 'c07f29ee-801d-4cf3-90ef-96c56c65de21',
    username: 'Alice',
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z'
  }
  let state: IdentityAvailableState = {
    status: 'available',
    identityVersion: 0,
    currentAccount: null,
    accountCount: 0,
    firstPromptDismissed: false
  }
  const createAccount = vi.fn(async (username: string) => {
    if (options.createError) throw options.createError
    state = {
      ...state,
      identityVersion: 1,
      currentAccount: { ...account, username },
      accountCount: 1
    }
    return state
  })
  const host: DomainRendererHost = {
    capabilityInvoker: {
      observe: vi.fn(),
      invoke: vi.fn(async (contract, input) => {
        if (contract.actionId === IDENTITY_CAPABILITY_IDS.listAccounts) {
          if (state.accountCount > 0 && options.refreshErrorAfterCreate) {
            throw options.refreshErrorAfterCreate
          }
          return {
            state,
            accounts: state.currentAccount ? [state.currentAccount] : []
          } as never
        }
        if (contract.actionId === IDENTITY_CAPABILITY_IDS.createAccount) {
          return await createAccount((input as { username: string }).username) as never
        }
        throw new Error(`Unexpected Identity action ${contract.actionId}`)
      })
    },
    openExternal: vi.fn(),
    workbench: {
      openRightPanel: vi.fn(),
      toggleGlobalOverlay: vi.fn()
    }
  }
  return { host, createAccount }
}

async function mountIdentityOverlay(host: DomainRendererHost) {
  const entry = createDomainRendererEntry(host)
  const overlay = entry.contributions.find(
    (contribution) => contribution.kind === 'renderer.workbench-global-overlay'
  )?.value as { render(context: { onClose: () => void }): React.ReactElement } | undefined
  if (!overlay) throw new Error('Identity overlay contribution is unavailable.')
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
        {overlay.render({ onClose: vi.fn() })}
      </I18nextProvider>
    )
    await tick()
    await tick()
  })
  return mounted
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === text)
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
