import { describe, expect, it } from 'vitest'
import { normalizeMarkdownMathDelimiters } from './write-markdown-math'

describe('normalizeMarkdownMathDelimiters', () => {
  it('expands a single-line display formula into a remark-math block', () => {
    expect(normalizeMarkdownMathDelimiters('Before\n\n$$x^2 + y^2$$\n\nAfter')).toBe(
      'Before\n\n$$\nx^2 + y^2\n$$\n\nAfter'
    )
  })

  it('normalizes bracket delimiters without changing fenced code', () => {
    expect(normalizeMarkdownMathDelimiters('\\(a+b\\)\n\n\\[c=d\\]\n\n```md\n$$raw$$\n```')).toBe(
      '$a+b$\n\n$$\nc=d\n$$\n\n```md\n$$raw$$\n```'
    )
  })
})
