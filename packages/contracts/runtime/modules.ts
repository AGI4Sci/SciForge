export const MODULE_CONTRACT_SCHEMA_VERSION = 'sciforge.module-contract.v1' as const;
export const EXECUTE_BOUNDED_OPERATION_INTENT = 'executeBoundedOperation' as const;

export type ModuleFunctionName = 'describe' | 'query' | 'read' | 'invoke';
export type ModuleFacetName = 'events' | 'refs' | 'approval' | 'subscription' | 'batch';
export type ModuleSideEffect = 'none' | 'local' | 'workspace' | 'external';
export type BoundedOperationStatus = 'completed' | 'partial' | 'blocked' | 'needs-confirmation' | 'failed';
export type BoundedOperationRiskPolicy = 'low' | 'medium' | 'high' | 'confirmation-required' | string;

export interface ModuleResourceDescription {
  kind: string;
  refPrefix: string;
  queryable?: boolean;
  readable?: boolean;
  summary?: string;
}

export interface ModuleIntentDescription {
  name: string;
  sideEffect: ModuleSideEffect;
  requiresApproval?: boolean;
  returnsOperation?: boolean;
  summary?: string;
}

export interface ModuleDescription {
  schemaVersion: typeof MODULE_CONTRACT_SCHEMA_VERSION;
  moduleId: string;
  title: string;
  summary: string;
  functions: Record<ModuleFunctionName, boolean>;
  resources?: ModuleResourceDescription[];
  intents?: ModuleIntentDescription[];
  facets?: Partial<Record<ModuleFacetName, boolean>>;
  limits?: {
    maxInlineBytes?: number;
    expectedLatencyMs?: number;
  };
}

export type ModuleDescriptionInput = Omit<ModuleDescription, 'schemaVersion' | 'functions'> & {
  schemaVersion?: typeof MODULE_CONTRACT_SCHEMA_VERSION;
  functions?: Partial<Record<ModuleFunctionName, boolean>>;
};

export interface ModuleQueryRequest {
  moduleId: string;
  query?: string;
  scope?: string;
  kind?: string;
  filters?: Record<string, unknown>;
  limit?: number;
}

export interface ModuleReadRequest {
  moduleId?: string;
  ref: string;
  includeMeta?: boolean;
  maxBytes?: number;
}

export interface ModuleInvokeRequest {
  moduleId: string;
  intent: string;
  input?: Record<string, unknown>;
  idempotencyKey?: string;
  traceParent?: string;
  approvalToken?: string;
}

export interface ModuleResultEnvelope<T = unknown> {
  schemaVersion: typeof MODULE_CONTRACT_SCHEMA_VERSION;
  moduleId: string;
  ok: boolean;
  value?: T;
  refs?: string[];
  operationRef?: string;
  approvalRequest?: Record<string, unknown>;
  error?: string;
}

export interface BoundedOperationConfig {
  allowedActions: string[];
  maxSteps: number;
  maxTimeMs: number;
  maxModelCalls: number;
  riskPolicy?: BoundedOperationRiskPolicy;
  requiredEvidence: string[];
  stopConditions: string[];
}

const BOUNDED_OPERATION_CONFIG_FIELDS = new Set([
  'allowedActions',
  'maxSteps',
  'maxTimeMs',
  'maxModelCalls',
  'riskPolicy',
  'requiredEvidence',
  'stopConditions',
]);

export interface BoundedOperationRequestInput {
  operationKind: string;
  ownerModuleId: string;
  targetScope: Record<string, unknown>;
  config: BoundedOperationConfig;
}

export type BoundedOperationInvokeRequest = ModuleInvokeRequest & {
  intent: typeof EXECUTE_BOUNDED_OPERATION_INTENT;
  input: BoundedOperationRequestInput;
};

export interface BoundedOperationBudgets {
  maxSteps?: number;
  stepsUsed?: number;
  maxTimeMs?: number;
  elapsedMs?: number;
  maxModelCalls?: number;
  modelCallsUsed?: number;
  exhausted?: Array<'maxSteps' | 'maxTimeMs' | 'maxModelCalls' | string>;
}

export interface BoundedOperationResultValue<T = unknown> {
  operationKind: string;
  ownerModuleId: string;
  status: BoundedOperationStatus;
  evidenceRefs: string[];
  actionRefs?: string[];
  artifactRefs?: string[];
  validatorRefs?: string[];
  sourceRefs?: string[];
  blockedReason?: string;
  repairHint?: string;
  budgets?: BoundedOperationBudgets;
  payload?: T;
}

export interface BoundedOperationResultInput<T = unknown> {
  moduleId: string;
  operationKind: string;
  status: BoundedOperationStatus;
  evidenceRefs?: string[];
  actionRefs?: string[];
  artifactRefs?: string[];
  validatorRefs?: string[];
  sourceRefs?: string[];
  value?: T;
  operationRef?: string;
  approvalRequest?: Record<string, unknown>;
  blockedReason?: string;
  repairHint?: string;
  budgets?: BoundedOperationBudgets;
}

export interface BoundedOperationValidationResult {
  ok: boolean;
  errors: string[];
}

export type ModuleQueryResult<T = unknown> = ModuleResultEnvelope<T>;
export type ModuleReadResult<T = unknown> = ModuleResultEnvelope<T>;
export type ModuleInvokeResult<T = unknown> = ModuleResultEnvelope<T>;

export interface ModulePipelineTraceStep {
  id: string;
  moduleId: string;
  functionName: ModuleFunctionName;
  intent?: string;
  query?: string;
  ref?: string;
  inputSummary?: string;
  resultSummary?: string;
  status: 'started' | 'completed' | 'failed' | 'cancelled' | 'approval-required';
  startedAt: string;
  completedAt?: string;
  timing?: {
    durationMs?: number;
  };
  parentId?: string;
  refs?: string[];
  operationRef?: string;
  approval?: Record<string, unknown>;
  summary?: string;
}

export function createModuleDescription(input: ModuleDescriptionInput): ModuleDescription {
  const resources = input.resources ?? [];
  const intents = input.intents ?? [];
  return {
    ...input,
    schemaVersion: MODULE_CONTRACT_SCHEMA_VERSION,
    functions: {
      describe: true,
      query: input.functions?.query ?? resources.some((resource) => resource.queryable === true),
      read: input.functions?.read ?? resources.some((resource) => resource.readable === true),
      invoke: input.functions?.invoke ?? intents.length > 0,
    },
    resources,
    intents,
  };
}

export function moduleSupportsFunction(description: ModuleDescription, functionName: ModuleFunctionName): boolean {
  if (functionName === 'describe') return true;
  return description.functions[functionName] === true;
}

export function moduleSupportsFacet(description: ModuleDescription, facet: ModuleFacetName): boolean {
  return description.facets?.[facet] === true;
}

export function moduleIntent(description: ModuleDescription, intentName: string): ModuleIntentDescription | undefined {
  return description.intents?.find((intent) => intent.name === intentName);
}

export function moduleIntentRequiresApproval(description: ModuleDescription, intentName: string): boolean {
  return moduleIntent(description, intentName)?.requiresApproval === true;
}

export function moduleResult<T>(input: Omit<ModuleResultEnvelope<T>, 'schemaVersion'>): ModuleResultEnvelope<T> {
  return {
    ...input,
    schemaVersion: MODULE_CONTRACT_SCHEMA_VERSION,
  };
}

export function validateBoundedOperationRequest(request: ModuleInvokeRequest): BoundedOperationValidationResult {
  const errors: string[] = [];
  if (request.intent !== EXECUTE_BOUNDED_OPERATION_INTENT) {
    errors.push(`unsupported_bounded_operation_intent:${request.intent}`);
  }
  const input = recordOrUndefined(request.input);
  if (!input) {
    errors.push('missing_input');
    return { ok: false, errors };
  }

  const ownerModuleId = stringValue(input.ownerModuleId);
  if (!ownerModuleId) errors.push('missing_ownerModuleId');
  if (ownerModuleId && ownerModuleId !== request.moduleId) errors.push('owner_module_mismatch');
  if (!stringValue(input.operationKind)) errors.push('missing_operationKind');
  if (!recordOrUndefined(input.targetScope)) errors.push('missing_targetScope');

  const config = recordOrUndefined(input.config);
  if (!config) {
    errors.push('missing_config');
  } else {
    const forbiddenDslFields = forbiddenWorkflowFields(config);
    for (const field of Object.keys(config)) {
      if (!BOUNDED_OPERATION_CONFIG_FIELDS.has(field) && !forbiddenDslFields.includes(field)) {
        errors.push(`unknown_boundary_config_field:config.${field}`);
      }
    }
    validateStringList(config.allowedActions, 'config.allowedActions', errors);
    validateStringList(config.requiredEvidence, 'config.requiredEvidence', errors);
    validateStringList(config.stopConditions, 'config.stopConditions', errors);
    for (const field of forbiddenDslFields) {
      errors.push(`forbidden_dsl_field:config.${field}`);
    }
    for (const field of ['maxSteps', 'maxTimeMs', 'maxModelCalls']) {
      if (!(field in config)) {
        errors.push(`missing_budget:config.${field}`);
      } else if (!isNonNegativeFiniteNumber(config[field])) {
        errors.push(`invalid_budget:config.${field}`);
      }
    }
  }

  if (containsNestedBoundedOperation(input)) {
    errors.push('nested_executeBoundedOperation_forbidden');
  }

  return { ok: errors.length === 0, errors };
}

export function boundedOperationResult<T>(
  input: BoundedOperationResultInput<T>,
): ModuleInvokeResult<BoundedOperationResultValue<T>> {
  const refs = uniqueRefs([
    ...(input.evidenceRefs ?? []),
    ...(input.actionRefs ?? []),
    ...(input.artifactRefs ?? []),
    ...(input.validatorRefs ?? []),
    ...(input.sourceRefs ?? []),
  ]);
  const value: BoundedOperationResultValue<T> = {
    operationKind: input.operationKind,
    ownerModuleId: input.moduleId,
    status: input.status,
    evidenceRefs: uniqueRefs(input.evidenceRefs ?? []),
    actionRefs: uniqueRefs(input.actionRefs ?? []),
    artifactRefs: uniqueRefs(input.artifactRefs ?? []),
    validatorRefs: uniqueRefs(input.validatorRefs ?? []),
    sourceRefs: uniqueRefs(input.sourceRefs ?? []),
    blockedReason: input.blockedReason,
    repairHint: input.repairHint,
    budgets: input.budgets,
    payload: input.value,
  };

  return sanitizeBoundedOperationResult(moduleResult({
    moduleId: input.moduleId,
    ok: input.status === 'completed' || input.status === 'partial',
    value,
    refs,
    operationRef: input.operationRef,
    approvalRequest: input.approvalRequest,
    error: input.status === 'completed' || input.status === 'partial'
      ? undefined
      : input.blockedReason ?? input.status,
  }));
}

export function sanitizeBoundedOperationResult<T>(
  result: ModuleInvokeResult<BoundedOperationResultValue<T>>,
): ModuleInvokeResult<BoundedOperationResultValue<T>> {
  const value = result.value
    ? sanitizeLargeInlineFields(result.value) as BoundedOperationResultValue<T>
    : result.value;
  return {
    ...result,
    value,
    refs: uniqueRefs([
      ...(result.refs ?? []),
      ...(value?.evidenceRefs ?? []),
      ...(value?.actionRefs ?? []),
      ...(value?.artifactRefs ?? []),
      ...(value?.validatorRefs ?? []),
      ...(value?.sourceRefs ?? []),
    ]),
  };
}

function validateStringList(value: unknown, path: string, errors: string[]) {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    errors.push(`invalid_string_list:${path}`);
  }
}

function forbiddenWorkflowFields(value: Record<string, unknown>) {
  const forbidden = ['if', 'else', 'loop', 'while', 'forEach', 'workflow', 'steps', 'next', 'then'];
  return forbidden.filter((field) => field in value);
}

function containsNestedBoundedOperation(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsNestedBoundedOperation(entry));
  const record = recordOrUndefined(value);
  if (!record) return false;
  if (record === value && record.intent === EXECUTE_BOUNDED_OPERATION_INTENT) return true;
  return Object.entries(record)
    .filter(([key]) => key !== 'intent')
    .some(([, entry]) => containsNestedBoundedOperation(entry));
}

function sanitizeLargeInlineFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitizeLargeInlineFields(entry));
  const record = recordOrUndefined(value);
  if (!record) return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (/^(?:raw|base64|screenshotBase64|imageBase64|providerPayload|trace|log|artifact)$/i.test(key)) {
      sanitized[`${key}RefRequired`] = true;
      continue;
    }
    sanitized[key] = sanitizeLargeInlineFields(entry);
  }
  return sanitized;
}

function uniqueRefs(refs: string[]) {
  return [...new Set(refs
    .filter((ref) => typeof ref === 'string' && ref.trim())
    .map((ref) => ref.trim())
    .filter((ref) => !isForbiddenOperationEvidenceRef(ref)))];
}

function isForbiddenOperationEvidenceRef(ref: string) {
  return /^(?:data:|raw:|fixture:|history:|replay:)/i.test(ref)
    || /;base64\b/i.test(ref);
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isNonNegativeFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
