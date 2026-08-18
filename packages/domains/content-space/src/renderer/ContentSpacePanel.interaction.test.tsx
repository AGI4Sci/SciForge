// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  DomainRendererFileTransferHost,
  DomainRendererSessionResource
} from '@sciforge/domain-sdk/host'

import {
  CONTENT_CONTAINER_RESOURCE_KIND,
  CONTENT_FILE_RESOURCE_KIND,
  type ContentContainerReference,
  type ContentFileReference,
  type ContentSpaceCapabilityState,
  type ContentSpaceOperation,
  type ContentSpaceResult
} from '../contract.js'
import { ContentSpacePanel, type ContentSpacePanelProps } from './ContentSpacePanel.js'
import type { ContentSpaceCapabilityClient } from './capability-client.js'

type Deferred<Value> = Readonly<{
  promise: Promise<Value>
  resolve: (value: Value) => void
}>

const providerOne = 'mock.instance.one'
const providerTwo = 'mock.instance.two'
const rootReference: ContentContainerReference = Object.freeze({
  providerInstanceRef: providerOne,
  containerId: 'root'
})
const secondRootReference: ContentContainerReference = Object.freeze({
  providerInstanceRef: providerTwo,
  containerId: 'second-root'
})
const fileReference: ContentFileReference = Object.freeze({
  providerInstanceRef: providerOne,
  fileId: 'paper.pdf'
})
const fileEntry = Object.freeze({
  kind: 'file' as const,
  reference: fileReference,
  label: 'paper.pdf',
  size: 128
})
const navigationCapabilities = readyCapabilities(
  'list-entries',
  'create-folder',
  'upload-new'
)
const fileCapabilities = readyCapabilities(
  'download',
  'portal-target',
  'observe-immutable-version'
)

const mountedPanels = new Set<MountedPanel>()

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  for (const mounted of [...mountedPanels]) await mounted.unmount()
  document.body.replaceChildren()
})

describe('ContentSpacePanel', () => {
  it('keeps its plugin-owned sidebar layout when the Host supplies sizing classes', async () => {
    const mounted = await mountPanel(panelClient(), { className: 'host-right-panel-size' })
    const panel = mounted.container.querySelector('[data-content-space-panel]')

    expect(panel).toBeInstanceOf(HTMLElement)
    expect(panel?.classList.contains('content-space-panel')).toBe(true)
    expect(panel?.classList.contains('host-right-panel-size')).toBe(true)
    expect(panel?.getAttribute('aria-busy')).toBe('false')
  })

  it('discovers Provider Instances without silently selecting a default Provider', async () => {
    const describeCapabilities = vi.fn(panelClient().describeCapabilities)
    const listContainers = vi.fn(panelClient().listContainers)
    const mounted = await mountPanel(panelClient({
      describeCapabilities,
      listContainers
    }))

    const select = providerSelect(mounted.container)
    expect([...select.options].map(({ value }) => value)).toEqual([
      '',
      providerOne,
      providerTwo
    ])
    expect(select.value).toBe('')
    expect(describeCapabilities).not.toHaveBeenCalled()
    expect(listContainers).not.toHaveBeenCalled()
    expect(mounted.container.textContent).toContain('Select a Provider Instance.')
  })

  it('admits trusted development-profile operations without presenting them as production-ready', async () => {
    const mounted = await mountPanel(panelClient({
      describeCapabilities: async () => ok({
        items: [
          {
            operation: 'list-containers',
            readiness: 'poc_only',
            reasonCode: 'verification_profile_required'
          },
          {
            operation: 'list-entries',
            readiness: 'poc_only',
            reasonCode: 'verification_profile_required'
          }
        ]
      }),
      listContainers: async () => ok({
        providerInstanceRef: providerOne,
        items: [{
          reference: rootReference,
          scope: 'personal',
          label: 'Development library'
        }]
      })
    }))

    await selectProvider(mounted.container, providerOne)
    await settleReact()

    const readiness = mounted.container.querySelector(
      '[aria-label="Content Space Provider readiness"]'
    )
    expect(readiness?.textContent).toContain('list-containers: ready (development)')
    expect(readiness?.closest('details')?.open).toBe(false)
    expect(readiness?.closest('details')?.querySelector('summary')?.textContent)
      .toContain('2 of 2 operations available')
    expect(buttonContainingText(mounted.container, 'Development library').disabled).toBe(false)
  })

  it('finishes independent Provider discovery while opening an initial resource', async () => {
    const discovered = deferred<Awaited<ReturnType<
      ContentSpaceCapabilityClient['listProviderInstances']
    >>>()
    const listProviderInstances = vi.fn(() => discovered.promise)
    const mounted = await mountPanel(panelClient({
      listProviderInstances,
      observeResource: async () => ({
        reference: fileReference,
        entry: fileEntry,
        capabilities: fileCapabilities
      })
    }), {
      initialResource: sessionResource(
        CONTENT_FILE_RESOURCE_KIND,
        'portable-file-id',
        'portable-file-token'
      )
    })

    expect(mounted.container.textContent).toContain('paper.pdf')

    discovered.resolve(ok({
      items: [
        { providerInstanceRef: providerOne, label: 'Mock One' },
        { providerInstanceRef: providerTwo, label: 'Mock Two' }
      ]
    }))
    await settleReact()

    expect(listProviderInstances).toHaveBeenCalledOnce()
    expect([...providerSelect(mounted.container).options].map(({ value }) => value))
      .toContain(providerTwo)
    expect(providerSelect(mounted.container).value).toBe(providerOne)
    expect(mounted.container.textContent).toContain('paper.pdf')
  })

  it('keeps container navigation capabilities separate from selected-file capabilities', async () => {
    const transfers = fileTransfers()
    const mounted = await mountContainerPanel(panelClient(), transfers)

    await click(buttonContainingText(mounted.container, 'paper.pdf'))

    expect(buttonByText(mounted.container, 'New folder').disabled).toBe(false)
    expect(buttonByText(mounted.container, 'Upload new').disabled).toBe(false)
    expect(buttonByText(mounted.container, 'Download').disabled).toBe(false)
    expect(buttonByText(mounted.container, 'Verify immutable').disabled).toBe(false)
    expect(buttonByText(mounted.container, 'Open Provider portal').disabled).toBe(false)

    const readiness = mounted.container.querySelector(
      '[aria-label="Content Space Provider readiness"]'
    )
    expect(readiness?.textContent).toContain('download: ready')
    expect(readiness?.textContent).not.toContain('create-folder: ready')
  })

  it('explains when a Provider cannot prove retained immutable retrieval', async () => {
    const mounted = await mountContainerPanel(panelClient(), fileTransfers())
    await click(buttonContainingText(mounted.container, 'paper.pdf'))
    await click(buttonByText(mounted.container, 'Verify immutable'))

    expect(mounted.container.textContent).toContain(
      'Provider cannot prove a retained immutable version for this file.'
    )
    expect(mounted.container.textContent).not.toContain('Done.')
  })

  it('fails closed on duplicate cross-page entries instead of growing an unbounded list', async () => {
    let pageCalls = 0
    const listEntries = vi.fn(async ({ parent }) => ok({
      parent,
      items: [fileEntry],
      ...(++pageCalls === 1 ? { nextCursor: 'cursor-next' } : {})
    })) satisfies ContentSpaceCapabilityClient['listEntries']
    const mounted = await mountContainerPanel(panelClient({ listEntries }), fileTransfers())

    await click(buttonByText(mounted.container, 'Load more entries'))

    expect(listEntries).toHaveBeenCalledTimes(2)
    expect(mounted.container.querySelector('[role="alert"]')?.textContent)
      .toContain('duplicate pagination')
    expect(buttonByTextOrNull(mounted.container, 'Load more entries')).toBeNull()
    expect([...mounted.container.querySelectorAll('button')].filter((button) =>
      button.textContent?.includes('paper.pdf'))).toHaveLength(1)
  })

  it('creates a folder, uploads a new file, and downloads through approved broker calls', async () => {
    const createFolder = vi.fn(async (input, options) => ok({
      invocationId: 'renderer-create-0001',
      parent: input.parent,
      name: input.name,
      reference: {
        providerInstanceRef: input.parent.providerInstanceRef,
        containerId: 'new-folder'
      }
    })) satisfies ContentSpaceCapabilityClient['createFolder']
    const uploadNew = vi.fn(async (input, options) => ok({
      invocationId: 'renderer-upload-0001',
      parent: input.parent,
      name: input.name,
      sourceSize: 256,
      reference: {
        providerInstanceRef: input.parent.providerInstanceRef,
        fileId: 'uploaded.bin'
      }
    })) satisfies ContentSpaceCapabilityClient['uploadNew']
    const download = vi.fn(async (input, options) => ok({
      invocationId: 'renderer-download-0001',
      reference: input.reference,
      bytesWritten: 128
    })) satisfies ContentSpaceCapabilityClient['download']
    const transfers = fileTransfers()
    const client = panelClient({ createFolder, uploadNew, download })
    const mounted = await mountContainerPanel(client, transfers)

    await click(buttonByText(mounted.container, 'New folder'))
    const nameInput = mounted.container.querySelector('input[placeholder="Folder name"]')
    expect(nameInput).toBeInstanceOf(HTMLInputElement)
    await setInputValue(nameInput as HTMLInputElement, 'Figures')
    await click(buttonByText(mounted.container, 'Create'))

    expect(createFolder).toHaveBeenCalledOnce()
    expect(createFolder.mock.calls[0]?.[0]).toEqual({
      parent: rootReference,
      name: 'Figures'
    })
    expect(createFolder.mock.calls[0]?.[1]).toEqual({
      approval: { mode: 'confirmation' },
      signal: expect.any(AbortSignal)
    })

    await click(buttonByText(mounted.container, 'Upload new'))
    expect(transfers.pickUploadSource).toHaveBeenCalledWith({
      title: 'Upload a new file',
      maxBytes: 16 * 1024 * 1024
    }, { signal: expect.any(AbortSignal) })
    expect(uploadNew).toHaveBeenCalledWith({
      parent: rootReference,
      name: 'upload.bin',
      sourceHandle: `xfer_${'u'.repeat(32)}`
    }, {
      approval: { mode: 'confirmation' },
      signal: expect.any(AbortSignal)
    })
    expect(transferProgress(mounted.container)).toMatchObject({
      operation: 'upload',
      phase: 'succeeded'
    })

    await click(buttonContainingText(mounted.container, 'paper.pdf'))
    await click(buttonByText(mounted.container, 'Download'))
    expect(transfers.pickDownloadDestination).toHaveBeenCalledWith({
      title: 'Download Content Space file',
      suggestedName: 'paper.pdf'
    }, { signal: expect.any(AbortSignal) })
    expect(download).toHaveBeenCalledWith({
      reference: fileReference,
      destinationHandle: `xfer_${'d'.repeat(32)}`
    }, {
      approval: { mode: 'confirmation' },
      signal: expect.any(AbortSignal)
    })
    expect(transferProgress(mounted.container)).toMatchObject({
      operation: 'download',
      phase: 'succeeded'
    })
  })

  it('silences a definite pre-dispatch AbortError without invoking the Provider', async () => {
    const uploadNew = vi.fn(panelClient().uploadNew)
    const pickUploadSource = vi.fn((
      _input: Parameters<DomainRendererFileTransferHost['pickUploadSource']>[0],
      options?: Parameters<DomainRendererFileTransferHost['pickUploadSource']>[1]
    ) => new Promise<never>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The picker was cancelled.', 'AbortError'))
      }, { once: true })
    }))
    const mounted = await mountContainerPanel(panelClient({ uploadNew }), {
      ...fileTransfers(),
      pickUploadSource
    })

    await click(buttonByText(mounted.container, 'Upload new'))
    await click(buttonByText(mounted.container, 'Cancel'))
    await settleReact()

    expect(uploadNew).not.toHaveBeenCalled()
    expect(mounted.container.querySelector('[role="alert"]')).toBeNull()
    expect(mounted.container.textContent).not.toContain('Content Space operation failed.')
    expect(buttonByTextOrNull(mounted.container, 'Cancel')).toBeNull()
    expect(transferProgress(mounted.container)).toMatchObject({
      operation: 'upload',
      phase: 'cancelled'
    })
  })

  it('converges a cancelled picker without capability dispatch, reload, or success status', async () => {
    const uploadNew = vi.fn(panelClient().uploadNew)
    const listEntries = vi.fn(panelClient().listEntries)
    const transfers = fileTransfers()
    transfers.pickUploadSource.mockResolvedValueOnce({ cancelled: true })
    const mounted = await mountContainerPanel(panelClient({ uploadNew, listEntries }), transfers)
    expect(listEntries).toHaveBeenCalledTimes(1)

    await click(buttonByText(mounted.container, 'Upload new'))

    expect(uploadNew).not.toHaveBeenCalled()
    expect(listEntries).toHaveBeenCalledTimes(1)
    expect(mounted.container.textContent).not.toContain('Done.')
    expect(transferProgress(mounted.container)).toMatchObject({
      operation: 'upload',
      phase: 'cancelled'
    })
  })

  it('keeps a committed upload succeeded while its separate refresh is pending', async () => {
    const refresh = deferred<Awaited<ReturnType<
      ContentSpaceCapabilityClient['listEntries']
    >>>()
    let listCall = 0
    const listEntries = vi.fn((input: Parameters<
      ContentSpaceCapabilityClient['listEntries']
    >[0]) => ++listCall === 1
      ? Promise.resolve(ok({ parent: input.parent, items: [fileEntry] }))
      : refresh.promise)
    const uploadNew = vi.fn(panelClient().uploadNew)
    const mounted = await mountContainerPanel(
      panelClient({ listEntries, uploadNew }),
      fileTransfers()
    )

    await click(buttonByText(mounted.container, 'Upload new'))
    expect(uploadNew).toHaveBeenCalledOnce()
    expect(listEntries).toHaveBeenCalledTimes(2)
    expect(buttonByTextOrNull(mounted.container, 'Cancel')).toBeNull()
    expect(transferProgress(mounted.container)).toMatchObject({
      operation: 'upload',
      phase: 'succeeded'
    })

    refresh.resolve(ok({ parent: rootReference, items: [fileEntry] }))
    await settleReact()
    expect(transferProgress(mounted.container).phase).toBe('succeeded')
  })

  it('surfaces outcome_unknown after a dispatched write is cancelled', async () => {
    const dispatched = deferred<Awaited<ReturnType<
      ContentSpaceCapabilityClient['uploadNew']
    >>>()
    let dispatchedSignal: AbortSignal | undefined
    const uploadNew = vi.fn((
      _input: Parameters<ContentSpaceCapabilityClient['uploadNew']>[0],
      options: Parameters<ContentSpaceCapabilityClient['uploadNew']>[1]
    ) => {
      dispatchedSignal = options.signal
      return dispatched.promise
    })
    const mounted = await mountContainerPanel(panelClient({ uploadNew }), fileTransfers())

    await click(buttonByText(mounted.container, 'Upload new'))
    expect(uploadNew).toHaveBeenCalledOnce()
    await click(buttonByText(mounted.container, 'Cancel'))
    expect(dispatchedSignal?.aborted).toBe(true)
    expect(transferProgress(mounted.container).phase).toBe('cancelled')

    dispatched.resolve(failure(
      'outcome_unknown',
      'The upload may have completed; verify before retrying.'
    ))
    await settleReact()

    expect(mounted.container.querySelector('[role="alert"]')?.textContent)
      .toContain('outcome_unknown')
    expect(mounted.container.textContent)
      .toContain('Verify the Provider and destination state before taking another action.')
    expect(transferProgress(mounted.container)).toMatchObject({
      operation: 'upload',
      phase: 'failed'
    })
  })

  it('cancels stale Provider reads, portable observations, and discovery on switch or unmount', async () => {
    let providerReadSignal: AbortSignal | undefined
    const providerRead = deferred<Awaited<ReturnType<
      ContentSpaceCapabilityClient['listContainers']
    >>>()
    const listContainers = vi.fn((
      input: Parameters<ContentSpaceCapabilityClient['listContainers']>[0],
      options?: Parameters<ContentSpaceCapabilityClient['listContainers']>[1]
    ) => {
      if (input.providerInstanceRef === providerOne) {
        providerReadSignal = options?.signal
        return providerRead.promise
      }
      return Promise.resolve(ok({
        providerInstanceRef: input.providerInstanceRef,
        items: []
      }))
    })
    const providerMounted = await mountPanel(panelClient({ listContainers }))
    await selectProvider(providerMounted.container, providerOne)
    expect(providerReadSignal?.aborted).toBe(false)
    await selectProvider(providerMounted.container, providerTwo)
    expect(providerReadSignal?.aborted).toBe(true)
    await providerMounted.unmount()

    let portableSignal: AbortSignal | undefined
    const firstObservation = deferred<Awaited<ReturnType<
      ContentSpaceCapabilityClient['observeResource']
    >>>()
    const observeResource = vi.fn((
      input: Parameters<ContentSpaceCapabilityClient['observeResource']>[0],
      options?: Readonly<{ signal?: AbortSignal }>
    ) => {
      if (input.resource.token === 'resource-a') {
        portableSignal = options?.signal
        return firstObservation.promise
      }
      return Promise.resolve({
        reference: secondRootReference,
        entry: {
          kind: 'container' as const,
          reference: secondRootReference,
          label: 'Second root'
        },
        capabilities: []
      })
    })
    const resourceMounted = await mountPanel(panelClient({ observeResource }), {
      initialResource: sessionResource(
        CONTENT_CONTAINER_RESOURCE_KIND,
        'portable-a',
        'resource-a'
      )
    })
    expect(portableSignal?.aborted).toBe(false)
    await resourceMounted.rerender({
      initialResource: sessionResource(
        CONTENT_CONTAINER_RESOURCE_KIND,
        'portable-b',
        'resource-b'
      )
    })
    expect(portableSignal?.aborted).toBe(true)
    await resourceMounted.unmount()

    let discoverySignal: AbortSignal | undefined
    const discovery = deferred<Awaited<ReturnType<
      ContentSpaceCapabilityClient['listProviderInstances']
    >>>()
    const discoveryMounted = await mountPanel(panelClient({
      listProviderInstances: (options) => {
        discoverySignal = options?.signal
        return discovery.promise
      }
    }))
    expect(discoverySignal?.aborted).toBe(false)
    await discoveryMounted.unmount()
    expect(discoverySignal?.aborted).toBe(true)
  })
})

type MountedPanel = Readonly<{
  container: HTMLDivElement
  rerender(props?: Partial<ContentSpacePanelProps>): Promise<void>
  unmount(): Promise<void>
}>

async function mountContainerPanel(
  client: ContentSpaceCapabilityClient,
  transfers: DomainRendererFileTransferHost
): Promise<MountedPanel> {
  return mountPanel(client, {
    fileTransfers: transfers,
    initialResource: sessionResource(
      CONTENT_CONTAINER_RESOURCE_KIND,
      'portable-root-id',
      'portable-root-token'
    )
  })
}

async function mountPanel(
  client: ContentSpaceCapabilityClient,
  initialProps: Partial<ContentSpacePanelProps> = {}
): Promise<MountedPanel> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let currentProps = initialProps
  const render = async () => {
    await act(async () => {
      root.render(<ContentSpacePanel client={client} {...currentProps} />)
      await tick()
      await tick()
    })
  }
  const mounted: MountedPanel = {
    container,
    rerender: async (props = {}) => {
      currentProps = { ...currentProps, ...props }
      await render()
      await settleReact()
    },
    unmount: async () => {
      if (!mountedPanels.delete(mounted)) return
      await act(async () => root.unmount())
      container.remove()
    }
  }
  mountedPanels.add(mounted)
  await render()
  await settleReact()
  return mounted
}

function panelClient(
  overrides: Partial<ContentSpaceCapabilityClient> = {}
): ContentSpaceCapabilityClient {
  return {
    listProviderInstances: async () => ok({
      items: [
        { providerInstanceRef: providerOne, label: 'Mock One' },
        { providerInstanceRef: providerTwo, label: 'Mock Two' }
      ]
    }),
    describeCapabilities: async () => ok({
      items: readyCapabilities('list-containers', 'list-entries')
    }),
    listContainers: async (input) => ok({
      providerInstanceRef: input.providerInstanceRef,
      items: []
    }),
    listEntries: async (input) => ok({ parent: input.parent, items: [fileEntry] }),
    observeEntry: async (reference) => {
      if ('containerId' in reference) {
        return ok({
          entry: { kind: 'container' as const, reference, label: reference.containerId },
          capabilities: navigationCapabilities
        })
      }
      return ok({ entry: fileEntry, capabilities: fileCapabilities })
    },
    createFolder: async (input) => ok({
      invocationId: 'renderer-create-default',
      parent: input.parent,
      name: input.name,
      reference: {
        providerInstanceRef: input.parent.providerInstanceRef,
        containerId: 'created-folder'
      }
    }),
    uploadNew: async (input) => ok({
      invocationId: 'renderer-upload-default',
      parent: input.parent,
      name: input.name,
      sourceSize: 0,
      reference: {
        providerInstanceRef: input.parent.providerInstanceRef,
        fileId: 'uploaded-file'
      }
    }),
    download: async (input) => ok({
      invocationId: 'renderer-download-default',
      reference: input.reference,
      bytesWritten: 128
    }),
    openPortal: async () => ok({ opened: true as const }),
    observeImmutableVersion: async () => ok({
      proven: false as const,
      reasonCode: 'verification_profile_required' as const
    }),
    observeResource: async () => ({
      reference: rootReference,
      entry: {
        kind: 'container' as const,
        reference: rootReference,
        label: 'Root'
      },
      capabilities: navigationCapabilities
    }),
    ...overrides
  }
}

function fileTransfers(): DomainRendererFileTransferHost & Readonly<{
  pickUploadSource: ReturnType<typeof vi.fn>
  pickDownloadDestination: ReturnType<typeof vi.fn>
}> {
  return {
    pickUploadSource: vi.fn(async () => ({
      cancelled: false as const,
      handle: `xfer_${'u'.repeat(32)}`,
      name: 'upload.bin',
      size: 256
    })),
    pickDownloadDestination: vi.fn(async () => ({
      cancelled: false as const,
      handle: `xfer_${'d'.repeat(32)}`,
      label: 'paper.pdf'
    }))
  }
}

function readyCapabilities(
  ...operations: readonly ContentSpaceOperation[]
): readonly ContentSpaceCapabilityState[] {
  return operations.map((operation) => Object.freeze({
    operation,
    readiness: 'production_ready' as const,
    reasonCode: 'available' as const
  }))
}

function sessionResource(
  kind: string,
  resourceRef: string,
  token: string
): DomainRendererSessionResource {
  return Object.freeze({
    kind,
    resourceRef,
    resource: Object.freeze({
      token,
      semanticRevision: 'revision-1',
      expiresAt: '2026-08-16T12:00:00.000Z'
    })
  })
}

function ok<Value>(value: Value): ContentSpaceResult<Value> {
  return Object.freeze({ ok: true, value })
}

function failure(
  code: 'outcome_unknown',
  message: string
): ContentSpaceResult<never> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, retry: 'never' as const })
  })
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await tick()
    await tick()
  })
}

async function selectProvider(container: HTMLElement, value: string): Promise<void> {
  const select = providerSelect(container)
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    await tick()
  })
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    expect(setter).toBeTypeOf('function')
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
  })
}

function providerSelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector('#content-space-provider')
  expect(select).toBeInstanceOf(HTMLSelectElement)
  return select as HTMLSelectElement
}

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = buttonByTextOrNull(container, label)
  expect(button, `Missing button: ${label}`).not.toBeNull()
  return button as HTMLButtonElement
}

function buttonContainingText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.includes(label)
  )
  expect(button, `Missing button containing: ${label}`).not.toBeUndefined()
  return button as HTMLButtonElement
}

function buttonByTextOrNull(container: HTMLElement, label: string): HTMLButtonElement | null {
  return [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label
  ) ?? null
}

function transferProgress(container: HTMLElement): Readonly<{
  operation: string | undefined
  phase: string | undefined
}> {
  const element = container.querySelector('[data-content-space-transfer-progress]')
  expect(element).not.toBeNull()
  return Object.freeze({
    operation: element?.getAttribute('data-operation') ?? undefined,
    phase: element?.getAttribute('data-phase') ?? undefined
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
