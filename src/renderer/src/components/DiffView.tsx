import { useMemo, useRef, useState, type ReactElement } from 'react'
import { CodeSelectionAction } from './CodeSelectionAction'
import { diffCodeRows } from '../lib/code-selection'
import { Check, Copy } from 'lucide-react'

type Props = {
  patch: string
  className?: string
  /** Maximum visible height (px). Defaults to 320 */
  maxHeight?: number
  /** Optional file path; falls back to parsing from patch headers */
  filePath?: string
  sessionId?: string
}

type ParsedDiff = {
  filePath: string | null
  added: number
  removed: number
  hunkOffset: number
}

const LANG_BADGES: Array<{ test: RegExp; label: string; tone: string }> = [
  { test: /\.tsx?$/i, label: 'TS', tone: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  { test: /\.jsx?$/i, label: 'JS', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  { test: /\.json$/i, label: 'JSON', tone: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300' },
  { test: /\.(css|scss|less)$/i, label: 'CSS', tone: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300' },
  { test: /\.md$/i, label: 'MD', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300' },
  { test: /\.py$/i, label: 'PY', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  { test: /\.html?$/i, label: 'HTML', tone: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300' },
  { test: /\.ya?ml$/i, label: 'YML', tone: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  { test: /\.sh$/i, label: 'SH', tone: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300' }
]

function parseDiff(patch: string, override?: string): ParsedDiff {
  const lines = patch.split('\n')
  let filePath = override ?? null
  let added = 0
  let removed = 0
  let hunkOffset = -1

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!filePath) {
      if (line.startsWith('+++ ')) {
        const raw = line.slice(4).trim()
        const cleaned = raw.replace(/^[ab]\//, '')
        if (cleaned && cleaned !== '/dev/null') filePath = cleaned
      } else if (line.startsWith('--- ') && !filePath) {
        const raw = line.slice(4).trim()
        const cleaned = raw.replace(/^[ab]\//, '')
        if (cleaned && cleaned !== '/dev/null') filePath = cleaned
      } else if (line.startsWith('diff --git ')) {
        const m = line.match(/ b\/(\S+)/)
        if (m) filePath = m[1]
      }
    }
    if (line.startsWith('@@') && hunkOffset === -1) hunkOffset = i
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1
  }
  return { filePath, added, removed, hunkOffset }
}

function badgeFor(name: string | null): { label: string; tone: string } {
  if (!name) return { label: 'TXT', tone: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300' }
  for (const b of LANG_BADGES) if (b.test.test(name)) return { label: b.label, tone: b.tone }
  return { label: 'TXT', tone: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300' }
}

/**
 * Lightweight unified-diff renderer with a header (badge, filename, stats,
 * copy). Tints +/-/@@ lines and renders everything else as monospace context.
 */
export function DiffView({
  patch,
  className = '',
  maxHeight = 320,
  filePath,
  sessionId
}: Props): ReactElement {
  const lines = patch.split('\n')
  const looksLikePatch = lines.some((l) => /^[+-]/.test(l) || l.startsWith('@@'))
  const parsed = useMemo(() => parseDiff(patch, filePath), [patch, filePath])
  const [copied, setCopied] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<HTMLPreElement>(null)
  const codeRows = diffCodeRows(patch)
  let codeRowIndex = 0
  const rowIndices = new Map<number, number>()
  let inHunk = false
  lines.forEach((line, index) => {
    if (line.startsWith('diff --git ') || line.startsWith('--- ') || line.startsWith('+++ ')) { inHunk = false; return }
    if (line.startsWith('@@')) { inHunk = true; return }
    if (inHunk && /^[ +-]/.test(line)) rowIndices.set(index, codeRowIndex++)
  })
  const selectionAction = (filePath || parsed.filePath) && lines.filter(line => line.startsWith('+++ ')).length <= 1 ? <CodeSelectionAction filePath={filePath ?? parsed.filePath!} sessionId={sessionId} read={() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null
    const range = selection.getRangeAt(0)
    const element = (node: Node) => node.nodeType === 1 ? node as Element : node.parentElement
    const start = element(range.startContainer)?.closest<HTMLElement>('[data-code-row]')
    const end = element(range.endContainer)?.closest<HTMLElement>('[data-code-row]')
    if (start && start === end && bodyRef.current?.contains(start)) {
      const row = codeRows[Number(start.dataset.codeRow)]
      if (!row) return null
      const prefix = range.cloneRange(); prefix.selectNodeContents(start); prefix.setEnd(range.startContainer, range.startOffset)
      const offset = prefix.toString().length
      return { text: row.code, start: offset, end: offset + selection.toString().length, bounds: range.getBoundingClientRect(), row }
    }
    if (sourceRef.current?.contains(range.startContainer) && sourceRef.current.contains(range.endContainer)) {
      const prefix = range.cloneRange(); prefix.selectNodeContents(sourceRef.current); prefix.setEnd(range.startContainer, range.startOffset)
      return { text: patch, start: prefix.toString().length, end: prefix.toString().length + selection.toString().length, bounds: range.getBoundingClientRect() }
    }
    return null
  }} /> : null

  const fileLabel = parsed.filePath ?? filePath ?? null
  const displayName = fileLabel ? fileLabel.split(/[/\\]/).pop() ?? fileLabel : null
  const badge = badgeFor(fileLabel)
  /** Sentinel: fill flex parent (inspector panel) instead of a fixed max-height box */
  const fillParent = maxHeight >= 9000

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(patch)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard unavailable */
    }
  }

  if (!looksLikePatch) {
    return (
      <div
        className={`ds-card-strong flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] ${className}`}
      >
        <DiffHeader
          badge={badge}
          name={displayName}
          added={null}
          removed={null}
          onCopy={onCopy}
          copied={copied}
        />
        <pre
          ref={sourceRef}
          className={`min-w-0 overflow-auto whitespace-pre p-3 font-mono text-ds-xs leading-6 text-ds-ink ${
            fillParent ? 'min-h-0 flex-1' : ''
          }`}
          style={fillParent ? undefined : { maxHeight }}
        >
          {patch}
        </pre>
        {selectionAction}
      </div>
    )
  }

  // Hide diff metadata lines (---, +++, diff --git, index) in the rendered body
  // since they're surfaced in the header.
  const bodyLines = lines.map((line, i) => ({ line, i })).filter(({ line }) => {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) return false
    if (line.startsWith('diff --git ')) return false
    if (line.startsWith('index ')) return false
    return true
  })

  // Compute display line numbers using hunk headers (@@ -a,b +c,d @@).
  const numbered: Array<{ key: number; line: string; lineNo: number | null; cls: string }> = []
  let newLineNo: number | null = null
  for (const { line, i } of bodyLines) {
    let cls: string
    let displayedNo: number | null = null
    if (line.startsWith('@@')) {
      cls = 'bg-accent-soft/60 text-ds-muted'
      const m = line.match(/\+(\d+)/)
      newLineNo = m ? parseInt(m[1], 10) : null
    } else if (line.startsWith('+')) {
      cls = 'bg-ds-diff-added-soft text-ds-diff-added'
      displayedNo = newLineNo
      if (newLineNo != null) newLineNo += 1
    } else if (line.startsWith('-')) {
      cls = 'bg-ds-diff-removed-soft text-ds-diff-removed'
    } else {
      cls = 'text-ds-ink'
      displayedNo = newLineNo
      if (newLineNo != null) newLineNo += 1
    }
    numbered.push({ key: i, line, lineNo: displayedNo, cls })
  }

  return (
    <div
      className={`ds-card-strong flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] ${className}`}
    >
      <DiffHeader
        badge={badge}
        name={displayName}
        added={parsed.added}
        removed={parsed.removed}
        onCopy={onCopy}
        copied={copied}
      />
      <div
        ref={bodyRef}
        className={`min-w-0 font-mono text-ds-xs leading-6 ${
          fillParent
            ? 'min-h-0 flex-1 overflow-x-auto overflow-y-auto'
            : 'overflow-x-auto overflow-y-auto'
        }`}
        style={fillParent ? undefined : { maxHeight }}
      >
        {/* Keep rows at least as wide as the viewport while still allowing long
            lines to expand horizontally. */}
        <table className="w-max min-w-full border-collapse">
          <tbody>
            {numbered.map(({ key, line, lineNo, cls }) => (
              <tr key={key} className={cls}>
                <td
                  className="select-none px-2 text-right tabular-nums text-ds-faint"
                  style={{ width: '2.75rem' }}
                >
                  {lineNo ?? ''}
                </td>
                <td className="whitespace-pre px-3 pr-2">{rowIndices.has(key)
                  ? <><span className="select-none">{line[0]}</span><span data-code-row={rowIndices.get(key)}>{line.slice(1) || ' '}</span></>
                  : line || ' '}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectionAction}
    </div>
  )
}

function DiffHeader({
  badge,
  name,
  added,
  removed,
  onCopy,
  copied
}: {
  badge: { label: string; tone: string }
  name: string | null
  added: number | null
  removed: number | null
  onCopy: () => void
  copied: boolean
}): ReactElement {
  return (
    <div className="ds-panel-strip flex items-center gap-2.5 border-b border-ds-border-muted px-3 py-2">
      <span
        className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-ds-2xs font-semibold ${badge.tone}`}
      >
        {badge.label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-ds-sm font-medium text-ds-ink" title={name ?? ''}>
        {name ?? 'patch'}
      </span>
      {added != null || removed != null ? (
        <span className="shrink-0 font-mono text-ds-xs tabular-nums">
          {(added ?? 0) > 0 ? (
            <span className="text-ds-diff-added">+{added}</span>
          ) : null}
          {(added ?? 0) > 0 && (removed ?? 0) > 0 ? <span className="px-1 text-ds-faint">·</span> : null}
          {(removed ?? 0) > 0 ? (
            <span className="text-ds-diff-removed">-{removed}</span>
          ) : null}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onCopy}
        className="ds-chip-muted shrink-0 rounded-md p-1 text-ds-faint transition hover:text-ds-ink"
        aria-label="Copy diff"
        title="Copy diff"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-ds-diff-added" strokeWidth={2} />
        ) : (
          <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
      </button>
    </div>
  )
}
