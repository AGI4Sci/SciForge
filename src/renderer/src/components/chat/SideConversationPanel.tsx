import { SideConversationHandoffEditor } from './SideConversationHandoffEditor'
import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUpToLine, MessageCircleMore, Plus, X } from 'lucide-react'
import { useChatStore } from '../../store/chat-store'
import type { AttachmentReference } from '../../agent/types'
import type { SideChatMode, SideConversation } from '../../store/chat-store-types'
import { getProvider } from '../../agent/registry'
import { prepareImageAttachmentUpload } from '../../lib/image-attachment-upload'
import { importComposerWorkspaceAttachment } from '../../lib/composer-workspace-attachment'
import { useEdgePanel, type EdgePanelBehavior } from '../use-edge-panel'
import { FloatingComposer, type ComposerFileReference, type ComposerImageAttachmentInput } from './FloatingComposer'
import { MessageTimeline } from './MessageTimeline'
import { visibleSideIds } from './side-conversation-selectors'
import type { SideConversationHandoffInput } from './side-conversation-handoff'
import { sideConversationHandoffDraft } from './side-conversation-handoff-draft'
import { SIDE_CONVERSATION_WIDTH } from '../side-conversation-layout'

export type { SideConversationHandoffInput } from './side-conversation-handoff'
type Props = { className?: string; rightOffset?: number; dockAvailable?: boolean; onHandoff?: (input: SideConversationHandoffInput) => Promise<boolean> }

function modeOf(side: SideConversation): SideChatMode {
  return side.chatMode ?? (side.source === 'child_agent' || side.source === 'sdd_assistant' ? 'deep' : 'light')
}

function SideModePicker({ mode, disabled, onChange }: {
  mode: SideChatMode; disabled?: boolean; onChange: (mode: SideChatMode) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return <div className="flex items-center rounded-lg border border-ds-border p-0.5" role="group" aria-label={t('sideChatMode')}>
    {(['light', 'deep'] as const).map(value => <button key={value} type="button" disabled={disabled} aria-pressed={mode === value}
      onClick={() => onChange(value)} className={`rounded-md px-2 py-1 text-xs disabled:opacity-50 ${mode === value ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted hover:bg-ds-hover'}`}>
      {t(value === 'light' ? 'sideChatLight' : 'sideChatDeep')}</button>)}
  </div>
}

type AttachmentDraft = { attachments: AttachmentReference[]; files: ComposerFileReference[]; busy: boolean; error?: string }
const emptyAttachments = (): AttachmentDraft => ({ attachments: [], files: [], busy: false })

function SideConversationView({ sideId, onHandoff }: { sideId: string; onHandoff?: Props['onHandoff'] }): ReactElement | null {
  const { t } = useTranslation('common')
  const side = useChatStore(s => s.sideConversations[sideId] ?? null)
  const parent = useChatStore(useShallow(s => {
    const source = s.threads.find(thread => thread.id === s.sideConversations[sideId]?.parentThreadId)
    return source ? { workspace: source.workspace, runtimeId: source.runtimeId } : null
  }))
  const shared = useChatStore(useShallow(s => ({
    runtimeConnection: s.runtimeConnection, workspaceRoot: s.workspaceRoot, activeAgentRuntime: s.activeAgentRuntime,
    composerPickList: s.composerPickList, composerModelGroups: s.composerModelGroups, setSideInput: s.setSideInput,
    sendSideMessage: s.sendSideMessage, interruptSide: s.interruptSide, setSideModel: s.setSideModel,
    setSideReasoningEffort: s.setSideReasoningEffort, setSideChatMode: s.setSideChatMode,
    removeSideQueuedMessage: s.removeSideQueuedMessage, probeRuntime: s.probeRuntime, setRoute: s.setRoute
  })))
  const [drafts, setDrafts] = useState<Record<string, AttachmentDraft>>({})
  const [handoffs, setHandoffs] = useState<Record<string, { document: string; memory: string; instruction: string }>>({})
  const [handoffOpen, setHandoffOpen] = useState(false)
  const [handoffBusy, setHandoffBusy] = useState(false)
  const [handoffError, setHandoffError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => { setHandoffOpen(false); setHandoffError(''); setNotice('') }, [sideId])
  if (!side) return null
  const mode = modeOf(side)
  const workspace = side.workspaceRoot ?? parent?.workspace ?? ''
  const runtimeId = side.runtimeId ?? parent?.runtimeId
  const matchingRuntime = Boolean(runtimeId && runtimeId === shared.activeAgentRuntime)
  const draft = drafts[sideId] ?? emptyAttachments()
  const handoff = handoffs[sideId]
  const patchDraft = (update: (value: AttachmentDraft) => AttachmentDraft): void => {
    setDrafts(current => ({ ...current, [sideId]: update(current[sideId] ?? emptyAttachments()) }))
  }
  const pickAttachments = async (inputs: ComposerImageAttachmentInput[]): Promise<void> => {
    patchDraft(current => ({ ...current, busy: true, error: undefined }))
    try {
      const provider = getProvider()
      const runtime = await provider.getRuntimeInfo?.()
      for (const input of inputs) {
        if (input.file.type.startsWith('image/')) {
          const capabilities = runtime?.capabilities.attachments
          if (!capabilities || !provider.uploadAttachment) throw new Error(t('composerAttachmentUnavailable'))
          const image = await prepareImageAttachmentUpload(input.file, capabilities)
          const uploaded = await provider.uploadAttachment({ name: input.file.name, mimeType: image.mimeType,
            dataBase64: image.dataBase64, textFallback: image.textFallback, threadId: sideId,
            ...(workspace ? { workspace } : {}), ...(input.path ? { localFilePath: input.path } : {}) })
          patchDraft(current => ({ ...current, attachments: [...current.attachments, {
            id: uploaded.id, name: uploaded.name, mimeType: uploaded.mimeType, byteSize: uploaded.byteSize,
            width: uploaded.width, height: uploaded.height, previewUrl: `data:${image.mimeType};base64,${image.dataBase64}`
          }] }))
        } else {
          if (mode !== 'deep' || !workspace) throw new Error(t('sideChatFileNeedsDeep'))
          const reference = await importComposerWorkspaceAttachment(input, { workspaceRoot: workspace, threadId: sideId,
            getPathForFile: window.sciforge.getPathForFile, writeWorkspaceFile: window.sciforge.writeWorkspaceFile })
          patchDraft(current => ({ ...current, files: [...current.files, reference] }))
        }
      }
    } catch (error) { patchDraft(current => ({ ...current, error: error instanceof Error ? error.message : String(error) })) }
    finally { patchDraft(current => ({ ...current, busy: false })) }
  }
  const send = async (): Promise<void> => {
    const sent = await shared.sendSideMessage(sideId, side.input, {
      attachmentIds: draft.attachments.map(a => a.id),
      ...(mode === 'deep' ? { fileReferences: draft.files.map(file => ({
        path: file.path ?? file.relativePath, relativePath: file.relativePath, name: file.name,
        ...(file.workspaceRoot ? { workspaceRoot: file.workspaceRoot } : {})
      })) } : {})
    })
    if (sent) patchDraft(() => emptyAttachments())
  }
  const previewHandoff = (): void => {
    setHandoffs(current => ({ ...current, [sideId]: current[sideId] ?? {
      document: sideConversationHandoffDraft(side), memory: '', instruction: t('sideChatHandoffDefaultInstruction')
    } }))
    setHandoffOpen(true); setHandoffError(''); setNotice('')
  }
  const sendHandoff = async (): Promise<void> => {
    if (!handoff || !onHandoff) return
    setHandoffBusy(true); setHandoffError('')
    try {
      const ok = await onHandoff({ sideId, parentThreadId: side.parentThreadId, runtimeId,
        title: side.title, document: handoff.document, instruction: handoff.instruction,
        memoryRefs: handoff.memory.split('\n').map(line => line.trim()).filter(Boolean) })
      if (!ok) throw new Error(t('sideChatHandoffFailed'))
      setHandoffOpen(false); setNotice(t('sideChatHandoffSent'))
    } catch (error) { setHandoffError(error instanceof Error ? error.message : String(error)) }
    finally { setHandoffBusy(false) }
  }
  const patchHandoff = (patch: Partial<NonNullable<typeof handoff>>): void => {
    setHandoffs(current => ({ ...current, [sideId]: { ...current[sideId], ...patch } }))
  }
  return <>
    <div className="shrink-0 space-y-2 border-b border-ds-border px-3 py-2">
      <div className="flex items-center gap-2"><SideModePicker mode={mode}
        disabled={side.busy || Boolean(side.queuedMessages?.length) || draft.busy}
        onChange={value => shared.setSideChatMode(sideId, value)} />
        {onHandoff ? <button className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ds-muted hover:bg-ds-hover"
          disabled={side.busy || !side.blocks.some(block => block.kind === 'assistant')}
          onClick={previewHandoff}><ArrowUpToLine size={13} />{t('sideChatHandoff')}</button> : null}
      </div>
      <div className="text-[11px] text-ds-muted">{t(mode === 'light' ? 'sideChatLightDescription' : 'sideChatDeepDescription')}</div>
      {side.context ? <details className="rounded-md border border-ds-border px-2 py-1 text-xs">
        <summary className="cursor-pointer truncate text-ds-muted">{side.context.title}</summary>
        <p className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-xs text-ds-muted">{side.context.text}</p>
      </details> : null}
    </div>
    {handoffOpen && handoff ? <SideConversationHandoffEditor value={handoff} error={handoffError} busy={handoffBusy} onChange={patchHandoff} onCancel={() => setHandoffOpen(false)} onSend={() => void sendHandoff()} /> : <>
      <MessageTimeline blocks={side.blocks} liveReasoning={side.liveReasoning} live={side.liveAssistant}
        emptyPresentation="conversation"
        activeThreadId={sideId} runtimeConnection={shared.runtimeConnection} runtimeError={side.error}
        runtimeIdOverride={runtimeId} workspaceRootOverride={workspace}
        onRetryConnection={() => void shared.probeRuntime('user')} onOpenSettings={() => shared.setRoute('settings')}
        busyOverride={side.busy} currentTurnUserIdOverride={side.userItemId}
        turnStartedAtByUserIdOverride={{}} turnDurationByUserIdOverride={{}}
        turnReasoningFirstAtByUserIdOverride={{}} turnReasoningLastAtByUserIdOverride={{}} />
      {side.error || notice ? <p role="status" className="mx-3 mb-2 text-xs text-ds-muted">{side.error || notice}</p> : null}
      <div className="shrink-0 border-t border-ds-border p-2">
        <FloatingComposer variant="compact" threadIdOverride={sideId} disableThreadManagementCommands hideBtwCommand
          input={side.input} setInput={value => shared.setSideInput(sideId, value)} mode="agent" setMode={() => undefined}
          busy={side.busy} runtimeReady={shared.runtimeConnection === 'ready' && Boolean(runtimeId)} hasActiveThread
          composerModel={side.model} composerPickList={matchingRuntime ? shared.composerPickList : [side.model].filter(Boolean)}
          composerModelGroups={matchingRuntime ? shared.composerModelGroups : []}
          activeAgentRuntime={runtimeId} runtimeLocked runtimeSessionLocked
          composerReasoningEffort={side.reasoningEffort} onComposerModelChange={model => shared.setSideModel(sideId, model)}
          onComposerReasoningEffortChange={effort => shared.setSideReasoningEffort(sideId, effort)}
          queuedMessages={side.queuedMessages ?? []} onRemoveQueuedMessage={id => void shared.removeSideQueuedMessage(sideId, id)}
          attachments={draft.attachments} attachmentUploadEnabled={matchingRuntime} attachmentUploadBusy={draft.busy} attachmentUploadError={draft.error}
          onPickAttachments={inputs => void pickAttachments(inputs)} onRemoveAttachment={id => patchDraft(current => ({ ...current, attachments: current.attachments.filter(a => a.id !== id) }))}
          fileReferenceEnabled={mode === 'deep' && Boolean(workspace)} fileReferences={mode === 'deep' ? draft.files : []}
          onAddFileReference={file => patchDraft(current => ({ ...current, files: [...current.files.filter(f => f.relativePath !== file.relativePath || f.workspaceRoot !== file.workspaceRoot), file] }))}
          onRemoveFileReference={(path, root) => patchDraft(current => ({ ...current, files: current.files.filter(f => f.relativePath !== path || (root !== undefined && f.workspaceRoot !== root)) }))}
          workspaceRootOverride={workspace} preferWorkspaceRootOverride onSend={() => void send()} onInterrupt={() => void shared.interruptSide(sideId)} />
      </div>
    </>}
  </>
}

export function SideConversationPanel({ className, rightOffset = 12, dockAvailable = false, onHandoff }: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const [draftInput, setDraftInput] = useState('')
  const [draftMode, setDraftMode] = useState<SideChatMode>('light')
  const [draftBusy, setDraftBusy] = useState(false)
  const [draftError, setDraftError] = useState('')
  const [draftModel, setDraftModel] = useState('')
  const panel = useChatStore(s => s.sidePanel)
  const activeSide = useChatStore(s => panel.activeSideId ? s.sideConversations[panel.activeSideId] ?? null : null)
  const ids = useChatStore(useShallow(visibleSideIds))
  const state = useChatStore(useShallow(s => ({ activeThreadId: s.activeThreadId, workspaceRoot: s.workspaceRoot,
    runtimeConnection: s.runtimeConnection, activeAgentRuntime: s.activeAgentRuntime,
    composerModel: s.composerModel, composerPickList: s.composerPickList, composerModelGroups: s.composerModelGroups,
    spawnSideConversation: s.spawnSideConversation, setSidePanelOpen: s.setSidePanelOpen,
    openSideConversationDraft: s.openSideConversationDraft, selectSideConversation: s.selectSideConversation,
    setSideModel: s.setSideModel, promoteSideConversation: s.promoteSideConversation,
    discardSideConversation: s.discardSideConversation
  })))
  const title = useChatStore(s => s.threads.find(thread => thread.id === (activeSide?.parentThreadId ?? s.activeThreadId))?.title)
  const sideOptions = useChatStore(useShallow(s => [...new Set([...ids, ...(activeSide ? [activeSide.threadId] : [])])]
    .map(id => `${id}\u0000${s.sideConversations[id]?.title ?? id}`)))
  const edge = useEdgePanel({ storageKey: 'sciforge.layout.sideChatBehavior', open: panel.open, onOpenChange: state.setSidePanelOpen })
  const docked = dockAvailable && edge.behavior === 'pinned' && panel.open
  const setPanelOpen = state.setSidePanelOpen
  useEffect(() => {
    if (!panel.open) return
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) setPanelOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [panel.open, setPanelOpen])
  if (!state.activeThreadId && !activeSide) return null
  const sendDraft = async (): Promise<void> => {
    if (!draftInput.trim()) return
    setDraftBusy(true); setDraftError('')
    try {
      const id = await state.spawnSideConversation(undefined, { chatMode: draftMode })
      if (!id) throw new Error(t('sideChatCreateFailed'))
      if (draftModel) state.setSideModel(id, draftModel)
      const sent = await useChatStore.getState().sendSideMessage(id, draftInput)
      if (sent) setDraftInput('')
      else useChatStore.getState().setSideInput(id, draftInput)
    } catch (error) { setDraftError(error instanceof Error ? error.message : String(error)) }
    finally { setDraftBusy(false) }
  }
  return <>
    {edge.edgeVisible ? <button {...edge.edgeProps} className="ds-no-drag absolute inset-y-16 right-0 z-[85] w-3 hover:bg-ds-hover focus-visible:bg-ds-hover"
      aria-label={t('sidePanelExpand')}><span className="absolute right-1 top-1/2 h-8 w-1 rounded-full bg-ds-border" /></button> : null}
    <div ref={edge.panelRef} {...edge.panelProps} role="complementary" aria-label={t('sidePanelTitle')}
      inert={!panel.open} aria-hidden={!panel.open}
      data-side-chat-presentation={docked ? 'docked' : 'overlay'}
      className={`ds-side-chat ds-no-drag z-[80] flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-ds-border bg-ds-card text-ds-ink shadow-xl [&_.ds-message-timeline-content]:px-3 [&_.ds-message-timeline-content]:pt-4 [&_.ds-message-timeline-content]:pb-4 ${docked ? 'relative mx-3 my-3 shrink-0' : 'absolute bottom-4 top-[64px]'} ${!panel.open ? 'invisible pointer-events-none' : ''} ${className ?? ''}`}
      style={docked ? { width: SIDE_CONVERSATION_WIDTH } : { width: SIDE_CONVERSATION_WIDTH, maxWidth: 'calc(100% - 24px)', right: `min(${Math.max(12, rightOffset)}px, max(12px, calc(100% - 464px)))` }}>
      <header className="flex shrink-0 items-center gap-2 border-b border-ds-border px-3 py-2">
        <MessageCircleMore className="h-4 w-4 text-accent" />
        <div className="min-w-0 flex-1"><div className="flex items-center gap-1 text-sm font-medium">
          {sideOptions.length ? <select className="max-w-full truncate bg-transparent text-sm" value={activeSide?.threadId ?? ''}
            aria-label={t('sidePanelTitle')} onChange={e => e.target.value ? state.selectSideConversation(e.target.value) : state.openSideConversationDraft()}>
            <option value="">{t('sidePanelNew')}</option>{sideOptions.map(option => { const [id, label] = option.split('\u0000'); return <option key={id} value={id}>{label}</option> })}
          </select> : t('sidePanelTitle')}
        </div><div className="truncate text-[11px] text-ds-muted">{title ?? t('sidePanelParentMissing')}</div></div>
        <select aria-label={t('sideChatLayout')} value={edge.behavior} onChange={e => edge.setBehavior(e.target.value as EdgePanelBehavior)}
          className="max-w-24 rounded-md border border-ds-border bg-ds-card p-1 text-[10px] text-ds-muted">
          <option value="pinned">{t('sideChatPinned')}</option><option value="auto">{t('sideChatAuto')}</option><option value="hidden">{t('sideChatHidden')}</option>
        </select>
        {activeSide ? <details className="relative">
          <summary className="cursor-pointer list-none rounded px-1 text-ds-muted hover:bg-ds-hover" aria-label={t('sidePanelMore')}>···</summary>
          <div className="absolute right-0 top-full z-10 mt-2 w-40 rounded-lg border border-ds-border bg-ds-card p-1 shadow-lg">
            <button className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-ds-hover"
              onClick={() => void state.promoteSideConversation(activeSide.threadId)}>{t('sidePanelPromote')}</button>
            <button className="w-full rounded px-2 py-1.5 text-left text-xs text-red-600 hover:bg-ds-hover"
              onClick={() => void state.discardSideConversation(activeSide.threadId)}>{t('sidePanelDiscardTitle')}</button>
          </div>
        </details> : null}
        <button onClick={state.openSideConversationDraft} className="rounded p-1 text-ds-muted hover:bg-ds-hover" aria-label={t('sidePanelNew')}><Plus size={15} /></button>
        <button onClick={() => state.setSidePanelOpen(false)} className="rounded p-1 text-ds-muted hover:bg-ds-hover" aria-label={t('sidePanelHide')}><X size={15} /></button>
      </header>
      {activeSide ? <SideConversationView sideId={activeSide.threadId} onHandoff={onHandoff} /> : <>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <SideModePicker mode={draftMode} onChange={setDraftMode} disabled={draftBusy} />
          <p className="text-xs text-ds-muted">{t(draftMode === 'light' ? 'sideChatLightDescription' : 'sideChatDeepDescription')}</p>
          {draftError ? <p role="alert" className="text-xs text-red-600">{draftError}</p> : null}
        </div>
        <div className="shrink-0 border-t border-ds-border p-2"><FloatingComposer variant="compact" threadIdOverride={null}
          disableThreadManagementCommands hideBtwCommand input={draftInput} setInput={setDraftInput} mode="agent" setMode={() => undefined}
          busy={draftBusy} runtimeReady={state.runtimeConnection === 'ready'} hasActiveThread={Boolean(state.activeThreadId)}
          composerModel={draftModel || state.composerModel} composerPickList={state.composerPickList} composerModelGroups={state.composerModelGroups}
          onComposerModelChange={setDraftModel} activeAgentRuntime={state.activeAgentRuntime} runtimeLocked
          queuedMessages={[]} onRemoveQueuedMessage={() => undefined} workspaceRootOverride={state.workspaceRoot} preferWorkspaceRootOverride
          onSend={() => void sendDraft()} onInterrupt={() => undefined} />
        </div>
      </>}
    </div>
  </>
}
