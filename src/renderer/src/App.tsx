import { lazy, Suspense, useSyncExternalStore } from 'react'
import { getResourcePreviewSnapshot, subscribeResourcePreview } from './lib/resource-preview'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import AppShell from './AppShell'
import { usePerformanceMode } from './lib/performance-mode'

const ResourcePreviewDialog = lazy(() => import('./components/ResourcePreviewDialog'))

export default function App(): React.ReactElement {
  const preview = useSyncExternalStore(subscribeResourcePreview, getResourcePreviewSnapshot, () => null)
  usePerformanceMode()
  return (
    <AppErrorBoundary>
      <AppShell />
      {preview ? <Suspense fallback={null}><ResourcePreviewDialog key={preview.id} request={preview} /></Suspense> : null}
    </AppErrorBoundary>
  )
}
