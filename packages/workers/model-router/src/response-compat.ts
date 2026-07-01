import { randomBytes } from 'node:crypto';

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
  parallel_tool_calls?: unknown;
  metadata?: unknown;
  asr_options?: unknown;
  reasoning?: unknown;
  reasoning_effort?: unknown;
};

type ResponseToolDescriptor = {
  responseName: string;
  description: string;
  parameters: unknown;
};

const PROVIDER_TOOL_SCHEMA_MAX_DEPTH = 8;
const PROVIDER_TOOL_SCHEMA_MAX_PROPERTIES = 80;
const PROVIDER_TOOL_SCHEMA_MAX_DESCRIPTION_CHARS = 1_000;
const PROVIDER_TOOL_SCHEMA_MAX_ENUM_VALUES = 120;
const PROVIDER_TOOL_SCHEMA_MAX_STRING_CHARS = 2_000;
const PROVIDER_TOOL_SCHEMA_KEYS = new Set([
  'type',
  'description',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
  'format',
  'nullable',
]);

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
  stream?: unknown;
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

export function reasoningOutputItem(text: string, id = makeId('rs')): JsonObject {
  return {
    id,
    type: 'reasoning',
    summary: [{
      type: 'summary_text',
      text,
    }],
  };
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
    max_tokens: request.max_tokens,
    parallel_tool_calls: request.parallel_tool_calls,
    metadata: request.metadata,
    asr_options: request.asr_options,
    reasoning: request.reasoning,
    reasoning_effort: reasoningEffort || undefined,
    include_reasoning: shouldRequestReasoningContent(request.reasoning) ? true : undefined,
  });
}

export function chatCompletionToResponse(
  payload: unknown,
  request: Pick<ResponsesRequest, 'model'> = {},
  toolNameAliases: Record<string, string> = {},
): JsonObject {
  const completion = isRecord(payload) ? payload : {};
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
  return {
    id: stringValue(completion.id) || makeId('resp'),
    object: 'response',
    created_at: numberValue(completion.created) || Math.floor(Date.now() / 1000),
    model: stringValue(request.model) || stringValue(completion.model) || '',
    status: 'completed',
    output,
    output_text: toolCalls.length > 0 ? '' : responseTextFromMessage(message),
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
    max_tokens: request.max_tokens,
    metadata: request.metadata,
  }) as ResponsesRequest;
}

export function responseToAnthropicMessage(
  response: JsonObject,
  request: Pick<AnthropicMessagesRequest, 'model'> = {},
): JsonObject {
  const output = Array.isArray(response.output) ? response.output : [];
  const content = responseOutputToAnthropicContent(output);
  const text = stringValue(response.output_text);
  const stopReason = content.some((part) => part.type === 'tool_use') ? 'tool_use' : 'end_turn';
  return {
    id: stringValue(response.id) || makeId('msg'),
    type: 'message',
    role: 'assistant',
    model: stringValue(request.model) || stringValue(response.model),
    content: content.length > 0 ? content : text ? [{ type: 'text', text }] : [],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: anthropicUsageFromResponse(response, text || JSON.stringify(content)),
  };
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
  const sanitized = sanitizeProviderToolSchema(value, 0);
  if (isRecord(sanitized)) {
    const properties = isRecord(sanitized.properties) ? sanitized.properties : {};
    return compactJsonObject({ ...sanitized, type: 'object', properties });
  }
  return { type: 'object', properties: {} };
}

function sanitizeProviderToolSchema(value: unknown, depth: number): JsonValue | undefined {
  if (depth > PROVIDER_TOOL_SCHEMA_MAX_DEPTH) return {};
  if (!isRecord(value)) return undefined;
  const out: Record<string, JsonValue> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key.startsWith('$') || !PROVIDER_TOOL_SCHEMA_KEYS.has(key)) continue;
    switch (key) {
      case 'properties': {
        const properties = isRecord(raw) ? raw : undefined;
        if (!properties) break;
        const entries = Object.entries(properties).slice(0, PROVIDER_TOOL_SCHEMA_MAX_PROPERTIES);
        out.properties = Object.fromEntries(entries.map(([name, schema]) => [
          boundedProviderToolString(name),
          sanitizeProviderToolSchema(schema, depth + 1) ?? {},
        ]));
        break;
      }
      case 'items': {
        if (Array.isArray(raw)) {
          out.items = raw
            .slice(0, PROVIDER_TOOL_SCHEMA_MAX_PROPERTIES)
            .map((item) => sanitizeProviderToolSchema(item, depth + 1) ?? {});
        } else if (isRecord(raw)) {
          out.items = sanitizeProviderToolSchema(raw, depth + 1) ?? {};
        }
        break;
      }
      case 'required': {
        const required = Array.isArray(raw)
          ? raw
            .filter((item): item is string => typeof item === 'string' && item.length > 0)
            .slice(0, PROVIDER_TOOL_SCHEMA_MAX_PROPERTIES)
            .map(boundedProviderToolString)
          : [];
        if (required.length) out.required = [...new Set(required)];
        break;
      }
      case 'enum': {
        if (Array.isArray(raw)) {
          out.enum = raw
            .filter(isJsonPrimitive)
            .slice(0, PROVIDER_TOOL_SCHEMA_MAX_ENUM_VALUES)
            .map((item) => typeof item === 'string' ? boundedProviderToolString(item) : item);
        }
        break;
      }
      case 'additionalProperties': {
        if (typeof raw === 'boolean') {
          out.additionalProperties = raw;
        } else if (isRecord(raw)) {
          out.additionalProperties = sanitizeProviderToolSchema(raw, depth + 1) ?? {};
        }
        break;
      }
      case 'type': {
        const type = providerToolSchemaType(raw);
        if (type) out.type = type;
        break;
      }
      case 'description': {
        if (typeof raw === 'string' && raw.trim()) {
          out.description = boundedProviderToolString(raw, PROVIDER_TOOL_SCHEMA_MAX_DESCRIPTION_CHARS);
        }
        break;
      }
      case 'pattern':
      case 'format': {
        if (typeof raw === 'string' && raw.trim()) out[key] = boundedProviderToolString(raw);
        break;
      }
      case 'nullable': {
        if (typeof raw === 'boolean') out.nullable = raw;
        break;
      }
      default: {
        if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw;
        break;
      }
    }
  }
  if (isRecord(out.properties) && !out.type) out.type = 'object';
  return out;
}

function providerToolSchemaType(value: unknown): JsonValue | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (!Array.isArray(value)) return undefined;
  const types = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return types.length ? [...new Set(types)] : undefined;
}

function boundedProviderToolString(
  value: string,
  maxLength = PROVIDER_TOOL_SCHEMA_MAX_STRING_CHARS,
): string {
  return value.trim().slice(0, maxLength);
}

function isJsonPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
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

function shouldRequestReasoningContent(reasoning: unknown): boolean {
  if (!isRecord(reasoning)) return false;
  return stringValue(reasoning.summary).toLowerCase() !== 'none';
}

function compactJsonObject(values: Record<string, unknown>): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(values)) {
    const normalized = jsonValue(value);
    if (normalized !== undefined) out[key] = normalized;
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
