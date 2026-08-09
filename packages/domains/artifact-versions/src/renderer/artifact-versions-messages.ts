export const ARTIFACT_VERSIONS_TRANSLATION_NAMESPACE = 'common'

export const artifactVersionsMessages = {
  en: {
    rightPanelArtifactVersions: 'Artifact versions',
    artifactVersionsTitle: 'Artifact history',
    artifactVersionsRefresh: 'Refresh lifecycle and history',
    artifactVersionsCollapse: 'Collapse panel',
    artifactVersionsCount: '{{count}} version(s)',
    artifactVersionsEmpty: 'No versioned artifacts are available in this workspace.',
    artifactVersionsNoWorkspace: 'Open a task with a workspace to inspect artifact history.',
    artifactVersionsLoading: 'Loading artifact history…',
    artifactVersionsCurrent: 'current',
    artifactVersionsSnapshot: 'snapshot',
    artifactVersionsReference: 'reference',
    artifactVersionsAvailable: 'available',
    artifactVersionsUnavailable: 'unavailable',
    artifactVersionsRemote: 'remote',
    artifactVersionsCreated: 'Created',
    artifactVersionsParent: 'Parent',
    artifactVersionsRootVersion: 'root version',
    artifactVersionsDigest: 'Digest',
    artifactVersionsStorage: 'Storage',
    artifactVersionsDependencies: 'Dependencies ({{count}})',
    artifactVersionsOptional: 'optional',
    artifactVersionsNoDependencies: 'No pinned dependencies.',
    artifactVersionsCompareParent: 'Compare parent',
    artifactVersionsCompareCurrent: 'Compare current',
    artifactVersionsMaterialize: 'Materialize',
    artifactVersionsMaterializeConfirm: 'Materialize this immutable version to {{path}}?',
    artifactVersionsMaterialized: 'Materialized verified bytes to {{path}}.',
    artifactVersionsRestoreAsNew: 'Restore as new',
    artifactVersionsRestoreConfirm: 'Restore version {{version}} as a new current version? History will not be overwritten.',
    artifactVersionsRestored: 'Restored as new version {{version}}.',
    artifactVersionsExportBundle: 'Export bundle',
    artifactVersionsExportDenied: 'At least one version denies export.',
    artifactVersionsVerifyBundle: 'Verify',
    artifactVersionsBundleVerified: 'Bundle integrity verified.',
    artifactVersionsBundleInvalid: 'Bundle verification found {{count}} issue(s).',
    artifactVersionsBundleExported: 'Exported and verified bundle at {{path}}.',
    artifactVersionsSameContent: 'same bytes',
    artifactVersionsDifferentContent: 'different bytes',
    artifactVersionsByteDelta: '{{count}} B delta',
    artifactVersionsMediaChanged: 'media type changed',
    artifactVersionsMediaUnchanged: 'media type unchanged',
    artifactVersionsMetadataChanged: 'metadata changed',
    artifactVersionsMetadataUnchanged: 'metadata unchanged',
    artifactVersionsDependencyDelta: 'dependency delta',
    artifactVersionsTextPreview: 'Text preview',
    artifactVersionsTruncated: 'truncated',
    artifactVersionsRefreshSummary: 'Checked {{checked}} source location(s); {{events}} lifecycle event(s).'
  },
  zh: {
    rightPanelArtifactVersions: '产物版本',
    artifactVersionsTitle: '产物版本历史',
    artifactVersionsRefresh: '刷新生命周期与版本历史',
    artifactVersionsCollapse: '收起面板',
    artifactVersionsCount: '共 {{count}} 个版本',
    artifactVersionsEmpty: '当前工作区还没有版本化产物。',
    artifactVersionsNoWorkspace: '请打开带工作区的任务以查看产物历史。',
    artifactVersionsLoading: '正在加载产物历史…',
    artifactVersionsCurrent: '当前版本',
    artifactVersionsSnapshot: '快照',
    artifactVersionsReference: '引用',
    artifactVersionsAvailable: '可用',
    artifactVersionsUnavailable: '不可用',
    artifactVersionsRemote: '远程',
    artifactVersionsCreated: '创建时间',
    artifactVersionsParent: '父版本',
    artifactVersionsRootVersion: '初始版本',
    artifactVersionsDigest: '内容摘要',
    artifactVersionsStorage: '存储状态',
    artifactVersionsDependencies: '固定依赖（{{count}}）',
    artifactVersionsOptional: '可选',
    artifactVersionsNoDependencies: '没有固定依赖。',
    artifactVersionsCompareParent: '与父版本比较',
    artifactVersionsCompareCurrent: '与当前版本比较',
    artifactVersionsMaterialize: '物化',
    artifactVersionsMaterializeConfirm: '将这个不可变版本物化到 {{path}}？',
    artifactVersionsMaterialized: '已将校验通过的内容物化到 {{path}}。',
    artifactVersionsRestoreAsNew: '恢复为新版本',
    artifactVersionsRestoreConfirm: '将版本 {{version}} 恢复为新的当前版本？既有历史不会被覆盖。',
    artifactVersionsRestored: '已恢复为新版本 {{version}}。',
    artifactVersionsExportBundle: '导出 Bundle',
    artifactVersionsExportDenied: '至少一个版本的策略禁止导出。',
    artifactVersionsVerifyBundle: '校验',
    artifactVersionsBundleVerified: 'Bundle 完整性校验通过。',
    artifactVersionsBundleInvalid: 'Bundle 校验发现 {{count}} 个问题。',
    artifactVersionsBundleExported: '已导出并校验 Bundle：{{path}}。',
    artifactVersionsSameContent: '内容相同',
    artifactVersionsDifferentContent: '内容不同',
    artifactVersionsByteDelta: '字节差 {{count}} B',
    artifactVersionsMediaChanged: '媒体类型有变化',
    artifactVersionsMediaUnchanged: '媒体类型未变化',
    artifactVersionsMetadataChanged: '元数据有变化',
    artifactVersionsMetadataUnchanged: '元数据未变化',
    artifactVersionsDependencyDelta: '依赖变化',
    artifactVersionsTextPreview: '文本预览',
    artifactVersionsTruncated: '已截断',
    artifactVersionsRefreshSummary: '已检查 {{checked}} 个来源位置，产生 {{events}} 个生命周期事件。'
  }
} as const

Object.freeze(artifactVersionsMessages.en)
Object.freeze(artifactVersionsMessages.zh)
Object.freeze(artifactVersionsMessages)

export type ArtifactVersionsI18nResourceContribution = Readonly<{
  namespace: typeof ARTIFACT_VERSIONS_TRANSLATION_NAMESPACE
  resources: typeof artifactVersionsMessages
}>

export const artifactVersionsI18nResourceContribution:
ArtifactVersionsI18nResourceContribution = Object.freeze({
  namespace: ARTIFACT_VERSIONS_TRANSLATION_NAMESPACE,
  resources: artifactVersionsMessages
})
