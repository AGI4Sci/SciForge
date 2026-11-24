import { codeSelectionSnapshotSchema, domainWorkbenchOpenResourceInputSchema, type CodeSelectionSnapshot } from '@sciforge/domain-sdk/renderer'
import type { DomainRendererWorkbenchHost } from '@sciforge/domain-sdk/host'

type Scope = CodeSelectionSnapshot['scope']
export type CodeRow = { code: string; side: 'old' | 'new'; line: number; hunkHeader: string }
export function diffCodeRows(patch: string): CodeRow[] {
  let old = 0, next = 0, hunkHeader = ''
  const rows: CodeRow[] = []
  for (const row of patch.split('\n')) {
    if (row.startsWith('diff --git ') || row.startsWith('--- ') || row.startsWith('+++ ')) { hunkHeader = ''; continue }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row)
    if (hunk) { old = Number(hunk[1]); next = Number(hunk[2]); hunkHeader = row; continue }
    if (!hunkHeader || !/^[ +-]/.test(row)) continue
    if (row.startsWith('-')) rows.push({ code: row.slice(1), side: 'old', line: old++, hunkHeader })
    else { rows.push({ code: row.slice(1), side: 'new', line: next++, hunkHeader }); if (!row.startsWith('+')) old++ }
  }
  return rows
}

export async function createCodeSelection(input: {
  scope: Scope; filePath: string; text: string; start: number; end: number
  bounds: CodeSelectionSnapshot['bounds']; viewport: CodeSelectionSnapshot['viewport']
  side?: 'old' | 'new'; firstLine?: number; hunkHeader?: string; revision?: string
}): Promise<CodeSelectionSnapshot & { codeAnchor: NonNullable<CodeSelectionSnapshot['codeAnchor']> }> {
  if (!Number.isInteger(input.start) || !Number.isInteger(input.end) || input.start < 0 || input.end > input.text.length || input.end <= input.start) throw new Error('请选择有效代码范围。')
  const quote = input.text.slice(input.start, input.end)
  if (!quote.trim() || quote.length > 4000) throw new Error('请选择 1–4000 字符代码；不会自动截断。')
  const root = input.scope.workspaceRoot.replace(/\/$/, '')
  const filePath = input.filePath.startsWith(root + '/') ? input.filePath.slice(root.length + 1) : input.filePath
  const digest = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  const baseRevision = input.revision ?? `snapshot:${await digest(input.text)}`
  const line = (input.firstLine ?? 1) + input.text.slice(0, input.start).split('\n').length - 1
  const endLine = line + quote.replace(/\n$/, '').split('\n').length - 1
  const anchor = { filePath, side: input.side ?? 'new', line, endLine, hunkHeader: input.hunkHeader ?? '', code: quote, baseRevision }
  const contentDigest = await digest(JSON.stringify(anchor))
  const result = codeSelectionSnapshotSchema.parse({ schemaVersion: 1, kind: 'resource-text-selection', resourceKind: 'code',
    resourceId: `code:${contentDigest}`, label: `${filePath}:${line}${endLine === line ? '' : `–${endLine}`}`, quote,
    revision: baseRevision, capturedAt: new Date().toISOString(), scope: input.scope, bounds: input.bounds, viewport: input.viewport,
    codeAnchor: { ...anchor, contentDigest } })
  return result as CodeSelectionSnapshot & { codeAnchor: NonNullable<CodeSelectionSnapshot['codeAnchor']> }
}

export async function openCodeSelection(selection: CodeSelectionSnapshot, workbench: Pick<DomainRendererWorkbenchHost, 'canOpenResource' | 'openResource'>): Promise<void> {
  if (!workbench.canOpenResource?.('resource-text-selection') || !workbench.openResource) throw new Error('没有已启用的批注入口；尚未保存。')
  const value = codeSelectionSnapshotSchema.parse(selection)
  const input = domainWorkbenchOpenResourceInputSchema.parse({ sessionId: value.scope.threadId, placement: 'new',
    resource: { resourceKind: value.kind, resourceId: value.resourceId, context: value } })
  if (!await workbench.openResource(input)) throw new Error('批注入口不可用；尚未保存。')
}
