import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ChatBlock } from '../agent/types'
import { useChatStore } from '../store/chat-store'
import type { ChatState } from '../store/chat-store-types'
import { buildPlanBuildPrompt, buildRefinePlanPrompt } from '../plan/plan-prompts'
import { buildSddVerifyPrompt } from '../sdd/sdd-verify-prompt'
import { sddDraftRelativePathForPlanPath, sddDraftTraceRelativePath } from '@shared/sdd'
import { buildSddTraceSnapshot, parseSddRequirementBlocks } from '@shared/sdd-trace'
import { CODE_PANEL_PREFERRED } from './workbench-layout'
import {
  createGuiPlanArtifact,
  guiPlanMatchesContext,
  guiPlanSession,
  guiPlanSessionGeneration,
  useGuiPlanStore,
  type GuiPlanArtifact
} from '../plan/plan-store'
import {
  GUI_PLAN_RELATIVE_DIR,
  nextAvailablePlanRelativePath,
  planFeatureNameFromRequest
} from '../plan/plan-path'
import { extractPlanMetadataFromBlock } from '../plan/plan-tool'
import type { RightPanelMode } from './chat/WorkbenchTopBar'
import type { GuiPlanMessageContext, SendMessageOverrides } from '../store/chat-store-types'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'

type PlanResultMatch = {
  blockId: string
  meta: NonNullable<ReturnType<typeof extractPlanMetadataFromBlock>>
}

type PlanTurnOverrides = Pick<
  SendMessageOverrides,
  | 'attachmentIds'
  | 'attachments'
  | 'displayText'
  | 'fileReferences'
  | 'guiPlan'
  | 'model'
  | 'reasoningEffort'
  | 'remoteTargetId'
> & {
  workspaceRoot?: string
}

type WorkbenchPlanControllerOptions = {
  ownerSessionId: string | null
  blocks: ChatBlock[]
  busy: boolean
  mode: 'plan' | 'agent'
  route: ChatState['route']
  sendMessage: ChatState['sendMessage']
  setError: ChatState['setError']
  setMode: Dispatch<SetStateAction<'plan' | 'agent'>>
  setRightPanelMode: Dispatch<SetStateAction<RightPanelMode>>
  setRightSidebarWidth: Dispatch<SetStateAction<number>>
  t: (key: string) => string
  workspaceRoot: string
  onPlanBuildStarted?: (plan: GuiPlanArtifact) => void | Promise<void>
}

function latestSuccessfulPlanBlock(blocks: ChatBlock[]): PlanResultMatch | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.kind !== 'tool' || block.status !== 'success') continue
    const meta = extractPlanMetadataFromBlock(block)
    if (meta) return { blockId: block.id, meta }
  }
  return null
}

export function resolvePlanTurnWorkspaceRoot(
  preferredWorkspaceRoot: string | undefined,
  fallbackWorkspaceRoot: string | undefined
): string {
  return normalizePlanWorkspaceRoot(preferredWorkspaceRoot) || normalizePlanWorkspaceRoot(fallbackWorkspaceRoot)
}

function normalizePlanWorkspaceRoot(value: string | undefined): string {
  return normalizeWorkspaceRoot(value).replaceAll('\\', '/').replace(/\/+$/, '')
}

export function buildGuiPlanTurnOverrides(
  plan: GuiPlanArtifact | null,
  workspaceRoot: string,
  ownerSessionId: string
): { guiPlan?: GuiPlanMessageContext } | undefined {
  if (!plan || !guiPlanMatchesContext(plan, workspaceRoot, ownerSessionId)) return undefined
  return {
    guiPlan: {
      operation: 'refine',
      workspaceRoot: plan.workspaceRoot,
      relativePath: plan.relativePath,
      planId: plan.id,
      sourceRequest: plan.sourceRequest,
      title: plan.featureName
    }
  }
}

export function buildDraftGuiPlanTurnOverrides(input: {
  request: string
  workspaceRoot: string
  ownerSessionId: string
  existingRelativePaths?: Iterable<string>
}): { guiPlan: GuiPlanMessageContext } {
  const sourceRequest = input.request.trim()
  const featureName = planFeatureNameFromRequest(sourceRequest)
  const relativePath = nextAvailablePlanRelativePath(featureName, input.existingRelativePaths ?? [])
  const plan = createGuiPlanArtifact({
    workspaceRoot: input.workspaceRoot,
    threadId: input.ownerSessionId,
    relativePath,
    sourceRequest
  })
  return {
    guiPlan: {
      operation: 'draft',
      workspaceRoot: plan.workspaceRoot,
      relativePath: plan.relativePath,
      planId: plan.id,
      sourceRequest: plan.sourceRequest,
      title: plan.featureName
    }
  }
}

export function buildOwnerPlanSendScope(
  ownerSessionId: string,
  workspaceRoot: string
): Required<Pick<SendMessageOverrides, 'targetThreadId' | 'workspaceRoot'>> {
  return {
    targetThreadId: ownerSessionId.trim(),
    workspaceRoot: normalizePlanWorkspaceRoot(workspaceRoot)
  }
}

export function extractPlanModeOriginalRequest(text: string): string {
  const normalized = text.trim()
  const marker = '## Original User Request'
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex < 0) return normalized
  const afterMarker = normalized.slice(markerIndex + marker.length).trim()
  const nextSectionIndex = afterMarker.search(/\n##\s+/)
  const requestSection = (nextSectionIndex >= 0 ? afterMarker.slice(0, nextSectionIndex) : afterMarker).trim()
  const taggedRequest = requestSection.match(/<user_request>\s*([\s\S]*?)\s*<\/user_request>/i)?.[1]
  const request = (taggedRequest ?? requestSection)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
  return request && request !== '(empty prompt with attachments/context only)' ? request : normalized
}

function ownerIsBusy(ownerSessionId: string, activeBusy: boolean): boolean {
  const state = useChatStore.getState()
  if (state.activeThreadId === ownerSessionId) return activeBusy || state.busy
  const status = state.threads.find((thread) => thread.id === ownerSessionId)?.status?.toLowerCase()
  return status === 'running' || status === 'streaming' || status === 'busy'
}

export function useWorkbenchPlanController({
  ownerSessionId,
  blocks,
  busy,
  mode,
  route,
  sendMessage,
  setError,
  setMode,
  setRightPanelMode,
  setRightSidebarWidth,
  t,
  workspaceRoot,
  onPlanBuildStarted
}: WorkbenchPlanControllerOptions) {
  const activeGuiPlan = useGuiPlanStore((state) =>
    guiPlanSession(state, ownerSessionId).activePlan
  )
  const latestPlanBlock = useMemo(() => latestSuccessfulPlanBlock(blocks), [blocks])
  const planTurnsInFlightRef = useRef(new Set<string>())
  const lastLoadedPlanBlocksRef = useRef(new Map<string, string>())

  const reportOwnerError = useCallback((message: string): void => {
    if (!ownerSessionId) return
    useGuiPlanStore.getState().setOperationStatus(ownerSessionId, 'error', message)
    if (useChatStore.getState().activeThreadId === ownerSessionId) setError(message)
  }, [ownerSessionId, setError])

  const openGuiPlanPanel = useCallback((): void => {
    if (!ownerSessionId) return
    setRightSidebarWidth((width) => Math.max(width, CODE_PANEL_PREFERRED))
    setRightPanelMode('plan')
  }, [ownerSessionId, setRightPanelMode, setRightSidebarWidth])

  const savePlanContentToDisk = async (
    owner: string,
    plan: GuiPlanArtifact,
    contentToSave: string
  ): Promise<boolean> => {
    useGuiPlanStore.getState().setSaveStatus(owner, 'saving')
    try {
      const result = await window.sciforge.writeWorkspaceFile({
        workspaceRoot: plan.workspaceRoot,
        path: plan.relativePath,
        content: contentToSave
      })
      const latest = guiPlanSession(useGuiPlanStore.getState(), owner)
      if (latest.activePlan?.id !== plan.id) return false
      if (!result.ok) {
        useGuiPlanStore.getState().setSaveStatus(owner, 'error', result.message)
        return false
      }
      useGuiPlanStore.getState().markSaved(owner, plan.id, contentToSave)
      return true
    } catch (error) {
      const latest = guiPlanSession(useGuiPlanStore.getState(), owner)
      if (latest.activePlan?.id === plan.id) {
        useGuiPlanStore.getState().setSaveStatus(
          owner,
          'error',
          error instanceof Error ? error.message : String(error)
        )
      }
      return false
    }
  }

  const readExistingPlanRelativePaths = async (
    targetWorkspaceRoot: string
  ): Promise<string[]> => {
    try {
      const result = await window.sciforge.listWorkspaceDirectory({
        workspaceRoot: targetWorkspaceRoot,
        path: GUI_PLAN_RELATIVE_DIR
      })
      if (!result.ok) return []
      return result.entries
        .filter((entry) => entry.type === 'file' && entry.name.toLowerCase().endsWith('.md'))
        .map((entry) => `${GUI_PLAN_RELATIVE_DIR}/${entry.name}`)
    } catch {
      return []
    }
  }

  const sendPlanTurn = async (
    text: string,
    overrides?: PlanTurnOverrides
  ): Promise<boolean> => {
    const owner = ownerSessionId?.trim()
    if (!owner) return false
    const ownerGeneration = guiPlanSessionGeneration(owner)
    const currentPlan = guiPlanSession(useGuiPlanStore.getState(), owner).activePlan
    const targetWorkspaceRoot = resolvePlanTurnWorkspaceRoot(
      overrides?.workspaceRoot,
      workspaceRoot || currentPlan?.workspaceRoot
    )
    if (!targetWorkspaceRoot) {
      reportOwnerError(t('workspaceRequiredToCreateThread'))
      return false
    }
    planTurnsInFlightRef.current.add(owner)
    const planOverrides = buildGuiPlanTurnOverrides(currentPlan, targetWorkspaceRoot, owner)
    const { workspaceRoot: _workspaceRoot, ...messageOverrides } = overrides ?? {}
    const chatAtStart = useChatStore.getState()
    const remoteTargetId = messageOverrides.remoteTargetId ?? (
      chatAtStart.activeThreadId === owner ? chatAtStart.remoteTargetId : undefined
    )
    const sourceRequest = extractPlanModeOriginalRequest(text)
    const guiPlan = messageOverrides.guiPlan ?? planOverrides?.guiPlan ?? buildDraftGuiPlanTurnOverrides({
      request: sourceRequest,
      workspaceRoot: targetWorkspaceRoot,
      ownerSessionId: owner,
      existingRelativePaths: await readExistingPlanRelativePaths(targetWorkspaceRoot)
    }).guiPlan
    if (guiPlanSessionGeneration(owner) !== ownerGeneration) {
      planTurnsInFlightRef.current.delete(owner)
      return false
    }
    try {
      const sent = await sendMessage(text, 'plan', {
        ...messageOverrides,
        ...(remoteTargetId?.trim() ? { remoteTargetId: remoteTargetId.trim() } : {}),
        ...buildOwnerPlanSendScope(owner, targetWorkspaceRoot),
        guiPlan
      })
      if (!sent) planTurnsInFlightRef.current.delete(owner)
      return sent
    } catch (error) {
      planTurnsInFlightRef.current.delete(owner)
      reportOwnerError(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  const loadPlanFromMeta = useCallback(async (
    meta: PlanResultMatch['meta'],
    shouldOpen: boolean
  ): Promise<void> => {
    const owner = ownerSessionId?.trim()
    if (!owner) return
    const ownerGeneration = guiPlanSessionGeneration(owner)
    const result = await window.sciforge.readWorkspaceFile({
      workspaceRoot: meta.workspaceRoot,
      path: meta.relativePath
    })
    if (guiPlanSessionGeneration(owner) !== ownerGeneration) return
    if (!result.ok) {
      useGuiPlanStore.getState().setOperationStatus(owner, 'error', result.message)
      return
    }
    const base = createGuiPlanArtifact({
      workspaceRoot: meta.workspaceRoot,
      threadId: owner,
      relativePath: meta.relativePath,
      absolutePath: meta.absolutePath ?? result.path,
      sourceRequest: meta.sourceRequest ?? ''
    })
    const plan = meta.title?.trim() ? { ...base, featureName: meta.title.trim() } : base
    useGuiPlanStore.getState().setActivePlan(owner, plan, result.content)
    if (shouldOpen && useChatStore.getState().activeThreadId === owner) openGuiPlanPanel()
  }, [openGuiPlanPanel, ownerSessionId])

  const buildGuiPlan = async (): Promise<void> => {
    const owner = ownerSessionId?.trim()
    if (!owner) return
    const snapshot = guiPlanSession(useGuiPlanStore.getState(), owner)
    const plan = snapshot.activePlan
    if (!plan) return
    if (ownerIsBusy(owner, busy)) {
      reportOwnerError(t('composerQueuePlaceholder'))
      return
    }
    const saved = await savePlanContentToDisk(owner, plan, snapshot.content)
    if (!saved) return
    const sent = await sendMessage(buildPlanBuildPrompt(plan.relativePath), 'agent', {
      displayText: `${t('planBuild')}: ${plan.relativePath}`,
      ...buildOwnerPlanSendScope(owner, plan.workspaceRoot)
    })
    if (sent) await onPlanBuildStarted?.(plan)
  }

  const handleGuiPlanCommand = async (request?: string): Promise<void> => {
    const owner = ownerSessionId?.trim()
    if (!owner) return
    if (useChatStore.getState().activeThreadId === owner) setMode('plan')
    if (request?.trim()) await sendPlanTurn(request.trim())
  }

  const verifyGuiPlan = async (): Promise<void> => {
    const owner = ownerSessionId?.trim()
    if (!owner) return
    const plan = guiPlanSession(useGuiPlanStore.getState(), owner).activePlan
    if (!plan) return
    const draftRelativePath = sddDraftRelativePathForPlanPath(plan.relativePath)
    if (!draftRelativePath) return
    if (ownerIsBusy(owner, busy)) {
      reportOwnerError(t('composerQueuePlaceholder'))
      return
    }
    await sendMessage(
      buildSddVerifyPrompt({
        workspaceRoot: plan.workspaceRoot,
        draftRelativePath,
        planRelativePath: plan.relativePath
      }),
      'agent',
      {
        displayText: `${t('planVerify')}: ${draftRelativePath}`,
        ...buildOwnerPlanSendScope(owner, plan.workspaceRoot)
      }
    )
  }

  const replanChangedRequirements = async (changedIds: string[]): Promise<void> => {
    const owner = ownerSessionId?.trim()
    if (!owner || changedIds.length === 0) return
    const snapshot = guiPlanSession(useGuiPlanStore.getState(), owner)
    const plan = snapshot.activePlan
    if (!plan) return
    const draftRelativePath = sddDraftRelativePathForPlanPath(plan.relativePath)
    if (!draftRelativePath) return
    if (ownerIsBusy(owner, busy)) {
      reportOwnerError(t('composerQueuePlaceholder'))
      return
    }

    const requirement = await window.sciforge.readWorkspaceFile({
      workspaceRoot: plan.workspaceRoot,
      path: draftRelativePath
    })
    if (!requirement.ok) {
      reportOwnerError(requirement.message)
      return
    }
    if (guiPlanSession(useGuiPlanStore.getState(), owner).activePlan?.id !== plan.id) return
    const lines = requirement.content.split(/\r?\n/)
    const changedBlocks = parseSddRequirementBlocks(requirement.content)
      .filter((block) => changedIds.includes(block.id))
      .map((block) => lines.slice(block.headingLineIndex, block.endLineIndex).join('\n'))
    const feedback = [
      `Requirements ${changedIds.join(', ')} changed after this plan was generated.`,
      'Update only the steps affected by these requirements. Keep all other steps and their covers tags unchanged, and keep every actionable step linked with a covers tag.',
      '',
      'Latest requirement blocks:',
      '```markdown',
      changedBlocks.join('\n\n'),
      '```'
    ].join('\n')

    const sent = await sendPlanTurn(
      buildRefinePlanPrompt({
        feedback,
        currentPlan: snapshot.content,
        workspaceRoot: plan.workspaceRoot,
        planRelativePath: plan.relativePath
      }),
      {
        displayText: t('sddReplanButton'),
        workspaceRoot: plan.workspaceRoot,
        guiPlan: {
          operation: 'refine',
          workspaceRoot: plan.workspaceRoot,
          relativePath: plan.relativePath,
          planId: plan.id,
          sourceRequest: plan.sourceRequest,
          title: plan.featureName
        }
      }
    )
    if (!sent) return
    const tracePath = sddDraftTraceRelativePath(draftRelativePath)
    if (tracePath) {
      await window.sciforge
        .writeWorkspaceFile({
          workspaceRoot: plan.workspaceRoot,
          path: tracePath,
          content: JSON.stringify(
            buildSddTraceSnapshot(requirement.content, plan.relativePath),
            null,
            2
          )
        })
        .catch(() => undefined)
    }
  }

  useEffect(() => {
    if (route !== 'chat' && mode === 'plan') setMode('agent')
  }, [mode, route, setMode])

  useEffect(() => {
    const owner = ownerSessionId?.trim()
    if (!owner || !latestPlanBlock) return
    if (lastLoadedPlanBlocksRef.current.get(owner) === latestPlanBlock.blockId) return
    lastLoadedPlanBlocksRef.current.set(owner, latestPlanBlock.blockId)
    const shouldOpen = planTurnsInFlightRef.current.has(owner) || mode === 'plan'
    planTurnsInFlightRef.current.delete(owner)
    void loadPlanFromMeta(latestPlanBlock.meta, shouldOpen).catch((error) => {
      useGuiPlanStore.getState().setOperationStatus(
        owner,
        'error',
        error instanceof Error ? error.message : String(error)
      )
    })
  }, [latestPlanBlock, loadPlanFromMeta, mode, ownerSessionId])

  useEffect(() => {
    const owner = ownerSessionId?.trim()
    if (owner && !busy) planTurnsInFlightRef.current.delete(owner)
  }, [busy, ownerSessionId])

  return {
    activeGuiPlan,
    buildGuiPlan,
    handleGuiPlanCommand,
    openGuiPlanPanel,
    replanChangedRequirements,
    sendPlanTurn,
    verifyGuiPlan
  }
}
