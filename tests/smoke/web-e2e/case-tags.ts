export type LegacyRealTaskPrefix = 'R-LIT' | 'R-DATA' | 'R-RUN' | 'R-UI';

export type WebE2eContractAssertion =
  | 'explicit-refs'
  | 'failure-evidence'
  | 'provider-route'
  | 'empty-result'
  | 'background-checkpoint'
  | 'degraded-handoff'
  | 'artifact-delivery'
  | 'audit-export'
  | 'projection-restore'
  | 'concurrency'
  | 'direct-context-gate'
  | 'no-legacy-ui'
  | 'literature-happy-path'
  | 'data-happy-path'
  | 'case-tag-contract';

export interface WebE2eLegacyTaskCaseTagMapping {
  rTaskId: `${LegacyRealTaskPrefix}-${string}`;
  title: string;
  saWebTags: string[];
  sourceFixtureTaskIds: string[];
  contractAssertions: WebE2eContractAssertion[];
}

export const FINAL_WEB_E2E_CASE_TAGS = [
  'SA-WEB-03',
  'SA-WEB-04',
  'SA-WEB-05',
  'SA-WEB-06',
  'SA-WEB-07',
  'SA-WEB-08',
  'SA-WEB-09',
  'SA-WEB-10',
  'SA-WEB-11',
  'SA-WEB-12',
  'SA-WEB-13',
  'SA-WEB-14',
  'SA-WEB-15',
  'SA-WEB-16',
  'SA-WEB-17',
  'SA-WEB-18',
  'SA-WEB-27',
] as const;

export const WEB_E2E_LEGACY_TASK_MAPPINGS: WebE2eLegacyTaskCaseTagMapping[] = [
  mapping('R-LIT-01', '今日 arXiv agent 论文深调研', ['SA-WEB-10', 'SA-WEB-15', 'SA-WEB-17'], ['T20-01', 'T10-01'], ['audit-export', 'literature-happy-path']),
  mapping('R-LIT-02', 'arXiv 空结果恢复', ['SA-WEB-06', 'SA-WEB-15'], ['T5-10', 'T10-09'], ['empty-result', 'literature-happy-path']),
  mapping('R-LIT-03', '多来源文献对照', ['SA-WEB-15', 'SA-WEB-17'], ['T20-01', 'T10-01'], ['provider-route', 'literature-happy-path']),
  mapping('R-LIT-04', '全文下载失败恢复', ['SA-WEB-04', 'SA-WEB-15'], ['T5-01', 'T10-01'], ['failure-evidence', 'literature-happy-path']),
  mapping('R-LIT-05', '引用修正多轮', ['SA-WEB-03', 'SA-WEB-15'], ['T10-01', 'T20-01'], ['explicit-refs', 'literature-happy-path']),
  mapping('R-LIT-06', '研究方向综述迭代', ['SA-WEB-15', 'SA-WEB-17'], ['T10-09', 'T20-14'], ['literature-happy-path', 'case-tag-contract']),
  mapping('R-LIT-07', '论文复现可行性筛选', ['SA-WEB-15', 'SA-WEB-17'], ['T20-01', 'T10-08'], ['literature-happy-path', 'audit-export']),
  mapping('R-LIT-08', '反事实追问', ['SA-WEB-13', 'SA-WEB-15'], ['T20-10', 'T10-12'], ['direct-context-gate', 'literature-happy-path']),
  mapping('R-LIT-09', '历史文献任务恢复', ['SA-WEB-04', 'SA-WEB-11'], ['TS-28', 'TS-05'], ['failure-evidence', 'projection-restore']),
  mapping('R-LIT-10', '双语报告', ['SA-WEB-15', 'SA-WEB-17'], ['T10-06', 'T20-09'], ['artifact-delivery', 'literature-happy-path']),

  mapping('R-DATA-01', 'CSV 多轮分析', ['SA-WEB-16', 'SA-WEB-17'], ['T5-06', 'T20-05'], ['data-happy-path', 'artifact-delivery']),
  mapping('R-DATA-02', '两表合并冲突', ['SA-WEB-16', 'SA-WEB-17'], ['T10-04', 'T20-05'], ['data-happy-path', 'failure-evidence']),
  mapping('R-DATA-03', '大文件摘要', ['SA-WEB-16', 'SA-WEB-17'], ['T20-10', 'T20-05'], ['data-happy-path', 'case-tag-contract']),
  mapping('R-DATA-04', '图表迭代', ['SA-WEB-03', 'SA-WEB-16'], ['T20-04', 'T10-06'], ['explicit-refs', 'data-happy-path']),
  mapping('R-DATA-05', '缺失文件恢复', ['SA-WEB-04', 'SA-WEB-16'], ['T5-04', 'TS-24'], ['failure-evidence', 'data-happy-path']),
  mapping('R-DATA-06', 'Notebook 风格任务', ['SA-WEB-07', 'SA-WEB-16'], ['T20-05', 'T20-11'], ['background-checkpoint', 'data-happy-path']),
  mapping('R-DATA-07', '外部数据源限流', ['SA-WEB-05', 'SA-WEB-16'], ['T10-10', 'T20-02'], ['provider-route', 'failure-evidence']),
  mapping('R-DATA-08', '审计导出', ['SA-WEB-10', 'SA-WEB-16'], ['T20-15', 'TS-29'], ['audit-export', 'data-happy-path']),

  mapping('R-RUN-01', '失败 run 诊断', ['SA-WEB-04', 'SA-WEB-13'], ['T5-07', 'TS-28'], ['failure-evidence', 'direct-context-gate']),
  mapping('R-RUN-02', 'Repair loop 防护', ['SA-WEB-04', 'SA-WEB-14'], ['T20-12', 'T10-10'], ['failure-evidence', 'no-legacy-ui']),
  mapping('R-RUN-03', 'Background continuation', ['SA-WEB-07', 'SA-WEB-11'], ['T20-07', 'TS-02'], ['background-checkpoint', 'projection-restore']),
  mapping('R-RUN-04', '多标签并发', ['SA-WEB-12', 'SA-WEB-17'], ['TS-20', 'T20-08'], ['concurrency', 'case-tag-contract']),
  mapping('R-RUN-05', '编辑历史 revert', ['SA-WEB-11', 'SA-WEB-17'], ['TS-12', 'TS-14'], ['projection-restore', 'case-tag-contract']),
  mapping('R-RUN-06', '编辑历史 continue', ['SA-WEB-11', 'SA-WEB-17'], ['TS-13', 'TS-15'], ['projection-restore', 'case-tag-contract']),
  mapping('R-RUN-07', '跨 session 恢复', ['SA-WEB-11', 'SA-WEB-17'], ['TS-04', 'TS-19'], ['projection-restore', 'case-tag-contract']),
  mapping('R-RUN-08', '取消边界', ['SA-WEB-04', 'SA-WEB-14'], ['TS-08', 'TS-10'], ['failure-evidence', 'no-legacy-ui']),
  mapping('R-RUN-09', '版本漂移恢复', ['SA-WEB-11', 'SA-WEB-14'], ['TS-21', 'TS-22'], ['projection-restore', 'no-legacy-ui']),
  mapping('R-RUN-10', '压缩后恢复', ['SA-WEB-08', 'SA-WEB-11'], ['TS-25', 'T20-10'], ['degraded-handoff', 'projection-restore']),

  mapping('R-UI-01', '失败结果可读性', ['SA-WEB-04', 'SA-WEB-14'], ['T5-07', 'T10-02'], ['failure-evidence', 'no-legacy-ui']),
  mapping('R-UI-02', 'Partial 优先', ['SA-WEB-07', 'SA-WEB-09'], ['T5-08', 'T20-11'], ['background-checkpoint', 'artifact-delivery']),
  mapping('R-UI-03', 'Artifact 选择追问', ['SA-WEB-03'], ['T5-04', 'T10-11'], ['explicit-refs']),
  mapping('R-UI-04', 'ExecutionUnit 展示', ['SA-WEB-04', 'SA-WEB-10'], ['T10-02', 'T20-15'], ['failure-evidence', 'audit-export']),
  mapping('R-UI-05', 'Verification 状态', ['SA-WEB-09', 'SA-WEB-10'], ['T20-04', 'T20-15'], ['artifact-delivery', 'audit-export']),
  mapping('R-UI-06', '空结果页面', ['SA-WEB-06', 'SA-WEB-14'], ['T5-10', 'T10-09'], ['empty-result', 'no-legacy-ui']),
  mapping('R-UI-07', '多 artifact 比较', ['SA-WEB-03', 'SA-WEB-09'], ['T20-04', 'T10-11'], ['explicit-refs', 'artifact-delivery']),
  mapping('R-UI-08', '导出 bundle', ['SA-WEB-10', 'SA-WEB-17'], ['T20-15', 'TS-29'], ['audit-export', 'case-tag-contract']),
];

export function mappingsForSaWebTag(tag: string): WebE2eLegacyTaskCaseTagMapping[] {
  if (tag === 'SA-WEB-27') return [...WEB_E2E_LEGACY_TASK_MAPPINGS];
  return WEB_E2E_LEGACY_TASK_MAPPINGS.filter((mapping) => mapping.saWebTags.includes(tag));
}

function mapping(
  rTaskId: WebE2eLegacyTaskCaseTagMapping['rTaskId'],
  title: string,
  saWebTags: string[],
  sourceFixtureTaskIds: string[],
  contractAssertions: WebE2eContractAssertion[],
): WebE2eLegacyTaskCaseTagMapping {
  return { rTaskId, title, saWebTags, sourceFixtureTaskIds, contractAssertions };
}
