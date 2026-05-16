import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { WORKSPACE_RUNTIME_GATEWAY_REPAIR_TOOL_ID } from '@sciforge-ui/runtime-contract/capabilities';
import {
  runtimeAgentBackendConfigurationFailureIsBlocking,
  runtimeAgentBackendConfigurationNextStep,
  runtimeAgentBackendConfigurationRecoverActions,
} from '@sciforge-ui/runtime-contract/agent-backend-policy';
import type { ContractValidationFailure } from '@sciforge-ui/runtime-contract/validation-failure';
import { repairDiagnosticViewSlotPolicy } from '../../../packages/presentation/interactive-views/runtime-ui-manifest-policy';
import { sha1 } from '../workspace-task-runner.js';
import { safeWorkspaceRel, uniqueStrings } from '../gateway-utils.js';
import { diagnosticForFailure, type AgentServerBackendFailureDiagnostic } from './backend-failure-diagnostics.js';

export const BACKEND_REPAIR_FAILURE_CONTRACT_ID = 'sciforge.backend-repair-failure.v1';
export const REPAIR_BOUNDARY_POLICY_ID = 'sciforge.repair-boundary-source-edit-guard.v1';
export const REPAIR_BOUNDARY_DIAGNOSTIC_CONTRACT_ID = 'sciforge.repair-boundary-diagnostic.v1';

export interface BackendRepairFailure {
  contract: typeof BACKEND_REPAIR_FAILURE_CONTRACT_ID;
  failureKind: 'backend-diagnostic' | 'repair-boundary';
  capabilityId: string;
  failureReason: string;
  diagnostic: AgentServerBackendFailureDiagnostic;
  recoverActions: string[];
  nextStep: string;
  relatedRefs: string[];
  createdAt: string;
}

export type StructuredRepairFailure = ContractValidationFailure | BackendRepairFailure;

export interface RepairPolicyRefs {
  taskRel?: string;
  outputRel?: string;
  stdoutRel?: string;
  stderrRel?: string;
  executionUnitStatus?: 'repair-needed' | 'failed-with-reason' | 'needs-human';
  evidenceRefs?: string[];
  blocker?: string;
  agentServerRefs?: Record<string, unknown>;
  recoverActions?: string[];
  validationFailure?: ContractValidationFailure;
  backendFailure?: BackendRepairFailure;
}

export interface RepairBoundarySnapshot {
  policyId: typeof REPAIR_BOUNDARY_POLICY_ID;
  workspace: string;
  capturedAt: string;
  protectedFiles: Record<string, string>;
}

export interface RepairBoundaryScope {
  taskRel?: string;
  allowedRelPaths?: string[];
  allowedPrefixes?: string[];
}

export interface RepairBoundaryViolation {
  contract: typeof REPAIR_BOUNDARY_DIAGNOSTIC_CONTRACT_ID;
  policyId: typeof REPAIR_BOUNDARY_POLICY_ID;
  status: 'blocked';
  reason: string;
  taskRel?: string;
  changedPaths: string[];
  blockedPaths: string[];
  allowedPaths: string[];
  allowedPrefixes: string[];
  auditRef?: string;
  createdAt: string;
}

export function repairNeededPayload(
  request: GatewayRequest,
  skill: SkillAvailability,
  reason: string,
  refs: RepairPolicyRefs = {},
  planRefs: Record<string, unknown> = {},
): ToolPayload {
  const validationFailure = refs.validationFailure;
  const evidenceRefs = evidenceRefsForRepair(refs);
  const backendFailure = validationFailure ? undefined : refs.backendFailure ?? backendRepairFailureFromReason(reason, {
    capabilityId: skill.id,
    backend: request.agentBackend,
    provider: request.modelProvider,
    model: request.modelName,
    evidenceRefs,
    recoverActions: refs.recoverActions,
  });
  const repairFailure: StructuredRepairFailure = validationFailure ?? backendFailure!;
  const repairReason = repairFailure.failureReason;
  const id = `EU-${request.skillDomain}-${sha1(`${request.prompt}:${repairReason}`).slice(0, 8)}`;
  const diagnostic = backendFailure?.diagnostic ?? diagnosticForFailure(repairReason, {
    backend: request.agentBackend,
    provider: request.modelProvider,
    model: request.modelName,
    evidenceRefs,
  });
  const recoverActions = refs.recoverActions
    ?? repairFailure.recoverActions
    ?? diagnostic.recoverActions
    ?? recoverActionsForRepair(repairFailure);
  const nextStep = repairFailure.nextStep ?? diagnostic.nextStep ?? nextStepForRepair(repairFailure);
  const displayReason = isContractValidationFailure(repairFailure)
    ? validationFailurePrompt(repairFailure)
    : backendFailurePrompt(repairFailure);
  const artifactId = `${request.skillDomain}-runtime-result`;
  const executionUnitStatus = refs.executionUnitStatus ?? 'repair-needed';
  const payloadClaimType = executionUnitStatus === 'failed-with-reason' ? 'runtime-diagnostic' : 'fact';
  const executionUnit = {
    id,
    tool: WORKSPACE_RUNTIME_GATEWAY_REPAIR_TOOL_ID,
    params: JSON.stringify(repairParams(request, skill, repairFailure)),
    status: executionUnitStatus,
    hash: sha1(`${id}:${repairReason}`).slice(0, 12),
    time: new Date().toISOString(),
    environment: 'SciForge workspace runtime gateway',
    inputData: [request.prompt],
    outputArtifacts: [artifactId],
    artifacts: [artifactId],
    codeRef: refs.taskRel,
    outputRef: refs.outputRel,
    stdoutRef: refs.stdoutRel,
    stderrRef: refs.stderrRel,
    blocker: refs.blocker,
    refs: {
      ...refs.agentServerRefs,
      ...(validationFailure ? { validationFailure } : { backendFailure }),
      diagnostic: {
        kind: diagnostic.kind,
        categories: diagnostic.categories,
        title: diagnostic.title,
        evidenceRefs,
      },
    },
    failureReason: displayReason,
    ...planRefs,
    requiredInputs: requiredInputsForRepair(request, repairFailure),
    recoverActions,
    nextStep,
    attempt: 1,
  };
  return {
    message: `SciForge runtime gateway needs repair or AgentServer task generation: ${displayReason}`,
    confidence: 0.2,
    claimType: payloadClaimType,
    evidenceLevel: 'runtime',
    reasoningTrace: [
      ...repairReasoningTrace(repairFailure),
      `skillDomain=${request.skillDomain}`,
      `skill=${skill.id}`,
      'No demo/default/record-only success payload was substituted.',
    ].join('\n'),
    claims: [{
      text: displayReason,
      type: 'fact',
      confidence: 0.2,
      evidenceLevel: 'runtime',
      supportingRefs: [skill.id],
      opposingRefs: [],
    }],
    uiManifest: [defaultRepairDiagnosticSlot(request)],
    executionUnits: [executionUnit],
    objectReferences: objectReferencesForEvidence(id, evidenceRefs),
    artifacts: [repairDiagnosticArtifact({
      artifactId,
      request,
      skill,
      repairFailure,
      diagnostic,
      displayReason,
      executionUnit,
      status: executionUnitStatus,
      evidenceRefs,
      recoverActions,
      nextStep,
    })],
  };
}

export async function captureRepairBoundarySnapshot(workspace: string): Promise<RepairBoundarySnapshot> {
  const root = resolve(workspace);
  const protectedFiles: Record<string, string> = {};
  await collectProtectedWorkspaceFiles(root, root, protectedFiles);
  return {
    policyId: REPAIR_BOUNDARY_POLICY_ID,
    workspace: root,
    capturedAt: new Date().toISOString(),
    protectedFiles,
  };
}

export function evaluateRepairBoundarySnapshot(
  before: RepairBoundarySnapshot,
  after: RepairBoundarySnapshot,
  scope: RepairBoundaryScope = {},
): RepairBoundaryViolation | undefined {
  const changedPaths = changedRepairBoundaryPaths(before.protectedFiles, after.protectedFiles);
  const allowedPrefixes = repairBoundaryAllowedPrefixes(scope);
  const allowedPaths = changedPaths.filter((path) => repairBoundaryPathAllowed(path, scope, allowedPrefixes));
  const blockedPaths = changedPaths.filter((path) => !repairBoundaryPathAllowed(path, scope, allowedPrefixes));
  if (!blockedPaths.length) return undefined;
  const clipped = blockedPaths.slice(0, 8).join(', ');
  return {
    contract: REPAIR_BOUNDARY_DIAGNOSTIC_CONTRACT_ID,
    policyId: REPAIR_BOUNDARY_POLICY_ID,
    status: 'blocked',
    reason: `Repair boundary rejected AgentServer repair because it changed repo source/config files outside the generated task boundary: ${clipped}${blockedPaths.length > 8 ? `, and ${blockedPaths.length - 8} more` : ''}.`,
    taskRel: normalizeOptionalRel(scope.taskRel),
    changedPaths,
    blockedPaths,
    allowedPaths,
    allowedPrefixes,
    createdAt: new Date().toISOString(),
  };
}

export async function writeRepairBoundaryAudit(workspace: string, violation: RepairBoundaryViolation): Promise<string> {
  const rel = `.sciforge/repair-boundary/${sha1(JSON.stringify({
    blockedPaths: violation.blockedPaths,
    taskRel: violation.taskRel,
    createdAt: violation.createdAt,
  })).slice(0, 12)}.json`;
  await mkdir(dirname(join(workspace, rel)), { recursive: true });
  await writeFile(join(workspace, rel), `${JSON.stringify(violation, null, 2)}\n`, 'utf8');
  return rel;
}

export async function repairBoundaryDiagnosticPayload(input: {
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  violation: RepairBoundaryViolation;
  refs?: RepairPolicyRefs;
}): Promise<ToolPayload> {
  const auditRef = input.violation.auditRef ?? await writeRepairBoundaryAudit(input.workspace, input.violation);
  const violation = { ...input.violation, auditRef };
  const backendFailure = repairBoundaryFailureFromViolation(input.skill, violation);
  return repairNeededPayload(input.request, input.skill, backendFailure.failureReason, {
    ...input.refs,
    blocker: 'repair-boundary',
    backendFailure,
    recoverActions: backendFailure.recoverActions,
    agentServerRefs: {
      ...(input.refs?.agentServerRefs ?? {}),
      repairBoundary: violation,
    },
  });
}

export function repairBoundaryFailureFromViolation(
  skill: SkillAvailability,
  violation: RepairBoundaryViolation,
): BackendRepairFailure {
  const relatedRefs = uniqueStrings([
    violation.auditRef,
    violation.taskRel,
    ...violation.blockedPaths,
  ].filter((value): value is string => Boolean(value)));
  const diagnostic: AgentServerBackendFailureDiagnostic = {
    kind: 'acceptance',
    categories: ['acceptance'],
    message: violation.reason,
    title: 'Repair boundary blocked',
    userReason: `Repair boundary diagnostic: ${violation.reason}`,
    evidenceRefs: relatedRefs,
    recoverActions: [
      'Reject the repair result and do not rerun it as a successful self-heal.',
      'Inspect or discard the out-of-bound repo edits before retrying repair.',
      'Retry repair with changes limited to the generated task or adjacent session-bundle files.',
    ],
    nextStep: 'Review the repair-boundary audit, restore any out-of-bound source edits if needed, then retry with a scoped generated-task repair.',
  };
  return {
    contract: BACKEND_REPAIR_FAILURE_CONTRACT_ID,
    failureKind: 'repair-boundary',
    capabilityId: skill.id,
    failureReason: diagnostic.userReason ?? diagnostic.message,
    diagnostic,
    recoverActions: diagnostic.recoverActions ?? [],
    nextStep: diagnostic.nextStep ?? 'Review the repair-boundary audit before retrying.',
    relatedRefs,
    createdAt: new Date().toISOString(),
  };
}

function repairDiagnosticArtifact(input: {
  artifactId: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  repairFailure: StructuredRepairFailure;
  diagnostic: AgentServerBackendFailureDiagnostic;
  displayReason: string;
  executionUnit: Record<string, unknown>;
  status: 'repair-needed' | 'failed-with-reason' | 'needs-human';
  evidenceRefs: string[];
  recoverActions: string[];
  nextStep: string;
}): Record<string, unknown> {
  return {
    id: input.artifactId,
    type: 'runtime-diagnostic',
    schemaVersion: 'sciforge.runtime-diagnostic.v1',
    data: {
      status: input.status,
      skillDomain: input.request.skillDomain,
      skillId: input.skill.id,
      message: input.displayReason,
      failure: input.repairFailure,
      diagnostic: {
        kind: input.diagnostic.kind,
        categories: input.diagnostic.categories,
        title: input.diagnostic.title,
        message: input.diagnostic.message,
      },
      executionUnits: [input.executionUnit],
      evidenceRefs: input.evidenceRefs,
      recoverActions: input.recoverActions,
      nextStep: input.nextStep,
    },
    metadata: {
      status: input.status,
      failureKind: input.repairFailure.failureKind,
      diagnosticKind: input.diagnostic.kind,
      source: 'workspace-runtime-repair-policy',
      producerSkillId: input.skill.id,
      createdAt: new Date().toISOString(),
    },
  };
}

export function backendRepairFailureFromReason(
  reason: string,
  options: {
    capabilityId: string;
    backend?: string;
    provider?: string;
    model?: string;
    evidenceRefs?: string[];
    recoverActions?: string[];
  },
): BackendRepairFailure {
  const diagnostic = diagnosticForFailure(reason, {
    backend: options.backend,
    provider: options.provider,
    model: options.model,
    evidenceRefs: options.evidenceRefs,
  });
  const recoverActions = options.recoverActions
    ?? runtimeAgentBackendConfigurationRecoverActions(reason)
    ?? diagnostic.recoverActions
    ?? backendDiagnosticRecoverActions(diagnostic);
  const nextStep = runtimeAgentBackendConfigurationNextStep(reason)
    ?? diagnostic.nextStep
    ?? backendDiagnosticNextStep(diagnostic);
  return {
    contract: BACKEND_REPAIR_FAILURE_CONTRACT_ID,
    failureKind: 'backend-diagnostic',
    capabilityId: options.capabilityId,
    failureReason: diagnostic.userReason ?? diagnostic.message,
    diagnostic,
    recoverActions,
    nextStep,
    relatedRefs: uniqueStrings(options.evidenceRefs ?? []),
    createdAt: new Date().toISOString(),
  };
}

function evidenceRefsForRepair(refs: RepairPolicyRefs) {
  return Array.from(new Set([
    refs.taskRel,
    refs.outputRel,
    refs.stdoutRel,
    refs.stderrRel,
    ...(refs.evidenceRefs ?? []),
    ...(refs.backendFailure?.relatedRefs ?? []),
    ...(refs.validationFailure?.relatedRefs ?? []),
    ...(refs.validationFailure?.invalidRefs ?? []),
    ...(refs.validationFailure?.unresolvedUris ?? []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function validationFailurePrompt(failure: ContractValidationFailure) {
  return [
    `ContractValidationFailure ${failure.failureKind}`,
    `contractId=${failure.contractId}`,
    `schemaPath=${failure.schemaPath}`,
    `reason=${failure.failureReason}`,
  ].join('; ');
}

function backendFailurePrompt(failure: BackendRepairFailure) {
  return failure.diagnostic.userReason ?? [
    `BackendRepairFailure ${failure.diagnostic.kind}`,
    `contractId=${failure.contract}`,
    `reason=${failure.failureReason}`,
  ].join('; ');
}

function repairReasoningTrace(failure: StructuredRepairFailure) {
  if (isBackendRepairFailure(failure)) {
    return [
      'structuredRepairFailure=BackendRepairFailure',
      `contractId=${failure.contract}`,
      `failureKind=${failure.failureKind}`,
      `diagnosticKind=${failure.diagnostic.kind}`,
      failure.diagnostic.categories.length ? `diagnosticCategories=${failure.diagnostic.categories.join(', ')}` : undefined,
      `failureReason=${failure.failureReason}`,
      failure.relatedRefs.length ? `relatedRefs=${failure.relatedRefs.join(', ')}` : undefined,
    ].filter((line): line is string => Boolean(line));
  }
  return [
    'structuredValidationFailure=ContractValidationFailure',
    `failureKind=${failure.failureKind}`,
    `contractId=${failure.contractId}`,
    `schemaPath=${failure.schemaPath}`,
    `failureReason=${failure.failureReason}`,
    failure.missingFields.length ? `missingFields=${failure.missingFields.join(', ')}` : undefined,
    failure.invalidRefs.length ? `invalidRefs=${failure.invalidRefs.join(', ')}` : undefined,
    failure.unresolvedUris.length ? `unresolvedUris=${failure.unresolvedUris.join(', ')}` : undefined,
    failure.relatedRefs.length ? `relatedRefs=${failure.relatedRefs.join(', ')}` : undefined,
  ].filter((line): line is string => Boolean(line));
}

function repairParams(
  request: GatewayRequest,
  skill: SkillAvailability,
  failure: StructuredRepairFailure,
) {
  const base = {
    prompt: request.prompt,
    skillDomain: request.skillDomain,
    skillId: skill.id,
  };
  if (isBackendRepairFailure(failure)) {
    return {
      ...base,
      backendFailure: {
        contract: failure.contract,
        failureKind: failure.failureKind,
        capabilityId: failure.capabilityId,
        failureReason: failure.failureReason,
        diagnostic: {
          kind: failure.diagnostic.kind,
          categories: failure.diagnostic.categories,
          backend: failure.diagnostic.backend,
          provider: failure.diagnostic.provider,
          model: failure.diagnostic.model,
          httpStatus: failure.diagnostic.httpStatus,
          retryAfterMs: failure.diagnostic.retryAfterMs,
          resetAt: failure.diagnostic.resetAt,
          message: failure.diagnostic.message,
          title: failure.diagnostic.title,
        },
        recoverActions: failure.recoverActions,
        nextStep: failure.nextStep,
        relatedRefs: failure.relatedRefs,
      },
    };
  }
  return {
    ...base,
    validationFailure: {
      contract: failure.contract,
      contractId: failure.contractId,
      capabilityId: failure.capabilityId,
      failureKind: failure.failureKind,
      schemaPath: failure.schemaPath,
      failureReason: failure.failureReason,
      missingFields: failure.missingFields,
      invalidRefs: failure.invalidRefs,
      unresolvedUris: failure.unresolvedUris,
      relatedRefs: failure.relatedRefs,
      issues: failure.issues,
    },
  };
}

function objectReferencesForEvidence(executionUnitId: string, refs: string[]) {
  return [
    {
      id: `or-${executionUnitId}`,
      title: '失败的 execution unit',
      kind: 'execution-unit',
      ref: `execution-unit:${executionUnitId}`,
      executionUnitId,
      status: 'blocked',
      actions: ['focus-right-pane', 'inspect', 'pin'],
    },
    ...refs.map((ref) => ({
      id: `or-${sha1(ref).slice(0, 10)}`,
      title: ref.split('/').pop() || ref,
      kind: ref.startsWith('artifact:') ? 'artifact' : ref.startsWith('http') ? 'url' : 'file',
      ref: ref.includes(':') ? ref : `file:${ref}`,
      executionUnitId,
      status: 'available',
      actions: ['focus-right-pane', 'inspect', 'copy-path', 'pin'],
    })),
  ];
}

function defaultRepairDiagnosticSlot(request: GatewayRequest) {
  return repairDiagnosticViewSlotPolicy({ skillDomain: request.skillDomain });
}

export function requiredInputsForRepair(request: GatewayRequest, problem: StructuredRepairFailure) {
  const inputs = ['workspacePath', 'prompt', 'skillDomain'];
  if (isContractValidationFailure(problem)) {
    inputs.push(`contract:${problem.contractId}`);
    if (problem.missingFields.length) inputs.push(`missingFields:${problem.missingFields.join(',')}`);
    if (problem.invalidRefs.length || problem.unresolvedUris.length) inputs.push('valid workspace/artifact refs');
    if (problem.failureKind === 'artifact-schema') inputs.push('artifact ids/types/data refs');
    if (problem.failureKind === 'ui-manifest') inputs.push('display manifest bindings');
    if (problem.failureKind === 'work-evidence') inputs.push('evidenceRefs/rawRef or honest failed status');
    if (problem.failureKind === 'verifier') inputs.push('verifier evidence or human approval');
    if (request.scenarioPackageRef) inputs.push(`scenarioPackage:${request.scenarioPackageRef.id}@${request.scenarioPackageRef.version}`);
    return Array.from(new Set(inputs));
  }
  const categories = new Set(problem.diagnostic.categories);
  if (categories.has('network')) inputs.push('agentServerBaseUrl');
  if (
    runtimeAgentBackendConfigurationFailureIsBlocking(problem.diagnostic.message)
    || runtimeAgentBackendConfigurationFailureIsBlocking(problem.failureReason)
  ) inputs.push('modelProvider', 'modelBaseUrl', 'modelName', 'apiKey');
  if (categories.has('auth')) inputs.push('credentials');
  if (categories.has('missing-input')) inputs.push('input artifacts or workspace files');
  if (request.scenarioPackageRef) inputs.push(`scenarioPackage:${request.scenarioPackageRef.id}@${request.scenarioPackageRef.version}`);
  return Array.from(new Set(inputs));
}

export function recoverActionsForRepair(problem: StructuredRepairFailure) {
  if (problem.recoverActions.length) return problem.recoverActions;
  if (isBackendRepairFailure(problem)) return backendDiagnosticRecoverActions(problem.diagnostic);
  if (problem.failureKind === 'reference') {
    return [
      'Read the referenced input by stable ref/path/dataRef.',
      'Regenerate the final answer/artifacts from that reference, or report the ref as unreadable with nextStep.',
    ];
  }
  if (problem.failureKind === 'artifact-schema') return ['Regenerate artifacts with non-empty ids/types and stable data refs.'];
  if (problem.failureKind === 'ui-manifest') return ['Repair display manifest bindings against the returned artifacts.'];
  if (problem.failureKind === 'work-evidence') return ['Attach durable evidenceRefs/rawRef, or return repair-needed/failed-with-reason with a blocker.'];
  if (problem.failureKind === 'verifier') return ['Run the required verifier path or collect human approval before completion.'];
  return ['Repair the structured payload contract and rerun validation.'];
}

function backendDiagnosticRecoverActions(diagnostic: AgentServerBackendFailureDiagnostic) {
  const userModelActions = runtimeAgentBackendConfigurationRecoverActions(diagnostic.message);
  if (userModelActions) return userModelActions;
  const categories = new Set(diagnostic.categories);
  if (categories.has('network')) {
    return [
      'Start or configure AgentServer, then retry the same prompt.',
      'If a local package skill package should handle this task, verify the skill registry match before using AgentServer fallback.',
    ];
  }
  if (categories.has('schema')) {
    return [
      'Open stdoutRef, stderrRef, and outputRef to inspect the generated task result.',
      'Retry after the task returns message, claims, uiManifest, executionUnits, and artifacts.',
    ];
  }
  return diagnostic.recoverActions ?? [
    'Inspect stdoutRef, stderrRef, and outputRef when present.',
    'Attach required inputs or choose a compatible skill/runtime before retrying.',
  ];
}

export function nextStepForRepair(problem: StructuredRepairFailure) {
  if (problem.nextStep) return problem.nextStep;
  if (isBackendRepairFailure(problem)) return backendDiagnosticNextStep(problem.diagnostic);
  if (problem.failureKind === 'reference') return 'Resolve invalid refs or explicitly report unreadable inputs, then rerun validation.';
  if (problem.failureKind === 'artifact-schema') return 'Repair artifact ids/types/data refs and rerun validation.';
  if (problem.failureKind === 'ui-manifest') return 'Repair display manifest slots and bindings, then rerun validation.';
  if (problem.failureKind === 'work-evidence') return 'Repair WorkEvidence/status/ref consistency and rerun validation.';
  if (problem.failureKind === 'verifier') return 'Run the selected verifier or collect human approval, then rerun validation.';
  return 'Repair the structured payload contract and rerun validation.';
}

function backendDiagnosticNextStep(diagnostic: AgentServerBackendFailureDiagnostic) {
  return runtimeAgentBackendConfigurationNextStep(diagnostic.message)
    ?? diagnostic.nextStep
    ?? 'Review diagnostics, provide missing inputs, and rerun.';
}

function isContractValidationFailure(problem: StructuredRepairFailure): problem is ContractValidationFailure {
  return problem.contract !== BACKEND_REPAIR_FAILURE_CONTRACT_ID;
}

function isBackendRepairFailure(problem: StructuredRepairFailure): problem is BackendRepairFailure {
  return problem.contract === BACKEND_REPAIR_FAILURE_CONTRACT_ID;
}

async function collectProtectedWorkspaceFiles(
  root: string,
  dir: string,
  out: Record<string, string>,
) {
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const rel = workspaceRel(root, abs);
    if (!rel) continue;
    if (entry.isDirectory()) {
      if (repairBoundarySkippedDirectory(entry.name, rel)) continue;
      await collectProtectedWorkspaceFiles(root, abs, out);
      continue;
    }
    if (!entry.isFile() || repairBoundarySkippedFile(rel)) continue;
    const signature = await protectedFileSignature(abs);
    if (signature) out[rel] = signature;
  }
}

async function protectedFileSignature(abs: string) {
  try {
    const meta = await stat(abs);
    if (!meta.isFile()) return undefined;
    if (meta.size > 10 * 1024 * 1024) return `large:${meta.size}:${Math.round(meta.mtimeMs)}`;
    return `${meta.size}:${sha1(await readFile(abs)).slice(0, 16)}`;
  } catch {
    return undefined;
  }
}

function changedRepairBoundaryPaths(before: Record<string, string>, after: Record<string, string>) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Array.from(keys)
    .filter((key) => before[key] !== after[key])
    .sort();
}

function repairBoundaryPathAllowed(path: string, scope: RepairBoundaryScope, allowedPrefixes: string[]) {
  const rel = normalizeOptionalRel(path);
  if (!rel) return false;
  const allowedRelPaths = uniqueStrings([
    scope.taskRel,
    ...(scope.allowedRelPaths ?? []),
  ].map(normalizeOptionalRel).filter((value): value is string => Boolean(value)));
  if (allowedRelPaths.includes(rel)) return true;
  return allowedPrefixes.some((prefix) => rel === prefix.replace(/\/+$/, '') || rel.startsWith(prefix));
}

function repairBoundaryAllowedPrefixes(scope: RepairBoundaryScope) {
  const explicit = (scope.allowedPrefixes ?? [])
    .map(normalizePrefix)
    .filter((value): value is string => Boolean(value));
  const taskRel = normalizeOptionalRel(scope.taskRel);
  const taskDir = taskRel ? taskRel.split('/').slice(0, -1).join('/') : '';
  const generatedTaskDir = taskDir && /^(?:tasks|generated-tasks|\.sciforge\/tasks|\.sciforge\/sessions\/[^/]+\/tasks)\//.test(`${taskDir}/`)
    ? `${taskDir.replace(/\/+$/, '')}/`
    : undefined;
  return uniqueStrings([
    ...explicit,
    generatedTaskDir,
  ].filter((value): value is string => Boolean(value)));
}

function normalizePrefix(value: unknown) {
  const rel = normalizeOptionalRel(value);
  return rel ? `${rel.replace(/\/+$/, '')}/` : undefined;
}

function normalizeOptionalRel(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    return safeWorkspaceRel(value.trim());
  } catch {
    return undefined;
  }
}

function workspaceRel(root: string, abs: string) {
  const rel = relative(root, abs).split(sep).join('/');
  return rel && rel !== '..' && !rel.startsWith('../') ? rel : undefined;
}

function repairBoundarySkippedDirectory(name: string, rel: string) {
  return [
    '.git',
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.cache',
    '.next',
    '.turbo',
    '.vite',
    'playwright-report',
    'test-results',
  ].includes(name) || /(?:^|\/)(?:__pycache__|\.pytest_cache)$/.test(rel);
}

function repairBoundarySkippedFile(rel: string) {
  return /(?:^|\/)(?:\.DS_Store|Thumbs\.db)$/.test(rel);
}
