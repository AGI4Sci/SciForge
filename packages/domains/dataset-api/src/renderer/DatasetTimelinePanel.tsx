import { useMemo, useState, type ReactElement } from 'react'
import { Braces, CheckCircle2, ChevronDown, ChevronRight, Circle, CircleX, Database, Download, ExternalLink, RotateCcw, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type DatasetTimelineBlock = Readonly<{
  kind: string
  id: string
  status?: string
  summary?: string
  detail?: unknown
  meta?: unknown
}>

type DatasetToolBlock = DatasetTimelineBlock & Readonly<{ kind: 'tool' }>
type OpenDatasetArtifact = (path: string) => void

type DatasetResultKind = 'metadata' | 'raw-data' | 'catalog' | 'sources' | 'object-stores' | 'objects' | 'plan' | 'execution' | 'profile' | 'processing' | 'validation' | 'publication' | 'other'

export type TimelineDatasetResult = {
  id: string
  toolName: string
  kind: DatasetResultKind
  success: boolean
  result?: Record<string, unknown>
  error?: Record<string, unknown>
}

export function datasetResultsFromTimelineBlocks(
  blocks: readonly DatasetTimelineBlock[]
): TimelineDatasetResult[] {
  const results: TimelineDatasetResult[] = []
  for (const block of blocks) {
    if (block.kind !== 'tool' || block.status === 'running') continue
    const parsed = datasetResultFromToolBlock(block as DatasetToolBlock)
    if (parsed) results.push(parsed)
  }
  return results
}

function datasetResultFromToolBlock(block: DatasetToolBlock): TimelineDatasetResult | null {
  const meta = asRecord(block.meta)
  const explicit = asRecord(meta?.datasetApi)
  const toolName = normalizeDatasetToolName(
    stringValue(explicit?.toolName) || stringValue(meta?.toolName) || block.summary || ''
  ) ?? datasetToolNameFromValue(meta?.structuredContent)
    ?? datasetToolNameFromValue(meta?.output)
    ?? datasetToolNameFromValue(block.detail)
  if (!toolName) return null

  const structured = explicit
    ?? structuredDatasetContent(meta?.structuredContent)
    ?? structuredDatasetContent(meta?.output)
    ?? structuredDatasetContent(block.detail)
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

function datasetToolNameFromValue(value: unknown, depth = 0): string | null {
  if (depth > 10 || value === undefined || value === null) return null
  if (typeof value === 'string') {
    const direct = normalizeDatasetToolName(value)
    if (direct) return direct
    const candidate = value.trim()
    if (!candidate.startsWith('{') && !candidate.startsWith('[')) return null
    try {
      return datasetToolNameFromValue(JSON.parse(candidate) as unknown, depth + 1)
    } catch {
      return null
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = datasetToolNameFromValue(item, depth + 1)
      if (found) return found
    }
    return null
  }
  const record = asRecord(value)
  if (!record) return null
  for (const key of ['toolName', 'toolId', 'normalizedName', 'actionId', 'operation']) {
    const found = normalizeDatasetToolName(stringValue(record[key]))
    if (found) return found
  }
  for (const key of ['result', 'structuredContent', 'output', 'content', 'datasetApi']) {
    const found = datasetToolNameFromValue(record[key], depth + 1)
    if (found) return found
  }
  if (record.type === 'text' || record.type === 'inputText' || record.type === 'outputText') {
    return datasetToolNameFromValue(record.text, depth + 1)
  }
  return null
}

function structuredDatasetContent(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 10 || value === undefined || value === null) return null
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
  if (record.error !== undefined) return record
  if (record.result !== undefined) {
    const nested = structuredDatasetContent(record.result, depth + 1)
    if (nested) return nested
    return record
  }
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
  const capabilityMatch = value.match(/dataset-api[.:/]([a-z-]+)/i)
  if (capabilityMatch) {
    return `dataset_${capabilityMatch[1].toLowerCase().replaceAll('-', '_')}`
  }
  const match = value.match(/dataset_(api_(?:catalog|register_provider|list|register|metadata|raw_data)|prepare_plan|execute_plan|resume_plan|profile|filter|select_columns|transform|deduplicate|id_map(?:_provider)?|join|structure_(?:profile|validate)|graph_organize|materialize|validate|publish)/i)
  return match ? `dataset_${match[1].toLowerCase()}` : null
}

function datasetKind(toolName: string, result: Record<string, unknown> | null): DatasetResultKind {
  if (toolName === 'dataset_execute_plan' || toolName === 'dataset_resume_plan' || result?.execution !== undefined) return 'execution'
  if (toolName === 'dataset_prepare_plan' || result?.plan !== undefined) return 'plan'
  if (toolName === 'dataset_profile' || result?.profile !== undefined) return 'profile'
  if (toolName === 'dataset_validate' || result?.validation !== undefined) return 'validation'
  if (toolName === 'dataset_publish' || result?.publication !== undefined) return 'publication'
  if (['dataset_filter', 'dataset_select_columns', 'dataset_transform', 'dataset_deduplicate', 'dataset_id_map', 'dataset_id_map_provider', 'dataset_join', 'dataset_graph_organize', 'dataset_materialize'].includes(toolName)) return 'processing'
  if (toolName === 'dataset_list_object_stores' || Array.isArray(result?.stores)) return 'object-stores'
  if (toolName === 'dataset_list_objects' || Array.isArray(result?.objects)) return 'objects'
  if (toolName.endsWith('_metadata') || result?.metadata !== undefined) return 'metadata'
  if (toolName.endsWith('_raw_data') || result?.artifact !== undefined) return 'raw-data'
  if (toolName.endsWith('_catalog') || Array.isArray(result?.providers)) return 'catalog'
  if (toolName.endsWith('_list') || Array.isArray(result?.sources)) return 'sources'
  return 'other'
}

export function TimelineDatasetResultsPanel({
  blocks,
  workspaceRoot,
  onContinuePrompt,
  onOpenArtifact
}: {
  blocks: readonly DatasetTimelineBlock[]
  workspaceRoot?: string
  onContinuePrompt?: (prompt: string) => void
  onOpenArtifact?: OpenDatasetArtifact
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
        <DatasetResultCard
          key={item.id}
          item={item}
          workspaceRoot={workspaceRoot}
          onContinuePrompt={onContinuePrompt}
          onOpenArtifact={onOpenArtifact}
        />
      ))}
    </section>
  )
}

function DatasetResultCard({
  item,
  workspaceRoot,
  onContinuePrompt,
  onOpenArtifact
}: {
  item: TimelineDatasetResult
  workspaceRoot?: string
  onContinuePrompt?: (prompt: string) => void
  onOpenArtifact?: OpenDatasetArtifact
}): ReactElement {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(false)
  const result = item.result
  const source = asRecord(result?.source)
  const request = asRecord(result?.request)
  const response = asRecord(result?.response)
  const artifact = asRecord(result?.artifact) ?? asRecord(result?.graphArtifact)
  const publication = asRecord(result?.publication)
  const title = stringValue(source?.name) || stringValue(source?.id) || datasetKindTitle(item.kind, t)
  const subtitle = item.success
    ? datasetSuccessSubtitle(item.kind, result, response, t)
    : stringValue(item.error?.message) || t('datasetResultFailed')
  const rawPath = stringValue(artifact?.path) || (item.kind === 'publication' ? '' : stringValue(publication?.manifestPath))
  const excludedPath = stringValue(asRecord(result?.excludedArtifact)?.path)
  const duplicatesPath = stringValue(asRecord(result?.duplicatesArtifact)?.path)
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
        {rawPath && onOpenArtifact ? (
          <button
            type="button"
            onClick={() => onOpenArtifact(rawPath)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('datasetResultOpenFile')}
          </button>
        ) : null}
        {excludedPath && onOpenArtifact ? (
          <button
            type="button"
            onClick={() => onOpenArtifact(excludedPath)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('datasetResultOpenExcluded')}
          </button>
        ) : null}
        {duplicatesPath && onOpenArtifact ? (
          <button
            type="button"
            onClick={() => onOpenArtifact(duplicatesPath)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('datasetResultOpenDuplicates')}
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
          preview={stringValue(artifact?.preview)}
        />
      ) : null}

      {item.success && ['plan', 'profile', 'processing', 'validation', 'publication'].includes(item.kind) ? (
        <DatasetProcessingHighlights item={item} />
      ) : null}

      {item.success && item.kind === 'execution' ? (
        <DatasetExecutionProgress
          result={result}
          workspaceRoot={workspaceRoot}
          onContinuePrompt={onContinuePrompt}
          onOpenArtifact={onOpenArtifact}
        />
      ) : null}

      {item.success && item.kind === 'publication' && publication ? (
        <DatasetPublicationFiles
          publication={publication}
          workspaceRoot={workspaceRoot}
          onOpenArtifact={onOpenArtifact}
        />
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

function DatasetExecutionProgress({
  result,
  workspaceRoot,
  onContinuePrompt,
  onOpenArtifact
}: {
  result?: Record<string, unknown>
  workspaceRoot?: string
  onContinuePrompt?: (prompt: string) => void
  onOpenArtifact?: OpenDatasetArtifact
}): ReactElement | null {
  const { t } = useTranslation('common')
  const execution = asRecord(result?.execution)
  if (!execution) return null
  const steps = arrayValue(execution.steps).map(asRecord).filter((step): step is Record<string, unknown> => step !== null)
  const status = stringValue(execution.status)
  const planId = stringValue(execution.planId)
  const runId = stringValue(execution.runId)
  const resumePrompt = `继续执行已确认的 Dataset 计划。请通过 Dataset API 的“Resume a dataset plan”能力恢复 planId="${planId}", runId="${runId}"，等待终端回执后报告结果。`
  return (
    <div data-dataset-execution-progress className="border-t border-ds-border-muted/70 bg-violet-500/[0.025] px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-semibold text-ds-ink">
          {t('datasetResultExecutionProgress', {
            completed: numberValue(execution.completedSteps) ?? 0,
            total: numberValue(execution.totalSteps) ?? steps.length
          })}
        </p>
        {status === 'failed' && onContinuePrompt && planId && runId ? (
          <button
            type="button"
            onClick={() => onContinuePrompt(resumePrompt)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[12px] font-semibold text-white transition hover:bg-violet-500"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('datasetResultResume')}
          </button>
        ) : null}
      </div>
      <ol className="space-y-2">
        {steps.map((step, position) => {
          const stepStatus = stringValue(step.status)
          const counts = asRecord(step.counts)
          const artifacts = arrayValue(step.artifacts).map(asRecord).filter((artifact): artifact is Record<string, unknown> => artifact !== null)
          return (
            <li key={`${stringValue(step.tool)}-${position}`} className="rounded-xl border border-ds-border-muted bg-ds-card/65 px-3 py-2.5">
              <div className="flex items-start gap-2.5">
                <span className={`mt-0.5 ${stepStatus === 'succeeded' ? 'text-emerald-500' : stepStatus === 'failed' ? 'text-red-500' : stepStatus === 'running' ? 'text-violet-500' : 'text-ds-faint'}`}>
                  {stepStatus === 'succeeded' ? <CheckCircle2 className="h-4 w-4" /> : stepStatus === 'failed' ? <CircleX className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[12px] font-semibold text-ds-ink">{position + 1}. {stringValue(step.description) || stringValue(step.tool)}</span>
                    <DatasetBadge>{t(`datasetResultStepStatus.${stepStatus || 'pending'}`)}</DatasetBadge>
                    {numberValue(step.attempts) && numberValue(step.attempts)! > 1 ? <DatasetBadge>{t('datasetResultAttempts', { count: numberValue(step.attempts) })}</DatasetBadge> : null}
                  </div>
                  {stringValue(step.error) ? <p className="mt-1 text-[11px] text-red-600 dark:text-red-300">{stringValue(step.error)}</p> : null}
                  {counts ? <p className="mt-1 text-[11px] text-ds-muted">{executionCountsSummary(counts, t)}</p> : null}
                  {artifacts.length > 0 && onOpenArtifact ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {artifacts.slice(0, 4).map((artifact, artifactIndex) => {
                        const path = stringValue(artifact.path)
                        return path ? (
                          <button
                            key={`${path}-${artifactIndex}`}
                            type="button"
                            onClick={() => onOpenArtifact(path)}
                            className="inline-flex max-w-[240px] items-center gap-1 rounded-md border border-ds-border px-2 py-1 text-[10.5px] text-ds-muted hover:bg-ds-hover"
                            title={path}
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="truncate">{path.split('/').pop()}</span>
                          </button>
                        ) : null
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function executionCountsSummary(
  counts: Record<string, unknown>,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const input = numberValue(counts.inputRecords) ?? numberValue(counts.leftRecords)
  const output = numberValue(counts.outputRecords) ?? numberValue(counts.records) ?? numberValue(counts.edgeRecords)
  if (input !== undefined && output !== undefined) return t('datasetResultRowChange', { input, output })
  if (output !== undefined) return t('datasetResultRecordsCount', { count: output })
  if (counts.valid !== undefined) return counts.valid === true ? t('datasetResultValidationPassed') : t('datasetResultValidationFailed')
  return Object.entries(counts).slice(0, 3).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')
}

function DatasetPublicationFiles({
  publication,
  workspaceRoot,
  onOpenArtifact
}: {
  publication: Record<string, unknown>
  workspaceRoot?: string
  onOpenArtifact?: OpenDatasetArtifact
}): ReactElement | null {
  const { t } = useTranslation('common')
  const files = publicationReleaseFiles(publication)
  if (files.length === 0 || !onOpenArtifact) return null
  return (
    <div data-dataset-publication-files className="flex flex-wrap gap-2 border-t border-ds-border-muted/70 px-5 py-3">
      {files.map((file) => (
        <button
          key={file.path}
          type="button"
          onClick={() => onOpenArtifact(file.path)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t(file.label)}
        </button>
      ))}
    </div>
  )
}

export function publicationReleaseFiles(publication: Record<string, unknown>): Array<{ label: string; path: string }> {
  return [
    { label: 'datasetResultOpenManifest', path: stringValue(publication.manifestPath) },
    { label: 'datasetResultOpenSchema', path: stringValue(publication.schemaPath) },
    { label: 'datasetResultOpenQuality', path: stringValue(publication.qualityReportPath) },
    { label: 'datasetResultOpenPlan', path: stringValue(publication.preparationPlanPath) },
    { label: 'datasetResultOpenChecksums', path: stringValue(publication.checksumsPath) }
  ].filter((file) => file.path)
}

function DatasetProcessingHighlights({ item }: { item: TimelineDatasetResult }): ReactElement | null {
  const { t } = useTranslation('common')
  const result = item.result
  const profile = asRecord(result?.profile)
  const counts = asRecord(result?.counts)
  const validation = asRecord(result?.validation)
  const publication = asRecord(result?.publication)
  const quality = asRecord(result?.quality)
  const plan = asRecord(result?.plan)
  const values: Array<{ label: string; value: string }> = []
  if (numberValue(profile?.records) !== undefined) values.push({ label: t('datasetResultRecords'), value: String(numberValue(profile?.records)) })
  if (numberValue(profile?.coordinateRecords) !== undefined) values.push({ label: t('datasetResultCoordinates'), value: String(numberValue(profile?.coordinateRecords)) })
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
  if (numberValue(counts?.nodeRecords) !== undefined) values.push({ label: t('datasetResultNodes'), value: String(numberValue(counts?.nodeRecords)) })
  if (numberValue(counts?.edgeRecords) !== undefined) values.push({ label: t('datasetResultEdges'), value: String(numberValue(counts?.edgeRecords)) })
  if (numberValue(counts?.invalidRecords) !== undefined) values.push({ label: t('datasetResultInvalidRecords'), value: String(numberValue(counts?.invalidRecords)) })
  if (Array.isArray(result?.operations)) values.push({ label: t('datasetResultOperations'), value: String(result.operations.length) })
  if (validation) values.push({ label: t('datasetResultQuality'), value: validation.valid === true ? t('datasetResultValid') : t('datasetResultInvalid') })
  if (numberValue(validation?.coordinateRecords) !== undefined) values.push({ label: t('datasetResultCoordinates'), value: String(numberValue(validation?.coordinateRecords)) })
  if (numberValue(validation?.errorCount) !== undefined) values.push({ label: t('datasetResultErrors'), value: String(numberValue(validation?.errorCount)) })
  if (numberValue(publication?.artifactCount) !== undefined) values.push({ label: t('datasetResultArtifacts'), value: String(numberValue(publication?.artifactCount)) })
  if (stringValue(quality?.status)) values.push({ label: t('datasetResultQuality'), value: stringValue(quality?.status) })
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
  sha256,
  preview
}: {
  path: string
  workspaceRoot?: string
  format: string
  contentType: string
  sha256: string
  preview: string
}): ReactElement | null {
  const supported = isTextDatasetFormat(format, contentType, path)
  const renderedPreview = supported && preview
    ? datasetTextPreview(preview, format, path)
    : ''

  if (!supported && !sha256) return null
  return (
    <div className="border-t border-ds-border-muted/70 bg-sky-500/[0.025] px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ds-muted">
        {sha256 ? <span className="font-mono" title={sha256}>SHA-256 {shortHash(sha256)}</span> : null}
        <span className="min-w-0 truncate font-mono" title={path}>{path}</span>
      </div>
      {renderedPreview ? (
        <pre data-dataset-raw-preview className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-ds-border-muted bg-ds-card/70 px-3.5 py-3 font-mono text-[11px] leading-5 text-ds-muted">
          {renderedPreview}
        </pre>
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
  if (kind === 'object-stores') return t('datasetResultObjectStores')
  if (kind === 'objects') return t('datasetResultObjects')
  if (kind === 'plan') return t('datasetResultPlan')
  if (kind === 'execution') return t('datasetResultExecution')
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
  if (kind === 'object-stores') return t('datasetResultObjectStoresCount', { count: arrayValue(result?.stores).length })
  if (kind === 'objects') return t('datasetResultObjectsCount', { count: arrayValue(result?.objects).length })
  if (kind === 'plan') return t('datasetResultPlanPrepared')
  if (kind === 'execution') {
    const execution = asRecord(result?.execution)
    return stringValue(execution?.status) === 'succeeded'
      ? t('datasetResultExecutionCompleted')
      : t('datasetResultExecutionStopped')
  }
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
  const request = asRecord(result?.request)
  if (stringValue(request?.bucket)) facts.push({ label: t('datasetResultBucket'), value: stringValue(request?.bucket) })
  if (stringValue(request?.prefix)) facts.push({ label: t('datasetResultPrefix'), value: stringValue(request?.prefix) })
  if (stringValue(request?.key)) facts.push({ label: t('datasetResultObjectKey'), value: stringValue(request?.key) })
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
