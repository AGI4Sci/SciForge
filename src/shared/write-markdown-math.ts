const FENCE_PATTERN = /^(?: {0,3})(`{3,}|~{3,})/

export function normalizeMarkdownMathDelimiters(markdown: string): string {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n')
  let fence: string | null = null

  return lines.map((line) => {
    const fenceMatch = line.match(FENCE_PATTERN)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) {
        fence = marker[0]
      } else if (marker.startsWith(fence)) {
        fence = null
      }
      return line
    }
    if (fence) return line

    const trimmed = line.trim()
    if (trimmed === '\\[') return line.replace('\\[', '$$')
    if (trimmed === '\\]') return line.replace('\\]', '$$')

    const normalizedLine = line
      .replace(/\\\[([\s\S]+?)\\\]/g, (_match, latex: string) => `$$${latex}$$`)
      .replace(/\\\((.+?)\\\)/g, (_match, latex: string) => `$${latex}$`)
    const singleLineDisplay = normalizedLine.trim().match(/^\$\$([^\n]+)\$\$$/)
    if (singleLineDisplay) {
      const indentation = normalizedLine.match(/^\s*/)?.[0] ?? ''
      return `${indentation}$$\n${singleLineDisplay[1].trim()}\n${indentation}$$`
    }
    return normalizedLine
  }).join('\n')
}
