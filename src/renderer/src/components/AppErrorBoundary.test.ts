import { createElement } from 'react'
import type { ReactElement } from 'react'
import type { ErrorInfo } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../store/chat-store'
import { AppErrorBoundary, recoverAppErrorBoundaryToWorkbench } from './AppErrorBoundary'

describe('AppErrorBoundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useChatStore.setState({ route: 'chat' })
  })

  it('renders children when no error occurs', () => {
    const html = renderToStaticMarkup(
      createElement(AppErrorBoundary, null, createElement('div', { 'data-testid': 'child' }, 'hello'))
    )
    expect(html).toContain('hello')
    expect(html).not.toContain('appErrorTitle')
  })

  it('renders without throwing when given no children', () => {
    const result = renderToStaticMarkup(createElement(AppErrorBoundary, null, null))
    expect(typeof result).toBe('string')
  })

  it('writes render errors to the app log API when available', () => {
    const logError = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { sciforge: { logError } })
    const boundary = new AppErrorBoundary({ children: null })
    const error = new Error('boom')

    boundary.componentDidCatch(error, { componentStack: '\n    at Child' } as ErrorInfo)

    expect(logError).toHaveBeenCalledWith('renderer', 'Uncaught render error', {
      name: 'Error',
      message: 'boom',
      stack: error.stack,
      componentStack: '\n    at Child'
    })
  })

  it('renders retry, workbench, and reload recovery actions', () => {
    const boundary = new AppErrorBoundary({ children: null })
    boundary.state = AppErrorBoundary.getDerivedStateFromError(new Error('boom'))

    const html = renderToStaticMarkup(boundary.render() as ReactElement)

    expect(html).toContain('Try again')
    expect(html).toContain('Workbench')
    expect(html).toContain('Reload')
  })

  it('returns the app route to the chat workbench for recovery', () => {
    useChatStore.setState({ route: 'settings' })

    recoverAppErrorBoundaryToWorkbench()

    expect(useChatStore.getState().route).toBe('chat')
  })
})
