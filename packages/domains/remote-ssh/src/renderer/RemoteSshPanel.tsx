import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  CircleCheck,
  Circle,
  Container,
  Copy,
  ExternalLink,
  Loader2,
  MonitorPlay,
  Network,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  RemoteSshLabEnvironmentResult,
  RemoteSshLab,
  RemoteSshLabEnvironmentProvider,
  RemoteSshTargetProbeResult,
  RemoteSshTarget,
  RemoteSshTargetBinding,
  RemoteSshTargetCapability,
  RemoteSshTargetHandle,
  RemoteSshWorkspaceBinding
} from '../contract'
import { REMOTE_SSH_DEFAULT_ENVIRONMENT_PROVIDER } from '../contract'
import type {
  RemoteSshCapabilityClient,
  RemoteSshMutationConfirmation
} from './remote-ssh-capability-client'

export type RemoteSshPanelProps = Readonly<{
  capabilityClient: RemoteSshCapabilityClient
  workspaceId?: string
  className?: string
  onCollapse?: () => void
  openExternal?: (url: string) => void | Promise<void>
}>

export type RemoteSshTargetGroup = Readonly<{
  lab: RemoteSshLab | null
  targets: readonly RemoteSshTarget[]
}>

type LabDraft = Readonly<{
  id?: string
  displayName: string
  environmentProvider: RemoteSshLabEnvironmentProvider
  vmId: string
  gatewaySshAlias: string
  dockerImage: string
  maxConcurrentExecutions: number
  expectedRevision?: string
}>

type TargetDraft = Readonly<{
  id?: string
  labId: string
  displayName: string
  sshAlias: string
  labels: Readonly<Record<string, string>>
  capabilities: readonly RemoteSshTargetCapability[]
  maxConcurrentExecutions: number
  expectedRevision?: string
}>

const USER_CONFIRMED_MUTATION = Object.freeze({
  approval: Object.freeze({ mode: 'confirmation' as const })
}) satisfies RemoteSshMutationConfirmation

const REMOTE_SSH_DEFAULT_DOCKER_IMAGE = 'hagb/docker-atrust:latest'

export type RemoteSshOnboardingAction =
  | 'create-lab'
  | 'ensure-environment'
  | 'open-console'
  | 'refresh'
  | 'add-target'

export function remoteSshOnboardingAction(
  lab: RemoteSshLab | undefined,
  environment: RemoteSshLabEnvironmentResult | undefined
): RemoteSshOnboardingAction {
  if (!lab) return 'create-lab'
  if (environment?.state === 'ready') return 'add-target'
  if (
    environment?.state === 'login-required' &&
    environment.consoleAvailable
  ) {
    return 'open-console'
  }
  if (environment?.state === 'starting') return 'refresh'
  return 'ensure-environment'
}

export const REMOTE_SSH_OPENSSH_TEMPLATE = `Host sciforge-lab-target
  HostName <private-target-host-or-ip>
  User <target-user>
  IdentityFile ~/.ssh/sciforge/lab-target
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  ForwardAgent no
`

export function groupRemoteSshTargets(
  labs: readonly RemoteSshLab[],
  targets: readonly RemoteSshTarget[]
): RemoteSshTargetGroup[] {
  const byLab = new Map<string, RemoteSshTarget[]>()
  for (const target of targets) {
    const group = byLab.get(target.labId) ?? []
    group.push(target)
    byLab.set(target.labId, group)
  }
  const groups = [...labs]
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map((lab) => ({
      lab,
      targets: (byLab.get(lab.id) ?? [])
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
    }))
  const knownLabIds = new Set(labs.map((lab) => lab.id))
  const ungrouped = targets
    .filter((target) => !knownLabIds.has(target.labId))
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
  return ungrouped.length ? [...groups, { lab: null, targets: ungrouped }] : groups
}

export function RemoteSshPanel({
  capabilityClient,
  workspaceId,
  className = '',
  onCollapse,
  openExternal
}: RemoteSshPanelProps): ReactElement {
  const { t } = useTranslation('common')
  const normalizedWorkspaceId = workspaceId?.trim() || undefined
  const [labs, setLabs] = useState<RemoteSshLab[]>([])
  const [targets, setTargets] = useState<RemoteSshTarget[]>([])
  const [targetHandles, setTargetHandles] = useState<Record<string, RemoteSshTargetHandle>>({})
  const [binding, setBinding] = useState<RemoteSshWorkspaceBinding | null>(null)
  const [probes, setProbes] = useState<Record<string, RemoteSshTargetProbeResult>>({})
  const [labEnvironments, setLabEnvironments] = useState<Record<string, RemoteSshLabEnvironmentResult>>({})
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [templateCopied, setTemplateCopied] = useState(false)
  const [labDraft, setLabDraft] = useState<LabDraft | null>(null)
  const [targetDraft, setTargetDraft] = useState<TargetDraft | null>(null)

  const groups = useMemo(() => groupRemoteSshTargets(labs, targets), [labs, targets])
  const onboardingLab = useMemo(
    () => [...labs].sort((left, right) => left.displayName.localeCompare(right.displayName))[0],
    [labs]
  )
  const onboardingAction = remoteSshOnboardingAction(
    onboardingLab,
    onboardingLab ? labEnvironments[onboardingLab.id] : undefined
  )
  const allowedTargetIds = useMemo(
    () => new Set(binding?.allowedTargetIds ?? []),
    [binding]
  )

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setMessage(null)
    try {
      const [labResult, catalogResult, targetResult, bindingResult] = await Promise.all([
        capabilityClient.listLabs(),
        capabilityClient.listTargetCatalog(),
        normalizedWorkspaceId
          ? capabilityClient.listTargets(normalizedWorkspaceId)
          : Promise.resolve({ targets: [] }),
        normalizedWorkspaceId
          ? capabilityClient.getBinding(normalizedWorkspaceId).catch(() => null)
          : Promise.resolve(null)
      ])
      setLabs(labResult.labs)
      setTargets(catalogResult.targets)
      setTargetHandles(handlesByTargetId(targetResult.targets))
      setBinding(bindingResult?.binding ?? null)
      setProbes({})
      const environmentResults = await Promise.all(
        labResult.labs.map(async (lab) => {
          try {
            return await capabilityClient.getLabEnvironment(lab.id)
          } catch {
            return null
          }
        })
      )
      setLabEnvironments(Object.fromEntries(
        environmentResults.flatMap((environment) => environment ? [[environment.labId, environment]] : [])
      ))
    } catch (error) {
      setMessage(errorMessage(error, t('remoteSshOperationFailed')))
    } finally {
      setLoading(false)
    }
  }, [capabilityClient, normalizedWorkspaceId, t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const probeTarget = async (target: RemoteSshTarget): Promise<void> => {
    if (!normalizedWorkspaceId) return
    const resource = targetHandles[target.id]
    if (!resource) return
    setBusyKey(`probe:${target.id}`)
    setMessage(null)
    try {
      const result = await capabilityClient.probeTarget(resource, normalizedWorkspaceId)
      setProbes((current) => ({ ...current, [target.id]: result }))
    } catch (error) {
      setMessage(errorMessage(error, t('remoteSshOperationFailed')))
    } finally {
      setBusyKey(null)
    }
  }

  const saveLab = async (): Promise<void> => {
    if (!labDraft) return
    setBusyKey('save-lab')
    setMessage(null)
    try {
      await capabilityClient.saveLab({
        ...(labDraft.id ? { id: labDraft.id } : {}),
        displayName: labDraft.displayName,
        environment: labDraft.environmentProvider === 'vm'
          ? {
              provider: 'vm',
              driver: 'virtualbox',
              vmId: labDraft.vmId,
              gatewaySshAlias: labDraft.gatewaySshAlias
            }
          : {
              provider: 'docker',
              image: labDraft.dockerImage
            },
        maxConcurrentExecutions: labDraft.maxConcurrentExecutions,
        ...(labDraft.expectedRevision ? { expectedRevision: labDraft.expectedRevision } : {})
      }, USER_CONFIRMED_MUTATION)
      setLabDraft(null)
      await refresh()
    } catch (error) {
      const fallback = labDraft.environmentProvider === 'vm'
        ? t('remoteSshVmSaveFailed')
        : t('remoteSshDockerSaveFailed')
      setMessage(capabilityOperationErrorMessage(error, fallback))
    } finally {
      setBusyKey(null)
    }
  }

  const ensureLabEnvironment = async (lab: RemoteSshLab): Promise<void> => {
    setBusyKey(`ensure-environment:${lab.id}`)
    setMessage(null)
    try {
      const environment = await capabilityClient.ensureLabEnvironment(
        lab.id,
        lab.revision,
        USER_CONFIRMED_MUTATION
      )
      setLabEnvironments((current) => ({ ...current, [lab.id]: environment }))
    } catch (error) {
      setMessage(errorMessage(error, t('remoteSshEnvironmentEnsureFailed')))
    } finally {
      setBusyKey(null)
    }
  }

  const openLabEnvironmentConsole = async (lab: RemoteSshLab): Promise<void> => {
    setBusyKey(`open-console:${lab.id}`)
    setMessage(null)
    try {
      const result = await capabilityClient.openLabEnvironmentConsole(
        lab.id,
        lab.revision,
        USER_CONFIRMED_MUTATION
      )
      if (result.presentation.kind === 'external-url' && openExternal) {
        await openExternal(result.presentation.url)
      }
      const environment = await capabilityClient.getLabEnvironment(lab.id)
      setLabEnvironments((current) => ({ ...current, [lab.id]: environment }))
    } catch (error) {
      setMessage(errorMessage(error, t('remoteSshEnvironmentConsoleFailed')))
    } finally {
      setBusyKey(null)
    }
  }

  const stopLabEnvironment = async (lab: RemoteSshLab): Promise<void> => {
    setBusyKey(`stop-environment:${lab.id}`)
    setMessage(null)
    try {
      const environment = await capabilityClient.stopLabEnvironment(
        lab.id,
        lab.revision,
        USER_CONFIRMED_MUTATION
      )
      setLabEnvironments((current) => ({ ...current, [lab.id]: environment }))
    } catch (error) {
      setMessage(errorMessage(error, t('remoteSshEnvironmentStopFailed')))
    } finally {
      setBusyKey(null)
    }
  }

  const deleteLab = async (lab: RemoteSshLab): Promise<void> => {
    if (!globalThis.confirm(t('remoteSshConfirmDeleteLab'))) return
    setBusyKey(`delete-lab:${lab.id}`)
    setMessage(null)
    try {
      await capabilityClient.deleteLab({
        labId: lab.id,
        expectedRevision: lab.revision
      }, USER_CONFIRMED_MUTATION)
      await refresh()
    } catch (error) {
      setMessage(errorMessage(error, t('remoteSshOperationFailed')))
    } finally {
      setBusyKey(null)
    }
  }

  const saveTarget = async (): Promise<void> => {
    if (!targetDraft) return
    const isNewTarget = !targetDraft.id
    setBusyKey('save-target')
    setMessage(null)
    try {
      const saved = await capabilityClient.saveTarget({
        ...(targetDraft.id ? { id: targetDraft.id } : {}),
        labId: targetDraft.labId,
        displayName: targetDraft.displayName,
        sshAlias: targetDraft.sshAlias,
        labels: { ...targetDraft.labels },
        capabilities: [...targetDraft.capabilities],
        maxConcurrentExecutions: targetDraft.maxConcurrentExecutions,
        ...(targetDraft.expectedRevision ? { expectedRevision: targetDraft.expectedRevision } : {})
      }, USER_CONFIRMED_MUTATION)
      setTargetDraft(null)

      let authorizationWarning: string | null = null
      if (
        isNewTarget &&
        normalizedWorkspaceId &&
        binding &&
        !binding.allowedTargetIds.includes(saved.target.id)
      ) {
        try {
          const authorized = await capabilityClient.saveBinding(normalizedWorkspaceId, {
            allowedTargetIds: [...binding.allowedTargetIds, saved.target.id],
            expectedRevision: binding.revision
          }, USER_CONFIRMED_MUTATION)
          setBinding(authorized.binding)
        } catch (error) {
          authorizationWarning = errorMessage(error, t('remoteSshAutoAuthorizeFailed'))
        }
      }

      await refresh()
      if (authorizationWarning) {
        setMessage(`${t('remoteSshTargetSavedAuthorizationWarning')} ${authorizationWarning}`)
        return
      }

      if (isNewTarget && normalizedWorkspaceId) {
        try {
          const workspaceTargets = await capabilityClient.listTargets(normalizedWorkspaceId)
          const handles = handlesByTargetId(workspaceTargets.targets)
          setTargetHandles(handles)
          const resource = handles[saved.target.id]
          if (resource) {
            setBusyKey(`probe:${saved.target.id}`)
            const probe = await capabilityClient.probeTarget(resource, normalizedWorkspaceId)
            setProbes((current) => ({ ...current, [saved.target.id]: probe }))
          }
        } catch {
          setMessage(t('remoteSshTargetSavedProbeWarning'))
        }
      }
    } catch (error) {
      setMessage(errorMessage(error, t('remoteSshOperationFailed')))
    } finally {
      setBusyKey(null)
    }
  }

  const copyOpenSshTemplate = async (): Promise<void> => {
    setMessage(null)
    try {
      if (!globalThis.navigator?.clipboard) throw new Error('Clipboard API is unavailable.')
      await globalThis.navigator.clipboard.writeText(REMOTE_SSH_OPENSSH_TEMPLATE)
      setTemplateCopied(true)
    } catch {
      setMessage(t('remoteSshCopyTemplateFailed'))
    }
  }

  const startOnboarding = (): void => {
    const firstLab = [...labs].sort((left, right) => left.displayName.localeCompare(right.displayName))[0]
    const action = remoteSshOnboardingAction(
      firstLab,
      firstLab ? labEnvironments[firstLab.id] : undefined
    )
    switch (action) {
      case 'create-lab':
        setLabDraft(emptyLabDraft())
        return
      case 'ensure-environment':
        void ensureLabEnvironment(firstLab!)
        return
      case 'open-console':
        void openLabEnvironmentConsole(firstLab!)
        return
      case 'refresh':
        void refresh()
        return
      case 'add-target':
        setTargetDraft(emptyTargetDraft(firstLab!.id))
    }
  }

  const deleteTarget = async (target: RemoteSshTarget): Promise<void> => {
    if (!globalThis.confirm(t('remoteSshConfirmDeleteTarget'))) return
    setBusyKey(`delete-target:${target.id}`)
    setMessage(null)
    try {
      await capabilityClient.deleteTarget({
        targetId: target.id,
        expectedRevision: target.revision
      }, USER_CONFIRMED_MUTATION)
      await refresh()
    } catch (error) {
      setMessage(errorMessage(error, t('remoteSshOperationFailed')))
    } finally {
      setBusyKey(null)
    }
  }

  const toggleWorkspaceBinding = async (targetId: string): Promise<void> => {
    if (!normalizedWorkspaceId || !binding) return
    const nextAllowedTargetIds = allowedTargetIds.has(targetId)
      ? binding.allowedTargetIds.filter((id) => id !== targetId)
      : [...binding.allowedTargetIds, targetId]
    setBusyKey(`binding:${targetId}`)
    setMessage(null)
    try {
      const result = await capabilityClient.saveBinding(normalizedWorkspaceId, {
        allowedTargetIds: nextAllowedTargetIds,
        expectedRevision: binding.revision
      }, USER_CONFIRMED_MUTATION)
      setBinding(result.binding)
      const workspaceTargets = await capabilityClient.listTargets(normalizedWorkspaceId)
      setTargetHandles(handlesByTargetId(workspaceTargets.targets))
      if (!result.binding.allowedTargetIds.includes(targetId)) {
        setProbes((current) => Object.fromEntries(
          Object.entries(current).filter(([id]) => id !== targetId)
        ))
      }
    } catch (error) {
      setMessage(errorMessage(error, t('remoteSshOperationFailed')))
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <section className={`ds-no-drag flex min-h-0 flex-col overflow-hidden bg-ds-sidebar ${className}`}>
      <header className="flex shrink-0 items-center gap-3 border-b border-ds-border px-4 py-3">
        <Server className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-ds-ink">{t('remoteSshTitle')}</h2>
          <p className="mt-0.5 truncate text-[11.5px] text-ds-faint">
            {t('remoteSshConfiguredTargets', { count: targets.length })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-md p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
          aria-label={t('remoteSshRefresh')}
          title={t('remoteSshRefresh')}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
        </button>
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-md p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        ) : null}
      </header>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ds-border px-4 py-2">
        <span className="min-w-0 truncate text-[11.5px] text-ds-faint">
          {normalizedWorkspaceId
            ? `${t('remoteSshWorkspaceBinding')}: ${binding ? binding.allowedTargetIds.length : '…'}`
            : t('remoteSshWorkspaceUnavailable')}
        </span>
        <button
          type="button"
          onClick={() => setLabDraft(emptyLabDraft())}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-ds-border bg-ds-panel px-2 py-1 text-[11.5px] font-medium text-ds-ink transition hover:bg-ds-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('remoteSshAddLab')}
        </button>
      </div>

      {message ? (
        <div className="shrink-0 border-b border-ds-border bg-red-500/8 px-4 py-2 text-[11.5px] leading-5 text-red-700 dark:text-red-300">
          {message}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-gutter:stable]">
        {labDraft ? (
          <LabEditor
            draft={labDraft}
            busy={busyKey === 'save-lab'}
            setDraft={setLabDraft}
            onSave={() => void saveLab()}
            onCancel={() => setLabDraft(null)}
            t={t}
          />
        ) : null}

        {targetDraft ? (
          <TargetEditor
            draft={targetDraft}
            labs={labs}
            busy={busyKey === 'save-target'}
            setDraft={setTargetDraft}
            onSave={() => void saveTarget()}
            onCancel={() => setTargetDraft(null)}
            t={t}
          />
        ) : null}

        {!loading && !targets.length && !labDraft && !targetDraft ? (
          <RemoteSshOnboarding
            action={onboardingAction}
            environmentProvider={onboardingLab?.environment.provider}
            busy={busyKey !== null}
            copied={templateCopied}
            onStart={startOnboarding}
            onAddTarget={() => {
              if (onboardingLab) setTargetDraft(emptyTargetDraft(onboardingLab.id))
            }}
            onCopy={() => void copyOpenSshTemplate()}
            t={t}
          />
        ) : null}

        <div className="grid gap-3">
          {groups.map((group) => {
            const labId = group.lab?.id ?? '__ungrouped__'
            const environment = group.lab ? labEnvironments[group.lab.id] : undefined
            return (
              <section key={labId} className="overflow-hidden rounded-lg border border-ds-border bg-ds-panel">
                <div className="flex items-center gap-2 border-b border-ds-border px-3 py-2.5">
                  <Server className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-ds-ink">
                      {group.lab?.displayName ?? t('remoteSshUngrouped')}
                    </div>
                    {group.lab ? (
                      <>
                        <div className="mt-0.5 truncate font-mono text-[10px] text-ds-faint">
                          {labEnvironmentSummary(group.lab, t)}
                        </div>
                        <LabEnvironmentStatus environment={environment} t={t} />
                        {environment?.message ? (
                          <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-ds-faint">
                            {environment.message}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  {group.lab ? (
                    <>
                      {canEnsureLabEnvironment(environment) ? (
                        <IconButton
                          label={group.lab.environment.provider === 'vm'
                            ? t('remoteSshEnvironmentEnsureVm')
                            : t('remoteSshEnvironmentEnsureDocker')}
                          busy={busyKey === `ensure-environment:${group.lab.id}`}
                          onClick={() => void ensureLabEnvironment(group.lab!)}
                        >
                          {group.lab.environment.provider === 'vm'
                            ? <Play className="h-3.5 w-3.5" />
                            : <Container className="h-3.5 w-3.5" />}
                        </IconButton>
                      ) : null}
                      {environment?.consoleAvailable ? (
                        <IconButton
                          label={group.lab.environment.provider === 'vm'
                            ? t('remoteSshEnvironmentOpenVm')
                            : t('remoteSshEnvironmentOpenVpnLogin')}
                          busy={busyKey === `open-console:${group.lab.id}`}
                          onClick={() => void openLabEnvironmentConsole(group.lab!)}
                        >
                          {group.lab.environment.provider === 'vm'
                            ? <MonitorPlay className="h-3.5 w-3.5" />
                            : <ExternalLink className="h-3.5 w-3.5" />}
                        </IconButton>
                      ) : null}
                      {environment &&
                      ['starting', 'login-required', 'ready'].includes(environment.state) ? (
                        <IconButton
                          label={t('remoteSshEnvironmentStop')}
                          busy={busyKey === `stop-environment:${group.lab.id}`}
                          onClick={() => void stopLabEnvironment(group.lab!)}
                        >
                          <Square className="h-3.5 w-3.5" />
                        </IconButton>
                      ) : null}
                      <IconButton
                        label={t('remoteSshAddTarget')}
                        onClick={() => setTargetDraft(emptyTargetDraft(group.lab!.id))}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        label={t('remoteSshEdit')}
                        onClick={() => setLabDraft(labDraftFrom(group.lab!))}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        label={t('remoteSshDelete')}
                        danger
                        busy={busyKey === `delete-lab:${group.lab.id}`}
                        onClick={() => void deleteLab(group.lab!)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </>
                  ) : null}
                </div>
                <div className="divide-y divide-ds-border">
                  {group.targets.map((target) => {
                    const probe = probes[target.id]
                    const status = probeDisplay(probe, t)
                    const allowed = allowedTargetIds.has(target.id)
                    const resource = targetHandles[target.id]
                    return (
                      <div key={target.id} className="px-3 py-2.5">
                        <div className="flex min-w-0 items-start gap-2">
                          <Circle className={`mt-1 h-2.5 w-2.5 shrink-0 fill-current ${status.className}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-[12.5px] font-medium text-ds-ink">
                                {target.displayName}
                              </span>
                              {binding ? (
                                <button
                                  type="button"
                                  onClick={() => void toggleWorkspaceBinding(target.id)}
                                  disabled={busyKey === `binding:${target.id}`}
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-semibold transition ${
                                    allowed
                                      ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                                      : 'bg-ds-hover text-ds-faint'
                                  }`}
                                  title={t('remoteSshWorkspaceBinding')}
                                >
                                  {allowed ? t('remoteSshWorkspaceAllowed') : t('remoteSshWorkspaceNotAllowed')}
                                </button>
                              ) : null}
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[10.5px] text-ds-faint">
                              ssh {target.sshAlias}
                            </div>
                            <div className={`mt-1 text-[10.5px] ${status.className}`}>{status.label}</div>
                          </div>
                          <IconButton
                            label={busyKey === `probe:${target.id}` ? t('remoteSshProbing') : t('remoteSshProbe')}
                            busy={busyKey === `probe:${target.id}`}
                            disabled={!resource}
                            onClick={() => void probeTarget(target)}
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton
                            label={t('remoteSshEdit')}
                            onClick={() => setTargetDraft(targetDraftFrom(target))}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton
                            label={t('remoteSshDelete')}
                            danger
                            busy={busyKey === `delete-target:${target.id}`}
                            onClick={() => void deleteTarget(target)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconButton>
                        </div>
                      </div>
                    )
                  })}
                  {!group.targets.length ? (
                    <button
                      type="button"
                      onClick={() => group.lab && setTargetDraft(emptyTargetDraft(group.lab.id))}
                      className="flex w-full items-center justify-center gap-1.5 px-3 py-4 text-[11.5px] text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t('remoteSshLabEmptyAction')}
                    </button>
                  ) : null}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </section>
  )
}

type Translate = (key: string, options?: Record<string, unknown>) => string

function RemoteSshOnboarding({
  action,
  environmentProvider,
  busy,
  copied,
  onStart,
  onAddTarget,
  onCopy,
  t
}: Readonly<{
  action: RemoteSshOnboardingAction
  environmentProvider?: RemoteSshLabEnvironmentProvider
  busy: boolean
  copied: boolean
  onStart: () => void
  onAddTarget: () => void
  onCopy: () => void
  t: Translate
}>): ReactElement {
  const steps = [
    { icon: Server, title: t('remoteSshOnboardingLabTitle'), body: t('remoteSshOnboardingLabBody') },
    { icon: Play, title: t('remoteSshOnboardingVmTitle'), body: t('remoteSshOnboardingVmBody') },
    { icon: Network, title: t('remoteSshOnboardingVpnTitle'), body: t('remoteSshOnboardingVpnBody') },
    { icon: Terminal, title: t('remoteSshOnboardingSshTitle'), body: t('remoteSshOnboardingSshBody') }
  ]
  return (
    <section className="mb-3 overflow-hidden rounded-lg border border-accent/25 bg-ds-panel">
      <div className="border-b border-ds-border bg-accent/5 px-3 py-3">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 rounded-md bg-accent/10 p-1.5 text-accent">
            <Network className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-[12.5px] font-semibold text-ds-ink">{t('remoteSshOnboardingTitle')}</h3>
            <p className="mt-1 text-[11px] leading-4.5 text-ds-muted">{t('remoteSshOnboardingIntro')}</p>
          </div>
        </div>
      </div>
      <ol className="grid gap-3 px-3 py-3">
        {steps.map(({ icon: StepIcon, title, body }, index) => (
          <li key={title} className="flex gap-2.5">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ds-border bg-ds-sidebar text-[10px] font-semibold text-ds-muted">
              {index + 1}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ds-ink">
                <StepIcon className="h-3.5 w-3.5 text-ds-muted" />
                {title}
              </div>
              <p className="mt-0.5 text-[10.5px] leading-4 text-ds-faint">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mx-3 mb-3 rounded-md border border-ds-border bg-ds-sidebar px-2.5 py-2 text-[10.5px] leading-4 text-ds-muted">
        <div className="flex items-start gap-1.5">
          <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{t('remoteSshOnboardingAutomation')}</span>
        </div>
      </div>
      <div className="grid gap-2 border-t border-ds-border px-3 py-3">
        <button
          type="button"
          onClick={onStart}
          disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-2.5 py-2 text-[11.5px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          {t(onboardingActionTranslationKey(action, environmentProvider))}
        </button>
        {action === 'open-console' ? (
          <button
            type="button"
            onClick={onAddTarget}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-2 text-[11px] font-medium text-ds-ink transition hover:bg-accent/10 disabled:opacity-50"
          >
            <Terminal className="h-3.5 w-3.5" />
            {t('remoteSshOnboardingVpnSignedIn')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-ds-border bg-ds-sidebar px-2.5 py-2 text-[11px] font-medium text-ds-ink transition hover:bg-ds-hover"
        >
          {copied ? <CircleCheck className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('remoteSshTemplateCopied') : t('remoteSshCopyTemplate')}
        </button>
        <p className="text-center text-[10px] leading-4 text-ds-faint">{t('remoteSshTemplateHint')}</p>
      </div>
    </section>
  )
}

function onboardingActionTranslationKey(
  action: RemoteSshOnboardingAction,
  environmentProvider?: RemoteSshLabEnvironmentProvider
): string {
  switch (action) {
    case 'create-lab': return 'remoteSshOnboardingStart'
    case 'ensure-environment': return environmentProvider === 'docker'
      ? 'remoteSshOnboardingEnsureDocker'
      : 'remoteSshOnboardingEnsureEnvironment'
    case 'open-console': return environmentProvider === 'docker'
      ? 'remoteSshEnvironmentOpenVpnLogin'
      : 'remoteSshOnboardingOpenConsole'
    case 'refresh': return 'remoteSshOnboardingRefresh'
    case 'add-target': return 'remoteSshOnboardingAddTarget'
  }
}

function LabEditor({
  draft,
  busy,
  setDraft,
  onSave,
  onCancel,
  t
}: Readonly<{
  draft: LabDraft
  busy: boolean
  setDraft: (draft: LabDraft | null) => void
  onSave: () => void
  onCancel: () => void
  t: Translate
}>): ReactElement {
  return (
    <form
      className="mb-3 grid gap-2 rounded-lg border border-ds-border bg-ds-panel p-3"
      onSubmit={(event) => { event.preventDefault(); onSave() }}
    >
      <EditorInput
        label={t('remoteSshLabName')}
        value={draft.displayName}
        required
        onChange={(displayName) => setDraft({ ...draft, displayName })}
      />
      <label className="grid gap-1 text-[11px] font-medium text-ds-muted">
        {t('remoteSshEnvironmentProvider')}
        <select
          value={draft.environmentProvider}
          onChange={(event) => setDraft({
            ...draft,
            environmentProvider: event.target.value as RemoteSshLabEnvironmentProvider
          })}
          className={EDITOR_INPUT_CLASS}
        >
          <option value="vm">{t('remoteSshEnvironmentProviderVm')}</option>
          <option value="docker">{t('remoteSshEnvironmentProviderDocker')}</option>
        </select>
        <span className="font-normal leading-4 text-ds-faint">
          {t('remoteSshEnvironmentProviderHint')}
        </span>
      </label>
      {draft.environmentProvider === 'vm' ? (
        <>
          <EditorInput
            label={t('remoteSshVmId')}
            value={draft.vmId}
            required
            description={t('remoteSshVmIdHint')}
            onChange={(vmId) => setDraft({ ...draft, vmId })}
          />
          <EditorInput
            label={t('remoteSshVmGatewayAlias')}
            value={draft.gatewaySshAlias}
            required
            description={t('remoteSshVmGatewayAliasHint')}
            onChange={(gatewaySshAlias) => setDraft({ ...draft, gatewaySshAlias })}
          />
          <div className="rounded-md border border-amber-500/25 bg-amber-500/8 px-2.5 py-2 text-[10.5px] leading-4 text-amber-800 dark:text-amber-200">
            {t('remoteSshVmRequirements')}
          </div>
        </>
      ) : (
        <EditorInput
          label={t('remoteSshDockerImage')}
          value={draft.dockerImage}
          required
          description={t('remoteSshDockerImageHint')}
          onChange={(dockerImage) => setDraft({ ...draft, dockerImage })}
        />
      )}
      <EditorInput
        label={t('remoteSshLabConcurrency')}
        value={String(draft.maxConcurrentExecutions)}
        type="number"
        min={1}
        onChange={(value) => setDraft({ ...draft, maxConcurrentExecutions: Number(value) })}
      />
      <EditorActions busy={busy} onCancel={onCancel} t={t} />
    </form>
  )
}

function TargetEditor({
  draft,
  labs,
  busy,
  setDraft,
  onSave,
  onCancel,
  t
}: Readonly<{
  draft: TargetDraft
  labs: readonly RemoteSshLab[]
  busy: boolean
  setDraft: (draft: TargetDraft | null) => void
  onSave: () => void
  onCancel: () => void
  t: Translate
}>): ReactElement {
  const toggleCapability = (capability: RemoteSshTargetCapability): void => {
    const next = draft.capabilities.includes(capability)
      ? draft.capabilities.filter((value) => value !== capability)
      : [...draft.capabilities, capability]
    if (next.length) setDraft({ ...draft, capabilities: next })
  }
  return (
    <form
      className="mb-3 grid gap-2 rounded-lg border border-ds-border bg-ds-panel p-3"
      onSubmit={(event) => { event.preventDefault(); onSave() }}
    >
      <label className="grid gap-1 text-[11px] font-medium text-ds-muted">
        {t('remoteSshLabName')}
        <select
          value={draft.labId}
          onChange={(event) => setDraft({ ...draft, labId: event.target.value })}
          className={EDITOR_INPUT_CLASS}
        >
          {labs.map((lab) => <option key={lab.id} value={lab.id}>{lab.displayName}</option>)}
        </select>
      </label>
      <EditorInput
        label={t('remoteSshTargetName')}
        value={draft.displayName}
        required
        onChange={(displayName) => setDraft({ ...draft, displayName })}
      />
      <EditorInput
        label={t('remoteSshAlias')}
        value={draft.sshAlias}
        required
        description={t('remoteSshAliasHint')}
        onChange={(sshAlias) => setDraft({ ...draft, sshAlias })}
      />
      <EditorInput
        label={t('remoteSshTargetConcurrency')}
        value={String(draft.maxConcurrentExecutions)}
        type="number"
        min={1}
        onChange={(value) => setDraft({ ...draft, maxConcurrentExecutions: Number(value) })}
      />
      <div className="flex gap-2">
        {(['shell', 'file-transfer'] as const).map((capability) => (
          <button
            key={capability}
            type="button"
            onClick={() => toggleCapability(capability)}
            className={`rounded-md border px-2 py-1 text-[10.5px] ${
              draft.capabilities.includes(capability)
                ? 'border-accent/40 bg-accent/10 text-ds-ink'
                : 'border-ds-border text-ds-faint'
            }`}
          >
            {capability}
          </button>
        ))}
      </div>
      <EditorActions busy={busy} onCancel={onCancel} t={t} />
    </form>
  )
}

const EDITOR_INPUT_CLASS = 'w-full rounded-md border border-ds-border bg-ds-sidebar px-2 py-1.5 text-[12px] text-ds-ink outline-none focus:border-accent/50'

function EditorInput({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  min,
  description
}: Readonly<{
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'number'
  required?: boolean
  min?: number
  description?: string
}>): ReactElement {
  return (
    <label className="grid gap-1 text-[11px] font-medium text-ds-muted">
      {label}
      <input
        type={type}
        value={value}
        required={required}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        className={EDITOR_INPUT_CLASS}
      />
      {description ? <span className="font-normal leading-4 text-ds-faint">{description}</span> : null}
    </label>
  )
}

function EditorActions({
  busy,
  onCancel,
  t
}: Readonly<{ busy: boolean; onCancel: () => void; t: Translate }>): ReactElement {
  return (
    <div className="mt-1 flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="rounded-md px-2 py-1.5 text-[11.5px] text-ds-muted hover:bg-ds-hover">
        {t('remoteSshCancel')}
      </button>
      <button type="submit" disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-[11.5px] font-semibold text-white disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        {t('remoteSshSave')}
      </button>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  children,
  danger = false,
  busy = false,
  disabled = false
}: Readonly<{
  label: string
  onClick: () => void
  children: ReactElement
  danger?: boolean
  busy?: boolean
  disabled?: boolean
}>): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`rounded-md p-1.5 transition hover:bg-ds-hover disabled:opacity-50 ${danger ? 'text-red-600' : 'text-ds-muted hover:text-ds-ink'}`}
      aria-label={label}
      title={label}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : children}
    </button>
  )
}

function emptyLabDraft(): LabDraft {
  return {
    displayName: '',
    environmentProvider: REMOTE_SSH_DEFAULT_ENVIRONMENT_PROVIDER,
    vmId: '',
    gatewaySshAlias: '',
    dockerImage: REMOTE_SSH_DEFAULT_DOCKER_IMAGE,
    maxConcurrentExecutions: 8
  }
}

function labDraftFrom(lab: RemoteSshLab): LabDraft {
  return {
    id: lab.id,
    displayName: lab.displayName,
    environmentProvider: lab.environment.provider,
    vmId: lab.environment.provider === 'vm' ? lab.environment.vmId : '',
    gatewaySshAlias: lab.environment.provider === 'vm' ? lab.environment.gatewaySshAlias : '',
    dockerImage: lab.environment.provider === 'docker'
      ? lab.environment.image
      : REMOTE_SSH_DEFAULT_DOCKER_IMAGE,
    maxConcurrentExecutions: lab.maxConcurrentExecutions,
    expectedRevision: lab.revision
  }
}

function labEnvironmentSummary(lab: RemoteSshLab, t: Translate): string {
  if (lab.environment.provider === 'vm') {
    return `${t('remoteSshEnvironmentProviderVmShort')} · ${lab.environment.vmId} · ssh ${lab.environment.gatewaySshAlias}`
  }
  return `${t('remoteSshEnvironmentProviderDockerShort')} · ${lab.environment.image}`
}

function canEnsureLabEnvironment(
  environment: RemoteSshLabEnvironmentResult | undefined
): boolean {
  return (
    !environment ||
    ['provider-unavailable', 'configuration-required', 'stopped', 'failed'].includes(
      environment.state
    )
  )
}

function LabEnvironmentStatus({
  environment,
  t
}: Readonly<{
  environment?: RemoteSshLabEnvironmentResult
  t: Translate
}>): ReactElement {
  const state = environment?.state ?? 'starting'
  const labelKey = environmentStateTranslationKey(state)
  const className = state === 'ready'
    ? 'text-emerald-600 dark:text-emerald-400'
    : state === 'login-required'
      ? 'text-amber-600 dark:text-amber-400'
      : state === 'failed' || state === 'provider-unavailable'
        ? 'text-red-600 dark:text-red-400'
        : 'text-ds-faint'
  return (
    <div className={`mt-1 flex items-center gap-1 text-[10px] ${className}`}>
      <Circle className="h-2 w-2 fill-current" />
      <span>{t(labelKey)}</span>
    </div>
  )
}

function environmentStateTranslationKey(
  state: RemoteSshLabEnvironmentResult['state']
): string {
  switch (state) {
    case 'provider-unavailable': return 'remoteSshEnvironmentStateProviderUnavailable'
    case 'configuration-required': return 'remoteSshEnvironmentStateConfigurationRequired'
    case 'stopped': return 'remoteSshEnvironmentStateStopped'
    case 'starting': return 'remoteSshEnvironmentStateStarting'
    case 'login-required': return 'remoteSshEnvironmentStateLoginRequired'
    case 'ready': return 'remoteSshEnvironmentStateReady'
    case 'failed': return 'remoteSshEnvironmentStateFailed'
  }
}

function emptyTargetDraft(labId: string): TargetDraft {
  return {
    labId,
    displayName: '',
    sshAlias: '',
    labels: {},
    capabilities: ['shell', 'file-transfer'],
    maxConcurrentExecutions: 2
  }
}

function targetDraftFrom(target: RemoteSshTarget): TargetDraft {
  return {
    id: target.id,
    labId: target.labId,
    displayName: target.displayName,
    sshAlias: target.sshAlias,
    labels: target.labels,
    capabilities: target.capabilities,
    maxConcurrentExecutions: target.maxConcurrentExecutions,
    expectedRevision: target.revision
  }
}

export function handlesByTargetId(
  targets: readonly RemoteSshTargetBinding[]
): Record<string, RemoteSshTargetHandle> {
  return Object.fromEntries(targets.map(({ target, resource }) => [target.id, resource]))
}

export function probeDisplay(
  result: RemoteSshTargetProbeResult | undefined,
  t: Translate
): Readonly<{ label: string; className: string }> {
  if (!result) return { label: t('remoteSshStatusUnknown'), className: 'text-ds-faint' }
  if (result.ready) return { label: t('remoteSshStatusReachable'), className: 'text-emerald-600 dark:text-emerald-400' }
  if (result.target.status === 'auth-failed' || result.target.status === 'host-key-rejected') {
    return { label: t('remoteSshStatusAuthRequired'), className: 'text-amber-600 dark:text-amber-400' }
  }
  return { label: t('remoteSshStatusUnreachable'), className: 'text-red-600 dark:text-red-400' }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function capabilityOperationErrorMessage(error: unknown, fallback: string): string {
  const message = errorMessage(error, fallback)
  return /^Handler for remote-ssh\.[a-z0-9.-]+ failed\.$/u.test(message)
    ? fallback
    : message
}
