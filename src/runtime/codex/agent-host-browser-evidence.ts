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
  action: 'call-browser-read' | 'project-final-answer' | 'collect-browser-evidence' | 'collect-web-search-evidence';
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
    readRequired: boolean;
    requireSourcePageRefs: boolean;
    requirePageTextRefs: boolean;
    minReadSources: number;
    minSearchSources: number;
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
  finalAnswerText?: string;
}

export type AgentHostWebSearchEvidenceRoute = 'native' | 'fallback' | 'unknown';

export interface AgentHostWebSearchEvidenceSourceLink {
  ref: string;
  url: string;
  title?: string;
  snippet?: string;
  source?: string;
  provider?: string;
  publishedAt?: string;
}

export interface AgentHostWebSearchEvidence {
  schemaVersion: 'sciforge.agent-host.web-search-evidence.v1';
  route: AgentHostWebSearchEvidenceRoute;
  query?: string;
  provider?: string;
  resultSetRefs: string[];
  sourceLinks: AgentHostWebSearchEvidenceSourceLink[];
  refs: string[];
  timings: Record<string, unknown>;
  diagnostics: unknown[];
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
  const webEnvelope = webRuntimeToolResultEnvelope(toolResult);
  if (!envelope && !webEnvelope) return ledger;
  const resources = envelope?.resources ?? webRuntimeResources(webEnvelope);
  const refs = envelope?.refs ?? webRuntimeRefs(webEnvelope);
  const resourcesByRef = { ...ledger.resourcesByRef };
  const resourceEvents = [...ledger.resourceEvents];
  for (const resource of resources) {
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
    refs: uniqueStrings([...ledger.refs, ...refs, ...resourceRefs(resources)]),
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

export function agentHostWebSearchEvidenceFromLedger(
  ledger: AgentHostBrowserEvidenceLedger,
  options: { route?: AgentHostWebSearchEvidenceRoute } = {},
): AgentHostWebSearchEvidence {
  return agentHostWebSearchEvidenceFromResources(Object.values(ledger.resourcesByRef), ledger.refs, {
    route: options.route ?? 'unknown',
  });
}

export function agentHostWebSearchEvidenceFromToolResult(
  toolResult: unknown,
  options: { route?: AgentHostWebSearchEvidenceRoute } = {},
): AgentHostWebSearchEvidence {
  const envelope = webRuntimeToolResultEnvelope(toolResult);
  if (envelope && stringFromRecord(envelope, 'tool') === 'web_search') {
    return agentHostWebSearchEvidenceFromResources(webSearchRuntimeResources(envelope), webRuntimeRefs(envelope), {
      route: options.route ?? 'fallback',
      provider: stringFromRecord(envelope, 'provider'),
      query: stringFromRecord(recordFromRecord(envelope, 'data'), 'query'),
      timings: recordFromRecord(envelope, 'timings') ?? {},
      diagnostics: arrayFromRecord(envelope, 'diagnostics'),
    });
  }
  const candidate = isRecord(toolResult) && isRecord(toolResult.value) ? toolResult.value : toolResult;
  return agentHostNativeWebSearchEvidenceFromRecord(isRecord(candidate) ? candidate : {}, {
    route: options.route ?? 'native',
  });
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
  const readRequired = readRequiredFromPrompt(userPrompt);
  const minSearchSources = minSearchSourcesFromPrompt(userPrompt);
  const minReadSources = readRequired ? minReadSourcesFromPrompt(userPrompt) : 0;
  const queryCandidates = searchQueryCandidates(primaryQuery, preferredDomains);
  const acceptanceSpec: AgentHostBrowserAcceptanceSpec = {
    schemaVersion: 'sciforge.agent-host.browser-acceptance-spec.v1',
    taskSummary: userPrompt?.trim().slice(0, 500) || undefined,
    source: {
      readRequired,
      requireSourcePageRefs: readRequired,
      requirePageTextRefs: readRequired,
      minReadSources,
      minSearchSources,
      rejectLowInformationSources: true,
      requireIndependentSources: Math.max(minReadSources, minSearchSources) > 1,
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
  const finalAnswerSourceLinks = finalAnswerSourceLinksFromText(options.finalAnswerText);
  const acceptanceSpec = options.acceptanceSpec;
  const hasSearchEvidence = resources.some((resource) => isWebSearchOriginTool(resource.originTool))
    || ledger.refs.some(isWebSearchToolRef);
  const hasReadEvidence = resources.some((resource) => isWebReadOriginTool(resource.originTool))
    || ledger.refs.some(isWebReadToolRef);
  const issues: AgentHostBrowserEvidenceIssue[] = [];
  const repairHints: AgentHostBrowserEvidenceRepairHint[] = [];

  if (acceptanceSpec && !acceptanceSpec.source.readRequired && sourcePageRefs.length === 0 && pageTextRefs.length === 0) {
    return evaluateAgentHostOrdinarySearchEvidence({
      resources,
      refs: ledger.refs,
      finalAnswerRefs,
      finalAnswerSourceLinks,
      acceptanceSpec,
    });
  }

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

function evaluateAgentHostOrdinarySearchEvidence(input: {
  resources: BrowserResource[];
  refs: string[];
  finalAnswerRefs: string[];
  finalAnswerSourceLinks: string[];
  acceptanceSpec: AgentHostBrowserAcceptanceSpec;
}): AgentHostBrowserEvidenceEvaluation {
  const searchResources = currentRunSearchResources(input.resources, input.refs);
  const sourceResources = searchResources.filter((resource) => resource.kind === 'web_page' && browserResourceUrl(resource));
  const searchRefs = uniqueStrings([
    ...searchResources.map((resource) => resource.ref),
    ...input.refs.filter(isWebSearchToolRef),
  ]);
  const issues: AgentHostBrowserEvidenceIssue[] = [];
  const repairHints: AgentHostBrowserEvidenceRepairHint[] = [];

  if (sourceResources.length < input.acceptanceSpec.source.minSearchSources) {
    issues.push({
      code: 'web-search-source-count-insufficient',
      message: `Ordinary search acceptance requires at least ${input.acceptanceSpec.source.minSearchSources} current-run search source link(s).`,
      evidenceRefs: searchRefs,
    });
  }

  if (input.acceptanceSpec.source.requireIndependentSources) {
    const independentDomains = uniqueStrings(sourceResources
      .map((resource) => browserResourceDomain(resource))
      .filter(Boolean));
    if (independentDomains.length < input.acceptanceSpec.source.minSearchSources) {
      issues.push({
        code: 'web-search-source-independent-count-insufficient',
        message: `Ordinary search acceptance requires at least ${input.acceptanceSpec.source.minSearchSources} independent search source domain(s).`,
        evidenceRefs: sourceResources.map((resource) => resource.ref),
      });
    }
  }

  if (input.acceptanceSpec.topicalTerms.length > 0 && sourceResources.length > 0) {
    const matched = sourceResources.some((resource) =>
      input.acceptanceSpec.topicalTerms.some((term) =>
        browserSearchTermMatchesText(term, browserResourceSearchText(resource))));
    if (!matched) {
      issues.push({
        code: 'web-search-source-relevance-gap',
        message: 'Search result metadata does not match the task topic closely enough for ordinary search completion.',
        evidenceRefs: sourceResources.map((resource) => resource.ref),
      });
    }
  }

  const temporalIssue = temporalSearchAcceptanceIssue(sourceResources, input.acceptanceSpec);
  if (temporalIssue) issues.push(temporalIssue);

  if (input.finalAnswerRefs.length === 0) {
    issues.push({
      code: 'browser-final-answer-ref-missing',
      message: 'Search evidence exists, but no current-run Codex App Server final-answer ref was recorded.',
      evidenceRefs: searchRefs,
    });
    repairHints.push({
      action: 'project-final-answer',
      reason: 'Agent Host should synthesize the final answer as a Codex App Server assistant final message after search evidence is accepted.',
    });
  }

  if (input.finalAnswerRefs.length > 0 && input.finalAnswerSourceLinks.length === 0) {
    issues.push({
      code: 'web-search-final-answer-source-links-missing',
      message: 'Ordinary search completion requires source links in the final answer.',
      evidenceRefs: searchRefs,
    });
  }

  if (issues.length > 0) {
    if (sourceResources.length === 0 || issues.some((issue) => issue.code === 'web-search-source-count-insufficient')) {
      repairHints.push({
        action: 'collect-web-search-evidence',
        reason: 'Collect enough current-run web_search source links before answering the ordinary search task.',
      });
    }
    return {
      schemaVersion: 'sciforge.agent-host.browser-evidence-evaluation.v1',
      status: input.finalAnswerRefs.length > 0 && sourceResources.length > 0 ? 'partial' : 'repairable',
      issues,
      repairHints,
      satisfiedEvidenceRefs: sourceResources.length > 0 ? searchRefs : [],
      acceptanceSpec: input.acceptanceSpec,
    };
  }

  return {
    schemaVersion: 'sciforge.agent-host.browser-evidence-evaluation.v1',
    status: 'satisfied',
    issues: [],
    repairHints: [],
    satisfiedEvidenceRefs: uniqueStrings([...searchRefs, ...input.finalAnswerRefs]),
    acceptanceSpec: input.acceptanceSpec,
  };
}

export function agentHostBrowserCompletionTruthFromEvaluation(
  evaluation: AgentHostBrowserEvidenceEvaluation,
): AgentHostBrowserCompletionTruth {
  if (evaluation.status === 'satisfied') {
    const hasReadEvidence = evaluation.satisfiedEvidenceRefs.some((ref) => isSourcePageEvidenceRef(ref) || isPageTextEvidenceRef(ref));
    return {
      schemaVersion: 'sciforge.agent-host.completion-truth.v1',
      scope: 'user-task',
      status: 'satisfied',
      validator: 'agent-host-browser-acceptance',
      evidenceRefs: evaluation.satisfiedEvidenceRefs,
      reason: hasReadEvidence
        ? 'Browser source/page text refs and Codex App Server final-answer evidence are present in the current run.'
        : 'Current-run web_search results, source links, and Codex App Server final-answer evidence satisfy the ordinary search task.',
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

function webRuntimeToolResultEnvelope(value: unknown): Record<string, unknown> | undefined {
  const candidate = isRecord(value) && isRecord(value.value) ? value.value : value;
  if (!isRecord(candidate)) return undefined;
  if (candidate.schemaVersion !== 'sciforge.web-runtime.result.v1') return undefined;
  if (candidate.tool !== 'web_search' && candidate.tool !== 'web_read') return undefined;
  if (!Array.isArray(candidate.refs)) return undefined;
  return candidate;
}

function webRuntimeRefs(envelope: Record<string, unknown> | undefined): string[] {
  if (!envelope) return [];
  return Array.isArray(envelope.refs)
    ? envelope.refs.filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0)
    : [];
}

function webRuntimeResources(envelope: Record<string, unknown> | undefined): BrowserResource[] {
  if (!envelope) return [];
  const tool = stringFromRecord(envelope, 'tool');
  if (tool === 'web_search') return webSearchRuntimeResources(envelope);
  if (tool === 'web_read') return webReadRuntimeResources(envelope);
  return [];
}

function webSearchRuntimeResources(envelope: Record<string, unknown>): BrowserResource[] {
  const refs = webRuntimeRefs(envelope);
  const data = recordFromRecord(envelope, 'data');
  const provider = stringFromRecord(envelope, 'provider');
  const searchRef = stringFromRecord(data, 'resultSetRef') ?? refs.find((ref) => /^web-search:/i.test(ref));
  const resources: BrowserResource[] = [];
  if (searchRef) {
    resources.push({
      ref: searchRef,
      kind: 'search_result_set',
      status: 'discovered',
      originTool: 'web.search' as never,
      title: stringFromRecord(data, 'query'),
      confidence: 'candidate',
      metadata: {
        ...(provider ? { provider } : {}),
        evidenceBoundary: stringFromRecord(data, 'evidenceBoundary'),
      },
    });
  }
  const results = Array.isArray(data?.results) ? data.results : [];
  for (const item of results) {
    if (!isRecord(item)) continue;
    const ref = stringFromRecord(item, 'resourceRef');
    const url = stringFromRecord(item, 'url');
    if (!ref) continue;
    resources.push({
      ref,
      kind: 'web_page',
      status: 'discovered',
      originTool: 'web.search' as never,
      ...(url ? { locator: { url } } : {}),
      title: stringFromRecord(item, 'title'),
      snippet: stringFromRecord(item, 'snippet'),
      confidence: 'candidate',
      metadata: {
        ...(provider ? { provider } : {}),
        source: stringFromRecord(item, 'source'),
        publishedAt: stringFromRecord(item, 'publishedAt'),
        searchRef,
      },
    });
  }
  return resources;
}

function webReadRuntimeResources(envelope: Record<string, unknown>): BrowserResource[] {
  const refs = webRuntimeRefs(envelope);
  const data = recordFromRecord(envelope, 'data');
  const source = recordFromRecord(data, 'source');
  const content = recordFromRecord(data, 'content');
  const provider = stringFromRecord(envelope, 'provider');
  const sourceRef = stringFromRecord(source, 'sourceRef') ?? refs.find((ref) => /^web-source:/i.test(ref));
  const pageTextRef = stringFromRecord(source, 'pageTextRef')
    ?? stringFromRecord(content, 'textRef')
    ?? refs.find((ref) => /^web-text:/i.test(ref));
  const finalUrl = stringFromRecord(source, 'finalUrl') ?? stringFromRecord(source, 'requestedUrl');
  const locator = finalUrl ? { url: finalUrl } : undefined;
  const metadata = {
    ...(provider ? { provider } : {}),
    requestedUrl: stringFromRecord(source, 'requestedUrl'),
    finalUrl,
    publishedAt: stringFromRecord(source, 'publishedAt'),
    openedAt: stringFromRecord(source, 'openedAt'),
    textSha1: stringFromRecord(source, 'textSha1'),
    textPreview: stringFromRecord(content, 'preview'),
  };
  const resources: BrowserResource[] = [];
  if (sourceRef) {
    resources.push({
      ref: sourceRef,
      kind: 'source_page',
      status: 'read',
      originTool: 'web.read' as never,
      ...(locator ? { locator } : {}),
      title: stringFromRecord(source, 'title'),
      metadata,
      confidence: 'materialized',
    });
  }
  if (pageTextRef) {
    resources.push({
      ref: pageTextRef,
      kind: 'page_text',
      status: 'read',
      originTool: 'web.read' as never,
      ...(locator ? { locator } : {}),
      title: stringFromRecord(source, 'title'),
      metadata,
      confidence: 'materialized',
    });
  }
  return resources;
}

function agentHostWebSearchEvidenceFromResources(
  resources: BrowserResource[],
  refs: string[],
  options: {
    route: AgentHostWebSearchEvidenceRoute;
    provider?: string;
    query?: string;
    timings?: Record<string, unknown>;
    diagnostics?: unknown[];
  },
): AgentHostWebSearchEvidence {
  const searchResources = currentRunSearchResources(resources, refs);
  const resultSetRefs = uniqueStrings(searchResources
    .filter((resource) => resource.kind === 'search_result_set')
    .map((resource) => resource.ref));
  const sourceLinks = searchResources
    .filter((resource) => resource.kind === 'web_page')
    .map((resource) => {
      const url = browserResourceUrl(resource);
      if (!url) return undefined;
      return {
        ref: resource.ref,
        url,
        ...(resource.title ? { title: resource.title } : {}),
        ...(resource.snippet ? { snippet: resource.snippet } : {}),
        ...(stringFromRecord(resource.metadata, 'source') ? { source: stringFromRecord(resource.metadata, 'source') } : {}),
        ...(stringFromRecord(resource.metadata, 'provider') ? { provider: stringFromRecord(resource.metadata, 'provider') } : {}),
        ...(stringFromRecord(resource.metadata, 'publishedAt') ? { publishedAt: stringFromRecord(resource.metadata, 'publishedAt') } : {}),
      } satisfies AgentHostWebSearchEvidenceSourceLink;
    })
    .filter((source): source is AgentHostWebSearchEvidenceSourceLink => Boolean(source));
  const refsFromResources = uniqueStrings([
    ...resultSetRefs,
    ...sourceLinks.map((source) => source.ref),
    ...refs.filter(isCurrentRunSearchEvidenceRef),
  ]);
  return {
    schemaVersion: 'sciforge.agent-host.web-search-evidence.v1',
    route: options.route,
    ...(options.query ? { query: options.query } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
    resultSetRefs,
    sourceLinks,
    refs: refsFromResources,
    timings: options.timings ?? {},
    diagnostics: options.diagnostics ?? [],
  };
}

function agentHostNativeWebSearchEvidenceFromRecord(
  record: Record<string, unknown>,
  options: { route: AgentHostWebSearchEvidenceRoute },
): AgentHostWebSearchEvidence {
  const data = recordFromRecord(record, 'data') ?? record;
  const provider = stringFromRecord(record, 'provider') ?? stringFromRecord(data, 'provider');
  const query = stringFromRecord(record, 'query') ?? stringFromRecord(data, 'query');
  const rawRefs = stringArrayFromRecord(record, 'refs');
  const resultSetRef = stringFromRecord(record, 'resultSetRef')
    ?? stringFromRecord(data, 'resultSetRef')
    ?? rawRefs.find((ref) => /^web-search:/i.test(ref));
  const resultRecords = recordArrayFromRecord(data, 'results').length > 0
    ? recordArrayFromRecord(data, 'results')
    : recordArrayFromRecord(data, 'sourceLinks');
  const sourceLinks = resultRecords
    .map((item) => nativeSearchSourceLinkFromRecord(item, provider))
    .filter((source): source is AgentHostWebSearchEvidenceSourceLink => Boolean(source));
  const resultSetRefs = uniqueStrings([resultSetRef]);
  return {
    schemaVersion: 'sciforge.agent-host.web-search-evidence.v1',
    route: options.route,
    ...(query ? { query } : {}),
    ...(provider ? { provider } : {}),
    resultSetRefs,
    sourceLinks,
    refs: uniqueStrings([
      ...resultSetRefs,
      ...sourceLinks.map((source) => source.ref),
      ...rawRefs.filter(isCurrentRunSearchEvidenceRef),
    ]),
    timings: recordFromRecord(record, 'timings') ?? recordFromRecord(data, 'timings') ?? {},
    diagnostics: arrayFromRecord(record, 'diagnostics').length > 0
      ? arrayFromRecord(record, 'diagnostics')
      : arrayFromRecord(data, 'diagnostics'),
  };
}

function nativeSearchSourceLinkFromRecord(
  item: Record<string, unknown>,
  fallbackProvider: string | undefined,
): AgentHostWebSearchEvidenceSourceLink | undefined {
  const url = stringFromRecord(item, 'url')
    ?? stringFromRecord(item, 'link')
    ?? stringFromRecord(item, 'sourceUrl');
  if (!url) return undefined;
  const ref = stringFromRecord(item, 'resourceRef')
    ?? stringFromRecord(item, 'ref')
    ?? stringFromRecord(item, 'sourceRef');
  if (!ref || !isCurrentRunSearchEvidenceRef(ref)) return undefined;
  const provider = stringFromRecord(item, 'provider') ?? fallbackProvider;
  return {
    ref,
    url,
    ...(stringFromRecord(item, 'title') ? { title: stringFromRecord(item, 'title') } : {}),
    ...(stringFromRecord(item, 'snippet') ? { snippet: stringFromRecord(item, 'snippet') } : {}),
    ...(stringFromRecord(item, 'source') ? { source: stringFromRecord(item, 'source') } : {}),
    ...(provider ? { provider } : {}),
    ...(stringFromRecord(item, 'publishedAt') ? { publishedAt: stringFromRecord(item, 'publishedAt') } : {}),
  };
}

function currentRunSourcePageRefs(resources: BrowserResource[], refs: string[]): string[] {
  return uniqueStrings([
    ...resources
      .filter((resource) => resource.kind === 'source_page' && resource.status === 'read')
      .map((resource) => resource.ref),
    ...refs.filter(isSourcePageEvidenceRef),
  ]).filter(isCurrentRunBrowserEvidenceRef);
}

function currentRunPageTextRefs(resources: BrowserResource[], refs: string[]): string[] {
  return uniqueStrings([
    ...resources
      .filter((resource) => resource.kind === 'page_text' && resource.status === 'read')
      .map((resource) => resource.ref),
    ...refs.filter(isPageTextEvidenceRef),
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

function currentRunSearchResources(resources: BrowserResource[], refs: string[]): BrowserResource[] {
  const currentRefs = new Set(uniqueStrings([
    ...resources
      .filter((resource) => isWebSearchOriginTool(resource.originTool))
      .map((resource) => resource.ref),
    ...refs.filter(isCurrentRunSearchEvidenceRef),
  ]));
  return resources.filter((resource) =>
    currentRefs.has(resource.ref)
    && isWebSearchOriginTool(resource.originTool)
    && resource.status !== 'blocked'
    && resource.status !== 'failed'
    && !/(?:fixture|replay|history|seed|demo|previous-run)/i.test(resource.ref));
}

function isCurrentRunSearchEvidenceRef(ref: string): boolean {
  return /^web-(?:search|page):/i.test(ref)
    && !/(?:fixture|replay|history|seed|demo|previous-run)/i.test(ref);
}

function browserResourceUrl(resource: BrowserResource): string | undefined {
  return stringFromRecord(resource.locator, 'url')
    ?? stringFromRecord(resource.metadata, 'finalUrl')
    ?? stringFromRecord(resource.metadata, 'url');
}

function finalAnswerSourceLinksFromText(text: string | undefined): string[] {
  if (!text) return [];
  return uniqueStrings(Array.from(text.matchAll(/\bhttps?:\/\/[^\s<>)\]}，。；、'"]+/giu))
    .map((match) => match[0].replace(/[.,;:!?]+$/u, '')));
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

function temporalSearchAcceptanceIssue(
  resources: BrowserResource[],
  spec: AgentHostBrowserAcceptanceSpec,
): AgentHostBrowserEvidenceIssue | undefined {
  if (!spec.temporal || resources.length === 0) return undefined;
  const dates = uniqueStrings(resources.flatMap(browserResourceDates)).sort();
  if (dates.length === 0) {
    return {
      code: 'web-search-temporal-evidence-missing',
      message: 'Ordinary search acceptance requires current/recent source evidence, but search result metadata contains no verifiable dates.',
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
    code: 'web-search-temporal-gap',
    message: `Search result dates do not satisfy the requested ${temporal.kind} window ${startDate}..${endDate}.`,
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

function minSearchSourcesFromPrompt(prompt: string | undefined): number {
  const text = prompt ?? '';
  const digitMatch = /(?:至少|最少|不少于|provide\s+at\s+least|at\s+least)\s*(\d{1,2})\s*(?:条|个|则|篇|sources?|items?|links?|信息|消息)?/iu.exec(text);
  if (digitMatch) return boundedSourceCount(Number(digitMatch[1]));
  const cjkNumberMatch = /(?:至少|最少|不少于)\s*(一|二|两|三|四|五|六|七|八|九|十)\s*(?:条|个|则|篇|来源|信息|消息)?/u.exec(text);
  if (cjkNumberMatch) return boundedSourceCount(cjkNumberValue(cjkNumberMatch[1]));
  if (/对比|比较|交叉验证|核验|多方|多个来源|两家|多家|compare|cross[-\s]?check|verify|multiple\s+sources/i.test(text)) {
    return 2;
  }
  return 1;
}

function boundedSourceCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(10, Math.floor(value)));
}

function cjkNumberValue(value: string | undefined): number {
  if (value === '一') return 1;
  if (value === '二' || value === '两') return 2;
  if (value === '三') return 3;
  if (value === '四') return 4;
  if (value === '五') return 5;
  if (value === '六') return 6;
  if (value === '七') return 7;
  if (value === '八') return 8;
  if (value === '九') return 9;
  if (value === '十') return 10;
  return 1;
}

function readRequiredFromPrompt(prompt: string | undefined): boolean {
  const text = prompt ?? '';
  if (/\bhttps?:\/\/\S+/i.test(text)) return true;
  return /网页正文|页面正文|实际读取|打开(?:这个|该|网页|链接|url)?|读取(?:这个|该|网页|链接|url)?|逐字|原文|直接引用|quote|quotations?|verbatim|summari[sz]e\s+(?:this|the)\s+(?:url|page|article)|总结(?:这个|该|这篇|网页|链接|url|文章|论文)/iu.test(text);
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
  return isWebSearchOriginTool(resource.originTool)
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

export function agentHostBrowserTopicTermMatchesText(term: string, text: string): boolean {
  return browserSearchTermMatchesText(term, text);
}

function browserSearchTermMatchesText(term: string, text: string): boolean {
  const normalizedText = normalizeText(text);
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) return false;
  if (/伊朗/u.test(term)) return /\biran(?:ian)?\b|伊朗/u.test(normalizedText);
  if (/openai/i.test(term)) return /\bopenai\b/i.test(normalizedText);
  if (/产品更新/u.test(term)) return /产品更新|product\s+updates?|release\s+notes?|changelog|updates?/iu.test(normalizedText);
  if (/人工智能/u.test(term)) return /人工智能|\bai\b|artificial\s+intelligence/iu.test(normalizedText);
  if (/[\p{Script=Han}]/u.test(normalizedTerm)) return normalizedText.includes(normalizedTerm);
  const termTokens = normalizedTerm.match(/[a-z0-9]+/giu)?.map((token) => token.toLowerCase()) ?? [];
  if (termTokens.length === 0) return false;
  const textTokenList = normalizedText.match(/[a-z0-9]+/giu)?.map((token) => token.toLowerCase()) ?? [];
  const textTokens = new Set(textTokenList);
  if (termTokens.length === 1) return textTokens.has(termTokens[0]);
  return textTokenList.some((_, index) =>
    termTokens.every((termToken, offset) => textTokenList[index + offset] === termToken));
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

function recordFromRecord(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function arrayFromRecord(record: Record<string, unknown> | undefined, key: string): unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

function recordArrayFromRecord(record: Record<string, unknown> | undefined, key: string): Record<string, unknown>[] {
  return arrayFromRecord(record, key).filter(isRecord);
}

function stringArrayFromRecord(record: Record<string, unknown> | undefined, key: string): string[] {
  return arrayFromRecord(record, key).filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function resourceRefs(resources: readonly BrowserResource[] | undefined): string[] {
  if (!resources) return [];
  return resources.flatMap((resource) => [resource.ref, ...(resource.refs ?? [])]);
}

function isCurrentRunBrowserEvidenceRef(ref: string): boolean {
  return (/^browser-host-session:/i.test(ref) || /^web-(?:source|text):/i.test(ref))
    && !/(?:fixture|replay|history|seed|demo)/i.test(ref);
}

function isSourcePageEvidenceRef(ref: string): boolean {
  return /source-pages\/.+\.source\.json$/i.test(ref) || /^web-source:/i.test(ref);
}

function isPageTextEvidenceRef(ref: string): boolean {
  return /source-pages\/.+\.txt$/i.test(ref) || /^web-text:/i.test(ref);
}

function isWebSearchOriginTool(value: string | undefined): boolean {
  return value === 'browser.search' || value === 'web.search' || value === 'web_search';
}

function isWebReadOriginTool(value: string | undefined): boolean {
  return value === 'browser.read' || value === 'web.read' || value === 'web_read';
}

function isWebSearchToolRef(ref: string): boolean {
  return /\b(?:browser_search|web_search)\b/i.test(ref) || /^web-search:/i.test(ref);
}

function isWebReadToolRef(ref: string): boolean {
  return /\b(?:browser_read|web_read)\b/i.test(ref);
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
