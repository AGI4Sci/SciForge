import {
  BROWSER_HOST_SESSION_PROVIDER_ID,
  browserRuntimeProjection,
  browserRuntimeSnapshotFromRefs,
  browserRuntimeTraceForCommand,
} from '../../packages/observe/web/browser-runtime.js';
import { browserSearchEngineFromPrompt, browserSearchLimitFromPrompt, evaluateBrowserEvidenceNeed } from '../../packages/contracts/runtime/default-browser-computer-use-policy.js';
import { BROWSER_HOST_SEARCH_SCHEMA, browserHostSearchSummary, defaultBrowserHostSessionManager, type BrowserHostSearchInput, type BrowserHostSearchOutput, type BrowserHostSessionManager } from './browser-host-session.js';
import { browserHostSearchAnswerFromOutput } from './browser-host-search-answer.js';
import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks } from './runtime-types.js';
import { sha1 } from './workspace-task-runner.js';
import { emitWorkspaceRuntimeEvent } from './workspace-runtime-events.js';

const TOOL_ID = 'browser_search' as const;

export async function tryRunBrowserHostSearchRuntime(
  request: GatewayRequest,
  callbacks: WorkspaceRuntimeCallbacks = {},
  manager: BrowserHostSessionManager = defaultBrowserHostSessionManager(),
): Promise<ToolPayload | undefined> {
  const input = browserHostSearchInputFromRequest(request);
  if (!input) return undefined;
  const id = sha1(JSON.stringify({ query: input.query, engine: input.engine ?? 'bing' })).slice(0, 12);
  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'browser-host-search-runtime',
    source: 'workspace-runtime-gateway',
    toolName: TOOL_ID,
    status: 'running',
    message: 'Opening host-owned BrowserHostSession for browser search.',
    detail: JSON.stringify({ query: input.query, limit: input.limit, engine: input.engine ?? 'bing' }),
  });
  try {
    const output = await manager.search(request.workspacePath || process.cwd(), input);
    const answer = browserHostSearchAnswerFromOutput({ prompt: request.prompt, output });
    const status = browserHostSearchPresentationStatus(answer.evidenceState);
    emitWorkspaceRuntimeEvent(callbacks, {
      type: 'browser-host-search-runtime',
      source: 'workspace-runtime-gateway',
      toolName: TOOL_ID,
      status: status.eventStatus,
      message: browserHostSearchRuntimeEventMessage(answer.evidenceState, output.results.length),
      detail: `finalUrl=${output.finalUrl}; searchResultRef=${output.searchResultRef}`,
    });
    return browserHostSearchPayload(request, output, id, answer);
  } catch (error) {
    const message = `BrowserHostSession browser_search failed: ${error instanceof Error ? error.message : String(error)}`;
    emitWorkspaceRuntimeEvent(callbacks, {
      type: 'browser-host-search-runtime',
      source: 'workspace-runtime-gateway',
      toolName: TOOL_ID,
      status: 'failed',
      message,
    });
    return browserHostSearchFailurePayload(request, input, id, message);
  }
}

export function browserHostSearchInputFromRequest(request: GatewayRequest): BrowserHostSearchInput | undefined {
  const decision = evaluateBrowserEvidenceNeed({
    prompt: request.prompt,
    selectedToolIds: request.selectedToolIds,
    selectedSkillIds: request.selectedSkillIds,
    availableSkills: request.availableSkills,
  });
  if (decision.decision !== 'search') return undefined;
  const sessionId = browserHostSessionIdFromRequest(request);
  return {
    query: decision.query,
    limit: browserSearchLimitFromPrompt(request.prompt),
    engine: browserSearchEngineFromPrompt(request.prompt),
    timeoutMs: 45_000,
    ...preferredBrowserHostSearchInput(request.prompt, decision.query),
    ...(sessionId ? { sessionId } : {}),
  };
}

function preferredBrowserHostSearchInput(prompt: string, query: string): Pick<BrowserHostSearchInput, 'preferredResults'> {
  const text = `${prompt}\n${query}`;
  if (/(?:hugging\s*face|huggingface|\bhf\b)/i.test(text) && /(?:daily\s*papers?|论文|paper)/i.test(text)) {
    const requestedDate = dailyPapersRequestedDate(text);
    if (requestedDate) {
      const fallbackDate = localIsoDate(new Date(localDateValue(requestedDate) - 24 * 60 * 60 * 1000));
      return {
        preferredResults: [{
          title: `Hugging Face Daily Papers API (${requestedDate})`,
          url: `https://huggingface.co/api/daily_papers?date=${requestedDate}`,
          snippet: `Official Hugging Face Daily Papers API for ${requestedDate}.`,
        }, {
          title: `Hugging Face Daily Papers API (${fallbackDate})`,
          url: `https://huggingface.co/api/daily_papers?date=${fallbackDate}`,
          snippet: `Official Hugging Face Daily Papers API fallback for the previous Daily Papers date.`,
        }, {
          title: 'Hugging Face Daily Papers',
          url: 'https://huggingface.co/papers',
          snippet: 'Official Hugging Face Daily Papers page.',
        }],
      };
    }
    return {
      preferredResults: [{
        title: 'Hugging Face Daily Papers API',
        url: 'https://huggingface.co/api/daily_papers?sort=trending',
        snippet: 'Official Hugging Face Daily Papers API for current trending papers.',
      }, {
        title: 'Hugging Face Daily Papers',
        url: 'https://huggingface.co/papers',
        snippet: 'Official Hugging Face Daily Papers page.',
      }],
    };
  }
  return {};
}

function dailyPapersRequestedDate(text: string): string | undefined {
  const explicitIso = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(text);
  if (explicitIso) return normalizedIsoDate(explicitIso[1], explicitIso[2], explicitIso[3]);
  const explicitChinese = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(text);
  if (explicitChinese) return normalizedIsoDate(explicitChinese[1], explicitChinese[2], explicitChinese[3]);
  if (/(?:今天|今日|\btoday\b)/i.test(text)) return localIsoDate(new Date());
  if (/(?:昨天|昨日|\byesterday\b)/i.test(text)) return localIsoDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  return undefined;
}

function normalizedIsoDate(year: string, month: string, day: string): string {
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateValue(isoDate: string): number {
  const [year = '1970', month = '01', day = '01'] = isoDate.split('-');
  return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
}

function browserHostSearchPayload(request: GatewayRequest, output: BrowserHostSearchOutput, id: string, answer = browserHostSearchAnswerFromOutput({ prompt: request.prompt, output })): ToolPayload {
  const projectionRef = `artifact:browser-host-projection-${id}`;
  const browserSessionRef = `browser-host-session:${output.session.id}`;
  const sourcePageTextPreview = browserHostSearchSourcePageTextPreview(output);
  const snapshot = browserRuntimeSnapshotFromRefs({
    url: output.finalUrl,
    title: output.session.title,
    textPreview: sourcePageTextPreview || output.results.map((result) => `${result.title} ${result.snippet}`).join('\n').slice(0, 1200),
    screenshotRef: output.screenshotRef,
    domSnapshotRef: output.domSnapshotRef,
    axSnapshotRef: output.axSnapshotRef,
    consoleLogRef: output.consoleLogRef,
    networkLogRef: output.networkLogRef,
    searchResultRef: output.searchResultRef,
  });
  const trace = browserRuntimeTraceForCommand({
    command: { type: 'tab.snapshot', sessionId: output.session.id, url: output.finalUrl, screenshot: true, dom: true, logs: true },
    sessionId: output.session.id,
    refs: [
      ...(output.searchResultRef ? [{ kind: 'search-result' as const, ref: output.searchResultRef }] : []),
      ...browserHostSearchSourcePageRefs(output).map((ref) => ({ kind: 'source-page' as const, ref })),
      ...(output.session.frameRef ? [{ kind: 'browser-frame' as const, ref: output.session.frameRef }] : []),
      ...(output.screenshotRef ? [{ kind: 'screenshot' as const, ref: output.screenshotRef }] : []),
      ...(output.domSnapshotRef ? [{ kind: 'dom-snapshot' as const, ref: output.domSnapshotRef }] : []),
      ...(output.axSnapshotRef ? [{ kind: 'ax-snapshot' as const, ref: output.axSnapshotRef }] : []),
      ...(output.consoleLogRef ? [{ kind: 'console-log' as const, ref: output.consoleLogRef }] : []),
      ...(output.networkLogRef ? [{ kind: 'network-log' as const, ref: output.networkLogRef }] : []),
    ],
  });
  const projection = browserRuntimeProjection({
    session: {
      id: output.session.id,
      mode: 'agent-headless',
      providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
      activeTabId: `${output.session.id}:tab`,
      tabs: [{
        id: `${output.session.id}:tab`,
        url: output.finalUrl,
        title: output.session.title ?? output.finalUrl,
        status: output.session.status === 'failed' ? 'failed' : output.session.status === 'closed' ? 'closed' : output.session.status === 'loading' || output.session.status === 'starting' ? 'loading' : 'ready',
        lastSnapshotRef: output.screenshotRef,
      }],
      updatedAt: output.session.updatedAt,
    },
    hostSession: output.session,
    snapshot,
    trace,
    automationSummary: output.automationSummary,
  });
  const summary = browserHostSearchSummary(output, Math.min(5, output.results.length || 5));
  const status = browserHostSearchPresentationStatus(answer.evidenceState);
  const executionGuidance = browserHostSearchExecutionGuidance(answer, output);
  return {
    message: answer.message,
    confidence: status.confidence,
    claimType: answer.evidenceState === 'browser-unavailable' ? 'diagnostic' : 'observation',
    evidenceLevel: 'runtime',
    reasoningTrace: browserHostSearchReasoningTrace(answer.evidenceState),
    displayIntent: {
      protocolStatus: status.protocolStatus,
      taskOutcome: status.taskOutcome,
      status: status.displayStatus,
      reason: status.reason,
    },
    claims: [{
      id: `claim-browser-host-search-${id}`,
      type: answer.evidenceState === 'browser-unavailable' ? 'diagnostic' : 'fact',
      text: browserHostSearchClaimText(answer.evidenceState, output),
      confidence: status.confidence,
      evidenceLevel: 'runtime',
      supportingRefs: browserHostSearchSupportingRefs(output),
      opposingRefs: [],
    }],
    uiManifest: [{
      componentId: 'browser-workbench',
      artifactRef: `browser-host-projection-${id}`,
      title: 'BrowserHostSession search',
      priority: 1,
    }],
    executionUnits: [{
      id: `EU-browser-host-search-${id}`,
      tool: TOOL_ID,
      status: status.unitStatus,
      params: JSON.stringify({ query: output.query, engine: output.engine, limit: output.results.length }),
      hash: sha1(JSON.stringify({ finalUrl: output.finalUrl, searchResultRef: output.searchResultRef })).slice(0, 16),
      environment: BROWSER_HOST_SESSION_PROVIDER_ID,
      runtimeProfileId: 'browser-host-session',
      selectedRuntime: 'browser-host-search-runtime',
      outputRef: output.searchResultRef,
      failureReason: executionGuidance.failureReason,
      recoverActions: executionGuidance.recoverActions,
      nextStep: executionGuidance.nextStep,
    }],
    artifacts: [{
      id: `browser-search-results-${id}`,
      type: 'browser-search-results',
      producerScenario: request.skillDomain,
      schemaVersion: BROWSER_HOST_SEARCH_SCHEMA,
      metadata: {
        source: TOOL_ID,
        providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
        searchedAt: output.searchedAt,
        finalUrl: output.finalUrl,
        browserSessionRef,
        projectionRef,
        searchResultRef: output.searchResultRef,
      },
      data: {
        query: output.query,
        engine: output.engine,
        searchedAt: output.searchedAt,
        finalUrl: output.finalUrl,
        browserSessionRef,
        projectionRef,
        results: output.results,
        sourcePages: output.sourcePages,
        answerEvidenceState: answer.evidenceState,
        browserHostSessionDiagnostics: answer.diagnostics,
        browserHostSearchSummary: summary,
        searchResultRef: output.searchResultRef,
        screenshotRef: output.screenshotRef,
        domSnapshotRef: output.domSnapshotRef,
        axSnapshotRef: output.axSnapshotRef,
        consoleLogRef: output.consoleLogRef,
        networkLogRef: output.networkLogRef,
        automationSummary: output.automationSummary,
      },
    }, {
      id: `browser-host-projection-${id}`,
      type: 'browser-runtime-projection',
      producerScenario: request.skillDomain,
      schemaVersion: 'sciforge.browser-runtime.projection.v1',
      metadata: {
        providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
        browserSessionRef,
        finalUrl: output.finalUrl,
      },
      data: projection,
    }, {
      id: `browser-search-diagnostic-${id}`,
      type: 'runtime-diagnostic',
      producerScenario: request.skillDomain,
      schemaVersion: 'sciforge.runtime-diagnostic.v1',
      delivery: {
        contractId: 'sciforge.artifact-delivery.v1',
        ref: `artifact:browser-search-diagnostic-${id}`,
        role: 'diagnostic',
        declaredMediaType: 'application/json',
        declaredExtension: '.json',
        contentShape: 'json-envelope',
        readableRef: `artifact:browser-search-diagnostic-${id}`,
        previewPolicy: 'audit-only',
      },
      metadata: {
        source: TOOL_ID,
        providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
        browserSessionRef,
        searchResultRef: output.searchResultRef,
      },
      data: {
        query: output.query,
        searchedAt: output.searchedAt,
        answerEvidenceState: answer.evidenceState,
        browserHostSessionDiagnostics: answer.diagnostics,
        browserHostSearchSummary: summary,
      },
    }],
    objectReferences: [{
      id: `obj-browser-host-final-url-${id}`,
      kind: 'url',
      title: output.session.title || output.finalUrl,
      ref: output.finalUrl,
      status: 'available',
      summary: `Final browser search URL for ${output.query}.`,
      provenance: { producer: BROWSER_HOST_SESSION_PROVIDER_ID, dataRef: output.searchResultRef },
    }, {
      id: `obj-browser-host-session-${id}`,
      kind: 'artifact',
      title: 'BrowserHostSession search projection',
      ref: `artifact:browser-host-projection-${id}`,
      artifactType: 'browser-runtime-projection',
      preferredView: 'browser-workbench',
      status: output.session.status === 'ready' ? 'available' : 'partial',
      summary: `Session ${output.session.id}; screenshot, DOM, AX, console, and network refs available when captured.`,
      provenance: {
        producer: BROWSER_HOST_SESSION_PROVIDER_ID,
        dataRef: `browser-host-session:${output.session.id}`,
        browserSessionRef,
        projectionRef,
        finalUrl: output.finalUrl,
      },
    }],
  };
}

function browserHostSearchFailurePayload(request: GatewayRequest, input: BrowserHostSearchInput, id: string, message: string): ToolPayload {
  return {
    message,
    confidence: 0.2,
    claimType: 'diagnostic',
    evidenceLevel: 'runtime',
    reasoningTrace: 'SciForge attempted BrowserHostSession browser_search and failed closed without synthesizing browser evidence.',
    displayIntent: {
      protocolStatus: 'protocol-failed',
      taskOutcome: 'needs-work',
      status: 'repair-needed',
    },
    claims: [{
      id: `claim-browser-host-search-failure-${id}`,
      type: 'diagnostic',
      text: message,
      confidence: 0.2,
      evidenceLevel: 'runtime',
      supportingRefs: [],
      opposingRefs: [],
    }],
    uiManifest: [],
    executionUnits: [{
      id: `EU-browser-host-search-failure-${id}`,
      tool: TOOL_ID,
      status: 'failed-with-reason',
      params: JSON.stringify(input),
      failureReason: message,
      hash: sha1(message).slice(0, 16),
    }],
    artifacts: [{
      id: `browser-host-search-failure-${id}`,
      type: 'runtime-diagnostic',
      producerScenario: request.skillDomain,
      schemaVersion: 'sciforge.runtime-diagnostic.v1',
      metadata: {
        source: TOOL_ID,
        status: 'repair-needed',
      },
      data: {
        message,
        input,
      },
    }],
  };
}

function browserHostSearchRuntimeEventMessage(evidenceState: ReturnType<typeof browserHostSearchAnswerFromOutput>['evidenceState'], resultCount: number) {
  if (evidenceState === 'browser-unavailable') {
    return 'BrowserHostSession search could not open the embedded browser; host diagnostics require recovery before search evidence can be read.';
  }
  if (evidenceState === 'candidate-only') {
    return `BrowserHostSession search returned ${resultCount} candidate result${resultCount === 1 ? '' : 's'}; source pages still need to be opened and read.`;
  }
  if (evidenceState === 'source-pages-read') {
    return `BrowserHostSession search opened and read source pages for ${resultCount} candidate result${resultCount === 1 ? '' : 's'}.`;
  }
  return `BrowserHostSession search returned ${resultCount} bounded results.`;
}

function browserHostSearchReasoningTrace(evidenceState: ReturnType<typeof browserHostSearchAnswerFromOutput>['evidenceState']) {
  if (evidenceState === 'browser-unavailable') {
    return 'SciForge attempted a host-owned BrowserHostSession browser_search, but the embedded browser session was unavailable. No search-page or source-page content was read, so the runtime surfaces the browser diagnostic instead of synthesizing an answer.';
  }
  if (evidenceState === 'candidate-only') {
    return 'SciForge opened a host-owned BrowserHostSession, executed browser_search, and returned candidate search-result refs. Source pages have not yet been opened/read, so the runtime asks for confirmation before summarizing.';
  }
  if (evidenceState === 'source-pages-read') {
    return 'SciForge opened a host-owned BrowserHostSession, executed browser_search, opened candidate source pages, and summarized only from opened source-page text refs.';
  }
  return 'SciForge opened a host-owned BrowserHostSession, executed browser_search, and returned refs-first browser evidence.';
}

function browserHostSearchClaimText(
  evidenceState: ReturnType<typeof browserHostSearchAnswerFromOutput>['evidenceState'],
  output: BrowserHostSearchOutput,
) {
  if (evidenceState === 'browser-unavailable') {
    return `BrowserHostSession search could not read search results for ${output.query} because the embedded browser session is unavailable.`;
  }
  if (evidenceState === 'candidate-only') {
    return `BrowserHostSession search returned ${output.results.length} candidate source snippets for ${output.query}; source pages still need to be read before final summarization.`;
  }
  if (evidenceState === 'source-pages-read') {
    return `BrowserHostSession search opened and read ${readSourcePageCount(output)} source page${readSourcePageCount(output) === 1 ? '' : 's'} for ${output.query}.`;
  }
  return `BrowserHostSession search returned ${output.results.length} bounded results for ${output.query}.`;
}

function browserHostSearchExecutionGuidance(
  answer: ReturnType<typeof browserHostSearchAnswerFromOutput>,
  output: BrowserHostSearchOutput,
) {
  if (answer.evidenceState === 'browser-unavailable') {
    const diagnostic = answer.diagnostics?.[0] ?? `BrowserHostSession ${output.session.status}`;
    return {
      failureReason: `BrowserHostSession unavailable: ${diagnostic}`,
      recoverActions: ['Connect or restart the SciForge native BrowserHostSession adapter, then retry the browser search.'],
      nextStep: 'Retry the search after the embedded browser adapter is available, then open and read source pages before summarizing.',
    };
  }
  if (answer.evidenceState === 'candidate-only') {
    return {
      failureReason: 'Search results are candidate snippets only; source pages have not been opened/read.',
      recoverActions: ['Confirm the target scope and continue by opening and reading the candidate source pages.'],
      nextStep: 'Open and read selected source pages, then summarize from source-page content.',
    };
  }
  if (answer.evidenceState === 'source-pages-read') {
    return {
      failureReason: undefined,
      recoverActions: undefined,
      nextStep: undefined,
    };
  }
  return {
    failureReason: undefined,
    recoverActions: undefined,
    nextStep: undefined,
  };
}

function browserHostSearchPresentationStatus(evidenceState: ReturnType<typeof browserHostSearchAnswerFromOutput>['evidenceState']) {
  if (evidenceState === 'source-pages-read') {
    return {
      confidence: 0.82,
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      displayStatus: 'done',
      unitStatus: 'done',
      eventStatus: 'satisfied',
      reason: 'source-pages-read',
    } as const;
  }
  if (evidenceState === 'browser-unavailable') {
    return {
      confidence: 0.3,
      protocolStatus: 'protocol-partial',
      taskOutcome: 'needs-human',
      displayStatus: 'needs-human',
      unitStatus: 'needs-human',
      eventStatus: 'needs-human',
      reason: 'browser-host-session-unavailable',
    } as const;
  }
  if (evidenceState === 'candidate-only') {
    return {
      confidence: 0.64,
      protocolStatus: 'protocol-partial',
      taskOutcome: 'needs-human',
      displayStatus: 'needs-human',
      unitStatus: 'needs-human',
      eventStatus: 'needs-human',
      reason: 'source-pages-not-read',
    } as const;
  }
  return {
    confidence: 0.45,
    protocolStatus: 'protocol-partial',
    taskOutcome: 'needs-work',
    displayStatus: 'repair-needed',
    unitStatus: 'repair-needed',
    eventStatus: 'needs-work',
    reason: 'no-usable-search-results',
  } as const;
}

function browserHostSearchSupportingRefs(output: BrowserHostSearchOutput) {
  return [
    output.finalUrl,
    output.searchResultRef,
    ...browserHostSearchSourcePageRefs(output),
    output.screenshotRef,
    output.domSnapshotRef,
    output.axSnapshotRef,
    output.consoleLogRef,
    output.networkLogRef,
  ].filter((value): value is string => Boolean(value));
}

function browserHostSearchSourcePageRefs(output: BrowserHostSearchOutput) {
  return (output.sourcePages ?? [])
    .filter((page) => page.status === 'read')
    .map((page) => page.textRef)
    .filter((value): value is string => Boolean(value));
}

function browserHostSearchSourcePageTextPreview(output: BrowserHostSearchOutput) {
  return (output.sourcePages ?? [])
    .filter((page) => page.status === 'read' && (page.textSummary || page.textPreview))
    .map((page) => `${page.title || page.finalUrl || page.url}\n${page.textSummary || page.textPreview}`)
    .join('\n\n')
    .slice(0, 1600);
}

function readSourcePageCount(output: BrowserHostSearchOutput) {
  return (output.sourcePages ?? []).filter((page) => page.status === 'read').length;
}

function browserHostSessionIdFromRequest(request: GatewayRequest) {
  const candidates = [
    ...browserHostSessionIdCandidatesFromRecord(request.uiState),
    ...(request.references ?? []).flatMap(browserHostSessionIdCandidatesFromRecord),
    ...(request.artifacts ?? []).flatMap(browserHostSessionIdCandidatesFromRecord),
  ];
  return candidates.map(browserHostSessionIdFromRef).find(Boolean);
}

function browserHostSessionIdCandidatesFromRecord(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const candidates = [
    stringField(value.browserSessionRef),
    stringField(value.browserHostSessionRef),
    stringField(value.browserHostSessionId),
  ];
  const provenance = isRecord(value.provenance) ? value.provenance : undefined;
  if (provenance) {
    candidates.push(
      stringField(provenance.browserSessionRef),
      stringField(provenance.browserHostSessionRef),
      stringField(provenance.browserHostSessionId),
    );
  }
  for (const key of ['currentReference', 'objectReference', 'focusedObjectReference'] as const) {
    candidates.push(...browserHostSessionIdCandidatesFromRecord(value[key]));
  }
  for (const key of ['currentReferences', 'objectReferences', 'references'] as const) {
    const list = Array.isArray(value[key]) ? value[key] : [];
    candidates.push(...list.flatMap(browserHostSessionIdCandidatesFromRecord));
  }
  return candidates.filter((candidate): candidate is string => Boolean(candidate));
}

function browserHostSessionIdFromRef(ref: string | undefined) {
  if (!ref) return undefined;
  const direct = /^browser-host-session:([^/\s]+)/.exec(ref.trim());
  if (direct?.[1]) return direct[1];
  return /^[A-Za-z0-9._:-]+$/.test(ref) ? ref : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
