import React from 'react'
import ReactDOM from 'react-dom/client'
import 'katex/dist/katex.min.css'
import '@xyflow/react/dist/style.css'
import 'molstar/build/viewer/molstar.css'
import './index.css'
import './styles/base-shell.css'
import './styles/surfaces-write.css'
import './styles/markdown-code.css'
import './styles/write-editor.css'
import './styles/write-rich-editor.css'
import './styles/workflow-canvas.css'
import App from './App'
import './i18n'
import { installDevSciForgeBridge } from './dev/dev-sciforge-bridge'
import { rendererRuntimeClient } from './agent/runtime-client'

installDevSciForgeBridge()
rendererRuntimeClient.startSettingsChangeListener()
document.documentElement.dataset.platform = window.sciforge?.platform ?? 'unknown'

function prewarmMolecularPreviewRuntime(): void {
  const prewarm = () => {
    void import('./workspace-preview/molecular-molstar')
      .then((module) => module.preloadMolecularMolstarRuntime())
      .catch((error) => {
        console.warn('[workspace-preview] Mol* runtime prewarm failed:', error)
      })
  }

  const requestIdleCallback = typeof window.requestIdleCallback === 'function'
    ? window.requestIdleCallback.bind(window)
    : null
  if (requestIdleCallback) {
    requestIdleCallback(prewarm, { timeout: 8_000 })
    return
  }

  window.setTimeout(prewarm, 2_500)
}

prewarmMolecularPreviewRuntime()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
