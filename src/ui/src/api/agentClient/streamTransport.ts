import type { AgentStreamEvent, NormalizedAgentResponse, SendAgentMessageInput } from '../../domain';
import { DEFAULT_AGENT_REQUEST_TIMEOUT_MS, DEFAULT_AGENT_SERVER_URL } from '../../../../shared/agentHandoff';
import { SciForgeClientError, reasonFromResponseText, recoverActionsForService } from '../clientError';
import { buildRunPayload } from './requestPayload';
import { normalizeAgentResponse } from './responseNormalization';
import { normalizeStreamEvent, withConfiguredContextWindowLimit } from './contextTelemetry';

const DEFAULT_REQUEST_TIMEOUT_MS = DEFAULT_AGENT_REQUEST_TIMEOUT_MS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function sendAgentMessageStream(
  input: SendAgentMessageInput,
  callbacks: {
    onEvent?: (event: AgentStreamEvent) => void;
  } = {},
  signal?: AbortSignal,
): Promise<NormalizedAgentResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), input.config.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS);
  const linkedAbort = () => controller.abort();
  signal?.addEventListener('abort', linkedAbort, { once: true });
  try {
    const baseUrl = input.config.agentServerBaseUrl || DEFAULT_AGENT_SERVER_URL;
    const response = await fetch(`${baseUrl}/api/agent-server/runs/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRunPayload(input)),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new SciForgeClientError({
        title: 'AgentServer 流式请求失败',
        reason: reasonFromResponseText(text, `HTTP ${response.status}`),
        recoverActions: recoverActionsForService('agentserver'),
        diagnosticRef: `agentserver-stream-http-${response.status}`,
      });
    }
    if (!response.body) {
      throw new SciForgeClientError({
        title: 'AgentServer 流式响应不可读',
        reason: '服务返回了成功状态，但没有可读取的响应体。',
        recoverActions: recoverActionsForService('agentserver'),
        diagnosticRef: 'agentserver-stream-body',
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: unknown;
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const envelope = JSON.parse(trimmed) as unknown;
        if (!isRecord(envelope)) continue;
        if ('event' in envelope) callbacks.onEvent?.(withConfiguredContextWindowLimit(
          normalizeStreamEvent(envelope.event),
          input.config.maxContextWindowTokens,
        ));
        if ('result' in envelope) finalResult = envelope.result;
        if ('error' in envelope) {
          callbacks.onEvent?.(withConfiguredContextWindowLimit(
            normalizeStreamEvent({ type: 'error', error: envelope.error }),
            input.config.maxContextWindowTokens,
          ));
        }
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const envelope = JSON.parse(buffer.trim()) as unknown;
      if (isRecord(envelope)) {
        if ('event' in envelope) callbacks.onEvent?.(withConfiguredContextWindowLimit(
          normalizeStreamEvent(envelope.event),
          input.config.maxContextWindowTokens,
        ));
        if ('result' in envelope) finalResult = envelope.result;
        if ('error' in envelope) callbacks.onEvent?.(withConfiguredContextWindowLimit(
          normalizeStreamEvent({ type: 'error', error: envelope.error }),
          input.config.maxContextWindowTokens,
        ));
      }
    }
    if (!finalResult) {
      throw new SciForgeClientError({
        title: 'AgentServer 流式响应不完整',
        reason: '流结束时没有最终 run result。',
        recoverActions: ['查看 AgentServer 日志', '重试当前请求', '改用 workspace/evolved capability 或 workspace runtime'],
        diagnosticRef: 'agentserver-stream-missing-result',
      });
    }
    return normalizeAgentResponse(input.scenarioId, input.prompt, { ok: true, data: finalResult });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new SciForgeClientError({
        title: 'AgentServer 流式请求超时',
        reason: '请求已取消或超过配置的 timeout。',
        recoverActions: ['检查模型后端是否响应', '调大 Timeout ms', '重试当前请求'],
        diagnosticRef: 'agentserver-stream-timeout',
        cause: err,
      });
    }
    if (err instanceof TypeError) {
      throw new SciForgeClientError({
        title: '无法连接 AgentServer stream',
        reason: `${input.config.agentServerBaseUrl || DEFAULT_AGENT_SERVER_URL} 未响应。`,
        recoverActions: recoverActionsForService('agentserver'),
        diagnosticRef: 'agentserver-stream-connection',
        cause: err,
      });
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', linkedAbort);
  }
}

