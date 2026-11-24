// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../agent/types'
import { addSessionRightPanelPane, createSessionRightPanelWorkspace } from './session-right-panel-workspaces'

const panelLayout = vi.hoisted(() => ({ workspaces: [] as import('./session-right-panel-workspaces').SessionRightPanelWorkspace[] }))

const probes = vi.hoisted(() => ({
  sidebarRender: vi.fn(),
  timelineRender: vi.fn(),
  composerRender: vi.fn(),
  topbarRender: vi.fn()
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' }
  })
}))

vi.mock('../agent/registry', () => ({
  getProvider: () => ({
    getRecoveryOptions: () => ({ canChooseExecutable: false }),
    rememberThreadRuntime: () => undefined
  })
}))

vi.mock('../agent/runtime-client', () => ({
  rendererRuntimeClient: {
    getSettings: () => Promise.resolve({}),
    setSettings: () => Promise.resolve({ ok: true })
  }
}))

vi.mock('./workbench-layout', () => ({
  CODE_PANEL_PREFERRED: 480,
  WORKBENCH_RIGHT_PANEL_VISIBLE_CLASS: 'right-panel-visible',
  hostSidebarPresentation: ({ collapsed, mainAreaActive }: { collapsed: boolean; mainAreaActive: boolean }) =>
    !collapsed ? 'expanded' : mainAreaActive ? 'rail' : 'hidden',
  useWorkbenchLayout: () => ({
    addRightPanelPaneForSession: vi.fn(),
    beginBottomPanelResize: vi.fn(),
    beginLeftResize: vi.fn(),
    beginRightPanelPaneResize: vi.fn(),
    bottomPanelActivation: null,
    bottomPanelContributionId: null,
    bottomPanelHeight: 0,
    closeBottomPanel: vi.fn(),
    closeRightPanelPaneForSession: vi.fn(),
    focusedRightPanelMode: null,
    focusedRightPanelPane: null,
    focusRightPanelPaneForSession: vi.fn(),
    leftSidebarCollapsed: false,
    leftSidebarEdge: { behavior: 'pinned', edgeVisible: false, edgeProps: {}, panelProps: {}, setBehavior: vi.fn() },
    leftSidebarWidth: 280,
    leftSidebarOverlay: false,
    sidebarOverlayRef: { current: null },
    navigateRightPanelPaneHistoryForSession: vi.fn(),
    placeRightPanelPaneForSession: vi.fn(),
    rebindRightPanelPaneForSession: vi.fn(),
    rightPanelDockViewportWidth: 0,
    rightPanelWorkspaces: panelLayout.workspaces,
    rightPanelVisible: false,
    setRightPanelPaneWidthForSession: vi.fn(),
    shellRef: { current: null },
    openBottomPanelForSession: vi.fn(),
    splitRightPanelPaneForSession: vi.fn(),
    toggleLeftSidebar: vi.fn(),
    updateRightPanelPaneForSession: vi.fn()
  })
}))

vi.mock('../domain-modules/installed-renderer-contributions', () => ({
  installedRendererContributions: {
    rightPanels: { resolve: () => undefined, list: () => [] },
    bottomPanels: { resolve: () => undefined, list: () => [] },
    globalOverlays: { resolve: () => undefined, list: () => [] },
    toolbarActions: { list: () => [] },
    navigationSections: { list: () => [] },
    mainAreas: { list: () => [] },
    settingsSections: { list: () => [] },
    composerContexts: { list: () => [] },
    commands: { execute: vi.fn() }
  }
}))

// Plain (unmemoized) probes: any Workbench root re-render shows up here.
vi.mock('./chat/Sidebar', () => ({
  Sidebar: () => {
    probes.sidebarRender()
    return null
  }
}))

vi.mock('./chat/MessageTimeline', () => ({
  MessageTimeline: (props: { live: string; liveReasoning: string; blocks: ChatBlock[]; onRetryConnection: () => void }) => {
    probes.timelineRender({ live: props.live, liveReasoning: props.liveReasoning, blocks: props.blocks, onRetryConnection: props.onRetryConnection })
    return null
  }
}))

vi.mock('./chat/FloatingComposer', () => ({
  FloatingComposer: (props: { changedFiles?: unknown[] }) => {
    probes.composerRender({ changedFiles: props.changedFiles })
    return null
  }
}))

vi.mock('./chat/WorkbenchTopBar', () => ({
  RIGHT_PANEL_MODES: [],
  WorkbenchTopBar: (props: { sideChatCount: number; sideChatRunningCount: number }) => {
    probes.topbarRender({ sideChatCount: props.sideChatCount, sideChatRunningCount: props.sideChatRunningCount })
    return null
  }
}))

vi.mock('./SessionHeader', () => ({ SessionHeader: () => null }))
vi.mock('./chat/RemoteWorkspaceSelector', () => ({ RemoteWorkspaceSelector: () => null }))
vi.mock('./chat/FocusedAgentWorkbench', () => ({ FocusedAgentWorkbench: () => null }))
vi.mock('./chat/SideConversationPanel', () => ({ SideConversationPanel: () => null }))
vi.mock('./chat/ChildAgentsPanel', () => ({
  SessionChildAgentsPanel: () => null,
  filterDirectChildAgents: () => [],
  useThreadChildren: () => ({ children: [] })
}))
vi.mock('./chat/use-child-agent-attention', () => ({
  useChildAgentAttention: () => ({
    summary: {
      targets: [],
      actionableTargets: [],
      counts: { total: 0, waitingUserInput: 0, waitingApproval: 0, failed: 0, unread: 0, running: 0 },
      primaryTarget: null
    },
    loading: false,
    degraded: false,
    error: null,
    refresh: () => undefined
  })
}))

import { Workbench } from './Workbench'
import { useChatStore } from '../store/chat-store'
import { useErrorPresentationStore } from '../store/error-presentation-store'
import type { SideConversation } from '../store/chat-store-types'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const STREAMING_SIDE: SideConversation = {
  threadId: 'side-1',
  parentThreadId: 'thread-1',
  title: 'Side',
  createdAt: '2026-10-20T00:00:00.000Z',
  inheritedAt: '2026-10-20T00:00:00.000Z',
  busy: true,
  blocks: [],
  liveReasoning: '',
  liveAssistant: '',
  lastSeq: 0,
  input: '',
  model: 'auto',
  reasoningEffort: '',
  turnId: null,
  userItemId: null,
  error: null
}

function seedStreamingState(): void {
  useChatStore.setState({
    route: 'chat',
    workspaceRoot: '/workspace',
    activeThreadId: 'thread-1',
    focusedAgentThreadId: null,
    runtimeConnection: 'idle',
    busy: true,
    error: null,
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    sideConversations: { 'side-1': STREAMING_SIDE },
    threads: [{
      id: 'thread-1',
      title: 'Session',
      updatedAt: '2026-10-20T00:00:00.000Z',
      model: 'auto',
      mode: 'agent',
      workspace: '/workspace'
    }]
  })
}

describe('Workbench streaming render isolation', () => {
  let root: Root | undefined
  let container: HTMLDivElement

  beforeEach(() => {
    Object.defineProperty(window, 'sciforge', {
      configurable: true,
      value: {
        platform: 'darwin',
        visibleContext: { onCaptureStateChanged: () => () => undefined },
        extensions: { rendererContributions: () => Promise.resolve([]) },
        getLogPath: () => Promise.resolve('/tmp/runtime.log'),
        listSkills: () => Promise.resolve({ ok: true, skills: [], validationErrors: [] }),
        runDesktopCommand: () => Promise.resolve()
      }
    })
    panelLayout.workspaces = []
    seedStreamingState()
    useErrorPresentationStore.setState({ dismissed: {} })
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    container.remove()
    vi.clearAllMocks()
    seedStreamingState()
    useChatStore.setState({ blocks: [], activeThreadId: null, busy: false, sideConversations: {} })
  })

  it('binds a resident plugin panel to its owning session workspace when the global workspace changes', async () => {
    const mode = 'development:@example/notes:panel'
    const ownerId = 'thread-1'
    const workspaces = addSessionRightPanelPane(
      { [ownerId]: createSessionRightPanelWorkspace(ownerId) }, ownerId, { mode }
    )
    panelLayout.workspaces = [workspaces[ownerId]]
    window.sciforge.extensions.rendererContributions = vi.fn(async () => [{
      pluginId: '@example/notes', contributionId: 'panel', kind: 'panel' as const,
      title: 'Notes', generation: 1, version: '1.0.0', stateVersion: 1,
      entryUrl: 'about:blank', capabilityIds: ['notes.read']
    }])
    useChatStore.setState(state => ({
      workspaceRoot: '/other-workspace',
      threads: state.threads.map(thread => ({ ...thread, runtimeId: 'dsh' as const }))
    }))
    root = createRoot(container)
    await act(async () => root!.render(createElement(Workbench)))
    const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Notes"]')!
    expect(frame).not.toBeNull()
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    await act(async () => frame.dispatchEvent(new Event('load')))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: 'host.init', workspaceRoot: '/workspace', sessionId: ownerId, runtimeId: 'dsh'
    }), '*')
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ workspaceRoot: '/other-workspace' }), '*')
  })

  it('dismisses runtime diagnostics without clearing failure state, survives refresh, and shows new failures', async () => {
    useChatStore.setState({ error: 'failed request', runtimeErrorDetail: 'timeout', runtimeConnection: 'offline' })
    root = createRoot(container)
    await act(async () => root!.render(createElement(Workbench)))
    const close = (): HTMLButtonElement | null => container.querySelector('[data-testid="runtime-error-dismiss"]')
    expect(close()).not.toBeNull()
    await act(async () => close()?.click())
    expect(close()).toBeNull()
    expect(useChatStore.getState().error).toBe('failed request')
    expect(useChatStore.getState().runtimeConnection).toBe('offline')
    await act(async () => useChatStore.setState({ error: null }))
    await act(async () => useChatStore.setState({ error: 'failed request' }))
    expect(close()).toBeNull()
    await act(async () => root?.unmount())
    root = createRoot(container)
    await act(async () => root!.render(createElement(Workbench)))
    expect(close()).toBeNull()
    await act(async () => useChatStore.setState((state) => ({
      threads: state.threads.map((thread) => ({ ...thread, latestTurnId: 'new-failed-turn' }))
    })))
    expect(close()).not.toBeNull()
    await act(async () => close()?.click())
    await act(async () => useChatStore.setState({ activeThreadId: 'another-session' }))
    expect(close()).not.toBeNull()
  })

  it('shows an identical failure after an explicit connection retry without a new turn', async () => {
    const originalProbe = useChatStore.getState().probeRuntime
    const probe = vi.fn(async () => {
      useChatStore.setState({ error: null, runtimeConnection: 'checking' })
      await Promise.resolve()
      useChatStore.setState({ error: 'failed request', runtimeErrorDetail: 'timeout', runtimeConnection: 'offline' })
    })
    useChatStore.setState({ error: 'failed request', runtimeErrorDetail: 'timeout', runtimeConnection: 'offline', probeRuntime: probe })
    try {
      root = createRoot(container)
      await act(async () => root!.render(createElement(Workbench)))
      const close = (): HTMLButtonElement | null => container.querySelector('[data-testid="runtime-error-dismiss"]')
      await act(async () => close()?.click())
      expect(close()).toBeNull()
      await act(async () => useChatStore.setState({ error: null }))
      await act(async () => useChatStore.setState({ error: 'failed request' }))
      expect(close()).toBeNull()
      const retry = probes.timelineRender.mock.calls.at(-1)?.[0].onRetryConnection as () => void
      await act(async () => retry())
      expect(probe).toHaveBeenCalledWith('user')
      expect(close()).not.toBeNull()
      expect(useChatStore.getState().error).toBe('failed request')
      expect(useChatStore.getState().activeThreadId).toBe('thread-1')
    } finally {
      await act(async () => useChatStore.setState({ probeRuntime: originalProbe }))
    }
  })

  it('keeps the root tree idle on streaming deltas while the timeline container updates', async () => {
    root = createRoot(container)
    await act(async () => root!.render(createElement(Workbench)))

    const baseline = {
      sidebar: probes.sidebarRender.mock.calls.length,
      composer: probes.composerRender.mock.calls.length,
      topbar: probes.topbarRender.mock.calls.length
    }
    expect(baseline.sidebar).toBeGreaterThan(0)
    expect(probes.timelineRender).toHaveBeenCalled()

    // Text/reasoning chunks on the active thread.
    await act(async () => useChatStore.setState({ liveAssistant: 'Hello' }))
    await act(async () => useChatStore.setState({ liveAssistant: 'Hello, world' }))
    await act(async () => useChatStore.setState({ liveReasoning: 'thinking…' }))

    // A background side conversation streams more chunks (its record identity
    // changes per delta) while its id list and running count stay the same.
    await act(async () => useChatStore.setState({
      sideConversations: { 'side-1': { ...STREAMING_SIDE, liveAssistant: 'side chunk' } }
    }))
    await act(async () => useChatStore.setState({
      sideConversations: {
        'side-1': { ...STREAMING_SIDE, liveAssistant: 'side chunk', blocks: [{ kind: 'user', id: 'u1', text: 'q' }] }
      }
    }))

    const timelineLast = probes.timelineRender.mock.calls.at(-1)?.[0] as {
      live: string
      liveReasoning: string
    }
    expect(timelineLast.live).toBe('Hello, world')
    expect(timelineLast.liveReasoning).toBe('thinking…')

    expect(probes.sidebarRender.mock.calls.length).toBe(baseline.sidebar)
    expect(probes.composerRender.mock.calls.length).toBe(baseline.composer)
    expect(probes.topbarRender.mock.calls.length).toBe(baseline.topbar)

    // A streamed tool block still reaches the timeline and the composer's
    // changed-files summary without re-rendering the root-owned chrome.
    const toolBlock = {
      kind: 'tool' as const,
      id: 'tool-1',
      createdAt: '2026-10-20T00:00:01.000Z',
      summary: 'edit',
      status: 'success' as const,
      toolKind: 'file_change' as const,
      detail: 'diff --git a/foo.ts b/foo.ts\n--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-old\n+new\n'
    }
    await act(async () => useChatStore.setState({ blocks: [toolBlock] }))

    const timelineWithBlock = probes.timelineRender.mock.calls.at(-1)?.[0] as { blocks: ChatBlock[] }
    expect(timelineWithBlock.blocks).toHaveLength(1)
    expect(probes.composerRender.mock.calls.length).toBeGreaterThan(baseline.composer)
    expect(probes.sidebarRender.mock.calls.length).toBe(baseline.sidebar)
  })

  it('keeps the root tree idle while the development contribution poll reports unchanged listings', async () => {
    const contribution = {
      pluginId: 'sciforge.example',
      contributionId: 'example.panel',
      kind: 'panel' as const,
      title: 'Example',
      generation: 1,
      version: '1.0.0',
      entryUrl: 'file:///plugins/example/panel.js',
      stateVersion: 1
    }
    let listing = [contribution]
    Object.defineProperty(window, 'sciforge', {
      configurable: true,
      value: {
        platform: 'darwin',
        visibleContext: { onCaptureStateChanged: () => () => undefined },
        // Every poll deserializes a fresh projection of the same contributions.
        extensions: { rendererContributions: () => Promise.resolve(listing.map((entry) => ({ ...entry }))) },
        getLogPath: () => Promise.resolve('/tmp/runtime.log'),
        listSkills: () => Promise.resolve({ ok: true, skills: [], validationErrors: [] }),
        runDesktopCommand: () => Promise.resolve()
      }
    })
    vi.useFakeTimers()
    try {
      root = createRoot(container)
      await act(async () => root!.render(createElement(Workbench)))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })

      const settled = {
        sidebar: probes.sidebarRender.mock.calls.length,
        composer: probes.composerRender.mock.calls.length,
        topbar: probes.topbarRender.mock.calls.length
      }

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })

      expect(probes.sidebarRender.mock.calls.length).toBe(settled.sidebar)
      expect(probes.composerRender.mock.calls.length).toBe(settled.composer)
      expect(probes.topbarRender.mock.calls.length).toBe(settled.topbar)

      // A genuinely changed listing must still reach the renderer.
      listing = [{ ...contribution, stateVersion: 2 }]
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })

      expect(probes.sidebarRender.mock.calls.length).toBeGreaterThan(settled.sidebar)
    } finally {
      vi.useRealTimers()
    }
  })
})
