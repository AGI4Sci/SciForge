import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ANCHORED_COMMENTS_ADD_TO_CONVERSATION_EVENT,
  useAnchoredCommentStore
} from './anchored-comment-store'
import { ProductFeedbackDialog } from './ProductFeedbackDialog'
import {
  elementBehindCommentCaptureLayer,
  inspectCommentTarget,
  inspectTextSelectionTarget,
  isCommentTargetDenied,
  resolveCommentTargetElement
} from './targeting'
import { DEFAULT_PRODUCT_FEEDBACK_DISCLOSURE, type AnchoredCommentThreadView } from './types'

const target = {
  label: 'Result chart',
  route: 'chat',
  bounds: { x: 12, y: 24, width: 200, height: 100 },
  componentId: 'results-panel',
  elementId: 'chart-1',
  domFingerprint: ['main', 'section', 'figure']
}

function resetStore(): void {
  useAnchoredCommentStore.setState({
    commentMode: false,
    threads: [],
    selectedForConversation: [],
    productFeedbackThreadId: null,
    panelOpen: false
  })
}

afterEach(() => {
  resetStore()
  vi.unstubAllGlobals()
})

describe('anchored comment store', () => {
  it('only dispatches explicitly selected thread ids to the conversation', () => {
    const dispatchEvent = vi.fn((_event: unknown): boolean => true)
    class TestCustomEvent<T> {
      type: string
      detail: T
      constructor(type: string, init: { detail: T }) {
        this.type = type
        this.detail = init.detail
      }
    }
    vi.stubGlobal('window', { dispatchEvent })
    vi.stubGlobal('CustomEvent', TestCustomEvent)

    const first = useAnchoredCommentStore.getState().addThread({
      kind: 'research',
      target,
      comment: 'Explain this peak.'
    })
    useAnchoredCommentStore.getState().addThread({
      kind: 'research',
      target: { ...target, label: 'Other chart' },
      comment: 'This one must not be attached.'
    })
    useAnchoredCommentStore.getState().toggleConversationSelection(first.id)

    expect(useAnchoredCommentStore.getState().addSelectedToConversation()).toEqual([first.id])
    expect(dispatchEvent).toHaveBeenCalledTimes(2)
    const event = dispatchEvent.mock.calls
      .map(([candidate]) => candidate as unknown as TestCustomEvent<{ threadIds: string[] }>)
      .find((candidate) => candidate.type === ANCHORED_COMMENTS_ADD_TO_CONVERSATION_EVENT)
    expect(event).toBeDefined()
    expect(event?.detail).toEqual({ threadIds: [first.id] })
    expect(useAnchoredCommentStore.getState().selectedForConversation).toEqual([])
    expect(useAnchoredCommentStore.getState().threads.find((thread) => thread.id === first.id)?.status)
      .toBe('attached')
  })

  it('never resolves a comment when it is attached', () => {
    const thread = useAnchoredCommentStore.getState().addThread({
      kind: 'research',
      target,
      comment: 'Change this result.'
    })
    useAnchoredCommentStore.getState().setConversationSelection([thread.id])
    useAnchoredCommentStore.getState().addSelectedToConversation()

    expect(useAnchoredCommentStore.getState().threads[0]?.status).toBe('attached')
  })
})

describe('product feedback confirmation', () => {
  const feedbackThread: AnchoredCommentThreadView = {
    id: 'feedback-1',
    kind: 'product_feedback',
    target,
    comment: 'The chart button does nothing.',
    createdAt: '2026-07-11T00:00:00.000Z',
    status: 'open',
    feedbackStatus: 'local'
  }

  it('uses safe disclosure defaults from the shared contract', () => {
    expect(DEFAULT_PRODUCT_FEEDBACK_DISCLOSURE).toEqual({
      annotatedScreenshots: true,
      applicationEnvironment: true,
      logs: false,
      conversationExcerpt: false,
      workspacePaths: false,
      fileMetadata: false
    })
  })

  it('shows an explicit public-upload warning and every optional disclosure', () => {
    const markup = renderToStaticMarkup(createElement(ProductFeedbackDialog, {
      thread: feedbackThread,
      onClose: vi.fn(),
      onConfirm: vi.fn()
    }))

    expect(markup).toContain('This feedback will be uploaded publicly.')
    expect(markup).toContain('Annotated screenshots')
    expect(markup).toContain('Application environment')
    expect(markup).toContain('Recent logs')
    expect(markup).toContain('Conversation excerpt')
    expect(markup).toContain('Workspace paths')
    expect(markup).toContain('File metadata')
    expect(markup.match(/checked=""/g)).toHaveLength(2)
  })
})

describe('comment target inspection', () => {
  it('promotes a tiny text leaf to its nearest painted card', () => {
    const card = {
      tagName: 'SPAN',
      parentElement: null,
      getBoundingClientRect: () => ({ x: 100, y: 80, width: 120, height: 52 })
    } as unknown as Element
    const leaf = {
      tagName: 'SPAN',
      parentElement: card,
      closest: vi.fn(() => null),
      getBoundingClientRect: () => ({ x: 110, y: 105, width: 92, height: 16 })
    } as unknown as Element
    vi.stubGlobal('window', {
      innerWidth: 1_200,
      innerHeight: 800,
      getComputedStyle: (element: Element) => element === card
        ? {
            backgroundColor: 'rgb(238, 242, 247)',
            borderTopWidth: '0px',
            borderRightWidth: '0px',
            borderBottomWidth: '0px',
            borderLeftWidth: '0px',
            boxShadow: 'none',
            borderRadius: '6px',
            paddingTop: '8px',
            paddingRight: '10px',
            paddingBottom: '8px',
            paddingLeft: '10px'
          }
        : {}
    })

    expect(resolveCommentTargetElement(leaf)).toBe(card)
    expect(resolveCommentTargetElement(leaf, 'exact')).toBe(leaf)
  })

  it('promotes icon descendants to their interactive control', () => {
    const button = { tagName: 'BUTTON' } as unknown as Element
    const path = {
      closest: vi.fn((selector: string) => selector.includes('button') ? button : null)
    } as unknown as Element

    expect(resolveCommentTargetElement(path)).toBe(button)
  })

  it('looks through the no-drag capture layer and restores its pointer behavior', () => {
    const element = {} as Element
    const elementFromPoint = vi.fn(() => element)
    vi.stubGlobal('document', { elementFromPoint })
    const captureLayer = { style: { pointerEvents: 'auto' } } as HTMLElement

    expect(elementBehindCommentCaptureLayer(captureLayer, 40, 80)).toBe(element)
    expect(elementFromPoint).toHaveBeenCalledWith(40, 80)
    expect(captureLayer.style.pointerEvents).toBe('auto')
  })

  it('rejects targets inside a sensitive region', () => {
    const element = {
      closest: vi.fn((selector: string) => selector.includes('data-sciforge-comment-sensitive') ? element : null)
    } as unknown as Element

    expect(isCommentTargetDenied(element)).toBe(true)
  })

  it('prefers stable SciForge target identity and keeps visual bounds', () => {
    class InputElement {}
    class TextAreaElement {}
    vi.stubGlobal('HTMLInputElement', InputElement)
    vi.stubGlobal('HTMLTextAreaElement', TextAreaElement)
    vi.stubGlobal('document', { documentElement: {} })
    const attributes: Record<string, string> = {
      'data-sciforge-comment-component': 'paper-viewer',
      'data-sciforge-comment-element': 'figure-2',
      'data-sciforge-comment-label': 'Figure 2'
    }
    const element = {
      tagName: 'FIGURE',
      id: '',
      parentElement: null,
      textContent: 'Fallback text',
      getAttribute: (name: string) => attributes[name] ?? null,
      closest: (selector: string) => selector.includes('data-sciforge-comments-ui') ? null : element,
      getBoundingClientRect: () => ({ x: 10.4, y: 20.6, width: 300.2, height: 149.7 })
    } as unknown as Element

    expect(inspectCommentTarget(element, 'chat')).toMatchObject({
      label: 'Figure 2',
      route: 'chat',
      componentId: 'paper-viewer',
      elementId: 'figure-2',
      bounds: { x: 10, y: 21, width: 300, height: 150 }
    })
  })

  it('creates bounded text-selection metadata for the right-clicked selection', () => {
    class InputElement {}
    class TextAreaElement {}
    vi.stubGlobal('HTMLInputElement', InputElement)
    vi.stubGlobal('HTMLTextAreaElement', TextAreaElement)
    vi.stubGlobal('document', { documentElement: {} })
    const attributes: Record<string, string> = {
      'data-sciforge-comment-resource-type': 'paper',
      'data-sciforge-comment-resource-id': 'paper-42',
      'data-sciforge-comment-component': 'paper-viewer'
    }
    const resource = {
      nodeType: 1,
      tagName: 'ARTICLE',
      id: '',
      parentElement: null,
      textContent: 'The selected claim is important.',
      getAttribute: (name: string) => attributes[name] ?? null,
      closest: (selector: string) => selector.includes('data-sciforge-comments-ui') ? null : resource,
      getBoundingClientRect: () => ({ x: 8, y: 10, width: 500, height: 300 })
    } as unknown as Element
    const range = {
      commonAncestorContainer: resource,
      startOffset: 4,
      endOffset: 18,
      intersectsNode: vi.fn(() => true),
      getBoundingClientRect: () => ({ x: 40.4, y: 70.6, width: 180.2, height: 21.4 })
    } as unknown as Range
    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      toString: () => '  selected   claim  ',
      getRangeAt: vi.fn(() => range)
    } as unknown as Selection

    const inspected = inspectTextSelectionTarget(selection, 'chat', resource)

    expect(inspected).toMatchObject({
      label: 'Selected text: selected claim',
      route: 'chat',
      resourceType: 'paper',
      resourceId: 'paper-42',
      bounds: { x: 40, y: 71, width: 180, height: 21 }
    })
    expect(JSON.parse(inspected?.selection ?? '{}')).toEqual({
      kind: 'text',
      text: 'selected claim',
      startOffset: 4,
      endOffset: 18
    })
    expect(range.intersectsNode).toHaveBeenCalledWith(resource)
  })

  it('does not offer a quick comment for collapsed, stale, or sensitive selections', () => {
    const safeContainer = {
      nodeType: 1,
      closest: vi.fn(() => null)
    } as unknown as Element
    const unrelatedContext = {
      closest: vi.fn(() => null)
    } as unknown as Element
    const range = {
      commonAncestorContainer: safeContainer,
      intersectsNode: vi.fn(() => false)
    } as unknown as Range
    const staleSelection = {
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'Selected elsewhere',
      getRangeAt: () => range
    } as unknown as Selection
    const collapsedSelection = {
      ...staleSelection,
      isCollapsed: true
    } as Selection
    const sensitiveContext = {
      closest: vi.fn(() => sensitiveContext)
    } as unknown as Element

    expect(inspectTextSelectionTarget(collapsedSelection, 'chat', safeContainer)).toBeNull()
    expect(inspectTextSelectionTarget(staleSelection, 'chat', unrelatedContext)).toBeNull()
    expect(inspectTextSelectionTarget(staleSelection, 'chat', sensitiveContext)).toBeNull()
  })
})
