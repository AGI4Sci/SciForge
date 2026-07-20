import type { JsonObject, JsonValue, ResponsesRequest } from './response-compat';

export type ProviderFamily =
  | 'anthropic'
  | 'deepseek'
  | 'gemini'
  | 'generic'
  | 'minimax'
  | 'moonshot'
  | 'openai'
  | 'qwen'
  | 'zhipu';

export type ProviderWireProtocol = 'responses' | 'chat-completions' | 'anthropic-messages';

type SchemaPatternPolicy = 'omit' | 'portable';
const PROVIDER_SCHEMA_MAX_DEPTH = 16;
const PROVIDER_SCHEMA_MAX_NODES = 5_000;
const PROVIDER_JSON_MAX_DEPTH = 64;
const PROVIDER_JSON_MAX_NODES = 20_000;
const SCHEMA_MAP_KEYWORDS = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
]);
const SCHEMA_ARRAY_KEYWORDS = new Set([
  'allOf',
  'anyOf',
  'oneOf',
  'prefixItems',
]);
const SCHEMA_SINGLE_KEYWORDS = new Set([
  'additionalProperties',
  'contains',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
]);

type TraversalBudget = {
  nodes: number;
  seen: WeakSet<object>;
};

export type ProviderCompatibilityProfile = {
  family: ProviderFamily;
  preferredProtocol: ProviderWireProtocol;
  allowedProtocols: readonly ProviderWireProtocol[];
  preserveChatReasoningContent: boolean;
  chatMaxTokensField: 'max_tokens' | 'max_completion_tokens';
  schemaPatternPolicy: SchemaPatternPolicy;
};

/**
 * Resolve the provider dialect from both the configured endpoint and model.
 * Official endpoint identity takes precedence. Otherwise model detection lets
 * an OpenAI-compatible gateway host several vendors behind one generic URL.
 */
export function resolveProviderCompatibility(
  baseUrl: string,
  model: string,
): ProviderCompatibilityProfile {
  const family = providerFamily(baseUrl, model);
  return {
    family,
    preferredProtocol: preferredProtocol(family, baseUrl, model),
    allowedProtocols: allowedProtocols(family, baseUrl),
    preserveChatReasoningContent: (
      family === 'deepseek'
      || family === 'minimax'
      || family === 'moonshot'
      || family === 'qwen'
      || family === 'zhipu'
      || family === 'generic'
    ),
    chatMaxTokensField: family === 'minimax' || family === 'moonshot' || family === 'openai'
      ? 'max_completion_tokens'
      : 'max_tokens',
    // Moonshot's MFJS dialect does not currently implement `pattern`.
    // Other providers keep portable regular expressions but reject constructs
    // such as lookaround and backreferences that are not broadly supported.
    schemaPatternPolicy: family === 'moonshot' ? 'omit' : 'portable',
  };
}

export function preferredProviderProtocol(baseUrl: string, model: string): ProviderWireProtocol {
  return resolveProviderCompatibility(baseUrl, model).preferredProtocol;
}

/**
 * Convert the canonical request into standards-compliant Responses input.
 * `reasoning_content` is a Chat-compatible vendor extension, not a Responses
 * message or function-call field. Opaque Responses reasoning items are kept.
 */
export function normalizeProviderResponsesRequest(
  request: ResponsesRequest,
  profile: ProviderCompatibilityProfile,
): ResponsesRequest {
  const normalized = { ...request };
  if (Array.isArray(request.input)) {
    normalized.input = request.input.map(stripLegacyReasoningContent);
  }
  if (request.tools !== undefined) {
    const tools = normalizeProviderTools(request.tools, profile.schemaPatternPolicy);
    if (tools !== undefined) normalized.tools = tools;
  }

  delete (normalized as Record<string, unknown>).reasoning_content;
  const legacyEffort = nonEmptyString(request.reasoning_effort);
  if (legacyEffort) {
    const reasoning = isRecord(request.reasoning) ? { ...request.reasoning } : {};
    if (!nonEmptyString(reasoning.effort)) reasoning.effort = legacyEffort;
    normalized.reasoning = reasoning;
  }
  delete normalized.reasoning_effort;
  return normalized;
}

/**
 * Apply the selected provider's Chat Completions dialect after the canonical
 * Responses-to-Chat envelope conversion has run.
 */
export function normalizeProviderChatCompletionsBody(
  body: JsonObject,
  profile: ProviderCompatibilityProfile,
): JsonObject {
  const normalized: Record<string, JsonValue> = { ...body };
  if (Array.isArray(body.messages)) {
    normalized.messages = body.messages.map((message) => (
      profile.preserveChatReasoningContent
        ? jsonValue(message) ?? null
        : stripLegacyReasoningContent(message)
    ));
  }
  if (body.tools !== undefined) {
    const tools = normalizeProviderTools(body.tools, profile.schemaPatternPolicy);
    if (tools !== undefined) normalized.tools = tools;
  }
  if (profile.chatMaxTokensField === 'max_completion_tokens' && body.max_tokens !== undefined) {
    normalized.max_completion_tokens = body.max_tokens;
    delete normalized.max_tokens;
  }
  return normalized;
}

export function normalizeProviderTools(
  tools: unknown,
  patternPolicy: SchemaPatternPolicy = 'portable',
): JsonValue | undefined {
  if (!Array.isArray(tools)) return jsonValue(tools);
  return tools.map((tool) => normalizeToolDefinition(tool, patternPolicy));
}

export function normalizeProviderJsonSchema(
  schema: unknown,
  patternPolicy: SchemaPatternPolicy = 'portable',
): JsonValue | undefined {
  return normalizeProviderJsonSchemaAtDepth(
    schema,
    patternPolicy,
    0,
    { nodes: 0, seen: new WeakSet<object>() },
  );
}

function normalizeProviderJsonSchemaAtDepth(
  schema: unknown,
  patternPolicy: SchemaPatternPolicy,
  depth: number,
  budget: TraversalBudget,
): JsonValue | undefined {
  if (depth > PROVIDER_SCHEMA_MAX_DEPTH) {
    throw new RangeError(`Provider tool JSON Schema exceeds the maximum depth of ${PROVIDER_SCHEMA_MAX_DEPTH}.`);
  }
  if (Array.isArray(schema)) {
    enterTraversalNode(schema, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
    return schema.map((item) => normalizeProviderJsonSchemaAtDepth(item, patternPolicy, depth + 1, budget) ?? null);
  }
  if (!isRecord(schema)) return jsonValue(schema);
  enterTraversalNode(schema, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');

  const normalized: Record<string, JsonValue> = {};
  let removedPattern = false;
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'required') continue;
    if (key === 'pattern' && typeof value === 'string') {
      if (patternPolicy === 'omit' || hasNonPortableRegexFeature(value)) {
        removedPattern = true;
        continue;
      }
    }
    let entry: JsonValue | undefined;
    if (SCHEMA_MAP_KEYWORDS.has(key) && isRecord(value)) {
      entry = normalizeSchemaMap(value, patternPolicy, depth + 1, budget);
    } else if (SCHEMA_ARRAY_KEYWORDS.has(key) && Array.isArray(value)) {
      entry = normalizeSchemaArray(value, patternPolicy, depth + 1, budget);
    } else if (SCHEMA_SINGLE_KEYWORDS.has(key)) {
      if (key === 'items' && Array.isArray(value)) {
        entry = normalizeSchemaArray(value, patternPolicy, depth + 1, budget);
      } else if (typeof value === 'boolean' || isRecord(value)) {
        entry = normalizeProviderJsonSchemaAtDepth(value, patternPolicy, depth + 1, budget);
      } else {
        entry = cloneSchemaLiteral(value, depth + 1, budget);
      }
    } else {
      // Annotation and instance-value keywords such as `default`, `examples`,
      // `const`, and `enum` contain data, not nested schemas. Treating those
      // objects as schemas can silently delete business fields named
      // `required` or rewrite strings named `pattern`.
      entry = cloneSchemaLiteral(value, depth + 1, budget);
    }
    if (entry !== undefined) defineJsonProperty(normalized, key, entry);
  }

  if (Array.isArray(schema.required)) {
    const properties = isRecord(schema.properties) ? new Set(Object.keys(schema.properties)) : undefined;
    const required = schema.required
      .filter((item): item is string => typeof item === 'string')
      .filter((item) => properties ? properties.has(item) : patternPolicy !== 'omit');
    if (required.length > 0) normalized.required = [...new Set(required)];
  }

  if (removedPattern) {
    const description = nonEmptyString(normalized.description);
    const note = 'Additional input validation is enforced by SciForge when this tool executes.';
    normalized.description = description ? `${description} ${note}` : note;
  }
  return normalized;
}

function normalizeSchemaMap(
  value: Record<string, unknown>,
  patternPolicy: SchemaPatternPolicy,
  depth: number,
  budget: TraversalBudget,
): JsonObject {
  assertSchemaTraversalDepth(depth);
  enterTraversalNode(value, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
  const normalized: Record<string, JsonValue> = {};
  for (const [key, schema] of Object.entries(value)) {
    const entry = normalizeProviderJsonSchemaAtDepth(schema, patternPolicy, depth + 1, budget);
    if (entry !== undefined) defineJsonProperty(normalized, key, entry);
  }
  return normalized;
}

function normalizeSchemaArray(
  value: unknown[],
  patternPolicy: SchemaPatternPolicy,
  depth: number,
  budget: TraversalBudget,
): JsonValue[] {
  assertSchemaTraversalDepth(depth);
  enterTraversalNode(value, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
  return value.map((schema) => (
    normalizeProviderJsonSchemaAtDepth(schema, patternPolicy, depth + 1, budget) ?? null
  ));
}

function cloneSchemaLiteral(
  value: unknown,
  depth: number,
  budget: TraversalBudget,
): JsonValue | undefined {
  assertSchemaTraversalDepth(depth);
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    enterTraversalNode(value, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
    return value.map((entry) => cloneSchemaLiteral(entry, depth + 1, budget) ?? null);
  }
  if (!isRecord(value)) return undefined;
  enterTraversalNode(value, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
  const normalized: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const json = cloneSchemaLiteral(entry, depth + 1, budget);
    if (json !== undefined) defineJsonProperty(normalized, key, json);
  }
  return normalized;
}

function assertSchemaTraversalDepth(depth: number): void {
  if (depth > PROVIDER_SCHEMA_MAX_DEPTH) {
    throw new RangeError(`Provider tool JSON Schema exceeds the maximum depth of ${PROVIDER_SCHEMA_MAX_DEPTH}.`);
  }
}

function providerFamily(baseUrl: string, model: string): ProviderFamily {
  const modelId = model.trim().toLowerCase();
  const hostname = providerHostname(baseUrl);

  if (matchesHostname(hostname, 'api.openai.com')) return 'openai';
  if (matchesHostname(hostname, 'api.anthropic.com')) return 'anthropic';
  if (matchesHostname(hostname, 'api.deepseek.com')) return 'deepseek';
  if (matchesHostname(hostname, 'api.moonshot.cn') || matchesHostname(hostname, 'api.moonshot.ai')) return 'moonshot';
  if (matchesHostname(hostname, 'bigmodel.cn') || matchesHostname(hostname, 'z.ai')) return 'zhipu';
  if (matchesHostname(hostname, 'dashscope.aliyuncs.com') || matchesHostname(hostname, 'maas.aliyuncs.com')) return 'qwen';
  if (matchesHostname(hostname, 'api.minimax.io') || matchesHostname(hostname, 'api.minimaxi.com')) return 'minimax';
  if (matchesHostname(hostname, 'generativelanguage.googleapis.com')) return 'gemini';

  if (/(?:^|[/_.-])deepseek(?:[/_.-]|[rv]\d|$)/u.test(modelId)) return 'deepseek';
  if (/(?:^|[/_.-])(?:kimi(?:[/_.-]|k\d|$)|moonshot(?:[/_.-]|v\d|$))/u.test(modelId)) return 'moonshot';
  if (/(?:^|[/_.-])glm(?:[/_.-]|\d|$)/u.test(modelId)) return 'zhipu';
  if (/(?:^|[/_.-])qwen(?:[/_.-]|\d|$)/u.test(modelId)) return 'qwen';
  if (/(?:^|[/_.-])minimax(?:[/_.-]|m\d|$)/u.test(modelId)) return 'minimax';
  if (/(?:^|[/_.-])gemini(?:[/_.-]|\d|$)/u.test(modelId)) return 'gemini';
  if (/(?:^|[/_.-])claude(?:[/_.-]|\d|$)/u.test(modelId)) return 'anthropic';
  if (
    /(?:^|[/_.-])gpt(?:[/_.-]|\d|$)/u.test(modelId)
    || /(?:^|[/_.-])(?:o[1345](?:[/_.-]|\d|$)|chatgpt(?:[/_.-]|\d|$))/u.test(modelId)
  ) return 'openai';

  return 'generic';
}

function allowedProtocols(
  family: ProviderFamily,
  baseUrl: string,
): readonly ProviderWireProtocol[] {
  if (family === 'generic') return ['responses', 'chat-completions', 'anthropic-messages'];
  if (family === 'anthropic') {
    return matchesHostname(providerHostname(baseUrl), 'api.anthropic.com')
      ? ['anthropic-messages']
      : ['responses', 'chat-completions', 'anthropic-messages'];
  }
  return ['responses', 'chat-completions'];
}

function preferredProtocol(
  family: ProviderFamily,
  baseUrl: string,
  model: string,
): ProviderWireProtocol {
  if (family === 'anthropic' && matchesHostname(providerHostname(baseUrl), 'api.anthropic.com')) {
    return 'anthropic-messages';
  }
  if (family === 'deepseek' || family === 'moonshot' || family === 'zhipu') {
    return 'chat-completions';
  }
  if (family === 'gemini') {
    return matchesHostname(providerHostname(baseUrl), 'generativelanguage.googleapis.com')
      ? 'chat-completions'
      : 'responses';
  }
  if (family === 'minimax') {
    const officialEndpoint = (
      matchesHostname(providerHostname(baseUrl), 'api.minimax.io')
      || matchesHostname(providerHostname(baseUrl), 'api.minimaxi.com')
    );
    return officialEndpoint && /(?:^|[/_.-])minimax-m3(?:[/_.-]|$)/iu.test(model)
      ? 'responses'
      : 'chat-completions';
  }
  if (family === 'qwen') {
    return /(?:^|[/_.-])qwen3\.7(?:[/_.-]|$)/iu.test(model)
      ? 'responses'
      : 'chat-completions';
  }
  return 'responses';
}

function normalizeToolDefinition(tool: unknown, patternPolicy: SchemaPatternPolicy): JsonValue {
  if (!isRecord(tool)) return jsonValue(tool) ?? null;
  const normalized: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(tool)) {
    if (key === 'parameters' || key === 'inputSchema' || key === 'input_schema') {
      const schema = normalizeProviderJsonSchema(value, patternPolicy);
      if (schema !== undefined) normalized[key] = schema;
      continue;
    }
    if (key === 'function' && isRecord(value)) {
      normalized.function = normalizeToolDefinition(value, patternPolicy);
      continue;
    }
    if (key === 'tools' && Array.isArray(value)) {
      normalized.tools = value.map((entry) => normalizeToolDefinition(entry, patternPolicy));
      continue;
    }
    const entry = jsonValue(value);
    if (entry !== undefined) defineJsonProperty(normalized, key, entry);
  }
  return normalized;
}

function stripLegacyReasoningContent(value: unknown): JsonValue {
  if (!isRecord(value)) return jsonValue(value) ?? null;
  const normalized: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'reasoning_content') continue;
    const json = key === 'content' && Array.isArray(entry)
      ? entry.map(stripContentPartReasoningContent)
      : jsonValue(entry);
    if (json !== undefined) defineJsonProperty(normalized, key, json);
  }
  return normalized;
}

function stripContentPartReasoningContent(value: unknown): JsonValue {
  if (!isRecord(value)) return jsonValue(value) ?? null;
  const normalized: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'reasoning_content') continue;
    const json = jsonValue(entry);
    if (json !== undefined) defineJsonProperty(normalized, key, json);
  }
  return normalized;
}

function hasNonPortableRegexFeature(pattern: string): boolean {
  try {
    new RegExp(pattern, 'u');
  } catch {
    return true;
  }

  let inCharacterClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '\\') {
      let slashCount = 1;
      while (pattern[index + slashCount] === '\\') slashCount += 1;
      const escaped = pattern[index + slashCount] ?? '';
      if (
        !inCharacterClass
        && slashCount % 2 === 1
        && (
          /[1-9]/u.test(escaped)
          || (
            (escaped === 'k' || escaped === 'g')
            && /[<{'"]/u.test(pattern[index + slashCount + 1] ?? '')
          )
        )
      ) {
        return true;
      }
      index += slashCount % 2 === 1 ? slashCount : slashCount - 1;
      continue;
    }
    if (character === '[' && !inCharacterClass) {
      inCharacterClass = true;
      continue;
    }
    if (character === ']' && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (inCharacterClass || character !== '(' || pattern[index + 1] !== '?') continue;
    const marker = pattern.slice(index + 2, index + 4);
    if (
      marker.startsWith('=')
      || marker.startsWith('!')
      || marker === '<='
      || marker === '<!'
      || marker.startsWith('>')
      || marker.startsWith('(')
      || marker.startsWith('R')
      || marker.startsWith('0')
      || marker.startsWith('&')
      || marker === 'P='
      || marker.startsWith('|')
    ) {
      return true;
    }
  }
  return inCharacterClass;
}

function providerHostname(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function matchesHostname(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function defineJsonProperty(target: Record<string, JsonValue>, key: string, value: JsonValue): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function jsonValue(value: unknown): JsonValue | undefined {
  return jsonValueAtDepth(
    value,
    0,
    { nodes: 0, seen: new WeakSet<object>() },
  );
}

function jsonValueAtDepth(
  value: unknown,
  depth: number,
  budget: TraversalBudget,
): JsonValue | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (depth > PROVIDER_JSON_MAX_DEPTH) {
    throw new RangeError(`Provider JSON value exceeds the maximum depth of ${PROVIDER_JSON_MAX_DEPTH}.`);
  }
  if (Array.isArray(value)) {
    enterTraversalNode(value, budget, PROVIDER_JSON_MAX_NODES, 'Provider JSON value');
    return value.map((entry) => jsonValueAtDepth(entry, depth + 1, budget) ?? null);
  }
  if (!isRecord(value)) return undefined;
  enterTraversalNode(value, budget, PROVIDER_JSON_MAX_NODES, 'Provider JSON value');
  const normalized: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const json = jsonValueAtDepth(entry, depth + 1, budget);
    if (json !== undefined) defineJsonProperty(normalized, key, json);
  }
  return normalized;
}

function enterTraversalNode(
  value: object,
  budget: TraversalBudget,
  maxNodes: number,
  label: string,
): void {
  if (budget.seen.has(value)) {
    throw new RangeError(`${label} must be an acyclic JSON tree.`);
  }
  budget.seen.add(value);
  budget.nodes += 1;
  if (budget.nodes > maxNodes) {
    throw new RangeError(`${label} exceeds the maximum node count of ${maxNodes}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
