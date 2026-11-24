import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

const parser = unified().use(remarkParse).use(remarkGfm)
type Node = { type: string; value?: string; children?: Node[]; [key: string]: unknown }
const inlineFormatting = new Set(['inlineCode', 'emphasis', 'strong', 'delete', 'link', 'image'])

/** Read the stored body, not the configurable publication export. Only native
 * block attribute lines outside code are removed; references stay references. */
export function bodyMarkdown(kramdown: string): string {
  const source = kramdown.replace(/\r\n/gu, '\n')
  const code: { start: number; end: number }[] = []
  type LocatedNode = { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: readonly LocatedNode[] }
  const visit = (node: LocatedNode) => {
    if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'html' &&
      /^<(?:pre|script|style|textarea)(?:\s|>)/iu.test(source.slice(node.position?.start.offset))) {
      const start = node.position?.start.offset, end = node.position?.end.offset
      if (start !== undefined && end !== undefined) code.push({ start, end })
    }
    if (node.children) for (const child of node.children) visit(child)
  }
  visit(parser.parse(source))
  for (const match of source.matchAll(/^\$\$[^\S\n]*\n[\s\S]*?^\$\$[^\S\n]*$/gmu)) {
    code.push({ start: match.index, end: match.index + match[0].length })
  }
  return source.replace(/^\{: (?:[\w-]+="[^"\n]*"\s*)+\}\n?/gmu, (line, offset: number) =>
    code.some(range => offset >= range.start && offset < range.end) ? line : '')
}

export function markdownTree(markdown: string) { return parser.parse(markdown) }

/** Compare Markdown structure, ignoring export formatting but preserving code,
 * links, tables, task state and hard breaks. SiYuan inserts a zero-width caret
 * placeholder next to inline formatting; only those boundary markers are
 * ignored. Zero-width content in code or ordinary text remains significant. */
function canonicalNode(node: Node): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'position' && key !== 'spread' && key !== 'children') {
      // SiYuan gives an unlabelled reference its own id as the default anchor.
      result[key] = key === 'value' && node.type === 'text' && typeof value === 'string'
        ? value.replace(/\(\((\d{14}-[a-z0-9]{7}) '\1'\)\)/gu, '(($1))')
          // Adjacent native block references get a caret separator on storage.
          // Keep ordinary zero-width text and all code content significant.
          .replace(/(\(\(\d{14}-[a-z0-9]{7}(?: '[^'\n]*')?\)\))\u200b+(?=\(\(\d{14}-[a-z0-9]{7}(?: '[^'\n]*')?\)\))/gu, '$1') : value
    }
  }
  if (node.children) {
    const children = node.children.map((child, index, siblings) => {
      if (child.type !== 'text') return canonicalNode(child)
      let value = child.value ?? ''
      if (inlineFormatting.has(siblings[index - 1]?.type)) value = value.replace(/^\u200b+/u, '')
      if (inlineFormatting.has(siblings[index + 1]?.type)) value = value.replace(/\u200b+$/u, '')
      return canonicalNode({ ...child, value })
    }).filter(child => child.type !== 'text' || child.value !== '')
    result.children = children
  }
  return result
}

export const comparableMarkdown = (markdown: string): string =>
  JSON.stringify(canonicalNode(parser.parse(markdown.replace(/\r\n/gu, '\n')) as Node))
