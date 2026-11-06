import { useEffect, useRef, type RefObject } from 'react'
import './preview-line-numbers.css'

/** Mirror wrapping so logical source lines stay aligned with a native textarea. */
export function TextareaLineGutter({ editorRef, value }: {
  editorRef: RefObject<HTMLTextAreaElement | null>
  value: string
}) {
  const gutterRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const editor = editorRef.current
    const gutter = gutterRef.current
    if (!editor || !gutter) return
    const doc = editor.ownerDocument
    const mirror = doc.createElement('div')
    mirror.setAttribute('aria-hidden', 'true')
    Object.assign(mirror.style, {
      position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
      whiteSpace: 'pre-wrap', overflowWrap: 'break-word', top: '0', left: '0'
    })
    editor.parentElement?.append(mirror)
    const syncScroll = () => { gutter.style.transform = `translateY(${-editor.scrollTop}px)` }
    const measure = () => {
      const style = getComputedStyle(editor)
      mirror.style.font = style.font
      mirror.style.lineHeight = style.lineHeight
      mirror.style.letterSpacing = style.letterSpacing
      mirror.style.tabSize = style.tabSize
      mirror.style.width = `${Math.max(0, editor.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))}px`
      const lines = value.split(/\r\n|\r|\n/u)
      mirror.replaceChildren(...lines.map((line) => {
        const row = doc.createElement('div')
        row.textContent = line || '\u200b'
        return row
      }))
      gutter.style.paddingTop = `${parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth)}px`
      gutter.replaceChildren(...Array.from(mirror.children).map((row, index) => {
        const number = doc.createElement('div')
        number.dataset.previewLineNumber = String(index + 1)
        number.style.position = 'relative'
        number.style.height = `${row.getBoundingClientRect().height || parseFloat(style.lineHeight) || 20}px`
        return number
      }))
      syncScroll()
    }
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(editor)
    editor.addEventListener('scroll', syncScroll)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      editor.removeEventListener('scroll', syncScroll)
      mirror.remove()
    }
  }, [editorRef, value])
  return <div aria-hidden="true" className="preview-line-gutter relative w-12 shrink-0 overflow-hidden pr-2">
    <div ref={gutterRef} />
  </div>
}
