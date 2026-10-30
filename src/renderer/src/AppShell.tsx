import { lazy, Suspense, useEffect, useState } from 'react'
import { useChatStore } from './store/chat-store'
import { clearPersistedActiveThread } from './store/chat-session-persistence'
import type { AppRoute } from './store/chat-store-types'
import { supportsDesktopTitleBar, WindowsTitleBar } from './components/WindowsTitleBar'

const Workbench = lazy(() =>
  import('./components/Workbench').then((module) => ({ default: module.Workbench }))
)
const SettingsView = lazy(() =>
  import('./components/SettingsView').then((module) => ({ default: module.SettingsView }))
)
const InitialSetupDialog = lazy(() =>
  import('./components/InitialSetupDialog').then((module) => ({
    default: module.InitialSetupDialog
  }))
)

export function RouteFallback(): React.ReactElement {
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    const timeout = window.setTimeout(() => setTimedOut(true), 10_000)
    return () => window.clearTimeout(timeout)
  }, [])

  const reload = (): void => window.location.reload()
  const resetAndReload = (): void => {
    clearPersistedActiveThread()
    window.location.reload()
  }

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-ds-main text-ds-muted">
      <div className="inline-flex items-center gap-2 rounded-[8px] border border-ds-border-muted bg-ds-card px-3 py-2 text-[12px] font-medium shadow-sm">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
        <div>
          <span>{timedOut ? 'Workspace loading is taking longer than expected.' : 'Restoring workspace...'}</span>
          {timedOut ? (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <button type="button" className="rounded-full bg-ds-hover px-3 py-1" onClick={reload}>
                Retry
              </button>
              <button type="button" className="rounded-full bg-ds-hover px-3 py-1" onClick={resetAndReload}>
                Open without restored session
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function PersistentWorkbenchRoutes({
  route,
  workbench,
  settings
}: {
  route: AppRoute
  workbench: React.ReactNode
  settings: React.ReactNode
}): React.ReactElement {
  const settingsOpen = route === 'settings'
  return (
    <>
      <div
        className={settingsOpen ? 'invisible pointer-events-none absolute inset-0' : 'flex min-h-0 flex-1 flex-col'}
        aria-hidden={settingsOpen}
        inert={settingsOpen}
      >
        {workbench}
      </div>
      {settingsOpen ? (
        <div className="absolute inset-0 flex min-h-0 flex-col bg-ds-main">
          {settings}
        </div>
      ) : null}
    </>
  )
}

export default function AppShell(): React.ReactElement {
  const route = useChatStore((s) => s.route)
  const boot = useChatStore((s) => s.boot)
  const initialSetupOpen = useChatStore((s) => s.initialSetupOpen)
  const platform = typeof window !== 'undefined' ? window.sciforge?.platform ?? 'unknown' : 'unknown'
  const hasDesktopTitleBar = supportsDesktopTitleBar(platform)

  useEffect(() => {
    void boot()
  }, [boot])

  return (
    <div className={hasDesktopTitleBar ? 'ds-windows-app-frame flex h-full min-h-0 flex-col bg-ds-main' : 'flex h-full min-h-0 flex-col bg-transparent'}>
      {hasDesktopTitleBar ? <WindowsTitleBar platform={platform} /> : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Suspense fallback={<RouteFallback />}>
          <PersistentWorkbenchRoutes
            route={route}
            workbench={<Workbench />}
            settings={<SettingsView />}
          />
        </Suspense>
      </div>
      {initialSetupOpen ? (
        <Suspense fallback={null}>
          <InitialSetupDialog />
        </Suspense>
      ) : null}
    </div>
  )
}
