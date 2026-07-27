import { useEffect, useMemo, useRef, useState } from 'react'
import {
  sddDraftFolderFromRelativePath,
  sddDraftTraceRelativePath
} from '@shared/sdd'
import {
  applySddDerivedStatuses,
  type SddTraceSnapshot
} from '@shared/sdd-trace'
import { buildPlanRelativePath } from '@shared/gui-plan'
import { useChatStore } from '../store/chat-store'
import type { ChatState } from '../store/chat-store-types'
import type { ThreadTodoList } from '../agent/types'
import { guiPlanSession, useGuiPlanStore } from '../plan/plan-store'
import { selectSddDraftSession, useSddDraftStore } from './sdd-draft-store'
import { computeSddTrace, type SddTraceResult } from './sdd-trace-compute'

function normalizeRoot(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function parseTraceSnapshot(raw: string): SddTraceSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as SddTraceSnapshot
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.planRelativePath !== 'string') return null
    if (!parsed.requirementHashes || typeof parsed.requirementHashes !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

export function sddPlanRelativePathForDraft(draftRelativePath: string): string | null {
  const folder = sddDraftFolderFromRelativePath(draftRelativePath)
  if (!folder) return null
  return buildPlanRelativePath(`sdd-${folder}`)
}

export function threadTodosForSession(
  state: Pick<ChatState, 'activeThreadId' | 'activeThreadTodos' | 'threads'>,
  ownerSessionId: string
): ThreadTodoList | null {
  return state.activeThreadId === ownerSessionId
    ? state.activeThreadTodos
    : (state.threads.find((thread) => thread.id === ownerSessionId)?.todos ?? null)
}

export function useSddTrace(input: {
  ownerSessionId: string
  workspaceRoot: string
  draftRelativePath: string | null
}): SddTraceResult | null {
  const workspaceRoot = normalizeRoot(input.workspaceRoot)
  const draftRelativePath = input.draftRelativePath
  const planRelativePath = useMemo(
    () => (draftRelativePath ? sddPlanRelativePathForDraft(draftRelativePath) : null),
    [draftRelativePath]
  )
  const threadTodos = useChatStore((state) => threadTodosForSession(state, input.ownerSessionId))
  const planSession = useGuiPlanStore((state) => guiPlanSession(state, input.ownerSessionId))
  const activePlan = planSession.activePlan
  const planIsActive = Boolean(
    activePlan &&
      planRelativePath &&
      activePlan.relativePath === planRelativePath &&
      normalizeRoot(activePlan.workspaceRoot) === workspaceRoot
  )

  const [diskRequirement, setDiskRequirement] = useState<string | null>(null)
  const [diskPlan, setDiskPlan] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<SddTraceSnapshot | null>(null)
  const todosVersion = threadTodos?.updatedAt ?? ''

  useEffect(() => {
    if (!workspaceRoot || !draftRelativePath || !planRelativePath) {
      setDiskRequirement(null)
      setDiskPlan(null)
      setSnapshot(null)
      return
    }
    let cancelled = false
    const load = async (): Promise<void> => {
      if (typeof window.sciforge?.readWorkspaceFile !== 'function') return
      const requirement = await window.sciforge
        .readWorkspaceFile({ workspaceRoot, path: draftRelativePath })
        .catch(() => null)
      if (!cancelled) setDiskRequirement(requirement?.ok ? requirement.content : null)
      if (!planIsActive) {
        const plan = await window.sciforge
          .readWorkspaceFile({ workspaceRoot, path: planRelativePath })
          .catch(() => null)
        if (!cancelled) setDiskPlan(plan?.ok ? plan.content : null)
      }
      const tracePath = sddDraftTraceRelativePath(draftRelativePath)
      if (tracePath) {
        const trace = await window.sciforge
          .readWorkspaceFile({ workspaceRoot, path: tracePath })
          .catch(() => null)
        if (!cancelled) setSnapshot(trace?.ok ? parseTraceSnapshot(trace.content) : null)
      } else if (!cancelled) {
        setSnapshot(null)
      }
    }
    void load()
    const timer = window.setInterval(() => {
      void load()
    }, 5_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [workspaceRoot, draftRelativePath, planRelativePath, planIsActive, todosVersion])

  const requirementMarkdown = diskRequirement
  const planMarkdown = planIsActive ? planSession.content : diskPlan
  const result = useMemo(() => {
    if (!requirementMarkdown || !planRelativePath) return null
    return computeSddTrace({
      requirementMarkdown,
      planMarkdown: planMarkdown ?? null,
      planRelativePath,
      threadTodos,
      traceSnapshot: snapshot
    })
  }, [requirementMarkdown, planMarkdown, planRelativePath, threadTodos, snapshot])

  const writebackBusyRef = useRef(false)
  useEffect(() => {
    if (!result || !requirementMarkdown || !draftRelativePath) return
    if (Object.keys(result.derivedStatuses).length === 0) return
    if (writebackBusyRef.current) return
    const next = applySddDerivedStatuses(requirementMarkdown, result.derivedStatuses)
    if (next === requirementMarkdown) return

    writebackBusyRef.current = true
    const run = async (): Promise<void> => {
      try {
        const draftState = useSddDraftStore.getState()
        const draftSession = selectSddDraftSession(draftState, input.ownerSessionId)
        const editorOwnsTarget = Boolean(
          draftSession &&
            draftSession.draft.relativePath === draftRelativePath &&
            normalizeRoot(draftSession.draft.workspaceRoot) === workspaceRoot
        )
        if (
          editorOwnsTarget &&
          (draftSession?.saveStatus === 'dirty' || draftSession?.saveStatus === 'saving')
        ) {
          return
        }
        if (typeof window.sciforge?.writeWorkspaceFile !== 'function') return
        const written = await window.sciforge.writeWorkspaceFile({
          workspaceRoot,
          path: draftRelativePath,
          content: next
        })
        if (written.ok) setDiskRequirement(next)
      } finally {
        writebackBusyRef.current = false
      }
    }
    void run()
  }, [result, requirementMarkdown, draftRelativePath, workspaceRoot, input.ownerSessionId])

  return result
}
