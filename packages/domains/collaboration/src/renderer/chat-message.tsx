import React, { useEffect, useState, type ReactElement } from 'react'
import type { DomainRendererChatMessageRenderContext, DomainRendererChatMessageValue } from '@sciforge/domain-sdk/renderer'
import { parseWorkerRuntimeResult } from '../worker-runtime-result.js'
import type { WorkerDeliveryReadInput, WorkerDeliveryView } from '../worker-delivery.js'
import type { CollaborationRendererClient } from './collaboration-capability-client.js'

type DeliveryReader = Pick<CollaborationRendererClient, 'readWorkerDelivery'>
type TaskMessage = Readonly<{
  title: string
  objective: string
  completionCriteria: readonly string[]
  revisionInstruction?: string
  protocol: string
}>

const criteriaMarker = '\n\nCompletion criteria:\n'
const revisionMarker = '\n\nCoordinator revision request:\n'
const responseMarker = 'Return exactly one JSON object and no Markdown fence.'
const protocolMarkers = ['Workspace file contract:', 'Design-analysis-only collaboration task report:', responseMarker]

/** Recognizes only the package's existing deterministic prompt layout. */
export function parseCollaborationTaskMessage(rawText: string): TaskMessage | null {
  if (!rawText.startsWith('Project Task: ')) return null
  const headerEnd = rawText.indexOf('\n\n')
  if (headerEnd < 0) return null
  const title = rawText.slice('Project Task: '.length, headerEnd)
  const sections = rawText.slice(headerEnd + 2).split(criteriaMarker)
  if (sections.length !== 2 || !title.trim() || title.includes('\n')) return null
  const objectives = sections[0].split(revisionMarker)
  if (objectives.length > 2 || objectives.some((value) => !value.trim())) return null
  const boundaries = protocolMarkers.map((marker) => sections[1].indexOf(`\n\n${marker}`)).filter((index) => index >= 0)
  if (boundaries.length === 0) return null
  const criteriaEnd = Math.min(...boundaries)
  const criteria = sections[1].slice(0, criteriaEnd).split('\n')
  const completionCriteria: string[] = []
  for (const criterion of criteria) {
    const numbered = /^(\d+)\. (.*)$/u.exec(criterion)
    if (numbered) {
      if (Number(numbered[1]) !== completionCriteria.length + 1 || !numbered[2].trim()) return null
      completionCriteria.push(numbered[2])
    } else if (completionCriteria.length) {
      completionCriteria[completionCriteria.length - 1] += `\n${criterion}`
    } else return null
  }
  const protocol = sections[1].slice(criteriaEnd + 2)
  if (!protocol.split('\n').includes(responseMarker)) return null
  return { title, objective: objectives[0], completionCriteria, protocol,
    ...(objectives[1] ? { revisionInstruction: objectives[1] } : {}) }
}

function taskIdentity(metadata: DomainRendererChatMessageRenderContext['message']['metadata']): WorkerDeliveryReadInput | null {
  if (metadata?.source !== 'collaboration.worker-task') return null
  const { projectId, taskId, executionId } = metadata
  if (typeof projectId !== 'string' || !projectId.trim() || typeof taskId !== 'string' || !taskId.trim() ||
    typeof executionId !== 'string' || !executionId.trim()) return null
  return { projectId, taskId, executionId }
}

export function deliveryConfirmsWorkerResult(
  delivery: WorkerDeliveryView,
  identity: WorkerDeliveryReadInput,
  turnId: string,
  summary: string
): boolean {
  const draft = delivery.draft
  return delivery.projectId === identity.projectId && delivery.taskId === identity.taskId &&
    delivery.executionId === identity.executionId && draft?.sourceTurnId === turnId &&
    (draft.aiSummary === summary || draft.summary === summary)
}

const cardClassName = 'min-w-0 space-y-3 rounded-xl border border-ds-border bg-ds-surface-subtle p-4 text-ds-text'
const disclosureClassName = 'border-t border-ds-border-muted pt-3'
const disclosureSummaryClassName = 'cursor-pointer text-ds-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ds-accent'
const bodyClassName = 'whitespace-pre-wrap break-words'
const rawClassName = 'mt-3 whitespace-pre-wrap break-words font-mono text-inherit'

function TaskMessageCard({ task }: Readonly<{ task: TaskMessage }>): ReactElement {
  return <section className={cardClassName} data-testid="collaboration-task-message" aria-label="协作任务说明">
    <h3 className="font-semibold">协作任务说明</h3>
    <dl className="space-y-3">
      <div><dt className="font-semibold">标题</dt><dd className={bodyClassName}>{task.title}</dd></div>
      <div><dt className="font-semibold">目标</dt><dd className={bodyClassName}>{task.objective}</dd></div>
      {task.revisionInstruction ? <div><dt className="font-semibold">返修意见</dt><dd className={bodyClassName}>{task.revisionInstruction}</dd></div> : null}
      <div><dt className="font-semibold">完成标准</dt><dd><ol className="list-decimal space-y-1 pl-5">
        {task.completionCriteria.map((criterion, index) => <li key={index} className={bodyClassName}>{criterion}</li>)}
      </ol></dd></div>
    </dl>
    <details className={disclosureClassName} data-testid="collaboration-task-protocol">
      <summary className={disclosureSummaryClassName}>系统格式要求</summary>
      <pre className={rawClassName}>{task.protocol}</pre>
    </details>
  </section>
}

function WorkerResultCard({ client, identity, turnId, summary, rawText }: Readonly<{
  client: DeliveryReader
  identity: WorkerDeliveryReadInput
  turnId: string
  summary: string
  rawText: string
}>): ReactElement {
  const [updated, setUpdated] = useState(false)
  const { projectId, taskId, executionId } = identity
  useEffect(() => {
    const abort = new AbortController()
    const deadline = setTimeout(() => { abort.abort() }, 30_000)
    let timer: ReturnType<typeof setTimeout> | undefined
    // The assistant final can precede TaskAdapter postflight. Read only the
    // existing capability and bound retries; a parsed result is never proof.
    const read = async (attempt: number): Promise<void> => {
      try {
        const { delivery } = await client.readWorkerDelivery({ projectId, taskId, executionId }, { signal: abort.signal })
        if (abort.signal.aborted) return
        if (deliveryConfirmsWorkerResult(delivery, { projectId, taskId, executionId }, turnId, summary)) {
          setUpdated(true)
        } else if (attempt < 20 && delivery.state === 'executing') {
          timer = setTimeout(() => { void read(attempt + 1) }, 500)
        }
      } catch { /* The result remains readable without asserting a draft write. */ }
    }
    void read(0)
    return () => { abort.abort(); clearTimeout(timer); clearTimeout(deadline) }
  }, [client, projectId, taskId, executionId, turnId, summary])
  return <section className={cardClassName} data-testid="collaboration-result-message" aria-label="结果说明">
    <h3 className="font-semibold">结果说明</h3>
    <p className={bodyClassName} data-testid="collaboration-result-summary">{summary}</p>
    {updated ? <p className="text-ds-text-muted" data-testid="collaboration-result-updated" role="status">已更新交付草稿</p> : null}
    <details className={disclosureClassName} data-testid="collaboration-result-json">
      <summary className={disclosureSummaryClassName}>原始 JSON</summary>
      <pre className={rawClassName}>{rawText}</pre>
    </details>
  </section>
}

/** One read-only body contribution; all Session actions retain original text. */
export function createCollaborationChatMessageContribution(client: DeliveryReader): DomainRendererChatMessageValue<ReactElement> {
  return Object.freeze({
    render: (context) => {
      if (context.streaming) return null
      if (context.message.role === 'user') {
        if (!taskIdentity(context.message.metadata)) return null
        const task = parseCollaborationTaskMessage(context.message.rawText)
        return task ? <TaskMessageCard task={task} /> : null
      }
      const identity = taskIdentity(context.relatedInput?.metadata)
      if (!identity || !context.runtimeId || !context.threadId || !context.turnId ||
        !context.turnLifecycle || context.turnLifecycle.phase === 'active') return null
      let result
      try { result = parseWorkerRuntimeResult(context.message.rawText) } catch { return null }
      if (result.outcome !== 'completed') return null
      return <WorkerResultCard key={`${identity.executionId}:${context.turnId}:${context.message.id}:${result.summary}`}
        client={client} identity={identity} turnId={context.turnId} summary={result.summary} rawText={context.message.rawText} />
    }
  })
}
