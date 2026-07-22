export const PAPER_RADAR_TRANSLATION_NAMESPACE = 'common'

export const paperRadarMessages = {
  en: {
    rightPanelPaperRadar: 'Paper Radar',
    paperRadarTitle: 'Paper Radar',
    paperRadarStatusStarting: 'Starting local paper service',
    paperRadarStatusReady: '{{total}} papers · arXiv {{arxiv}} · bioRxiv {{biorxiv}}',
    paperRadarSync: 'Sync latest metadata',
    paperRadarSyncDone: 'Synced metadata. arXiv: {{arxiv}}, bioRxiv: {{biorxiv}}.',
    paperRadarSyncOnly: 'Sync only',
    paperRadarUpdateDaily: 'Update daily radar',
    paperRadarReviewResults: 'Check results',
    paperRadarDigestOnly: 'Rank existing',
    paperRadarProfile: 'Topic profile',
    paperRadarProfileSaved: 'Topic profile saved.',
    paperRadarSaveProfile: 'Save',
    paperRadarSearch: 'Search papers',
    paperRadarKeywords: 'Digest keywords',
    paperRadarExcludeKeywords: 'Exclude keywords',
    paperRadarArxivCategories: 'arXiv categories',
    paperRadarBiorxivSubjects: 'bioRxiv subjects',
    paperRadarDays: 'Lookback days',
    paperRadarAdvanced: 'Advanced filters',
    paperRadarDigest: 'Generate digest',
    paperRadarFound: 'Found {{count}} papers.',
    paperRadarDigestDone: 'Digest contains {{count}} papers.',
    paperRadarDigestResults: 'Recommended papers',
    paperRadarSearchResults: 'Search results',
    paperRadarDigestStats: 'High {{high}} · Medium {{medium}} · Low {{low}}',
    paperRadarFilterResults: 'Filter results',
    paperRadarFilterEmpty: 'No loaded papers match this filter.',
    paperRadarVisibleCount: 'Showing {{visible}} of {{total}} papers.',
    paperRadarCopyDigest: 'Copy digest',
    paperRadarCopied: 'Digest copied.',
    paperRadarMetricTotal: 'Total',
    paperRadarRelevance: 'Relevance',
    paperRadarRelevanceHigh: 'High',
    paperRadarRelevanceMedium: 'Medium',
    paperRadarRelevanceLow: 'Low',
    paperRadarReason: 'Reason',
    paperRadarGeneratedAt: 'Generated at',
    paperRadarDigestReportTitle: 'Paper Radar Daily Digest',
    paperRadarTimeout: 'Sync took too long. Try again later, or reduce the lookback days.',
    paperRadarEmpty: 'Check results to load papers, then filter and open them here.'
  },
  zh: {
    rightPanelPaperRadar: '论文雷达',
    paperRadarTitle: '论文雷达',
    paperRadarStatusStarting: '正在启动本地论文服务',
    paperRadarStatusReady: '{{total}} 篇论文 · arXiv {{arxiv}} · bioRxiv {{biorxiv}}',
    paperRadarSync: '同步最新 metadata',
    paperRadarSyncDone: 'metadata 同步完成。arXiv：{{arxiv}}，bioRxiv：{{biorxiv}}。',
    paperRadarSyncOnly: '只同步',
    paperRadarUpdateDaily: '更新今日雷达',
    paperRadarReviewResults: '检查结果',
    paperRadarDigestOnly: '排行已有论文',
    paperRadarProfile: '关注方向',
    paperRadarProfileSaved: '关注方向已保存。',
    paperRadarSaveProfile: '保存',
    paperRadarSearch: '搜索论文',
    paperRadarKeywords: '简报关键词',
    paperRadarExcludeKeywords: '排除关键词',
    paperRadarArxivCategories: 'arXiv 分类',
    paperRadarBiorxivSubjects: 'bioRxiv 主题',
    paperRadarDays: '回看天数',
    paperRadarAdvanced: '高级筛选',
    paperRadarDigest: '生成简报',
    paperRadarFound: '找到 {{count}} 篇论文。',
    paperRadarDigestDone: '简报包含 {{count}} 篇论文。',
    paperRadarDigestResults: '推荐论文',
    paperRadarSearchResults: '搜索结果',
    paperRadarDigestStats: '高相关 {{high}} · 中相关 {{medium}} · 低相关 {{low}}',
    paperRadarFilterResults: '筛选结果',
    paperRadarFilterEmpty: '当前筛选条件没有匹配已载入论文。',
    paperRadarVisibleCount: '显示 {{visible}} / {{total}} 篇论文。',
    paperRadarCopyDigest: '复制日报',
    paperRadarCopied: '日报已复制。',
    paperRadarMetricTotal: '总数',
    paperRadarRelevance: '相关性',
    paperRadarRelevanceHigh: '高相关',
    paperRadarRelevanceMedium: '中相关',
    paperRadarRelevanceLow: '低相关',
    paperRadarReason: '推荐理由',
    paperRadarGeneratedAt: '生成时间',
    paperRadarDigestReportTitle: '论文雷达日报',
    paperRadarTimeout: '同步时间超过限制。请稍后重试，或把回看天数调小。',
    paperRadarEmpty: '检查结果后，可在这里筛选并打开论文。'
  }
} as const

Object.freeze(paperRadarMessages.en)
Object.freeze(paperRadarMessages.zh)
Object.freeze(paperRadarMessages)

export type PaperRadarTranslationLanguage = keyof typeof paperRadarMessages
export type PaperRadarTranslationResources = Readonly<Record<string, string>>

export type PaperRadarI18nResourceContribution = Readonly<{
  namespace: typeof PAPER_RADAR_TRANSLATION_NAMESPACE
  resources: typeof paperRadarMessages
}>

export const paperRadarI18nResourceContribution: PaperRadarI18nResourceContribution =
  Object.freeze({
    namespace: PAPER_RADAR_TRANSLATION_NAMESPACE,
    resources: paperRadarMessages
  })
