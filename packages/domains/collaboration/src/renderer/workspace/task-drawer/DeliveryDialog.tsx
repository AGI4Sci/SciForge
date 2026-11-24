import { translateWorkspace as cw, useWorkspaceTranslation } from '../workspace-i18n.js'
import React, { useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { useWorkspaceDocument } from '../workspace-document.js'

function dialogControls(element: HTMLElement): HTMLElement[] {
  return Array.from(element.querySelectorAll<HTMLElement>('button, input:not([type="hidden"]), textarea, select, [tabindex="0"]'))
    .filter((control) => !control.matches(':disabled, [disabled]') && !control.closest('[hidden], [inert], [aria-hidden="true"]'))
}

function focusDialog(element: HTMLElement): void {
  const controls = dialogControls(element)
  ;(controls.find((control) => control.hasAttribute('data-autofocus')) ?? controls[0] ?? element).focus()
}

/** Shared keyboard and focus behavior for the two delivery dialogs. */
export function DeliveryDialog({ titleId, testId, busy = false, onClose, children }: Readonly<{
  titleId: string
  testId: string
  busy?: boolean
  onClose(): void
  children: ReactNode
}>): ReactElement {
  useWorkspaceTranslation()
  const panel = useRef<HTMLElement>(null)
  const document = useWorkspaceDocument()
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  closeRef.current = onClose
  busyRef.current = busy
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = panel.current
    if (element) focusDialog(element)
    const keepFocus = (event: FocusEvent): void => {
      if (element && event.target && 'nodeType' in event.target && !element.contains(event.target as Node)) focusDialog(element)
    }
    document.addEventListener('focusin', keepFocus)
    return () => {
      document.removeEventListener('focusin', keepFocus)
      if (previous?.isConnected) previous.focus()
    }
  }, [document])
  useLayoutEffect(() => {
    const element = panel.current
    const active = document.activeElement
    // Disabling the focused submitter can move browser focus to the page body.
    // Resolve the current controls; a previously captured target may be disabled or gone.
    if (element && (!active || !element.contains(active) || active.matches(':disabled, [disabled]'))) focusDialog(element)
  }, [busy, document])
  return <div className="collaboration-workspace-dialog-backdrop collaboration-workspace-delivery-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyRef.current) closeRef.current() }}>
    <section ref={panel} tabIndex={-1} className="collaboration-workspace-dialog collaboration-workspace-delivery-dialog" role="dialog" data-native-view-occluder="true" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} data-testid={testId} onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        event.preventDefault()
        if (!busyRef.current) closeRef.current()
      }
      if (event.key !== 'Tab') return
      event.stopPropagation()
      const controls = panel.current ? dialogControls(panel.current) : []
      const first = controls[0]
      const last = controls.at(-1)
      if (!first) { event.preventDefault(); panel.current?.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus() }
    }}>{children}</section>
  </div>
}
