import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { expectedArtifactTypesForRequest } from './gateway-request.js';
import { clipForBackendJson, isRecord, toRecordList } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import { isToolPayload } from './tool-payload-contract.js';
import { normalizeRuntimeVerificationResultsOrUndefined } from './verification-results.js';
import {
  directAnswerArtifactNeedsRepair,
  directAnswerPlainTextResultPolicy,
  directAnswerResultPolicyIds,
  ensureDirectAnswerReportArtifactPolicy,
  normalizeDirectAnswerArtifacts,
  normalizeDirectAnswerUiManifest,
  standaloneWorkspaceArtifactPayloadPolicy,
  stripDirectAnswerJsonFence,
} from '../../../packages/presentation/interactive-views/direct-answer-result-policy.js';

type ArtifactReferenceContextCollector = (request: GatewayRequest) => Promise<{ combinedArtifacts: Array<Record<string, unknown>> } | undefined>;
let artifactReferenceContextCollector: ArtifactReferenceContextCollector | undefined;
const reportViewerComponentId = ['report', 'viewer'].join('-');
const executionUnitTableComponentId = ['execution', 'unit', 'table'].join('-');
const unknownArtifactInspectorComponentId = ['unknown', 'artifact', 'inspector'].join('-');

export {
  GENERATED_TASK_PAYLOAD_PREFLIGHT_SCHEMA_VERSION,
  evaluateGeneratedTaskPayloadPreflight,
  type GeneratedTaskPayloadPreflightIssue,
  type GeneratedTaskPayloadPreflightReport,
} from './generated-task-payload-preflight.js';

export function configureDirectAnswerArtifactContext(collector: ArtifactReferenceContextCollector) {
  artifactReferenceContextCollector = collector;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizePayloadConfidence(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function artifactNeedsRepair(artifact: Record<string, unknown>) {
  return directAnswerArtifactNeedsRepair(artifact);
}

export function toolPayloadFromPlainAgentOutput(text: string, request: GatewayRequest): ToolPayload {
  const extracted = extractJson(text);
  const explanation = coerceBackendExplanationPayload(extracted, request);
  if (explanation) return ensureDirectAnswerReportArtifact(explanation, request, directAnswerResultPolicyIds.structuredAnswerSource);
  const structured = coerceBackendToolPayload(extracted);
  if (structured) return ensureDirectAnswerReportArtifact(structured, request, directAnswerResultPolicyIds.structuredAnswerSource);
  const nested = extractNestedBackendPayloadFromText(text);
  if (nested) return ensureDirectAnswerReportArtifact(nested, request, directAnswerResultPolicyIds.structuredAnswerSource);
  const directTextGuard = classifyPlainAgentText(text);
  if (directTextGuard.kind === 'human-answer') {
    const missingExecutionEvidence = directPlainAnswerMissingRequiredExecutionEvidence(text, request);
    if (missingExecutionEvidence) return guardedDirectTextDiagnosticPayload(text, request, missingExecutionEvidence);
    return toolPayloadFromPlainHumanAnswer(text, request, directTextGuard);
  }
  return guardedDirectTextDiagnosticPayload(text, request, directTextGuard);
}

function coerceBackendExplanationPayload(value: unknown, request: GatewayRequest): ToolPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.taskFiles) || isRecord(value.response) || isRecord(value.projectPlan)) return undefined;
  if (['claims', 'uiManifest', 'executionUnits', 'artifacts', 'objectReferences'].some((key) => Array.isArray(value[key]))) return undefined;
  const message = stringField(value.message);
  if (!message) return undefined;
  const claimType = stringField(value.claimType) ?? 'backend-explanation';
  const evidenceLevel = stringField(value.evidenceLevel) ?? 'backend';
  const reasoningTrace = typeof value.reasoningTrace === 'string'
    ? value.reasoningTrace
    : `Runtime backend returned a structured explanation JSON without full ToolPayload arrays; SciForge normalized it at the direct-answer boundary.`;
  const blocking = /\b(cannot|can't|unable|blocked|required|requires|missing|budget|quota|permission|credential|increase|refine|narrow|failed|failure)\b/i.test(message);
  const status = blocking ? 'failed-with-reason' : 'needs-human';
  const id = sha1(`backend-explanation:${message}`).slice(0, 10);
  const expected = expectedArtifactTypesForRequest(request);
  const confidence = typeof value.confidence === 'number' ? value.confidence : undefined;
  return {
    message,
    ...(confidence !== undefined ? { confidence } : {}),
    claimType,
    evidenceLevel,
    reasoningTrace,
    claims: [{
      id: `claim-backend-explanation-${id}`,
      text: message,
      type: claimType,
      ...(confidence !== undefined ? { confidence } : {}),
      evidenceLevel,
      supportingRefs: [],
      opposingRefs: [],
    }],
    uiManifest: [{
      componentId: reportViewerComponentId,
      artifactRef: `backend-explanation-${id}`,
      title: blocking ? 'Blocked result explanation' : 'Runtime explanation',
      priority: 1,
    }],
    executionUnits: [{
      id: `backend-explanation-${id}`,
      status,
      tool: directAnswerResultPolicyIds.directTextTool,
      params: JSON.stringify({ expectedArtifactTypes: expected, prompt: request.prompt.slice(0, 200) }),
      failureReason: blocking ? message : undefined,
      recoverActions: blocking
        ? ['Narrow the request, increase the runtime budget, or retry with the missing provider/permission.']
        : ['Ask the backend to return complete ToolPayload arrays if this explanation should include artifacts.'],
      nextStep: blocking ? 'Adjust the request or runtime budget, then retry.' : 'Retry with complete structured output if artifacts are required.',
    }],
    artifacts: [{
      id: `backend-explanation-${id}`,
      type: blocking ? 'runtime-blocker' : 'backend-explanation',
      format: 'markdown',
      title: blocking ? 'Blocked result explanation' : 'Runtime explanation',
      content: [
        blocking ? '# Blocked result explanation' : '# Runtime explanation',
        '',
        message,
        '',
        '## Context',
        '',
        `- Expected artifacts: ${expected.length ? expected.join(', ') : 'none declared'}`,
        `- Evidence level: ${evidenceLevel}`,
      ].join('\n'),
      data: {
        message,
        expectedArtifactTypes: expected,
        normalizedFrom: 'backend-message-json',
      },
    }],
    displayIntent: {
      status: blocking ? 'failed' : 'needs-human',
      reason: blocking ? 'backend-explanation-blocked' : 'backend-explanation-needs-structure',
      primaryView: 'answer',
    },
  };
}

export type PlainAgentTextClassificationKind =
  | 'human-answer'
  | 'tool-payload-json'
  | 'task-files-json'
  | 'code-or-script'
  | 'runtime-log'
  | 'trace-or-debug-payload'
  | 'process-narration';

export interface PlainAgentTextClassification {
  kind: PlainAgentTextClassificationKind;
  reason: string;
}

export function classifyPlainAgentText(text: string): PlainAgentTextClassification {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'runtime-log', reason: 'empty direct text cannot satisfy the user-visible result contract' };
  if (looksLikeUserFacingStageResult(trimmed)) {
    return { kind: 'human-answer', reason: 'markdown stage result appears to be a user-facing answer with result/verdict sections' };
  }
  if (/"(?:message|claims|uiManifest|executionUnits|artifacts)"\s*:/.test(trimmed) || /\bToolPayload\b|raw[_\s-]*tool[_\s-]*payload/i.test(trimmed)) {
    return { kind: 'tool-payload-json', reason: 'direct text looks like an unparsed ToolPayload or payload fragment' };
  }
  if (/"taskFiles"\s*:|taskFiles\s*[:=]|\b(outputRel|stdoutRel|stderrRel|taskRel)\b/.test(trimmed)) {
    return { kind: 'task-files-json', reason: 'direct text looks like generated taskFiles or workspace task metadata' };
  }
  if (/\b(stdout|stderr|stack trace|traceback \(most recent call last\)|error:|exception:)\b/i.test(trimmed)
    && /(?:\n|at\s+\S+\s+\(|\.ts:\d+|\.py", line \d+)/i.test(trimmed)) {
    return { kind: 'runtime-log', reason: 'direct text looks like raw logs or a stack trace' };
  }
  if (/\b(runtimeEvents|reasoningTrace|workEvidence|executionUnits|validationFailures|contractValidationFailure|schemaVersion)\b/.test(trimmed)
    && /[{[\]]/.test(trimmed)) {
    return { kind: 'trace-or-debug-payload', reason: 'direct text looks like runtime trace, schema, or debug payload' };
  }
  if (looksMostlyLikeCode(trimmed)) {
    return { kind: 'code-or-script', reason: 'direct text looks like code or script output that should be materialized as an artifact or execution unit' };
  }
  if (/^(?:i(?:'|’)ll|i will|let me|now i(?:'|’)ll|next i(?:'|’)ll|checking|inspecting|running|reading)\b/i.test(trimmed)
    && !/[.!?]\s*$/.test(trimmed.slice(0, 240))) {
    return { kind: 'process-narration', reason: 'direct text looks like intermediate process narration rather than a final answer' };
  }
  return { kind: 'human-answer', reason: 'direct text appears to be a user-facing answer' };
}

function directPlainAnswerMissingRequiredExecutionEvidence(
  text: string,
  request: GatewayRequest,
): PlainAgentTextClassification | undefined {
  const taskText = `${request.skillDomain ?? ''}\n${request.prompt ?? ''}`.toLowerCase();
  const reproduciblePackageMissing = directPlainAnswerMissingRequiredReproduciblePackageEvidence(text, taskText);
  if (reproduciblePackageMissing) return reproduciblePackageMissing;
  const asksForRuntimeWork = /\b(reproduc|code|coding|script|python|demo|run|self[-\s]?check|execute|debug|repair|fix|bug|patch|implement|refactor|test|metric|rmse|parameter|pr|pull request)\b/.test(taskText);
  if (!asksForRuntimeWork) return undefined;
  const asksForCodingDelivery = /\b(code|coding|repo|repository|source|typescript|javascript|python|debug|repair|fix|bug|patch|implement|refactor|test|pr|pull request)\b/.test(taskText);
  const answer = text.toLowerCase();
  const claimsRuntimeCompletion = /\b(i\s+(?:ran|executed|tested|verified|fixed|implemented|patched|updated|modified|changed|refactored)|ran|executed|self[-\s]?checked|succeeded|successfully|reproduced|recovered|fixed|implemented|patched|updated|modified|changed|refactored|tests?\s+(?:pass|passed)|typecheck\s+(?:pass|passed)|pr\s+ready|ready\s+for\s+pr|fit(?:ted)?|rmse|parameter\s+error)\b/.test(answer);
  if (!claimsRuntimeCompletion) return undefined;
  if (directPlainAnswerHasFailedVerificationDiagnostic(text)) {
    return {
      kind: 'process-narration',
      reason: 'direct text mixes completion claims with failed verification diagnostics and cannot be promoted without structured passing evidence',
    };
  }
  // Final execution/completion truth requires structured ToolPayload refs,
  // execution units, artifacts, or verification results. Plain text mentions of
  // file paths, commands, and pass/fail words are lexical evidence only.
  return {
    kind: 'process-narration',
    reason: asksForCodingDelivery
      ? 'direct text claims coding or repair completion but lacks structured patch, execution, artifact, or verification refs'
      : 'direct text claims code/reproduction execution success but lacks structured workspace execution evidence',
  };
}

function directPlainAnswerHasFailedVerificationDiagnostic(text: string) {
  if (text.split(/\r?\n/).some((line) => {
    return /\b(?:verification|verified|tests?|typecheck|build|check|self[-\s]?check)\b/i.test(line)
      && /\b(?:failed|fail|failing|error|assertion error|not ready|did not pass|does not pass)\b/i.test(line);
  })) return true;
  return /\b(?:verification|verified|tests?|typecheck|build|check|self[-\s]?check)\b[^\n.;]{0,120}\b(?:failed|fail|failing|error|assertion error|not ready|did not pass|does not pass)\b/i.test(text)
    || /\b(?:failed|fail|failing|error|assertion error|not ready|did not pass|does not pass)\b[^\n.;]{0,120}\b(?:verification|verified|tests?|typecheck|build|check|self[-\s]?check)\b/i.test(text);
}

function directPlainAnswerMissingRequiredReproduciblePackageEvidence(
  text: string,
  taskText: string,
): PlainAgentTextClassification | undefined {
  const asksForPackageArtifacts = /\b(rerun|script|notebook|raw\s+csv|cleaned\s+csv|qc|missingness|markdown\s+report|png\s+charts?)\b/.test(taskText);
  const asksForReproduciblePackage = asksForPackageArtifacts
    && /\b(generate|create|produce|package|analysis|workspace)\b/.test(taskText);
  if (!asksForReproduciblePackage) return undefined;
  const answer = text.toLowerCase();
  const claimsPackageSuccess = /\b(successfully|executed|generated|produced|artifacts?\s+produced|all required artifacts|package\s+(?:executed|generated|complete))\b/.test(answer);
  if (!claimsPackageSuccess) return undefined;
  const asksForExactRerun = /\b(exact\s+rerun\s+command|rerun\s+command\s+that\s+works|works\s+here|script\s+or\s+notebook|python\s+script|notebook)\b/.test(taskText);
  const citesArchivedTask = /\btaskFiles\b|codeRef|executionUnits|\.sciforge\/sessions\/[^`'"\s]+\/tasks\/[^`'"\s]+\.(?:py|ipynb)\b/i.test(text);
  const citesConcreteScript = /(?:^|[`'"\s])(?:\.sciforge\/|workspace\/|\/)[^`'"\s]+\.(?:py|ipynb)\b/i.test(text);
  const hasExactBundleRerun = /\bcd\s+['"]?\/[^`'\n"]*SciForge[^`'\n"]*['"]?\s+&&\s+python3?\s+['"]?\/[^`'\n"]+\.(?:py|ipynb)['"]?\s+['"]?\/[^`'\n"]+\.json['"]?\s+['"]?\/[^`'\n"]+\.json['"]?/i.test(text);
  if (asksForExactRerun && !hasExactBundleRerun) {
    return {
      kind: 'process-narration',
      reason: 'direct text claims a reproducible workspace package but does not provide an exact bundle-local rerun command with absolute script, input, and output paths',
    };
  }
  if (!citesArchivedTask && !citesConcreteScript) {
    return {
      kind: 'process-narration',
      reason: 'direct text claims a reproducible workspace package but does not cite an archived script/notebook or taskFiles execution unit',
    };
  }
  return undefined;
}

function looksLikeUserFacingStageResult(text: string) {
  const head = text.slice(0, 2400);
  if (!/^#{1,3}\s+Stage Result:/i.test(head)) return false;
  if (looksLikeRawJsonEnvelope(text)) return false;
  const hasResultSection = /#{2,4}\s+(Results?|Execution\s*&\s*Validation|Repair Verdict|Verdict|Summary|Diagnosis)\b/i.test(text);
  const hasUserFacingEvidence = /\b(RMSE|error|succeeded|failed|verdict|exit code|script path|run command|output artifacts)\b/i.test(text);
  return hasResultSection && hasUserFacingEvidence;
}

function looksLikeRawJsonEnvelope(text: string) {
  const trimmed = text.trim();
  if (/^```(?:json)?\s*\{[\s\S]*\}\s*```$/i.test(trimmed)) return true;
  if (/^\{[\s\S]*"(?:message|claims|uiManifest|executionUnits|artifacts)"\s*:/.test(trimmed)) return true;
  return false;
}

function guardedDirectTextDiagnosticPayload(
  text: string,
  request: GatewayRequest,
  classification: PlainAgentTextClassification,
): ToolPayload {
  const id = sha1(`${classification.kind}:${text}`).slice(0, 10);
  const expected = expectedArtifactTypesForRequest(request);
  const excerpt = clipForBackendJson(text, 2000);
  return {
    message: 'Runtime backend returned raw generated work instead of a user-facing result. SciForge preserved it as a diagnostic and did not present it as the final answer.',
    confidence: 0,
    claimType: 'runtime-diagnostic',
    evidenceLevel: 'backend-direct-text-guard',
    reasoningTrace: [
      'Plain runtime text was blocked by the strict ToolPayload boundary.',
      `classification=${classification.kind}`,
      `reason=${classification.reason}`,
    ].join('\n'),
    claims: [{
      id: `claim-direct-text-guard-${id}`,
      text: 'Plain runtime output was not a structured ToolPayload or taskFiles response and cannot be promoted to a final answer.',
      type: 'runtime-diagnostic',
      confidence: 0,
      evidenceLevel: 'backend-direct-text-guard',
      supportingRefs: [`artifact:backend-direct-text-diagnostic-${id}`],
      opposingRefs: [],
    }],
    uiManifest: [
      {
        componentId: reportViewerComponentId,
        artifactRef: `backend-direct-text-diagnostic-${id}`,
        title: 'Direct text diagnostic',
        priority: 1,
      },
      {
        componentId: executionUnitTableComponentId,
        title: 'Recovery unit',
        priority: 2,
      },
    ],
    executionUnits: [{
      id: `backend-direct-text-guard-${id}`,
      status: 'needs-human',
      tool: directAnswerResultPolicyIds.directTextTool,
      params: JSON.stringify({ classification: classification.kind, expectedArtifactTypes: expected, prompt: request.prompt.slice(0, 200) }),
      failureReason: classification.reason,
      recoverActions: [
        'Ask the backend to return a structured ToolPayload with artifacts, executionUnits, and uiManifest.',
        'If this is prose, return it inside a strict ToolPayload with structured claims, refs, artifacts, and displayIntent.',
      ],
      nextStep: 'Retry with structured output or inspect the preserved diagnostic artifact.',
    }],
    artifacts: [{
      id: `backend-direct-text-diagnostic-${id}`,
      type: 'runtime-diagnostic',
      format: 'markdown',
      title: 'Runtime direct text guard',
      content: [
        '# Runtime direct text guard',
        '',
        `- Classification: ${classification.kind}`,
        `- Reason: ${classification.reason}`,
        `- Expected artifacts: ${expected.length ? expected.join(', ') : 'none declared'}`,
        '',
        '## Preserved excerpt',
        '',
        '```text',
        excerpt,
        '```',
      ].join('\n'),
      data: {
        classification: classification.kind,
        reason: classification.reason,
        excerpt,
        expectedArtifactTypes: expected,
      },
    }],
    displayIntent: {
      status: 'needs-human',
      reason: 'direct-text-fallback-guard',
      primaryView: 'diagnostic',
    },
  };
}

function toolPayloadFromPlainHumanAnswer(
  text: string,
  request: GatewayRequest,
  classification: PlainAgentTextClassification,
): ToolPayload {
  const id = sha1(`${classification.kind}:${text}`).slice(0, 10);
  const trimmed = text.trim();
  const viewPolicy = directAnswerPlainTextResultPolicy(trimmed, {
    prompt: request.prompt,
    skillDomain: request.skillDomain,
    expectedArtifactTypes: expectedArtifactTypesForRequest(request),
  });
  const reportId = `backend-direct-answer-${id}`;
  const reportArtifact = {
    id: reportId,
    type: 'research-report',
    format: 'markdown',
    title: 'Runtime direct answer',
    schemaVersion: '1',
    metadata: {
      source: directAnswerResultPolicyIds.directTextTool,
      classification: classification.kind,
      reason: classification.reason,
    },
    data: {
      markdown: trimmed,
    },
  };
  const fileArtifacts = directAnswerFileArtifactsFromText(trimmed);
  const artifacts = dedupeDirectAnswerArtifacts([
    ...(viewPolicy.artifacts.length ? viewPolicy.artifacts : [reportArtifact]),
    ...fileArtifacts,
  ]);
  const uiManifest = viewPolicy.artifacts.length
    ? viewPolicy.uiManifest
    : [
      { componentId: reportViewerComponentId, artifactRef: reportId, title: 'Answer', priority: 1 },
      { componentId: executionUnitTableComponentId, title: 'Execution', priority: 2 },
    ];
  const uiManifestWithFileArtifacts = [
    ...uiManifest,
    ...directAnswerFileArtifactUiManifest(fileArtifacts, uiManifest.length + 1),
  ];
  return {
    message: trimmed,
    claimType: 'backend-direct-answer',
    evidenceLevel: 'backend',
    reasoningTrace: [
      'Plain runtime text was classified as a user-facing answer.',
      'SciForge wrapped it in a strict ToolPayload so ConversationProjection remains the user-visible source of truth.',
      `classification=${classification.kind}`,
      `reason=${classification.reason}`,
    ].join('\n'),
    claims: [{
      id: `claim-direct-answer-${id}`,
      text: trimmed.split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 240) || 'Runtime backend completed the request.',
      type: 'inference',
      evidenceLevel: 'backend',
      supportingRefs: [],
      opposingRefs: [],
    }],
    uiManifest: uiManifestWithFileArtifacts,
    executionUnits: [{
      id: `backend-direct-answer-${id}`,
      status: 'done',
      tool: directAnswerResultPolicyIds.directTextTool,
      params: JSON.stringify({ classification: classification.kind, prompt: request.prompt.slice(0, 200) }),
      hash: sha1(trimmed).slice(0, 16),
      outputRef: `artifact:${artifacts[0]?.id ?? reportId}`,
    }],
    artifacts,
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'completed',
      primaryView: 'answer',
    },
  };
}

function directAnswerFileArtifactsFromText(text: string): Array<Record<string, unknown>> {
  const paths = directAnswerWorkspaceFileRefs(text)
    .filter((ref) => /\.(?:csv|tsv|png|jpe?g|gif|webp|svg|md|markdown|json)(?:$|[?#])/i.test(ref));
  const artifacts: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const id = safeArtifactToken(artifactIdFromPath(path), 'artifact');
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const extension = fileExtension(path);
    const type = directAnswerArtifactTypeFromPath(path, extension);
    if (type === 'research-report' && seen.has('research-report')) continue;
    artifacts.push({
      id,
      type,
      path,
      dataRef: path,
      metadata: {
        source: 'backend-direct-text-file-ref',
        sourceRef: path,
        title: titleFromArtifactId(id),
        presentationRole: type === 'research-report' ? 'primary-deliverable' : 'supporting-evidence',
      },
    });
  }
  return artifacts;
}

function directAnswerWorkspaceFileRefs(text: string) {
  const candidates = [
    ...Array.from(text.matchAll(/(?:^|[`'"\s(:：])((?:\.{0,2}\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.@+-]+\.(?:csv|tsv|png|jpe?g|gif|webp|svg|md|markdown|json))(?:$|[`'"\s),，。:：])/gi), (match) => match[1]),
  ];
  return Array.from(new Set(candidates
    .map((candidate) => candidate.replace(/^\.\/+/, '').replace(/\\/g, '/').trim())
    .filter((candidate) => candidate && !candidate.startsWith('../') && !candidate.includes('/../') && !/^[a-z]+:\/\//i.test(candidate))));
}

function directAnswerArtifactTypeFromPath(path: string, extension: string) {
  const normalized = path.toLowerCase();
  if (extension === 'csv' || extension === 'tsv') return extension;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)) return 'image';
  if (extension === 'md' || extension === 'markdown') return /report|summary|analysis/.test(normalized) ? 'research-report' : 'markdown';
  if (/evidence[_-]?matrix|matrix/.test(normalized)) return 'evidence-matrix';
  if (/notebook[_-]?timeline|timeline/.test(normalized)) return 'notebook-timeline';
  return 'json';
}

function directAnswerFileArtifactUiManifest(artifacts: Array<Record<string, unknown>>, startPriority: number) {
  return artifacts.map((artifact, index) => ({
    componentId: componentForDirectAnswerFileArtifact(String(artifact.type || '')),
    artifactRef: String(artifact.id || artifact.type || 'artifact'),
    title: stringField(isRecord(artifact.metadata) ? artifact.metadata.title : undefined) ?? String(artifact.id || 'Artifact'),
    priority: startPriority + index,
  }));
}

function componentForDirectAnswerFileArtifact(type: string) {
  if (type === 'research-report' || type === 'markdown') return reportViewerComponentId;
  if (type === 'evidence-matrix') return 'evidence-matrix';
  if (type === 'notebook-timeline') return 'notebook-timeline';
  return unknownArtifactInspectorComponentId;
}

function dedupeDirectAnswerArtifacts(artifacts: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const artifact of artifacts) {
    const key = String(artifact.id || artifact.type || '').toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(artifact);
  }
  return out;
}

function mergeExistingContextArtifactsForDirectAnswer(
  payload: ToolPayload,
  request: GatewayRequest,
  referenceArtifacts: Array<Record<string, unknown>>,
): ToolPayload {
  const expected = new Set(expectedArtifactTypesForRequest(request));
  if (!expected.size || !referenceArtifacts.length) return payload;
  const present = new Set(payload.artifacts.map((artifact) => String(artifact.type || artifact.id || '')).filter(Boolean));
  const additions: Array<Record<string, unknown>> = [];
  for (const artifact of referenceArtifacts) {
    const type = String(artifact.type || artifact.id || '');
    if (!expected.has(type) || present.has(type) || artifactNeedsRepair(artifact)) continue;
    additions.push({
      ...artifact,
      metadata: {
        ...(isRecord(artifact.metadata) ? artifact.metadata : {}),
        source: stringField(isRecord(artifact.metadata) ? artifact.metadata.source : undefined) ?? directAnswerResultPolicyIds.existingContextSource,
        reusedForContextAnswer: true,
      },
    });
    present.add(type);
  }
  return additions.length ? { ...payload, artifacts: [...payload.artifacts, ...additions] } : payload;
}

export async function mergeReusableContextArtifactsForDirectPayload(
  payload: ToolPayload,
  request: GatewayRequest,
): Promise<ToolPayload> {
  const context = directPayloadReferencesExistingContext(payload, request)
    ? await artifactReferenceContextCollector?.(request)
    : undefined;
  return mergeExistingContextArtifactsForDirectAnswer(
    payload,
    request,
    context?.combinedArtifacts.length ? context.combinedArtifacts : request.artifacts,
  );
}

function directPayloadReferencesExistingContext(payload: ToolPayload, request: GatewayRequest) {
  const hasRecoverableContext = request.artifacts.length > 0
    || toRecordList(request.uiState?.recentExecutionRefs).length > 0
    || (Array.isArray(request.uiState?.recentConversation) && request.uiState.recentConversation.length > 1);
  if (!hasRecoverableContext) return false;
  const policy = isRecord(request.uiState?.contextReusePolicy) ? request.uiState.contextReusePolicy : undefined;
  if (policy) {
    const mode = typeof policy.mode === 'string' ? policy.mode : '';
    const historyReuse = isRecord(policy.historyReuse) ? policy.historyReuse : {};
    return historyReuse.allowed === true || mode === 'continue' || mode === 'repair';
  }
  return directPayloadCarriesStructuredContextRefs(payload);
}

function directPayloadCarriesStructuredContextRefs(payload: ToolPayload) {
  if (toRecordList(payload.objectReferences).some((reference) => {
    const ref = stringField(reference.ref);
    return ref ? /^(artifact|file|folder|run|execution-unit):/i.test(ref) : false;
  })) return true;
  if (payload.artifacts.some((artifact) => artifact.dataRef || artifact.ref || artifact.path)) return true;
  return payload.claims.some((claim) => toRecordList(claim.supportingRefs).length || toRecordList(claim.evidenceRefs).length);
}

export function ensureDirectAnswerReportArtifact(payload: ToolPayload, request: GatewayRequest, source: string): ToolPayload {
  const expected = expectedArtifactTypesForRequest(request);
  return ensureDirectAnswerReportArtifactPolicy(payload, {
    prompt: request.prompt,
    skillDomain: request.skillDomain,
    expectedArtifactTypes: expected,
  }, source);
}

export function coerceBackendToolPayload(value: unknown): ToolPayload | undefined {
  const normalized = normalizeBackendToolPayloadCandidate(value);
  return isToolPayload(normalized) ? normalizeToolPayloadShape(normalized) : undefined;
}

export function coerceWorkspaceTaskPayload(value: unknown): ToolPayload | undefined {
  if (isToolPayload(value)) return normalizeToolPayloadShape(value);
  if (!isRecord(value)) return undefined;
  const normalizedCandidate = normalizeToolPayloadShape(value as unknown as ToolPayload);
  if (isToolPayload(normalizedCandidate)) return normalizedCandidate;
  const strictNested = strictToolPayloadCandidate(value);
  if (strictNested) return normalizeToolPayloadShape(strictNested);
  const artifactPayload = coerceStandaloneArtifactPayload(value);
  if (artifactPayload) return artifactPayload;
  return undefined;
}

export function normalizeWorkspaceTaskPayloadBoundary(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    ...value,
    artifacts: normalizeWorkspaceTaskArtifacts(value.artifacts),
  };
}

export function normalizeWorkspaceTaskArtifacts(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value
      .map((artifact, index) => isRecord(artifact) ? normalizeWorkspaceTaskArtifactRecord(artifact, String(index + 1)) : undefined)
      .filter(isRecord);
  }
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .flatMap(([key, artifact]) => {
      if (!isRecord(artifact)) return [];
      return [{
        ...normalizeWorkspaceTaskArtifactRecord(artifact, key),
        metadata: {
          ...(isRecord(artifact.metadata) ? artifact.metadata : {}),
          originalArtifactKey: key,
          normalizedFromArtifactMap: true,
        },
      }];
    });
}

function normalizeWorkspaceTaskArtifactRecord(artifact: Record<string, unknown>, fallbackKey: string): Record<string, unknown> {
  const ref = artifactRefCandidate(artifact);
  const inferredId = stringField(artifact.id)
    ?? artifactIdFromRef(ref)
    ?? stringField(artifact.title)
    ?? stringField(artifact.label)
    ?? fallbackKey;
  const id = safeArtifactToken(inferredId, fallbackKey);
  const type = safeArtifactToken(
    stringField(artifact.type)
      ?? stringField(artifact.artifactType)
      ?? artifactTypeFromRef(ref)
      ?? (stringField(artifact.kind) && !/^file$/i.test(String(artifact.kind)) ? stringField(artifact.kind) : undefined)
      ?? id,
    id,
  );
  const path = stringField(artifact.path) ?? stringField(artifact.filePath) ?? stringField(artifact.ref);
  const dataRef = stringField(artifact.dataRef) ?? stringField(artifact.data_ref) ?? path;
  return {
    ...artifact,
    id,
    type,
    ...(path ? { path } : {}),
    ...(dataRef ? { dataRef } : {}),
    metadata: {
      ...(isRecord(artifact.metadata) ? artifact.metadata : {}),
      ...(ref && !stringField(isRecord(artifact.metadata) ? artifact.metadata.sourceRef : undefined) ? { sourceRef: ref } : {}),
      normalizedArtifactIdentity: stringField(artifact.id) && stringField(artifact.type) ? undefined : true,
    },
  };
}

function artifactRefCandidate(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  return stringField(artifact.dataRef)
    ?? stringField(artifact.path)
    ?? stringField(artifact.ref)
    ?? stringField(artifact.filePath)
    ?? stringField(metadata.path)
    ?? stringField(metadata.filePath)
    ?? stringField(metadata.markdownRef)
    ?? stringField(metadata.reportRef);
}

function artifactIdFromRef(ref: string | undefined) {
  if (!ref) return undefined;
  const last = ref.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  return last?.replace(/\.[^.]+$/, '');
}

function artifactTypeFromRef(ref: string | undefined) {
  const id = artifactIdFromRef(ref)?.toLowerCase();
  if (!id) return undefined;
  if (/research-report|report|summary|review|readme|project[-_]?brief|brief/.test(id)) return 'research-report';
  if (/paper-list|papers|bibliography|references/.test(id)) return 'paper-list';
  if (/evidence-matrix|evidence|matrix/.test(id)) return 'evidence-matrix';
  if (/timeline|budget/.test(id)) return 'notebook-timeline';
  if (/risk[-_]?register|decision[-_]?log/.test(id)) return 'evidence-matrix';
  if (/\.?csv$/.test(ref ?? '')) return 'data-table';
  if (/\.?md$|\.?markdown$/.test(ref ?? '')) return 'markdown';
  return id;
}

function artifactIdFromPath(path: string) {
  const basename = path.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() ?? path;
  return basename.replace(/\.[^.]+$/, '');
}

function fileExtension(path: string) {
  return path.replace(/[?#].*$/, '').match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() ?? '';
}

function titleFromArtifactId(id: string) {
  return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function safeArtifactToken(value: string | undefined, fallback: string) {
  return (value ?? fallback).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || fallback;
}

function coerceStandaloneArtifactPayload(value: Record<string, unknown>): ToolPayload | undefined {
  return standaloneWorkspaceArtifactPayloadPolicy(value) as ToolPayload | undefined;
}

export function normalizeToolPayloadShape(payload: ToolPayload): ToolPayload {
  const { confidence: rawConfidence, ...payloadWithoutConfidence } = payload as ToolPayload & { confidence?: unknown };
  const confidence = normalizePayloadConfidence(rawConfidence);
  const artifacts = normalizeWorkspaceTaskArtifacts(payload.artifacts);
  const rawDisplayIntent: unknown = payload.displayIntent;
  const message = String(payload.message || '');
  const executionUnits = normalizeBackendExecutionUnits(payload.executionUnits);
  return {
    ...payloadWithoutConfidence,
    ...(confidence !== undefined ? { confidence } : {}),
    claimType: String(payload.claimType || 'backend-answer'),
    evidenceLevel: String(payload.evidenceLevel || 'backend'),
    reasoningTrace: Array.isArray(payload.reasoningTrace)
      ? payload.reasoningTrace.map(String).filter(Boolean).join('\n')
      : typeof payload.reasoningTrace === 'string'
        ? payload.reasoningTrace
        : String(payload.reasoningTrace || ''),
    claims: normalizeBackendClaims(payload.claims, message),
    displayIntent: normalizeDirectAnswerDisplayIntent(rawDisplayIntent, message, executionUnits),
    uiManifest: normalizeDirectAnswerUiManifest(payload.uiManifest, artifacts),
    executionUnits,
    artifacts: normalizeDirectAnswerArtifacts(artifacts, payload.message),
    objectReferences: Array.isArray(payload.objectReferences) ? payload.objectReferences.filter(isRecord) : undefined,
  };
}

function normalizeBackendToolPayloadCandidate(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined;
  if (isToolPayload(value)) return value;
  if (typeof value === 'string') return normalizeBackendToolPayloadCandidate(extractJson(value), depth + 1);
  if (!isRecord(value)) return undefined;

  for (const key of ['payload', 'toolPayload', 'result', 'output', 'data']) {
    const nested = normalizeBackendToolPayloadCandidate(value[key], depth + 1);
    if (isToolPayload(nested)) return nested;
  }
  for (const key of ['markdown', 'report', 'text', 'finalText', 'handoffSummary', 'outputSummary']) {
    const nested = typeof value[key] === 'string'
      ? normalizeBackendToolPayloadCandidate(value[key], depth + 1)
      : undefined;
    if (isToolPayload(nested)) return nested;
  }

  const message = firstStringField(value, ['message', 'answer', 'summary', 'markdown', 'report', 'text', 'finalText', 'handoffSummary', 'outputSummary']);
  const artifacts = normalizeDirectAnswerArtifacts(normalizeWorkspaceTaskArtifacts(value.artifacts), message);
  const claims = normalizeBackendClaims(value.claims, message);
  const uiManifest = normalizeDirectAnswerUiManifest(value.uiManifest, artifacts);
  const executionUnits = normalizeBackendExecutionUnits(value.executionUnits);
  const objectReferences = Array.isArray(value.objectReferences) ? value.objectReferences.filter(isRecord) : undefined;
  const displayIntent = normalizeDirectAnswerDisplayIntent(value.displayIntent, message, executionUnits);

  if (!message || !claims.length || !uiManifest.length) return undefined;
  const confidence = typeof value.confidence === 'number' ? value.confidence : undefined;
  return {
    message,
    ...(confidence !== undefined ? { confidence } : {}),
    claimType: String(value.claimType || 'backend-answer'),
    evidenceLevel: String(value.evidenceLevel || 'backend'),
    reasoningTrace: String(value.reasoningTrace || 'Runtime backend returned structured answer JSON; SciForge normalized it into a ToolPayload.'),
    claims,
    uiManifest,
    executionUnits,
    artifacts,
    displayIntent,
    objectReferences,
    ...(isRecord(value.confidenceExplanation) ? { confidenceExplanation: value.confidenceExplanation as unknown as ToolPayload['confidenceExplanation'] } : {}),
    verificationResults: normalizeRuntimeVerificationResultsOrUndefined(value.verificationResults ?? value.verificationResult),
    verificationPolicy: isRecord(value.verificationPolicy) ? value.verificationPolicy as unknown as ToolPayload['verificationPolicy'] : undefined,
  };
}

function defaultDirectAnswerDisplayIntent(
  message: string | undefined,
  executionUnits: Array<Record<string, unknown>>,
): ToolPayload['displayIntent'] | undefined {
  if (!message?.trim()) return undefined;
  const hasBlockingUnit = executionUnits.some((unit) => /failed|error|repair|needs-human/i.test(String(unit.status || '')));
  if (hasBlockingUnit) return undefined;
  // Final direct-answer completion truth must be structured runtime status plus evidence,
  // never lexical completion words in the answer text alone.
  return {
    protocolStatus: 'protocol-success',
    taskOutcome: 'satisfied',
    status: 'completed',
    primaryView: 'answer',
  };
}

function normalizeDirectAnswerDisplayIntent(
  value: unknown,
  message: string | undefined,
  executionUnits: Array<Record<string, unknown>>,
): ToolPayload['displayIntent'] | undefined {
  const defaults = defaultDirectAnswerDisplayIntent(message, executionUnits);
  if (typeof value === 'string' && value.trim()) {
    return defaults ? { ...defaults, primaryView: value.trim() } : { primaryView: value.trim() };
  }
  if (!isRecord(value)) return defaults;
  if (directAnswerDisplayIntentIsBlocking(value)) return value;
  return defaults ? { ...defaults, ...value } : value;
}

function directAnswerDisplayIntentIsBlocking(value: Record<string, unknown>) {
  return /needs-work|needs-human|blocked|partial|unverified|failed|error/i.test([
    value.taskOutcome,
    value.status,
    value.answerStatus,
    value.userGoalStatus,
    value.protocolStatus,
  ].map((entry) => String(entry ?? '')).join(' '));
}

function strictToolPayloadCandidate(value: unknown, depth = 0): ToolPayload | undefined {
  if (depth > 4 || value === undefined || value === null) return undefined;
  if (isToolPayload(value)) return value;
  if (typeof value === 'string') return strictToolPayloadCandidate(extractJson(value), depth + 1);
  if (!isRecord(value)) return undefined;
  for (const key of ['payload', 'toolPayload', 'result', 'output', 'data']) {
    const nested = strictToolPayloadCandidate(value[key], depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

function extractNestedBackendPayloadFromText(text: string): ToolPayload | undefined {
  const parsed = extractJson(text);
  if (!isRecord(parsed)) return undefined;
  for (const key of ['markdown', 'report', 'message', 'text']) {
    const nested = typeof parsed[key] === 'string' ? coerceBackendToolPayload(extractJson(parsed[key])) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

function firstStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return stripOuterJsonFence(value.trim());
  }
  return undefined;
}

function normalizeBackendClaims(value: unknown, message?: string): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const claims = value.map((claim) => {
      if (typeof claim === 'string') return { text: claim, type: 'inference', evidenceLevel: 'backend' };
      if (isRecord(claim)) return claim;
      return undefined;
    }).filter(isRecord);
    if (claims.length) return claims;
  }
  return [{
    text: (message || 'Runtime backend completed the request.').split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 240) || 'Runtime backend completed the request.',
    type: 'inference',
    evidenceLevel: 'backend',
    supportingRefs: [],
    opposingRefs: [],
  }];
}

function normalizeBackendExecutionUnits(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const units = value.map((unit) => isRecord(unit) ? unit : undefined).filter(isRecord);
    if (units.length) return units;
  }
  return [{
    id: `backend-direct-${sha1(JSON.stringify(value ?? {})).slice(0, 8)}`,
    status: 'done',
    tool: directAnswerResultPolicyIds.directTextTool,
    params: '{}',
  }];
}

function looksMostlyLikeCode(text: string) {
  const fenced = text.match(/```(?!json\b)(?:[a-zA-Z0-9_+-]+)?\s*([\s\S]*?)```/);
  const sample = fenced?.[1] ?? text;
  const lines = sample.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  const codeLike = lines.filter((line) => {
    return /^(?:import|export|from|def|class|function|const|let|var|if|for|while|try|catch|type|interface)\b/.test(line)
      || /^[{}[\]();,]+$/.test(line)
      || /(?:=>|===|!==|;\s*$|\{\s*$|\}\s*$)/.test(line)
      || /^#!\/|^python\s|^node\s|^npm\s|^tsx\s/.test(line);
  }).length;
  return codeLike / lines.length >= 0.45;
}

function stripOuterJsonFence(text: string) {
  return stripDirectAnswerJsonFence(text);
}

export function extractStandaloneJson(text: string): unknown {
  const stripped = stripOuterJsonFence(text).trim();
  if (!stripped.startsWith('{')) return undefined;
  try {
    return JSON.parse(stripped);
  } catch {
    return undefined;
  }
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] || text;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
