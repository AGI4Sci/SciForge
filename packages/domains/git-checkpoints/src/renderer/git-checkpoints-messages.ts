export const GIT_CHECKPOINTS_TRANSLATION_NAMESPACE = 'common'

export const gitCheckpointsMessages = {
  en: {
    gitCheckpointsToolbar: 'Git checkpoints',
    gitCheckpointsTitle: 'Git checkpoints',
    gitCheckpointsRefresh: 'Refresh checkpoints',
    gitCheckpointsCollapse: 'Collapse panel',
    gitCheckpointsCount: '{{count}} checkpoint(s)',
    gitCheckpointsEmpty: 'No Git checkpoints are available for this task.',
    gitCheckpointsNoSession: 'Open a task with a workspace to inspect its checkpoints.',
    gitCheckpointsPreview: 'Checkpoint preview',
    gitCheckpointsPreviewEmpty: 'This checkpoint has no patch preview.',
    gitCheckpointsPatch: 'Workspace patch',
    gitCheckpointsPreviewTruncated: 'The preview was truncated by the version-control provider.',
    gitCheckpointsRestore: 'Restore',
    gitCheckpointsRestoreConfirm: 'Restore this checkpoint? A rescue checkpoint will be captured first.',
    gitCheckpointsRestored: 'Checkpoint restored. Rescue checkpoint: {{id}}',
    gitCheckpointsLoading: 'Loading…'
  },
  zh: {
    gitCheckpointsToolbar: 'Git Checkpoints',
    gitCheckpointsTitle: 'Git Checkpoints',
    gitCheckpointsRefresh: '刷新 Checkpoints',
    gitCheckpointsCollapse: '收起面板',
    gitCheckpointsCount: '共 {{count}} 个 checkpoint',
    gitCheckpointsEmpty: '当前任务没有可用的 Git checkpoint。',
    gitCheckpointsNoSession: '请打开带工作区的任务以查看 checkpoints。',
    gitCheckpointsPreview: 'Checkpoint 预览',
    gitCheckpointsPreviewEmpty: '这个 checkpoint 没有 patch 可预览。',
    gitCheckpointsPatch: '工作区 Patch',
    gitCheckpointsPreviewTruncated: '版本控制提供方已截断预览内容。',
    gitCheckpointsRestore: '恢复',
    gitCheckpointsRestoreConfirm: '恢复这个 checkpoint？系统会先创建救援 checkpoint。',
    gitCheckpointsRestored: 'Checkpoint 已恢复。救援 checkpoint：{{id}}',
    gitCheckpointsLoading: '加载中…'
  }
} as const

Object.freeze(gitCheckpointsMessages.en)
Object.freeze(gitCheckpointsMessages.zh)
Object.freeze(gitCheckpointsMessages)

export type GitCheckpointsI18nResourceContribution = Readonly<{
  namespace: typeof GIT_CHECKPOINTS_TRANSLATION_NAMESPACE
  resources: typeof gitCheckpointsMessages
}>

export const gitCheckpointsI18nResourceContribution:
GitCheckpointsI18nResourceContribution = Object.freeze({
  namespace: GIT_CHECKPOINTS_TRANSLATION_NAMESPACE,
  resources: gitCheckpointsMessages
})
