import { normalizeMarkdownMathDelimiters } from './write-markdown-math'

/** Minimal structural view of a unist/mdast node; avoids an extra type dependency. */
type MarkdownNode = {
  type?: string
  value?: unknown
  children?: MarkdownNode[]
}

/**
 * CommonMark only accepts spaces in a link/image destination when it is
 * wrapped in angle brackets. Workspace and chat content routinely reference
 * paths with spaces (`figures/my chart.png`, `C:\Users\me\fig a\plot.png`), so
 * those destinations are normalized before the document reaches the parser.
 * The authored Markdown itself is preserved: only the destination is wrapped.
 */
export function normalizeMarkdownImageDestinations(markdown: string): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(([^()\n]*\s[^()\n]*)\)/g,
    (match, alt: string, destination: string) => {
      const value = destination.trim()
      if (!value || value.startsWith('<') || value.endsWith('>')) return match
      const titled = value.match(/^(.+?)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))$/)
      if (titled) return `![${alt}](<${titled[1]}>${titled[2]})`
      return `![${alt}](<${value}>)`
    }
  )
}

export function normalizeMarkdownLinkDestinations(markdown: string): string {
  return markdown.replace(
    /(?<!!)\[([^\]]*)\]\(([^()\n]*\s[^()\n]*)\)/g,
    (match, label: string, destination: string) => {
      const value = destination.trim()
      if (!value || value.startsWith('<') || value.endsWith('>')) return match
      const titled = value.match(/^(.+?)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))$/)
      if (titled) return `[${label}](<${titled[1]}>${titled[2]})`
      return `[${label}](<${value}>)`
    }
  )
}

/** Both destination normalizers, in the order the parser needs them. */
export function normalizeMarkdownDestinations(markdown: string): string {
  return normalizeMarkdownLinkDestinations(normalizeMarkdownImageDestinations(markdown))
}

const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})/
const LIST_ITEM_DISPLAY_MATH = /^(\s*(?:[-+*]|\d+[.)])\s+)(\$\$[^\n]+?\$\$)\s*$/

/**
 * Display math written inline inside a list item (`- $$x$$`) used to be
 * expanded by the delimiter normalizer into three lines at column 0, which
 * closed the list and swallowed the following list items / tables. Expand it
 * first with the continuation lines aligned to the item content instead.
 */
export function normalizeMarkdownDisplayMathInLists(markdown: string): string {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let fence: string | null = null
  for (const line of lines) {
    const fenceMatch = line.match(FENCE_LINE)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) fence = marker[0]
      else if (marker.startsWith(fence)) fence = null
      out.push(line)
      continue
    }
    if (fence) {
      out.push(line)
      continue
    }
    const listItem = line.match(LIST_ITEM_DISPLAY_MATH)
    if (!listItem) {
      out.push(line)
      continue
    }
    const prefix = listItem[1]
    const latex = listItem[2].slice(2, -2).trim()
    const indent = ' '.repeat(prefix.length)
    out.push(`${prefix}$$`, `${indent}${latex}`, `${indent}$$`)
  }
  return out.join('\n')
}

/**
 * Canonical chat-answer normalization: keep display math inside its list item,
 * then normalize math delimiters and link/image destinations for the parser.
 */
export function normalizeChatMarkdown(markdown: string): string {
  const withListMath = normalizeMarkdownDisplayMathInLists(markdown)
  const withDelimiters = normalizeMarkdownMathDelimiters(withListMath)
  return normalizeMarkdownDestinations(normalizeMarkdownDisplayMathInLists(withDelimiters))
}

// Built from a char code so the source stays free of control characters.
const ESC = String.fromCharCode(27)
const ANSI_ESCAPE_REGEX = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g')

/**
 * Tool output frequently carries ANSI colour codes. They are meaningless once
 * rendered as Markdown and show up as `[31m` noise, so drop them.
 */
export function stripAnsiEscapes(text: string): string {
  return text.replace(ANSI_ESCAPE_REGEX, '')
}

const MATH_SIGNAL_REGEX = /[\\^_{}=+<>]|[a-zA-Z]\s*[a-zA-Z]/

/**
 * `remark-math` treats any `$…$` pair as inline math. Chat answers use `$` for
 * currency far more often than for TeX, so `"the price is $5 and $10"` used to
 * swallow the words between the two dollar signs into a KaTeX error.
 *
 * An inline math run is demoted back to literal text when it looks like money
 * or prose: it starts with a digit, contains whitespace, and carries no TeX
 * syntax. Real formulas (`$x^2$`, `$\alpha + \beta$`) keep their math node.
 */
export function isCurrencyOrProseMath(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (!/^[\d$]/.test(trimmed)) return false
  if (!/\s/.test(trimmed)) return false
  return !MATH_SIGNAL_REGEX.test(trimmed)
}

function demoteCurrencyMath(parent: MarkdownNode): void {
  const children = parent.children
  if (!children || children.length === 0) return
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (child.type === 'inlineMath' && typeof child.value === 'string' && isCurrencyOrProseMath(child.value)) {
      children[index] = { type: 'text', value: `$${child.value}$` }
      continue
    }
    demoteCurrencyMath(child)
  }
}

/** Remark plugin that keeps money out of KaTeX. Apply after `remark-math`. */
export function remarkCurrencyMath(): (tree: unknown) => void {
  return (tree: unknown) => {
    demoteCurrencyMath(tree as MarkdownNode)
  }
}
