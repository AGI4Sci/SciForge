import {
  createModuleDescription,
  moduleIntent,
  moduleIntentRequiresApproval,
  moduleResult,
  moduleSupportsFunction,
  type ModuleDescription,
  type ModuleFunctionName,
  type ModuleInvokeRequest,
  type ModulePipelineTraceStep,
  type ModuleQueryRequest,
  type ModuleReadRequest,
  type ModuleResultEnvelope,
} from '@sciforge-ui/runtime-contract/modules';
import { createResourceModuleHandlers } from './resource-modules.js';

export interface RuntimeModuleHandler {
  describe(): ModuleDescription | Promise<ModuleDescription>;
  query?(request: ModuleQueryRequest): unknown | Promise<unknown>;
  read?(request: ModuleReadRequest): unknown | Promise<unknown>;
  invoke?(request: ModuleInvokeRequest): unknown | Promise<unknown>;
}

export interface RuntimeModuleRegistry {
  moduleIds(): string[];
  get(moduleId: string): RuntimeModuleHandler | undefined;
  describe(moduleId: string): Promise<ModuleDescription | undefined>;
  descriptions(): Promise<ModuleDescription[]>;
  resolveModuleIdForRef(ref: string): Promise<string | undefined>;
}

export interface RuntimeModuleDispatcher {
  describe(request?: { moduleId?: string }): Promise<ModuleResultEnvelope>;
  query(request: ModuleQueryRequest): Promise<ModuleResultEnvelope>;
  read(request: ModuleReadRequest): Promise<ModuleResultEnvelope>;
  invoke(request: ModuleInvokeRequest): Promise<ModuleResultEnvelope>;
  trace(): ModulePipelineTraceStep[];
  clearTrace(): void;
}

export const RUNTIME_MODULE_IDS = [
  'gui',
  'skills',
  'memory',
  'capabilities',
  'browser',
  'verifier',
  'actions',
  'artifacts',
] as const;

export type RuntimeModuleId = typeof RUNTIME_MODULE_IDS[number];

export function createRuntimeModuleRegistry(
  handlers: Partial<Record<string, RuntimeModuleHandler>> = {},
): RuntimeModuleRegistry {
  const resourceHandlers = createResourceModuleHandlers();
  const defaults: Partial<Record<string, RuntimeModuleHandler>> = {
    skills: resourceHandlers.skills,
    memory: resourceHandlers.memory,
    capabilities: resourceHandlers.capabilities,
  };
  const merged = new Map<string, RuntimeModuleHandler>();
  for (const moduleId of RUNTIME_MODULE_IDS) {
    merged.set(moduleId, handlers[moduleId] ?? defaults[moduleId] ?? describeOnlyModuleHandler(defaultModuleDescription(moduleId)));
  }
  for (const [moduleId, handler] of Object.entries(handlers)) {
    if (handler) merged.set(moduleId, handler);
  }

  return {
    moduleIds: () => [...merged.keys()],
    get: (moduleId) => merged.get(moduleId),
    describe: async (moduleId) => {
      const handler = merged.get(moduleId);
      return handler ? handler.describe() : undefined;
    },
    descriptions: async () => Promise.all([...merged.values()].map((handler) => handler.describe())),
    resolveModuleIdForRef: async (ref) => {
      const descriptions = await Promise.all([...merged.entries()].map(async ([moduleId, handler]) => ({
        moduleId,
        description: await handler.describe(),
      })));
      return descriptions.find(({ description }) =>
        description.resources?.some((resource) => ref.startsWith(resource.refPrefix)),
      )?.moduleId;
    },
  };
}

export function createRuntimeModuleDispatcher(registry = createRuntimeModuleRegistry()): RuntimeModuleDispatcher {
  let traceCounter = 0;
  let traceSteps: ModulePipelineTraceStep[] = [];

  async function dispatch(
    moduleId: string,
    functionName: ModuleFunctionName,
    input: unknown,
    run: (handler: RuntimeModuleHandler, description: ModuleDescription) => Promise<ModuleResultEnvelope>,
  ): Promise<ModuleResultEnvelope> {
    const startedAtMs = Date.now();
    const step: ModulePipelineTraceStep = {
      id: `module-step-${++traceCounter}`,
      moduleId,
      functionName,
      status: 'started',
      startedAt: new Date(startedAtMs).toISOString(),
      inputSummary: summarizeForTrace(input),
    };
    if (isRecord(input)) {
      if (typeof input.intent === 'string') step.intent = input.intent;
      if (typeof input.query === 'string') step.query = input.query;
      if (typeof input.ref === 'string') step.ref = input.ref;
      if (typeof input.traceParent === 'string') step.parentId = input.traceParent;
    }
    traceSteps.push(step);

    const finish = (result: ModuleResultEnvelope, status?: ModulePipelineTraceStep['status']) => {
      const completedAtMs = Date.now();
      const completed: ModulePipelineTraceStep = {
        ...step,
        status: status ?? traceStatusForResult(result),
        completedAt: new Date(completedAtMs).toISOString(),
        timing: { durationMs: Math.max(0, completedAtMs - startedAtMs) },
        resultSummary: summarizeForTrace(result.value ?? result.error ?? result.approvalRequest),
        refs: result.refs,
        operationRef: result.operationRef,
        approval: result.approvalRequest,
      };
      traceSteps = traceSteps.map((entry) => entry.id === step.id ? completed : entry);
      return result;
    };

    const handler = registry.get(moduleId);
    if (!handler) {
      return finish(fail(moduleId, `module_not_found:${moduleId}`), 'failed');
    }
    const description = await handler.describe();
    if (!moduleSupportsFunction(description, functionName)) {
      return finish(fail(moduleId, `unsupported_function:${functionName}`), 'failed');
    }

    try {
      return finish(await run(handler, description));
    } catch (error) {
      return finish(fail(moduleId, `module_error:${errorMessage(error)}`), 'failed');
    }
  }

  return {
    async describe(request = {}) {
      const moduleId = request.moduleId;
      if (moduleId) {
        return dispatch(moduleId, 'describe', request, async (_handler, description) =>
          moduleResult({ moduleId, ok: true, value: description }),
        );
      }
      const descriptions = await registry.descriptions();
      return moduleResult({
        moduleId: 'registry',
        ok: true,
        value: {
          modules: descriptions,
          moduleIds: descriptions.map((description) => description.moduleId),
        },
      });
    },
    async query(request) {
      return dispatch(request.moduleId, 'query', request, async (handler) => {
        if (!handler.query) return fail(request.moduleId, 'unsupported_function:query');
        return envelopeFromHandlerResult(request.moduleId, await handler.query(request));
      });
    },
    async read(request) {
      const moduleId = request.moduleId ?? await registry.resolveModuleIdForRef(request.ref);
      if (!moduleId) return moduleResult({ moduleId: 'registry', ok: false, error: `unroutable_ref:${request.ref}` });
      return dispatch(moduleId, 'read', request, async (handler) => {
        if (!handler.read) return fail(moduleId, 'unsupported_function:read');
        return envelopeFromHandlerResult(moduleId, await handler.read({ ...request, moduleId }));
      });
    },
    async invoke(request) {
      return dispatch(request.moduleId, 'invoke', request, async (handler, description) => {
        const intent = moduleIntent(description, request.intent);
        if (!intent) return fail(request.moduleId, `unsupported_intent:${request.intent}`);
        if (moduleIntentRequiresApproval(description, request.intent) && !request.approvalToken) {
          return moduleResult({
            moduleId: request.moduleId,
            ok: false,
            approvalRequest: {
              moduleId: request.moduleId,
              intent: request.intent,
              sideEffect: intent.sideEffect,
              reason: 'approval_required',
            },
            error: `approval_required:${request.intent}`,
          });
        }
        if (!handler.invoke) return fail(request.moduleId, 'unsupported_function:invoke');
        return envelopeFromHandlerResult(request.moduleId, await handler.invoke(request));
      });
    },
    trace: () => traceSteps.map((step) => ({ ...step })),
    clearTrace: () => {
      traceSteps = [];
      traceCounter = 0;
    },
  };
}

function describeOnlyModuleHandler(description: ModuleDescription): RuntimeModuleHandler {
  return { describe: () => description };
}

function defaultModuleDescription(moduleId: RuntimeModuleId): ModuleDescription {
  if (moduleId === 'gui') {
    return createModuleDescription({
      moduleId,
      title: 'GUI',
      summary: 'Presentation-only GUI module alias for semantic resources and local presentation intents.',
      resources: [{ kind: 'gui-resource', refPrefix: 'gui:', queryable: true, readable: true }],
      intents: [
        { name: 'present', sideEffect: 'local' },
        { name: 'ask_user', sideEffect: 'local' },
        { name: 'notify', sideEffect: 'local' },
        { name: 'set_status', sideEffect: 'local' },
        { name: 'apply_batch', sideEffect: 'local' },
        { name: 'watch', sideEffect: 'none', returnsOperation: true },
      ],
      facets: { refs: true, events: true, subscription: true, batch: true },
      limits: { maxInlineBytes: 64_000, expectedLatencyMs: 100 },
    });
  }
  if (moduleId === 'skills') {
    return createModuleDescription({
      moduleId,
      title: 'Skills',
      summary: 'Read-only skill catalog resource; execution remains an Agent Host native skill/tool decision.',
      resources: [{ kind: 'skill', refPrefix: 'skill:', queryable: true, readable: true }],
      facets: { refs: true },
      limits: { maxInlineBytes: 32_000, expectedLatencyMs: 100 },
    });
  }
  if (moduleId === 'memory') {
    return createModuleDescription({
      moduleId,
      title: 'Memory',
      summary: 'Project, session, and user memory resource surface with explicit mutation intents.',
      resources: [{ kind: 'memory', refPrefix: 'memory:', queryable: true, readable: true }],
      intents: [
        { name: 'write', sideEffect: 'workspace', requiresApproval: true },
        { name: 'update', sideEffect: 'workspace', requiresApproval: true },
        { name: 'forget', sideEffect: 'workspace', requiresApproval: true },
      ],
      facets: { refs: true, approval: true },
      limits: { maxInlineBytes: 32_000, expectedLatencyMs: 100 },
    });
  }
  if (moduleId === 'capabilities') {
    return createModuleDescription({
      moduleId,
      title: 'Capabilities',
      summary: 'Capability discovery resource for search, explain, plan, and expansion without execution.',
      resources: [{ kind: 'capability', refPrefix: 'capability:', queryable: true, readable: true }],
      intents: [
        { name: 'search', sideEffect: 'none' },
        { name: 'explain', sideEffect: 'none' },
        { name: 'plan', sideEffect: 'none' },
        { name: 'expand', sideEffect: 'none' },
      ],
      facets: { refs: true },
      limits: { maxInlineBytes: 64_000, expectedLatencyMs: 200 },
    });
  }
  if (moduleId === 'actions') {
    return createModuleDescription({
      moduleId,
      title: 'Actions',
      summary: [
        'Action provider boundary for host-executed side effects.',
        'Computer Use is exposed here as an L1 resource/session adapter whose L0 handler intents are selected by the Agent Host inside actions.execute input, not by GUI routes.',
        'Supported Computer Use L0 handler intents: observe, capture, ground, propose_scoped_action, execute_scoped_action, verify, write_trace, emit_event.',
      ].join(' '),
      resources: [
        { kind: 'action', refPrefix: 'action:', queryable: true, readable: true },
        { kind: 'computer-use-session', refPrefix: 'computer-use:session:', queryable: true, readable: true },
        { kind: 'computer-use-evidence', refPrefix: 'computer-use:evidence:', queryable: true, readable: true },
        { kind: 'computer-use-replay', refPrefix: 'computer-use:replay:', queryable: true, readable: true },
      ],
      intents: [{
        name: 'execute',
        sideEffect: 'workspace',
        requiresApproval: true,
        returnsOperation: true,
        summary: 'Canonical module.invoke intent for Computer Use L1 action execution; mutating L0 desktop input requires scoped lease/provenance/approval and returns operation/evidence/replay refs.',
      }],
      facets: { refs: true, approval: true, events: true },
      limits: { maxInlineBytes: 16_000, expectedLatencyMs: 500 },
    });
  }
  const staticDescriptions: Record<Exclude<RuntimeModuleId, 'gui' | 'skills' | 'memory' | 'capabilities' | 'actions'>, {
    title: string;
    summary: string;
    kind: string;
    refPrefix: string;
  }> = {
    browser: {
      title: 'Browser',
      summary: 'Browser observation and interaction module boundary.',
      kind: 'browser-resource',
      refPrefix: 'browser:',
    },
    verifier: {
      title: 'Verifier',
      summary: 'Verification result and verifier operation module boundary.',
      kind: 'verification',
      refPrefix: 'verifier:',
    },
    artifacts: {
      title: 'Artifacts',
      summary: 'Artifact metadata and reusable object references.',
      kind: 'artifact',
      refPrefix: 'artifact:',
    },
  };
  const current = staticDescriptions[moduleId];
  return createModuleDescription({
    moduleId,
    title: current.title,
    summary: current.summary,
    resources: [{ kind: current.kind, refPrefix: current.refPrefix, queryable: true, readable: true }],
    facets: { refs: true },
    limits: { maxInlineBytes: 64_000, expectedLatencyMs: 100 },
  });
}

function envelopeFromHandlerResult<T>(moduleId: string, value: unknown): ModuleResultEnvelope<T> {
  if (isModuleEnvelope(value)) return value as ModuleResultEnvelope<T>;
  return moduleResult({ moduleId, ok: true, value: value as T });
}

function fail(moduleId: string, error: string): ModuleResultEnvelope {
  return moduleResult({ moduleId, ok: false, error: scrubTraceText(error) });
}

function traceStatusForResult(result: ModuleResultEnvelope): ModulePipelineTraceStep['status'] {
  if (result.approvalRequest) return 'approval-required';
  return result.ok ? 'completed' : 'failed';
}

function isModuleEnvelope(value: unknown): value is ModuleResultEnvelope {
  return isRecord(value)
    && value.schemaVersion === 'sciforge.module-contract.v1'
    && typeof value.moduleId === 'string'
    && typeof value.ok === 'boolean';
}

function summarizeForTrace(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? {});
  return scrubTraceText(text.length > 320 ? `${text.slice(0, 280)}...${text.slice(-24)}` : text);
}

export function scrubTraceText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted-secret]')
    .replace(/\b(api[_-]?key|token|secret|password|authorization)=([^&\s]+)/gi, '$1=[redacted-secret]')
    .replace(/https?:\/\/[^\s"')]+/gi, '[redacted-url]');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
