import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WriteInlineCompletionRequest } from '../../shared/write-inline-completion'

import {
  clearWriteRetrievalCache,
  retrieveWriteContext,
  retrieveWriteInlineCompletionContext,
  tokenizeWriteRetrievalText
} from './write-retrieval-service'

function escapePdfText(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

function createSimpleTextPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    [
      '3 0 obj',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]',
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      'endobj\n'
    ].join('\n'),
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream\nendobj\n`
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'))
    pdf += object
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii')
  pdf += 'xref\n0 6\n'
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'ascii')
}

function createRequest(workspaceRoot: string): WriteInlineCompletionRequest {
  return {
    workspaceRoot,
    currentFilePath: join(workspaceRoot, 'draft.md'),
    prefix: '# Draft\n\nBM25 关键词',
    suffix: '',
    cursor: {
      line: 3,
      column: 9
    },
    context: {
      language: 'markdown',
      currentLinePrefix: 'BM25 关键词',
      currentLineSuffix: '',
      previousLine: '',
      previousNonEmptyLine: '# Draft',
      nextLine: '',
      indentation: '',
      signals: {
        list: false,
        quote: false,
        heading: false,
        table: false,
        atLineEnd: true,
        endsWithSentencePunctuation: false,
        previousLineEndsWithSentencePunctuation: false,
        prefersNewLineCompletion: false,
        paragraphBreakOpportunity: false
      }
    },
    policy: {
      name: 'precision-inline-v2',
      instruction: 'Return only inserted text.',
      acceptanceCriteria: ['Keep it short.'],
      rejectionCriteria: ['Do not ramble.']
    },
    preview: {
      local: 'BM25 关键词',
      documentTail: '# Draft BM25 关键词'
    }
  }
}

afterEach(() => {
  clearWriteRetrievalCache()
})

describe('write retrieval service', () => {
  it('tokenizes latin terms and CJK keyword ngrams', () => {
    const tokens = tokenizeWriteRetrievalText('BM25 关键词检索 RAG')

    expect(tokens).toContain('bm25')
    expect(tokens).toContain('rag')
    expect(tokens).toContain('关键词')
    expect(tokens).toContain('检索')
  })

  it('retrieves relevant cross-document snippets and excludes the active file', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-write-rag-'))
    await mkdir(join(workspaceRoot, 'research'), { recursive: true })
    await writeFile(
      join(workspaceRoot, 'draft.md'),
      '# Draft\n\nBM25 关键词',
      'utf8'
    )
    await writeFile(
      join(workspaceRoot, 'research', 'rag.md'),
      [
        '# 检索方案',
        '',
        'BM25 关键词检索用于在写作空间中找到相关片段。',
        '这些片段会作为 RAG 上下文帮助补全保持术语一致。'
      ].join('\n'),
      'utf8'
    )
    await writeFile(
      join(workspaceRoot, 'unrelated.md'),
      '# Shopping',
      'utf8'
    )

    const result = await retrieveWriteInlineCompletionContext(createRequest(workspaceRoot))

    expect(result?.source).toBe('bm25-keyword')
    expect(result?.snippets[0].path).toBe('research/rag.md')
    expect(result?.snippets[0].text).toContain('BM25 关键词检索')
    expect(result?.snippets.some((snippet) => snippet.path === 'draft.md')).toBe(false)
  })

  it('ignores unsupported large data files while scanning the workspace', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-write-rag-'))
    await writeFile(join(workspaceRoot, 'draft.md'), '# Draft\n\nembedding cache', 'utf8')
    await writeFile(
      join(workspaceRoot, 'notes.md'),
      '# Notes\n\nEmbedding cache notes help the inline completion stay consistent.',
      'utf8'
    )
    await writeFile(
      join(workspaceRoot, 'huge.md'),
      `# Huge\n\n${'embedding cache '.repeat(60_000)}`,
      'utf8'
    )
    await writeFile(join(workspaceRoot, 'output.jsonl'), `${'x'.repeat(10_000)}\n`, 'utf8')

    const result = await retrieveWriteInlineCompletionContext({
      ...createRequest(workspaceRoot),
      prefix: '# Draft\n\nembedding cache',
      context: {
        ...createRequest(workspaceRoot).context,
        currentLinePrefix: 'embedding cache',
        previousNonEmptyLine: '# Draft'
      },
      preview: {
        local: 'embedding cache',
        documentTail: '# Draft embedding cache'
      }
    })

    expect(result?.snippets.some((snippet) => snippet.path === 'output.jsonl')).toBe(false)
    expect(result?.snippets.some((snippet) => snippet.path === 'huge.md')).toBe(false)
    expect(result?.snippets.some((snippet) => snippet.path === 'notes.md')).toBe(true)
  })

  it('retrieves PDF chunks for assistant context with page locations', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-write-pdf-rag-'))
    const pdfPath = join(workspaceRoot, 'papers', 'study.pdf')
    await mkdir(join(workspaceRoot, 'papers'), { recursive: true })
    await writeFile(join(workspaceRoot, 'draft.md'), '# Draft\n\nExplain literature context.', 'utf8')
    await writeFile(pdfPath, createSimpleTextPdf([
      'PDF BM25 keyword retrieval with literature context improves retrieval quality.',
      'The assistant can cite the relevant page when explaining research evidence.'
    ].join(' ')))

    const result = await retrieveWriteContext({
      workspaceRoot,
      currentFilePath: pdfPath,
      query: 'PDF BM25 keyword literature retrieval quality',
      maxSnippets: 3,
      includeCurrentFile: true
    })

    expect(result?.source).toBe('bm25-keyword')
    expect(result?.snippets[0]).toMatchObject({
      path: 'papers/study.pdf',
      pageStart: 1,
      pageEnd: 1,
      location: {
        kind: 'pdf',
        pageStart: 1,
        pageEnd: 1
      }
    })
    expect(result?.snippets[0].text).toContain('PDF BM25 keyword')
  })
})
