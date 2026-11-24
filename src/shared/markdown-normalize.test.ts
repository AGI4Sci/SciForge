import { describe, expect, it } from 'vitest'
import {
  normalizeChatMarkdown,
  normalizeMarkdownDisplayMathInLists
} from './markdown-normalize'

describe('normalizeMarkdownDisplayMathInLists', () => {
  it('keeps display math inside its list item when the continuation lines are indented', () => {
    expect(normalizeMarkdownDisplayMathInLists('- $$\\frac{a}{b}$$\n- next item')).toBe(
      '- $$\n  \\frac{a}{b}\n  $$\n- next item'
    )
  })

  it('aligns numbered list continuations with the marker width', () => {
    expect(normalizeMarkdownDisplayMathInLists('1. $$x^2$$\n2. next')).toBe(
      '1. $$\n   x^2\n   $$\n2. next'
    )
  })

  it('leaves fenced code and inline math untouched', () => {
    const markdown = '```md\n- $$not math$$\n```\n\n- inline $x$ stays'
    expect(normalizeMarkdownDisplayMathInLists(markdown)).toBe(markdown)
  })
})

describe('normalizeChatMarkdown', () => {
  it('keeps a table after a display-math list item attached to the list', () => {
    const normalized = normalizeChatMarkdown([
      '- $$E = mc^2$$',
      '- second item',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |'
    ].join('\n'))

    expect(normalized).toContain('- $$\n  E = mc^2\n  $$')
    expect(normalized).toContain('- second item')
    expect(normalized).toContain('| a | b |')
  })

  it('normalizes link destinations that contain spaces', () => {
    expect(normalizeChatMarkdown('[paper](papers/my paper.pdf)')).toBe(
      '[paper](<papers/my paper.pdf>)'
    )
  })
})
