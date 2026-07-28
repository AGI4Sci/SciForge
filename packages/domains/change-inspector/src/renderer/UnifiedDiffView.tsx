import { useMemo, useState, type ReactElement } from 'react'
import { Check, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { countDiffStats, extractDiffFilePath } from './diff-utils.js'

export function UnifiedDiffView({
  patch,
  filePath,
  className = ''
}: {
  patch: string
  filePath?: string
  className?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const [copied, setCopied] = useState(false)
  const path = extractDiffFilePath(patch, filePath)
  const stats = useMemo(() => countDiffStats(patch), [patch])
  const rows = useMemo(() => diffRows(patch), [patch])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(patch)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_400)
    } catch {
      // Clipboard access is optional and never affects inspection.
    }
  }

  return (
    <div className={`ds-card-strong flex min-h-0 min-w-0 flex-col overflow-hidden ${className}`}>
      <div className="ds-panel-strip flex items-center gap-2.5 border-b border-ds-border-muted px-3 py-2">
        <span
          className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-ds-ink"
          title={path ?? ''}
        >
          {path?.split(/[/\\]/).pop() ?? 'patch'}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums">
          <span className="text-ds-diff-added">+{stats.added}</span>
          <span className="px-1 text-ds-faint">·</span>
          <span className="text-ds-diff-removed">-{stats.removed}</span>
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="ds-chip-muted shrink-0 rounded-md p-1 text-ds-faint transition hover:text-ds-ink"
          aria-label={t('changeInspectorCopyDiff')}
          title={t('changeInspectorCopyDiff')}
        >
          {copied
            ? <Check className="h-3.5 w-3.5 text-ds-diff-added" strokeWidth={2} />
            : <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />}
        </button>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto font-mono text-[11.5px] leading-6">
        <table className="w-max min-w-full border-collapse">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={row.className}>
                <td
                  className="select-none px-2 text-right tabular-nums text-ds-faint"
                  style={{ width: '2.75rem' }}
                >
                  {row.lineNumber ?? ''}
                </td>
                <td className="whitespace-pre px-3 pr-2">{row.text || ' '}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type DiffRow = Readonly<{
  key: number
  text: string
  lineNumber: number | null
  className: string
}>

function diffRows(patch: string): DiffRow[] {
  const visibleLines = patch.split('\n').filter((line) =>
    !line.startsWith('diff --git ') &&
    !line.startsWith('index ') &&
    !line.startsWith('--- ') &&
    !line.startsWith('+++ ')
  )
  let nextLine: number | null = null
  return visibleLines.map((line, key) => {
    if (line.startsWith('@@')) {
      const match = line.match(/\+(\d+)/)
      nextLine = match?.[1] ? Number.parseInt(match[1], 10) : null
      return {
        key,
        text: line,
        lineNumber: null,
        className: 'bg-accent-soft/60 text-ds-muted'
      }
    }
    if (line.startsWith('+')) {
      const lineNumber = nextLine
      if (nextLine !== null) nextLine += 1
      return {
        key,
        text: line,
        lineNumber,
        className: 'bg-ds-diff-added-soft text-ds-diff-added'
      }
    }
    if (line.startsWith('-')) {
      return {
        key,
        text: line,
        lineNumber: null,
        className: 'bg-ds-diff-removed-soft text-ds-diff-removed'
      }
    }
    const lineNumber = nextLine
    if (nextLine !== null) nextLine += 1
    return { key, text: line, lineNumber, className: 'text-ds-ink' }
  })
}
