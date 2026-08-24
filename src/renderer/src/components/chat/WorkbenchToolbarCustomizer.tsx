import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Settings2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WorkbenchToolbarSettingsV1 } from '@shared/app-settings'
import type { RegisteredWorkbenchToolbarActionContribution } from '../../domain-modules/workbench-toolbar-slot'
import {
  moveWorkbenchToolbarAction,
  orderWorkbenchToolbarActions,
  resetWorkbenchToolbarPreferences,
  setWorkbenchToolbarActionVisible
} from '../../domain-modules/workbench-toolbar-preferences'

type Props = {
  actions: readonly RegisteredWorkbenchToolbarActionContribution[]
  preferences: WorkbenchToolbarSettingsV1
  saving: boolean
  error: string
  onChange: (next: WorkbenchToolbarSettingsV1) => void
}

type MenuPosition = {
  left: number
  top: number
  width: number
}

export function WorkbenchToolbarCustomizer({
  actions,
  preferences,
  saving,
  error,
  onChange
}: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const orderedActions = useMemo(
    () => orderWorkbenchToolbarActions(actions, preferences),
    [actions, preferences]
  )
  const hidden = useMemo(
    () => new Set(preferences.hiddenCommandIds),
    [preferences.hiddenCommandIds]
  )

  const updatePosition = useCallback((): void => {
    const anchor = triggerRef.current
    if (!anchor || typeof window === 'undefined') {
      setPosition(null)
      return
    }
    const rect = anchor.getBoundingClientRect()
    const width = Math.min(420, Math.max(280, window.innerWidth - 16))
    const left = Math.min(
      Math.max(8, rect.right - width),
      Math.max(8, window.innerWidth - width - 8)
    )
    setPosition({ left, top: rect.bottom + 8, width })
  }, [])

  useEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    updatePosition()
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, updatePosition])

  if (actions.length === 0) return null

  const panel = open && position ? (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('workbenchToolbarCustomize')}
      style={position}
      className="ds-card-strong fixed z-[1001] max-h-[min(32rem,calc(100vh-3rem))] overflow-y-auto rounded-[18px] border border-ds-border shadow-[0_18px_52px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:shadow-[0_22px_58px_rgba(0,0,0,0.38)]"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-ds-border-muted bg-ds-card-strong px-4 py-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ds-ink">
            {t('workbenchToolbarCustomize')}
          </div>
          <div className="mt-0.5 text-[11px] leading-4 text-ds-faint">
            {t('workbenchToolbarCustomizeDescription')}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onChange(resetWorkbenchToolbarPreferences())}
          disabled={saving}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('workbenchToolbarReset')}
        </button>
      </div>

      <div className="space-y-1.5 p-2">
        {orderedActions.map((action, index) => {
          const { contribution } = action
          const commandId = contribution.commandId
          const visible = !hidden.has(commandId)
          const label = t(contribution.label)
          const Icon = contribution.icon
          return (
            <div
              key={commandId}
              className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 transition ${
                visible
                  ? 'border-ds-border-muted bg-white/55 dark:bg-white/6'
                  : 'border-transparent bg-ds-hover/45 opacity-75'
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ds-hover text-ds-muted">
                <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-ds-ink">
                  {label}
                </span>
                <span className="block truncate text-[10.5px] text-ds-faint">
                  {contribution.group
                    ? `${t(contribution.group.label)} · ${action.ownerId}`
                    : action.ownerId}
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => onChange(moveWorkbenchToolbarAction(
                    actions,
                    preferences,
                    commandId,
                    -1
                  ))}
                  disabled={saving || index === 0}
                  className="rounded-md p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-25"
                  aria-label={t('workbenchToolbarMoveBefore', { label })}
                  title={t('workbenchToolbarMoveBefore', { label })}
                >
                  <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  onClick={() => onChange(moveWorkbenchToolbarAction(
                    actions,
                    preferences,
                    commandId,
                    1
                  ))}
                  disabled={saving || index === orderedActions.length - 1}
                  className="rounded-md p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-25"
                  aria-label={t('workbenchToolbarMoveAfter', { label })}
                  title={t('workbenchToolbarMoveAfter', { label })}
                >
                  <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              </span>
              <button
                type="button"
                onClick={() => onChange(setWorkbenchToolbarActionVisible(
                  preferences,
                  commandId,
                  !visible
                ))}
                disabled={saving}
                aria-pressed={visible}
                aria-label={visible
                  ? t('workbenchToolbarRemoveAction', { label })
                  : t('workbenchToolbarAddAction', { label })}
                className={`inline-flex w-[4.75rem] shrink-0 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition disabled:opacity-50 ${
                  visible
                    ? 'border-ds-border-muted text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                    : 'border-accent/30 bg-accent/10 text-accent hover:bg-accent/15'
                }`}
              >
                {visible ? (
                  <Minus className="h-3.5 w-3.5" strokeWidth={2} />
                ) : (
                  <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                )}
                {visible ? t('workbenchToolbarRemove') : t('workbenchToolbarAdd')}
              </button>
            </div>
          )
        })}
      </div>

      {saving || error ? (
        <div
          className={`border-t border-ds-border-muted px-4 py-2 text-[11px] ${
            error ? 'text-red-600 dark:text-red-300' : 'text-ds-faint'
          }`}
          role={error ? 'alert' : 'status'}
        >
          {saving ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('workbenchToolbarSaving')}
            </span>
          ) : error}
        </div>
      ) : null}
    </div>
  ) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={t('workbenchToolbarCustomize')}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t('workbenchToolbarCustomize')}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11.5px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${
          open
            ? 'border-ds-border-strong bg-white/70 text-ds-ink dark:bg-white/10'
            : 'border-ds-border-muted bg-white/55 text-ds-muted hover:border-ds-border-strong hover:bg-white/75 hover:text-ds-ink dark:bg-white/7 dark:hover:bg-white/11'
        }`}
      >
        <Settings2 className="h-4 w-4" strokeWidth={1.75} />
        <span className="whitespace-nowrap">{t('workbenchToolbarCustomizeShort')}</span>
      </button>
      {typeof document === 'undefined' ? panel : createPortal(panel, document.body)}
    </>
  )
}
