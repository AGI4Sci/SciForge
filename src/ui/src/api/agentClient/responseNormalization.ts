import type { ClaimType, EvidenceLevel } from '../../data';
import type { ContractValidationFailure, ContractValidationFailureKind } from '@sciforge-ui/runtime-contract';
import { makeId, nowIso, type NormalizedAgentResponse, type ObjectAction, type ObjectReference, type ObjectReferenceKind, type RuntimeArtifact, type RuntimeExecutionUnit, type ScenarioInstanceId } from '../../domain';

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
  const report = reportMarkdownFromArtifacts(structured.artifacts);
  if (report) return report;
  const markdown = reportMarkdownFromPayload(structured);
  if (markdown) return markdown;
  return stripVerificationFooter(direct || fallback);
}

function stripVerificationFooter(value: string) {
  return value
    .replace(/\n{1,3}Verification:\s*(?:pass|fail|uncertain|needs-human|unverified)\b[^\n]*(?:\n[^\n]*)?$/i, '')
    .trim();
}

function reportMarkdownFromArtifacts(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    if (!isRecord(item) || item.type !== 'research-report') continue;
    const markdown = reportMarkdownFromPayload(isRecord(item.data) ? item.data : item);
    if (markdown) return markdown;
  }
  return undefined;
}

function reportMarkdownFromPayload(payload: Record<string, unknown>): string | undefined {
  const nested = parseReportPayload(payload) ?? payload;
  const direct = asString(nested.markdown) || asString(nested.report) || asString(nested.summary) || asString(nested.content);
  if (direct && !looksLikeRawJson(direct)) return direct;
  const sections = Array.isArray(nested.sections) ? nested.sections.filter(isRecord) : [];
  if (sections.length) {
    return sections.map((section, index) => {
      const title = asString(section.title) || `Section ${index + 1}`;
      const content = asString(section.content) || asString(section.markdown) || readableRecord(section);
      return `## ${title}\n\n${content}`;
    }).join('\n\n');
  }
  return undefined;
}

function parseReportPayload(payload: Record<string, unknown>) {
  for (const key of ['data', 'content', 'report', 'result']) {
    const value = payload[key];
    if (isRecord(value)) return value;
    if (typeof value !== 'string' || !value.trim().startsWith('{')) continue;
    try {
      const parsed = JSON.parse(value);
      if (isRecord(parsed)) return isRecord(parsed.data) ? parsed.data : parsed;
    } catch {
      // Keep natural-language report strings unchanged.
    }
  }
  return undefined;
}

function readableRecord(record: Record<string, unknown>) {
  return Object.entries(record)
    .filter(([key]) => key !== 'title')
    .map(([key, value]) => {
      if (typeof value === 'string') return `**${key}:** ${value}`;
      if (Array.isArray(value)) return `**${key}:**\n${value.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n')}`;
      if (typeof value === 'number' || typeof value === 'boolean') return `**${key}:** ${String(value)}`;
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function looksLikeRawJson(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}');
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
  const outputText = extractOutputText(root);
  const structured = extractJsonObject(outputText) ?? payloadLikeRecord(root) ?? {};
  const contractValidationFailure = findContractValidationFailure(structured, root, runRecord);
  const now = nowIso();
  const runId = asString(runRecord.id) || makeId('run');
  const runStatus = runRecord.status === 'failed' || contractValidationFailure ? 'failed' : 'completed';
  const cleanOutputText = outputText.replace(/```(?:json)?[\s\S]*?```/gi, '').trim() || outputText;
  const hasStructuredOutput = Object.keys(structured).length > 0;
  const messageText = contractValidationFailure
    ? messageFromContractValidationFailure(contractValidationFailure)
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
  const objectReferences = normalizeObjectReferences(structured.objectReferences, artifacts, runId, contractValidationFailure?.relatedRefs);
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
    uiManifest: Array.isArray(structured.uiManifest) ? structured.uiManifest.filter(isRecord).map((slot) => ({
      componentId: asString(slot.componentId) || asString(slot.id) || 'paper-card-list',
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
    })) : [],
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
    const artifactType = asString(artifact.type) || 'scenario-output';
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
      data: normalizeArtifactData(artifactType, artifact),
      dataRef: asString(artifact.dataRef),
      path,
      visibility: asTimelineVisibility(artifact.visibility),
      audience: asStringArray(artifact.audience),
      sensitiveDataFlags: asStringArray(artifact.sensitiveDataFlags),
      exportPolicy: asExportPolicy(artifact.exportPolicy),
    };
  }) : [];
}

function normalizeObjectReferences(value: unknown, artifacts: RuntimeArtifact[], runId: string, relatedRefs: string[] = []): ObjectReference[] {
  const explicit = Array.isArray(value)
    ? value.filter(isRecord).flatMap((record) => {
      const normalized = normalizeObjectReference(record, artifacts, runId);
      return normalized ? [normalized] : [];
    })
    : [];
  const autoIndexed = artifacts.map((artifact) => objectReferenceFromArtifact(artifact, runId));
  const related = relatedRefs.flatMap((ref) => {
    const normalized = objectReferenceFromRelatedRef(ref, artifacts, runId);
    return normalized ? [normalized] : [];
  });
  const byRef = new Map<string, ObjectReference>();
  for (const reference of [...explicit, ...autoIndexed, ...related]) {
    const key = reference.ref || reference.id;
    if (!byRef.has(key)) {
      byRef.set(key, reference);
      continue;
    }
    byRef.set(key, {
      ...reference,
      ...byRef.get(key),
      actions: uniqueStringList([...(byRef.get(key)?.actions ?? []), ...(reference.actions ?? [])]) as ObjectAction[],
    });
  }
  return Array.from(byRef.values()).slice(0, 16);
}

function objectReferenceFromRelatedRef(ref: string, artifacts: RuntimeArtifact[], runId: string): ObjectReference | undefined {
  const kind = inferObjectKindFromRef(ref);
  if (!kind) return undefined;
  const matchedArtifact = kind === 'artifact' ? findArtifactForObjectRef(ref, artifacts) : undefined;
  return {
    id: stableObjectId(ref),
    title: matchedArtifact?.id || ref.replace(/^[a-z-]+:{1,2}/i, ''),
    kind,
    ref,
    artifactType: matchedArtifact?.type,
    runId,
    executionUnitId: kind === 'execution-unit' ? ref.replace(/^execution-unit:{1,2}/i, '') : undefined,
    preferredView: preferredViewForArtifactType(matchedArtifact?.type),
    actions: normalizeObjectActions(undefined, kind, matchedArtifact),
    status: matchedArtifact || kind !== 'artifact' ? 'available' : 'missing',
    summary: 'contract validation related ref',
    provenance: normalizeObjectProvenance(undefined, matchedArtifact),
  };
}

function normalizeObjectReference(record: Record<string, unknown>, artifacts: RuntimeArtifact[], runId: string): ObjectReference | undefined {
  const ref = asString(record.ref)
    || objectRefFromRecord(record);
  if (!ref) return undefined;
  const kind = normalizeObjectKind(record.kind) ?? inferObjectKindFromRef(ref);
  if (!kind) return undefined;
  const matchedArtifact = kind === 'artifact' ? findArtifactForObjectRef(ref, artifacts) : undefined;
  const title = asString(record.title)
    || asString(matchedArtifact?.metadata?.title)
    || matchedArtifact?.id
    || ref.replace(/^[a-z-]+:/i, '');
  const actions = normalizeObjectActions(record.actions, kind, matchedArtifact);
  return {
    id: asString(record.id) || stableObjectId(ref),
    title,
    kind,
    ref,
    artifactType: asString(record.artifactType) || matchedArtifact?.type,
    runId: asString(record.runId) || runId,
    executionUnitId: asString(record.executionUnitId),
    preferredView: asString(record.preferredView) || preferredViewForArtifactType(matchedArtifact?.type),
    actions,
    status: normalizeObjectStatus(record.status) || 'available',
    summary: asString(record.summary),
    provenance: normalizeObjectProvenance(record.provenance, matchedArtifact),
  };
}

function objectReferenceFromArtifact(artifact: RuntimeArtifact, runId: string): ObjectReference {
  const path = preferredArtifactPreviewPath(artifact);
  return {
    id: stableObjectId(`artifact:${artifact.id}`),
    title: asString(artifact.metadata?.title) || artifact.id || artifact.type,
    kind: 'artifact',
    ref: `artifact:${artifact.id}`,
    artifactType: artifact.type,
    runId,
    preferredView: preferredViewForArtifactType(artifact.type),
    actions: objectActionsForArtifact(artifact),
    status: 'available',
    summary: artifactSummary(artifact),
    provenance: {
      dataRef: artifact.dataRef,
      path,
      producer: asString(artifact.metadata?.producer) || asString(artifact.metadata?.executionUnitId),
      version: artifact.schemaVersion,
      hash: asString(artifact.metadata?.hash),
      size: asNumber(artifact.metadata?.size),
    },
  };
}

function preferredArtifactPreviewPath(artifact: RuntimeArtifact) {
  return firstMarkdownPath(
    artifact.metadata?.markdownRef,
    artifact.metadata?.reportRef,
    artifact.path,
    artifact.metadata?.path,
    artifact.metadata?.filePath,
    artifact.dataRef,
  )
    || artifact.path
    || asString(artifact.metadata?.path)
    || asString(artifact.metadata?.filePath);
}

function firstMarkdownPath(...values: unknown[]) {
  return values.map(asString).find((value) => Boolean(value && /\.m(?:d|arkdown)(?:$|[?#])/i.test(value)));
}

function objectRefFromRecord(record: Record<string, unknown>) {
  const artifactId = asString(record.artifactId) || asString(record.artifactRef);
  if (artifactId) return artifactId.startsWith('artifact:') ? artifactId : `artifact:${artifactId}`;
  const path = asString(record.path) || asString(record.filePath);
  if (path) return `${record.kind === 'folder' ? 'folder' : 'file'}:${path}`;
  const url = asString(record.url);
  if (url) return `url:${url}`;
  return undefined;
}

function normalizeObjectKind(value: unknown): ObjectReferenceKind | undefined {
  const kind = asString(value);
  if (kind === 'artifact' || kind === 'file' || kind === 'folder' || kind === 'run' || kind === 'execution-unit' || kind === 'url' || kind === 'scenario-package') return kind;
  return undefined;
}

function inferObjectKindFromRef(ref: string): ObjectReferenceKind | undefined {
  const prefix = ref.split(':', 1)[0]?.toLowerCase();
  if (prefix === 'artifact' || prefix === 'file' || prefix === 'folder' || prefix === 'run' || prefix === 'execution-unit' || prefix === 'url' || prefix === 'scenario-package') return prefix;
  if (/^https?:\/\//i.test(ref)) return 'url';
  return undefined;
}

function normalizeObjectActions(value: unknown, kind: ObjectReferenceKind, artifact?: RuntimeArtifact): ObjectAction[] {
  const allowed = ['focus-right-pane', 'inspect', 'open-external', 'reveal-in-folder', 'copy-path', 'pin', 'compare'];
  const declared = Array.isArray(value) ? value.filter((item): item is ObjectAction => typeof item === 'string' && allowed.includes(item)) : [];
  const defaults: ObjectAction[] = kind === 'artifact'
    ? objectActionsForArtifact(artifact)
    : kind === 'file' || kind === 'folder'
      ? ['focus-right-pane', 'open-external', 'reveal-in-folder', 'copy-path', 'pin']
      : kind === 'url'
        ? ['focus-right-pane', 'copy-path', 'pin']
        : ['focus-right-pane', 'pin'];
  return uniqueStringList([...declared, ...defaults]) as ObjectAction[];
}

function objectActionsForArtifact(artifact?: RuntimeArtifact): ObjectAction[] {
  const fileLike = Boolean(artifact?.path || artifact?.metadata?.path || artifact?.metadata?.filePath || artifact?.metadata?.localPath);
  return fileLike
    ? ['focus-right-pane', 'inspect', 'open-external', 'reveal-in-folder', 'copy-path', 'pin', 'compare']
    : ['focus-right-pane', 'inspect', 'pin', 'compare'];
}

function normalizeObjectStatus(value: unknown): ObjectReference['status'] | undefined {
  const status = asString(value);
  if (status === 'available' || status === 'missing' || status === 'expired' || status === 'blocked' || status === 'external') return status;
  return undefined;
}

function normalizeObjectProvenance(value: unknown, artifact?: RuntimeArtifact): ObjectReference['provenance'] {
  const record = isRecord(value) ? value : {};
  const path = asString(record.path) || artifact?.path || asString(artifact?.metadata?.path) || asString(artifact?.metadata?.filePath);
  return {
    dataRef: asString(record.dataRef) || artifact?.dataRef,
    path,
    producer: asString(record.producer) || asString(artifact?.metadata?.producer) || asString(artifact?.metadata?.executionUnitId),
    version: asString(record.version) || artifact?.schemaVersion,
    hash: asString(record.hash) || asString(artifact?.metadata?.hash),
    size: asNumber(record.size) ?? asNumber(artifact?.metadata?.size),
  };
}

function findArtifactForObjectRef(ref: string, artifacts: RuntimeArtifact[]) {
  const id = ref.replace(/^artifact:/i, '');
  return artifacts.find((artifact) => artifact.id === id || artifact.type === id || artifact.dataRef === id || artifact.path === id);
}

function preferredViewForArtifactType(type?: string) {
  if (!type) return undefined;
  if (/structure|pdb|protein|molecule|mmcif|cif|3d/i.test(type)) return 'structure-viewer';
  if (/report|markdown|document|summary/i.test(type)) return 'report-viewer';
  if (/evidence/i.test(type)) return 'evidence-matrix-panel';
  if (/paper|literature/i.test(type)) return 'literature-paper-cards';
  if (/network|graph|knowledge/i.test(type)) return 'graph-viewer';
  if (/table|matrix|csv|tsv|dataframe/i.test(type)) return 'record-table';
  return 'generic-artifact-inspector';
}

function artifactSummary(artifact: RuntimeArtifact) {
  const rows = isRecord(artifact.data) ? asNumber(artifact.data.rows) : undefined;
  const count = Array.isArray(artifact.data) ? artifact.data.length : rows;
  return `${artifact.type}${count ? ` · ${count} records` : ''}`;
}

function stableObjectId(ref: string) {
  return `obj-${ref.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52) || makeId('ref')}`;
}

function uniqueStringList(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function withRuntimePresentationMetadata(raw: unknown, structured: Record<string, unknown>, objectReferences: ObjectReference[], contractValidationFailure?: ContractValidationFailure) {
  const metadata = {
    displayIntent: isRecord(structured.displayIntent) ? structured.displayIntent : undefined,
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

function normalizeArtifactData(type: string, artifact: Record<string, unknown>) {
  const data = 'data' in artifact
    ? artifact.data
    : artifact.content ?? artifact.markdown ?? artifact.report ?? artifact.summary;
  const encoding = asString(artifact.encoding) || asString(isRecord(artifact.metadata) ? artifact.metadata.encoding : undefined);
  if (typeof data === 'string' && isTextLikeArtifact(type, encoding)) {
    return {
      markdown: data,
      text: data,
      report: data,
    };
  }
  if (typeof data === 'string' && isJsonLikeArtifact(type, encoding)) {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return {
        text: data,
      };
    }
  }
  return data;
}

function isTextLikeArtifact(type: string, encoding?: string) {
  return /markdown|md|text/i.test(encoding || '')
    || /report|summary|notebook|document|markdown|text|note|protocol|plan|narrative/i.test(type);
}

function isJsonLikeArtifact(type: string, encoding?: string) {
  return /json/i.test(encoding || '')
    || /list|table|matrix|graph|records|items|rows/i.test(type);
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
