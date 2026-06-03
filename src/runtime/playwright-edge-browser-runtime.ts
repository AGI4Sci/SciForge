import {
  invokePlaywrightEdgeBrowser,
  type PlaywrightEdgeBrowserInvocationInput,
} from '../../packages/observe/web/mcp/playwright-edge-provider.js';
import {
  PLAYWRIGHT_EDGE_MCP_CAPABILITY_ID,
  PLAYWRIGHT_EDGE_MCP_PROVIDER_ID,
} from '../../packages/observe/web/mcp/playwright-edge.js';
import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks } from './runtime-types.js';
import { capabilityProviderRoutesForGatewayInvocation } from './gateway/capability-provider-preflight.js';
import { sha1 } from './workspace-task-runner.js';
import { emitWorkspaceRuntimeEvent } from './workspace-runtime-events.js';
import {
  ensureWorkspaceBrowserProfileDir,
  normalizeWorkspaceRootPath,
  WORKSPACE_BROWSER_PROFILE_REF,
  workspaceBrowserOutputDir,
  workspaceBrowserProfileState,
} from './workspace-paths.js';

const TOOL_ID = PLAYWRIGHT_EDGE_MCP_CAPABILITY_ID;

export async function tryRunPlaywrightEdgeBrowserRuntime(
  request: GatewayRequest,
  callbacks: WorkspaceRuntimeCallbacks = {},
): Promise<ToolPayload | undefined> {
  const input = playwrightEdgeBrowserInvocationInputFromRequest(request);
  if (!input) return undefined;
  const id = sha1(JSON.stringify({ prompt: request.prompt, url: input.url, query: input.query })).slice(0, 12);
  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'playwright-edge-browser-runtime',
    source: 'workspace-runtime-gateway',
    toolName: TOOL_ID,
    status: 'running',
    message: 'Calling configured Microsoft Edge Playwright MCP browser provider.',
    detail: JSON.stringify(playwrightEdgeBrowserExecutionDiagnostic(input)),
  });
  try {
    if (input.workspaceProfileDir) await ensureWorkspaceBrowserProfileDir(request.workspacePath || process.cwd());
    const output = await invokePlaywrightEdgeBrowser(input);
    const message = playwrightEdgeBrowserMarkdown(output);
    emitWorkspaceRuntimeEvent(callbacks, {
      type: 'playwright-edge-browser-runtime',
      source: 'workspace-runtime-gateway',
      toolName: TOOL_ID,
      status: output.status === 'succeeded' ? 'satisfied' : output.status,
      message: `Microsoft Edge MCP browser read ${output.title || output.url}.`,
      detail: `edgeDetected=${output.providerDiagnostics.edgeDetected}; urlDigest=${urlDigest(output.url)?.sha1.slice(0, 12) ?? 'none'}`,
    });
    return {
      message,
      confidence: output.status === 'succeeded' ? 0.84 : 0.58,
      claimType: 'observation',
      evidenceLevel: 'runtime',
      reasoningTrace: 'SciForge workspace runtime directly invoked the configured Microsoft Edge Playwright MCP provider route.',
      displayIntent: {
        protocolStatus: output.status === 'succeeded' ? 'protocol-success' : 'protocol-failed',
        taskOutcome: output.status === 'succeeded' ? 'satisfied' : 'needs-work',
        status: output.status === 'succeeded' ? 'completed' : 'repair-needed',
      },
      claims: [{
        id: `claim-playwright-edge-browser-${id}`,
        type: 'fact',
        text: `Microsoft Edge MCP read ${output.title || 'page'}; edgeDetected=${output.providerDiagnostics.edgeDetected}; urlDigest=${urlDigest(output.url)?.sha1.slice(0, 12) ?? 'none'}.`,
        confidence: output.status === 'succeeded' ? 0.84 : 0.58,
        evidenceLevel: 'runtime',
        supportingRefs: [`artifact:playwright-edge-browser-result-${id}`],
        opposingRefs: [],
      }],
      uiManifest: [{
        componentId: 'markdown-report',
        artifactRef: `playwright-edge-browser-result-${id}`,
        title: 'Microsoft Edge MCP browser result',
        priority: 1,
      }],
      executionUnits: [{
        id: `EU-playwright-edge-browser-${id}`,
        tool: TOOL_ID,
        status: output.status === 'succeeded' ? 'done' : 'repair-needed',
        params: playwrightEdgeBrowserExecutionParams(input),
        hash: sha1(JSON.stringify(output)).slice(0, 16),
        environment: 'Microsoft Edge + Playwright MCP',
        runtimeProfileId: 'playwright-edge-mcp',
        selectedRuntime: 'playwright-edge-browser-runtime',
      }],
      artifacts: [{
        id: `playwright-edge-browser-result-${id}`,
        type: 'research-report',
        producerScenario: request.skillDomain,
        schemaVersion: '1',
        metadata: {
          source: TOOL_ID,
          providerId: PLAYWRIGHT_EDGE_MCP_PROVIDER_ID,
          urlDigest: urlDigest(output.url),
          title: output.title,
          edgeDetected: output.providerDiagnostics.edgeDetected,
          transport: output.providerDiagnostics.transport,
          workspaceProfileRef: input.workspaceProfileDir ? WORKSPACE_BROWSER_PROFILE_REF : undefined,
        },
        data: {
          markdown: message,
          output: publicPlaywrightEdgeBrowserOutput(output),
        },
      }],
      objectReferences: [{
        id: `obj-playwright-edge-browser-${id}`,
        kind: 'url',
        title: output.title || 'Microsoft Edge MCP page',
        ref: `url-digest:${urlDigest(output.url)?.sha1 ?? sha1(output.url)}`,
        status: output.status === 'succeeded' ? 'available' : 'partial',
        summary: output.text.slice(0, 240),
      }],
    };
  } catch (error) {
    const message = `Microsoft Edge Playwright MCP provider invocation failed: ${error instanceof Error ? error.message : String(error)}`;
    emitWorkspaceRuntimeEvent(callbacks, {
      type: 'playwright-edge-browser-runtime',
      source: 'workspace-runtime-gateway',
      toolName: TOOL_ID,
      status: 'failed',
      message,
    });
    return playwrightEdgeBrowserFailurePayload(request, input, id, message);
  }
}

export function playwrightEdgeBrowserInvocationInputFromRequest(request: GatewayRequest): PlaywrightEdgeBrowserInvocationInput | undefined {
  if (!looksLikePlaywrightEdgeBrowserRequest(request.prompt)) return undefined;
  const route = capabilityProviderRoutesForGatewayInvocation(request).routes.find((candidate) => candidate.capabilityId === PLAYWRIGHT_EDGE_MCP_CAPABILITY_ID);
  if (route && route.status !== 'ready') return undefined;
  const provider = route?.providers.find((candidate) => candidate.providerId === route.primaryProviderId) ?? route?.providers[0];
  const mcpUrl = providerEndpoint(provider);
  const url = urlFromPrompt(request.prompt);
  const query = url ? undefined : queryFromPrompt(request.prompt);
  if (!url && !query) return undefined;
  const workspaceRoot = request.workspacePath ? normalizeWorkspaceRootPath(request.workspacePath) : '';
  const workspaceProfile = workspaceRoot ? workspaceBrowserProfileState(workspaceRoot) : undefined;
  return {
    task: request.prompt,
    ...(url ? { url } : {}),
    ...(query ? { query, mode: 'search' as const } : { mode: 'read' as const }),
    maxChars: 1800,
    timeoutMs: 60_000,
    ...(mcpUrl ? { mcpUrl } : {}),
    ...(workspaceRoot && workspaceProfile ? {
      workspaceProfileDir: workspaceProfile.profileDir,
      outputDir: workspaceBrowserOutputDir(workspaceRoot, 'playwright-edge-output'),
    } : {}),
  };
}

export function playwrightEdgeBrowserExecutionParams(input: PlaywrightEdgeBrowserInvocationInput | undefined): string {
  return JSON.stringify(playwrightEdgeBrowserExecutionDiagnostic(input));
}

function looksLikePlaywrightEdgeBrowserRequest(prompt: string) {
  const text = prompt.toLowerCase();
  return /\bplaywright_edge_browser\b/.test(text)
    || /sciforge\.observe\.playwright-edge-mcp/.test(text)
    || (/\bplaywright\s+mcp\b/.test(text) && /\b(edge|msedge|microsoft\s+edge)\b/.test(text));
}

function providerEndpoint(provider: { endpoint?: unknown; baseUrl?: unknown; url?: unknown; invokeUrl?: unknown } | undefined) {
  for (const value of [provider?.invokeUrl, provider?.endpoint, provider?.baseUrl, provider?.url]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function urlFromPrompt(prompt: string) {
  const raw = prompt.match(/https?:\/\/[^\s"'<>，。；;）)]+/i)?.[0];
  return raw?.replace(/[.,!?，。！？]+$/g, '');
}

function queryFromPrompt(prompt: string) {
  const search = /(?:search|query|搜索|检索)\s*[:：]?\s*["“]?([^"”\n。；;]+)/i.exec(prompt)?.[1]?.trim();
  return search || undefined;
}

function playwrightEdgeBrowserMarkdown(output: Awaited<ReturnType<typeof invokePlaywrightEdgeBrowser>>) {
  const firstSentence = firstReadableSentence(output.text);
  const digest = urlDigest(output.url);
  return [
    '# Microsoft Edge MCP browser result',
    '',
    `- Title: ${output.title || '(untitled)'}`,
    `- URL digest: ${digest ? `${digest.length}:${digest.sha1}` : '(unavailable)'}`,
    `- Body first sentence: ${firstSentence || '(no readable body text)'}`,
    `- providerDiagnostics.edgeDetected: ${String(output.providerDiagnostics.edgeDetected)}`,
    `- userAgent contains Edg: ${String(/Edg\//.test(output.providerDiagnostics.userAgent ?? ''))}`,
    `- userAgent: ${output.providerDiagnostics.userAgent ?? '(unavailable)'}`,
    `- MCP transport: ${output.providerDiagnostics.transport}`,
    '',
    '## Page Text',
    output.text || '(empty)',
  ].join('\n');
}

function firstReadableSentence(text: string) {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  return trimmed.split(/(?<=[.!?。！？])\s+/)[0]?.slice(0, 400) ?? trimmed.slice(0, 400);
}

function playwrightEdgeBrowserFailurePayload(
  request: GatewayRequest,
  input: PlaywrightEdgeBrowserInvocationInput,
  id: string,
  message: string,
): ToolPayload {
  return {
    message,
    confidence: 0.2,
    claimType: 'diagnostic',
    evidenceLevel: 'runtime',
    reasoningTrace: 'SciForge workspace runtime attempted the configured Microsoft Edge Playwright MCP provider route and failed closed.',
    displayIntent: {
      protocolStatus: 'protocol-failed',
      taskOutcome: 'needs-work',
      status: 'repair-needed',
    },
    claims: [{
      id: `claim-playwright-edge-browser-failure-${id}`,
      type: 'diagnostic',
      text: message,
      confidence: 0.2,
      evidenceLevel: 'runtime',
      supportingRefs: [],
      opposingRefs: [],
    }],
    uiManifest: [],
    executionUnits: [{
      id: `EU-playwright-edge-browser-${id}`,
      tool: TOOL_ID,
      status: 'failed-with-reason',
      params: playwrightEdgeBrowserExecutionParams(input),
      failureReason: message,
      hash: sha1(message).slice(0, 16),
    }],
    artifacts: [{
      id: `playwright-edge-browser-failure-${id}`,
      type: 'runtime-diagnostic',
      producerScenario: request.skillDomain,
      schemaVersion: 'sciforge.runtime-diagnostic.v1',
      metadata: {
        source: TOOL_ID,
        status: 'repair-needed',
      },
      data: {
        message,
        input: playwrightEdgeBrowserExecutionDiagnostic(input),
      },
    }],
  };
}

function playwrightEdgeBrowserExecutionDiagnostic(input: PlaywrightEdgeBrowserInvocationInput | undefined) {
  return {
    mode: input?.mode,
    queryDigest: input?.query ? textDigest(input.query) : undefined,
    urlDigest: input?.url ? urlDigest(input.url) : undefined,
    mcpRoute: input?.mcpUrl ? 'configured-loopback-or-provider-route' : undefined,
    workspaceProfileRef: input?.workspaceProfileDir ? WORKSPACE_BROWSER_PROFILE_REF : undefined,
    outputRef: input?.outputDir ? '.sciforge/browser-host/playwright-edge-output' : undefined,
  };
}

function publicPlaywrightEdgeBrowserOutput(output: Awaited<ReturnType<typeof invokePlaywrightEdgeBrowser>>) {
  return {
    ...output,
    url: `url-digest:${urlDigest(output.url)?.sha1 ?? sha1(output.url)}`,
    observations: output.observations.map((observation) => ({
      ...observation,
      url: observation.url ? `url-digest:${urlDigest(observation.url)?.sha1 ?? sha1(observation.url)}` : undefined,
    })),
    resultLinks: output.resultLinks?.map((link) => ({
      text: link.text,
      href: `url-digest:${urlDigest(link.href)?.sha1 ?? sha1(link.href)}`,
    })),
    links: output.links?.map((link) => ({
      text: link.text,
      href: `url-digest:${urlDigest(link.href)?.sha1 ?? sha1(link.href)}`,
    })),
    providerDiagnostics: {
      ...output.providerDiagnostics,
      mcpUrl: output.providerDiagnostics.mcpUrl ? 'configured-loopback-or-provider-route' : '',
    },
  };
}

function urlDigest(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return { length: normalized.length, sha1: sha1(normalized) };
}

function textDigest(value: string) {
  return { length: value.length, sha1: sha1(value) };
}
