/**
 * Small iframe-side bridge. The host binds messages to the active plugin
 * generation; the SDK never exposes Electron, Node.js, or host credentials.
 */
export function createSciForgeUiSdk(options = {}) {
  const target = options.target ?? window.parent
  const targetOrigin = options.targetOrigin ?? '*'
  const timeoutMs = options.timeoutMs ?? 10_000
  const pending = new Map()
  let nextRequestId = 0
  let disposed = false

  const post = (message) => {
    if (disposed) throw new Error('SciForge UI SDK has been disposed.')
    target.postMessage(message, targetOrigin)
  }

  const onMessage = (event) => {
    if (event.source !== target || !event.data || typeof event.data !== 'object') return
    const message = event.data
    if (message.type !== 'result' && message.type !== 'error') return
    if (typeof message.requestId !== 'string') return
    const request = pending.get(message.requestId)
    if (!request) return
    pending.delete(message.requestId)
    clearTimeout(request.timer)
    if (message.type === 'error') request.reject(new Error(typeof message.error === 'string' ? message.error : 'SciForge UI request failed.'))
    else request.resolve(message.output)
  }

  window.addEventListener('message', onMessage)
  post({ type: 'ready' })

  return Object.freeze({
    ready() {
      post({ type: 'ready' })
    },
    invoke(capabilityId, input) {
      if (typeof capabilityId !== 'string' || !capabilityId.trim()) return Promise.reject(new Error('A capability id is required.'))
      const requestId = `ui-${++nextRequestId}`
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId)
          reject(new Error(`SciForge UI request timed out: ${capabilityId}`))
        }, timeoutMs)
        pending.set(requestId, { resolve, reject, timer })
        try {
          post({ type: 'invoke', requestId, capabilityId, input })
        } catch (error) {
          clearTimeout(timer)
          pending.delete(requestId)
          reject(error)
        }
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      window.removeEventListener('message', onMessage)
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(new Error('SciForge UI SDK was disposed.'))
      }
      pending.clear()
      try {
        target.postMessage({ type: 'dispose' }, targetOrigin)
      } catch {
        // The frame may already be detached during host teardown.
      }
    }
  })
}
