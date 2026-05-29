export const MODULE_CONTRACT_SCHEMA_VERSION = 'sciforge.module-contract.v1' as const;

export type ModuleFunctionName = 'describe' | 'query' | 'read' | 'invoke';
export type ModuleFacetName = 'events' | 'refs' | 'approval' | 'subscription' | 'batch';
export type ModuleSideEffect = 'none' | 'local' | 'workspace' | 'external';

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
