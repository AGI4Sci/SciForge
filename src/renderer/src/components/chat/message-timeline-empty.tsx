import { Fragment, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, GitFork, RefreshCw, Settings, X } from 'lucide-react'
import type { AgentRuntimeId } from '@shared/app-settings'
import { InitialSessionUsageHeatmap } from './InitialSessionUsageHeatmap'

/**
 * Empty / hero states rendered by `MessageTimeline` when there is no
 * turn content yet. Lifted out of the timeline component so the main
 * file can focus on rendering turns and scroll behaviour.
 */

function RuntimeWakeHero({
  runtimeError,
  onDismissRuntimeError,
  onRetry,
  onOpenSettings
}: {
  runtimeError?: string | null
  onDismissRuntimeError?: () => void
  onRetry: () => void
  onOpenSettings: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  // When the runtime probe has surfaced a specific error (e.g. port conflict,
  // missing API key, or unhealthy runtime), prefer a clear "cannot connect"
  // title and show the localized error message as the body. Otherwise fall
  // back to the generic "waking" hero. This addresses issue #78, where users
  // saw the "正在唤醒" title and assumed the app was still loading, never
  // noticing the port-conflict detail text below it.
  const trimmedError = runtimeError?.trim() ?? ''
  const hasError = trimmedError.length > 0
  const title = hasError ? t('runtimeErrorHeroTitle') : t('runtimeOfflineHeroTitle')
  const detail = hasError ? trimmedError : t('runtimeOfflineHeroSub')

  return (
    <div className="ds-runtime-wake-hero ds-no-drag px-6 pb-8 pt-12 text-center md:pt-16">
      <p className="text-ds-sm font-semibold uppercase tracking-[0] text-accent">
        {t('runtimeOfflineHeroKicker')}
      </p>
      <h1 className="mt-2 max-w-[620px] text-ds-5xl font-semibold leading-tight tracking-[0] text-ds-ink md:text-ds-7xl">
        {title}
      </h1>
      <p className="mt-3 max-w-[620px] text-ds-xl leading-7 text-ds-muted">
        {detail}
      </p>
      {hasError && onDismissRuntimeError ? (
        <button type="button" onClick={onDismissRuntimeError} aria-label={t('close')}
          className="ds-chip-muted mt-4 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-ds-md text-ds-muted hover:text-ds-ink">
          <X className="h-4 w-4" aria-hidden="true" />{t('close')}
        </button>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          className="ds-chip inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-ds-md font-medium text-ds-ink transition hover:text-ds-ink"
          onClick={onRetry}
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('retryConnection')}
        </button>
        <button
          type="button"
          className="ds-chip-muted inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-ds-md font-medium text-ds-muted transition hover:text-ds-ink"
          onClick={onOpenSettings}
        >
          <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('openSettings')}
        </button>
      </div>
    </div>
  )
}

export function MessageTimelineEmptyHero({
  ready,
  hasWorkspace,
  runtimeError,
  onDismissRuntimeError,
  runtimeId,
  onPickWorkspace,
  onRetry,
  onOpenSettings,
  onSelectSuggestion
}: {
  ready: boolean
  hasWorkspace: boolean
  runtimeError?: string | null
  onDismissRuntimeError?: () => void
  runtimeId: AgentRuntimeId
  onPickWorkspace: () => void
  onRetry: () => void
  onOpenSettings: () => void
  onSelectSuggestion?: (prompt: string) => void
}): ReactElement {
  const { t } = useTranslation('common')

  if (!ready) {
    return <RuntimeWakeHero runtimeError={runtimeError} onDismissRuntimeError={onDismissRuntimeError} onRetry={onRetry} onOpenSettings={onOpenSettings} />
  }

  if (!hasWorkspace) {
    return (
      <div className="ds-no-drag flex flex-col items-center justify-center px-6 py-24 text-center">
        <FolderOpen className="mb-4 h-8 w-8 text-ds-muted" strokeWidth={1.6} />
        <h1 className="text-ds-5xl font-semibold tracking-[-0.02em] text-ds-ink">
          {t('selectWorkspace')}
        </h1>
        <p className="mt-2 max-w-sm text-ds-lg leading-6 text-ds-muted">
          {t('emptyHeroSubNoWorkspace')}
        </p>
        <button
          type="button"
          className="ds-chip mt-5 rounded-full px-5 py-2.5 text-ds-md font-medium text-ds-ink transition hover:text-ds-ink"
          onClick={onPickWorkspace}
        >
          {t('selectWorkspace')}
        </button>
      </div>
    )
  }

  void onSelectSuggestion
  return <InitialSessionUsageHeatmap runtimeId={runtimeId} />
}

export function ThreadForkBanner({ parentTitle }: { parentTitle: string }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="rounded-[18px] border border-accent/16 bg-accent/7 px-4 py-3 text-ds-muted shadow-[0_14px_36px_rgba(0,136,255,0.05)]">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-accent/12 text-accent">
          <GitFork className="h-4 w-4" strokeWidth={1.85} />
        </span>
        <span className="min-w-0">
          <span className="block text-ds-md font-semibold text-ds-ink">
            {t('threadForkBannerTitle')}
          </span>
          <span className="mt-1 block text-ds-sm leading-5 text-ds-muted">
            {parentTitle
              ? t('threadForkBannerSub', { title: parentTitle })
              : t('threadForkBannerSubUnknown')}
          </span>
        </span>
      </div>
    </div>
  )
}

export function ThreadForkPoint({ parentTitle }: { parentTitle: string }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex items-center gap-3 py-1 text-ds-sm font-medium text-ds-faint">
      <span className="h-px min-w-6 flex-1 bg-ds-border-muted" />
      <span
        className="inline-flex max-w-[min(100%,420px)] items-center gap-1.5 rounded-full border border-accent/16 bg-ds-card/78 px-3 py-1.5 text-accent shadow-sm"
        title={parentTitle ? t('threadForkPointFrom', { title: parentTitle }) : t('threadForkPoint')}
      >
        <GitFork className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span className="truncate">
          {parentTitle ? t('threadForkPointFrom', { title: parentTitle }) : t('threadForkPoint')}
        </span>
      </span>
      <span className="h-px min-w-6 flex-1 bg-ds-border-muted" />
    </div>
  )
}
