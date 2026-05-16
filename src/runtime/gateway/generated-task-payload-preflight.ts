import type { GatewayRequest } from '../runtime-types.js';
import { capabilityProviderRoutesForGatewayInvocation } from './capability-provider-preflight.js';

export const GENERATED_TASK_PAYLOAD_PREFLIGHT_SCHEMA_VERSION = 'sciforge.generated-task-payload-preflight.v1' as const;
export const GENERATED_TASK_CAPABILITY_FIRST_PREFLIGHT_ISSUE_KIND = 'capability-first-direct-network' as const;
const GENERATED_TASK_PAYLOAD_PREFLIGHT_POLICY_ID = 'sciforge.generated-task-payload-preflight.v1' as const;
const REQUIRED_TOOL_PAYLOAD_KEYS = ['message', 'claims', 'uiManifest', 'executionUnits', 'artifacts'] as const;

export interface GeneratedTaskPayloadPreflightIssue {
  id: string;
  kind?: typeof GENERATED_TASK_CAPABILITY_FIRST_PREFLIGHT_ISSUE_KIND;
  severity: 'guidance' | 'repair-needed';
  path: string;
  reason: string;
  sourceRef?: string;
  evidence?: string;
  recoverActions: string[];
}

export interface GeneratedTaskPayloadPreflightReport {
  schemaVersion: typeof GENERATED_TASK_PAYLOAD_PREFLIGHT_SCHEMA_VERSION;
  policyId: typeof GENERATED_TASK_PAYLOAD_PREFLIGHT_POLICY_ID;
  status: 'ready' | 'guidance' | 'blocked';
  issues: GeneratedTaskPayloadPreflightIssue[];
  guidance: string[];
  requiredEnvelopeKeys: string[];
  expectedArtifacts: string[];
  inspectedTaskFiles: Array<{ path: string; language?: string; inspected: boolean; reason?: string }>;
}

export function evaluateGeneratedTaskPayloadPreflight(input: {
  taskFiles: Array<{ path: string; content?: string; language?: string }>;
  entrypoint?: { path?: string };
  expectedArtifacts?: string[];
  request?: GatewayRequest;
}): GeneratedTaskPayloadPreflightReport {
  const expectedArtifacts = uniqueNonEmptyStrings([
    ...(input.expectedArtifacts ?? []),
    ...(input.request?.expectedArtifactTypes ?? []),
  ]);
  const inspectedTaskFiles: GeneratedTaskPayloadPreflightReport['inspectedTaskFiles'] = [];
  const issues: GeneratedTaskPayloadPreflightIssue[] = [];
  const entrypointPath = normalizeRelPath(input.entrypoint?.path);
  for (const file of input.taskFiles) {
    const path = normalizeRelPath(file.path);
    const content = typeof file.content === 'string' ? file.content : '';
    const shouldInspect = Boolean(content) && (
      !entrypointPath
      || path === entrypointPath
      || generatedTaskSourceMentionsOutputContract(content)
    );
    inspectedTaskFiles.push({
      path: file.path,
      language: file.language,
      inspected: shouldInspect,
      reason: content
        ? shouldInspect ? undefined : 'no output contract tokens in non-entrypoint helper'
        : 'task file content unavailable to preflight',
    });
    if (shouldInspect) {
      issues.push(...generatedTaskPayloadPreflightIssuesForSource(content, file.path));
      issues.push(...generatedTaskProviderFirstNetworkIssuesForSource(content, file.path, input.request));
    }
  }

  if (!inspectedTaskFiles.some((file) => file.inspected)) {
    issues.push({
      id: 'generated-task-payload-preflight:no-inspectable-source',
      severity: 'guidance',
      path: 'taskFiles[].content',
      reason: 'Generated task payload shape could not be statically inspected before execution because no task file content was available.',
      recoverActions: generatedTaskPreflightBaseGuidance(expectedArtifacts),
    });
  }

  const dedupedIssues = dedupePreflightIssues(issues);
  return {
    schemaVersion: GENERATED_TASK_PAYLOAD_PREFLIGHT_SCHEMA_VERSION,
    policyId: GENERATED_TASK_PAYLOAD_PREFLIGHT_POLICY_ID,
    status: dedupedIssues.some((issue) => issue.severity === 'repair-needed')
      ? 'blocked'
      : dedupedIssues.length ? 'guidance' : 'ready',
    issues: dedupedIssues,
    guidance: generatedTaskPreflightGuidance(dedupedIssues, expectedArtifacts),
    requiredEnvelopeKeys: [...REQUIRED_TOOL_PAYLOAD_KEYS],
    expectedArtifacts,
    inspectedTaskFiles,
  };
}

export function generatedTaskPayloadPreflightFailureReason(preflight: GeneratedTaskPayloadPreflightReport) {
  const blockingIssues = preflight.issues.filter((issue) => issue.severity === 'repair-needed');
  const issueText = (blockingIssues.length ? blockingIssues : preflight.issues)
    .slice(0, 4)
    .map((issue) => `${issue.path}: ${issue.reason}`)
    .join('; ');
  return `Generated task payload preflight blocked expensive execution before runner start: ${issueText || 'output shape risk detected'}`;
}

export function generatedTaskPayloadPreflightRecoverActions(preflight: GeneratedTaskPayloadPreflightReport) {
  return uniqueNonEmptyStrings([
    ...preflight.guidance,
    'Regenerate the task code so the object written to outputPath matches the SciForge ToolPayload schema before any expensive work runs.',
    'Preserve generated task refs and use this preflight report as repair context.',
  ]);
}

export function isGeneratedTaskCapabilityFirstPolicyIssue(issue: GeneratedTaskPayloadPreflightIssue) {
  return issue.kind === GENERATED_TASK_CAPABILITY_FIRST_PREFLIGHT_ISSUE_KIND || issue.path === 'capabilityFirstPolicy';
}

export function generatedTaskPayloadPreflightForTaskInput(preflight: GeneratedTaskPayloadPreflightReport) {
  return {
    schemaVersion: preflight.schemaVersion,
    policyId: preflight.policyId,
    status: preflight.status,
    requiredEnvelopeKeys: preflight.requiredEnvelopeKeys,
    expectedArtifacts: preflight.expectedArtifacts,
    issues: preflight.issues.map((issue) => ({
      severity: issue.severity,
      path: issue.path,
      reason: issue.reason,
      sourceRef: issue.sourceRef,
      recoverActions: issue.recoverActions,
    })),
    guidance: preflight.guidance,
  };
}

function generatedTaskPayloadPreflightIssuesForSource(source: string, sourceRef: string): GeneratedTaskPayloadPreflightIssue[] {
  const issues: GeneratedTaskPayloadPreflightIssue[] = [];
  const candidates = generatedTaskPayloadLiteralCandidates(source, sourceRef);
  const outputWriterVisible = generatedTaskSourceMentionsOutputWrite(source);
  if (!candidates.length) {
    issues.push(outputWriterVisible ? {
      id: `${sourceRef}:payload-envelope-not-static`,
      severity: 'guidance',
      path: 'outputPayload',
      sourceRef,
      reason: 'Generated task writes an output file, but preflight could not see a static ToolPayload envelope before execution.',
      recoverActions: generatedTaskPreflightBaseGuidance([]),
    } : {
      id: `${sourceRef}:missing-output-write`,
      severity: 'guidance',
      path: 'outputPath',
      sourceRef,
      reason: 'Generated task entrypoint does not visibly write the required outputPath ToolPayload JSON.',
      recoverActions: [
        'Read argv inputPath/outputPath and always write compact ToolPayload JSON to outputPath.',
        'If work is blocked before expensive execution, write a repair-needed ToolPayload instead of only logging to stdout/stderr.',
      ],
    });
    return issues;
  }

  for (const candidate of candidates) {
    const fields = parseTopLevelObjectFields(candidate.objectText);
    const missingKeys = REQUIRED_TOOL_PAYLOAD_KEYS
      .filter((key) => !fields.has(key) && !candidateAssignsField(source, candidate.variableName, key));
    if (missingKeys.length) {
      issues.push({
        id: `${sourceRef}:${candidate.writtenToOutput ? 'missing' : 'partial'}-output-envelope:${missingKeys.join(',')}`,
        severity: candidate.writtenToOutput ? 'repair-needed' : 'guidance',
        path: missingKeys.join(','),
        sourceRef,
        evidence: clipEvidence(candidate.objectText),
        reason: candidate.writtenToOutput
          ? `Generated task appears to write JSON without the required ToolPayload envelope fields: ${missingKeys.join(', ')}.`
          : `Preflight saw a payload-like object missing ToolPayload fields: ${missingKeys.join(', ')}.`,
        recoverActions: candidate.writtenToOutput
          ? [
              'Regenerate the task so the object written to outputPath includes message, claims, uiManifest, executionUnits, and artifacts.',
              'Use an honest repair-needed/failed-with-reason ToolPayload when the task cannot produce final artifacts.',
            ]
          : generatedTaskPreflightBaseGuidance([]),
      });
    }

    for (const key of ['claims', 'uiManifest', 'executionUnits', 'artifacts'] as const) {
      const value = fields.get(key);
      if (!value || candidateAssignsField(source, candidate.variableName, key)) continue;
      const assigned = assignedLiteralForExpression(source, value);
      const literalEvidence = assigned?.literal ?? value;
      const kind = assigned?.kind ?? leadingLiteralKind(value);
      if (kind === 'expression' && !assigned) {
        issues.push({
          id: `${sourceRef}:${key}-dynamic-array-unverified`,
          severity: 'guidance',
          path: key,
          sourceRef,
          evidence: clipEvidence(literalEvidence),
          reason: `Generated task sets ${key} dynamically; preflight could not prove it will be an array before expensive execution.`,
          recoverActions: [`Validate ${key} is an array before starting expensive work, or write repair-needed immediately.`],
        });
      } else if (key === 'uiManifest' && kind === 'object') {
        issues.push({
          id: `${sourceRef}:uiManifest-object`,
          severity: 'repair-needed',
          path: key,
          sourceRef,
          evidence: clipEvidence(literalEvidence),
          reason: 'Generated task uiManifest is object-shaped; ToolPayload uiManifest must be an array of component slots.',
          recoverActions: ['Return uiManifest as an array of component slots bound to produced artifact ids.'],
        });
      } else if (kind !== 'array') {
        issues.push({
          id: `${sourceRef}:${key}-not-array`,
          severity: 'repair-needed',
          path: key,
          sourceRef,
          evidence: clipEvidence(literalEvidence),
          reason: `Generated task sets ${key} to a ${kind || 'non-array'} value; ToolPayload ${key} must be an array.`,
          recoverActions: [`Return ${key} as an array before writing outputPath.`],
        });
      }
    }

    const artifactsValue = fields.get('artifacts');
    const assignedArtifacts = assignedLiteralForExpression(source, artifactsValue);
    const artifactsLiteral = assignedArtifacts?.kind === 'array' ? assignedArtifacts.literal : artifactsValue;
    if (artifactsLiteral && leadingLiteralKind(artifactsLiteral) === 'array') {
      issues.push(...generatedTaskArtifactArrayIssues(artifactsLiteral, sourceRef, source));
    }
  }
  return issues;
}

function generatedTaskProviderFirstNetworkIssuesForSource(
  source: string,
  sourceRef: string,
  request?: GatewayRequest,
): GeneratedTaskPayloadPreflightIssue[] {
  const routes = readyWebProviderRoutes(request);
  if (!routes.length) return [];
  const directNetworkUses = directExternalNetworkUses(source);
  if (!directNetworkUses.length) return [];
  return [{
    id: `${sourceRef}:provider-first-direct-network:${routes.map((route) => route.capabilityId).join(',')}`,
    kind: GENERATED_TASK_CAPABILITY_FIRST_PREFLIGHT_ISSUE_KIND,
    severity: 'repair-needed',
    path: 'capabilityFirstPolicy',
    sourceRef,
    evidence: clipEvidence(directNetworkUses.join(', ')),
    reason: `Generated task uses direct external network APIs (${directNetworkUses.join(', ')}) even though SciForge has ready provider route(s) for ${routes.map((route) => route.capabilityId).join(', ')}.`,
    recoverActions: [
      'Regenerate the task to use the SciForge provider route contract for web_search/web_fetch work before any direct external network call.',
      'Import sciforge_task from the entrypoint directory and inspect capabilityProviderRoutes/provider-first policy from task input.',
      'If the provider returns empty results or is unavailable at runtime, write a repair-needed ToolPayload with recoverActions instead of falling back to direct network libraries.',
    ],
  }];
}

function readyWebProviderRoutes(request?: GatewayRequest) {
  if (!request) return [];
  const selectedToolIds = new Set([...(request.selectedToolIds ?? []), 'web_search', 'web_fetch']);
  return capabilityProviderRoutesForGatewayInvocation({ ...request, selectedToolIds: [...selectedToolIds] }).routes
    .filter((route) => (route.capabilityId === 'web_search' || route.capabilityId === 'web_fetch') && route.status === 'ready');
}

function directExternalNetworkUses(source: string) {
  const uses = new Set<string>();
  const stripped = stripGeneratedTaskComments(source);
  const patterns: Array<[string, RegExp]> = [
    ['requests', /(?:^|\n)\s*(?:import\s+requests\b|from\s+requests\b)|\brequests\.(?:get|post|put|patch|delete|request|Session)\b/],
    ['urllib', /(?:^|\n)\s*(?:import\s+urllib(?:\.request)?\b|from\s+urllib\b)|\burllib\.request\.(?:urlopen|Request)\b/],
    ['httpx', /(?:^|\n)\s*(?:import\s+httpx\b|from\s+httpx\b)|\bhttpx\.(?:get|post|put|patch|delete|request|Client|AsyncClient)\b/],
    ['aiohttp', /(?:^|\n)\s*(?:import\s+aiohttp\b|from\s+aiohttp\b)|\baiohttp\.ClientSession\b/],
    ['socket', /(?:^|\n)\s*(?:import\s+socket\b|from\s+socket\b)|\bsocket\.(?:socket|create_connection|create_server)\s*\(/],
    ['http.client', /(?:^|\n)\s*(?:import\s+http\.client\b|from\s+http\.client\b)|\bhttp\.client\.(?:HTTPConnection|HTTPSConnection)\s*\(/],
    ['fetch', /\bfetch\s*\(/],
    ['node:http', /(?:^|\n)\s*(?:import\s+.*\bfrom\s+["']node:https?["']|import\s+.*\bfrom\s+["']https?["']|(?:require|import)\s*\(\s*["'](?:node:)?https?["']\s*\))/],
    ['curl/wget', /\b(?:subprocess\.(?:run|Popen|call|check_call|check_output)|os\.system)\s*\([^)\n]*(?:curl|wget)\b/],
  ];
  for (const [label, pattern] of patterns) {
    if (pattern.test(stripped)) uses.add(label);
  }
  return [...uses].sort();
}

function stripGeneratedTaskComments(source: string) {
  return source
    .replace(/^\s*#.*$/gm, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

type PayloadLiteralCandidate = {
  objectText: string;
  variableName?: string;
  writtenToOutput: boolean;
};

function generatedTaskPayloadLiteralCandidates(source: string, sourceRef: string): PayloadLiteralCandidate[] {
  const candidates: PayloadLiteralCandidate[] = [];
  const assignmentPattern = /\b(payload|tool_payload|toolPayload|result|output)\s*(?::\s*[^=\n]+)?=\s*{/g;
  for (const match of source.matchAll(assignmentPattern)) {
    const start = (match.index ?? 0) + match[0].lastIndexOf('{');
    const objectText = balancedEnclosedText(source, start, '{', '}');
    if (!objectText) continue;
    const variableName = String(match[1] || '');
    candidates.push({
      objectText,
      variableName,
      writtenToOutput: variableWrittenToOutput(source, variableName),
    });
  }
  const literalWritePattern = /\b(?:json\.dump|JSON\.stringify)\s*\(\s*{/g;
  for (const match of source.matchAll(literalWritePattern)) {
    const start = (match.index ?? 0) + match[0].lastIndexOf('{');
    const objectText = balancedEnclosedText(source, start, '{', '}');
    if (objectText) candidates.push({ objectText, writtenToOutput: true });
  }
  return candidates;
}

function generatedTaskArtifactArrayIssues(value: string, sourceRef: string, source: string): GeneratedTaskPayloadPreflightIssue[] {
  return parseTopLevelArrayItems(value).flatMap((item, index) => {
    const resolved = artifactArrayItemLiteral(source, item);
    const artifactText = resolved?.literal ?? item;
    if (leadingLiteralKind(artifactText) !== 'object') {
      return [{
        id: `${sourceRef}:artifacts-${index}-not-object`,
        severity: 'repair-needed' as const,
        path: `artifacts[${index}]`,
        sourceRef,
        evidence: clipEvidence(artifactText),
        reason: `Generated task artifacts[${index}] is not an object; artifact entries must include id and type.`,
        recoverActions: ['Return each artifact as an object with non-empty id, type, and data/dataRef/path content.'],
      }];
    }
    const fields = parseTopLevelObjectFields(artifactText);
    const missing = ['id', 'type'].filter((key) => !fields.has(key) || fieldValueIsEmptyString(fields.get(key)));
    const derivable = missing.length > 0 && artifactIdentityDerivableFromFields(fields);
    return missing.length ? [{
      id: `${sourceRef}:artifacts-${index}-missing-${missing.join('-')}`,
      severity: derivable ? 'guidance' as const : 'repair-needed' as const,
      path: missing.map((key) => `artifacts[${index}].${key}`).join(','),
      sourceRef,
      evidence: clipEvidence(artifactText),
      reason: derivable
        ? `Generated task artifact ${index + 1} is missing non-empty ${missing.join(' and ')} field(s), but identity can be derived mechanically from its file ref.`
        : `Generated task artifact ${index + 1} is missing non-empty ${missing.join(' and ')} field(s).`,
      recoverActions: [derivable
        ? 'Prefer explicit stable artifact id/type fields; SciForge may derive them only from concrete artifact refs at the boundary.'
        : 'Regenerate artifacts with stable non-empty id and type fields before expensive execution proceeds.'],
    }] : [];
  });
}

function artifactArrayItemLiteral(source: string, item: string) {
  if (leadingLiteralKind(item) === 'object') return { literal: item, kind: 'object' as const };
  const assigned = assignedLiteralForExpression(source, item);
  return assigned?.kind === 'object' ? assigned : undefined;
}

function artifactIdentityDerivableFromFields(fields: Map<string, string>) {
  const values = ['id', 'type', 'artifactType', 'ref', 'path', 'dataRef', 'fileRef', 'filename', 'title', 'label', 'kind', 'mimeType']
    .map((key) => literalStringValue(fields.get(key)))
    .filter((value): value is string => Boolean(value));
  return values.some((value) => /[A-Za-z0-9]/.test(value) && !/^(?:file|artifact)$/i.test(value));
}

function parseTopLevelObjectFields(objectText: string): Map<string, string> {
  const out = new Map<string, string>();
  if (leadingLiteralKind(objectText) !== 'object') return out;
  let index = 1;
  while (index < objectText.length - 1) {
    index = skipWhitespaceAndCommas(objectText, index);
    const parsedKey = parseObjectKeyAt(objectText, index);
    if (!parsedKey) {
      index += 1;
      continue;
    }
    let cursor = skipWhitespace(objectText, parsedKey.end);
    if (objectText[cursor] !== ':') {
      index = parsedKey.end;
      continue;
    }
    const valueStart = skipWhitespace(objectText, cursor + 1);
    const valueEnd = findTopLevelValueEnd(objectText, valueStart);
    out.set(parsedKey.key, objectText.slice(valueStart, valueEnd).trim());
    index = valueEnd + 1;
  }
  return out;
}

function parseTopLevelArrayItems(arrayText: string): string[] {
  if (leadingLiteralKind(arrayText) !== 'array') return [];
  const items: string[] = [];
  let start = 1;
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = 1; index < arrayText.length - 1; index += 1) {
    const char = arrayText[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') depth += 1;
    if (char === '}' || char === ']' || char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      const item = arrayText.slice(start, index).trim();
      if (item) items.push(item);
      start = index + 1;
    }
  }
  const tail = arrayText.slice(start, -1).trim();
  if (tail) items.push(tail);
  return items;
}

function parseObjectKeyAt(text: string, index: number): { key: string; end: number } | undefined {
  const char = text[index];
  if (char !== '"' && char !== "'") {
    const match = text.slice(index).match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
    return match ? { key: match[1]!, end: index + match[0].length } : undefined;
  }
  let cursor = index + 1;
  let escaped = false;
  let key = '';
  while (cursor < text.length) {
    const current = text[cursor]!;
    if (escaped) {
      key += current;
      escaped = false;
    } else if (current === '\\') {
      escaped = true;
    } else if (current === char) {
      return { key, end: cursor + 1 };
    } else {
      key += current;
    }
    cursor += 1;
  }
  return undefined;
}

function findTopLevelValueEnd(text: string, start: number) {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') depth += 1;
    if (char === '}' || char === ']' || char === ')') {
      if (depth === 0) return index;
      depth -= 1;
    }
    if (char === ',' && depth === 0) return index;
  }
  return text.length;
}

function balancedEnclosedText(source: string, start: number, open: string, close: string) {
  if (source[start] !== open) return undefined;
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return undefined;
}

function assignedLiteralForExpression(source: string, value: string | undefined) {
  const name = (value ?? '').trim().match(/^([A-Za-z_][A-Za-z0-9_]*)$/)?.[1];
  if (!name) return undefined;
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*(?::\\s*[^=\\n]+)?=\\s*([\\[{])`, 'g');
  for (const match of source.matchAll(pattern)) {
    const open = match[1]!;
    const start = (match.index ?? 0) + match[0].lastIndexOf(open);
    const literal = balancedEnclosedText(source, start, open, open === '{' ? '}' : ']');
    if (literal) return { literal, kind: leadingLiteralKind(literal) };
  }
  return undefined;
}

function generatedTaskSourceMentionsOutputContract(source: string) {
  return /output_?path|json\.dump|json\.dumps|JSON\.stringify|ToolPayload|uiManifest|executionUnits|artifacts/i.test(source);
}

function generatedTaskSourceMentionsOutputWrite(source: string) {
  return /output_?path/i.test(source) && /json\.dump|json\.dumps|JSON\.stringify|writeFile|open\s*\(/i.test(source);
}

function variableWrittenToOutput(source: string, variableName: string | undefined) {
  if (!variableName) return false;
  const escaped = escapeRegExp(variableName);
  return new RegExp(`(?:json\\.dump|json\\.dumps|JSON\\.stringify)\\s*\\(\\s*${escaped}\\b|write(?:FileSync|File)?\\s*\\([\\s\\S]{0,160}\\b${escaped}\\b`, 'i').test(source);
}

function candidateAssignsField(source: string, variableName: string | undefined, field: string) {
  if (!variableName) return false;
  return new RegExp(`\\b${escapeRegExp(variableName)}\\s*(?:\\[\\s*["']${escapeRegExp(field)}["']\\s*\\]|\\.${escapeRegExp(field)})\\s*=`, 'i').test(source);
}

function leadingLiteralKind(value: string | undefined) {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('[')) return 'array';
  if (trimmed.startsWith('{')) return 'object';
  if (/^["'`]/.test(trimmed)) return 'string';
  if (/^(?:true|false|True|False)\b/.test(trimmed)) return 'boolean';
  if (/^-?\d/.test(trimmed)) return 'number';
  if (/^(?:None|null|undefined)\b/.test(trimmed)) return 'nullish';
  return 'expression';
}

function literalStringValue(value: string | undefined) {
  const trimmed = (value ?? '').trim();
  if (!/^["']/.test(trimmed)) return undefined;
  const quote = trimmed[0];
  if (trimmed[trimmed.length - 1] !== quote) return undefined;
  return trimmed.slice(1, -1).trim();
}

function generatedTaskPreflightGuidance(issues: GeneratedTaskPayloadPreflightIssue[], expectedArtifacts: string[]) {
  return uniqueNonEmptyStrings([
    ...generatedTaskPreflightBaseGuidance(expectedArtifacts),
    ...issues.flatMap((issue) => issue.recoverActions),
  ]).slice(0, 8);
}

function generatedTaskPreflightBaseGuidance(expectedArtifacts: string[]) {
  return [
    'Before expensive external fetch/download/analysis, initialize the exact ToolPayload envelope: message, confidence, claimType, evidenceLevel, reasoningTrace, claims, uiManifest, executionUnits, artifacts.',
    'claims, uiManifest, executionUnits, and artifacts must be arrays; every artifact object must have non-empty id and type.',
    'If the task cannot satisfy the output contract, write a repair-needed or failed-with-reason ToolPayload immediately and preserve stdout/stderr/output refs.',
    expectedArtifacts.length
      ? `Expected artifact types for this run: ${expectedArtifacts.join(', ')}. Bind uiManifest[].artifactRef to produced artifact ids.`
      : 'Bind uiManifest[].artifactRef to a produced artifact id when a visual result is available.',
  ];
}

function dedupePreflightIssues(issues: GeneratedTaskPayloadPreflightIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.severity}:${issue.path}:${issue.reason}:${issue.sourceRef ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fieldValueIsEmptyString(value: string | undefined) {
  return /^["']\s*["']$/.test((value ?? '').trim());
}

function skipWhitespaceAndCommas(text: string, index: number) {
  let cursor = index;
  while (cursor < text.length && /[\s,]/.test(text[cursor]!)) cursor += 1;
  return cursor;
}

function skipWhitespace(text: string, index: number) {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor]!)) cursor += 1;
  return cursor;
}

function uniqueNonEmptyStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim()))];
}

function normalizeRelPath(value: unknown) {
  return typeof value === 'string' ? value.replace(/^\.\//, '').trim() : undefined;
}

function clipEvidence(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 320);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
