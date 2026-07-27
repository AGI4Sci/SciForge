import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  Loader2,
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
  type MouseEvent,
  type ReactElement
} from 'react'
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
  onCollapse,
  sessionId,
  visibleContext,
  workspaceRoot
}: Readonly<{
  active: boolean
  className?: string
  client: BrowserPreviewCapabilityClient
  onCollapse: () => void
  sessionId: string
  visibleContext: DomainRendererVisibleContextHost
  workspaceRoot: string
}>): ReactElement {
  const { t } = useTranslation('common')
  const viewportRef = useRef<HTMLDivElement>(null)
  const resourceRef = useRef<DomainCapabilityResourceHandle | null>(null)
  const observingRef = useRef(false)
  const [address, setAddress] = useState(DEFAULT_BROWSER_PREVIEW_URL)
  const [observation, setObservation] = useState<Observation | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const observe = useCallback(async (): Promise<void> => {
    const resource = resourceRef.current
    if (!resource || observingRef.current) return
    observingRef.current = true
    try {
      const next = await client.observe(resource, workspaceRoot || undefined)
      resourceRef.current = next.resource
      setObservation(next)
      if (next.state.url) setAddress(next.state.url)
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
      url: DEFAULT_BROWSER_PREVIEW_URL,
      ...(workspaceRoot ? { workspaceId: workspaceRoot } : {})
    }).then((resource) => {
      if (cancelled) return
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
      resourceRef.current = null
    }
  }, [client, observe, sessionId, workspaceRoot])

  useEffect(() => {
    if (!active) return undefined
    const timer = window.setInterval(() => {
      void observe()
    }, 1_200)
    void observe()
    return () => window.clearInterval(timer)
  }, [active, observe])

  useEffect(() => {
    if (!active || !observation) return undefined
    const componentId = `browser-preview.${sessionId}`
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
          sessionId
        }
      }],
      state: {
        sessionId,
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
        active: true,
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
  }, [active, observation, sessionId, t, visibleContext])

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

  const submitAddress = (event: FormEvent): void => {
    event.preventDefault()
    void mutate(() => client.navigate(address, mutationOptions()))
  }

  const clickScreenshot = (event: MouseEvent<HTMLImageElement>): void => {
    if (!observation || busy) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const x = (event.clientX - rect.left) / rect.width * observation.state.viewport.width
    const y = (event.clientY - rect.top) / rect.height * observation.state.viewport.height
    void mutate(() => client.click({ x, y }, mutationOptions()))
  }

  const screenshot = observation?.state.screenshotDataUrl
  const statusLabel = useMemo(() => {
    if (busy && !observation) return t('browserPreviewStarting')
    return observation?.state.status ?? 'error'
  }, [busy, observation, t])

  return (
    <section className={`flex min-h-0 flex-col bg-background ${className}`}>
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
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={t('browserPreviewAddressPlaceholder')}
            className="min-w-0 flex-1 rounded-md border bg-muted/30 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            spellCheck={false}
          />
        </form>
      </header>

      <div className="flex shrink-0 items-center gap-1.5 border-b bg-amber-50 px-3 py-1 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <ShieldAlert className="h-3 w-3" />
        <span>{t('browserPreviewUntrusted')}</span>
        <span className="ml-auto truncate">{statusLabel}</span>
      </div>

      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-auto bg-neutral-100 dark:bg-neutral-950">
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
}

function messageFrom(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000)
}
