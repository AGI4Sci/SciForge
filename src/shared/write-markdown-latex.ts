import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { normalizeMarkdownMathDelimiters } from './write-markdown-math'

type MarkdownNode = {
  type: string
  value?: string
  lang?: string
  depth?: number
  ordered?: boolean
  checked?: boolean | null
  url?: string
  alt?: string
  title?: string | null
  children?: MarkdownNode[]
  align?: Array<'left' | 'right' | 'center' | null>
}

type LatexRenderState = {
  imagePaths: Set<string>
  links: Set<string>
}

export type MarkdownLatexDocumentOptions = {
  title?: string
  documentClass?: 'ctexart' | 'article'
}

const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)

const LATEX_ESCAPE_PATTERN = /[\\{}$&#_%~^]/g
const LATEX_ESCAPE_MAP: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '$': '\\$',
  '&': '\\&',
  '#': '\\#',
  '_': '\\_',
  '%': '\\%',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}'
}

function escapeLatex(value = ''): string {
  return String(value).replace(LATEX_ESCAPE_PATTERN, (char) => LATEX_ESCAPE_MAP[char] ?? char)
}

function escapeLatexUrl(value = ''): string {
  return String(value)
    .replace(/\\/g, '/')
    .replace(/[%#{}]/g, (char) => LATEX_ESCAPE_MAP[char] ?? char)
}

function detokenize(value = ''): string {
  return `\\detokenize{${String(value).replace(/}/g, '\\}')}}`
}

function compactBlankLines(value: string): string {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function renderChildren(node: MarkdownNode | undefined, state: LatexRenderState): string {
  return (node?.children ?? []).map((child) => renderInline(child, state)).join('')
}

function renderInline(node: MarkdownNode, state: LatexRenderState): string {
  switch (node.type) {
    case 'text':
      return escapeLatex(node.value ?? '')
    case 'emphasis':
      return `\\emph{${renderChildren(node, state)}}`
    case 'strong':
      return `\\textbf{${renderChildren(node, state)}}`
    case 'delete':
      return renderChildren(node, state)
    case 'inlineCode':
      return `\\texttt{${escapeLatex(node.value ?? '')}}`
    case 'inlineMath':
      return `\\(${node.value ?? ''}\\)`
    case 'link': {
      const url = node.url ?? ''
      state.links.add(url)
      return `\\href{${escapeLatexUrl(url)}}{${renderChildren(node, state)}}`
    }
    case 'image': {
      const src = node.url ?? ''
      if (src) state.imagePaths.add(src)
      return src ? `\\includegraphics[width=0.9\\linewidth]{${detokenize(src)}}` : ''
    }
    case 'break':
      return '\\\\\n'
    case 'html':
      return escapeLatex(node.value ?? '')
    default:
      if (node.children) return renderChildren(node, state)
      return escapeLatex(node.value ?? '')
  }
}

function headingCommand(depth = 1): string {
  if (depth <= 1) return 'section'
  if (depth === 2) return 'subsection'
  if (depth === 3) return 'subsubsection'
  if (depth === 4) return 'paragraph'
  return 'subparagraph'
}

function renderListItem(node: MarkdownNode, state: LatexRenderState): string {
  const children = node.children ?? []
  const [first, ...rest] = children
  const taskPrefix = typeof node.checked === 'boolean'
    ? node.checked ? '[x] ' : '[ ] '
    : ''
  const firstText = first?.type === 'paragraph'
    ? `${taskPrefix}${renderChildren(first, state)}`
    : `${taskPrefix}${renderBlock(first, state)}`
  const restText = rest.map((child) => renderBlock(child, state)).filter(Boolean).join('\n\n')
  return restText ? `\\item ${firstText}\n\n${restText}` : `\\item ${firstText}`
}

function renderTable(node: MarkdownNode, state: LatexRenderState): string {
  const rows = node.children ?? []
  const firstRow = rows[0]
  const columnCount = Math.max(1, firstRow?.children?.length ?? 1)
  const columns = Array.from({ length: columnCount }, () => 'l').join('')
  const renderedRows = rows.map((row, index) => {
    const cells = row.children ?? []
    const renderedCells = Array.from({ length: columnCount }, (_, cellIndex) => {
      const cell = cells[cellIndex]
      return renderChildren(cell, state).trim()
    })
    const suffix = index === 0 ? ' \\\\ \\hline' : ' \\\\'
    return `${renderedCells.join(' & ')}${suffix}`
  })

  return [
    `\\begin{tabular}{${columns}}`,
    '\\hline',
    ...renderedRows,
    '\\hline',
    '\\end{tabular}'
  ].join('\n')
}

function renderBlock(node: MarkdownNode | undefined, state: LatexRenderState): string {
  if (!node) return ''

  switch (node.type) {
    case 'root':
      return (node.children ?? []).map((child) => renderBlock(child, state)).filter(Boolean).join('\n\n')
    case 'paragraph':
      return renderChildren(node, state)
    case 'heading':
      return `\\${headingCommand(node.depth)}{${renderChildren(node, state)}}`
    case 'blockquote': {
      const body = (node.children ?? []).map((child) => renderBlock(child, state)).filter(Boolean).join('\n\n')
      return `\\begin{quote}\n${body}\n\\end{quote}`
    }
    case 'list': {
      const env = node.ordered ? 'enumerate' : 'itemize'
      const body = (node.children ?? []).map((child) => renderListItem(child, state)).join('\n')
      return `\\begin{${env}}\n${body}\n\\end{${env}}`
    }
    case 'code': {
      const language = node.lang ? `% language: ${escapeLatex(node.lang)}\n` : ''
      return `${language}\\begin{verbatim}\n${node.value ?? ''}\n\\end{verbatim}`
    }
    case 'math':
      return `\\[\n${node.value ?? ''}\n\\]`
    case 'thematicBreak':
      return '\\par\\noindent\\rule{\\linewidth}{0.4pt}\\par'
    case 'table':
      return renderTable(node, state)
    case 'html':
      return escapeLatex(node.value ?? '')
    default:
      if (node.children) return renderChildren(node, state)
      return escapeLatex(node.value ?? '')
  }
}

function latexPreamble(options: MarkdownLatexDocumentOptions): string {
  const documentClass = options.documentClass ?? 'ctexart'
  const title = options.title?.trim()
  return [
    `\\documentclass[UTF8]{${documentClass}}`,
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{graphicx}',
    '\\usepackage{hyperref}',
    '\\usepackage[margin=1in]{geometry}',
    '',
    title ? `\\title{${escapeLatex(title)}}` : '',
    title ? '\\date{}' : ''
  ].filter((line) => line !== '').join('\n')
}

export function markdownToLatexBody(markdown: string): string {
  const tree = parser.parse(normalizeMarkdownMathDelimiters(markdown)) as MarkdownNode
  const state: LatexRenderState = {
    imagePaths: new Set(),
    links: new Set()
  }
  return compactBlankLines(renderBlock(tree, state))
}

export function markdownToLatexDocument(
  markdown: string,
  options: MarkdownLatexDocumentOptions = {}
): string {
  const body = markdownToLatexBody(markdown)
  return compactBlankLines([
    latexPreamble(options),
    '',
    '\\begin{document}',
    options.title?.trim() ? '\\maketitle' : '',
    '',
    body,
    '',
    '\\end{document}'
  ].filter((line) => line !== '').join('\n')) + '\n'
}
