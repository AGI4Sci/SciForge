import { describe, expect, it } from 'vitest'
import {
  WRITE_RICH_MAX_CHARS,
  auditWriteMarkdownFidelity,
  parseWriteMarkdown,
  serializeWriteMarkdown,
  serializeWriteMarkdownIfSafe
} from './markdown-manager'

const BASIC_DOC = [
  '# Draft',
  '',
  'A paragraph with **bold**, *italic*, `code`, and [a link](https://example.com).',
  '',
  '- item one',
  '- item two',
  '',
  '- [ ] todo',
  '- [x] done',
  '',
  '| Field | Value |',
  '| --- | --- |',
  '| id | 1 |',
  '',
  '```ts',
  'const value = 1',
  '```',
  '',
  '![Diagram](images/diagram.png)',
  ''
].join('\n')

describe('write rich markdown manager', () => {
  it('round-trips basic markdown through a stable normalized form', () => {
    const firstPass = serializeWriteMarkdown(parseWriteMarkdown(BASIC_DOC))
    const secondPass = serializeWriteMarkdown(parseWriteMarkdown(firstPass))

    expect(secondPass).toBe(firstPass)
    expect(firstPass).toContain('- [ ] todo')
    expect(firstPass).toContain('- [x] done')
    expect(firstPass).toContain('| Field')
    expect(firstPass).toContain('![Diagram](images/diagram.png)')
  })

  it('accepts simple markdown and reports whether normalization was exact', () => {
    const fidelity = auditWriteMarkdownFidelity(BASIC_DOC)

    expect(fidelity.eligible).toBe(true)
    if (fidelity.eligible) {
      expect(fidelity.normalized).toContain('# Draft')
      expect(typeof fidelity.exact).toBe('boolean')
    }
  })

  it('round-trips inline and block math through rich markdown', () => {
    const doc = [
      '# Math',
      '',
      'Inline $E = mc^2$ formula.',
      '',
      '$$',
      'a^2 + b^2 = c^2',
      '$$',
      ''
    ].join('\n')
    const firstPass = serializeWriteMarkdown(parseWriteMarkdown(doc))
    const secondPass = serializeWriteMarkdown(parseWriteMarkdown(firstPass))

    expect(secondPass).toBe(firstPass)
    expect(firstPass).toContain('$E = mc^2$')
    expect(firstPass).toContain('a^2 + b^2 = c^2')
  })

  it('rejects unstable markdown instead of allowing rich write-back', () => {
    const doc = [
      '1. Add protocol fields in `src/contracts/`.',
      '2. Add behavior in `src/loop/`, or a',
      '   new adapter under `src/ports/`.',
      ''
    ].join('\n')

    expect(auditWriteMarkdownFidelity(doc)).toMatchObject({
      eligible: false,
      reason: 'unstable'
    })
  })

  it('rejects raw html blocks that mutate across passes', () => {
    const doc = [
      '<a href="https://github.com/x/y">',
      '  <img src="https://contrib.rocks/image?repo=x/y" />',
      '</a>',
      ''
    ].join('\n')

    expect(auditWriteMarkdownFidelity(doc).eligible).toBe(false)
  })

  it('rejects documents above the rich-mode size limit', () => {
    expect(auditWriteMarkdownFidelity('a'.repeat(WRITE_RICH_MAX_CHARS + 1))).toMatchObject({
      eligible: false,
      reason: 'too-large'
    })
  })

  it('does not serialize unchanged documents', () => {
    const doc = parseWriteMarkdown(BASIC_DOC)
    const result = serializeWriteMarkdownIfSafe({
      doc,
      sourceMarkdown: BASIC_DOC,
      fidelity: auditWriteMarkdownFidelity(BASIC_DOC),
      edited: false
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'unchanged',
      fallbackMarkdown: BASIC_DOC
    })
  })
})
