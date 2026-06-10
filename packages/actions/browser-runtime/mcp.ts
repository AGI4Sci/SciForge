import { moduleResult, type ModuleInvokeRequest, type ModuleInvokeResult } from '@sciforge-ui/runtime-contract/modules';
import {
  BROWSER_PRIMITIVE_INPUT_SCHEMAS,
  BROWSER_PRIMITIVE_INTENTS,
  BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
  WEB_READ_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  WEB_TOOL_INPUT_SCHEMAS,
  browserPrimitiveEnvelopeToWebToolResult,
  validateWebToolInput,
  type BrowserPrimitiveName,
  type BrowserPrimitiveEnvelope,
  type BrowserPrimitiveService,
  type WebReadInput,
  type WebSearchInput,
  type WebToolName,
  type WebToolResultEnvelope,
} from './index.js';

export const BROWSER_RUNTIME_MCP_PACKAGE_ID = '@agi4sci/sciforge-browser-runtime-action-provider' as const;
export const BROWSER_RUNTIME_MCP_SERVER_NAME = 'sciforge-browser-runtime' as const;

export interface BrowserRuntimeMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface BrowserRuntimeMcpCallToolRequest {
  name: string;
  arguments?: Record<string, unknown>;
}

export function browserRuntimeMcpTools(): BrowserRuntimeMcpToolDefinition[] {
  return [
    {
      name: WEB_SEARCH_TOOL_NAME,
      description: 'Codex-compatible ordinary search entry for a Host-provided query. Returns current-run web_search results, candidate page refs, and source links for ordinary search answers; ordinary search does not require web_read. Agent Host may escalate to web_read for URL summaries, direct quotes, page-level verification, or low-information/conflicting results.',
      inputSchema: WEB_TOOL_INPUT_SCHEMAS.web_search,
    },
    {
      name: WEB_READ_TOOL_NAME,
      description: 'Internal or advanced read capability for one Host-provided URL or web-page:{id} candidate ref. Use for URL summaries, direct quotes, page-level verification, diagnostics, or fallback read escalation. web_read source/page text refs are evidence: source page refs use web-source:{id}; page text refs use web-text:{id}.',
      inputSchema: WEB_TOOL_INPUT_SCHEMAS.web_read,
    },
  ];
}

export function createBrowserRuntimeMcpAdapter(service: BrowserPrimitiveService) {
  return {
    tools: browserRuntimeMcpTools,
    callTool: async (request: BrowserRuntimeMcpCallToolRequest): Promise<ModuleInvokeResult<WebToolResultEnvelope>> => {
      const tool = browserRuntimeMcpWebToolName(request.name);
      const validation = validateWebToolInput(request.name, request.arguments ?? {});
      if (!tool || !validation.ok || !validation.tool || !validation.input) {
        const error = validation.errors[0] ?? {
          code: 'invalid_input' as const,
          message: `unsupported_web_tool:${request.name}`,
        };
        return moduleResult({
          moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
          ok: false,
          value: {
            schemaVersion: 'sciforge.browser-runtime.web-tool-result.v1',
            ok: false,
            status: 'failed',
            tool: tool ?? WEB_SEARCH_TOOL_NAME,
            refs: [],
            timings: {},
            warnings: [],
            error,
          },
          refs: [],
          error: error.message,
        });
      }
      const primitive = browserRuntimePrimitiveForWebTool(tool);
      const moduleRequest: ModuleInvokeRequest = {
        moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
        intent: BROWSER_PRIMITIVE_INTENTS[primitive],
        input: browserRuntimeMcpToolInput(tool, validation.input),
      };
      const result = await service.invoke(moduleRequest);
      return browserRuntimeWebModuleResult(tool, result, providerForWebInput(tool, validation.input));
    },
  };
}

const BROWSER_RUNTIME_MCP_WEB_TOOL_TO_PRIMITIVE = new Map<WebToolName, BrowserPrimitiveName>(
  [
    [WEB_SEARCH_TOOL_NAME, 'search'],
    [WEB_READ_TOOL_NAME, 'read'],
  ],
);

export function browserRuntimeMcpToolName(primitive: BrowserPrimitiveName) {
  if (primitive === 'search') return WEB_SEARCH_TOOL_NAME;
  if (primitive === 'read') return WEB_READ_TOOL_NAME;
  return BROWSER_PRIMITIVE_INTENTS[primitive].replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function browserRuntimeMcpWebToolName(name: string): WebToolName | undefined {
  if (name === WEB_SEARCH_TOOL_NAME || name === WEB_READ_TOOL_NAME) return name;
  return undefined;
}

function browserRuntimePrimitiveForWebTool(tool: WebToolName): BrowserPrimitiveName {
  return BROWSER_RUNTIME_MCP_WEB_TOOL_TO_PRIMITIVE.get(tool) ?? 'search';
}

function browserRuntimeMcpToolInput(tool: WebToolName, args: WebSearchInput | WebReadInput): Record<string, unknown> {
  if (tool === WEB_SEARCH_TOOL_NAME) {
    const search = args as WebSearchInput;
    const constraints = search.safe_search
      ? { ...(search.constraints ?? {}), safeSearch: search.safe_search }
      : search.constraints;
    return withoutUndefined({
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.search,
      query: search.query,
      limit: search.limit,
      locale: search.language,
      region: search.region,
      timeRange: search.time_range,
      engine: search.provider,
      budget: search.timeout_ms ? { maxTimeMs: search.timeout_ms } : undefined,
      constraints,
    });
  }
  const read = args as WebReadInput;
  const format = read.format ?? 'markdown';
  return withoutUndefined({
    schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.read,
    url: read.url,
    resourceRef: read.resourceRef,
    navigationMode: read.url ? 'ephemeral' : undefined,
    includeText: format === 'markdown' || format === 'text',
    includeHtml: format === 'html',
    maxTextChars: read.max_chars,
    timeoutMs: read.timeout_ms,
  });
}

function browserRuntimeWebModuleResult(
  tool: WebToolName,
  result: ModuleInvokeResult<BrowserPrimitiveEnvelope>,
  provider?: string,
): ModuleInvokeResult<WebToolResultEnvelope> {
  if (!result.value) {
    const error = {
      code: tool === WEB_SEARCH_TOOL_NAME ? 'provider_unavailable' as const : 'read_failed' as const,
      message: result.error ?? `${tool} failed`,
    };
    const value: WebToolResultEnvelope = {
      schemaVersion: 'sciforge.browser-runtime.web-tool-result.v1',
      ok: false,
      status: 'failed',
      tool,
      provider,
      refs: [],
      timings: {},
      warnings: [],
      error,
    };
    return moduleResult({
      moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
      ok: false,
      value,
      refs: [],
      error: error.message,
    });
  }
  const value = browserPrimitiveEnvelopeToWebToolResult(tool, result.value, provider);
  const refs = value.refs.map((ref) => ref.ref);
  return moduleResult({
    moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
    ok: value.ok,
    value,
    refs,
    error: value.ok ? undefined : value.error?.message ?? result.error,
  });
}

function providerForWebInput(tool: WebToolName, input: WebSearchInput | WebReadInput): string | undefined {
  if (tool === WEB_SEARCH_TOOL_NAME) return (input as WebSearchInput).provider;
  return undefined;
}

function withoutUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
