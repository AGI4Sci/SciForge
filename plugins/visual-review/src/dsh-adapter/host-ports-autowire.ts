import type { Json, PortRequest, VisualReviewPorts } from '../ports/visual-review-ports.js'
import { setVisualReviewPorts } from './handlers.js'

/**
 * Auto-wiring for the host ports bridge (delivered as a reference
 * implementation on the feat/host-ports-bridge line). The runner injects
 * `globalThis.__sciforgeHostPorts` before the plugin entry is imported; when
 * it is present, artifact-bound capabilities go live without any host-side
 * per-plugin code. When it is absent (bridge not merged / not connected), the
 * plugin keeps its fail-closed behaviour and setVisualReviewPorts stays
 * available for tests.
 *
 * Transport notes (v1 bridge): the injected client owns the wire protocol
 * (`sciforge-host-ports.v1`) and generates request ids itself, so the wrapper
 * forwards only {operation, input, caller}. Cancellation is not reachable
 * per-request in v1 (the client never exposes the generated id), so cancel is
 * a truthful no-op. The host binds identity and authorizes against the
 * adapter contract's ports allowlist, so the identity below is a declared
 * placeholder, never trusted.
 */

type InjectedHostPorts = Readonly<{
  request(request: unknown): Promise<unknown>
  cancel(requestId: string): Promise<unknown>
}>

declare global {
  // eslint-disable-next-line no-var
  var __sciforgeHostPorts: InjectedHostPorts | undefined
}

export function autoWireHostPorts(): boolean {
  const injected = globalThis.__sciforgeHostPorts
  if (!injected || typeof injected.request !== 'function') return false
  const ports: VisualReviewPorts = Object.freeze({
    identity: Object.freeze({
      pluginId: '@sciforge/plugin-visual-review',
      version: '0.1.0',
      profileId: 'host-bound'
    }),
    storageRoot: '',
    async request(request: PortRequest): Promise<Json> {
      return await injected.request({
        operation: request.operation,
        input: request.input,
        ...(request.caller ? { caller: request.caller } : {})
      }) as Json
    },
    async cancel(): Promise<{ cancelled: boolean; quiescent: boolean }> {
      // v1: the bridge client never exposes its generated request ids, so a
      // per-request cancel cannot be addressed. Report quiescence honestly.
      return { cancelled: false, quiescent: true }
    }
  })
  setVisualReviewPorts(ports)
  return true
}
