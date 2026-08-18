import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  BookOpenCheck,
  Boxes,
  ChevronRight,
  CircleDashed,
  Database,
  ExternalLink,
  FileCode2,
  Fingerprint,
  FlaskConical,
  GitCompareArrows,
  History,
  Import,
  Loader2,
  PanelRightClose,
  RefreshCw,
  RotateCcw,
  Scale,
  ShieldCheck,
  Square
} from 'lucide-react'
import * as React from 'react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { useTranslation } from 'react-i18next'

import type {
  ArtifactVersionCompareV1,
  ArtifactVersionListV2,
  ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import type {
  ResearchCheckpointLegacyPreviewV1,
  ResearchCheckpointRecordV1,
  ResearchCheckpointStatusV1,
  ResearchRecordingStatusV1
} from '@sciforge/domain-research-checkpoints/contract'
import {
  createResearchDossierActivation,
  moveResearchDossierActivationToPage,
  researchDossierActivationPayloadV1Schema,
  type ResearchDossierActivationPayloadV1,
  type ResearchDossierPage
} from '../contract.js'
import type {
  DomainRendererWorkspacePreviewHost,
  DomainRendererWorkbenchHost,
  DomainWorkbenchRightPanelActivation,
  DomainWorkbenchRightPanelSession
} from '@sciforge/domain-sdk/host'

import type { ResearchDossierCapabilityClient } from './research-dossier-capability-client.js'
import {
  loadExactResearchDossier,
  loadResearchDossierBrowse,
  type ResearchDossierBrowseV1,
  type ResearchDossierVisualReviewSummaryV1
} from './research-dossier-loader.js'
import {
  artifactHistoryInput,
  artifactMetadataRows,
  bundleV2Destination,
  bundleV2IdempotencyKey,
  computeRunRefs,
  dossierBreakpoints,
  exactRecordDigest,
  fiveAxisStatus,
  isResearchSourceUri,
  mergeArtifactHistory,
  previewDestination,
  previewIdempotencyKey,
  previewableRef,
  researchDossierPreviewTarget,
  type ResearchDossierExactRecord
} from './research-dossier-model.js'

/**
 * Presentation-only shape for older activation payloads. The current upstream
 * Evidence owner does not expose an exact dossier-summary capability, so new
 * loads never fabricate this projection.
 */
type LegacyEvidenceDossierSummary = Readonly<{
  target?: unknown
  provenanceLevel: string
  provenanceComplete: boolean
  freshness: string
  matchedNodeCount?: number
  staleNodeCount?: number
  breakpointCount: number
  pending: Readonly<{ state: string }> | null
  humanReview: Readonly<{
    level: string
    status: string
    gateStatus: string
    blocking: boolean
    pendingCount?: number
    blockingCount?: number
    reviewPacketId?: string | null
  }> | null
  snapshot: Readonly<{
    digest: string
    [key: string]: unknown
  }>
}>

type LoadState =
  | Readonly<{ status: 'idle' | 'loading' }>
  | Readonly<{ status: 'error'; code: string; message: string }>
  | Readonly<{ status: 'browse'; value: ResearchDossierBrowseV1 }>
  | Readonly<{
      status: 'ready'
      record: ResearchDossierExactRecord
      evidence: LegacyEvidenceDossierSummary | null
      review: ResearchDossierVisualReviewSummaryV1 | null
      issues: Readonly<Partial<Record<'versions' | 'checkpoint' | 'reproduction' | 'evidence' | 'review', string>>>
    }>

export type ResearchRecordingLoadState =
  | Readonly<{ status: 'idle' | 'loading' }>
  | Readonly<{ status: 'unavailable'; message: string }>
  | Readonly<{
      status: 'ready'
      recordingMode: ResearchCheckpointStatusV1['recordingMode']
      automaticEnabled: boolean
      policyRevision: number
      recording: ResearchRecordingStatusV1 | null
    }>

type ResearchRecordingAction = 'start' | 'stop'

type ResearchRecordingActionNotice = Readonly<{
  tone: 'error' | 'success'
  message: string
}>

type ResearchRecordingScope = Readonly<{
  generation: number
  client: ResearchDossierCapabilityClient
  activationKind: 'empty' | 'invalid' | 'valid'
  workspaceRoot: string
  runtimeId: string
  threadId: string
}>

type ScopedResearchRecordingState = Readonly<{
  scopeGeneration: number
  value: ResearchRecordingLoadState
}>

type ScopedResearchRecordingAction = Readonly<{
  scopeGeneration: number
  value: ResearchRecordingAction
}>

type ScopedResearchRecordingActionNotice = Readonly<{
  scopeGeneration: number
  value: ResearchRecordingActionNotice
}>

export type LegacyImportLoadState =
  | Readonly<{ status: 'closed' }>
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; preview: ResearchCheckpointLegacyPreviewV1 }>
  | Readonly<{ status: 'error'; message: string }>

export type ResearchDossierPanelProps = Readonly<{
  client: ResearchDossierCapabilityClient
  session: DomainWorkbenchRightPanelSession
  activation?: DomainWorkbenchRightPanelActivation
  active: boolean
  className?: string
  onCollapse: () => void
  surfaceId: string
  workbench?: DomainRendererWorkbenchHost
  workspacePreview?: DomainRendererWorkspacePreviewHost
}>

export function ResearchDossierPanel({
  client,
  session,
  activation,
  active,
  className = '',
  onCollapse,
  surfaceId,
  workbench,
  workspacePreview
}: ResearchDossierPanelProps): ReactElement {
  const { t } = useTranslation('common')
  const parsedActivation = useMemo(
    () => parseDossierActivation(activation),
    [activation]
  )
  const [state, setState] = useState<LoadState>({ status: 'idle' })
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewIssue, setPreviewIssue] = useState<string | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [versionBusy, setVersionBusy] = useState<string | null>(null)
  const [versionNotice, setVersionNotice] = useState<string | null>(null)
  const [comparison, setComparison] = useState<ArtifactVersionCompareV1 | null>(null)
  const [scopedRecordingState, setScopedRecordingState] = useState<ScopedResearchRecordingState>({
    scopeGeneration: 0,
    value: { status: 'idle' }
  })
  const [scopedRecordingAction, setScopedRecordingAction] = useState<ScopedResearchRecordingAction | null>(null)
  const [scopedRecordingNotice, setScopedRecordingNotice] = useState<ScopedResearchRecordingActionNotice | null>(null)
  const [legacyImportState, setLegacyImportState] = useState<LegacyImportLoadState>({ status: 'closed' })
  const [legacySelectedTurnIds, setLegacySelectedTurnIds] = useState<readonly string[]>([])
  const [legacyTitle, setLegacyTitle] = useState('')
  const [legacyBusy, setLegacyBusy] = useState(false)
  const [legacyNotice, setLegacyNotice] = useState<string | null>(null)
  const loadGeneration = useRef(0)
  const recordingLoadGeneration = useRef(0)
  const recordingActionGeneration = useRef(0)
  const recordingScopeRef = useRef<ResearchRecordingScope | null>(null)

  const nextRecordingScope = {
    client,
    activationKind: parsedActivation.kind,
    workspaceRoot: session.workspaceRoot?.trim() ?? '',
    runtimeId: session.runtimeId?.trim() ?? '',
    threadId: session.id.trim()
  } as const
  const recordingScope: ResearchRecordingScope = sameResearchRecordingScope(
    recordingScopeRef.current,
    nextRecordingScope
  )
    ? recordingScopeRef.current!
    : Object.freeze({
      ...nextRecordingScope,
      generation: (recordingScopeRef.current?.generation ?? 0) + 1
    })
  recordingScopeRef.current = recordingScope
  const recordingState = scopedRecordingState.scopeGeneration === recordingScope.generation
    ? scopedRecordingState.value
    : { status: 'loading' as const }
  const recordingAction = scopedRecordingAction?.scopeGeneration === recordingScope.generation
    ? scopedRecordingAction.value
    : null
  const recordingNotice = scopedRecordingNotice?.scopeGeneration === recordingScope.generation
    ? scopedRecordingNotice.value
    : null

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    const commit = (next: LoadState) => {
      if (generation === loadGeneration.current) setState(next)
    }
    const workspaceRoot = session.workspaceRoot?.trim()
    if (!workspaceRoot || parsedActivation.kind === 'invalid') {
      commit({ status: 'idle' })
      return
    }
    commit({ status: 'loading' })
    if (generation === loadGeneration.current) {
      setPreviewIssue(null)
      setVersionNotice(null)
      setComparison(null)
    }
    try {
      if (parsedActivation.kind === 'empty') {
        commit({
          status: 'browse',
          value: await loadResearchDossierBrowse(client, workspaceRoot)
        })
        return
      }
      const result = await loadExactResearchDossier(
        client,
        workspaceRoot,
        parsedActivation.value
      )
      if (!result.ok) {
        commit({
          status: 'error',
          code: result.issue.code,
          message: result.issue.code === 'digest-mismatch'
            ? t('researchDossierDigestMismatch')
            : result.issue.message
        })
        return
      }
      commit({
        status: 'ready',
        record: result.value.record,
        evidence: result.value.evidence,
        review: result.value.review,
        issues: result.value.issues
      })
    } catch (error) {
      commit({ status: 'error', code: 'owner-unavailable', message: errorMessage(error) })
    }
  }, [client, parsedActivation, session.workspaceRoot, t])

  useEffect(() => {
    void load()
  }, [load])

  const loadRecording = useCallback(async (showLoading = true) => {
    const scope = recordingScope
    const requestGeneration = ++recordingLoadGeneration.current
    const isCurrentRequest = () => (
      recordingScopeRef.current?.generation === scope.generation &&
      recordingLoadGeneration.current === requestGeneration
    )
    const commitState = (value: ResearchRecordingLoadState) => {
      if (isCurrentRequest()) {
        setScopedRecordingState({ scopeGeneration: scope.generation, value })
      }
    }
    const clearNotice = () => {
      if (isCurrentRequest()) setScopedRecordingNotice(null)
    }
    if (scope.activationKind !== 'empty') {
      commitState({ status: 'idle' })
      if (showLoading) clearNotice()
      return
    }
    const { workspaceRoot, runtimeId, threadId } = scope
    if (!workspaceRoot || !runtimeId || !threadId) {
      commitState({
        status: 'unavailable',
        message: t('researchDossierRecordingScopeUnavailable')
      })
      return
    }
    if (showLoading) {
      commitState({ status: 'loading' })
      clearNotice()
    }
    try {
      const result = await scope.client.readResearchRecordingStatus(workspaceRoot, {
        runtimeId,
        threadId
      })
      commitState(result.ok
        ? {
            status: 'ready',
            recordingMode: result.value.recordingMode,
            automaticEnabled: result.value.automaticEnabled,
            policyRevision: result.value.policyRevision,
            recording: result.value.recording
          }
        : { status: 'unavailable', message: result.issue.message })
    } catch (error) {
      commitState({ status: 'unavailable', message: errorMessage(error) })
    }
  }, [recordingScope, t])

  useEffect(() => {
    void loadRecording()
  }, [loadRecording])

  const startAutomaticRecording = async () => {
    const scope = recordingScope
    const { workspaceRoot, runtimeId, threadId } = scope
    if (
      !workspaceRoot || !runtimeId || !threadId || recordingAction ||
      recordingState.status !== 'ready' || recordingState.automaticEnabled
    ) return
    const actionGeneration = ++recordingActionGeneration.current
    const isCurrentAction = () => (
      recordingScopeRef.current?.generation === scope.generation &&
      recordingActionGeneration.current === actionGeneration
    )
    setScopedRecordingAction({ scopeGeneration: scope.generation, value: 'start' })
    setScopedRecordingNotice(null)
    try {
      const result = await scope.client.startResearchRecording(workspaceRoot, {
        runtimeId,
        threadId,
        expectedPolicyRevision: recordingState.policyRevision,
        idempotencyKey: `research-dossier:start:${randomToken()}`
      })
      if (!isCurrentAction()) return
      if (!result.ok) {
        setScopedRecordingNotice({
          scopeGeneration: scope.generation,
          value: { tone: 'error', message: result.issue.message }
        })
        await loadRecording(false)
        return
      }
      setScopedRecordingNotice({
        scopeGeneration: scope.generation,
        value: { tone: 'success', message: t('researchDossierRecordingStarted') }
      })
      await loadRecording(false)
    } catch (error) {
      if (isCurrentAction()) {
        setScopedRecordingNotice({
          scopeGeneration: scope.generation,
          value: { tone: 'error', message: errorMessage(error) }
        })
      }
    } finally {
      if (isCurrentAction()) setScopedRecordingAction(null)
    }
  }

  const stopAutomaticRecording = async () => {
    const scope = recordingScope
    const { workspaceRoot, runtimeId, threadId } = scope
    if (
      !workspaceRoot || !runtimeId || !threadId || recordingAction ||
      recordingState.status !== 'ready' || !recordingState.automaticEnabled
    ) return
    const recording = recordingState.recording
    const actionGeneration = ++recordingActionGeneration.current
    const isCurrentAction = () => (
      recordingScopeRef.current?.generation === scope.generation &&
      recordingActionGeneration.current === actionGeneration
    )
    setScopedRecordingAction({ scopeGeneration: scope.generation, value: 'stop' })
    setScopedRecordingNotice(null)
    try {
      const result = await scope.client.stopResearchRecording(workspaceRoot, {
        runtimeId,
        threadId,
        expectedPolicyRevision: recordingState.policyRevision,
        idempotencyKey: `research-dossier:stop:${randomToken()}`,
        ...(recording ? { recordingId: recording.recordingId } : {})
      })
      if (!isCurrentAction()) return
      if (!result.ok) {
        setScopedRecordingNotice({
          scopeGeneration: scope.generation,
          value: { tone: 'error', message: result.issue.message }
        })
        await loadRecording(false)
        return
      }
      setScopedRecordingNotice({
        scopeGeneration: scope.generation,
        value: { tone: 'success', message: t('researchDossierRecordingStopped') }
      })
      await loadRecording(false)
    } catch (error) {
      if (isCurrentAction()) {
        setScopedRecordingNotice({
          scopeGeneration: scope.generation,
          value: { tone: 'error', message: errorMessage(error) }
        })
      }
    } finally {
      if (isCurrentAction()) setScopedRecordingAction(null)
    }
  }

  const openLegacyImport = async () => {
    const workspaceRoot = session.workspaceRoot?.trim()
    const runtimeId = session.runtimeId?.trim()
    const threadId = session.id.trim()
    if (!workspaceRoot || !runtimeId || !threadId || legacyBusy) return
    setLegacyImportState({ status: 'loading' })
    setLegacySelectedTurnIds([])
    setLegacyTitle('')
    setLegacyNotice(null)
    try {
      const result = await client.previewLegacyResearchTurns(workspaceRoot, { runtimeId, threadId })
      setLegacyImportState(result.ok
        ? { status: 'ready', preview: result.value }
        : { status: 'error', message: result.issue.message })
    } catch (error) {
      setLegacyImportState({ status: 'error', message: errorMessage(error) })
    }
  }

  const toggleLegacyTurn = (turnId: string) => {
    setLegacySelectedTurnIds((current) => current.includes(turnId)
      ? current.filter((candidate) => candidate !== turnId)
      : [...current, turnId])
    setLegacyNotice(null)
  }

  const importLegacyTurns = async () => {
    const workspaceRoot = session.workspaceRoot?.trim()
    const runtimeId = session.runtimeId?.trim()
    const threadId = session.id.trim()
    if (!workspaceRoot || !runtimeId || !threadId || legacyBusy || !legacySelectedTurnIds.length) {
      setLegacyNotice(t('researchDossierLegacySelectionRequired'))
      return
    }
    setLegacyBusy(true)
    setLegacyNotice(null)
    try {
      const digestResult = await client.previewLegacyResearchTurns(workspaceRoot, {
        runtimeId,
        threadId,
        selectedTurnIds: [...legacySelectedTurnIds]
      })
      if (!digestResult.ok) {
        setLegacyNotice(digestResult.issue.message)
        return
      }
      const expectedTranscriptDigest = digestResult.value.selectedTranscriptDigest
      if (!expectedTranscriptDigest) {
        setLegacyNotice(t('researchDossierLegacyDigestMissing'))
        return
      }
      const result = await client.importLegacyResearchTurns(workspaceRoot, {
        runtimeId,
        threadId,
        idempotencyKey: `research-dossier:legacy:${expectedTranscriptDigest}:${randomToken()}`,
        title: legacyTitle.trim() || `Legacy research ${new Date().toLocaleDateString()}`,
        expectedTranscriptDigest,
        selectedTurnIds: [...legacySelectedTurnIds]
      })
      if (!result.ok) {
        setLegacyNotice(result.issue.message)
        return
      }
      setLegacyNotice(t('researchDossierLegacyImported'))
      openArtifact(result.value.artifactRef)
    } catch (error) {
      setLegacyNotice(errorMessage(error))
    } finally {
      setLegacyBusy(false)
    }
  }

  const navigate = (page: ResearchDossierPage) => {
    if (!workbench || parsedActivation.kind !== 'valid') return
    workbench.openRightPanel({
      contributionId: 'research-dossier.workbench-right-panel',
      sessionId: session.id,
      surfaceId,
      activation: moveResearchDossierActivationToPage(
        parsedActivation.value,
        page,
        (activation?.revision ?? 0) + 1
      )
    })
  }

  const openArtifact = (ref: ArtifactVersionRefV1, page: ResearchDossierPage = 'overview') => {
    if (!workbench) return
    workbench.openRightPanel({
      contributionId: 'research-dossier.workbench-right-panel',
      sessionId: session.id,
      surfaceId,
      activation: createResearchDossierActivation({
        kind: 'artifact-version',
        versionId: ref.versionId
      }, {
        page,
        expectedDigest: `sha256:${ref.contentDigest}`,
        revision: (activation?.revision ?? 0) + 1
      })
    })
  }

  const preview = async () => {
    if (
      state.status !== 'ready' ||
      !session.workspaceRoot ||
      !workspacePreview ||
      parsedActivation.kind !== 'valid'
    ) return
    const ref = previewableRef(state.record)
    if (!ref) return
    setPreviewBusy(true)
    setPreviewIssue(null)
    try {
      const result = await client.materializeArtifactVersion(session.workspaceRoot, {
        idempotencyKey: previewIdempotencyKey(ref),
        versionId: ref.versionId,
        destinationPath: previewDestination(ref)
      })
      if (!result.ok) {
        setPreviewIssue(result.issue.message)
        return
      }
      workspacePreview.open(researchDossierPreviewTarget({
        destinationPath: result.value.destinationPath,
        previewRef: ref,
        recordDigest: exactRecordDigest(state.record),
        sessionId: session.id,
        surfaceId,
        workspaceRoot: session.workspaceRoot,
        target: parsedActivation.value.target,
        page: parsedActivation.value.page,
        revision: activation?.revision ?? 1,
        label: t('researchDossierTitle')
      }))
    } catch (error) {
      setPreviewIssue(errorMessage(error))
    } finally {
      setPreviewBusy(false)
    }
  }

  const loadMoreHistory = async () => {
    if (
      state.status !== 'ready' ||
      state.record.kind !== 'artifact-version' ||
      !state.record.history.nextBeforeSequence ||
      !session.workspaceRoot
    ) return
    setHistoryBusy(true)
    try {
      const next = await client.listArtifactVersions(
        session.workspaceRoot,
        artifactHistoryInput(
          state.record.descriptor.artifact.artifactId,
          state.record.history.nextBeforeSequence
        )
      )
      if (!next.ok) {
        setState({ ...state, issues: { ...state.issues, versions: next.issue.message } })
        return
      }
      setState({
        ...state,
        record: {
          ...state.record,
          history: mergeArtifactHistory(state.record.history, next.value)
        },
        issues: { ...state.issues, versions: undefined }
      })
    } catch (error) {
      setState({ ...state, issues: { ...state.issues, versions: errorMessage(error) } })
    } finally {
      setHistoryBusy(false)
    }
  }

  const compareSelectedVersion = async () => {
    if (state.status !== 'ready' || state.record.kind !== 'artifact-version' || !session.workspaceRoot) return
    const descriptor = state.record.descriptor
    const targetVersionId = descriptor.isCurrent
      ? descriptor.version.parentVersionId
      : descriptor.artifact.currentVersionId
    if (!targetVersionId) return
    setVersionBusy('compare')
    setVersionNotice(null)
    try {
      const result = await client.compareArtifactVersions(session.workspaceRoot, {
        fromVersionId: descriptor.version.versionId,
        toVersionId: targetVersionId,
        textPreviewMaxBytes: 8 * 1024
      })
      if (!result.ok) setVersionNotice(result.issue.message)
      else setComparison(result.value)
    } catch (error) {
      setVersionNotice(errorMessage(error))
    } finally {
      setVersionBusy(null)
    }
  }

  const restoreSelectedVersion = async () => {
    if (
      state.status !== 'ready' ||
      state.record.kind !== 'artifact-version' ||
      state.record.descriptor.isCurrent ||
      !session.workspaceRoot
    ) return
    if (!window.confirm(t('researchDossierRestore'))) return
    const descriptor = state.record.descriptor
    const recordingId = metadataString(descriptor.version.metadata.researchRecordingId)
    setVersionBusy('restore')
    setVersionNotice(null)
    try {
      const idempotencyKey = `research-dossier:restore:${descriptor.version.versionId}:${randomToken()}`
      let restoredRef: ArtifactVersionRefV1 | undefined
      if (recordingId) {
        const result = await client.restoreResearchCheckpointAsNew(session.workspaceRoot, {
            recordingId,
            idempotencyKey,
            artifactId: descriptor.artifact.artifactId,
            sourceVersionId: descriptor.version.versionId,
            expectedCurrentVersionId: descriptor.artifact.currentVersionId
          })
        if (!result.ok) {
          setVersionNotice(result.issue.message)
          return
        }
        restoredRef = result.value.restoredRef
      } else {
        const result = await client.restoreArtifactVersionAsNew(session.workspaceRoot, {
            idempotencyKey,
            artifactId: descriptor.artifact.artifactId,
            sourceVersionId: descriptor.version.versionId,
            expectedCurrentVersionId: descriptor.artifact.currentVersionId,
            metadata: { restoredBy: 'research-dossier' }
          })
        if (!result.ok) {
          setVersionNotice(result.issue.message)
          return
        }
        restoredRef = result.value.versions[0]?.ref
      }
      if (!restoredRef) {
        setVersionNotice(t('researchDossierRestoreReceiptMissing'))
      } else {
        openArtifact(restoredRef, 'versions')
      }
    } catch (error) {
      setVersionNotice(errorMessage(error))
    } finally {
      setVersionBusy(null)
    }
  }

  const exportSelectedBundle = async () => {
    if (state.status !== 'ready' || state.record.kind !== 'artifact-version' || !session.workspaceRoot) return
    const descriptor = state.record.descriptor
    setVersionBusy('bundle')
    setVersionNotice(null)
    try {
      const result = await client.exportArtifactBundle(session.workspaceRoot, {
        idempotencyKey: bundleV2IdempotencyKey(descriptor.ref),
        versionIds: [descriptor.version.versionId],
        destinationPath: bundleV2Destination(descriptor.ref),
        format: 'v2-directory'
      })
      setVersionNotice(result.ok ? result.value.path : result.issue.message)
    } catch (error) {
      setVersionNotice(errorMessage(error))
    } finally {
      setVersionBusy(null)
    }
  }

  const requestedPage = parsedActivation.kind === 'valid'
    ? parsedActivation.value.page
    : 'overview'
  const visiblePages = visibleDossierPages(parsedActivation, state)
  const page = visiblePages.some((item) => item.id === requestedPage)
    ? requestedPage
    : 'overview'
  const canPreview = state.status === 'ready' && Boolean(previewableRef(state.record))

  return (
    <aside
      className={`flex min-h-0 min-w-0 flex-col border-l border-ds-border bg-ds-sidebar ${className}`}
      data-active={active ? 'true' : 'false'}
    >
      <header className="shrink-0 border-b border-ds-border bg-ds-main/40">
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-accent/20 bg-accent-soft text-accent">
              <BookOpenCheck className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-ds-ink">{t('researchDossierTitle')}</div>
              <div className="truncate text-[9.5px] text-ds-faint">
                {targetLabel(
                  parsedActivation,
                  t('researchDossierRecentRecords'),
                  t('researchDossierVerifiedRecord')
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => {
                void load()
                void loadRecording()
              }}
              disabled={state.status === 'loading' || recordingState.status === 'loading' || parsedActivation.kind === 'invalid'}
              className={iconButtonClass}
              aria-label={t('researchDossierRefresh')}
              title={t('researchDossierRefresh')}
            >
              <RefreshCw className={`h-4 w-4 ${state.status === 'loading' ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onCollapse}
              className={iconButtonClass}
              aria-label={t('researchDossierCollapse')}
              title={t('researchDossierCollapse')}
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          </div>
        </div>
        {visiblePages.length ? (
          <nav className="flex gap-0.5 overflow-x-auto px-2" aria-label={t('researchDossierTitle')}>
          {visiblePages.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={parsedActivation.kind !== 'valid'}
              onClick={() => navigate(item.id)}
              className={`shrink-0 border-b-2 px-2.5 py-2 text-[10.5px] font-medium transition ${
                page === item.id
                  ? 'border-accent text-ds-ink'
                  : 'border-transparent text-ds-muted hover:text-ds-ink'
              } disabled:opacity-40`}
            >
              {t(item.label)}
            </button>
          ))}
          </nav>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!session.workspaceRoot?.trim() ? (
          <EmptyState icon={<Database />} message={t('researchDossierNoWorkspace')} />
        ) : parsedActivation.kind === 'invalid' ? (
          <EmptyState icon={<AlertTriangle />} message={t('researchDossierInvalidActivation')} tone="error" />
        ) : state.status === 'loading' || state.status === 'idle' ? (
          <EmptyState icon={<Loader2 className="animate-spin" />} message={t('researchDossierLoading')} />
        ) : state.status === 'error' ? (
          <ErrorState
            code={state.code}
            message={state.code === 'access-restricted'
              ? t('researchDossierAccessDenied')
              : state.message || t('researchDossierUnavailable')}
            onRetry={() => void load()}
          />
        ) : state.status === 'browse' ? (
          <BrowsePage
            value={state.value}
            recordingState={recordingState}
            recordingAction={recordingAction}
            recordingNotice={recordingNotice}
            legacyImportState={legacyImportState}
            legacySelectedTurnIds={legacySelectedTurnIds}
            legacyTitle={legacyTitle}
            legacyBusy={legacyBusy}
            legacyNotice={legacyNotice}
            onOpenLegacyImport={() => void openLegacyImport()}
            onStartRecording={() => void startAutomaticRecording()}
            onStopRecording={() => void stopAutomaticRecording()}
            onCloseLegacyImport={() => {
              setLegacyImportState({ status: 'closed' })
              setLegacyNotice(null)
            }}
            onToggleLegacyTurn={toggleLegacyTurn}
            onLegacyTitleChange={setLegacyTitle}
            onImportLegacy={() => void importLegacyTurns()}
            onOpenArtifact={openArtifact}
          />
        ) : state.status === 'ready' ? (
          <div className="grid gap-3">
            {previewIssue ? <InlineIssue message={previewIssue} /> : null}
            {page === 'overview' ? (
              <OverviewPage
                record={state.record}
                issues={state.issues}
                canPreview={canPreview && Boolean(workspacePreview)}
                previewBusy={previewBusy}
                onPreview={() => void preview()}
                onOpenArtifact={openArtifact}
              />
            ) : page === 'versions' ? (
              <VersionsPage
                record={state.record}
                issue={state.issues.versions}
                actionNotice={versionNotice}
                comparison={comparison}
                canPreview={canPreview && Boolean(workspacePreview)}
                historyBusy={historyBusy}
                versionBusy={versionBusy}
                onLoadMore={() => void loadMoreHistory()}
                onOpenArtifact={openArtifact}
                onCompare={() => void compareSelectedVersion()}
                onPreview={() => void preview()}
                onRestore={() => void restoreSelectedVersion()}
                onExportBundle={() => void exportSelectedBundle()}
              />
            ) : page === 'reproduction' ? (
              <ReproductionPage
                record={state.record}
                checkpointIssue={state.issues.checkpoint}
                issue={state.issues.reproduction}
                onOpenArtifact={openArtifact}
              />
            ) : (
              <EvidenceReviewPage
                evidence={state.evidence}
                review={state.review}
                issues={state.issues}
              />
            )}
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function BrowsePage({
  value,
  recordingState,
  recordingAction,
  recordingNotice,
  legacyImportState,
  legacySelectedTurnIds,
  legacyTitle,
  legacyBusy,
  legacyNotice,
  onOpenLegacyImport,
  onStartRecording,
  onStopRecording,
  onCloseLegacyImport,
  onToggleLegacyTurn,
  onLegacyTitleChange,
  onImportLegacy,
  onOpenArtifact
}: Readonly<{
  value: ResearchDossierBrowseV1
  recordingState: ResearchRecordingLoadState
  recordingAction: ResearchRecordingAction | null
  recordingNotice: ResearchRecordingActionNotice | null
  legacyImportState: LegacyImportLoadState
  legacySelectedTurnIds: readonly string[]
  legacyTitle: string
  legacyBusy: boolean
  legacyNotice: string | null
  onOpenLegacyImport: () => void
  onStartRecording: () => void
  onStopRecording: () => void
  onCloseLegacyImport: () => void
  onToggleLegacyTurn: (turnId: string) => void
  onLegacyTitleChange: (value: string) => void
  onImportLegacy: () => void
  onOpenArtifact: (ref: ArtifactVersionRefV1, page?: ResearchDossierPage) => void
}>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="grid gap-3">
      <ResearchRecordingCallout
        state={recordingState}
        action={recordingAction}
        notice={recordingNotice}
        onStartRecording={onStartRecording}
        onStopRecording={onStopRecording}
        onOpenLegacyImport={onOpenLegacyImport}
      />
      <LegacyImportPanel
        state={legacyImportState}
        selectedTurnIds={legacySelectedTurnIds}
        title={legacyTitle}
        busy={legacyBusy}
        notice={legacyNotice}
        onClose={onCloseLegacyImport}
        onToggleTurn={onToggleLegacyTurn}
        onTitleChange={onLegacyTitleChange}
        onImport={onImportLegacy}
      />
      <SectionCard title={t('researchDossierRecentArtifacts')} icon={<Boxes />}>
        {value.issues.artifacts ? <InlineIssue message={value.issues.artifacts} /> : null}
        <BrowseArtifactList items={value.artifacts.items} onOpen={onOpenArtifact} />
      </SectionCard>
    </div>
  )
}

export function ResearchRecordingCallout({
  state,
  action,
  notice,
  onStartRecording,
  onStopRecording,
  onOpenLegacyImport
}: Readonly<{
  state: ResearchRecordingLoadState
  action: ResearchRecordingAction | null
  notice: ResearchRecordingActionNotice | null
  onStartRecording: () => void
  onStopRecording: () => void
  onOpenLegacyImport: () => void
}>): ReactElement {
  const { t } = useTranslation('common')
  if (state.status === 'unavailable') {
    return (
      <section className="rounded-xl border border-ds-border bg-[var(--ds-warning-soft)] p-3 text-[10.5px] text-ds-muted">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4" />
          {t('researchDossierRecordingUnavailable')}
        </div>
        <p className="mt-1.5 leading-relaxed">{state.message}</p>
      </section>
    )
  }

  if (state.status !== 'ready') {
    return (
      <section className="rounded-xl border border-ds-border bg-ds-main/50 p-3 text-[10.5px] text-ds-muted">
        <div className="flex items-center gap-2 font-semibold text-ds-ink">
          <Loader2 className={`h-4 w-4 ${state.status === 'loading' ? 'animate-spin' : ''}`} />
          {t('researchDossierRecordingChecking')}
        </div>
      </section>
    )
  }

  const recording = state.recording
  const automaticDisabled = !state.automaticEnabled
  const active = !automaticDisabled && recording?.state === 'active'
  const hasVersion = Boolean(recording && recording.versionCount > 0)
  const title = automaticDisabled
    ? t('researchDossierAutomaticStopped')
    : !recording
      ? t('researchDossierAutomaticWaiting')
      : active
        ? hasVersion
          ? `${t('researchDossierRecordingActiveVersioned')} · v${recording.currentOrdinal ?? recording.versionCount}`
          : t('researchDossierRecordingStartedNoVersion')
        : t('researchDossierAutomaticNext')
  const detail = automaticDisabled
    ? t('researchDossierAutomaticStoppedHint')
    : !recording
      ? t('researchDossierAutomaticWaitingHint')
      : !active
        ? t('researchDossierAutomaticNextHint')
        : hasVersion
          ? t('researchDossierRecordingActiveHint')
          : t('researchDossierRecordingNextTurnHint')

  return (
    <section
      className="rounded-xl border border-ds-border bg-ds-main/50 p-3 text-[10.5px]"
      data-research-recording-state={recording?.state ?? 'not-started'}
      data-research-recording-mode={state.recordingMode}
      data-research-recording-automatic-enabled={state.automaticEnabled ? 'true' : 'false'}
      data-research-recording-policy-revision={state.policyRevision}
    >
      <div className="flex items-start gap-2.5">
        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${active
          ? 'bg-ds-success-soft text-ds-success'
          : 'bg-accent-soft text-accent'}`}
        >
          {active ? <BookOpenCheck className="h-4 w-4" /> : <CircleDashed className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ds-ink">{title}</div>
          <p className="mt-1 leading-relaxed text-ds-muted">{detail}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {automaticDisabled ? (
              <button
                type="button"
                disabled={action !== null}
                aria-busy={action === 'start'}
                aria-label={t('researchDossierStartRecording')}
                onClick={onStartRecording}
                className={actionButtonClass}
              >
                {action === 'start'
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <RotateCcw className="h-3 w-3" />}
                {t(action === 'start'
                  ? 'researchDossierStartingRecording'
                  : 'researchDossierStartRecording')}
              </button>
            ) : (
              <button
                type="button"
                disabled={action !== null}
                aria-busy={action === 'stop'}
                aria-label={t('researchDossierStopRecording')}
                onClick={onStopRecording}
                className={actionButtonClass}
              >
                {action === 'stop'
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Square className="h-3 w-3" />}
                {t(action === 'stop'
                  ? 'researchDossierStoppingRecording'
                  : 'researchDossierStopRecording')}
              </button>
            )}
            <button
              type="button"
              onClick={onOpenLegacyImport}
              className={actionButtonClass}
            >
              <Import className="h-3 w-3" />
              {t('researchDossierLegacyImport')}
            </button>
          </div>
          {notice ? (
            <p
              className={`mt-2 leading-relaxed ${notice.tone === 'error' ? 'text-ds-danger' : 'text-ds-success'}`}
              role={notice.tone === 'error' ? 'alert' : 'status'}
            >
              {notice.message}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export function LegacyImportPanel({
  state,
  selectedTurnIds,
  title,
  busy,
  notice,
  onClose,
  onToggleTurn,
  onTitleChange,
  onImport
}: Readonly<{
  state: LegacyImportLoadState
  selectedTurnIds: readonly string[]
  title: string
  busy: boolean
  notice: string | null
  onClose: () => void
  onToggleTurn: (turnId: string) => void
  onTitleChange: (value: string) => void
  onImport: () => void
}>): ReactElement | null {
  const { t } = useTranslation('common')
  if (state.status === 'closed') return null
  return (
    <section
      className="overflow-hidden rounded-xl border border-ds-border bg-ds-main/35"
      data-legacy-import-state={state.status}
    >
      <header className="flex items-start justify-between gap-3 border-b border-ds-border-muted p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-ds-ink">
            <Import className="h-3.5 w-3.5 text-accent" />
            {t('researchDossierLegacyImportTitle')}
          </div>
          <p className="mt-1 text-[9.5px] leading-relaxed text-ds-muted">
            {t('researchDossierLegacyImportHint')}
          </p>
        </div>
        <button type="button" onClick={onClose} className={iconButtonClass} aria-label={t('researchDossierCancel')}>
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="grid gap-3 p-3">
        {state.status === 'loading' ? (
          <MutedText><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />{t('researchDossierLoading')}</MutedText>
        ) : state.status === 'error' ? (
          <InlineIssue message={state.message} />
        ) : (
          <>
            <label className="grid gap-1 text-[9.5px] font-medium text-ds-muted">
              {t('researchDossierLegacyRecordTitle')}
              <input
                value={title}
                onChange={(event) => onTitleChange(event.currentTarget.value)}
                maxLength={512}
                placeholder={t('researchDossierLegacyImportTitle')}
                className="rounded-lg border border-ds-border bg-ds-sidebar px-2.5 py-2 text-[10.5px] text-ds-ink outline-none transition focus:border-accent/50"
              />
            </label>
            <div>
              <div className="mb-1.5 text-[9.5px] font-medium text-ds-muted">{t('researchDossierLegacySelect')}</div>
              {state.preview.turns.length ? (
                <ol className="grid max-h-72 gap-1.5 overflow-auto pr-1">
                  {state.preview.turns.map((turn) => {
                    const selected = selectedTurnIds.includes(turn.turnId)
                    return (
                      <li key={turn.turnId}>
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => onToggleTurn(turn.turnId)}
                          className={`w-full rounded-lg border p-2 text-left transition ${selected
                            ? 'border-accent/45 bg-accent-soft'
                            : 'border-ds-border-muted bg-ds-main/45 hover:border-accent/25'}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[9.5px] font-semibold text-ds-ink">{turn.summary}</span>
                            <span className="shrink-0 text-[9px] text-ds-faint">{turn.completedAt ? formatTime(turn.completedAt) : turn.status}</span>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              ) : <MutedText>{t('researchDossierLegacyEmpty')}</MutedText>}
            </div>
            <div className="rounded-lg border border-ds-border bg-ds-danger-soft p-2 text-[9.5px] leading-relaxed text-ds-danger">
              <AlertTriangle className="mr-1 inline h-3 w-3" />
              {t('researchDossierLegacyIncomplete')}
            </div>
            {notice ? <InlineIssue message={notice} /> : null}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy || selectedTurnIds.length === 0}
                onClick={onImport}
                className={actionButtonClass}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Import className="h-3 w-3" />}
                {t('researchDossierLegacyImportAction')} ({selectedTurnIds.length})
              </button>
              <button type="button" disabled={busy} onClick={onClose} className={actionButtonClass}>
                {t('researchDossierCancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function BrowseArtifactList({
  items,
  onOpen
}: Readonly<{
  items: ArtifactVersionListV2['items']
  onOpen: (ref: ArtifactVersionRefV1, page?: ResearchDossierPage) => void
}>): ReactElement {
  const { t } = useTranslation('common')
  if (!items.length) return <MutedText>{t('researchDossierEmpty')}</MutedText>
  return (
    <ol className="grid gap-1.5">
      {items.map((item) => (
        <li key={item.version.versionId}>
          <button
            type="button"
            onClick={() => onOpen(item.ref)}
            className={listButtonClass}
          >
            <div className="flex items-center justify-between gap-2 text-[10.5px]">
              <span className="truncate font-semibold text-ds-ink">
                {item.artifact.label ?? item.artifact.kind}
              </span>
              <span className="font-mono text-ds-faint">v{item.artifactOrdinal}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[9.5px] text-ds-muted">
              <span>{formatTime(item.version.createdAt)}</span>
              <ChevronRight className="h-3 w-3 shrink-0 transition group-hover:translate-x-0.5" />
            </div>
          </button>
        </li>
      ))}
    </ol>
  )
}

export function OverviewPage({
  record,
  issues = {},
  canPreview,
  previewBusy,
  onPreview,
  onOpenArtifact
}: Readonly<{
  record: ResearchDossierExactRecord
  issues?: Readonly<Partial<Record<'checkpoint' | 'reproduction' | 'evidence' | 'review', string>>>
  canPreview: boolean
  previewBusy: boolean
  onPreview: () => void
  onOpenArtifact?: (ref: ArtifactVersionRefV1, page?: ResearchDossierPage) => void
}>): ReactElement {
  const { t } = useTranslation('common')
  const axes = fiveAxisStatus(record)
  const visibleAxes = researcherFacingAxes(record, axes)
  const breakpoints = dossierBreakpoints(record)
  const groupedBreakpoints = groupDossierBreakpoints(breakpoints)
  const attentionIssues = [...new Set([
    issues.checkpoint,
    issues.reproduction,
    issues.evidence,
    issues.review
  ].filter((value): value is string => Boolean(value)))]
  return (
    <>
      {attentionIssues.length ? (
        <SectionCard title={t('researchDossierLimitations')} icon={<AlertTriangle />}>
          <div className="grid gap-2" data-research-dossier-owner-issues>
            {attentionIssues.map((message) => <InlineIssue key={message} message={message} />)}
          </div>
        </SectionCard>
      ) : null}
      <SectionCard title={t('researchDossierVerifiedRecord')} icon={<Fingerprint />}>
        <div className="grid gap-2 text-[10.5px]">
          {record.kind === 'artifact-version' ? (
            <>
              <div className="font-semibold text-ds-ink">
                {record.descriptor.artifact.label ?? record.descriptor.artifact.kind}
              </div>
              <LabeledValue label={t('researchDossierVersions')} value={record.descriptor.isCurrent
                ? `${t('researchDossierCurrent')} · v${record.descriptor.artifactOrdinal}`
                : `${t('researchDossierHistorical')} · v${record.descriptor.artifactOrdinal}`} />
              <LabeledValue label={t('researchDossierOccurredAt')} value={formatTime(record.descriptor.version.createdAt)} />
            </>
          ) : (
            <>
              <div className="font-semibold text-ds-ink">{t('researchDossierFormalRun')}</div>
              <LabeledValue label={t('researchDossierExecution')} value={record.run.outcome} />
              <LabeledValue label={t('researchDossierOccurredAt')} value={formatTime(record.run.updatedAt)} />
            </>
          )}
        </div>
        <button
          type="button"
          disabled={!canPreview || previewBusy}
          onClick={onPreview}
          className={`${actionButtonClass} mt-3`}
          title={canPreview ? t('researchDossierPreview') : t('researchDossierPreviewUnavailable')}
        >
          {previewBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
          {t('researchDossierPreview')}
        </button>
        <TechnicalDetails>
          <div className="grid gap-2 text-[10px]">
            <LabeledValue label={record.kind === 'artifact-version' ? 'Version ID' : 'Run ID'}
              value={record.kind === 'artifact-version'
                ? record.descriptor.version.versionId
                : record.run.runId} mono />
            <LabeledValue label="SHA-256" value={exactRecordDigest(record)} mono />
            {record.kind === 'artifact-version' ? (
              <>
                <LabeledValue label="Artifact ID" value={record.descriptor.artifact.artifactId} mono />
                <LabeledValue label="Access" value={record.descriptor.ref.accessPolicy.visibility} />
              </>
            ) : <LabeledValue label="Journal" value={record.run.state} />}
          </div>
        </TechnicalDetails>
      </SectionCard>

      {record.kind === 'artifact-version' && record.checkpoint ? (
        <>
          <ResearchCheckpointNarrative record={record.checkpoint} />
          <ResearchCheckpointKeyArtifacts record={record.checkpoint} onOpenArtifact={onOpenArtifact} />
        </>
      ) : null}

      {visibleAxes.length ? (
      <SectionCard title={t('researchDossierTrustSummary')} icon={<ShieldCheck />}>
      <div className="grid grid-cols-2 gap-2">
        {visibleAxes.map((axis) => (
          <AxisCard
            key={axis.key}
            label={t(axis.label)}
            value={t(researchStatusKey(axis.value))}
            rawValue={axis.value}
            icon={axis.icon}
            wide={axis.key === 'evidence'}
          />
        ))}
      </div>
      <TechnicalDetails>
        <div className="grid gap-2 text-[10px]">
          <LabeledValue label={t('researchDossierExecution')} value={axes.execution} mono />
          <LabeledValue label={t('researchDossierProvenance')} value={axes.provenance} mono />
          <LabeledValue label={t('researchDossierControl')} value={axes.control} mono />
          <LabeledValue label={t('researchDossierReplication')} value={axes.replication} mono />
          <LabeledValue label={t('researchDossierEvidence')} value={axes.evidence} mono />
        </div>
      </TechnicalDetails>
      </SectionCard>
      ) : null}

      {groupedBreakpoints.length ? (
        <SectionCard title={t('researchDossierLimitations')} icon={<AlertTriangle />}>
          <ul className="grid gap-2">
            {groupedBreakpoints.map((breakpoint) => (
              <li key={breakpoint.code} className="rounded-lg border border-ds-border-muted bg-ds-main/50 p-2 text-[10.5px]">
                <div className="flex items-center gap-1.5 font-semibold text-ds-ink">
                  {breakpoint.blocking
                    ? <AlertTriangle className="h-3 w-3 text-ds-danger" />
                    : <CircleDashed className="h-3 w-3 text-ds-muted" />}
                  {t(limitationSummaryKey(breakpoint.code))}
                </div>
                {breakpoint.blocking ? <p className="mt-1 text-ds-muted">{t('researchDossierLimitationBlocking')}</p> : null}
                {breakpoint.count > 1
                  ? <p className="mt-1 text-ds-faint">{t('researchDossierLimitationCount', { count: breakpoint.count })}</p>
                  : null}
                <TechnicalDetails className="mt-2">
                  <LabeledValue label="Code" value={breakpoint.code} mono />
                  {breakpoint.messages.map((message) => (
                    <p key={message} className="break-words text-ds-muted">{message}</p>
                  ))}
                </TechnicalDetails>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </>
  )
}

function VersionsPage({
  record,
  issue,
  actionNotice,
  comparison,
  canPreview,
  historyBusy,
  versionBusy,
  onLoadMore,
  onOpenArtifact,
  onCompare,
  onPreview,
  onRestore,
  onExportBundle
}: Readonly<{
  record: ResearchDossierExactRecord
  issue?: string
  actionNotice: string | null
  comparison: ArtifactVersionCompareV1 | null
  canPreview: boolean
  historyBusy: boolean
  versionBusy: string | null
  onLoadMore: () => void
  onOpenArtifact: (ref: ArtifactVersionRefV1, page?: ResearchDossierPage) => void
  onCompare: () => void
  onPreview: () => void
  onRestore: () => void
  onExportBundle: () => void
}>): ReactElement {
  const { t } = useTranslation('common')
  if (record.kind === 'compute-run') {
    return (
      <SectionCard title={t('researchDossierVersions')} icon={<History />}>
        <RefList refs={computeRunRefs(record.run)} onOpen={onOpenArtifact} />
      </SectionCard>
    )
  }
  return (
    <SectionCard title={record.descriptor.artifact.label ?? record.descriptor.artifact.kind} icon={<History />}>
      {issue ? <InlineIssue message={issue} /> : null}
      {actionNotice ? <InlineIssue message={actionNotice} /> : null}
      <div className="mb-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={Boolean(versionBusy) || (!record.descriptor.version.parentVersionId && record.descriptor.isCurrent)}
          onClick={onCompare}
          className={actionButtonClass}
        >
          {versionBusy === 'compare' ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitCompareArrows className="h-3 w-3" />}
          {t('researchDossierCompare')}
        </button>
        <button
          type="button"
          disabled={Boolean(versionBusy) || !canPreview}
          onClick={onPreview}
          className={actionButtonClass}
        >
          <ExternalLink className="h-3 w-3" />{t('researchDossierPreview')}
        </button>
        <button
          type="button"
          disabled={Boolean(versionBusy) || record.descriptor.isCurrent || record.descriptor.ref.availability !== 'available'}
          onClick={onRestore}
          className={actionButtonClass}
        >
          {versionBusy === 'restore' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          {t('researchDossierRestore')}
        </button>
        <button
          type="button"
          disabled={Boolean(versionBusy) || !record.descriptor.ref.accessPolicy.allowExport}
          onClick={onExportBundle}
          className={actionButtonClass}
        >
          {versionBusy === 'bundle' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
          {t('researchDossierBundle')}
        </button>
      </div>
      {comparison ? (
        <div className="grid gap-2" data-artifact-version-comparison>
          <div className="grid gap-2 rounded-lg border border-ds-border-muted bg-ds-main/50 p-2 text-[10px]">
            <div className="font-semibold text-ds-ink">{t('researchDossierComparisonSummary')}</div>
            <ul className="grid gap-1 text-ds-muted">
              <li>{comparison.sameContent ? t('researchDossierSameContent') : t('researchDossierDifferentContent')}</li>
              {comparison.metadataChanged ? <li>{t('researchDossierMetadataChanged')}</li> : null}
              {comparison.mediaTypeChanged ? <li>{t('researchDossierMediaChanged')}</li> : null}
              {comparison.addedDependencies.length || comparison.removedDependencies.length
                ? <li>{t('researchDossierDependencyChanges')}</li>
                : null}
            </ul>
            <TechnicalDetails>
              <LabeledValue label="From Version" value={comparison.from.versionId} mono />
              <LabeledValue label="To Version" value={comparison.to.versionId} mono />
              <JsonBlock value={{
                sameContent: comparison.sameContent,
                byteLengthDelta: comparison.byteLengthDelta,
                mediaTypeChanged: comparison.mediaTypeChanged,
                metadataChanged: comparison.metadataChanged,
                dependencies: {
                  added: comparison.addedDependencies,
                  removed: comparison.removedDependencies
                }
              }} />
            </TechnicalDetails>
          </div>
          {comparison.textPreview ? (
            <div className="grid gap-2" data-comparison-text-preview>
              <ComparisonText label="From text" value={comparison.textPreview.from} />
              <ComparisonText label="To text" value={comparison.textPreview.to} />
              {comparison.textPreview.truncated
                ? <MutedText>{t('researchDossierComparePreviewTruncated')}</MutedText>
                : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <ol className="relative mt-1 grid gap-0 before:absolute before:bottom-4 before:left-[5px] before:top-4 before:w-px before:bg-ds-border">
        {record.history.items.map((item) => (
          <li key={item.version.versionId} className="relative min-w-0 py-1.5 pl-5">
            <span className={`absolute left-0 top-[15px] h-2.5 w-2.5 rounded-full border-2 ${
              item.isCurrent
                ? 'border-ds-success bg-ds-success-soft'
                : item.version.versionId === record.descriptor.version.versionId
                  ? 'border-accent bg-accent-soft'
                  : 'border-ds-border bg-ds-sidebar'
            }`} />
            <div className="rounded-lg border border-ds-border-muted bg-ds-main/50 p-2 transition hover:border-accent/30 hover:bg-ds-hover">
              <button
                type="button"
                onClick={() => onOpenArtifact(item.ref, 'versions')}
                className="group w-full text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-semibold text-ds-ink">v{item.artifactOrdinal}</span>
                  <span className="text-[9.5px] text-ds-faint">{formatTime(item.version.createdAt)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[9.5px] text-ds-muted">
                  <span className="line-clamp-2">{versionReason(item.version.metadata, item.version.intent)}</span>
                  <ChevronRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                </div>
              </button>
              <TechnicalDetails className="mt-2">
                <LabeledValue label="Version ID" value={item.version.versionId} mono />
              </TechnicalDetails>
            </div>
          </li>
        ))}
      </ol>
      {record.history.nextBeforeSequence ? (
        <button type="button" disabled={historyBusy} onClick={onLoadMore} className={`${actionButtonClass} mt-2`}>
          {historyBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArchiveRestore className="h-3 w-3" />}
          {t('researchDossierLoadMore')}
        </button>
      ) : <MutedText className="mt-2">{t('researchDossierNoMoreVersions')}</MutedText>}
    </SectionCard>
  )
}

export function ReproductionPage({
  record,
  checkpointIssue,
  issue,
  onOpenArtifact
}: Readonly<{
  record: ResearchDossierExactRecord
  checkpointIssue?: string
  issue?: string
  onOpenArtifact?: (ref: ArtifactVersionRefV1, page?: ResearchDossierPage) => void
}>): ReactElement {
  const { t } = useTranslation('common')
  if (record.kind === 'artifact-version') {
    if (record.checkpoint) {
      return (
        <ResearchCheckpointReproduction
          record={record.checkpoint}
          issue={issue}
          onOpenArtifact={onOpenArtifact}
        />
      )
    }
    if (checkpointIssue) {
      return (
        <>
          <InlineIssue message={checkpointIssue} />
          <SectionCard title={t('researchDossierDependencies')} icon={<Boxes />}>
            {record.descriptor.version.dependencies.length
              ? <RefList refs={record.descriptor.version.dependencies.map((dependency) => ({
                  role: dependency.role,
                  ref: dependency.target
                }))} />
              : <MutedText>{t('researchDossierEmpty')}</MutedText>}
          </SectionCard>
          <UnavailableSection message={t('researchDossierCheckpointProjectionUnavailable')} />
        </>
      )
    }
    return (
      <>
        <SectionCard title={t('researchDossierDependencies')} icon={<Boxes />}>
          {record.descriptor.version.dependencies.length
            ? <RefList refs={record.descriptor.version.dependencies.map((dependency) => ({
                role: dependency.role,
                ref: dependency.target
              }))} />
            : <MutedText>{t('researchDossierEmpty')}</MutedText>}
        </SectionCard>
        <SectionCard title={t('researchDossierTechnicalDetails')} icon={<FileCode2 />}>
          <TechnicalDetails>
            <MetadataTable metadata={record.descriptor.version.metadata} />
          </TechnicalDetails>
        </SectionCard>
        <UnavailableSection message={issue ?? t('researchDossierSectionUnavailable')} />
      </>
    )
  }
  const spec = record.spec
  if (!spec) return <UnavailableSection message={issue ?? record.specIssue ?? t('researchDossierSectionUnavailable')} />
  return (
    <>
      <SectionCard title={t('researchDossierInputs')} icon={<Database />}>
        <RefList refs={spec.inputs.map((input) => ({ role: `${input.name} → ${input.mountPath}`, ref: input.version }))} />
      </SectionCard>
      <SectionCard title={t('researchDossierCode')} icon={<FileCode2 />}>
        <RefList refs={[{ role: 'python-code', ref: spec.code }]} />
      </SectionCard>
      <SectionCard title={t('researchDossierParameters')} icon={<Fingerprint />}>
        <JsonBlock value={spec.parameters} />
        <LabeledValue label="Random seed" value={spec.randomSeed === undefined ? t('researchDossierEmpty') : String(spec.randomSeed)} />
      </SectionCard>
      <SectionCard title={t('researchDossierEnvironment')} icon={<ShieldCheck />}>
        <LabeledValue label={t('researchDossierControl')} value={t(researchStatusKey(spec.requestedControl))} />
        <RefList refs={[{ role: 'environment-lock', ref: spec.environmentVersion }]} />
        <TechnicalDetails>
          <JsonBlock value={{ requestedControl: spec.requestedControl, resources: spec.resources }} />
        </TechnicalDetails>
      </SectionCard>
      <SectionCard title={t('researchDossierExecutionFacts')} icon={<FlaskConical />}>
        <div className="grid gap-2 text-[10.5px]">
          <LabeledValue label={t('researchDossierExecution')} value={t(researchStatusKey(record.run.outcome))} />
          <LabeledValue label={t('researchDossierControl')} value={t(researchStatusKey(record.run.control))} />
          <LabeledValue label={t('researchDossierOccurredAt')} value={formatTime(record.run.updatedAt)} />
        </div>
        <TechnicalDetails>
          <JsonBlock value={{
            runId: record.run.runId,
            state: record.run.state,
            outcome: record.run.outcome,
            control: record.run.control,
            updatedAt: record.run.updatedAt,
          }} />
        </TechnicalDetails>
      </SectionCard>
      <SectionCard title={t('researchDossierLogs')} icon={<FileCode2 />}>
        {record.run.receiptRef
          ? <RefList refs={[{ role: 'run-receipt', ref: record.run.receiptRef }]} />
          : <UnavailableSection compact message={t('researchDossierSectionUnavailable')} />}
      </SectionCard>
      <SectionCard title={t('researchDossierOutputs')} icon={<Boxes />}>
        {record.run.outputs.length ? (
          <ul className="grid gap-2">
            {record.run.outputs.map((output) => (
              <li key={output.outputId} className="rounded-lg border border-ds-border-muted bg-ds-main/50 p-2 text-[10px]">
                <div className="font-semibold text-ds-ink">{output.outputId}</div>
                <div className="mt-1 text-ds-muted">{output.versionRef.mediaType ?? 'data'} · {formatBytes(output.versionRef.byteLength)}</div>
                {output.quarantined
                  ? <p className="mt-1 text-ds-danger">{t('researchDossierOutputQuarantined')}</p>
                  : null}
                <TechnicalDetails className="mt-2">
                  <ExactReferenceRows refValue={output.versionRef} />
                  <LabeledValue label="SHA-256" value={output.versionRef.contentDigest} mono />
                </TechnicalDetails>
              </li>
            ))}
          </ul>
        ) : <MutedText>{t('researchDossierEmpty')}</MutedText>}
      </SectionCard>
    </>
  )
}

function ResearchCheckpointNarrative({
  record
}: Readonly<{ record: ResearchCheckpointRecordV1 }>): ReactElement {
  const { t } = useTranslation('common')
  const manifest = record.manifest
  const sources = manifest.sources.filter((source) => isResearchSourceUri(source.uri))
  return (
    <>
      <SectionCard title={t('researchDossierResearchNarrative')} icon={<BookOpenCheck />}>
        <div className="grid gap-3" data-research-checkpoint-narrative>
          <div className="grid gap-1.5 rounded-lg border border-ds-border-muted bg-ds-main/50 p-2.5">
            <LabeledValue label={t('researchDossierChangeReason')} value={manifest.changeReason} />
            <LabeledValue label={t('researchDossierOccurredAt')} value={formatTime(manifest.turn.occurredAt)} />
          </div>
          <BoundedText value={manifest.narrative.canonicalText} />
          <TechnicalDetails>
            <div className="grid gap-2 text-[10px]">
              <LabeledValue label={t('researchDossierRecordedTurn')} value={manifest.turn.turnId} mono />
              <LabeledValue label={t('researchDossierOrigin')} value={manifest.recording.origin} />
              <LabeledValue label="Recording ID" value={manifest.recording.recordingId} mono />
            </div>
          </TechnicalDetails>
        </div>
      </SectionCard>
      {sources.length ? (
        <SectionCard title={t('researchDossierSources')} icon={<ExternalLink />}>
          <ul className="grid gap-2" data-research-checkpoint-sources>
            {sources.map((source) => (
              <li key={source.sourceId} className="rounded-lg border border-ds-border-muted bg-ds-main/50 p-2 text-[10px]">
                <div className="font-semibold text-ds-ink">{source.title ?? source.sourceId}</div>
                <div className="mt-1 break-all font-mono text-[9.5px] text-ds-muted">{source.uri}</div>
                {!source.artifactVersionRef && !source.contentDigest
                  ? <div className="mt-1 text-[9px] text-ds-faint">{t('researchDossierSourceUnpinned')}</div>
                  : null}
                <TechnicalDetails className="mt-2">
                  <LabeledValue label="Source ID" value={source.sourceId} mono />
                  {source.artifactVersionRef
                    ? <ExactReferenceRows refValue={source.artifactVersionRef} />
                    : source.contentDigest
                      ? <LabeledValue label="SHA-256" value={source.contentDigest} mono />
                      : null}
                </TechnicalDetails>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </>
  )
}

function ResearchCheckpointKeyArtifacts({
  record,
  onOpenArtifact
}: Readonly<{
  record: ResearchCheckpointRecordV1
  onOpenArtifact?: (ref: ArtifactVersionRefV1, page?: ResearchDossierPage) => void
}>): ReactElement | null {
  const { t } = useTranslation('common')
  const files = record.manifest.declaredFiles.filter((file) => (
    (file.role === 'output' || file.role === 'generated' || file.role === 'modified') &&
    isResearcherFacingDeclaredFile(file)
  ))
  if (!files.length) return null
  return (
    <SectionCard title={t('researchDossierKeyArtifacts')} icon={<Boxes />}>
      <ul className="grid gap-2" data-research-checkpoint-key-artifacts>
        {files.map((file) => (
          <li key={`${file.role}:${file.path}`} className="rounded-lg border border-ds-border-muted bg-ds-main/50 p-2 text-[10px]">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="break-all font-semibold text-ds-ink">{file.path}</div>
                <div className="mt-1 text-ds-muted">{file.role}{file.mediaType ? ` · ${file.mediaType}` : ''}</div>
              </div>
              {file.artifactVersionRef && onOpenArtifact ? (
                <button
                  type="button"
                  onClick={() => onOpenArtifact(file.artifactVersionRef!)}
                  className={iconButtonClass}
                  aria-label={t('researchDossierOpenExactArtifact')}
                  title={t('researchDossierOpenExactArtifact')}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <TechnicalDetails className="mt-2">
              <LabeledValue label="Capture" value={file.capture} mono />
              {file.artifactVersionRef ? <ExactReferenceRows refValue={file.artifactVersionRef} /> : null}
              {!file.artifactVersionRef && file.contentDigest
                ? <LabeledValue label="SHA-256" value={file.contentDigest} mono />
                : null}
            </TechnicalDetails>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

function ResearchCheckpointReproduction({
  record,
  issue,
  onOpenArtifact
}: Readonly<{
  record: ResearchCheckpointRecordV1
  issue?: string
  onOpenArtifact?: (ref: ArtifactVersionRefV1, page?: ResearchDossierPage) => void
}>): ReactElement {
  const { t } = useTranslation('common')
  const manifest = record.manifest
  const researcherFiles = manifest.declaredFiles.filter(isResearcherFacingDeclaredFile)
  const technicalFiles = manifest.declaredFiles.filter((file) => !isResearcherFacingDeclaredFile(file))
  const researcherDependencies = manifest.artifactDependencies.filter((dependency) => (
    !researcherFiles.some((file) => file.artifactVersionRef?.versionId === dependency.ref.versionId) &&
    ['input', 'source', 'code'].includes(dependency.role)
  ))
  const technicalDependencies = manifest.artifactDependencies.filter((dependency) => (
    !researcherDependencies.includes(dependency)
  ))
  return (
    <>
      {issue ? <InlineIssue message={issue} /> : null}
      {researcherFiles.length ? (
        <SectionCard title={t('researchDossierDeclaredFiles')} icon={<Database />}>
          <ul className="grid gap-2" data-research-checkpoint-files>
            {researcherFiles.map((file) => (
              <li key={`${file.role}:${file.path}`} className="rounded-lg border border-ds-border-muted bg-ds-main/50 p-2 text-[10px]">
                <div className="flex items-start justify-between gap-2">
                  <span className="break-all font-semibold text-ds-ink">{file.path}</span>
                  <span className="shrink-0 text-ds-faint">{file.role}</span>
                </div>
                <div className="mt-1 text-ds-muted">
                  {file.artifactVersionRef
                    ? t('researchDossierStatusVerified')
                    : file.contentDigest
                      ? t('researchDossierStatusAvailable')
                      : t('researchDossierUntracked')}
                </div>
                {file.artifactVersionRef && onOpenArtifact ? (
                  <button
                    type="button"
                    onClick={() => onOpenArtifact(file.artifactVersionRef!)}
                    className={`${actionButtonClass} mt-2`}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t('researchDossierPreview')}
                  </button>
                ) : null}
                <TechnicalDetails className="mt-2">
                  <LabeledValue label="Capture" value={file.capture} mono />
                  {file.artifactVersionRef ? <ExactReferenceRows refValue={file.artifactVersionRef} /> : null}
                  {!file.artifactVersionRef && file.contentDigest ? <LabeledValue label="SHA-256" value={file.contentDigest} mono /> : null}
                </TechnicalDetails>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
      {technicalFiles.length ? (
        <TechnicalDetails>
          <p className="mb-2 text-[10px] text-ds-muted">
            {t('researchDossierTechnicalFileSummary', { count: technicalFiles.length })}
          </p>
          <ul className="grid gap-1.5" data-research-checkpoint-technical-files>
            {technicalFiles.map((file) => (
              <li key={`${file.role}:${file.path}`} className="break-all font-mono text-[9.5px] text-ds-faint">
                {file.path} · {file.capture}
              </li>
            ))}
          </ul>
        </TechnicalDetails>
      ) : null}
      {researcherDependencies.length ? (
        <SectionCard title={t('researchDossierDependencies')} icon={<Boxes />}>
          <RefList refs={researcherDependencies.map((dependency) => ({
            role: `${dependency.role}${dependency.label ? `: ${dependency.label}` : ''}`,
            ref: dependency.ref
          }))} />
        </SectionCard>
      ) : null}
      {technicalDependencies.length ? (
        <TechnicalDetails>
          <div className="font-semibold text-ds-ink">{t('researchDossierDependencies')}</div>
          <RefList refs={technicalDependencies.map((dependency) => ({
            role: `${dependency.role}${dependency.label ? `: ${dependency.label}` : ''}`,
            ref: dependency.ref
          }))} />
        </TechnicalDetails>
      ) : null}
      {manifest.computeRuns.length ? (
        <SectionCard title={t('researchDossierComputeRuns')} icon={<FlaskConical />}>
          <ul className="grid gap-2" data-research-checkpoint-compute-runs>
            {manifest.computeRuns.map((run) => (
              <li key={run.runId} className="rounded-lg border border-ds-border-muted bg-ds-main/50 p-2">
                <div className="text-[10px] font-semibold text-ds-ink">{t('researchDossierFormalRun')}</div>
                <div className="mt-1 text-[9.5px] text-ds-muted">
                  {run.receiptRef ? t('researchDossierStatusVerified') : t('researchDossierStatusAvailable')}
                </div>
                <TechnicalDetails className="mt-2">
                  <LabeledValue label="Run ID" value={run.runId} mono />
                  <RefList refs={[
                    ...(run.specRef ? [{ role: 'run-spec', ref: run.specRef }] : []),
                    ...(run.receiptRef ? [{ role: 'run-receipt', ref: run.receiptRef }] : [])
                  ]} />
                </TechnicalDetails>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
      {manifest.untrackedOperations.length ? (
        <SectionCard title={t('researchDossierUntrackedOperations')} icon={<Square />}>
          <p className="rounded-lg border border-ds-border-muted bg-[var(--ds-warning-soft)] p-2 text-[10px] text-ds-muted">
            {t('researchDossierUntrackedSummary', { count: manifest.untrackedOperations.length })}
          </p>
          <TechnicalDetails className="mt-2">
            <ul className="grid gap-2" data-research-checkpoint-untracked>
              {manifest.untrackedOperations.map((operation, index) => (
                <li key={`${operation.itemId ?? operation.kind}:${index}`} className="rounded-lg border border-ds-border-muted bg-ds-main/50 p-2 text-[10px]">
                  <div className="font-mono font-semibold text-ds-ink">{operation.kind}</div>
                  {operation.summary ? <p className="mt-1 break-words text-ds-muted">{operation.summary}</p> : null}
                </li>
              ))}
            </ul>
          </TechnicalDetails>
        </SectionCard>
      ) : null}
      {manifest.gitCheckpoints.length ? (
        <TechnicalDetails>
          <div className="font-semibold text-ds-ink">{t('researchDossierGitProjection')}</div>
          <ul className="grid gap-2" data-research-checkpoint-git>
            {manifest.gitCheckpoints.map((git) => (
              <li key={`${git.provider}:${git.checkpointId}`} className="rounded-lg border border-ds-border-muted bg-ds-main/50 p-2 text-[10px]">
                <LabeledValue label={t('researchDossierProvider')} value={git.provider} />
                <LabeledValue label={t('researchDossierCheckpoint')} value={git.checkpointId} mono />
                <LabeledValue label={t('researchDossierRevision')} value={git.revision} mono />
              </li>
            ))}
          </ul>
        </TechnicalDetails>
      ) : null}
    </>
  )
}

export function EvidenceReviewPage({
  evidence,
  review,
  issues
}: Readonly<{
  evidence: LegacyEvidenceDossierSummary | null
  review: ResearchDossierVisualReviewSummaryV1 | null
  issues: Readonly<Partial<Record<'evidence' | 'review', string>>>
}>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <>
      {evidence || issues.evidence ? <SectionCard title={t('researchDossierTrustSummary')} icon={<Scale />}>
        {evidence ? (
          <div className="grid gap-2">
            <LabeledValue label="Level" value={evidence.provenanceLevel} />
            <LabeledValue label={t('researchDossierProvenance')} value={t(researchStatusKey(evidence.provenanceComplete ? 'complete' : 'incomplete'))} />
            <LabeledValue label="Freshness" value={t(researchStatusKey(evidence.freshness))} />
            {evidence.breakpointCount > 0
              ? <LabeledValue label={t('researchDossierLimitations')} value={String(evidence.breakpointCount)} />
              : null}
            <LabeledValue label="Compilation" value={t(researchStatusKey(evidence.pending ? evidence.pending.state : 'committed'))} />
            {evidence.humanReview && !(
              evidence.humanReview.level === 'none' && evidence.humanReview.status === 'not_needed'
            ) ? (
              <LabeledValue
                label="Evidence review"
                value={t(evidenceHumanReviewStatusKey(evidence.humanReview))}
              />
            ) : null}
            <TechnicalDetails>
              <LabeledValue label="Snapshot" value={evidence.snapshot.digest} mono />
              <LabeledValue label="Freshness" value={evidence.freshness} mono />
              <LabeledValue label="Compilation" value={evidence.pending ? evidence.pending.state : 'committed'} mono />
              {evidence.humanReview ? (
                <LabeledValue
                  label="Evidence review"
                  value={`${evidence.humanReview.gateStatus} · ${evidence.humanReview.status}`}
                  mono
                />
              ) : null}
            </TechnicalDetails>
          </div>
        ) : <UnavailableSection compact message={issues.evidence ?? t('researchDossierSectionUnavailable')} />}
      </SectionCard> : null}
      {review || issues.review ? (
        <SectionCard title={t('researchDossierReview')} icon={<BookOpenCheck />}>
          {review ? (
          <div className="grid gap-2">
            <LabeledValue label="Status" value={t(researchStatusKey(review.status))} />
            <LabeledValue label="Score" value={review.score.toFixed(3)} />
            <LabeledValue label="Reviewed" value={formatTime(review.reviewedAt)} />
            <TechnicalDetails>
              <LabeledValue label="Document" value={review.documentId} mono />
              <LabeledValue label="Revision" value={review.revisionId} mono />
              <LabeledValue label="Review digest" value={review.reviewDigest} mono />
              <LabeledValue label="Status" value={review.status} mono />
            </TechnicalDetails>
          </div>
          ) : <UnavailableSection compact message={issues.review!} />}
        </SectionCard>
      ) : null}
    </>
  )
}

function SectionCard({
  title,
  icon,
  children
}: Readonly<{ title: string; icon: ReactNode; children: ReactNode }>): ReactElement {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-ds-border-muted bg-ds-main/35">
      <header className="flex items-center gap-2 border-b border-ds-border-muted px-3 py-2.5 text-[11px] font-semibold text-ds-ink">
        <span className="text-accent [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        {title}
      </header>
      <div className="p-3">{children}</div>
    </section>
  )
}

function AxisCard({
  label,
  value,
  rawValue,
  icon,
  wide = false
}: Readonly<{ label: string; value: string; rawValue?: string; icon: ReactNode; wide?: boolean }>): ReactElement {
  const tone = statusTone(rawValue ?? value)
  return (
    <article className={`relative overflow-hidden rounded-xl border border-ds-border-muted bg-ds-main/45 p-2.5 ${wide ? 'col-span-2' : ''}`}>
      <span className={`absolute inset-y-0 left-0 w-0.5 ${tone.bar}`} />
      <div className="flex items-center gap-1.5 text-[9.5px] font-medium uppercase tracking-[0.08em] text-ds-faint">
        <span className="[&>svg]:h-3 [&>svg]:w-3">{icon}</span>
        {label}
      </div>
      <div className={`mt-1.5 break-words font-mono text-[10.5px] font-semibold ${tone.text}`}>{value}</div>
    </article>
  )
}

function RefList({
  refs,
  onOpen
}: Readonly<{
  refs: readonly Readonly<{ role: string; ref: ArtifactVersionRefV1 }>[]
  onOpen?: (ref: ArtifactVersionRefV1) => void
}>): ReactElement {
  const { t } = useTranslation('common')
  if (!refs.length) return <MutedText>{t('researchDossierEmpty')}</MutedText>
  return (
    <ul className="grid gap-2">
      {refs.map(({ role, ref }) => (
        <li key={`${role}:${ref.versionId}`} className="min-w-0 rounded-lg border border-ds-border-muted bg-ds-main/50 p-2">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold text-ds-ink">{role}</div>
              <div className="mt-1 text-[9.5px] text-ds-muted">
                {ref.availability === 'available'
                  ? t('researchDossierStatusAvailable')
                  : t('researchDossierStatusUnavailableShort')}
              </div>
            </div>
            {onOpen ? (
              <button
                type="button"
                onClick={() => onOpen(ref)}
                className={iconButtonClass}
                aria-label={t('researchDossierOpenExactArtifact')}
                title={t('researchDossierOpenExactArtifact')}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <TechnicalDetails className="mt-2">
            <ExactReferenceRows refValue={ref} />
          </TechnicalDetails>
        </li>
      ))}
    </ul>
  )
}

function MetadataTable({ metadata }: Readonly<{ metadata: Readonly<Record<string, unknown>> }>): ReactElement {
  const { t } = useTranslation('common')
  const rows = artifactMetadataRows(metadata as never)
  if (!rows.length) return <MutedText>{t('researchDossierEmpty')}</MutedText>
  return (
    <dl className="grid grid-cols-[minmax(80px,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 text-[10px]">
      {rows.map(({ key, value }) => (
        <div key={key} className="contents">
          <dt className="truncate font-mono text-ds-faint" title={key}>{key}</dt>
          <dd className="min-w-0 break-words text-ds-muted">{compactJson(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

function JsonBlock({ value }: Readonly<{ value: unknown }>): ReactElement {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ds-border-muted bg-ds-sidebar/60 p-2.5 font-mono text-[9.5px] leading-relaxed text-ds-muted">
      {JSON.stringify(value, null, 2).slice(0, 24_000)}
    </pre>
  )
}

function TechnicalDetails({
  children,
  className = ''
}: Readonly<{ children: ReactNode; className?: string }>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <details className={`group rounded-lg border border-ds-border-muted bg-ds-sidebar/35 ${className}`} data-technical-details>
      <summary className="cursor-pointer select-none px-2.5 py-2 text-[9.5px] font-medium text-ds-muted transition hover:text-ds-ink">
        {t('researchDossierTechnicalDetails')}
      </summary>
      <div className="grid gap-2 border-t border-ds-border-muted p-2.5">{children}</div>
    </details>
  )
}

function ExactReferenceRows({ refValue }: Readonly<{ refValue: ArtifactVersionRefV1 }>): ReactElement {
  return (
    <div className="grid gap-2">
      <LabeledValue label="Artifact ID" value={refValue.artifactId} mono />
      <LabeledValue label="Version ID" value={refValue.versionId} mono />
      <LabeledValue label="SHA-256" value={refValue.contentDigest} mono />
      <LabeledValue label="Availability" value={refValue.availability} mono />
    </div>
  )
}

function BoundedText({ value }: Readonly<{ value: string }>): ReactElement {
  const limit = 24_000
  const truncated = value.length > limit
  return (
    <div className="min-w-0" data-research-checkpoint-text>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ds-border-muted bg-ds-sidebar/60 p-3 text-[10.5px] leading-relaxed text-ds-muted">
        {value.slice(0, limit)}
      </pre>
      {truncated ? <MutedText className="mt-1">Content preview truncated at {limit.toLocaleString()} characters.</MutedText> : null}
    </div>
  )
}

function ComparisonText({ label, value }: Readonly<{ label: string; value: string }>): ReactElement {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-ds-faint">
        {label}
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ds-border-muted bg-ds-sidebar/60 p-2.5 font-mono text-[9.5px] leading-relaxed text-ds-muted">
        {value}
      </pre>
    </div>
  )
}

function LabeledValue({
  label,
  value,
  mono = false
}: Readonly<{ label: string; value: string; mono?: boolean }>): ReactElement {
  return (
    <div className="grid grid-cols-[minmax(76px,auto)_minmax(0,1fr)] items-start gap-2">
      <span className="text-ds-faint">{label}</span>
      <span className={`min-w-0 break-words text-ds-muted ${mono ? 'font-mono text-[9.5px]' : ''}`} title={value}>{value}</span>
    </div>
  )
}

function UnavailableSection({ message, compact = false }: Readonly<{ message: string; compact?: boolean }>): ReactElement {
  return (
    <div className={`rounded-lg border border-dashed border-ds-border bg-ds-sidebar/50 text-ds-faint ${compact ? 'p-2 text-[9.5px]' : 'p-4 text-center text-[10.5px]'}`}>
      <CircleDashed className={`mx-auto mb-1 h-3.5 w-3.5 ${compact ? 'hidden' : ''}`} />
      {message}
    </div>
  )
}

function EmptyState({ icon, message, tone = 'neutral' }: Readonly<{
  icon: ReactNode
  message: string
  tone?: 'neutral' | 'error'
}>): ReactElement {
  return (
    <div className={`grid min-h-48 place-items-center rounded-xl border border-dashed p-6 text-center text-[11px] ${
      tone === 'error'
        ? 'border-ds-border bg-ds-danger-soft text-ds-danger'
        : 'border-ds-border text-ds-muted'
    }`}>
      <div>
        <div className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-full border border-current/15 bg-ds-main/50 [&>svg]:h-4 [&>svg]:w-4">{icon}</div>
        <p className="mx-auto max-w-64 leading-relaxed">{message}</p>
      </div>
    </div>
  )
}

function ErrorState({ code, message, onRetry }: Readonly<{
  code: string
  message: string
  onRetry: () => void
}>): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="rounded-xl border border-ds-border bg-ds-danger-soft p-4 text-[10.5px] text-ds-danger">
      <div className="flex items-center gap-2 font-mono font-semibold"><AlertTriangle className="h-4 w-4" />{code}</div>
      <p className="mt-2 leading-relaxed">{message}</p>
      <button type="button" onClick={onRetry} className={`${actionButtonClass} mt-3`}>
        <RefreshCw className="h-3 w-3" />{t('researchDossierRetry')}
      </button>
    </div>
  )
}

function InlineIssue({ message }: Readonly<{ message: string }>): ReactElement {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-ds-border bg-[var(--ds-warning-soft)] p-2 text-[10px] text-ds-muted">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="break-words">{message}</span>
    </div>
  )
}

function MutedText({ children, className = '' }: Readonly<{ children: ReactNode; className?: string }>): ReactElement {
  return <div className={`text-[10px] text-ds-faint ${className}`}>{children}</div>
}

export function parseDossierActivation(
  activation?: DomainWorkbenchRightPanelActivation
): Readonly<
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'valid'; value: ResearchDossierActivationPayloadV1 }
> {
  if (!activation) return { kind: 'empty' }
  const parsed = researchDossierActivationPayloadV1Schema.safeParse(activation.payload)
  return parsed.success ? { kind: 'valid', value: parsed.data } : { kind: 'invalid' }
}

function targetLabel(
  parsed: ReturnType<typeof parseDossierActivation>,
  recentLabel: string,
  recordLabel: string
): string {
  if (parsed.kind === 'empty') return recentLabel
  if (parsed.kind === 'invalid') return recordLabel
  return recordLabel
}

function researchStatusKey(value: string):
  | 'researchDossierStatusVerified'
  | 'researchDossierStatusNeedsAttention'
  | 'researchDossierStatusNotVerified'
  | 'researchDossierStatusInProgress'
  | 'researchDossierStatusAvailable'
  | 'researchDossierStatusUnavailableShort' {
  if (/^(succeeded|success|complete|committed|accepted|approved|not_needed|clear|fresh|isolated-attested|replicates|formal-references-present)$/u.test(value)) {
    return 'researchDossierStatusVerified'
  }
  if (/^(failed|cancelled|incomplete|partial|mixed|stale|needs-review|fails-to-replicate|quarantined|rejected|blocked|expired)$/u.test(value)) {
    return 'researchDossierStatusNeedsAttention'
  }
  if (/^(pending|running|queued|not-started|retrying|candidate|deferred)$/u.test(value)) return 'researchDossierStatusInProgress'
  if (/^(unavailable|missing|indeterminate)$/u.test(value)) return 'researchDossierStatusUnavailableShort'
  if (/^(not-run|not-applicable|untracked|observed-untracked|inconclusive|eligible|pinned-nonhermetic)$/u.test(value)) {
    return 'researchDossierStatusNotVerified'
  }
  return 'researchDossierStatusAvailable'
}

function evidenceHumanReviewStatusKey(
  review: LegacyEvidenceDossierSummary['humanReview']
): ReturnType<typeof researchStatusKey> {
  if (!review) return 'researchDossierStatusNotVerified'
  if (review.blocking || review.gateStatus === 'blocked') return 'researchDossierStatusNeedsAttention'
  if (/^(pending|deferred|retrying|candidate)$/u.test(review.status)) return 'researchDossierStatusInProgress'
  if (review.gateStatus === 'clear' && /^(approved|not_needed|complete|accepted)$/u.test(review.status)) {
    return 'researchDossierStatusVerified'
  }
  return researchStatusKey(review.status)
}

function limitationSummaryKey(code: string):
  | 'researchDossierLimitationSource'
  | 'researchDossierLimitationFile'
  | 'researchDossierLimitationUntracked'
  | 'researchDossierLimitationCompute'
  | 'researchDossierLimitationGit'
  | 'researchDossierLimitationNarrative'
  | 'researchDossierLimitationLegacy'
  | 'researchDossierLimitationGeneric' {
  if (/source/u.test(code)) return 'researchDossierLimitationSource'
  if (/file|path/u.test(code)) return 'researchDossierLimitationFile'
  if (/untracked|ambient|editor/u.test(code)) return 'researchDossierLimitationUntracked'
  if (/compute|execution|output|environment|sandbox|resource/u.test(code)) return 'researchDossierLimitationCompute'
  if (/git/u.test(code)) return 'researchDossierLimitationGit'
  if (/narrative/u.test(code)) return 'researchDossierLimitationNarrative'
  if (/legacy/u.test(code)) return 'researchDossierLimitationLegacy'
  return 'researchDossierLimitationGeneric'
}

function groupDossierBreakpoints(
  breakpoints: readonly Readonly<{ code: string; blocking: boolean; message: string }>[]
): readonly Readonly<{
  code: string
  blocking: boolean
  count: number
  messages: readonly string[]
}>[] {
  const groups = new Map<string, { blocking: boolean; count: number; messages: Set<string> }>()
  for (const breakpoint of breakpoints) {
    const existing = groups.get(breakpoint.code) ?? {
      blocking: false,
      count: 0,
      messages: new Set<string>()
    }
    existing.blocking ||= breakpoint.blocking
    existing.count += 1
    existing.messages.add(breakpoint.message)
    groups.set(breakpoint.code, existing)
  }
  return [...groups.entries()].map(([code, value]) => ({
    code,
    blocking: value.blocking,
    count: value.count,
    messages: [...value.messages]
  }))
}

function versionReason(metadata: Readonly<Record<string, unknown>>, fallback: string): string {
  return metadataString(metadata.changeReason) ?? fallback
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KB`
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`
}

function statusTone(value: string): Readonly<{ bar: string; text: string }> {
  if (/^(succeeded|complete|isolated-attested|replicates|committed)$/u.test(value)) {
    return { bar: 'bg-ds-success', text: 'text-ds-success' }
  }
  if (/^(failed|cancelled|indeterminate|fails-to-replicate)$/u.test(value)) {
    return { bar: 'bg-ds-danger', text: 'text-ds-danger' }
  }
  if (/^(pending|incomplete|pinned-nonhermetic|inconclusive|stale|needs-review)$/u.test(value)) {
    return { bar: 'bg-accent', text: 'text-ds-muted' }
  }
  return { bar: 'bg-ds-border', text: 'text-ds-muted' }
}

function compactJson(value: unknown): string {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  return serialized.length > 500 ? `${serialized.slice(0, 500)}…` : serialized
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function metadataString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isResearcherFacingDeclaredFile(
  file: ResearchCheckpointRecordV1['manifest']['declaredFiles'][number]
): boolean {
  if (file.role === 'input') return true
  return file.artifactVersionRef?.artifactId.startsWith('artifact:research-output:') === true
}

function researcherFacingAxes(
  record: ResearchDossierExactRecord,
  axes: ReturnType<typeof fiveAxisStatus>
): readonly Readonly<{
  key: 'execution' | 'provenance' | 'control' | 'replication' | 'evidence'
  label: 'researchDossierExecution' | 'researchDossierProvenance' | 'researchDossierControl' | 'researchDossierReplication' | 'researchDossierEvidence'
  value: string
  icon: ReactNode
}>[] {
  const values = [
    { key: 'execution' as const, label: 'researchDossierExecution' as const, value: axes.execution, icon: <FlaskConical /> },
    { key: 'provenance' as const, label: 'researchDossierProvenance' as const, value: axes.provenance, icon: <Boxes /> },
    { key: 'control' as const, label: 'researchDossierControl' as const, value: axes.control, icon: <ShieldCheck /> },
    { key: 'replication' as const, label: 'researchDossierReplication' as const, value: axes.replication, icon: <GitCompareArrows /> },
    { key: 'evidence' as const, label: 'researchDossierEvidence' as const, value: axes.evidence, icon: <Scale /> }
  ]
  if (record.kind === 'compute-run') return values
  if (!record.checkpoint) {
    const metadata = record.descriptor.version.metadata
    const declared = new Set([
      metadataString(metadata.executionOutcome) ? 'execution' : null,
      metadataString(metadata.provenanceStatus) ? 'provenance' : null,
      metadataString(metadata.controlLevel) ? 'control' : null,
      metadataString(metadata.replicationStatus) ? 'replication' : null,
      metadataString(metadata.evidenceStatus) ? 'evidence' : null
    ].filter((value): value is string => value !== null))
    return values.filter((axis) => declared.has(axis.key))
  }
  const noFormalExecution = record.checkpoint?.manifest.computeRuns.length === 0 &&
    /^(not-applicable|observed-untracked)$/u.test(axes.execution)
  return values.filter((axis) => !(
    noFormalExecution && (
      axis.key === 'execution' ||
      axis.key === 'control' ||
      (axis.key === 'replication' && axes.replication === 'not-run')
    )
  ))
}

function sameResearchRecordingScope(
  current: ResearchRecordingScope | null,
  next: Omit<ResearchRecordingScope, 'generation'>
): boolean {
  return Boolean(
    current &&
    current.client === next.client &&
    current.activationKind === next.activationKind &&
    current.workspaceRoot === next.workspaceRoot &&
    current.runtimeId === next.runtimeId &&
    current.threadId === next.threadId
  )
}

function randomToken(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const PAGES = [
  { id: 'overview', label: 'researchDossierOverview' },
  { id: 'versions', label: 'researchDossierVersions' },
  { id: 'reproduction', label: 'researchDossierReproduction' },
  { id: 'evidence-review', label: 'researchDossierEvidenceReview' }
] as const

function visibleDossierPages(
  activation: ReturnType<typeof parseDossierActivation>,
  state: LoadState
): readonly (typeof PAGES)[number][] {
  if (activation.kind !== 'valid') return []
  if (state.status !== 'ready') {
    return activation.value.target.kind === 'artifact-version'
      ? PAGES.filter((item) => item.id === 'overview' || item.id === 'versions')
      : PAGES.filter((item) => item.id === 'overview' || item.id === 'reproduction')
  }

  const hasVersions = state.record.kind === 'artifact-version'
  const hasReproduction = state.record.kind === 'compute-run' || Boolean(
    state.record.checkpoint ||
    state.record.descriptor.version.dependencies.length ||
    state.issues.checkpoint ||
    state.issues.reproduction
  )
  const hasEvidenceReview = Boolean(
    state.evidence || state.review || state.issues.evidence || state.issues.review
  )
  return PAGES.filter((item) => (
    item.id === 'overview' ||
    (item.id === 'versions' && hasVersions) ||
    (item.id === 'reproduction' && hasReproduction) ||
    (item.id === 'evidence-review' && hasEvidenceReview)
  ))
}

const iconButtonClass =
  'rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40'
const actionButtonClass =
  'inline-flex items-center gap-1.5 rounded-lg border border-ds-border bg-ds-sidebar px-2 py-1.5 text-[10px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40'
const listButtonClass =
  'group w-full rounded-lg border border-ds-border-muted bg-ds-main/50 p-2 text-left transition hover:border-accent/30 hover:bg-ds-hover'
