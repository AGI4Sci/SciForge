export interface DirectContextLiteratureReportRowPolicyInput {
  title: string;
  year?: string;
  url?: string;
  evidenceLocation?: string;
  fullTextStatus?: string;
  summary?: string;
}

export type DirectContextPolicyIntent =
  | 'context-summary'
  | 'context-summary:risk'
  | 'context-summary:method'
  | 'context-summary:timeline'
  | 'run-diagnostic'
  | 'artifact-status'
  | 'capability-status'
  | 'fresh-execution'
  | 'unknown';

export type DirectContextPolicyTransformMode =
  | 'answer-only-compress'
  | 'answer-only-summary'
  | 'answer-only-checklist'
  | 'answer-only-planning-register'
  | 'answer-only-document'
  | 'none';

export function directContextLiteratureNoResultScope(sourceText: string, requestText: string) {
  const text = `${sourceText}\n${requestText}`;
  const source = /\barxiv\b/i.test(text)
    ? 'arXiv'
    : /\bpubmed\b/i.test(text)
      ? 'PubMed'
      : /\bbiorxiv\b/i.test(text)
        ? 'bioRxiv'
        : 'provider';
  const conditionLabel = /\btoday\b|今天|submitted on|提交于/i.test(text) ? '当前日期窗口下' : '请求条件下';
  return {
    conditionLabel,
    sourceEvidenceLabel: source === 'arXiv' ? ' arXiv abs/PDF ' : ` ${source} 论文/PDF `,
    sourceRetryLabel: source === 'provider' ? '相关 provider' : ` ${source}`,
    englishScope: source === 'provider' ? 'the requested provider/query scope' : `the requested ${source} query/date scope`,
    englishEvidenceLabel: source === 'arXiv' ? 'arXiv abs/PDF link' : `${source} paper/PDF link`,
    englishRetryLabel: source === 'provider' ? 'the relevant provider query' : `${source}`,
  };
}

export function directContextTextAsksFullTextEvidenceStatus(text: string) {
  return /(PDF|full[-\s]?text|fulltext|arXiv|全文|全文证据|PDF证据|全文调研|论文全文|原文|读取|阅读|已读|读完|downloaded?|retrieved?|citation verification|引用验证|引文验证|文献验证|证据位置|页码|段落)/i.test(text);
}

export function directContextTextWantsChinese(text: string) {
  return /[一-龥]/.test(text) || /\b(?:answer|write|respond|summari[sz]e|report)\s+in\s+Chinese\b|\bChinese\s+(?:answer|response|summary|report)\b|中文|汉语|普通话/i.test(text);
}

export function directContextPromptRequestsEvidenceMatrixArtifact(prompt: string) {
  return /evidence[-\s_]?matrix|证据矩阵|matrix artifact/i.test(prompt);
}

export function directContextRecordLooksLikeEvidenceMatrix(text: string) {
  return /evidence[-\s_]?matrix/i.test(text);
}

export function directContextPromptRequestsEvidenceMatrixHypotheses(prompt: string) {
  return /(hypoth(?:esis|eses)|可检验|假设|validation experiment|minimal validation)/i.test(prompt)
    && /(evidence matrix|matrix|证据矩阵)/i.test(prompt);
}

export function directContextRequiredContextForIntentPolicy(intent: DirectContextPolicyIntent | string) {
  if (intent === 'run-diagnostic') return ['run-trace', 'execution-units', 'failure-evidence'];
  if (intent === 'artifact-status') return ['artifact-index', 'object-references', 'current-refs'];
  if (intent.startsWith('context-summary')) return ['current-session-context'];
  if (intent === 'capability-status') return ['capability-registry', 'tool-registry', 'provider-registry'];
  if (intent === 'fresh-execution') return ['backend-routing', 'capability-provider-routes'];
  return ['typed-current-context'];
}

export function directContextCapabilityStatusBlockedContextPolicy() {
  return ['capability-registry', 'tool-registry', 'provider-registry', 'agentserver-worker-registry'];
}

export function directContextGateBlockedReasonForIntent(intent: DirectContextPolicyIntent | string) {
  if (intent === 'capability-status') return 'Skill/tool/capability/provider status must be answered from registries, not artifact summaries.';
  if (intent === 'fresh-execution') return 'Fresh execution or external lookup request requires backend/tool routing.';
  return 'Structured direct-context decision did not authorize a direct answer.';
}

export function directContextIntentSummaryLimit(prompt: string) {
  return /two|2|两|二/.test(prompt) ? 2 : 3;
}

export function directContextBoundedArtifactIntent(prompt: string): Extract<DirectContextPolicyIntent, 'context-summary' | 'context-summary:risk'> {
  return /fail|risk|失败|风险/i.test(prompt) ? 'context-summary:risk' : 'context-summary';
}

export function directContextBoundedArtifactTransformMode(prompt: string): DirectContextPolicyTransformMode | undefined {
  return /hypoth(?:esis|eses)|可检验|假设/i.test(prompt) ? 'answer-only-summary' : undefined;
}

export function directContextPromptRequestsFreshExternalWork(text: string) {
  return /(search|retrieve|检索|搜索|重新检索|new search|web|external provider|fresh)/i.test(text)
    && !/(do not|don't|no|不要|不得|不(?:启动|运行|重新|做|进行)|without)/i.test(text);
}

export function directContextPromptRequestsAnalysisReportFollowup(prompt: string) {
  return /(treatment effect|confounders?|robustness|batch|timepoint|main conclusion|处理效应|混杂|稳健性)/i.test(prompt);
}

export function directContextPromptRequestsProtocolBudgetAdaptation(prompt: string, sourcePreview: string) {
  return /(budget|librar(?:y|ies)|sequencing|timepoints?|预算|测序|文库|时间点)/i.test(prompt)
    && /(protocol|trial|RCT|study design|方案|研究设计)/i.test(`${prompt}\n${sourcePreview}`);
}

export function directContextLibraryBudgetTarget(prompt: string) {
  return firstIntegerMatch(prompt, /(\d+)\s*(?:sequencing\s*)?librar(?:y|ies)\b/i)
    ?? firstIntegerMatch(prompt, /预算\D{0,16}(\d+)\s*(?:个\s*)?(?:librar(?:y|ies)|文库)/i);
}

export function directContextPromptRequestsSelectedReport(prompt: string) {
  return /(selected|reference|report|artifact|选中|引用|报告|产物)/i.test(prompt);
}

export function directContextPromptRequestsSelectedReportBullets(prompt: string) {
  return /(selected|reference|report|artifact|引用|选中|报告|产物|刚刚)/i.test(prompt)
    && /(flow\s*matching|perturbation|single[-\s]?cell|pdf|full[-\s]?text|全文|文献|论文)/i.test(prompt)
    && /(bullet|bullets?|points?|summari[sz]e|conclusions?|priorit|read first|highest|reason|evidence|limitation|三条|3\s*条|总结|结论|要点|指出|优先|先读|理由|原因|证据|局限)/i.test(prompt);
}

export function directContextPromptRequestsPriorityLiteratureRows(prompt: string) {
  return /(priorit|read first|highest|先读|优先|最值得|推荐)/i.test(prompt);
}

export function directContextPromptRequestsQcMissingnessImpact(prompt: string) {
  return /(selected|reference|artifact|file|table|csv|QC|missingness|选中|引用|产物|文件|表|缺失|质控)/i.test(prompt)
    && (directContextPromptMentionsQcArtifact(prompt) || directContextPromptAsksQcImpact(prompt));
}

export function directContextPromptMentionsQcArtifact(prompt: string) {
  return /(missing|missingness|outlier|protocol[-_\s]?deviations?|QC|quality[-_\s]?control|table|csv|缺失|质控|离群|异常|违背|表格)/i.test(prompt);
}

export function directContextPromptAsksQcImpact(prompt: string) {
  return /(treatment[-_\s]?effect|treatment|effect|prove|overturn|bias|sensitivity|robust|治疗|效应|证明|推翻|偏倚|敏感|稳健|影响)/i.test(prompt);
}

export function directContextPromptRequestsChartSufficiency(prompt: string) {
  return /(selected|reference|artifact|chart|plot|figure|image|选中|引用|产物|图表|图片)/i.test(prompt)
    && /(alone|only|single|support|prove|conclude|conclusion|statistical|significance|p[-\s]?value|confidence interval|batch|confound|causal|单独|仅|只|支持|证明|结论|显著|混杂|批次)/i.test(prompt);
}

export function directContextPromptMentionsChart(prompt: string) {
  return /(chart|plot|figure|image|png|jpe?g|webp|svg|boxplot|violin|heatmap|图表|图片|图像)/i.test(prompt);
}

export function directContextPromptAsksStatistics(prompt: string) {
  return /(statistical|significance|p[-\s]?value|confidence interval|interval|sample size|effect|model|test|显著|p\s*值|置信|样本|效应|模型|检验)/i.test(prompt);
}

export function directContextPromptAsksConfounding(prompt: string) {
  return /(batch|confound|adjust|control|stratif|批次|混杂|控制|调整|分层)/i.test(prompt);
}

export function directContextPromptRequestsCounterfactualThreshold(prompt: string) {
  return /(selected|reference|report|artifact|reproduc|选中|引用|报告|产物|复现)/i.test(prompt)
    && /(counterfactual|if|new threshold|stricter|still|success|反事实|如果|新门槛|新阈值|仍可|仍然|判成功|验收|门槛|阈值|<=|≤)/i.test(prompt)
    && /(r\b|K\b|RMSE|error|误差)/i.test(prompt);
}

export function directContextPromptRequestsRerunInfo(prompt: string) {
  return /(selected|reference|report|artifact|reproduc|选中|引用|报告|产物|复现)/i.test(prompt)
    && /(rerun command|run command|complete rerun|copy-pasteable command|script path|复跑性|复现命令|运行命令|完整.{0,8}命令|脚本路径)/i.test(prompt);
}

export function directContextPromptRequestsLiteralFacts(prompt: string) {
  return /(selected|reference|report|artifact|reproduc|选中|引用|报告|产物|复现)/i.test(prompt)
    && /(random seed|seed|optimizer|bounds?|parameter bounds?|noise|std|脚本|路径|随机种子|优化器|参数边界|取值边界|边界条件|噪声)/i.test(prompt);
}

export function directContextSelectedReportLiteralFactKinds(prompt: string) {
  return {
    seed: /random seed|seed|随机种子/i.test(prompt),
    optimizer: /optimizer|优化器/i.test(prompt),
    bounds: /bounds?|parameter bounds?|参数边界|取值边界|边界条件/i.test(prompt),
    noise: /noise|std|噪声/i.test(prompt),
    script: /script|脚本|路径/i.test(prompt),
  };
}

export function directContextPromptRequestsEvidenceBoundary(prompt: string) {
  return /(selected|reference|report|artifact|reproduc|这份|当前|选中|引用|报告|产物|复现)/i.test(prompt)
    && /(cannot prove|cannot show|not prove|extrapolat|limitation|boundary|不能证明|不能外推|外推|边界|局限|缺口)/i.test(prompt);
}

export function directContextPromptRequestsCredibilityAudit(prompt: string) {
  return /(selected|reference|report|artifact|reproduc|当前|选中|引用|报告|产物|复现)/i.test(prompt)
    && /(over.?optimistic|too optimistic|credible as a toy reproduction|supporting evidence|counter.?evidence|audit|过度乐观|支持证据|反对证据|一致性审计)/i.test(prompt);
}

export function directContextPromptRequestsPassFailAudit(prompt: string) {
  return /(selected|reference|report|artifact|reproduc|选中|引用|报告|产物|复现)/i.test(prompt)
    && /(PASS|FAIL|pass\/fail|true|fitted|error|threshold|RMSE|达标|未达标|没达标|阈值|逐项|核对|指标|误差|拟合)/i.test(prompt);
}

export function directContextPromptRequestsSelectedReportQuestion(prompt: string) {
  return /(selected|reference|report|artifact|选中|引用|报告|产物)/i.test(prompt)
    && /(credible|credibility|whether|verdict|metrics?|support|risk|validation|next step|可信|是否|结论|指标|支持|风险|验证|下一步)/i.test(prompt);
}

export function directContextLiteratureSourceIsMetadataOnly(sourceText: string) {
  return /(provider[-\s]?grounded metadata|provider metadata|metadata until full[-\s]?text verification|until full[-\s]?text verification|requires full[-\s]?text verification|citation verification|unverified|needs[-\s]?verification|未验证|待验证|未完成全文|未读取全文)/i.test(sourceText);
}

export function directContextLiteratureSourceHasCompletedFullTextEvidence(sourceText: string) {
  return /(PDF|full[-\s]?text|全文)[^。.!?\n]{0,80}(read|retrieved|downloaded|verified|completed|已读取|已阅读|已获取|已验证|完成)/i.test(sourceText)
    && !/(until full[-\s]?text verification|requires full[-\s]?text verification|未验证|待验证|metadata until)/i.test(sourceText);
}

export function directContextNoConfirmedLiteratureAnswerLines(input: {
  chinese: boolean;
  selectedTitle: string;
  scope: ReturnType<typeof directContextLiteratureNoResultScope>;
  reason?: string;
  basisLines: string[];
}) {
  if (input.chinese) {
    return [
      `只基于当前选中的 ${input.selectedTitle} 回答，不启动新的 workspace task，也不使用未选中的历史消息或外部新检索。`,
      '',
      `- 是否确认${input.scope.conditionLabel}的相关论文：没有。选中报告明确是无可确认结果/最新论文列表为空，不能把本轮结果解读成已经确认到满足请求条件的论文。`,
      `- PDF/全文状态：没有可对应到论文的 PDF/全文可读记录；${input.reason ?? '报告没有给出可引用论文的 PDF 或全文读取证据。'}`,
      `- 证据位置边界：证据只停留在 provider/运行诊断或失败原因层面；没有可引用的${input.scope.sourceEvidenceLabel}链接、页码、段落或论文内证据位置。`,
      '- 关键结论：本轮可以诚实支持“未确认到满足请求条件的论文”，不能支持“已完成阅读全文调研”。',
      `- 局限性：可能受 provider 限流、日期窗口、查询词和 bounded run 影响；需要稍后重试${input.scope.sourceRetryLabel}、放宽日期窗口或逐篇拉取 PDF 后才能形成 citation-grade 结论。`,
      ...input.basisLines.map((line) => `- 选中报告依据：${line}`),
    ];
  }
  return [
    `Answered only from the selected ${input.selectedTitle}; no new workspace task or external lookup was started.`,
    '',
    `- Confirmed papers for the requested scope: none. The selected report records an empty/no-confirmed-result literature list for ${input.scope.englishScope}.`,
    `- PDF/full-text status: no paper-level PDF or full-text evidence was read or verified; ${input.reason ?? 'the report does not provide citable paper/PDF evidence.'}`,
    `- Evidence-location boundary: only provider/runtime diagnostics are available; no ${input.scope.englishEvidenceLabel}, page, section, or snippet can be cited from the selected report.`,
    '- Key conclusion: this supports an honest no-confirmed-result answer, not a completed full-text literature review.',
    `- Limitations: provider rate limits, date-window strictness, query wording, and bounded execution may have caused false negatives; retry ${input.scope.englishRetryLabel} and paper-level PDF extraction are still required for citation-grade conclusions.`,
    ...input.basisLines.map((line) => `- Selected-report basis: ${line}`),
  ];
}

export function directContextLiteratureMetadataEvidenceAnswerLines(input: {
  chinese: boolean;
  selectedTitle: string;
  sourceLines: string[];
  completedFullTextEvidence: boolean;
}) {
  if (input.chinese) {
    if (!input.completedFullTextEvidence) {
      return [
        `只基于当前选中的 ${input.selectedTitle} 回答，不启动新的 workspace task，也不使用未选中的历史消息或外部新检索。`,
        '',
        '- 已读取的 arXiv PDF/全文证据：这份选中报告没有记录任何已经读取、下载或验证过的 arXiv PDF/全文证据。',
        '- 未读取或未验证的部分：报告只留下 provider/web_search 路由产出的候选元数据；候选行仍被标记为 provider-grounded metadata，等待 full-text/citation verification。',
        '- 能否支持“全文调研已完成”：不能。它只能支持“已有候选元数据/诊断材料”，不能支持“全文调研已完成”或“PDF 证据已读完”的结论。',
        '- 下一步恢复：按候选论文逐篇解析 arXiv 身份和 PDF/全文，记录已读取的段落/页码/证据位置，做 citation/title/date 校验，再重新生成证据矩阵和中文报告。',
        ...input.sourceLines.map((line) => `- 选中报告依据：${line}`),
      ];
    }
    return [
      `只基于当前选中的 ${input.selectedTitle} 回答，不启动新的 workspace task。`,
      '- 选中报告包含已完成全文/PDF 读取的表述；仍需逐条核对证据位置后才能把它当作最终完成结论。',
      ...input.sourceLines.map((line) => `- 选中报告依据：${line}`),
    ];
  }
  if (!input.completedFullTextEvidence) {
    return [
      `Answered only from the selected ${input.selectedTitle}; no new workspace task or external lookup was started.`,
      '',
      '- Read arXiv PDF/full-text evidence: the selected report does not record any arXiv PDF or full-text evidence as read, downloaded, or verified.',
      '- Missing/unverified evidence: it only preserves provider/web_search candidate metadata and says the rows remain provider-grounded until full-text/citation verification.',
      '- Completion verdict: it cannot support a claim that full-text research is complete.',
      '- Recovery step: read each candidate paper/PDF, record evidence locations, verify citation/title/date identity, then regenerate the evidence matrix and report.',
      ...input.sourceLines.map((line) => `- Selected-report basis: ${line}`),
    ];
  }
  return [
    `Answered only from the selected ${input.selectedTitle}; no new workspace task was started.`,
    '- The selected report includes completed full-text/PDF language, but the evidence locations still need item-by-item audit before treating it as a final completion claim.',
    ...input.sourceLines.map((line) => `- Selected-report basis: ${line}`),
  ];
}

export function directContextSelectedLiteratureReportBasisLines(sourceText: string) {
  return uniqueStrings(sourceText
    .split(/[\n\r]+|(?<=[。.!?；;])\s+/)
    .map((line) => line.trim().replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').replace(/\s+/g, ' '))
    .filter((line) => /(无可确认|未能确认|最新论文列表|PDF|全文|证据位置|HTTP\s*429|arXiv|provider|diagnostic|局限|limitations?)/i.test(line))
    .filter((line) => line.length > 0 && line.length <= 260))
    .slice(0, 4);
}

export function directContextEvidenceStatusSourceLines(sourceText: string) {
  const lines = sourceText
    .split(/(?<=[。.!?；;])\s+|[\n\r]+/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => /(provider|metadata|full[-\s]?text|PDF|arXiv|citation|verification|verified|unverified|全文|读取|阅读|验证)/i.test(line))
    .filter((line) => line.length > 0 && line.length <= 260);
  return uniqueStrings(lines).slice(0, 3);
}

export function directContextIsLiteraturePaperRow(row: DirectContextLiteratureReportRowPolicyInput) {
  if (/(provider search|web_search|browser_fetch|source fetch|fetch status|called provider|normalized \d+ candidate|检索通道)/i.test(row.title)) {
    return false;
  }
  if (row.url && !/^https?:\/\//i.test(row.url)) return false;
  if (row.fullTextStatus && !/(PDF|PDF\/full-text|full[-\s]?text|download|reach|extract|unavailable|not confirmed|failed|provider|candidate)/i.test(row.fullTextStatus)) return false;
  const text = `${row.title}\n${row.year ?? ''}\n${row.url ?? ''}\n${row.evidenceLocation ?? ''}\n${row.fullTextStatus ?? ''}\n${row.summary ?? ''}`;
  return /(arxiv|pubmed|doi\b|pmid\b|pdf|full[-\s]?text|published|20\d{2}|论文|文献)/i.test(text);
}

export function directContextLiteratureFullTextStatus(status: string) {
  const pdfUrl = status.match(/https?:\/\/\S+/i)?.[0]?.replace(/[).,;，。]+$/, '');
  if (/candidate link found|candidate URL inferred/i.test(status)) {
    return pdfUrl ? `已发现候选 PDF/全文链接（${pdfUrl}），仍建议做逐篇全文核验。` : '已发现候选 PDF/全文链接，仍建议做逐篇全文核验。';
  }
  if (/likely reachable/i.test(status)) return 'provider URL 显示 PDF/全文大概率可达，但本轮 bounded run 未下载或逐段核验。';
  if (/not confirmed|unavailable|failed|no PDF/i.test(status)) return '本轮未确认 PDF/全文可用性；需后续 PDF 提取或网页抓取验证。';
  return status || '当前 report 未写明 PDF/full-text 状态。';
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function firstIntegerMatch(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}
