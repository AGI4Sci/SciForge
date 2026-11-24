// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import '../../i18n'
import { MessageTimelineEmptyHero } from './message-timeline-empty'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('closes an offline error while keeping connection recovery actions available', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  let dismissals = 0
  const render = async (runtimeError: string | null): Promise<void> => {
    await act(async () => root.render(<MessageTimelineEmptyHero ready={false} hasWorkspace runtimeId="codex"
      runtimeError={runtimeError} onDismissRuntimeError={() => { dismissals += 1 }}
      onPickWorkspace={() => undefined} onRetry={() => undefined} onOpenSettings={() => undefined} />))
  }
  try {
    await render('specific failure')
    expect(container.textContent).toContain('specific failure')
    const close = container.querySelector<HTMLButtonElement>('button[aria-label]')
    expect(close).not.toBeNull()
    await act(async () => close?.click())
    expect(dismissals).toBe(1)
    await render(null)
    expect(container.textContent).not.toContain('specific failure')
    expect(container.querySelectorAll('button')).toHaveLength(2)
  } finally {
    await act(async () => root.unmount())
  }
})
