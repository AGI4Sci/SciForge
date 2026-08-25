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

  it('keeps account authentication out of the Renderer and opens only the native action', async () => {
    const client = connectionClient()
    const mounted = await mountEnrollment({ client })

    expect(mounted.container.textContent).toContain('Connect OpenContent')
    expect(mounted.container.textContent).not.toContain('OpenContent Connection')
    expect(mounted.container.querySelector('[role="status"]')?.textContent)
      .toContain('Ready to connect')

    expect(mounted.container.querySelectorAll('input')).toHaveLength(0)
    expect(mounted.container.textContent).toContain('private operating-system prompt')
    expect(buttonByText(mounted.container, 'Connect account').disabled).toBe(false)
  })

  it('sends only the Provider Instance and translates authentication failure safely', async () => {
    const bind = vi.fn(async (): Promise<OpenContentConnectionResult> => ({
      outcome: 'error',
      error: { code: 'invalid_credentials', action: 'check_credentials' }
    }))
    const client = connectionClient({ bind })
    const mounted = await mountEnrollment({ client })

    await click(buttonByText(mounted.container, 'Connect account'))

    expect(bind).toHaveBeenCalledWith(
      OPENCONTENT_PROVIDER_INSTANCE_REF,
      { signal: expect.any(AbortSignal) }
    )
    const alert = mounted.container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('did not accept')
    expect(alert?.textContent).not.toContain('invalid_credentials')
    expect(mounted.container.querySelectorAll('input')).toHaveLength(0)
  })

  it('shows the connected external account and notifies Content Space after binding', async () => {
    const onConnectionChanged = vi.fn()
    const client = connectionClient({
      bind: vi.fn(async () => connectedResult('Research Library', 'scientist'))
    })
    const mounted = await mountEnrollment({ client, onConnectionChanged })

    await click(buttonByText(mounted.container, 'Connect account'))

    expect(mounted.container.textContent).toContain('Account connected')
    expect(mounted.container.textContent).toContain('Research Library')
    expect(mounted.container.textContent).toContain('scientist')
    expect(onConnectionChanged).toHaveBeenCalledTimes(1)
  })

  it('presents a secret-free native reconnect action when reauthentication is required', async () => {
    const client = connectionClient()
    const mounted = await mountEnrollment({
      client,
      viewState: resolvedViewState(connectedResult(
        'Research Library',
        'returning-scientist',
        'reauthentication_required'
      ))
    })

    expect(mounted.container.textContent).toContain('Reconnect OpenContent')
    expect(mounted.container.querySelector('[role="alert"]')?.textContent)
      .toContain('sign in again')
    expect(mounted.container.querySelectorAll('input')).toHaveLength(0)
    expect(buttonByText(mounted.container, 'Reconnect account')).toBeTruthy()
  })

  it('fails closed when a successful status belongs to a different Provider Instance', async () => {
    const drifted = connectedResult('Wrong Library', 'wrong-account')
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
      viewState: resolvedViewState(connectedResult('Research Library', 'scientist'))
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
    const bind = vi.fn(async () => connectedResult('Research Library', 'scientist'))
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
    const client = connectionClient({
      bind: vi.fn(async (_providerInstanceRef, options) => {
        bindSignal = options?.signal
        return pendingBind.promise
      })
    })
    const mounted = await mountEnrollment({ client, onConnectionChanged })

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
    pendingBind.resolve(connectedResult('Stale Research Library', 'stale-scientist'))
    await settleReact()

    expect(bindSignal?.aborted).toBe(true)
    expect(mounted.container.textContent).toContain('Connect OpenContent')
    expect(mounted.container.textContent).not.toContain('Stale Research Library')
    expect(onConnectionChanged).not.toHaveBeenCalled()
  })
})

function connectionClient(
  overrides: Partial<OpenContentConnectionRendererClient> = {}
): OpenContentConnectionRendererClient {
  return {
    status: async () => ({ outcome: 'success', status: { state: 'disconnected' } }),
    bind: async () => connectedResult('Research Library', 'scientist'),
    unbind: async () => ({
      outcome: 'success',
      state: 'disconnected',
      remoteRevocation: 'unsupported'
    }),
    ...overrides
  }
}

function connectedResult(
  name: string,
  account: string,
  state: 'connected' | 'reauthentication_required' = 'connected'
): OpenContentConnectionResult {
  return {
    outcome: 'success',
    status: {
      state,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      externalAccount: {
        id: 'external-account-id',
        identityId: 42,
        account,
        name
      }
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
