import { sanitizePublicEvent } from '@sciforge-ui/runtime-contract/public-event-sanitizer';
import {
  createComputerUseAppModuleRegistry,
  validateComputerUseAppModuleReadiness,
  type ComputerUseAppModule,
  type ComputerUseAppModulePrimitiveCandidate,
  type ComputerUseAppModuleReadiness,
} from './computer-use-app-module-registry.js';
import { createVSCodeAppModule } from './vscode-app-module.js';
import type {
  CodexAgentHostComputerUseActMaterializer,
  CodexAgentHostComputerUseActMaterializerInput,
  CodexAgentHostComputerUseActMaterializerResult,
} from './agent-host-turn-loop.js';

const TOOL_ID = 'computer-use.app-module-registry';

interface StructuredAppModuleOperation {
  operation: string;
  operationRef?: string;
}

export function createDefaultComputerUseAppModuleMaterializer(options: {
  modules?: readonly ComputerUseAppModule[];
} = {}): CodexAgentHostComputerUseActMaterializer {
  const registry = createComputerUseAppModuleRegistry(options.modules ?? [createVSCodeAppModule()]);

  return (input) => {
    const refs = collectAppModuleRefs(input);
    const hostOperation = structuredAppModuleOperation(input, refs);
    if (!hostOperation) {
      if (!hasComputerUseAppModuleMarker(input, refs)) return undefined;
      return readinessResult(input, {
        status: 'blocked',
        reasonRef: 'blocked:computer-use-app-module:operation-ref-required',
        evidenceRefs: [
          'blocked:computer-use-app-module:operation-ref-required',
          ...refs,
        ],
      }, {
        operation: 'operation-required',
        moduleId: undefined,
        candidateModuleIds: [],
      });
    }
    const { operation, operationRef } = hostOperation;
    const moduleMatch = registry.resolve({ refs });
    if (moduleMatch.status === 'blocked') {
      return readinessResult(input, {
        status: 'blocked',
        reasonRef: moduleMatch.reasonRef,
        evidenceRefs: [
          moduleMatch.reasonRef,
          ...moduleMatch.candidateModuleIds.map((moduleId) => `runtime-truth:computer-use-app-module/candidate/${safeToken(moduleId) || 'module'}`),
          ...refs,
        ],
      }, {
        operation,
        moduleId: undefined,
        candidateModuleIds: moduleMatch.candidateModuleIds,
      });
    }

    const readiness = validateComputerUseAppModuleReadiness(moduleMatch.module.checkReadiness({
      operation,
      operationRef,
      refs,
    }));
    return readinessResult(input, readiness, {
      operation,
      moduleId: moduleMatch.module.moduleId,
      candidateModuleIds: moduleMatch.candidateModuleIds,
    });
  };
}

export function hasStructuredComputerUseAppModuleOperation(input: CodexAgentHostComputerUseActMaterializerInput): boolean {
  return structuredAppModuleOperation(input, collectAppModuleRefs(input)) !== undefined;
}

function readinessResult(
  input: CodexAgentHostComputerUseActMaterializerInput,
  readiness: ComputerUseAppModuleReadiness,
  context: {
    operation: string;
    moduleId: string | undefined;
    candidateModuleIds: string[];
  },
): CodexAgentHostComputerUseActMaterializerResult {
  const refs = appModuleEvidenceRefs([
    `runtime-truth:computer-use-app-module/${safeToken(context.moduleId) || 'unresolved'}/${safeToken(context.operation) || 'operation'}`,
    ...readiness.evidenceRefs,
    readiness.status !== 'ready' ? readiness.reasonRef : undefined,
  ]);
  const outputRef = refs[0] ?? `runtime-truth:computer-use-app-module/${safeToken(context.operation) || 'operation'}`;
  if (readiness.status === 'ready') {
    return sanitizeReadinessResult({
      status: 'completed',
      message: 'Computer Use app module selected one Host-requested primitive candidate from current refs.',
      confidence: 0.76,
      claimType: 'computer-use-app-module-primitive-candidate',
      reasoningTrace: 'Agent Host supplied one structured operation and current-run refs; the app module returned one primitive candidate. Computer Use core did not plan the task and no user-level completion truth was produced.',
      evidenceRefs: refs,
      executionUnits: [executionUnit(input, 'candidate', outputRef, context, readiness.primitive)],
      artifacts: [readinessArtifact(input, readiness, context, refs)],
      claims: [{
        id: `claim-computer-use-app-module-${safeToken(input.attemptId) || 'attempt'}`,
        type: 'runtime-action-candidate',
        text: 'Agent Host received one refs-first Computer Use primitive candidate from a Host-side app module.',
        confidence: 0.76,
        evidenceLevel: 'runtime',
        supportingRefs: refs.slice(0, 12),
        opposingRefs: [],
      }],
    });
  }
  return sanitizeReadinessResult({
    status: readiness.status,
    message: readiness.status === 'needs-confirmation'
      ? 'Computer Use app module needs Host target confirmation before returning a primitive candidate.'
      : 'Computer Use app module blocked before returning a primitive candidate.',
    confidence: readiness.status === 'needs-confirmation' ? 0.72 : 0.68,
    claimType: readiness.status === 'needs-confirmation'
      ? 'computer-use-app-module-needs-confirmation'
      : 'computer-use-app-module-blocked',
    reasoningTrace: 'Agent Host stopped at the app module readiness gate; no Computer Use primitive was executed and no user-level completion truth was produced.',
    evidenceRefs: refs.length ? refs : [outputRef],
    executionUnits: [executionUnit(input, readiness.status, outputRef, context, undefined)],
    artifacts: [readinessArtifact(input, readiness, context, refs)],
  });
}

function sanitizeReadinessResult(
  result: CodexAgentHostComputerUseActMaterializerResult,
): CodexAgentHostComputerUseActMaterializerResult {
  return sanitizePublicEvent(result) as CodexAgentHostComputerUseActMaterializerResult;
}

function executionUnit(
  input: CodexAgentHostComputerUseActMaterializerInput,
  status: 'candidate' | 'blocked' | 'needs-confirmation',
  outputRef: string,
  context: {
    operation: string;
    moduleId: string | undefined;
  },
  primitive: ComputerUseAppModulePrimitiveCandidate | undefined,
): Record<string, unknown> {
  return compactRecord({
    id: `EU-computer-use-app-module-${safeToken(input.attemptId) || 'attempt'}`,
    tool: TOOL_ID,
    status,
    moduleId: context.moduleId,
    operation: context.operation,
    primitive: primitive?.name,
    outputRef,
    hash: safeToken(input.attemptId) || 'computer-use-app-module',
  });
}

function readinessArtifact(
  input: CodexAgentHostComputerUseActMaterializerInput,
  readiness: ComputerUseAppModuleReadiness,
  context: {
    operation: string;
    moduleId: string | undefined;
    candidateModuleIds: string[];
  },
  refs: string[],
): Record<string, unknown> {
  return {
    id: `computer-use-app-module-readiness-${safeToken(input.attemptId) || 'attempt'}`,
    type: 'computer-use-app-module-readiness',
    metadata: {
      source: TOOL_ID,
      status: readiness.status,
    },
    data: compactRecord({
      schemaVersion: 'sciforge.computer-use.app-module-readiness.v1',
      hostOwnsOperation: true,
      computerUseCorePlanning: false,
      moduleId: context.moduleId,
      candidateModuleIds: context.candidateModuleIds,
      operation: context.operation,
      readinessStatus: readiness.status,
      reasonRef: readiness.status === 'ready' ? undefined : readiness.reasonRef,
      primitive: readiness.status === 'ready' ? readiness.primitive : undefined,
      evidenceRefs: refs.slice(0, 16),
    }),
  };
}

function structuredAppModuleOperation(
  input: CodexAgentHostComputerUseActMaterializerInput,
  refs: string[],
): StructuredAppModuleOperation | undefined {
  const target = isRecord(input.agentHostInput.target) ? input.agentHostInput.target : {};
  const records = [
    target,
    isRecord(target.computerUseAppModule) ? target.computerUseAppModule : undefined,
    isRecord(target.appModule) ? target.appModule : undefined,
  ];
  const operation = records.map(operationFromRecord).find((value): value is string => typeof value === 'string');
  const safe = operation ? safeOperation(operation) : undefined;
  if (!safe) return undefined;
  return {
    operation: safe,
    operationRef: records.map(operationRefFromRecord).find((value): value is string => typeof value === 'string')
      ?? operationRefFromRefs(safe, refs),
  };
}

function hasComputerUseAppModuleMarker(
  input: CodexAgentHostComputerUseActMaterializerInput,
  refs: string[],
): boolean {
  const target = isRecord(input.agentHostInput.target) ? input.agentHostInput.target : {};
  return target.kind === 'computer-use-app-module'
    || refs.includes('intent:computer-use-app-module-dry-run')
    || isRecord(target.computerUseAppModule)
    || isRecord(target.appModule);
}

function operationFromRecord(value: Record<string, unknown> | undefined): string | undefined {
  if (!value) return undefined;
  return stringField(value.operation)
    ?? stringField(value.computerUseOperation)
    ?? stringField(value.primitiveOperation);
}

function operationRefFromRecord(value: Record<string, unknown> | undefined): string | undefined {
  if (!value) return undefined;
  return safeOperationRef(stringField(value.operationRef)
    ?? stringField(value.computerUseOperationRef)
    ?? stringField(value.primitiveOperationRef));
}

function operationRefFromRefs(operation: string, refs: string[]): string | undefined {
  const prefix = `operation-ref:`;
  const candidates = refs.filter((ref) => ref.startsWith(prefix) && ref.includes(`:${operation}:`));
  return candidates.length === 1 ? safeOperationRef(candidates[0]) : undefined;
}

function collectAppModuleRefs(input: CodexAgentHostComputerUseActMaterializerInput): string[] {
  const refs = [
    ...stringList(input.agentHostInput.refs),
    ...stringList(input.agentHostInput.target.refs),
    ...stringList(input.agentHostInput.observation.refs),
    ...stringList(input.agentHostInput.permissions.refs),
    ...input.preflight.target.refs,
    ...input.preflight.evidenceRefs,
    ...(input.runtimeTruth?.target?.refs ?? []),
    ...(input.runtimeTruth?.observation?.refs ?? []),
    ...(input.runtimeTruth?.permissions?.refs ?? []),
    ...(input.runtimeTruth?.permissions?.permissionRefs ?? []),
    ...(input.runtimeTruth?.permissions?.scopedExecutorRefs ?? []),
    ...(input.runtimeTruth?.refs ?? []),
  ];
  return uniqueStrings([
    ...refs,
    ...appModuleObservationFreshnessRefs(input, refs),
  ]);
}

function appModuleObservationFreshnessRefs(
  input: CodexAgentHostComputerUseActMaterializerInput,
  refs: string[],
): string[] {
  if (!refs.some((ref) =>
    ref === 'macos-app:vscode'
    || ref.startsWith('process:vscode')
    || ref.startsWith('window:vscode:')
  )) {
    return [];
  }
  const observations = [
    input.agentHostInput.observation,
    input.runtimeTruth?.observation,
  ];
  return observations.some(staleObservationMetadata)
    ? ['stale-invalidation:vscode:host-observation-metadata']
    : [];
}

function staleObservationMetadata(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const freshness = isRecord(value.freshnessCheck) ? value.freshnessCheck : undefined;
  const status = stringField(freshness?.status)
    ?? stringField(value.status)
    ?? (value.fresh === false ? 'stale' : value.fresh === true ? 'current' : undefined);
  const normalizedStatus = status?.toLowerCase();
  if (normalizedStatus && normalizedStatus !== 'current' && normalizedStatus !== 'fresh') return true;
  if (value.fresh === false) return true;

  const observedAt = stringField(value.observedAt)
    ?? stringField(value.capturedAt)
    ?? stringField(freshness?.observedAt);
  const checkedAt = stringField(value.freshnessCheckedAt)
    ?? stringField(freshness?.checkedAt);
  const maxAgeMs = numberField(freshness?.maxAgeMs);
  if (!observedAt || !checkedAt || maxAgeMs === undefined) return false;
  const observedMs = Date.parse(observedAt);
  const checkedMs = Date.parse(checkedAt);
  return Number.isFinite(observedMs)
    && Number.isFinite(checkedMs)
    && checkedMs - observedMs > maxAgeMs;
}

function appModuleEvidenceRefs(refs: Array<string | undefined>): string[] {
  return uniqueStrings(refs.filter((ref): ref is string => typeof ref === 'string' && safeAppModuleRef(ref))).slice(0, 64);
}

function safeAppModuleRef(value: string): boolean {
  const ref = value.trim();
  if (!ref || ref.length > 240) return false;
  if (/^(?:gui(?:\.|:)|ui:|fixture:|replay:|history:)/i.test(ref)) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer|provider[-_/]?(?:payload|input|request|response)/i.test(ref)) return false;
  if (/(^|[:/._-])raw([:/._-]|$)/i.test(ref)) return false;
  return /^(?:runtime-truth:|intent:|blocked:|needs-confirmation:|module:|capability:|operation-ref:|macos-app:|process:|window:|frontmost:|file-ref:|text:|text-ref:|image:|accessibility:|element:|focused-editor:|freshness:|observation:|diagnostics:|problems:|terminal:|command-palette:|command-palette-input:|command-palette-items:|command-palette-item:|command-palette-item-rank:|command-palette-item-hash:|verifier:(?:vscode-app-module|vscode-cowork|current-vscode-cowork):|window-action-session:|computer-use-session:|computer-use:|permission:|risk:|approval:|non-user-file-scope:|cursor-move:|selection-ref:|action:|executor-event:|input-event:|input-lease:|lease:|action-ledger:|adapter-registry:|actor-cursor:|cursor-marker:|scoped-input-lease:|scoped-input-adapter:|front-app-restore:|mouse-position-restore:|focus-lease:|stale-invalidation:|cancel:|stop:|app-native-command:)/i.test(ref);
}

function safeOperation(value: string): string | undefined {
  const operation = value.trim();
  return /^[a-z][a-z0-9-]{1,80}$/u.test(operation) ? operation : undefined;
}

function safeOperationRef(value: string | undefined): string | undefined {
  const ref = value?.trim();
  return ref && /^operation-ref:[a-z0-9._-]+:[a-z0-9._-]+:[A-Za-z0-9._:-]+$/u.test(ref) ? ref : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function safeToken(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80)
    : '';
}

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
