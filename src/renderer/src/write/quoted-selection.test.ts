import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  resolveWriteMarkdownResource,
  resolveWriteMarkdownResourcePath,
  WriteMarkdownPreview
} from '../components/write/WriteMarkdownPreview'
import {
  WRITE_QUOTE_ORIGINAL_END,
  WRITE_QUOTE_ORIGINAL_START,
  WRITE_QUOTE_METADATA_PREFIX,
  WRITE_RETRIEVAL_END,
  composeWritePrompt,
  formatWriteQuotedSelectionForPrompt,
  formatWriteRetrievalContextForPrompt,
  parseWritePromptForDisplay,
  quotedSelectionFromEditor
} from './quoted-selection'

describe('write quoted selections', () => {
  it('formats selected text with file and line context', () => {
    const quote = {
      id: 'quote-1',
      text: 'Selected paragraph',
      sourceKind: 'text' as const,
      sourceTitle: 'notes/draft.md',
      sourceFilePath: '/tmp/workspace/notes/draft.md',
      lineStart: 3,
      lineEnd: 5,
      charCount: 18,
      createdAt: '2026-05-24T00:00:00.000Z'
    }

    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain('第3-5行')
    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain(WRITE_QUOTE_ORIGINAL_START)
    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain(WRITE_QUOTE_ORIGINAL_END)
  })

  it('formats and parses PDF selected text with page context', () => {
    const quote = {
      id: 'quote-pdf-1',
      text: 'Important PDF passage',
      sourceKind: 'pdf' as const,
      sourceTitle: 'papers/study.pdf',
      sourceFilePath: '/tmp/workspace/papers/study.pdf',
      pageStart: 2,
      pageEnd: 4,
      rects: [{ page: 2, x: 10.5, y: 20, width: 120, height: 14 }],
      pdfAnchorId: 'anchor-pdf-1',
      pdfAnnotationThreadId: 'thread-pdf-1',
      pdfAnnotationKind: 'highlight' as const,
      charCount: 21,
      createdAt: '2026-05-24T00:00:00.000Z'
    }

    const prompt = composeWritePrompt('总结这段', [quote])

    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain('第2-4页')
    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain('位置: p.2 x=10.5 y=20 w=120 h=14')
    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain(
      `${WRITE_QUOTE_METADATA_PREFIX} {"pdfAnchorId":"anchor-pdf-1","pdfAnnotationThreadId":"thread-pdf-1","pdfAnnotationKind":"highlight"}`
    )
    const parsed = parseWritePromptForDisplay(prompt)
    expect(parsed?.quotes[0]).toMatchObject({
      sourceKind: 'pdf',
      sourceTitle: 'papers/study.pdf',
      sourceFilePath: '/tmp/workspace/papers/study.pdf',
      pageStart: 2,
      pageEnd: 4,
      position: 'p.2 x=10.5 y=20 w=120 h=14',
      pdfAnchorId: 'anchor-pdf-1',
      pdfAnnotationThreadId: 'thread-pdf-1',
      pdfAnnotationKind: 'highlight',
      charCount: 21,
      text: 'Important PDF passage'
    })
  })

  it('parses legacy PDF selected text without metadata', () => {
    const prompt = [
      '[引用片段] papers/study.pdf（第2页，共18字）路径: /tmp/workspace/papers/study.pdf',
      WRITE_QUOTE_ORIGINAL_START,
      'Legacy PDF passage',
      WRITE_QUOTE_ORIGINAL_END,
      '',
      '继续写'
    ].join('\n')

    const parsed = parseWritePromptForDisplay(prompt)

    expect(parsed?.quotes[0]).toMatchObject({
      sourceKind: 'pdf',
      sourceTitle: 'papers/study.pdf',
      sourceFilePath: '/tmp/workspace/papers/study.pdf',
      pageStart: 2,
      pageEnd: 2,
      charCount: 18,
      text: 'Legacy PDF passage'
    })
    expect(parsed?.quotes[0]?.pdfAnchorId).toBeUndefined()
    expect(parsed?.quotes[0]?.pdfAnnotationThreadId).toBeUndefined()
    expect(parsed?.quotes[0]?.pdfAnnotationKind).toBeUndefined()
    expect(parsed?.userInput).toBe('继续写')
  })

  it('keeps multiple PDF annotation references in one composed question', () => {
    const prompt = composeWritePrompt('比较这两个选区的观点', [
      {
        id: 'quote-pdf-a',
        text: 'First PDF claim',
        sourceKind: 'pdf',
        sourceTitle: 'papers/study.pdf',
        sourceFilePath: '/tmp/workspace/papers/study.pdf',
        pageStart: 2,
        pageEnd: 2,
        rects: [{ page: 2, x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
        pdfAnchorId: 'anchor-a',
        pdfAnnotationThreadId: 'thread-a',
        pdfAnnotationKind: 'question',
        charCount: 15,
        createdAt: '2026-05-24T00:00:00.000Z'
      },
      {
        id: 'quote-pdf-b',
        text: 'Second PDF claim',
        sourceKind: 'pdf',
        sourceTitle: 'papers/study.pdf',
        sourceFilePath: '/tmp/workspace/papers/study.pdf',
        pageStart: 5,
        pageEnd: 6,
        rects: [{ page: 5, x: 0.2, y: 0.3, width: 0.25, height: 0.05 }],
        pdfAnchorId: 'anchor-b',
        pdfAnnotationThreadId: 'thread-b',
        pdfAnnotationKind: 'comment',
        charCount: 16,
        createdAt: '2026-05-24T00:00:00.000Z'
      }
    ])

    const parsed = parseWritePromptForDisplay(prompt)

    expect(parsed?.userInput).toBe('比较这两个选区的观点')
    expect(parsed?.quotes.map((quote) => quote.pdfAnnotationThreadId)).toEqual(['thread-a', 'thread-b'])
    expect(parsed?.quotes.map((quote) => quote.pdfAnchorId)).toEqual(['anchor-a', 'anchor-b'])
    expect(parsed?.quotes.map((quote) => quote.sourceKind)).toEqual(['pdf', 'pdf'])
  })

  it('creates PDF quotes from page-aware selections and preserves annotation metadata', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2)
    const quote = quotedSelectionFromEditor({
      text: 'PDF passage',
      ranges: [{
        from: 0,
        to: 11,
        startLine: 2,
        startColumn: 1,
        endLine: 3,
        endColumn: 12,
        text: 'PDF passage',
        charCount: 11,
        page: 2
      }],
      sourceKind: 'pdf',
      pageStart: 2,
      pageEnd: 3,
      rects: [{ page: 2, x: 10, y: 20, width: 30, height: 12 }],
      pdfAnchorId: ' anchor-selection-1 ',
      pdfAnnotationThreadId: ' thread-selection-1 ',
      pdfAnnotationKind: 'comment',
      charCount: 11
    }, '/tmp/workspace/papers/study.pdf', '/tmp/workspace', Date.parse('2026-05-24T00:00:00.000Z'))

    expect(quote).toMatchObject({
      sourceKind: 'pdf',
      sourceTitle: 'papers/study.pdf',
      pageStart: 2,
      pageEnd: 3,
      rects: [{ page: 2, x: 10, y: 20, width: 30, height: 12 }],
      pdfAnchorId: 'anchor-selection-1',
      pdfAnnotationThreadId: 'thread-selection-1',
      pdfAnnotationKind: 'comment'
    })
    vi.restoreAllMocks()
  })

  it('derives PDF page context from rect metadata when page fields are missing', () => {
    const quote = {
      id: 'quote-pdf-rect-only',
      text: 'Rect only passage',
      sourceKind: 'pdf' as const,
      sourceTitle: 'paper.pdf',
      sourceFilePath: '/tmp/workspace/paper.pdf',
      rects: [
        { page: 8, x: 10, y: 20, width: 30, height: 12 },
        { page: 7, x: 12, y: 40, width: 28, height: 10 }
      ],
      charCount: 17,
      createdAt: '2026-05-24T00:00:00.000Z'
    }

    const prompt = formatWriteQuotedSelectionForPrompt(quote)

    expect(prompt).toContain('第7-8页')
    expect(prompt).toContain('等2处')
  })

  it('ignores invalid PDF rect metadata without dropping the quote', () => {
    const quote = quotedSelectionFromEditor({
      text: 'PDF passage',
      ranges: [{
        from: 0,
        to: 11,
        startLine: 5,
        startColumn: 1,
        endLine: 5,
        endColumn: 12,
        text: 'PDF passage',
        charCount: 11,
        page: 5
      }],
      sourceKind: 'pdf',
      pageStart: 6,
      pageEnd: 5,
      rects: [
        { page: 5, x: 10, y: 20, width: 0, height: 12 },
        { page: 5, x: Number.NaN, y: 20, width: 30, height: 12 }
      ],
      charCount: 11
    }, '/tmp/workspace/papers/study.pdf', '/tmp/workspace', Date.parse('2026-05-24T00:00:00.000Z'))

    expect(quote).toMatchObject({
      sourceKind: 'pdf',
      pageStart: 5,
      pageEnd: 6
    })
    expect(quote?.rects).toBeUndefined()
  })

  it('does not create a quote for empty selections', () => {
    expect(quotedSelectionFromEditor({
      text: '   ',
      ranges: [],
      charCount: 0
    }, '/tmp/workspace/notes.md', '/tmp/workspace')).toBeNull()
  })

  it('composes prompt with committed quote context first', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    const quote = quotedSelectionFromEditor({
      text: 'A useful quote',
      ranges: [{
        from: 0,
        to: 14,
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 14,
        text: 'A useful quote',
        charCount: 14
      }],
      charCount: 14
    }, '/tmp/workspace/a.md', '/tmp/workspace', Date.parse('2026-05-24T00:00:00.000Z'))

    expect(quote).not.toBeNull()
    const prompt = composeWritePrompt('Please revise it.', quote ? [quote] : [])
    expect(prompt.startsWith('[写作上下文]')).toBe(true)
    expect(prompt).toContain('不要调用 request_user_input')
    expect(prompt).toContain('不要为了读取、确认或补全当前写作文件而调用 shell')
    expect(prompt.indexOf('[引用片段] a.md')).toBeGreaterThan(prompt.indexOf('[写作上下文]'))
    expect(prompt.endsWith('Please revise it.')).toBe(true)
    vi.restoreAllMocks()
  })

  it('composes the active write file as a readable reference without workspace_file wrapping', () => {
    const prompt = composeWritePrompt('请评价这个提纲', [], {
      workspaceRoot: '/tmp/workspace',
      activeFilePath: '/tmp/workspace/notes/science reasoning.md'
    })

    expect(prompt).toContain('当前文件: notes/science reasoning.md')
    expect(prompt).not.toContain('当前文件引用:')
    expect(prompt).not.toContain('当前文件绝对路径:')
    expect(prompt).not.toContain('workspace_file')
    expect(prompt.endsWith('请评价这个提纲')).toBe(true)
  })

  it('parses write prompt metadata for compact timeline display', () => {
    const prompt = composeWritePrompt(
      '帮我改成中文',
      [{
        id: 'quote-1',
        text: "Hi, I'm zxy. Glad to meet you.",
        sourceKind: 'text',
        sourceTitle: 'welcome.md',
        sourceFilePath: '/tmp/workspace/welcome.md',
        lineStart: 10,
        lineEnd: 10,
        charCount: 31,
        createdAt: '2026-05-24T00:00:00.000Z'
      }],
      {
        workspaceRoot: '/tmp/workspace',
        activeFilePath: '/tmp/workspace/welcome.md'
      }
    )

    const parsed = parseWritePromptForDisplay(prompt)

    expect(parsed?.userInput).toBe('帮我改成中文')
    expect(parsed?.context?.workspaceRoot).toBe('/tmp/workspace')
    expect(parsed?.context?.activeFile).toBe('welcome.md')
    expect(parsed?.context?.lines.some((line) => line.includes('不要调用 request_user_input'))).toBe(true)
    expect(parsed?.context?.lines.some((line) => line.includes('不要为了读取、确认或补全当前写作文件'))).toBe(true)
    expect(parsed?.context?.lines.some((line) => line.includes('当前文件引用:'))).toBe(false)
    expect(parsed?.context?.lines.some((line) => line.includes('当前文件绝对路径:'))).toBe(false)
    expect(parsed?.userInput).toBe('帮我改成中文')
    expect(parsed?.quotes).toHaveLength(1)
    expect(parsed?.quotes[0]).toMatchObject({
      sourceTitle: 'welcome.md',
      sourceFilePath: '/tmp/workspace/welcome.md',
      lineStart: 10,
      lineEnd: 10,
      charCount: 31,
      text: "Hi, I'm zxy. Glad to meet you."
    })
  })

  it('adds retrieval snippets with PDF page locations to assistant prompts', () => {
    const prompt = composeWritePrompt(
      '解释这段论文',
      [],
      {
        workspaceRoot: '/tmp/workspace',
        activeFilePath: '/tmp/workspace/papers/study.pdf',
        retrieval: {
          source: 'bm25-keyword',
          query: 'retrieval quality',
          keywords: ['retrieval', 'quality'],
          indexedFiles: 2,
          indexedChunks: 4,
          snippets: [{
            path: 'papers/study.pdf',
            title: 'Page 3',
            text: 'The method improves retrieval quality with focused context.',
            score: 1.25,
            keywords: ['retrieval', 'quality'],
            location: {
              kind: 'pdf',
              pageStart: 3,
              pageEnd: 3
            },
            pageStart: 3,
            pageEnd: 3
          }]
        }
      }
    )

    expect(prompt).toContain('[相关文献上下文]')
    expect(prompt).toContain('papers/study.pdf 第3页')
    expect(prompt).toContain('The method improves retrieval quality')
    expect(prompt).toContain(WRITE_RETRIEVAL_END)
    expect(formatWriteRetrievalContextForPrompt(null)).toBe('')
  })

  it('collapses retrieval context out of the displayed user input', () => {
    const prompt = composeWritePrompt(
      '帮我看看这篇文章讲什么内容\n\n再总结三条要点',
      [],
      {
        workspaceRoot: '/tmp/workspace',
        activeFilePath: '/tmp/workspace/papers/study.pdf',
        retrieval: {
          source: 'bm25-keyword',
          query: 'feature development',
          keywords: ['feature', 'development'],
          indexedFiles: 2,
          indexedChunks: 4,
          snippets: [
            {
              path: 'notes/code-graph.md',
              title: '节点内容的处理',
              text: '每个节点都保留了原始的代码内容和行号范围。\n\n<p align="center">\n  <img src="./pic/1.png" alt="代码图构建" width="800">\n</p>',
              score: 2.5,
              keywords: ['内容'],
              location: { kind: 'text', lineStart: 12, lineEnd: 30 }
            },
            {
              path: 'papers/study.pdf',
              title: '',
              text: 'SWE-Dev provides runnable environments with developer-authored tests.',
              score: 1.5,
              keywords: ['feature'],
              location: { kind: 'pdf', pageStart: 1, pageEnd: 2 }
            }
          ]
        }
      }
    )

    const parsed = parseWritePromptForDisplay(prompt)

    expect(parsed?.userInput).toBe('帮我看看这篇文章讲什么内容\n\n再总结三条要点')
    expect(parsed?.retrieval?.source).toBe('bm25-keyword')
    expect(parsed?.retrieval?.keywords).toBe('feature, development')
    expect(parsed?.retrieval?.snippets).toHaveLength(2)
    expect(parsed?.retrieval?.snippets[0]).toMatchObject({
      location: 'notes/code-graph.md:12-30',
      title: '节点内容的处理',
      keywords: '内容'
    })
    expect(parsed?.retrieval?.snippets[0]?.text).toContain('代码图构建')
    expect(parsed?.retrieval?.snippets[1]).toMatchObject({
      location: 'papers/study.pdf 第1-2页',
      text: 'SWE-Dev provides runnable environments with developer-authored tests.'
    })
  })
})

describe('write markdown preview resources', () => {
  it('preserves complete external links without blocked placeholders', () => {
    const html = renderToStaticMarkup(createElement(WriteMarkdownPreview, {
      content: '[Agent-R1](https://github.com/AgentR1/Agent-R1)',
      isMarkdown: true
    }))

    expect(html).toContain('href="https://github.com/AgentR1/Agent-R1"')
    expect(html).not.toContain('[blocked]')
    expect(html).not.toContain('Blocked URL:')
  })

  it('resolves relative image paths for workspace IPC instead of file URLs', () => {
    const resolved = resolveWriteMarkdownResource('../assets/hero image.png', '/tmp/workspace/docs/draft.md')
    expect(resolved).toBeUndefined()
    expect(resolveWriteMarkdownResourcePath('../assets/hero image.png', '/tmp/workspace/docs/draft.md')).toBe(
      '/tmp/workspace/assets/hero image.png'
    )
  })

  it('keeps explicit external URLs unchanged', () => {
    expect(resolveWriteMarkdownResource('https://example.com/a.png', '/tmp/workspace/docs/draft.md')).toBe('https://example.com/a.png')
    expect(resolveWriteMarkdownResource('data:image/png;base64,AAAA', '/tmp/workspace/docs/draft.md')).toBe('data:image/png;base64,AAAA')
    expect(resolveWriteMarkdownResourcePath('https://example.com/a.png', '/tmp/workspace/docs/draft.md')).toBeUndefined()
  })

  it('does not pass through unsafe explicit URLs from markdown content', () => {
    expect(resolveWriteMarkdownResource('file:///tmp/secret.png', '/tmp/workspace/docs/draft.md')).toBeUndefined()
    expect(resolveWriteMarkdownResource('javascript:alert(1)', '/tmp/workspace/docs/draft.md')).toBeUndefined()
    expect(resolveWriteMarkdownResource('ftp://example.com/a.png', '/tmp/workspace/docs/draft.md')).toBeUndefined()
    expect(resolveWriteMarkdownResource('data:image/svg+xml;base64,AAAA', '/tmp/workspace/docs/draft.md')).toBeUndefined()
    expect(resolveWriteMarkdownResource('data:text/html;base64,AAAA', '/tmp/workspace/docs/draft.md')).toBeUndefined()
  })
})
