// @vitest-environment happy-dom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WriteMarkdownPreview } from './WriteMarkdownPreview'
import { TextareaLineGutter } from './TextareaLineGutter'
import { WritePdfPageFrame } from './WritePdfPageFrame'

describe('preview location gutters', () => {
  it('keeps Markdown source locations after math expansion without adding text to annotations', () => {
    const content = '# Heading\n\n$$x^2$$\n\nAfter\n\n| A |\n|---|\n| B |'
    const root = document.createElement('div')
    root.innerHTML = renderToStaticMarkup(<WriteMarkdownPreview content={content} isMarkdown showLineNumbers />)
    expect(Array.from(root.querySelectorAll('[data-preview-line-number]'), (el) => el.getAttribute('data-preview-line-number'))).toEqual(['1', '3', '5', '7'])
    expect(root.querySelector('[data-preview-line-number="5"]')?.textContent).toBe('After')
    expect(root.querySelector('[data-preview-line-number="7"] table')).not.toBeNull()
  })

  it('numbers blank and trailing source lines and follows textarea scroll', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const editorRef = createRef<HTMLTextAreaElement>()
    const render = (value: string) => <div><TextareaLineGutter editorRef={editorRef} value={value} /><textarea ref={editorRef} value={value} readOnly style={{ lineHeight: '20px', padding: '12px', border: '1px solid' }} /></div>
    try {
      await act(async () => root.render(render('a\n\nlong line\n')))
      const numbers = () => Array.from(host.querySelectorAll('[data-preview-line-number]'), (el) => el.getAttribute('data-preview-line-number'))
      expect(numbers()).toEqual(['1', '2', '3', '4'])
      editorRef.current!.scrollTop = 40
      editorRef.current!.dispatchEvent(new Event('scroll'))
      expect(host.querySelector<HTMLElement>('.preview-line-gutter > div')!.style.transform).toBe('translateY(-40px)')
      expect(host.querySelector('.preview-line-gutter')!.textContent).toBe('')
      await act(async () => root.render(render('short')))
      expect(numbers()).toEqual(['1'])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('labels PDF rows with page and line while preserving page geometry and text', () => {
    const root = document.createElement('div')
    root.innerHTML = renderToStaticMarkup(<WritePdfPageFrame pageNumber={3} rendered pageSize={{ width: 600, height: 800 }} lineNumbers={[20, 40]}><div>Page text</div></WritePdfPageFrame>)
    expect(Array.from(root.querySelectorAll('[data-preview-line-number]'), (el) => el.getAttribute('data-preview-line-number'))).toEqual(['3:1', '3:2'])
    expect(root.querySelector<HTMLElement>('[data-write-pdf-page]')!.style.width).toBe('600px')
    expect(root.textContent).toBe('Page text')
  })
})
