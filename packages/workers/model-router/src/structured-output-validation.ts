import { isDeepStrictEqual } from 'node:util';

import type { JsonObject, JsonValue } from './response-compat';

/**
 * Local enforcement for structured-output contracts that an upstream cannot
 * enforce natively. The validator implements a bounded JSON Schema subset and
 * fails closed on any other validation keyword, so a contract is never
 * silently weakened to what the Router happens to understand.
 */

export type LocalStructuredOutputContract = Readonly<{
  name: string;
  description?: string;
  schema: JsonObject;
}>;

const VALIDATION_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'pattern',
  'enum',
  'const',
  'anyOf',
]);
const ANNOTATION_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$comment',
  'title',
  'description',
  'default',
  'examples',
  'readOnly',
  'writeOnly',
  'deprecated',
]);
const MAX_REPORTED_ISSUES = 5;

/** Throws a RangeError when the schema uses a keyword the local validator cannot enforce. */
export function assertLocallyEnforceableJsonSchema(schema: JsonValue, path = '$'): void {
  if (typeof schema === 'boolean') return;
  if (!isObject(schema)) throw new RangeError(`Structured-output schema at ${path} must be an object.`);
  for (const [keyword, value] of Object.entries(schema)) {
    if (ANNOTATION_KEYWORDS.has(keyword)) continue;
    if (!VALIDATION_KEYWORDS.has(keyword)) {
      throw new RangeError(
        `Structured-output schema keyword "${keyword}" at ${path} cannot be enforced locally for a json_object upstream.`,
      );
    }
    if (keyword === 'properties' && isObject(value)) {
      for (const [name, child] of Object.entries(value)) {
        assertLocallyEnforceableJsonSchema(child, `${path}.properties.${name}`);
      }
    } else if ((keyword === 'items' || keyword === 'additionalProperties') && !Array.isArray(value)) {
      assertLocallyEnforceableJsonSchema(value, `${path}.${keyword}`);
    } else if (keyword === 'anyOf' && Array.isArray(value)) {
      value.forEach((child, index) => assertLocallyEnforceableJsonSchema(child, `${path}.anyOf[${index}]`));
    } else if (keyword === 'pattern' && typeof value === 'string') {
      try {
        new RegExp(value, 'u');
      } catch {
        throw new RangeError(`Structured-output schema pattern at ${path} is not a valid Unicode regular expression.`);
      }
    } else if (keyword === 'items' || keyword === 'properties' || keyword === 'anyOf' || keyword === 'pattern') {
      throw new RangeError(`Structured-output schema keyword "${keyword}" at ${path} has an unsupported form.`);
    }
  }
}

/** Returns bounded, value-free issue paths; empty when the text satisfies the contract. */
export function structuredOutputValidationIssues(text: string, schema: JsonObject): string[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return ['$: output is not valid JSON'];
  }
  if (!isObject(value)) return ['$: output must be a JSON object'];
  const issues: string[] = [];
  validate(value as JsonValue, schema, '$', issues);
  return issues.slice(0, MAX_REPORTED_ISSUES);
}

/**
 * System instruction that carries the contract when the upstream only offers
 * JSON mode. Some JSON-mode upstreams require the literal word "json" and an
 * example in the prompt, so both are always present.
 */
export function jsonObjectStructuredOutputInstruction(contract: LocalStructuredOutputContract): string {
  return [
    `Respond with exactly one json object that conforms to the JSON Schema named "${contract.name}".`,
    ...(contract.description ? [`Schema purpose: ${contract.description}`] : []),
    'Output only the json object: no Markdown code fences, no commentary, no text before or after it.',
    'Every required property must be present, no undeclared properties may appear, and every value must satisfy the schema constraints.',
    'JSON Schema:',
    JSON.stringify(contract.schema),
    'Example json output format (placeholder values; replace them with real content that satisfies the schema):',
    JSON.stringify(jsonSchemaExample(contract.schema)),
  ].join('\n');
}

function jsonSchemaExample(schema: JsonValue): JsonValue {
  if (!isObject(schema)) return null;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]!;
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) return jsonSchemaExample(schema.anyOf[0]!);
  switch (schemaTypes(schema)[0]) {
    case 'object': {
      const properties = isObject(schema.properties) ? schema.properties : {};
      return Object.fromEntries(Object.entries(properties).map(([name, child]) => [name, jsonSchemaExample(child)]));
    }
    case 'array':
      return [jsonSchemaExample(schema.items ?? {})];
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

function validate(value: JsonValue, schema: JsonValue, path: string, issues: string[]): void {
  if (issues.length >= MAX_REPORTED_ISSUES) return;
  if (schema === true) return;
  if (schema === false || !isObject(schema)) {
    issues.push(`${path}: value is not allowed`);
    return;
  }
  const types = schemaTypes(schema);
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    issues.push(`${path}: expected ${types.join(' or ')}`);
    return;
  }
  if (schema.const !== undefined && !isDeepStrictEqual(value, schema.const)) {
    issues.push(`${path}: value does not match const`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => isDeepStrictEqual(value, entry))) {
    issues.push(`${path}: value is not in enum`);
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((branch) => branchMatches(value, branch, path))) {
    issues.push(`${path}: value matches no anyOf branch`);
  }
  if (typeof value === 'string') validateString(value, schema, path, issues);
  if (Array.isArray(value)) validateArray(value, schema, path, issues);
  else if (isObject(value)) validateObject(value, schema, path, issues);
}

function validateString(value: string, schema: JsonObject, path: string, issues: string[]): void {
  const length = [...value].length;
  if (typeof schema.minLength === 'number' && length < schema.minLength) issues.push(`${path}: string is too short`);
  if (typeof schema.maxLength === 'number' && length > schema.maxLength) issues.push(`${path}: string is too long`);
  if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
    issues.push(`${path}: string does not match pattern`);
  }
}

function validateArray(value: JsonValue[], schema: JsonObject, path: string, issues: string[]): void {
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) issues.push(`${path}: too few items`);
  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) issues.push(`${path}: too many items`);
  if (schema.items !== undefined) {
    value.forEach((entry, index) => validate(entry, schema.items!, `${path}[${index}]`, issues));
  }
}

function validateObject(value: JsonObject, schema: JsonObject, path: string, issues: string[]): void {
  const properties = isObject(schema.properties) ? schema.properties : {};
  if (Array.isArray(schema.required)) {
    for (const name of schema.required) {
      if (typeof name === 'string' && !Object.hasOwn(value, name)) issues.push(`${path}.${name}: required property is missing`);
    }
  }
  for (const [name, entry] of Object.entries(value)) {
    if (Object.hasOwn(properties, name)) {
      validate(entry, properties[name]!, `${path}.${name}`, issues);
    } else if (schema.additionalProperties !== undefined) {
      validate(entry, schema.additionalProperties, `${path}.${name}`, issues);
    }
  }
}

function branchMatches(value: JsonValue, branch: JsonValue, path: string): boolean {
  const branchIssues: string[] = [];
  validate(value, branch, path, branchIssues);
  return branchIssues.length === 0;
}

function schemaTypes(schema: JsonObject): string[] {
  if (typeof schema.type === 'string') return [schema.type];
  return Array.isArray(schema.type) ? schema.type.filter((type): type is string => typeof type === 'string') : [];
}

function matchesType(value: JsonValue, type: string): boolean {
  switch (type) {
    case 'object': return isObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return false;
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
