import { createHash } from 'node:crypto';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface ResponsesRequest {
  model?: string;
  input?: unknown;
  instructions?: unknown;
  stream?: unknown;
  tools?: unknown;
  tool_choice?: unknown;
  temperature?: unknown;
  top_p?: unknown;
  max_output_tokens?: unknown;
  max_tokens?: unknown;
  parallel_tool_calls?: unknown;
  metadata?: unknown;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  tools?: unknown;
  tool_choice?: unknown;
  temperature?: unknown;
  top_p?: unknown;
  max_tokens?: unknown;
  parallel_tool_calls?: unknown;
  metadata?: unknown;
}

export type ChatToolNameAliasMap = Record<string, string>;

export interface CodexResponsesProxyOptions {
  defaultModel?: string;
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
};

export type ChatToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export function responsesToChatCompletions(
  value: unknown,
  options: CodexResponsesProxyOptions = {},
): ChatCompletionRequest {
  const request = asRecord(value);
  const model = upstreamModelForResponsesRequest(stringOrUndefined(request.model), options.defaultModel);
  if (!model) {
    throw new Error('Responses request must include model or proxy defaultModel');
  }

  const messages: ChatMessage[] = [];
  const instructions = textFromContent(request.instructions);
  if (instructions) {
    messages.push({ role: 'system', content: instructions });
  }
  messages.push(...inputToMessages(request.input));
  if (messages.length === 0) {
    messages.push({ role: 'user', content: '' });
  }

  const chatRequest: ChatCompletionRequest = {
    model,
    messages,
  };
  if (request.stream === true) chatRequest.stream = true;
  const chatTools = toolsToChatTools(request.tools);
  const toolNameAliases = dynamicToolAliasPairs(request.tools);
  if (chatTools) chatRequest.tools = chatTools;
  if (request.tool_choice !== undefined) chatRequest.tool_choice = toolChoiceToChatToolChoice(request.tool_choice, toolNameAliases);
  if (request.temperature !== undefined) chatRequest.temperature = request.temperature;
  if (request.top_p !== undefined) chatRequest.top_p = request.top_p;
  if (request.max_output_tokens !== undefined || request.max_tokens !== undefined) {
    chatRequest.max_tokens = request.max_output_tokens ?? request.max_tokens;
  }
  if (request.parallel_tool_calls !== undefined) chatRequest.parallel_tool_calls = request.parallel_tool_calls;
  if (request.metadata !== undefined) chatRequest.metadata = request.metadata;
  return chatRequest;
}

function upstreamModelForResponsesRequest(model: string | undefined, defaultModel: string | undefined): string | undefined {
  if (!model) return defaultModel;
  if (defaultModel && isSciForgePublicRouterAlias(model)) return defaultModel;
  return model;
}

function isSciForgePublicRouterAlias(model: string): boolean {
  return model === 'sciforge-router' || model.startsWith('sciforge-router-');
}

export function chatCompletionToResponse(
  value: unknown,
  request: Pick<ResponsesRequest, 'model'> = {},
  toolNameAliases: ChatToolNameAliasMap = {},
): JsonObject {
  const completion = asRecord(value);
  const choice = firstRecord(completion.choices);
  const message = asRecord(choice.message);
  const text = textFromContent(message.content);
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.map((toolCall) => chatToolCallToResponseItem(toolCall, toolNameAliases)).filter(isRecord)
    : [];

  const output: JsonObject[] = [];
  if (text) output.push(messageOutputItem(text));
  output.push(...toolCalls);

  const model = responseModelForCompletion(completion.model, request.model);
  return compactObject({
    id: stringOrUndefined(completion.id) ?? makeId('resp'),
    object: 'response',
    created_at: numberOrUndefined(completion.created) ?? Math.floor(Date.now() / 1000),
    model,
    status: 'completed',
    output,
    output_text: text,
    usage: completion.usage,
  });
}

function responseModelForCompletion(completionModel: unknown, requestModel: unknown): string {
  const requestedModel = stringOrUndefined(requestModel);
  if (requestedModel && isSciForgePublicRouterAlias(requestedModel)) return requestedModel;
  return stringOrUndefined(completionModel) ?? requestedModel ?? 'unknown';
}

export function messageOutputItem(text: string, id = makeId('msg')): JsonObject {
  return {
    id,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [
      {
        type: 'output_text',
        text,
        annotations: [],
      },
    ],
  };
}

export function functionCallOutputItem(call: ChatToolCall, id = makeId('fc')): JsonObject {
  return {
    id,
    type: 'function_call',
    status: 'completed',
    call_id: call.id,
    name: call.function.name,
    arguments: call.function.arguments,
  };
}

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function providerSafeProxyErrorMessage(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  if (containsProviderUnsafeDetail(text)) {
    return 'Provider proxy error. Private provider details were suppressed.';
  }
  return text.trim().slice(0, 500) || 'Provider proxy error.';
}

function inputToMessages(input: unknown): ChatMessage[] {
  if (input === undefined || input === null) return [];
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  if (!Array.isArray(input)) return [{ role: 'user', content: textFromContent(input) }];

  return input.flatMap((item) => {
    const record = asRecord(item);
    const type = stringOrUndefined(record.type);
    if (type === 'function_call_output') {
      return [{
        role: 'tool' as const,
        tool_call_id: stringOrUndefined(record.call_id) ?? stringOrUndefined(record.item_id) ?? stringOrUndefined(record.id) ?? makeId('call'),
        content: textFromContent(record.output ?? record.content),
      }];
    }
    if (type === 'function_call') {
      const call = responseFunctionCallToChatToolCall(record);
      return [{ role: 'assistant' as const, content: '', tool_calls: [call] }];
    }

    const role = normalizeRole(record.role);
    if (!role) return [{ role: 'user' as const, content: textFromContent(item) }];
    return [{ role, content: textFromContent(record.content ?? record.text ?? record.input) }];
  });
}

function toolsToChatTools(tools: unknown): unknown[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  const converted = tools.flatMap((tool) => {
    const record = asRecord(tool);
    if (record.type === 'function') {
      if (isRecord(record.function)) {
        return [tool];
      }
      const name = stringOrUndefined(record.name);
      if (!name) return [];
      return [{
        type: 'function',
        function: compactObject({
          name,
          description: record.description,
          parameters: record.parameters ?? record.input_schema ?? { type: 'object', properties: {} },
          strict: record.strict,
        }),
      }];
    }

    const dynamicTool = namespacedDynamicTool(record);
    if (!dynamicTool) return [];
    return [{
      type: 'function',
      function: compactObject({
        name: dynamicTool.chatName,
        description: record.description,
        parameters: record.parameters ?? record.inputSchema ?? record.input_schema ?? { type: 'object', properties: {} },
        strict: record.strict,
      }),
    }];
  });
  return converted.length ? converted : undefined;
}

export function chatToolNameAliasesFromResponsesTools(tools: unknown): ChatToolNameAliasMap {
  return Object.fromEntries(dynamicToolAliasPairs(tools).map((pair) => [pair.chatName, pair.responseName]));
}

function dynamicToolAliasPairs(tools: unknown): Array<{ chatName: string; responseName: string }> {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => namespacedDynamicTool(asRecord(tool)))
    .filter((tool): tool is NonNullable<ReturnType<typeof namespacedDynamicTool>> => Boolean(tool));
}

function namespacedDynamicTool(record: Record<string, unknown>): { chatName: string; responseName: string } | undefined {
  const namespace = stringOrUndefined(record.namespace);
  const name = stringOrUndefined(record.name);
  if (!namespace || !name) return undefined;
  const originalResponseName = `${namespace}.${name}`;
  const chatName = providerSafeFunctionName(`${namespace}__${name}`);
  const responseName = containsSensitiveProviderSlug(originalResponseName) ? chatName : originalResponseName;
  return {
    responseName,
    chatName,
  };
}

function providerSafeFunctionName(value: string): string {
  if (containsSensitiveProviderSlug(value)) {
    const fallbackName = value.split('__').at(-1) ?? 'dynamic_tool';
    const safeFallbackName = providerSafeFunctionName(fallbackName);
    return `dynamic_tool_${safeFallbackName}_${createHash('sha256').update(value).digest('hex').slice(0, 8)}`.slice(0, 64);
  }
  const safe = value.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return (safe || 'dynamic_tool').slice(0, 64);
}

function containsSensitiveProviderSlug(value: string): boolean {
  return /:\/\/|(?:^|[?&#_-])(?:api[_-]?key|authorization|bearer|secret|token|client[_-]?secret)=?/i.test(value);
}

function containsProviderUnsafeDetail(value: string): boolean {
  return containsSensitiveProviderSlug(value)
    || /\b(?:api[_-]?key|authorization|bearer|secret|token|client[_-]?secret|password|credential)\b/i.test(value)
    || /\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/.test(value);
}

function toolChoiceToChatToolChoice(value: unknown, aliases: Array<{ chatName: string; responseName: string }>): unknown {
  if (!aliases.length || !isRecord(value)) return value;
  const mapped = responseToolNameToChatToolName(value.name, aliases);
  if (mapped) return { ...value, name: mapped };
  if (isRecord(value.function)) {
    const mappedFunctionName = responseToolNameToChatToolName(value.function.name, aliases);
    if (mappedFunctionName) return { ...value, function: { ...value.function, name: mappedFunctionName } };
  }
  return value;
}

function responseToolNameToChatToolName(value: unknown, aliases: Array<{ chatName: string; responseName: string }>): string | undefined {
  const name = stringOrUndefined(value);
  if (!name) return undefined;
  return aliases.find((alias) => alias.responseName === name)?.chatName;
}

function responseFunctionCallToChatToolCall(record: Record<string, unknown>): ChatToolCall {
  return {
    id: stringOrUndefined(record.call_id) ?? stringOrUndefined(record.id) ?? makeId('call'),
    type: 'function',
    function: {
      name: stringOrUndefined(record.name) ?? 'unknown_tool',
      arguments: typeof record.arguments === 'string' ? record.arguments : JSON.stringify(record.arguments ?? {}),
    },
  };
}

function chatToolCallToResponseItem(value: unknown, toolNameAliases: ChatToolNameAliasMap): JsonObject | undefined {
  const record = asRecord(value);
  const fn = asRecord(record.function);
  const name = stringOrUndefined(fn.name);
  if (!name) return undefined;
  const responseName = toolNameAliases[name] ?? name;
  return functionCallOutputItem({
    id: stringOrUndefined(record.id) ?? makeId('call'),
    type: 'function',
    function: {
      name: responseName,
      arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
    },
  });
}

function normalizeRole(value: unknown): ChatMessage['role'] | undefined {
  if (value === 'user' || value === 'assistant' || value === 'tool') return value;
  if (value === 'system' || value === 'developer') return 'system';
  return undefined;
}

function textFromContent(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((part) => {
      const record = asRecord(part);
      if (typeof record.text === 'string') return record.text;
      if (typeof record.output_text === 'string') return record.output_text;
      if (typeof record.input_text === 'string') return record.input_text;
      if (typeof record.content === 'string') return record.content;
      return isEmptyRecord(record) ? '' : JSON.stringify(part);
    }).filter(Boolean).join('\n');
  }
  const record = asRecord(value);
  if (typeof record.text === 'string') return record.text;
  if (typeof record.content === 'string') return record.content;
  return JSON.stringify(value);
}

function firstRecord(value: unknown): Record<string, unknown> {
  return Array.isArray(value) ? asRecord(value[0]) : {};
}

function compactObject(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as JsonObject;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEmptyRecord(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 0;
}
