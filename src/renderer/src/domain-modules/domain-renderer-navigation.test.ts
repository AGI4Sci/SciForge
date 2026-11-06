import type {
  DomainWorkbenchOpenRightPanelInput,
  DomainWorkbenchOpenSurfaceInput,
  DomainWorkspacePreviewTarget
} from '@sciforge/domain-sdk/host'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WORKSPACE_FILE_PREVIEW_EVENT } from '../lib/workspace-file-preview'
import {
  DOMAIN_WORKBENCH_OPEN_RIGHT_PANEL_EVENT,
  DOMAIN_WORKBENCH_OPEN_BOTTOM_PANEL_EVENT,
  domainRendererNavigationHost,
  sendDomainWorkbenchMessage,
  resolveDomainWorkbenchSession,
  selectDomainWorkbenchSession,
  openDomainWorkbenchSideConversation,
  setDomainWorkbenchSideConversationOpener,
  setDomainWorkbenchSessionNavigator,
  setDomainWorkbenchResourceNavigationProvider,
  setDevelopmentWorkbenchResourceNavigationProvider
} from './domain-renderer-navigation'
import type { ChatState } from '../store/chat-store-types'

afterEach(() => vi.unstubAllGlobals())

describe('domain renderer navigation host', () => {
  it('routes workspace previews and right-panel activations through generic events', () => {
    const targetWindow = new EventTarget()
    vi.stubGlobal('window', targetWindow)
    const previews: DomainWorkspacePreviewTarget[] = []
    const panels: DomainWorkbenchOpenRightPanelInput[] = []
    let bottomPanel: DomainWorkbenchOpenSurfaceInput | undefined
    targetWindow.addEventListener(WORKSPACE_FILE_PREVIEW_EVENT, (event) => {
      previews.push((event as CustomEvent<DomainWorkspacePreviewTarget>).detail)
    })
    targetWindow.addEventListener(DOMAIN_WORKBENCH_OPEN_RIGHT_PANEL_EVENT, (event) => {
      panels.push((event as CustomEvent<DomainWorkbenchOpenRightPanelInput>).detail)
    })
    targetWindow.addEventListener(DOMAIN_WORKBENCH_OPEN_BOTTOM_PANEL_EVENT, (event) => {
      bottomPanel = (event as CustomEvent<DomainWorkbenchOpenSurfaceInput>).detail
    })
    const activation = {
      contributionId: 'fixture.panel',
      revision: 4,
      payload: { nodeId: 'node-4' }
    } as const

    domainRendererNavigationHost.workspacePreview.open({
      path: 'paper.pdf',
      sessionId: 'session-1',
      placement: 'new',
      workspaceRoot: '/workspace',
      returnTo: {
        contributionId: 'fixture.panel',
        activation
      }
    })
    domainRendererNavigationHost.workspacePreview.open({
      path: 'figure.png',
      sessionId: 'session-1',
      surfaceId: 'pane:figure'
    })
    domainRendererNavigationHost.workbench.openRightPanel({
      contributionId: 'fixture.panel',
      sessionId: 'session-1',
      activation
    })
    expect(domainRendererNavigationHost.workbench.canOpenResource?.('artifact-version')).toBe(false)
    expect(domainRendererNavigationHost.workbench.openResource?.({
      sessionId: 'session-1',
      resource: {
        resourceKind: 'artifact-version',
        resourceId: 'artifact-version:figure:2',
        integrity: {
          algorithm: 'sha256',
          expectedDigest: `sha256:${'a'.repeat(64)}`
        }
      }
    })).toBe(false)
    const disposeResourceProvider = setDomainWorkbenchResourceNavigationProvider({
      canOpen: (resourceKind) => resourceKind === 'artifact-version',
      resolve: (input) => ({
        contributionId: 'fixture.resource-panel',
        sessionId: input.sessionId,
        activation: {
          contributionId: 'fixture.resource-panel',
          revision: 1,
          payload: { resourceId: input.resource.resourceId }
        }
      })
    })
    expect(domainRendererNavigationHost.workbench.canOpenResource?.('artifact-version')).toBe(true)
    expect(domainRendererNavigationHost.workbench.canOpenResource?.('compute-run')).toBe(false)
    expect(domainRendererNavigationHost.workbench.openResource?.({
      sessionId: 'session-1',
      resource: {
        resourceKind: 'artifact-version',
        resourceId: 'artifact-version:figure:2',
        integrity: {
          algorithm: 'sha256',
          expectedDigest: `sha256:${'a'.repeat(64)}`
        }
      }
    })).toBe(true)
    disposeResourceProvider()
    domainRendererNavigationHost.workbench.openBottomPanel?.({
      contributionId: 'fixture.bottom-panel',
      sessionId: 'session-1',
      activation
    })

    expect(previews[0]).toMatchObject({
      path: 'paper.pdf',
      sessionId: 'session-1',
      placement: 'new',
      returnTo: {
        kind: 'domain-right-panel',
        contributionId: 'fixture.panel',
        activation
      }
    })
    expect(previews[1]).toEqual({
      path: 'figure.png',
      sessionId: 'session-1',
      surfaceId: 'pane:figure'
    })
    expect(panels[0]).toEqual({
      contributionId: 'fixture.panel',
      sessionId: 'session-1',
      activation
    })
    expect(panels[1]).toEqual({
      contributionId: 'fixture.resource-panel',
      sessionId: 'session-1',
      activation: {
        contributionId: 'fixture.resource-panel',
        revision: 1,
        payload: {
          resourceId: 'artifact-version:figure:2'
        }
      }
    })
    expect(bottomPanel).toEqual({
      contributionId: 'fixture.bottom-panel',
      sessionId: 'session-1',
      activation
    })
  })
})

it('falls back to a development plugin panel for an unowned resource kind', () => {
  const targetWindow = new EventTarget()
  vi.stubGlobal('window', targetWindow)
  const panels: DomainWorkbenchOpenRightPanelInput[] = []
  targetWindow.addEventListener(DOMAIN_WORKBENCH_OPEN_RIGHT_PANEL_EVENT, (event) => {
    panels.push((event as CustomEvent<DomainWorkbenchOpenRightPanelInput>).detail)
  })
  const dispose = setDevelopmentWorkbenchResourceNavigationProvider({
    canOpen: (resourceKind) => resourceKind === 'scientific-plot',
    resolve: (input) => ({
      contributionId: 'development:@example/ui:panel',
      sessionId: input.sessionId,
      activation: {
        contributionId: 'development:@example/ui:panel',
        revision: 1,
        payload: { resource: input.resource }
      }
    })
  })
  const resource = {
    resourceKind: 'scientific-plot',
    resourceId: 'artifact-version:figure:9'
  } as const
  expect(domainRendererNavigationHost.workbench.canOpenResource?.('scientific-plot')).toBe(true)
  expect(domainRendererNavigationHost.workbench.openResource?.({ sessionId: 'session-1', resource })).toBe(true)
  expect(panels).toEqual([{
    contributionId: 'development:@example/ui:panel',
    sessionId: 'session-1',
    activation: {
      contributionId: 'development:@example/ui:panel',
      revision: 1,
      payload: { resource }
    }
  }])
  dispose()
  expect(domainRendererNavigationHost.workbench.canOpenResource?.('scientific-plot')).toBe(false)
})


it('routes a failed-input source to the same canonical reexecution action without falling back to another Session', async () => {
  const state = { reexecuteFailedInput: vi.fn(async () => true), sendMessage: vi.fn(), activeThreadId: 'different-session', threads: [] }
  expect(await sendDomainWorkbenchMessage({ sessionId: 'original-session',
    reexecuteInput: { runtimeId: 'codex', clientDirectiveId: 'failed-source' } }, state)).toEqual({ ok: true })
  expect(state.reexecuteFailedInput).toHaveBeenCalledWith({ threadId: 'original-session', runtimeId: 'codex', clientDirectiveId: 'failed-source' })
  expect(state.sendMessage).not.toHaveBeenCalled()
})

it('opens only an exact owned runtime and thread through the standard Session navigator', async () => {
  const threads = [
    { id: 'task-thread', runtimeId: 'codex' },
    { id: 'other-thread', runtimeId: 'claude' }
  ] as ChatState['threads']
  const request = { runtimeId: 'codex', threadId: 'task-thread', focusComposer: true,
    returnTo: { contributionId: 'fixture.page', label: 'Return to delivery',
      activation: { revision: 1, payload: { taskId: 'task-1' } } } }
  expect(resolveDomainWorkbenchSession(request, threads)).toEqual({ runtimeId: 'codex', threadId: 'task-thread' })
  expect(resolveDomainWorkbenchSession({ ...request, runtimeId: 'claude' }, threads)).toBeNull()
  expect(resolveDomainWorkbenchSession({ ...request, threadId: 'missing' }, threads)).toBeNull()
  expect(await domainRendererNavigationHost.workbench.openSession!(request)).toBe(false)
  const navigate = vi.fn(async () => true)
  const dispose = setDomainWorkbenchSessionNavigator(navigate)
  expect(await domainRendererNavigationHost.workbench.openSession!(request)).toBe(true)
  expect(navigate).toHaveBeenCalledWith(request)
  dispose()
  expect(await domainRendererNavigationHost.workbench.openSession!(request)).toBe(false)
})

it('rejects a missing ordinary Session instead of sending research context to the active Session', async () => {
  const state = { reexecuteFailedInput: vi.fn(), sendMessage: vi.fn(), activeThreadId: 'unrelated-session', threads: [] }
  expect(await sendDomainWorkbenchMessage({ sessionId: 'missing-project-session', text: 'scoped research context' }, state)).toMatchObject({ ok: false, error: { code: 'session-unavailable' } })
  expect(state.sendMessage).not.toHaveBeenCalled()
})

it('opens a scoped side conversation on its exact parent and reuses its discussion without switching Sessions', async () => {
  const input = { runtimeId: 'codex', parentThreadId: 'research-parent', workspaceRoot: 'f:/PROJECT/',
    context: { id: 'phase-1', title: 'Phase one', text: 'Evidence summary' } }
  const state = { threads: [{ id: 'research-parent', runtimeId: 'codex', workspace: 'F:\\Project' }] as ChatState['threads'],
    sideConversations: {} as ChatState['sideConversations'], spawnSideConversation: vi.fn(async () => 'side-1'),
    selectSideConversation: vi.fn(), sendSideMessage: vi.fn(async () => true) }
  expect(await openDomainWorkbenchSideConversation(input, state)).toBe('side-1')
  expect(state.spawnSideConversation).toHaveBeenCalledWith(undefined, expect.objectContaining({
    parentThreadId: 'research-parent', runtimeId: 'codex', chatMode: 'light', context: input.context
  }))
  expect(await openDomainWorkbenchSideConversation({ ...input, runtimeId: 'claude' }, state)).toBeNull()
  expect(await openDomainWorkbenchSideConversation({ ...input, workspaceRoot: '/different' }, state)).toBeNull()
  state.sideConversations['side-1'] = { threadId: 'side-1', runtimeId: 'codex', parentThreadId: input.parentThreadId,
    context: input.context } as ChatState['sideConversations'][string]
  expect(await openDomainWorkbenchSideConversation({ ...input, question: 'Follow up' }, state)).toBe('side-1')
  expect(state.spawnSideConversation).toHaveBeenCalledTimes(1)
  expect(state.selectSideConversation).toHaveBeenCalledWith('side-1')
  expect(state.sendSideMessage).toHaveBeenCalledWith('side-1', 'Follow up')
  const dispose = setDomainWorkbenchSideConversationOpener(request => openDomainWorkbenchSideConversation(request, state))
  expect(await domainRendererNavigationHost.workbench.openSideConversation!(input)).toBe('side-1')
  dispose()
  expect(await domainRendererNavigationHost.workbench.openSideConversation!(input)).toBeNull()
})


describe('source session selection', () => {
  it('routes cross-runtime coordinates through read-only selection without sending', async () => {
    const request = { runtimeId: 'codex', threadId: 'source', turnId: 'turn-1', itemId: 'item-1', workspaceRoot: '/science' }
    const state = { threads: [{ id: 'source', runtimeId: 'codex', workspace: '/science' }], activeThreadId: 'other', error: null,
      selectThread: vi.fn(async (id: string) => { state.activeThreadId = id }), sendMessage: vi.fn() }
    const get = () => state as unknown as ChatState
    expect(await selectDomainWorkbenchSession(request, get)).toBe(true)
    expect(state.selectThread).toHaveBeenCalledWith('source', { readOnly: true })
    expect(state.sendMessage).not.toHaveBeenCalled()
    expect(await selectDomainWorkbenchSession({ ...request, runtimeId: 'other' }, get)).toBe(false)
    expect(await selectDomainWorkbenchSession({ ...request, workspaceRoot: '/wrong' }, get)).toBe(false)
    expect(state.selectThread).toHaveBeenCalledTimes(1)
  })
  it('rejects failed and superseded selections even when the ID remains active', async () => {
    const state = { threads: [{ id: 'source', runtimeId: 'codex' }], activeThreadId: 'source', error: null as string | null,
      selectThread: vi.fn(async () => { state.error = 'missing transcript' }) }
    expect(await selectDomainWorkbenchSession({ runtimeId: 'codex', threadId: 'source' }, () => state as unknown as ChatState)).toBe(false)
    state.selectThread.mockImplementation(async () => { state.error = null; state.activeThreadId = 'another' })
    expect(await selectDomainWorkbenchSession({ runtimeId: 'codex', threadId: 'source' }, () => state as unknown as ChatState)).toBe(false)
  })
})
