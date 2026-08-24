import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  WorkspaceHostOpenRemoteSessionInput
} from '@sciforge/domain-sdk/workspace-host'
import {
  Check,
  CircleCheck,
  Circle,
  Container,
  Copy,
  ExternalLink,
  FolderOpen,
  Loader2,
  MonitorPlay,
  Network,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  RemoteSshLabEnvironmentResult,
  RemoteSshLabEnvironmentGuidanceCode,
  RemoteSshLab,
  RemoteSshLabEnvironmentProvider,
  RemoteSshTargetProbeResult,
  RemoteSshTarget,
  RemoteSshTargetBinding,
  RemoteSshTargetCapability,
  RemoteSshTargetHandle,
  RemoteSshVirtualBoxMachine,
  RemoteSshVirtualBoxMachineListResult,
  RemoteSshWorkspaceBinding
} from '../contract'
import { REMOTE_SSH_DEFAULT_ENVIRONMENT_PROVIDER } from '../contract'
import type {
  RemoteSshCapabilityClient,
  RemoteSshMutationConfirmation
} from './remote-ssh-capability-client'
import {
  normalizedRemoteWorkspaceRoot,
  openRemoteSshWorkspace,
  parseRemoteWorkspaceEgressAllowlist,
  type RemoteSshWorkspaceEgressRequest
} from './remote-workspace-flow'

export type RemoteSshPanelProps = Readonly<{
  capabilityClient: RemoteSshCapabilityClient
  workspaceId?: string
  className?: string
  onCollapse?: () => void
  openExternal?: (url: string) => void | Promise<void>
  openRemoteSession?: (input: WorkspaceHostOpenRemoteSessionInput) => Promise<void>
  openRemoteResourcesSettings?: () => void
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

type RemoteWorkspaceDraft = Readonly<{
  targetId: string
  workspaceRoot: string
  egressMode: 'none' | 'local' | 'remote-target'
  egressTargetId: string
  egressAllowlist: string
}>

const USER_CONFIRMED_MUTATION = Object.freeze({
  approval: Object.freeze({ mode: 'confirmation' as const })
}) satisfies RemoteSshMutationConfirmation

const REMOTE_SSH_DEFAULT_DOCKER_IMAGE = 'hagb/docker-atrust:latest'

export type RemoteSshOnboardingAction =
  | 'create-lab'
  | 'ensure-environment'
  | 'open-console'
  | 'open-config'
  | 'refresh'
  | 'add-target'

export type RemoteSshWorkspaceOpenReadiness =
  | 'unavailable'
  | 'environment-required'
  | 'target-check-required'
  | 'ready'

export function remoteSshWorkspaceOpenReadiness({
  allowed,
  resourceAvailable,
  hostAvailable,
  environment,
  probe
}: Readonly<{
  allowed: boolean
  resourceAvailable: boolean
  hostAvailable: boolean
  environment?: RemoteSshLabEnvironmentResult
  probe?: RemoteSshTargetProbeResult
}>): RemoteSshWorkspaceOpenReadiness {
  if (!allowed || !resourceAvailable || !hostAvailable) return 'unavailable'
  if (environment?.state !== 'ready') return 'environment-required'
  return probe?.ready ? 'ready' : 'target-check-required'
}

export function remoteSshOnboardingAction(
  lab: RemoteSshLab | undefined,
  environment: RemoteSshLabEnvironmentResult | undefined
): RemoteSshOnboardingAction {
  if (!lab) return 'create-lab'
  if (environment?.state === 'ready') return 'add-target'
  if (
    (environment?.state === 'login-required' ||
      environment?.guidanceCode === 'open-vpn-login' ||
      environment?.guidanceCode === 'authorize-gateway-key' ||
      environment?.guidanceCode === 'enable-gateway-ssh' ||
      environment?.guidanceCode === 'resume-environment') &&
    environment.consoleAvailable
  ) {
    return 'open-console'
  }
  if (environment?.guidanceCode === 'configure-gateway-alias') {
    return 'open-config'
  }
  if (
    environment?.state === 'starting' ||
    environment?.guidanceCode === 'trust-gateway-host-key' ||
    environment?.guidanceCode === 'install-host-openssh' ||
    environment?.guidanceCode === 'retry'
  ) {
    return 'refresh'
  }
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
  openExternal,
  openRemoteSession,
  openRemoteResourcesSettings
}: RemoteSshPanelProps): ReactElement {
  const { t } = useTranslation('common')
  const normalizedWorkspaceId = workspaceId?.trim() || undefined
  const [labs, setLabs] = useState<RemoteSshLab[]>([])
  const [targets, setTargets] = useState<RemoteSshTarget[]>([])
  const [targetHandles, setTargetHandles] = useState<Record<string, RemoteSshTargetHandle>>({})
  const [binding, setBinding] = useState<RemoteSshWorkspaceBinding | null>(null)
  const [probes, setProbes] = useState<Record<string, RemoteSshTargetProbeResult>>({})
  const [labEnvironments, setLabEnvironments] = useState<Record<string, RemoteSshLabEnvironmentResult>>({})
  const [virtualBoxCatalog, setVirtualBoxCatalog] =
    useState<RemoteSshVirtualBoxMachineListResult | null>(null)
  const [virtualBoxCatalogError, setVirtualBoxCatalogError] =
    useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [templateCopied, setTemplateCopied] = useState(false)
  const [labDraft, setLabDraft] = useState<LabDraft | null>(null)
  const [targetDraft, setTargetDraft] = useState<TargetDraft | null>(null)
  const [remoteWorkspaceDraft, setRemoteWorkspaceDraft] =
    useState<RemoteWorkspaceDraft | null>(null)
  const [workspaceBlockerLabId, setWorkspaceBlockerLabId] = useState<string | null>(null)

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
    setRemoteWorkspaceDraft(null)
    setWorkspaceBlockerLabId(null)
    try {
      const [labResult, catalogResult, targetResult, bindingResult, virtualBoxOutcome] = await Promise.all([
        capabilityClient.listLabs(),
        capabilityClient.listTargetCatalog(),
        normalizedWorkspaceId
          ? capabilityClient.listTargets(normalizedWorkspaceId)
          : Promise.resolve({ targets: [] }),
        normalizedWorkspaceId
          ? capabilityClient.getBinding(normalizedWorkspaceId).catch(() => null)
          : Promise.resolve(null),
        capabilityClient.listVirtualBoxMachines()
          .then((result) => ({ result, error: null }))
          .catch((error) => ({
            result: null,
            error: errorMessage(error, t('remoteSshVmDiscoveryFailed'))
          }))
      ])
      setLabs(labResult.labs)
      setTargets(catalogResult.targets)
      setTargetHandles(handlesByTargetId(targetResult.targets))
      setBinding(bindingResult?.binding ?? null)
      setVirtualBoxCatalog(virtualBoxOutcome.result)
      setVirtualBoxCatalogError(virtualBoxOutcome.error)
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

  const openOpenSshConfig = async (): Promise<void> => {
    setBusyKey('open-openssh-config')
    setMessage(null)
    try {
      await capabilityClient.openOpenSshConfig(USER_CONFIRMED_MUTATION)
    } catch (error) {
      setMessage(errorMessage(error, t('remoteSshOpenConfigFailed')))
    } finally {
      setBusyKey(null)
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
      case 'open-config':
        void openOpenSshConfig()
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

  const showRemoteWorkspaceEditor = (target: RemoteSshTarget): void => {
    const firstEgressTarget = targets.find((candidate) =>
      candidate.id !== target.id &&
      allowedTargetIds.has(candidate.id) &&
      Boolean(targetHandles[candidate.id])
    )
    setRemoteWorkspaceDraft({
      targetId: target.id,
      workspaceRoot: '',
      egressMode: 'none',
      egressTargetId: firstEgressTarget?.id ?? '',
      egressAllowlist: ''
    })
    setMessage(null)
    setWorkspaceBlockerLabId(null)
  }

  const prepareOpenRemoteWorkspace = async (target: RemoteSshTarget): Promise<void> => {
    const resource = targetHandles[target.id]
    const readiness = remoteSshWorkspaceOpenReadiness({
      allowed: allowedTargetIds.has(target.id),
      resourceAvailable: Boolean(resource),
      hostAvailable: Boolean(openRemoteSession),
      environment: labEnvironments[target.labId],
      probe: probes[target.id]
    })
    if (readiness === 'unavailable') {
      setWorkspaceBlockerLabId(null)
      setMessage(t('remoteSshWorkspaceTargetUnavailable'))
      return
    }
    if (readiness === 'environment-required') {
      setRemoteWorkspaceDraft(null)
      setWorkspaceBlockerLabId(target.labId)
      setMessage(t('remoteSshWorkspaceEnvironmentRequired', {
        lab: labs.find((lab) => lab.id === target.labId)?.displayName ?? target.labId
      }))
      return
    }
    if (readiness === 'ready') {
      showRemoteWorkspaceEditor(target)
      return
    }
    if (!normalizedWorkspaceId || !resource) return

    setBusyKey(`prepare-workspace:${target.id}`)
    setMessage(null)
    setWorkspaceBlockerLabId(null)
    try {
      const result = await capabilityClient.probeTarget(resource, normalizedWorkspaceId)
      setProbes((current) => ({ ...current, [target.id]: result }))
      if (!result.ready) {
        setRemoteWorkspaceDraft(null)
        setMessage(t('remoteSshWorkspaceTargetCheckRequired'))
        return
      }
      showRemoteWorkspaceEditor(target)
    } catch (error) {
      setMessage(errorMessage(error, t('remoteSshWorkspaceTargetCheckFailed')))
    } finally {
      setBusyKey(null)
    }
  }

  const openRemoteWorkspace = async (): Promise<void> => {
    if (!remoteWorkspaceDraft || !normalizedWorkspaceId || !openRemoteSession) return
    const workspaceRoot = normalizedRemoteWorkspaceRoot(remoteWorkspaceDraft.workspaceRoot)
    if (!workspaceRoot) {
      setMessage(t('remoteSshWorkspaceRootInvalid'))
      return
    }
    const target = targets.find((candidate) => candidate.id === remoteWorkspaceDraft.targetId)
    const workspaceTargetResource = targetHandles[remoteWorkspaceDraft.targetId]
    if (!target || !workspaceTargetResource) {
      setMessage(t('remoteSshWorkspaceTargetUnavailable'))
      return
    }
    const readiness = remoteSshWorkspaceOpenReadiness({
      allowed: allowedTargetIds.has(target.id),
      resourceAvailable: true,
      hostAvailable: true,
      environment: labEnvironments[target.labId],
      probe: probes[target.id]
    })
    if (readiness === 'environment-required') {
      setRemoteWorkspaceDraft(null)
      setWorkspaceBlockerLabId(target.labId)
      setMessage(t('remoteSshWorkspaceEnvironmentRequired', {
        lab: labs.find((lab) => lab.id === target.labId)?.displayName ?? target.labId
      }))
      return
    }
    if (readiness !== 'ready') {
      setRemoteWorkspaceDraft(null)
      setMessage(t('remoteSshWorkspaceTargetCheckRequired'))
      return
    }

    let egress: RemoteSshWorkspaceEgressRequest
    if (remoteWorkspaceDraft.egressMode === 'none') {
      egress = { mode: 'none' }
    } else {
      const allowlist = parseRemoteWorkspaceEgressAllowlist(
        remoteWorkspaceDraft.egressAllowlist
      )
      if (!allowlist) {
        setMessage(t('remoteSshWorkspaceEgressAllowlistInvalid'))
        return
      }
      if (remoteWorkspaceDraft.egressMode === 'local') {
        egress = { mode: 'local', allowlist }
      } else {
        const egressResource = targetHandles[remoteWorkspaceDraft.egressTargetId]
        if (
          !egressResource ||
          !allowedTargetIds.has(remoteWorkspaceDraft.egressTargetId) ||
          remoteWorkspaceDraft.egressTargetId === remoteWorkspaceDraft.targetId
        ) {
          setMessage(t('remoteSshWorkspaceEgressTargetUnavailable'))
          return
        }
        egress = {
          mode: 'remote-target',
          targetId: remoteWorkspaceDraft.egressTargetId,
          resource: egressResource,
          allowlist
        }
      }
    }

    setBusyKey(`open-workspace:${target.id}`)
    setMessage(null)
    setWorkspaceBlockerLabId(null)
    try {
      const opened = await openRemoteSshWorkspace({
        capabilityClient,
        workspaceId: normalizedWorkspaceId,
        workspaceTargetId: target.id,
        workspaceTargetResource,
        workspaceRoot,
        egress,
        confirmation: USER_CONFIRMED_MUTATION,
        openRemoteSession
      })
      setRemoteWorkspaceDraft(null)
      setMessage(t('remoteSshWorkspaceOpened', {
        target: target.displayName,
        path: opened.workspaceRoot
      }))
    } catch (error) {
      setMessage(errorMessage(error, t('remoteSshWorkspaceOpenFailed')))
    } finally {
      setBusyKey(null)
    }
  }

  const workspaceBlockerLab = workspaceBlockerLabId
    ? labs.find((lab) => lab.id === workspaceBlockerLabId)
    : undefined
  const workspaceBlockerEnvironment = workspaceBlockerLab
    ? labEnvironments[workspaceBlockerLab.id]
    : undefined
  const workspaceBlockerAction = workspaceBlockerEnvironment
    ? labEnvironmentGuidanceAction(
        labEnvironmentGuidanceCode(workspaceBlockerEnvironment),
        targets.filter((target) => target.labId === workspaceBlockerLab?.id).length
      )
    : null
  const runWorkspaceBlockerAction = (): void => {
    if (!workspaceBlockerLab || !workspaceBlockerAction) return
    switch (workspaceBlockerAction) {
      case 'edit':
        setLabDraft(labDraftFrom(workspaceBlockerLab))
        return
      case 'ensure':
        void ensureLabEnvironment(workspaceBlockerLab)
        return
      case 'open-config':
        void openOpenSshConfig()
        return
      case 'open-console':
        void openLabEnvironmentConsole(workspaceBlockerLab)
        return
      case 'refresh':
        void refresh()
        return
      case 'add-target':
        setTargetDraft(emptyTargetDraft(workspaceBlockerLab.id))
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
        {openRemoteResourcesSettings ? (
          <button
            type="button"
            onClick={openRemoteResourcesSettings}
            className="rounded-md p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('remoteSshOpenResourcesSettings')}
            title={t('remoteSshOpenResourcesSettings')}
          >
            <Settings2 className="h-4 w-4" strokeWidth={1.8} />
          </button>
        ) : null}
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
        <div className="flex shrink-0 items-center gap-2 border-b border-ds-border bg-red-500/8 px-4 py-2 text-[11.5px] leading-5 text-red-700 dark:text-red-300">
          <span className="min-w-0 flex-1">{message}</span>
          {workspaceBlockerLab && workspaceBlockerAction ? (
            <button
              type="button"
              onClick={runWorkspaceBlockerAction}
              disabled={busyKey !== null}
              className="shrink-0 rounded-md border border-red-500/25 bg-ds-panel px-2 py-1 text-[10.5px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:opacity-50"
            >
              {workspaceBlockerAction === 'open-console' &&
              workspaceBlockerLab.environment.provider === 'vm'
                ? t('remoteSshWorkspaceOpenVmAction', {
                    lab: workspaceBlockerLab.displayName
                  })
                : t(labEnvironmentGuidanceActionTranslationKey(
                    workspaceBlockerAction,
                    workspaceBlockerLab.environment.provider
                  ))}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-gutter:stable]">
        {labDraft ? (
          <LabEditor
            draft={labDraft}
            virtualBoxCatalog={virtualBoxCatalog}
            virtualBoxCatalogError={virtualBoxCatalogError}
            assignedVmIds={new Set(labs.flatMap((lab) =>
              lab.id !== labDraft.id && lab.environment.provider === 'vm'
                ? [lab.environment.vmId]
                : []
            ))}
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
            openingOpenSshConfig={busyKey === 'open-openssh-config'}
            setDraft={setTargetDraft}
            onSave={() => void saveTarget()}
            onOpenSshConfig={() => void openOpenSshConfig()}
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
                        {environment?.message && !environment.guidanceCode ? (
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
                {group.lab && environment ? (
                  <LabEnvironmentGuidance
                    environment={environment}
                    targetCount={group.targets.length}
                    busy={busyKey !== null}
                    onEdit={() => setLabDraft(labDraftFrom(group.lab!))}
                    onEnsure={() => void ensureLabEnvironment(group.lab!)}
                    onOpenConfig={() => void openOpenSshConfig()}
                    onOpenConsole={() => void openLabEnvironmentConsole(group.lab!)}
                    onRefresh={() => void refresh()}
                    onAddTarget={() => setTargetDraft(emptyTargetDraft(group.lab!.id))}
                    t={t}
                  />
                ) : null}
                <div className="divide-y divide-ds-border">
                  {group.targets.map((target) => {
                    const probe = probes[target.id]
                    const status = probeDisplay(probe, t)
                    const allowed = allowedTargetIds.has(target.id)
                    const resource = targetHandles[target.id]
                    const workspaceReadiness = remoteSshWorkspaceOpenReadiness({
                      allowed,
                      resourceAvailable: Boolean(resource),
                      hostAvailable: Boolean(openRemoteSession),
                      environment,
                      probe
                    })
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
                            label={workspaceReadiness === 'environment-required'
                              ? t('remoteSshWorkspaceEnvironmentActionRequired')
                              : busyKey === `prepare-workspace:${target.id}`
                                ? t('remoteSshWorkspaceChecking')
                                : t('remoteSshOpenWorkspace')}
                            busy={busyKey === `prepare-workspace:${target.id}`}
                            disabled={workspaceReadiness === 'unavailable'}
                            onClick={() => void prepareOpenRemoteWorkspace(target)}
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                          </IconButton>
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
                        {remoteWorkspaceDraft?.targetId === target.id &&
                        workspaceReadiness === 'ready' ? (
                          <RemoteWorkspaceEditor
                            draft={remoteWorkspaceDraft}
                            egressTargets={targets.filter((candidate) =>
                              candidate.id !== target.id &&
                              allowedTargetIds.has(candidate.id) &&
                              Boolean(targetHandles[candidate.id])
                            )}
                            busy={busyKey === `open-workspace:${target.id}`}
                            hostAvailable={Boolean(openRemoteSession)}
                            setDraft={setRemoteWorkspaceDraft}
                            onOpen={() => void openRemoteWorkspace()}
                            onCancel={() => setRemoteWorkspaceDraft(null)}
                            t={t}
                          />
                        ) : null}
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

type LabEnvironmentGuidanceAction =
  | 'edit'
  | 'ensure'
  | 'open-config'
  | 'open-console'
  | 'refresh'
  | 'add-target'

export function labEnvironmentGuidanceCode(
  environment: RemoteSshLabEnvironmentResult
): RemoteSshLabEnvironmentGuidanceCode {
  if (environment.guidanceCode) return environment.guidanceCode
  switch (environment.state) {
    case 'provider-unavailable': return 'install-provider'
    case 'configuration-required': return 'retry'
    case 'stopped': return 'start-environment'
    case 'starting': return 'wait-for-environment'
    case 'login-required': return 'open-vpn-login'
    case 'ready': return 'test-target'
    case 'failed': return 'retry'
  }
}

export function labEnvironmentGuidanceAction(
  code: RemoteSshLabEnvironmentGuidanceCode,
  targetCount: number
): LabEnvironmentGuidanceAction | null {
  switch (code) {
    case 'install-provider':
    case 'select-environment':
      return 'edit'
    case 'start-environment':
      return 'ensure'
    case 'configure-gateway-alias':
      return 'open-config'
    case 'resume-environment':
    case 'authorize-gateway-key':
    case 'enable-gateway-ssh':
    case 'open-vpn-login':
      return 'open-console'
    case 'test-target':
      return targetCount === 0 ? 'add-target' : null
    case 'install-host-openssh':
    case 'trust-gateway-host-key':
    case 'wait-for-environment':
    case 'retry':
      return 'refresh'
  }
}

function labEnvironmentGuidanceActionTranslationKey(
  action: LabEnvironmentGuidanceAction,
  provider: RemoteSshLabEnvironmentProvider
): string {
  switch (action) {
    case 'edit': return 'remoteSshGuidanceEdit'
    case 'ensure': return 'remoteSshGuidanceStart'
    case 'open-config': return 'remoteSshOpenConfig'
    case 'open-console': return provider === 'vm'
      ? 'remoteSshGuidanceOpenVm'
      : 'remoteSshEnvironmentOpenVpnLogin'
    case 'refresh': return 'remoteSshGuidanceCheckAgain'
    case 'add-target': return 'remoteSshAddTarget'
  }
}

function labEnvironmentGuidanceTranslationKeys(
  code: RemoteSshLabEnvironmentGuidanceCode
): Readonly<{ title: string; body: string }> {
  switch (code) {
    case 'install-provider':
      return { title: 'remoteSshGuidanceInstallProviderTitle', body: 'remoteSshGuidanceInstallProviderBody' }
    case 'select-environment':
      return { title: 'remoteSshGuidanceSelectEnvironmentTitle', body: 'remoteSshGuidanceSelectEnvironmentBody' }
    case 'start-environment':
      return { title: 'remoteSshGuidanceStartEnvironmentTitle', body: 'remoteSshGuidanceStartEnvironmentBody' }
    case 'wait-for-environment':
      return { title: 'remoteSshGuidanceWaitEnvironmentTitle', body: 'remoteSshGuidanceWaitEnvironmentBody' }
    case 'resume-environment':
      return { title: 'remoteSshGuidanceResumeEnvironmentTitle', body: 'remoteSshGuidanceResumeEnvironmentBody' }
    case 'install-host-openssh':
      return { title: 'remoteSshGuidanceInstallOpenSshTitle', body: 'remoteSshGuidanceInstallOpenSshBody' }
    case 'configure-gateway-alias':
      return { title: 'remoteSshGuidanceConfigureAliasTitle', body: 'remoteSshGuidanceConfigureAliasBody' }
    case 'trust-gateway-host-key':
      return { title: 'remoteSshGuidanceTrustHostKeyTitle', body: 'remoteSshGuidanceTrustHostKeyBody' }
    case 'authorize-gateway-key':
      return { title: 'remoteSshGuidanceAuthorizeKeyTitle', body: 'remoteSshGuidanceAuthorizeKeyBody' }
    case 'enable-gateway-ssh':
      return { title: 'remoteSshGuidanceEnableSshTitle', body: 'remoteSshGuidanceEnableSshBody' }
    case 'open-vpn-login':
      return { title: 'remoteSshGuidanceVpnLoginTitle', body: 'remoteSshGuidanceVpnLoginBody' }
    case 'test-target':
      return { title: 'remoteSshGuidanceTestTargetTitle', body: 'remoteSshGuidanceTestTargetBody' }
    case 'retry':
      return { title: 'remoteSshGuidanceRetryTitle', body: 'remoteSshGuidanceRetryBody' }
  }
}

function LabEnvironmentGuidance({
  environment,
  targetCount,
  busy,
  onEdit,
  onEnsure,
  onOpenConfig,
  onOpenConsole,
  onRefresh,
  onAddTarget,
  t
}: Readonly<{
  environment: RemoteSshLabEnvironmentResult
  targetCount: number
  busy: boolean
  onEdit: () => void
  onEnsure: () => void
  onOpenConfig: () => void
  onOpenConsole: () => void
  onRefresh: () => void
  onAddTarget: () => void
  t: Translate
}>): ReactElement {
  const code = labEnvironmentGuidanceCode(environment)
  const action = labEnvironmentGuidanceAction(code, targetCount)
  const actions = [
    action,
    code === 'enable-gateway-ssh' ? 'open-config' as const : null
  ].filter((candidate): candidate is LabEnvironmentGuidanceAction => candidate !== null)
  const copy = labEnvironmentGuidanceTranslationKeys(code)
  const ready = code === 'test-target'
  const actionCallbacks: Record<LabEnvironmentGuidanceAction, () => void> = {
    edit: onEdit,
    ensure: onEnsure,
    'open-config': onOpenConfig,
    'open-console': onOpenConsole,
    refresh: onRefresh,
    'add-target': onAddTarget
  }
  return (
    <div
      className={`border-b px-3 py-2.5 ${
        ready
          ? 'border-emerald-500/20 bg-emerald-500/6'
          : 'border-amber-500/20 bg-amber-500/6'
      }`}
    >
      <div className="flex items-start gap-2">
        {ready
          ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          : <Network className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />}
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] font-semibold text-ds-ink">
            {t(copy.title)}
          </div>
          <p className="mt-0.5 text-[10.5px] leading-4 text-ds-muted">
            {t(copy.body)}
          </p>
          {environment.message ? (
            <details className="mt-1.5 text-[10px] text-ds-faint">
              <summary className="cursor-pointer select-none">
                {t('remoteSshGuidanceTechnicalDetails')}
              </summary>
              <div className="mt-1 break-words rounded bg-ds-sidebar px-2 py-1.5 font-mono leading-4">
                {environment.message}
              </div>
            </details>
          ) : null}
        </div>
        {actions.length ? (
          <div className="grid shrink-0 gap-1">
            {actions.map((guidanceAction) => (
              <button
                key={guidanceAction}
                type="button"
                disabled={busy}
                onClick={actionCallbacks[guidanceAction]}
                className="inline-flex items-center justify-center gap-1 rounded-md border border-ds-border bg-ds-panel px-2 py-1.5 text-[10.5px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {t(labEnvironmentGuidanceActionTranslationKey(
                  guidanceAction,
                  environment.provider
                ))}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function RemoteWorkspaceEditor({
  draft,
  egressTargets,
  busy,
  hostAvailable,
  setDraft,
  onOpen,
  onCancel,
  t
}: Readonly<{
  draft: RemoteWorkspaceDraft
  egressTargets: readonly RemoteSshTarget[]
  busy: boolean
  hostAvailable: boolean
  setDraft: (draft: RemoteWorkspaceDraft | null) => void
  onOpen: () => void
  onCancel: () => void
  t: Translate
}>): ReactElement {
  const rootValid = normalizedRemoteWorkspaceRoot(draft.workspaceRoot) !== null
  const allowlistValid =
    draft.egressMode === 'none' ||
    parseRemoteWorkspaceEgressAllowlist(draft.egressAllowlist) !== null
  const egressTargetValid =
    draft.egressMode !== 'remote-target' ||
    egressTargets.some((target) => target.id === draft.egressTargetId)
  return (
    <form
      className="mt-2 grid gap-2 rounded-md border border-accent/25 bg-accent/5 p-2.5"
      aria-label={t('remoteSshWorkspaceOpenTitle')}
      onSubmit={(event) => {
        event.preventDefault()
        onOpen()
      }}
    >
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ds-ink">
        <FolderOpen className="h-3.5 w-3.5 text-accent" />
        {t('remoteSshWorkspaceOpenTitle')}
      </div>
      <label className="grid gap-1 text-[11px] font-medium text-ds-muted">
        {t('remoteSshWorkspaceRoot')}
        <input
          type="text"
          value={draft.workspaceRoot}
          required
          maxLength={4_096}
          autoComplete="off"
          spellCheck={false}
          placeholder={t('remoteSshWorkspaceRootPlaceholder')}
          onChange={(event) => setDraft({
            ...draft,
            workspaceRoot: event.target.value
          })}
          className={EDITOR_INPUT_CLASS}
        />
        <span className="font-normal leading-4 text-ds-faint">
          {t('remoteSshWorkspaceRootHint')}
        </span>
      </label>
      <label className="grid gap-1 text-[11px] font-medium text-ds-muted">
        {t('remoteSshWorkspaceEgress')}
        <select
          value={draft.egressMode}
          onChange={(event) => {
            const egressMode = parseRemoteWorkspaceEgressMode(event.target.value)
            setDraft({
              ...draft,
              egressMode,
              egressTargetId: egressMode === 'remote-target'
                ? draft.egressTargetId || egressTargets[0]?.id || ''
                : ''
            })
          }}
          className={EDITOR_INPUT_CLASS}
        >
          <option value="none">{t('remoteSshWorkspaceEgressNone')}</option>
          <option value="local">{t('remoteSshWorkspaceEgressLocal')}</option>
          <option value="remote-target">{t('remoteSshWorkspaceEgressRemoteTarget')}</option>
        </select>
      </label>
      {draft.egressMode === 'remote-target' ? (
        <label className="grid gap-1 text-[11px] font-medium text-ds-muted">
          {t('remoteSshWorkspaceEgressTarget')}
          <select
            value={draft.egressTargetId}
            required
            onChange={(event) => setDraft({
              ...draft,
              egressTargetId: event.target.value
            })}
            className={EDITOR_INPUT_CLASS}
          >
            {!egressTargets.length ? (
              <option value="">{t('remoteSshWorkspaceEgressTargetUnavailable')}</option>
            ) : null}
            {egressTargets.map((target) => (
              <option key={target.id} value={target.id}>{target.displayName}</option>
            ))}
          </select>
        </label>
      ) : null}
      {draft.egressMode !== 'none' ? (
        <label className="grid gap-1 text-[11px] font-medium text-ds-muted">
          {t('remoteSshWorkspaceEgressAllowlist')}
          <textarea
            value={draft.egressAllowlist}
            required
            rows={3}
            maxLength={8_192}
            autoComplete="off"
            spellCheck={false}
            placeholder={t('remoteSshWorkspaceEgressAllowlistPlaceholder')}
            onChange={(event) => setDraft({
              ...draft,
              egressAllowlist: event.target.value
            })}
            className={`${EDITOR_INPUT_CLASS} resize-y font-mono`}
          />
          <span className="font-normal leading-4 text-ds-faint">
            {t('remoteSshWorkspaceEgressAllowlistHint')}
          </span>
        </label>
      ) : null}
      {!hostAvailable ? (
        <p className="text-[10.5px] leading-4 text-amber-700 dark:text-amber-300">
          {t('remoteSshWorkspaceHostUnavailable')}
        </p>
      ) : null}
      <div className="mt-1 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1.5 text-[11.5px] text-ds-muted hover:bg-ds-hover"
        >
          {t('remoteSshCancel')}
        </button>
        <button
          type="submit"
          disabled={
            busy ||
            !hostAvailable ||
            !rootValid ||
            !egressTargetValid ||
            !allowlistValid
          }
          className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-[11.5px] font-semibold text-white disabled:opacity-50"
        >
          {busy
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <FolderOpen className="h-3.5 w-3.5" />}
          {busy ? t('remoteSshWorkspaceOpening') : t('remoteSshOpenWorkspace')}
        </button>
      </div>
    </form>
  )
}

function parseRemoteWorkspaceEgressMode(
  value: string
): RemoteWorkspaceDraft['egressMode'] {
  switch (value) {
    case 'local':
    case 'remote-target':
      return value
    default:
      return 'none'
  }
}

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
    case 'open-config': return 'remoteSshOpenConfig'
    case 'refresh': return 'remoteSshOnboardingRefresh'
    case 'add-target': return 'remoteSshOnboardingAddTarget'
  }
}

function LabEditor({
  draft,
  virtualBoxCatalog,
  virtualBoxCatalogError,
  assignedVmIds,
  busy,
  setDraft,
  onSave,
  onCancel,
  t
}: Readonly<{
  draft: LabDraft
  virtualBoxCatalog: RemoteSshVirtualBoxMachineListResult | null
  virtualBoxCatalogError: string | null
  assignedVmIds: ReadonlySet<string>
  busy: boolean
  setDraft: (draft: LabDraft | null) => void
  onSave: () => void
  onCancel: () => void
  t: Translate
}>): ReactElement {
  const machines = virtualBoxCatalog?.machines ?? []
  const [advancedOpen, setAdvancedOpen] = useState(
    virtualBoxCatalog?.available === false || machines.length === 0
  )
  const selectedMachine = machines.find((machine) => machine.uuid === draft.vmId)
  const chooseMachine = (vmId: string): void => {
    const machine = machines.find((candidate) => candidate.uuid === vmId)
    if (!machine) {
      setDraft({ ...draft, vmId })
      return
    }
    setDraft({
      ...draft,
      vmId: machine.uuid,
      displayName: draft.displayName || machine.name,
      gatewaySshAlias: remoteSshGeneratedGatewayAlias(machine)
    })
  }
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
          <label className="grid gap-1 text-[11px] font-medium text-ds-muted">
            {t('remoteSshVmPicker')}
            <select
              value={draft.vmId}
              required
              onChange={(event) => chooseMachine(event.target.value)}
              className={EDITOR_INPUT_CLASS}
            >
              <option value="">{t('remoteSshVmPickerPlaceholder')}</option>
              {machines.map((machine) => (
                <option
                  key={machine.uuid}
                  value={machine.uuid}
                  disabled={assignedVmIds.has(machine.uuid)}
                >
                  {virtualBoxMachineOption(machine, assignedVmIds.has(machine.uuid), t)}
                </option>
              ))}
              {draft.vmId && !selectedMachine ? (
                <option value={draft.vmId}>{draft.vmId}</option>
              ) : null}
            </select>
            <span className="font-normal leading-4 text-ds-faint">
              {virtualBoxCatalog?.available
                ? machines.length
                  ? t('remoteSshVmPickerHint')
                  : t('remoteSshVmPickerEmpty')
                : virtualBoxCatalogError ?? t('remoteSshVmPickerUnavailable')}
            </span>
          </label>
          {selectedMachine ? (
            <div className="rounded-md border border-emerald-500/25 bg-emerald-500/8 px-2.5 py-2">
              <div className="flex items-start gap-2">
                <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div className="min-w-0">
                  <div className="truncate text-[11.5px] font-semibold text-ds-ink">
                    {selectedMachine.name}
                  </div>
                  <div className="mt-0.5 text-[10px] leading-4 text-ds-faint">
                    {[
                      virtualBoxStateLabel(selectedMachine.state, t),
                      selectedMachine.osType,
                      selectedMachine.architecture
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {draft.gatewaySshAlias ? (
            <div className="rounded-md border border-ds-border bg-ds-sidebar px-2.5 py-2">
              <div className="text-[10px] font-medium text-ds-faint">
                {t('remoteSshVmGatewayGenerated')}
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-ds-ink">
                ssh {draft.gatewaySshAlias}
              </div>
            </div>
          ) : null}
          <div className="rounded-md border border-amber-500/25 bg-amber-500/8 px-2.5 py-2 text-[10.5px] leading-4 text-amber-800 dark:text-amber-200">
            {t('remoteSshVmRequirementsFriendly')}
          </div>
          <details
            className="rounded-md border border-ds-border bg-ds-sidebar"
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer px-2.5 py-2 text-[10.5px] font-medium text-ds-muted">
              {t('remoteSshAdvancedSettings')}
            </summary>
            <div className="grid gap-2 border-t border-ds-border px-2.5 py-2.5">
              <EditorInput
                label={t('remoteSshVmId')}
                value={draft.vmId}
                required
                description={t('remoteSshVmIdAdvancedHint')}
                onChange={(vmId) => setDraft({ ...draft, vmId })}
              />
              <EditorInput
                label={t('remoteSshVmGatewayAlias')}
                value={draft.gatewaySshAlias}
                required
                description={t('remoteSshVmGatewayAliasAdvancedHint')}
                onChange={(gatewaySshAlias) => setDraft({ ...draft, gatewaySshAlias })}
              />
              <EditorInput
                label={t('remoteSshLabConcurrency')}
                value={String(draft.maxConcurrentExecutions)}
                type="number"
                min={1}
                onChange={(value) => setDraft({ ...draft, maxConcurrentExecutions: Number(value) })}
              />
            </div>
          </details>
        </>
      ) : (
        <>
          <EditorInput
            label={t('remoteSshDockerImage')}
            value={draft.dockerImage}
            required
            description={t('remoteSshDockerImageHint')}
            onChange={(dockerImage) => setDraft({ ...draft, dockerImage })}
          />
          <EditorInput
            label={t('remoteSshLabConcurrency')}
            value={String(draft.maxConcurrentExecutions)}
            type="number"
            min={1}
            onChange={(value) => setDraft({ ...draft, maxConcurrentExecutions: Number(value) })}
          />
        </>
      )}
      <EditorActions busy={busy} onCancel={onCancel} t={t} />
    </form>
  )
}

function TargetEditor({
  draft,
  labs,
  busy,
  openingOpenSshConfig,
  setDraft,
  onSave,
  onOpenSshConfig,
  onCancel,
  t
}: Readonly<{
  draft: TargetDraft
  labs: readonly RemoteSshLab[]
  busy: boolean
  openingOpenSshConfig: boolean
  setDraft: (draft: TargetDraft | null) => void
  onSave: () => void
  onOpenSshConfig: () => void
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
        descriptionAction={{
          label: t('remoteSshOpenConfig'),
          onClick: onOpenSshConfig,
          busy: openingOpenSshConfig
        }}
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
  description,
  descriptionAction
}: Readonly<{
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'number'
  required?: boolean
  min?: number
  description?: string
  descriptionAction?: Readonly<{
    label: string
    onClick: () => void
    busy?: boolean
  }>
}>): ReactElement {
  return (
    <div className="grid gap-1 text-[11px] font-medium text-ds-muted">
      <label className="grid gap-1">
        {label}
        <input
          type={type}
          value={value}
          required={required}
          min={min}
          onChange={(event) => onChange(event.target.value)}
          className={EDITOR_INPUT_CLASS}
        />
      </label>
      {description ? (
        <div className="flex items-start justify-between gap-2">
          <span className="font-normal leading-4 text-ds-faint">{description}</span>
          {descriptionAction ? (
            <button
              type="button"
              onClick={descriptionAction.onClick}
              disabled={descriptionAction.busy}
              className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 font-medium text-accent transition hover:bg-accent/10 disabled:opacity-50"
            >
              {descriptionAction.busy
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <ExternalLink className="h-3 w-3" />}
              {descriptionAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
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

export function remoteSshGeneratedGatewayAlias(
  machine: Pick<RemoteSshVirtualBoxMachine, 'name' | 'uuid'>
): string {
  const slug = machine.name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40) || 'vm'
  return `sciforge-${slug}-${machine.uuid.slice(0, 8)}`
}

function virtualBoxMachineOption(
  machine: RemoteSshVirtualBoxMachine,
  assigned: boolean,
  t: Translate
): string {
  const state = virtualBoxStateLabel(machine.state, t)
  return assigned
    ? `${machine.name} · ${state} · ${t('remoteSshVmAlreadyAssigned')}`
    : `${machine.name} · ${state}`
}

function virtualBoxStateLabel(state: string, t: Translate): string {
  switch (state.toLowerCase()) {
    case 'running': return t('remoteSshVmStateRunning')
    case 'poweroff': return t('remoteSshVmStateStopped')
    case 'saved': return t('remoteSshVmStateSaved')
    case 'paused': return t('remoteSshVmStatePaused')
    default: return state
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
  if (environment?.state === 'configuration-required' && environment.consoleAvailable) {
    return false
  }
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
  if (result.target.status === 'not-tested') {
    return { label: t('remoteSshStatusNotTested'), className: 'text-amber-600 dark:text-amber-400' }
  }
  if (result.target.status === 'not-configured') {
    return { label: t('remoteSshStatusNotConfigured'), className: 'text-amber-600 dark:text-amber-400' }
  }
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
