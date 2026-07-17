import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Braces, ChevronDown, ChevronRight, Database, Download, ExternalLink, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { previewWorkspaceFile } from '../../lib/workspace-file-preview'

type DatasetResultKind = 'metadata' | 'raw-data' | 'catalog' | 'sources' | 'plan' | 'profile' | 'processing' | 'validation' | 'publication' | 'other'

export type TimelineDatasetResult = {
  id: string
  toolName: string
  kind: DatasetResultKind
  success: boolean
  result?: Record<string, unknown>
  error?: Record<string, unknown>
}

export function datasetResultsFromTimelineBlocks(
  blocks: readonly ChatBlock[]
): TimelineDatasetResult[] {
  const results: TimelineDatasetResult[] = []
  for (const block of blocks) {
    if (block.kind !== 'tool' || block.status === 'running') continue
    const parsed = datasetResultFromToolBlock(block)
    if (parsed) results.push(parsed)
  }
  return results
}

function datasetResultFromToolBlock(block: ToolBlock): TimelineDatasetResult | null {
  const meta = asRecord(block.meta)
  const explicit = asRecord(meta?.datasetApi)
  const toolName = normalizeDatasetToolName(
    stringValue(explicit?.toolName) || stringValue(meta?.toolName) || block.summary
  )
  if (!toolName) return null

  const structured = explicit ?? structuredDatasetContent(meta?.output) ?? structuredDatasetContent(block.detail)
  const result = asRecord(structured?.result)
  const error = asRecord(structured?.error)
  if (!result && !error) return null
  return {
    id: block.id,
    toolName,
    kind: datasetKind(toolName, result),
    success: block.status === 'success' && explicit?.success !== false && !error,
    ...(result ? { result } : {}),
    ...(error ? { error } : {})
  }
}

function structuredDatasetContent(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 4 || value === undefined || value === null) return null
  if (typeof value === 'string') {
    const marker = 'structuredContent:\n'
    const markerIndex = value.indexOf(marker)
    const candidate = markerIndex >= 0 ? value.slice(markerIndex + marker.length) : value.trim()
    if (!candidate.startsWith('{') && !candidate.startsWith('[')) return null
    try {
      return structuredDatasetContent(JSON.parse(candidate) as unknown, depth + 1)
    } catch {
      return null
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = structuredDatasetContent(item, depth + 1)
      if (found) return found
    }
    return null
  }
  const record = asRecord(value)
  if (!record) return null
  if (record.result !== undefined || record.error !== undefined) return record
  for (const key of ['structuredContent', 'output', 'content', 'datasetApi']) {
    const found = structuredDatasetContent(record[key], depth + 1)
    if (found) return found
  }
  if (record.type === 'text' || record.type === 'inputText' || record.type === 'outputText') {
    return structuredDatasetContent(record.text, depth + 1)
  }
  return null
}

function normalizeDatasetToolName(value: string): string | null {
  const match = value.match(/dataset_(api_(?:catalog|register_provider|list|register|metadata|raw_data)|prepare_plan|profile|filter|select_columns|transform|deduplicate|id_map|join|validate|publish)/i)
  return match ? `dataset_${match[1].toLowerCase()}` : null
}

function datasetKind(toolName: string, result: Record<string, unknown> | null): DatasetResultKind {
  if (toolName === 'dataset_prepare_plan' || result?.plan !== undefined) return 'plan'
  if (toolName === 'dataset_profile' || result?.profile !== undefined) return 'profile'
  if (toolName === 'dataset_validate' || result?.validation !== undefined) return 'validation'
  if (toolName === 'dataset_publish' || result?.publication !== undefined) return 'publication'
  if (['dataset_filter', 'dataset_select_columns', 'dataset_transform', 'dataset_deduplicate', 'dataset_id_map', 'dataset_join'].includes(toolName)) return 'processing'
  if (toolName.endsWith('_metadata') || result?.metadata !== undefined) return 'metadata'
  if (toolName.endsWith('_raw_data') || result?.artifact !== undefined) return 'raw-data'
  if (toolName.endsWith('_catalog') || Array.isArray(result?.providers)) return 'catalog'
  if (toolName.endsWith('_list') || Array.isArray(result?.sources)) return 'sources'
  return 'other'
}

export function TimelineDatasetResultsPanel({
  blocks,
  workspaceRoot
}: {
  blocks: ChatBlock[]
  workspaceRoot?: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  const items = useMemo(() => datasetResultsFromTimelineBlocks(blocks), [blocks])
  if (items.length === 0) return null

  return (
    <section
      className="flex w-full max-w-2xl flex-col gap-3"
      aria-label={t('datasetResultRegion')}
      data-timeline-dataset-results
    >
      {items.map((item) => (
        <DatasetResultCard key={item.id} item={item} workspaceRoot={workspaceRoot} />
      ))}
    </section>
  )
}

function DatasetResultCard({
  item,
  workspaceRoot
}: {
  item: TimelineDatasetResult
  workspaceRoot?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(item.kind === 'metadata')
  const result = item.result
  const source = asRecord(result?.source)
  const request = asRecord(result?.request)
  const response = asRecord(result?.response)
  const artifact = asRecord(result?.artifact)
  const publication = asRecord(result?.publication)
  const title = stringValue(source?.name) || stringValue(source?.id) || datasetKindTitle(item.kind, t)
  const subtitle = item.success
    ? datasetSuccessSubtitle(item.kind, result, response, t)
    : stringValue(item.error?.message) || t('datasetResultFailed')
  const rawPath = stringValue(artifact?.path) || stringValue(publication?.manifestPath)
  const details = datasetDetails(item)
  const contentType = stringValue(response?.contentType)
  const format = stringValue(artifact?.format)
  const sha256 = stringValue(artifact?.sha256)
  const facts = datasetFacts(item.kind, result, response, artifact, t)

  return (
    <article className="overflow-hidden rounded-[20px] border border-ds-border bg-ds-card/85 shadow-[0_16px_40px_rgba(86,103,136,0.08)] backdrop-blur-xl">
      <div className="flex items-start gap-3 px-5 py-4">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] ${
          item.success
            ? item.kind === 'raw-data' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
            : 'bg-red-500/10 text-red-600 dark:text-red-300'
        }`}>
          {item.success
            ? item.kind === 'raw-data' ? <Download className="h-5 w-5" /> : <Database className="h-5 w-5" />
            : <TriangleAlert className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold text-ds-ink">{title}</h3>
            <DatasetBadge>{datasetKindTitle(item.kind, t)}</DatasetBadge>
            {numberValue(response?.status) ? <DatasetBadge>{`HTTP ${numberValue(response?.status)}`}</DatasetBadge> : null}
            {result?.metadataTruncated === true ? <DatasetBadge>{t('datasetResultSummary')}</DatasetBadge> : null}
          </div>
          <p className={`mt-1 break-words text-[12.5px] ${item.success ? 'text-ds-muted' : 'text-red-600 dark:text-red-300'}`}>
            {subtitle}
          </p>
          {stringValue(request?.url) ? (
            <p className="mt-1 truncate font-mono text-[11px] text-ds-faint" title={stringValue(request?.url)}>
              {stringValue(request?.url)}
            </p>
          ) : null}
          {facts.length > 0 ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              {facts.map((fact) => (
                <div key={fact.label} className="min-w-0">
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ds-faint">{fact.label}</dt>
                  <dd className="mt-0.5 truncate text-[12px] font-medium text-ds-ink" title={fact.value}>{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {rawPath ? (
          <button
            type="button"
            onClick={() => previewWorkspaceFile({ path: rawPath, workspaceRoot })}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('datasetResultOpenFile')}
          </button>
        ) : null}
      </div>

      {item.success && item.kind === 'metadata' && result?.metadata !== undefined ? (
        <DatasetMetadataHighlights metadata={result.metadata} />
      ) : null}

      {item.success && item.kind === 'raw-data' && rawPath ? (
        <DatasetRawDataPreview
          path={rawPath}
          workspaceRoot={workspaceRoot}
          format={format}
          contentType={contentType}
          sha256={sha256}
        />
      ) : null}

      {item.success && ['plan', 'profile', 'processing', 'validation', 'publication'].includes(item.kind) ? (
        <DatasetProcessingHighlights item={item} />
      ) : null}

      {details !== undefined ? (
        <div className="border-t border-ds-border-muted/70">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="flex w-full items-center gap-2 px-5 py-2.5 text-left text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover/40"
          >
            <Braces className="h-3.5 w-3.5" />
            <span className="flex-1">{item.kind === 'metadata' ? t('datasetResultMetadata') : t('datasetResultDetails')}</span>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {expanded ? (
            <pre className="max-h-80 overflow-auto border-t border-ds-border-muted/60 bg-ds-card-muted/35 px-5 py-4 font-mono text-[11.5px] leading-5 text-ds-muted">
              {JSON.stringify(details, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function DatasetProcessingHighlights({ item }: { item: TimelineDatasetResult }): ReactElement | null {
  const { t } = useTranslation('common')
  const result = item.result
  const profile = asRecord(result?.profile)
  const counts = asRecord(result?.counts)
  const validation = asRecord(result?.validation)
  const publication = asRecord(result?.publication)
  const plan = asRecord(result?.plan)
  const values: Array<{ label: string; value: string }> = []
  if (numberValue(profile?.records) !== undefined) values.push({ label: t('datasetResultRecords'), value: String(numberValue(profile?.records)) })
  if (numberValue(counts?.inputRecords) !== undefined) values.push({ label: t('datasetResultInputRecords'), value: String(numberValue(counts?.inputRecords)) })
  if (numberValue(counts?.outputRecords) !== undefined) values.push({ label: t('datasetResultOutputRecords'), value: String(numberValue(counts?.outputRecords)) })
  if (numberValue(counts?.excludedRecords) !== undefined) values.push({ label: t('datasetResultExcludedRecords'), value: String(numberValue(counts?.excludedRecords)) })
  if (numberValue(counts?.duplicateRecordsRemoved) !== undefined) values.push({ label: t('datasetResultDuplicatesRemoved'), value: String(numberValue(counts?.duplicateRecordsRemoved)) })
  if (numberValue(counts?.leftRecords) !== undefined) values.push({ label: t('datasetResultLeftRecords'), value: String(numberValue(counts?.leftRecords)) })
  if (numberValue(counts?.rightRecords) !== undefined) values.push({ label: t('datasetResultRightRecords'), value: String(numberValue(counts?.rightRecords)) })
  if (numberValue(counts?.unmatchedLeftRecords) !== undefined) values.push({ label: t('datasetResultUnmatchedLeft'), value: String(numberValue(counts?.unmatchedLeftRecords)) })
  if (numberValue(counts?.unmatchedRightRecords) !== undefined) values.push({ label: t('datasetResultUnmatchedRight'), value: String(numberValue(counts?.unmatchedRightRecords)) })
  if (numberValue(counts?.mappedRecords) !== undefined) values.push({ label: t('datasetResultMappedRecords'), value: String(numberValue(counts?.mappedRecords)) })
  if (numberValue(counts?.unmatchedRecords) !== undefined) values.push({ label: t('datasetResultUnmatchedRecords'), value: String(numberValue(counts?.unmatchedRecords)) })
  if (numberValue(counts?.ambiguousRecords) !== undefined) values.push({ label: t('datasetResultAmbiguousRecords'), value: String(numberValue(counts?.ambiguousRecords)) })
  if (Array.isArray(result?.operations)) values.push({ label: t('datasetResultOperations'), value: String(result.operations.length) })
  if (validation) values.push({ label: t('datasetResultQuality'), value: validation.valid === true ? t('datasetResultValid') : t('datasetResultInvalid') })
  if (numberValue(validation?.errorCount) !== undefined) values.push({ label: t('datasetResultErrors'), value: String(numberValue(validation?.errorCount)) })
  if (numberValue(publication?.artifactCount) !== undefined) values.push({ label: t('datasetResultArtifacts'), value: String(numberValue(publication?.artifactCount)) })
  if (stringValue(plan?.status)) values.push({ label: t('datasetResultPlanStatus'), value: stringValue(plan?.status) })
  if (values.length === 0) return null
  return (
    <div className="border-t border-ds-border-muted/70 bg-violet-500/[0.025] px-5 py-3">
      <dl className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
        {values.slice(0, 8).map((entry) => (
          <div key={entry.label} className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ds-faint">{entry.label}</dt>
            <dd className="mt-0.5 truncate text-[12px] font-medium text-ds-ink">{entry.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function DatasetMetadataHighlights({ metadata }: { metadata: unknown }): ReactElement | null {
  const highlights = metadataHighlights(metadata)
  if (highlights.length === 0) return null
  return (
    <div className="border-t border-ds-border-muted/70 bg-emerald-500/[0.025] px-5 py-3">
      <dl className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
        {highlights.map((highlight) => (
          <div key={highlight.label} className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ds-faint">{highlight.label}</dt>
            <dd className="mt-0.5 truncate text-[12px] font-medium text-ds-ink" title={highlight.value}>{highlight.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function DatasetRawDataPreview({
  path,
  workspaceRoot,
  format,
  contentType,
  sha256
}: {
  path: string
  workspaceRoot?: string
  format: string
  contentType: string
  sha256: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  const [preview, setPreview] = useState<string>('')
  const [previewError, setPreviewError] = useState<string>('')
  const supported = isTextDatasetFormat(format, contentType, path)

  useEffect(() => {
    let cancelled = false
    setPreview('')
    setPreviewError('')
    if (!supported || typeof window.sciforge?.readWorkspaceFile !== 'function') return () => { cancelled = true }
    void window.sciforge.readWorkspaceFile({ path, workspaceRoot })
      .then((read) => {
        if (cancelled) return
        if (!read.ok) {
          setPreviewError(read.message)
          return
        }
        if (read.kind !== 'text') return
        setPreview(datasetTextPreview(read.content, format, path))
      })
      .catch((error: unknown) => {
        if (!cancelled) setPreviewError(error instanceof Error ? error.message : String(error))
      })
    return () => { cancelled = true }
  }, [contentType, format, path, supported, workspaceRoot])

  if (!supported && !sha256) return null
  return (
    <div className="border-t border-ds-border-muted/70 bg-sky-500/[0.025] px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ds-muted">
        {sha256 ? <span className="font-mono" title={sha256}>SHA-256 {shortHash(sha256)}</span> : null}
        <span className="min-w-0 truncate font-mono" title={path}>{path}</span>
      </div>
      {preview ? (
        <pre data-dataset-raw-preview className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-ds-border-muted bg-ds-card/70 px-3.5 py-3 font-mono text-[11px] leading-5 text-ds-muted">
          {preview}
        </pre>
      ) : previewError ? (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-300">{t('datasetResultPreviewUnavailable')}: {previewError}</p>
      ) : null}
    </div>
  )
}

function DatasetBadge({ children }: { children: string }): ReactElement {
  return <span className="rounded-md border border-ds-border-muted bg-ds-card-muted/60 px-1.5 py-0.5 text-[10.5px] font-medium text-ds-muted">{children}</span>
}

function datasetDetails(item: TimelineDatasetResult): unknown {
  if (item.error) return item.error
  if (!item.result) return undefined
  if (item.kind === 'metadata') return item.result.metadata
  if (item.kind === 'catalog') return item.result.providers
  if (item.kind === 'sources') return item.result.sources
  if (item.kind === 'raw-data') {
    return {
      artifact: item.result.artifact,
      response: item.result.response,
      resolvedFrom: asRecord(item.result.request)?.resolvedFrom
    }
  }
  return item.result
}

function datasetKindTitle(kind: DatasetResultKind, t: (key: string) => string): string {
  if (kind === 'metadata') return t('datasetResultMetadata')
  if (kind === 'raw-data') return t('datasetResultRawData')
  if (kind === 'catalog') return t('datasetResultCatalog')
  if (kind === 'sources') return t('datasetResultSources')
  if (kind === 'plan') return t('datasetResultPlan')
  if (kind === 'profile') return t('datasetResultProfile')
  if (kind === 'processing') return t('datasetResultProcessing')
  if (kind === 'validation') return t('datasetResultValidation')
  if (kind === 'publication') return t('datasetResultPublication')
  return t('datasetResultDatabase')
}

function datasetSuccessSubtitle(
  kind: DatasetResultKind,
  result: Record<string, unknown> | undefined,
  response: Record<string, unknown> | null,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const bytes = numberValue(response?.bytes)
  if (kind === 'metadata') return t('datasetResultMetadataLoaded', { bytes: formatBytes(bytes) })
  if (kind === 'raw-data') {
    const artifact = asRecord(result?.artifact)
    return t('datasetResultRawSaved', {
      bytes: formatBytes(bytes),
      format: stringValue(artifact?.format).toUpperCase() || t('datasetResultUnknownFormat')
    })
  }
  if (kind === 'catalog') return t('datasetResultProvidersCount', { count: arrayValue(result?.providers).length })
  if (kind === 'sources') return t('datasetResultSourcesCount', { count: arrayValue(result?.sources).length })
  if (kind === 'plan') return t('datasetResultPlanPrepared')
  if (kind === 'profile') return t('datasetResultProfileCompleted')
  if (kind === 'processing') return t('datasetResultProcessingCompleted')
  if (kind === 'validation') return asRecord(result?.validation)?.valid === true
    ? t('datasetResultValidationPassed')
    : t('datasetResultValidationFailed')
  if (kind === 'publication') return t('datasetResultPublished')
  return t('datasetResultCompleted')
}

function datasetFacts(
  kind: DatasetResultKind,
  result: Record<string, unknown> | undefined,
  response: Record<string, unknown> | null,
  artifact: Record<string, unknown> | null,
  t: (key: string) => string
): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = []
  const status = numberValue(response?.status)
  const bytes = numberValue(response?.bytes)
  const contentType = stringValue(response?.contentType)
  const format = stringValue(artifact?.format)
  const artifactBytes = numberValue(artifact?.bytes)
  if (status !== undefined) facts.push({ label: t('datasetResultHttpStatus'), value: String(status) })
  if (bytes !== undefined || artifactBytes !== undefined) facts.push({ label: t('datasetResultSize'), value: formatBytes(bytes ?? artifactBytes) })
  if (format) facts.push({ label: t('datasetResultFormat'), value: format.toUpperCase() })
  if (contentType) facts.push({ label: t('datasetResultContentType'), value: contentType })
  if (kind === 'raw-data' && stringValue(artifact?.fileName)) {
    facts.push({ label: t('datasetResultFile'), value: stringValue(artifact?.fileName) })
  }
  const plan = asRecord(result?.plan)
  if (stringValue(plan?.planId)) facts.push({ label: t('datasetResultPlan'), value: stringValue(plan?.planId) })
  return facts.slice(0, 4)
}

export function metadataHighlights(metadata: unknown): Array<{ label: string; value: string }> {
  const record = asRecord(metadata)
  if (!record) return []
  const organism = asRecord(record.organism)
  const sequence = asRecord(record.sequence)
  const genes = Array.isArray(record.genes)
    ? record.genes
    : arrayValue(asRecord(record.genes)?.sample)
  const firstGene = asRecord(genes[0])
  const geneName = asRecord(firstGene?.geneName)
  const values: Array<[string, unknown]> = [
    ['Accession', record.primaryAccession ?? record.accession ?? record.id],
    ['Gene', geneName?.value ?? firstGene?.display_name ?? record.display_name],
    ['Organism', organism?.scientificName ?? organism?.display_name ?? record.species],
    ['Sequence', numberValue(sequence?.length) !== undefined ? `${numberValue(sequence?.length)} aa` : undefined],
    ['Assembly', record.assembly_name],
    ['Region', genomicRegion(record)]
  ]
  return values
    .flatMap(([label, value]) => {
      const normalized = stringOrNumber(value)
      return normalized ? [{ label, value: normalized }] : []
    })
    .slice(0, 4)
}

function genomicRegion(record: Record<string, unknown>): string {
  const region = stringValue(record.seq_region_name)
  const start = numberValue(record.start)
  const end = numberValue(record.end)
  if (!region || start === undefined || end === undefined) return ''
  return `${region}:${start}-${end}`
}

export function datasetTextPreview(content: string, format: string, path: string): string {
  const normalizedFormat = format.toLowerCase() || path.split('.').at(-1)?.toLowerCase() || ''
  const bounded = content.slice(0, 12_000)
  if (normalizedFormat === 'json') {
    try {
      return JSON.stringify(JSON.parse(bounded) as unknown, null, 2).slice(0, 8_000)
    } catch {
      return bounded.slice(0, 8_000)
    }
  }
  const maxLines = normalizedFormat === 'fasta' || normalizedFormat === 'fa' || normalizedFormat === 'faa' ? 10 : 18
  return bounded.split(/\r?\n/u).slice(0, maxLines).join('\n').slice(0, 8_000)
}

function isTextDatasetFormat(format: string, contentType: string, path: string): boolean {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  return ['fasta', 'fa', 'faa', 'fastq', 'fq', 'json', 'csv', 'tsv', 'txt', 'xml', 'bed', 'gff', 'gff3', 'vcf'].includes(format.toLowerCase()) ||
    ['fasta', 'fa', 'faa', 'fastq', 'fq', 'json', 'csv', 'tsv', 'txt', 'xml', 'bed', 'gff', 'gff3', 'vcf'].includes(extension) ||
    contentType.toLowerCase().startsWith('text/') || contentType.toLowerCase().includes('json')
}

function shortHash(value: string): string {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value
}

function stringOrNumber(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
