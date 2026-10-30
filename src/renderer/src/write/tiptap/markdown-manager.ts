import type { AnyExtension, JSONContent } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Mathematics } from '@tiptap/extension-mathematics'
import { WriteLocalImage } from './local-image'

export type WriteRichFidelityReason =
  | 'too-large'
  | 'parse-error'
  | 'serialize-error'
  | 'unstable'
  | 'text-loss'
  | 'unsupported-syntax'

export type WriteRichFidelity =
  | {
      eligible: true
      source: string
      normalized: string
      exact: boolean
    }
  | {
      eligible: false
      source: string
      reason: WriteRichFidelityReason
      detail?: string
    }

export type WriteRichLoadResult =
  | {
      ok: true
      source: string
      doc: JSONContent
      fidelity: Extract<WriteRichFidelity, { eligible: true }>
    }
  | {
      ok: false
      source: string
      fidelity: Extract<WriteRichFidelity, { eligible: false }>
    }

export type WriteRichWriteBlockedReason =
  | 'unchanged'
  | 'ineligible'
  | WriteRichFidelityReason

export type WriteRichWriteResult =
  | {
      ok: true
      markdown: string
    }
  | {
      ok: false
      reason: WriteRichWriteBlockedReason
      fallbackMarkdown: string
      detail?: string
    }

// Rich mode refuses documents above this size; CodeMirror/source mode handles
// them better and the open-time round-trip audit would become expensive.
export const WRITE_RICH_MAX_CHARS = 300_000

function trimTrailingNewlines(markdown: string): string {
  return markdown.replace(/\n+$/, '')
}

export function buildWriteRichExtensions(options: {
  getFilePath?: () => string
  getWorkspaceRoot?: () => string
} = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      link: { openOnClick: false },
      undoRedo: { depth: 200 }
    }),
    TableKit.configure({
      table: { resizable: false }
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Mathematics.configure({
      katexOptions: {
        throwOnError: false
      }
    }),
    WriteLocalImage.configure({
      getFilePath: options.getFilePath ?? (() => ''),
      getWorkspaceRoot: options.getWorkspaceRoot ?? (() => '')
    })
  ]
}

let sharedManager: MarkdownManager | null = null

export function getWriteMarkdownManager(): MarkdownManager {
  if (!sharedManager) {
    sharedManager = new MarkdownManager({
      markedOptions: { gfm: true },
      extensions: buildWriteRichExtensions()
    })
  }
  return sharedManager
}

export function parseWriteMarkdown(markdown: string): JSONContent {
  return getWriteMarkdownManager().parse(markdown)
}

export function serializeWriteMarkdown(doc: JSONContent): string {
  return getWriteMarkdownManager().serialize(doc)
}

function collectContentText(node: JSONContent | undefined, acc: string[]): string[] {
  if (!node) return acc
  if (node.type === 'text' && node.text) acc.push(node.text)
  if (node.type === 'image' && node.attrs) {
    const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : ''
    const src = typeof node.attrs.src === 'string' ? node.attrs.src : ''
    const title = typeof node.attrs.title === 'string' ? node.attrs.title : ''
    acc.push(`image:${alt}:${src}:${title}`)
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) collectContentText(child, acc)
  }
  return acc
}

function normalizedContentText(doc: JSONContent): string {
  return collectContentText(doc, []).join(' ').replace(/\s+/g, ' ').trim()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function unsupportedMarkdownSyntax(markdown: string): string | null {
  if (/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/.test(markdown)) return 'frontmatter'
  if (/^\s*(?:import|export)\s.+$/m.test(markdown)) return 'mdx'
  if (/^\s*\[\^[^\]]+\]:/m.test(markdown) || /\[\^[^\]]+\]/.test(markdown)) return 'footnote'
  if (/^\s*\[[^\]]+\]:\s+\S+/m.test(markdown)) return 'link-reference-definition'
  if (/^\s*<([A-Za-z][\w:-]*)(?:\s|>|\/>)/m.test(markdown)) return 'html-block'
  if (/<\/?[A-Za-z][\w:-]*(?:\s[^>]*)?>/.test(markdown)) return 'inline-html'
  return null
}

/**
 * Open-time fidelity gate for rich markdown. Rich mode is allowed only when a
 * document is idempotent after one serialize/parse pass and preserves textual
 * content. Otherwise callers should keep editing the source markdown.
 */
export function auditWriteMarkdownFidelity(
  markdown: string,
  options: { maxChars?: number } = {}
): WriteRichFidelity {
  const source = String(markdown ?? '')
  const maxChars = options.maxChars ?? WRITE_RICH_MAX_CHARS
  if (source.length > maxChars) {
    return {
      eligible: false,
      source,
      reason: 'too-large',
      detail: `document has ${source.length} characters; rich mode limit is ${maxChars}`
    }
  }
  const unsupportedSyntax = unsupportedMarkdownSyntax(source)
  if (unsupportedSyntax) {
    return {
      eligible: false,
      source,
      reason: 'unsupported-syntax',
      detail: unsupportedSyntax
    }
  }

  const manager = getWriteMarkdownManager()
  let firstDoc: JSONContent
  let firstPass: string
  let secondDoc: JSONContent
  let secondPass: string

  try {
    firstDoc = manager.parse(source)
  } catch (error) {
    return { eligible: false, source, reason: 'parse-error', detail: errorMessage(error) }
  }

  try {
    firstPass = manager.serialize(firstDoc)
  } catch (error) {
    return { eligible: false, source, reason: 'serialize-error', detail: errorMessage(error) }
  }

  try {
    secondDoc = manager.parse(firstPass)
    secondPass = manager.serialize(secondDoc)
  } catch (error) {
    return { eligible: false, source, reason: 'parse-error', detail: errorMessage(error) }
  }

  if (firstPass !== secondPass) {
    return { eligible: false, source, reason: 'unstable' }
  }

  if (normalizedContentText(firstDoc) !== normalizedContentText(secondDoc)) {
    return { eligible: false, source, reason: 'text-loss' }
  }

  return {
    eligible: true,
    source,
    normalized: firstPass,
    exact: firstPass === trimTrailingNewlines(source)
  }
}

export function loadWriteRichMarkdown(markdown: string): WriteRichLoadResult {
  const fidelity = auditWriteMarkdownFidelity(markdown)
  if (!fidelity.eligible) return { ok: false, source: fidelity.source, fidelity }

  try {
    return {
      ok: true,
      source: fidelity.source,
      doc: parseWriteMarkdown(fidelity.source),
      fidelity
    }
  } catch (error) {
    return {
      ok: false,
      source: fidelity.source,
      fidelity: {
        eligible: false,
        source: fidelity.source,
        reason: 'parse-error',
        detail: errorMessage(error)
      }
    }
  }
}

export function serializeWriteMarkdownIfSafe({
  doc,
  sourceMarkdown,
  fidelity,
  edited,
  audit = true
}: {
  doc: JSONContent
  sourceMarkdown: string
  fidelity?: WriteRichFidelity | null
  edited: boolean
  audit?: boolean
}): WriteRichWriteResult {
  const fallbackMarkdown = String(sourceMarkdown ?? '')
  if (!edited) {
    return { ok: false, reason: 'unchanged', fallbackMarkdown }
  }

  const gate = fidelity ?? auditWriteMarkdownFidelity(fallbackMarkdown)
  if (!gate.eligible) {
    return {
      ok: false,
      reason: 'ineligible',
      fallbackMarkdown,
      detail: gate.detail ?? gate.reason
    }
  }

  let markdown: string
  try {
    markdown = serializeWriteMarkdown(doc)
  } catch (error) {
    return {
      ok: false,
      reason: 'serialize-error',
      fallbackMarkdown,
      detail: errorMessage(error)
    }
  }

  if (audit) {
    const nextFidelity = auditWriteMarkdownFidelity(markdown)
    if (!nextFidelity.eligible) {
      return {
        ok: false,
        reason: nextFidelity.reason,
        fallbackMarkdown,
        detail: nextFidelity.detail
      }
    }
  }

  return { ok: true, markdown }
}
