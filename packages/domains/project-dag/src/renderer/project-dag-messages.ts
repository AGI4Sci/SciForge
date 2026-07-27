export const PROJECT_DAG_TRANSLATION_NAMESPACE = 'common'

export const projectDagMessages = {
  en: {
    rightPanelProjectDag: 'Project DAG',
    projectDagCurrentProject: 'Current project: {{project}}',
    projectDagGlobalView: 'Project-wide view',
    projectDagUpdate: 'Update now',
    projectDagRefresh: 'Refresh',
    projectDagCollapse: 'Collapse panel',
    projectDagLoading: 'Loading Project DAG…',
    projectDagUnavailable: 'Project DAG is unavailable.',
    projectDagEmpty: 'No committed Project snapshot yet.',
    projectDagCommitted: 'Committed v{{version}}',
    projectDagCommittedAt: 'Committed {{time}}',
    projectDagPendingQueued: 'Queued',
    projectDagPendingRunning: 'Running',
    projectDagPendingRetry: 'Retry scheduled',
    projectDagPendingFailed: 'Latest update failed',
    projectDagAttempt: 'Attempt {{count}}',
    projectDagLastActivity: 'Last activity {{time}}',
    projectDagCommittedLayer: 'Committed snapshot',
    projectDagAttemptLayer: 'Current attempt',
    projectDagAuditWarning: 'Only committed findings are audit eligible.',
    projectDagAttention: '{{count}} need attention',
    projectDagAuditStale: 'Audit target is stale',
    projectDagEvidenceSessions: 'Evidence sessions',
    projectDagOpenEvidence: 'Open Evidence DAG for {{session}}',
    projectDagGoal: 'Project goal',
    projectDagGoalTitle: 'Goal title',
    projectDagGoalDescription: 'Description',
    projectDagGoalSave: 'Save goal',
    projectDagGoalSaved: 'Goal saved.',
    projectDagPreviewInvalid: 'Project DAG evidence preview request is invalid.',
    projectDagPreviewSnapshotMismatch: 'The evidence request does not belong to the committed Project snapshot.',
    projectDagPreviewProvenanceMismatch: 'The resolved evidence does not match the requested provenance.',
    projectDagPreviewRestricted: 'This evidence is restricted by the access policy.',
    projectDagPreviewUnsupported: 'This source is not a previewable workspace file.',
    projectDagPreviewMissing: 'The evidence file is unavailable.',
    projectDagPreviewFailed: 'Unable to verify the claim provenance.'
  },
  zh: {
    rightPanelProjectDag: '项目 DAG',
    projectDagCurrentProject: '当前项目：{{project}}',
    projectDagGlobalView: '项目全局视图',
    projectDagUpdate: '立即更新',
    projectDagRefresh: '刷新',
    projectDagCollapse: '收起面板',
    projectDagLoading: '正在载入 Project DAG…',
    projectDagUnavailable: 'Project DAG 当前不可用。',
    projectDagEmpty: '尚无已提交的 Project 快照。',
    projectDagCommitted: '已提交 v{{version}}',
    projectDagCommittedAt: '提交于 {{time}}',
    projectDagPendingQueued: '已排队',
    projectDagPendingRunning: '执行中',
    projectDagPendingRetry: '等待重试',
    projectDagPendingFailed: '最近一次更新失败',
    projectDagAttempt: '第 {{count}} 次尝试',
    projectDagLastActivity: '最后活动 {{time}}',
    projectDagCommittedLayer: '已提交快照',
    projectDagAttemptLayer: '当前尝试',
    projectDagAuditWarning: '只有已提交的发现可用于审计。',
    projectDagAttention: '{{count}} 项需要关注',
    projectDagAuditStale: '审计目标已过期',
    projectDagEvidenceSessions: '证据会话',
    projectDagOpenEvidence: '打开 {{session}} 的 Evidence DAG',
    projectDagGoal: '项目目标',
    projectDagGoalTitle: '目标标题',
    projectDagGoalDescription: '描述',
    projectDagGoalSave: '保存目标',
    projectDagGoalSaved: '项目目标已保存。',
    projectDagPreviewInvalid: 'Project DAG 的证据预览请求格式无效。',
    projectDagPreviewSnapshotMismatch: '证据请求不属于当前已提交的 Project 快照。',
    projectDagPreviewProvenanceMismatch: '受信解析结果与请求的固定溯源标识不一致。',
    projectDagPreviewRestricted: '该证据受访问策略限制，无法打开。',
    projectDagPreviewUnsupported: '该来源不是 workspace 内可预览的文件。',
    projectDagPreviewMissing: '证据文件不存在或当前不可访问。',
    projectDagPreviewFailed: '无法验证该 Claim 与原始证据的固定溯源关系。'
  }
} as const

Object.freeze(projectDagMessages.en)
Object.freeze(projectDagMessages.zh)
Object.freeze(projectDagMessages)

export type ProjectDagI18nResourceContribution = Readonly<{
  namespace: typeof PROJECT_DAG_TRANSLATION_NAMESPACE
  resources: typeof projectDagMessages
}>

export const projectDagI18nResourceContribution: ProjectDagI18nResourceContribution =
  Object.freeze({
    namespace: PROJECT_DAG_TRANSLATION_NAMESPACE,
    resources: projectDagMessages
  })
