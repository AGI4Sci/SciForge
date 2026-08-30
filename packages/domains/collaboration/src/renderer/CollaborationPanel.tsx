import React, { type FormEvent, type ReactElement, type ReactNode } from 'react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Cloud,
  CloudOff,
  Link2,
  Loader2,
  Monitor,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Smartphone,
  Unlink,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type {
  CollaborationEndpointChallengeStartInput,
  CollaborationProjectionLinkInput,
  CollaborationProjectionQueueItemView,
  CollaborationProjectionView,
  CollaborationStatusSnapshot,
  CollaborationTaskView
} from '../contract.js'
import type { CollaborationRendererClient } from './collaboration-capability-client.js'

type ParticipantView = NonNullable<CollaborationStatusSnapshot['participant']>
type EndpointView = ParticipantView['endpoints'][number]
type ProjectionLocator = EndpointView['projectionLocators'][number]
type AgentView = ParticipantView['agents'][number]
type ProjectView = CollaborationStatusSnapshot['projects'][number]
type ManagedContainerView = CollaborationStatusSnapshot['managedContainers'][number]

export type CollaborationPanelSession = Readonly<{
  id: string
  title?: string
  runtimeId?: string
  workspaceRoot?: string
}>

export type CollaborationPanelProps = Readonly<{
  client: CollaborationRendererClient
  session: CollaborationPanelSession
  className?: string
  onCollapse?: () => void
  embedded?: boolean
  view?: 'all' | 'work' | 'settings'
}>

export function projectionLocatorKey(locator: ProjectionLocator): string {
  return JSON.stringify([
    locator.provider,
    locator.realmId,
    locator.containerId,
    locator.topicId
  ])
}

export function reconcileProjectionLocatorSelection(
  currentKey: string,
  locators: readonly ProjectionLocator[]
): string {
  if (currentKey && locators.some((item) => projectionLocatorKey(item) === currentKey)) {
    return currentKey
  }
  return locators.length === 1 ? projectionLocatorKey(locators[0]) : ''
}

export function resolveProjectionLocatorSelection(
  selectedKey: string,
  locators: readonly ProjectionLocator[]
): ProjectionLocator | undefined {
  if (!selectedKey) return undefined
  return locators.find((item) => projectionLocatorKey(item) === selectedKey)
}

export function projectionMatchesSession(
  projection: CollaborationProjectionView,
  session: CollaborationPanelSession
): boolean {
  return Boolean(
    session.runtimeId &&
    projection.runtimeId === session.runtimeId &&
    projection.threadId === session.id &&
    projection.status !== 'closed'
  )
}

export function projectionMatchesLocator(
  projection: CollaborationProjectionView,
  locator: ProjectionLocator
): boolean {
  return projection.status !== 'closed' && projectionLocatorIdentityMatches(projection, locator)
}

export function filterProjectionLocatorsForManagedContainer(
  locators: readonly ProjectionLocator[],
  _managedContainers: readonly ManagedContainerView[],
  humanEndpointId?: string
): ProjectionLocator[] {
  return humanEndpointId ? [...locators] : []
}

export function projectionTopicDisplayName(
  projection: CollaborationProjectionView
): string {
  const remoteTopic = projection.remoteLocator?.topicDisplayName?.trim()
  if (remoteTopic) return remoteTopic
  const remoteDisplay = projection.remoteDisplay?.trim()
  if (remoteDisplay) {
    const segments = remoteDisplay.split('/').map((segment) => segment.trim()).filter(Boolean)
    if (segments.length) return segments.at(-1)!
  }
  return projection.displayName
}

function projectionLocatorIdentityMatches(
  projection: CollaborationProjectionView,
  locator: ProjectionLocator
): boolean {
  const remote = projection.remoteLocator
  return Boolean(
    remote &&
    remote.provider === locator.provider &&
    remote.realmId === locator.realmId &&
    remote.containerId === locator.containerId &&
    remote.topicId === locator.topicId
  )
}

export function orderProjectionsForSession(
  projections: readonly CollaborationProjectionView[],
  session: CollaborationPanelSession
): CollaborationProjectionView[] {
  return [...projections].sort((left, right) => {
    const rank = (projection: CollaborationProjectionView): number => {
      if (projectionMatchesSession(projection, session)) return 0
      if (projection.status !== 'closed') return 1
      return 2
    }
    return rank(left) - rank(right)
  })
}

export function groupProjectionsForSession(
  projections: readonly CollaborationProjectionView[],
  session: CollaborationPanelSession
): Readonly<{
  current?: CollaborationProjectionView
  other: CollaborationProjectionView[]
  closed: CollaborationProjectionView[]
}> {
  const current = projections.find((projection) => projectionMatchesSession(projection, session))
  return {
    ...(current ? { current } : {}),
    other: projections.filter((projection) => (
      projection.status !== 'closed' && projection.projectionId !== current?.projectionId
    )),
    closed: projections.filter((projection) => projection.status === 'closed')
  }
}

export function buildProjectionLinkInput(input: Readonly<{
  mode: 'existing' | 'new'
  selectedLocatorKey: string
  locators: readonly ProjectionLocator[]
  agentId: string
  humanEndpointId: string
  runtimeId: string
  threadId: string
  workspaceRoot?: string
  displayName: string
}>): CollaborationProjectionLinkInput | undefined {
  const locator = resolveProjectionLocatorSelection(input.selectedLocatorKey, input.locators)
  if (!locator || (input.mode === 'existing' && !input.threadId)) return undefined
  const common = {
    agentId: input.agentId,
    humanEndpointId: input.humanEndpointId,
    locator,
    runtimeId: input.runtimeId,
    ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    displayName: input.displayName
  }
  return input.mode === 'existing'
    ? { mode: 'existing', ...common, threadId: input.threadId }
    : { mode: 'new', ...common }
}

export function buildEndpointChallengeInput(input: Readonly<{
  providerKey: string
  locator: Readonly<Record<string, string>>
}>): CollaborationEndpointChallengeStartInput | undefined {
  if (!input.providerKey.trim()) return undefined
  return {
    providerKey: input.providerKey,
    locator: Object.fromEntries(
      Object.entries(input.locator)
        .map(([key, value]) => [key, value.trim()] as const)
        .filter(([, value]) => value.length > 0)
    )
  }
}

type PairingDisplay = Readonly<{
  status: 'pending' | 'verified' | 'expired'
  pairingCode?: string
  expiresAt?: string
  instruction?: string
  userId?: string
  assurance?: 'low' | 'verified' | 'strong'
}>

type PairingCopyState = 'idle' | 'copied' | 'failed'

type ClipboardWriter = Readonly<{
  writeText: (value: string) => Promise<void>
}>

export async function writePairingCommandToClipboard(
  pairingCode: string,
  clipboard: ClipboardWriter | undefined = globalThis.navigator?.clipboard
): Promise<Exclude<PairingCopyState, 'idle'>> {
  if (!pairingCode.trim() || !clipboard) return 'failed'
  try {
    await clipboard.writeText(pairingCode)
    return 'copied'
  } catch {
    return 'failed'
  }
}

const MINIMUM_PAIRING_POLL_MILLISECONDS = 3_000
const PAIRING_ERROR_RETRY_MILLISECONDS = 4_000

export function nextPairingPollDelayMilliseconds(input: Readonly<{
  nowMilliseconds: number
  expiresAt: string
  retryAfterSeconds?: number
  fallbackMilliseconds?: number
}>): number | null {
  const expiresAtMilliseconds = Date.parse(input.expiresAt)
  const remainingMilliseconds = expiresAtMilliseconds - input.nowMilliseconds
  if (!Number.isFinite(expiresAtMilliseconds) || remainingMilliseconds <= 0) return null
  const requestedMilliseconds = input.retryAfterSeconds === undefined
    ? input.fallbackMilliseconds ?? MINIMUM_PAIRING_POLL_MILLISECONDS
    : input.retryAfterSeconds * 1_000
  return Math.min(
    Math.max(MINIMUM_PAIRING_POLL_MILLISECONDS, requestedMilliseconds),
    remainingMilliseconds
  )
}

const PANEL_SECTION = 'rounded-lg border border-ds-border bg-ds-card p-3'
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-ds-border bg-ds-card px-2.5 py-1.5 text-xs font-medium text-ds-ink transition-colors hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY_BUTTON =
  'inline-flex items-center justify-center gap-1.5 rounded-md bg-ds-ink px-2.5 py-1.5 text-xs font-medium text-ds-card transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40'
const INPUT =
  'w-full rounded-md border border-ds-border bg-ds-card px-2.5 py-2 text-xs text-ds-ink outline-none placeholder:text-ds-faint focus:border-ds-muted'

export function CollaborationPanel({
  client,
  session,
  className = '',
  onCollapse,
  embedded = false,
  view = 'all'
}: CollaborationPanelProps): ReactElement {
  const { t } = useTranslation('common')
  const [snapshot, setSnapshot] = useState<CollaborationStatusSnapshot | null>(null)
  const [tasks, setTasks] = useState<readonly CollaborationTaskView[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [selectedProviderKey, setSelectedProviderKey] = useState('')
  const [locator, setLocator] = useState<Record<string, string>>({})
  const [selectedProjectionLocatorKey, setSelectedProjectionLocatorKey] = useState('')
  const [pairing, setPairing] = useState<PairingDisplay | null>(null)
  // The stable poll handle is deliberately kept out of React state, rendered
  // diagnostics, and snapshots. Only the short-lived code intended for the
  // human is represented in PairingDisplay.
  const challengeHandleRef = useRef<string | null>(null)
  const challengeExpiresAtRef = useRef<string | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshTasks = useCallback(async (): Promise<void> => {
    const taskList = await client.listTasks()
    setTasks(taskList.tasks)
  }, [client])

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [next] = await Promise.all([
        client.readStatus(),
        refreshTasks()
      ])
      setSnapshot(next)
      setBaseUrl((current) => current || next.connection.baseUrl || '')
      setSelectedProviderKey((current) => current || next.providerOptions[0]?.providerKey || '')
      setActionError(null)
    } catch (error) {
      setActionError(errorMessage(error, t('collaborationUnavailable')))
    } finally {
      setLoading(false)
    }
  }, [client, refreshTasks, t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (view === 'settings') return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        await refreshTasks()
      } catch {
        // Initial refresh reports capability errors; background polling is best-effort.
      }
      if (active) timer = setTimeout(() => void poll(), 3_000)
    }
    timer = setTimeout(() => void poll(), 3_000)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [refreshTasks, view])

  useEffect(() => () => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    challengeHandleRef.current = null
    challengeExpiresAtRef.current = null
  }, [])

  const expirePairing = useCallback((): void => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    pollTimerRef.current = null
    challengeHandleRef.current = null
    challengeExpiresAtRef.current = null
    setPairing({ status: 'expired' })
  }, [])

  const runAction = useCallback(async (
    key: string,
    action: () => Promise<unknown>,
    options: Readonly<{ refresh?: boolean }> = { refresh: true }
  ): Promise<boolean> => {
    setBusyKey(key)
    setActionError(null)
    setActionSuccess(null)
    try {
      await action()
      if (options.refresh !== false) await refresh()
      setActionSuccess(t('collaborationActionSucceeded'))
      return true
    } catch (error) {
      if (options.refresh !== false) await refresh().catch(() => undefined)
      setActionError(errorMessage(error, t('collaborationActionFailed')))
      return false
    } finally {
      setBusyKey(null)
    }
  }, [refresh, t])

  const selectedProvider = useMemo(
    () => snapshot?.providerOptions.find(({ providerKey }) =>
      providerKey === selectedProviderKey
    ),
    [selectedProviderKey, snapshot]
  )

  const pollPairing = useCallback(async (): Promise<void> => {
    pollTimerRef.current = null
    const challengeId = challengeHandleRef.current
    const expiresAt = challengeExpiresAtRef.current
    if (!challengeId || !expiresAt) return
    if (nextPairingPollDelayMilliseconds({
      nowMilliseconds: Date.now(),
      expiresAt
    }) === null) {
      expirePairing()
      return
    }
    try {
      const result = await client.pollEndpointChallenge({ challengeId })
      if (challengeHandleRef.current !== challengeId) return
      if (result.status === 'pending') {
        challengeExpiresAtRef.current = result.expiresAt
        setPairing((current) => current
          ? { ...current, status: 'pending', expiresAt: result.expiresAt }
          : { status: 'pending', expiresAt: result.expiresAt })
        const delay = nextPairingPollDelayMilliseconds({
          nowMilliseconds: Date.now(),
          expiresAt: result.expiresAt,
          retryAfterSeconds: result.retryAfterSeconds
        })
        if (delay === null) expirePairing()
        else pollTimerRef.current = setTimeout(() => void pollPairing(), delay)
        return
      }
      if (result.status === 'expired') {
        expirePairing()
        return
      }
      challengeHandleRef.current = null
      challengeExpiresAtRef.current = null
      setPairing({
        status: 'verified',
        userId: result.userId,
        assurance: result.assurance
      })
      await refresh()
    } catch (error) {
      const retryExpiresAt = challengeExpiresAtRef.current
      const delay = retryExpiresAt
        ? nextPairingPollDelayMilliseconds({
            nowMilliseconds: Date.now(),
            expiresAt: retryExpiresAt,
            fallbackMilliseconds: PAIRING_ERROR_RETRY_MILLISECONDS
          })
        : null
      if (delay === null) {
        expirePairing()
        return
      }
      setActionError(errorMessage(error, t('collaborationActionFailed')))
      if (challengeHandleRef.current === challengeId) {
        pollTimerRef.current = setTimeout(() => void pollPairing(), delay)
      }
    }
  }, [client, expirePairing, refresh, t])

  const startPairing = useCallback(async (): Promise<void> => {
    if (!selectedProvider) return
    const normalizedLocator = Object.fromEntries(
      selectedProvider.locatorFields
        .map(({ key }) => [key, locator[key]?.trim() ?? ''] as const)
        .filter(([, value]) => value.length > 0)
    )
    const complete = selectedProvider.locatorFields.every((field) =>
      !field.required || Boolean(normalizedLocator[field.key])
    )
    if (!complete) return
    const input = buildEndpointChallengeInput({
      providerKey: selectedProvider.providerKey,
      locator: normalizedLocator
    })
    if (!input) return
    const succeeded = await runAction('pairing', async () => {
      const result = await client.startEndpointChallenge(input)
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
      challengeHandleRef.current = result.challengeId
      challengeExpiresAtRef.current = result.expiresAt
      setPairing({
        status: 'pending',
        pairingCode: result.pairingCode,
        expiresAt: result.expiresAt,
        instruction: result.instruction
      })
    }, { refresh: false })
    if (succeeded) {
      const expiresAt = challengeExpiresAtRef.current
      const delay = expiresAt
        ? nextPairingPollDelayMilliseconds({ nowMilliseconds: Date.now(), expiresAt })
        : null
      if (delay === null) expirePairing()
      else pollTimerRef.current = setTimeout(() => void pollPairing(), delay)
    }
  }, [client, expirePairing, locator, pollPairing, runAction, selectedProvider])

  const participant = snapshot?.participant
  const localAgent = participant?.agents.find(({ agentId }) =>
    agentId === snapshot?.connection.localAgentId
  )
  const primaryEndpoint = participant?.endpoints.find(({ humanEndpointId }) =>
    humanEndpointId === participant.primaryHumanEndpointId
  )
  const projectionLocators = useMemo(
    () => filterProjectionLocatorsForManagedContainer(
      primaryEndpoint?.projectionLocators ?? [],
      snapshot?.managedContainers ?? [],
      primaryEndpoint?.humanEndpointId
    ),
    [primaryEndpoint, snapshot?.managedContainers]
  )
  useEffect(() => {
    setSelectedProjectionLocatorKey((current) =>
      reconcileProjectionLocatorSelection(current, projectionLocators)
    )
  }, [projectionLocators])
  const selectedProjectionLocator = resolveProjectionLocatorSelection(
    selectedProjectionLocatorKey,
    projectionLocators
  )
  const groupedProjections = useMemo(
    () => groupProjectionsForSession(snapshot?.projections ?? [], session),
    [session, snapshot?.projections]
  )
  const currentSessionProjection = groupedProjections.current
  const selectedLocatorProjection = selectedProjectionLocator
    ? snapshot?.projections.find((projection) =>
        projectionMatchesLocator(projection, selectedProjectionLocator)
      )
    : undefined
  const canLink = Boolean(
    participant?.userId &&
    localAgent &&
    primaryEndpoint &&
    selectedProjectionLocator &&
    session.runtimeId &&
    !currentSessionProjection &&
    !selectedLocatorProjection
  )

  const linkSession = useCallback(async (mode: 'existing' | 'new'): Promise<void> => {
    if (
      !participant ||
      !localAgent ||
      !primaryEndpoint ||
      !session.runtimeId
    ) return
    const input = buildProjectionLinkInput({
      mode,
      selectedLocatorKey: selectedProjectionLocatorKey,
      locators: projectionLocators,
      agentId: localAgent.agentId,
      humanEndpointId: primaryEndpoint.humanEndpointId,
      runtimeId: session.runtimeId,
      threadId: session.id,
      ...(session.workspaceRoot ? { workspaceRoot: session.workspaceRoot } : {}),
      displayName: session.title?.trim() || session.id
    })
    if (!input) return
    await runAction(`projection-${mode}`, () => client.linkProjection(input))
  }, [
    client,
    participant,
    localAgent,
    primaryEndpoint,
    projectionLocators,
    runAction,
    selectedProjectionLocatorKey,
    session
  ])

  const showWork = view !== 'settings'
  const showSettings = view !== 'work'
  const phoneLinkSetupComplete = Boolean(
    snapshot?.connection.configured &&
    primaryEndpoint?.status === 'active' &&
    localAgent &&
    snapshot.connection.agentAuthorityReady !== false
  )

  if (loading && !snapshot) {
    return (
      <div
        className={`flex h-full items-center justify-center text-xs text-ds-muted ${className}`}
        data-collaboration-view={view}
      >
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('collaborationLoading')}
      </div>
    )
  }

  return (
    <div
      className={`flex h-full min-h-0 flex-col bg-ds-card text-ds-ink ${className}`}
      data-collaboration-panel="true"
      data-collaboration-embedded={embedded ? 'true' : 'false'}
      data-collaboration-view={view}
    >
      {!embedded ? <header className="flex items-center gap-2 border-b border-ds-border px-3 py-2.5">
        <Users className="h-4 w-4" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {t('collaborationTitle')}
        </h2>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          onClick={() => void refresh()}
          disabled={loading || busyKey !== null}
          aria-label={t('collaborationRefresh')}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
        {onCollapse ? (
          <button
            type="button"
            className={SECONDARY_BUTTON}
            onClick={onCollapse}
            aria-label={t('collaborationCollapse')}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </header> : null}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {actionError ? (
          <ExplicitError message={actionError} />
        ) : null}
        {actionSuccess ? (
          <p className="rounded-md border border-ds-border bg-ds-hover p-2 text-xs text-ds-ink"
            role="status" aria-live="polite">
            {actionSuccess}
          </p>
        ) : null}

        {snapshot ? (
          <>
            {showSettings ? (
              <>
            <PhoneLinkSetup setupComplete={phoneLinkSetupComplete}>
            <CloudConnectionSection
              connection={snapshot.connection}
              baseUrl={baseUrl}
              busyKey={busyKey}
              onBaseUrlChange={setBaseUrl}
              onConfigure={(event) => {
                event.preventDefault()
                void runAction('connection-configure', () =>
                  client.configureConnection({ baseUrl: baseUrl.trim() })
                )
              }}
              onConnectionAction={(action) => {
                void runAction(`connection-${action}`, () =>
                  client.changeConnection({ action })
                )
              }}
            />

            <ParticipantSection
              participant={participant}
              providerOptions={snapshot.providerOptions}
              selectedProviderKey={selectedProviderKey}
              locator={locator}
              localAgentId={snapshot.connection.localAgentId}
              agentAuthorityReady={snapshot.connection.agentAuthorityReady}
              pairing={pairing}
              busyKey={busyKey}
              onProviderChange={(providerKey) => {
                setSelectedProviderKey(providerKey)
                setLocator({})
                challengeHandleRef.current = null
                setPairing(null)
              }}
              onLocatorChange={(key, value) => {
                setLocator((current) => ({ ...current, [key]: value }))
              }}
              onStartPairing={() => void startPairing()}
              onWorkerAcceptanceModeChange={(agentId, mode) => {
                void runAction(`worker-policy-${agentId}`, () =>
                  client.updateWorkerAcceptancePolicy({ agentId, mode })
                )
              }}
            />
            </PhoneLinkSetup>

            <ManagedChannelSection
              snapshot={snapshot}
              busy={busyKey !== null}
              onEnsure={(humanEndpointId) => void runAction(
                `managed-channel-ensure-${humanEndpointId}`,
                () => client.manageContainer({ action: 'ensure', humanEndpointId })
              )}
              onRefreshStatus={() => void runAction(
                'managed-channel-refresh-status',
                () => client.manageContainer({ action: 'refresh-status' })
              )}
              onRefreshTopics={(humanEndpointId) => void runAction(
                `managed-channel-refresh-topics-${humanEndpointId}`,
                () => client.manageContainer({ action: 'refresh-locators', humanEndpointId })
              )}
              onReconcile={(managedContainerId, expectedRevision) => void runAction(
                `managed-channel-reconcile-${managedContainerId}`,
                () => client.manageContainer({ action: 'reconcile', managedContainerId, expectedRevision })
              )}
              onArchive={(managedContainerId, expectedRevision) => void runAction(
                `managed-channel-archive-${managedContainerId}`,
                () => client.manageContainer({ action: 'archive', managedContainerId, expectedRevision })
              )}
            />

            <section className={PANEL_SECTION} data-collaboration-section="projections">
              <SectionTitle icon={<Link2 className="h-4 w-4" />}>
                {t('collaborationPersonalSessions')}
              </SectionTitle>
              <p className="mb-3 text-xs text-ds-muted">
                {t('collaborationNoProjectRequired')}
              </p>
              {!currentSessionProjection && primaryEndpoint ? (
                <div className="mb-3 rounded-md border border-ds-border bg-ds-hover p-2.5 text-xs">
                  <p className="font-medium">{t('collaborationCreatePrivateChannelInZulipWeb')}</p>
                  <p className="mt-1 text-ds-muted">{t('collaborationReturnAndDiscoverTopics')}</p>
                  <button
                    type="button"
                    className={`${SECONDARY_BUTTON} mt-2`}
                    disabled={busyKey !== null}
                    onClick={() => void runAction(
                      `private-channel-discover-${primaryEndpoint.humanEndpointId}`,
                      () => client.discoverPrivateChannels({
                        humanEndpointId: primaryEndpoint.humanEndpointId
                      })
                    )}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t('collaborationRefreshTopics')}
                  </button>
                </div>
              ) : null}
              <CurrentSessionBindingSummary
                session={session}
                projection={currentSessionProjection}
                busy={busyKey !== null}
                onPause={currentSessionProjection ? () => void runAction(
                  `projection-pause-${currentSessionProjection.projectionId}`,
                  () => client.updateProjection({
                    action: 'pause',
                    projectionId: currentSessionProjection.projectionId,
                    expectedRevision: currentSessionProjection.revision
                  })
                ) : undefined}
                onResume={currentSessionProjection ? () => void runAction(
                  `projection-resume-${currentSessionProjection.projectionId}`,
                  () => client.updateProjection({
                    action: 'resume',
                    projectionId: currentSessionProjection.projectionId,
                    expectedRevision: currentSessionProjection.revision
                  })
                ) : undefined}
                onRetry={currentSessionProjection ? () => void runAction(
                  `projection-retry-${currentSessionProjection.projectionId}`,
                  () => client.retrySynchronization({
                    scope: 'projection',
                    id: currentSessionProjection.projectionId
                  })
                ) : undefined}
              />
              {!currentSessionProjection ? <>
                <ProjectionLocatorSelector
                  locators={projectionLocators}
                  projections={snapshot.projections}
                  session={session}
                  selectedKey={selectedProjectionLocatorKey}
                  busy={busyKey !== null}
                  onSelect={setSelectedProjectionLocatorKey}
                />
                {selectedLocatorProjection ? (
                  <div className="mb-3 rounded bg-ds-hover p-2 text-xs text-ds-muted" role="alert">
                    <p>{t('collaborationTopicAlreadyBound', {
                      name: selectedLocatorProjection.displayName
                    })}</p>
                  </div>
                ) : null}
                <p className="mb-3 text-xs text-ds-muted">
                  {t('collaborationExistingHistoryNotice')}
                </p>
                <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={PRIMARY_BUTTON}
                  disabled={!canLink || busyKey !== null}
                  onClick={() => void linkSession('existing')}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {t('collaborationShareCurrent')}
                </button>
                </div>
              </> : null}
              {groupedProjections.other.length ? (
                <ProjectionGroup
                  kind="other"
                  label={t('collaborationOtherSessionMappings', {
                    count: groupedProjections.other.length
                  })}
                >
                  {groupedProjections.other.map((projection) => (
                    <ProjectionCard
                      key={projection.projectionId}
                      projection={projection}
                      busy={busyKey !== null}
                      onUpdate={(input) => void runAction(
                        `projection-${input.action}-${projection.projectionId}`,
                        () => client.updateProjection(input)
                      )}
                      onRetry={() => void runAction(
                        `projection-retry-${projection.projectionId}`,
                        () => client.retrySynchronization({
                          scope: 'projection',
                          id: projection.projectionId
                        })
                      )}
                    />
                  ))}
                </ProjectionGroup>
              ) : null}
              {groupedProjections.closed.length ? (
                <ProjectionGroup
                  kind="closed"
                  label={t('collaborationClosedSessionMappings', {
                    count: groupedProjections.closed.length
                  })}
                >
                  {groupedProjections.closed.map((projection) => (
                    <ProjectionCard
                      key={projection.projectionId}
                      projection={projection}
                      busy={busyKey !== null}
                      onUpdate={(input) => void runAction(
                        `projection-${input.action}-${projection.projectionId}`,
                        () => client.updateProjection(input)
                      )}
                      onRetry={() => void runAction(
                        `projection-retry-${projection.projectionId}`,
                        () => client.retrySynchronization({
                          scope: 'projection',
                          id: projection.projectionId
                        })
                      )}
                    />
                  ))}
                </ProjectionGroup>
              ) : null}
              {!snapshot.projections.length ? (
                <EmptyState>{t('collaborationNoProjections')}</EmptyState>
              ) : null}
            </section>
              </>
            ) : null}

            {showWork ? (
              <>
                <ProjectsSection
                  projects={snapshot.projects}
                  tasks={tasks}
                  participant={participant}
                  busy={busyKey !== null}
                  onTaskOfferDecision={(taskOfferId, decision) => {
                    void runAction(`task-offer-${decision}-${taskOfferId}`, () =>
                      client.decideTaskOffer(
                        { taskOfferId, decision }
                      )
                    )
                  }}
                />

                <RecoverySection
                  queue={snapshot.queue}
                  diagnostics={snapshot.diagnostics}
                  busy={busyKey !== null}
                  onRetry={(scope, id) => void runAction(
                    `retry-${scope}-${id ?? ''}`,
                    () => client.retrySynchronization({ scope, ...(id ? { id } : {}) })
                  )}
                />
              </>
            ) : null}
          </>
        ) : (
          <ExplicitError message={t('collaborationUnavailable')} />
        )}
      </div>
    </div>
  )
}

export function ManagedChannelSection({
  snapshot,
  busy,
  onEnsure,
  onRefreshStatus,
  onRefreshTopics,
  onReconcile,
  onArchive
}: Readonly<{
  snapshot: CollaborationStatusSnapshot
  busy: boolean
  onEnsure: (humanEndpointId: string) => void
  onRefreshStatus: () => void
  onRefreshTopics: (humanEndpointId: string) => void
  onReconcile: (managedContainerId: string, expectedRevision: number) => void
  onArchive: (managedContainerId: string, expectedRevision: number) => void
}>): ReactElement | null {
  const { t } = useTranslation('common')
  const [archiveConfirmationId, setArchiveConfirmationId] = useState<string | null>(null)
  const eligibleEndpoints = snapshot.participant?.endpoints.filter((endpoint) => (
    endpoint.status === 'active' && snapshot.providerOptions.some((provider) => (
      provider.providerKey === endpoint.providerKey && provider.managedContainers
    ))
  )) ?? []
  if (eligibleEndpoints.length === 0 && snapshot.managedContainers.length === 0) return null
  return (
    <section className={PANEL_SECTION} data-collaboration-section="managed-channels">
      <SectionTitle icon={<ShieldCheck className="h-4 w-4" />}>
        {t('collaborationManagedChannel')}
      </SectionTitle>
      <p className="mb-3 text-xs text-ds-muted">{t('collaborationManagedChannelTrust')}</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {eligibleEndpoints.filter((endpoint) => !snapshot.managedContainers.some((container) => (
          container.humanEndpointId === endpoint.humanEndpointId
        ))).map((endpoint) => (
          <button key={endpoint.humanEndpointId} type="button" className={PRIMARY_BUTTON}
            disabled={busy} onClick={() => onEnsure(endpoint.humanEndpointId)}>
            <Plus className="h-3.5 w-3.5" />{t('collaborationManagedChannelCreate')}
          </button>
        ))}
        <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={onRefreshStatus}>
          <RefreshCw className="h-3.5 w-3.5" />{t('collaborationManagedChannelCheck')}
        </button>
      </div>
      <div className="space-y-2">
        {snapshot.managedContainers.map((container) => {
          const checks = container.checks
          const endpoint = snapshot.participant?.endpoints.find((candidate) => (
            candidate.humanEndpointId === container.humanEndpointId
          ))
          const provider = snapshot.providerOptions.find((candidate) => (
            candidate.providerKey === endpoint?.providerKey
          ))
          const mutable = container.status === 'active' || container.status === 'drifted'
          const checkMark = (value: boolean | undefined): string => value === undefined ? '?' : value ? '✓' : '✕'
          return (
            <div key={container.managedContainerId} className="rounded-md border border-ds-border p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{container.displayName}</span>
                <span className="text-ds-muted">{container.status}</span>
              </div>
              <p className="mt-1 text-ds-muted">
                {provider?.label ?? endpoint?.providerKey ?? container.container?.provider ?? '—'} ·{' '}
                {endpoint?.displayName ?? t('collaborationPhoneEndpoint')} ·{' '}
                {provider?.containerLabel ?? 'Channel'}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-ds-muted">
                <dt>{t('collaborationManagedChannelPrivacy')}</dt><dd>{checkMark(checks?.private)}</dd>
                <dt>{t('collaborationManagedChannelHistory')}</dt><dd>{checkMark(checks?.protectedHistory)}</dd>
                <dt>{t('collaborationManagedChannelMembers')}</dt><dd>{checkMark(checks?.exactMembership)}</dd>
                <dt>{t('collaborationManagedChannelSend')}</dt><dd>{checkMark(checks == null ? undefined : checks.ownerCanSend && checks.messageBotCanSend)}</dd>
                <dt>{t('collaborationManagedChannelTopics')}</dt><dd>{checkMark(checks?.ownerCanCreateTopics)}</dd>
                <dt>{t('collaborationManagedChannelMemberManagement')}</dt><dd>{checkMark(checks?.memberManagementRestricted)}</dd>
                <dt>{t('collaborationManagedChannelAdministration')}</dt><dd>{checkMark(checks?.channelManagementRestricted)}</dd>
                <dt>{t('collaborationManagedChannelSession')}</dt>
                <dd>{snapshot.projections.filter((projection) => (
                  projection.humanEndpointId === container.humanEndpointId &&
                  projection.remoteLocator?.provider === container.container?.provider &&
                  projection.remoteLocator?.realmId === container.container?.realmId &&
                  projection.remoteLocator?.containerId === container.container?.containerId
                )).length}</dd>
                <dt>{t('collaborationManagedChannelVerified')}</dt>
                <dd>{container.lastVerifiedAt ? new Date(container.lastVerifiedAt).toLocaleString() : '—'}</dd>
              </dl>
              {container.safeErrorCode ? <p className="mt-2 text-ds-danger">{container.safeErrorCode}</p> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {container.status === 'failed' && !container.container ? (
                  <button type="button" className={PRIMARY_BUTTON} disabled={busy}
                    onClick={() => onEnsure(container.humanEndpointId)}>
                    <RotateCcw className="h-3.5 w-3.5" />{t('collaborationManagedChannelRetry')}
                  </button>
                ) : null}
                <button type="button" className={SECONDARY_BUTTON} disabled={busy || container.status !== 'active'}
                  onClick={() => onRefreshTopics(container.humanEndpointId)}>
                  <RefreshCw className="h-3.5 w-3.5" />{t('collaborationManagedChannelRefreshTopics')}
                </button>
                {container.container && (container.status === 'drifted' || container.status === 'failed') ? (
                  <button type="button" className={SECONDARY_BUTTON} disabled={busy}
                    onClick={() => onReconcile(container.managedContainerId, container.revision)}>
                    <RotateCcw className="h-3.5 w-3.5" />{t('collaborationManagedChannelRepair')}
                  </button>
                ) : null}
                {container.container && mutable ? (
                  <button type="button" className={SECONDARY_BUTTON} disabled={busy}
                    onClick={() => setArchiveConfirmationId(container.managedContainerId)}>
                    <Unlink className="h-3.5 w-3.5" />{t('collaborationManagedChannelArchive')}
                  </button>
                ) : null}
              </div>
              {archiveConfirmationId === container.managedContainerId ? (
                <InlineConfirmationEditor
                  message={t('collaborationManagedChannelArchiveConfirm')}
                  busy={busy}
                  onConfirm={() => {
                    onArchive(container.managedContainerId, container.revision)
                    setArchiveConfirmationId(null)
                  }}
                  onCancel={() => setArchiveConfirmationId(null)}
                />
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function ProjectionLocatorSelector({
  locators,
  projections,
  session,
  selectedKey,
  busy,
  onSelect
}: Readonly<{
  locators: readonly ProjectionLocator[]
  projections: readonly CollaborationProjectionView[]
  session: CollaborationPanelSession
  selectedKey: string
  busy: boolean
  onSelect: (key: string) => void
}>): ReactElement {
  const { t } = useTranslation('common')
  const requiresExplicitSelection = locators.length !== 1
  return (
    <label className="mb-3 block text-xs text-ds-muted">
      <span className="mb-1 block">{t('collaborationProjectionDestination')}</span>
      <select
        className={INPUT}
        data-projection-locator-selector="true"
        value={selectedKey}
        disabled={busy || locators.length === 0}
        onChange={(event) => onSelect(event.currentTarget.value)}
      >
        {requiresExplicitSelection ? (
          <option value="">
            {locators.length === 0
              ? t('collaborationNoProjectionDestinations')
              : t('collaborationSelectProjectionDestination')}
          </option>
        ) : null}
        {locators.map((item) => {
          const key = projectionLocatorKey(item)
          const container = item.containerDisplayName || t('collaborationPrivateChannelFallback')
          const topic = item.topicDisplayName || t('collaborationTopicFallback')
          const binding = projections.find((projection) => projectionMatchesLocator(projection, item))
          const closed = projections.find((projection) => (
            projection.status === 'closed' && projectionLocatorIdentityMatches(projection, item)
          ))
          const suffix = binding
            ? projectionMatchesSession(binding, session)
              ? t('collaborationBoundToCurrentSession')
              : t('collaborationBoundToSession', { name: binding.displayName })
            : closed
              ? t('collaborationClosedTopic')
              : t('collaborationUnboundTopic')
          return (
            <option key={key} value={key}>
              {container} / {topic} — {suffix}
            </option>
          )
        })}
      </select>
    </label>
  )
}

export function CurrentSessionBindingSummary({
  session,
  projection,
  busy = false,
  onPause,
  onResume,
  onRetry
}: Readonly<{
  session: CollaborationPanelSession
  projection?: CollaborationProjectionView
  busy?: boolean
  onPause?: () => void
  onResume?: () => void
  onRetry?: () => void
}>): ReactElement {
  const { t } = useTranslation('common')
  const sessionName = session.title?.trim() || t('collaborationUnnamedSession')
  return (
    <div className="mb-3 rounded-md border border-ds-border bg-ds-hover p-2.5 text-xs"
      data-current-session-binding={projection ? 'bound' : 'unbound'}>
      <div className="flex items-center gap-2 font-semibold">
        <Monitor className="h-3.5 w-3.5" />
        {t('collaborationCurrentDesktopSession')}: {sessionName}
      </div>
      <div className="mt-1 flex items-center gap-2 font-semibold">
        <Smartphone className="h-3.5 w-3.5" />
        {t('collaborationPhoneLocation')}: {projection?.remoteDisplay || t('collaborationChooseTopicToBind')}
      </div>
      <div className="mt-1 flex items-center gap-2 text-ds-muted">
        <span>{t('collaborationMappingStatus')}:</span>
        {projection ? <StatusPill status={projection.status} /> : <span>—</span>}
      </div>
      {projection ? (
        <>
          <p className="mt-2 rounded bg-ds-card p-2 text-ds-muted">
            {t('collaborationPersonalControlOnly')}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {projection.status === 'paused' ? (
              <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={onResume}>
                <Play className="h-3.5 w-3.5" />
                {t('collaborationResume')}
              </button>
            ) : (
              <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={onPause}>
                <Pause className="h-3.5 w-3.5" />
                {t('collaborationPause')}
              </button>
            )}
            {(projection.status === 'error' || projection.lastError) ? (
              <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={onRetry}>
                <RotateCcw className="h-3.5 w-3.5" />
                {t('collaborationRetry')}
              </button>
            ) : null}
          </div>
          <ProjectionTechnicalDetails projection={projection} />
        </>
      ) : null}
    </div>
  )
}

export function ProjectionGroup({
  kind,
  label,
  children
}: Readonly<{
  kind: 'other' | 'closed'
  label: ReactNode
  children: ReactNode
}>): ReactElement {
  return (
    <details className="mt-2 rounded-md border border-ds-border"
      data-projection-group={kind}>
      <summary className="cursor-pointer px-2.5 py-2 text-xs font-semibold">
        {label}
      </summary>
      <div className="space-y-2 border-t border-ds-border p-2">
        {children}
      </div>
    </details>
  )
}

export function PhoneLinkSetup({
  setupComplete,
  children
}: Readonly<{
  setupComplete: boolean
  children: ReactNode
}>): ReactElement {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(!setupComplete)
  const contentId = useId()
  useEffect(() => {
    if (!setupComplete) setExpanded(true)
    else setExpanded(false)
  }, [setupComplete])
  return (
    <section className="min-w-0" data-phone-link-setup={setupComplete ? 'complete' : 'incomplete'}>
      <button
        type="button"
        className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-semibold text-ds-ink hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-muted"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((current) => !current)}
      >
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`} />
        <span className="truncate">{t('collaborationPhoneLinkSetup')}</span>
        {setupComplete ? <StatusPill status="connected" /> : null}
      </button>
      {expanded ? <div id={contentId} className="min-w-0 space-y-3 pt-3">{children}</div> : null}
    </section>
  )
}

type CloudConnectionSectionProps = Readonly<{
  connection: CollaborationStatusSnapshot['connection']
  baseUrl: string
  busyKey: string | null
  onBaseUrlChange: (value: string) => void
  onConfigure: (event: FormEvent<HTMLFormElement>) => void
  onConnectionAction: (action: 'connect' | 'disconnect' | 'recover') => void
}>

export function CloudConnectionSection({
  connection,
  baseUrl,
  busyKey,
  onBaseUrlChange,
  onConfigure,
  onConnectionAction
}: CloudConnectionSectionProps): ReactElement {
  const { t } = useTranslation('common')
  const connected = connection.state === 'connected'
  return (
    <section className={PANEL_SECTION} data-collaboration-section="connection">
      <SectionTitle icon={connected
        ? <Cloud className="h-4 w-4" />
        : <CloudOff className="h-4 w-4" />}
      >
        {t('collaborationCloud')}
        <StatusPill status={connection.state} />
      </SectionTitle>
      <form className="space-y-2" onSubmit={onConfigure}>
        <label className="block text-xs text-ds-muted">
          <span className="mb-1 block">{t('collaborationCloudAddress')}</span>
          <input
            className={INPUT}
            type="url"
            required
            value={baseUrl}
            placeholder={t('collaborationCloudAddressPlaceholder')}
            onChange={(event) => onBaseUrlChange(event.currentTarget.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className={PRIMARY_BUTTON}
            disabled={!baseUrl.trim() || busyKey !== null}
          >
            {t('collaborationConfigure')}
          </button>
          {connected ? (
            <button
              type="button"
              className={SECONDARY_BUTTON}
              disabled={busyKey !== null}
              onClick={() => onConnectionAction('disconnect')}
            >
              <Unlink className="h-3.5 w-3.5" />
              {t('collaborationDisconnect')}
            </button>
          ) : (
            <button
              type="button"
              className={SECONDARY_BUTTON}
              disabled={!connection.configured || busyKey !== null}
              onClick={() => onConnectionAction('connect')}
            >
              <Play className="h-3.5 w-3.5" />
              {t('collaborationConnect')}
            </button>
          )}
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={!connection.configured || busyKey !== null}
            onClick={() => onConnectionAction('recover')}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('collaborationReconnect')}
          </button>
        </div>
      </form>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-ds-muted">
        <span>Inbox #{connection.lastInboxSequence}</span>
        <span>Outbox {connection.pendingOutboxCount}</span>
      </div>
      {connection.lastError ? <ExplicitError message={connection.lastError} compact /> : null}
    </section>
  )
}

type ParticipantSectionProps = Readonly<{
  participant?: ParticipantView
  providerOptions: CollaborationStatusSnapshot['providerOptions']
  selectedProviderKey: string
  locator: Readonly<Record<string, string>>
  localAgentId?: string
  agentAuthorityReady?: boolean
  pairing: PairingDisplay | null
  busyKey: string | null
  onProviderChange: (providerKey: string) => void
  onLocatorChange: (key: string, value: string) => void
  onStartPairing: () => void
  onWorkerAcceptanceModeChange: (
    agentId: string,
    mode: 'manual' | 'automatic'
  ) => void
}>

export function ParticipantSection({
  participant,
  providerOptions,
  selectedProviderKey,
  locator,
  localAgentId,
  agentAuthorityReady,
  pairing,
  busyKey,
  onProviderChange,
  onLocatorChange,
  onStartPairing,
  onWorkerAcceptanceModeChange
}: ParticipantSectionProps): ReactElement {
  const { t } = useTranslation('common')
  const selectedProvider = providerOptions.find(({ providerKey }) =>
    providerKey === selectedProviderKey
  )
  const missingRequiredLocator = selectedProvider?.locatorFields.some((field) =>
    field.required && !locator[field.key]?.trim()
  ) ?? true
  const localAgent = participant?.agents.find((agent) => agent.agentId === localAgentId)
  const otherAgents = participant?.agents.filter((agent) => agent.agentId !== localAgentId) ?? []

  return (
    <section className={PANEL_SECTION} data-collaboration-section="participant">
      <SectionTitle icon={<Users className="h-4 w-4" />}>
        {t('collaborationParticipants')}
        {participant ? <StatusPill status={participant.complete ? participant.status : 'incomplete'} /> : null}
      </SectionTitle>

      {participant ? (
        <div className="mb-3">
          <div className="font-medium">{participant.displayName}</div>
        </div>
      ) : null}

      <div className="grid gap-3">
        <div className="rounded-md border border-ds-border p-2.5">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
            <Smartphone className="h-4 w-4" />
            {t('collaborationEndpoint')}
          </div>
          {participant?.endpoints.length ? (
            <div className="space-y-2">
              {participant.endpoints.map((endpoint) => (
                <EndpointRow
                  key={endpoint.humanEndpointId}
                  endpoint={endpoint}
                  primary={endpoint.humanEndpointId === participant.primaryHumanEndpointId}
                />
              ))}
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs text-ds-muted">
                {t('collaborationEndpointMissing')}
              </p>
              <div className="space-y-2">
                <label className="block text-xs text-ds-muted">
                  <span className="mb-1 block">{t('collaborationProvider')}</span>
                  <select
                    className={INPUT}
                    value={selectedProviderKey}
                    onChange={(event) => onProviderChange(event.currentTarget.value)}
                  >
                    <option value="" disabled>—</option>
                    {providerOptions.map((provider) => (
                      <option key={provider.providerKey} value={provider.providerKey}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedProvider?.locatorFields.map((field) => (
                  <label key={field.key} className="block text-xs text-ds-muted">
                    <span className="mb-1 block">{field.label}</span>
                    <input
                      className={INPUT}
                      required={field.required}
                      value={locator[field.key] ?? ''}
                      placeholder={field.placeholder}
                      onChange={(event) => onLocatorChange(field.key, event.currentTarget.value)}
                    />
                  </label>
                ))}
                <button
                  type="button"
                  className={PRIMARY_BUTTON}
                  disabled={
                    missingRequiredLocator ||
                    busyKey !== null ||
                    pairing?.status === 'pending'
                  }
                  onClick={onStartPairing}
                >
                  {busyKey === 'pairing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Smartphone className="h-3.5 w-3.5" />}
                  {t('collaborationStartPairing')}
                </button>
              </div>
              {pairing ? <PairingStatus pairing={pairing} /> : null}
            </>
          )}
        </div>

        <div className="rounded-md border border-ds-border p-2.5">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
            <Monitor className="h-4 w-4" />
            {t('collaborationAgent')}
          </div>
          <div className="space-y-2">
            {localAgent ? (
              <>
                <p className="text-xs text-ds-muted">
                  {t('collaborationAgentAutomatic')}
                </p>
                <AgentRow
                  agent={localAgent}
                  busy={busyKey !== null}
                  currentDevice
                  onWorkerAcceptanceModeChange={(mode) =>
                    onWorkerAcceptanceModeChange(localAgent.agentId, mode)}
                />
              </>
            ) : (
              <span className="text-xs text-ds-muted" data-collaboration-agent-preparing="true">
                {agentAuthorityReady === false
                  ? t('collaborationAgentUnavailable')
                  : t('collaborationAgentPreparing')}
              </span>
            )}
            {otherAgents.length ? (
              <div className="space-y-2 border-t border-ds-border pt-2">
                <p className="text-xs font-medium text-ds-muted">
                  {t('collaborationOtherDeviceAgents')}
                </p>
                {otherAgents.map((agent) => (
                  <AgentRow
                    key={agent.agentId}
                    agent={agent}
                    busy={busyKey !== null}
                    currentDevice={false}
                    onWorkerAcceptanceModeChange={(mode) =>
                      onWorkerAcceptanceModeChange(agent.agentId, mode)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

function EndpointRow({ endpoint, primary }: Readonly<{
  endpoint: EndpointView
  primary: boolean
}>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div
      className="rounded-md bg-ds-hover p-2 text-xs"
      data-endpoint-status={endpoint.status}
      data-endpoint-assurance={endpoint.assurance}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">
          {endpoint.displayName || t('collaborationPhoneEndpoint')}
        </span>
        {primary ? <StatusPill status="primary" /> : null}
        <StatusPill status={endpoint.status} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-ds-muted">
        <span>{t('collaborationProvider')}: {endpoint.providerKey}</span>
        <span>{t('collaborationAssurance')}: {endpoint.assurance}</span>
        {endpoint.verifiedAt ? (
          <span>{t('collaborationVerifiedAt')}: {formatDate(endpoint.verifiedAt)}</span>
        ) : null}
      </div>
    </div>
  )
}

function AgentRow({
  agent,
  busy,
  currentDevice,
  onWorkerAcceptanceModeChange
}: Readonly<{
  agent: AgentView
  busy: boolean
  currentDevice: boolean
  onWorkerAcceptanceModeChange: (mode: 'manual' | 'automatic') => void
}>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div
      className="rounded-md bg-ds-hover p-2 text-xs"
      data-agent-status={agent.status}
      data-agent-owner={agent.ownerUserId}
      data-current-device-agent={currentDevice ? 'true' : 'false'}
    >
      <div className="flex items-center gap-2">
        {agent.nodeType === 'server'
          ? <Server className="h-3.5 w-3.5" />
          : <Monitor className="h-3.5 w-3.5" />}
        <span className="min-w-0 flex-1 truncate font-medium">{agent.displayName}</span>
        {currentDevice ? (
          <span className="rounded-full border border-ds-border px-2 py-0.5 text-[10px] text-ds-muted">
            {t('collaborationCurrentDevice')}
          </span>
        ) : null}
        <StatusPill status={agent.status} />
      </div>
      {agent.workerAcceptanceMode ? (
        <label className="mt-2 block text-ds-muted">
          <span className="mb-1 block">{t('collaborationWorkerAcceptancePolicy')}</span>
          <select
            className={INPUT}
            data-worker-acceptance-agent-id={agent.agentId}
            value={agent.workerAcceptanceMode}
            disabled={busy || agent.status === 'revoked'}
            onChange={(event) => onWorkerAcceptanceModeChange(
              event.currentTarget.value as 'manual' | 'automatic'
            )}
          >
            <option value="manual">{t('collaborationWorkerAcceptanceManual')}</option>
            <option value="automatic">{t('collaborationWorkerAcceptanceAutomatic')}</option>
          </select>
        </label>
      ) : null}
    </div>
  )
}

export function PairingStatus({ pairing }: Readonly<{ pairing: PairingDisplay }>): ReactElement {
  const { t } = useTranslation('common')
  const [copyState, setCopyState] = useState<PairingCopyState>('idle')
  useEffect(() => setCopyState('idle'), [pairing.pairingCode])
  if (pairing.status === 'verified') {
    return (
      <div className="mt-3 rounded-md border border-ds-border bg-ds-hover p-2 text-xs">
        <div className="flex items-center gap-1.5 font-medium">
          <CheckCircle2 className="h-4 w-4" />
          {t('collaborationPairingComplete')}
        </div>
        <span className="text-ds-muted">{t('collaborationAssurance')}: {pairing.assurance}</span>
      </div>
    )
  }
  if (pairing.status === 'expired') {
    return <ExplicitError message={t('collaborationPairingExpired')} compact />
  }
  return (
    <div className="mt-3 rounded-md border border-ds-border bg-ds-hover p-2 text-xs">
      <div className="text-ds-muted">{t('collaborationPairingCode')}</div>
      {pairing.pairingCode ? (
        <div className="my-1 select-all font-mono text-lg font-semibold tracking-widest">
          {pairing.pairingCode}
        </div>
      ) : null}
      {pairing.instruction ? <p>{pairing.instruction}</p> : null}
      {pairing.pairingCode ? (
        <div className="mt-2">
          <p className="mb-2 text-ds-muted">{t('collaborationPairingCopyHint')}</p>
          <button
            type="button"
            className={PRIMARY_BUTTON}
            data-collaboration-copy-pairing="true"
            onClick={() => {
              void writePairingCommandToClipboard(pairing.pairingCode ?? '')
                .then(setCopyState)
            }}
          >
            {t('collaborationCopyPairingInstruction')}
          </button>
          <PairingCopyFeedback state={copyState} />
        </div>
      ) : null}
      {pairing.expiresAt ? (
        <p className="mt-1 text-ds-muted">
          {t('collaborationPairingExpires')}: {formatDate(pairing.expiresAt)}
        </p>
      ) : null}
      <p className="mt-1 flex items-center gap-1 text-ds-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('collaborationPairingWaiting')}
      </p>
    </div>
  )
}

export function PairingCopyFeedback({ state }: Readonly<{
  state: PairingCopyState
}>): ReactElement | null {
  const { t } = useTranslation('common')
  if (state === 'idle') return null
  if (state === 'failed') {
    return (
      <p className="mt-2 text-xs text-ds-muted" role="alert">
        {t('collaborationPairingCopyFailed')}
      </p>
    )
  }
  return (
    <p className="mt-2 text-xs text-ds-muted" role="status" aria-live="polite">
      {t('collaborationPairingCopied')}
    </p>
  )
}

type ProjectionCardProps = Readonly<{
  projection: CollaborationProjectionView
  currentSessionOccupied?: boolean
  currentSession?: CollaborationPanelSession
  busy: boolean
  onUpdate: (input:
    | Readonly<{ action: 'rename'; projectionId: string; displayName: string; expectedRevision: number }>
    | Readonly<{ action: 'pause' | 'resume'; projectionId: string; expectedRevision: number }>
  ) => void
  onRetry: () => void
}>

function ProjectionTechnicalDetails({ projection }: Readonly<{
  projection: CollaborationProjectionView
}>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <details className="mt-2 text-ds-faint">
      <summary className="cursor-pointer">{t('collaborationTechnicalDetails')}</summary>
      <dl className="mt-1 grid gap-1">
        <div>
          <dt>{t('collaborationSync')}:</dt>
          <dd>{projection.lastSynchronizedAt ? formatDate(projection.lastSynchronizedAt) : '—'}</dd>
        </div>
        <div>
          <dt>{t('collaborationQueued')}:</dt>
          <dd>{projection.queueDepth}</dd>
        </div>
      </dl>
    </details>
  )
}

export function ProjectionCard({
  projection,
  busy,
  onUpdate,
  onRetry
}: ProjectionCardProps): ReactElement {
  const { t } = useTranslation('common')
  const updateBase = {
    projectionId: projection.projectionId,
    expectedRevision: projection.revision
  } as const
  return (
    <article
      className="rounded-md border border-ds-border p-2.5 text-xs"
      data-projection-id={projection.projectionId}
      data-projection-status={projection.status}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{projectionTopicDisplayName(projection)}</div>
          <div className="mt-0.5 text-[10px] font-medium text-ds-muted">
            {t('collaborationDesktopSession')}: {projection.displayName}
          </div>
        </div>
        <StatusPill status={projection.status} />
      </div>
      <p className="mt-2 rounded bg-ds-hover p-2 text-ds-muted">
        {t('collaborationPersonalControlOnly')}
      </p>
      {projection.lastError ? <ExplicitError message={projection.lastError} compact /> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {projection.status === 'paused' ? (
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={busy}
            onClick={() => onUpdate({ action: 'resume', ...updateBase })}
          >
            <Play className="h-3.5 w-3.5" />
            {t('collaborationResume')}
          </button>
        ) : projection.status !== 'closed' ? (
          <button
            type="button"
            className={SECONDARY_BUTTON}
            title={t('collaborationPauseHint')}
            disabled={busy || projection.status === 'linking'}
            onClick={() => onUpdate({ action: 'pause', ...updateBase })}
          >
            <Pause className="h-3.5 w-3.5" />
            {t('collaborationPause')}
          </button>
        ) : null}
        {(projection.status === 'error' || projection.lastError) ? (
          <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={onRetry}>
            <RotateCcw className="h-3.5 w-3.5" />
            {t('collaborationRetry')}
          </button>
        ) : null}
      </div>
      <ProjectionTechnicalDetails projection={projection} />
    </article>
  )
}

export function InlineTextActionEditor({
  label,
  value,
  allowEmpty = false,
  busy,
  submitLabel,
  onChange,
  onSubmit,
  onCancel
}: Readonly<{
  label: string
  value: string
  allowEmpty?: boolean
  busy: boolean
  submitLabel: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <form
      className="mt-2 space-y-2 rounded-md bg-ds-hover p-2"
      data-collaboration-inline-editor="text"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <label className="block text-xs text-ds-muted">
        <span className="mb-1 block">{label}</span>
        <input
          className={INPUT}
          value={value}
          required={!allowEmpty}
          disabled={busy}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          className={PRIMARY_BUTTON}
          disabled={busy || (!allowEmpty && !value.trim())}
        >
          {submitLabel}
        </button>
        <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={onCancel}>
          {t('collaborationCancel')}
        </button>
      </div>
    </form>
  )
}

export function InlineConfirmationEditor({
  message,
  busy,
  onConfirm,
  onCancel
}: Readonly<{
  message: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div
      className="mt-2 rounded-md bg-ds-hover p-2"
      data-collaboration-inline-editor="confirmation"
      role="group"
      aria-label={message}
    >
      <p className="mb-2 text-xs">{message}</p>
      <div className="flex gap-2">
        <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={onConfirm}>
          {t('collaborationConfirm')}
        </button>
        <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={onCancel}>
          {t('collaborationCancel')}
        </button>
      </div>
    </div>
  )
}

export function ProjectsSection({
  projects,
  tasks,
  participant,
  busy,
  onTaskOfferDecision
}: Readonly<{
  projects: readonly ProjectView[]
  tasks: readonly CollaborationTaskView[]
  participant?: ParticipantView
  busy: boolean
  onTaskOfferDecision: (taskOfferId: string, decision: 'accept' | 'reject' | 'dismiss') => void
}>): ReactElement {
  const { t } = useTranslation('common')
  const projectIds = new Set(projects.map((project) => project.projectId))
  const tasksWithoutProject = tasks.filter((task) => !projectIds.has(task.projectId))
  return (
    <section className={PANEL_SECTION} data-collaboration-section="projects">
      <SectionTitle icon={<Server className="h-4 w-4" />}>
        {t('collaborationProjects')}
      </SectionTitle>
      {tasksWithoutProject.length ? (
        <div className="mb-2 space-y-1.5" data-collaboration-unmatched-tasks="true">
          {tasksWithoutProject.map((task) => (
            <TaskRow
              key={task.taskOfferId}
              task={task}
              participant={participant}
              busy={busy}
              onOfferDecision={onTaskOfferDecision}
            />
          ))}
        </div>
      ) : null}
      {projects.length ? (
        <div className="space-y-2">
          {projects.map((project) => (
            <article
              key={project.projectId}
              className="rounded-md border border-ds-border p-2.5 text-xs"
              data-project-id={project.projectId}
              data-project-status={project.state}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{project.name}</div>
                </div>
                <StatusPill status={project.state} />
              </div>
              <dl className="my-2 grid gap-1 text-ds-muted">
                <div className="flex gap-1">
                  <dt>{t('collaborationCoordinator')}:</dt>
                  <dd className="text-ds-ink">
                    {participant?.agents.find(({ agentId }) =>
                      agentId === project.coordinatorAgentId
                    )?.displayName || t('collaborationUnknownAgent')}
                  </dd>
                </div>
                <div>Cloud revision {project.revision}</div>
              </dl>
              {tasks.some((task) => task.projectId === project.projectId) ? (
                <div className="space-y-1.5">
                  {tasks.filter((task) => task.projectId === project.projectId).map((task) => (
                    <TaskRow
                      key={task.taskOfferId}
                      task={task}
                      participant={participant}
                      busy={busy}
                      onOfferDecision={onTaskOfferDecision}
                    />
                  ))}
                </div>
              ) : <EmptyState>{t('collaborationNoTasks')}</EmptyState>}
            </article>
          ))}
        </div>
      ) : null}
      {!projects.length && !tasksWithoutProject.length
        ? <EmptyState>{t('collaborationNoProjects')}</EmptyState>
        : null}
    </section>
  )
}

function TaskRow({ task, participant, busy, onOfferDecision }: Readonly<{
  task: CollaborationTaskView
  participant?: ParticipantView
  busy: boolean
  onOfferDecision: (taskOfferId: string, decision: 'accept' | 'reject' | 'dismiss') => void
}>): ReactElement {
  const { t } = useTranslation('common')
  const agent = participant?.agents.find(({ agentId }) => agentId === task.assigneeAgentId)
  const workerUser = participant?.userId === task.workerUserId ? participant.displayName : task.workerUserId
  return (
    <div
      className="rounded bg-ds-hover p-2"
      data-task-id={task.taskId}
      data-task-status={task.state}
    >
      <div className="flex items-center gap-2">
        <CircleDot className="h-3.5 w-3.5" />
        <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
        <StatusPill status={task.state} />
      </div>
      <div className="mt-1 text-ds-muted">
        {t('collaborationAssignee')}: {agent?.displayName || workerUser} · Revision {task.revision}
      </div>
      <div className="mt-1 text-ds-muted">
        {t('collaborationWorkerAcceptancePolicy')}: {task.acceptanceMode === 'manual'
          ? t('collaborationWorkerAcceptanceManual')
          : t('collaborationWorkerAcceptanceAutomatic')}
      </div>
      {task.preflightReasons.length ? (
        <div className="mt-1 text-ds-muted" data-task-preflight-reasons="true">
          {t('collaborationTaskPreflightBlocked')}: {task.preflightReasons.join(', ')}
        </div>
      ) : null}
      {task.decisionRequired ? (
        <div className="mt-2 flex gap-2" data-task-offer-decision="true">
          <button
            type="button"
            className={PRIMARY_BUTTON}
            disabled={busy}
            onClick={() => onOfferDecision(task.taskOfferId, 'accept')}
          >
            {t('collaborationTaskAccept')}
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={busy}
            onClick={() => onOfferDecision(task.taskOfferId, 'reject')}
          >
            {t('collaborationTaskReject')}
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={busy}
            onClick={() => onOfferDecision(task.taskOfferId, 'dismiss')}
          >
            {t('collaborationTaskDismiss')}
          </button>
        </div>
      ) : null}
      {task.error ? <ExplicitError message={task.error} compact /> : null}
    </div>
  )
}

export function RecoverySection({ queue, diagnostics, busy, onRetry }: Readonly<{
  queue: readonly CollaborationProjectionQueueItemView[]
  diagnostics: CollaborationStatusSnapshot['diagnostics']
  busy: boolean
  onRetry: (scope: 'connection' | 'inbox' | 'outbox' | 'projection' | 'task', id?: string) => void
}>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <section className={PANEL_SECTION} data-collaboration-section="recovery">
      <SectionTitle icon={<RotateCcw className="h-4 w-4" />}>
        {t('collaborationRecovery')}
      </SectionTitle>
      <div className="mb-2 flex flex-wrap gap-1.5">
        <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={() => onRetry('inbox')}>
          Inbox {t('collaborationRecover')}
        </button>
        <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={() => onRetry('outbox')}>
          Outbox {t('collaborationRecover')}
        </button>
      </div>
      {queue.length ? (
        <ol className="space-y-1.5">
          {queue.slice(0, 50).map((item) => (
            <li
              key={item.queueItemId}
              className="rounded bg-ds-hover p-2 text-xs"
              data-queue-sequence={item.sequence}
              data-queue-state={item.state}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px]">#{item.sequence}</span>
                <span className="min-w-0 flex-1 truncate">{item.kind} · {item.origin}</span>
                <StatusPill status={item.state} />
              </div>
              <div className="mt-1 text-ds-muted">
                {t('collaborationAttempts')}: {item.attempts} · {formatDate(item.updatedAt)}
              </div>
              {item.error ? <ExplicitError message={item.error} compact /> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {diagnostics.length ? (
        <div className="mt-2 space-y-1.5">
          {diagnostics.map((diagnostic, index) => (
            <div
              key={`${diagnostic.code}-${diagnostic.occurredAt}-${index}`}
              className="rounded border border-ds-border p-2 text-xs"
              data-diagnostic-code={diagnostic.code}
              data-diagnostic-severity={diagnostic.severity}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{diagnostic.message}</div>
                  <div className="text-ds-muted">{diagnostic.code} · {formatDate(diagnostic.occurredAt)}</div>
                </div>
              </div>
              {diagnostic.recoverable ? (
                <button
                  type="button"
                  className={`${SECONDARY_BUTTON} mt-2`}
                  disabled={busy}
                  onClick={() => onRetry('connection')}
                >
                  {t('collaborationRecover')}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

export function ExplicitError({ message, compact = false }: Readonly<{
  message: string
  compact?: boolean
}>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div
      className={`${compact ? 'mt-2 p-2' : 'p-3'} flex items-start gap-2 rounded-md border border-ds-border bg-ds-hover text-xs`}
      role="alert"
      data-collaboration-error="true"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="font-semibold">{t('collaborationError')}</div>
        <div className="break-words text-ds-muted">{message}</div>
      </div>
    </div>
  )
}

function SectionTitle({ icon, children }: Readonly<{
  icon: ReactElement
  children: ReactNode
}>): ReactElement {
  return (
    <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold">
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
    </h3>
  )
}

function StatusPill({ status }: Readonly<{ status: string }>): ReactElement {
  const { t } = useTranslation('common')
  const labels: Readonly<Record<string, string>> = {
    active: t('collaborationStatusActive'),
    paused: t('collaborationStatusPaused'),
    closed: t('collaborationStatusClosed'),
    linking: t('collaborationStatusLinking'),
    error: t('collaborationStatusError'),
    connected: t('collaborationStatusConnected'),
    connecting: t('collaborationStatusConnecting'),
    completed: t('collaborationStatusCompleted'),
    failed: t('collaborationStatusFailed'),
    online: t('collaborationStatusOnline'),
    offline: t('collaborationStatusOffline'),
    running: t('collaborationStatusRunning')
  }
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ds-border bg-ds-card px-1.5 py-0.5 text-[10px] font-medium text-ds-muted"
      data-status={status}
    >
      {status === 'online' || status === 'connected' || status === 'active' || status === 'completed'
        ? <CheckCircle2 className="h-3 w-3" />
        : status === 'connecting' || status === 'recovering' || status === 'linking' || status === 'running'
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : status === 'error' || status === 'failed'
            ? <AlertTriangle className="h-3 w-3" />
            : <CircleDot className="h-3 w-3" />}
      {labels[status] || status}
    </span>
  )
}

function EmptyState({ children }: Readonly<{ children: string }>): ReactElement {
  return <div className="rounded-md bg-ds-hover p-3 text-xs text-ds-muted">{children}</div>
}

function formatDate(value: string): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(time))
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
