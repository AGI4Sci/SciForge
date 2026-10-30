import type { WorkerDeliveryView } from '../../../worker-delivery.js'
import type { TaskCardModel } from '../workspace-types.js'
import type { DeliveryFileEntry } from '../files/delivery-files.js'
import type { DeliveryDraftData, DeliveryDraftFile } from './delivery-draft-types.js'

export function workerDeliveryPresentation(delivery: WorkerDeliveryView | null | undefined, card: TaskCardModel, members: readonly Readonly<{ userId: string; name: string }>[], deliveryFiles: readonly DeliveryFileEntry[] = []): DeliveryDraftData {
  const candidate = delivery?.candidate
  const localDraft = delivery?.draft
  const deliverySubmitted = delivery?.state === 'sealed'
  const sealed = delivery?.history.find((entry) => entry.deliveryManifestId === delivery.deliveryManifestId)
  const outputs = deliverySubmitted ? candidate?.bundle.outputs ?? [] : localDraft?.outputs ?? []
  const toFile = (file: typeof outputs[number], prefix = ''): DeliveryDraftFile => ({ id: `${prefix}${'relativePath' in file ? file.relativePath : file.fileName}`, name: file.fileName, relativePath: 'relativePath' in file && typeof file.relativePath === 'string' ? file.relativePath : '', mediaType: file.mediaType, byteCount: file.byteCount, source: 'source' in file && (file.source === 'ai' || file.source === 'member' || file.source === 'attachment') ? file.source : 'unknown' })
  return {
    revision: (deliverySubmitted ? candidate?.target.resultRevision : localDraft?.resultRevision) ?? 1,
    summary: deliverySubmitted ? candidate?.bundle.summary ?? '' : localDraft?.summary ?? '',
    state: deliverySubmitted ? 'submitted' : delivery?.state === 'submitting' ? 'submitting' : card.executionFailure ? 'failed' : delivery?.state === 'executing' ? localDraft?.sourceTurnId || localDraft?.summaryEdited || localDraft?.basedOnResultRevision || localDraft?.summary ? 'modifying' : 'generating' : localDraft?.changed ? 'changed' : 'ready',
    submissionProgress: delivery?.submissionProgress,
    editLocked: Boolean(delivery?.operationId) && !deliverySubmitted,
    submitError: delivery?.operationId && delivery.error ? deliverySubmissionError(delivery.error) : undefined,
    materialError: localDraft?.materialError ?? undefined,
    aiSummary: localDraft?.aiSummary ?? undefined,
    source: localDraft?.sourceUpdatedAt ? { round: localDraft.sourceRound, finishedAt: localDraft.sourceUpdatedAt, revision: localDraft.resultRevision } : undefined,
    failureReason: card.executionFailure ? taskFailureReason(card.executionFailure.code) : undefined,
    submittedAt: sealed?.submittedAt ?? deliveryFiles[0]?.submittedAt,
    submitter: members.find((member) => member.userId === sealed?.submittedByUserId)?.name ?? deliveryFiles[0]?.submitter ?? card.assignee ?? undefined,
    declaredFiles: outputs.filter((file) => !('role' in file) || file.role === 'declared').map((file) => toFile(file)),
    additionalFiles: outputs.filter((file) => 'role' in file && file.role === 'member').map((file) => toFile(file)),
    history: delivery?.history.filter((entry) => !deliverySubmitted || entry.deliveryManifestId !== delivery.deliveryManifestId).map((entry) => ({ revision: entry.bundle.resultRevision, summary: entry.bundle.summary,
      submitter: members.find((member) => member.userId === entry.submittedByUserId)?.name ?? card.assignee ?? '成员', submittedAt: entry.submittedAt,
      declaredFiles: entry.bundle.outputs.filter((file) => !('role' in file) || file.role === 'declared').map((file) => toFile(file, `${entry.deliveryManifestId}:`)),
      additionalFiles: entry.bundle.outputs.filter((file) => 'role' in file && file.role === 'member').map((file) => toFile(file, `${entry.deliveryManifestId}:`)) }))
  }
}

function taskFailureReason(code: string): string {
  switch (code) {
    case 'upstream_unavailable': return '模型服务暂时不可用，请稍后重新执行。'
    case 'response_schema_incompatible': return '模型服务返回格式不兼容，请检查模型配置后重新执行。'
    case 'model_capacity': return '模型服务当前繁忙，请稍后重新执行。'
    case 'runtime_connection_interrupted': return '执行连接已中断，请检查连接后重新执行。'
    case 'runtime_interrupted': return '本轮执行已中断，可重新执行或编辑草稿后提交。'
    case 'runtime_cancelled': return '本轮执行已取消。'
    default: return '本轮执行失败，可重新执行或退回任务。'
  }
}

export function deliverySubmissionError(reason: string): string {
  if (/[\p{Script=Han}]/u.test(reason)) return reason
  if (/timed out/iu.test(reason)) return '身份验证服务响应超时，草稿已保留，请稍后再次提交。'
  if (/auth|credential|permission|authority|unauthorized|forbidden/iu.test(reason)) return '当前账户或任务授权已变化，请检查后再次提交。'
  if (/network|fetch|offline|timeout|connection|transport|ECONN|50[0234]/iu.test(reason)) return '网络或服务暂时不可用，草稿已保留，请稍后再次提交。'
  if (/pending|admission|barrier|active.turn/iu.test(reason)) return '会话仍有未完成或待核验的输入，请处理后再次提交。'
  return '提交失败，草稿已保留。请稍后再次提交。'
}
