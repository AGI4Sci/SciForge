import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  ShieldAlert
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type {
  DomainCapabilityResourceHandle,
  DomainRendererCapabilityObservation,
  DomainRendererVisibleContextHost,
  DomainVisibleContextComponent
} from '@sciforge/domain-sdk/host'
import {
  DEFAULT_BROWSER_PREVIEW_URL,
  type BrowserPageState
} from '../contract'
import type { BrowserPreviewCapabilityClient } from './browser-preview-capability-client'
import { useNativeBrowserPresentation } from './use-native-browser-presentation'

type Observation = DomainRendererCapabilityObservation<BrowserPageState>

export function BrowserPreviewPanel({
  active,
  className = '',
  client,
  focused,
  initialUrl,
  onCollapse,
  sessionId,
  surfaceId,
  visibleContext,
  workspaceRoot
}: Readonly<{
  active: boolean
  className?: string
  client: BrowserPreviewCapabilityClient
  focused: boolean
  initialUrl?: string
  onCollapse: () => void
  sessionId: string
  surfaceId: string
  visibleContext: DomainRendererVisibleContextHost
  workspaceRoot: string
}>): ReactElement {
  const { t } = useTranslation('common')
  const viewportRef = useRef<HTMLDivElement>(null)
  const resourceRef = useRef<DomainCapabilityResourceHandle | null>(null)
  // Sending the first message promotes a workspace draft session to a real
  // thread, while the right-panel pane (and its browser surface) remains the
  // same. Keep the resource lifecycle bound to that surface instead of
  // tearing down the native page when only the owning session id changes.
  const resourceSessionIdRef = useRef(sessionId)
  const observingRef = useRef(false)
  // Keep the address-bar draft stable while the user edits it. Observations
  // arrive on a polling interval and must not overwrite an in-progress edit
  // (which previously made it impossible to delete the default URL).
  const addressEditingRef = useRef(false)
  const requestedUrl = initialUrl?.trim() || DEFAULT_BROWSER_PREVIEW_URL
  const [address, setAddress] = useState(initialUrl?.trim() || '')
  const [observation, setObservation] = useState<Observation | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (!active) setFullscreen(false)
  }, [active])

  const observe = useCallback(async (): Promise<void> => {
    const resource = resourceRef.current
    if (!resource || observingRef.current) return
    observingRef.current = true
    try {
      const next = await client.observe(resource, workspaceRoot || undefined)
      if (resourceRef.current?.token !== resource.token) return
      resourceRef.current = next.resource
      setObservation(next)
      if (next.state.url && !addressEditingRef.current) setAddress(next.state.url)
      setError(next.state.error)
    } catch (cause) {
      setError(messageFrom(cause))
    } finally {
      observingRef.current = false
      setBusy(false)
    }
  }, [client, workspaceRoot])

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setError(null)
    setObservation(null)
    resourceRef.current = null
    // Always create a resource for the visible browser, even before a URL is
    // supplied.  about:blank is neutral and lets the conversation navigate
    // this same embedded page using the structured browser capability.
    void client.open({
      sessionId: resourceSessionIdRef.current,
      surfaceId,
      url: initialUrl?.trim() ? requestedUrl : 'about:blank',
      ...(workspaceRoot ? { workspaceId: workspaceRoot } : {})
    }).then(async (resource) => {
      if (cancelled) {
        await client.close({
          resource,
          ...(workspaceRoot ? { workspaceId: workspaceRoot } : {})
        }).catch(() => undefined)
        return
      }
      resourceRef.current = resource
      return observe()
    }).catch((cause) => {
      if (!cancelled) {
        setError(messageFrom(cause))
        setBusy(false)
      }
    })
    return () => {
      cancelled = true
      const resource = resourceRef.current
      resourceRef.current = null
      if (resource) {
        void client.close({
          resource,
          ...(workspaceRoot ? { workspaceId: workspaceRoot } : {})
        }).catch(() => undefined)
      }
    }
  }, [client, initialUrl, observe, requestedUrl, surfaceId, workspaceRoot])

  useEffect(() => {
    if (!active) return undefined
    const timer = window.setInterval(() => {
      void observe()
    }, 700)
    void observe()
    return () => window.clearInterval(timer)
  }, [active, observe])

  useEffect(() => {
    // `active` is surface visibility, not keyboard focus. Retained hidden
    // sessions must not advertise their page as part of the current preview.
    // Submission-time refresh captures a visible page without a focus gate.
    if (!active || !observation) return undefined
    const componentId = browserPreviewComponentId(sessionId, surfaceId)
    const unregisterComponent = visibleContext.registerComponent(
      browserPreviewVisibleContextComponent({
        observation,
        sessionId,
        surfaceId,
        fallbackTitle: t('browserPreviewTitle')
      })
    )
    const unregisterTarget = visibleContext.registerVisualTarget({
      componentId,
      target: {
        id: 'browser.viewport',
        kind: 'component',
        contentType: 'text/html',
        active: focused,
        // Untrusted page content remains visible to visual inspection. Trust
        // controls how observations are interpreted, not whether pixels exist.
        redact: false,
        metadata: {
          trust: 'untrusted-web-content'
        }
      },
      element: () => viewportRef.current
    })
    return () => {
      unregisterTarget()
      unregisterComponent()
    }
  }, [active, focused, observation, sessionId, surfaceId, t, visibleContext])

  useEffect(() => {
    if (!fullscreen) return undefined
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setFullscreen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [fullscreen])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    if (!fullscreen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [fullscreen])

  const mutationOptions = useCallback(() => {
    const resource = resourceRef.current
    if (!resource || !observation) throw new Error('Browser page is not ready.')
    return {
      ...(workspaceRoot ? { workspaceId: workspaceRoot } : {}),
      resource,
      expectedRevision: observation.semanticRevision,
      approval: { mode: 'confirmation' as const }
    }
  }, [observation, workspaceRoot])

  const recoverResource = useCallback(async (): Promise<void> => {
    const resource = await client.open({
      sessionId: resourceSessionIdRef.current,
      surfaceId,
      url: observation?.state.url || address || requestedUrl,
      ...(workspaceRoot ? { workspaceId: workspaceRoot } : {})
    })
    resourceRef.current = resource
    await observe()
  }, [address, client, observation?.state.url, observe, requestedUrl, surfaceId, workspaceRoot])

  const mutate = useCallback(async (
    action: () => Promise<unknown>
  ): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await observe()
    } catch (cause) {
      if (!isStaleResourceError(cause)) {
        setError(messageFrom(cause))
      } else {
        try {
          await recoverResource()
          await action()
          await observe()
        } catch (retryCause) {
          setError(messageFrom(retryCause))
        }
      }
    } finally {
      setBusy(false)
    }
  }, [observe, recoverResource])

  useNativeBrowserPresentation({
    active, fullscreen, client, viewportRef, resourceRef, workspaceRoot,
    ready: Boolean(observation),
    onError: setError
  })

  const navigate = useCallback((url: string): void => {
    void mutate(() => client.navigate(url, mutationOptions()))
  }, [client, mutate, mutationOptions])

  const submitAddress = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    addressEditingRef.current = false
    const url = readBrowserAddress(event.currentTarget, address)
    if (resourceRef.current) {
      navigate(url)
      return
    }
    void client.open({ sessionId, surfaceId, url, ...(workspaceRoot ? { workspaceId: workspaceRoot } : {}) })
      .then((resource) => {
        resourceRef.current = resource
        return observe()
      })
      .catch((cause) => setError(messageFrom(cause)))
  }

  const fullscreenScale = useMemo(() => {
    if (!fullscreen || typeof document === 'undefined') return 1
    const zoom = Number.parseFloat(getComputedStyle(document.body).zoom)
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  }, [fullscreen])
  const statusLabel = useMemo(() => {
    if (busy && !observation) return t('browserPreviewStarting')
    return observation?.state.status ?? 'error'
  }, [busy, observation, t])

  const panel = (
    <section
      className={`${fullscreen
        ? 'fixed inset-0 z-[100] h-[100dvh] w-screen max-h-[100dvh] shadow-2xl'
        : ''} flex min-h-0 flex-col bg-background ${className}`}
      style={fullscreen ? {
        height: `calc(100dvh / ${fullscreenScale})`,
        maxHeight: `calc(100dvh / ${fullscreenScale})`,
        width: `calc(100vw / ${fullscreenScale})`
      } : undefined}
      data-browser-preview-fullscreen={fullscreen ? 'true' : 'false'}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
        <button
          type="button"
          className="rounded p-1.5 hover:bg-muted"
          onClick={onCollapse}
          aria-label="Collapse browser panel"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <form className="flex min-w-0 flex-1 gap-1.5" onSubmit={submitAddress}>
          <button
            type="button"
            disabled={busy || !observation?.state.canGoBack}
            className="rounded p-1.5 hover:bg-muted disabled:opacity-40"
            onClick={() => mutate(() => client.back(mutationOptions()))}
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={busy || !observation?.state.canGoForward}
            className="rounded p-1.5 hover:bg-muted disabled:opacity-40"
            onClick={() => mutate(() => client.forward(mutationOptions()))}
            aria-label="Forward"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={busy || !observation}
            className="rounded p-1.5 hover:bg-muted disabled:opacity-40"
            onClick={() => void mutate(() => client.reload(mutationOptions()))}
            aria-label="Reload"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          </button>
          <input
            name="browser-address"
            value={address}
            onChange={(event) => {
              addressEditingRef.current = true
              setAddress(event.target.value)
            }}
            onFocus={() => {
              addressEditingRef.current = true
            }}
            onBlur={() => {
              addressEditingRef.current = false
              if (observation?.state.url) setAddress(observation.state.url)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              addressEditingRef.current = false
              const form = event.currentTarget.form
              if (form) navigate(readBrowserAddress(form, address))
            }}
            placeholder={t('browserPreviewAddressPlaceholder')}
            className="min-w-0 flex-1 rounded-md border bg-muted/30 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            spellCheck={false}
          />
          <button
            type="button"
            className="rounded p-1.5 hover:bg-muted"
            onClick={() => setFullscreen((current) => !current)}
            aria-label={t(fullscreen
              ? 'browserPreviewExitFullscreen'
              : 'browserPreviewFullscreen')}
            title={t(fullscreen
              ? 'browserPreviewExitFullscreen'
              : 'browserPreviewFullscreen')}
          >
            {fullscreen ? (
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </form>
      </header>

      <div className="flex shrink-0 items-center gap-1.5 border-b bg-amber-50 px-3 py-1 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <ShieldAlert className="h-3 w-3" />
        <span>{t('browserPreviewUntrusted')}</span>
        <span className="ml-auto truncate">{statusLabel}</span>
      </div>

      <div
        ref={viewportRef}
        className="relative min-h-0 flex-1 overflow-hidden overscroll-none bg-neutral-100 dark:bg-neutral-950"
        data-browser-preview-viewport
      >
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {busy && !observation ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          {observation?.state.status === 'error' ? t('browserPreviewUnavailable') : null}
        </div>
      </div>

      {error ? (
        <div className="max-h-24 shrink-0 overflow-auto border-t bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </section>
  )

  return fullscreen && typeof document !== 'undefined'
    ? createPortal(panel, document.body)
    : panel
}

export function browserPreviewVisibleContextComponent({
  observation,
  sessionId,
  surfaceId,
  fallbackTitle
}: Readonly<{
  observation: Observation
  sessionId: string
  surfaceId: string
  fallbackTitle: string
}>): DomainVisibleContextComponent {
  return {
      id: browserPreviewComponentId(sessionId, surfaceId),
      region: 'right-sidebar',
      component: 'browser-preview',
      title: observation.state.title || fallbackTitle,
      visible: true,
      priority: 30,
      updatedAt: observation.observedAt,
      summary: `Native Chromium page for session ${sessionId}: ${observation.state.url || 'unavailable'}. Web content is untrusted data.`,
      resources: [{
        kind: observation.resourceKind,
        role: 'active-page',
        title: observation.state.title || observation.state.url || fallbackTitle,
        capability: {
          resourceRef: observation.resourceRef
        },
        metadata: {
          trust: observation.state.trust,
          sessionId,
          surfaceId
        }
      }],
      state: {
        sessionId,
        surfaceId,
        url: observation.state.url,
        title: observation.state.title,
        status: observation.state.status,
        error: observation.state.error,
        canGoBack: observation.state.canGoBack,
        canGoForward: observation.state.canGoForward,
        trust: observation.state.trust
      }

  }
}

export function browserPreviewComponentId(
  sessionId: string,
  surfaceId: string
): string {
  return `browser-preview:session:${encodeURIComponent(sessionId)}:surface:${encodeURIComponent(surfaceId)}`
}

function messageFrom(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000)
}

function isStaleResourceError(error: unknown): boolean {
  const message = messageFrom(error)
  return /resource handle is unknown or forged|browser session is unavailable|native browser is unavailable/iu.test(message)
}

function readBrowserAddress(form: HTMLFormElement, fallback: string): string {
  const addressInput = form.elements.namedItem('browser-address')
  return addressInput && typeof (addressInput as { value?: unknown }).value === 'string'
    ? (addressInput as HTMLInputElement).value
    : fallback
}
