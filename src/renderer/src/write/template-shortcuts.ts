export type WriteTemplateShortcutExpansion = {
  from: number
  to: number
  insert: string
}

const WRITE_TEMPLATE_SHORTCUTS = new Set(['@date'])

export function formatWriteTemplateDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function buildWriteTemplateShortcutExpansion({
  text,
  cursor,
  now = new Date()
}: {
  text: string
  cursor: number
  now?: Date
}): WriteTemplateShortcutExpansion | null {
  const head = Math.max(0, Math.min(text.length, Math.floor(cursor)))
  const lineStart = text.lastIndexOf('\n', Math.max(0, head - 1)) + 1
  const linePrefix = text.slice(lineStart, head)
  const match = /(^|[^A-Za-z0-9_@])(@[A-Za-z][A-Za-z0-9_-]*)$/.exec(linePrefix)
  const shortcut = match?.[2]
  if (!shortcut || !WRITE_TEMPLATE_SHORTCUTS.has(shortcut)) return null

  return {
    from: head - shortcut.length,
    to: head,
    insert: formatWriteTemplateDate(now)
  }
}
