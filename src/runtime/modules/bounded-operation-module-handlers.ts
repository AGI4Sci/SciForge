import {
  EXECUTE_BOUNDED_OPERATION_INTENT,
  boundedOperationResult,
  createModuleDescription,
  moduleResult,
  validateBoundedOperationRequest,
  type BoundedOperationRequestInput,
  type BoundedOperationResultInput,
  type ModuleDescription,
  type ModuleInvokeRequest,
} from '@sciforge-ui/runtime-contract/modules';
import {
  defaultBrowserHostSessionManager,
  type BrowserHostOpenReadInput,
  type BrowserHostSearchInput,
  type BrowserHostSessionManager,
} from '../browser-host-session.js';
import type { RuntimeModuleHandler } from './dispatcher.js';

export interface BrowserReadEvidence {
  sourceRefs: string[];
  pageTextRefs: string[];
  searchResultRefs?: string[];
  sourcePages?: unknown[];
}

export interface BrowserBoundedOperationPorts {
  searchRead?(input: BoundedOperationRequestInput): Promise<BrowserReadEvidence> | BrowserReadEvidence;
  openRead?(input: BoundedOperationRequestInput): Promise<BrowserReadEvidence> | BrowserReadEvidence;
  workspacePath?: string;
  manager?: BrowserHostSessionManager;
}

export interface ComputerUseActionEvidence {
  beforeEvidenceRef?: string;
  groundingRefs?: string[];
  executorEventRef?: string;
  afterEvidenceRef?: string;
  staleInvalidationRefs?: string[];
}

export interface ComputerUseBoundedOperationPorts {
  modelRouterCandidate?(
    input: BoundedOperationRequestInput,
  ): Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
  executeLocalAction?(input: BoundedOperationRequestInput): Promise<ComputerUseActionEvidence> | ComputerUseActionEvidence;
  fillFields?(input: BoundedOperationRequestInput): Promise<ComputerUseActionEvidence> | ComputerUseActionEvidence;
}

export function createBrowserBoundedOperationModuleHandler(ports: BrowserBoundedOperationPorts = {}): RuntimeModuleHandler {
  return {
    describe: browserModuleDescription,
    invoke: async (request) => {
      const parsed = parseBoundedOperationRequest('browser', request);
      if (!parsed.ok) return parsed.result;
      const input = parsed.input;
      const budgetBlock = exhaustedBudgetResult('browser', input);
      if (budgetBlock) return budgetBlock;
      const allowedBlock = browserAllowedActionBlock(input);
      if (allowedBlock) {
        return boundedOperationResult({
          moduleId: 'browser',
          operationKind: input.operationKind,
          status: 'blocked',
          blockedReason: allowedBlock,
          repairHint: 'Ask the Host to declare only the bounded Browser actions this operation may perform.',
        });
      }
      const evidence = input.operationKind === 'browser.search_read'
        ? await (ports.searchRead?.(input) ?? browserSearchReadWithManager(ports, input))
        : input.operationKind === 'browser.open_read'
          ? await (ports.openRead?.(input) ?? browserOpenReadWithManager(ports, input))
          : undefined;
      if (!evidence) {
        return boundedOperationResult({
          moduleId: 'browser',
          operationKind: input.operationKind,
          status: 'blocked',
          blockedReason: `unsupported_operation_kind:${input.operationKind}`,
          repairHint: 'Ask the Host to invoke browser.search_read or browser.open_read inside a bounded operation.',
        });
      }
      const sourceRefs = uniqueStrings(evidence.sourceRefs);
      const pageTextRefs = uniqueStrings(evidence.pageTextRefs);
      const evidenceRefs = uniqueStrings([...sourceRefs, ...pageTextRefs]);
      const missing = missingRequiredEvidence(input, {
        'source-page-ref': sourceRefs,
        'page-text-ref': pageTextRefs,
      });
      return boundedOperationResult({
        moduleId: 'browser',
        operationKind: input.operationKind,
        status: missing.length ? 'blocked' : 'completed',
        sourceRefs,
        evidenceRefs,
        value: { sourcePages: evidence.sourcePages ?? [] },
        blockedReason: missing.length ? `missing_required_evidence:${missing.join(',')}` : undefined,
        repairHint: missing.length ? 'Open and read actual source pages in the current run before synthesizing an answer.' : undefined,
      });
    },
  };
}

async function browserSearchReadWithManager(
  ports: BrowserBoundedOperationPorts,
  input: BoundedOperationRequestInput,
): Promise<BrowserReadEvidence | undefined> {
  if (!ports.workspacePath) return undefined;
  const query = string(input.targetScope.query);
  if (!query) return undefined;
  const manager = ports.manager ?? defaultBrowserHostSessionManager();
  const output = await manager.search(ports.workspacePath, browserSearchInput(input, query));
  const readSourcePages = (output.sourcePages ?? []).filter((page) => page.status === 'read' && page.textRef);
  const pageTextRefs = uniqueStrings(readSourcePages.map((page) => page.textRef));
  const sourceRefs = uniqueStrings(readSourcePages.map((page) => page.sourcePageRef ?? browserSourcePageRef(page.textRef)));
  return {
    sourceRefs,
    pageTextRefs,
    searchResultRefs: output.searchResultRef ? [output.searchResultRef] : [],
    sourcePages: readSourcePages,
  };
}

async function browserOpenReadWithManager(
  ports: BrowserBoundedOperationPorts,
  input: BoundedOperationRequestInput,
): Promise<BrowserReadEvidence | undefined> {
  if (!ports.workspacePath) return undefined;
  const url = browserOpenReadUrl(input);
  if (!url) return undefined;
  const manager = ports.manager ?? defaultBrowserHostSessionManager();
  const output = await manager.openRead(ports.workspacePath, browserOpenReadInput(input, url));
  const readSourcePages = output.sourcePage.status === 'read' && output.sourcePage.textRef
    ? [output.sourcePage]
    : [];
  const sourceRefs = uniqueStrings(readSourcePages.map((page) => page.sourcePageRef ?? browserSourcePageRef(page.textRef)));
  const pageTextRefs = uniqueStrings(readSourcePages.map((page) => page.textRef));
  return {
    sourceRefs,
    pageTextRefs,
    sourcePages: readSourcePages,
  };
}

function browserOpenReadUrl(input: BoundedOperationRequestInput): string | undefined {
  return string(input.targetScope.url)
    ?? string(input.targetScope.href)
    ?? string(input.targetScope.targetUrl);
}

function browserSourcePageRef(textRef: string | undefined): string | undefined {
  if (!textRef) return undefined;
  return textRef.replace(/(?:-[a-f0-9]{10})?\.txt$/i, '.source.json');
}

function browserAllowedActionBlock(input: BoundedOperationRequestInput): string | undefined {
  const required = input.operationKind === 'browser.search_read'
    ? ['search', 'open', 'read']
    : input.operationKind === 'browser.open_read'
      ? ['open', 'read']
      : [];
  const missing = required.find((action) => !input.config.allowedActions.includes(action));
  return missing ? `action_not_allowed:${missing}` : undefined;
}

function browserSearchInput(input: BoundedOperationRequestInput, query: string): BrowserHostSearchInput {
  return {
    query,
    limit: numericBudget(input.config.maxSteps, 1, 10),
    sourcePageLimit: numericBudget(input.config.maxSteps, 0, 5),
    timeoutMs: numericBudget(input.config.maxTimeMs, 1_000, 120_000),
  };
}

function browserOpenReadInput(input: BoundedOperationRequestInput, url: string): BrowserHostOpenReadInput {
  return {
    url,
    sessionId: string(input.targetScope.sessionId),
    title: string(input.targetScope.title),
    timeoutMs: numericBudget(input.config.maxTimeMs, 1_000, 120_000),
  };
}

export function createComputerUseBoundedOperationModuleHandler(
  ports: ComputerUseBoundedOperationPorts = {},
): RuntimeModuleHandler {
  return {
    describe: computerUseModuleDescription,
    invoke: async (request) => {
      const parsed = parseBoundedOperationRequest('computer_use', request);
      if (!parsed.ok) return parsed.result;
      const input = parsed.input;
      const budgetBlock = exhaustedBudgetResult('computer_use', input);
      if (budgetBlock) return budgetBlock;
      if (!['computer_use.perform_local_action', 'computer_use.fill_fields'].includes(input.operationKind)) {
        return blockedComputerUse(input, `unsupported_operation_kind:${input.operationKind}`);
      }

      const actualActionKind = computerUseActualActionKind(input);
      if (actualActionKind && !input.config.allowedActions.includes(actualActionKind)) {
        return blockedComputerUse(input, `action_not_allowed:${actualActionKind}`);
      }

      const modelRouterCandidate = record(input, 'modelRouterCandidate') ?? await ports.modelRouterCandidate?.(input);
      const candidateBlock = computerUseCandidatePolicyBlock(input, modelRouterCandidate);
      if (candidateBlock) return blockedComputerUse(input, candidateBlock);

      if (!hasTargetBinding(input)) {
        return blockedComputerUse(input, 'missing_target_binding', 'Bind a current native target scope before executing Computer Use.');
      }

      const targetEvidence = computerUseTargetEvidence(input);
      const targetEvidenceRefs = computerUseTargetEvidenceRefs(targetEvidence);
      const missingTargetEvidence = missingRequiredEvidence(input, {
        'native-host-ref': targetEvidence.nativeHostRefs,
        'permission-ref': targetEvidence.permissionRefs,
        'scoped-executor-ref': targetEvidence.scopedExecutorRefs,
        'stop-cancel-ref': targetEvidence.stopCancelRefs,
      });
      if (missingTargetEvidence.length) {
        return blockedComputerUse(
          input,
          `missing_required_evidence:${missingTargetEvidence.join(',')}`,
          'Provide current native host, permission refs, scoped executor, and stop/cancel path before retrying.',
          targetEvidenceRefs,
        );
      }

      if (requiresConfirmation(input) && !request.approvalToken) {
        return boundedOperationResult({
          moduleId: 'computer_use',
          operationKind: input.operationKind,
          status: 'needs-confirmation',
          evidenceRefs: targetEvidenceRefs,
          approvalRequest: {
            moduleId: 'computer_use',
            intent: EXECUTE_BOUNDED_OPERATION_INTENT,
            operationKind: input.operationKind,
            reason: 'confirmation_required',
          },
          blockedReason: 'confirmation_required',
          repairHint: 'Collect explicit user confirmation, then retry with the Host approval token.',
        });
      }

      const run = input.operationKind === 'computer_use.fill_fields' ? ports.fillFields : ports.executeLocalAction;
      const evidence = await run?.(input);
      if (!evidence) return blockedComputerUse(input, 'missing_executor_port', undefined, targetEvidenceRefs);

      const beforeEvidenceRef = computerUseRef(evidence.beforeEvidenceRef, 'computer-use:evidence:');
      const groundingRefs = computerUseRefs(evidence.groundingRefs, 'computer-use:grounding:');
      const executorEventRef = computerUseRef(evidence.executorEventRef, 'computer-use:executor:');
      const afterEvidenceRef = computerUseRef(evidence.afterEvidenceRef, 'computer-use:evidence:');
      const staleInvalidationRefs = computerUseRefs(evidence.staleInvalidationRefs, 'computer-use:evidence:');
      const evidenceRefs = uniqueStrings([
        ...targetEvidenceRefs,
        beforeEvidenceRef,
        ...groundingRefs,
        executorEventRef,
        afterEvidenceRef,
        ...staleInvalidationRefs,
      ]);
      const missing = missingRequiredEvidence(input, {
        'native-host-ref': targetEvidence.nativeHostRefs,
        'permission-ref': targetEvidence.permissionRefs,
        'scoped-executor-ref': targetEvidence.scopedExecutorRefs,
        'stop-cancel-ref': targetEvidence.stopCancelRefs,
        'before-evidence-ref': beforeEvidenceRef ? [beforeEvidenceRef] : [],
        'grounding-ref': groundingRefs,
        'executor-event-ref': executorEventRef ? [executorEventRef] : [],
        'after-evidence-ref': afterEvidenceRef ? [afterEvidenceRef] : [],
        'stale-invalidation-ref': staleInvalidationRefs,
      });
      return boundedOperationResult({
        moduleId: 'computer_use',
        operationKind: input.operationKind,
        status: missing.length ? 'blocked' : 'completed',
        evidenceRefs,
        actionRefs: executorEventRef ? [executorEventRef] : [],
        blockedReason: missing.length ? `missing_required_evidence:${missing.join(',')}` : undefined,
        repairHint: missing.length ? 'Refresh target-bound evidence and rerun the scoped local action.' : undefined,
      });
    },
  };
}

function browserModuleDescription(): ModuleDescription {
  return createModuleDescription({
    moduleId: 'browser',
    title: 'Browser',
    summary: 'Bounded browser read module; Host owns source choice, answer synthesis, completion truth, and repair.',
    resources: [
      { kind: 'browser-source-page', refPrefix: 'browser:source-page:', queryable: false, readable: true },
      { kind: 'browser-page-text', refPrefix: 'browser:page-text:', queryable: false, readable: true },
    ],
    intents: [
      {
        name: EXECUTE_BOUNDED_OPERATION_INTENT,
        sideEffect: 'local',
        returnsOperation: true,
        summary: 'Typed module.invoke intent for browser.search_read and browser.open_read only.',
      },
    ],
    facets: { refs: true },
    limits: { maxInlineBytes: 16_000, expectedLatencyMs: 500 },
  });
}

function computerUseModuleDescription(): ModuleDescription {
  return createModuleDescription({
    moduleId: 'computer_use',
    title: 'Computer Use',
    summary: 'Bounded local GUI action module; Host owns task plan, confirmation, completion truth, repair, and final answer.',
    resources: [
      { kind: 'computer-use-evidence', refPrefix: 'computer-use:evidence:', queryable: false, readable: true },
      { kind: 'computer-use-grounding', refPrefix: 'computer-use:grounding:', queryable: false, readable: true },
      { kind: 'computer-use-executor-event', refPrefix: 'computer-use:executor:', queryable: false, readable: true },
    ],
    intents: [
      {
        name: EXECUTE_BOUNDED_OPERATION_INTENT,
        sideEffect: 'local',
        returnsOperation: true,
        summary: 'Typed module.invoke intent for computer_use.perform_local_action and computer_use.fill_fields only.',
      },
    ],
    facets: { refs: true, approval: true, events: true },
    limits: { maxInlineBytes: 16_000, expectedLatencyMs: 500 },
  });
}

function parseBoundedOperationRequest(moduleId: string, request: ModuleInvokeRequest):
  | { ok: true; input: BoundedOperationRequestInput }
  | { ok: false; result: ReturnType<typeof moduleResult> } {
  const validation = validateBoundedOperationRequest(request);
  if (!validation.ok) {
    return {
      ok: false,
      result: moduleResult({ moduleId, ok: false, error: validation.errors.join(';') }),
    };
  }
  return { ok: true, input: request.input as unknown as BoundedOperationRequestInput };
}

function missingRequiredEvidence(input: BoundedOperationRequestInput, refsByRequirement: Record<string, string[]>) {
  return input.config.requiredEvidence.filter((requirement) => (
    requirement in refsByRequirement && !refsByRequirement[requirement]?.length
  ));
}

function computerUseCandidatePolicyBlock(
  input: BoundedOperationRequestInput,
  candidate: Record<string, unknown> | undefined,
): string | undefined {
  if (!candidate) return undefined;
  const action = record(candidate, 'action');
  const actionKind = string(action?.kind);
  if (actionKind && !input.config.allowedActions.includes(actionKind)) {
    return `candidate_action_not_allowed:${actionKind}`;
  }
  if (candidate.riskPolicy !== undefined && candidate.riskPolicy !== input.config.riskPolicy) {
    return 'candidate_risk_policy_change_forbidden';
  }
  if (recordContainsAnyKey(candidate, ['finalAnswer', 'completionTruth'])) {
    return 'candidate_completion_boundary_forbidden';
  }
  if (candidateCrossModuleNextStep(input, candidate)) {
    return 'candidate_cross_module_next_step_forbidden';
  }
  if (recordContainsAnyKey(candidate, ['approvalToken', 'bypassConfirmation', 'confirmationBypass'])) {
    return 'candidate_confirmation_bypass_forbidden';
  }
  if (recordContainsAnyKey(candidate, ['autoRepair', 'retryWith', 'repairAction'])) {
    return 'candidate_auto_repair_forbidden';
  }
  if (candidateExecutableBinding(candidate)) {
    return 'candidate_executable_binding_forbidden';
  }
  if (action && !record(input, 'action')) {
    return 'candidate_action_requires_host_binding';
  }
  if (candidateFreshEvidenceInvalid(candidate)) {
    return 'candidate_fresh_evidence_invalid';
  }
  return undefined;
}

function candidateCrossModuleNextStep(
  input: BoundedOperationRequestInput,
  candidate: Record<string, unknown>,
) {
  const candidateOwners = [
    string(candidate.moduleId),
    string(candidate.ownerModuleId),
    string(record(candidate, 'nextStep')?.moduleId),
    string(record(candidate, 'nextStep')?.ownerModuleId),
    string(record(candidate, 'nextIntent')?.moduleId),
    string(record(candidate, 'nextIntent')?.ownerModuleId),
  ].filter((value): value is string => Boolean(value));
  return candidateOwners.some((owner) => owner !== input.ownerModuleId);
}

function candidateExecutableBinding(candidate: Record<string, unknown>) {
  const executableBindingKeys = [
    'targetBindingRef',
    'windowRef',
    'inputLeaseRef',
    'inputLeaseRefs',
    'coordinates',
    'coordinate',
    'screenPoint',
    'writeFile',
    'fileWrite',
    'filePath',
  ];
  return recordContainsAnyKey(candidate, executableBindingKeys);
}

function candidateFreshEvidenceInvalid(candidate: Record<string, unknown>) {
  const freshness = record(candidate, 'freshness');
  const freshnessStatus = string(freshness?.status);
  const refs = candidateEvidenceRefs(candidate);
  if (freshnessStatus && freshnessStatus !== 'current') return true;
  if (refs.length && freshnessStatus !== 'current') return true;
  return refs.some((ref) => !computerUseRef(ref, 'computer-use:evidence:'));
}

function candidateEvidenceRefs(candidate: Record<string, unknown>) {
  return uniqueStrings([
    ...stringList(candidate.evidenceRef),
    ...stringList(candidate.evidenceRefs),
    ...stringList(candidate.freshEvidenceRef),
    ...stringList(candidate.freshEvidenceRefs),
    ...stringList(candidate.beforeEvidenceRef),
    ...stringList(candidate.beforeEvidenceRefs),
    ...stringList(candidate.afterEvidenceRef),
    ...stringList(candidate.afterEvidenceRefs),
  ]);
}

function recordContainsAnyKey(record: Record<string, unknown>, keys: string[]): boolean {
  const wanted = new Set(keys);
  const visit = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(visit);
    return Object.entries(value as Record<string, unknown>).some(([key, child]) => wanted.has(key) || visit(child));
  };
  return visit(record);
}

function computerUseActualActionKind(input: BoundedOperationRequestInput): string | undefined {
  const action = record(input, 'action');
  return string(action?.kind);
}

function exhaustedBudgetResult(moduleId: string, input: BoundedOperationRequestInput) {
  const exhausted = [
    input.config.maxSteps === 0 ? 'maxSteps' : undefined,
    input.config.maxTimeMs === 0 ? 'maxTimeMs' : undefined,
    input.config.maxModelCalls === 0 ? 'maxModelCalls' : undefined,
  ].filter((value): value is string => Boolean(value));
  if (!exhausted.length) return undefined;
  return boundedOperationResult({
    moduleId,
    operationKind: input.operationKind,
    status: 'blocked',
    blockedReason: `budget_exhausted:${exhausted.join(',')}`,
    repairHint: 'Ask the Host for a nonzero explicit bounded operation budget.',
    budgets: {
      maxSteps: input.config.maxSteps,
      maxTimeMs: input.config.maxTimeMs,
      maxModelCalls: input.config.maxModelCalls,
      exhausted,
    },
  });
}

function hasTargetBinding(input: BoundedOperationRequestInput) {
  return Boolean(string(input.targetScope.targetBindingRef) || string(input.targetScope.windowRef));
}

function computerUseTargetEvidence(input: BoundedOperationRequestInput) {
  return {
    nativeHostRefs: computerUseRefs(scopeRefs(input.targetScope, ['nativeHostRef', 'nativeHostRefs']), 'computer-use:native-host'),
    permissionRefs: computerUseRefs(scopeRefs(input.targetScope, ['permissionRef', 'permissionRefs']), 'computer-use:permission'),
    scopedExecutorRefs: computerUseRefs(scopeRefs(input.targetScope, ['scopedExecutorRef', 'scopedExecutorRefs']), 'computer-use:executor-scope'),
    stopCancelRefs: computerUseRefs(scopeRefs(input.targetScope, [
      'stopCancelRef',
      'stopCancelRefs',
      'stopCancelPathRef',
      'stopCancelPathRefs',
      'stopPathRef',
      'cancelPathRef',
    ]), 'computer-use:stop-cancel'),
  };
}

function computerUseTargetEvidenceRefs(evidence: ReturnType<typeof computerUseTargetEvidence>) {
  return uniqueStrings([
    ...evidence.nativeHostRefs,
    ...evidence.permissionRefs,
    ...evidence.scopedExecutorRefs,
    ...evidence.stopCancelRefs,
  ]);
}

function scopeRefs(scope: Record<string, unknown>, fields: string[]) {
  return fields.flatMap((field) => stringList(scope[field]));
}

function computerUseRefs(values: unknown, prefix: string) {
  return uniqueStrings(stringList(values).map((value) => computerUseRef(value, prefix)));
}

function computerUseRef(value: unknown, prefix: string) {
  const ref = string(value);
  if (!ref || forbiddenComputerUseEvidenceRef(ref)) return undefined;
  return ref.startsWith(prefix) ? ref : undefined;
}

function forbiddenComputerUseEvidenceRef(ref: string) {
  return /^(?:data:|raw:|fixture:|history:|replay:|gui-projection:)/i.test(ref)
    || /;base64\b/i.test(ref);
}

function requiresConfirmation(input: BoundedOperationRequestInput) {
  const action = record(input, 'action');
  return input.config.riskPolicy === 'confirmation-required'
    || string(action?.risk) === 'high'
    || string(action?.kind) === 'submit';
}

function blockedComputerUse(
  input: BoundedOperationRequestInput,
  blockedReason: string,
  repairHint = 'Provide current target binding, fresh evidence, allowed action, and scoped executor before retrying.',
  evidenceRefs: string[] = [],
) {
  return boundedOperationResult({
    moduleId: 'computer_use',
    operationKind: input.operationKind,
    status: 'blocked',
    evidenceRefs,
    blockedReason,
    repairHint,
  });
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim()))];
}

function record(parent: unknown, key: string) {
  if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return undefined;
  const value = (parent as Record<string, unknown>)[key];
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function string(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => string(entry) ? [string(entry) as string] : []);
  const single = string(value);
  return single ? [single] : [];
}

function numericBudget(value: number, min: number, max: number) {
  const numeric = Math.floor(value);
  return Math.max(min, Math.min(max, numeric));
}
