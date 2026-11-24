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
    useChatStore.setState({ route: 'chat', activeThreadId: null, blocks: [], threadBlocksById: {}, error: null })
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
    const blocks = [{ kind: 'assistant' as const, id: 'answer', text: 'kept history' }]
    useChatStore.setState({ route: 'settings', activeThreadId: 'broken-session', blocks,
      focusedAgentThreadId: 'broken-child', error: 'real failure', runtimeConnection: 'offline',
      sidePanel: { open: true, activeSideId: 'broken-child' } })

    recoverAppErrorBoundaryToWorkbench()

    const state = useChatStore.getState()
    expect(state.route).toBe('chat')
    expect(state.activeThreadId).toBeNull()
    expect(state.focusedAgentThreadId).toBeNull()
    expect(state.sidePanel.open).toBe(false)
    expect(state.blocks).toEqual([])
    expect(state.threadBlocksById['broken-session']).toEqual(blocks)
    expect(state.error).toBe('real failure')
    expect(state.runtimeConnection).toBe('offline')
  })
})
