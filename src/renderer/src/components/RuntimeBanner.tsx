import type { ReactElement } from 'react'
import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy, FolderOpen } from 'lucide-react'
import type { AgentRuntimeId } from '@shared/app-settings'
import type { AgentRuntimeDiscoveryResult } from '@shared/agent-runtime-contract'
import { runtimeErrorTranslationKey } from '../lib/format-runtime-error'

export function runtimeDiscoveryForActiveRuntime(
  runtimeId: AgentRuntimeId,
  discovery: AgentRuntimeDiscoveryResult | null
): AgentRuntimeDiscoveryResult | null {
  return discovery?.runtimeId === runtimeId ? discovery : null
}

export function RuntimeBanner({
  message,
  detail,
  discovery,
  code,
  logPath,
  onOpenLogDir,
  onOpenSettings,
  onRetryConnection,
  onChooseRuntime,
  onOpenInstallGuide,
  runtimeReady,
  stageInsetClass,
  t
}: {
  message: string
  detail?: string | null
  discovery?: AgentRuntimeDiscoveryResult | null
  code?: string | null
  logPath?: string | null
  onOpenLogDir?: () => Promise<{ ok: boolean; message?: string }>
  onOpenSettings: () => void
  onRetryConnection: () => void
  onChooseRuntime?: () => void
  onOpenInstallGuide?: () => void
  runtimeReady: boolean
  stageInsetClass: string
  t: (key: string, options?: Record<string, unknown>) => string
}): ReactElement {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [logOpenError, setLogOpenError] = useState<string | null>(null)
  const cleanedLogPath = logPath?.trim() ?? ''
  const technicalDetailText = [
    code ? `Code: ${code}` : '',
    detail?.trim() ?? ''
  ].filter(Boolean).join('\n\n')
  const detailText = [
    technicalDetailText,
    cleanedLogPath ? `${t('runtimeErrorLogPath')}: ${cleanedLogPath}` : ''
  ].filter(Boolean).join('\n\n')
  const hasDetail = technicalDetailText.trim().length > 0

  const copyDetails = async (): Promise<void> => {
    if (!hasDetail || !navigator?.clipboard?.writeText) return
    await navigator.clipboard.writeText(detailText)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const openLogDir = async (): Promise<void> => {
    if (!onOpenLogDir) return
    setLogOpenError(null)
    try {
      const result = await onOpenLogDir()
      if (!result.ok) setLogOpenError(result.message ?? t('runtimeErrorOpenLogsFailed'))
    } catch (error) {
      setLogOpenError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="ds-no-drag shrink-0 border-b border-amber-200/70 bg-[rgba(255,248,235,0.82)] backdrop-blur-lg dark:border-amber-800/50 dark:bg-amber-950/35">
      <div className={`${stageInsetClass} flex w-full min-w-0 flex-col gap-2 py-3`}>
        <div className="flex w-full min-w-0 items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-[14px] leading-6 text-amber-950 dark:text-amber-100">
            {message}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {hasDetail ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-medium text-amber-900/80 transition hover:bg-amber-50/70 dark:text-amber-100 dark:hover:bg-amber-900/30"
                onClick={() => setDetailsOpen((value) => !value)}
              >
                {detailsOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
                )}
                {t('runtimeErrorDetails')}
              </button>
            ) : null}
            {!runtimeReady ? (
              <>
                <button
                  type="button"
                  className="rounded-lg border border-amber-300/70 bg-white px-3 py-1 text-[12px] font-medium text-amber-950 transition hover:bg-amber-100/80 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-100 dark:hover:bg-amber-900/40"
                  onClick={onRetryConnection}
                >
                  {t('retryConnection')}
                </button>
                <button
                  type="button"
                  className="rounded-lg px-3 py-1 text-[12px] font-medium text-amber-900/80 transition hover:bg-amber-50/70 dark:text-amber-100 dark:hover:bg-amber-900/30"
                  onClick={onOpenSettings}
                >
                  {t('openSettings')}
                </button>
                {onChooseRuntime ? (
                  <button
                    type="button"
                    className="rounded-lg px-3 py-1 text-[12px] font-medium text-amber-900/80 transition hover:bg-amber-50/70 dark:text-amber-100 dark:hover:bg-amber-900/30"
                    onClick={onChooseRuntime}
                  >
                    {t('runtimeChooseLocalApp')}
                  </button>
                ) : null}
                {onOpenInstallGuide ? (
                  <button
                    type="button"
                    className="rounded-lg px-3 py-1 text-[12px] font-medium text-amber-900/80 transition hover:bg-amber-50/70 dark:text-amber-100 dark:hover:bg-amber-900/30"
                    onClick={onOpenInstallGuide}
                  >
                    {t('runtimeInstallGuide')}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        {discovery ? (
          <div className="text-[12px] leading-5 text-amber-900/80 dark:text-amber-100/85">
            {discovery.failure
              ? t(runtimeErrorTranslationKey(discovery.failure.code) ?? 'runtimeActionFailed')
              : t('runtimeDiscoveryDetected', {
                  source: discovery.source
                    ? t(`runtimeDiscoverySource_${discovery.source.replaceAll('-', '_')}`)
                    : t('runtimeDiscoveryUnknown'),
                  version: discovery.version ?? t('runtimeDiscoveryUnknown')
                })}
          </div>
        ) : null}
        {cleanedLogPath ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px] leading-5 text-amber-900/80 dark:text-amber-100/85">
            <span className="font-medium">{t('runtimeErrorLogPath')}</span>
            <code className="min-w-0 max-w-full break-all rounded-md bg-white/70 px-2 py-0.5 font-mono text-[12px] text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
              {cleanedLogPath}
            </code>
            {onOpenLogDir ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium text-amber-900/85 transition hover:bg-amber-50/70 dark:text-amber-100 dark:hover:bg-amber-900/30"
                onClick={() => void openLogDir()}
              >
                <FolderOpen className="h-3.5 w-3.5" strokeWidth={2} />
                {t('windowsMenuOpenLogDir')}
              </button>
            ) : null}
            {logOpenError ? (
              <span className="text-red-700 dark:text-red-300">{logOpenError}</span>
            ) : null}
          </div>
        ) : null}
        {hasDetail && detailsOpen ? (
          <div className="rounded-lg border border-amber-300/60 bg-white/70 p-3 dark:border-amber-800/50 dark:bg-amber-950/25">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[12px] font-semibold text-amber-950 dark:text-amber-100">
                {t('runtimeErrorTechnicalDetails')}
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-amber-900/80 transition hover:bg-amber-100/70 dark:text-amber-100 dark:hover:bg-amber-900/40"
                onClick={() => void copyDetails()}
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                {copied ? t('copySuccess') : t('copyDetails')}
              </button>
            </div>
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-amber-950 dark:text-amber-100">
              {detailText}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  )
}
