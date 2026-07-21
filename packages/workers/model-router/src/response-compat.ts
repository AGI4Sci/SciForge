import { randomBytes } from 'node:crypto';

import { normalizeProviderJsonSchema } from './provider-compat';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type ResponsesRequest = {
  model?: string;
  input?: unknown;
  instructions?: string;
  tools?: unknown;
  tool_choice?: unknown;
  temperature?: unknown;
  top_p?: unknown;
  max_tokens?: unknown;
  max_output_tokens?: unknown;
  parallel_tool_calls?: unknown;
  metadata?: unknown;
  asr_options?: unknown;
  reasoning?: unknown;
  reasoning_effort?: unknown;
  thinking?: unknown;
  stop?: unknown;
  stream?: unknown;
};

type ResponseToolDescriptor = {
  responseName: string;
  description: string;
  parameters: unknown;
};

const PROVIDER_TOOL_SCHEMA_MAX_STRING_CHARS = 2_000;

export type AnthropicMessagesRequest = {
  model?: string;
  messages?: unknown;
  system?: unknown;
  tools?: unknown;
  tool_choice?: unknown;
  temperature?: unknown;
  top_p?: unknown;
  max_tokens?: unknown;
  metadata?: unknown;
  thinking?: unknown;
  stop_sequences?: unknown;
  stream?: unknown;
};

export type CanonicalTerminalDetails = {
  protocol: 'chat-completions' | 'anthropic-messages';
  finish_reason?: string;
  stop_reason?: string;
  stop_sequence?: string | null;
};

export function makeId(prefix: string): string {
  const cleanPrefix = prefix.replace(/[^A-Za-z0-9_-]+/g, '_') || 'id';
  return `${cleanPrefix}_${randomBytes(12).toString('hex')}`;
}

export function messageOutputItem(text: string, id = makeId('msg')): JsonObject {
  return {
    id,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [{
      type: 'output_text',
      text,
      annotations: [],
    }],
  };
}

export function reasoningOutputItem(text: string, id = makeId('rs'), signature?: string): JsonObject {
  return compactJsonObject({
    id,
    type: 'reasoning',
    summary: [{
      type: 'summary_text',
      text,
    }],
    signature,
  });
}

export function chatToolNameAliasesFromResponsesTools(tools: unknown): Record<string, string> {
  const aliases: Record<string, string> = {};
  const used = new Set<string>();
  responseToolDescriptors(tools).forEach((tool, index) => {
    const alias = chatToolNameAlias(tool.responseName, index, used);
    if (alias !== tool.responseName) aliases[alias] = tool.responseName;
  });
  return aliases;
}

export function responsesToChatCompletions(
  request: ResponsesRequest,
  options: { defaultModel?: string } = {},
): JsonObject {
  const toolAliases = chatToolNameAliasesFromResponsesTools(request.tools);
  const reasoning = isRecord(request.reasoning) ? request.reasoning : undefined;
  const reasoningEffort = stringValue(request.reasoning_effort) || (reasoning ? stringValue(reasoning.effort) : '');
  return compactJsonObject({
    model: stringValue(request.model) || options.defaultModel || '',
    messages: responsesInputToMessages(request, toolAliases),
    tools: responsesToolsToChatTools(request.tools, toolAliases),
    tool_choice: responseToolChoiceToChatToolChoice(request.tool_choice, toolAliases),
    temperature: request.temperature,
    top_p: request.top_p,
    max_tokens: request.max_output_tokens ?? request.max_tokens,
    parallel_tool_calls: request.parallel_tool_calls,
    metadata: request.metadata,
    asr_options: request.asr_options,
    reasoning_effort: reasoningEffort || undefined,
    stop: request.stop,
  });
}

export function chatCompletionToResponse(
  payload: unknown,
  request: Pick<ResponsesRequest, 'model'> = {},
  toolNameAliases: Record<string, string> = {},
): JsonObject {
  const completion = isRecord(payload) ? payload : {};
  const choices = Array.isArray(completion.choices) ? completion.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : {};
  const finishReason = stringValue(firstChoice.finish_reason);
  const message = firstChoiceMessage(completion);
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const reasoningContent = messageReasoningContent(message);
  const reasoningItems = reasoningContent ? [reasoningOutputItem(reasoningContent)] : [];
  const output = toolCalls.length > 0
    ? [
      ...reasoningItems,
      ...toolCalls.map((toolCall) => chatToolCallToResponseItem(toolCall, toolNameAliases, reasoningContent)),
    ]
    : responseTextFromMessage(message)
      ? [...reasoningItems, messageOutputItem(responseTextFromMessage(message))]
      : [];
  const usage = canonicalUsageFromChatCompletion(completion);
  const incompleteReason = finishReason === 'length'
    ? 'max_output_tokens'
    : finishReason === 'content_filter'
      ? 'content_filter'
      : undefined;
  return {
    id: stringValue(completion.id) || makeId('resp'),
    object: 'response',
    created_at: numberValue(completion.created) || Math.floor(Date.now() / 1000),
    model: stringValue(request.model) || stringValue(completion.model) || '',
    status: incompleteReason ? 'incomplete' : 'completed',
    output,
    output_text: toolCalls.length > 0 ? '' : responseTextFromMessage(message),
    usage,
    ...(finishReason
      ? { terminal_details: { protocol: 'chat-completions', finish_reason: finishReason } }
      : {}),
    ...(incompleteReason ? { incomplete_details: { reason: incompleteReason } } : {}),
  };
}

export function anthropicMessagesToResponses(
  request: AnthropicMessagesRequest,
  options: { defaultModel?: string } = {},
): ResponsesRequest {
  return compactJsonObject({
    model: stringValue(request.model) || options.defaultModel || '',
    instructions: anthropicSystemToText(request.system),
    input: anthropicMessagesToResponsesInput(request.messages),
    tools: anthropicToolsToResponsesTools(request.tools),
    tool_choice: request.tool_choice,
    temperature: request.temperature,
    top_p: request.top_p,
    max_output_tokens: request.max_tokens,
    metadata: request.metadata,
    thinking: request.thinking,
    stop: request.stop_sequences,
    stream: request.stream,
  }) as ResponsesRequest;
}

export function responseToAnthropicMessage(
  response: JsonObject,
  request: Pick<AnthropicMessagesRequest, 'model'> = {},
): JsonObject {
  const output = Array.isArray(response.output) ? response.output : [];
  const content = responseOutputToAnthropicContent(output);
  const text = stringValue(response.output_text);
  const terminal = anthropicTerminalFromResponse(
    response,
    content.some((part) => part.type === 'tool_use') ? 'tool_use' : 'end_turn',
  );
  return {
    id: stringValue(response.id) || makeId('msg'),
    type: 'message',
    role: 'assistant',
    model: stringValue(request.model) || stringValue(response.model),
    content: content.length > 0 ? content : text ? [{ type: 'text', text }] : [],
    stop_reason: terminal.stopReason,
    stop_sequence: terminal.stopSequence,
    usage: anthropicUsageFromResponse(response, text || JSON.stringify(content)),
  };
}

export function responsesToAnthropicMessages(
  request: ResponsesRequest,
  options: { defaultModel?: string } = {},
): JsonObject {
  const chat = responsesToChatCompletions(request, options);
  const chatMessages = Array.isArray(chat.messages) ? chat.messages : [];
  const system: JsonValue[] = [];
  const messages: JsonValue[] = [];
  for (const value of chatMessages) {
    if (!isRecord(value)) continue;
    const role = stringValue(value.role) || 'user';
    if (role === 'system' || role === 'developer') {
      const text = chatContentToText(value.content);
      if (text) system.push({ type: 'text', text });
      continue;
    }
    if (role === 'tool') {
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: stringValue(value.tool_call_id),
          content: chatContentToText(value.content),
        }],
      });
      continue;
    }
    const content = chatMessageToAnthropicContent(value);
    messages.push({
      role: role === 'assistant' ? 'assistant' : 'user',
      content,
    });
  }
  const maxTokens = numberValue(request.max_output_tokens) || numberValue(request.max_tokens);
  const effectiveMaxTokens = maxTokens && maxTokens > 0 ? maxTokens : 4096;
  return compactJsonObject({
    model: stringValue(request.model) || options.defaultModel || '',
    system: system.length > 0 ? system : undefined,
    messages: messages.length > 0 ? messages : [{ role: 'user', content: [{ type: 'text', text: '' }] }],
    tools: chatToolsToAnthropicTools(chat.tools),
    tool_choice: chatToolChoiceToAnthropicToolChoice(chat.tool_choice, request.parallel_tool_calls),
    temperature: request.temperature,
    top_p: request.top_p,
    max_tokens: effectiveMaxTokens,
    metadata: request.metadata,
    thinking: responsesReasoningToAnthropicThinking(request, effectiveMaxTokens),
    stop_sequences: request.stop,
    stream: request.stream,
  });
}

export function responsesReasoningToAnthropicThinking(
  request: Pick<ResponsesRequest, 'reasoning' | 'reasoning_effort' | 'thinking'>,
  maxTokens: number,
): JsonObject | undefined {
  const rawThinking = isRecord(request.thinking) ? request.thinking : undefined;
  if (rawThinking) {
    const type = stringValue(rawThinking.type);
    if (!type) throw new RangeError('Anthropic thinking.type must be a non-empty string.');
    if (type === 'enabled') {
      const budget = numberValue(rawThinking.budget_tokens);
      assertAnthropicThinkingBudget(budget, maxTokens);
    }
    return compactJsonObject(rawThinking);
  }
  if (request.thinking !== undefined) {
    throw new RangeError('Anthropic thinking must be an object when provided.');
  }

  const reasoning = isRecord(request.reasoning) ? request.reasoning : undefined;
  const effort = stringValue(request.reasoning_effort) || stringValue(reasoning?.effort) || (
    request.reasoning !== undefined ? 'medium' : ''
  );
  if (!effort) return undefined;
  if (effort === 'none' || effort === 'disabled') return { type: 'disabled' };
  const ratios: Record<string, number> = { low: 0.25, medium: 0.5, high: 0.75, xhigh: 0.875 };
  const ratio = ratios[effort];
  if (ratio === undefined) throw new RangeError(`Unsupported reasoning effort for Anthropic thinking: ${effort}`);
  if (!Number.isInteger(maxTokens) || maxTokens <= 1024) {
    throw new RangeError('Anthropic thinking requires max_tokens greater than 1024.');
  }
  const budget = Math.min(maxTokens - 1, Math.max(1024, Math.floor(maxTokens * ratio)));
  assertAnthropicThinkingBudget(budget, maxTokens);
  return { type: 'enabled', budget_tokens: budget };
}

export function anthropicMessageToResponse(
  payload: unknown,
  request: Pick<ResponsesRequest, 'model'> = {},
): JsonObject {
  const message = isRecord(payload) ? payload : {};
  const stopReason = stringValue(message.stop_reason);
  const stopSequence = typeof message.stop_sequence === 'string' ? message.stop_sequence : null;
  const content = Array.isArray(message.content) ? message.content : [];
  const output: JsonObject[] = [];
  let outputText = '';
  for (const value of content) {
    if (!isRecord(value)) continue;
    if (value.type === 'text') {
      const text = stringValue(value.text);
      if (!text) continue;
      outputText += text;
      output.push(messageOutputItem(text));
      continue;
    }
    if (value.type === 'thinking') {
      const thinking = stringValue(value.thinking);
      if (thinking) output.push(reasoningOutputItem(thinking, makeId('rs'), stringValue(value.signature) || undefined));
      continue;
    }
    if (value.type === 'tool_use') {
      const id = stringValue(value.id) || makeId('call');
      output.push({
        id,
        type: 'function_call',
        status: 'completed',
        call_id: id,
        name: stringValue(value.name),
        arguments: stringifyJsonValue(value.input) || '{}',
      });
    }
  }
  return {
    id: stringValue(message.id) || makeId('resp'),
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model: stringValue(request.model) || stringValue(message.model),
    status: message.stop_reason === 'max_tokens' ? 'incomplete' : 'completed',
    output,
    output_text: outputText,
    usage: canonicalUsageFromAnthropicMessage(message),
    ...(stopReason
      ? {
          terminal_details: {
            protocol: 'anthropic-messages',
            stop_reason: stopReason,
            stop_sequence: stopSequence,
          },
        }
      : {}),
    ...(message.stop_reason === 'max_tokens'
      ? { incomplete_details: { reason: 'max_output_tokens' } }
      : {}),
  };
}

export function chatFinishReasonFromResponse(response: JsonObject, fallback: string): string {
  const terminal = isRecord(response.terminal_details) ? response.terminal_details : {};
  const finishReason = stringValue(terminal.finish_reason);
  if (finishReason) return finishReason;

  const stopReason = stringValue(terminal.stop_reason);
  if (stopReason) {
    const mapped: Record<string, string> = {
      end_turn: 'stop',
      stop_sequence: 'stop',
      max_tokens: 'length',
      tool_use: 'tool_calls',
    };
    const value = mapped[stopReason];
    if (!value) throw new RangeError(`Chat Completions cannot represent Anthropic stop_reason="${stopReason}".`);
    return value;
  }

  const incomplete = isRecord(response.incomplete_details) ? response.incomplete_details : {};
  const incompleteReason = stringValue(incomplete.reason);
  if (incompleteReason === 'max_output_tokens') return 'length';
  if (incompleteReason === 'content_filter') return 'content_filter';
  return fallback;
}

export function anthropicTerminalFromResponse(
  response: JsonObject,
  fallbackStopReason: string,
): { stopReason: string; stopSequence: string | null } {
  const terminal = isRecord(response.terminal_details) ? response.terminal_details : {};
  const stopReason = stringValue(terminal.stop_reason);
  if (stopReason) {
    return {
      stopReason,
      stopSequence: typeof terminal.stop_sequence === 'string' ? terminal.stop_sequence : null,
    };
  }

  const finishReason = stringValue(terminal.finish_reason);
  if (finishReason) {
    const mapped: Record<string, string> = {
      stop: 'end_turn',
      length: 'max_tokens',
      tool_calls: 'tool_use',
      function_call: 'tool_use',
    };
    const value = mapped[finishReason];
    if (!value) throw new RangeError(`Anthropic Messages cannot represent Chat finish_reason="${finishReason}".`);
    return { stopReason: value, stopSequence: null };
  }

  const incomplete = isRecord(response.incomplete_details) ? response.incomplete_details : {};
  const incompleteReason = stringValue(incomplete.reason);
  if (incompleteReason === 'max_output_tokens') return { stopReason: 'max_tokens', stopSequence: null };
  if (incompleteReason) {
    throw new RangeError(`Anthropic Messages cannot represent Responses incomplete reason="${incompleteReason}".`);
  }
  return { stopReason: fallbackStopReason, stopSequence: null };
}

export function estimateAnthropicMessagesInputTokens(request: AnthropicMessagesRequest): number {
  return estimateTokenCount(JSON.stringify({
    system: request.system,
    messages: request.messages,
    tools: request.tools,
  }));
}

function responsesInputToMessages(
  request: ResponsesRequest,
  toolNameAliases: Record<string, string>,
): JsonValue[] {
  const messages: JsonValue[] = [];
  if (request.instructions?.trim()) {
    messages.push({ role: 'system', content: request.instructions.trim() });
  }
  const input = request.input;
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    const aliasByOriginal = new Map(Object.entries(toolNameAliases).map(([alias, original]) => [original, alias]));
    const pendingToolCalls: JsonObject[] = [];
    const pendingReasoning: string[] = [];
    const flushPendingToolCalls = (): void => {
      if (pendingToolCalls.length === 0) return;
      messages.push(compactJsonObject({
        role: 'assistant',
        content: null,
        reasoning_content: pendingReasoning.length > 0 ? pendingReasoning.join('\n') : undefined,
        tool_calls: [...pendingToolCalls],
      }));
      pendingToolCalls.length = 0;
      pendingReasoning.length = 0;
    };
    for (const item of input) {
      if (isRecord(item) && item.type === 'function_call') {
        const toolCall = responseInputFunctionCallToChatToolCall(item, aliasByOriginal);
        if (toolCall) {
          pendingToolCalls.push(toolCall.toolCall);
          if (toolCall.reasoningContent) pendingReasoning.push(toolCall.reasoningContent);
        }
        continue;
      }
      flushPendingToolCalls();
      const message = responseInputItemToMessage(item, aliasByOriginal);
      if (message) messages.push(message);
    }
    flushPendingToolCalls();
  }
  if (messages.length === 0) messages.push({ role: 'user', content: '' });
  return messages;
}

function anthropicSystemToText(system: unknown): string | undefined {
  if (typeof system === 'string') return system.trim() || undefined;
  const text = anthropicContentToText(system);
  return text.trim() || undefined;
}

function anthropicMessagesToResponsesInput(messages: unknown): JsonValue[] {
  if (!Array.isArray(messages)) return [{ role: 'user', content: [{ type: 'input_text', text: '' }] }];
  const input: JsonValue[] = [];
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const role = stringValue(message.role) || 'user';
    const textParts: JsonObject[] = [];
    const flushTextParts = (): void => {
      if (textParts.length === 0) return;
      input.push({ role, content: [...textParts] });
      textParts.length = 0;
    };
    const parts = anthropicContentParts(message.content);
    for (const part of parts) {
      if (isRecord(part) && part.type === 'tool_use') {
        const callId = stringValue(part.id) || makeId('toolu');
        const name = stringValue(part.name) || 'tool';
        flushTextParts();
        input.push({
          id: callId,
          type: 'function_call',
          status: 'completed',
          call_id: callId,
          name,
          arguments: JSON.stringify(jsonValue(part.input) ?? {}),
        });
        continue;
      }
      if (isRecord(part) && part.type === 'tool_result') {
        const callId = stringValue(part.tool_use_id);
        const output = anthropicToolResultOutput(part.content);
        if (callId) {
          flushTextParts();
          input.push({
            type: 'function_call_output',
            call_id: callId,
            output,
          });
        } else {
          textParts.push({ type: 'input_text', text: output });
        }
        continue;
      }
      const normalized = anthropicContentPartToResponsesPart(part);
      if (normalized) textParts.push(normalized);
    }
    flushTextParts();
  }
  return input.length > 0 ? input : [{ role: 'user', content: [{ type: 'input_text', text: '' }] }];
}

function anthropicToolResultOutput(content: unknown): JsonValue {
  const text = anthropicContentToText(content);
  const images = anthropicToolResultImages(content);
  if (images.length === 0) return text || stringifyJsonValue(content) || '';
  return compactJsonObject({
    kind: 'image',
    note: text || undefined,
    content: [
      ...(text ? [{ type: 'text', text }] : []),
      ...images,
    ],
  });
}

function anthropicToolResultImages(content: unknown): JsonObject[] {
  const parts = anthropicContentParts(content);
  const images: JsonObject[] = [];
  for (const part of parts) {
    const image = anthropicImagePartToMcpContent(part);
    if (image) images.push(image);
  }
  return images;
}

function anthropicImagePartToMcpContent(part: unknown): JsonObject | null {
  if (!isRecord(part) || part.type !== 'image') return null;
  const source = isRecord(part.source) ? part.source : {};
  const data = stringValue(source.data);
  const mimeType = stringValue(source.media_type) || 'image/png';
  if (!data) return null;
  return { type: 'image', data, mimeType };
}

function anthropicContentParts(content: unknown): unknown[] {
  if (typeof content === 'string') return [content];
  if (Array.isArray(content)) return content;
  return [''];
}

function anthropicContentPartToResponsesPart(part: unknown): JsonObject | null {
  if (typeof part === 'string') return { type: 'input_text', text: part };
  if (!isRecord(part)) return null;
  if (part.type === 'text') return { type: 'input_text', text: stringValue(part.text) };
  if (part.type === 'image') {
    const source = isRecord(part.source) ? part.source : {};
    const data = stringValue(source.data);
    const mediaType = stringValue(source.media_type) || 'image/png';
    if (data) return { type: 'input_image', image_url: `data:${mediaType};base64,${data}` };
  }
  return { type: 'input_text', text: stringifyJsonValue(part) || '' };
}

function anthropicContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!isRecord(part)) return '';
      return stringValue(part.text) || stringValue(part.content);
    })
    .filter(Boolean)
    .join('\n');
}

function anthropicToolsToResponsesTools(tools: unknown): JsonValue[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  const responsesTools = tools.map((tool): JsonObject | null => {
    if (!isRecord(tool)) return null;
    const name = stringValue(tool.name);
    if (!name) return null;
    return compactJsonObject({
      type: 'function',
      name,
      description: stringValue(tool.description) || undefined,
      parameters: jsonValue(tool.input_schema) ?? {},
    });
  }).filter((tool): tool is JsonObject => Boolean(tool));
  return responsesTools.length > 0 ? responsesTools : undefined;
}

function responseOutputToAnthropicContent(output: JsonValue[]): JsonObject[] {
  const content: JsonObject[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (item.type === 'reasoning') {
      const summary = Array.isArray(item.summary) ? item.summary : [];
      const thinking = summary
        .map((part) => isRecord(part) ? stringValue(part.text) : '')
        .filter(Boolean)
        .join('\n');
      if (thinking) {
        content.push(compactJsonObject({
          type: 'thinking',
          thinking,
          signature: stringValue(item.signature) || undefined,
        }));
      }
      continue;
    }
    if (item.type === 'message' && Array.isArray(item.content)) {
      const text = item.content
        .map((part) => isRecord(part) ? stringValue(part.text) : '')
        .filter(Boolean)
        .join('\n');
      if (text) content.push({ type: 'text', text });
      continue;
    }
    if (item.type === 'function_call') {
      content.push({
        type: 'tool_use',
        id: stringValue(item.call_id) || stringValue(item.id) || makeId('toolu'),
        name: stringValue(item.name),
        input: parseJsonObject(stringValue(item.arguments)) ?? {},
      });
    }
  }
  return content;
}

function anthropicUsageFromResponse(response: JsonObject, fallbackText: string): JsonObject {
  const usage = isRecord(response.usage) ? response.usage : {};
  const inputTokens = numberValue(usage.input_tokens) || numberValue(usage.prompt_tokens);
  const outputTokens = numberValue(usage.output_tokens) || numberValue(usage.completion_tokens);
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens || estimateTokenCount(fallbackText),
    cache_creation_input_tokens: numberValue(usage.cache_creation_input_tokens),
    cache_read_input_tokens: numberValue(usage.cache_read_input_tokens) || numberValue(usage.cached_input_tokens),
  };
}

function parseJsonObject(raw: string): JsonObject | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? compactJsonObject(parsed) : null;
  } catch {
    return null;
  }
}

function stringifyJsonValue(value: unknown): string | undefined {
  const normalized = jsonValue(value);
  return normalized === undefined ? undefined : JSON.stringify(normalized);
}

function estimateTokenCount(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function responseInputItemToMessage(
  item: unknown,
  aliasByOriginal: Map<string, string>,
): JsonObject | null {
  if (!isRecord(item)) return null;
  if (item.type === 'function_call') {
    const toolCall = responseInputFunctionCallToChatToolCall(item, aliasByOriginal);
    if (!toolCall) return null;
    return compactJsonObject({
      role: 'assistant',
      content: null,
      reasoning_content: toolCall.reasoningContent || undefined,
      tool_calls: [toolCall.toolCall],
    });
  }
  if (item.type === 'function_call_output') {
    const callId = stringValue(item.call_id) || stringValue(item.id);
    if (!callId) return null;
    return {
      role: 'tool',
      tool_call_id: callId,
      content: functionCallOutputText(item.output),
    };
  }
  const role = chatRoleFromResponseRole(stringValue(item.role));
  const content = Array.isArray(item.content)
    ? chatContentFromResponseParts(item.content)
    : stringValue(item.content) || '';
  return compactJsonObject({
    role,
    content,
    reasoning_content: role === 'assistant' ? stringValue(item.reasoning_content) || undefined : undefined,
  });
}

function responseInputFunctionCallToChatToolCall(
  item: Record<string, unknown>,
  aliasByOriginal: Map<string, string>,
): { toolCall: JsonObject; reasoningContent: string } | null {
  const name = stringValue(item.name);
  const callId = stringValue(item.call_id) || stringValue(item.id);
  if (!name || !callId) return null;
  return {
    toolCall: {
      id: callId,
      type: 'function',
      function: {
        name: aliasByOriginal.get(name) ?? name,
        arguments: stringValue(item.arguments) || '{}',
      },
    },
    reasoningContent: stringValue(item.reasoning_content),
  };
}

function chatRoleFromResponseRole(role: string): string {
  if (role === 'assistant' || role === 'tool' || role === 'system' || role === 'user') return role;
  if (role === 'developer') return 'system';
  return 'user';
}

function chatContentFromResponseParts(parts: unknown[]): JsonValue {
  const chatParts = parts.map(responseContentPartToChatPart).filter((part): part is JsonObject => Boolean(part));
  if (!chatParts.some((part) => part.type === 'image_url')) {
    if (!chatParts.every((part) => part.type === 'text')) return chatParts;
    return chatParts
      .map((part) => stringValue(part.text) || stringValue(part.content))
      .filter(Boolean)
      .join('\n');
  }
  return chatParts;
}

function functionCallOutputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (typeof entry === 'string') return entry;
      if (!isRecord(entry)) return '';
      return stringValue(entry.text) || stringValue(entry.output) || stringValue(entry.content);
    }).filter(Boolean).join('\n');
  }
  const normalized = jsonValue(value);
  return normalized === undefined ? '' : JSON.stringify(normalized);
}

function responseContentPartToChatPart(part: unknown): JsonObject | null {
  if (!isRecord(part)) return null;
  if (part.type === 'input_text' || part.type === 'output_text') {
    return {
      type: 'text',
      text: stringValue(part.text) || '',
    };
  }
  if (part.type === 'input_audio') {
    const inputAudio = isRecord(part.input_audio) ? jsonObjectValue(part.input_audio) : undefined;
    return {
      type: 'input_audio',
      input_audio: inputAudio ?? { data: stringValue(part.data) || '' },
    };
  }
  if (part.type === 'input_image') {
    const imageUrl = stringValue(part.image_url) || stringValue(part.url);
    if (!imageUrl) return null;
    return {
      type: 'image_url',
      image_url: { url: imageUrl },
    };
  }
  return jsonObjectValue(part);
}

function responsesToolsToChatTools(
  tools: unknown,
  aliases: Record<string, string>,
): JsonValue[] | undefined {
  const aliasByOriginal = new Map(Object.entries(aliases).map(([alias, original]) => [original, alias]));
  const chatTools = responseToolDescriptors(tools)
    .map((tool) => responseToolToChatTool(tool, aliasByOriginal))
    .filter(Boolean);
  return chatTools.length > 0 ? chatTools as JsonValue[] : undefined;
}

function responseToolToChatTool(tool: ResponseToolDescriptor, aliasByOriginal: Map<string, string>): JsonObject | null {
  return {
    type: 'function',
    function: compactJsonObject({
      name: aliasByOriginal.get(tool.responseName) ?? tool.responseName,
      description: boundedProviderToolString(tool.description) || undefined,
      parameters: providerSafeChatToolParameters(tool.parameters),
    }),
  };
}

function responseToolDescriptors(tools: unknown): ResponseToolDescriptor[] {
  if (!Array.isArray(tools)) return [];
  return tools.flatMap(responseToolDescriptorsFromTool);
}

function responseToolDescriptorsFromTool(tool: unknown): ResponseToolDescriptor[] {
  if (!isRecord(tool)) return [];

  const namespace = nonEmptyString(tool.namespace);
  const directName = responseToolDeclaredName(tool);
  if (namespace && directName && tool.type !== 'namespace') {
    return [{
      responseName: `${namespace}.${directName}`,
      description: responseToolDescription(tool),
      parameters: responseToolParameters(tool),
    }];
  }

  if (tool.type === 'namespace') {
    const namespaceName = nonEmptyString(tool.name) || namespace;
    if (!namespaceName || !Array.isArray(tool.tools)) return [];
    return tool.tools.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const name = responseToolDeclaredName(entry);
      if (!name) return [];
      return [{
        responseName: `${namespaceName}.${name}`,
        description: responseToolDescription(entry) || responseToolDescription(tool),
        parameters: responseToolParameters(entry),
      }];
    });
  }

  if (tool.type !== 'function') return [];
  const name = responseToolDeclaredName(tool);
  if (!name) return [];
  return [{
    responseName: name,
    description: responseToolDescription(tool),
    parameters: responseToolParameters(tool),
  }];
}

function responseToolDeclaredName(tool: Record<string, unknown>): string {
  const direct = nonEmptyString(tool.name);
  if (direct) return direct;
  return isRecord(tool.function) ? nonEmptyString(tool.function.name) : '';
}

function responseToolDescription(tool: Record<string, unknown>): string {
  const direct = stringValue(tool.description).trim();
  if (direct) return direct;
  return isRecord(tool.function) ? stringValue(tool.function.description).trim() : '';
}

function responseToolParameters(tool: Record<string, unknown>): unknown {
  if (tool.parameters !== undefined) return tool.parameters;
  if (tool.inputSchema !== undefined) return tool.inputSchema;
  if (tool.input_schema !== undefined) return tool.input_schema;
  if (!isRecord(tool.function)) return {};
  if (tool.function.parameters !== undefined) return tool.function.parameters;
  if (tool.function.inputSchema !== undefined) return tool.function.inputSchema;
  if (tool.function.input_schema !== undefined) return tool.function.input_schema;
  return {};
}

function responseToolChoiceToChatToolChoice(
  toolChoice: unknown,
  aliases: Record<string, string>,
): unknown {
  const aliasByOriginal = new Map(Object.entries(aliases).map(([alias, original]) => [original, alias]));
  if (aliasByOriginal.size === 0) return toolChoice;
  if (typeof toolChoice === 'string') return aliasByOriginal.get(toolChoice) ?? toolChoice;
  if (!isRecord(toolChoice)) return toolChoice;

  const directName = nonEmptyString(toolChoice.name);
  if (directName) {
    const alias = aliasByOriginal.get(directName);
    if (alias) return { ...toolChoice, name: alias };
  }

  if (isRecord(toolChoice.function)) {
    const functionName = nonEmptyString(toolChoice.function.name);
    const alias = functionName ? aliasByOriginal.get(functionName) : undefined;
    if (alias) {
      return {
        ...toolChoice,
        function: {
          ...toolChoice.function,
          name: alias,
        },
      };
    }
  }

  return toolChoice;
}

function providerSafeChatToolParameters(value: unknown): JsonObject {
  const sanitized = normalizeProviderJsonSchema(value);
  if (isRecord(sanitized)) {
    const schemaTypes = typeof sanitized.type === 'string'
      ? [sanitized.type]
      : Array.isArray(sanitized.type)
        ? sanitized.type
        : [];
    if (schemaTypes.length > 0 && !schemaTypes.includes('object')) {
      throw new RangeError('Provider tool parameters must use an object root schema.');
    }
    if (sanitized.properties !== undefined && !isRecord(sanitized.properties)) {
      throw new RangeError('Provider tool parameter properties must be a schema map.');
    }
    return compactJsonObject({
      ...sanitized,
      type: sanitized.type ?? 'object',
      properties: sanitized.properties ?? {},
    });
  }
  if (sanitized === false) {
    throw new RangeError('Provider tool parameters cannot be represented by an always-false root schema.');
  }
  if (sanitized === true) return { type: 'object', properties: {} };
  throw new RangeError('Provider tool parameters must be a JSON Schema object or boolean.');
}

function boundedProviderToolString(
  value: string,
  maxLength = PROVIDER_TOOL_SCHEMA_MAX_STRING_CHARS,
): string {
  return value.trim().slice(0, maxLength);
}

function chatToolNameAlias(name: string, index: number, used: Set<string>): string {
  const base = name
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 56) || `tool_${index + 1}`;
  let candidate = /^[A-Za-z0-9_-]{1,64}$/.test(name) ? name : base;
  let suffix = 2;
  while (used.has(candidate)) {
    const room = Math.max(1, 64 - String(suffix).length - 1);
    candidate = `${base.slice(0, room)}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function chatToolCallToResponseItem(
  toolCall: unknown,
  toolNameAliases: Record<string, string>,
  reasoningContent = '',
): JsonObject {
  const record = isRecord(toolCall) ? toolCall : {};
  const fn = isRecord(record.function) ? record.function : {};
  const chatName = stringValue(fn.name) || stringValue(record.name) || '';
  return compactJsonObject({
    id: makeId('fc'),
    type: 'function_call',
    status: 'completed',
    call_id: stringValue(record.id) || makeId('call'),
    name: toolNameAliases[chatName] ?? chatName,
    arguments: stringValue(fn.arguments) || stringValue(record.arguments) || '',
    reasoning_content: reasoningContent || undefined,
  });
}

function firstChoiceMessage(completion: Record<string, unknown>): Record<string, unknown> {
  const choices = Array.isArray(completion.choices) ? completion.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : {};
  return isRecord(firstChoice.message) ? firstChoice.message : {};
}

function responseTextFromMessage(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!isRecord(part)) return '';
      return stringValue(part.text) || stringValue(part.content);
    })
    .filter(Boolean)
    .join('\n');
}

function messageReasoningContent(message: Record<string, unknown>): string {
  const direct = stringValue(message.reasoning_content);
  if (direct) return direct;
  if (isRecord(message.reasoning)) {
    return stringValue(message.reasoning.content) || stringValue(message.reasoning.text);
  }
  return '';
}

function chatMessageToAnthropicContent(message: Record<string, unknown>): JsonValue[] {
  const content: JsonValue[] = [];
  const reasoning = messageReasoningContent(message);
  if (reasoning) content.push({ type: 'thinking', thinking: reasoning, signature: '' });
  const rawContent = message.content;
  if (typeof rawContent === 'string') {
    if (rawContent) content.push({ type: 'text', text: rawContent });
  } else if (Array.isArray(rawContent)) {
    for (const part of rawContent) {
      if (!isRecord(part)) continue;
      const type = stringValue(part.type);
      if (type === 'text' || type === 'input_text') {
        content.push({ type: 'text', text: stringValue(part.text) });
      } else if (type === 'image_url' || type === 'input_image') {
        const imageUrl = isRecord(part.image_url)
          ? stringValue(part.image_url.url)
          : stringValue(part.image_url);
        const image = imageUrlToAnthropicSource(imageUrl);
        if (image) content.push({ type: 'image', source: image });
      }
    }
  }
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const value of toolCalls) {
    if (!isRecord(value)) continue;
    const fn = isRecord(value.function) ? value.function : {};
    content.push({
      type: 'tool_use',
      id: stringValue(value.id) || makeId('toolu'),
      name: stringValue(fn.name),
      input: parseJsonObject(stringValue(fn.arguments)) ?? {},
    });
  }
  return content.length > 0 ? content : [{ type: 'text', text: '' }];
}

function imageUrlToAnthropicSource(value: string): JsonObject | undefined {
  const data = /^data:([^;,]+);base64,(.+)$/i.exec(value);
  if (data) return { type: 'base64', media_type: data[1], data: data[2] };
  if (/^https?:\/\//i.test(value)) return { type: 'url', url: value };
  return undefined;
}

function chatContentToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => isRecord(part) ? stringValue(part.text) || stringValue(part.content) : '')
    .filter(Boolean)
    .join('\n');
}

function chatToolsToAnthropicTools(value: unknown): JsonValue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tools = value.flatMap((item): JsonObject[] => {
    if (!isRecord(item)) return [];
    const fn = isRecord(item.function) ? item.function : {};
    const name = stringValue(fn.name);
    if (!name) return [];
    return [compactJsonObject({
      name,
      description: fn.description,
      input_schema: isRecord(fn.parameters) ? fn.parameters : { type: 'object', properties: {} },
    })];
  });
  return tools.length > 0 ? tools : undefined;
}

function chatToolChoiceToAnthropicToolChoice(value: unknown, parallelToolCalls: unknown): JsonObject | undefined {
  const disableParallel = parallelToolCalls === false ? true : undefined;
  if (value === undefined || value === 'auto') {
    return disableParallel ? { type: 'auto', disable_parallel_tool_use: true } : undefined;
  }
  if (value === 'required') return compactJsonObject({ type: 'any', disable_parallel_tool_use: disableParallel });
  if (!isRecord(value)) return undefined;
  const fn = isRecord(value.function) ? value.function : {};
  const name = stringValue(fn.name);
  return name ? compactJsonObject({ type: 'tool', name, disable_parallel_tool_use: disableParallel }) : undefined;
}

function canonicalUsageFromChatCompletion(completion: Record<string, unknown>): JsonObject {
  const usage = isRecord(completion.usage) ? completion.usage : {};
  const inputTokens = numberValue(usage.input_tokens) || numberValue(usage.prompt_tokens);
  const outputTokens = numberValue(usage.output_tokens) || numberValue(usage.completion_tokens);
  const inputDetails = isRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const outputDetails = isRecord(usage.output_tokens_details)
    ? usage.output_tokens_details
    : isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : {};
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: numberValue(usage.total_tokens) || inputTokens + outputTokens,
    input_tokens_details: { cached_tokens: numberValue(inputDetails.cached_tokens) },
    output_tokens_details: { reasoning_tokens: numberValue(outputDetails.reasoning_tokens) },
  };
}

function canonicalUsageFromAnthropicMessage(message: Record<string, unknown>): JsonObject {
  const usage = isRecord(message.usage) ? message.usage : {};
  const inputTokens = numberValue(usage.input_tokens);
  const outputTokens = numberValue(usage.output_tokens);
  const cachedTokens = numberValue(usage.cache_read_input_tokens);
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    input_tokens_details: { cached_tokens: cachedTokens },
    output_tokens_details: { reasoning_tokens: 0 },
  };
}

function assertAnthropicThinkingBudget(budget: number, maxTokens: number): void {
  if (!Number.isInteger(budget) || budget < 1024) {
    throw new RangeError('Anthropic thinking budget_tokens must be an integer of at least 1024.');
  }
  if (!Number.isInteger(maxTokens) || budget >= maxTokens) {
    throw new RangeError('Anthropic thinking budget_tokens must be lower than max_tokens.');
  }
}

function compactJsonObject(values: Record<string, unknown>): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(values)) {
    const normalized = jsonValue(value);
    if (normalized !== undefined) {
      Object.defineProperty(out, key, {
        configurable: true,
        enumerable: true,
        value: normalized,
        writable: true,
      });
    }
  }
  return out;
}

function jsonObjectValue(value: Record<string, unknown>): JsonObject {
  return compactJsonObject(value);
}

function jsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.map(jsonValue).filter((item): item is JsonValue => item !== undefined);
  if (isRecord(value)) return compactJsonObject(value);
  return undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
