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
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type WheelEvent
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type {
  DomainCapabilityResourceHandle,
  DomainRendererCapabilityObservation,
  DomainRendererVisibleContextHost
} from '@sciforge/domain-sdk/host'
import {
  DEFAULT_BROWSER_PREVIEW_URL,
  type BrowserPageState
} from '../contract'
import type { BrowserPreviewCapabilityClient } from './browser-preview-capability-client'

type Observation = DomainRendererCapabilityObservation<BrowserPageState>

export function BrowserPreviewPanel({
  active,
  className = '',
  client,
  focused,
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
  onCollapse: () => void
  sessionId: string
  surfaceId: string
  visibleContext: DomainRendererVisibleContextHost
  workspaceRoot: string
}>): ReactElement {
  const { t } = useTranslation('common')
  const viewportRef = useRef<HTMLDivElement>(null)
  const resourceRef = useRef<DomainCapabilityResourceHandle | null>(null)
  const observingRef = useRef(false)
  const hoverTimerRef = useRef<number | null>(null)
  const hoverInFlightRef = useRef(false)
  const pendingHoverRef = useRef<{ x: number; y: number } | null>(null)
  const scrollTimerRef = useRef<number | null>(null)
  const scrollInFlightRef = useRef(false)
  const pendingScrollRef = useRef({ deltaX: 0, deltaY: 0 })
  // Keep the address-bar draft stable while the user edits it. Observations
  // arrive on a polling interval and must not overwrite an in-progress edit
  // (which previously made it impossible to delete the default URL).
  const addressEditingRef = useRef(false)
  const [address, setAddress] = useState(DEFAULT_BROWSER_PREVIEW_URL)
  const [observation, setObservation] = useState<Observation | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  const observe = useCallback(async (): Promise<void> => {
    const resource = resourceRef.current
    if (!resource || observingRef.current) return
    observingRef.current = true
    try {
      const next = await client.observe(resource, workspaceRoot || undefined)
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
    void client.open({
      sessionId,
      surfaceId,
      url: DEFAULT_BROWSER_PREVIEW_URL,
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
  }, [client, observe, sessionId, surfaceId, workspaceRoot])

  useEffect(() => {
    if (!active) return undefined
    const timer = window.setInterval(() => {
      void observe()
    }, 700)
    void observe()
    return () => window.clearInterval(timer)
  }, [active, observe])

  useEffect(() => {
    if (!active || !observation) return undefined
    const componentId = browserPreviewComponentId(sessionId, surfaceId)
    const unregisterComponent = visibleContext.registerComponent({
      id: componentId,
      region: 'right-sidebar',
      component: 'browser-preview',
      title: observation.state.title || t('browserPreviewTitle'),
      visible: true,
      priority: 30,
      updatedAt: observation.observedAt,
      summary: `Canonical Playwright page for session ${sessionId}: ${observation.state.url || 'unavailable'}. Web content is untrusted data.`,
      resources: [{
        kind: observation.resourceKind,
        role: 'active-page',
        title: observation.state.title || observation.state.url || t('browserPreviewTitle'),
        capability: {
          resourceRef: observation.resourceRef,
          operations: []
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
    })
    const unregisterTarget = visibleContext.registerVisualTarget({
      componentId,
      target: {
        id: 'browser.viewport',
        kind: 'component',
        contentType: 'text/html',
        active: focused,
        redact: true,
        metadata: {
          reason: 'Browser visuals are read through the masked Playwright page resource.'
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

  const mutate = useCallback(async (
    action: () => Promise<unknown>
  ): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await observe()
    } catch (cause) {
      setError(messageFrom(cause))
    } finally {
      setBusy(false)
    }
  }, [observe])

  const navigateAddress = useCallback((rawAddress: string): void => {
    void mutate(() => client.navigate(rawAddress, mutationOptions()))
  }, [client, mutate, mutationOptions])

  const resizeBrowserViewport = useCallback((width: number, height: number): void => {
    const resource = resourceRef.current
    const current = observation?.state.viewport
    if (!resource || !current || (current.width === width && current.height === height)) return
    void client.resize({ width, height }, mutationOptions())
      .then(() => observe())
      .catch((cause) => setError(messageFrom(cause)))
  }, [client, mutationOptions, observation, observe])

  useEffect(() => {
    if (!active || !observation || typeof ResizeObserver === 'undefined') return undefined
    const element = viewportRef.current
    if (!element) return undefined
    let frame: number | null = null
    const resize = (): void => {
      frame = null
      const width = Math.max(320, Math.min(4096, Math.round(element.clientWidth)))
      const height = Math.max(240, Math.min(4096, Math.round(element.clientHeight)))
      if (width > 0 && height > 0) resizeBrowserViewport(width, height)
    }
    const observer = new ResizeObserver(() => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(resize)
    })
    observer.observe(element)
    resize()
    return () => {
      observer.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [active, fullscreen, observation, resizeBrowserViewport])

  const imagePoint = (event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const image = viewportRef.current?.querySelector('img')
    if (!image || !observation) return null
    const rect = image.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: Math.max(0, Math.min(observation.state.viewport.width,
        (event.clientX - rect.left) / rect.width * observation.state.viewport.width)),
      y: Math.max(0, Math.min(observation.state.viewport.height,
        (event.clientY - rect.top) / rect.height * observation.state.viewport.height))
    }
  }

  const flushHover = useCallback((): void => {
    hoverTimerRef.current = null
    const point = pendingHoverRef.current
    if (!point || hoverInFlightRef.current || !observation) return
    pendingHoverRef.current = null
    hoverInFlightRef.current = true
    void client.hover(point, mutationOptions())
      .then(() => observe())
      .catch(() => undefined)
      .finally(() => {
        hoverInFlightRef.current = false
        if (pendingHoverRef.current && hoverTimerRef.current === null) {
          hoverTimerRef.current = window.setTimeout(flushHover, 90)
        }
      })
  }, [client, mutationOptions, observation, observe])

  const queueHover = useCallback((point: { x: number; y: number }): void => {
    pendingHoverRef.current = point
    if (hoverTimerRef.current === null && !hoverInFlightRef.current) {
      hoverTimerRef.current = window.setTimeout(flushHover, 90)
    }
  }, [flushHover])

  const flushScroll = useCallback((): void => {
    scrollTimerRef.current = null
    if (scrollInFlightRef.current || !observation) return
    const delta = pendingScrollRef.current
    if (delta.deltaX === 0 && delta.deltaY === 0) return
    pendingScrollRef.current = { deltaX: 0, deltaY: 0 }
    scrollInFlightRef.current = true
    void client.scroll(delta, mutationOptions())
      .then(() => observe())
      .catch((cause) => setError(messageFrom(cause)))
      .finally(() => {
        scrollInFlightRef.current = false
        if ((pendingScrollRef.current.deltaX !== 0 || pendingScrollRef.current.deltaY !== 0) &&
            scrollTimerRef.current === null) {
          scrollTimerRef.current = window.setTimeout(flushScroll, 35)
        }
      })
  }, [client, mutationOptions, observation, observe])

  const queueScroll = useCallback((deltaX: number, deltaY: number): void => {
    pendingScrollRef.current.deltaX += deltaX
    pendingScrollRef.current.deltaY += deltaY
    if (scrollTimerRef.current === null && !scrollInFlightRef.current) {
      scrollTimerRef.current = window.setTimeout(flushScroll, 25)
    }
  }, [flushScroll])

  const submitAddress = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    addressEditingRef.current = false
    navigateAddress(readBrowserAddress(event.currentTarget, address))
  }

  const clickScreenshot = (event: MouseEvent<HTMLImageElement>): void => {
    if (!observation || busy) return
    viewportRef.current?.focus({ preventScroll: true })
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const x = (event.clientX - rect.left) / rect.width * observation.state.viewport.width
    const y = (event.clientY - rect.top) / rect.height * observation.state.viewport.height
    void mutate(() => client.click({ x, y }, mutationOptions()))
  }

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>): void => {
    const point = imagePoint(event)
    if (point) queueHover(point)
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    queueScroll(event.deltaX, event.deltaY)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const key = event.key === ' ' ? 'Space' : event.key
    const allowed = new Set([
      'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Home', 'End', 'PageUp', 'PageDown', 'Space'
    ])
    if (!allowed.has(key) || !observation || busy) return
    event.preventDefault()
    void mutate(() => client.pressKey({ key }, mutationOptions()))
  }

  const screenshot = observation?.state.screenshotDataUrl
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
            onClick={() => void mutate(() => client.back(mutationOptions()))}
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={busy || !observation?.state.canGoForward}
            className="rounded p-1.5 hover:bg-muted disabled:opacity-40"
            onClick={() => void mutate(() => client.forward(mutationOptions()))}
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
              if (form) navigateAddress(readBrowserAddress(form, address))
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
        tabIndex={0}
        onMouseMove={handleMouseMove}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
      >
        {screenshot ? (
          <img
            src={screenshot}
            alt={observation?.state.title || 'Browser page'}
            className="block h-auto w-full cursor-default select-none"
            draggable={false}
            onClick={clickScreenshot}
          />
        ) : (
          <div className="flex h-full min-h-48 items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('browserPreviewStarting')}
              </span>
            ) : (
              <span>{error || t('browserPreviewUnavailable')}</span>
            )}
          </div>
        )}
        {busy && screenshot ? (
          <div className="absolute right-2 top-2 rounded bg-background/85 p-1 shadow">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : null}
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

export function browserPreviewComponentId(
  sessionId: string,
  surfaceId: string
): string {
  return `browser-preview:session:${encodeURIComponent(sessionId)}:surface:${encodeURIComponent(surfaceId)}`
}

function messageFrom(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000)
}

function readBrowserAddress(form: HTMLFormElement, fallback: string): string {
  const addressInput = form.elements.namedItem('browser-address')
  return addressInput && typeof (addressInput as { value?: unknown }).value === 'string'
    ? (addressInput as HTMLInputElement).value
    : fallback
}
