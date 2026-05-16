import type { SciForgeSharedSkillDomain } from './handoff';
import { toolPayloadShapeContractSummary } from './tool-payload-shape';

const DEFAULT_ARTIFACT_TYPE_BY_SKILL_DOMAIN: Record<SciForgeSharedSkillDomain, string> = {
  literature: 'paper-list',
  structure: 'structure-summary',
  omics: 'omics-differential-expression',
  knowledge: 'knowledge-graph',
};

const RESEARCH_REPORT_ARTIFACT_TYPE = 'research-report';
const RUNTIME_CONTEXT_SUMMARY_ARTIFACT_TYPE = 'runtime-context-summary';
const OMICS_DIFFERENTIAL_EXPRESSION_ARTIFACT_TYPE = 'omics-differential-expression';
const TEXT_MARKDOWN_ARTIFACT_TYPE_PATTERN = /report|summary|markdown|text/i;

export const BIBLIOGRAPHIC_VERIFICATION_POLICY_CONTRACT_ID = 'sciforge.bibliographic-verification.v1' as const;
export const BIBLIOGRAPHIC_RECORD_CONTRACT_ID = 'sciforge.bibliographic-record.v1' as const;
export const BIBLIOGRAPHIC_ARTIFACT_TYPES = [
  'paper-list',
  'bibliography',
  'citation-record',
  'bibliographic-record',
  'literature-reproduction-feasibility',
] as const;
export const BIBLIOGRAPHIC_COMPONENT_IDS = ['paper-card-list'] as const;
export const BIBLIOGRAPHIC_CAPABILITY_IDS = [
  'citation.verification',
  'literature.retrieval',
  'agentserver.generate.literature',
] as const;

const BIBLIOGRAPHIC_ARTIFACT_TYPE_SET = new Set<string>(BIBLIOGRAPHIC_ARTIFACT_TYPES);
const BIBLIOGRAPHIC_COMPONENT_ID_SET = new Set<string>(BIBLIOGRAPHIC_COMPONENT_IDS);
const BIBLIOGRAPHIC_CAPABILITY_ID_SET = new Set<string>(BIBLIOGRAPHIC_CAPABILITY_IDS);
const BIBLIOGRAPHIC_SKILL_DOMAIN_SET = new Set<string>(['literature']);
const BIBLIOGRAPHIC_POLICY_CONTRACT_SET = new Set<string>([
  BIBLIOGRAPHIC_VERIFICATION_POLICY_CONTRACT_ID,
  BIBLIOGRAPHIC_RECORD_CONTRACT_ID,
]);

export const CURRENT_REFERENCE_GATE_TOOL_ID = 'sciforge.current-reference-gate' as const;
export const CURRENT_REFERENCE_DIGEST_RECOVERY_TOOL_ID = 'sciforge.current-reference-digest-recovery' as const;
export const CURRENT_REFERENCE_DIGEST_RECOVERY_REF_PATH = 'current-reference-digest-recovery' as const;
export const CURRENT_REFERENCE_DIGEST_RECOVERY_REPORT_ARTIFACT_ID = 'research-report' as const;
export const CURRENT_REFERENCE_DIGEST_RECOVERY_REPORT_ARTIFACT_TYPE = 'research-report' as const;
export const CURRENT_REFERENCE_DIGEST_RECOVERY_CLAIM_TYPE = 'current-reference-digest-recovery' as const;
export const CURRENT_REFERENCE_DIGEST_RECOVERY_EVIDENCE_LEVEL = 'bounded-current-reference-digest' as const;
export const CURRENT_REFERENCE_DIGEST_RECOVERY_RUNTIME_LABEL = 'SciForge current-reference digest recovery' as const;
export const CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_TYPE = 'agentserver-digest-recovery' as const;
export const CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_MESSAGE =
  'AgentServer did not converge, so SciForge recovered from bounded current-reference digests.' as const;
export const CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_DETAIL =
  'The recovery output keeps the same user-visible contract: report artifact, object references, and execution audit.' as const;
export const CURRENT_REFERENCE_DIGEST_RECOVERY_LOG_LINE =
  'SciForge recovered from bounded current-reference digests.\n' as const;
export const CURRENT_REFERENCE_EVIDENCE_POLICY_DEFAULT_ACTION =
  'Use current references as explicit user-provided evidence; resolve large payloads by ref and bounded summary. Treat stdoutRef/stderrRef as audit refs unless a structured harness/context policy grants bounded raw log expansion.' as const;
export const EXECUTION_LOG_REF_AUDIT_NOTE =
  'stdoutRef/stderrRef are audit and provenance refs by default; raw log expansion requires a structured harness/context policy grant.' as const;
export const EXECUTION_LOG_REF_EXPANSION_POLICY =
  'cite stdoutRef/stderrRef for audit; expand only when structured harness/context policy grants bounded log inspection' as const;

export interface DirectContextFastPathItem {
  kind: string;
  label: string;
  ref?: string;
  summary: string;
}

export interface DirectContextFastPathInputs {
  artifacts?: unknown;
  uiArtifacts?: unknown;
  references?: unknown;
  currentReferences?: unknown;
  currentReferenceDigests?: unknown;
  claims?: unknown;
  recentExecutionRefs?: unknown;
  executionUnits?: unknown;
}

export const DIRECT_CONTEXT_FAST_PATH_POLICY = {
  reportArtifactId: 'direct-context-summary',
  reportArtifactType: RUNTIME_CONTEXT_SUMMARY_ARTIFACT_TYPE,
  source: 'direct-context-fast-path',
  policyOwner: 'python-conversation-policy',
  claimId: 'direct-context-claim',
  claimType: 'context-summary',
  evidenceLevel: 'current-session-context',
  executionToolId: 'sciforge.direct-context-fast-path',
  outputRef: 'runtime://direct-context-fast-path',
  uiRoute: 'direct-context-fast-path',
  messageHeader: '基于当前会话已有上下文直接回答，不启动新的 workspace task。',
  defaultClaimText: 'Existing session context is available.',
  reasoningTraceLines: [
    'Python conversation-policy selected direct-context-answer.',
    'SciForge executed the direct-context fast path from current reference digests, artifacts, references, and execution refs only.',
  ],
  contextLimits: {
    artifacts: 12,
    references: 12,
    executionUnits: 8,
    messageItems: 8,
    summaryChars: 240,
  },
  fallbackRefs: {
    artifact: 'artifact:',
    executionUnit: 'execution-unit:',
  },
  missingExpectedArtifacts: {
    claimId: 'direct-context-missing-expected-artifacts',
    claimType: 'missing-expected-artifacts',
    status: 'needs-work',
    artifactType: 'runtime-diagnostic',
    messageHeader: '当前会话有可复用 refs，但缺少本轮 follow-up 需要的结构化产物，不能把上下文摘要当作任务成功。',
    nextStepTemplate: 'Resume or repair the prior run before answering this follow-up; missing expected artifacts: {{missing}}.',
    recoverActions: [
      'Resume or repair the prior run using preserved execution refs.',
      'Generate the missing expected artifact before answering the format/change/audit follow-up.',
    ],
  },
} as const;

export interface CurrentReferenceDigestRecoveryCandidate {
  sourceRef: string;
  digestRef: string;
  inlineText?: string;
}

export interface CurrentReferenceDigestRecoverySource {
  sourceRef: string;
  digestRef: string;
  text: string;
}

export interface CurrentReferenceDigestRecoveryPayloadRequest {
  prompt: string;
  skillDomain: string;
  skillId: string;
  failureReason: string;
  sources: CurrentReferenceDigestRecoverySource[];
  uiManifest: Array<Record<string, unknown>>;
  shortHash?: (value: string) => string;
}

export type ArtifactPolicyRecord = Record<string, unknown>;

export type ArtifactPolicyReadKind = 'text' | 'csv';

export interface ArtifactPolicyReadRequest {
  key: string;
  kind: ArtifactPolicyReadKind;
  ref: unknown;
}

export type ArtifactPolicyReadResults = Record<string, unknown>;

export function defaultArtifactSchemaForSkillDomain(skillDomain: SciForgeSharedSkillDomain): Record<string, unknown> {
  return { type: DEFAULT_ARTIFACT_TYPE_BY_SKILL_DOMAIN[skillDomain] };
}

export function buildDirectContextFastPathItems(inputs: DirectContextFastPathInputs): DirectContextFastPathItem[] {
  const items: DirectContextFastPathItem[] = [];
  for (const digest of recordRows(inputs.currentReferenceDigests).slice(-DIRECT_CONTEXT_FAST_PATH_POLICY.contextLimits.references)) {
    const summary = directContextDigestSummary(digest);
    if (!summary) continue;
    const sourceRef = stringField(digest.sourceRef)
      ?? stringField(digest.path)
      ?? stringField(digest.clickableRef)
      ?? stringField(digest.ref);
    const digestRef = stringField(digest.digestRef) ?? stringField(digest.digestPath);
    const ref = digestRef ?? sourceRef;
    const label = stringField(digest.title)
      ?? stringField(digest.label)
      ?? sourceRef
      ?? digestRef
      ?? 'current reference digest';
    items.push({
      kind: 'current-reference-digest',
      label,
      ref,
      summary,
    });
  }
  for (const artifact of [...recordRows(inputs.artifacts), ...recordRows(inputs.uiArtifacts)].slice(-DIRECT_CONTEXT_FAST_PATH_POLICY.contextLimits.artifacts)) {
    const id = stringField(artifact.id) ?? stringField(artifact.type) ?? 'artifact';
    const type = stringField(artifact.type) ?? stringField(artifact.artifactType) ?? 'artifact';
    const ref = stringField(artifact.dataRef) ?? stringField(artifact.path) ?? `${DIRECT_CONTEXT_FAST_PATH_POLICY.fallbackRefs.artifact}${id}`;
    items.push({
      kind: 'artifact',
      label: `${type} ${id}`,
      ref,
      summary: directContextArtifactSummary(artifact),
    });
  }
  for (const reference of [...recordRows(inputs.references), ...recordRows(inputs.currentReferences)].slice(-DIRECT_CONTEXT_FAST_PATH_POLICY.contextLimits.references)) {
    const ref = stringField(reference.ref);
    items.push({
      kind: stringField(reference.kind) ?? 'file',
      label: stringField(reference.title) ?? ref ?? 'reference',
      ref,
      summary: stringField(reference.summary) ?? ref ?? 'current reference',
    });
  }
  for (const claim of recordRows(inputs.claims).slice(-DIRECT_CONTEXT_FAST_PATH_POLICY.contextLimits.references)) {
    const id = stringField(claim.id) ?? stringField(claim.ref) ?? 'claim';
    const text = stringField(claim.text) ?? stringField(claim.summary) ?? stringField(claim.message);
    if (!text) continue;
    items.push({
      kind: stringField(claim.type) ?? stringField(claim.claimType) ?? 'claim',
      label: `claim ${id}`,
      ref: stringField(claim.ref) ?? stringField(claim.sourceRef) ?? `claim:${id}`,
      summary: text,
    });
  }
  for (const unit of [...recordRows(inputs.recentExecutionRefs), ...recordRows(inputs.executionUnits)].slice(-DIRECT_CONTEXT_FAST_PATH_POLICY.contextLimits.executionUnits)) {
    const id = stringField(unit.id) ?? 'execution-unit';
    const refs = uniqueStrings([
      stringField(unit.codeRef),
      stringField(unit.outputRef),
      stringField(unit.stdoutRef),
      stringField(unit.stderrRef),
    ]);
    items.push({
      kind: 'execution-unit',
      label: id,
      ref: refs[0] ?? `${DIRECT_CONTEXT_FAST_PATH_POLICY.fallbackRefs.executionUnit}${id}`,
      summary: refs.length ? refs.join('; ') : stringField(unit.status) ?? 'prior execution ref',
    });
  }
  return dedupeDirectContextFastPathItems(items);
}

export function directContextFastPathMessage(items: DirectContextFastPathItem[]): string {
  const refLines = items
    .slice(0, DIRECT_CONTEXT_FAST_PATH_POLICY.contextLimits.messageItems)
    .map((item, index) => `${index + 1}. ${item.label}: ${item.summary}${item.ref ? ` (${item.ref})` : ''}`);
  return [
    DIRECT_CONTEXT_FAST_PATH_POLICY.messageHeader,
    ...refLines,
  ].join('\n');
}

export function directContextFastPathSupportingRefs(items: DirectContextFastPathItem[]): string[] {
  return uniqueStrings(items.map((item) => item.ref));
}

export function materializedMarkdownTextForArtifact(artifact: ArtifactPolicyRecord) {
  return artifactMarkdownText(artifact);
}

export function materializedMarkdownMetadataForArtifact(metadata: unknown, markdownRef: string | undefined) {
  if (!markdownRef) return {};
  const record = isRecord(metadata) ? metadata : {};
  return {
    reportRef: stringField(record.reportRef) ?? markdownRef,
    markdownRef: stringField(record.markdownRef) ?? markdownRef,
  };
}

export function artifactDataForUnparsedPathText(artifact: ArtifactPolicyRecord, text: string | undefined) {
  if (!text || !TEXT_MARKDOWN_ARTIFACT_TYPE_PATTERN.test(artifactPolicyType(artifact))) return {};
  return { markdown: text, content: text };
}

export function artifactDataReadRequestsForPolicy(artifact: ArtifactPolicyRecord): ArtifactPolicyReadRequest[] {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  switch (artifactPolicyType(artifact)) {
    case RESEARCH_REPORT_ARTIFACT_TYPE:
      return [
        { key: 'reportMarkdown', kind: 'text', ref: metadata.reportRef },
        { key: 'realDataPlan', kind: 'text', ref: metadata.realDataPlanRef },
      ];
    case OMICS_DIFFERENTIAL_EXPRESSION_ARTIFACT_TYPE:
      return [
        { key: 'markerRows', kind: 'csv', ref: metadata.markerRef },
        { key: 'qcRows', kind: 'csv', ref: metadata.qcRef },
        { key: 'compositionRows', kind: 'csv', ref: metadata.compositionRef },
        { key: 'volcanoRows', kind: 'csv', ref: metadata.volcanoRef },
        { key: 'umapSvgText', kind: 'text', ref: metadata.umapSvgRef },
        { key: 'heatmapSvgText', kind: 'text', ref: metadata.heatmapSvgRef },
      ];
    default:
      return [];
  }
}

export function normalizeArtifactDataWithPolicy(
  artifact: ArtifactPolicyRecord,
  initialData: Record<string, unknown>,
  reads: ArtifactPolicyReadResults,
) {
  const data = { ...initialData };
  switch (artifactPolicyType(artifact)) {
    case RESEARCH_REPORT_ARTIFACT_TYPE:
      return normalizeResearchReportArtifactData(artifact, data, reads);
    case OMICS_DIFFERENTIAL_EXPRESSION_ARTIFACT_TYPE:
      return normalizeOmicsDifferentialExpressionArtifactData(data, reads);
    default:
      return data;
  }
}

export function agentServerToolPayloadProtocolContractLines() {
  const shape = toolPayloadShapeContractSummary();
  return [
    `ToolPayload schema is strict (${shape.contractId}): ${shape.arrayFields.join(', ')} must be arrays; every uiManifest slot must be an object with componentId and a string artifactRef when present; every artifact entry must be an object with non-empty id and type. Do not put result rows inside uiManifest. Do not put artifact filenames, variable names, or result rows directly in artifacts/uiManifest; put content in artifacts[].data, artifacts[].dataRef, artifacts[].path, or a clearly declared artifact object.`,
    `Use uiManifest only as view routing metadata. ${shape.contentRule}. All user-visible result content, tables, lists, reports, raw provider traces, and files must be represented as artifacts with durable dataRef/path or inline data that SciForge can persist.`,
    'When repairing schema failures, preserve the task-specific componentId/artifactRef/artifact type from selectedComponentIds, expectedArtifactTypes, incoming uiManifest, or generated artifacts. If none is known, use a generic unknown-artifact-inspector slot bound to a runtime-result artifact; do not force literature/report-specific components into unrelated scenarios.',
  ];
}

export function agentServerArtifactSelectionPromptPolicyLines() {
  return [
    'Only treat expectedArtifactTypes as required when the list is non-empty. If it is empty, infer the minimal output from the raw user prompt and do not add scenario-default artifacts.',
    'If expectedArtifactTypes contains multiple artifacts, generate a coordinated Python task or small Python module set that emits every requested artifact type. A partial package skill result is not enough unless the missing artifact has a clear failed-with-reason ExecutionUnit.',
  ];
}

export function agentServerCurrentReferencePromptPolicyLines() {
  return [
    'Current-reference contract: if uiStateSummary.currentReferences or contextEnvelope.sessionFacts.currentReferences is non-empty, treat those refs as explicit current-turn inputs. The final message, claims, or artifact content must reflect that each non-UI ref was actually read/used. Merely echoing it as objectReferences or preserving a file chip is not enough.',
    'If the current refs cannot be read or do not contain enough information to answer, return executionUnits.status="failed-with-reason" with the missing/unreadable refs and a precise nextStep. Do not answer from old session memory, priorAttempts, or broad scenario defaults.',
    'Current-reference digest contract: when uiStateSummary.currentReferenceDigests or contextEnvelope.sessionFacts.currentReferenceDigests exists, use those bounded digests first. Do not run generation-stage shell/browser loops that print full PDFs, long documents, or large logs into context; if more evidence is needed, return taskFiles for a workspace task that reads refs by path and writes bounded artifacts.',
  ];
}

export function agentServerBibliographicVerificationPromptPolicyLines() {
  return [
    'Bibliographic verification contract: never mark a PMID, DOI, trial id, citation, or paper record as corrected/verified unless the returned title, year, journal, and identifier correspond to the same work as the source claim.',
    'If an identifier lookup returns a title mismatch, topic mismatch, unrelated journal, or only a broad review when the source claim is a trial/cohort/paper, preserve the original claim and mark it needs-verification with the mismatch reason and search terms. Do not substitute the unrelated record as a correction.',
    'Plain paper titles, author-year strings, journal names, or citation-looking text are not verified citations by themselves. If no provider/raw/evidence refs or identifier lookup evidence were produced in this run, mark literature records unverified or needs-verification and keep any bibliography in an uncertainty/checklist artifact.',
    'When the user asks not to retrieve, search, browse, or use external providers, do not emit fabricated DOI/PMID/trial ids or verified bibliography. Emit a bounded plan, acceptance criteria, and evidence gaps instead.',
    'For literature artifacts, keep original_title, verified_title, title_match, identifier_match, verification_status, and verification_notes fields when correcting references so SciForge and users can audit the match.',
  ];
}

export interface BibliographicVerificationPromptPolicyGateInput {
  skillDomain?: unknown;
  expectedArtifactTypes?: unknown;
  selectedComponentIds?: unknown;
  selectedCapabilityIds?: unknown;
  selectedCapabilities?: unknown;
  artifacts?: unknown;
  schemas?: unknown;
  verificationPolicies?: unknown;
}

export function agentServerShouldIncludeBibliographicVerificationPromptPolicy(input: BibliographicVerificationPromptPolicyGateInput) {
  return bibliographicVerificationPolicyScopeEnabled(input);
}

export function bibliographicVerificationPolicyScopeEnabled(input: BibliographicVerificationPromptPolicyGateInput) {
  return policyTokenInSet(input.skillDomain, BIBLIOGRAPHIC_SKILL_DOMAIN_SET)
    || policyTokensInSet(input.expectedArtifactTypes, BIBLIOGRAPHIC_ARTIFACT_TYPE_SET)
    || policyTokensInSet(input.selectedComponentIds, BIBLIOGRAPHIC_COMPONENT_ID_SET)
    || policyTokensInSet(input.selectedCapabilityIds, BIBLIOGRAPHIC_CAPABILITY_ID_SET)
    || valueDeclaresBibliographicVerificationPolicy(input.selectedCapabilities, 'capability')
    || valueDeclaresBibliographicVerificationPolicy(input.artifacts, 'artifact')
    || valueDeclaresBibliographicVerificationPolicy(input.schemas, 'schema')
    || valueDeclaresBibliographicVerificationPolicy(input.verificationPolicies, 'policy');
}

export function valueDeclaresBibliographicVerificationPolicy(value: unknown, scope: 'artifact' | 'capability' | 'schema' | 'policy' | 'record' = 'policy'): boolean {
  if (Array.isArray(value)) return value.some((entry) => valueDeclaresBibliographicVerificationPolicy(entry, scope));
  if (!isRecord(value)) {
    if (scope !== 'record' && policyTokenInSet(value, BIBLIOGRAPHIC_POLICY_CONTRACT_SET)) return true;
    return scope === 'artifact'
      ? policyTokenInSet(value, BIBLIOGRAPHIC_ARTIFACT_TYPE_SET)
      : scope === 'capability'
        ? policyTokenInSet(value, BIBLIOGRAPHIC_CAPABILITY_ID_SET)
        : false;
  }

  if (truthyPolicyFlag(value.requiresBibliographicVerification)
    || truthyPolicyFlag(value.bibliographicVerificationRequired)
    || truthyPolicyFlag(value.citationVerificationRequired)) {
    return true;
  }

  const policy = isRecord(value.policy) ? value.policy : undefined;
  if (policy && (
    truthyPolicyFlag(policy.requiresBibliographicVerification)
    || truthyPolicyFlag(policy.bibliographicVerificationRequired)
    || truthyPolicyFlag(policy.citationVerificationRequired)
  )) {
    return true;
  }

  if (policyTokenInSet(value.contractId, BIBLIOGRAPHIC_POLICY_CONTRACT_SET)
    || policyTokenInSet(value.verificationContract, BIBLIOGRAPHIC_POLICY_CONTRACT_SET)
    || policyTokenInSet(value.recordContract, BIBLIOGRAPHIC_POLICY_CONTRACT_SET)
    || policyTokenInSet(value.dataContract, BIBLIOGRAPHIC_POLICY_CONTRACT_SET)) {
    return true;
  }

  if (policyTokensInSet(value.verificationPolicies, BIBLIOGRAPHIC_POLICY_CONTRACT_SET)
    || policyTokensInSet(value.policyContracts, BIBLIOGRAPHIC_POLICY_CONTRACT_SET)) {
    return true;
  }

  if (scope === 'artifact' || scope === 'schema') {
    return policyTokenInSet(value.type, BIBLIOGRAPHIC_ARTIFACT_TYPE_SET)
      || policyTokenInSet(value.artifactType, BIBLIOGRAPHIC_ARTIFACT_TYPE_SET)
      || policyTokenInSet(value.acceptsArtifactType, BIBLIOGRAPHIC_ARTIFACT_TYPE_SET)
      || policyTokensInSet(value.acceptsArtifactTypes, BIBLIOGRAPHIC_ARTIFACT_TYPE_SET)
      || valueDeclaresBibliographicVerificationPolicy(value.metadata, 'policy')
      || valueDeclaresBibliographicVerificationPolicy(value.schema, 'schema');
  }

  if (scope === 'capability') {
    return policyTokenInSet(value.id, BIBLIOGRAPHIC_CAPABILITY_ID_SET)
      || policyTokenInSet(value.capabilityId, BIBLIOGRAPHIC_CAPABILITY_ID_SET)
      || valueDeclaresBibliographicVerificationPolicy(value.metadata, 'policy')
      || valueDeclaresBibliographicVerificationPolicy(value.policy, 'policy');
  }

  if (scope === 'record') {
    return policyTokenInSet(value.recordContract, BIBLIOGRAPHIC_POLICY_CONTRACT_SET)
      || policyTokenInSet(value.schemaVersion, BIBLIOGRAPHIC_POLICY_CONTRACT_SET)
      || policyTokenInSet(value.type, new Set(['bibliographic-record', 'citation-record', 'paper-record']))
      || policyTokenInSet(value.kind, new Set(['bibliographic-record', 'citation-record', 'paper-record']));
  }

  return false;
}

function policyTokensInSet(value: unknown, allowed: Set<string>) {
  return toStringList(value).some((entry) => policyTokenInSet(entry, allowed))
    || (Array.isArray(value) && value.some((entry) => policyTokenInSet(entry, allowed)));
}

function policyTokenInSet(value: unknown, allowed: Set<string>) {
  const token = stringField(value)?.trim().toLowerCase();
  return Boolean(token && allowed.has(token));
}

function truthyPolicyFlag(value: unknown) {
  if (value === true) return true;
  const text = stringField(value)?.trim().toLowerCase();
  return text === 'true' || text === 'required';
}

export function currentReferenceDigestFailureCanRecover(failureReason: string) {
  return /convergence guard|silent stream guard|context window|token/i.test(failureReason);
}

export function currentReferenceDigestRecoveryCandidates(value: unknown, limit = 6): CurrentReferenceDigestRecoveryCandidate[] {
  const digests = Array.isArray(value) ? value : [];
  const candidates: CurrentReferenceDigestRecoveryCandidate[] = [];
  for (const digest of digests) {
    if (!isRecord(digest) || !/^(ok|ready)$/i.test(String(digest.status || ''))) continue;
    const digestRef = typeof digest.digestRef === 'string'
      ? stripFileRef(digest.digestRef)
      : typeof digest.clickableRef === 'string'
        ? stripFileRef(digest.clickableRef)
        : typeof digest.path === 'string'
          ? digest.path
          : '';
    const inlineText = typeof digest.digestText === 'string' && digest.digestText.trim()
      ? digest.digestText
      : undefined;
    if (!digestRef && !inlineText) continue;
    candidates.push({
      sourceRef: String(digest.sourceRef || digestRef || digest.id || 'current-reference'),
      digestRef: digestRef || String(digest.clickableRef || digest.sourceRef || digest.id || 'current-reference'),
      inlineText,
    });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

export function buildCurrentReferenceDigestRecoveryPayload(input: CurrentReferenceDigestRecoveryPayloadRequest) {
  const shortHash = input.shortHash ?? fallbackShortHash;
  const markdown = buildCurrentReferenceDigestRecoveryMarkdown(input);
  const first = firstParagraph(markdown);
  const digestRefs = input.sources.flatMap((source) => [
    {
      id: `source-${shortHash(source.sourceRef)}`,
      kind: 'file',
      title: source.sourceRef.split('/').pop() || source.sourceRef,
      ref: `file:${source.sourceRef}`,
    },
    {
      id: `digest-${shortHash(source.digestRef)}`,
      kind: 'file',
      title: source.digestRef.split('/').pop() || source.digestRef,
      ref: `file:${source.digestRef}`,
    },
  ]);
  return {
    message: first || '已根据本轮引用摘要生成恢复性结果。',
    confidence: 0.68,
    claimType: CURRENT_REFERENCE_DIGEST_RECOVERY_CLAIM_TYPE,
    evidenceLevel: CURRENT_REFERENCE_DIGEST_RECOVERY_EVIDENCE_LEVEL,
    reasoningTrace: [
      'AgentServer generation was stopped by convergence guard.',
      'SciForge recovered from bounded current-reference digests instead of replaying full files into the backend context.',
      `Failure reason: ${input.failureReason}`,
    ].join('\n'),
    claims: [{
      text: first || 'Current-reference digest recovery produced a report from bounded workspace refs.',
      type: 'inference',
      confidence: 0.68,
      evidenceLevel: CURRENT_REFERENCE_DIGEST_RECOVERY_EVIDENCE_LEVEL,
      supportingRefs: input.sources.map((source) => `file:${source.sourceRef}`),
      opposingRefs: [],
    }],
    uiManifest: input.uiManifest,
    executionUnits: [{
      id: `${CURRENT_REFERENCE_DIGEST_RECOVERY_REF_PATH}-${shortHash(markdown)}`,
      status: 'self-healed',
      tool: CURRENT_REFERENCE_DIGEST_RECOVERY_TOOL_ID,
      params: JSON.stringify({
        skillId: input.skillId,
        sourceRefs: input.sources.map((source) => source.sourceRef),
        digestRefs: input.sources.map((source) => source.digestRef),
      }),
      stdoutRef: input.sources[0] ? `file:${input.sources[0].digestRef}` : undefined,
    }],
    artifacts: [{
      id: CURRENT_REFERENCE_DIGEST_RECOVERY_REPORT_ARTIFACT_ID,
      type: CURRENT_REFERENCE_DIGEST_RECOVERY_REPORT_ARTIFACT_TYPE,
      producerScenario: input.skillDomain,
      producer: CURRENT_REFERENCE_DIGEST_RECOVERY_TOOL_ID,
      schemaVersion: '1',
      metadata: {
        source: CURRENT_REFERENCE_DIGEST_RECOVERY_REF_PATH,
        markdownRef: input.sources.find((source) => /\.(md|markdown)$/i.test(source.sourceRef))?.sourceRef,
        sourceRefs: input.sources.map((source) => source.sourceRef),
        digestRefs: input.sources.map((source) => source.digestRef),
        failureReason: input.failureReason,
      },
      data: {
        markdown,
        sections: currentReferenceDigestRecoveryMarkdownSections(markdown),
      },
    }],
    objectReferences: digestRefs,
  };
}

export function buildCurrentReferenceDigestRecoveryMarkdown(input: Pick<CurrentReferenceDigestRecoveryPayloadRequest, 'prompt' | 'failureReason' | 'sources'>) {
  const combined = input.sources.map((source) => `# Source: ${source.sourceRef}\n\n${source.text}`).join('\n\n');
  const executive = extractSection(combined, ['Executive Summary', '摘要', 'Summary']) || firstUsefulLines(combined, 8);
  const stats = extractSection(combined, ['Key Statistics', 'Statistics', '统计']) || summarizeJsonLikeSources(input.sources);
  const topics = extractTopicSections(combined);
  const opportunities = extractSection(combined, ['Opportunities', '机会', 'Future Directions', 'Research Opportunities']) || inferOpportunities(topics);
  const risks = extractSection(combined, ['Risks', 'Limitations', '风险', '局限']) || inferRisks(topics);
  const refs = input.sources.map((source) => `- \`${source.sourceRef}\`（digest: \`${source.digestRef}\`）`).join('\n');
  return [
    '# Current Reference Digest Recovery Report',
    '',
    `用户问题：${input.prompt}`,
    '',
    '## 摘要',
    executive,
    '',
    '## 关键统计',
    stats,
    '',
    '## 方向聚类',
    topics.length ? topics.map((topic) => `### ${topic.title}\n${topic.body}`).join('\n\n') : firstUsefulLines(combined, 12),
    '',
    '## 机会',
    opportunities,
    '',
    '## 风险',
    risks,
    '',
    '## 可审计引用',
    refs,
    '',
    '## 恢复说明',
    `AgentServer 未能在收敛阈值内完成（${input.failureReason}）。本报告使用本轮显式引用的 bounded digest 生成，避免重复全量读取大文件。`,
  ].join('\n');
}

export function currentReferenceDigestRecoveryMarkdownSections(markdown: string) {
  const sections: Array<{ title: string; content: string }> = [];
  const parts = markdown.split(/\n##\s+/);
  for (const part of parts.slice(1)) {
    const [titleLine, ...rest] = part.split('\n');
    const title = titleLine.trim();
    const content = rest.join('\n').trim();
    if (title && content) sections.push({ title, content });
  }
  return sections;
}

function extractSection(text: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`(?:^|\\n)#{1,3}\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n#{1,3}\\s|\\n# Source:|$)`, 'i'));
    if (match?.[1]?.trim()) return clipLines(match[1], 18);
  }
  return '';
}

function extractTopicSections(text: string) {
  const topics: Array<{ title: string; body: string }> = [];
  const pattern = /(?:^|\n)##\s+Topic:\s*([^\n]+)\n([\s\S]*?)(?=\n##\s+Topic:|\n##\s+[A-Z\u4e00-\u9fff]|$)/g;
  for (const match of text.matchAll(pattern)) {
    const title = match[1]?.trim();
    const body = clipLines(match[2] || '', 10);
    if (title && body) topics.push({ title, body });
  }
  return topics.slice(0, 10);
}

function summarizeJsonLikeSources(sources: Array<{ sourceRef: string; text: string }>) {
  const lines: string[] = [];
  for (const source of sources) {
    if (!/\.json$/i.test(source.sourceRef)) continue;
    try {
      const parsed = JSON.parse(source.text);
      const content = isRecord(parsed) && Array.isArray(parsed.content) ? parsed.content : Array.isArray(parsed) ? parsed : undefined;
      if (content) lines.push(`- \`${source.sourceRef}\`: ${content.length} 条记录。`);
    } catch {
      // Digest text may be clipped or normalized; ignore parse failures.
    }
  }
  return lines.join('\n') || '未发现结构化统计字段；请查看下方可审计引用。';
}

function inferOpportunities(topics: Array<{ title: string }>) {
  if (!topics.length) return '可优先围绕高频方向做复现基准、工具链集成、可靠性评估和跨任务迁移验证。';
  return topics.slice(0, 6).map((topic) => `- ${topic.title}: 适合继续追踪可复现 benchmark、真实用户工作流和与现有工具链的集成机会。`).join('\n');
}

function inferRisks(topics: Array<{ title: string }>) {
  if (!topics.length) return '主要风险包括评估不充分、上下文成本过高、工具调用不可复现、以及结论依赖未验证来源。';
  return topics.slice(0, 6).map((topic) => `- ${topic.title}: 需关注评估外推、数据污染、工具调用失败和安全/可靠性边界。`).join('\n');
}

function firstParagraph(text: string) {
  return text.split(/\n{2,}/).map((part) => part.replace(/^#+\s*/, '').trim()).find((part) => part && !part.startsWith('用户问题'))?.slice(0, 400);
}

function firstUsefulLines(text: string, count: number) {
  return clipLines(text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('{') && !line.startsWith('}') && !line.startsWith('"'))
    .slice(0, count)
    .join('\n'), count);
}

function clipLines(text: string, maxLines: number) {
  const lines = text.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim());
  return lines.slice(0, maxLines).join('\n').slice(0, 3600);
}

function stripFileRef(value: string) {
  return value.replace(/^file:/, '');
}

function fallbackShortHash(value: string) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeResearchReportArtifactData(
  artifact: ArtifactPolicyRecord,
  data: Record<string, unknown>,
  reads: ArtifactPolicyReadResults,
) {
  const markdown = stringField(reads.reportMarkdown);
  if (markdown) {
    data.markdown = markdown;
    if (!Array.isArray(data.sections)) data.sections = markdownSections(markdown);
  }
  const inlineMarkdown = artifactMarkdownText({ ...artifact, data })
    ?? (typeof artifact.data === 'string' ? artifact.data : undefined);
  if (inlineMarkdown) {
    data.markdown = inlineMarkdown;
    data.report = stringField(data.report) ?? inlineMarkdown;
    if (!Array.isArray(data.sections)) data.sections = markdownSections(inlineMarkdown);
  }
  const realDataPlanText = stringField(reads.realDataPlan);
  if (realDataPlanText) {
    try {
      data.realDataPlan = JSON.parse(realDataPlanText);
    } catch {
      data.realDataPlan = realDataPlanText;
    }
  }
  return data;
}

function normalizeOmicsDifferentialExpressionArtifactData(
  data: Record<string, unknown>,
  reads: ArtifactPolicyReadResults,
) {
  const markerRows = recordRows(reads.markerRows);
  const qcRows = recordRows(reads.qcRows);
  const compositionRows = recordRows(reads.compositionRows);
  const volcanoRows = recordRows(reads.volcanoRows);
  const umapSvgText = stringField(reads.umapSvgText);
  const heatmapSvgText = stringField(reads.heatmapSvgText);
  if (markerRows.length) data.markers = markerRows;
  if (qcRows.length) data.qc = qcRows;
  if (compositionRows.length) data.composition = compositionRows;
  if (volcanoRows.length) {
    data.volcano = volcanoRows;
    data.points = volcanoRows.map((row, index) => {
      const negLogP = numberFrom(row.negLogP ?? row.neg_log10_pval ?? row.neg_log10_p ?? row.pValue ?? row.pval_adj);
      return {
        gene: String(row.gene || row.label || `Gene${index + 1}`),
        logFC: numberFrom(row.logFC ?? row.log2FC ?? row.logfoldchange) ?? 0,
        negLogP,
        significant: Boolean((negLogP ?? 0) >= 1.3),
        cluster: String(row.cluster || row.cell_type || ''),
      };
    });
  }
  if (umapSvgText) data.umapSvgText = umapSvgText;
  if (heatmapSvgText) data.heatmapSvgText = heatmapSvgText;
  return data;
}

function directContextArtifactSummary(artifact: ArtifactPolicyRecord): string {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const dataSummary = isRecord(artifact.dataSummary) ? artifact.dataSummary : {};
  const digestText = isRecord(dataSummary.digestText) ? dataSummary.digestText : {};
  const candidates = [
    artifact.summary,
    metadata.summary,
    metadata.title,
    directContextDataPreview(artifact.data),
    digestText.preview,
    dataSummary.preview,
    artifact.dataRef,
    artifact.path,
  ];
  return candidates.map(stringField).find(Boolean)
    ?? JSON.stringify(clipJsonForDirectContext(artifact, 2)).slice(0, DIRECT_CONTEXT_FAST_PATH_POLICY.contextLimits.summaryChars);
}

function directContextDigestSummary(digest: ArtifactPolicyRecord): string | undefined {
  const status = String(digest.status || '').toLowerCase();
  const candidates = [
    digest.digestText,
    digest.summary,
    digest.text,
    digest.preview,
    digest.content,
    directContextDigestExcerpts(digest.excerpts),
  ];
  const summary = candidates.map(stringField).find(Boolean);
  if (!summary) return undefined;
  if (
    ['unresolved', 'unreadable', 'failed'].includes(status)
    && /Reference path was not readable inside the workspace|Reference exists but is not a regular file/i.test(summary)
  ) {
    return undefined;
  }
  return summary;
}

function directContextDigestExcerpts(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const text = value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .slice(0, 3)
    .join(' ');
  return text ? text.slice(0, DIRECT_CONTEXT_FAST_PATH_POLICY.contextLimits.summaryChars) : undefined;
}

function directContextDataPreview(value: unknown): string | undefined {
  if (typeof value === 'string') return value.slice(0, DIRECT_CONTEXT_FAST_PATH_POLICY.contextLimits.summaryChars);
  if (!isRecord(value)) return undefined;
  const markdown = stringField(value.markdown)
    ?? stringField(value.report)
    ?? stringField(value.text)
    ?? directContextStructuredSummary(value);
  if (markdown) return markdown.replace(/\s+/g, ' ').slice(0, DIRECT_CONTEXT_FAST_PATH_POLICY.contextLimits.summaryChars);
  const keys = Object.keys(value).slice(0, 8);
  return keys.length ? `fields: ${keys.join(', ')}` : undefined;
}

function directContextStructuredSummary(value: Record<string, unknown>) {
  return uniqueStrings([
    stringField(value.summary),
    ...recordRows(value.keyFindings).map((item) => stringField(item.text) ?? stringField(item.summary)).filter((item): item is string => Boolean(item)),
    ...(Array.isArray(value.keyFindings) ? value.keyFindings.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []),
    stringField(value.conclusion),
    stringField(value.limitations),
  ]).join('\n');
}

function dedupeDirectContextFastPathItems(items: DirectContextFastPathItem[]): DirectContextFastPathItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.ref ?? `${item.kind}:${item.label}:${item.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function artifactMarkdownText(artifact: ArtifactPolicyRecord) {
  const data = isRecord(artifact.data) ? artifact.data : {};
  return stringField(data.markdown)
    ?? stringField(data.report)
    ?? stringField(data.content)
    ?? stringField(artifact.markdown)
    ?? stringField(artifact.report)
    ?? stringField(artifact.content)
    ?? (typeof artifact.data === 'string' ? artifact.data : undefined);
}

function artifactPolicyType(artifact: ArtifactPolicyRecord) {
  return String(artifact.type || artifact.id || '');
}

function markdownSections(markdown: string) {
  const sections: Array<{ title: string; content: string }> = [];
  let current: { title: string; content: string } | undefined;
  for (const line of markdown.split('\n')) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      if (current) sections.push({ ...current, content: current.content.trim() });
      current = { title: heading[1].trim(), content: '' };
      continue;
    }
    if (current) current.content += `${line}\n`;
  }
  if (current) sections.push({ ...current, content: current.content.trim() });
  return sections;
}

function recordRows(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function numberFrom(value: unknown) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function clipJsonForDirectContext(value: unknown, depth: number, seen = new WeakSet<object>()): unknown {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => clipJsonForDirectContext(item, depth - 1, seen));
  }
  if (depth <= 0) return '[Object]';
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).slice(0, 12)) {
    out[key] = clipJsonForDirectContext(child, depth - 1, seen);
  }
  return out;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function toStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}
