import type { z } from 'zod'
import type { siyuanDocumentPatchRequestSchema } from '../editor-contract.js'
import { SiYuanError } from './client.js'
import { comparableMarkdown, markdownTree } from './markdown.js'

function locked(markdown: string): string[] {
  const markers = [...markdown.matchAll(/<!--\s*(\/?)locked\s*-->/gu)]
  const regions: string[] = []
  for (let i = 0; i < markers.length; i += 2) {
    const start = markers[i], end = markers[i + 1]
    if (start[1] || !end || !end[1]) throw new SiYuanError('protected_content')
    regions.push(markdown.slice(start.index, end.index + end[0].length))
  }
  return regions
}
export function assertLocked(before: string, after: string) {
  if (JSON.stringify(locked(before)) !== JSON.stringify(locked(after))) throw new SiYuanError('protected_content')
}

/** Full-document edits may append rows, never silently rewrite existing cells. */
export function assertDocumentProtection(before: string, after: string) {
  assertLocked(before, after)
  const tables = (text: string) => {
    const result: import('mdast').Table[] = []
    const visit = (node: import('mdast').Nodes) => {
      if (node.type === 'table') result.push(node)
      if ('children' in node) for (const child of node.children) visit(child)
    }
    visit(markdownTree(text))
    return result
  }
  const old = tables(before), next = tables(after)
  for (let index = 0; index < old.length; index++) {
    const a = old[index], b = next[index]
    if (!b || JSON.stringify(a.align) !== JSON.stringify(b.align) || b.children.length < a.children.length ||
      a.children.some((row, i) => comparableMarkdown(before.slice(row.position!.start.offset!, row.position!.end.offset!)) !==
        comparableMarkdown(after.slice(b.children[i].position!.start.offset!, b.children[i].position!.end.offset!))) ||
      b.children.some(row => row.children.length !== a.children[0].children.length)) throw new SiYuanError('protected_content')
  }
}

type Patch = z.infer<typeof siyuanDocumentPatchRequestSchema>
export type MarkdownChange = { start: number; end: number; text: string }
export function patchChanges(markdown: string, request: Patch): MarkdownChange[] {
  const tree = markdownTree(markdown)
  const changes: MarkdownChange[] = []
  for (const change of request.changes) {
    const headings = tree.children.filter(node => node.type === 'heading').filter(node =>
      markdown.slice(node.position!.start.offset!, node.position!.end.offset!).replace(/^#{1,6}\s+/u, '').replace(/\s+#+\s*$/u, '') === change.section)
    if (headings.length !== 1) throw new SiYuanError('edit_scope_invalid')
    const heading = headings[0]
    const start = heading.position!.end.offset!
    const next = tree.children.find(node => node.type === 'heading' && node.depth <= heading.depth && node.position!.start.offset! > start)
    const end = next?.position!.start.offset ?? markdown.length
    const tables = tree.children.filter(node => node.type === 'table').filter(node => node.position!.start.offset! >= start && node.position!.end.offset! <= end)
    if (change.type === 'text') {
      if (/^\{: .*\}$/mu.test(change.replace)) throw new SiYuanError('edit_scope_invalid')
      const found = markdown.indexOf(change.find, start)
      if (found < start || found + change.find.length > end || markdown.indexOf(change.find, found + 1) >= 0 && markdown.indexOf(change.find, found + 1) < end ||
        tables.some(table => found < table.position!.end.offset! && found + change.find.length > table.position!.start.offset!)) throw new SiYuanError('edit_scope_invalid')
      changes.push({ start: found, end: found + change.find.length, text: change.replace })
    } else {
      const table = tables[change.tableIndex]
      if (!table) throw new SiYuanError('edit_scope_invalid')
      if (change.type === 'table-cell') {
        const cell = table.children[change.row]?.children[change.column]
        if (!cell) throw new SiYuanError('edit_scope_invalid')
        let cellStart = cell.children[0]?.position?.start.offset ?? cell.position!.start.offset!
        let cellEnd = cell.children.at(-1)?.position?.end.offset ?? cell.position!.end.offset!
        if (!cell.children.length) {
          if (markdown[cellStart] === '|') cellStart++
          if (markdown[cellEnd - 1] === '|') cellEnd--
        }
        if (markdown.slice(cellStart, cellEnd).trim() !== change.expected.trim()) throw new SiYuanError('document_changed')
        if (/[|\r\n]/u.test(change.value)) throw new SiYuanError('edit_scope_invalid')
        changes.push({ start: cellStart, end: cellEnd, text: change.value })
      } else {
        const columns = table.children[0].children.length
        if (change.rows.some(row => row.length !== columns || row.some(cell => /[|\r\n]/u.test(cell)))) throw new SiYuanError('protected_content')
        changes.push({ start: table.position!.end.offset!, end: table.position!.end.offset!, text: change.rows.map(row => '\n| ' + row.join(' | ') + ' |').join('') })
      }
    }
  }
  changes.sort((a, b) => a.start - b.start)
  if (changes.some((change, i) => i > 0 && change.start <= changes[i - 1].end)) throw new SiYuanError('edit_scope_invalid')
  const candidate = applyChanges(markdown, changes)
  assertLocked(markdown, candidate)
  // Text replacement cannot smuggle new headings, tables or multiple blocks.
  for (const change of request.changes) {
    if (change.type === 'text') {
      const a = markdownTree(change.find).children, b = markdownTree(change.replace).children
      if (a.length !== 1 || b.length !== 1 || a[0].type !== b[0].type || !['paragraph', 'code', 'html'].includes(b[0].type)) throw new SiYuanError('edit_scope_invalid')
    }
  }
  return changes
}
export function applyChanges(markdown: string, changes: readonly MarkdownChange[]): string {
  let result = markdown
  for (const change of [...changes].sort((a, b) => b.start - a.start)) result = result.slice(0, change.start) + change.text + result.slice(change.end)
  return result
}
