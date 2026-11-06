import type { CodeRunsTransport } from '../ui/CodeRunsPanel.js'

export interface PanelBinding {
  pluginId: string
  contributionId: string
  generation: number
  version: string
  workspaceRoot?: string
}
type Pending = { responseType: 'capability.result' | 'composer.result' | 'workspace.pickFile.result'; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
export interface FrameWindow {
  parent: { postMessage(message: unknown, targetOrigin: string): void }
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

/** Public opaque-origin iframe transport. The host binds workspace and invocation authority. */
export function createPanelBridge(frame: FrameWindow, onBinding: (binding: PanelBinding | null) => void, timeoutMs = 660_000) {
  let binding: PanelBinding | null = null
  let disposed = false
  const pending = new Map<string, Pending>()
  const rejectPending = (reason: string): void => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(reason)) }
    pending.clear()
  }
  const receive = (event: MessageEvent): void => {
    if (event.source !== frame.parent || !event.data || typeof event.data !== 'object') return
    const data = event.data
    if (data.type === 'host.init') {
      if (typeof data.pluginId !== 'string' || typeof data.contributionId !== 'string' || typeof data.generation !== 'number' || typeof data.version !== 'string') return
      const next: PanelBinding = { pluginId: data.pluginId, contributionId: data.contributionId, generation: data.generation, version: data.version, ...(typeof data.workspaceRoot === 'string' ? { workspaceRoot: data.workspaceRoot } : {}) }
      if (JSON.stringify(binding) === JSON.stringify(next)) return
      rejectPending('The host panel binding changed.')
      binding = next
      onBinding(next)
    } else if ((data.type === 'capability.result' || data.type === 'composer.result' || data.type === 'workspace.pickFile.result') && typeof data.requestId === 'string') {
      const item = pending.get(data.requestId)
      if (!item || item.responseType !== data.type) return
      pending.delete(data.requestId)
      clearTimeout(item.timer)
      if (data.ok === true) item.resolve(data.type === 'workspace.pickFile.result' ? data.result : data.output)
      else item.reject(new Error(`${data.error?.code ?? 'CAPABILITY_UNAVAILABLE'}: ${data.error?.message ?? 'Scientific Figures operation failed.'}`))
    } else if (data.type === 'dispose') {
      binding = null
      rejectPending('The host disposed this panel.')
      onBinding(null)
    }
  }
  frame.addEventListener('message', receive)
  frame.parent.postMessage({ type: 'ready' }, '*')
  const request = <T,>(message: Record<string, unknown>, responseType: Pending['responseType']): Promise<T> => {
    if (disposed || !binding?.workspaceRoot) return Promise.reject(new Error('No active workspace is bound to this panel.'))
    const requestId = crypto.randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Scientific Figures operation timed out. Check its receipt before retrying.')) }, timeoutMs)
      pending.set(requestId, { responseType, resolve: value => resolve(value as T), reject, timer })
      try { frame.parent.postMessage({ ...message, requestId }, '*') }
      catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error) }
    })
  }
  // Durable operation/run IDs stay in plugin inputs; authority stays with the Host.
  const call: CodeRunsTransport = <T,>(action: string, input: unknown): Promise<T> => request<T>({ type: 'capability.invoke', actionId: 'scientific-figures.operation', input: { action, input } }, 'capability.result')
  return {
    call,
    async pickFile(): Promise<string | undefined> {
      const result = await request<{ canceled: boolean; path?: string }>({ type: 'workspace.pickFile', input: {} }, 'workspace.pickFile.result')
      return result.canceled ? undefined : result.path
    },
    sendMessage(text: string, displayText: string): Promise<void> {
      return request<void>({ type: 'composer.sendMessage', input: { text, displayText } }, 'composer.result')
    },
    dispose(): void {
      disposed = true
      binding = null
      frame.removeEventListener('message', receive)
      rejectPending('The panel was closed.')
    }
  }
}
