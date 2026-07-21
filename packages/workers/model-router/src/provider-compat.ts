import type { JsonObject, JsonValue, ResponsesRequest } from './response-compat';

export type ProviderWireProtocol = 'responses' | 'chat-completions' | 'anthropic-messages';
export type ProviderSchemaPatternPolicy = 'preserve' | 'reject';

export type ProviderCompatibilityConfig = {
  preferredProtocol?: ProviderWireProtocol;
  allowedProtocols?: ProviderWireProtocol[];
  preserveResponsesReasoningContent?: boolean;
  preserveChatReasoningContent?: boolean;
  chatMaxTokensField?: 'max_tokens' | 'max_completion_tokens';
  schemaPatternPolicy?: ProviderSchemaPatternPolicy;
};

export type ProviderCompatibilityProfile = {
  preferredProtocol: ProviderWireProtocol;
  allowedProtocols: readonly ProviderWireProtocol[];
  preserveResponsesReasoningContent: boolean;
  preserveChatReasoningContent: boolean;
  chatMaxTokensField: 'max_tokens' | 'max_completion_tokens';
  schemaPatternPolicy: ProviderSchemaPatternPolicy;
};

const PROVIDER_SCHEMA_MAX_DEPTH = 16;
const PROVIDER_SCHEMA_MAX_NODES = 5_000;
const PROVIDER_SCHEMA_MAX_PROPERTIES = 256;
const PROVIDER_SCHEMA_MAX_BRANCHES = 128;
const PROVIDER_SCHEMA_MAX_ENUM_VALUES = 512;
const PROVIDER_SCHEMA_MAX_KEY_CHARS = 4_096;
const PROVIDER_JSON_MAX_DEPTH = 64;
const PROVIDER_JSON_MAX_NODES = 20_000;
const PROTOCOLS: readonly ProviderWireProtocol[] = [
  'responses',
  'chat-completions',
  'anthropic-messages',
];
const PROVIDER_COMPATIBILITY_KEYS = new Set<string>([
  'preferredProtocol',
  'allowedProtocols',
  'preserveResponsesReasoningContent',
  'preserveChatReasoningContent',
  'chatMaxTokensField',
  'schemaPatternPolicy',
]);
const SCHEMA_MAP_KEYWORDS = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
]);
const SCHEMA_MIXED_MAP_KEYWORDS = new Set(['dependencies']);
const SCHEMA_ARRAY_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SCHEMA_SINGLE_KEYWORDS = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
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

export function providerCompatibilityConfigurationIssue(
  value: ProviderCompatibilityConfig | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'compatibility settings must be an object';
  }
  const unknownKey = Object.keys(value).find((key) => !PROVIDER_COMPATIBILITY_KEYS.has(key));
  if (unknownKey) return `unknown compatibility setting "${unknownKey}"`;
  if (value.preferredProtocol !== undefined && !PROTOCOLS.includes(value.preferredProtocol)) {
    return `unknown preferred protocol "${String(value.preferredProtocol)}"`;
  }
  if (value.allowedProtocols !== undefined) {
    if (!Array.isArray(value.allowedProtocols) || value.allowedProtocols.length === 0) {
      return 'allowedProtocols must contain at least one protocol';
    }
    if (value.allowedProtocols.some((protocol) => !PROTOCOLS.includes(protocol))) {
      return 'allowedProtocols contains an unknown protocol';
    }
    if (value.preferredProtocol && !value.allowedProtocols.includes(value.preferredProtocol)) {
      return 'preferredProtocol must be present in allowedProtocols';
    }
  }
  if (
    value.chatMaxTokensField !== undefined
    && value.chatMaxTokensField !== 'max_tokens'
    && value.chatMaxTokensField !== 'max_completion_tokens'
  ) {
    return 'chatMaxTokensField is invalid';
  }
  if (
    value.preserveResponsesReasoningContent !== undefined
    && typeof value.preserveResponsesReasoningContent !== 'boolean'
  ) {
    return 'preserveResponsesReasoningContent must be a boolean';
  }
  if (
    value.preserveChatReasoningContent !== undefined
    && typeof value.preserveChatReasoningContent !== 'boolean'
  ) {
    return 'preserveChatReasoningContent must be a boolean';
  }
  if (
    value.schemaPatternPolicy !== undefined
    && value.schemaPatternPolicy !== 'preserve'
    && value.schemaPatternPolicy !== 'reject'
  ) {
    return 'schemaPatternPolicy is invalid';
  }
  return undefined;
}

export function resolveProviderCompatibility(
  configured?: ProviderCompatibilityConfig,
  requestedProtocol: ProviderWireProtocol = 'responses',
): ProviderCompatibilityProfile {
  const issue = providerCompatibilityConfigurationIssue(configured);
  if (issue) throw new RangeError(`Invalid provider compatibility configuration: ${issue}.`);
  const allowed = dedupeProtocols(configured?.allowedProtocols ?? PROTOCOLS);
  const preferred = configured?.preferredProtocol ?? requestedProtocol;
  if (!allowed.includes(preferred)) {
    throw new RangeError(`Preferred provider protocol "${preferred}" is not allowed.`);
  }
  return {
    preferredProtocol: preferred,
    allowedProtocols: allowed,
    preserveResponsesReasoningContent: configured?.preserveResponsesReasoningContent ?? false,
    preserveChatReasoningContent: configured?.preserveChatReasoningContent ?? true,
    chatMaxTokensField: configured?.chatMaxTokensField ?? 'max_tokens',
    schemaPatternPolicy: configured?.schemaPatternPolicy ?? 'preserve',
  };
}

export function preferredProviderProtocol(
  configured?: ProviderCompatibilityConfig,
  requestedProtocol: ProviderWireProtocol = 'responses',
): ProviderWireProtocol {
  return resolveProviderCompatibility(configured, requestedProtocol).preferredProtocol;
}

export function normalizeProviderResponsesRequest(
  request: ResponsesRequest,
  profile: ProviderCompatibilityProfile,
): ResponsesRequest {
  const normalized = { ...request };
  if (Array.isArray(request.input)) {
    normalized.input = profile.preserveResponsesReasoningContent
      ? request.input.map((item) => jsonValue(item) ?? null)
      : request.input.map(stripLegacyReasoningContent);
  }
  if (request.tools !== undefined) {
    const tools = normalizeProviderTools(request.tools, profile.schemaPatternPolicy);
    if (tools !== undefined) normalized.tools = tools;
  }
  if (!profile.preserveResponsesReasoningContent) {
    delete (normalized as Record<string, unknown>).reasoning_content;
  }
  const legacyEffort = nonEmptyString(request.reasoning_effort);
  if (legacyEffort) {
    const reasoning = isRecord(request.reasoning) ? { ...request.reasoning } : {};
    if (!nonEmptyString(reasoning.effort)) reasoning.effort = legacyEffort;
    normalized.reasoning = reasoning;
  }
  delete normalized.reasoning_effort;
  return normalized;
}

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
  patternPolicy: ProviderSchemaPatternPolicy = 'preserve',
): JsonValue | undefined {
  if (!Array.isArray(tools)) return jsonValue(tools);
  return tools.map((tool) => normalizeToolDefinition(tool, patternPolicy));
}

/**
 * Clone and bound JSON Schema without renaming, truncating, or dropping any
 * validation constraint. Unsupported regex features fail closed.
 */
export function normalizeProviderJsonSchema(
  schema: unknown,
  patternPolicy: ProviderSchemaPatternPolicy = 'preserve',
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
  patternPolicy: ProviderSchemaPatternPolicy,
  depth: number,
  budget: TraversalBudget,
): JsonValue | undefined {
  assertSchemaDepth(depth);
  if (Array.isArray(schema)) {
    enterTraversalNode(schema, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
    if (schema.length > PROVIDER_SCHEMA_MAX_BRANCHES) {
      throw new RangeError(`Provider tool JSON Schema exceeds ${PROVIDER_SCHEMA_MAX_BRANCHES} array entries.`);
    }
    return schema.map((item) => normalizeProviderJsonSchemaAtDepth(item, patternPolicy, depth + 1, budget) ?? null);
  }
  if (!isRecord(schema)) return jsonValue(schema);
  enterTraversalNode(schema, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');

  const normalized: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(schema)) {
    assertSchemaKey(key);
    if (key === 'required') {
      defineJsonProperty(normalized, key, normalizeRequired(value));
      continue;
    }
    if (key === 'pattern' && typeof value === 'string') {
      assertProviderPattern(value, patternPolicy);
    }
    let entry: JsonValue | undefined;
    if (SCHEMA_MAP_KEYWORDS.has(key) && isRecord(value)) {
      entry = normalizeSchemaMap(value, patternPolicy, depth + 1, budget, key === 'patternProperties');
    } else if (SCHEMA_MIXED_MAP_KEYWORDS.has(key) && isRecord(value)) {
      entry = normalizeMixedSchemaMap(value, patternPolicy, depth + 1, budget);
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
      entry = cloneSchemaLiteral(value, depth + 1, budget);
    }
    if (entry !== undefined) defineJsonProperty(normalized, key, entry);
  }
  return normalized;
}

function normalizeRequired(value: unknown): JsonValue[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new RangeError('Provider tool JSON Schema required must be an array of property names.');
  }
  if (value.length > PROVIDER_SCHEMA_MAX_PROPERTIES) {
    throw new RangeError(`Provider tool JSON Schema exceeds ${PROVIDER_SCHEMA_MAX_PROPERTIES} required properties.`);
  }
  const required = [...new Set(value as string[])];
  required.forEach(assertSchemaKey);
  return required;
}

function normalizeSchemaMap(
  value: Record<string, unknown>,
  patternPolicy: ProviderSchemaPatternPolicy,
  depth: number,
  budget: TraversalBudget,
  patternKeys = false,
): JsonObject {
  assertSchemaDepth(depth);
  const entries = Object.entries(value);
  if (entries.length > PROVIDER_SCHEMA_MAX_PROPERTIES) {
    throw new RangeError(`Provider tool JSON Schema exceeds ${PROVIDER_SCHEMA_MAX_PROPERTIES} properties.`);
  }
  enterTraversalNode(value, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
  const normalized: Record<string, JsonValue> = {};
  for (const [key, schema] of entries) {
    assertSchemaKey(key);
    if (patternKeys) assertProviderPattern(key, patternPolicy);
    const entry = normalizeProviderJsonSchemaAtDepth(schema, patternPolicy, depth + 1, budget);
    if (entry !== undefined) defineJsonProperty(normalized, key, entry);
  }
  return normalized;
}

function normalizeMixedSchemaMap(
  value: Record<string, unknown>,
  patternPolicy: ProviderSchemaPatternPolicy,
  depth: number,
  budget: TraversalBudget,
): JsonObject {
  assertSchemaDepth(depth);
  const entries = Object.entries(value);
  if (entries.length > PROVIDER_SCHEMA_MAX_PROPERTIES) {
    throw new RangeError('Provider tool JSON Schema contains too many dependency entries.');
  }
  enterTraversalNode(value, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
  const normalized: Record<string, JsonValue> = {};
  for (const [key, dependency] of entries) {
    assertSchemaKey(key);
    const entry = isRecord(dependency) || typeof dependency === 'boolean'
      ? normalizeProviderJsonSchemaAtDepth(dependency, patternPolicy, depth + 1, budget)
      : cloneSchemaLiteral(dependency, depth + 1, budget);
    if (entry !== undefined) defineJsonProperty(normalized, key, entry);
  }
  return normalized;
}

function normalizeSchemaArray(
  value: unknown[],
  patternPolicy: ProviderSchemaPatternPolicy,
  depth: number,
  budget: TraversalBudget,
): JsonValue[] {
  assertSchemaDepth(depth);
  if (value.length > PROVIDER_SCHEMA_MAX_BRANCHES) {
    throw new RangeError(`Provider tool JSON Schema exceeds ${PROVIDER_SCHEMA_MAX_BRANCHES} branches.`);
  }
  enterTraversalNode(value, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
  return value.map((schema) => normalizeProviderJsonSchemaAtDepth(schema, patternPolicy, depth + 1, budget) ?? null);
}

function cloneSchemaLiteral(value: unknown, depth: number, budget: TraversalBudget): JsonValue | undefined {
  assertSchemaDepth(depth);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('Provider tool JSON Schema must contain only finite numbers.');
    return value;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    enterTraversalNode(value, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
    if (value.length > PROVIDER_SCHEMA_MAX_ENUM_VALUES) {
      throw new RangeError(`Provider tool JSON Schema exceeds ${PROVIDER_SCHEMA_MAX_ENUM_VALUES} literal values.`);
    }
    return value.map((entry) => cloneSchemaLiteral(entry, depth + 1, budget) ?? null);
  }
  if (!isRecord(value)) return undefined;
  enterTraversalNode(value, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
  const normalized: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    assertSchemaKey(key);
    const json = cloneSchemaLiteral(entry, depth + 1, budget);
    if (json !== undefined) defineJsonProperty(normalized, key, json);
  }
  return normalized;
}

function normalizeToolDefinition(tool: unknown, patternPolicy: ProviderSchemaPatternPolicy): JsonValue {
  if (!isRecord(tool)) return jsonValue(tool) ?? null;
  const normalized: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(tool)) {
    assertSchemaKey(key);
    if (key === 'parameters' || key === 'inputSchema' || key === 'input_schema') {
      const schema = normalizeProviderJsonSchema(value, patternPolicy);
      if (schema !== undefined) defineJsonProperty(normalized, key, schema);
      continue;
    }
    if (key === 'function' && isRecord(value)) {
      defineJsonProperty(normalized, key, normalizeToolDefinition(value, patternPolicy));
      continue;
    }
    if (key === 'tools' && Array.isArray(value)) {
      defineJsonProperty(normalized, key, value.map((entry) => normalizeToolDefinition(entry, patternPolicy)));
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

function dedupeProtocols(protocols: readonly ProviderWireProtocol[]): ProviderWireProtocol[] {
  return [...new Set(protocols)];
}

function assertProviderPattern(
  pattern: string,
  policy: ProviderSchemaPatternPolicy,
): void {
  if (policy === 'reject') {
    throw new RangeError('Provider tool JSON Schema pattern constraints are disabled by configuration.');
  }
  try {
    new RegExp(pattern, 'u');
  } catch {
    throw new RangeError('Provider tool JSON Schema contains an invalid pattern.');
  }
}

function assertSchemaDepth(depth: number): void {
  if (depth > PROVIDER_SCHEMA_MAX_DEPTH) {
    throw new RangeError(`Provider tool JSON Schema exceeds the maximum depth of ${PROVIDER_SCHEMA_MAX_DEPTH}.`);
  }
}

function assertSchemaKey(key: string): void {
  if (key.length > PROVIDER_SCHEMA_MAX_KEY_CHARS) {
    throw new RangeError(`Provider tool JSON Schema property name exceeds ${PROVIDER_SCHEMA_MAX_KEY_CHARS} characters.`);
  }
}

function enterTraversalNode(
  value: object,
  budget: TraversalBudget,
  maxNodes: number,
  label: string,
): void {
  if (budget.seen.has(value)) throw new RangeError(`${label} must be an acyclic JSON tree.`);
  budget.seen.add(value);
  budget.nodes += 1;
  if (budget.nodes > maxNodes) throw new RangeError(`${label} exceeds the maximum node count of ${maxNodes}.`);
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
  return jsonValueAtDepth(value, 0, { nodes: 0, seen: new WeakSet<object>() });
}

function jsonValueAtDepth(value: unknown, depth: number, budget: TraversalBudget): JsonValue | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('Provider JSON value must contain only finite numbers.');
    return value;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
