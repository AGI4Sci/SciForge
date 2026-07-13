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

    el.style.height = '0px'
    const nextHeight = Math.min(el.scrollHeight, 176)
    const minHeight = 36
    el.style.height = `${Math.max(nextHeight, minHeight)}px`
    el.style.overflowY = el.scrollHeight > 176 ? 'auto' : 'hidden'
  }, [])

  useLayoutEffect(() => {
    resizeTextarea()
  }, [canCompose, input, resizeTextarea])

  useEffect(() => {
    const el = textareaRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    let frame = 0
    let previousWidth = el.getBoundingClientRect().width
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry?.contentRect.width ?? el.getBoundingClientRect().width
      if (Math.abs(nextWidth - previousWidth) < 0.5) return
      previousWidth = nextWidth
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(resizeTextarea)
    })

    observer.observe(el)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [resizeTextarea])

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
