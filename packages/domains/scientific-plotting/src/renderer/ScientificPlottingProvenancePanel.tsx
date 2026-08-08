import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  GitCompareArrows,
  History,
  Loader2,
  PanelRightClose,
  Play,
  RefreshCw
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { useTranslation } from 'react-i18next'
import type { ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'
import type {
  ScientificPlottingCompareResult,
  ScientificPlottingRerunResult
} from '../contract.js'
import type { ScientificPlottingCapabilityClient } from './scientific-plotting-capability-client.js'
import {
  loadScientificPlotProvenance,
  type ScientificPlotProvenanceRecord
} from './scientific-plot-provenance.js'

type Notice = Readonly<{
  tone: 'error' | 'info' | 'success' | 'warning'
  message: string
}>

export type ScientificPlottingProvenancePanelProps = Readonly<{
  client: ScientificPlottingCapabilityClient
  workspaceRoot: string
  preferredManifestVersionId?: string
  className?: string
  onCollapse: () => void
  onOpenArtifactHistory?: () => void
}>

export function ScientificPlottingProvenancePanel({
  client,
  workspaceRoot,
  preferredManifestVersionId,
  className = '',
  onCollapse,
  onOpenArtifactHistory
}: ScientificPlottingProvenancePanelProps): ReactElement {
  const { t } = useTranslation('common')
  const [records, setRecords] = useState<readonly ScientificPlotProvenanceRecord[]>([])
  const [issues, setIssues] = useState<readonly string[]>([])
  const [activeVersionId, setActiveVersionId] = useState('')
  const [compareVersionId, setCompareVersionId] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<'rerun' | 'compare' | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [comparison, setComparison] = useState<ScientificPlottingCompareResult | null>(null)

  const load = useCallback(async () => {
    if (!workspaceRoot.trim()) {
      setRecords([])
      setIssues([])
      return
    }
    setLoading(true)
    setNotice(null)
    try {
      const result = await loadScientificPlotProvenance(client, workspaceRoot)
      setRecords(result.records)
      setIssues(result.issues)
      setActiveVersionId((current) => {
        if (result.records.some((record) => record.manifestRef.versionId === current)) {
          return current
        }
        if (preferredManifestVersionId && result.records.some(
          (record) => record.manifestRef.versionId === preferredManifestVersionId
        )) return preferredManifestVersionId
        return result.records[0]?.manifestRef.versionId ?? ''
      })
    } catch (error) {
      setNotice({ tone: 'error', message: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [client, preferredManifestVersionId, workspaceRoot])

  useEffect(() => {
    void load()
  }, [load])

  const activeRecord = useMemo(
    () => records.find((record) => record.manifestRef.versionId === activeVersionId)
      ?? records[0],
    [activeVersionId, records]
  )
  const compareRecord = records.find(
    (record) => record.manifestRef.versionId === compareVersionId
  )

  useEffect(() => {
    if (!activeRecord || compareVersionId !== activeRecord.manifestRef.versionId) return
    setCompareVersionId('')
  }, [activeRecord, compareVersionId])

  const rerun = async () => {
    if (!activeRecord || !window.confirm(t('scientificPlottingRerunConfirm'))) return
    setBusy('rerun')
    setNotice(null)
    try {
      const result: ScientificPlottingRerunResult = await client.rerun(workspaceRoot, {
        operationId: `scientific-plot-rerun:${activeRecord.figureRef!.versionId}:${activeRecord.currentFigureVersionId!}`,
        baselineFigureVersionRef: activeRecord.figureRef!,
        recipeVersionRef: activeRecord.recipeRef!,
        expectedCurrentVersionId: activeRecord.currentFigureVersionId!
      })
      if (!result.ok) {
        setNotice({ tone: 'error', message: result.message })
        return
      }
      setNotice({
        tone: result.reproductionRelation === 'replicates' ? 'success' : 'warning',
        message: result.reproductionRelation === 'replicates'
          ? t('scientificPlottingRerunReplicates')
          : t('scientificPlottingRerunDiffers')
      })
      await load()
    } catch (error) {
      setNotice({ tone: 'error', message: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  const compare = async () => {
    if (!activeRecord || !compareRecord) return
    setBusy('compare')
    setNotice(null)
    setComparison(null)
    try {
      const result = await client.compare(workspaceRoot, {
        baselineManifestVersionRef: activeRecord.manifestRef,
        candidateManifestVersionRef: compareRecord.manifestRef
      })
      setComparison(result)
      if (!result.ok) setNotice({ tone: 'error', message: result.message })
    } catch (error) {
      setNotice({ tone: 'error', message: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  const canLoad = Boolean(workspaceRoot.trim())
  return (
    <aside className={`flex min-h-0 min-w-0 flex-col border-l border-ds-border bg-ds-sidebar ${className}`}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-ds-ink">
          <BarChart3 className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
          <span>{t('scientificPlottingPanelTitle')}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void load()}
            disabled={!canLoad || loading || Boolean(busy)}
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
            aria-label={t('scientificPlottingRefresh')}
            title={t('scientificPlottingRefresh')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('scientificPlottingCollapse')}
            title={t('scientificPlottingCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {notice ? <NoticeBox notice={notice} /> : null}
        {issues.length > 0 ? (
          <details className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-ds-muted">
            <summary className="cursor-pointer text-amber-700 dark:text-amber-300">
              {t('scientificPlottingUnreadable', { count: issues.length })}
            </summary>
            <ul className="mt-2 grid gap-1 pl-4">
              {issues.map((issue) => <li key={issue} className="list-disc break-words">{issue}</li>)}
            </ul>
          </details>
        ) : null}

        {!canLoad ? (
          <EmptyState text={t('scientificPlottingNoWorkspace')} />
        ) : loading && records.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-ds-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('scientificPlottingLoading')}
          </div>
        ) : !activeRecord ? (
          <EmptyState text={t('scientificPlottingEmpty')} />
        ) : (
          <>
            <div className="grid gap-2 rounded-xl border border-ds-border-muted bg-ds-main/30 p-3">
              <label className="grid gap-1 text-[11px] text-ds-muted">
                {t('scientificPlottingExactManifest')}
                <select
                  value={activeRecord.manifestRef.versionId}
                  onChange={(event) => {
                    setActiveVersionId(event.target.value)
                    setComparison(null)
                    setCompareVersionId('')
                  }}
                  className="min-w-0 rounded-lg border border-ds-border bg-ds-main px-2.5 py-2 text-[12px] text-ds-ink"
                >
                  {records.map((record) => (
                    <option key={record.manifestRef.versionId} value={record.manifestRef.versionId}>
                      {record.manifest.recipe.labels.title ?? record.manifest.recipe.figureId}
                      {' · '}{formatTime(record.manifest.createdAt)}
                    </option>
                  ))}
                </select>
              </label>
              <ExactReference label={t('scientificPlottingExactManifest')} refValue={activeRecord.manifestRef} />
              {activeRecord.figureRef ? (
                <ExactReference label={t('scientificPlottingExactFigure')} refValue={activeRecord.figureRef} />
              ) : null}
              {activeRecord.recipeRef ? (
                <ExactReference label={t('scientificPlottingExactRecipe')} refValue={activeRecord.recipeRef} />
              ) : null}
              {onOpenArtifactHistory ? (
                <button
                  type="button"
                  onClick={onOpenArtifactHistory}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-ds-border px-2.5 py-2 text-[11px] font-medium text-ds-ink transition hover:bg-ds-hover"
                >
                  <History className="h-3.5 w-3.5" />
                  {t('scientificPlottingOpenArtifactHistory')}
                </button>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void rerun()}
                disabled={Boolean(busy) || !activeRecord.figureRef || !activeRecord.recipeRef || !activeRecord.currentFigureVersionId}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-ds-accent px-2.5 py-2 text-[11px] font-semibold text-white disabled:opacity-50"
              >
                {busy === 'rerun' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {busy === 'rerun' ? t('scientificPlottingBusy') : t('scientificPlottingRerun')}
              </button>
              <button
                type="button"
                onClick={() => void compare()}
                disabled={Boolean(busy) || !compareRecord}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-ds-border px-2.5 py-2 text-[11px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:opacity-50"
              >
                {busy === 'compare' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompareArrows className="h-3.5 w-3.5" />}
                {busy === 'compare' ? t('scientificPlottingBusy') : t('scientificPlottingCompare')}
              </button>
            </div>
            <select
              aria-label={t('scientificPlottingCompareWith')}
              value={compareVersionId}
              onChange={(event) => {
                setCompareVersionId(event.target.value)
                setComparison(null)
              }}
              className="min-w-0 rounded-lg border border-ds-border bg-ds-main px-2.5 py-2 text-[11px] text-ds-ink"
            >
              <option value="">{t('scientificPlottingCompareWith')}</option>
              {records.filter((record) => record.manifestRef.versionId !== activeRecord.manifestRef.versionId)
                .map((record) => (
                  <option key={record.manifestRef.versionId} value={record.manifestRef.versionId}>
                    {record.manifest.recipe.labels.title ?? record.manifest.recipe.figureId}
                    {' · '}{formatTime(record.manifest.createdAt)}
                  </option>
                ))}
            </select>
            {comparison?.ok ? (
              <NoticeBox notice={{
                tone: comparison.comparison.changedSections.length > 0 ? 'warning' : 'success',
                message: comparison.comparison.changedSections.length > 0
                  ? t('scientificPlottingChangedSections', {
                      sections: comparison.comparison.changedSections.join(', ')
                    })
                  : t('scientificPlottingNoChanges')
              }} />
            ) : null}

            <ProvenanceSections record={activeRecord} />
          </>
        )}
      </div>
    </aside>
  )
}

function ProvenanceSections({ record }: Readonly<{
  record: ScientificPlotProvenanceRecord
}>): ReactElement {
  const { t } = useTranslation('common')
  const { recipe } = record.manifest
  const statistics = recipe.statistics
  const review = reviewState(record.manifest.finalReview)
  return (
    <div className="grid gap-2">
      <ProvenanceSection title={t('scientificPlottingData')} icon={<Database className="h-3.5 w-3.5" />} open>
        <KeyValue label={t('scientificPlottingDataHash')} value={recipe.dataHash} mono />
        {record.derivedDataRef ? (
          <ExactReference label={t('scientificPlottingDerivedTable')} refValue={record.derivedDataRef} compact />
        ) : null}
        <div className="grid gap-2">
          {recipe.dataSources.map((source) => (
            <div key={source.sourceId} className="rounded-lg border border-ds-border-muted bg-ds-main/40 p-2">
              <div className="text-[11px] font-semibold text-ds-ink">{source.sourceId}</div>
              <KeyValue label={t('scientificPlottingSource')} value={`${source.kind} · ${source.locator}`} />
              <KeyValue label={t('scientificPlottingDigest')} value={source.sha256} mono />
              {source.selection ? (
                <JsonDetails label={t('scientificPlottingSelection')} value={source.selection} />
              ) : null}
              {source.kind === 'artifact-version' ? (
                <ExactReference label={t('scientificPlottingVersion')} refValue={source.artifactVersion} compact />
              ) : null}
            </div>
          ))}
        </div>
        {recipe.derivedTables.map((table) => (
          <div key={table.receiptId} className="rounded-lg bg-ds-hover/50 p-2 text-[11px] text-ds-muted">
            <span className="font-medium text-ds-ink">{table.receiptId}</span>
            {' · '}{table.operation}
            {table.rowCount === undefined ? '' : ` · ${table.rowCount} rows`}
            <div className="mt-1 break-all font-mono text-[10px]">{table.outputHash}</div>
          </div>
        ))}
      </ProvenanceSection>

      <ProvenanceSection title={t('scientificPlottingStatistics')}>
        {!statistics ? (
          <MutedText>{t('scientificPlottingNoStatistics')}</MutedText>
        ) : (
          <>
            <KeyValue label={t('scientificPlottingEstimator')} value={statistics.estimator} />
            <KeyValue
              label={t('scientificPlottingAggregation')}
              value={statistics.aggregation
                ? `${statistics.aggregation.method} · ${statistics.aggregation.groupBy.join(', ') || 'ungrouped'}`
                : t('scientificPlottingNone')}
            />
            <KeyValue
              label={t('scientificPlottingUncertainty')}
              value={statistics.uncertainty
                ? `${statistics.uncertainty.kind}${statistics.uncertainty.confidenceLevel
                  ? ` · ${statistics.uncertainty.confidenceLevel * 100}%`
                  : ''} · ${statistics.uncertainty.suppliedBy}`
                : t('scientificPlottingNone')}
            />
            <KeyValue label={t('scientificPlottingMissingValues')} value={statistics.missingValues} />
            {statistics.sampleUnit ? <KeyValue label={t('scientificPlottingSampleUnit')} value={statistics.sampleUnit} /> : null}
            {statistics.seed === undefined ? null : <KeyValue label={t('scientificPlottingSeed')} value={String(statistics.seed)} />}
            {statistics.comparisons?.length ? (
              <JsonDetails label={t('scientificPlottingComparisons')} value={statistics.comparisons} />
            ) : null}
          </>
        )}
      </ProvenanceSection>

      <ProvenanceSection title={t('scientificPlottingTransformations')}>
        {recipe.transformations.map((transformation, index) => (
          <div key={transformation.transformationId} className="rounded-lg border border-ds-border-muted p-2">
            <div className="text-[11px] font-semibold text-ds-ink">
              {index + 1}. {transformation.kind}
            </div>
            <div className="mt-1 text-[11px] text-ds-muted">{transformation.description}</div>
            <JsonDetails label={transformation.transformationId} value={transformation.parameters} />
            <div className="mt-1 break-all font-mono text-[9px] text-ds-muted">
              {shortDigest(transformation.inputHash)} → {shortDigest(transformation.outputHash)}
            </div>
          </div>
        ))}
      </ProvenanceSection>

      <ProvenanceSection title={t('scientificPlottingParameters')}>
        <KeyValue label={t('scientificPlottingTemplate')} value={recipe.template} />
        <JsonDetails label={t('scientificPlottingLabels')} value={recipe.labels} />
        <KeyValue label={t('scientificPlottingStyle')} value={recipe.style.resolvedSpecHash} mono />
        <JsonDetails
          label={t('scientificPlottingMatplotlib')}
          value={recipe.render.matplotlib ?? { unavailable: 'legacy recipe' }}
        />
        <KeyValue label={t('scientificPlottingReproducibility')} value={recipe.reproducibilityMode} />
      </ProvenanceSection>

      <ProvenanceSection title={t('scientificPlottingEnvironment')}>
        <KeyValue
          label={t('scientificPlottingPython')}
          value={`${recipe.environment.pythonVersion} · ${recipe.environment.pythonExecutable}`}
        />
        <KeyValue label={t('scientificPlottingEnvironmentDigest')} value={recipe.environment.environmentDigest} mono />
        <KeyValue label={t('scientificPlottingFonts')} value={recipe.environment.fontFingerprint} mono />
        <JsonDetails label={t('scientificPlottingPackages')} value={recipe.environment.packages} />
      </ProvenanceSection>

      <ProvenanceSection title={t('scientificPlottingExecution')}>
        <KeyValue
          label={t('scientificPlottingRenderer')}
          value={`${recipe.execution.renderer} · ${recipe.execution.rendererVersion}`}
        />
        <KeyValue label={t('scientificPlottingRendererCode')} value={recipe.execution.rendererCodeSha256} mono />
        <KeyValue label={t('scientificPlottingCommand')} value={recipe.execution.command.join(' ')} mono />
        <KeyValue label={t('scientificPlottingCwd')} value={recipe.execution.cwd} mono />
        <KeyValue label={t('scientificPlottingTimeout')} value={`${recipe.execution.timeoutMs} ms`} />
        <KeyValue label={t('scientificPlottingManifestPath')} value={record.manifestPath} mono />
        <KeyValue label={t('scientificPlottingOutputPath')} value={record.manifest.outputPath} mono />
        {record.logRef ? <ExactReference label={t('scientificPlottingAttempts')} refValue={record.logRef} compact /> : null}
      </ProvenanceSection>

      <ProvenanceSection title={t('scientificPlottingReview')}>
        <div className={`flex items-center gap-2 text-[11px] font-medium ${
          review === 'verified'
            ? 'text-emerald-700 dark:text-emerald-300'
            : review === 'failed'
              ? 'text-red-700 dark:text-red-300'
              : 'text-ds-muted'
        }`}>
          {review === 'verified'
            ? <CheckCircle2 className="h-3.5 w-3.5" />
            : review === 'failed'
              ? <AlertTriangle className="h-3.5 w-3.5" />
              : null}
          {review === 'verified'
            ? t('scientificPlottingVerified')
            : review === 'failed'
              ? t('scientificPlottingFailed')
              : t('scientificPlottingNotReviewed')}
        </div>
        <KeyValue label={t('scientificPlottingAttempts')} value={String(record.manifest.attempts.length)} />
        {record.manifest.finalReview === undefined ? null : (
          <JsonDetails label={t('scientificPlottingReview')} value={record.manifest.finalReview} />
        )}
        {[...recipe.provenanceWarnings, ...record.manifest.warnings].length > 0 ? (
          <JsonDetails
            label={t('scientificPlottingWarnings')}
            value={[...recipe.provenanceWarnings, ...record.manifest.warnings]}
          />
        ) : null}
      </ProvenanceSection>
    </div>
  )
}

function ProvenanceSection({
  title,
  icon,
  open = false,
  children
}: Readonly<{
  title: string
  icon?: ReactNode
  open?: boolean
  children: ReactNode
}>): ReactElement {
  return (
    <details open={open} className="overflow-hidden rounded-xl border border-ds-border-muted bg-ds-main/25">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[12px] font-semibold text-ds-ink">
        {icon}
        {title}
      </summary>
      <div className="grid gap-2 border-t border-ds-border-muted px-3 py-3">
        {children}
      </div>
    </details>
  )
}

function ExactReference({
  label,
  refValue,
  compact = false
}: Readonly<{
  label: string
  refValue: ArtifactVersionRefV1
  compact?: boolean
}>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className={`min-w-0 rounded-lg border border-ds-border-muted bg-ds-main/50 ${compact ? 'p-2' : 'p-2.5'}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ds-muted">{label}</div>
      <dl className="mt-1 grid gap-1 text-[10px]">
        <KeyValue label={t('scientificPlottingArtifact')} value={refValue.artifactId} mono />
        <KeyValue label={t('scientificPlottingVersion')} value={refValue.versionId} mono />
        <KeyValue label={t('scientificPlottingDigest')} value={refValue.contentDigest} mono />
        <KeyValue label={t('scientificPlottingAvailability')} value={refValue.availability} />
      </dl>
    </div>
  )
}

function KeyValue({
  label,
  value,
  mono = false
}: Readonly<{
  label: string
  value: string
  mono?: boolean
}>): ReactElement {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(72px,0.42fr)_minmax(0,1fr)] gap-2 text-[10.5px]">
      <dt className="text-ds-muted">{label}</dt>
      <dd className={`min-w-0 break-all text-ds-ink ${mono ? 'font-mono text-[9.5px]' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

function JsonDetails({ label, value }: Readonly<{
  label: string
  value: unknown
}>): ReactElement {
  return (
    <details className="rounded-lg bg-ds-hover/40 px-2 py-1.5 text-[10px]">
      <summary className="cursor-pointer text-ds-muted">{label}</summary>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[9px] leading-relaxed text-ds-ink">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  )
}

function NoticeBox({ notice }: Readonly<{ notice: Notice }>): ReactElement {
  const style = notice.tone === 'error'
    ? 'border-red-500/25 bg-red-500/5 text-red-700 dark:text-red-300'
    : notice.tone === 'warning'
      ? 'border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300'
      : notice.tone === 'success'
        ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
        : 'border-sky-500/25 bg-sky-500/5 text-sky-700 dark:text-sky-300'
  return <div className={`rounded-lg border px-3 py-2 text-[11px] ${style}`}>{notice.message}</div>
}

function EmptyState({ text }: Readonly<{ text: string }>): ReactElement {
  return (
    <div className="rounded-xl border border-dashed border-ds-border px-4 py-10 text-center text-[12px] text-ds-muted">
      {text}
    </div>
  )
}

function MutedText({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  return <div className="text-[11px] text-ds-muted">{children}</div>
}

function reviewState(value: unknown): 'verified' | 'failed' | 'not-reviewed' {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'not-reviewed'
  return (value as { ok?: unknown }).ok === true ? 'verified' : 'failed'
}

function shortDigest(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
