import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PageFloatingBounds } from '../components/workbench-page-layout'

/** Adopt the same portal container across documents: moving never remounts the page. */
export function WorkbenchPageSurface({ id, title, external, hidden, focusKey, style, bounds, onReturn, onBounds, onError, children }: {
  id: string
  title: string
  external: boolean
  hidden?: boolean
  focusKey?: object
  style?: CSSProperties
  bounds?: PageFloatingBounds
  onReturn: () => void
  onBounds: (bounds: PageFloatingBounds) => void
  onError: () => void
  children: (ownerDocument: Document) => ReactNode
}): ReactElement {
  const placeholder = useRef<HTMLDivElement>(null)
  const auxiliary = useRef<Window | null>(null)
  const [ownerDocument, setOwnerDocument] = useState(document)
  const [container] = useState(() => {
    const element = document.createElement('div')
    element.className = 'workbench-page-surface'
    return element
  })
  const callbacks = useRef({ onReturn, onBounds, onError })
  useLayoutEffect(() => { callbacks.current = { onReturn, onBounds, onError } })
  const initialBounds = useRef(bounds)
  useLayoutEffect(() => { initialBounds.current = bounds }, [bounds])
  const label = useRef(title)
  useLayoutEffect(() => {
    label.current = title
    if (auxiliary.current && !auxiliary.current.closed) auxiliary.current.document.title = `${title} — SciForge`
  }, [title])
  useLayoutEffect(() => {
    const slot = placeholder.current!
    if (!external) { slot.append(container); setOwnerDocument(slot.ownerDocument); return }
    const rect = initialBounds.current
    const popup = window.open('about:blank', `sciforge-workbench:${id}`,
      `popup=yes,width=${rect?.width ?? 760},height=${rect?.height ?? 600},left=${rect?.x ?? window.screenX + 80},top=${rect?.y ?? window.screenY + 80}`)
    if (!popup) { slot.append(container); callbacks.current.onError(); callbacks.current.onReturn(); return }
    auxiliary.current = popup
    const doc = popup.document
    doc.title = `${label.current} — SciForge`
    doc.documentElement.lang = document.documentElement.lang
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]')
    if (csp) doc.head.append(csp.cloneNode(true))
    const styles = new Map<Element, Element>()
    const syncStyles = () => {
      const sources = new Set(document.querySelectorAll('link[rel="stylesheet"], style'))
      for (const [source, copy] of styles) if (!sources.has(source)) { copy.remove(); styles.delete(source) }
      for (const source of sources) {
        let copy = styles.get(source)
        if (!copy) { copy = source.cloneNode(true) as Element; styles.set(source, copy); doc.head.append(copy) }
        if (source.tagName === 'LINK') copy.setAttribute('href', (source as HTMLLinkElement).href)
        else if (copy.textContent !== source.textContent) copy.textContent = source.textContent
        for (const attribute of ['media', 'disabled']) {
          if (source.hasAttribute(attribute)) copy.setAttribute(attribute, source.getAttribute(attribute)!)
          else copy.removeAttribute(attribute)
        }
      }
    }
    syncStyles()
    const stylesheetChanges = new MutationObserver(syncStyles)
    stylesheetChanges.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['href', 'media', 'disabled'] })
    const syncTheme = () => {
      for (const [source, target] of [[document.documentElement, doc.documentElement], [document.body, doc.body]]) {
        for (const attribute of Array.from(target.attributes)) {
          if ((attribute.name === 'class' || attribute.name === 'style' || attribute.name.startsWith('data-')) && !source.hasAttribute(attribute.name)) target.removeAttribute(attribute.name)
        }
        for (const attribute of Array.from(source.attributes)) {
          if (attribute.name === 'class' || attribute.name === 'style' || attribute.name.startsWith('data-')) target.setAttribute(attribute.name, attribute.value)
        }
      }
      doc.body.classList.add('workbench-page-window')
    }
    syncTheme()
    const theme = new MutationObserver(syncTheme)
    theme.observe(document.documentElement, { attributes: true })
    theme.observe(document.body, { attributes: true })
    doc.body.append(container)
    setOwnerDocument(doc)
    let returning = false
    const returnToOwner = () => {
      if (returning) return
      returning = true
      // Adopt before Chromium destroys the auxiliary document.
      slot.append(container)
      setOwnerDocument(slot.ownerDocument)
      callbacks.current.onReturn()
      window.dispatchEvent(new Event('resize'))
    }
    popup.addEventListener('beforeunload', returnToOwner)
    const saveBounds = () => {
      if (popup.closed) { returnToOwner(); return }
      const next = { x: popup.screenX, y: popup.screenY, width: popup.outerWidth, height: popup.outerHeight }
      const before = initialBounds.current
      if (!before || (['x', 'y', 'width', 'height'] as const).some(key => next[key] !== before[key])) {
        initialBounds.current = next
        callbacks.current.onBounds(next)
      }
    }
    const timer = window.setInterval(saveBounds, 600)
    popup.focus()
    window.dispatchEvent(new Event('resize'))
    return () => {
      returning = true
      clearInterval(timer)
      theme.disconnect()
      stylesheetChanges.disconnect()
      if (!popup.closed) popup.removeEventListener('beforeunload', returnToOwner)
      slot.append(container)
      if (!popup.closed) popup.close()
      auxiliary.current = null
      window.dispatchEvent(new Event('resize'))
    }
  }, [container, external, id])
  useLayoutEffect(() => {
    if (external && auxiliary.current && !auxiliary.current.closed) auxiliary.current.focus()
  }, [external, focusKey])
  return <><div ref={placeholder} className="workbench-page-surface-slot" style={style} hidden={external || hidden} />{createPortal(children(ownerDocument), container)}</>
}
