import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Database,
  Download,
  FileClock,
  GitCompare,
  Loader2,
  PanelRightClose,
  RefreshCw,
  RotateCcw,
  ShieldCheck
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ArtifactVersionBundleReceiptV1,
  ArtifactVersionBundleVerificationV1,
  ArtifactVersionCompareV1,
  ArtifactVersionListV1
} from '../contract.js'
import {
  defaultBundleDestination,
  defaultMaterializeDestination,
  stableUiActionKey,
  uniqueRestoreActionKey
} from './artifact-version-actions.js'
import type { ArtifactVersionsCapabilityClient } from './artifact-versions-capability-client.js'

type HistoryItem = ArtifactVersionListV1['items'][number]
type ArtifactHistory = Readonly<{
  artifactId: string
  items: readonly HistoryItem[]
  current: HistoryItem
}>
type Notice = Readonly<{
  tone: 'error' | 'info' | 'success'
  message: string
}>
type BundleState = Readonly<{
  receipt: ArtifactVersionBundleReceiptV1
  verification?: ArtifactVersionBundleVerificationV1
}>

export type ArtifactVersionsPanelProps = Readonly<{
  client: ArtifactVersionsCapabilityClient
  workspaceRoot: string
  className?: string
  onCollapse: () => void
}>

export function ArtifactVersionsPanel({
  client,
  workspaceRoot,
  className = '',
  onCollapse
}: ArtifactVersionsPanelProps): ReactElement {
  const { t } = useTranslation('common')
  const [items, setItems] = useState<readonly HistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [comparisons, setComparisons] = useState<Readonly<Record<
    string,
    ArtifactVersionCompareV1
  >>>({})
  const [bundles, setBundles] = useState<Readonly<Record<string, BundleState>>>({})

  const load = useCallback(async () => {
    if (!workspaceRoot.trim()) {
      setItems([])
      return false
    }
    setLoading(true)
    setNotice(null)
    try {
      const result = await client.list(workspaceRoot, { limit: 500 })
      if (!result.ok) {
        setNotice({ tone: 'error', message: result.issue.message })
        return false
      }
      setItems(result.value.items)
      return true
    } catch (error) {
      setNotice({ tone: 'error', message: errorMessage(error) })
      return false
    } finally {
      setLoading(false)
    }
  }, [client, workspaceRoot])

  useEffect(() => {
    void load()
  }, [load])

  const histories = useMemo(() => groupArtifactHistories(items), [items])

  const refresh = async () => {
    if (!workspaceRoot.trim()) return
    setLoading(true)
    setNotice(null)
    try {
      const result = await client.refresh(workspaceRoot)
      if (!result.ok) {
        setNotice({ tone: 'error', message: result.issue.message })
        return
      }
      setNotice({
        tone: 'info',
        message: t('artifactVersionsRefreshSummary', {
          checked: result.value.checked,
          events: result.value.events.length
        })
      })
      const history = await client.list(workspaceRoot, { limit: 500 })
      if (history.ok) setItems(history.value.items)
      else setNotice({ tone: 'error', message: history.issue.message })
    } catch (error) {
      setNotice({ tone: 'error', message: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }

  const compare = async (item: HistoryItem, current: HistoryItem) => {
    const isCurrent = item.version.versionId === current.version.versionId
    const fromVersionId = isCurrent
      ? item.version.parentVersionId
      : item.version.versionId
    const toVersionId = isCurrent
      ? item.version.versionId
      : current.version.versionId
    if (!fromVersionId) return
    const action = `compare:${item.version.versionId}`
    setBusyAction(action)
    setNotice(null)
    try {
      const result = await client.compare(workspaceRoot, {
        fromVersionId,
        toVersionId,
        textPreviewMaxBytes: 8 * 1_024
      })
      if (!result.ok) {
        setNotice({ tone: 'error', message: result.issue.message })
        return
      }
      setComparisons((previous) => ({
        ...previous,
        [item.version.versionId]: result.value
      }))
    } catch (error) {
      setNotice({ tone: 'error', message: errorMessage(error) })
    } finally {
      setBusyAction(null)
    }
  }

  const materialize = async (item: HistoryItem) => {
    const destinationPath = defaultMaterializeDestination(item)
    if (!window.confirm(t('artifactVersionsMaterializeConfirm', { path: destinationPath }))) return
    const action = `materialize:${item.version.versionId}`
    setBusyAction(action)
    setNotice(null)
    try {
      const result = await client.materialize(workspaceRoot, {
        idempotencyKey: stableUiActionKey('materialize', item),
        versionId: item.version.versionId,
        destinationPath
      })
      if (!result.ok) {
        setNotice({ tone: 'error', message: result.issue.message })
        return
      }
      setNotice({
        tone: 'success',
        message: t('artifactVersionsMaterialized', { path: result.value.destinationPath })
      })
    } catch (error) {
      setNotice({ tone: 'error', message: errorMessage(error) })
    } finally {
      setBusyAction(null)
    }
  }

  const restore = async (item: HistoryItem, current: HistoryItem) => {
    if (!window.confirm(t('artifactVersionsRestoreConfirm', {
      version: item.version.sequence
    }))) return
    const action = `restore:${item.version.versionId}`
    setBusyAction(action)
    setNotice(null)
    try {
      const result = await client.restoreAsNew(workspaceRoot, {
        idempotencyKey: uniqueRestoreActionKey(item.version.versionId),
        artifactId: item.artifact.artifactId,
        sourceVersionId: item.version.versionId,
        expectedCurrentVersionId: current.version.versionId,
        metadata: { restoredBy: 'artifact-history-ui' }
      })
      if (!result.ok) {
        setNotice({ tone: 'error', message: result.issue.message })
        return
      }
      const restoredVersion = result.value.versions[0]?.version.sequence ?? ''
      if (await load()) {
        setNotice({
          tone: 'success',
          message: t('artifactVersionsRestored', { version: restoredVersion })
        })
      }
    } catch (error) {
      setNotice({ tone: 'error', message: errorMessage(error) })
    } finally {
      setBusyAction(null)
    }
  }

  const verifyBundle = async (artifactId: string, bundlePath: string) => {
    const action = `verify:${artifactId}`
    setBusyAction(action)
    setNotice(null)
    try {
      const result = await client.verifyBundle(workspaceRoot, { bundlePath })
      if (!result.ok) {
        setNotice({ tone: 'error', message: result.issue.message })
        return
      }
      setBundles((previous) => {
        const existing = previous[artifactId]
        return existing
          ? { ...previous, [artifactId]: { ...existing, verification: result.value } }
          : previous
      })
      setNotice({
        tone: result.value.valid ? 'success' : 'error',
        message: result.value.valid
          ? t('artifactVersionsBundleVerified')
          : t('artifactVersionsBundleInvalid', { count: result.value.issues.length })
      })
    } catch (error) {
      setNotice({ tone: 'error', message: errorMessage(error) })
    } finally {
      setBusyAction(null)
    }
  }

  const exportBundle = async (history: ArtifactHistory) => {
    const destinationPath = defaultBundleDestination(history.current)
    const action = `bundle:${history.artifactId}`
    setBusyAction(action)
    setNotice(null)
    try {
      const result = await client.exportBundle(workspaceRoot, {
        idempotencyKey: stableUiActionKey('bundle-export', history.current),
        artifactIds: [history.artifactId],
        destinationPath
      })
      if (!result.ok) {
        setNotice({ tone: 'error', message: result.issue.message })
        return
      }
      setBundles((previous) => ({
        ...previous,
        [history.artifactId]: { receipt: result.value }
      }))
      const verification = await client.verifyBundle(workspaceRoot, {
        bundlePath: result.value.path
      })
      if (!verification.ok) {
        setNotice({ tone: 'error', message: verification.issue.message })
        return
      }
      setBundles((previous) => ({
        ...previous,
        [history.artifactId]: { receipt: result.value, verification: verification.value }
      }))
      setNotice({
        tone: verification.value.valid ? 'success' : 'error',
        message: verification.value.valid
          ? t('artifactVersionsBundleExported', { path: result.value.path })
          : t('artifactVersionsBundleInvalid', { count: verification.value.issues.length })
      })
    } catch (error) {
      setNotice({ tone: 'error', message: errorMessage(error) })
    } finally {
      setBusyAction(null)
    }
  }

  const canLoad = Boolean(workspaceRoot.trim())
  return (
    <aside className={`flex min-h-0 min-w-0 flex-col border-l border-ds-border bg-ds-sidebar ${className}`}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-ds-ink">
          <FileClock className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
          <span>{t('artifactVersionsTitle')}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || Boolean(busyAction) || !canLoad}
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
            aria-label={t('artifactVersionsRefresh')}
            title={t('artifactVersionsRefresh')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('artifactVersionsCollapse')}
            title={t('artifactVersionsCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {notice ? <NoticeBox notice={notice} /> : null}
        <div className="text-[12px] text-ds-muted">
          {t('artifactVersionsCount', { count: items.length })}
        </div>
        {!canLoad ? (
          <EmptyState text={t('artifactVersionsNoWorkspace')} />
        ) : loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-ds-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('artifactVersionsLoading')}
          </div>
        ) : items.length === 0 ? (
          <EmptyState text={t('artifactVersionsEmpty')} />
        ) : (
          <div className="grid gap-3">
            {histories.map((history) => (
              <ArtifactHistorySection
                key={history.artifactId}
                history={history}
                busyAction={busyAction}
                comparisons={comparisons}
                bundle={bundles[history.artifactId]}
                onCompare={(item) => void compare(item, history.current)}
                onMaterialize={(item) => void materialize(item)}
                onRestore={(item) => void restore(item, history.current)}
                onExportBundle={() => void exportBundle(history)}
                onVerifyBundle={(path) => void verifyBundle(history.artifactId, path)}
                t={t}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function ArtifactHistorySection({
  history,
  busyAction,
  comparisons,
  bundle,
  onCompare,
  onMaterialize,
  onRestore,
  onExportBundle,
  onVerifyBundle,
  t
}: Readonly<{
  history: ArtifactHistory
  busyAction: string | null
  comparisons: Readonly<Record<string, ArtifactVersionCompareV1>>
  bundle?: BundleState
  onCompare: (item: HistoryItem) => void
  onMaterialize: (item: HistoryItem) => void
  onRestore: (item: HistoryItem) => void
  onExportBundle: () => void
  onVerifyBundle: (path: string) => void
  t: ReturnType<typeof useTranslation>['t']
}>): ReactElement {
  const { current, items } = history
  const exportAllowed = items.every((item) => item.ref.accessPolicy.allowExport)
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-ds-border-muted bg-ds-main/30">
      <header className="border-b border-ds-border-muted px-3 py-2.5">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <Database className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
              <span className="truncate text-[12.5px] font-semibold text-ds-ink">
                {current.artifact.label ?? current.artifact.kind}
              </span>
            </div>
            <div className="mt-1 truncate font-mono text-[9.5px] text-ds-faint" title={history.artifactId}>
              {history.artifactId}
            </div>
          </div>
          <button
            type="button"
            disabled={Boolean(busyAction) || !exportAllowed}
            onClick={onExportBundle}
            className={actionButtonClass}
            title={exportAllowed
              ? t('artifactVersionsExportBundle')
              : t('artifactVersionsExportDenied')}
          >
            {busyAction === `bundle:${history.artifactId}`
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Archive className="h-3 w-3" />}
            {t('artifactVersionsExportBundle')}
          </button>
        </div>
        {bundle ? (
          <BundleReceipt
            bundle={bundle}
            busy={busyAction === `verify:${history.artifactId}`}
            onVerify={() => onVerifyBundle(bundle.receipt.path)}
            t={t}
          />
        ) : null}
      </header>
      <div className="relative grid gap-0 px-3 py-2 before:absolute before:bottom-4 before:left-[18px] before:top-4 before:w-px before:bg-ds-border">
        {items.map((item) => (
          <HistoryCard
            key={item.version.versionId}
            item={item}
            current={current}
            busyAction={busyAction}
            comparison={comparisons[item.version.versionId]}
            onCompare={() => onCompare(item)}
            onMaterialize={() => onMaterialize(item)}
            onRestore={() => onRestore(item)}
            t={t}
          />
        ))}
      </div>
    </section>
  )
}

function HistoryCard({
  item,
  current,
  busyAction,
  comparison,
  onCompare,
  onMaterialize,
  onRestore,
  t
}: Readonly<{
  item: HistoryItem
  current: HistoryItem
  busyAction: string | null
  comparison?: ArtifactVersionCompareV1
  onCompare: () => void
  onMaterialize: () => void
  onRestore: () => void
  t: ReturnType<typeof useTranslation>['t']
}>): ReactElement {
  const isCurrent = item.version.versionId === current.version.versionId
  const canCompare = isCurrent
    ? Boolean(item.version.parentVersionId)
    : item.version.versionId !== current.version.versionId
  return (
    <article className="relative min-w-0 py-2 pl-5">
      <span className={`absolute left-[1px] top-[15px] h-2.5 w-2.5 rounded-full border-2 ${
        isCurrent
          ? 'border-emerald-500 bg-emerald-200 dark:bg-emerald-800'
          : 'border-ds-border bg-ds-sidebar'
      }`} />
      <div className="min-w-0 rounded-lg border border-ds-border-muted bg-ds-main/60 px-3 py-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-ds-ink">
              v{item.version.sequence}
            </span>
            <span className="text-[10.5px] text-ds-muted">{item.version.intent}</span>
          </div>
          {isCurrent ? (
            <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-200">
              {t('artifactVersionsCurrent')}
            </span>
          ) : null}
        </div>

        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-[10.5px]">
          <dt className="text-ds-faint">{t('artifactVersionsCreated')}</dt>
          <dd className="truncate text-ds-muted" title={item.version.createdAt}>
            {formatTime(item.version.createdAt)}
          </dd>
          <dt className="text-ds-faint">{t('artifactVersionsParent')}</dt>
          <dd className="truncate font-mono text-ds-muted" title={item.version.parentVersionId}>
            {item.version.parentVersionId
              ? compactId(item.version.parentVersionId)
              : t('artifactVersionsRootVersion')}
          </dd>
          <dt className="text-ds-faint">{t('artifactVersionsDigest')}</dt>
          <dd className="truncate font-mono text-ds-muted" title={`sha256:${item.ref.contentDigest}`}>
            sha256:{item.ref.contentDigest.slice(0, 16)}…
          </dd>
          <dt className="text-ds-faint">{t('artifactVersionsStorage')}</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-1.5 text-ds-muted">
            <AvailabilityBadge availability={item.ref.availability} t={t} />
            <span>·</span>
            <span>{item.ref.retention === 'snapshot'
              ? t('artifactVersionsSnapshot')
              : t('artifactVersionsReference')}</span>
            <span>·</span>
            <span>{formatBytes(item.ref.byteLength)}</span>
          </dd>
        </dl>

        <div className="mt-2 border-t border-ds-border-muted pt-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ds-faint">
            {t('artifactVersionsDependencies', { count: item.version.dependencies.length })}
          </div>
          {item.version.dependencies.length ? (
            <ul className="mt-1 grid gap-1">
              {item.version.dependencies.map((dependency) => (
                <li
                  key={`${dependency.role}:${dependency.target.versionId}`}
                  className="min-w-0 text-[10px] text-ds-muted"
                  title={`${dependency.target.artifactId} / ${dependency.target.versionId} / sha256:${dependency.target.contentDigest}`}
                >
                  <span className="font-semibold text-ds-ink">{dependency.role}</span>
                  <span> → </span>
                  <span className="font-mono">{compactId(dependency.target.versionId)}</span>
                  {!dependency.required ? <span> ({t('artifactVersionsOptional')})</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-1 text-[10px] text-ds-faint">{t('artifactVersionsNoDependencies')}</div>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={Boolean(busyAction) || !canCompare}
            onClick={onCompare}
            className={actionButtonClass}
          >
            {busyAction === `compare:${item.version.versionId}`
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <GitCompare className="h-3 w-3" />}
            {isCurrent
              ? t('artifactVersionsCompareParent')
              : t('artifactVersionsCompareCurrent')}
          </button>
          <button
            type="button"
            disabled={Boolean(busyAction) || item.ref.availability !== 'available'}
            onClick={onMaterialize}
            className={actionButtonClass}
            title={item.ref.availability === 'available'
              ? t('artifactVersionsMaterialize')
              : t('artifactVersionsUnavailable')}
          >
            {busyAction === `materialize:${item.version.versionId}`
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Download className="h-3 w-3" />}
            {t('artifactVersionsMaterialize')}
          </button>
          {!isCurrent ? (
            <button
              type="button"
              disabled={Boolean(busyAction) || item.ref.availability !== 'available'}
              onClick={onRestore}
              className={actionButtonClass}
            >
              {busyAction === `restore:${item.version.versionId}`
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RotateCcw className="h-3 w-3" />}
              {t('artifactVersionsRestoreAsNew')}
            </button>
          ) : null}
        </div>

        {comparison ? <ComparisonResult comparison={comparison} t={t} /> : null}
      </div>
    </article>
  )
}

function ComparisonResult({
  comparison,
  t
}: Readonly<{
  comparison: ArtifactVersionCompareV1
  t: ReturnType<typeof useTranslation>['t']
}>): ReactElement {
  return (
    <div className="mt-2 rounded-lg border border-blue-300/30 bg-blue-500/5 p-2 text-[10px] text-ds-muted">
      <div className="flex items-center gap-1.5 font-semibold text-ds-ink">
        <GitCompare className="h-3 w-3" />
        {compactId(comparison.from.versionId)} → {compactId(comparison.to.versionId)}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
        <span>{comparison.sameContent
          ? t('artifactVersionsSameContent')
          : t('artifactVersionsDifferentContent')}</span>
        <span>{t('artifactVersionsByteDelta', { count: comparison.byteLengthDelta })}</span>
        <span>{comparison.mediaTypeChanged
          ? t('artifactVersionsMediaChanged')
          : t('artifactVersionsMediaUnchanged')}</span>
        <span>{comparison.metadataChanged
          ? t('artifactVersionsMetadataChanged')
          : t('artifactVersionsMetadataUnchanged')}</span>
        <span>+{comparison.addedDependencies.length}/-{comparison.removedDependencies.length} {t('artifactVersionsDependencyDelta')}</span>
      </div>
      {comparison.textPreview ? (
        <details className="mt-2">
          <summary className="cursor-pointer font-semibold text-ds-ink">
            {t('artifactVersionsTextPreview')}
            {comparison.textPreview.truncated ? ` (${t('artifactVersionsTruncated')})` : ''}
          </summary>
          <div className="mt-1 grid gap-1">
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-ds-sidebar p-1.5 text-[9px]">{comparison.textPreview.from}</pre>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-ds-sidebar p-1.5 text-[9px]">{comparison.textPreview.to}</pre>
          </div>
        </details>
      ) : null}
    </div>
  )
}

function BundleReceipt({
  bundle,
  busy,
  onVerify,
  t
}: Readonly<{
  bundle: BundleState
  busy: boolean
  onVerify: () => void
  t: ReturnType<typeof useTranslation>['t']
}>): ReactElement {
  return (
    <div className="mt-2 rounded-lg border border-ds-border-muted bg-ds-sidebar/60 p-2 text-[10px] text-ds-muted">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {bundle.verification?.valid
            ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" />
            : <Archive className="h-3 w-3 shrink-0" />}
          <span className="truncate" title={bundle.receipt.path}>{bundle.receipt.path}</span>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onVerify}
          className={actionButtonClass}
        >
          {busy
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <ShieldCheck className="h-3 w-3" />}
          {t('artifactVersionsVerifyBundle')}
        </button>
      </div>
      <div className="mt-1 font-mono text-[9px]" title={bundle.receipt.bundleDigest}>
        sha256:{bundle.receipt.bundleDigest.slice(0, 16)}… · {bundle.receipt.artifactCount}/{bundle.receipt.versionCount}/{bundle.receipt.objectCount}
      </div>
      {bundle.verification && !bundle.verification.valid ? (
        <ul className="mt-1 list-inside list-disc text-red-600 dark:text-red-300">
          {bundle.verification.issues.slice(0, 3).map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      ) : null}
    </div>
  )
}

function AvailabilityBadge({
  availability,
  t
}: Readonly<{
  availability: HistoryItem['ref']['availability']
  t: ReturnType<typeof useTranslation>['t']
}>): ReactElement {
  const style = availability === 'available'
    ? 'text-emerald-700 dark:text-emerald-300'
    : availability === 'missing'
      ? 'text-red-600 dark:text-red-300'
      : 'text-amber-700 dark:text-amber-300'
  return (
    <span className={style}>
      {availability === 'available'
        ? t('artifactVersionsAvailable')
        : availability === 'missing'
          ? t('artifactVersionsUnavailable')
          : t('artifactVersionsRemote')}
    </span>
  )
}

function NoticeBox({ notice }: Readonly<{ notice: Notice }>): ReactElement {
  const style = notice.tone === 'error'
    ? 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-200'
    : notice.tone === 'success'
      ? 'border-emerald-300/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
      : 'border-blue-300/50 bg-blue-500/10 text-blue-700 dark:text-blue-200'
  return (
    <div className={`rounded-lg border px-3 py-2 text-[12px] ${style}`} role="status">
      {notice.tone === 'error'
        ? <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
        : notice.tone === 'success'
          ? <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
          : null}
      {notice.message}
    </div>
  )
}

function groupArtifactHistories(items: readonly HistoryItem[]): readonly ArtifactHistory[] {
  const groups = new Map<string, HistoryItem[]>()
  for (const item of items) {
    const group = groups.get(item.artifact.artifactId) ?? []
    group.push(item)
    groups.set(item.artifact.artifactId, group)
  }
  return [...groups.entries()].flatMap(([artifactId, versions]) => {
    versions.sort((left, right) => right.version.sequence - left.version.sequence)
    const current = versions.find((item) =>
      item.version.versionId === item.artifact.currentVersionId
    )
    return current ? [{ artifactId, items: versions, current }] : []
  })
}

function EmptyState({ text }: Readonly<{ text: string }>): ReactElement {
  return (
    <div className="rounded-lg border border-dashed border-ds-border px-4 py-8 text-center text-[12px] text-ds-muted">
      {text}
    </div>
  )
}

const actionButtonClass = [
  'inline-flex items-center gap-1 rounded-md border border-ds-border-muted',
  'bg-ds-sidebar px-2 py-1 text-[10px] font-medium text-ds-muted transition',
  'hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45'
].join(' ')

function compactId(value: string): string {
  const tail = value.split(':').at(-1) ?? value
  return tail.length > 14 ? `${tail.slice(0, 14)}…` : tail
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

function formatTime(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
