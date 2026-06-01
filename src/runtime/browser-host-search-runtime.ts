import {
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BROWSER_RUNTIME_CAPABILITY_ID,
  browserRuntimeProjection,
  browserRuntimeSnapshotFromRefs,
  browserRuntimeTraceForCommand,
} from '../../packages/observe/web/browser-runtime.js';
import { BROWSER_HOST_SEARCH_SCHEMA, browserHostSearchSummary, defaultBrowserHostSessionManager, type BrowserHostSearchInput, type BrowserHostSearchOutput, type BrowserHostSessionManager } from './browser-host-session.js';
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
    emitWorkspaceRuntimeEvent(callbacks, {
      type: 'browser-host-search-runtime',
      source: 'workspace-runtime-gateway',
      toolName: TOOL_ID,
      status: 'satisfied',
      message: `BrowserHostSession search returned ${output.results.length} bounded results.`,
      detail: `finalUrl=${output.finalUrl}; searchResultRef=${output.searchResultRef}`,
    });
    return browserHostSearchPayload(request, output, id);
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
  if (!looksLikeBrowserHostSearchRequest(request)) return undefined;
  const query = browserSearchQueryFromPrompt(request.prompt);
  if (!query) return undefined;
  const sessionId = browserHostSessionIdFromRequest(request);
  return {
    query,
    limit: browserSearchLimitFromPrompt(request.prompt),
    engine: /duckduckgo|ddg/i.test(request.prompt) ? 'duckduckgo' : 'bing',
    timeoutMs: 45_000,
    ...(sessionId ? { sessionId } : {}),
  };
}

function browserHostSearchPayload(request: GatewayRequest, output: BrowserHostSearchOutput, id: string): ToolPayload {
  const projectionRef = `artifact:browser-host-projection-${id}`;
  const browserSessionRef = `browser-host-session:${output.session.id}`;
  const snapshot = browserRuntimeSnapshotFromRefs({
    url: output.finalUrl,
    title: output.session.title,
    textPreview: output.results.map((result) => `${result.title} ${result.snippet}`).join('\n').slice(0, 1200),
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
  });
  const summary = browserHostSearchSummary(output, Math.min(5, output.results.length || 5));
  return {
    message: summary,
    confidence: output.results.length ? 0.82 : 0.45,
    claimType: 'observation',
    evidenceLevel: 'runtime',
    reasoningTrace: 'SciForge opened a host-owned BrowserHostSession, executed browser_search, and returned refs-first browser evidence.',
    displayIntent: {
      protocolStatus: output.results.length ? 'protocol-success' : 'protocol-partial',
      taskOutcome: output.results.length ? 'satisfied' : 'needs-work',
      status: output.results.length ? 'completed' : 'repair-needed',
    },
    claims: [{
      id: `claim-browser-host-search-${id}`,
      type: 'fact',
      text: `BrowserHostSession search returned ${output.results.length} bounded results for ${output.query}.`,
      confidence: output.results.length ? 0.82 : 0.45,
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
      status: output.results.length ? 'done' : 'repair-needed',
      params: JSON.stringify({ query: output.query, engine: output.engine, limit: output.results.length }),
      hash: sha1(JSON.stringify({ finalUrl: output.finalUrl, searchResultRef: output.searchResultRef })).slice(0, 16),
      environment: BROWSER_HOST_SESSION_PROVIDER_ID,
      runtimeProfileId: 'browser-host-session',
      selectedRuntime: 'browser-host-search-runtime',
      outputRef: output.searchResultRef,
    }],
    artifacts: [{
      id: `browser-search-results-${id}`,
      type: 'browser-search-results',
      producerScenario: request.skillDomain,
      schemaVersion: BROWSER_HOST_SEARCH_SCHEMA,
      metadata: {
        source: TOOL_ID,
        providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
        finalUrl: output.finalUrl,
        browserSessionRef,
        projectionRef,
        searchResultRef: output.searchResultRef,
      },
      data: {
        query: output.query,
        engine: output.engine,
        finalUrl: output.finalUrl,
        browserSessionRef,
        projectionRef,
        results: output.results,
        searchResultRef: output.searchResultRef,
        screenshotRef: output.screenshotRef,
        domSnapshotRef: output.domSnapshotRef,
        axSnapshotRef: output.axSnapshotRef,
        consoleLogRef: output.consoleLogRef,
        networkLogRef: output.networkLogRef,
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
      summary: `Session ${output.session.id}; screenshot/DOM/AX/console/network refs available when captured.`,
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

function browserHostSearchSupportingRefs(output: BrowserHostSearchOutput) {
  return [
    output.finalUrl,
    output.searchResultRef,
    output.screenshotRef,
    output.domSnapshotRef,
    output.axSnapshotRef,
    output.consoleLogRef,
    output.networkLogRef,
  ].filter((value): value is string => Boolean(value));
}

function looksLikeBrowserHostSearchRequest(request: GatewayRequest) {
  const selected = [
    ...(request.selectedToolIds ?? []),
    ...(request.selectedSkillIds ?? []),
    ...(request.availableSkills ?? []),
  ].join(' ');
  const text = `${request.prompt}\n${selected}`;
  return /\bbrowser_search\b/i.test(text)
    || /\/browser\s+search\b/i.test(text)
    || (/\b(?:browser|rendered|浏览器)\b/i.test(text) && /\b(?:search|query|检索|搜索)\b/i.test(text))
    || selected.includes(TOOL_ID)
    || selected.includes(BROWSER_RUNTIME_CAPABILITY_ID);
}

function browserSearchQueryFromPrompt(prompt: string) {
  const patterns = [
    /browser_search\s*\(\s*(?:query\s*[:=]\s*)?["“']([^"”']+)["”']\s*\)/i,
    /\/browser\s+search\s+["“']([^"”']+)["”']/i,
    /(?:browser\s+search|search|query|搜索|检索)\s*[:：]\s*["“']?([^"”'\n。；;]+)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(prompt);
    const value = match?.[1]?.trim();
    if (value) return value.replace(/\s+/g, ' ');
  }
  if (/\bbrowser_search\b/i.test(prompt)) return prompt.replace(/\bbrowser_search\b/ig, '').replace(/["“”']/g, ' ').replace(/\s+/g, ' ').trim();
  return undefined;
}

function browserSearchLimitFromPrompt(prompt: string) {
  const match = /(?:limit|maxResults|max results|前)\s*[:=]?\s*(\d{1,2})/i.exec(prompt);
  if (!match) return 5;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.max(1, Math.min(10, value)) : 5;
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
