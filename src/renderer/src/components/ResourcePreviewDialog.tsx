import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ResourcePreviewSnapshot } from '../lib/resource-preview'
import { closeResourcePreview } from '../lib/resource-preview'
import type { WorkspacePreviewResourceContent } from '@sciforge/domain-sdk/workspace-preview'
import { loadResourcePreviewContent } from '../lib/resource-preview-content'
import { installedRendererContributions } from '../domain-modules/installed-renderer-contributions'

type ContentState = Readonly<{ kind: 'loading' | 'error' }> |
  Readonly<{ kind: 'ready'; content: WorkspacePreviewResourceContent; viewer: ReactElement | null }>

export default function ResourcePreviewDialog({ request }: Readonly<{ request: ResourcePreviewSnapshot }>): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [state, setState] = useState<ContentState>({ kind: 'loading' })
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const close = () => closeResourcePreview(request.id)
  useEffect(() => {
    const controller = new AbortController()
    let current = true
    void loadResourcePreviewContent(request.sourceUrl, controller.signal)
      .then(content => {
        if (!current) return
        const descriptor = installedRendererContributions.workspacePreviews.resolve({
          path: request.input.file.name, mimeType: content.mimeType, resourceContentKind: content.kind
        })
        const viewer = descriptor?.contribution.resource?.render({
          content, title: request.input.file.name, sourceUrl: request.sourceUrl,
          contentKey: `${request.input.resource.token}:${request.input.resource.semanticRevision}`,
          fileSummary: new Intl.NumberFormat(i18n.language, { style: 'unit', unit: 'byte', maximumFractionDigits: 0 }).format(content.size),
          onLoadError: () => { if (current) setState({ kind: 'error' }) }
        }) ?? null
        setState({ kind: 'ready', content, viewer })
      })
      .catch(() => { if (current) setState({ kind: 'error' }) })
    return () => { current = false; controller.abort() }
  }, [request, i18n.language])
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeResourcePreview(request.id)
      }
      if (event.key !== 'Tab') return
      const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], textarea:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])]
        .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
      const first = controls[0]
      const last = controls.at(-1)
      if (!first || !last) { event.preventDefault(); closeRef.current?.focus(); return }
      const active = document.activeElement
      if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (active === last || !panelRef.current?.contains(active))) {
        event.preventDefault(); first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown, true)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [request.id])
  const content = state.kind === 'ready' ? state.content : null
  const size = content?.size ?? request.input.file.size
  const fileSummary = new Intl.NumberFormat(i18n.language, { style: 'unit', unit: 'byte', maximumFractionDigits: 0 }).format(size)
  return createPortal(
    <div className="ds-no-drag fixed inset-0 z-[1100] flex items-center justify-center bg-ds-main/90 p-4" data-testid="resource-preview-backdrop">
      <section ref={panelRef} data-native-view-occluder="true" role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="flex h-full max-h-full w-full max-w-screen-xl flex-col overflow-hidden rounded-xl border border-ds-border bg-ds-card text-ds-text shadow-panel"
        data-testid="resource-preview-dialog">
        <header className="flex shrink-0 items-center gap-3 border-b border-ds-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="break-all text-ds-lg font-medium">{request.input.file.name}</h2>
            <p className="break-all text-ds-sm text-ds-muted">{content?.mimeType ?? request.input.file.mimeType} · {fileSummary}</p>
          </div>
          <button ref={closeRef} type="button" onClick={close} aria-label={t('close')} title={t('close')}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ds-muted hover:bg-ds-hover hover:text-ds-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            data-testid="resource-preview-close"><X className="h-4 w-4" aria-hidden="true" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto" aria-busy={state.kind === 'loading'} data-testid="resource-preview-content">
          {state.kind === 'loading' ? <p role="status" className="p-4 text-ds-lg text-ds-muted">{t('loading')}</p> : null}
          {state.kind === 'error' ? <p role="alert" className="p-4 text-ds-lg text-ds-muted">{t('resourcePreviewFailed')}</p> : null}
          {state.kind === 'ready' && !state.viewer ? <p role="status" className="p-4 text-ds-lg text-ds-muted">{t('resourcePreviewUnsupported')}</p> : null}
          {state.kind === 'ready' ? state.viewer : null}
          {content && 'truncated' in content && content.truncated ?
            <p role="status" className="p-4 text-ds-lg text-ds-muted">{t('resourcePreviewTruncated')}</p> : null}
        </div>
      </section>
    </div>, document.body
  )
}
