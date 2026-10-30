import {
  cloneElement,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { Ellipsis } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type ToolbarAction = {
  id: string
  label: string
  icon: ReactNode
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  active?: boolean
  attention?: boolean
  badge?: ReactNode
  keepOpen?: boolean
  popup?: 'menu'
  expanded?: boolean
}

export function fittingToolbarActions(
  width: number,
  widths: readonly number[],
  trailingWidth: number,
  gap: number
): number {
  let used = trailingWidth
  let count = 0
  for (const itemWidth of widths) {
    used += itemWidth + gap
    if (used > width) break
    count++
  }
  return count
}

/** One ordered action list drives both the toolbar and its overflow menu. */
export function AdaptiveToolbar({
  actions,
  customization
}: {
  actions: readonly ToolbarAction[]
  customization: ReactElement<{ className?: string }>
}): ReactElement {
  const { t } = useTranslation('common')
  const rootRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const pendingFocusRef = useRef<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(actions.length)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 280,
    maxHeight: 400
  })
  const hidden = actions.slice(visibleCount)
  const overflow = hidden.length > 0

  useLayoutEffect(() => {
    const root = rootRef.current
    const measure = measureRef.current
    if (!root || !measure) return
    const update = (): void => {
      const widths = Array.from(measure.children, (child) => (child as HTMLElement).offsetWidth)
      const gap = Number.parseFloat(getComputedStyle(root).columnGap) || 0
      const next = fittingToolbarActions(
        root.clientWidth,
        widths.slice(0, -1),
        widths.at(-1) ?? 44,
        gap
      )
      const focused = document.activeElement as HTMLElement | null
      const focusedIndex = focused
        ? actions.findIndex((action) => action.id === focused.dataset.actionId)
        : -1
      if (focusedIndex >= next && root.contains(focused)) pendingFocusRef.current = 'more'
      if (focusedIndex >= 0 && focusedIndex < next && panelRef.current?.contains(focused)) {
        pendingFocusRef.current = actions[focusedIndex].id
      }
      if (focused === moreRef.current && next === actions.length)
        pendingFocusRef.current = 'customize'
      if (focused?.classList.contains('toolbar-customize')) {
        if (root.contains(focused) && next < actions.length) pendingFocusRef.current = 'more'
        if (panelRef.current?.contains(focused) && next === actions.length)
          pendingFocusRef.current = 'customize'
      }
      setVisibleCount(next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(root)
    for (const child of measure.children) observer.observe(child)
    return () => observer.disconnect()
  }, [actions])

  useLayoutEffect(() => {
    if (pendingFocusRef.current) {
      const target =
        pendingFocusRef.current === 'more'
          ? moreRef.current
          : pendingFocusRef.current === 'customize'
            ? rootRef.current?.querySelector<HTMLButtonElement>('.toolbar-customize')
            : Array.from(
                rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-action-id]') ?? []
              ).find((button) => button.dataset.actionId === pendingFocusRef.current)
      target?.focus()
      pendingFocusRef.current = null
    }
  }, [visibleCount])

  useLayoutEffect(() => {
    if (!open || !overflow) return
    const update = (): void => {
      const rect = moreRef.current?.getBoundingClientRect()
      if (!rect) return
      const scale = rect.width / (moreRef.current?.offsetWidth || rect.width)
      setPosition({
        left: Math.max(8, Math.min(rect.left / scale, window.innerWidth / scale - 288)),
        width: Math.min(280, window.innerWidth / scale - 16),
        top: rect.bottom / scale + 8,
        maxHeight: Math.max(44, (window.innerHeight - rect.bottom) / scale - 16)
      })
    }
    update()
    if (document.activeElement === moreRef.current) {
      panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    }
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node
      if (target instanceof Element && target.closest('[data-toolbar-popup]')) return
      if (!panelRef.current?.contains(target) && !moreRef.current?.contains(target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !(event.target as Element)?.closest?.('[data-toolbar-popup]')) {
        setOpen(false)
        moreRef.current?.focus()
      }
    }
    const observer = new ResizeObserver(update)
    if (rootRef.current) observer.observe(rootRef.current)
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, overflow, visibleCount])

  useLayoutEffect(() => {
    if (!overflow && open) {
      setOpen(false)
      if (!rootRef.current?.contains(document.activeElement)) {
        rootRef.current?.querySelector<HTMLButtonElement>('.toolbar-customize')?.focus()
      }
    }
  }, [overflow, open])

  const button = (action: ToolbarAction, inMenu: boolean): ReactElement => (
    <button
      key={action.id}
      type="button"
      data-action-id={action.id}
      aria-label={action.label}
      title={action.label}
      aria-pressed={action.active}
      aria-haspopup={action.popup}
      aria-expanded={action.expanded}
      disabled={action.disabled}
      onClick={(event) => {
        action.onClick(event)
        if (inMenu && !action.keepOpen) {
          setOpen(false)
          moreRef.current?.focus()
        }
      }}
      className={`toolbar-action ${inMenu ? 'toolbar-menu-action' : ''} ${action.active ? 'is-active' : ''}`}
    >
      <span className="relative inline-flex shrink-0">
        {action.icon}
        {action.badge}
        {action.attention ? <span className="toolbar-attention" /> : null}
      </span>
      {inMenu ? <span>{action.label}</span> : null}
    </button>
  )

  return (
    <div ref={rootRef} className="chat-workbench-topbar ds-no-drag">
      <div ref={measureRef} className="toolbar-measure" aria-hidden="true" inert>
        {actions.map((action) => (
          <span key={action.id} className="toolbar-action">
            {action.icon}
          </span>
        ))}
        <span className="toolbar-action" />
      </div>
      {actions.slice(0, visibleCount).map((action) => button(action, false))}
      <span className="toolbar-tail">
        <button
          ref={moreRef}
          type="button"
          className={`toolbar-action ${overflow ? '' : 'hidden'} ${hidden.some((action) => action.active) ? 'is-active' : ''}`}
          aria-label={
            hidden.some((action) => action.attention)
              ? t('workbenchToolbarMoreAttention')
              : t('workbenchToolbarMore')
          }
          title={t('workbenchToolbarMore')}
          aria-haspopup="dialog"
          aria-expanded={open && overflow}
          onClick={() => setOpen((value) => !value)}
        >
          <Ellipsis className="h-4 w-4" />
          {hidden.some((action) => action.attention) ? (
            <span className="toolbar-attention" />
          ) : null}
        </button>
        {!overflow
          ? cloneElement(customization, {
              className: 'toolbar-action toolbar-customize'
            })
          : null}
      </span>
      {overflow
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={t('workbenchToolbarMore')}
              className="toolbar-overflow ds-card-strong"
              aria-hidden={!open}
              inert={!open}
              style={{ ...position, visibility: open ? 'visible' : 'hidden' }}
            >
              {hidden.map((action) => button(action, true))}
              <div className="mt-1 border-t border-ds-border-muted pt-1">
                {cloneElement(customization, {
                  className: 'toolbar-action toolbar-menu-action toolbar-customize'
                })}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
