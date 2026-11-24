import { isAbsolute } from 'node:path'

/** ACP ToolCallUpdate fields patch the call; content arrays replace the collection.
 * Only structured provider diff blocks are eligible. Model text/rawInput/rawOutput
 * and tool names never establish a file change or an executor receipt. */
export class AcpFileChangeProjection {
  private calls = new Map<string, { kind?: string; status?: string; content?: unknown[] }>()

  update(update: Record<string, unknown>): string | undefined {
    const id = update.toolCallId
    if (typeof id !== 'string' || !id) return undefined
    if (update.sessionUpdate === 'tool_call') this.calls.set(id, {})
    const call = this.calls.get(id)
    // Orphan updates cannot establish provenance for a call we never observed.
    if (!call) return undefined
    if (typeof update.kind === 'string') call.kind = update.kind
    if (typeof update.status === 'string') call.status = update.status
    if (Array.isArray(update.content)) call.content = update.content
    if (call.kind !== 'edit' || call.status !== 'completed') return undefined
    const changes: { path: string; diff: string }[] = []
    for (const value of call.content ?? []) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const block = value as Record<string, unknown>
      if (block.type !== 'diff') continue
      // Do not present a partial edit as the complete change for this call.
      if (typeof block.path !== 'string' || !isAbsolute(block.path)
        || /[\r\n\0]/u.test(block.path) || typeof block.newText !== 'string'
        || (block.oldText !== undefined && block.oldText !== null && typeof block.oldText !== 'string')) return undefined
      const oldText = typeof block.oldText === 'string' ? block.oldText : ''
      if (oldText === block.newText) continue
      changes.push({ path: block.path, diff: unifiedDiff(block.path, oldText, block.newText, block.oldText == null) })
    }
    return changes.length ? JSON.stringify({ changes }) : undefined
  }
}

/** Whole-file unified hunks retain exact text and final-newline semantics. The
 * provider supplied full before/after contents, so no filesystem read is needed. */
function unifiedDiff(path: string, before: string, after: string, created: boolean): string {
  const lines = (text: string): string[] => text ? (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n') : []
  const oldLines = lines(before)
  const newLines = lines(after)
  const section = (text: string, values: string[], prefix: string) => values.length
    ? values.map(line => `${prefix}${line}\n`).join('') + (text.endsWith('\n') ? '' : '\\ No newline at end of file\n') : ''
  return `--- ${created ? '/dev/null' : path}\n+++ ${path}\n@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@\n`
    + section(before, oldLines, '-') + section(after, newLines, '+')
}
