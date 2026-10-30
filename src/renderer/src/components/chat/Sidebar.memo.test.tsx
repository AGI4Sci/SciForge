// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const frameRender = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN' }
  })
}))

vi.mock('../../lib/visible-context', () => ({
  registerVisibleContextComponent: () => () => undefined
}))

vi.mock('../sidebar/SidebarPrimitives', () => ({
  SidebarFrame: ({ children, footer }: { children?: ReactNode; footer?: ReactNode }) => {
    frameRender()
    return createElement('div', null, children, footer)
  },
  SidebarCommandRow: () => null
}))

vi.mock('./SidebarProjectsSection', () => ({
  SidebarProjectsSection: () => null
}))

import { Sidebar } from './Sidebar'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const baseProps = {
  threads: [],
  activeThreadId: null,
  activeView: 'chat' as const,
  pluginsActive: false,
  runtimeReady: true,
  threadSearch: '',
  showArchivedThreads: false,
  onThreadSearchChange: () => undefined,
  onShowArchivedThreadsChange: () => undefined,
  onSelectThread: () => undefined,
  onRenameThread: async () => undefined,
  onArchiveThread: async () => undefined,
  onDeleteThread: async () => undefined,
  onRestoreThread: async () => undefined,
  onNewChat: () => undefined,
  onNewChatInWorkspace: () => undefined,
  onOpenSettings: () => undefined,
  onOpenPlugins: () => undefined,
  onScheduleOpen: () => undefined,
  onToggleSidebar: () => undefined
}

describe('Sidebar memoization', () => {
  let root: Root | undefined
  let container: HTMLDivElement

  afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    container?.remove()
    frameRender.mockClear()
  })

  it('skips re-render when parent re-renders with identical props, and re-renders on real prop changes', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root!.render(createElement(Sidebar, baseProps)))
    expect(frameRender).toHaveBeenCalledTimes(1)

    // Parent re-render with identical prop references must not re-render Sidebar.
    await act(async () => root!.render(createElement(Sidebar, baseProps)))
    expect(frameRender).toHaveBeenCalledTimes(1)

    // A real prop change still re-renders.
    await act(async () => root!.render(createElement(Sidebar, { ...baseProps, threadSearch: 'query' })))
    expect(frameRender).toHaveBeenCalledTimes(2)
  })
})
