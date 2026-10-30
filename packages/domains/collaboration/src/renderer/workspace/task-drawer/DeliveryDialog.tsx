import React, { useEffect, useRef, type ReactElement, type ReactNode } from 'react'

/** Shared keyboard and focus behavior for the two delivery dialogs. */
export function DeliveryDialog({ titleId, testId, busy = false, onClose, children }: Readonly<{
  titleId: string
  testId: string
  busy?: boolean
  onClose(): void
  children: ReactNode
}>): ReactElement {
  const panel = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  closeRef.current = onClose
  busyRef.current = busy
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = panel.current
    const initial = element?.querySelector<HTMLElement>('[data-autofocus], input, button, [tabindex="0"]')
    ;(initial ?? element)?.focus()
    const keepFocus = (event: FocusEvent): void => {
      if (element && event.target instanceof Node && !element.contains(event.target)) (initial ?? element).focus()
    }
    document.addEventListener('focusin', keepFocus)
    return () => {
      document.removeEventListener('focusin', keepFocus)
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return <div className="collaboration-workspace-dialog-backdrop collaboration-workspace-delivery-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyRef.current) closeRef.current() }}>
    <section ref={panel} tabIndex={-1} className="collaboration-workspace-dialog collaboration-workspace-delivery-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} data-testid={testId} onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        event.preventDefault()
        if (!busyRef.current) closeRef.current()
      }
      if (event.key !== 'Tab') return
      event.stopPropagation()
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? [])
      const first = controls[0]
      const last = controls.at(-1)
      if (!first) { event.preventDefault(); panel.current?.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus() }
    }}>{children}</section>
  </div>
}
