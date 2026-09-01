// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type OpenContentConnectionResult
} from '../contract.js'
import {
  OpenContentEnrollment,
  type OpenContentEnrollmentProps
} from './OpenContentEnrollment.js'
import type {
  OpenContentConnectionRendererClient,
  OpenContentUnbindResult
} from './client.js'

const OPENCONTENT_PROVIDER_INSTANCE_REF = 'test-opencontent-provider'

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
})

describe('OpenContent enrollment fragment', () => {
  it('renders the owning access read without issuing a second status request', async () => {
    const status = vi.fn(async () => {
      throw new Error('the fragment must not repeat the access read')
    })
    const client = connectionClient({ status })
    const mounted = await mountEnrollment({
      client,
      viewState: resolvedViewState({
        outcome: 'success',
        status: { state: 'disconnected' }
      })
    })

    expect(mounted.container.textContent).toContain('Connect OpenContent')
    expect(status).not.toHaveBeenCalled()
  })

  it('renders an accessible one-use account and password form', async () => {
    const client = connectionClient()
    const mounted = await mountEnrollment({ client })

    expect(mounted.container.textContent).toContain('Connect OpenContent')
    expect(mounted.container.textContent).not.toContain('OpenContent Connection')
    expect(mounted.container.querySelector('[role="status"]')?.textContent)
      .toContain('Ready to connect')

    const account = inputByLabel(mounted.container, 'OpenContent account')
    const password = inputByLabel(mounted.container, 'Password')
    expect(account.autocomplete).toBe('off')
    expect(password.autocomplete).toBe('off')
    expect(password.type).toBe('password')
    expect(account.getAttribute('data-visual-context-sensitive')).toBe('true')
    expect(password.getAttribute('data-visual-context-sensitive')).toBe('true')
    expect(account.value).toBe('')
    expect(password.value).toBe('')
    expect(buttonByText(mounted.container, 'Connect account').disabled).toBe(true)
  })

  it('clears submitted fields immediately and blocks concurrent credential attempts', async () => {
    const pendingBind = deferred<OpenContentConnectionResult>()
    let submittedCredentials: { account: string; password: string } | undefined
    let submittedSnapshot: { account: string; password: string } | undefined
    let bindSignal: AbortSignal | undefined
    const bind = vi.fn(async (_providerInstanceRef, credentials, options) => {
      submittedCredentials = credentials
      submittedSnapshot = { ...credentials }
      bindSignal = options?.signal
      return pendingBind.promise
    })
    const client = connectionClient({ bind })
    const mounted = await mountEnrollment({ client })

    const account = inputByLabel(mounted.container, 'OpenContent account')
    const password = inputByLabel(mounted.container, 'Password')
    await setInputValue(account, '  scientist@example.org  ')
    await setInputValue(password, 'one-use-secret')
    await clickWithoutSettling(buttonByText(mounted.container, 'Connect account'))

    expect(submittedSnapshot).toEqual({
      account: 'scientist@example.org',
      password: 'one-use-secret'
    })
    expect(submittedCredentials).toEqual({ account: '', password: '' })
    expect(bindSignal).toBeInstanceOf(AbortSignal)
    expect(account.value).toBe('')
    expect(password.value).toBe('')
    expect(account.disabled).toBe(true)
    expect(password.disabled).toBe(true)
    expect(buttonByText(mounted.container, 'Connecting…').disabled).toBe(true)

    await clickWithoutSettling(buttonByText(mounted.container, 'Connecting…'))
    expect(bind).toHaveBeenCalledTimes(1)

    pendingBind.resolve({
      outcome: 'error',
      error: { code: 'invalid_credentials', action: 'check_credentials' }
    })
    await settleReact()

    expect(submittedCredentials).toEqual({ account: '', password: '' })
    const alert = mounted.container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('did not accept')
    expect(alert?.textContent).not.toContain('invalid_credentials')
    expect(mounted.container.textContent).not.toContain('scientist@example.org')
    expect(mounted.container.textContent).not.toContain('one-use-secret')
    expect(account.getAttribute('aria-invalid')).toBe('true')
    expect(password.getAttribute('aria-invalid')).toBe('true')
    expect(password.getAttribute('aria-describedby')).toContain('privacy')
    expect(password.getAttribute('aria-describedby')).toContain('notice')
    expect(document.activeElement).toBe(password)
    expect(account.disabled).toBe(false)
    expect(password.disabled).toBe(false)
  })

  it('returns a cancelled attempt to the same blank form without notifying Content Space', async () => {
    const onConnectionChanged = vi.fn()
    const client = connectionClient({
      bind: vi.fn(async (): Promise<OpenContentConnectionResult> => ({
        outcome: 'error',
        error: { code: 'cancelled', action: 'none' }
      }))
    })
    const mounted = await mountEnrollment({ client, onConnectionChanged })

    await setInputValue(
      inputByLabel(mounted.container, 'OpenContent account'),
      'scientist@example.org'
    )
    await setInputValue(inputByLabel(mounted.container, 'Password'), 'one-use-secret')
    await click(buttonByText(mounted.container, 'Connect account'))

    expect(mounted.container.querySelector('[role="alert"]')?.textContent)
      .toContain('cancelled')
    expect(inputByLabel(mounted.container, 'OpenContent account').value).toBe('')
    expect(inputByLabel(mounted.container, 'Password').value).toBe('')
    expect(mounted.container.textContent).not.toContain('scientist@example.org')
    expect(mounted.container.textContent).not.toContain('one-use-secret')
    expect(onConnectionChanged).not.toHaveBeenCalled()
  })

  it('reports an existing enrollment safely and keeps the retry form blank', async () => {
    const onConnectionChanged = vi.fn()
    const client = connectionClient({
      bind: vi.fn(async (): Promise<OpenContentConnectionResult> => ({
        outcome: 'error',
        error: { code: 'enrollment_in_progress', action: 'retry' }
      }))
    })
    const mounted = await mountEnrollment({ client, onConnectionChanged })

    await setInputValue(
      inputByLabel(mounted.container, 'OpenContent account'),
      'scientist@example.org'
    )
    await setInputValue(inputByLabel(mounted.container, 'Password'), 'one-use-secret')
    await click(buttonByText(mounted.container, 'Connect account'))

    const alert = mounted.container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('connection is already in progress')
    expect(alert?.textContent).toContain('Try again shortly')
    expect(alert?.textContent).not.toContain('enrollment_in_progress')
    expect(alert?.textContent).not.toContain('scientist@example.org')
    expect(alert?.textContent).not.toContain('one-use-secret')
    expect(inputByLabel(mounted.container, 'OpenContent account').value).toBe('')
    expect(inputByLabel(mounted.container, 'Password').value).toBe('')
    expect(onConnectionChanged).not.toHaveBeenCalled()
  })

  it('shows a provider-free connected state and notifies Content Space after binding', async () => {
    const onConnectionChanged = vi.fn()
    const client = connectionClient({
      bind: vi.fn(async () => connectedResult())
    })
    const mounted = await mountEnrollment({ client, onConnectionChanged })

    await setInputValue(
      inputByLabel(mounted.container, 'OpenContent account'),
      'scientist@example.org'
    )
    await setInputValue(inputByLabel(mounted.container, 'Password'), 'one-use-secret')
    await click(buttonByText(mounted.container, 'Connect account'))

    expect(mounted.container.textContent).toContain('Account connected')
    expect(mounted.container.textContent).not.toContain('Research Library')
    expect(mounted.container.textContent).not.toContain('scientist@example.org')
    expect(mounted.container.textContent).not.toContain('one-use-secret')
    expect(mounted.container.textContent).not.toContain('OpenContent account')
    expect(onConnectionChanged).toHaveBeenCalledTimes(1)
  })

  it('presents the same blank one-use form when reauthentication is required', async () => {
    const client = connectionClient()
    const mounted = await mountEnrollment({
      client,
      viewState: resolvedViewState(reauthenticationRequiredResult())
    })

    expect(mounted.container.textContent).toContain('Reconnect OpenContent')
    expect(mounted.container.querySelector('[role="alert"]')?.textContent)
      .toContain('sign in again')
    expect(inputByLabel(mounted.container, 'OpenContent account').value).toBe('')
    expect(inputByLabel(mounted.container, 'Password').value).toBe('')
    expect(buttonByText(mounted.container, 'Reconnect account').disabled).toBe(true)
    expect(mounted.container.textContent).not.toContain('returning-scientist')
  })

  it('fails closed when a successful status belongs to a different Provider Instance', async () => {
    const drifted = connectedResult()
    if (drifted.outcome !== 'success' || drifted.status.state === 'disconnected') {
      throw new Error('Invalid test fixture.')
    }
    const mounted = await mountEnrollment({
      client: connectionClient(),
      viewState: resolvedViewState({
        ...drifted,
        status: {
          ...drifted.status,
          providerInstanceRef: 'opencontent-other-instance'
        }
      })
    })

    expect(mounted.container.textContent).toContain('Connection unavailable')
    expect(mounted.container.textContent).not.toContain('Wrong Library')
    expect(mounted.container.textContent).not.toContain('wrong-account')
  })

  it('requires inline confirmation before disconnecting this device', async () => {
    const unbind = vi.fn(async (): Promise<OpenContentUnbindResult> => ({
      outcome: 'success',
      state: 'disconnected',
      remoteRevocation: 'unsupported'
    }))
    const onConnectionChanged = vi.fn()
    const client = connectionClient({
      unbind
    })
    const mounted = await mountEnrollment({
      client,
      onConnectionChanged,
      viewState: resolvedViewState(connectedResult())
    })

    const disconnectButton = buttonByText(mounted.container, 'Disconnect')
    disconnectButton.focus()
    await click(disconnectButton)
    expect(unbind).not.toHaveBeenCalled()
    expect(mounted.container.textContent).toContain('Disconnect on this device?')
    const confirmation = mounted.container.querySelector('[role="group"]')
    expect(confirmation?.getAttribute('aria-labelledby')).toBeTruthy()
    expect(document.activeElement).toBe(buttonByText(mounted.container, 'Cancel'))

    await click(buttonByText(mounted.container, 'Yes, disconnect'))
    expect(unbind).toHaveBeenCalledWith(
      OPENCONTENT_PROVIDER_INSTANCE_REF,
      { signal: expect.any(AbortSignal) }
    )
    expect(mounted.container.textContent).toContain('Connect OpenContent')
    expect(onConnectionChanged).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['unavailable access state', Object.freeze({
      phase: 'unavailable' as const,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    })],
    ['resolved provider-unavailable result', resolvedViewState({
      outcome: 'error',
      error: { code: 'provider_unavailable', action: 'retry' }
    })]
  ])('allows confirmed local disconnect through the %s', async (_case, viewState) => {
    const status = vi.fn(async (): Promise<OpenContentConnectionResult> => ({
      outcome: 'error',
      error: { code: 'provider_unavailable', action: 'retry' }
    }))
    const bind = vi.fn(async () => connectedResult())
    const unbind = vi.fn(async (): Promise<OpenContentUnbindResult> => ({
      outcome: 'success',
      state: 'disconnected',
      remoteRevocation: 'unsupported'
    }))
    const onConnectionChanged = vi.fn()
    const mounted = await mountEnrollment({
      client: connectionClient({ status, bind, unbind }),
      onConnectionChanged,
      viewState
    })

    expect(mounted.container.textContent).toContain('Connection unavailable')
    await click(buttonByText(mounted.container, 'Disconnect'))
    expect(unbind).not.toHaveBeenCalled()
    expect(mounted.container.textContent).toContain('Disconnect on this device?')
    expect(mounted.container.textContent).toContain('remote files will not be deleted')

    await click(buttonByText(mounted.container, 'Yes, disconnect'))
    expect(unbind).toHaveBeenCalledTimes(1)
    expect(unbind).toHaveBeenCalledWith(
      OPENCONTENT_PROVIDER_INSTANCE_REF,
      { signal: expect.any(AbortSignal) }
    )
    expect(status).not.toHaveBeenCalled()
    expect(bind).not.toHaveBeenCalled()
    expect(onConnectionChanged).toHaveBeenCalledTimes(1)
  })

  it('hides unavailable details and delegates retry to the owning access read', async () => {
    const status = vi.fn(async () => ({
      outcome: 'success' as const,
      status: { state: 'disconnected' as const }
    }))
    const onConnectionChanged = vi.fn()
    const mounted = await mountEnrollment({
      client: connectionClient({ status }),
      onConnectionChanged,
      viewState: Object.freeze({
        phase: 'unavailable' as const,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
      })
    })

    const alert = mounted.container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('couldn’t check')

    await click(buttonByText(mounted.container, 'Try again'))
    expect(onConnectionChanged).toHaveBeenCalledTimes(1)
    expect(status).not.toHaveBeenCalled()
  })

  it('drops a pending bind result after the selected Provider Instance changes', async () => {
    const pendingBind = deferred<OpenContentConnectionResult>()
    const onConnectionChanged = vi.fn()
    let bindSignal: AbortSignal | undefined
    let submittedCredentials: { account: string; password: string } | undefined
    const client = connectionClient({
      bind: vi.fn(async (_providerInstanceRef, credentials, options) => {
        submittedCredentials = credentials
        bindSignal = options?.signal
        return pendingBind.promise
      })
    })
    const mounted = await mountEnrollment({ client, onConnectionChanged })

    await setInputValue(inputByLabel(mounted.container, 'OpenContent account'), 'scientist')
    await setInputValue(inputByLabel(mounted.container, 'Password'), 'one-use-secret')
    await clickWithoutSettling(buttonByText(mounted.container, 'Connect account'))

    await act(async () => {
      mounted.root.render(
        <OpenContentEnrollment
          client={client}
          providerInstanceRef="opencontent-other-instance"
          viewState={resolvedViewState(
            { outcome: 'success', status: { state: 'disconnected' } },
            'opencontent-other-instance'
          )}
          onConnectionChanged={onConnectionChanged}
        />
      )
      await tick()
      await tick()
    })
    pendingBind.resolve(connectedResult())
    await settleReact()

    expect(bindSignal?.aborted).toBe(true)
    expect(submittedCredentials).toEqual({ account: '', password: '' })
    expect(mounted.container.textContent).toContain('Connect OpenContent')
    expect(mounted.container.textContent).not.toContain('Stale Research Library')
    expect(inputByLabel(mounted.container, 'OpenContent account').value).toBe('')
    expect(inputByLabel(mounted.container, 'Password').value).toBe('')
    expect(onConnectionChanged).not.toHaveBeenCalled()
  })
})

function connectionClient(
  overrides: Partial<OpenContentConnectionRendererClient> = {}
): OpenContentConnectionRendererClient {
  return {
    status: async () => ({ outcome: 'success', status: { state: 'disconnected' } }),
    bind: async () => connectedResult(),
    unbind: async () => ({
      outcome: 'success',
      state: 'disconnected',
      remoteRevocation: 'unsupported'
    }),
    ...overrides
  }
}

function connectedResult(): OpenContentConnectionResult {
  return {
    outcome: 'success',
    status: {
      state: 'connected',
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    }
  }
}

function reauthenticationRequiredResult(): OpenContentConnectionResult {
  return {
    outcome: 'success',
    status: {
      state: 'reauthentication_required',
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    }
  }
}

function resolvedViewState(
  result: OpenContentConnectionResult,
  providerInstanceRef: string = OPENCONTENT_PROVIDER_INSTANCE_REF
) {
  return Object.freeze({
    phase: 'resolved' as const,
    providerInstanceRef,
    result
  })
}

async function mountEnrollment(
  props: Pick<OpenContentEnrollmentProps, 'client'> &
    Partial<Omit<OpenContentEnrollmentProps, 'client'>>
) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const mounted = { root, container }
  mountedRoots.add(mounted)
  await act(async () => {
    root.render(
      <OpenContentEnrollment
        providerInstanceRef={OPENCONTENT_PROVIDER_INSTANCE_REF}
        viewState={resolvedViewState({
          outcome: 'success',
          status: { state: 'disconnected' }
        })}
        onConnectionChanged={() => undefined}
        {...props}
      />
    )
    await tick()
    await tick()
  })
  await settleReact()
  return mounted
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === text)
  expect(button, `Missing button: ${text}`).toBeInstanceOf(HTMLButtonElement)
  return button as HTMLButtonElement
}

function inputByLabel(container: HTMLElement, text: string): HTMLInputElement {
  const label = [...container.querySelectorAll('label')]
    .find((candidate) => candidate.textContent?.includes(text))
  const input = label?.querySelector('input')
  expect(input, `Missing input: ${text}`).toBeInstanceOf(HTMLInputElement)
  return input as HTMLInputElement
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await tick()
    await tick()
  })
  await settleReact()
}

async function clickWithoutSettling(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await tick()
  })
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

async function settleReact(): Promise<void> {
  await act(async () => {
    await tick()
    await tick()
  })
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function deferred<Value>(): Readonly<{
  promise: Promise<Value>
  resolve: (value: Value) => void
}> {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
