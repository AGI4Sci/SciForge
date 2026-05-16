import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult } from '../runtime-types.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { isRecord, uniqueStrings } from '../gateway-utils.js';
import type { RuntimeRefBundle } from './artifact-materializer.js';
import { recordCapabilityEvolutionRuntimeEvent } from './capability-evolution-events.js';
import { expectedArtifactTypesForRequest } from './gateway-request.js';
import type { GeneratedTaskRunnerDeps } from './generated-task-runner.js';
import { AGENTSERVER_SUPPLEMENTAL_GENERATION_EVENT_TYPE } from '../../../packages/skills/runtime-policy';

type RunAgentServerGeneratedTask = (
  request: GatewayRequest,
  skill: SkillAvailability,
  skills: SkillAvailability[],
  callbacks: WorkspaceRuntimeCallbacks | undefined,
  deps: GeneratedTaskRunnerDeps,
  options: { allowSupplement?: boolean },
) => Promise<ToolPayload | undefined>;

export interface GeneratedTaskSupplementLifecycleInput {
  request: GatewayRequest;
  skill: SkillAvailability;
  skills: SkillAvailability[];
  workspace: string;
  payload: ToolPayload;
  primaryTaskId: string;
  primaryRunId?: string;
  primaryRun: WorkspaceTaskRunResult;
  primaryRefs: RuntimeRefBundle;
  expectedArtifactTypes?: string[];
  callbacks?: WorkspaceRuntimeCallbacks;
  deps: GeneratedTaskRunnerDeps;
  runGeneratedTask: RunAgentServerGeneratedTask;
}

export async function tryAgentServerSupplementMissingArtifacts(
  params: GeneratedTaskSupplementLifecycleInput,
) {
  const missingTypes = missingExpectedArtifactTypes(params.request, params.payload.artifacts, params.expectedArtifactTypes);
  if (!missingTypes.length) return undefined;
  const fallbackReason = `Missing expected artifact types: ${missingTypes.join(', ')}`;
  emitWorkspaceRuntimeEvent(params.callbacks, {
    type: AGENTSERVER_SUPPLEMENTAL_GENERATION_EVENT_TYPE,
    source: 'workspace-runtime',
    status: 'running',
    message: 'Requesting supplemental AgentServer/backend generation',
    detail: fallbackReason,
  });
  const existingTypes = uniqueStrings(params.payload.artifacts.map((artifact) => String(artifact.type || artifact.id || '')).filter(Boolean));
  const supplementRequest: GatewayRequest = {
    ...params.request,
    prompt: [
      params.request.prompt,
      '',
      `Supplement the previous local skill result. Missing expected artifact types: ${missingTypes.join(', ')}.`,
      'Write reproducible workspace code that emits all missing artifacts and preserves existing artifacts if useful.',
      `Existing artifact types: ${existingTypes.join(', ') || 'none'}.`,
    ].join('\n'),
    artifacts: params.payload.artifacts,
    expectedArtifactTypes: missingTypes,
  };
  const supplement = await params.runGeneratedTask(
    supplementRequest,
    params.skill,
    params.skills,
    params.callbacks,
    params.deps,
    { allowSupplement: false },
  );
  if (!supplement) {
    await recordSupplementalFallbackLedger(params, {
      status: 'fallback-failed',
      fallbackReason,
      missingTypes,
      payload: params.payload,
      supplement,
      filled: [],
    });
    return undefined;
  }
  const supplementedTypes = new Set(supplement.artifacts
    .filter((artifact) => !artifactNeedsRepair(artifact))
    .map((artifact) => String(artifact.type || artifact.id || ''))
    .filter(Boolean));
  const filled = missingTypes.filter((type) => supplementedTypes.has(type));
  if (!filled.length) {
    await recordSupplementalFallbackLedger(params, {
      status: 'fallback-failed',
      fallbackReason,
      missingTypes,
      payload: params.payload,
      supplement,
      filled,
    });
    return undefined;
  }
  const merged = mergeSupplementalPayload(params.payload, supplement, filled);
  await recordSupplementalFallbackLedger(params, {
    status: 'fallback-succeeded',
    fallbackReason,
    missingTypes,
    payload: merged,
    supplement,
    filled,
  });
  return merged;
}

export function expectedArtifactTypesForGeneratedRun(request: GatewayRequest, generatedExpectedArtifacts?: string[]) {
  const generated = uniqueStrings((generatedExpectedArtifacts ?? []).map((type) => type.trim()).filter(Boolean));
  return uniqueStrings([...expectedArtifactTypesForRequest(request), ...generatedArtifactTypesForRequest(request, generated)]);
}

export function supplementScopeForGeneratedRun(request: GatewayRequest, generatedExpectedArtifacts?: string[]) {
  const generated = uniqueStrings((generatedExpectedArtifacts ?? []).map((type) => type.trim()).filter(Boolean));
  const scopedGenerated = generatedArtifactTypesForRequest(request, generated);
  return scopedGenerated.length ? scopedGenerated : expectedArtifactTypesForRequest(request);
}

function generatedArtifactTypesForRequest(request: GatewayRequest, generated: string[]) {
  if (!generated.length) return [];
  if (expectedArtifactTypesForRequest(request).length) return generated;
  if (!workspaceCodeTaskPrompt(request.prompt)) return generated;
  return generated.filter((artifactType) => !scenarioDefaultResearchArtifactType(artifactType));
}

function workspaceCodeTaskPrompt(prompt: string) {
  const text = prompt.toLowerCase();
  const hasCodeIntent = /\b(code|coding|repository|repo|module|source file|typescript|javascript|python|test helper|unit test|typecheck|patch|refactor|bug|runtime|gateway|manifest|validation|preflight|self-improvement)\b/.test(text)
    || /(?:代码|仓库|模块|源码|测试|补丁|修复|重构|类型检查|运行时|网关|清单|校验)/.test(prompt);
  const hasResearchRetrievalIntent = /\b(literature|papers?|pmid|doi|citation|bibliography|clinical trial|pubmed|openalex|evidence matrix|systematic review)\b/.test(text)
    || /(?:文献|论文|引用|证据矩阵|综述|临床试验)/.test(prompt);
  return hasCodeIntent && !hasResearchRetrievalIntent;
}

function scenarioDefaultResearchArtifactType(artifactType: string) {
  return /^(?:paper-list|evidence-matrix|notebook-timeline|bibliography|citation-record|bibliographic-record)$/.test(artifactType);
}

async function recordSupplementalFallbackLedger(
  params: {
    request: GatewayRequest;
    skill: SkillAvailability;
    workspace: string;
    payload: ToolPayload;
    primaryTaskId: string;
    primaryRunId?: string;
    primaryRun: WorkspaceTaskRunResult;
    primaryRefs: RuntimeRefBundle;
  },
  outcome: {
    status: 'fallback-succeeded' | 'fallback-failed';
    fallbackReason: string;
    missingTypes: string[];
    payload: ToolPayload;
    supplement?: ToolPayload;
    filled: string[];
  },
) {
  const fallbackSucceeded = outcome.status === 'fallback-succeeded';
  const supplementExecutionUnitRefs = executionUnitRefsFromPayload(outcome.supplement);
  const supplementArtifactRefs = artifactRefsFromPayload(outcome.supplement);
  const validationResult = {
    verdict: 'fail' as const,
    validatorId: 'sciforge.expected-artifact-contract',
    failureCode: 'missing-artifact',
    summary: outcome.fallbackReason,
    resultRef: params.primaryRefs.outputRel,
  };
  await writeCapabilityEvolutionEventBestEffort({
    workspacePath: params.workspace,
    request: params.request,
    skill: params.skill,
    taskId: params.primaryTaskId,
    runId: params.primaryRunId,
    run: params.primaryRun,
    payload: outcome.payload,
    taskRel: params.primaryRefs.taskRel,
    inputRel: `.sciforge/task-inputs/${params.primaryTaskId}.json`,
    outputRel: params.primaryRefs.outputRel,
    stdoutRel: params.primaryRefs.stdoutRel,
    stderrRel: params.primaryRefs.stderrRel,
    finalStatus: outcome.status,
    ...(fallbackSucceeded ? {} : {
      failureReason: `Supplemental fallback did not fill missing artifact types: ${outcome.missingTypes.join(', ')}`,
    }),
    fallbackReason: outcome.fallbackReason,
    eventKind: 'composed-capability-fallback',
    validationResult,
    selectedCapabilities: [{
      id: `capability.composed.${params.request.skillDomain}.expected-artifacts`,
      kind: 'composed',
      providerId: params.skill.id,
      role: 'primary',
    }],
    fallbackCapabilities: [
      {
        id: 'runtime.python-task',
        kind: 'tool',
        providerId: 'sciforge.core.runtime.python-task',
        role: 'fallback',
      },
      {
        id: 'runtime.workspace-write',
        kind: 'action',
        providerId: 'sciforge.core.runtime.workspace-write',
        role: 'fallback',
      },
      {
        id: 'verifier.schema',
        kind: 'verifier',
        providerId: 'sciforge.core.verifier.schema',
        role: 'validator',
      },
    ],
    providers: [
      { id: 'sciforge.core.runtime.python-task', kind: 'local-runtime' },
      { id: 'sciforge.core.runtime.workspace-write', kind: 'local-runtime' },
      { id: 'sciforge.core.verifier.schema', kind: 'local-runtime' },
    ],
    inputSchemaRefs: [`capability-fallback:${params.request.skillDomain}:expected-artifacts`],
    outputSchemaRefs: outcome.missingTypes.map((type) => `artifact-schema:${type}`),
    recoverActions: fallbackSucceeded
      ? ['fallback-to-atomic', 'supplement-missing-artifacts', 'merge-supplemental-payload']
      : ['fallback-to-atomic', 'supplement-missing-artifacts', 'preserve-failure-evidence-refs'],
    atomicTrace: [{
      capabilityId: 'runtime.python-task',
      providerId: 'sciforge.core.runtime.python-task',
      status: fallbackSucceeded ? 'succeeded' : 'failed',
      failureCode: fallbackSucceeded ? undefined : 'missing-artifact',
      executionUnitRefs: supplementExecutionUnitRefs,
      artifactRefs: supplementArtifactRefs,
      validationResult: {
        verdict: fallbackSucceeded ? 'pass' : 'fail',
        validatorId: 'sciforge.expected-artifact-contract',
        failureCode: fallbackSucceeded ? undefined : 'missing-artifact',
        summary: fallbackSucceeded
          ? `Supplemental fallback filled artifact types: ${outcome.filled.join(', ')}`
          : `Supplemental fallback did not fill artifact types: ${outcome.missingTypes.join(', ')}`,
        resultRef: params.primaryRefs.outputRel,
      },
    }],
  });
}

function missingExpectedArtifactTypes(request: GatewayRequest, artifacts: Array<Record<string, unknown>>, expectedArtifactTypes?: string[]) {
  const present = new Set(artifacts
    .filter((artifact) => !artifactNeedsRepair(artifact))
    .map((artifact) => String(artifact.type || artifact.id || ''))
    .filter(Boolean));
  const expected = expectedArtifactTypes?.length ? expectedArtifactTypes : expectedArtifactTypesForRequest(request);
  return uniqueStrings(expected).filter((type) => !present.has(type));
}

function executionUnitRefsFromPayload(payload: ToolPayload | undefined) {
  return uniqueStrings((payload?.executionUnits ?? []).flatMap((unit) => {
    const id = isRecord(unit) && typeof unit.id === 'string' ? unit.id : '';
    return id ? [`execution-unit:${id}`] : [];
  }));
}

function artifactRefsFromPayload(payload: ToolPayload | undefined) {
  return uniqueStrings((payload?.artifacts ?? []).flatMap((artifact) => {
    const id = isRecord(artifact) && typeof artifact.id === 'string' ? artifact.id : '';
    return id ? [`artifact:${id}`] : [];
  }));
}

function mergeSupplementalPayload(base: ToolPayload, supplement: ToolPayload, filledTypes: string[]): ToolPayload {
  const seenArtifacts = new Set<string>();
  const artifacts = [...base.artifacts, ...supplement.artifacts].filter((artifact) => {
    const key = [
      String(artifact.type || artifact.id || ''),
      String(artifact.id || ''),
      String(artifact.dataRef || ''),
      isRecord(artifact.metadata) ? String(artifact.metadata.artifactRef || artifact.metadata.outputRef || '') : '',
    ].join('|');
    if (seenArtifacts.has(key)) return false;
    seenArtifacts.add(key);
    return true;
  });
  const uiManifest = [...base.uiManifest, ...supplement.uiManifest].filter((slot, index, all) => {
    const key = `${String(slot.componentId || '')}:${String(slot.artifactRef || '')}`;
    return all.findIndex((candidate) => `${String(candidate.componentId || '')}:${String(candidate.artifactRef || '')}` === key) === index;
  });
  return {
    ...base,
    message: `${base.message}\n\nSupplemented missing artifacts: ${filledTypes.join(', ')}.`,
    reasoningTrace: [
      base.reasoningTrace,
      `Supplemental AgentServer/backend generation filled: ${filledTypes.join(', ')}`,
      supplement.reasoningTrace,
    ].filter(Boolean).join('\n'),
    claims: [...base.claims, ...supplement.claims],
    uiManifest,
    executionUnits: [...base.executionUnits, ...supplement.executionUnits],
    artifacts,
    logs: [...(base.logs ?? []), ...(supplement.logs ?? [])],
    budgetDebits: mergeSupplementalBudgetDebits(base.budgetDebits, supplement.budgetDebits),
    workEvidence: mergeSupplementalWorkEvidence(base.workEvidence, supplement.workEvidence),
  };
}

function mergeSupplementalBudgetDebits(
  base: ToolPayload['budgetDebits'],
  supplement: ToolPayload['budgetDebits'],
): ToolPayload['budgetDebits'] {
  const merged: NonNullable<ToolPayload['budgetDebits']> = [];
  const indexes = new Map<string, number>();
  for (const debit of [...(base ?? []), ...(supplement ?? [])]) {
    const key = stringField(debit.debitId) ?? stableJson(debit);
    const existingIndex = indexes.get(key);
    if (existingIndex === undefined) {
      indexes.set(key, merged.length);
      merged.push(debit);
      continue;
    }
    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      ...debit,
      subjectRefs: uniqueStrings([...(existing.subjectRefs ?? []), ...(debit.subjectRefs ?? [])]),
      debitLines: mergeRecordsByStableKey(existing.debitLines ?? [], debit.debitLines ?? []),
      exhaustedDimensions: uniqueStrings([...(existing.exhaustedDimensions ?? []), ...(debit.exhaustedDimensions ?? [])]) as typeof existing.exhaustedDimensions,
      sinkRefs: {
        executionUnitRef: existing.sinkRefs.executionUnitRef ?? debit.sinkRefs.executionUnitRef,
        workEvidenceRefs: uniqueStrings([
          ...(existing.sinkRefs.workEvidenceRefs ?? []),
          ...(debit.sinkRefs.workEvidenceRefs ?? []),
        ]),
        auditRefs: uniqueStrings([
          ...(existing.sinkRefs.auditRefs ?? []),
          ...(debit.sinkRefs.auditRefs ?? []),
        ]),
      },
      metadata: {
        ...(existing.metadata ?? {}),
        ...(debit.metadata ?? {}),
      },
    };
  }
  return merged.length ? merged : undefined;
}

function mergeSupplementalWorkEvidence(
  base: ToolPayload['workEvidence'],
  supplement: ToolPayload['workEvidence'],
): ToolPayload['workEvidence'] {
  const merged: NonNullable<ToolPayload['workEvidence']> = [];
  const indexes = new Map<string, number>();
  for (const evidence of [...(base ?? []), ...(supplement ?? [])]) {
    const key = stringField(evidence.id) ?? stableJson(evidence);
    const existingIndex = indexes.get(key);
    if (existingIndex === undefined) {
      indexes.set(key, merged.length);
      merged.push(evidence);
      continue;
    }
    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      ...evidence,
      evidenceRefs: uniqueStrings([...(existing.evidenceRefs ?? []), ...(evidence.evidenceRefs ?? [])]),
      recoverActions: uniqueStrings([...(existing.recoverActions ?? []), ...(evidence.recoverActions ?? [])]),
      diagnostics: uniqueOptionalStrings(existing.diagnostics, evidence.diagnostics),
      budgetDebitRefs: uniqueOptionalStrings(existing.budgetDebitRefs, evidence.budgetDebitRefs),
    };
  }
  return merged.length ? merged : undefined;
}

function mergeRecordsByStableKey<T>(base: T[], supplement: T[]) {
  const seen = new Set<string>();
  return [...base, ...supplement].filter((item) => {
    const key = stableJson(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueOptionalStrings(base: string[] | undefined, supplement: string[] | undefined) {
  const merged = uniqueStrings([...(base ?? []), ...(supplement ?? [])]);
  return merged.length ? merged : undefined;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function artifactNeedsRepair(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const data = isRecord(artifact.data) ? artifact.data : {};
  return metadata.status === 'repair-needed'
    || metadata.requiresAgentServerGeneration === true
    || data.requiresAgentServerGeneration === true;
}

async function writeCapabilityEvolutionEventBestEffort(
  input: Parameters<typeof recordCapabilityEvolutionRuntimeEvent>[0],
) {
  try {
    await recordCapabilityEvolutionRuntimeEvent(input);
  } catch {
    // Ledger capture is audit evidence; it must not turn a repair/fallback path into a harder failure.
  }
}
