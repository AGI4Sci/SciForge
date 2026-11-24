import { collaborationFailureMessage, stripCapabilityEnvelope } from './collaboration-errors.js'
import { translateWorkspace } from './workspace-i18n.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CollaborationRendererClient } from '../collaboration-capability-client.js'
import type { WorkerDeliveryView } from '../../worker-delivery.js'

type Material = { relativePath: string; source?: 'member' | 'attachment' }
type Edit = { summary: string; selectedMaterials?: Material[]; declaredMaterial?: Material | null; sequence: number; aiSummaryDecision?: 'replace' | 'keep' }

/** Coalesces local explanation and material selection writes while preserving edits across AI refreshes and task navigation. */
export function useWorkerDeliveryDraft(
  client: CollaborationRendererClient,
  delivery: WorkerDeliveryView | null,
  onDelivery: (view: WorkerDeliveryView) => void
) {
  const views = useRef(new Map<string, WorkerDeliveryView>())
  const edits = useRef(new Map<string, Edit>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const flights = useRef(new Map<string, Promise<void>>())
  const sequence = useRef(0)
  const changed = useRef(onDelivery)
  changed.current = onDelivery
  const [saveErrors, setSaveErrors] = useState<Record<string, string | undefined>>({})
  const [states, setStates] = useState<Record<string, 'saved' | 'saving' | 'error'>>({})
  if (delivery) {
    const previous = views.current.get(delivery.executionId)
    if (!previous?.draft || !delivery.draft || delivery.draft.revision >= previous.draft.revision) views.current.set(delivery.executionId, delivery)
  }
  const publish = useCallback((view: WorkerDeliveryView) => {
    views.current.set(view.executionId, view)
    changed.current(view)
  }, [])
  const persist = useCallback((executionId: string): Promise<void> => {
    const existing = flights.current.get(executionId)
    if (existing) return existing
    const run = async () => {
      while (edits.current.has(executionId)) {
        const edit = edits.current.get(executionId)!
        const view = views.current.get(executionId)
        if (!view?.draft) throw new Error(translateWorkspace('本机交付草稿尚未准备好。'))
        const identity = { projectId: view.projectId, taskId: view.taskId, executionId }
        let result: Awaited<ReturnType<CollaborationRendererClient['saveWorkerDeliveryDraft']>>
        try {
          result = await client.saveWorkerDeliveryDraft({ ...identity, summary: edit.summary,
            expectedDraftRevision: view.draft.revision,
            ...(edit.declaredMaterial !== undefined ? { declaredMaterial: edit.declaredMaterial } : {}),
            ...(edit.selectedMaterials ? { selectedMaterials: edit.selectedMaterials } : {}),
            ...(edit.aiSummaryDecision ? { aiSummaryDecision: edit.aiSummaryDecision } : {}) })
        } catch (cause) {
          const current = (await client.readWorkerDelivery(identity).catch(() => { throw cause })).delivery
          publish(current)
          // Only a confirmed version conflict warrants repeating this local write.
          if (!current.draft || current.draft.revision === view.draft.revision || !stripCapabilityEnvelope(cause instanceof Error ? cause.message : '').includes('草稿已有更新')) throw cause
          // A decision applies only to the AI explanation the member actually reviewed.
          const decision = current.draft.aiSummary === view.draft.aiSummary ? edit.aiSummaryDecision : undefined
          result = await client.saveWorkerDeliveryDraft({ ...identity, summary: edit.summary,
            expectedDraftRevision: current.draft.revision,
            ...(edit.declaredMaterial !== undefined ? { declaredMaterial: edit.declaredMaterial } : {}),
            ...(edit.selectedMaterials ? { selectedMaterials: edit.selectedMaterials } : {}),
            ...(decision ? { aiSummaryDecision: decision } : {}) })
        }
        publish(result.delivery)
        if (edits.current.get(executionId)?.sequence === edit.sequence) edits.current.delete(executionId)
      }
      setSaveErrors((current) => ({ ...current, [executionId]: undefined }))
      setStates((current) => ({ ...current, [executionId]: 'saved' }))
    }
    const flight = run().catch((cause) => {
      setSaveErrors((current) => ({ ...current, [executionId]: stripCapabilityEnvelope(collaborationFailureMessage(cause, '保存失败，当前修改已保留在此页面')) }))
      setStates((current) => ({ ...current, [executionId]: 'error' }))
      throw cause
    }).finally(() => { flights.current.delete(executionId) })
    flights.current.set(executionId, flight)
    return flight
  }, [client, publish])
  const queue = useCallback((summary: string, aiSummaryDecision?: 'replace' | 'keep', selectedMaterials?: Material[], declaredMaterial?: Material | null) => {
    if (!delivery?.draft) return
    const id = delivery.executionId
    const previous = edits.current.get(id)
    const decision = aiSummaryDecision ?? (previous?.aiSummaryDecision ? 'keep' : undefined)
    edits.current.set(id, { summary, declaredMaterial: declaredMaterial !== undefined ? declaredMaterial : previous?.declaredMaterial, selectedMaterials: selectedMaterials ?? previous?.selectedMaterials, sequence: ++sequence.current,
      ...(decision ? { aiSummaryDecision: decision } : {}) })
    setStates((current) => ({ ...current, [id]: 'saving' }))
    clearTimeout(timers.current.get(id))
    timers.current.set(id, setTimeout(() => { timers.current.delete(id); void persist(id).catch(() => undefined) }, 250))
  }, [delivery, persist])
  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
    for (const id of edits.current.keys()) void persist(id).catch(() => undefined)
  }, [persist])
  const flush = useCallback(async (summary: string): Promise<WorkerDeliveryView> => {
    if (!delivery?.draft) throw new Error(translateWorkspace('本机交付草稿尚未准备好。'))
    const id = delivery.executionId
    if (summary !== (edits.current.get(id)?.summary ?? views.current.get(id)?.draft?.summary)) queue(summary)
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    while (edits.current.has(id) || flights.current.has(id)) await persist(id)
    return views.current.get(id)!
  }, [delivery, persist, queue])
  return {
    summary: delivery ? edits.current.get(delivery.executionId)?.summary ?? delivery.draft?.summary : undefined,
    saveError: delivery ? saveErrors[delivery.executionId] : undefined,
    saveState: delivery?.draft ? states[delivery.executionId] ?? 'saved' as const : undefined,
    onSummaryChange: queue,
    selectedMaterials: delivery ? edits.current.get(delivery.executionId)?.selectedMaterials ?? delivery.draft?.selectedMaterials : undefined,
    onMaterialsChange: (selectedMaterials: Material[]) => {
      if (!delivery?.draft) return
      queue(edits.current.get(delivery.executionId)?.summary ?? delivery.draft.summary, undefined, selectedMaterials)
    },
    onDeclaredMaterialChange: (declaredMaterial: Material | null) => {
      if (!delivery?.draft) return
      queue(edits.current.get(delivery.executionId)?.summary ?? delivery.draft.summary, undefined, undefined, declaredMaterial)
    },
    onAiSummaryDecision: (decision: 'replace' | 'keep', summary: string) => queue(summary, decision),
    flush
  }
}
