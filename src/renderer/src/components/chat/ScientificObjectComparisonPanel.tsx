import type { CSSProperties, ReactElement } from 'react'
import { ExternalLink, GitCompareArrows } from 'lucide-react'
import type {
  ScientificObjectComparison,
  ScientificObjectRef
} from '@shared/scientific-objects'
import {
  scientificObjectCardViewModel,
  type ScientificObjectCardViewModel
} from './ScientificObjectCard'

export type ScientificObjectComparisonPanelLabels = {
  comparison: string
  object: string
  modality: string
  source: string
  format: string
  openObject: string
  empty: string
  needsMoreObjects: string
  unknownValue: string
}

export type ScientificObjectComparisonPanelProps = {
  comparison: ScientificObjectComparison
  className?: string
  labels?: Partial<ScientificObjectComparisonPanelLabels>
  onOpenObject?: (object: ScientificObjectRef) => void
}

type ComparisonRow = {
  key: string
  label: string
  values: string[]
}

export type ScientificObjectComparisonViewModel = {
  id: string
  title: string
  objects: Array<ScientificObjectCardViewModel & { object: ScientificObjectRef }>
  rows: ComparisonRow[]
}

const DEFAULT_LABELS: ScientificObjectComparisonPanelLabels = {
  comparison: 'Scientific object comparison',
  object: 'Object',
  modality: 'Modality',
  source: 'Source',
  format: 'Format',
  openObject: 'Open object',
  empty: 'No scientific objects to compare.',
  needsMoreObjects: 'Add at least one more object to compare.',
  unknownValue: '—'
}

function rowKey(label: string): string {
  return label.trim().toLocaleLowerCase()
}

/** Builds a union of core facts so mixed-modality comparisons remain meaningful. */
export function scientificObjectComparisonViewModel(
  comparison: ScientificObjectComparison,
  labels: ScientificObjectComparisonPanelLabels = DEFAULT_LABELS
): ScientificObjectComparisonViewModel {
  const objects = comparison.objects.map((object) => ({
    object,
    ...scientificObjectCardViewModel(object)
  }))
  const factLabels = new Map<string, string>()
  for (const model of objects) {
    for (const fact of model.facts) {
      const key = rowKey(fact.label)
      if (!factLabels.has(key)) factLabels.set(key, fact.label)
    }
  }
  const rows: ComparisonRow[] = [
    {
      key: 'modality',
      label: labels.modality,
      values: objects.map((model) => model.modalityLabel)
    },
    {
      key: 'source',
      label: labels.source,
      values: objects.map((model) => model.sourceLabel ?? labels.unknownValue)
    },
    {
      key: 'format',
      label: labels.format,
      values: objects.map((model) => model.formatLabel ?? labels.unknownValue)
    },
    ...[...factLabels.entries()].map(([key, label]) => ({
      key: `fact:${key}`,
      label,
      values: objects.map((model) => model.facts.find((fact) => rowKey(fact.label) === key)?.value ?? labels.unknownValue)
    }))
  ]
  return {
    id: comparison.id,
    title: comparison.title?.trim() || labels.comparison,
    objects,
    rows
  }
}

function mergeClassNames(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(' ')
}

export function ScientificObjectComparisonPanel({
  comparison,
  className,
  labels: labelOverrides,
  onOpenObject
}: ScientificObjectComparisonPanelProps): ReactElement {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides }
  const model = scientificObjectComparisonViewModel(comparison, labels)
  const tableMinWidth = Math.max(520, 156 + model.objects.length * 190)

  return (
    <section
      aria-labelledby={`${model.id}-comparison-title`}
      data-scientific-object-comparison-id={model.id}
      className={mergeClassNames(
        'w-full overflow-hidden rounded-[20px] border border-ds-border bg-ds-card/90 shadow-[0_12px_34px_rgba(51,65,85,0.08)] backdrop-blur-xl',
        className
      )}
    >
      <header className="flex min-w-0 items-center gap-3 border-b border-ds-border-muted/70 px-4 py-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
          <GitCompareArrows className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${model.id}-comparison-title`} className="truncate text-[14px] font-semibold text-ds-ink">{model.title}</h2>
          <p className="mt-0.5 text-[11.5px] text-ds-faint">
            {model.objects.length} {model.objects.length === 1 ? labels.object : `${labels.object}s`}
          </p>
        </div>
      </header>

      {model.objects.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-ds-muted">{labels.empty}</p>
      ) : (
        <div className="overflow-x-auto overscroll-x-contain" tabIndex={0} aria-label={model.title}>
          <table className="w-full table-fixed border-collapse text-left" style={{ minWidth: tableMinWidth } as CSSProperties}>
            <thead>
              <tr className="bg-ds-card-muted/45">
                <th scope="col" className="w-[156px] border-b border-r border-ds-border-muted/70 px-3 py-3 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ds-faint">
                  {labels.object}
                </th>
                {model.objects.map((item) => (
                  <th key={item.id} scope="col" className="border-b border-r border-ds-border-muted/70 px-3 py-3 last:border-r-0">
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-semibold text-ds-ink" title={item.title}>{item.title}</div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="truncate text-[10.5px] text-ds-faint">{item.modalityLabel}</span>
                        {onOpenObject ? (
                          <button
                            type="button"
                            onClick={() => onOpenObject(item.object)}
                            aria-label={`${labels.openObject}: ${item.title}`}
                            title={labels.openObject}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-accent transition hover:bg-accent/10"
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => (
                <tr key={row.key} className="odd:bg-transparent even:bg-ds-card-muted/20">
                  <th scope="row" className="border-b border-r border-ds-border-muted/60 px-3 py-2.5 text-[11px] font-semibold text-ds-muted">
                    {row.label}
                  </th>
                  {row.values.map((value, index) => (
                    <td key={`${row.key}:${model.objects[index]?.id ?? index}`} className="border-b border-r border-ds-border-muted/60 px-3 py-2.5 text-[12px] text-ds-ink last:border-r-0">
                      <span className="block truncate" title={value}>{value}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {model.objects.length === 1 ? (
        <p role="status" className="border-t border-ds-border-muted/70 px-4 py-2.5 text-[11.5px] text-amber-700 dark:text-amber-300">
          {labels.needsMoreObjects}
        </p>
      ) : null}
    </section>
  )
}
