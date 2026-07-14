import { useState, type ReactElement } from 'react'
import {
  getRemoteExecutorSettings,
  getBioGymSettings,
  isRemoteExecutorTargetTrustedForWorkspace,
  remoteExecutorWorkspaceMatchesTrust,
  type AppSettingsPatch,
  type AppSettingsV1,
  type RemoteExecutorTargetKindV1,
  type RemoteExecutorTargetV1
} from '@shared/app-settings'
import { Loader2, Plus, Stethoscope, Trash2 } from 'lucide-react'
import { SettingsCard, SettingRow, Toggle } from './settings-controls'

type RemoteResourcesSettingsContext = {
  t: (key: string, values?: Record<string, unknown>) => string
  form: AppSettingsV1
  update: (partial: AppSettingsPatch) => void
  selectControlClass: string
}

function inputClass(extra = ''): string {
  return `w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 ${extra}`
}

function numberValue(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function parseOptionalPositiveInteger(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return undefined
  const integer = Math.floor(parsed)
  return integer > 0 ? integer : undefined
}

function newTargetId(targets: RemoteExecutorTargetV1[]): string {
  const existing = new Set(targets.map((target) => target.id))
  for (let index = 1; index < 1000; index += 1) {
    const id = `target-${index}`
    if (!existing.has(id)) return id
  }
  return `target-${Date.now()}`
}

function settingsTrustFingerprint(target: RemoteExecutorTargetV1): string {
  return `settings-ui:${target.id}`
}

function targetTrustedForWorkspace(target: RemoteExecutorTargetV1, workspaceRoot: string): boolean {
  const workspace = workspaceRoot.trim()
  if (!workspace) return false
  return isRemoteExecutorTargetTrustedForWorkspace(target, workspace, settingsTrustFingerprint(target))
}

export function RemoteResourcesSettingsSection({
  ctx
}: {
  ctx: RemoteResourcesSettingsContext
}): ReactElement {
  const { t, form, update, selectControlClass } = ctx
  const remoteExecutor = getRemoteExecutorSettings(form)
  const biogym = getBioGymSettings(form)
  const targets = remoteExecutor.targets
  const workspaceRoot = form.workspaceRoot.trim()
  const [bioGymDoctorBusy, setBioGymDoctorBusy] = useState(false)
  const [bioGymDoctorResult, setBioGymDoctorResult] = useState<{ ok: boolean; message: string } | null>(null)

  const runBioGymDoctor = async (): Promise<void> => {
    setBioGymDoctorBusy(true)
    setBioGymDoctorResult(null)
    try {
      const api = window.sciforge?.biogym
      if (!api) throw new Error(t('biogymDoctorBridgeUnavailable'))
      const result = await api.doctor()
      setBioGymDoctorResult({ ok: result.ok, message: result.message })
    } catch (error) {
      setBioGymDoctorResult({
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBioGymDoctorBusy(false)
    }
  }

  const patchRemoteExecutor = (
    nextTargets: RemoteExecutorTargetV1[],
    extra?: { enabled?: boolean; defaultTargetId?: string }
  ): void => {
    update({
      remoteExecutor: {
        enabled: extra?.enabled ?? remoteExecutor.enabled,
        defaultTargetId: extra?.defaultTargetId ?? remoteExecutor.defaultTargetId,
        targets: nextTargets
      }
    })
  }

  const updateTarget = (
    targetId: string,
    mapper: (target: RemoteExecutorTargetV1) => RemoteExecutorTargetV1
  ): void => {
    patchRemoteExecutor(targets.map((target) => (target.id === targetId ? mapper(target) : target)))
  }

  const addTarget = (): void => {
    const id = newTargetId(targets)
    const nextTarget: RemoteExecutorTargetV1 = {
      id,
      label: t('remoteTargetDefaultLabel', { index: targets.length + 1 }),
      enabled: true,
      kind: 'ssh',
      ssh: { port: 22 },
      remoteWorkspaceRoot: '',
      trustedWorkspaces: []
    }
    patchRemoteExecutor([...targets, nextTarget], {
      enabled: true,
      defaultTargetId: remoteExecutor.defaultTargetId || id
    })
  }

  const removeTarget = (targetId: string): void => {
    const nextTargets = targets.filter((target) => target.id !== targetId)
    patchRemoteExecutor(nextTargets, {
      defaultTargetId: remoteExecutor.defaultTargetId === targetId ? nextTargets[0]?.id ?? '' : remoteExecutor.defaultTargetId
    })
  }

  const setTargetKind = (target: RemoteExecutorTargetV1, kind: RemoteExecutorTargetKindV1): void => {
    updateTarget(target.id, (current) => ({
      ...current,
      kind,
      ...(kind === 'ssh' ? { ssh: current.ssh ?? { port: 22 } } : {}),
      ...(kind === 'slurm' ? { slurm: current.slurm ?? { defaults: {} } } : {})
    }))
  }

  const setWorkspaceTrusted = (target: RemoteExecutorTargetV1, trusted: boolean): void => {
    if (!workspaceRoot) return
    updateTarget(target.id, (current) => {
      const remaining = current.trustedWorkspaces.filter(
        (trust) => !remoteExecutorWorkspaceMatchesTrust(trust.workspaceRoot, workspaceRoot)
      )
      return {
        ...current,
        trustedWorkspaces: trusted
          ? [
              ...remaining,
              {
                workspaceRoot,
                targetFingerprint: settingsTrustFingerprint(current),
                trustedAt: new Date().toISOString(),
                trustedBy: 'settings-ui',
                approvalBypass: true as const
              }
            ]
          : remaining
      }
    })
  }

  return (
    <>
      <SettingsCard title={t('remoteResourcesTitle')}>
        <SettingRow
          title={t('remoteExecutorEnabled')}
          description={t('remoteExecutorEnabledDesc')}
          control={
            <Toggle
              checked={remoteExecutor.enabled}
              onChange={(enabled) => update({ remoteExecutor: { enabled } })}
            />
          }
        />
        <SettingRow
          title={t('remoteExecutorDefaultTarget')}
          description={t('remoteExecutorDefaultTargetDesc')}
          control={
            <select
              className={selectControlClass}
              value={remoteExecutor.defaultTargetId}
              onChange={(event) => update({ remoteExecutor: { defaultTargetId: event.target.value } })}
            >
              <option value="">{t('remoteExecutorDefaultLocal')}</option>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label || target.id}
                </option>
              ))}
            </select>
          }
        />
      </SettingsCard>

      <SettingsCard title={t('biogymSettingsTitle')} className="mt-6">
        <SettingRow
          title={t('biogymEnabled')}
          description={t('biogymEnabledDesc')}
          control={
            <Toggle
              checked={biogym.enabled}
              onChange={(enabled) => update({ biogym: { enabled } })}
            />
          }
        />
        <div className="grid gap-3 px-3 py-5 md:grid-cols-2">
          <label className="block min-w-0 md:col-span-2">
            <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
              {t('biogymCliPath')}
            </span>
            <input
              className={inputClass()}
              value={biogym.cliPath}
              placeholder="/absolute/path/to/biogym"
              onChange={(event) => update({ biogym: { cliPath: event.target.value } })}
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
              {t('biogymSshHost')}
            </span>
            <input
              className={inputClass()}
              value={biogym.sshHost}
              onChange={(event) => update({ biogym: { sshHost: event.target.value } })}
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
              {t('biogymRemoteRoot')}
            </span>
            <input
              className={inputClass()}
              value={biogym.remoteRoot}
              onChange={(event) => update({ biogym: { remoteRoot: event.target.value } })}
            />
          </label>
          <div className="flex min-w-0 flex-col items-start gap-2 md:col-span-2">
            <button
              type="button"
              onClick={() => { void runBioGymDoctor() }}
              disabled={bioGymDoctorBusy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-wait disabled:opacity-60"
            >
              {bioGymDoctorBusy
                ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                : <Stethoscope className="h-4 w-4" strokeWidth={1.8} />}
              {bioGymDoctorBusy ? t('biogymDoctorRunning') : t('biogymDoctorAction')}
            </button>
            {bioGymDoctorResult ? (
              <div
                role="status"
                className={`text-[12px] leading-5 ${bioGymDoctorResult.ok ? 'text-emerald-700' : 'text-red-600'}`}
              >
                {bioGymDoctorResult.message}
              </div>
            ) : null}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title={t('remoteExecutorTargets')} className="mt-6">
        {targets.length === 0 ? (
          <div className="px-3 py-5">
            <div className="text-[13px] leading-6 text-ds-muted">{t('remoteExecutorNoTargets')}</div>
            <button
              type="button"
              onClick={addTarget}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
            >
              <Plus className="h-4 w-4" strokeWidth={1.8} />
              {t('remoteExecutorAddTarget')}
            </button>
          </div>
        ) : (
          <>
            {targets.map((target) => {
              const ssh = target.ssh ?? {}
              const slurmDefaults = target.slurm?.defaults ?? {}
              const trusted = targetTrustedForWorkspace(target, workspaceRoot)
              return (
                <div key={target.id} className="px-3 py-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-semibold text-ds-ink">
                        {target.label || target.id}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[11.5px] font-medium text-ds-faint">
                        <span className="rounded-md border border-ds-border-muted bg-ds-subtle px-2 py-0.5 uppercase">
                          {target.kind}
                        </span>
                        <span className="rounded-md border border-ds-border-muted bg-ds-subtle px-2 py-0.5">
                          {trusted ? t('remoteTargetTrusted') : t('remoteTargetUntrusted')}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Toggle
                        checked={target.enabled}
                        onChange={(enabled) => updateTarget(target.id, (current) => ({ ...current, enabled }))}
                      />
                      <button
                        type="button"
                        onClick={() => removeTarget(target.id)}
                        title={t('remoteExecutorRemoveTarget')}
                        aria-label={t('remoteExecutorRemoveTarget')}
                        className="rounded-lg p-2 text-ds-faint transition hover:bg-ds-hover hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="block min-w-0">
                      <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                        {t('remoteTargetLabel')}
                      </span>
                      <input
                        className={inputClass()}
                        value={target.label}
                        onChange={(event) => updateTarget(target.id, (current) => ({ ...current, label: event.target.value }))}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                        {t('remoteTargetKind')}
                      </span>
                      <select
                        className={selectControlClass}
                        value={target.kind}
                        onChange={(event) => setTargetKind(target, event.target.value as RemoteExecutorTargetKindV1)}
                      >
                        <option value="ssh">{t('remoteTargetKindSsh')}</option>
                        <option value="slurm">{t('remoteTargetKindSlurm')}</option>
                      </select>
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                        {t('remoteTargetSshHost')}
                      </span>
                      <input
                        className={inputClass()}
                        value={ssh.host ?? ''}
                        onChange={(event) => updateTarget(target.id, (current) => ({
                          ...current,
                          ssh: { ...(current.ssh ?? {}), host: event.target.value }
                        }))}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                        {t('remoteTargetSshUser')}
                      </span>
                      <input
                        className={inputClass()}
                        value={ssh.user ?? ''}
                        onChange={(event) => updateTarget(target.id, (current) => ({
                          ...current,
                          ssh: { ...(current.ssh ?? {}), user: event.target.value }
                        }))}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                        {t('remoteTargetSshPort')}
                      </span>
                      <input
                        className={inputClass()}
                        inputMode="numeric"
                        value={numberValue(ssh.port)}
                        onChange={(event) => updateTarget(target.id, (current) => ({
                          ...current,
                          ssh: { ...(current.ssh ?? {}), port: parseOptionalPositiveInteger(event.target.value) }
                        }))}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                        {t('remoteTargetWorkspaceRoot')}
                      </span>
                      <input
                        className={inputClass()}
                        value={target.remoteWorkspaceRoot}
                        onChange={(event) => updateTarget(target.id, (current) => ({
                          ...current,
                          remoteWorkspaceRoot: event.target.value
                        }))}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                        {t('remoteTargetSlurmPartition')}
                      </span>
                      <input
                        className={inputClass()}
                        value={slurmDefaults.partition ?? ''}
                        onChange={(event) => updateTarget(target.id, (current) => ({
                          ...current,
                          slurm: {
                            defaults: { ...(current.slurm?.defaults ?? {}), partition: event.target.value }
                          }
                        }))}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                        {t('remoteTargetSlurmAccount')}
                      </span>
                      <input
                        className={inputClass()}
                        value={slurmDefaults.account ?? ''}
                        onChange={(event) => updateTarget(target.id, (current) => ({
                          ...current,
                          slurm: {
                            defaults: { ...(current.slurm?.defaults ?? {}), account: event.target.value }
                          }
                        }))}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                        {t('remoteTargetSlurmTime')}
                      </span>
                      <input
                        className={inputClass()}
                        value={slurmDefaults.timeLimit ?? ''}
                        onChange={(event) => updateTarget(target.id, (current) => ({
                          ...current,
                          slurm: {
                            defaults: { ...(current.slurm?.defaults ?? {}), timeLimit: event.target.value }
                          }
                        }))}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                        {t('remoteTargetSlurmGpus')}
                      </span>
                      <input
                        className={inputClass()}
                        inputMode="numeric"
                        value={numberValue(slurmDefaults.gpus)}
                        onChange={(event) => updateTarget(target.id, (current) => ({
                          ...current,
                          slurm: {
                            defaults: { ...(current.slurm?.defaults ?? {}), gpus: parseOptionalPositiveInteger(event.target.value) }
                          }
                        }))}
                      />
                    </label>
                  </div>

                  <div className="mt-4 rounded-xl border border-ds-border-muted bg-ds-main/35 px-3 py-3">
                    <SettingRow
                      title={t('remoteTargetWorkspaceTrust')}
                      description={workspaceRoot ? t('remoteTargetWorkspaceTrustDesc', { workspace: workspaceRoot }) : t('remoteTargetWorkspaceTrustNoWorkspace')}
                      control={
                        <Toggle
                          checked={trusted}
                          disabled={!workspaceRoot}
                          onChange={(value) => setWorkspaceTrusted(target, value)}
                        />
                      }
                    />
                  </div>
                </div>
              )
            })}
            <div className="px-3 py-4">
              <button
                type="button"
                onClick={addTarget}
                className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
              >
                <Plus className="h-4 w-4" strokeWidth={1.8} />
                {t('remoteExecutorAddTarget')}
              </button>
            </div>
          </>
        )}
      </SettingsCard>
    </>
  )
}
