import { describe, expect, it, vi } from 'vitest'

import { rendererFileTransferHostFor } from './file-transfer-client'

const requestId = '11111111-1111-4111-8111-111111111111'

describe('rendererFileTransferHostFor', () => {
  it('does not resolve the browser transport until a picker is called', async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    let windowReads = 0
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      get: () => {
        windowReads += 1
        throw new Error('window accessed')
      }
    })
    try {
      const host = rendererFileTransferHostFor('sciforge.workspace-files')
      expect(windowReads).toBe(0)

      await expect(host.pickUploadSource({ title: 'Upload', maxBytes: 1_024 }))
        .rejects.toThrow('window accessed')
      expect(windowReads).toBe(1)
    } finally {
      if (originalWindow) {
        Object.defineProperty(globalThis, 'window', originalWindow)
      } else {
        Reflect.deleteProperty(globalThis, 'window')
      }
    }
  })

  it('binds the installed owner and opaque transport request identity', async () => {
    const transport = {
      pickUploadSource: vi.fn(async () => ({
        cancelled: false as const,
        handle: `xfer_${'a'.repeat(32)}`,
        name: 'paper.pdf',
        size: 42
      })),
      pickDownloadDestination: vi.fn(),
      cancel: vi.fn(async () => true),
      settle: vi.fn(async () => true)
    }
    const host = rendererFileTransferHostFor(
      'sciforge.workspace-files',
      transport as never,
      () => requestId
    )

    await expect(host.pickUploadSource({ title: 'Upload', maxBytes: 1_024 }))
      .resolves.toMatchObject({ cancelled: false, name: 'paper.pdf' })
    expect(transport.pickUploadSource).toHaveBeenCalledWith({
      ownerId: 'sciforge.workspace-files',
      request: { title: 'Upload', maxBytes: 1_024 },
      transportRequestId: requestId
    })
    expect(transport.settle).toHaveBeenCalledWith(requestId)
  })

  it('cancels an in-flight picker by transport request identity', async () => {
    let resolvePicker: ((value: { cancelled: true }) => void) | undefined
    const transport = {
      pickUploadSource: vi.fn(() => new Promise<{ cancelled: true }>((resolve) => {
        resolvePicker = resolve
      })),
      pickDownloadDestination: vi.fn(),
      cancel: vi.fn(async () => true),
      settle: vi.fn(async () => true)
    }
    const controller = new AbortController()
    const host = rendererFileTransferHostFor(
      'sciforge.workspace-files',
      transport as never,
      () => requestId
    )
    const pending = host.pickUploadSource(
      { title: 'Upload', maxBytes: 1_024 },
      { signal: controller.signal }
    )

    controller.abort(new Error('picker cancelled'))
    expect(transport.cancel).toHaveBeenCalledWith(requestId)
    resolvePicker?.({ cancelled: true })
    await expect(pending).rejects.toThrow('picker cancelled')
  })

  it('revokes a response cancelled before renderer settlement', async () => {
    let resolvePicker: ((value: {
      cancelled: false
      handle: string
      name: string
      size: number
    }) => void) | undefined
    const transport = {
      pickUploadSource: vi.fn(() => new Promise<{
        cancelled: false
        handle: string
        name: string
        size: number
      }>((resolve) => {
        resolvePicker = resolve
      })),
      pickDownloadDestination: vi.fn(),
      cancel: vi.fn(async () => true),
      settle: vi.fn(async () => true)
    }
    const controller = new AbortController()
    const host = rendererFileTransferHostFor(
      'sciforge.workspace-files',
      transport as never,
      () => requestId
    )
    const pending = host.pickUploadSource(
      { title: 'Upload', maxBytes: 1_024 },
      { signal: controller.signal }
    )

    resolvePicker?.({
      cancelled: false,
      handle: `xfer_${'b'.repeat(32)}`,
      name: 'paper.pdf',
      size: 42
    })
    controller.abort(new DOMException('cancelled before delivery', 'AbortError'))

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(transport.cancel).toHaveBeenCalledWith(requestId)
    expect(transport.settle).not.toHaveBeenCalled()
  })

  it('does not dispatch an already-cancelled picker', async () => {
    const transport = {
      pickUploadSource: vi.fn(),
      pickDownloadDestination: vi.fn(),
      cancel: vi.fn(),
      settle: vi.fn()
    }
    const controller = new AbortController()
    controller.abort(new Error('already cancelled'))
    const host = rendererFileTransferHostFor(
      'sciforge.workspace-files',
      transport as never,
      () => requestId
    )

    await expect(host.pickUploadSource(
      { title: 'Upload', maxBytes: 1_024 },
      { signal: controller.signal }
    )).rejects.toThrow('already cancelled')
    expect(transport.pickUploadSource).not.toHaveBeenCalled()
  })

  it('closes the abort race between the initial check and listener registration', async () => {
    const transport = {
      pickUploadSource: vi.fn(),
      pickDownloadDestination: vi.fn(),
      cancel: vi.fn(async () => true),
      settle: vi.fn(async () => true)
    }
    const controller = new AbortController()
    const host = rendererFileTransferHostFor(
      'sciforge.workspace-files',
      transport as never,
      () => {
        controller.abort(new DOMException('raced cancellation', 'AbortError'))
        return requestId
      }
    )

    await expect(host.pickUploadSource(
      { title: 'Upload', maxBytes: 1_024 },
      { signal: controller.signal }
    )).rejects.toThrow('raced cancellation')
    expect(transport.cancel).toHaveBeenCalledWith(requestId)
    expect(transport.pickUploadSource).not.toHaveBeenCalled()
  })
})
