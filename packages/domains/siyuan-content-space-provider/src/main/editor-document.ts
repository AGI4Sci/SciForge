/** Only identify the visible editor here; document content is read by the
 * authenticated structured API. Never fall back to recent files or history. */
export function currentEditorDocument(document: Document): string | null {
  const visible = (element: Element): boolean => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (node.classList.contains('fn__none') || node.hasAttribute('hidden') ||
          node.getAttribute('aria-hidden') === 'true') return false
    }
    return element.getClientRects().length > 0
  }
  const editors = Array.from(document.querySelectorAll('.layout__center .protyle')).filter(visible)
  const focused = editors.filter(editor => editor.closest('.layout__wnd--active'))
  const candidates = focused.length ? focused : editors
  // Split panes without an active pane are ambiguous: do not pick arbitrarily.
  if (candidates.length !== 1) return null
  const id = candidates[0].querySelector('.protyle-background[data-node-id]')?.getAttribute('data-node-id')
  return id && /^\d{14}-[a-z0-9]{7}$/u.test(id) ? id : null
}

export const CURRENT_EDITOR_DOCUMENT_SCRIPT = `(${currentEditorDocument.toString()})(document)`
