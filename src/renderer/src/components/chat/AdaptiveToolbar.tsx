import {
  cloneElement,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
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

/** Size of one square icon-only rail pill. */
export const TOOLBAR_ACTION_SIZE = 44

/**
 * Rendered width of the vertical toolbar rail. Kept in sync with the
 * `--ds-sidebar-rail-width` token so the right rail and the collapsed left
 * sidebar read as one symmetrical pair. `AdaptiveToolbar.test.ts` asserts the
 * token still matches.
 */
export const TOOLBAR_RAIL_WIDTH = 56

/**
 * How many items fit in `available` space before a reserved trailing item.
 * Shared by the rail's height fit and unit-tested on its own; the caller owns
 * the meaning of "size" (the rail only ever passes heights).
 */
export function fittingToolbarActions(
  available: number,
  sizes: readonly number[],
  trailingSize: number,
  gap: number
): number {
  let used = trailingSize
  let count = 0
  for (const itemSize of sizes) {
    used += itemSize + gap
    if (used > available) break
    count++
  }
  return count
}

export type ToolbarFitPlan = {
  /** Actions rendered in the rail; the rest live in the "More tools" menu. */
  visibleCount: number
}

export type VerticalToolbarFitInput = {
  /** Height available inside the rail's padding box. */
  height: number
  /** Measured height of every action pill, in order. */
  itemHeights: readonly number[]
  /** Measured height of the customization pill (the non-overflow tail). */
  customizeTailHeight: number
  /** Measured height of the "More tools" pill. */
  moreTailHeight: number
  /** Row gap between stacked pills. */
  gap: number
}

/**
 * Vertical fit rule — the rail never squeezes horizontally, it only ever hands
 * the tail of the ordered action list to the "More tools" menu:
 *
 * 1. every action plus the customization pill fits → render the whole set;
 * 2. otherwise the tail becomes "More tools", the deepest prefix that still
 *    fits stays in the rail and the remainder moves into the menu. At least one
 *    action always stays in the menu, so "More" never opens an empty panel.
 *
 * The plan is pure: the component feeds it measured heights, so it is unit
 * tested without a DOM.
 */
export function planVerticalToolbarFit(input: VerticalToolbarFitInput): ToolbarFitPlan {
  const count = input.itemHeights.length
  if (count === 0) return { visibleCount: 0 }
  const fitting = (tailHeight: number): number =>
    fittingToolbarActions(input.height, input.itemHeights, tailHeight, input.gap)
  if (fitting(input.customizeTailHeight) === count) return { visibleCount: count }
  return { visibleCount: Math.max(0, Math.min(count - 1, fitting(input.moreTailHeight))) }
}

export type ToolbarPopupAnchor = {
  left: number
  right: number
  top: number
  bottom: number
}

export type ToolbarPopupPlacementInput = {
  anchor: ToolbarPopupAnchor
  viewport: { width: number; height: number }
  preferredWidth: number
  preferredMaxHeight?: number
  gap?: number
  margin?: number
}

export type ToolbarPopupPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

const POPUP_MIN_HEIGHT = 160

/**
 * One placement rule for every toolbar popup (overflow menu, editor picker,
 * customizer). It derives the side from the anchor's geometry instead of
 * assuming the toolbar is a horizontal row: a trigger on the right edge opens
 * its panel to the left, a trigger in the top bar opens below, and a trigger
 * without room below opens upwards. Shared by every toolbar popup so the
 * vertical rail did not have to fork the portal positioning code.
 */
export function placeToolbarPopup(input: ToolbarPopupPlacementInput): ToolbarPopupPlacement {
  const margin = input.margin ?? 8
  const gap = input.gap ?? 8
  const width = Math.max(0, Math.min(input.preferredWidth, input.viewport.width - margin * 2))
  const clampLeft = (candidate: number): number =>
    Math.min(Math.max(margin, candidate), Math.max(margin, input.viewport.width - margin - width))

  const roomRight = input.viewport.width - margin - input.anchor.right - gap
  const roomLeft = input.anchor.left - gap - margin
  const left = roomRight >= width
    ? clampLeft(input.anchor.right + gap)
    : roomLeft >= width
      ? clampLeft(input.anchor.left - gap - width)
      : clampLeft(input.anchor.left)

  const belowTop = Math.max(margin, input.anchor.bottom + gap)
  const roomBelow = input.viewport.height - margin - belowTop
  const roomAbove = input.anchor.top - gap - margin
  const preferredMaxHeight = Math.min(
    input.preferredMaxHeight ?? Number.POSITIVE_INFINITY,
    input.viewport.height - margin * 2
  )
  if (roomBelow >= Math.min(POPUP_MIN_HEIGHT, preferredMaxHeight) || roomBelow >= roomAbove) {
    return {
      left,
      top: belowTop,
      width,
      maxHeight: Math.max(44, Math.min(preferredMaxHeight, roomBelow))
    }
  }
  const maxHeight = Math.max(44, Math.min(preferredMaxHeight, roomAbove))
  return {
    left,
    top: Math.max(margin, input.anchor.top - gap - maxHeight),
    width,
    maxHeight
  }
}

/**
 * The workbench toolbar: one vertical rail docked at the right edge. Every
 * action is an icon-only pill whose accessible name and tooltip carry the full
 * label; when the available height runs out the tail of the list moves into
 * the "More tools" menu rendered from the same ordered action list.
 *
 * `presentation: 'menu'` renders only the "More tools" pill for hosts that
 * already have their own chrome (a canvas header); it still opens the same
 * action list, so both presentations stay one implementation.
 */
export function AdaptiveToolbar({
  actions,
  customization,
  presentation = 'rail',
  preserveTextSelection = false
}: {
  actions: readonly ToolbarAction[]
  customization: ReactElement<{ className?: string }>
  presentation?: 'rail' | 'menu'
  preserveTextSelection?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const rootRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const tailMeasureRef = useRef<HTMLDivElement>(null)
  const tailRef = useRef<HTMLSpanElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const pendingFocusRef = useRef<string | null>(null)
  // The tail renders "More" while actions overflow and the customization trigger
  // otherwise, so its height is not constant. Reserve the tallest tail ever
  // measured rather than the current one: the reservation then only ever grows,
  // so swapping the tail cannot flip the fit decision back and forth.
  const tailHeightRef = useRef(0)
  const [plan, setPlan] = useState<ToolbarFitPlan>(() => ({
    visibleCount: presentation === 'menu' ? 0 : actions.length
  }))
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<ToolbarPopupPlacement>({
    left: 0,
    top: 0,
    width: 280,
    maxHeight: 400
  })
  const hidden = actions.slice(plan.visibleCount)
  const overflow = hidden.length > 0

  useLayoutEffect(() => {
    if (presentation === 'menu') {
      setPlan((current) => (current.visibleCount === 0 ? current : { visibleCount: 0 }))
      return
    }
    const root = rootRef.current
    if (!root) return
    const update = (): void => {
      const itemHeights = Array.from(
        measureRef.current?.children ?? [],
        (child) => (child as HTMLElement).offsetHeight
      )
      // Before the first real layout (hidden pane, collapsed container) every
      // measurement is zero; keep the current plan instead of collapsing the
      // whole rail into "More" until the ResizeObserver reports a real height.
      if (root.clientHeight === 0 && itemHeights.every((height) => height === 0)) return
      const computed = getComputedStyle(root)
      const gap = Number.parseFloat(computed.rowGap) || 0
      const paddingTop = Number.parseFloat(computed.paddingTop) || 0
      const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0
      const availableHeight = Math.max(0, root.clientHeight - paddingTop - paddingBottom)
      const measuredTailHeight = tailRef.current?.offsetHeight ?? 0
      if (measuredTailHeight > 0) {
        tailHeightRef.current = Math.max(tailHeightRef.current, measuredTailHeight)
      }
      const moreMeasure = tailMeasureRef.current?.firstElementChild as HTMLElement | null
      const next = planVerticalToolbarFit({
        height: availableHeight,
        itemHeights: actions.map((_, index) => itemHeights[index] || TOOLBAR_ACTION_SIZE),
        customizeTailHeight: tailHeightRef.current || TOOLBAR_ACTION_SIZE,
        moreTailHeight: moreMeasure?.offsetHeight || TOOLBAR_ACTION_SIZE,
        gap
      })
      const focused = document.activeElement as HTMLElement | null
      const focusedIndex = focused
        ? actions.findIndex((action) => action.id === focused.dataset.actionId)
        : -1
      if (focusedIndex >= next.visibleCount && root.contains(focused)) pendingFocusRef.current = 'more'
      if (focusedIndex >= 0 && focusedIndex < next.visibleCount && panelRef.current?.contains(focused)) {
        pendingFocusRef.current = actions[focusedIndex].id
      }
      if (focused === moreRef.current && next.visibleCount === actions.length)
        pendingFocusRef.current = 'customize'
      if (focused?.classList.contains('toolbar-customize')) {
        if (root.contains(focused) && next.visibleCount < actions.length) pendingFocusRef.current = 'more'
        if (panelRef.current?.contains(focused) && next.visibleCount === actions.length)
          pendingFocusRef.current = 'customize'
      }
      setPlan((current) => (
        current.visibleCount === next.visibleCount ? current : next
      ))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(root)
    if (tailRef.current) observer.observe(tailRef.current)
    for (const row of [measureRef.current, tailMeasureRef.current]) {
      if (!row) continue
      for (const child of row.children) observer.observe(child)
    }
    return () => observer.disconnect()
  }, [actions, presentation])

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
  }, [plan.visibleCount])

  useLayoutEffect(() => {
    if (!open || !overflow) return
    const update = (): void => {
      const anchor = moreRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const scale = anchor.offsetWidth > 0 ? rect.width / anchor.offsetWidth : 1
      setPosition(placeToolbarPopup({
        anchor: {
          left: rect.left / scale,
          right: rect.right / scale,
          top: rect.top / scale,
          bottom: rect.bottom / scale
        },
        viewport: {
          width: window.innerWidth / scale,
          height: window.innerHeight / scale
        },
        preferredWidth: 280,
        preferredMaxHeight: 420
      }))
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
  }, [open, overflow, plan.visibleCount])

  useLayoutEffect(() => {
    if (!overflow && open) {
      setOpen(false)
      if (!rootRef.current?.contains(document.activeElement)) {
        rootRef.current?.querySelector<HTMLButtonElement>('.toolbar-customize')?.focus()
      }
    }
  }, [overflow, open])

  const retainSelection = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (preserveTextSelection && window.getSelection()?.toString()) event.preventDefault()
  }

  /** The same icon + label markup renders in the rail, the menu and the measure column. */
  const content = (action: ToolbarAction): ReactElement => (
    <>
      <span className="relative inline-flex shrink-0">
        {action.icon}
        {action.badge}
        {action.attention ? <span className="toolbar-attention" /> : null}
      </span>
      <span className="toolbar-action-label">{action.label}</span>
    </>
  )

  /** The trailing "More tools" pill; the hidden measure column carries its height. */
  const moreContent = (attention: boolean): ReactElement => (
    <>
      <span className="relative inline-flex shrink-0">
        <Ellipsis className="h-4 w-4" />
        {attention ? <span className="toolbar-attention" /> : null}
      </span>
      <span className="toolbar-action-label">{t('workbenchToolbarMore')}</span>
    </>
  )

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
      onPointerDown={retainSelection}
      onClick={(event) => {
        action.onClick(event)
        if (inMenu && !action.keepOpen) {
          setOpen(false)
          moreRef.current?.focus()
        }
      }}
      className={`toolbar-action ${inMenu ? 'toolbar-menu-action' : ''} ${action.active ? 'is-active' : ''}`}
    >
      {content(action)}
    </button>
  )

  const moreAttention = hidden.some((action) => action.attention)
  const anyAttention = actions.some((action) => action.attention)
  // Only the rail is a toolbar: menu presentation is a single trigger pill that
  // hosts drop into their own chrome.
  const railRole = presentation === 'rail'
    ? { role: 'toolbar' as const, 'aria-orientation': 'vertical' as const }
    : {}

  return (
    <div
      ref={rootRef}
      className={presentation === 'menu'
        ? 'chat-workbench-toolbar-menu ds-no-drag'
        : 'chat-workbench-topbar ds-no-drag'}
      {...railRole}
    >
      {/*
        Heights come from a hidden column, so the measurement can never depend on
        how many actions the rail currently renders.
      */}
      <div ref={measureRef} className="toolbar-measure" aria-hidden="true" inert>
        {actions.map((action) => (
          <span key={action.id} className="toolbar-action">
            {content(action)}
          </span>
        ))}
      </div>
      <div ref={tailMeasureRef} className="toolbar-measure" aria-hidden="true" inert>
        <span className="toolbar-action">{moreContent(anyAttention)}</span>
      </div>
      {actions.slice(0, plan.visibleCount).map((action) => button(action, false))}
      <span ref={tailRef} className="toolbar-tail">
        <button
          ref={moreRef}
          type="button"
          className={`toolbar-action toolbar-more ${overflow ? '' : 'hidden'} ${hidden.some((action) => action.active) ? 'is-active' : ''}`}
          aria-label={
            moreAttention ? t('workbenchToolbarMoreAttention') : t('workbenchToolbarMore')
          }
          title={t('workbenchToolbarMore')}
          aria-haspopup="dialog"
          aria-expanded={open && overflow}
          onPointerDown={retainSelection}
          onClick={() => setOpen((value) => !value)}
        >
          {moreContent(moreAttention)}
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
              data-native-view-occluder="true" role="dialog"
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
