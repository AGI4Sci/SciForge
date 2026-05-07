import type { NormalizedAgentResponse, SendAgentMessageInput } from '../../domain';
import { DEFAULT_AGENT_REQUEST_TIMEOUT_MS, DEFAULT_AGENT_SERVER_URL } from '../../../../shared/agentHandoff';
import { SciForgeClientError, reasonFromResponseText, recoverActionsForService } from '../clientError';
import { buildRunPayload } from './requestPayload';
import { normalizeAgentResponse } from './responseNormalization';

const DEFAULT_REQUEST_TIMEOUT_MS = DEFAULT_AGENT_REQUEST_TIMEOUT_MS;

export async function sendAgentMessage(input: SendAgentMessageInput, signal?: AbortSignal): Promise<NormalizedAgentResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), input.config.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS);
  const linkedAbort = () => controller.abort();
  signal?.addEventListener('abort', linkedAbort, { once: true });
  try {
    const baseUrl = input.config.agentServerBaseUrl || DEFAULT_AGENT_SERVER_URL;
    const response = await fetch(`${baseUrl}/api/agent-server/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRunPayload(input)),
      signal: controller.signal,
    });
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // Keep the raw text for diagnostics.
    }
    if (!response.ok) {
      throw new SciForgeClientError({
        title: 'AgentServer 请求失败',
        reason: reasonFromResponseText(text, `HTTP ${response.status}`),
        recoverActions: recoverActionsForService('agentserver'),
        diagnosticRef: `agentserver-http-${response.status}`,
      });
    }
    return normalizeAgentResponse(input.scenarioId, input.prompt, json);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new SciForgeClientError({
        title: 'AgentServer 请求超时',
        reason: '请求已取消或超过配置的 timeout。',
        recoverActions: ['检查模型后端是否响应', '调大 Timeout ms', '重试当前请求'],
        diagnosticRef: 'agentserver-timeout',
        cause: err,
      });
    }
    if (err instanceof TypeError) {
      throw new SciForgeClientError({
        title: '无法连接 AgentServer',
        reason: `${input.config.agentServerBaseUrl || DEFAULT_AGENT_SERVER_URL} 未响应。`,
        recoverActions: recoverActionsForService('agentserver'),
        diagnosticRef: 'agentserver-connection',
        cause: err,
      });
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', linkedAbort);
  }
}

