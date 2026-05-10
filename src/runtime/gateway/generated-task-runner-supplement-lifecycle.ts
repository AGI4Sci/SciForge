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
  return uniqueStrings([...expectedArtifactTypesForRequest(request), ...generated]);
}

export function supplementScopeForGeneratedRun(request: GatewayRequest, generatedExpectedArtifacts?: string[]) {
  const generated = uniqueStrings((generatedExpectedArtifacts ?? []).map((type) => type.trim()).filter(Boolean));
  return generated.length ? generated : expectedArtifactTypesForRequest(request);
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
  };
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
