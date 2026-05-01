import type {
  BioAgentReference,
  BioAgentSession,
  NormalizedAgentResponse,
  ObjectAction,
  ObjectReference,
  ObjectReferenceKind,
  RuntimeArtifact,
  RuntimeExecutionUnit,
  ScenarioInstanceId,
  ScenarioRuntimeOverride,
  TurnAcceptance,
  TurnAcceptanceFailure,
  UserGoalSnapshot,
  UserGoalType,
} from './domain';
import { makeId, nowIso } from './domain';

type GoalInput = {
  turnId: string;
  prompt: string;
  references?: BioAgentReference[];
  scenarioId: ScenarioInstanceId;
  scenarioOverride?: ScenarioRuntimeOverride;
  expectedArtifacts?: string[];
  recentMessages?: Array<{ role: string; content: string }>;
};

type AcceptanceInput = {
  snapshot: UserGoalSnapshot;
  response: NormalizedAgentResponse;
  session: BioAgentSession;
};

export function buildUserGoalSnapshot({
  turnId,
  prompt,
  references = [],
  scenarioId,
  scenarioOverride,
  expectedArtifacts = [],
  recentMessages = [],
}: GoalInput): UserGoalSnapshot {
  const text = `${prompt}\n${scenarioOverride?.scenarioMarkdown ?? ''}`.toLowerCase();
  const goalType = inferGoalType(prompt, references);
  const requiredFormats = inferRequiredFormats(prompt);
  const requiredArtifacts = inferRequiredArtifacts(prompt, goalType, expectedArtifacts);
  const freshness = inferFreshness(prompt);
  const requiredReferences = references.map((reference) => reference.ref);
  const continuation = /继续|上一轮|上次|刚才|修复|重试|rerun|repair|continue/i.test(prompt);
  const uiExpectations = [
    requiredArtifacts.some((artifact) => /report|markdown|document/i.test(artifact)) ? 'report-viewer' : '',
    requiredArtifacts.some((artifact) => /table|matrix|csv|paper-list/i.test(artifact)) ? 'table-or-list-viewer' : '',
    references.length ? 'preserve-explicit-references' : '',
    /路径|文件|打开|下载|产物|artifact|file|path/i.test(prompt) ? 'clickable-object-references' : '',
  ].filter(Boolean);
  const acceptanceCriteria = [
    'final response is user-readable',
    'raw ToolPayload JSON is not the default user-facing answer',
    references.length ? 'explicit references are preserved through the turn' : '',
    requiredArtifacts.length ? `required artifacts exist: ${requiredArtifacts.join(', ')}` : '',
    requiredFormats.length ? `required formats exist: ${requiredFormats.join(', ')}` : '',
    continuation || recentMessages.length > 1 ? 'multi-turn context is considered' : '',
    text.includes('objectreferences') ? 'objectReferences contract is honored' : '',
  ].filter(Boolean);
  return {
    turnId,
    rawPrompt: prompt,
    goalType,
    requiredFormats,
    requiredArtifacts,
    requiredReferences,
    freshness,
    uiExpectations,
    acceptanceCriteria,
  };
}

export function acceptAndRepairAgentResponse({
  snapshot,
  response,
  session,
}: AcceptanceInput): NormalizedAgentResponse {
  const extractedReferences = extractObjectReferencesFromTurnText(response, session);
  const existingReferences = response.message.objectReferences ?? [];
  const objectReferences = mergeObjectReferences([...existingReferences, ...extractedReferences]);
  const acceptance = evaluateTurnAcceptance(snapshot, {
    ...response,
    message: { ...response.message, objectReferences },
    run: { ...response.run, objectReferences },
  }, session, objectReferences);
  const repairedMessage = presentationRepairMessage(response.message.content, acceptance);
  const repairedRaw = enrichRaw(response.run.raw, snapshot, acceptance, objectReferences);
  return {
    ...response,
    message: {
      ...response.message,
      content: repairedMessage,
      objectReferences,
      goalSnapshot: snapshot,
      acceptance,
    },
    run: {
      ...response.run,
      response: repairedMessage,
      objectReferences,
      goalSnapshot: snapshot,
      acceptance,
      raw: repairedRaw,
    },
  };
}

export function extractObjectReferencesFromTurnText(response: NormalizedAgentResponse, session: BioAgentSession): ObjectReference[] {
  const texts = [
    response.message.content,
    response.run.response,
    typeof response.run.raw === 'string' ? response.run.raw : '',
    ...response.artifacts.flatMap((artifact) => [
      artifact.path,
      artifact.dataRef,
      stringFromRecord(artifact.metadata, 'path'),
      stringFromRecord(artifact.metadata, 'filePath'),
      stringFromRecord(artifact.metadata, 'markdownRef'),
      stringFromRecord(artifact.metadata, 'reportRef'),
    ]),
  ].filter((value): value is string => Boolean(value && value.trim()));
  const refs: ObjectReference[] = [];
  for (const text of texts) refs.push(...extractObjectReferencesFromText(text, session, response));
  for (const artifact of response.artifacts) {
    const path = artifact.path || artifact.dataRef || stringFromRecord(artifact.metadata, 'path') || stringFromRecord(artifact.metadata, 'markdownRef');
    if (path) refs.push(objectReferenceForPath(path, response.run.id, artifact));
  }
  return mergeObjectReferences(refs).slice(0, 16);
}

export function extractObjectReferencesFromText(
  text: string,
  session: BioAgentSession,
  response?: NormalizedAgentResponse,
): ObjectReference[] {
  const references: ObjectReference[] = [];
  const controlledRefPattern = /\b(artifact|file|folder|run|execution-unit|scenario-package|url):([^\s"'`<>)\]}，。；;]+)/gi;
  for (const match of text.matchAll(controlledRefPattern)) {
    const kind = match[1].toLowerCase() as ObjectReferenceKind;
    const rawRef = `${kind}:${trimReferenceTail(match[2])}`;
    const existing = referenceFromKnownObject(rawRef, session, response);
    references.push(existing ?? objectReferenceFromControlledRef(rawRef, kind, response?.run.id));
  }
  const urlPattern = /\bhttps?:\/\/[^\s"'`<>)\]}，。；;]+/gi;
  for (const match of text.matchAll(urlPattern)) {
    const url = trimReferenceTail(match[0]);
    references.push({
      id: stableObjectId(`url:${url}`),
      title: titleForPath(url),
      kind: 'url',
      ref: `url:${url}`,
      runId: response?.run.id,
      preferredView: 'generic-artifact-inspector',
      actions: ['focus-right-pane', 'copy-path', 'pin'],
      status: 'external',
      summary: url,
      provenance: { dataRef: url },
    });
  }
  const pathPattern = /(?:^|[\s"'`(（:：])((?:\.bioagent|workspace\/\.bioagent|\/[^"'`\s<>)\]}，。；;]+|[\w.-]+\/[\w./-]+)[^\s"'`<>)\]}，。；;]*(?:\.md|\.markdown|\.csv|\.tsv|\.json|\.pdf|\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|\.html|\.htm|\.txt|\.pdb|\.cif|\.mmcif|\/))(?:$|[\s"'`),，。；;])/gi;
  for (const match of text.matchAll(pathPattern)) {
    const path = trimReferenceTail(match[1]);
    if (!path || path.includes('://')) continue;
    references.push(objectReferenceForPath(path, response?.run.id));
  }
  for (const artifact of [...(response?.artifacts ?? []), ...session.artifacts]) {
    if (!artifact.id || !mentionsToken(text, artifact.id)) continue;
    references.push(objectReferenceForArtifact(artifact, response?.run.id));
  }
  for (const run of [...(response ? [response.run] : []), ...session.runs]) {
    if (!run.id || !mentionsToken(text, run.id)) continue;
    references.push({
      id: stableObjectId(`run:${run.id}`),
      title: `run ${run.id.replace(/^run-/, '').slice(0, 8)}`,
      kind: 'run',
      ref: `run:${run.id}`,
      runId: run.id,
      actions: ['focus-right-pane', 'pin'],
      status: 'available',
      summary: run.prompt?.slice(0, 240),
    });
  }
  for (const unit of [...response?.executionUnits ?? [], ...session.executionUnits]) {
    if (!unit.id || !mentionsToken(text, unit.id)) continue;
    references.push({
      id: stableObjectId(`execution-unit:${unit.id}`),
      title: unit.id,
      kind: 'execution-unit',
      ref: `execution-unit:${unit.id}`,
      runId: response?.run.id,
      executionUnitId: unit.id,
      actions: ['focus-right-pane', 'pin'],
      status: unit.status === 'failed' || unit.status === 'failed-with-reason' ? 'blocked' : 'available',
      summary: unit.failureReason || unit.tool,
    });
  }
  return prioritizeObjectReferences(mergeObjectReferences(references));
}

function inferGoalType(prompt: string, references: BioAgentReference[]): UserGoalType {
  if (/修复|重试|repair|fix|rerun/i.test(prompt)) return 'repair';
  if (/继续|上一轮|上次|刚才|continue|previous/i.test(prompt)) return 'continuation';
  if (/报告|阅读报告|markdown|文档|report|document/i.test(prompt)) return 'report';
  if (/图|可视化|plot|chart|visual|umap|heatmap/i.test(prompt)) return 'visualization';
  if (/文件|路径|下载|打开|导出|file|path|download|export/i.test(prompt)) return 'file';
  if (/分析|比较|总结|归纳|analysis|analyze|summarize/i.test(prompt) || references.length) return 'analysis';
  return 'answer';
}

function inferRequiredFormats(prompt: string) {
  const formats: string[] = [];
  if (/markdown|\.md|报告|阅读报告/i.test(prompt)) formats.push('markdown');
  if (/csv|表格|table|matrix|矩阵/i.test(prompt)) formats.push('table');
  if (/pdf/i.test(prompt)) formats.push('pdf');
  if (/json/i.test(prompt)) formats.push('json');
  if (/图|plot|chart|png|svg|visual/i.test(prompt)) formats.push('visual');
  return Array.from(new Set(formats));
}

function inferRequiredArtifacts(prompt: string, goalType: UserGoalType, expectedArtifacts: string[]) {
  const artifacts = new Set<string>();
  if (goalType === 'report') artifacts.add('research-report');
  if (/paper|论文|文献|arxiv/i.test(prompt)) artifacts.add('paper-list');
  if (/证据|evidence|claim/i.test(prompt)) artifacts.add('evidence-matrix');
  if (/图|plot|chart|visual|umap|heatmap/i.test(prompt)) artifacts.add('visualization');
  for (const artifact of expectedArtifacts) {
    if (goalType === 'workflow' || prompt.toLowerCase().includes(artifact.toLowerCase())) artifacts.add(artifact);
  }
  return Array.from(artifacts);
}

function inferFreshness(prompt: string): UserGoalSnapshot['freshness'] | undefined {
  if (/今天|今日|today/i.test(prompt)) return { kind: 'today', date: new Date().toISOString().slice(0, 10) };
  if (/最新|latest|recent|current/i.test(prompt)) return { kind: 'latest' };
  if (/上一轮|上次|prior|previous/i.test(prompt)) return { kind: 'prior-run' };
  if (/当前|本轮|current-session/i.test(prompt)) return { kind: 'current-session' };
  return undefined;
}

function evaluateTurnAcceptance(
  snapshot: UserGoalSnapshot,
  response: NormalizedAgentResponse,
  session: BioAgentSession,
  objectReferences: ObjectReference[],
): TurnAcceptance {
  const failures: TurnAcceptanceFailure[] = [];
  const content = response.message.content.trim();
  if (!content) {
    failures.push({ code: 'empty-final-response', detail: 'Agent final response is empty.', repairAction: 'artifact-repair' });
  }
  if (looksLikeRawPayload(content)) {
    failures.push({ code: 'raw-payload-leak', detail: 'Final response appears to expose raw ToolPayload/JSON instead of a user-readable answer.', repairAction: 'presentation-repair' });
  }
  if (snapshot.requiredReferences.length) {
    const preserved = new Set((response.run.references ?? response.message.references ?? []).map((reference) => reference.ref));
    const missing = snapshot.requiredReferences.filter((ref) => !preserved.has(ref));
    if (missing.length) {
      failures.push({ code: 'missing-explicit-references', detail: `Explicit references were not preserved: ${missing.join(', ')}`, repairAction: 'presentation-repair' });
    }
  }
  if (snapshot.goalType === 'report' || snapshot.requiredArtifacts.some((artifact) => /report|markdown/i.test(artifact))) {
    if (!hasReadableReport(response, objectReferences)) {
      failures.push({ code: 'missing-readable-report', detail: 'Report request did not produce readable markdown/report content or a clickable .md reference.', repairAction: 'artifact-repair' });
    }
  }
  if (snapshot.uiExpectations.includes('clickable-object-references') && !objectReferences.length) {
    failures.push({ code: 'missing-object-references', detail: 'User-visible paths or artifacts were not normalized into clickable object references.', repairAction: 'presentation-repair' });
  }
  const repairable = failures.length && failures.every((failure) => failure.repairAction === 'presentation-repair');
  const severity = !failures.length ? 'pass' : repairable ? 'repairable' : failures.some((failure) => failure.repairAction === 'artifact-repair') ? 'warning' : 'failed';
  return {
    pass: failures.length === 0,
    severity,
    checkedAt: nowIso(),
    failures,
    objectReferences,
    repairAttempt: repairable ? 1 : 0,
    repairPrompt: failures.length ? buildRepairPrompt(snapshot, failures, response) : undefined,
  };
}

function hasReadableReport(response: NormalizedAgentResponse, objectReferences: ObjectReference[]) {
  if (/^#{1,3}\s|\n#{1,3}\s|\.md\b|markdown|报告/i.test(response.message.content) && !looksLikeRawPayload(response.message.content)) return true;
  for (const artifact of response.artifacts) {
    if (!/report|markdown|document|summary/i.test(artifact.type)) continue;
    const data = artifact.data;
    if (typeof data === 'string' && data.trim()) return true;
    if (isRecord(data) && ['markdown', 'report', 'content', 'summary', 'markdownRef', 'reportRef'].some((key) => typeof data[key] === 'string' && String(data[key]).trim())) return true;
    if (artifact.path?.match(/\.md$/i) || artifact.dataRef?.match(/\.md$/i)) return true;
  }
  return objectReferences.some((reference) => reference.kind === 'file' && /\.md($|[?#])/i.test(reference.ref));
}

function presentationRepairMessage(content: string, acceptance: TurnAcceptance) {
  if (!acceptance.failures.some((failure) => failure.code === 'raw-payload-leak')) return content;
  const message = readableMessageFromPayloadText(content);
  if (message) return message;
  const reportRef = acceptance.objectReferences.find((reference) => reference.kind === 'file' && /\.md($|[?#])/i.test(reference.ref));
  if (reportRef) return `已生成 Markdown 报告：${reportRef.ref.replace(/^file:/, '')}`;
  return content;
}

function readableMessageFromPayloadText(text: string) {
  const payload = parseJsonFromText(text);
  if (!payload) return undefined;
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (message && !looksLikeRawPayload(message)) return message;
  const reportRef = findReportRef(payload);
  if (reportRef) return `已生成 Markdown 报告：${reportRef}`;
  return undefined;
}

function buildRepairPrompt(snapshot: UserGoalSnapshot, failures: TurnAcceptanceFailure[], response: NormalizedAgentResponse) {
  return [
    'BioAgent TurnAcceptanceGate detected unmet user expectations.',
    `Original user goal: ${snapshot.rawPrompt}`,
    `Goal type: ${snapshot.goalType}`,
    `Failures: ${failures.map((failure) => `${failure.code}: ${failure.detail}`).join('; ')}`,
    `Current response: ${response.message.content.slice(0, 1200)}`,
    'Repair requirement: return user-readable final content and required artifacts/objectReferences without exposing raw ToolPayload JSON.',
  ].join('\n');
}

function enrichRaw(raw: unknown, snapshot: UserGoalSnapshot, acceptance: TurnAcceptance, objectReferences: ObjectReference[]) {
  const metadata = { userGoalSnapshot: snapshot, turnAcceptance: acceptance, objectReferences };
  return isRecord(raw) ? { ...raw, ...metadata } : { raw, ...metadata };
}

function referenceFromKnownObject(ref: string, session: BioAgentSession, response?: NormalizedAgentResponse) {
  const normalized = ref.replace(/^(artifact|file|folder|run|execution-unit|scenario-package|url):/i, '');
  const artifact = [...(response?.artifacts ?? []), ...session.artifacts]
    .find((item) => item.id === normalized || item.path === normalized || item.dataRef === normalized);
  if (artifact) return objectReferenceForArtifact(artifact, response?.run.id);
  const run = [...(response ? [response.run] : []), ...session.runs].find((item) => item.id === normalized);
  if (run) {
    return {
      id: stableObjectId(`run:${run.id}`),
      title: `run ${run.id.replace(/^run-/, '').slice(0, 8)}`,
      kind: 'run' as const,
      ref: `run:${run.id}`,
      runId: run.id,
      actions: ['focus-right-pane', 'pin'] as ObjectAction[],
      status: 'available' as const,
      summary: run.prompt?.slice(0, 240),
    };
  }
  const unit = [...response?.executionUnits ?? [], ...session.executionUnits].find((item) => item.id === normalized);
  if (unit) {
    return {
      id: stableObjectId(`execution-unit:${unit.id}`),
      title: unit.id,
      kind: 'execution-unit' as const,
      ref: `execution-unit:${unit.id}`,
      runId: response?.run.id,
      executionUnitId: unit.id,
      actions: ['focus-right-pane', 'pin'] as ObjectAction[],
      status: unit.status === 'failed' || unit.status === 'failed-with-reason' ? 'blocked' as const : 'available' as const,
      summary: unit.failureReason || unit.tool,
    };
  }
  return undefined;
}

function objectReferenceFromControlledRef(ref: string, kind: ObjectReferenceKind, runId?: string): ObjectReference {
  if (kind === 'file' || kind === 'folder') return objectReferenceForPath(ref.replace(/^(file|folder):/i, ''), runId, undefined, kind);
  if (kind === 'url') {
    const url = ref.replace(/^url:/i, '');
    return {
      id: stableObjectId(`url:${url}`),
      title: titleForPath(url),
      kind: 'url',
      ref: `url:${url}`,
      runId,
      preferredView: 'generic-artifact-inspector',
      actions: ['focus-right-pane', 'copy-path', 'pin'],
      status: 'external',
      summary: url,
      provenance: { dataRef: url },
    };
  }
  return {
    id: stableObjectId(ref),
    title: ref.replace(/^[a-z-]+:/i, ''),
    kind,
    ref,
    runId,
    actions: ['focus-right-pane', 'pin'],
    status: 'available',
    summary: ref,
  };
}

function objectReferenceForArtifact(artifact: RuntimeArtifact, runId?: string): ObjectReference {
  const path = artifact.path || stringFromRecord(artifact.metadata, 'path') || stringFromRecord(artifact.metadata, 'filePath') || artifact.dataRef;
  return {
    id: stableObjectId(`artifact:${artifact.id}`),
    title: stringFromRecord(artifact.metadata, 'title') || artifact.id || artifact.type,
    kind: 'artifact',
    ref: `artifact:${artifact.id}`,
    artifactType: artifact.type,
    runId,
    preferredView: preferredViewForPath(path) || preferredViewForArtifactType(artifact.type),
    actions: path ? ['focus-right-pane', 'inspect', 'open-external', 'reveal-in-folder', 'copy-path', 'pin'] : ['focus-right-pane', 'inspect', 'pin'],
    status: 'available',
    summary: artifact.type,
    provenance: {
      dataRef: artifact.dataRef,
      path,
      version: artifact.schemaVersion,
      hash: stringFromRecord(artifact.metadata, 'hash'),
      size: numberFromRecord(artifact.metadata, 'size'),
    },
  };
}

function objectReferenceForPath(path: string, runId?: string, artifact?: RuntimeArtifact, forcedKind?: 'file' | 'folder'): ObjectReference {
  const normalizedPath = trimReferenceTail(path.replace(/^file:/i, '').replace(/^folder:/i, ''));
  const isFolder = forcedKind === 'folder' || normalizedPath.endsWith('/');
  const kind = isFolder ? 'folder' : 'file';
  return {
    id: stableObjectId(`${kind}:${normalizedPath}`),
    title: titleForPath(normalizedPath),
    kind,
    ref: `${kind}:${normalizedPath}`,
    artifactType: artifact?.type ?? artifactTypeForPath(normalizedPath, kind),
    runId,
    preferredView: preferredViewForPath(normalizedPath) || preferredViewForArtifactType(artifact?.type),
    actions: ['focus-right-pane', 'open-external', 'reveal-in-folder', 'copy-path', 'pin'],
    status: 'available',
    summary: normalizedPath,
    provenance: {
      dataRef: artifact?.dataRef || normalizedPath,
      path: normalizedPath,
      version: artifact?.schemaVersion,
      hash: stringFromRecord(artifact?.metadata, 'hash'),
      size: numberFromRecord(artifact?.metadata, 'size'),
    },
  };
}

function artifactTypeForPath(path: string, kind: ObjectReferenceKind) {
  if (kind === 'folder') return 'workspace-folder';
  if (/\.md|\.markdown$/i.test(path)) return 'research-report';
  if (/\.pdf$/i.test(path)) return 'pdf-document';
  if (/\.json$/i.test(path)) return 'json-document';
  if (/\.html?$/i.test(path)) return 'html-document';
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) return 'image';
  if (/\.(csv|tsv|xlsx?)$/i.test(path)) return 'data-table';
  if (/\.(pdb|cif|mmcif)$/i.test(path)) return 'structure-summary';
  return 'workspace-file';
}

function preferredViewForPath(path?: string) {
  if (!path) return undefined;
  if (/\.md|\.markdown$/i.test(path)) return 'report-viewer';
  if (/\.(csv|tsv|xlsx?|json)$/i.test(path)) return 'generic-data-table';
  if (/\.(png|jpe?g|gif|webp|svg|html?)$/i.test(path)) return 'generic-artifact-inspector';
  if (/\.(pdb|cif|mmcif)$/i.test(path)) return 'molecule-viewer';
  return undefined;
}

function preferredViewForArtifactType(type?: string) {
  if (!type) return undefined;
  if (/report|markdown|document|summary/i.test(type)) return 'report-viewer';
  if (/table|matrix|csv|tsv|dataframe|json/i.test(type)) return 'generic-data-table';
  if (/structure|pdb|protein|molecule|mmcif|cif|3d/i.test(type)) return 'molecule-viewer';
  if (/paper|literature/i.test(type)) return 'literature-paper-cards';
  if (/graph|network|knowledge/i.test(type)) return 'network-graph';
  return 'generic-artifact-inspector';
}

function mergeObjectReferences(references: ObjectReference[]) {
  const byRef = new Map<string, ObjectReference>();
  for (const reference of references) {
    const key = reference.ref || reference.id;
    const current = byRef.get(key);
    if (!current) {
      byRef.set(key, reference);
      continue;
    }
    byRef.set(key, {
      ...reference,
      ...current,
      actions: uniqueStrings([...(current.actions ?? []), ...(reference.actions ?? [])]) as ObjectAction[],
      provenance: { ...reference.provenance, ...current.provenance },
    });
  }
  return prioritizeObjectReferences(Array.from(byRef.values()));
}

function prioritizeObjectReferences(references: ObjectReference[]) {
  return [...references].sort((left, right) => objectReferencePriority(right) - objectReferencePriority(left));
}

function objectReferencePriority(reference: ObjectReference) {
  let score = 0;
  const haystack = `${reference.ref} ${reference.title} ${reference.artifactType ?? ''}`.toLowerCase();
  if (/\.md|markdown|report|报告/.test(haystack)) score += 80;
  if (/\.csv|\.tsv|table|matrix|表格|矩阵/.test(haystack)) score += 60;
  if (reference.kind === 'artifact') score += 20;
  if (reference.kind === 'file') score += 15;
  if (reference.kind === 'run' || reference.kind === 'execution-unit') score += 5;
  return score;
}

function findReportRef(payload: Record<string, unknown>): string | undefined {
  for (const key of ['reportRef', 'markdownRef', 'dataRef', 'path', 'outputRef']) {
    if (typeof payload[key] === 'string' && payload[key].trim()) return payload[key];
  }
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts.filter(isRecord) : [];
  for (const artifact of artifacts) {
    const nested = isRecord(artifact.data) ? artifact.data : artifact;
    const ref = findReportRef(nested);
    if (ref) return ref;
  }
  return undefined;
}

function parseJsonFromText(text: string): Record<string, unknown> | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  for (const candidate of [fenced, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]) {
    if (!candidate?.trim()) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Ignore natural-language content.
    }
  }
  return undefined;
}

function looksLikeRawPayload(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || /^```json/i.test(trimmed)) return true;
  return /ToolPayload|uiManifest|executionUnits|reasoningTrace|Returning the existing result/i.test(trimmed)
    && /"artifacts"|"message"|"confidence"/i.test(trimmed);
}

function mentionsToken(text: string, token: string) {
  if (!token || token.length < 4) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w.-])${escaped}($|[^\\w.-])`, 'i').test(text);
}

function trimReferenceTail(value: string) {
  return value.trim().replace(/[.,;:，。；、)）\]}]+$/g, '');
}

function titleForPath(path: string) {
  const clean = path.replace(/\/+$/, '');
  return clean.split('/').filter(Boolean).at(-1) || clean || 'workspace object';
}

function stableObjectId(ref: string) {
  return `obj-${ref.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52) || makeId('ref')}`;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function stringFromRecord(record: unknown, key: string) {
  return isRecord(record) && typeof record[key] === 'string' && record[key].trim() ? record[key] : undefined;
}

function numberFromRecord(record: unknown, key: string) {
  return isRecord(record) && typeof record[key] === 'number' && Number.isFinite(record[key]) ? record[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
