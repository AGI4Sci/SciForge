import { create } from 'zustand'
import type {
  AnchoredCommentKind,
  AnchoredCommentThreadView,
  CommentTargetInspection,
  FeedbackSubmissionStatus,
  ProductFeedbackDisclosure
} from './types'

export const ANCHORED_COMMENTS_SUBMIT_FEEDBACK_EVENT =
  'sciforge:anchored-comments-submit-feedback' as const
export const ANCHORED_COMMENTS_STATUS_CHANGE_EVENT =
  'sciforge:anchored-comments-status-change' as const
export const ANCHORED_COMMENTS_DELETE_EVENT =
  'sciforge:anchored-comments-delete' as const

export type AnchoredCommentsSubmitFeedbackDetail = {
  threadId: string
  disclosure: ProductFeedbackDisclosure
}

type AddThreadInput = {
  kind: AnchoredCommentKind
  target: CommentTargetInspection
  comment: string
}

export type AnchoredCommentStoreState = {
  commentMode: boolean
  threads: AnchoredCommentThreadView[]
  selectedForConversation: string[]
  productFeedbackThreadId: string | null
  panelOpen: boolean
  setCommentMode: (enabled: boolean) => void
  toggleCommentMode: () => void
  setPanelOpen: (open: boolean) => void
  addThread: (input: AddThreadInput) => AnchoredCommentThreadView
  replaceThreads: (threads: AnchoredCommentThreadView[]) => void
  replaceThread: (thread: AnchoredCommentThreadView) => void
  removeThread: (threadId: string) => void
  resolveThread: (threadId: string) => void
  reopenThread: (threadId: string) => void
  toggleConversationSelection: (threadId: string) => void
  setConversationSelection: (threadIds: string[]) => void
  clearConversationSelection: () => void
  addSelectedToConversation: () => string[]
  openProductFeedback: (threadId: string) => void
  closeProductFeedback: () => void
  submitProductFeedback: (threadId: string, disclosure: ProductFeedbackDisclosure) => void
  markFeedbackStatus: (threadId: string, status: FeedbackSubmissionStatus, error?: string) => void
}

function nextThreadId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `comment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function dispatchWindowEvent<T>(eventName: string, detail: T): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent<T>(eventName, { detail }))
}

export const useAnchoredCommentStore = create<AnchoredCommentStoreState>((set, get) => ({
  commentMode: false,
  threads: [],
  selectedForConversation: [],
  productFeedbackThreadId: null,
  panelOpen: false,
  setCommentMode: (commentMode) => set({ commentMode }),
  toggleCommentMode: () => set((state) => ({ commentMode: !state.commentMode })),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  addThread: (input) => {
    const thread: AnchoredCommentThreadView = {
      id: nextThreadId(),
      kind: input.kind,
      target: input.target,
      comment: input.comment.trim(),
      createdAt: new Date().toISOString(),
      status: 'open',
      feedbackStatus: 'local'
    }
    set((state) => ({ threads: [thread, ...state.threads], panelOpen: true }))
    return thread
  },
  replaceThreads: (threads) => set({ threads: [...threads] }),
  replaceThread: (thread) => set((state) => ({
    threads: state.threads.some((item) => item.id === thread.id)
      ? state.threads.map((item) => item.id === thread.id ? thread : item)
      : [thread, ...state.threads]
  })),
  removeThread: (threadId) => {
    set((state) => ({
      threads: state.threads.filter((thread) => thread.id !== threadId),
      selectedForConversation: state.selectedForConversation.filter((id) => id !== threadId),
      productFeedbackThreadId:
        state.productFeedbackThreadId === threadId ? null : state.productFeedbackThreadId
    }))
    dispatchWindowEvent(ANCHORED_COMMENTS_DELETE_EVENT, { threadId })
  },
  resolveThread: (threadId) => {
    set((state) => ({
      threads: state.threads.map((thread) =>
        thread.id === threadId ? { ...thread, status: 'resolved' } : thread
      )
    }))
    dispatchWindowEvent(ANCHORED_COMMENTS_STATUS_CHANGE_EVENT, { threadId, status: 'resolved' })
  },
  reopenThread: (threadId) => {
    set((state) => ({
      threads: state.threads.map((thread) =>
        thread.id === threadId ? { ...thread, status: 'open' } : thread
      )
    }))
    dispatchWindowEvent(ANCHORED_COMMENTS_STATUS_CHANGE_EVENT, { threadId, status: 'open' })
  },
  toggleConversationSelection: (threadId) => set((state) => ({
    selectedForConversation: state.selectedForConversation.includes(threadId)
      ? state.selectedForConversation.filter((id) => id !== threadId)
      : [...state.selectedForConversation, threadId]
  })),
  setConversationSelection: (threadIds) => set({ selectedForConversation: [...new Set(threadIds)] }),
  clearConversationSelection: () => set({ selectedForConversation: [] }),
  addSelectedToConversation: () => {
    const threadIds = [...get().selectedForConversation]
    if (threadIds.length === 0) return []
    set((state) => ({
      threads: state.threads.map((thread) =>
        threadIds.includes(thread.id) && thread.status === 'open'
          ? { ...thread, status: 'attached' }
          : thread
      )
    }))
    for (const threadId of threadIds) {
      dispatchWindowEvent(ANCHORED_COMMENTS_STATUS_CHANGE_EVENT, { threadId, status: 'attached' })
    }
    return threadIds
  },
  openProductFeedback: (productFeedbackThreadId) => set({ productFeedbackThreadId }),
  closeProductFeedback: () => set({ productFeedbackThreadId: null }),
  submitProductFeedback: (threadId, disclosure) => {
    set((state) => ({
      threads: state.threads.map((thread) =>
        thread.id === threadId ? { ...thread, feedbackStatus: 'submitting', error: undefined } : thread
      )
    }))
    dispatchWindowEvent<AnchoredCommentsSubmitFeedbackDetail>(
      ANCHORED_COMMENTS_SUBMIT_FEEDBACK_EVENT,
      { threadId, disclosure }
    )
  },
  markFeedbackStatus: (threadId, feedbackStatus, error) => set((state) => ({
    threads: state.threads.map((thread) =>
      thread.id === threadId ? { ...thread, feedbackStatus, error } : thread
    )
  }))
}))

export const anchoredCommentStore = useAnchoredCommentStore
