const PREWARM_DELAY_MS = 5_000
const MIN_IDLE_BUDGET_MS = 16

let prewarmStarted = false

/**
 * Warm Mol* only after the workbench has committed and the renderer has spare
 * time. In Vite development mode Mol* expands into thousands of modules, so an
 * import cannot be made genuinely background work in the renderer's JS realm.
 * Production uses bundled chunks and can safely benefit from idle prewarming.
 */
export function scheduleMolecularMolstarPrewarm(): () => void {
  if (import.meta.env.DEV || prewarmStarted || typeof window.requestIdleCallback !== 'function') {
    return () => undefined
  }

  let cancelled = false
  let idleHandle: number | null = null

  const requestIdlePrewarm = (): void => {
    idleHandle = window.requestIdleCallback((deadline) => {
      idleHandle = null
      if (cancelled || prewarmStarted) return

      if (deadline.timeRemaining() < MIN_IDLE_BUDGET_MS) {
        requestIdlePrewarm()
        return
      }

      prewarmStarted = true
      void import('./molecular-molstar')
        .then((module) => module.preloadMolecularMolstarRuntime())
        .catch((error) => {
          prewarmStarted = false
          console.warn('[workspace-preview] Mol* runtime prewarm failed:', error)
        })
    })
  }

  const delayHandle = window.setTimeout(requestIdlePrewarm, PREWARM_DELAY_MS)

  return () => {
    cancelled = true
    window.clearTimeout(delayHandle)
    if (idleHandle != null) window.cancelIdleCallback(idleHandle)
  }
}
