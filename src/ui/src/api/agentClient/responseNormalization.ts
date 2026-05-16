import type { ClaimType, EvidenceLevel } from '../../data';
import type { ContractValidationFailure, ContractValidationFailureKind } from '@sciforge-ui/runtime-contract';
import { makeId, nowIso, type NormalizedAgentResponse, type ObjectReference, type RuntimeArtifact, type RuntimeExecutionUnit, type ScenarioInstanceId } from '../../domain';
import { normalizeResponseObjectReferences } from '../../../../../packages/support/object-references';

const evidenceLevels: EvidenceLevel[] = ['meta', 'rct', 'cohort', 'case', 'experimental', 'review', 'database', 'preprint', 'prediction'];
const claimTypes: ClaimType[] = ['fact', 'inference', 'hypothesis'];
const CONTRACT_VALIDATION_FAILURE_CONTRACT = 'sciforge.contract-validation-failure.v1';
const contractValidationFailureKinds: ContractValidationFailureKind[] = ['payload-schema', 'artifact-schema', 'reference', 'ui-manifest', 'work-evidence', 'verifier', 'unknown'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return entries.length ? entries : undefined;
}

function asStringList(value: unknown): string[] {
  return asStringArray(value) ?? [];
}

function pickEvidence(value: unknown): EvidenceLevel {
  return evidenceLevels.includes(value as EvidenceLevel) ? value as EvidenceLevel : 'prediction';
}

function pickClaimType(value: unknown): ClaimType {
  return claimTypes.includes(value as ClaimType) ? value as ClaimType : 'inference';
}

function extractJsonObject(text: string): Record<string, unknown> | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)].filter(Boolean);
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Natural-language answers are valid; JSON is optional.
    }
  }
  return undefined;
}

function readableMessageFromStructured(structured: Record<string, unknown>, fallback: string) {
  const direct = asString(structured.message);
  if (direct && !looksLikeRawJson(direct)) return stripVerificationFooter(direct);
  const failure = userVisibleFailureSummary(structured, fallback);
  if (failure) return failure;
  return stripVerificationFooter(direct || fallback);
}

function stripVerificationFooter(value: string) {
  return value
    .replace(/\n{1,3}Verification:\s*(?:pass|fail|uncertain|needs-human|unverified)\b[^\n]*(?:\n[^\n]*)?$/i, '')
    .trim();
}

function looksLikeRawJson(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}');
}

function userVisibleFailureSummary(structured: Record<string, unknown>, fallback: string) {
  const status = asString(structured.status) ?? asString(structured.errorStatus) ?? asString(structured.state);
  const finalText = asString(structured.finalText) ?? asString(structured.error) ?? asString(structured.detail);
  const isRawFailureText = looksLikeRawFailureText(fallback);
  const source = finalText || ((looksLikeRawJson(fallback) || isRawFailureText) ? fallback : '');
  if (!source) return undefined;
  const compact = source.replace(/\s+/g, ' ').trim();
  // When source is raw JSON (not an explicit error field or raw failure text literal), restrict failure
  // detection to the status field only. This avoids false positives from success messages that mention
  // previously-failed operations (e.g. "Backend repaired the failed run.").
  const textToCheck = (finalText || isRawFailureText) ? `${status ?? ''} ${compact}` : `${status ?? ''}`;
  const failed = /failed|error|unauthorized|forbidden|timeout|timed out|401|403|429|5\d\d/i.test(textToCheck);
  if (!failed) return undefined;
  const httpStatus = compact.match(/\bHTTP\s+(\d{3})(?:\s+([A-Za-z][A-Za-z -]{2,40}))?/i);
  const timeout = /\b(?:timeout|timed out)\b/i.test(compact);
  const reason = httpStatus
    ? `HTTP ${httpStatus[1]}${httpStatus[2] ? ` ${httpStatus[2].trim()}` : ''}`
    : timeout
      ? 'backend timeout'
      : 'backend failure';
  return `后端运行未完成：${reason}。详细诊断已保留在运行审计中，主结果不展示原始响应正文、endpoint 或日志内容。`;
}

function looksLikeRawFailureText(value: string) {
  return /\bHTTP\s+(?:401|403|429|5\d\d)\b/i.test(value)
    || /\b(?:Invalid token|Unauthorized|Forbidden)\b/i.test(value)
    || /\bhttps?:\/\/[^\s"'<>]+/i.test(value)
    || /\b(?:stdoutRef|stderrRef|rawRef|runtimeEventsRef)\b/i.test(value);
}

function extractOutputText(data: unknown): string {
  if (!isRecord(data)) return String(data ?? '');
  const run = isRecord(data.run) ? data.run : undefined;
  const output = isRecord(run?.output) ? run?.output : isRecord(data.output) ? data.output : undefined;
  return (
    asString(output?.result) ||
    asString(output?.text) ||
    asString(output?.message) ||
    asString(output?.error) ||
    asString(data.message) ||
    asString(data.result) ||
    'AgentServer 已返回结果，但响应中没有可展示文本。'
  );
}

function normalizeExecutionUnits(value: unknown, fallback: RuntimeExecutionUnit): RuntimeExecutionUnit[] {
  if (!Array.isArray(value)) return [fallback];
  const units = value.map((item, index) => {
    const record = isRecord(item) ? item : {};
    return {
      id: asString(record.id) || `${fallback.id}-${index + 1}`,
      tool: asString(record.tool) || asString(record.name) || fallback.tool,
      params: asString(record.params) || JSON.stringify(record.params ?? record.input ?? {}),
      status: isExecutionUnitStatus(record.status)
        ? record.status
        : 'failed-with-reason',
      hash: asString(record.hash) || fallback.hash,
      runId: asString(record.runId) ?? fallback.runId,
      sourceRunId: asString(record.sourceRunId),
      producerRunId: asString(record.producerRunId),
      agentServerRunId: asString(record.agentServerRunId),
      code: asString(record.code) || asString(record.command),
      language: asString(record.language),
      codeRef: asString(record.codeRef),
      entrypoint: asString(record.entrypoint),
      stdoutRef: asString(record.stdoutRef),
      stderrRef: asString(record.stderrRef),
      outputRef: asString(record.outputRef),
      attempt: asNumber(record.attempt),
      parentAttempt: asNumber(record.parentAttempt),
      selfHealReason: asString(record.selfHealReason),
      patchSummary: asString(record.patchSummary),
      diffRef: asString(record.diffRef),
      failureReason: asString(record.failureReason),
      seed: asNumber(record.seed) ?? asNumber(record.randomSeed),
      time: asString(record.time),
      environment: asString(record.environment),
      inputData: asStringArray(record.inputData) ?? asStringArray(record.inputs),
      dataFingerprint: asString(record.dataFingerprint),
      databaseVersions: asStringArray(record.databaseVersions),
      artifacts: asStringArray(record.artifacts),
      outputArtifacts: asStringArray(record.outputArtifacts),
      scenarioPackageRef: isScenarioPackageRef(record.scenarioPackageRef) ? record.scenarioPackageRef : undefined,
      skillPlanRef: asString(record.skillPlanRef),
      uiPlanRef: asString(record.uiPlanRef),
      runtimeProfileId: asString(record.runtimeProfileId),
      routeDecision: normalizeRouteDecision(record.routeDecision),
      requiredInputs: asStringArray(record.requiredInputs),
      recoverActions: asStringArray(record.recoverActions),
      nextStep: asString(record.nextStep),
    } satisfies RuntimeExecutionUnit;
  });
  return units.length ? units : [fallback];
}

function isScenarioPackageRef(value: unknown): value is RuntimeExecutionUnit['scenarioPackageRef'] {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.version === 'string'
    && (value.source === 'built-in' || value.source === 'workspace' || value.source === 'generated');
}

function normalizeRouteDecision(value: unknown): RuntimeExecutionUnit['routeDecision'] {
  if (!isRecord(value)) return undefined;
  return {
    selectedSkill: asString(value.selectedSkill),
    selectedRuntime: asString(value.selectedRuntime),
    fallbackReason: asString(value.fallbackReason),
    selectedAt: asString(value.selectedAt) || nowIso(),
  };
}

function isExecutionUnitStatus(value: unknown) {
  return value === 'done'
    || value === 'running'
    || value === 'failed'
    || value === 'planned'
    || value === 'record-only'
    || value === 'repair-needed'
    || value === 'self-healed'
    || value === 'failed-with-reason'
    || value === 'needs-human';
}

export function normalizeAgentResponse(
  scenarioId: ScenarioInstanceId,
  prompt: string,
  raw: unknown,
): NormalizedAgentResponse {
  const data = isRecord(raw) && raw.ok === true && 'data' in raw ? raw.data : raw;
  const root = isRecord(data) ? data : {};
  const runRecord = isRecord(root.run) ? root.run : {};
  const transportProjectionAnswer = projectionVisibleAnswer(raw) ?? projectionVisibleAnswer(root);
  const outputText = transportProjectionAnswer?.text ?? extractOutputText(root);
  const structured = extractJsonObject(outputText) ?? payloadLikeRecord(root) ?? {};
  const projectionAnswer = transportProjectionAnswer ?? projectionVisibleAnswer(structured);
  const contractValidationFailure = findContractValidationFailure(structured, root, runRecord);
  const projectionIsSatisfied = projectionAnswer?.status === 'satisfied';
  const now = nowIso();
  const runId = asString(runRecord.id) || makeId('run');
  const runStatus = projectionIsSatisfied
    ? 'completed'
    : runRecord.status === 'failed' || contractValidationFailure
      ? 'failed'
      : 'completed';
  const cleanOutputText = outputText.replace(/```(?:json)?[\s\S]*?```/gi, '').trim() || outputText;
  const hasStructuredOutput = Object.keys(structured).length > 0;
  const failureSummary = userVisibleFailureSummary(structured, cleanOutputText);
  const messageText = projectionAnswer?.text
    ? projectionAnswer.text
    : contractValidationFailure
    ? messageFromContractValidationFailure(contractValidationFailure)
    : failureSummary
    ? failureSummary
    : runStatus === 'failed' && !hasStructuredOutput
    ? `AgentServer 后端运行失败：${cleanOutputText}`
    : readableMessageFromStructured(structured, cleanOutputText);
  const confidence = asNumber(structured.confidence) ?? 0.78;
  const claimType = pickClaimType(structured.claimType);
  const evidence = pickEvidence(structured.evidenceLevel ?? structured.evidence);
  const fallbackExecutionUnit: RuntimeExecutionUnit = {
    id: `EU-${runId.slice(-6)}`,
    tool: `${scenarioId}.scenario-server-run`,
    params: `prompt=${prompt.slice(0, 80)}`,
    status: contractValidationFailure ? 'failed-with-reason' : runStatus === 'completed' ? 'done' : 'failed',
    hash: runId.slice(0, 10),
    runId,
    time: asString(runRecord.completedAt) ? 'archived' : undefined,
    failureReason: contractValidationFailure?.failureReason,
    recoverActions: contractValidationFailure?.recoverActions,
    nextStep: contractValidationFailure?.nextStep,
    outputRef: contractValidationFailure?.relatedRefs[0],
  };

  const claims = Array.isArray(structured.claims) ? structured.claims.map((item, index) => {
    const record = isRecord(item) ? item : {};
    return {
      id: asString(record.id) || makeId('claim'),
      text: asString(record.text) || asString(record.claim) || messageText,
      type: pickClaimType(record.type),
      confidence: asNumber(record.confidence) ?? confidence,
      evidenceLevel: pickEvidence(record.evidenceLevel ?? record.evidence),
      supportingRefs: Array.isArray(record.supportingRefs) ? record.supportingRefs.filter((entry): entry is string => typeof entry === 'string') : [],
      opposingRefs: Array.isArray(record.opposingRefs) ? record.opposingRefs.filter((entry): entry is string => typeof entry === 'string') : [],
      dependencyRefs: asStringArray(record.dependencyRefs),
      updateReason: asString(record.updateReason),
      updatedAt: now,
    };
  }) : [{
    id: makeId('claim'),
    text: messageText.split('\n')[0] || messageText,
    type: claimType,
    confidence,
    evidenceLevel: evidence,
    supportingRefs: [],
    opposingRefs: [],
    updatedAt: now,
  }];
  const artifacts = normalizeRuntimeArtifacts(structured.artifacts, scenarioId);
  const objectReferences = normalizeResponseObjectReferences({
    objectReferences: structured.objectReferences,
    artifacts,
    runId,
    relatedRefs: contractValidationFailure?.relatedRefs,
  });
  const normalizedRaw = withRuntimePresentationMetadata(raw, structured, objectReferences, contractValidationFailure);

  return {
    message: {
      id: makeId('msg'),
      role: 'scenario',
      content: messageText,
      confidence,
      evidence,
      claimType,
      expandable: asString(structured.reasoningTrace) || asString(structured.reasoning) || `AgentServer run: ${runId}\nStatus: ${asString(runRecord.status) || 'completed'}`,
      createdAt: now,
      status: runStatus,
      objectReferences,
    },
    run: {
      id: runId,
      scenarioId,
      status: runStatus,
      prompt,
      response: messageText,
      createdAt: asString(runRecord.createdAt) || now,
      completedAt: asString(runRecord.completedAt) || now,
      raw: normalizedRaw,
      objectReferences,
    },
    uiManifest: Array.isArray(structured.uiManifest) ? structured.uiManifest.filter(isRecord).flatMap((slot) => {
      const componentId = asString(slot.componentId);
      if (!componentId) return [];
      return [{
        componentId,
        title: asString(slot.title),
        props: isRecord(slot.props) ? slot.props : undefined,
        artifactRef: asString(slot.artifactRef),
        priority: asNumber(slot.priority),
        encoding: isRecord(slot.encoding) ? slot.encoding : undefined,
        layout: isRecord(slot.layout) ? slot.layout : undefined,
        selection: isRecord(slot.selection) ? slot.selection : undefined,
        sync: isRecord(slot.sync) ? slot.sync : undefined,
        transform: Array.isArray(slot.transform) ? slot.transform.filter(isViewTransform) : undefined,
        compare: isRecord(slot.compare) ? slot.compare : undefined,
      }];
    }) : [],
    claims,
    executionUnits: normalizeExecutionUnits(structured.executionUnits, fallbackExecutionUnit),
    artifacts,
    notebook: normalizeNotebookRecords(structured.notebook, {
      scenarioId,
      messageText,
      claimType,
      confidence,
      now,
    }),
  };
}

function projectionVisibleAnswer(value: unknown): { status?: string; text: string } | undefined {
  const record = isRecord(value) ? value : {};
  const displayIntent = isRecord(record.displayIntent) ? record.displayIntent : {};
  const projection = isRecord(displayIntent.conversationProjection)
    ? displayIntent.conversationProjection
    : isRecord(displayIntent.taskOutcomeProjection) && isRecord(displayIntent.taskOutcomeProjection.conversationProjection)
      ? displayIntent.taskOutcomeProjection.conversationProjection
      : isRecord(displayIntent.resultPresentation) && isRecord(displayIntent.resultPresentation.conversationProjection)
        ? displayIntent.resultPresentation.conversationProjection
        : undefined;
  const visibleAnswer = isRecord(projection?.visibleAnswer) ? projection.visibleAnswer : undefined;
  const text = asString(visibleAnswer?.text) ?? asString(visibleAnswer?.diagnostic);
  if (!text || looksLikeRawJson(text)) return undefined;
  const status = asString(visibleAnswer?.status);
  return { status, text: stripVerificationFooter(text) };
}

function payloadLikeRecord(value: Record<string, unknown>) {
  if (Array.isArray(value.artifacts)
    || Array.isArray(value.uiManifest)
    || Array.isArray(value.objectReferences)
    || isRecord(value.displayIntent)
    || isContractValidationFailureRecord(value)
    || isRecord(value.contractValidationFailure)
    || Array.isArray(value.contractValidationFailures)
  ) return value;
  const output = isRecord(value.output) ? value.output : undefined;
  if (output && (Array.isArray(output.artifacts)
    || Array.isArray(output.uiManifest)
    || Array.isArray(output.objectReferences)
    || isRecord(output.displayIntent)
    || isContractValidationFailureRecord(output)
    || isRecord(output.contractValidationFailure)
    || Array.isArray(output.contractValidationFailures)
  )) return output;
  return undefined;
}

function normalizeRuntimeArtifacts(value: unknown, scenarioId: ScenarioInstanceId): RuntimeArtifact[] {
  return Array.isArray(value) ? value.filter(isRecord).map((artifact) => {
    const artifactType = asString(artifact.type) || 'artifact';
    const artifactId = asString(artifact.id) || asString(artifact.ref) || artifactType || makeId('artifact');
    const path = asString(artifact.path) || asString(artifact.markdownRef) || asString(artifact.reportRef);
    const metadata = {
      ...(isRecord(artifact.metadata) ? artifact.metadata : {}),
      ...(asString(artifact.ref) ? { artifactRef: asString(artifact.ref) } : {}),
      ...(asString(artifact.markdownRef) ? { markdownRef: asString(artifact.markdownRef) } : {}),
      ...(asString(artifact.reportRef) ? { reportRef: asString(artifact.reportRef) } : {}),
    };
    return {
      id: artifactId,
      type: artifactType,
      producerScenario: scenarioId,
      schemaVersion: asString(artifact.schemaVersion) || '1',
      metadata: Object.keys(metadata).length ? metadata : undefined,
      data: normalizeArtifactData(artifact),
      dataRef: asString(artifact.dataRef),
      path,
      delivery: isRecord(artifact.delivery) ? artifact.delivery as unknown as RuntimeArtifact['delivery'] : undefined,
      visibility: asTimelineVisibility(artifact.visibility),
      audience: asStringArray(artifact.audience),
      sensitiveDataFlags: asStringArray(artifact.sensitiveDataFlags),
      exportPolicy: asExportPolicy(artifact.exportPolicy),
    };
  }) : [];
}

function uniqueStringList(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function withRuntimePresentationMetadata(raw: unknown, structured: Record<string, unknown>, objectReferences: ObjectReference[], contractValidationFailure?: ContractValidationFailure) {
  const rawDisplayIntent = isRecord(raw) && isRecord(raw.displayIntent) ? raw.displayIntent : undefined;
  const metadata = {
    displayIntent: isRecord(structured.displayIntent) ? structured.displayIntent : rawDisplayIntent,
    verificationResults: Array.isArray(structured.verificationResults)
      ? structured.verificationResults
      : isRecord(structured.verificationResult)
        ? [structured.verificationResult]
        : undefined,
    objectReferences,
    contractValidationFailure,
    contractValidationFailures: contractValidationFailure ? [contractValidationFailure] : undefined,
  };
  if (isRecord(raw)) return { ...raw, ...metadata };
  return { raw, ...metadata };
}

function findContractValidationFailure(...values: unknown[]): ContractValidationFailure | undefined {
  for (const value of values) {
    const found = contractValidationFailureCandidates(value).map(normalizeContractValidationFailure).find(Boolean);
    if (found) return found;
  }
  return undefined;
}

function contractValidationFailureCandidates(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value)) return [];
  const direct = isContractValidationFailureRecord(value) ? [value] : [];
  return [
    ...direct,
    ...recordList(value.contractValidationFailures),
    ...recordList(value.validationFailures),
    ...recordList(value.failures).filter(isContractValidationFailureRecord),
    ...singleRecord(value.contractValidationFailure),
    ...singleRecord(value.validationFailure),
    ...singleRecord(value.failure).filter(isContractValidationFailureRecord),
  ];
}

function normalizeContractValidationFailure(record: Record<string, unknown>): ContractValidationFailure | undefined {
  if (!isContractValidationFailureRecord(record)) return undefined;
  const failureKind = contractValidationFailureKinds.includes(record.failureKind as ContractValidationFailureKind)
    ? record.failureKind as ContractValidationFailureKind
    : 'unknown';
  return {
    contract: CONTRACT_VALIDATION_FAILURE_CONTRACT,
    schemaPath: asString(record.schemaPath) || '',
    contractId: asString(record.contractId) || asString(record.contract) || CONTRACT_VALIDATION_FAILURE_CONTRACT,
    capabilityId: asString(record.capabilityId) || asString(record.capability) || 'unknown-capability',
    failureKind,
    expected: record.expected,
    actual: record.actual,
    missingFields: asStringList(record.missingFields),
    invalidRefs: asStringList(record.invalidRefs),
    unresolvedUris: asStringList(record.unresolvedUris),
    failureReason: asString(record.failureReason) || asString(record.reason) || asString(record.message) || 'Contract validation failed.',
    recoverActions: asStringList(record.recoverActions),
    nextStep: asString(record.nextStep) || asString(record.repairAction) || 'Inspect the related refs and rerun after repairing the contract payload.',
    relatedRefs: uniqueStringList([
      ...asStringList(record.relatedRefs),
      ...asStringList(record.refs),
      ...asStringList(record.invalidRefs),
      ...asStringList(record.unresolvedUris),
    ]),
    issues: recordList(record.issues).map((issue) => ({
      path: asString(issue.path) || '',
      message: asString(issue.message) || asString(issue.detail) || 'Contract validation issue.',
      expected: asString(issue.expected),
      actual: asString(issue.actual),
      missingField: asString(issue.missingField),
      invalidRef: asString(issue.invalidRef),
      unresolvedUri: asString(issue.unresolvedUri),
    })),
    createdAt: asString(record.createdAt),
  };
}

function isContractValidationFailureRecord(value: Record<string, unknown>) {
  return value.contract === CONTRACT_VALIDATION_FAILURE_CONTRACT
    || (typeof value.failureKind === 'string'
      && (Array.isArray(value.issues) || Array.isArray(value.recoverActions) || Array.isArray(value.relatedRefs))
      && (typeof value.failureReason === 'string' || typeof value.message === 'string' || typeof value.reason === 'string'));
}

function messageFromContractValidationFailure(failure: ContractValidationFailure) {
  return [
    `failed-with-reason: ContractValidationFailure(${failure.failureKind}) ${failure.failureReason}`,
    failure.nextStep ? `nextStep: ${failure.nextStep}` : '',
    failure.recoverActions.length ? `recoverActions: ${failure.recoverActions.join('；')}` : '',
    failure.relatedRefs.length ? `relatedRefs: ${failure.relatedRefs.join('；')}` : '',
  ].filter(Boolean).join('\n');
}

function singleRecord(value: unknown): Record<string, unknown>[] {
  return isRecord(value) ? [value] : [];
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizeArtifactData(artifact: Record<string, unknown>) {
  if ('data' in artifact) return artifact.data;
  if ('content' in artifact) return artifact.content;
  if ('markdown' in artifact) return artifact.markdown;
  if ('report' in artifact) return artifact.report;
  if ('summary' in artifact) return artifact.summary;
  return undefined;
}

function normalizeNotebookRecords(
  value: unknown,
  defaults: {
    scenarioId: ScenarioInstanceId;
    messageText: string;
    claimType: ClaimType;
    confidence: number;
    now: string;
  },
) {
  if (!Array.isArray(value)) return [];
  const records = value.filter(isRecord).map((record) => ({
    id: asString(record.id) || makeId('note'),
    time: asString(record.time) || new Date(defaults.now).toLocaleString('zh-CN', { hour12: false }),
    scenario: asString(record.scenario) || defaults.scenarioId,
    title: asString(record.title) || asString(record.id) || 'Notebook record',
    desc: asString(record.desc) || asString(record.description) || defaults.messageText.slice(0, 96),
    claimType: pickClaimType(record.claimType),
    confidence: asNumber(record.confidence) ?? defaults.confidence,
    artifactRefs: asStringArray(record.artifactRefs),
    executionUnitRefs: asStringArray(record.executionUnitRefs),
    beliefRefs: asStringArray(record.beliefRefs),
    dependencyRefs: asStringArray(record.dependencyRefs),
    updateReason: asString(record.updateReason),
  }));
  return records;
}

function asTimelineVisibility(value: unknown) {
  return value === 'private-draft'
    || value === 'team-visible'
    || value === 'project-record'
    || value === 'restricted-sensitive'
    ? value
    : undefined;
}

function asExportPolicy(value: unknown) {
  return value === 'allowed' || value === 'restricted' || value === 'blocked'
    ? value
    : undefined;
}

function isViewTransform(value: unknown) {
  if (!isRecord(value)) return false;
  return value.type === 'filter'
    || value.type === 'sort'
    || value.type === 'limit'
    || value.type === 'group'
    || value.type === 'derive';
}
