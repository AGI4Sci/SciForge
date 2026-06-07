export function freshCodeDebugExecutionPromptPolicy(prompt: string) {
  const text = prompt.toLowerCase();
  const codeSignals = [
    /\bdebug\b/,
    /\bbug\b/,
    /\bpatch\b/,
    /\bmodify\b/,
    /\bedit\b/,
    /\brepair\b/,
    /\brerun\b/,
    /\bpytest\b/,
    /\bunit tests?\b/,
    /\bfailing tests?\b/,
    /\btest_[\w.-]+\.py\b/,
    /\b[\w.-]+\.py\b/,
    /读代码|调试|修复|修改代码|单测|运行测试|复跑/,
  ];
  const asksForScenarioArtifacts = /\b(evidence matrix|paper-list|paper list|notebook timeline|research report artifact)\b|证据矩阵|论文列表|全文|arxiv|pdf/.test(text);
  return codeSignals.some((pattern) => pattern.test(text)) && !asksForScenarioArtifacts;
}

export function generatedWorkSelectedComponentsAllowed(prompt: string) {
  return !freshCodeDebugExecutionPromptPolicy(prompt);
}

export function workspaceCodeTaskPromptPolicy(prompt: string) {
  const text = prompt.toLowerCase();
  const hasCodeIntent = /\b(code|coding|repository|repo|module|source file|typescript|javascript|python|test helper|unit test|typecheck|patch|refactor|bug|runtime|gateway|manifest|validation|preflight|self-improvement)\b/.test(text)
    || /(?:代码|仓库|模块|源码|测试|补丁|修复|重构|类型检查|运行时|网关|清单|校验)/.test(prompt);
  const hasResearchRetrievalIntent = /\b(literature|papers?|pmid|doi|citation|bibliography|clinical trial|pubmed|openalex|evidence matrix|systematic review)\b/.test(text)
    || /(?:文献|论文|引用|证据矩阵|综述|临床试验)/.test(prompt);
  return hasCodeIntent && !hasResearchRetrievalIntent;
}

export function generatedTaskProviderFirstNetworkIssuePolicy(input: {
  sourceRef: string;
  directNetworkUses: string[];
  unavailableProviderSdkUses: string[];
  capabilityIds: string[];
}) {
  const routeList = input.capabilityIds.join(', ');
  const reason = input.directNetworkUses.length
    ? `Generated task uses direct external network APIs (${input.directNetworkUses.join(', ')}) even though SciForge has ready provider route(s) for ${routeList}.`
    : `Generated task imports unavailable provider SDKs (${input.unavailableProviderSdkUses.join(', ')}) even though SciForge generated tasks must use the local sciforge_task helper for ready provider route(s) ${routeList}.`;
  return {
    id: `${input.sourceRef}:provider-first-direct-network:${input.capabilityIds.join(',')}`,
    reason,
    recoverActions: [
      'Regenerate the task to use the SciForge provider route contract for web_search/web_fetch/browser_search/browser_fetch work before any direct external network call or unavailable provider SDK import.',
      'Import sciforge_task from the entrypoint directory and inspect capabilityProviderRoutes/provider-first policy from task input.',
      'If the provider returns empty results or is unavailable at runtime, write a repair-needed ToolPayload with recoverActions instead of falling back to direct network libraries.',
    ],
  };
}

export function generatedTaskUsesProviderInvocationHelper(source: string) {
  return /\binvoke_(?:capability|provider)\s*\(/.test(source);
}

export function generatedTaskProviderInvocationHelperEvidence(source: string) {
  return source.match(/^[^\n]*\binvoke_(?:capability|provider)\s*\([^\n]*/m)?.[0] ?? 'invoke_capability(...)';
}

export function generatedTaskDefinesOrImportsProviderInvocationHelper(source: string) {
  return /(?:^|\n)\s*from\s+sciforge_task\s+import\s+[^\n]*(?:invoke_capability|invoke_provider)/.test(source)
    || /(?:^|\n)\s*import\s+sciforge_task\b/.test(source)
    || /(?:^|\n)\s*def\s+invoke_(?:capability|provider)\s*\(/.test(source);
}

export function generatedTaskProviderHelperMissingImportIssuePolicy(input: {
  sourceRef: string;
  capabilityIds: string[];
  evidence: string;
}) {
  return {
    id: `${input.sourceRef}:provider-helper-missing-import:${input.capabilityIds.join(',')}`,
    evidence: input.evidence,
    reason: 'Generated task calls invoke_capability/invoke_provider without importing the SciForge sciforge_task helper, so provider-first execution would fail at runtime.',
    recoverActions: [
      'Regenerate the task with: from sciforge_task import load_input, write_payload, invoke_capability, provider_result_is_empty, empty_result_payload, ProviderInvocationError.',
      'Do not catch missing invoke_capability as an empty result; missing provider helper is a task-code error that requires repair.',
    ],
  };
}

export function generatedTaskRecoveryTaskPath(kind: 'provider-first' | 'literature-metadata' | 'contract-failure', digest: string) {
  const prefix = kind === 'provider-first'
    ? 'provider-first-recovery'
    : kind === 'literature-metadata'
      ? 'literature-metadata-recovery'
      : 'contract-failure';
  return `.sciforge/generated-tasks/${prefix}-${digest}.py`;
}

export function generatedTaskLiteratureDeliverablesExpected(input: {
  requestText: string;
  uiManifest?: unknown;
  artifacts?: unknown;
}) {
  return /paper-list|evidence-matrix|research-report|full[-\s]?text|pdf|论文|文献|全文/i.test([
    input.requestText,
    JSON.stringify(input.uiManifest ?? []),
    JSON.stringify(input.artifacts ?? []),
  ].join('\n'));
}

export function literatureNoResultScope(value: string) {
  const sourceLabel = /\barxiv\b/i.test(value)
    ? ' arXiv '
    : /\bpubmed\b/i.test(value)
      ? ' PubMed '
      : /\bbiorxiv\b/i.test(value)
        ? ' bioRxiv '
        : '文献数据库/网页 provider ';
  const conditionLabel = /\btoday\b|今天|submitted on|提交于/i.test(value)
    ? '当前日期窗口下'
    : '请求条件下';
  const topicLabel = value
    .replace(/\b(?:today|recent|latest|arxiv|pubmed|biorxiv|papers?|literature|survey|research|read|full|text|pdf|report|artifact|submitted|on|utc)\b/gi, ' ')
    .replace(/(?:今天|最新|论文|文献|调研|阅读全文|全文|中文|总结|报告|证据|位置|不可得|说明|写一份|帮我|一下)/g, ' ')
    .replace(/[^\p{L}\p{N}+._\-\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return {
    sourceLabel,
    conditionLabel,
    topicLabel: topicLabel || value.slice(0, 120) || 'requested literature topic',
  };
}

export function literatureRecoverySearchQuery(prompt: string) {
  if (/single[-\s]?cell/i.test(prompt) && /flow\s+matching/i.test(prompt)) {
    return 'arxiv flow matching single cell';
  }
  if (/single[-\s]?cell/i.test(prompt) && /perturbation/i.test(prompt)) {
    return 'arxiv single cell perturbation prediction';
  }
  const topic = prompt.match(/\b(?:papers?|literature|survey|文献|论文).*?\b(?:on|about|for)\s+(.+?)(?:\.\s*(?:Read|Write|Summari[sz]e|Requirements?|Hard requirements?)\b|(?:Requirements?|Hard requirements?)\b|$)/i)?.[1]
    ?? prompt.match(/关于\s*([^。；;\n]+?)(?:的)?(?:文献|论文|综述)/)?.[1]
    ?? prompt;
  const wantsArxiv = /\barxiv\b/i.test(prompt);
  const datePrefix = /\btoday\b|今天/i.test(prompt)
    ? 'today '
    : (prompt.match(/\b(?:last|past|recent)\s+\d{1,3}\s+(?:day|days|week|weeks|month|months)\b/i)?.[0] ?? '');
  const cleaned = `${topic}`
    .replace(/\bP\d+\b/gi, ' ')
    .replace(/\b(hard requirements?|requirements?|latest paper list|latest papers?|full text|read full text|pdf availability|unavailable note|evidence locations?|chinese report artifact|key conclusions|method differences?|next reading advice|limitations|selected report follow[- ]?up(?: supported)?|arxiv|pubmed|literature survey|survey recheck|provider recovery|after provider recovery|literature|survey|papers?|latest|recent|research|investigate|read|write|summar(?:y|ize|ise)|report|artifact|chinese|as much as possible|do not return placeholder papers?|budget[-\s]?limit note|final answer|or)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}+._\-\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (`${datePrefix}${wantsArxiv ? 'arxiv ' : ''}${cleaned}`.trim() || 'recent literature').slice(0, 180);
}

export function literatureProviderMetadataMissingFullTextStatus() {
  return 'No PDF/full-text URL confirmed by provider metadata; mark unavailable/not confirmed until PDF extraction verification.';
}

export function literatureGenerationFailureRecoveryMessage(input: {
  rowCount: number;
  fetchedCount: number;
  pdfExtractedCount: number;
}) {
  return `Backend 生成阶段失败后，SciForge 已通过 web_search/web_fetch/pdf_extract provider fallback 生成文献调研交付包：${input.rowCount} 篇候选论文、${input.fetchedCount} 条来源页面抓取、${input.pdfExtractedCount} 条 PDF 正文抽取、中文报告 artifact 和 evidence matrix。`;
}
