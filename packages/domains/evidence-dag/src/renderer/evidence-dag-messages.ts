export const EVIDENCE_DAG_TRANSLATION_NAMESPACE = 'common'

export const evidenceDagMessages = {
  en: {
    researchAuditOpen: 'Research progress',
    rightPanelEvidenceDag: 'Research record & evidence',
    evidenceDagHistoricalSearchBounded: 'Historical lookup is limited. Select a specific historical version.',
    evidenceDagMaterialSnapshotMissing: 'This material has no linked saved evidence graph.',
    evidenceDagSnapshotUnavailable: 'This evidence is unavailable or access is restricted.',
    evidenceDagCurrentThread: 'Current session',
    evidenceDagAllThreads: 'Project evidence',
    evidenceDagUpdate: 'Update',
    evidenceDagRebuild: 'Rebuild',
    evidenceDagRefresh: 'Refresh',
    evidenceDagCollapse: 'Collapse panel',
    evidenceDagLoading: 'Loading Evidence DAG…',
    evidenceDagUnavailable: 'Evidence DAG is unavailable.',
    evidenceDagWorkspaceRequired: 'This session has no workspace binding. Select a session with a workspace to view evidence.',
    evidenceDagEmpty: 'No committed Evidence snapshot yet.',
    evidenceDagUpdateQueued: 'Update accepted for {{count}} items.',
    evidenceDagPreviousContentRetained: 'The last published content remains available.',
    evidenceDagCommitted: 'Updated',
    evidenceDagCommittedAt: 'Committed {{time}}',
    evidenceDagPendingQueued: 'Queued',
    evidenceDagPendingRunning: 'Organizing new evidence',
    evidenceDagPendingRetrying: 'Retry scheduled',
    evidenceDagPendingFailed: 'Latest update failed',
    evidenceDagAttempt: 'Attempt {{count}}',
    evidenceDagLastActivity: 'Last activity {{time}}',
    evidenceDagBatchProgress: '{{completed}}/{{total}} batches committed',
    evidenceDagCommittedLayer: 'Committed snapshot',
    evidenceDagAttemptLayer: 'Current attempt',
    evidenceDagAuditWarning: 'Only committed nodes and edges are audit eligible.',
    evidenceDagPreviewInvalid: 'Evidence preview request is invalid.',
    evidenceDagPreviewThreadMismatch: 'The evidence request does not belong to this session.',
    evidenceDagPreviewSnapshotMismatch: 'The evidence request does not belong to the committed snapshot.',
    evidenceDagPreviewProvenanceMismatch: 'The resolved evidence does not match the requested provenance.',
    evidenceDagPreviewDigestMissing: 'The resolved evidence has no verifiable content digest.',
    evidenceDagPreviewRestricted: 'This evidence is restricted by the access policy.',
    evidenceDagPreviewUnsupported: 'This source cannot be opened as a workspace file.',
    evidenceDagPreviewMissing: 'The evidence file is unavailable.',
    evidenceDagPreviewFailed: 'Unable to verify the evidence provenance.'
  },
  zh: {
    researchAuditOpen: '研究进展',
    rightPanelEvidenceDag: '研究记录与证据',
    evidenceDagHistoricalSearchBounded: '历史读取范围受限，请选择具体的历史版本。',
    evidenceDagMaterialSnapshotMissing: '这份材料尚未关联已保存的证据图。',
    evidenceDagSnapshotUnavailable: '暂时无法读取这份依据，或当前没有访问权限。',
    evidenceDagCurrentThread: '当前会话',
    evidenceDagAllThreads: '项目证据',
    evidenceDagUpdate: '更新',
    evidenceDagRebuild: '重建',
    evidenceDagRefresh: '刷新',
    evidenceDagCollapse: '收起面板',
    evidenceDagLoading: '正在载入 Evidence DAG…',
    evidenceDagUnavailable: 'Evidence DAG 当前不可用。',
    evidenceDagWorkspaceRequired: '当前会话未绑定工作区；请选择带工作区的会话以查看证据。',
    evidenceDagEmpty: '暂未生成依据。',
    evidenceDagUpdateQueued: '已接收 {{count}} 项更新。',
    evidenceDagPreviousContentRetained: '当前显示上次结果。',
    evidenceDagCommitted: '已更新',
    evidenceDagCommittedAt: '提交于 {{time}}',
    evidenceDagPendingQueued: '已排队',
    evidenceDagPendingRunning: '正在整理新的依据',
    evidenceDagPendingRetrying: '等待重试',
    evidenceDagPendingFailed: '最近一次更新失败',
    evidenceDagAttempt: '第 {{count}} 次尝试',
    evidenceDagLastActivity: '最后活动 {{time}}',
    evidenceDagBatchProgress: '已提交 {{completed}}/{{total}} 批',
    evidenceDagCommittedLayer: '已提交快照',
    evidenceDagAttemptLayer: '当前尝试',
    evidenceDagAuditWarning: '只有已提交的节点和边可用于审计。',
    evidenceDagPreviewInvalid: 'Evidence DAG 的证据预览请求格式无效。',
    evidenceDagPreviewThreadMismatch: '证据请求不属于当前会话。',
    evidenceDagPreviewSnapshotMismatch: '证据请求不属于当前已提交快照。',
    evidenceDagPreviewProvenanceMismatch: '受信解析结果与请求的固定溯源标识不一致。',
    evidenceDagPreviewDigestMissing: '证据版本缺少可验证的内容摘要。',
    evidenceDagPreviewRestricted: '该证据受访问策略限制，无法打开。',
    evidenceDagPreviewUnsupported: '该来源不能作为 workspace 文件打开。',
    evidenceDagPreviewMissing: '证据文件不存在或当前不可访问。',
    evidenceDagPreviewFailed: '无法验证该证据的固定溯源关系。'
  }
} as const

Object.freeze(evidenceDagMessages.en)
Object.freeze(evidenceDagMessages.zh)
Object.freeze(evidenceDagMessages)

export type EvidenceDagI18nResourceContribution = Readonly<{
  namespace: typeof EVIDENCE_DAG_TRANSLATION_NAMESPACE
  resources: typeof evidenceDagMessages
}>

export const evidenceDagI18nResourceContribution: EvidenceDagI18nResourceContribution =
  Object.freeze({
    namespace: EVIDENCE_DAG_TRANSLATION_NAMESPACE,
    resources: evidenceDagMessages
  })
