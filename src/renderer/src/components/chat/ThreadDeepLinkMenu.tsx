import { useEffect, useState, type MouseEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function ThreadDeepLinkMenuItem({ threadId, onCopied }: {
  threadId: string
  onCopied: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [failed, setFailed] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(`codex://threads/${encodeURIComponent(threadId.trim())}`)
      onCopied()
    } catch {
      setFailed(true)
    }
  }
  return (
    <button
      type="button"
      role="menuitem"
      disabled={!threadId.trim()}
      onClick={() => void copy()}
      className="flex min-h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-ds-ink transition hover:bg-[var(--ds-sidebar-row-hover)] disabled:opacity-50"
    >
      <Link className="h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={1.9} />
      <span role={failed ? 'alert' : undefined}>{t(failed ? 'copyFailed' : 'copyThreadDeepLink')}</span>
    </button>
  )
}

export function useThreadDeepLinkContextMenu(): {
  open: (event: MouseEvent, threadId: string) => void
  menu: ReactElement | null
} {
  const [target, setTarget] = useState<{ threadId: string; x: number; y: number } | null>(null)
  const { t } = useTranslation('common')
  useEffect(() => {
    if (!target) return
    const close = (): void => setTarget(null)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [target])
  return {
    open: (event, threadId) => {
      event.preventDefault()
      event.stopPropagation()
      setTarget({ threadId, x: Math.max(0, Math.min(event.clientX, window.innerWidth - 188)), y: Math.max(0, Math.min(event.clientY, window.innerHeight - 48)) })
    },
    menu: target ? createPortal(
      <div
        role="menu"
        aria-label={t('copyThreadDeepLink')}
        className="ds-no-drag fixed z-50 min-w-[180px] rounded-lg border border-ds-border bg-ds-card p-1 shadow-xl"
        style={{ left: target.x, top: target.y }}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <ThreadDeepLinkMenuItem key={target.threadId} threadId={target.threadId} onCopied={() => setTarget(null)} />
      </div>, document.body
    ) : null
  }
}
