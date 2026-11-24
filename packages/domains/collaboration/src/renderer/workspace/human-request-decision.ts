import { translateWorkspace } from './workspace-i18n.js'
import { humanAnswerCommandSchema, type HumanNeeded } from '@sciforge/collaboration-contracts'
import type { ProjectCoordinatorRendererClient } from '../../coordinator/renderer/project-coordinator-capability-client.js'

export type HumanDecision = 'approve' | 'reject'
export type HumanAnswerFeedback = Readonly<{
  projectId: string
  taskId: string
  executionId: string
  userId: string
  humanRequestId: string
  decision?: HumanDecision
}>

/** Compare the reviewed object with fresh facts; Cloud remains the authority. */
export async function answerReviewedHumanRequest(
  client: Pick<ProjectCoordinatorRendererClient, 'readWorkspace' | 'answerHumanNeeded'>,
  reviewed: HumanNeeded,
  userId: string,
  answer: string,
  decision?: HumanDecision,
  selectedOptionId?: string
): Promise<void> {
  const input = { projectId: reviewed.projectId,
    humanRequestId: reviewed.humanRequestId, requestRevision: reviewed.revision,
    answer: humanAnswerCommandSchema.shape.answer.parse(answer),
    ...(decision ? { decision } : {}), ...(selectedOptionId ? { selectedOptionId } : {}) }
  if (Boolean(reviewed.confirmableAction) !== Boolean(decision)) throw new Error(translateWorkspace("请明确批准或拒绝该动作；普通回答不能代替动作决定。"))
  const fresh = await client.readWorkspace({ projectId: reviewed.projectId })
  const project = fresh.projects.find(entry => entry.project.projectId === reviewed.projectId)
  const current = project?.pendingHumanNeeded.find(item => item.humanRequestId === reviewed.humanRequestId)
  if (!current) throw new Error(translateWorkspace("请求已处理或不再可见，请刷新后查看当前任务。"))
  if (fresh.connection.state !== 'ready' || fresh.connection.userId !== userId || reviewed.targetUserId !== userId || current?.targetUserId !== userId) {
    throw new Error(translateWorkspace("当前账户不是这项请求的指定决策人，请刷新后查看。"))
  }
  if (current.status !== 'pending' || reviewed.status !== 'pending' || Date.parse(current.expiresAt) <= Date.now()) {
    throw new Error(translateWorkspace("请求已处理或已过期，请刷新后查看当前任务。"))
  }
  const actionMatches = current.confirmableAction === null && reviewed.confirmableAction === null ||
    current.confirmableAction && reviewed.confirmableAction &&
    (['actionType', 'safeSummary', 'effect', 'actionDigest'] as const).every(key => current.confirmableAction![key] === reviewed.confirmableAction![key])
  if (current.revision !== reviewed.revision || current.prompt !== reviewed.prompt ||
      current.expiresAt !== reviewed.expiresAt || !actionMatches ||
      JSON.stringify(current.context) !== JSON.stringify(reviewed.context) ||
      JSON.stringify(current.interaction) !== JSON.stringify(reviewed.interaction)) {
    throw new Error(translateWorkspace("请求内容已变更，请查看最新动作并重新填写说明后决定。"))
  }
  if (current.context.scope === 'coordinator_project') {
    if (project?.project.coordinatorAuthorityEpoch !== current.context.coordinatorAuthorityEpoch) throw new Error(translateWorkspace('请求内容已变更，请查看最新动作并重新填写说明后决定。'))
    await client.answerHumanNeeded(input)
    return
  }
  const { taskId, executionId } = current.context
  const task = project?.tasks.find(entry => entry.task.taskId === taskId)?.task
  if (!task || task.currentExecutionId !== executionId ||
      !['accepted', 'running', 'needs_human'].includes(task.currentExecutionState ?? '')) {
    throw new Error(translateWorkspace("任务执行已变化，不能提交旧请求的决定。请刷新后查看。"))
  }
  // This capability validates the matching HumanAnswer receipt before returning.
  await client.answerHumanNeeded(input)
}
