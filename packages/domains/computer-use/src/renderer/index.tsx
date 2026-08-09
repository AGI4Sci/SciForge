import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/renderer'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'

import {
  COMPUTER_USE_REQUEST_PERMISSION_CONTRACT,
  COMPUTER_USE_STATUS_CONTRACT
} from '../contract.js'
import {
  COMPUTER_USE_RENDERER_SETTINGS_CONTRACT,
  COMPUTER_USE_RENDERER_SETTINGS_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'

type RuntimeId = 'sciforge' | 'codex' | 'claude'
type Settings = {
  enabled: boolean
  runtimeEnabled: Record<RuntimeId, boolean>
}
type Status = Awaited<ReturnType<typeof readStatus>>

export function createDomainRendererEntry(
  host: DomainRendererHost
): TrustedDomainProcessEntryInput<unknown> {
  return {
    definition: domainPackageDefinition,
    contributions: [{
      ...COMPUTER_USE_RENDERER_SETTINGS_CONTRIBUTION,
      contract: COMPUTER_USE_RENDERER_SETTINGS_CONTRACT,
      value: {
        section: 'agents.permissions',
        order: 180,
        render: ({ host: settingsHost }: { host: Readonly<Record<string, unknown>> }) => (
          <ComputerUseSettingsCard
            capabilityHost={host}
            settingsHost={settingsHost}
          />
        )
      }
    }]
  }
}

function ComputerUseSettingsCard({
  capabilityHost,
  settingsHost
}: {
  capabilityHost: DomainRendererHost
  settingsHost: Readonly<Record<string, unknown>>
}): ReactElement {
  const t = typeof settingsHost.t === 'function'
    ? settingsHost.t as (key: string) => string
    : (key: string) => key
  const update = typeof settingsHost.update === 'function'
    ? settingsHost.update as (patch: unknown) => void
    : () => undefined
  const form = isRecord(settingsHost.form) ? settingsHost.form : {}
  const settings = normalizeSettings(form.computerUse)
  const initialStatus = isRecord(settingsHost.computerUseStatus)
    ? settingsHost.computerUseStatus as Status
    : null
  const [status, setStatus] = useState<Status | null>(initialStatus)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await readStatus(capabilityHost, settings))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [settings.enabled, settings.runtimeEnabled.codex, settings.runtimeEnabled.claude])

  const runtime = status?.runtime
  const permissions = status?.permissions
  const updateSettings = (next: Settings): void => update({ computerUse: next })
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-sm">
      <div className="border-b border-ds-border-muted px-4 py-3">
        <h3 className="text-[14px] font-semibold text-ds-ink">{t('computerUseTitle')}</h3>
        <p className="mt-1 text-[12.5px] leading-5 text-ds-muted">{t('computerUseHint')}</p>
      </div>
      <div className="grid gap-4 p-4 text-[12.5px] text-ds-muted">
        <label className="flex items-center justify-between gap-4">
          <span>{t('computerUseEnable')}</span>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => updateSettings({ ...settings, enabled: event.target.checked })}
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['codex', 'claude'] as const).map((runtimeId) => (
            <label key={runtimeId} className="flex items-center justify-between rounded-xl border border-ds-border-muted px-3 py-2">
              <span>{runtimeId}</span>
              <input
                type="checkbox"
                disabled={!settings.enabled}
                checked={settings.runtimeEnabled[runtimeId]}
                onChange={(event) => updateSettings({
                  ...settings,
                  runtimeEnabled: {
                    ...settings.runtimeEnabled,
                    [runtimeId]: event.target.checked
                  }
                })}
              />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge online={runtime?.connection === 'online'}>
            {t(`computerUseConnection_${runtime?.connection ?? 'offline'}`)}
          </StatusBadge>
          <span>{t('computerUseLifecycle')}: {runtime?.lifecycleState ?? 'unknown'}</span>
          <span>{t('computerUseApprovalProof')}: {runtime?.approvalProof ?? 'unavailable'}</span>
          <span>{t('computerUseSidecarInstance')}: {runtime?.serverInstanceId ?? 'unknown'}</span>
          <span>{t('computerUseSidecarGeneration')}: {runtime?.generation ?? 'unknown'}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1 rounded-lg border border-ds-border px-2 py-1"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            {t('computerUseRefresh')}
          </button>
        </div>
        {runtime?.stale ? (
          <div className="rounded-xl border border-amber-300/50 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
            {t('computerUseStaleLastKnown')}: {t('computerUseCurrentStateUnknown')}
          </div>
        ) : null}
        {error || runtime?.lastStatusError ? (
          <div className="rounded-xl border border-rose-300/50 bg-rose-500/10 px-3 py-2 text-rose-800 dark:text-rose-200">
            {error ?? runtime?.lastStatusError}
          </div>
        ) : null}
        {permissions?.needsPermission ? (
          <div className="grid gap-2">
            <div className="font-semibold text-ds-ink">{t('computerUsePermissions')}</div>
            <div className="flex flex-wrap items-center gap-2">
              <span>Accessibility: {permissions.accessibility}</span>
              <span>Screen recording: {permissions.screenRecording}</span>
              {(['accessibility', 'screenRecording'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  disabled={busy}
                  className="rounded-lg border border-ds-border px-2 py-1"
                  onClick={() => void capabilityHost.capabilityInvoker.invoke(
                    COMPUTER_USE_REQUEST_PERMISSION_CONTRACT,
                    { kind },
                    { approval: { mode: 'confirmation' } }
                  ).then(() => refresh()).catch((cause) => {
                    setError(cause instanceof Error ? cause.message : String(cause))
                  })}
                >
                  {kind}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <StatusList title={t('computerUseBackend')} items={(runtime?.backends ?? []).map((backend) => [
          `${backend.backend}: ${backend.available ? 'available' : 'unavailable'}`,
          backend.reason,
          backend.instanceId ? `${t('computerUseBackendInstance')}: ${backend.instanceId}` : null,
          backend.generation ? `${t('computerUseSidecarGeneration')}: ${backend.generation}` : null,
          backend.mayActivateTarget ? t('computerUseSafetyTargetActivationPossible') : null
        ].filter((item): item is string => Boolean(item)).join(' — '))} />
        {(runtime?.active ?? []).some((lease) => lease.verification === 'unverified') ? (
          <div className="rounded-xl border border-amber-300/50 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
            {t('computerUseUnverifiedHint')}
          </div>
        ) : null}
        <StatusList title={t('computerUseActiveLeases')} items={(runtime?.active ?? []).map((lease) =>
          `${lease.targetId} · ${lease.backend ?? 'routing'} · ${lease.verification}${lease.degradedReason ? ` · ${lease.degradedReason}` : ''}`
        )} empty={t('computerUseNoActiveLeases')} />
        <StatusList title={t('computerUseCleanupPending')} items={(runtime?.cleanupPending ?? []).map((item) =>
          `${item.backend} / ${item.requestId}: ${item.errors.join('; ')}`
        )} empty={t('computerUseNoCleanupPending')} />
      </div>
    </section>
  )
}

async function readStatus(host: DomainRendererHost, settings: Settings) {
  return host.capabilityInvoker.invoke(COMPUTER_USE_STATUS_CONTRACT, { settings })
}

function StatusBadge({ online, children }: { online: boolean; children: string }): ReactElement {
  return <span className={`rounded-lg border px-2 py-1 ${online ? 'border-emerald-400/30 text-emerald-700' : 'border-amber-400/30 text-amber-700'}`}>{children}</span>
}

function StatusList({ title, items, empty = '—' }: {
  title: string
  items: readonly string[]
  empty?: string
}): ReactElement {
  return (
    <div>
      <div className="font-semibold text-ds-ink">{title}</div>
      <div className="mt-1 grid gap-1">
        {items.length > 0
          ? items.map((item) => <div key={item} className="rounded-lg border border-ds-border-muted px-3 py-2">{item}</div>)
          : <div className="text-ds-faint">{empty}</div>}
      </div>
    </div>
  )
}

function normalizeSettings(value: unknown): Settings {
  const input = isRecord(value) ? value : {}
  const runtimes = isRecord(input.runtimeEnabled) ? input.runtimeEnabled : {}
  return {
    enabled: input.enabled !== false,
    runtimeEnabled: {
      sciforge: false,
      codex: runtimes.codex !== false,
      claude: runtimes.claude !== false
    }
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
