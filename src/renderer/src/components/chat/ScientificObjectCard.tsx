import type { FormEvent, ReactElement, ReactNode } from 'react'
import { useId, useMemo, useState } from 'react'
import {
  Atom,
  BarChart3,
  Dna,
  ExternalLink,
  ImageIcon,
  MessageSquareQuote,
  Microscope,
  Plus,
  Tags,
  Trash2,
  Waves,
  type LucideIcon
} from 'lucide-react'
import type {
  ScientificObjectAnnotation,
  ScientificObjectModality,
  ScientificObjectRef
} from '@shared/scientific-objects'

export type ScientificObjectFact = {
  label: string
  value: string
}

export type ScientificObjectCardViewModel = {
  id: string
  modality: ScientificObjectModality
  modalityLabel: string
  title: string
  description?: string
  sourcePath?: string
  sourceLabel?: string
  formatLabel?: string
  provenanceLabel?: string
  facts: ScientificObjectFact[]
}

export type ScientificObjectCardLabels = {
  openWorkspace: string
  askAboutSelection: string
  selectionRequired: string
  annotations: string
  addAnnotation: string
  annotationPlaceholder: string
  saveAnnotation: string
  cancel: string
  deleteAnnotation: string
  unnamedObject: string
  unknownValue: string
}

export type ScientificObjectCardProps = {
  object: ScientificObjectRef
  selection?: unknown
  annotations?: readonly ScientificObjectAnnotation[]
  compact?: boolean
  className?: string
  labels?: Partial<ScientificObjectCardLabels>
  renderStaticPreview?: (object: ScientificObjectRef, fallback: ReactElement) => ReactNode
  onOpenWorkspace?: (object: ScientificObjectRef) => void
  onAskAboutSelection?: (object: ScientificObjectRef, selection: unknown) => void
  onAddAnnotation?: (object: ScientificObjectRef, text: string) => void
  onDeleteAnnotation?: (object: ScientificObjectRef, annotation: ScientificObjectAnnotation) => void
}

const DEFAULT_LABELS: ScientificObjectCardLabels = {
  openWorkspace: 'Open in workspace',
  askAboutSelection: 'Ask about current selection',
  selectionRequired: 'Select a chain, residue, atom, or ligand first',
  annotations: 'Annotations',
  addAnnotation: 'Add annotation',
  annotationPlaceholder: 'Record an observation…',
  saveAnnotation: 'Save annotation',
  cancel: 'Cancel',
  deleteAnnotation: 'Delete annotation',
  unnamedObject: 'Scientific object',
  unknownValue: 'Not reported'
}

const MODALITY_META: Record<ScientificObjectModality, { label: string; icon: LucideIcon; tone: string }> = {
  molecular: {
    label: 'Molecular structure',
    icon: Atom,
    tone: 'border-violet-400/25 bg-violet-500/10 text-violet-700 dark:text-violet-300'
  },
  sequence: {
    label: 'Sequence',
    icon: Dna,
    tone: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  },
  spectra: {
    label: 'Spectrum',
    icon: Waves,
    tone: 'border-amber-400/25 bg-amber-500/10 text-amber-800 dark:text-amber-200'
  },
  omics: {
    label: 'Omics dataset',
    icon: BarChart3,
    tone: 'border-cyan-400/25 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200'
  },
  bioimaging: {
    label: 'Bioimage',
    icon: Microscope,
    tone: 'border-rose-400/25 bg-rose-500/10 text-rose-700 dark:text-rose-300'
  }
}

type FactDefinition = {
  label: string
  keys: string[]
}

const FACT_DEFINITIONS: Record<ScientificObjectModality, FactDefinition[]> = {
  molecular: [
    { label: 'Models', keys: ['modelCount', 'models'] },
    { label: 'Chains', keys: ['chainCount', 'chains'] },
    { label: 'Residues', keys: ['residueCount', 'residues'] },
    { label: 'Atoms', keys: ['atomCount', 'atoms'] },
    { label: 'Ligands', keys: ['ligandCount', 'ligands'] },
    { label: 'Formula', keys: ['formula', 'molecularFormula'] }
  ],
  sequence: [
    { label: 'Sequences', keys: ['sequenceCount', 'recordCount', 'records'] },
    { label: 'Length', keys: ['totalLength', 'sequenceLength', 'length'] },
    { label: 'Alphabet', keys: ['alphabet', 'moleculeType', 'sequenceType'] },
    { label: 'Features', keys: ['featureCount', 'features'] },
    { label: 'References', keys: ['referenceCount', 'references'] }
  ],
  spectra: [
    { label: 'Spectra', keys: ['spectrumCount', 'spectra'] },
    { label: 'Peaks', keys: ['peakCount', 'sampledPeaks', 'peaks'] },
    { label: 'Scans', keys: ['scanCount', 'scanMarkers', 'scans'] },
    { label: 'X axis', keys: ['xAxis', 'xUnit'] },
    { label: 'm/z range', keys: ['mzRange', 'xRange'] },
    { label: 'Intensity', keys: ['intensityRange', 'yRange'] }
  ],
  omics: [
    { label: 'Format', keys: ['format', 'assay', 'assayType'] },
    { label: 'Matrix', keys: ['matrixShape', 'dimensions', 'shape'] },
    { label: 'Observations', keys: ['observationCount', 'sampleCount', 'nObs'] },
    { label: 'Variables', keys: ['variableCount', 'featureCount', 'geneCount', 'nVars'] },
    { label: 'Embeddings', keys: ['embeddingCount', 'embeddings'] },
    { label: 'Matrices', keys: ['matrixCount', 'matrixIds'] }
  ],
  bioimaging: [
    { label: 'Format', keys: ['format', 'imageFormat'] },
    { label: 'Dimensions', keys: ['dimensions', 'imageDimensions', 'shape'] },
    { label: 'Channels', keys: ['channelCount', 'channels'] },
    { label: 'Z slices', keys: ['z', 'zCount', 'sliceCount'] },
    { label: 'Time points', keys: ['t', 'frameCount', 'timepointCount'] },
    { label: 'Resolution', keys: ['pixelSize', 'resolution', 'voxelSize'] }
  ]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function readNonEmptyString(record: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!record) return undefined
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function readFirstValue(scopes: readonly (Record<string, unknown> | undefined)[], keys: readonly string[]): unknown {
  for (const scope of scopes) {
    if (!scope) continue
    for (const key of keys) {
      const value = scope[key]
      if (value !== undefined && value !== null && value !== '') return value
    }
  }
  return undefined
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value)
}

function formatArray(value: readonly unknown[]): string | undefined {
  if (value.length === 0) return undefined
  if (value.length === 2 && value.every((item) => typeof item === 'number')) {
    return `${compactNumber(value[0] as number)} × ${compactNumber(value[1] as number)}`
  }
  const readable = value
    .filter((item): item is string | number => typeof item === 'string' || typeof item === 'number')
    .slice(0, 3)
    .map((item) => typeof item === 'number' ? compactNumber(item) : item.trim())
    .filter(Boolean)
  if (readable.length === 0) return compactNumber(value.length)
  const preview = readable.join(', ')
  return value.length > readable.length ? `${compactNumber(value.length)} · ${preview}, …` : `${compactNumber(value.length)} · ${preview}`
}

function formatRecord(value: Record<string, unknown>): string | undefined {
  const min = typeof value.min === 'number' ? value.min : value.start
  const max = typeof value.max === 'number' ? value.max : value.end
  if (typeof min === 'number' && typeof max === 'number') {
    return `${compactNumber(min)}–${compactNumber(max)}`
  }
  const width = value.width
  const height = value.height
  if (typeof width === 'number' && typeof height === 'number') {
    const suffix = [
      typeof value.z === 'number' ? `Z=${compactNumber(value.z)}` : '',
      typeof value.t === 'number' ? `T=${compactNumber(value.t)}` : '',
      typeof value.c === 'number' ? `C=${compactNumber(value.c)}` : ''
    ].filter(Boolean).join(' · ')
    return `${compactNumber(width)} × ${compactNumber(height)}${suffix ? ` · ${suffix}` : ''}`
  }
  return undefined
}

export function formatScientificObjectFact(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number' && Number.isFinite(value)) return compactNumber(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return formatArray(value)
  const record = asRecord(value)
  return record ? formatRecord(record) : undefined
}

function normalizeModality(value: unknown): ScientificObjectModality {
  if (value === 'sequence' || value === 'spectra' || value === 'omics' || value === 'bioimaging') return value
  return 'molecular'
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || normalized
}

function clampText(value: string | undefined, max = 240): string | undefined {
  if (!value) return undefined
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1).trimEnd()}…` : normalized
}

function objectScopes(record: Record<string, unknown>, modality: ScientificObjectModality): Array<Record<string, unknown> | undefined> {
  const facts = asRecord(record.facts)
  const preview = asRecord(record.preview)
  const observation = asRecord(record.observation)
  return [
    asRecord(record[modality]),
    facts && asRecord(facts[modality]),
    preview && asRecord(preview[modality]),
    observation && asRecord(observation[modality]),
    facts,
    preview,
    observation,
    record
  ]
}

function fallbackFacts(scopes: readonly (Record<string, unknown> | undefined)[]): ScientificObjectFact[] {
  const ignored = new Set([
    'id', 'kind', 'type', 'modality', 'title', 'name', 'label', 'description', 'summary', 'path',
    'source', 'preview', 'observation', 'provenance', 'annotations', 'selection', 'actions', 'schemaVersion',
    'workspaceRoot', 'mimeType', 'hash', 'sessionId'
  ])
  const facts: ScientificObjectFact[] = []
  const seen = new Set<string>()
  for (const scope of scopes) {
    if (!scope) continue
    for (const [key, rawValue] of Object.entries(scope)) {
      if (ignored.has(key) || seen.has(key)) continue
      const value = formatScientificObjectFact(rawValue)
      if (!value) continue
      const label = key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/^./, (character) => character.toUpperCase())
      facts.push({ label, value })
      seen.add(key)
      if (facts.length === 4) return facts
    }
  }
  return facts
}

function sourceFormat(source: Record<string, unknown> | undefined): string | undefined {
  const mime = readNonEmptyString(source, 'mimeType', 'mime')
  const explicit = readNonEmptyString(source, 'format', 'extension')
  if (explicit) return explicit.toUpperCase()
  if (!mime) return undefined
  const subtype = mime.split('/').pop()?.split('+').shift()
  return subtype?.replace(/^x-/, '').toUpperCase()
}

function provenanceSummary(record: Record<string, unknown>): string | undefined {
  const provenance = asRecord(record.provenance)
  const generator = readNonEmptyString(provenance, 'creator', 'toolName', 'generator', 'provider', 'tool', 'model')
  const createdAt = readNonEmptyString(provenance, 'createdAt', 'timestamp', 'generatedAt')
  const hash = readNonEmptyString(asRecord(record.hash), 'digest')
    ?? readNonEmptyString(record, 'sha256', 'digest')
  const pieces = [
    generator,
    createdAt,
    hash ? `SHA-256 ${hash.length > 12 ? `${hash.slice(0, 12)}…` : hash}` : undefined
  ].filter((value): value is string => Boolean(value))
  return pieces.length > 0 ? pieces.join(' · ') : undefined
}

export function scientificObjectCardViewModel(object: ScientificObjectRef): ScientificObjectCardViewModel {
  const record = asRecord(object) ?? {}
  const observation = asRecord(record.observation)
  const view = observation && asRecord(observation.view)
  const modality = normalizeModality(record.modality ?? view?.modality)
  const scopes = objectScopes(record, modality)
  const sourcePath = readNonEmptyString(record, 'path', 'relativePath', 'absolutePath', 'uri')
    ?? readNonEmptyString(asRecord(observation?.file), 'path')
  const title = readNonEmptyString(record, 'title', 'label', 'name')
    ?? readNonEmptyString(view, 'title')
    ?? (sourcePath ? basename(sourcePath) : MODALITY_META[modality].label)
  const facts = FACT_DEFINITIONS[modality].flatMap(({ label, keys }) => {
    const value = formatScientificObjectFact(readFirstValue(scopes, keys))
    return value ? [{ label, value }] : []
  })
  const id = readNonEmptyString(record, 'id', 'objectId') ?? `${modality}:${sourcePath ?? title}`

  return {
    id,
    modality,
    modalityLabel: MODALITY_META[modality].label,
    title,
    description: clampText(
      readNonEmptyString(record, 'description', 'summary')
      ?? readNonEmptyString(asRecord(record.preview), 'description', 'summary')
      ?? readNonEmptyString(observation, 'visibleText')
    ),
    sourcePath,
    sourceLabel: sourcePath ? basename(sourcePath) : undefined,
    formatLabel: sourceFormat(record) ?? formatScientificObjectFact(readFirstValue(scopes, ['format'])),
    provenanceLabel: provenanceSummary(record),
    facts: facts.length > 0 ? facts : fallbackFacts(scopes)
  }
}

function annotationText(annotation: ScientificObjectAnnotation): string {
  const record = asRecord(annotation)
  return readNonEmptyString(record, 'text', 'body', 'content', 'summary', 'note') ?? 'Annotation'
}

function annotationId(annotation: ScientificObjectAnnotation, index: number): string {
  return readNonEmptyString(asRecord(annotation), 'id', 'annotationId') ?? `annotation-${index}`
}

function annotationMeta(annotation: ScientificObjectAnnotation): string | undefined {
  const record = asRecord(annotation)
  const authorValue = record && record.author
  const author = typeof authorValue === 'string'
    ? authorValue.trim()
    : readNonEmptyString(asRecord(authorValue), 'name', 'label', 'id')
      ?? readNonEmptyString(record, 'authorId')
  const timestamp = readNonEmptyString(record, 'updatedAt', 'createdAt', 'timestamp')
  return [author, timestamp].filter(Boolean).join(' · ') || undefined
}

function annotationsFromObject(object: ScientificObjectRef): readonly ScientificObjectAnnotation[] {
  const value = asRecord(object)?.annotations
  return Array.isArray(value) ? value as ScientificObjectAnnotation[] : []
}

function selectionFromObject(object: ScientificObjectRef): unknown {
  const record = asRecord(object)
  const direct = record?.selection
  if (direct !== undefined) return direct
  return asRecord(record?.observation)?.selection
}

function selectionHasContent(selection: unknown): boolean {
  const record = asRecord(selection)
  if (!record) return false
  return Object.entries(record).some(([key, value]) => {
    if (key === 'kind') return false
    if (Array.isArray(value)) return value.length > 0
    return value !== undefined && value !== null && value !== ''
  })
}

export function summarizeScientificObjectSelection(selection: unknown): string | undefined {
  const record = asRecord(selection)
  if (!record || !selectionHasContent(selection)) return undefined
  const kind = readNonEmptyString(record, 'kind')
  const details: string[] = []
  for (const key of ['chains', 'residues', 'atoms', 'ligands', 'ranges', 'features', 'peaks', 'channels', 'regions', 'roiIds', 'obsKeys', 'varKeys']) {
    const value = record[key]
    if (!Array.isArray(value) || value.length === 0) continue
    details.push(`${value.length} ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}`)
    if (details.length === 2) break
  }
  return [kind, ...details].filter(Boolean).join(' · ') || undefined
}

function mergeClassNames(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(' ')
}

function AnnotationList({
  object,
  annotations,
  labels,
  compact,
  onDelete
}: {
  object: ScientificObjectRef
  annotations: readonly ScientificObjectAnnotation[]
  labels: ScientificObjectCardLabels
  compact: boolean
  onDelete?: (object: ScientificObjectRef, annotation: ScientificObjectAnnotation) => void
}): ReactElement | null {
  if (annotations.length === 0) return null
  return (
    <section className="border-t border-ds-border-muted/70 px-3.5 py-3" aria-label={labels.annotations}>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
        <Tags className="h-3.5 w-3.5" aria-hidden="true" />
        {labels.annotations} · {annotations.length}
      </div>
      <ul className="space-y-1.5">
        {annotations.slice(0, compact ? 2 : 6).map((annotation, index) => {
          const text = annotationText(annotation)
          const meta = annotationMeta(annotation)
          return (
            <li key={annotationId(annotation, index)} className="group/annotation flex min-w-0 items-start gap-2 rounded-lg bg-ds-card-muted/45 px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="break-words text-[12.5px] leading-5 text-ds-muted">{text}</p>
                {meta ? <p className="mt-0.5 truncate text-[10.5px] text-ds-faint">{meta}</p> : null}
              </div>
              {onDelete ? (
                <button
                  type="button"
                  onClick={() => onDelete(object, annotation)}
                  aria-label={`${labels.deleteAnnotation}: ${text}`}
                  title={labels.deleteAnnotation}
                  className="-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-red-500/10 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function ScientificObjectCard({
  object,
  selection,
  annotations,
  compact = false,
  className,
  labels: labelOverrides,
  renderStaticPreview,
  onOpenWorkspace,
  onAskAboutSelection,
  onAddAnnotation,
  onDeleteAnnotation
}: ScientificObjectCardProps): ReactElement {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides }
  const model = useMemo(() => scientificObjectCardViewModel(object), [object])
  const [annotationEditorOpen, setAnnotationEditorOpen] = useState(false)
  const [annotationDraft, setAnnotationDraft] = useState('')
  const currentSelection = selection ?? selectionFromObject(object)
  const titleId = useId()
  const annotationInputId = useId()
  const resolvedAnnotations = annotations ?? annotationsFromObject(object)
  const meta = MODALITY_META[model.modality]
  const Icon = meta.icon
  const selectionSummary = summarizeScientificObjectSelection(currentSelection)

  const submitAnnotation = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const text = annotationDraft.trim()
    if (!text || !onAddAnnotation) return
    onAddAnnotation(object, text)
    setAnnotationDraft('')
    setAnnotationEditorOpen(false)
  }

  const displayedFacts = model.facts.slice(0, compact ? 4 : 6)
  const canAskAboutSelection = Boolean(selectionSummary)

  return (
    <article
      aria-labelledby={titleId}
      data-scientific-object-id={model.id}
      data-scientific-object-modality={model.modality}
      className={mergeClassNames(
        'w-full overflow-hidden rounded-[18px] border border-ds-border bg-ds-card/90 shadow-[0_10px_30px_rgba(51,65,85,0.08)] backdrop-blur-xl',
        compact && 'rounded-[15px] shadow-sm',
        className
      )}
    >
      <div className={mergeClassNames('flex min-w-0 items-start gap-3 px-3.5 pt-3.5', compact && 'gap-2.5 px-3 pt-3')}>
        <span className={mergeClassNames('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border', meta.tone, compact && 'h-9 w-9')}>
          <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-ds-border-muted bg-ds-card-muted/60 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ds-muted">
              {model.modalityLabel}
            </span>
            {model.formatLabel ? (
              <span className="rounded-full bg-ds-card-muted/55 px-2 py-0.5 font-mono text-[10.5px] text-ds-faint">{model.formatLabel}</span>
            ) : null}
          </div>
          <h3 id={titleId} className="mt-1.5 truncate text-[14px] font-semibold leading-5 text-ds-ink" title={model.title}>
            {model.title || labels.unnamedObject}
          </h3>
          {model.sourceLabel ? (
            <p className="mt-0.5 truncate font-mono text-[10.5px] text-ds-faint" title={model.sourcePath}>{model.sourceLabel}</p>
          ) : null}
        </div>
      </div>

      {!compact ? (
        <div className="px-3.5 pt-3">
          {renderStaticPreview?.(
            object,
            <ScientificObjectStaticPlaceholder modality={model.modality} />
          ) ?? <ScientificObjectStaticPlaceholder modality={model.modality} />}
        </div>
      ) : null}

      {model.description && !compact ? (
        <p className="mx-3.5 mt-2 line-clamp-2 break-words text-[12.5px] leading-5 text-ds-muted">{model.description}</p>
      ) : null}

      {displayedFacts.length > 0 ? (
        <dl className={mergeClassNames('grid grid-cols-2 gap-x-3 gap-y-2 px-3.5 py-3', compact && 'gap-y-1.5 px-3 py-2.5')}>
          {displayedFacts.map((fact) => (
            <div key={fact.label} className="min-w-0 rounded-lg bg-ds-card-muted/45 px-2.5 py-2">
              <dt className="truncate text-[10.5px] font-medium uppercase tracking-[0.06em] text-ds-faint">{fact.label}</dt>
              <dd className="mt-0.5 truncate text-[12.5px] font-semibold text-ds-ink" title={fact.value}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="px-3.5 py-3 text-[12px] text-ds-faint">
          {model.sourceLabel ?? model.formatLabel ?? labels.unknownValue}
        </div>
      )}

      {model.provenanceLabel && !compact ? (
        <p className="mx-3.5 mb-3 truncate text-[10.5px] text-ds-faint" title={model.provenanceLabel}>{model.provenanceLabel}</p>
      ) : null}

      {selectionSummary ? (
        <div className="flex items-center gap-1.5 border-t border-ds-border-muted/70 px-3.5 py-2 text-[11px] text-ds-muted">
          <MessageSquareQuote className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
          <span className="truncate" title={selectionSummary}>{selectionSummary}</span>
        </div>
      ) : null}

      <AnnotationList
        object={object}
        annotations={resolvedAnnotations}
        labels={labels}
        compact={compact}
        onDelete={onDeleteAnnotation}
      />

      {annotationEditorOpen && onAddAnnotation ? (
        <form onSubmit={submitAnnotation} className="border-t border-ds-border-muted/70 px-3.5 py-3">
          <label htmlFor={annotationInputId} className="sr-only">{labels.addAnnotation}</label>
          <textarea
            id={annotationInputId}
            value={annotationDraft}
            onChange={(event) => setAnnotationDraft(event.currentTarget.value)}
            rows={2}
            maxLength={2_000}
            placeholder={labels.annotationPlaceholder}
            className="block w-full resize-y rounded-xl border border-ds-border bg-ds-card-muted/40 px-3 py-2 text-[12.5px] leading-5 text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent/45 focus:ring-2 focus:ring-accent/10"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setAnnotationDraft('')
                setAnnotationEditorOpen(false)
              }}
              className="h-8 rounded-lg px-3 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover"
            >
              {labels.cancel}
            </button>
            <button
              type="submit"
              disabled={!annotationDraft.trim()}
              className="h-8 rounded-lg bg-accent px-3 text-[12px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {labels.saveAnnotation}
            </button>
          </div>
        </form>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-ds-border-muted/70 px-2.5 py-2">
        {onOpenWorkspace ? (
          <button
            type="button"
            onClick={() => onOpenWorkspace(object)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-semibold text-ds-ink transition hover:bg-ds-hover"
          >
            <ExternalLink className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            {labels.openWorkspace}
          </button>
        ) : null}
        {onAskAboutSelection ? (
          <button
            type="button"
            disabled={!canAskAboutSelection}
            onClick={() => {
              if (canAskAboutSelection) onAskAboutSelection(object, currentSelection)
            }}
            title={canAskAboutSelection ? labels.askAboutSelection : labels.selectionRequired}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
          >
            <MessageSquareQuote className="h-3.5 w-3.5" aria-hidden="true" />
            {labels.askAboutSelection}
          </button>
        ) : null}
        {onAddAnnotation && !annotationEditorOpen ? (
          <button
            type="button"
            onClick={() => setAnnotationEditorOpen(true)}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {labels.addAnnotation}
          </button>
        ) : null}
      </div>
    </article>
  )
}

export function ScientificObjectStaticPlaceholder({ modality }: { modality: ScientificObjectModality }): ReactElement {
  const meta = MODALITY_META[modality]
  const Icon = modality === 'bioimaging' ? ImageIcon : meta.icon
  return (
    <div className={mergeClassNames('flex h-28 items-center justify-center rounded-xl border', meta.tone)} aria-label={meta.label}>
      <Icon className="h-8 w-8" strokeWidth={1.5} aria-hidden="true" />
    </div>
  )
}
