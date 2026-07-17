import { AlertTriangle, Loader2, Network } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { AppSettingsV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import {
  SETTINGS_CHANGED_EVENT,
  emitRendererSettingsChanged
} from '../lib/keyboard-shortcut-settings'
import { useTranslation } from 'react-i18next'

export type DagRuntimeControl = {
  enabled: boolean | null
  saving: boolean
  error: string | null
  setEnabled: (enabled: boolean) => void
}

function evidenceDagEnabled(settings: AppSettingsV1): boolean {
  return settings.evidenceDag?.enabled === true
}

export function useDagRuntimeControl(): DagRuntimeControl {
  const [enabled, setEnabledState] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void rendererRuntimeClient.getSettings().then((settings) => {
      if (!cancelled) setEnabledState(evidenceDagEnabled(settings))
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    })

    const onSettingsChanged = (event: Event): void => {
      if (cancelled) return
      const settings = (event as CustomEvent<AppSettingsV1>).detail
      setEnabledState(evidenceDagEnabled(settings))
      setError(null)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [])

  const setEnabled = useCallback((nextEnabled: boolean): void => {
    if (saving) return
    setSaving(true)
    setError(null)
    void rendererRuntimeClient.setSettings({ evidenceDag: { enabled: nextEnabled } })
      .then((settings) => {
        setEnabledState(evidenceDagEnabled(settings))
        emitRendererSettingsChanged(settings)
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setSaving(false))
  }, [saving])

  return { enabled, saving, error, setEnabled }
}

export function DagRuntimeToggle({ control }: { control: DagRuntimeControl }): ReactElement {
  const { t } = useTranslation('common')
  const checked = control.enabled === true
  const label = control.saving
    ? t('dagRuntimeSaving')
    : checked
      ? t('dagRuntimeEnabled')
      : control.enabled === false
        ? t('dagRuntimeDisabled')
        : t('dagRuntimeLoading')
  const title = control.error || t('dagRuntimeToggleHelp')

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={t('dagRuntimeToggle')}
      title={title}
      disabled={control.enabled === null || control.saving}
      onClick={() => control.setEnabled(!checked)}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[10.5px] font-medium transition disabled:cursor-wait disabled:opacity-65 ${
        checked
          ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700/70 dark:bg-emerald-950/25 dark:text-emerald-300'
          : 'border-ds-border bg-ds-surface text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      {control.saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      <span className="hidden sm:inline">{label}</span>
      <span className={`relative h-[16px] w-7 rounded-full transition ${checked ? 'bg-emerald-500' : 'bg-ds-faint'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-[left] ${checked ? 'left-3.5' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

export function DagRuntimeDisabledState({ control }: { control: DagRuntimeControl }): ReactElement {
  const { t } = useTranslation('common')
  const loading = control.enabled === null && !control.error
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-ds-main px-6">
      <div className="max-w-sm text-center">
        {loading
          ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-ds-faint" />
          : control.error
            ? <AlertTriangle className="mx-auto h-5 w-5 text-amber-500" />
            : <Network className="mx-auto h-6 w-6 text-ds-faint" strokeWidth={1.6} />}
        <div className="mt-3 text-[13px] font-semibold text-ds-ink">
          {loading ? t('dagRuntimeLoading') : control.error ? t('dagRuntimeLoadFailed') : t('dagRuntimePausedTitle')}
        </div>
        <div className="mt-2 text-[12px] leading-5 text-ds-muted">
          {control.error || t('dagRuntimePausedDescription')}
        </div>
      </div>
    </div>
  )
}
