import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StreamdownCode } from './StreamdownCode'

describe('StreamdownCode plain text fences', () => {
  it('renders text fenced blocks without code block chrome', () => {
    const html = renderToStaticMarkup(
      createElement(
        StreamdownCode,
        { className: 'language-text', 'data-block': true },
        'refactor(chat): simplify composer\n\n- Keep only Stop\n'
      )
    )

    expect(html).toContain('ds-plain-text-block')
    expect(html).toContain('refactor(chat): simplify composer')
    expect(html).toContain('- Keep only Stop')
    expect(html).not.toContain('ds-code-block-header')
    expect(html).not.toContain('Download code')
    expect(html).not.toContain('Copy code')
  })

  it('hides empty plain text fenced blocks', () => {
    const html = renderToStaticMarkup(
      createElement(
        StreamdownCode,
        { className: 'language-text', 'data-block': true },
        '\n'
      )
    )

    expect(html).toBe('')
  })
})

describe('StreamdownCode fenced blocks without a usable language', () => {
  it('renders an unlabeled fence with code block chrome and a copy button', () => {
    const html = renderToStaticMarkup(
      createElement(
        StreamdownCode,
        { 'data-block': true },
        'const answer = 42\n'
      )
    )

    expect(html).toContain('ds-code-block')
    expect(html).toContain('ds-code-block-header')
    expect(html).toContain('Copy code')
    expect(html).toContain('const answer = 42')
  })

  it('maps an unsafe fence language to the text default', () => {
    const html = renderToStaticMarkup(
      createElement(
        StreamdownCode,
        { className: 'language-foo"bar', 'data-block': true },
        'plain output\n'
      )
    )

    expect(html).toContain('ds-code-block-header')
    expect(html).toContain('Copy code')
    expect(html).toContain('data-language="text"')
  })
})
