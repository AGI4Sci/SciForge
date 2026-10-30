/**
 * Settings-side view of the automatic reasoning-level discovery for one binding.
 *
 * Shows the resolved outcome (state / levels / source / updated-at / partial),
 * marks each manually declared level as confirmed / unconfirmed / conflicting
 * with an explicit upstream "unsupported" (never claiming "unsupported" for a
 * mere absence of evidence), and offers refresh + restore-to-auto.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { ModelReasoningOutcome } from '@shared/model-reasoning'
import { composerReasoningLevelLabelKey, composerReasoningSourceKey } from '../lib/composer-reasoning-discovery'

type Translate = (key: string, values?: Record<string, unknown>) => string

type PanelState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  outcome: ModelReasoningOutcome | null
}

function stateLabelKey(outcome: ModelReasoningOutcome): string {
  if (outcome.state === 'known') return 'modelRouterReasoningDiscoveryStateKnown'
  if (outcome.state === 'unsupported') return 'modelRouterReasoningDiscoveryStateUnsupported'
  return 'modelRouterReasoningDiscoveryStateUnknown'
}

function declaredStatusKey(outcome: ModelReasoningOutcome, effort: string): string {
  const normalized = effort.trim()
  if (outcome.state === 'unsupported') return 'modelRouterReasoningDiscoveryDeclaredConflictUnsupported'
  if (
    outcome.state === 'known' &&
    outcome.levels.some((level) => level.trim() === normalized)
  ) {
    return 'modelRouterReasoningDiscoveryDeclaredConfirmed'
  }
  // No evidence is not a negative: an explicit level outside the discovered
  // list is "unconfirmed", never "unsupported".
  return 'modelRouterReasoningDiscoveryDeclaredUnconfirmed'
}

function formatCheckedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function ModelReasoningDiscoveryPanel({
  model,
  protocol,
  endpoint,
  declaredEfforts = [],
  onRestoreAuto,
  t
}: {
  model: string
  protocol: string
  endpoint: string
  declaredEfforts?: string[]
  onRestoreAuto?: () => void
  t: Translate
}): ReactElement | null {
  const query = useMemo(
    () =>
      model.trim() && endpoint.trim()
        ? {
            provider: 'model-router',
            model: model.trim(),
            protocol: protocol.trim() || 'auto',
            endpoint: endpoint.trim()
          }
        : null,
    [model, protocol, endpoint]
  )
  const [state, setState] = useState<PanelState>({ status: 'idle', outcome: null })

  const load = useCallback(
    async (force: boolean): Promise<void> => {
      if (!query || typeof window.sciforge?.modelReasoning?.discover !== 'function') return
      setState((current) => ({ status: 'loading', outcome: current.outcome }))
      try {
        const outcome = await window.sciforge.modelReasoning.discover({
          ...query,
          ...(force ? { force: true } : {})
        })
        setState({ status: 'ready', outcome })
      } catch {
        setState((current) => ({ status: 'error', outcome: current.outcome }))
      }
    },
    [query]
  )

  useEffect(() => {
    void load(false)
  }, [load])

  if (!query) return null

  const outcome = state.outcome
  const sourceKey = outcome ? composerReasoningSourceKey(outcome) : undefined
  return (
    <div className="mt-1 rounded-lg border border-ds-border-muted bg-ds-main/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-ds-muted">
          {t('modelRouterReasoningDiscoveryTitle')}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void load(true)}
            className="rounded-md border border-ds-border-muted px-2 py-0.5 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            {t('modelRouterReasoningDiscoveryRefresh')}
          </button>
          {onRestoreAuto && declaredEfforts.length > 0 ? (
            <button
              type="button"
              onClick={onRestoreAuto}
              className="rounded-md border border-ds-border-muted px-2 py-0.5 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('modelRouterReasoningDiscoveryRestore')}
            </button>
          ) : null}
        </span>
      </div>

      {state.status === 'loading' ? (
        <p className="mt-1 text-[11.5px] leading-4 text-ds-faint">
          {t('modelRouterReasoningDiscoveryLoading')}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p className="mt-1 text-[11.5px] leading-4 text-amber-700 dark:text-amber-300">
          {t('modelRouterReasoningDiscoveryError')}
        </p>
      ) : null}

      {outcome ? (
        <>
          <p className="mt-1 text-[11.5px] leading-4 text-ds-faint">
            {t(stateLabelKey(outcome))}
            {sourceKey ? ` · ${t(sourceKey)}` : ''}
            {outcome.completeness === 'partial' ? ` · ${t('modelRouterReasoningDiscoveryPartial')}` : ''}
            {outcome.checkedAt
              ? ` · ${t('modelRouterReasoningDiscoveryUpdatedAt', { time: formatCheckedAt(outcome.checkedAt) })}`
              : ''}
          </p>
          {outcome.stale ? (
            <p className="mt-1 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
              {t('modelRouterReasoningDiscoveryStaleNote', {
                message: outcome.refreshError ?? ''
              })}
            </p>
          ) : null}
          {outcome.levels.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {outcome.levels.map((level) => {
                const labelKey = composerReasoningLevelLabelKey(level)
                return (
                  <span
                    key={level}
                    className="rounded border border-ds-border-muted bg-ds-main/40 px-1.5 py-0.5 font-mono text-[11px] text-ds-muted"
                  >
                    {labelKey ? t(labelKey) : level}
                    {level === outcome.defaultLevel
                      ? ` · ${t('modelRouterReasoningDiscoveryDefault')}`
                      : ''}
                  </span>
                )
              })}
            </div>
          ) : null}
          {declaredEfforts.length > 0 ? (
            <ul className="mt-1.5 grid gap-0.5">
              {declaredEfforts.map((effort) => (
                <li key={effort} className="font-mono text-[11.5px] leading-4 text-ds-faint">
                  {effort} — {t(declaredStatusKey(outcome, effort))}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      <p className="mt-1.5 text-[11px] leading-4 text-ds-faint">
        {t('modelRouterReasoningDiscoveryPrecedence')}
      </p>
    </div>
  )
}