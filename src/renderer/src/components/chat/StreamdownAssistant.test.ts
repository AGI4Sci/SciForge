import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  STREAMDOWN_CONTROLS,
  StreamdownAssistant,
  shouldAnimateStreamingText
} from './StreamdownAssistant'

describe('STREAMDOWN_CONTROLS', () => {
  it('keeps final-answer tables static in chat rendering', () => {
    expect(STREAMDOWN_CONTROLS).toEqual({ table: false })
  })
})

describe('shouldAnimateStreamingText', () => {
  it('keeps the lightweight reveal for short single-line text', () => {
    expect(shouldAnimateStreamingText('正在检查配置。')).toBe(true)
    expect(shouldAnimateStreamingText('Checking the CSS variables.')).toBe(true)
  })

  it('lets multiline streaming render from the actual SSE sequence', () => {
    expect(shouldAnimateStreamingText('First line\nSecond line')).toBe(false)
    expect(shouldAnimateStreamingText('First paragraph\n\nSecond paragraph')).toBe(false)
  })

  it('does not animate structured markdown while it is still streaming', () => {
    expect(shouldAnimateStreamingText('- one\n- two')).toBe(false)
    expect(shouldAnimateStreamingText('Use `npm test` next.')).toBe(false)
  })

  it('does not animate markdown image syntax while streaming', () => {
    expect(shouldAnimateStreamingText('![plot](plot.png)')).toBe(false)
    expect(shouldAnimateStreamingText('![plot](data:image/png;base64,abc)')).toBe(false)
  })
})

describe('StreamdownAssistant link rendering', () => {
  it('preserves complete external links without blocked placeholders', () => {
    const html = renderToStaticMarkup(createElement(StreamdownAssistant, {
      text: '[Agent-R1](https://github.com/AgentR1/Agent-R1) / [paper](https://arxiv.org/abs/2604.22558)',
      streaming: false
    }))

    expect(html).toContain('href="https://github.com/AgentR1/Agent-R1"')
    expect(html).toContain('href="https://arxiv.org/abs/2604.22558"')
    expect(html).not.toContain('[blocked]')
    expect(html).not.toContain('Blocked URL:')
  })
})

describe('StreamdownAssistant math rendering', () => {
  it('renders inline and display dollar-delimited math with KaTeX', () => {
    const html = renderToStaticMarkup(createElement(StreamdownAssistant, {
      text: 'Inline $x^2$ and display:\n\n$$\\mathcal{L}_{\\text{SDL}} = e^{-\\ell} - 1 + \\ell$$',
      streaming: false
    }))

    expect(html).toContain('class="katex"')
    expect(html).toContain('class="katex-display"')
    expect(html).not.toContain('$$')
  })

  it('normalizes bracket-style math delimiters used by model responses', () => {
    const html = renderToStaticMarkup(createElement(StreamdownAssistant, {
      text: 'Inline \\(a+b\\) and display:\n\n\\[c=d\\]',
      streaming: false
    }))

    expect(html.match(/class="katex"/g)).toHaveLength(2)
    expect(html).toContain('class="katex-display"')
    expect(html).not.toContain('\\(a+b\\)')
    expect(html).not.toContain('\\[c=d\\]')
  })
})
