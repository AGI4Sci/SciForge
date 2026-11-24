import type { ReactElement } from 'react'
import { SettingsCard } from './settings-controls'

type RemoteResourcesSettingsContext = {
  t: (key: string, values?: Record<string, unknown>) => string
}

export function RemoteResourcesSettingsSection({
  ctx
}: {
  ctx: RemoteResourcesSettingsContext
}): ReactElement {
  const { t } = ctx

  return (
    <SettingsCard title={t('remoteResourcesTitle')}>
      <div className="px-3 py-4">
        <div className="text-ds-lg font-semibold text-ds-ink">
          {t('remoteWorkspaceSettingsTitle')}
        </div>
        <p className="mt-0.5 text-ds-md leading-relaxed text-ds-muted">
          {t('remoteWorkspaceSettingsDesc')}
        </p>
      </div>
    </SettingsCard>
  )
}
