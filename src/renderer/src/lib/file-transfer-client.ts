import type { DomainRendererFileTransferHost } from '@sciforge/domain-sdk/file-transfer'
import { capabilityTransportRequestIdSchema } from '@shared/capability-broker'
import type { SciForgeApi } from '@shared/sciforge-api'

type FileTransferTransport = SciForgeApi['fileTransfers']

function defaultFileTransferTransport(): FileTransferTransport {
  if (typeof window === 'undefined' || !window.sciforge?.fileTransfers) {
    throw new Error('The Host file-transfer transport is unavailable.')
  }
  return window.sciforge.fileTransfers
}

function createTransportRequestId(): string {
  return capabilityTransportRequestIdSchema.parse(globalThis.crypto.randomUUID())
}

function cancellationReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('The file-transfer picker was cancelled.', 'AbortError')
}

async function withCancellation<Result>(
  signal: AbortSignal | undefined,
  transport: FileTransferTransport,
  invoke: (transportRequestId: string) => Promise<Result>,
  requestId: () => string
): Promise<Result> {
  if (signal?.aborted) throw cancellationReason(signal)
  const transportRequestId = requestId()
  const onAbort = () => {
    void transport.cancel(transportRequestId).catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) {
    onAbort()
    signal.removeEventListener('abort', onAbort)
    throw cancellationReason(signal)
  }
  let responseReceived = false
  let settled = false
  try {
    const result = await invoke(transportRequestId)
    responseReceived = true
    if (signal?.aborted) throw cancellationReason(signal)
    // Removing the listener immediately after the synchronous post-response
    // check defines the renderer acceptance point. Until then, cancellation
    // reaches the Host-owned grant through the retained controller.
    signal?.removeEventListener('abort', onAbort)
    settled = await transport.settle(transportRequestId)
    if (!settled) throw cancellationReason(signal)
    return result
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (responseReceived && !settled) {
      void transport.cancel(transportRequestId).catch(() => undefined)
    }
  }
}

/** Creates one renderer-safe, package-owned picker facade. */
export function rendererFileTransferHostFor(
  ownerId: string,
  transport: FileTransferTransport | undefined = undefined,
  requestId: () => string = createTransportRequestId
): DomainRendererFileTransferHost {
  return Object.freeze({
    pickUploadSource: async (request, options) => {
      const activeTransport = transport ?? defaultFileTransferTransport()
      return withCancellation(
        options?.signal,
        activeTransport,
        (transportRequestId) => activeTransport.pickUploadSource({
          ownerId,
          request,
          transportRequestId
        }),
        requestId
      )
    },
    pickDownloadDestination: async (request, options) => {
      const activeTransport = transport ?? defaultFileTransferTransport()
      return withCancellation(
        options?.signal,
        activeTransport,
        (transportRequestId) => activeTransport.pickDownloadDestination({
          ownerId,
          request,
          transportRequestId
        }),
        requestId
      )
    }
  })
}
