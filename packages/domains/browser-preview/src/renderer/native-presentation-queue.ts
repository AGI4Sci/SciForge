import type { DomainCapabilityResourceHandle } from '@sciforge/domain-sdk/host'
import type { BrowserPresentationInput } from '../contract'

type Presentation = Readonly<{
  input: BrowserPresentationInput
  resource: DomainCapabilityResourceHandle
  onError: (error: unknown) => void
}>

/** One stream survives layout-effect restarts (collapse/fullscreen). An old
 * cleanup must never finish after a newer show and leave the page hidden. */
export function createNativePresentationQueue(
  send: (input: BrowserPresentationInput, resource: DomainCapabilityResourceHandle) => Promise<unknown>
): (next: Presentation) => void {
  const pending: Presentation[] = []
  let running = false
  const flush = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      while (pending.length) {
        const next = pending.shift()!
        try { await send(next.input, next.resource) } catch (error) { next.onError(error) }
      }
    } finally { running = false }
  }
  return next => {
    // Only adjacent presentations for the exact same opaque handle coalesce.
    // A renewed handle is retained verbatim, never reconstructed.
    if (pending.at(-1)?.resource === next.resource) pending[pending.length - 1] = next
    else pending.push(next)
    void flush()
  }
}
