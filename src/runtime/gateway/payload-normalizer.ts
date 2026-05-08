import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceTaskRunResult } from '../runtime-types.js';
import { isRecord, uniqueStrings } from '../gateway-utils.js';
import { composeRuntimeUiManifest } from '../runtime-ui-manifest.js';
import { sha1 } from '../workspace-task-runner.js';
import { expectedArtifactTypesForRequest } from './gateway-request.js';
import { normalizeArtifactsForPayload, persistArtifactRefsForPayload, type RuntimeRefBundle } from './artifact-materializer.js';
import { normalizeRuntimeVerificationResultsOrUndefined } from './verification-results.js';

export function isToolPayload(value: unknown): value is ToolPayload {
  if (!isRecord(value)) return false;
  return typeof value.message === 'string'
    && Array.isArray(value.claims)
    && Array.isArray(value.uiManifest)
    && Array.isArray(value.executionUnits)
    && Array.isArray(value.artifacts);
}

export function coerceAgentServerToolPayload(value: unknown): ToolPayload | undefined {
  const normalized = normalizeAgentServerToolPayloadCandidate(value);
  if (!isRecord(normalized)) return undefined;
  const message = firstStringField(normalized, ['message', 'summary', 'answer', 'finalText', 'handoffSummary']);
  const artifacts = normalizeAgentServerArtifacts(normalized.artifacts, message);
  return {
    message: message || 'AgentServer completed the request.',
    confidence: typeof normalized.confidence === 'number' ? normalized.confidence : 0.72,
    claimType: typeof normalized.claimType === 'string' ? normalized.claimType : 'evidence-summary',
    evidenceLevel: typeof normalized.evidenceLevel === 'string' ? normalized.evidenceLevel : 'agentserver',
    reasoningTrace: typeof normalized.reasoningTrace === 'string' ? normalized.reasoningTrace : 'AgentServer returned a structured ToolPayload candidate.',
    claims: normalizeAgentServerClaims(normalized.claims, message),
    uiManifest: normalizeAgentServerUiManifest(normalized.uiManifest, artifacts),
    executionUnits: normalizeAgentServerExecutionUnits(normalized.executionUnits),
    artifacts,
    displayIntent: isRecord(normalized.displayIntent) ? normalized.displayIntent : undefined,
    objectReferences: Array.isArray(normalized.objectReferences) ? normalized.objectReferences.filter(isRecord) : undefined,
    verificationResults: normalizeRuntimeVerificationResultsOrUndefined(normalized.verificationResults ?? normalized.verificationResult),
    verificationPolicy: isRecord(normalized.verificationPolicy) ? normalized.verificationPolicy as unknown as ToolPayload['verificationPolicy'] : undefined,
  };
}

export function coerceWorkspaceTaskPayload(value: unknown): ToolPayload | undefined {
  if (isToolPayload(value)) return value;
  if (isRecord(value)) {
    const nested = coerceAgentServerToolPayload(value.payload ?? value.toolPayload ?? value.result ?? value.data);
    if (nested) return nested;
    return coerceStandaloneArtifactPayload(value);
  }
  if (typeof value === 'string') return coerceAgentServerToolPayload(extractJson(value));
  return undefined;
}

export function coerceStandaloneArtifactPayload(value: Record<string, unknown>): ToolPayload | undefined {
  const artifactType = typeof value.type === 'string' ? value.type : typeof value.artifactType === 'string' ? value.artifactType : undefined;
  if (!artifactType) return undefined;
  const artifact = {
    ...value,
    id: typeof value.id === 'string' ? value.id : artifactType,
    type: artifactType,
    data: isRecord(value.data) ? value.data : artifactDataFromLooseArtifact(value),
  };
  return {
    message: `Generated ${artifactType}.`,
    confidence: 0.7,
    claimType: 'artifact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'Workspace task returned a standalone artifact; SciForge wrapped it as ToolPayload.',
    claims: [],
    uiManifest: [{ componentId: componentForStandaloneArtifact(artifactType), artifactRef: artifact.id, priority: 1 }],
    executionUnits: [],
    artifacts: [artifact],
  };
}

export async function validateAndNormalizePayload(
  payload: ToolPayload,
  request: GatewayRequest,
  skill: SkillAvailability,
  refs: RuntimeRefBundle & { runtimeFingerprint: Record<string, unknown> },
  planRefs: Record<string, unknown> = {},
) {
  const errors = schemaErrors(payload);
  if (errors.length) return undefined;
  const workspace = request.workspacePath || process.cwd();
  const normalizedArtifacts = await normalizeArtifactsForPayload(Array.isArray(payload.artifacts) ? payload.artifacts : [], workspace, refs);
  const persistedArtifacts = await persistArtifactRefsForPayload(workspace, request, normalizedArtifacts, refs);
  const referenceFailures = currentReferenceUsageFailures(payload, persistedArtifacts, request);
  const referenceFailureUnits = referenceFailures.map((failure, index) => ({
    id: `current-reference-usage-${index + 1}`,
    status: 'failed-with-reason',
    tool: 'sciforge.current-reference-gate',
    failureReason: failure,
    recoverActions: [
      'Read the current-turn reference by ref/path/dataRef.',
      'Regenerate the final answer/artifacts from that reference, or report the ref as unreadable with nextStep.',
    ],
  }));
  const message = referenceFailures.length
    ? `Current-turn reference contract failed: ${referenceFailures.join('; ')}`
    : String(payload.message || `${skill.id} completed.`);
  return {
    message,
    confidence: typeof payload.confidence === 'number' ? payload.confidence : 0.5,
    claimType: String(payload.claimType || 'fact'),
    evidenceLevel: String(payload.evidenceLevel || 'runtime'),
    reasoningTrace: [
      String(payload.reasoningTrace || ''),
      `Skill: ${skill.id}`,
      `Runtime gateway refs: taskCodeRef=${refs.taskRel}, outputRef=${refs.outputRel}, stdoutRef=${refs.stdoutRel}, stderrRef=${refs.stderrRel}`,
    ].filter(Boolean).join('\n'),
    claims: Array.isArray(payload.claims) ? payload.claims : [],
    uiManifest: composeRuntimeUiManifest(Array.isArray(payload.uiManifest) ? payload.uiManifest : [], Array.isArray(payload.artifacts) ? payload.artifacts : [], request),
    executionUnits: [
      ...(Array.isArray(payload.executionUnits) ? payload.executionUnits : []).map((unit) => isRecord(unit) ? {
      language: 'python',
      codeRef: refs.taskRel,
      stdoutRef: refs.stdoutRel,
      stderrRef: refs.stderrRel,
      outputRef: refs.outputRel,
      runtimeFingerprint: refs.runtimeFingerprint,
      skillId: skill.id,
      ...planRefs,
      ...unit,
      status: normalizeExecutionUnitStatus(unit.status),
      } : unit),
      ...referenceFailureUnits,
    ],
    artifacts: persistedArtifacts,
    logs: [{ kind: 'stdout', ref: refs.stdoutRel }, { kind: 'stderr', ref: refs.stderrRel }],
    verificationResults: payload.verificationResults,
    verificationPolicy: payload.verificationPolicy,
  };
}

function currentReferenceUsageFailures(
  payload: ToolPayload,
  artifacts: Array<Record<string, unknown>>,
  request: GatewayRequest,
) {
  const references = currentTurnReferences(request).filter(shouldRequireCurrentReferenceUse);
  if (!references.length) return [];
  const haystack = payloadReferenceUseHaystack(payload, artifacts);
  return references
    .filter((reference) => !referenceTokens(reference).some((token) => containsMeaningfulReferenceToken(haystack, token)))
    .map((reference) => `Current-turn reference was not reflected in answer/artifacts: ${stringField(reference.ref) ?? stringField(reference.title) ?? 'unknown-ref'}`);
}

function currentTurnReferences(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const refs = Array.isArray(uiState.currentReferences) ? uiState.currentReferences.filter(isRecord) : [];
  return refs.slice(0, 8);
}

function shouldRequireCurrentReferenceUse(reference: Record<string, unknown>) {
  const kind = String(reference.kind || '').toLowerCase();
  if (kind === 'ui') {
    const payload = isRecord(reference.payload) ? reference.payload : {};
    const selectedText = typeof payload.selectedText === 'string' ? payload.selectedText.trim() : '';
    const textRange = isRecord(reference.locator) && typeof reference.locator.textRange === 'string' ? reference.locator.textRange.trim() : '';
    return selectedText.length >= 12 || textRange.length >= 12 || /^ui-text:/i.test(String(reference.ref || ''));
  }
  return true;
}

function payloadReferenceUseHaystack(payload: ToolPayload, artifacts: Array<Record<string, unknown>>) {
  const values = [
    payload.message,
    payload.reasoningTrace,
    ...payload.claims.flatMap((claim) => isRecord(claim) ? [
      claim.text,
      claim.claim,
      Array.isArray(claim.supportingRefs) ? claim.supportingRefs.join(' ') : undefined,
      Array.isArray(claim.opposingRefs) ? claim.opposingRefs.join(' ') : undefined,
    ] : [String(claim)]),
    ...artifacts.flatMap((artifact) => [
      artifact.id,
      artifact.type,
      artifact.path,
      artifact.dataRef,
      JSON.stringify(isRecord(artifact.metadata) ? artifact.metadata : {}),
      compactArtifactDataForReferenceUse(artifact.data),
    ]),
  ];
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join('\n').toLowerCase();
}

function compactArtifactDataForReferenceUse(data: unknown) {
  if (typeof data === 'string') return data.slice(0, 8000);
  if (!isRecord(data)) return '';
  const values: string[] = [];
  for (const key of ['markdown', 'report', 'content', 'summary', 'text', 'title']) {
    if (typeof data[key] === 'string') values.push(String(data[key]).slice(0, 8000));
  }
  if (Array.isArray(data.sections)) {
    values.push(...data.sections.slice(0, 12).flatMap((section) => isRecord(section)
      ? [String(section.title || ''), String(section.content || section.markdown || '')]
      : []));
  }
  return values.join('\n');
}

function referenceTokens(reference: Record<string, unknown>) {
  const kind = String(reference.kind || '').toLowerCase();
  const payload = isRecord(reference.payload) ? reference.payload : {};
  const locator = isRecord(reference.locator) ? reference.locator : {};
  const identityTokens = [
    reference.ref,
    reference.title,
    reference.sourceId,
  ];
  const evidenceTokens = kind === 'ui' ? [
    reference.summary,
    typeof payload.selectedText === 'string' ? payload.selectedText : undefined,
    typeof payload.sourceTitle === 'string' ? payload.sourceTitle : undefined,
    typeof locator.textRange === 'string' ? locator.textRange : undefined,
  ] : [];
  return [...identityTokens, ...evidenceTokens]
    .filter((token): token is string => typeof token === 'string' && token.trim().length > 0);
}

function containsMeaningfulReferenceToken(haystack: string, token: string) {
  const normalized = token.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return false;
  if (haystack.includes(normalized)) return true;
  if (looksLikeReferencePath(normalized)) {
    const basename = normalized.replace(/^file:/, '').split(/[\\/]/).filter(Boolean).pop();
    return fileNameReflectionTokens(basename).some((candidate) => haystack.includes(candidate));
  }
  if (normalized.length > 48 && haystack.includes(normalized.slice(0, 48))) return true;
  const words = normalized.match(/[\p{L}\p{N}_-]{4,}/gu) ?? [];
  return words.slice(0, 8).some((word) => haystack.includes(word));
}

function fileNameReflectionTokens(basename: string | undefined) {
  if (!basename) return [];
  const decoded = decodeURIComponentSafe(basename).toLowerCase();
  const withoutQuery = decoded.split(/[?#]/)[0] ?? decoded;
  const stem = withoutQuery.replace(/\.[a-z0-9]{1,12}$/i, '');
  const suffixStem = stem.split('-').filter(Boolean).pop() ?? '';
  return [withoutQuery, stem, suffixStem]
    .map((token) => token.trim())
    .filter((token, index, tokens) => token.length >= 4 && tokens.indexOf(token) === index);
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function looksLikeReferencePath(value: string) {
  return /^(?:file|artifact|folder|url):/i.test(value)
    || /[\\/]/.test(value)
    || /\.(?:pdf|docx?|xlsx?|csv|tsv|json|md|markdown|txt|png|jpe?g|gif|webp|svg|html?|pdb|cif|mmcif)$/i.test(value);
}

export function normalizeToolPayloadShape(payload: ToolPayload): ToolPayload {
  return {
    ...payload,
    claims: Array.isArray(payload.claims) ? payload.claims : [],
    uiManifest: Array.isArray(payload.uiManifest) ? payload.uiManifest : [],
    executionUnits: Array.isArray(payload.executionUnits) ? payload.executionUnits : [],
    artifacts: Array.isArray(payload.artifacts) ? payload.artifacts : [],
    verificationResults: payload.verificationResults,
    verificationPolicy: payload.verificationPolicy,
  };
}

export function parseGenerationResponse(value: unknown) {
  const candidates = [
    value,
    isRecord(value) ? value.result : undefined,
    isRecord(value) ? value.text : undefined,
    isRecord(value) ? value.finalText : undefined,
    isRecord(value) ? value.handoffSummary : undefined,
    isRecord(value) ? value.outputSummary : undefined,
    ...structuredTextCandidates(value),
  ];
  for (const candidate of candidates) {
    const parsed = typeof candidate === 'string' ? extractStandaloneJson(candidate) ?? extractJson(candidate) : candidate;
    if (!isRecord(parsed)) continue;
    const taskFiles = Array.isArray(parsed.taskFiles) ? parsed.taskFiles.filter(isRecord) : [];
    const entrypoint = normalizeGenerationEntrypoint(parsed.entrypoint);
    if (!taskFiles.length || typeof entrypoint.path !== 'string') continue;
    return {
      taskFiles: taskFiles.map((file) => ({
        path: String(file.path || ''),
        content: String(file.content || ''),
        language: String(file.language || 'python'),
      })),
      entrypoint: {
        language: entrypoint.language === 'r' || entrypoint.language === 'shell' || entrypoint.language === 'cli' ? entrypoint.language : 'python',
        path: String(entrypoint.path),
        command: typeof entrypoint.command === 'string' ? entrypoint.command : undefined,
        args: Array.isArray(entrypoint.args) ? entrypoint.args.map(String) : undefined,
      },
      environmentRequirements: isRecord(parsed.environmentRequirements) ? parsed.environmentRequirements : {},
      validationCommand: String(parsed.validationCommand || ''),
      expectedArtifacts: normalizeExpectedArtifactNames(parsed.expectedArtifacts),
      patchSummary: typeof parsed.patchSummary === 'string' ? parsed.patchSummary : undefined,
    };
  }
  return undefined;
}

export function toolPayloadFromPlainAgentOutput(text: string, request: GatewayRequest): ToolPayload {
  const structured = coerceAgentServerToolPayload(extractJson(text));
  if (structured) return structured;
  const expected = expectedArtifactTypesForRequest(request);
  return {
    message: text,
    confidence: 0.72,
    claimType: 'evidence-summary',
    evidenceLevel: 'agentserver-direct',
    reasoningTrace: 'AgentServer returned plain text; SciForge converted it into a ToolPayload so the work remains visible and auditable.',
    claims: [{
      text: text.split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 240) || 'AgentServer completed the request.',
      type: 'inference',
      confidence: 0.72,
      evidenceLevel: 'agentserver-direct',
      supportingRefs: [],
      opposingRefs: [],
    }],
    uiManifest: [{ componentId: 'execution-unit-table', artifactRef: `${request.skillDomain}-runtime-result`, priority: 1 }],
    executionUnits: [{
      id: `agentserver-direct-${sha1(text).slice(0, 8)}`,
      status: 'done',
      tool: 'agentserver.direct-text',
      params: JSON.stringify({ expectedArtifactTypes: expected, prompt: request.prompt.slice(0, 200) }),
    }],
    artifacts: [],
  };
}

function structuredTextCandidates(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();
  const visit = (item: unknown, depth: number) => {
    if (depth > 5 || item === null || item === undefined || seen.has(item)) return;
    if (typeof item === 'string') {
      out.push(item);
      return;
    }
    if (!isRecord(item) && !Array.isArray(item)) return;
    seen.add(item);
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
      return;
    }
    for (const key of ['finalText', 'handoffSummary', 'outputSummary', 'result', 'text', 'output', 'data', 'run', 'stages']) visit(item[key], depth + 1);
  };
  visit(value, 0);
  return uniqueStrings(out);
}

function normalizeExpectedArtifactNames(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (isRecord(entry)) return stringField(entry.type) ?? stringField(entry.id) ?? JSON.stringify(entry);
    return String(entry);
  });
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

type NormalizedGenerationEntrypoint = {
  language?: WorkspaceTaskRunResult['spec']['language'] | string;
  path?: string;
  command?: string;
  args?: unknown[];
};

function normalizeGenerationEntrypoint(value: unknown): NormalizedGenerationEntrypoint {
  if (typeof value === 'string' && value.trim()) {
    const command = value.trim();
    const path = extractEntrypointPath(command) ?? command;
    return { language: inferLanguageFromEntrypoint(command), path, command, args: extractEntrypointArgs(command, path) };
  }
  if (isRecord(value)) {
    const path = typeof value.path === 'string' ? extractEntrypointPath(value.path) ?? value.path : undefined;
    const command = typeof value.command === 'string' ? value.command : undefined;
    const resolvedPath = path ?? extractEntrypointPath(command);
    return {
      path: resolvedPath,
      command,
      args: Array.isArray(value.args) ? value.args : extractEntrypointArgs(command, resolvedPath),
      language: typeof value.language === 'string' ? value.language : inferLanguageFromEntrypoint(resolvedPath ?? command),
    };
  }
  return {};
}

function extractEntrypointArgs(command: unknown, path: unknown) {
  const commandText = typeof command === 'string' ? command.trim() : '';
  if (!commandText) return undefined;
  const tokens = splitCommandLine(commandText);
  const pathText = typeof path === 'string' ? path.trim().replace(/^\.\//, '') : '';
  let start = /^(?:python(?:\d(?:\.\d+)?)?|python3|Rscript|bash|sh|node|tsx)$/.test(tokens[0] || '') ? 1 : 0;
  if (tokens[start]) {
    const tokenPath = tokens[start].replace(/^\.\//, '');
    if (!pathText || tokenPath === pathText || tokenPath.endsWith(`/${pathText}`) || pathText.endsWith(`/${tokenPath}`)) start += 1;
  }
  const args = tokens.slice(start);
  return args.length ? args : undefined;
}

function splitCommandLine(command: string) {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (escaped) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

function extractEntrypointPath(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return undefined;
  const token = text.match(/(?:^|\s)(\.?\/?\.sciforge\/tasks\/[^\s"'<>]+\.(?:py|R|r|sh))(?:\s|$)/)?.[1]
    ?? text.match(/(?:^|\s)([^\s"'<>]+\.(?:py|R|r|sh))(?:\s|$)/)?.[1];
  return token ? token.replace(/^\.\//, '') : undefined;
}

function inferLanguageFromEntrypoint(value: unknown): WorkspaceTaskRunResult['spec']['language'] {
  const text = typeof value === 'string' ? value : '';
  if (/\.r(?:\s|$)/i.test(text) || /\bRscript\b/.test(text)) return 'r';
  if (/\.sh(?:\s|$)/i.test(text) || /\b(?:bash|sh)\b/.test(text)) return 'shell';
  return 'python';
}

function normalizeAgentServerToolPayloadCandidate(value: unknown, depth = 0): unknown {
  if (depth > 4) return value;
  if (typeof value === 'string') return extractStandaloneJson(value) ?? extractJson(value) ?? value;
  if (!isRecord(value)) return value;
  if (isToolPayload(value) || Array.isArray(value.artifacts) || Array.isArray(value.executionUnits) || Array.isArray(value.claims)) return value;
  for (const key of ['payload', 'toolPayload', 'result', 'data', 'output', 'finalText', 'handoffSummary']) {
    const nested = normalizeAgentServerToolPayloadCandidate(value[key], depth + 1);
    if (isRecord(nested) && (isToolPayload(nested) || Array.isArray(nested.artifacts) || Array.isArray(nested.executionUnits) || Array.isArray(nested.claims))) return nested;
  }
  return value;
}

function firstStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return stripOuterJsonFence(value.trim());
  }
  return undefined;
}

function normalizeAgentServerClaims(value: unknown, message?: string): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const claims = value.map((claim) => {
      if (typeof claim === 'string') return { text: claim, type: 'inference', confidence: 0.72, evidenceLevel: 'agentserver' };
      if (isRecord(claim)) return claim;
      return undefined;
    }).filter(isRecord);
    if (claims.length) return claims;
  }
  return [{
    text: (message || 'AgentServer completed the request.').split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 240) || 'AgentServer completed the request.',
    type: 'inference',
    confidence: 0.72,
    evidenceLevel: 'agentserver',
    supportingRefs: [],
    opposingRefs: [],
  }];
}

function normalizeAgentServerUiManifest(value: unknown, artifacts: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const manifest = value.map((slot) => isRecord(slot) ? slot : undefined).filter(isRecord);
    if (manifest.length) return manifest;
  }
  if (artifacts.some((artifact) => artifact.type === 'research-report')) return [{ componentId: 'report-viewer', artifactRef: 'research-report', priority: 1 }];
  return [{ componentId: 'execution-unit-table', artifactRef: 'agentserver-runtime-result', priority: 1 }];
}

function normalizeAgentServerExecutionUnits(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const units = value.map((unit) => isRecord(unit) ? unit : undefined).filter(isRecord);
    if (units.length) return units;
  }
  return [{ id: `agentserver-direct-${sha1(JSON.stringify(value ?? {})).slice(0, 8)}`, status: 'done', tool: 'agentserver.direct-text', params: '{}' }];
}

function normalizeAgentServerArtifacts(value: unknown, message?: string): Array<Record<string, unknown>> {
  const artifacts = Array.isArray(value) ? value.map((artifact) => isRecord(artifact) ? artifact : undefined).filter(isRecord) : [];
  if (!artifacts.length && message) {
    return [{
      id: 'research-report',
      type: 'research-report',
      schemaVersion: '1',
      metadata: { source: 'agentserver-structured-answer' },
      data: { markdown: message, sections: [{ title: 'AgentServer Report', content: message }] },
    }];
  }
  return artifacts.map((artifact) => {
    const type = String(artifact.type || artifact.artifactType || artifact.id || '');
    const id = String(artifact.id || artifact.ref || type || 'artifact');
    const normalizedArtifact = { ...artifact, id, type };
    const data = isRecord(artifact.data) ? artifact.data : artifactDataFromLooseArtifact(normalizedArtifact);
    return Object.keys(data).length ? { ...normalizedArtifact, data } : normalizedArtifact;
  });
}

function artifactDataFromLooseArtifact(artifact: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(artifact)) {
    if (['id', 'type', 'artifactType', 'schemaVersion', 'metadata', 'dataRef', 'visibility', 'audience', 'sensitiveDataFlags', 'exportPolicy'].includes(key)) continue;
    data[key] = value;
  }
  return data;
}

function componentForStandaloneArtifact(type: string) {
  if (/paper|literature/i.test(type)) return 'paper-card-list';
  if (/report|summary|markdown/i.test(type)) return 'report-viewer';
  if (/table|csv|data/i.test(type)) return 'data-table';
  return 'unknown-artifact-inspector';
}

function stripOuterJsonFence(text: string) {
  const fenced = text.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() || text;
}

function extractStandaloneJson(text: string): unknown {
  const stripped = stripOuterJsonFence(text).trim();
  if (!stripped.startsWith('{')) return undefined;
  try {
    return JSON.parse(stripped);
  } catch {
    return undefined;
  }
}

function extractJson(text: string): unknown {
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

function normalizeExecutionUnitStatus(value: unknown) {
  const text = typeof value === 'string' ? value : '';
  return ['planned', 'running', 'done', 'failed', 'record-only', 'repair-needed', 'self-healed', 'failed-with-reason', 'needs-human'].includes(text) ? text : 'done';
}

function schemaErrors(payload: unknown) {
  if (!isRecord(payload)) return ['payload is not an object'];
  const errors: string[] = [];
  for (const key of ['message', 'claims', 'uiManifest', 'executionUnits', 'artifacts']) {
    if (!(key in payload)) errors.push(`${key} is required`);
  }
  return errors;
}
