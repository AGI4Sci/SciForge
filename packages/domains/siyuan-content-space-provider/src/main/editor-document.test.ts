import { Window } from 'happy-dom'
import { expect, it } from 'vitest'
import { currentEditorDocument } from './editor-document.js'

it('selects the visible document in the active pane, never hidden tabs or popup previews', () => {
  const window = new Window()
  const document = window.document
  document.body.innerHTML = `<div class="layout__center">
    <div class="layout__wnd--active">
      <div class="protyle fn__none"><div class="protyle-background" data-node-id="20261108120000-hiddenx"></div></div>
      <div class="protyle"><div class="protyle-background" data-node-id="20261108120000-current"></div></div>
    </div>
    <div class="protyle"><div class="protyle-background" data-node-id="20261108120000-otherxx"></div></div>
  </div><div class="protyle"><div class="protyle-background" data-node-id="20261108120000-popupxx"></div></div>`
  for (const element of document.querySelectorAll('.protyle')) {
    element.getClientRects = () => [{ width: 400, height: 600 }] as never
  }
  const read = () => currentEditorDocument(document as unknown as Document)
  expect(read()).toBe('20261108120000-current')
  document.querySelector('.layout__wnd--active')!.className = ''
  expect(read()).toBeNull()
  document.querySelector('.layout__center')!.setAttribute('hidden', '')
  expect(read()).toBeNull()
  window.happyDOM.abort()
})
