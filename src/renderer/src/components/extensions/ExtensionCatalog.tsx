import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Loader2,
  PackagePlus,
  Power,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2
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
  source: 'bundled' | 'user'
  official: true
  verification: 'bundled' | 'official-signed'
  execution: 'trusted-compile-time' | 'sandboxed-runtime'
  status: DomainExtensionStatus
  permissions: readonly string[]
  contributionKinds: readonly string[]
  contributionCount: number
  canRollback: boolean
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
      canRollback: false
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
    official: true,
    verification: summary.verification,
    execution: summary.execution,
    status: summary.status,
    permissions: summary.permissions,
    contributionKinds: summary.contributionKinds,
    contributionCount: summary.contributionCount,
    canRollback: summary.canRollback,
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
  if (kind.endsWith('.agent-artifact-consumer')) return t('extensionContributionArtifacts')
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
  onSetEnabled?: (extension: ExtensionCatalogItem, enabled: boolean) => void
  onRollback?: (extension: ExtensionCatalogItem) => void
  onUninstall?: (extension: ExtensionCatalogItem) => void
}>

export function ExtensionCard({
  extension,
  runtimeStatus,
  busy = false,
  onSetEnabled,
  onRollback,
  onUninstall
}: ExtensionCardProps): ReactElement {
  const { t } = useTranslation('common')
  const status = runtimeStatus ?? extensionStatus(extension, t)
  const contributionLabels = [...new Set(
    extension.contributionKinds.map((kind) => contributionKindLabel(kind, t))
  )]
  const enabled = extension.status === 'active' ||
    extension.status === 'installed' ||
    extension.status === 'restart-required'

  return (
    <article className="flex min-h-[214px] flex-col rounded-2xl border border-ds-border bg-ds-card p-5 shadow-sm">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ds-subtle text-ds-muted">
          <Box className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[17px] font-semibold text-ds-ink">
              {extension.displayName}
            </h3>
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/30 dark:text-blue-200">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              {t('extensionOfficial')}
            </span>
            <span className="rounded-md bg-ds-subtle px-2 py-0.5 text-[11px] font-semibold text-ds-muted">
              {t(extension.source === 'bundled' ? 'extensionBundled' : 'extensionLocal')}
            </span>
            <span
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${runtimeStatusTone(status.tone)}`}
              title={status.detail}
            >
              {status.label}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-ds-faint">
            {extension.packageName}
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
        <div>
          <dt className="text-ds-faint">{t('extensionPublisher')}</dt>
          <dd className="mt-0.5 font-medium text-ds-ink">{extension.publisher}</dd>
        </div>
        <div>
          <dt className="text-ds-faint">{t('extensionVersion')}</dt>
          <dd className="mt-0.5 font-mono text-ds-ink">{extension.version}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-ds-faint">{t('extensionSource')}</dt>
          <dd className="mt-0.5 font-medium text-ds-ink">
            {t(extension.source === 'bundled'
              ? 'extensionBundledSource'
              : 'extensionLocalSource')}
          </dd>
        </div>
      </dl>

      {extension.diagnostic ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] leading-5 text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {extension.diagnostic}
        </p>
      ) : null}

      <div className="mt-4 border-t border-ds-border-muted pt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ds-faint">
          {t('extensionContributes', { count: extension.contributionCount })}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {contributionLabels.length > 0 ? (
            contributionLabels.map((label) => (
              <span
                key={label}
                className="rounded-md border border-ds-border-muted bg-ds-subtle px-2 py-1 text-[11px] text-ds-muted"
              >
                {label}
              </span>
            ))
          ) : (
            <span className="text-[12px] text-ds-faint">{t('extensionNoContributions')}</span>
          )}
        </div>
      </div>

      {extension.source === 'user' && (onSetEnabled || onRollback || onUninstall) ? (
        <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-ds-border-muted pt-4">
          {onSetEnabled && extension.status !== 'invalid' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onSetEnabled(extension, !enabled)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border px-2.5 py-1.5 text-[12px] font-semibold text-ds-muted transition hover:text-ds-ink disabled:opacity-50"
            >
              <Power className="h-3.5 w-3.5" aria-hidden="true" />
              {t(enabled ? 'extensionDisable' : 'extensionEnable')}
            </button>
          ) : null}
          {onRollback && extension.canRollback ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRollback(extension)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border px-2.5 py-1.5 text-[12px] font-semibold text-ds-muted transition hover:text-ds-ink disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t('extensionRollback')}
            </button>
          ) : null}
          {onUninstall ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onUninstall(extension)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-[12px] font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"
            >
              {busy
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
              {t('extensionUninstall')}
            </button>
          ) : null}
        </div>
      ) : null}
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
  onSetEnabled?: (extension: ExtensionCatalogItem, enabled: boolean) => void
  onRollback?: (extension: ExtensionCatalogItem) => void
  onUninstall?: (extension: ExtensionCatalogItem) => void
}>

export function ExtensionCatalog({
  extensions = extensionCatalogItemsFromDefinitions(installedDomainPackages.definitions),
  statusProvider,
  loading = false,
  error,
  busyPackageName,
  onInstall,
  onSetEnabled,
  onRollback,
  onUninstall
}: ExtensionCatalogProps): ReactElement {
  const { t } = useTranslation('common')
  const [query, setQuery] = useState('')
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
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {visibleExtensions.map((extension) => (
            <ExtensionCard
              key={`${extension.source}:${extension.packageName}`}
              extension={extension}
              runtimeStatus={statusProvider?.(extension)}
              busy={busyPackageName === extension.packageName}
              onSetEnabled={onSetEnabled}
              onRollback={onRollback}
              onUninstall={onUninstall}
            />
          ))}
        </div>
      )}
    </section>
  )
}
