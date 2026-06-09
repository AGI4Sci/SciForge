import type {
  BrowserPrimitiveEnvelope,
  BrowserResource,
  BrowserResourceStatus,
} from '../../../packages/actions/browser-runtime/index.js';

export interface AgentHostBrowserEvidenceLedger {
  schemaVersion: 'sciforge.agent-host.browser-evidence-ledger.v1';
  resourcesByRef: Record<string, BrowserResource>;
  resourceEvents: AgentHostBrowserResourceEvent[];
  refs: string[];
}

export interface AgentHostBrowserResourceEvent {
  ref: string;
  kind: string;
  status: BrowserResourceStatus;
  originTool?: string;
}

export interface AgentHostBrowserEvidenceIssue {
  code: string;
  message: string;
  evidenceRefs?: string[];
}

export interface AgentHostBrowserEvidenceRepairHint {
  action: 'call-browser-read' | 'project-final-answer' | 'collect-browser-evidence';
  reason: string;
}

export interface AgentHostBrowserSearchPlan {
  schemaVersion: 'sciforge.agent-host.browser-search-plan.v1';
  taskSummary?: string;
  search: {
    primaryQuery: string;
    queryCandidates: string[];
    preferredDomains: string[];
    avoidedDomains: string[];
    maxDiscoveryAttemptsBeforeRead: number;
  };
  acceptanceSpec: AgentHostBrowserAcceptanceSpec;
}

export interface AgentHostBrowserAcceptanceSpec {
  schemaVersion: 'sciforge.agent-host.browser-acceptance-spec.v1';
  taskSummary?: string;
  source: {
    requireSourcePageRefs: true;
    requirePageTextRefs: true;
    minReadSources: number;
    rejectLowInformationSources: true;
    requireIndependentSources: boolean;
    preferredDomains: string[];
    avoidedDomains: string[];
  };
  topicalTerms: string[];
  temporal?: AgentHostBrowserTemporalConstraint;
}

export type AgentHostBrowserTemporalConstraint =
  | {
      kind: 'relative-window';
      windowDays: number;
      startDate: string;
      endDate: string;
      referenceDate: string;
      source: 'prompt';
    }
  | {
      kind: 'today';
      startDate: string;
      endDate: string;
      referenceDate: string;
      source: 'prompt';
    }
  | {
      kind: 'latest';
      maxAgeDays: number;
      referenceDate: string;
      source: 'prompt';
    };

export interface AgentHostBrowserEvidenceEvaluationOptions {
  acceptanceSpec?: AgentHostBrowserAcceptanceSpec;
}

export interface AgentHostBrowserEvidenceEvaluation {
  schemaVersion: 'sciforge.agent-host.browser-evidence-evaluation.v1';
  status: 'satisfied' | 'repairable' | 'partial' | 'blocked';
  issues: AgentHostBrowserEvidenceIssue[];
  repairHints: AgentHostBrowserEvidenceRepairHint[];
  satisfiedEvidenceRefs: string[];
  acceptanceSpec?: AgentHostBrowserAcceptanceSpec;
}

export interface AgentHostBrowserSearchGuardEvaluation {
  schemaVersion: 'sciforge.agent-host.browser-search-guard-evaluation.v1';
  status: 'allowed' | 'repairable';
  issues: AgentHostBrowserEvidenceIssue[];
  repairHints: AgentHostBrowserEvidenceRepairHint[];
  satisfiedEvidenceRefs: string[];
  rejectedEvidenceRefs: string[];
}

export interface AgentHostBrowserCompletionTruth {
  schemaVersion: 'sciforge.agent-host.completion-truth.v1';
  scope: 'user-task';
  status: 'satisfied' | 'partial' | 'blocked';
  validator: 'agent-host-browser-acceptance';
  evidenceRefs: string[];
  reason?: string;
}

export function createAgentHostBrowserEvidenceLedger(): AgentHostBrowserEvidenceLedger {
  return {
    schemaVersion: 'sciforge.agent-host.browser-evidence-ledger.v1',
    resourcesByRef: {},
    resourceEvents: [],
    refs: [],
  };
}

export function recordAgentHostBrowserToolResult(
  ledger: AgentHostBrowserEvidenceLedger,
  toolResult: unknown,
): AgentHostBrowserEvidenceLedger {
  const envelope = browserPrimitiveEnvelope(toolResult);
  if (!envelope) return ledger;
  const resourcesByRef = { ...ledger.resourcesByRef };
  const resourceEvents = [...ledger.resourceEvents];
  for (const resource of envelope.resources ?? []) {
    if (!resource.ref?.trim()) continue;
    resourcesByRef[resource.ref] = resource;
    resourceEvents.push({
      ref: resource.ref,
      kind: resource.kind,
      status: resource.status,
      originTool: resource.originTool,
    });
  }
  return {
    ...ledger,
    resourcesByRef,
    resourceEvents,
    refs: uniqueStrings([...ledger.refs, ...(envelope.refs ?? []), ...resourceRefs(envelope.resources)]),
  };
}

export function recordAgentHostBrowserRefs(
  ledger: AgentHostBrowserEvidenceLedger,
  refs: readonly string[],
): AgentHostBrowserEvidenceLedger {
  return {
    ...ledger,
    refs: uniqueStrings([...ledger.refs, ...refs]),
  };
}

export function agentHostBrowserAcceptanceSpecFromPrompt(
  prompt: string | undefined,
  options: { now?: Date } = {},
): AgentHostBrowserAcceptanceSpec {
  return agentHostBrowserSearchPlanFromPrompt(prompt, options).acceptanceSpec;
}

export function agentHostBrowserSearchPlanFromPrompt(
  prompt: string | undefined,
  options: { now?: Date } = {},
): AgentHostBrowserSearchPlan {
  const now = options.now ?? new Date();
  const referenceDate = isoDate(now);
  const userPrompt = agentHostBrowserUserPromptFromCommandText(prompt);
  const temporal = temporalConstraintFromPrompt(userPrompt, now, referenceDate);
  const baseTopicalTerms = topicalTermsFromPrompt(userPrompt);
  const queryTerms = searchQueryTermsFromPrompt(userPrompt, baseTopicalTerms);
  const topicalTerms = acceptanceTopicalTerms(baseTopicalTerms, queryTerms);
  const primaryQuery = queryTerms.join(' ') || compactPlanQuery(userPrompt) || topicalTerms.join(' ');
  const preferredDomains = preferredDomainsFromPrompt(userPrompt, queryTerms);
  const avoidedDomains = avoidedDomainsFromPrompt(userPrompt);
  const minReadSources = minReadSourcesFromPrompt(userPrompt);
  const queryCandidates = searchQueryCandidates(primaryQuery, preferredDomains);
  const acceptanceSpec: AgentHostBrowserAcceptanceSpec = {
    schemaVersion: 'sciforge.agent-host.browser-acceptance-spec.v1',
    taskSummary: userPrompt?.trim().slice(0, 500) || undefined,
    source: {
      requireSourcePageRefs: true,
      requirePageTextRefs: true,
      minReadSources,
      rejectLowInformationSources: true,
      requireIndependentSources: minReadSources > 1,
      preferredDomains,
      avoidedDomains,
    },
    topicalTerms,
    ...(temporal ? { temporal } : {}),
  };
  return {
    schemaVersion: 'sciforge.agent-host.browser-search-plan.v1',
    taskSummary: userPrompt?.trim().slice(0, 500) || undefined,
    search: {
      primaryQuery,
      queryCandidates,
      preferredDomains,
      avoidedDomains,
      maxDiscoveryAttemptsBeforeRead: 1,
    },
    acceptanceSpec,
  };
}

export function agentHostBrowserUserPromptFromCommandText(prompt: string | undefined): string | undefined {
  const text = prompt?.replace(/\r\n?/g, '\n').trim();
  if (!text) return undefined;
  const currentRequest = /\nCurrent request:\s*\n+/i.exec(text);
  if (currentRequest) {
    const request = text.slice(currentRequest.index + currentRequest[0].length).trim();
    if (request) return request;
  }
  return text
    .replace(
      /^Continue the active Runtime Codex session\.\s+Interpret relative references such as [\s\S]*?(?:\n\s*\n|$)/i,
      '',
    )
    .replace(
      /^Same-chat continuity context for relative references\.[\s\S]*?(?:\nCurrent request:\s*\n+|\n\s*\n)/i,
      '',
    )
    .trim() || text;
}

export function evaluateAgentHostBrowserSearchQuery(
  query: string | undefined,
  plan: AgentHostBrowserSearchPlan,
): AgentHostBrowserSearchGuardEvaluation {
  const issues: AgentHostBrowserEvidenceIssue[] = [];
  const text = query?.trim() ?? '';
  const taskText = `${plan.taskSummary ?? ''} ${plan.acceptanceSpec.taskSummary ?? ''} ${plan.acceptanceSpec.topicalTerms.join(' ')}`;
  const querySignals = browserSearchTopicSignals(text);
  const planSignals = browserSearchTopicSignals(taskText);
  if (browserSearchWorkflowContamination(text) && !browserSearchWorkflowContamination(taskText)) {
    issues.push({
      code: 'browser-search-query-contaminated',
      message: 'Agent Host rejected the Browser search query because it contains workflow/task text that is not part of the current user intent.',
    });
  } else if (planSignals.length > 0 && querySignals.length > 0 && !signalsIntersect(planSignals, querySignals)) {
    issues.push({
      code: 'browser-search-query-topic-drift',
      message: 'Agent Host rejected the Browser search query because its topic signals do not match the current user intent.',
    });
  }
  return searchGuardEvaluation(issues, [], []);
}

export function evaluateAgentHostBrowserSearchDiscovery(
  ledger: AgentHostBrowserEvidenceLedger,
  plan: AgentHostBrowserSearchPlan,
): AgentHostBrowserSearchGuardEvaluation {
  const resources = Object.values(ledger.resourcesByRef).filter(browserSearchDiscoveryResource);
  if (resources.length === 0 || plan.acceptanceSpec.topicalTerms.length === 0) return searchGuardEvaluation([], [], []);
  const matchedRefs = resources
    .filter((resource) => agentHostBrowserResourceMatchesSearchPlan(resource, plan))
    .map((resource) => resource.ref);
  if (matchedRefs.length > 0) return searchGuardEvaluation([], matchedRefs, []);
  const rejectedRefs = resources
    .filter((resource) => browserSearchResourceLooksSpecific(resource, plan))
    .map((resource) => resource.ref);
  if (rejectedRefs.length === 0) return searchGuardEvaluation([], [], []);
  return searchGuardEvaluation([{
    code: 'browser-search-result-relevance-gap',
    message: 'Agent Host found Browser search candidates, but their visible result metadata does not match the current task topic.',
    evidenceRefs: rejectedRefs,
  }], [], rejectedRefs);
}

export function evaluateAgentHostBrowserEvidence(
  ledger: AgentHostBrowserEvidenceLedger,
  options: AgentHostBrowserEvidenceEvaluationOptions = {},
): AgentHostBrowserEvidenceEvaluation {
  const resources = Object.values(ledger.resourcesByRef);
  const sourcePageRefs = currentRunSourcePageRefs(resources, ledger.refs);
  const pageTextRefs = currentRunPageTextRefs(resources, ledger.refs);
  const finalAnswerRefs = currentRunFinalAnswerRefs(ledger.refs);
  const acceptanceSpec = options.acceptanceSpec;
  const hasSearchEvidence = resources.some((resource) => resource.originTool === 'browser.search')
    || ledger.refs.some((ref) => /\bbrowser_search\b/i.test(ref));
  const hasReadEvidence = resources.some((resource) => resource.originTool === 'browser.read')
    || ledger.refs.some((ref) => /\bbrowser_read\b/i.test(ref));
  const issues: AgentHostBrowserEvidenceIssue[] = [];
  const repairHints: AgentHostBrowserEvidenceRepairHint[] = [];

  if (!hasReadEvidence) {
    issues.push({
      code: 'browser-read-tool-missing',
      message: 'No current-run browser_read evidence was recorded.',
    });
  }
  if (sourcePageRefs.length === 0) {
    issues.push({
      code: 'browser-source-page-refs-missing',
      message: 'Browser search candidates are not source evidence until browser_read materializes source-page refs.',
    });
  }
  if (pageTextRefs.length === 0) {
    issues.push({
      code: 'browser-page-text-refs-missing',
      message: 'Browser search candidates are not page text evidence until browser_read materializes page-text refs.',
    });
  }
  if (sourcePageRefs.length === 0 || pageTextRefs.length === 0 || !hasReadEvidence) {
    repairHints.push({
      action: hasSearchEvidence ? 'call-browser-read' : 'collect-browser-evidence',
      reason: hasSearchEvidence
        ? 'Read one or more discovered web_page resources before claiming user-level Browser completion.'
        : 'Collect Browser source/page-text evidence before claiming user-level Browser completion.',
    });
    return {
      schemaVersion: 'sciforge.agent-host.browser-evidence-evaluation.v1',
      status: hasSearchEvidence ? 'repairable' : 'blocked',
      issues,
      repairHints,
      satisfiedEvidenceRefs: [],
      ...(acceptanceSpec ? { acceptanceSpec } : {}),
    };
  }

  const sourceEvidenceRefs = uniqueStrings([...sourcePageRefs, ...pageTextRefs]);
  const acceptance = acceptanceEvaluationForReadSources(resources, ledger.refs, acceptanceSpec);
  if (acceptance.issues.length > 0) {
    return {
      schemaVersion: 'sciforge.agent-host.browser-evidence-evaluation.v1',
      status: acceptance.status,
      issues: acceptance.issues,
      repairHints: acceptance.repairHints,
      satisfiedEvidenceRefs: sourceEvidenceRefs,
      ...(acceptanceSpec ? { acceptanceSpec } : {}),
    };
  }

  if (finalAnswerRefs.length === 0) {
    issues.push({
      code: 'browser-final-answer-ref-missing',
      message: 'Browser source evidence exists, but no current-run Codex App Server final-answer ref was recorded.',
      evidenceRefs: sourceEvidenceRefs,
    });
    repairHints.push({
      action: 'project-final-answer',
      reason: 'Agent Host should synthesize the final answer as a Codex App Server assistant final message after verifier acceptance.',
    });
    return {
      schemaVersion: 'sciforge.agent-host.browser-evidence-evaluation.v1',
      status: 'partial',
      issues,
      repairHints,
      satisfiedEvidenceRefs: sourceEvidenceRefs,
      ...(acceptanceSpec ? { acceptanceSpec } : {}),
    };
  }

  return {
    schemaVersion: 'sciforge.agent-host.browser-evidence-evaluation.v1',
    status: 'satisfied',
    issues: [],
    repairHints: [],
    satisfiedEvidenceRefs: uniqueStrings([...sourceEvidenceRefs, ...finalAnswerRefs]),
    ...(acceptanceSpec ? { acceptanceSpec } : {}),
  };
}

function searchGuardEvaluation(
  issues: AgentHostBrowserEvidenceIssue[],
  satisfiedEvidenceRefs: string[],
  rejectedEvidenceRefs: string[],
): AgentHostBrowserSearchGuardEvaluation {
  return {
    schemaVersion: 'sciforge.agent-host.browser-search-guard-evaluation.v1',
    status: issues.length > 0 ? 'repairable' : 'allowed',
    issues,
    repairHints: issues.length > 0
      ? [{
          action: 'collect-browser-evidence',
          reason: 'Agent Host should repair the Browser search plan/query before reading sources or synthesizing an answer.',
        }]
      : [],
    satisfiedEvidenceRefs,
    rejectedEvidenceRefs,
  };
}

export function agentHostBrowserCompletionTruthFromEvaluation(
  evaluation: AgentHostBrowserEvidenceEvaluation,
): AgentHostBrowserCompletionTruth {
  if (evaluation.status === 'satisfied') {
    return {
      schemaVersion: 'sciforge.agent-host.completion-truth.v1',
      scope: 'user-task',
      status: 'satisfied',
      validator: 'agent-host-browser-acceptance',
      evidenceRefs: evaluation.satisfiedEvidenceRefs,
      reason: 'Browser source/page text refs and Codex App Server final-answer evidence are present in the current run.',
    };
  }
  if (evaluation.status === 'partial') {
    return {
      schemaVersion: 'sciforge.agent-host.completion-truth.v1',
      scope: 'user-task',
      status: 'partial',
      validator: 'agent-host-browser-acceptance',
      evidenceRefs: evaluation.satisfiedEvidenceRefs,
      reason: evaluation.issues.map((issue) => issue.message).join(' '),
    };
  }
  return {
    schemaVersion: 'sciforge.agent-host.completion-truth.v1',
    scope: 'user-task',
    status: 'blocked',
    validator: 'agent-host-browser-acceptance',
    evidenceRefs: evaluation.satisfiedEvidenceRefs,
    reason: evaluation.issues.map((issue) => issue.message).join(' '),
  };
}

function browserPrimitiveEnvelope(value: unknown): BrowserPrimitiveEnvelope | undefined {
  const candidate = isRecord(value) && isRecord(value.value) ? value.value : value;
  if (!isRecord(candidate)) return undefined;
  if (candidate.schemaVersion !== 'sciforge.browser-runtime.primitive-result.v1') return undefined;
  if (candidate.moduleId !== 'browser') return undefined;
  if (!Array.isArray(candidate.resources)) return undefined;
  return candidate as unknown as BrowserPrimitiveEnvelope;
}

function currentRunSourcePageRefs(resources: BrowserResource[], refs: string[]): string[] {
  return uniqueStrings([
    ...resources
      .filter((resource) => resource.kind === 'source_page' && resource.status === 'read')
      .map((resource) => resource.ref),
    ...refs.filter((ref) => /source-pages\/.+\.source\.json$/i.test(ref)),
  ]).filter(isCurrentRunBrowserEvidenceRef);
}

function currentRunPageTextRefs(resources: BrowserResource[], refs: string[]): string[] {
  return uniqueStrings([
    ...resources
      .filter((resource) => resource.kind === 'page_text' && resource.status === 'read')
      .map((resource) => resource.ref),
    ...refs.filter((ref) => /source-pages\/.+\.txt$/i.test(ref)),
  ]).filter(isCurrentRunBrowserEvidenceRef);
}

function currentRunFinalAnswerRefs(refs: string[]): string[] {
  return refs.filter((ref) => /(?:^|[:/_-])codex\.app-server\.final-answer\b|final[-_/]?answer/i.test(ref));
}

function acceptanceEvaluationForReadSources(
  resources: BrowserResource[],
  refs: string[],
  spec: AgentHostBrowserAcceptanceSpec | undefined,
): Pick<AgentHostBrowserEvidenceEvaluation, 'status' | 'issues' | 'repairHints'> {
  if (!spec) return { status: 'satisfied', issues: [], repairHints: [] };
  const readResources = currentRunReadResources(resources, refs);
  const lowInformationRefs = readResources.filter(browserResourceLooksLowInformation).map((resource) => resource.ref);
  const completionEligibleSourceRefs = currentRunSourcePageRefs(
    readResources.filter((resource) => resource.kind === 'source_page' && !lowInformationRefs.includes(resource.ref)),
    refs,
  );
  const issues: AgentHostBrowserEvidenceIssue[] = [];
  const repairHints: AgentHostBrowserEvidenceRepairHint[] = [];
  if (lowInformationRefs.length > 0) {
    issues.push({
      code: 'browser-source-low-information',
      message: 'Browser read refs only include low-information navigation, login, or discovery-only pages.',
      evidenceRefs: lowInformationRefs,
    });
  }
  if (completionEligibleSourceRefs.length < spec.source.minReadSources) {
    issues.push({
      code: 'browser-source-count-insufficient',
      message: `Browser acceptance requires at least ${spec.source.minReadSources} current-run read source page ref(s).`,
      evidenceRefs: completionEligibleSourceRefs,
    });
  }
  if (spec.source.requireIndependentSources) {
    const independentDomains = uniqueStrings(readResources
      .map((resource) => browserResourceDomain(resource))
      .filter(Boolean));
    if (independentDomains.length < spec.source.minReadSources) {
      issues.push({
        code: 'browser-source-independent-count-insufficient',
        message: `Browser acceptance requires at least ${spec.source.minReadSources} independent source domain(s).`,
        evidenceRefs: readResources.map((resource) => resource.ref),
      });
    }
  }
  if (spec.source.preferredDomains.length > 0) {
    const hasPreferredDomain = readResources.some((resource) => {
      const domain = browserResourceDomain(resource);
      return domain ? domainMatchesAny(domain, spec.source.preferredDomains) : false;
    });
    if (!hasPreferredDomain) {
      issues.push({
        code: 'browser-source-authority-gap',
        message: 'Browser read refs were materialized, but none match the Agent Host preferred source domains for this task.',
        evidenceRefs: readResources.map((resource) => resource.ref),
      });
    }
  }

  const textualResources = readResources
    .map((resource) => normalizeText(browserResourceSearchText(resource)))
    .filter(Boolean);
  if (spec.topicalTerms.length > 0 && textualResources.length === 0) {
    issues.push({
      code: 'browser-source-relevance-evidence-missing',
      message: 'Browser read refs were materialized, but source metadata contains no searchable text for topic relevance verification.',
      evidenceRefs: readResources.map((resource) => resource.ref),
    });
  } else if (spec.topicalTerms.length > 0) {
    const matched = spec.topicalTerms.some((term) => {
      const normalized = normalizeText(term);
      return normalized && textualResources.some((text) => text.includes(normalized));
    });
    if (!matched) {
      issues.push({
        code: 'browser-source-relevance-gap',
        message: 'Browser read refs were materialized, but available source metadata does not match the task topic.',
        evidenceRefs: readResources.map((resource) => resource.ref),
      });
    }
  }

  const temporalIssue = temporalAcceptanceIssue(readResources, spec);
  if (temporalIssue) issues.push(temporalIssue);

  if (issues.length === 0) return { status: 'satisfied', issues: [], repairHints: [] };
  repairHints.push({
    action: 'call-browser-read',
    reason: 'Read additional task-relevant source pages before claiming Browser user-level completion.',
  });
  return {
    status: issues.some((issue) =>
      issue.code === 'browser-source-low-information' || issue.code === 'browser-source-count-insufficient')
      ? 'blocked'
      : 'partial',
    issues,
    repairHints,
  };
}

function currentRunReadResources(resources: BrowserResource[], refs: string[]): BrowserResource[] {
  const currentRefs = new Set(uniqueStrings([
    ...currentRunSourcePageRefs(resources, refs),
    ...currentRunPageTextRefs(resources, refs),
  ]));
  return resources.filter((resource) =>
    resource.status === 'read'
    && (currentRefs.has(resource.ref) || resource.kind === 'web_page')
    && !/(?:fixture|replay|history|seed|demo)/i.test(resource.ref));
}

function browserResourceLooksLowInformation(resource: BrowserResource): boolean {
  if (resource.metadata?.discoveryOnly === true) return true;
  const url = stringFromRecord(resource.locator, 'url') ?? stringFromRecord(resource.metadata, 'finalUrl');
  if (url && browserUrlLooksLowInformation(url)) return true;
  const text = normalizeText(browserResourceSearchText(resource));
  if (!text) return false;
  return /\b(?:login|sign in|sign-in|homepage|home page|privacy policy|terms of service|skip to main content)\b/i.test(text)
    && text.length < 500;
}

function browserUrlLooksLowInformation(value: string): boolean {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/g, '').toLowerCase();
    return path === ''
      || path === '/'
      || /^\/(?:login|signin|sign-in|account|help|about|contact|privacy|terms)$/i.test(path);
  } catch {
    return false;
  }
}

function browserResourceSearchText(resource: BrowserResource): string {
  return [
    resource.title,
    resource.snippet,
    stringFromRecord(resource.locator, 'url'),
    stringFromRecord(resource.metadata, 'finalUrl'),
    stringFromRecord(resource.metadata, 'textPreview'),
    stringFromRecord(resource.metadata, 'textSummary'),
    stringFromRecord(resource.metadata, 'publishedAt'),
    stringFromRecord(resource.metadata, 'date'),
  ].filter(Boolean).join(' ');
}

function temporalAcceptanceIssue(
  resources: BrowserResource[],
  spec: AgentHostBrowserAcceptanceSpec,
): AgentHostBrowserEvidenceIssue | undefined {
  if (!spec.temporal) return undefined;
  const dates = uniqueStrings(resources.flatMap(browserResourceDates)).sort();
  if (dates.length === 0) {
    return {
      code: 'browser-source-temporal-evidence-missing',
      message: 'Browser acceptance requires current/recent source evidence, but source metadata contains no verifiable dates.',
      evidenceRefs: resources.map((resource) => resource.ref),
    };
  }
  const temporal = spec.temporal;
  const startDate = temporal.kind === 'latest'
    ? isoDateMinusDays(temporal.referenceDate, temporal.maxAgeDays)
    : temporal.startDate;
  const endDate = temporal.kind === 'latest' ? temporal.referenceDate : temporal.endDate;
  const inWindow = dates.some((date) => date >= startDate && date <= endDate);
  if (inWindow) return undefined;
  return {
    code: 'browser-source-temporal-gap',
    message: `Browser source dates do not satisfy the requested ${temporal.kind} window ${startDate}..${endDate}.`,
    evidenceRefs: resources.map((resource) => resource.ref),
  };
}

function browserResourceDates(resource: BrowserResource): string[] {
  const rawValues = [
    stringFromRecord(resource.metadata, 'publishedAt'),
    stringFromRecord(resource.metadata, 'date'),
    stringFromRecord(resource.metadata, 'updatedAt'),
    browserResourceSearchText(resource),
  ];
  return rawValues.flatMap((value) => value ? isoDatesInText(value) : []);
}

function temporalConstraintFromPrompt(
  prompt: string | undefined,
  now: Date,
  referenceDate: string,
): AgentHostBrowserTemporalConstraint | undefined {
  const text = prompt ?? '';
  if (/最近一周|近一周|过去一周|last\s+7\s+days|past\s+week|last\s+week|recent\s+week/i.test(text)) {
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 7);
    return {
      kind: 'relative-window',
      windowDays: 7,
      startDate: isoDate(start),
      endDate: referenceDate,
      referenceDate,
      source: 'prompt',
    };
  }
  if (/今天|今日|\btoday\b/i.test(text)) {
    return {
      kind: 'today',
      startDate: referenceDate,
      endDate: referenceDate,
      referenceDate,
      source: 'prompt',
    };
  }
  if (/最新|最近|当前|current|latest|recent/i.test(text)) {
    return {
      kind: 'latest',
      maxAgeDays: 14,
      referenceDate,
      source: 'prompt',
    };
  }
  return undefined;
}

function minReadSourcesFromPrompt(prompt: string | undefined): number {
  const text = prompt ?? '';
  if (/对比|比较|交叉验证|核验|多方|多个来源|两家|多家|compare|cross[-\s]?check|verify|multiple\s+sources/i.test(text)) {
    return 2;
  }
  return 1;
}

function searchQueryTermsFromPrompt(prompt: string | undefined, topicalTerms: string[]): string[] {
  const text = prompt ?? '';
  const terms: string[] = [];
  if (/\bOpenAI\b/i.test(text)) terms.push('OpenAI');
  if (/官方|official/i.test(text)) terms.push('官方');
  if (/产品更新|product\s+updates?|release\s+notes?/i.test(text)) terms.push('产品更新');
  if (/伊朗局势/u.test(text)) terms.push('伊朗局势');
  if (/媒体|media|press/i.test(text)) terms.push('媒体');
  for (const term of topicalTerms) {
    if (/^(?:一条|的一条|发布|官方)$/u.test(term)) continue;
    terms.push(term);
  }
  return uniqueStrings(terms).slice(0, 8);
}

function acceptanceTopicalTerms(topicalTerms: readonly string[], queryTerms: readonly string[]): string[] {
  return uniqueStrings([
    ...topicalTerms,
    ...queryTerms.filter((term) => /产品更新|product\s+updates?/i.test(term)),
  ]).slice(0, 12);
}

function preferredDomainsFromPrompt(prompt: string | undefined, queryTerms: readonly string[]): string[] {
  const text = prompt ?? '';
  const joined = queryTerms.join(' ');
  const domains: string[] = [];
  if (/\bOpenAI\b/i.test(joined) && /官方|official|产品更新|product\s+updates?|release\s+notes?/i.test(text)) {
    domains.push('openai.com', 'platform.openai.com', 'developers.openai.com');
  }
  domains.push(...siteDomainsFromPrompt(text));
  return uniqueStrings(domains);
}

function avoidedDomainsFromPrompt(prompt: string | undefined): string[] {
  const text = prompt ?? '';
  const domains: string[] = [];
  for (const match of text.matchAll(/(?:不要|排除|avoid|exclude)\s+(?:site:)?([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    domains.push(match[1]);
  }
  return uniqueStrings(domains);
}

function siteDomainsFromPrompt(prompt: string): string[] {
  return uniqueStrings(Array.from(prompt.matchAll(/\bsite:([a-z0-9.-]+\.[a-z]{2,})\b/gi)).map((match) => match[1]));
}

function searchQueryCandidates(primaryQuery: string, preferredDomains: readonly string[]): string[] {
  const scoped = preferredDomains.map((domain) => `site:${domain} ${primaryQuery}`);
  return uniqueStrings([...scoped, primaryQuery].filter(Boolean)).slice(0, 5);
}

function compactPlanQuery(prompt: string | undefined): string {
  const text = prompt ?? '';
  return normalizeText(text
    .replace(/不要只凭记忆回答|不要只给搜索结果|不要只给|凭记忆回答|引用编号|最近一周|近一周|过去一周|今天|今日|最新|最近|当前|来源链接|来源|链接|搜索|搜一下|查询|查一下|总结|回答|请你|请|帮我|帮忙|麻烦|一下|并列出|列出|必须先调用|调用|网页正文|实际读取|验收标记/gu, ' ')
    .replace(/\b(?:sciforge|search|read|answer|summarize|summary|source|sources|refs?|latest|recent|current|today|week|links?|browser|evidence|and|from|with|for|the|this|that|user|task|cite|list|provide)\b/giu, ' '))
    .slice(0, 120);
}

function topicalTermsFromPrompt(prompt: string | undefined): string[] {
  if (!prompt?.trim()) return [];
  const text = prompt
    .replace(/不要只凭记忆回答|不要只给搜索结果|不要只给|凭记忆回答|引用编号|最近一周|近一周|过去一周|今天|今日|最新|最近|当前|官方|发布|产品更新|一条|的一条|来源链接|来源|链接|搜索|搜一下|查询|查一下|总结|回答|请你|请|帮我|帮忙|麻烦|一下|并列出|列出|必须先调用|调用|网页正文|实际读取|验收标记/gu, ' ')
    .replace(/\b(?:sciforge|search|read|answer|summarize|summary|source|sources|refs?|latest|recent|current|today|week|links?|browser|evidence|and|from|with|for|the|this|that|user|task|cite|list|provide)\b/giu, ' ');
  const cjkTerms = (text.match(/[\p{Script=Han}]{2,}/gu) ?? [])
    .map((term) => term.replace(/^[或和与及]+/u, '').replace(/[的是了]+$/u, ''))
    .filter((term) => !/使用|内置|读取|页面|主题|调用|正文|中文|简短|新闻|动态|网页|来源|结果|编号|记忆|回答/.test(term));
  const latinTerms = (text.match(/[a-z0-9][a-z0-9-]{2,}/giu) ?? [])
    .filter((term) => !/^(?:search|read|browser|source|refs?|sciforge|actual|web)$/i.test(term));
  return uniqueStrings([...latinTerms, ...cjkTerms]).slice(0, 12);
}

function browserSearchDiscoveryResource(resource: BrowserResource): boolean {
  return resource.originTool === 'browser.search'
    && resource.status !== 'read'
    && resource.status !== 'blocked'
    && resource.status !== 'failed'
    && (resource.kind === 'web_page' || resource.kind === 'search_result_set');
}

function agentHostBrowserResourceMatchesSearchPlan(
  resource: BrowserResource,
  plan: AgentHostBrowserSearchPlan,
): boolean {
  const text = browserResourceSearchText(resource);
  if (!text.trim()) return false;
  const taskText = `${plan.taskSummary ?? ''} ${plan.acceptanceSpec.topicalTerms.join(' ')}`;
  const planSignals = browserSearchTopicSignals(taskText);
  const resourceSignals = browserSearchTopicSignals(text);
  if (planSignals.length > 0 && resourceSignals.length > 0 && signalsIntersect(planSignals, resourceSignals)) return true;
  return plan.acceptanceSpec.topicalTerms.some((term) => browserSearchTermMatchesText(term, text));
}

function browserSearchResourceLooksSpecific(
  resource: BrowserResource,
  plan: AgentHostBrowserSearchPlan,
): boolean {
  const text = browserResourceSearchText(resource);
  if (!text.trim()) return false;
  const taskText = `${plan.taskSummary ?? ''} ${plan.acceptanceSpec.topicalTerms.join(' ')}`;
  const planSignals = browserSearchTopicSignals(taskText);
  const resourceSignals = browserSearchTopicSignals(text);
  if (planSignals.length > 0 && resourceSignals.length > 0 && !signalsIntersect(planSignals, resourceSignals)) return true;
  if (/[\p{Script=Han}]{4,}/u.test(text)) return true;
  const specificLatinTokens = (text.match(/[a-z][a-z-]{4,}/giu) ?? [])
    .map((token) => token.toLowerCase())
    .filter((token) => !/^(?:https?|source|candidate|result|results|browser|search|latest|recent|current|example|login|signin|sign-in|page|pages|news|update|updates)$/i.test(token));
  return specificLatinTokens.length >= 2;
}

function browserSearchTermMatchesText(term: string, text: string): boolean {
  const normalizedText = normalizeText(text);
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) return false;
  if (normalizedText.includes(normalizedTerm)) return true;
  if (/伊朗/u.test(term)) return /\biran(?:ian)?\b|伊朗/u.test(normalizedText);
  if (/openai/i.test(term)) return /\bopenai\b/i.test(normalizedText);
  if (/产品更新/u.test(term)) return /产品更新|product\s+updates?|release\s+notes?|changelog|updates?/iu.test(normalizedText);
  if (/人工智能/u.test(term)) return /人工智能|\bai\b|artificial\s+intelligence/iu.test(normalizedText);
  return false;
}

function browserSearchTopicSignals(text: string | undefined): string[] {
  const value = text ?? '';
  const signals: string[] = [];
  if (/\bopenai\b/i.test(value)) signals.push('openai');
  if (/\biran(?:ian)?\b|伊朗/u.test(value)) signals.push('iran');
  if (browserSearchWorkflowContamination(value)) signals.push('computer-use-workflow');
  return uniqueStrings(signals);
}

function browserSearchWorkflowContamination(text: string | undefined): boolean {
  return /Computer Use acceptance task|visible desktop|ordinary SciForge Desktop chat|product chat surface|bind the curr|permission handoff|live acceptance/i.test(text ?? '');
}

function signalsIntersect(left: readonly string[], right: readonly string[]): boolean {
  const rightSet = new Set(right);
  return left.some((signal) => rightSet.has(signal));
}

function browserResourceDomain(resource: BrowserResource): string | undefined {
  const url = stringFromRecord(resource.locator, 'url') ?? stringFromRecord(resource.metadata, 'finalUrl');
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function domainMatchesAny(domain: string, preferredDomains: readonly string[]): boolean {
  const normalized = domain.toLowerCase().replace(/^www\./, '');
  return preferredDomains.some((preferred) => {
    const candidate = preferred.toLowerCase().replace(/^www\./, '');
    return normalized === candidate || normalized.endsWith(`.${candidate}`);
  });
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isoDateMinusDays(referenceDate: string, days: number): string {
  const value = new Date(`${referenceDate}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return isoDate(value);
}

function isoDatesInText(value: string): string[] {
  const monthNumbers: Record<string, string> = {
    jan: '01',
    january: '01',
    feb: '02',
    february: '02',
    mar: '03',
    march: '03',
    apr: '04',
    april: '04',
    may: '05',
    jun: '06',
    june: '06',
    jul: '07',
    july: '07',
    aug: '08',
    august: '08',
    sep: '09',
    september: '09',
    oct: '10',
    october: '10',
    nov: '11',
    november: '11',
    dec: '12',
    december: '12',
  };
  return uniqueStrings([
    ...(value.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []),
    ...(value.match(/\b\d{4}\/\d{2}\/\d{2}\b/g) ?? []).map((date) => date.replace(/\//g, '-')),
    ...Array.from(value.matchAll(/\b(20\d{2})年(\d{1,2})月(\d{1,2})日(?=$|[\s,.;:!?，。；：！？])/g))
      .map((match) => `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`),
    ...Array.from(value.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s+(20\d{2})\b/gi))
      .map((match) => `${match[3]}-${monthNumbers[String(match[1]).toLowerCase()] ?? '01'}-${String(match[2]).padStart(2, '0')}`),
  ]);
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function stringFromRecord(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resourceRefs(resources: readonly BrowserResource[] | undefined): string[] {
  if (!resources) return [];
  return resources.flatMap((resource) => [resource.ref, ...(resource.refs ?? [])]);
}

function isCurrentRunBrowserEvidenceRef(ref: string): boolean {
  return /^browser-host-session:/i.test(ref) && !/(?:fixture|replay|history|seed|demo)/i.test(ref);
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
