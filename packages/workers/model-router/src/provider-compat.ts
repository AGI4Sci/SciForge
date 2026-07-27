import type { JsonObject, JsonValue, ResponsesRequest } from './response-compat';

export type ProviderWireProtocol = 'responses' | 'chat-completions' | 'anthropic-messages';
export type ProviderSchemaPatternPolicy = 'preserve' | 'reject';

export type ProviderCompatibilityConfig = {
  preferredProtocol?: ProviderWireProtocol;
  allowedProtocols?: ProviderWireProtocol[];
  probeBeforeUse?: boolean;
  preserveResponsesReasoningContent?: boolean;
  preserveChatReasoningContent?: boolean;
  chatMaxTokensField?: 'max_tokens' | 'max_completion_tokens';
  schemaPatternPolicy?: ProviderSchemaPatternPolicy;
};

export type ProviderCompatibilityProfile = {
  preferredProtocol: ProviderWireProtocol;
  allowedProtocols: readonly ProviderWireProtocol[];
  probeBeforeUse: boolean;
  preserveResponsesReasoningContent: boolean;
  preserveChatReasoningContent: boolean;
  chatMaxTokensField: 'max_tokens' | 'max_completion_tokens';
  schemaPatternPolicy: ProviderSchemaPatternPolicy;
};

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
  'probeBeforeUse',
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
    value.probeBeforeUse !== undefined
    && typeof value.probeBeforeUse !== 'boolean'
  ) {
    return 'probeBeforeUse must be a boolean';
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
    probeBeforeUse: configured?.probeBeforeUse ?? false,
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
  const budget: TraversalBudget = { nodes: 0, seen: new WeakSet<object>() };
  let normalized: JsonValue | undefined;
  const tasks: SchemaTraversalTask[] = [{
    mode: 'schema',
    value: schema,
    assign: (value) => {
      normalized = value;
    },
  }];

  while (tasks.length > 0) {
    const task = tasks.pop() as SchemaTraversalTask;
    if (task.mode === 'literal') {
      visitSchemaLiteral(task.value, task.assign, tasks, budget);
      continue;
    }
    if (task.mode === 'schema-array') {
      visitSchemaArray(task.value as unknown[], task.assign, tasks, budget);
      continue;
    }
    if (task.mode === 'schema-map') {
      visitSchemaMap(
        task.value as Record<string, unknown>,
        Boolean(task.patternKeys),
        task.assign,
        tasks,
        budget,
        patternPolicy,
      );
      continue;
    }
    if (task.mode === 'mixed-schema-map') {
      visitMixedSchemaMap(task.value as Record<string, unknown>, task.assign, tasks, budget);
      continue;
    }
    visitSchema(task.value, task.assign, tasks, budget, patternPolicy);
  }
  return normalized;
}

type SchemaTraversalMode = 'schema' | 'schema-map' | 'mixed-schema-map' | 'schema-array' | 'literal';

type SchemaTraversalTask = {
  mode: SchemaTraversalMode;
  value: unknown;
  patternKeys?: boolean;
  assign: (value: JsonValue | undefined) => void;
};

function visitSchema(
  schema: unknown,
  assign: SchemaTraversalTask['assign'],
  tasks: SchemaTraversalTask[],
  budget: TraversalBudget,
  patternPolicy: ProviderSchemaPatternPolicy,
): void {
  if (Array.isArray(schema)) {
    visitSchemaArray(schema, assign, tasks, budget);
    return;
  }
  if (!isRecord(schema)) {
    visitSchemaLiteral(schema, assign, tasks, budget);
    return;
  }
  enterTraversalNode(schema, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
  const result: Record<string, JsonValue> = {};
  assign(result);
  const childTasks: SchemaTraversalTask[] = [];
  for (const [key, value] of Object.entries(schema)) {
    assertSchemaKey(key);
    if (key === 'required') {
      defineJsonProperty(result, key, normalizeRequired(value));
      continue;
    }
    if (key === 'pattern' && typeof value === 'string') {
      assertProviderPattern(value, patternPolicy);
    }
    let mode: SchemaTraversalMode = 'literal';
    let patternKeys = false;
    if (SCHEMA_MAP_KEYWORDS.has(key) && isRecord(value)) {
      mode = 'schema-map';
      patternKeys = key === 'patternProperties';
    } else if (SCHEMA_MIXED_MAP_KEYWORDS.has(key) && isRecord(value)) {
      mode = 'mixed-schema-map';
    } else if (SCHEMA_ARRAY_KEYWORDS.has(key) && Array.isArray(value)) {
      mode = 'schema-array';
    } else if (SCHEMA_SINGLE_KEYWORDS.has(key)) {
      if (key === 'items' && Array.isArray(value)) mode = 'schema-array';
      else if (typeof value === 'boolean' || isRecord(value)) mode = 'schema';
    }
    reserveNormalizedProperty(result, key);
    childTasks.push({
      mode,
      value,
      patternKeys,
      assign: normalizedValue => assignNormalizedProperty(result, key, normalizedValue),
    });
  }
  pushTraversalTasks(tasks, childTasks);
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

function visitSchemaMap(
  value: Record<string, unknown>,
  patternKeys: boolean,
  assign: SchemaTraversalTask['assign'],
  tasks: SchemaTraversalTask[],
  budget: TraversalBudget,
  patternPolicy: ProviderSchemaPatternPolicy,
): void {
  const entries = Object.entries(value);
  if (entries.length > PROVIDER_SCHEMA_MAX_PROPERTIES) {
    throw new RangeError(`Provider tool JSON Schema exceeds ${PROVIDER_SCHEMA_MAX_PROPERTIES} properties.`);
  }
  enterTraversalNode(value, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
  const result: Record<string, JsonValue> = {};
  assign(result);
  const childTasks: SchemaTraversalTask[] = [];
  for (const [key, schema] of entries) {
    assertSchemaKey(key);
    if (patternKeys) assertProviderPattern(key, patternPolicy);
    reserveNormalizedProperty(result, key);
    childTasks.push({
      mode: 'schema',
      value: schema,
      assign: normalizedValue => assignNormalizedProperty(result, key, normalizedValue),
    });
  }
  pushTraversalTasks(tasks, childTasks);
}

function visitMixedSchemaMap(
  value: Record<string, unknown>,
  assign: SchemaTraversalTask['assign'],
  tasks: SchemaTraversalTask[],
  budget: TraversalBudget,
): void {
  const entries = Object.entries(value);
  if (entries.length > PROVIDER_SCHEMA_MAX_PROPERTIES) {
    throw new RangeError('Provider tool JSON Schema contains too many dependency entries.');
  }
  enterTraversalNode(value, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
  const result: Record<string, JsonValue> = {};
  assign(result);
  const childTasks: SchemaTraversalTask[] = [];
  for (const [key, dependency] of entries) {
    assertSchemaKey(key);
    reserveNormalizedProperty(result, key);
    childTasks.push({
      mode: isRecord(dependency) || typeof dependency === 'boolean' ? 'schema' : 'literal',
      value: dependency,
      assign: normalizedValue => assignNormalizedProperty(result, key, normalizedValue),
    });
  }
  pushTraversalTasks(tasks, childTasks);
}

function visitSchemaArray(
  value: unknown[],
  assign: SchemaTraversalTask['assign'],
  tasks: SchemaTraversalTask[],
  budget: TraversalBudget,
): void {
  if (value.length > PROVIDER_SCHEMA_MAX_BRANCHES) {
    throw new RangeError(`Provider tool JSON Schema exceeds ${PROVIDER_SCHEMA_MAX_BRANCHES} branches.`);
  }
  enterTraversalNode(value, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
  const result: JsonValue[] = new Array(value.length).fill(null);
  assign(result);
  const childTasks = value.map<SchemaTraversalTask>((schema, index) => ({
    mode: 'schema',
    value: schema,
    assign: normalizedValue => {
      result[index] = normalizedValue ?? null;
    },
  }));
  pushTraversalTasks(tasks, childTasks);
}

function visitSchemaLiteral(
  value: unknown,
  assign: SchemaTraversalTask['assign'],
  tasks: SchemaTraversalTask[],
  budget: TraversalBudget,
): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('Provider tool JSON Schema must contain only finite numbers.');
    assign(value);
    return;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    assign(value);
    return;
  }
  if (Array.isArray(value)) {
    enterTraversalNode(value, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
    if (value.length > PROVIDER_SCHEMA_MAX_ENUM_VALUES) {
      throw new RangeError(`Provider tool JSON Schema exceeds ${PROVIDER_SCHEMA_MAX_ENUM_VALUES} literal values.`);
    }
    const result: JsonValue[] = new Array(value.length).fill(null);
    assign(result);
    const childTasks = value.map<SchemaTraversalTask>((entry, index) => ({
      mode: 'literal',
      value: entry,
      assign: normalizedValue => {
        result[index] = normalizedValue ?? null;
      },
    }));
    pushTraversalTasks(tasks, childTasks);
    return;
  }
  if (!isRecord(value)) {
    assign(undefined);
    return;
  }
  enterTraversalNode(value, budget, PROVIDER_SCHEMA_MAX_NODES, 'Provider tool JSON Schema');
  const result: Record<string, JsonValue> = {};
  assign(result);
  const childTasks: SchemaTraversalTask[] = [];
  for (const [key, entry] of Object.entries(value)) {
    assertSchemaKey(key);
    reserveNormalizedProperty(result, key);
    childTasks.push({
      mode: 'literal',
      value: entry,
      assign: normalizedValue => assignNormalizedProperty(result, key, normalizedValue),
    });
  }
  pushTraversalTasks(tasks, childTasks);
}

function pushTraversalTasks(tasks: SchemaTraversalTask[], children: SchemaTraversalTask[]): void {
  for (let index = children.length - 1; index >= 0; index -= 1) {
    tasks.push(children[index] as SchemaTraversalTask);
  }
}

function reserveNormalizedProperty(target: Record<string, JsonValue>, key: string): void {
  defineJsonProperty(target, key, null);
}

function assignNormalizedProperty(
  target: Record<string, JsonValue>,
  key: string,
  value: JsonValue | undefined,
): void {
  if (value === undefined) {
    delete target[key];
    return;
  }
  defineJsonProperty(target, key, value);
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
