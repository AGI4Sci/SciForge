export const CHANGE_INSPECTOR_TRANSLATION_NAMESPACE = 'common'

export const changeInspectorMessages = {
  en: {
    changeInspectorToolbar: 'Changes',
    changeInspectorTitle: 'Changes',
    changeInspectorSummary: '{{count}} changed files',
    changeInspectorEmptyTitle: 'No changes yet',
    changeInspectorEmpty: 'This session has not reported any file changes.',
    changeInspectorSelectHint: 'Select a changed file to inspect its diff.',
    changeInspectorStatusRunning: 'Running',
    changeInspectorFilterPlaceholder: 'Filter changed files',
    changeInspectorFilterAll: 'All statuses',
    changeInspectorFilterSuccess: 'Completed',
    changeInspectorFilterRunning: 'Running',
    changeInspectorFilterError: 'Failed',
    changeInspectorNoMatches: 'No changed files match the current filter.',
    changeInspectorLoadFailed: 'Changes could not be loaded.',
    changeInspectorTruncated: 'Showing the newest 5,000 changes.',
    changeInspectorUnknownFile: 'Changed file',
    changeInspectorCollapse: 'Collapse changes',
    changeInspectorCopyDiff: 'Copy diff'
  },
  zh: {
    changeInspectorToolbar: '变更',
    changeInspectorTitle: '变更',
    changeInspectorSummary: '{{count}} 个文件变更',
    changeInspectorEmptyTitle: '还没有变更',
    changeInspectorEmpty: '此会话中尚无文件变更。',
    changeInspectorSelectHint: '选择一个变更文件查看 diff。',
    changeInspectorStatusRunning: '运行中',
    changeInspectorFilterPlaceholder: '筛选变更文件',
    changeInspectorFilterAll: '全部状态',
    changeInspectorFilterSuccess: '已完成',
    changeInspectorFilterRunning: '运行中',
    changeInspectorFilterError: '失败',
    changeInspectorNoMatches: '没有符合当前筛选条件的变更文件。',
    changeInspectorLoadFailed: '无法加载变更。',
    changeInspectorTruncated: '仅显示最新的 5,000 项变更。',
    changeInspectorUnknownFile: '变更文件',
    changeInspectorCollapse: '收起变更',
    changeInspectorCopyDiff: '复制 diff'
  }
} as const

Object.freeze(changeInspectorMessages.en)
Object.freeze(changeInspectorMessages.zh)
Object.freeze(changeInspectorMessages)

export type ChangeInspectorI18nResourceContribution = Readonly<{
  namespace: typeof CHANGE_INSPECTOR_TRANSLATION_NAMESPACE
  resources: typeof changeInspectorMessages
}>

export const changeInspectorI18nResourceContribution:
ChangeInspectorI18nResourceContribution = Object.freeze({
  namespace: CHANGE_INSPECTOR_TRANSLATION_NAMESPACE,
  resources: changeInspectorMessages
})
