import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import {
  navigateComposerHistory,
  type ComposerHistoryNavigationState
} from './composer-input-memory'

type UseComposerDraftOptions = {
  input: string
  canCompose: boolean
  historyItems?: readonly string[]
  setInput?: (value: string) => void
  onHistoryInput?: (value: string) => void
}

export function useComposerDraft({
  input,
  canCompose,
  historyItems = [],
  setInput,
  onHistoryInput
}: UseComposerDraftOptions): {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  focused: boolean
  focusComposer: () => void
  onFocus: () => void
  onBlur: () => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
  isComposingEvent: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean
  navigateHistory: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean
  resetHistoryNavigation: (value: string) => void
} {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const resizeFrameRef = useRef(0)
  const composingRef = useRef(false)
  const historyStateRef = useRef<ComposerHistoryNavigationState>({ cursor: null, draft: input })
  const historyAppliedInputRef = useRef<string | null>(null)
  const latestInputRef = useRef(input)
  const [focused, setFocused] = useState(false)
  latestInputRef.current = input

  useEffect(() => {
    if (historyAppliedInputRef.current === input) {
      historyAppliedInputRef.current = null
      return
    }
    historyStateRef.current = { cursor: null, draft: input }
  }, [input])

  useEffect(() => {
    historyStateRef.current = { cursor: null, draft: latestInputRef.current }
  }, [historyItems])

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return

    // Reset before measuring so the textarea can shrink as text is removed.
    // Keep the layout read to one scrollHeight access and batch calls per frame.
    el.style.height = 'auto'
    const scrollHeight = el.scrollHeight
    const nextHeight = Math.min(scrollHeight, 176)
    const minHeight = 36
    const height = `${Math.max(nextHeight, minHeight)}px`
    const overflowY = scrollHeight > 176 ? 'auto' : 'hidden'
    if (el.style.height !== height) el.style.height = height
    if (el.style.overflowY !== overflowY) el.style.overflowY = overflowY
  }, [])

  const scheduleTextareaResize = useCallback(() => {
    window.cancelAnimationFrame(resizeFrameRef.current)
    resizeFrameRef.current = window.requestAnimationFrame(resizeTextarea)
  }, [resizeTextarea])

  useLayoutEffect(() => {
    scheduleTextareaResize()
  }, [canCompose, input, scheduleTextareaResize])

  useEffect(() => () => {
    window.cancelAnimationFrame(resizeFrameRef.current)
  }, [])

  useEffect(() => {
    const el = textareaRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    let previousWidth = el.getBoundingClientRect().width
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry?.contentRect.width ?? el.getBoundingClientRect().width
      if (Math.abs(nextWidth - previousWidth) < 0.5) return
      previousWidth = nextWidth
      scheduleTextareaResize()
    })

    observer.observe(el)

    return () => {
      observer.disconnect()
    }
  }, [scheduleTextareaResize])

  const focusComposer = useCallback(() => {
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  const resetHistoryNavigation = useCallback((value: string) => {
    historyAppliedInputRef.current = null
    historyStateRef.current = { cursor: null, draft: value }
  }, [])

  const navigateHistory = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!setInput || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return false
    const element = event.currentTarget
    const result = navigateComposerHistory({
      key: event.key,
      value: input,
      selectionStart: element.selectionStart ?? input.length,
      selectionEnd: element.selectionEnd ?? input.length,
      history: historyItems,
      state: historyStateRef.current
    })
    if (!result) return false
    historyStateRef.current = { cursor: result.cursor, draft: result.draft }
    historyAppliedInputRef.current = result.value
    setInput(result.value)
    onHistoryInput?.(result.value)
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      const cursor = result.value.length
      textarea.focus()
      textarea.setSelectionRange(cursor, cursor)
    })
    return true
  }, [historyItems, input, onHistoryInput, setInput])

  return {
    textareaRef,
    focused,
    focusComposer,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onCompositionStart: () => {
      composingRef.current = true
    },
    onCompositionEnd: () => {
      composingRef.current = false
    },
    isComposingEvent: (event) =>
      event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229,
    navigateHistory,
    resetHistoryNavigation
  }
}
