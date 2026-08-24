import type { ReactElement } from 'react'
import { ArrowRight, Server } from 'lucide-react'
import { SettingsCard } from './settings-controls'

type RemoteResourcesSettingsContext = {
  t: (key: string, values?: Record<string, unknown>) => string
  openRemoteTargets: () => void
  canOpenRemoteTargets: boolean
}

export function RemoteResourcesSettingsSection({
  ctx
}: {
  ctx: RemoteResourcesSettingsContext
}): ReactElement {
  const { t, openRemoteTargets, canOpenRemoteTargets } = ctx

  return (
    <SettingsCard title={t('remoteResourcesTitle')}>
      <div className="px-3 py-4">
        <div className="text-[14px] font-semibold text-ds-ink">
          {t('remoteWorkspaceSettingsTitle')}
        </div>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ds-muted">
          {t('remoteWorkspaceSettingsDesc')}
        </p>
        <button
          type="button"
          onClick={openRemoteTargets}
          disabled={!canOpenRemoteTargets}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-ds-border bg-ds-panel px-3 py-2 text-[13px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Server className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          {t('remoteResourcesOpenTargets')}
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </SettingsCard>
  )
}
