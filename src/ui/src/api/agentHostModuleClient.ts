import type {
  ModuleDescription,
  ModuleFunctionName,
  ModuleInvokeRequest,
  ModulePipelineTraceStep,
  ModuleQueryRequest,
  ModuleReadRequest,
  ModuleResultEnvelope,
} from '@sciforge-ui/runtime-contract/modules';
import type { SciForgeConfig } from '../domain';
import { SciForgeClientError, reasonFromResponseText, recoverActionsForService } from './clientError';

export const RUNTIME_MODULE_DISPATCHER_CAPABILITY = 'runtime-module-dispatcher';

export interface AgentHostModuleCallResult<T = unknown> {
  result: ModuleResultEnvelope<T>;
  trace: ModulePipelineTraceStep[];
}

export async function describeAgentHostModule(
  request: { moduleId?: string },
  config: SciForgeConfig,
): Promise<AgentHostModuleCallResult<ModuleDescription | { modules: ModuleDescription[]; moduleIds: string[] }>> {
  return callAgentHostModule('describe', request, config);
}

export async function queryAgentHostModule<T = unknown>(
  request: ModuleQueryRequest,
  config: SciForgeConfig,
): Promise<AgentHostModuleCallResult<T>> {
  return callAgentHostModule('query', request, config);
}

export async function readAgentHostModule<T = unknown>(
  request: ModuleReadRequest,
  config: SciForgeConfig,
): Promise<AgentHostModuleCallResult<T>> {
  return callAgentHostModule('read', request, config);
}

export async function invokeAgentHostModule<T = unknown>(
  request: ModuleInvokeRequest,
  config: SciForgeConfig,
): Promise<AgentHostModuleCallResult<T>> {
  return callAgentHostModule('invoke', request, config);
}

export async function callAgentHostModule<T>(
  functionName: ModuleFunctionName,
  request: object,
  config: SciForgeConfig,
): Promise<AgentHostModuleCallResult<T>> {
  const candidates = agentHostModuleDispatcherCandidates(config);
  let firstError: unknown;
  for (const [index, baseUrl] of candidates.entries()) {
    try {
      return await callAgentHostModuleAtBaseUrl(functionName, request, config, baseUrl);
    } catch (error) {
      firstError ??= error;
      if (index === candidates.length - 1 || !agentHostModuleErrorAllowsFallback(error)) throw error;
    }
  }
  throw firstError instanceof Error ? firstError : new Error(String(firstError ?? 'Agent Host module dispatcher unavailable.'));
}

export function agentHostModuleDispatcherCandidates(config: SciForgeConfig) {
  return uniqueUrls([
    config.agentServerBaseUrl,
    // Compatibility transport: current web shell exposes the Agent Host module dispatcher through
    // the local workspace runtime while Codex app-server itself is stdio-owned.
    config.workspaceWriterBaseUrl,
  ]);
}

async function callAgentHostModuleAtBaseUrl<T>(
  functionName: ModuleFunctionName,
  request: object,
  config: SciForgeConfig,
  baseUrl: string,
): Promise<AgentHostModuleCallResult<T>> {
  const response = await fetchAgentHostModule(
    baseUrl,
    `module.${functionName}`,
    `${baseUrl}/api/sciforge/modules/${functionName}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(request as Record<string, unknown>), workspacePath: config.workspacePath }),
    },
  );
  const json = await readAgentHostModuleJson<{
    result?: ModuleResultEnvelope<T>;
    trace?: ModulePipelineTraceStep[];
    error?: string;
  }>(
    baseUrl,
    `module.${functionName}`,
    response,
    `Agent Host module ${functionName} failed: HTTP ${response.status}`,
  );
  if (!json.result) throw new Error(json.error ?? `Agent Host module ${functionName} returned no result envelope.`);
  return {
    result: json.result,
    trace: Array.isArray(json.trace) ? json.trace : [],
  };
}

async function fetchAgentHostModule(
  baseUrl: string,
  operation: string,
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SciForgeClientError({
      title: 'Agent Host dispatcher 未连接',
      reason: sanitizeAgentHostDiagnosticText(`${baseUrl} 无法访问，操作：${operation}。${detail}`),
      recoverActions: recoverActionsForService('workspace'),
      diagnosticRef: 'agent-host-module-connection',
      cause: error,
    });
  }
}

async function readAgentHostModuleJson<T>(
  baseUrl: string,
  operation: string,
  response: Response,
  fallback: string,
): Promise<T> {
  if (!response.ok) throw await agentHostModuleRequestError(baseUrl, response, fallback);
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const looksLikeHtml = agentHostModuleResponseLooksLikeHtml(text, contentType);
    const reason = looksLikeHtml
      ? `${sanitizeAgentHostDiagnosticText(baseUrl)} 返回的是 SciForge UI 页面，不是 Agent Host module dispatcher JSON。`
      : `${sanitizeAgentHostDiagnosticText(operation)} returned a non-JSON response (${contentType || 'unknown content type'}).`;
    throw new SciForgeClientError({
      title: 'Agent Host dispatcher 响应不是 JSON',
      reason: sanitizeAgentHostDiagnosticText(reason),
      recoverActions: recoverActionsForService('workspace'),
      diagnosticRef: looksLikeHtml ? 'agent-host-module-html-response' : 'agent-host-module-invalid-json',
      cause: error,
    });
  }
}

async function agentHostModuleRequestError(baseUrl: string, response: Response, fallback: string) {
  const text = await response.text();
  const staleWriterError = response.status === 404 || response.status === 405
    ? await missingModuleDispatcherCapabilityError(baseUrl)
    : undefined;
  if (staleWriterError) return staleWriterError;
  return new SciForgeClientError({
    title: 'Agent Host dispatcher 请求失败',
    reason: sanitizeAgentHostDiagnosticText(reasonFromResponseText(text, sanitizeAgentHostDiagnosticText(fallback))),
    recoverActions: recoverActionsForService('workspace'),
    diagnosticRef: `agent-host-module-http-${response.status}`,
  });
}

function agentHostModuleErrorAllowsFallback(error: unknown) {
  if (!(error instanceof SciForgeClientError)) return false;
  return error.diagnosticRef === 'agent-host-module-connection'
    || error.diagnosticRef === 'agent-host-module-html-response'
    || error.diagnosticRef === 'agent-host-module-http-404'
    || error.diagnosticRef === 'agent-host-module-http-405'
    || error.diagnosticRef === 'agent-host-module-missing-runtime-module-dispatcher';
}

function uniqueUrls(values: string[]) {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const value of values) {
    const url = value.trim().replace(/\/+$/, '');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function agentHostModuleResponseLooksLikeHtml(text: string, contentType: string) {
  return /\bhtml\b/i.test(contentType) || /^\s*<!doctype\s+html/i.test(text) || /^\s*<html[\s>]/i.test(text);
}

async function missingModuleDispatcherCapabilityError(baseUrl: string) {
  const health = await loadAgentHostModuleHealth(baseUrl);
  if (!health || health.service !== 'sciforge-workspace-writer') return undefined;
  if (health.capabilities.includes(RUNTIME_MODULE_DISPATCHER_CAPABILITY)) return undefined;
  return new SciForgeClientError({
    title: 'Workspace Writer 缺少 Agent Host module dispatcher',
    reason: `当前 Workspace Writer 已在线，但缺少 ${RUNTIME_MODULE_DISPATCHER_CAPABILITY} 能力；这通常表示 writer 进程仍是旧版本或尚未重启。`,
    recoverActions: [
      '重启 npm run workspace:server 后刷新',
      '确认 Settings 中的 Workspace Writer URL 指向当前 writer',
      '重新打开右侧 Files 或对象引用',
    ],
    diagnosticRef: 'agent-host-module-missing-runtime-module-dispatcher',
  });
}

async function loadAgentHostModuleHealth(baseUrl: string): Promise<{ service: string; capabilities: string[] } | undefined> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, {
      signal: agentHostModuleHealthSignal(1200),
    });
    if (!response.ok) return undefined;
    const json = await response.json() as unknown;
    if (!json || typeof json !== 'object') return undefined;
    const record = json as { service?: unknown; capabilities?: unknown };
    return {
      service: typeof record.service === 'string' ? record.service : '',
      capabilities: Array.isArray(record.capabilities) ? record.capabilities.filter((item): item is string => typeof item === 'string') : [],
    };
  } catch {
    return undefined;
  }
}

function agentHostModuleHealthSignal(timeoutMs: number) {
  const timeout = typeof AbortSignal !== 'undefined'
    ? (AbortSignal as typeof AbortSignal & { timeout?: (milliseconds: number) => AbortSignal }).timeout
    : undefined;
  return typeof timeout === 'function' ? timeout(timeoutMs) : undefined;
}

function sanitizeAgentHostDiagnosticText(value: string) {
  return value
    .replace(/\bAuthorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Authorization: Bearer [redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9][A-Za-z0-9_-]{8,}\b/g, '[redacted-token]')
    .replace(
      /\b(api[_-]?key|authorization|credential|password|secret|token)\b(\s*[:=]\s*)(["']?)[^"',}\]\s]+/gi,
      (_match, key: string, separator: string, quote: string) => `${key}${separator}${quote}[redacted]`,
    )
    .replace(/\bhttps?:\/\/[^\s"'<>\\)]+/gi, '[url]')
    .replace(/\b(?:api|[a-z0-9-]*(?:openai|anthropic|provider|openrouter|azure|googleapis)[a-z0-9-]*)(?:\.[a-z0-9-]+)+(?:\:\d+)?\b/gi, '[host]')
    .replace(/\bfile:\/\/\/[^\s"'<>\\)]+/gi, '[workspace-path]')
    .replace(/\/(?:Applications|Users|home|private|var|tmp)\/[^\s"'<>\\)]+/gi, '[workspace-path]')
    .replace(/\b[A-Za-z]:\\Users\\[^\s"'<>]+/gi, '[workspace-path]');
}
