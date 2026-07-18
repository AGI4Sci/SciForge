import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Loader2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { AgentProviderCapabilities } from '../../agent/types'
import type { AgentRuntimeId } from '@shared/app-settings'
import { useChatStore } from '../../store/chat-store'
import {
  selectSddDraftSession,
  useSddDraftStore,
  type SddDraft
} from '../../sdd/sdd-draft-store'
import type { ComposerFileReference } from '../chat/FloatingComposer'
import type { ComposerReasoningEffort } from '../chat/FloatingComposerModelPicker'
import { SddAssistantPanel } from './SddAssistantPanel'

export type SddAssistantSendRequest = {
  ownerSessionId: string
  draft: SddDraft
  draftContent: string
  value: string
  mode: 'plan' | 'agent'
  fileReferences: ComposerFileReference[]
}

type Props = {
  ownerSessionId: string
  title: string
  runtimeId?: AgentRuntimeId
  runtimeCapabilities?: AgentProviderCapabilities
  onSend: (request: SddAssistantSendRequest) => Promise<boolean>
  onPreviewFileReference?: (
    ownerSessionId: string,
    reference: ComposerFileReference
  ) => void
  onNewConversation: (ownerSessionId: string, draft: SddDraft) => void
  onCollapse: () => void
  className?: string
}

function reasoningEffort(value: string): ComposerReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'max'
    ? value
    : 'max'
}

function removeFileReference(
  references: ComposerFileReference[],
  relativePath: string,
  workspaceRoot?: string
): ComposerFileReference[] {
  return references.filter((reference) =>
    reference.relativePath !== relativePath ||
    (workspaceRoot !== undefined && reference.workspaceRoot !== workspaceRoot)
  )
}

function mergeFileReference(
  references: ComposerFileReference[],
  reference: ComposerFileReference
): ComposerFileReference[] {
  const next = removeFileReference(references, reference.relativePath, reference.workspaceRoot)
  return [...next, reference]
}

/**
 * Session-owned SDD assistant surface. Draft state lives in the SDD session
 * registry while transcript, stream, composer, busy state, and queue reuse the
 * existing isolated side-conversation runtime path for the same thread ID.
 */
export function SessionSddAssistantPanel({
  ownerSessionId,
  title,
  runtimeId,
  runtimeCapabilities,
  onSend,
  onPreviewFileReference,
  onNewConversation,
  onCollapse,
  className = ''
}: Props): ReactElement {
  const draftSession = useSddDraftStore((state) =>
    selectSddDraftSession(state, ownerSessionId)
  )
  const {
    side,
    runtimeConnection,
    composerPickList,
    composerModelGroups,
    attachSideConversation,
    setSideInput,
    setSideModel,
    setSideReasoningEffort,
    removeSideQueuedMessage,
    interruptSide,
    closeSideConversation,
    probeRuntime,
    openSettings
  } = useChatStore(
    useShallow((state) => ({
      side: state.sideConversations[ownerSessionId] ?? null,
      runtimeConnection: state.runtimeConnection,
      composerPickList: state.composerPickList,
      composerModelGroups: state.composerModelGroups,
      attachSideConversation: state.attachSideConversation,
      setSideInput: state.setSideInput,
      setSideModel: state.setSideModel,
      setSideReasoningEffort: state.setSideReasoningEffort,
      removeSideQueuedMessage: state.removeSideQueuedMessage,
      interruptSide: state.interruptSide,
      closeSideConversation: state.closeSideConversation,
      probeRuntime: state.probeRuntime,
      openSettings: state.openSettings
    }))
  )
  const [mode, setMode] = useState<'plan' | 'agent'>('agent')
  const [fileReferences, setFileReferences] = useState<ComposerFileReference[]>([])
  const ownerSessionIdRef = useRef(ownerSessionId)
  ownerSessionIdRef.current = ownerSessionId

  useEffect(() => {
    if (!draftSession || side) return
    void attachSideConversation({
      threadId: ownerSessionId,
      parentThreadId: ownerSessionId,
      ...(runtimeId ? { runtimeId } : {}),
      title,
      source: 'sdd_assistant',
      openPanel: false
    })
  }, [attachSideConversation, draftSession, ownerSessionId, runtimeId, side, title])

  useEffect(() => () => {
    void closeSideConversation(ownerSessionIdRef.current)
  }, [closeSideConversation])

  const effectivePickList = useMemo(() => {
    const models = new Set(composerPickList)
    if (side?.model) models.add(side.model)
    return [...models]
  }, [composerPickList, side?.model])

  if (!draftSession || !side) {
    return (
      <div
        className={`flex h-full min-h-0 items-center justify-center bg-ds-sidebar text-ds-faint ${className}`}
        data-sdd-owner-session={ownerSessionId}
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      </div>
    )
  }

  const send = async (): Promise<void> => {
    const value = side.input.trim()
    if (!value && fileReferences.length === 0) return
    const sent = await onSend({
      ownerSessionId,
      draft: draftSession.draft,
      draftContent: draftSession.content,
      value,
      mode,
      fileReferences: [...fileReferences]
    })
    if (!sent) return
    setSideInput(ownerSessionId, '')
    setFileReferences([])
  }

  return (
    <SddAssistantPanel
      draft={draftSession.draft}
      input={side.input}
      setInput={(value) => setSideInput(ownerSessionId, value)}
      mode={mode}
      setMode={setMode}
      busy={side.busy}
      runtimeConnection={runtimeConnection}
      activeThreadId={ownerSessionId}
      blocks={side.blocks}
      liveReasoning={side.liveReasoning}
      liveAssistant={side.liveAssistant}
      composerModel={side.model}
      composerPickList={effectivePickList}
      composerModelGroups={composerModelGroups}
      composerReasoningEffort={reasoningEffort(side.reasoningEffort)}
      setComposerModel={(model) => setSideModel(ownerSessionId, model)}
      setComposerReasoningEffort={(effort) => setSideReasoningEffort(ownerSessionId, effort)}
      queuedMessages={side.queuedMessages ?? []}
      removeQueuedMessage={(messageId) => removeSideQueuedMessage(ownerSessionId, messageId)}
      fileReferenceEnabled={Boolean(draftSession.draft.workspaceRoot.trim())}
      fileReferences={fileReferences}
      onAddFileReference={(reference) => {
        setFileReferences((current) => mergeFileReference(current, reference))
      }}
      onPreviewFileReference={onPreviewFileReference
        ? (reference) => onPreviewFileReference(ownerSessionId, reference)
        : undefined}
      onRemoveFileReference={(relativePath, workspaceRoot) => {
        setFileReferences((current) => removeFileReference(current, relativePath, workspaceRoot))
      }}
      onSend={() => void send()}
      onInterrupt={() => void interruptSide(ownerSessionId)}
      runtimeCapabilities={runtimeCapabilities}
      onRetryConnection={() => void probeRuntime('user')}
      onOpenSettings={() => openSettings('agents')}
      onNewConversation={() => onNewConversation(ownerSessionId, draftSession.draft)}
      onCollapse={onCollapse}
      className={className}
    />
  )
}
