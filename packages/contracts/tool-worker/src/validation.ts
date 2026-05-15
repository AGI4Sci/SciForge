import type {
  JsonObject,
  ToolInputField,
  ToolInvokeRequest,
  ToolInvokeResponse,
  ToolManifest,
  ToolWorkerHealth,
  ToolWorkerManifest,
} from './types';

export class ToolProtocolValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid tool protocol payload: ${issues.join('; ')}`);
    this.name = 'ToolProtocolValidationError';
    this.issues = issues;
  }
}

export function assertToolWorkerManifest(value: unknown): asserts value is ToolWorkerManifest {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new ToolProtocolValidationError(['manifest must be an object']);
  }
  requireString(value, 'protocolVersion', issues);
  if (value.protocolVersion !== 'sciforge.tools.v1') {
    issues.push('protocolVersion must be sciforge.tools.v1');
  }
  requireString(value, 'workerId', issues);
  requireString(value, 'workerVersion', issues);
  requireString(value, 'description', issues);
  if (!Array.isArray(value.tools) || value.tools.length === 0) {
    issues.push('tools must be a non-empty array');
  } else {
    value.tools.forEach((tool, index) => validateToolManifest(tool, `tools[${index}]`, issues));
  }
  if (value.capabilities !== undefined && !isStringArray(value.capabilities)) {
    issues.push('capabilities must be an array of strings');
  }
  throwIfIssues(issues);
}

export function assertToolWorkerHealth(value: unknown): asserts value is ToolWorkerHealth {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new ToolProtocolValidationError(['health must be an object']);
  }
  if (!['ok', 'degraded', 'unavailable'].includes(String(value.status))) {
    issues.push('status must be ok, degraded, or unavailable');
  }
  requireString(value, 'checkedAt', issues);
  if (typeof value.checkedAt === 'string' && Number.isNaN(Date.parse(value.checkedAt))) {
    issues.push('checkedAt must be an ISO-compatible timestamp');
  }
  if (value.details !== undefined && !isJsonObject(value.details)) {
    issues.push('details must be a JSON object');
  }
  throwIfIssues(issues);
}

export function assertToolInvokeRequest(value: unknown): asserts value is ToolInvokeRequest {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new ToolProtocolValidationError(['invoke request must be an object']);
  }
  requireString(value, 'toolId', issues);
  if (!isJsonObject(value.input)) {
    issues.push('input must be a JSON object');
  }
  if (value.requestId !== undefined && typeof value.requestId !== 'string') {
    issues.push('requestId must be a string');
  }
  if (value.deadlineMs !== undefined && !isPositiveNumber(value.deadlineMs)) {
    issues.push('deadlineMs must be a positive number');
  }
  if (value.metadata !== undefined && !isJsonObject(value.metadata)) {
    issues.push('metadata must be a JSON object');
  }
  throwIfIssues(issues);
}

export function assertToolInvokeResponse(value: unknown): asserts value is ToolInvokeResponse {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new ToolProtocolValidationError(['invoke response must be an object']);
  }
  if (value.ok === true) {
    if (!isJsonValue(value.output)) {
      issues.push('output must be JSON serializable');
    }
  } else if (value.ok === false) {
    if (!isRecord(value.error)) {
      issues.push('error must be an object');
    } else {
      requireString(value.error, 'code', issues);
      requireString(value.error, 'message', issues);
      if (value.error.retryable !== undefined && typeof value.error.retryable !== 'boolean') {
        issues.push('error.retryable must be a boolean');
      }
      if (value.error.details !== undefined && !isJsonObject(value.error.details)) {
        issues.push('error.details must be a JSON object');
      }
    }
  } else {
    issues.push('ok must be true or false');
  }
  if (value.requestId !== undefined && typeof value.requestId !== 'string') {
    issues.push('requestId must be a string');
  }
  if (value.metadata !== undefined && !isJsonObject(value.metadata)) {
    issues.push('metadata must be a JSON object');
  }
  throwIfIssues(issues);
}

export function validateToolInput(tool: ToolManifest, input: JsonObject): string[] {
  const issues: string[] = [];
  for (const [fieldName, field] of Object.entries(tool.inputSchema)) {
    const fieldValue = input[fieldName];
    if (field.required && fieldValue === undefined) {
      issues.push(`${fieldName} is required`);
      continue;
    }
    if (fieldValue !== undefined && !matchesFieldType(field, fieldValue)) {
      issues.push(`${fieldName} must be ${field.type}`);
    }
    if (field.enum && !field.enum.some((candidate) => candidate === fieldValue)) {
      issues.push(`${fieldName} must be one of ${field.enum.join(', ')}`);
    }
  }
  return issues;
}

function validateToolManifest(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  requireString(value, 'id', issues, path);
  requireString(value, 'name', issues, path);
  requireString(value, 'version', issues, path);
  requireString(value, 'description', issues, path);
  if (!isRecord(value.inputSchema)) {
    issues.push(`${path}.inputSchema must be an object`);
  } else {
    for (const [fieldName, field] of Object.entries(value.inputSchema)) {
      validateInputField(field, `${path}.inputSchema.${fieldName}`, issues);
    }
  }
  if (value.outputSchema !== undefined && !isRecord(value.outputSchema)) {
    issues.push(`${path}.outputSchema must be an object`);
  }
  if (!Array.isArray(value.sideEffects) || value.sideEffects.some((item) => typeof item !== 'string')) {
    issues.push(`${path}.sideEffects must be an array of strings`);
  }
  if (value.timeoutMs !== undefined && !isPositiveNumber(value.timeoutMs)) {
    issues.push(`${path}.timeoutMs must be a positive number`);
  }
  if (value.tags !== undefined && !isStringArray(value.tags)) {
    issues.push(`${path}.tags must be an array of strings`);
  }
}

function validateInputField(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  if (!['string', 'number', 'boolean', 'object', 'array'].includes(String(value.type))) {
    issues.push(`${path}.type must be string, number, boolean, object, or array`);
  }
  if (value.required !== undefined && typeof value.required !== 'boolean') {
    issues.push(`${path}.required must be a boolean`);
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    issues.push(`${path}.description must be a string`);
  }
  if (value.enum !== undefined && (!Array.isArray(value.enum) || !value.enum.every(isJsonPrimitive))) {
    issues.push(`${path}.enum must be an array of JSON primitives`);
  }
  if (value.default !== undefined && !isJsonValue(value.default)) {
    issues.push(`${path}.default must be JSON serializable`);
  }
}

function matchesFieldType(field: ToolInputField, value: unknown): boolean {
  if (field.type === 'array') return Array.isArray(value);
  if (field.type === 'object') return isJsonObject(value);
  return typeof value === field.type;
}

function requireString(value: Record<string, unknown>, field: string, issues: string[], path?: string): void {
  if (typeof value[field] !== 'string' || value[field] === '') {
    issues.push(`${path ? `${path}.` : ''}${field} must be a non-empty string`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): boolean {
  if (isJsonPrimitive(value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function isJsonPrimitive(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function throwIfIssues(issues: string[]): void {
  if (issues.length > 0) {
    throw new ToolProtocolValidationError(issues);
  }
}
