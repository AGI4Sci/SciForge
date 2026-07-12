import { describe, expect, it } from 'vitest'
import type { ChatState, SideConversation } from './chat-store-types'
import {
  clearedAgentFocusState,
  createFocusActions,
  resetAgentFocusState,
  selectFocusedAgentSurface
} from './chat-store-focus-actions'

function side(
  threadId: string,
  parentThreadId: string,
  title: string,
  input = ''
): SideConversation {
  return {
    threadId,
    runtimeId: 'codex',
    parentThreadId,
    source: 'child_agent',
    title,
    createdAt: '2026-07-11T00:00:00.000Z',
    inheritedAt: '2026-07-11T00:00:00.000Z',
    blocks: [{ kind: 'assistant', id: `${threadId}-answer`, createdAt: '2026-07-11T00:00:00.000Z', text: title }],
    liveReasoning: `${title} reasoning`,
    liveAssistant: '',
    lastSeq: 2,
    input,
    model: 'sciforge-router',
    reasoningEffort: 'high',
    busy: true,
    turnId: `${threadId}-turn`,
    userItemId: `${threadId}-user`,
    error: null
  }
}

function harness() {
  let state = {
    activeThreadId: 'root',
    activeAgentRuntime: 'sciforge',
    threads: [{
      id: 'root',
      title: 'Root',
      runtimeId: 'sciforge',
      updatedAt: '2026-07-11T00:00:00.000Z',
      model: 'sciforge-router',
      mode: 'agent',
      status: 'idle'
    }],
    sideConversations: {
      child: side('child', 'root', 'Child', 'child draft'),
      grandchild: side('grandchild', 'child', 'Grandchild', 'grandchild draft'),
      sibling: side('sibling', 'root', 'Sibling')
    },
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    busy: false,
    currentTurnId: null,
    composerModel: 'sciforge-router',
    error: null,
    ...clearedAgentFocusState()
  } as unknown as ChatState
  const get = () => state
  const set = (patch: Partial<ChatState> | ((current: ChatState) => Partial<ChatState>)) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  }
  const actions = createFocusActions(set, get)
  state = { ...state, ...actions }
  actions.resetAgentFocus()
  return { get, actions }
}

describe('agent focus navigation', () => {
  it('focuses attached descendants without changing the selected root thread', () => {
    const { get, actions } = harness()

    expect(actions.focusAgentThread({ threadId: 'grandchild' })).toBe(true)

    expect(get().activeThreadId).toBe('root')
    expect(get().focusedAgentThreadId).toBe('grandchild')
    expect(get().focusedAgentRuntimeId).toBe('codex')
    expect(get().agentFocusLineage.map((node) => node.threadId)).toEqual(['root', 'child', 'grandchild'])
  })

  it('supports browser history, parent navigation, and truncates a forward branch', () => {
    const { get, actions } = harness()
    actions.focusAgentThread({ threadId: 'child' })
    actions.focusAgentThread({ threadId: 'grandchild' })

    expect(actions.focusAgentBack()).toBe(true)
    expect(get().focusedAgentThreadId).toBe('child')
    expect(actions.focusAgentForward()).toBe(true)
    expect(get().focusedAgentThreadId).toBe('grandchild')
    expect(actions.focusAgentParent()).toBe(true)
    expect(get().focusedAgentThreadId).toBe('child')

    expect(actions.focusAgentThread({ threadId: 'sibling' })).toBe(true)
    expect(get().agentFocusHistory.map((location) => location.threadId)).toEqual([
      'root', 'child', 'grandchild', 'child', 'sibling'
    ])
    expect(actions.focusAgentForward()).toBe(false)
  })

  it('exposes a child side timeline and draft as the focused workbench surface', () => {
    const { get, actions } = harness()
    actions.focusAgentThread({ threadId: 'grandchild' })

    const surface = selectFocusedAgentSurface(get())
    expect(surface).toMatchObject({
      source: 'side',
      threadId: 'grandchild',
      parentThreadId: 'child',
      title: 'Grandchild',
      input: 'grandchild draft',
      busy: true,
      turnId: 'grandchild-turn'
    })
    expect(surface?.blocks).toHaveLength(1)
    expect(surface?.liveReasoning).toBe('Grandchild reasoning')
  })

  it('resets focus and history when the selected root changes', () => {
    const { get, actions } = harness()
    actions.focusAgentThread({ threadId: 'child' })
    const state = get()
    state.threads.push({
      id: 'next-root',
      title: 'Next root',
      runtimeId: 'codex',
      updatedAt: '2026-07-11T00:00:00.000Z',
      model: 'sciforge-router',
      mode: 'agent',
      status: 'idle'
    })

    const reset = resetAgentFocusState(state, 'next-root')
    expect(reset.focusedAgentThreadId).toBe('next-root')
    expect(reset.focusedAgentRuntimeId).toBe('codex')
    expect(reset.agentFocusHistory).toHaveLength(1)
    expect(reset.agentFocusLineage.map((node) => node.threadId)).toEqual(['next-root'])
  })
})
