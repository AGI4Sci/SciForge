import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  ChevronLeft,
  Loader2,
  PackagePlus,
  Search,
  ShieldCheck
} from 'lucide-react'
import type { TrustedDomainPackageDefinition } from '@sciforge/domain-sdk'
import type {
  DomainExtensionStatus,
  DomainExtensionSummary
} from '@shared/domain-extensions'
import { installedDomainPackages } from '@shared/installed-domain-packages'

export type ExtensionCatalogItem = Readonly<{
  id: string
  displayName: string
  packageName: string
  publisher: string
  version: string
  source: 'bundled' | 'user' | 'development'
  official: boolean
  verification: 'bundled' | 'official-signed' | 'development-local'
  execution: 'trusted-compile-time' | 'sandboxed-runtime'
  status: DomainExtensionStatus
  permissions: readonly string[]
  contributionKinds: readonly string[]
  contributionCount: number
  canRollback: boolean
  enabled?: boolean
  candidateVersion?: string
  restartRequired?: boolean
  generation?: number
  hostApi?: { minimum: string; maximumExclusive: string }
  activationState?: string
  installedAt?: string
  diagnostic?: string
}>

export type ExtensionRuntimeStatus = Readonly<{
  label: string
  detail?: string
  tone?: 'default' | 'success' | 'warning' | 'error'
}>

export type ExtensionRuntimeStatusProvider = (
  extension: ExtensionCatalogItem
) => ExtensionRuntimeStatus | null | undefined

export function extensionCatalogItemsFromDefinitions(
  definitions: readonly TrustedDomainPackageDefinition[]
): ExtensionCatalogItem[] {
  return definitions.map((definition) => {
    const contributions = definition.entrypoints.flatMap((entrypoint) => entrypoint.contributions)
    return {
      id: definition.module.id,
      displayName: definition.module.displayName,
      packageName: definition.packageName,
      publisher: definition.publisher?.displayName ??
        publisherFromPackageName(definition.packageName),
      version: definition.module.version,
      source: 'bundled' as const,
      official: true as const,
      verification: 'bundled' as const,
      execution: 'trusted-compile-time' as const,
      status: 'active' as const,
      permissions: [],
      contributionKinds: [...new Set(contributions.map((contribution) => contribution.kind))],
      contributionCount: contributions.length,
      canRollback: false,
      enabled: true
    }
  })
}

export function extensionCatalogItemsFromSummaries(
  summaries: readonly DomainExtensionSummary[]
): ExtensionCatalogItem[] {
  return summaries.map((summary) => ({
    id: summary.moduleId,
    displayName: summary.moduleDisplayName,
    packageName: summary.packageName,
    publisher: summary.publisher.displayName,
    version: summary.version,
    source: summary.source,
    official: summary.verification !== 'development-local',
    verification: summary.verification,
    execution: summary.execution,
    status: summary.status,
    permissions: summary.permissions,
    contributionKinds: summary.contributionKinds,
    contributionCount: summary.contributionCount,
    canRollback: summary.canRollback,
    ...(summary.enabled !== undefined ? { enabled: summary.enabled } : {}),
    ...(summary.candidateVersion ? { candidateVersion: summary.candidateVersion } : {}),
    ...(summary.restartRequired ? { restartRequired: summary.restartRequired } : {}),
    ...(summary.generation !== undefined ? { generation: summary.generation } : {}),
    ...(summary.hostApi ? { hostApi: summary.hostApi } : {}),
    ...(summary.activationState ? { activationState: summary.activationState } : {}),
    ...(summary.installedAt ? { installedAt: summary.installedAt } : {}),
    ...(summary.diagnostic ? { diagnostic: summary.diagnostic } : {})
  }))
}

function publisherFromPackageName(packageName: string): string {
  const scope = packageName.match(/^@([^/]+)\//)?.[1]
  if (!scope) return packageName
  return scope === 'sciforge'
    ? 'SciForge'
    : scope
        .split(/[-_.]+/)
        .filter(Boolean)
        .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
        .join(' ')
}

function contributionKindLabel(
  kind: string,
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  if (kind.endsWith('.capability-factory')) return t('extensionContributionCapabilities')
  if (kind.endsWith('.workbench-right-panel')) return t('extensionContributionPanels')
  if (kind.endsWith('.workbench-toolbar-action')) return t('extensionContributionToolbar')
  if (kind.endsWith('.workspace-preview-plugin')) return t('extensionContributionPreviews')
  if (kind.endsWith('.runtime-lifecycle')) return t('extensionContributionRuntime')
  if (kind.endsWith('.artifact-consumer')) return t('extensionContributionArtifacts')
  if (kind.endsWith('.action-guard')) return t('extensionContributionGuards')
  if (kind.endsWith('.lifecycle')) return t('extensionContributionLifecycle')
  if (kind.endsWith('.i18n-resource')) return t('extensionContributionTranslations')
  return kind
}

function runtimeStatusTone(tone: ExtensionRuntimeStatus['tone']): string {
  switch (tone) {
    case 'success':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200'
    case 'warning':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200'
    case 'error':
      return 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
    case 'default':
    default:
      return 'bg-ds-subtle text-ds-muted'
  }
}

function extensionStatus(
  extension: ExtensionCatalogItem,
  t: (key: string) => string
): ExtensionRuntimeStatus {
  switch (extension.status) {
    case 'active':
      return { label: t('extensionStatusActive'), tone: 'success' }
    case 'installed':
      return { label: t('extensionStatusInstalled'), tone: 'success' }
    case 'disabled':
      return { label: t('extensionStatusDisabled'), tone: 'default' }
    case 'restart-required':
      return { label: t('extensionStatusRestartRequired'), tone: 'warning' }
    case 'invalid':
      return {
        label: t('extensionStatusInvalid'),
        detail: extension.diagnostic,
        tone: 'error'
      }
  }
}

type ExtensionCardProps = Readonly<{
  extension: ExtensionCatalogItem
  runtimeStatus?: ExtensionRuntimeStatus | null
  busy?: boolean
  onOpenDetails?: (extension: ExtensionCatalogItem) => void
  onRollback?: (extension: ExtensionCatalogItem) => void
  onUninstall?: (extension: ExtensionCatalogItem) => void
  onSetEnabled?: (extension: ExtensionCatalogItem, enabled: boolean) => void
}>

export function ExtensionCard({
  extension,
  runtimeStatus,
  busy = false,
  onOpenDetails,
  onRollback,
  onUninstall
}: ExtensionCardProps): ReactElement {
  const { t } = useTranslation('common')
  const status = runtimeStatus ?? extensionStatus(extension, t)

  return (
    <article className="rounded-2xl border border-ds-border bg-ds-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={() => onOpenDetails?.(extension)} aria-label={`Show details for ${extension.displayName}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ds-subtle text-ds-muted transition hover:bg-ds-border-muted hover:text-ds-ink">
          <Box className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => onOpenDetails?.(extension)} aria-label={`Show details for ${extension.displayName}`} className="min-w-0 truncate text-left text-[15px] font-semibold text-ds-ink hover:text-accent">
              {extension.displayName}
            </button>
            {extension.official ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/30 dark:text-blue-200">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                {t('extensionOfficial')}
              </span>
            ) : (
              <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                Development
              </span>
            )}
            <span className="rounded-md bg-ds-subtle px-1.5 py-0.5 text-[10px] font-semibold text-ds-muted">
              {extension.source === 'development'
                ? t('extensionDevelopmentPlugin', { defaultValue: 'Development plugin' })
                : t(extension.source === 'bundled' ? 'extensionBundled' : 'extensionLocal')}
            </span>
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${runtimeStatusTone(status.tone)}`}
              title={status.detail}
            >
              {status.label}
            </span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-ds-faint">
            {extension.packageName}
          </div>
        </div>
      </div>
    </article>
  )
}

function ExtensionDetails({
  extension,
  runtimeStatus,
  busy = false,
  onBack,
  onRollback,
  onUninstall,
  onSetEnabled,
  onApplyCandidate,
  onCancelCandidate,
  onCheckCandidate
}: ExtensionCardProps & {
  onBack: () => void
  onApplyCandidate?: (extension: ExtensionCatalogItem) => void
  onCancelCandidate?: (extension: ExtensionCatalogItem) => void
  onCheckCandidate?: (extension: ExtensionCatalogItem) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const status = runtimeStatus ?? extensionStatus(extension, t)
  const labels = [...new Set(extension.contributionKinds.map((kind) => contributionKindLabel(kind, t)))]
  const enabled = extension.enabled ?? (extension.status !== 'disabled' && extension.status !== 'invalid')
  return (
    <article className="mt-4 rounded-2xl border border-ds-border bg-ds-card p-5 shadow-sm">
      <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ds-muted hover:text-ds-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        {t('extensionBackToList', { defaultValue: 'Back to extensions' })}
      </button>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ds-subtle text-ds-muted"><Box className="h-5 w-5" aria-hidden="true" /></div>
        <div className="min-w-0 flex-1"><h3 className="text-xl font-semibold text-ds-ink">{extension.displayName}</h3><div className="mt-1 font-mono text-xs text-ds-faint">{extension.packageName}</div></div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2"><span className={`rounded-md px-2 py-1 text-xs font-semibold ${runtimeStatusTone(status.tone)}`}>{status.label}</span><span className="rounded-md bg-ds-subtle px-2 py-1 text-xs text-ds-muted">{extension.version}</span></div>
      {extension.source !== 'bundled' && onSetEnabled ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={busy || (!enabled && extension.status === 'invalid')}
            onClick={() => onSetEnabled(extension, !enabled)}
            className="inline-flex items-center gap-2 rounded-lg border border-ds-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
            {t(enabled ? 'extensionDisable' : 'extensionEnable')}
          </button>
        </div>
      ) : null}
      <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-ds-border-muted pt-5 text-sm sm:grid-cols-2">
        <div><dt className="text-ds-faint">{t('extensionPublisher')}</dt><dd className="mt-1 text-ds-ink">{extension.publisher}</dd></div>
        <div><dt className="text-ds-faint">{t('extensionSource')}</dt><dd className="mt-1 text-ds-ink">{extension.source === 'development' ? 'PR-2 external plugin directory' : extension.source}</dd></div>
        <div><dt className="text-ds-faint">Host API</dt><dd className="mt-1 font-mono text-ds-ink">{extension.hostApi ? `>=${extension.hostApi.minimum} & <${extension.hostApi.maximumExclusive}` : 'unknown / adapter-required'}</dd></div>
        <div><dt className="text-ds-faint">Runtime</dt><dd className="mt-1 font-mono text-ds-ink">{extension.activationState ?? 'not-loaded'}</dd></div>
      </dl>
      {extension.diagnostic ? <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">{extension.diagnostic}</p> : null}
      <div className="mt-5 border-t border-ds-border-muted pt-4"><div className="text-xs font-semibold uppercase tracking-wide text-ds-faint">{t('extensionContributes', { count: extension.contributionCount })}</div><div className="mt-2 flex flex-wrap gap-1.5">{labels.length ? labels.map((label) => <span key={label} className="rounded-md border border-ds-border-muted bg-ds-subtle px-2 py-1 text-xs text-ds-muted">{label}</span>) : <span className="text-sm text-ds-faint">{t('extensionNoContributions')}</span>}</div></div>
      {extension.source !== 'bundled' && (onRollback || onUninstall) ? <div className="mt-4 flex justify-end gap-2 border-t border-ds-border-muted pt-4">{onRollback && extension.canRollback ? <button type="button" disabled={busy} onClick={() => onRollback(extension)} className="rounded-lg border border-ds-border px-3 py-1.5 text-xs font-semibold">{t('extensionRollback')}</button> : null}{onUninstall && extension.source === 'user' ? <button type="button" disabled={busy} onClick={() => onUninstall(extension)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600">{t('extensionUninstall')}</button> : null}</div> : null}
      {onCheckCandidate && extension.source !== 'bundled' ? <div className="mt-4 flex justify-end gap-2 border-t border-ds-border-muted pt-4"><button type="button" disabled={busy} onClick={() => onCheckCandidate(extension)} className="rounded-lg border border-ds-border px-3 py-1.5 text-xs font-semibold">{t('extensionCheckCandidate', { defaultValue: 'Check candidate version' })}</button></div> : null}
      {(extension.candidateVersion || extension.restartRequired) && (onApplyCandidate || onCancelCandidate) ? <div className="mt-4 flex justify-end gap-2 border-t border-ds-border-muted pt-4">{extension.candidateVersion ? <span className="self-center text-xs text-ds-muted">candidate {extension.candidateVersion}</span> : null}{onApplyCandidate ? <button type="button" disabled={busy} onClick={() => onApplyCandidate(extension)} className="rounded-lg border border-ds-border px-3 py-1.5 text-xs font-semibold">{t('extensionApplyUpdate', { defaultValue: 'Apply update' })}</button> : null}{onCancelCandidate ? <button type="button" disabled={busy} onClick={() => onCancelCandidate(extension)} className="rounded-lg border border-ds-border px-3 py-1.5 text-xs font-semibold">{t('extensionCancelCandidate', { defaultValue: 'Cancel update' })}</button> : null}</div> : null}
    </article>
  )
}

export type ExtensionCatalogProps = Readonly<{
  extensions?: readonly ExtensionCatalogItem[]
  statusProvider?: ExtensionRuntimeStatusProvider
  loading?: boolean
  error?: string
  busyPackageName?: string | null
  onInstall?: () => void
  onRollback?: (extension: ExtensionCatalogItem) => void
  onUninstall?: (extension: ExtensionCatalogItem) => void
  onSetEnabled?: (extension: ExtensionCatalogItem, enabled: boolean) => void
  onApplyCandidate?: (extension: ExtensionCatalogItem) => void
  onCancelCandidate?: (extension: ExtensionCatalogItem) => void
  onCheckCandidate?: (extension: ExtensionCatalogItem) => void
}>

export function ExtensionCatalog({
  extensions = extensionCatalogItemsFromDefinitions(installedDomainPackages.definitions),
  statusProvider,
  loading = false,
  error,
  busyPackageName,
  onInstall,
  onRollback,
  onUninstall,
  onSetEnabled,
  onApplyCandidate,
  onCancelCandidate,
  onCheckCandidate
}: ExtensionCatalogProps): ReactElement {
  const { t } = useTranslation('common')
  const [query, setQuery] = useState('')
  const [selectedExtensionKey, setSelectedExtensionKey] = useState<string | null>(null)
  const selectedExtension = extensions.find(
    (extension) => `${extension.source}:${extension.packageName}` === selectedExtensionKey
  )
  const visibleExtensions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return extensions
    return extensions.filter((extension) => {
      const searchable = [
        extension.displayName,
        extension.id,
        extension.packageName,
        extension.publisher,
        extension.version,
        ...extension.permissions,
        ...extension.contributionKinds
      ]
      return searchable.some((value) => value.toLowerCase().includes(normalizedQuery))
    })
  }, [extensions, query])

  return (
    <section
      id="extension-center-extensions-panel"
      role="tabpanel"
      aria-labelledby="extension-center-extensions-tab"
      className="mt-7"
    >
      <div className="flex flex-col gap-3 rounded-2xl border border-ds-border bg-ds-card/75 p-4 text-[13px] leading-5 text-ds-muted sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-semibold text-ds-ink">{t('extensionTrustTitle')}</div>
          <p className="mt-1">{t('extensionTrustBody')}</p>
          <p className="mt-1 text-amber-700 dark:text-amber-300">
            {t('extensionStateChangesNotice')}
          </p>
        </div>
        {onInstall ? (
          <button
            type="button"
            disabled={busyPackageName === '__install__'}
            onClick={onInstall}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            {busyPackageName === '__install__'
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <PackagePlus className="h-4 w-4" aria-hidden="true" />}
            {t('extensionInstallFromFile')}
          </button>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
        >
          {error}
        </div>
      ) : null}

      <label className="relative mt-5 block">
        <span className="sr-only">{t('extensionSearch')}</span>
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-faint"
          aria-hidden="true"
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-11 w-full rounded-2xl border border-ds-border bg-ds-card pl-11 pr-4 text-[15px] text-ds-ink shadow-sm outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
          placeholder={t('extensionSearch')}
        />
      </label>

      <div className="mt-4 flex items-center justify-between border-b border-ds-border-muted pb-3">
        <h2 className="text-[20px] font-semibold text-ds-ink">{t('extensionInstalledTitle')}</h2>
        <span className="text-[12px] text-ds-faint">
          {loading ? t('extensionLoading') : t('extensionCount', { count: visibleExtensions.length })}
        </span>
      </div>

      {visibleExtensions.length === 0 ? (
        <div className="py-10 text-[14px] text-ds-faint">
          {loading ? t('extensionLoading') : t('extensionNoResults')}
        </div>
      ) : selectedExtension ? (
        <ExtensionDetails
          extension={selectedExtension}
          runtimeStatus={statusProvider?.(selectedExtension)}
          busy={busyPackageName === selectedExtension.packageName}
          onBack={() => setSelectedExtensionKey(null)}
          onRollback={onRollback}
          onUninstall={onUninstall}
          onSetEnabled={onSetEnabled}
          onApplyCandidate={onApplyCandidate}
          onCancelCandidate={onCancelCandidate}
          onCheckCandidate={onCheckCandidate}
        />
      ) : (
        <div className="mt-4 grid items-start gap-x-8 gap-y-2 lg:grid-cols-2">
          {visibleExtensions.map((extension) => (
            <ExtensionCard
              key={`${extension.source}:${extension.packageName}`}
              extension={extension}
              runtimeStatus={statusProvider?.(extension)}
              busy={busyPackageName === extension.packageName}
              onOpenDetails={(item) => setSelectedExtensionKey(`${item.source}:${item.packageName}`)}
              onRollback={onRollback}
              onUninstall={onUninstall}
            />
          ))}
        </div>
      )}
    </section>
  )
}
