export const AGENT_DESKTOP_ALIGNMENT_EVIDENCE_SCHEMA_VERSION = 'sciforge.agent-desktop-alignment-evidence.v1' as const;
export const AGENT_DESKTOP_ALIGNMENT_LIVE_LEDGER_SCHEMA_VERSION = 'sciforge.agent-desktop-alignment-live-ledger.v1' as const;

export type AgentDesktopAlignmentEvidenceSchemaVersion = typeof AGENT_DESKTOP_ALIGNMENT_EVIDENCE_SCHEMA_VERSION;
export type AgentDesktopAlignmentLiveLedgerSchemaVersion = typeof AGENT_DESKTOP_ALIGNMENT_LIVE_LEDGER_SCHEMA_VERSION;

export type AgentDesktopAlignmentChangeKind = 'pull-request' | 'repair-run';
export type AgentDesktopAlignmentSurface = 'sidebar' | 'chat' | 'presentation';
export type AgentDesktopAlignmentEvidenceSide = 'sciforge-browser' | 'cursor-agent-computer-use';
export type AgentDesktopAlignmentEvidenceTool = 'browser' | 'computer-use';
export type AgentDesktopAlignmentEvidenceTarget = 'sciforge-web' | 'cursor-agent-desktop';
export type AgentDesktopAlignmentEvidenceStatus = 'accepted' | 'rejected';
export type AgentDesktopAlignmentCoverageStatus = 'covered' | 'missing-sciforge-browser' | 'missing-cursor-agent-computer-use' | 'missing-both';
export type AgentDesktopAlignmentLiveLedgerStatus = 'active' | 'complete' | 'blocked';
export type AgentDesktopAlignmentLiveRoundStatus = 'planned' | 'observed' | 'fixing' | 'retest-needed' | 'passed' | 'blocked';
export type AgentDesktopAlignmentLiveLoopStepStatus = 'pending' | 'completed' | 'blocked' | 'skipped';
export type AgentDesktopAlignmentRedactionCheckStatus = 'not-run' | 'passed' | 'failed';
export type AgentDesktopAlignmentVerificationStatus = 'not-run' | 'passed' | 'failed' | 'blocked';
export type AgentDesktopAlignmentDifferenceStatus = 'open' | 'fixing' | 'retest-needed' | 'closed' | 'wont-fix';
export type AgentDesktopAlignmentDifferenceDecision = 'fix-generically' | 'defer-with-todo' | 'document-no-code-change' | 'wont-fix';
export type AgentDesktopAlignmentFixArea = 'code' | 'protocol' | 'documentation' | 'test' | 'live-evidence';
export type AgentDesktopAlignmentDifferenceCategory =
  | 'sidebar'
  | 'chat-process'
  | 'right-side-presentation'
  | 'interaction-semantics'
  | 'protocol-boundary'
  | 'redaction'
  | 'test-coverage'
  | 'documentation';
export type AgentDesktopAlignmentLiveLoopStepId =
  | 'observe-sciforge'
  | 'observe-cursor-agent'
  | 'record-differences'
  | 'update-project-todo'
  | 'implement-generic-fix'
  | 'verify'
  | 'retest-both-sides';

export type AgentDesktopAlignmentRequirementId =
  | 'sidebar-new-project-new-chat'
  | 'completed-state-collapsed'
  | 'running-state-live-updates'
  | 'command-expansion'
  | 'edit-diff-expansion'
  | 'file-preview'
  | 'sub-agent-expansion'
  | 'right-side-result-presentation';

export type AgentDesktopAlignmentRequirement = {
  id: AgentDesktopAlignmentRequirementId;
  label: string;
  surface: AgentDesktopAlignmentSurface;
  requiredSides: readonly AgentDesktopAlignmentEvidenceSide[];
};

export const AGENT_DESKTOP_ALIGNMENT_REQUIRED_SIDES = [
  'sciforge-browser',
  'cursor-agent-computer-use',
] as const satisfies readonly AgentDesktopAlignmentEvidenceSide[];

export const AGENT_DESKTOP_ALIGNMENT_REQUIREMENTS = [
  {
    id: 'sidebar-new-project-new-chat',
    label: 'Left sidebar new project and new chat management',
    surface: 'sidebar',
    requiredSides: AGENT_DESKTOP_ALIGNMENT_REQUIRED_SIDES,
  },
  {
    id: 'completed-state-collapsed',
    label: 'Completed process defaults to collapsed state',
    surface: 'chat',
    requiredSides: AGENT_DESKTOP_ALIGNMENT_REQUIRED_SIDES,
  },
  {
    id: 'running-state-live-updates',
    label: 'Running process streams live updates',
    surface: 'chat',
    requiredSides: AGENT_DESKTOP_ALIGNMENT_REQUIRED_SIDES,
  },
  {
    id: 'command-expansion',
    label: 'Command action expands to bounded command and output details',
    surface: 'chat',
    requiredSides: AGENT_DESKTOP_ALIGNMENT_REQUIRED_SIDES,
  },
  {
    id: 'edit-diff-expansion',
    label: 'Edit action expands to bounded diff details',
    surface: 'chat',
    requiredSides: AGENT_DESKTOP_ALIGNMENT_REQUIRED_SIDES,
  },
  {
    id: 'file-preview',
    label: 'File action opens a file preview',
    surface: 'presentation',
    requiredSides: AGENT_DESKTOP_ALIGNMENT_REQUIRED_SIDES,
  },
  {
    id: 'sub-agent-expansion',
    label: 'Sub agent action expands to transcript or result refs',
    surface: 'chat',
    requiredSides: AGENT_DESKTOP_ALIGNMENT_REQUIRED_SIDES,
  },
  {
    id: 'right-side-result-presentation',
    label: 'Right side result presentation shows the final result surface',
    surface: 'presentation',
    requiredSides: AGENT_DESKTOP_ALIGNMENT_REQUIRED_SIDES,
  },
] as const satisfies readonly AgentDesktopAlignmentRequirement[];

export type AgentDesktopAlignmentEvidenceSourceInput = {
  tool: AgentDesktopAlignmentEvidenceTool;
  target: AgentDesktopAlignmentEvidenceTarget;
  ref?: string;
};

export type AgentDesktopAlignmentEvidenceInput = {
  id: string;
  side: AgentDesktopAlignmentEvidenceSide;
  source: AgentDesktopAlignmentEvidenceSourceInput;
  requirementIds: AgentDesktopAlignmentRequirementId[];
  refs: string[];
  summary: string;
  capturedAt?: string;
  details?: Record<string, unknown>;
  privacyScope?: 'task-relevant-redacted' | 'full-private-dialog' | 'unrelated-desktop' | 'raw-provider-secret';
};

export type AgentDesktopAlignmentEvidenceEntry = Omit<AgentDesktopAlignmentEvidenceInput, 'details' | 'privacyScope'> & {
  status: AgentDesktopAlignmentEvidenceStatus;
  details?: unknown;
  policyDiagnostics: string[];
};

export type AgentDesktopAlignmentChangeInput = {
  kind: AgentDesktopAlignmentChangeKind;
  summary: string;
  refs: string[];
  surfaces?: AgentDesktopAlignmentSurface[];
};

export type AgentDesktopAlignmentChange = AgentDesktopAlignmentChangeInput & {
  summary: string;
};

export type AgentDesktopAlignmentEvidenceRecordInput = {
  recordId: string;
  recordedAt?: string;
  change: AgentDesktopAlignmentChangeInput;
  evidence: AgentDesktopAlignmentEvidenceInput[];
};

export type AgentDesktopAlignmentCoverageMatrixRow = {
  requirementId: AgentDesktopAlignmentRequirementId;
  label: string;
  surface: AgentDesktopAlignmentSurface;
  status: AgentDesktopAlignmentCoverageStatus;
  sciforgeBrowserRefs: string[];
  cursorAgentComputerUseRefs: string[];
  missingSides: AgentDesktopAlignmentEvidenceSide[];
};

export type AgentDesktopAlignmentValidationResult = {
  ok: boolean;
  diagnostics: string[];
  missingRequirementIds: AgentDesktopAlignmentRequirementId[];
  rejectedEvidenceIds: string[];
};

export type AgentDesktopAlignmentLiveObservationInput = {
  side: AgentDesktopAlignmentEvidenceSide;
  entryPoint: string;
  refs: string[];
  capturedAt?: string;
  summary?: string;
};

export type AgentDesktopAlignmentLiveObservation = AgentDesktopAlignmentLiveObservationInput & {
  entryPoint: string;
  refs: string[];
  summary?: string;
};

export type AgentDesktopAlignmentLiveLoopStepInput = {
  id: AgentDesktopAlignmentLiveLoopStepId;
  status: AgentDesktopAlignmentLiveLoopStepStatus;
  refs?: string[];
  summary?: string;
};

export type AgentDesktopAlignmentLiveLoopStep = {
  id: AgentDesktopAlignmentLiveLoopStepId;
  status: AgentDesktopAlignmentLiveLoopStepStatus;
  refs: string[];
  summary?: string;
};

export type AgentDesktopAlignmentLiveCoverageInput = {
  surfaces: AgentDesktopAlignmentSurface[];
  requirementIds: AgentDesktopAlignmentRequirementId[];
  summary: string;
};

export type AgentDesktopAlignmentLiveCoverage = {
  surfaces: AgentDesktopAlignmentSurface[];
  requirementIds: AgentDesktopAlignmentRequirementId[];
  summary: string;
};

export type AgentDesktopAlignmentDifferenceInput = {
  id: string;
  category: AgentDesktopAlignmentDifferenceCategory;
  surface: AgentDesktopAlignmentSurface;
  requirementIds: AgentDesktopAlignmentRequirementId[];
  status: AgentDesktopAlignmentDifferenceStatus;
  impactScope: string;
  requires: Partial<Record<AgentDesktopAlignmentFixArea, boolean>>;
  minimumGenericFix: string;
  decision: AgentDesktopAlignmentDifferenceDecision;
  evidenceRefs: string[];
  testRefs: string[];
  retestEvidenceRefs?: string[];
  projectTodoRef?: string;
  summary?: string;
};

export type AgentDesktopAlignmentDifference = Omit<
  AgentDesktopAlignmentDifferenceInput,
  'impactScope' | 'minimumGenericFix' | 'evidenceRefs' | 'testRefs' | 'retestEvidenceRefs' | 'projectTodoRef' | 'summary'
> & {
  id: string;
  impactScope: string;
  minimumGenericFix: string;
  evidenceRefs: string[];
  testRefs: string[];
  retestEvidenceRefs: string[];
  projectTodoRef?: string;
  summary?: string;
  policyDiagnostics: string[];
};

export type AgentDesktopAlignmentLiveDecisionInput = {
  status: 'not-needed' | 'planned' | 'implemented' | 'deferred';
  summary: string;
  refs: string[];
};

export type AgentDesktopAlignmentLiveDecision = {
  status: 'not-needed' | 'planned' | 'implemented' | 'deferred';
  summary: string;
  refs: string[];
};

export type AgentDesktopAlignmentLiveVerificationInput = {
  status: AgentDesktopAlignmentVerificationStatus;
  summary: string;
  refs: string[];
};

export type AgentDesktopAlignmentLiveVerification = AgentDesktopAlignmentLiveVerificationInput;

export type AgentDesktopAlignmentRedactionCheckInput = {
  status: AgentDesktopAlignmentRedactionCheckStatus;
  summary: string;
  refs: string[];
};

export type AgentDesktopAlignmentRedactionCheck = AgentDesktopAlignmentRedactionCheckInput;

export type AgentDesktopAlignmentLiveRoundInput = {
  roundId: string;
  status: AgentDesktopAlignmentLiveRoundStatus;
  startedAt?: string;
  completedAt?: string;
  observationEntryPoints: AgentDesktopAlignmentLiveObservationInput[];
  coverage: AgentDesktopAlignmentLiveCoverageInput;
  steps: AgentDesktopAlignmentLiveLoopStepInput[];
  evidence: AgentDesktopAlignmentEvidenceInput[];
  differences: AgentDesktopAlignmentDifferenceInput[];
  correctionDecision: AgentDesktopAlignmentLiveDecisionInput;
  verification: AgentDesktopAlignmentLiveVerificationInput;
  redactionCheck: AgentDesktopAlignmentRedactionCheckInput;
};

export type AgentDesktopAlignmentLiveRoundEvidenceCoverage = {
  sciforgeBrowserRefs: string[];
  cursorAgentComputerUseRefs: string[];
  missingSides: AgentDesktopAlignmentEvidenceSide[];
  requirementCoverage: AgentDesktopAlignmentLiveRequirementCoverage[];
};

export type AgentDesktopAlignmentLiveRequirementCoverage = {
  requirementId: AgentDesktopAlignmentRequirementId;
  sciforgeBrowserRefs: string[];
  cursorAgentComputerUseRefs: string[];
  missingSides: AgentDesktopAlignmentEvidenceSide[];
};

export type AgentDesktopAlignmentLiveRound = Omit<
  AgentDesktopAlignmentLiveRoundInput,
  'roundId' | 'observationEntryPoints' | 'coverage' | 'steps' | 'evidence' | 'differences' | 'correctionDecision' | 'verification' | 'redactionCheck'
> & {
  roundId: string;
  observationEntryPoints: AgentDesktopAlignmentLiveObservation[];
  coverage: AgentDesktopAlignmentLiveCoverage;
  steps: AgentDesktopAlignmentLiveLoopStep[];
  evidence: AgentDesktopAlignmentEvidenceEntry[];
  evidenceCoverage: AgentDesktopAlignmentLiveRoundEvidenceCoverage;
  differences: AgentDesktopAlignmentDifference[];
  correctionDecision: AgentDesktopAlignmentLiveDecision;
  verification: AgentDesktopAlignmentLiveVerification;
  redactionCheck: AgentDesktopAlignmentRedactionCheck;
  policyDiagnostics: string[];
};

export type AgentDesktopAlignmentMissingLiveEvidence = {
  roundId: string;
  side: AgentDesktopAlignmentEvidenceSide;
  requirementIds: AgentDesktopAlignmentRequirementId[];
};

export type AgentDesktopAlignmentLiveLedgerValidationResult = {
  ok: boolean;
  diagnostics: string[];
  rejectedEvidenceIds: string[];
  openDifferenceIds: string[];
  missingLiveEvidence: AgentDesktopAlignmentMissingLiveEvidence[];
};

export type AgentDesktopAlignmentLiveLedgerInput = {
  ledgerId: string;
  recordedAt?: string;
  status: AgentDesktopAlignmentLiveLedgerStatus;
  rounds: AgentDesktopAlignmentLiveRoundInput[];
};

export type AgentDesktopAlignmentLiveLedger = {
  schemaVersion: AgentDesktopAlignmentLiveLedgerSchemaVersion;
  ledgerId: string;
  recordedAt?: string;
  status: AgentDesktopAlignmentLiveLedgerStatus;
  policy: {
    refsFirst: true;
    redaction: 'required';
    continuousLiveEvidence: true;
    requiredSides: typeof AGENT_DESKTOP_ALIGNMENT_REQUIRED_SIDES;
    requiredLoop: typeof AGENT_DESKTOP_ALIGNMENT_LIVE_LOOP;
    forbiddenContent: readonly string[];
  };
  rounds: AgentDesktopAlignmentLiveRound[];
  validation: AgentDesktopAlignmentLiveLedgerValidationResult;
};

export type AgentDesktopAlignmentEvidenceRecord = {
  schemaVersion: AgentDesktopAlignmentEvidenceSchemaVersion;
  recordId: string;
  recordedAt?: string;
  policy: {
    refsFirst: true;
    redaction: 'required';
    forbiddenContent: readonly string[];
  };
  change: AgentDesktopAlignmentChange;
  evidence: AgentDesktopAlignmentEvidenceEntry[];
  coverageMatrix: AgentDesktopAlignmentCoverageMatrixRow[];
  validation: AgentDesktopAlignmentValidationResult;
};

const requirementById = new Map<AgentDesktopAlignmentRequirementId, AgentDesktopAlignmentRequirement>(
  AGENT_DESKTOP_ALIGNMENT_REQUIREMENTS.map((requirement) => [requirement.id, requirement]),
);

const sourceBySide = {
  'sciforge-browser': { tool: 'browser', target: 'sciforge-web' },
  'cursor-agent-computer-use': { tool: 'computer-use', target: 'cursor-agent-desktop' },
} as const satisfies Record<AgentDesktopAlignmentEvidenceSide, { tool: AgentDesktopAlignmentEvidenceTool; target: AgentDesktopAlignmentEvidenceTarget }>;

const forbiddenContent = [
  'provider URL',
  'provider secret',
  'API key',
  'model name',
  'Authorization header',
  'raw token or credential',
  'local absolute path',
  'full private dialog',
  'unrelated desktop or other-application state',
  'inline screenshot/base64/html/transcript payloads',
] as const;

export const AGENT_DESKTOP_ALIGNMENT_LIVE_LOOP = [
  'observe-sciforge',
  'observe-cursor-agent',
  'record-differences',
  'update-project-todo',
  'implement-generic-fix',
  'verify',
  'retest-both-sides',
] as const satisfies readonly AgentDesktopAlignmentLiveLoopStepId[];

const fatalPrivacyScopes = new Set<NonNullable<AgentDesktopAlignmentEvidenceInput['privacyScope']>>([
  'full-private-dialog',
  'unrelated-desktop',
  'raw-provider-secret',
]);

const fatalKeyPattern = /(?:full|complete|private)[_-]?(?:conversation|dialog|transcript)|raw[_-]?(?:html|dom|transcript|conversation|screenshot|provider|payload)|screenshot[_-]?base64|desktop[_-]?snapshot|all[_-]?windows|clipboard|other[_-]?apps?|unrelated[_-]?desktop/i;
const sensitiveKeyPattern = /(?:authorization|api[-_]?key|apiKey|token|secret|password|credential|provider|model|endpoint|baseUrl|url)/i;
const fatalTextPattern = /\b(?:full private conversation|complete private conversation|full private dialog|raw transcript|raw html|raw dom|unrelated desktop|all windows|other app)\b|完整私密对话|完整私人对话|无关桌面信息/i;

export function createAgentDesktopAlignmentEvidenceRecord(
  input: AgentDesktopAlignmentEvidenceRecordInput,
): AgentDesktopAlignmentEvidenceRecord {
  const change = sanitizeChange(input.change);
  const evidence = input.evidence.map((entry) => normalizeEvidenceEntry(entry));
  const coverageMatrix = buildAgentDesktopAlignmentCoverageMatrix(evidence);
  const validation = validateAgentDesktopAlignmentEvidence({
    change,
    evidence,
    coverageMatrix,
  });
  return {
    schemaVersion: AGENT_DESKTOP_ALIGNMENT_EVIDENCE_SCHEMA_VERSION,
    recordId: sanitizeIdentifier(input.recordId, 'record'),
    recordedAt: input.recordedAt,
    policy: {
      refsFirst: true,
      redaction: 'required',
      forbiddenContent,
    },
    change,
    evidence,
    coverageMatrix,
    validation,
  };
}

export function buildAgentDesktopAlignmentCoverageMatrix(
  evidence: readonly AgentDesktopAlignmentEvidenceEntry[],
): AgentDesktopAlignmentCoverageMatrixRow[] {
  return AGENT_DESKTOP_ALIGNMENT_REQUIREMENTS.map((requirement) => {
    const refsBySide = refsForRequirement(evidence, requirement.id);
    const missingSides = requirement.requiredSides.filter((side) => refsBySide[side].length === 0);
    return {
      requirementId: requirement.id,
      label: requirement.label,
      surface: requirement.surface,
      status: coverageStatus(missingSides),
      sciforgeBrowserRefs: refsBySide['sciforge-browser'],
      cursorAgentComputerUseRefs: refsBySide['cursor-agent-computer-use'],
      missingSides,
    };
  });
}

export function validateAgentDesktopAlignmentEvidenceRecord(
  record: AgentDesktopAlignmentEvidenceRecord,
): AgentDesktopAlignmentValidationResult {
  return validateAgentDesktopAlignmentEvidence(record);
}

export function createAgentDesktopAlignmentLiveLedger(
  input: AgentDesktopAlignmentLiveLedgerInput,
): AgentDesktopAlignmentLiveLedger {
  const rounds = input.rounds.map((round) => normalizeLiveRound(round));
  const validation = validateAgentDesktopAlignmentLiveLedger({ status: input.status, rounds });
  return {
    schemaVersion: AGENT_DESKTOP_ALIGNMENT_LIVE_LEDGER_SCHEMA_VERSION,
    ledgerId: sanitizeIdentifier(input.ledgerId, 'ledger'),
    recordedAt: input.recordedAt,
    status: input.status,
    policy: {
      refsFirst: true,
      redaction: 'required',
      continuousLiveEvidence: true,
      requiredSides: AGENT_DESKTOP_ALIGNMENT_REQUIRED_SIDES,
      requiredLoop: AGENT_DESKTOP_ALIGNMENT_LIVE_LOOP,
      forbiddenContent,
    },
    rounds,
    validation,
  };
}

export function sanitizeAlignmentEvidenceText(value: string, limit = 480): string {
  const redacted = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat|sk|rk|pk|pat|token)[_-][A-Za-z0-9_-]{12,}\b/gi, '[redacted]')
    .replace(
      /\b(api[-_]?key|apiKey|access[-_]?token|auth[-_]?token|token|secret|password|credential|authorization)\b(\s*[:=]\s*["']?)([^"',\s);}\]]+)/gi,
      (_match, label: string, separator: string) => `${label}${separator}[redacted]`,
    )
    .replace(
      /\b(provider|providerUrl|baseUrl|endpoint|model|modelName)\b(\s*[:=]\s*["']?)([^"',\s);}\]]+)/gi,
      (_match, label: string, separator: string) => `${label}${separator}[redacted]`,
    )
    .replace(
      /\b(provider\s+url|model\s+name)\b(\s*[:=]\s*["']?|\s+)([^"',\s);}\]]+)/gi,
      (_match, label: string, separator: string) => `${label}${separator}[redacted]`,
    )
    .replace(/https?:\/\/[^\s"'<>\\)]+/gi, '[redacted-url]')
    .replace(/\/(?:Applications|Users|home|private|var|tmp)\/[^\s"'<>\\)]+/gi, '[redacted-path]')
    .replace(/\b[A-Za-z]:\\Users\\[^\s"'<>]+/gi, '[redacted-path]')
    .replace(/\b[A-Za-z0-9+/]{240,}={0,2}\b/g, '[redacted-long-token]')
    .replace(/\s+/g, ' ')
    .trim();
  if (redacted.length <= limit) return redacted;
  return `${redacted.slice(0, Math.max(0, limit - 15)).replace(/\s+\S*$/, '')} ... [clipped]`;
}

function normalizeLiveRound(input: AgentDesktopAlignmentLiveRoundInput): AgentDesktopAlignmentLiveRound {
  const policyDiagnostics: string[] = [];
  const coverage = normalizeLiveCoverage(input.coverage, input.roundId, policyDiagnostics);
  const evidence = input.evidence.map((entry) => normalizeEvidenceEntry(entry));
  const differences = input.differences.map((difference) => normalizeDifference(difference));
  const observationEntryPoints = input.observationEntryPoints.map((entry) => normalizeLiveObservation(entry));
  const steps = input.steps.map((step) => normalizeLiveLoopStep(step));
  const evidenceCoverage = roundEvidenceCoverage(evidence, coverage.requirementIds);
  return {
    roundId: sanitizeIdentifier(input.roundId, 'round'),
    status: input.status,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    observationEntryPoints,
    coverage,
    steps,
    evidence,
    evidenceCoverage,
    differences,
    correctionDecision: normalizeLiveDecision(input.correctionDecision),
    verification: normalizeLiveVerification(input.verification),
    redactionCheck: normalizeRedactionCheck(input.redactionCheck),
    policyDiagnostics,
  };
}

function normalizeLiveObservation(input: AgentDesktopAlignmentLiveObservationInput): AgentDesktopAlignmentLiveObservation {
  return {
    side: input.side,
    entryPoint: sanitizeAlignmentEvidenceText(input.entryPoint, 180),
    refs: normalizeRefs(input.refs),
    capturedAt: input.capturedAt,
    summary: input.summary ? sanitizeAlignmentEvidenceText(input.summary, 240) : undefined,
  };
}

function normalizeLiveCoverage(
  input: AgentDesktopAlignmentLiveCoverageInput,
  roundId: string,
  diagnostics: string[],
): AgentDesktopAlignmentLiveCoverage {
  const surfaces = unique(input.surfaces.filter(isKnownSurface));
  const requirementIds = normalizeRequirementIds(input.requirementIds, `round ${roundId} coverage`, diagnostics);
  if (!surfaces.length) diagnostics.push(`round ${roundId || '(missing id)'} must cover at least one surface`);
  return {
    surfaces,
    requirementIds,
    summary: sanitizeAlignmentEvidenceText(input.summary, 320),
  };
}

function normalizeLiveLoopStep(input: AgentDesktopAlignmentLiveLoopStepInput): AgentDesktopAlignmentLiveLoopStep {
  return {
    id: input.id,
    status: input.status,
    refs: normalizeOptionalRefs(input.refs ?? []),
    summary: input.summary ? sanitizeAlignmentEvidenceText(input.summary, 240) : undefined,
  };
}

function normalizeDifference(input: AgentDesktopAlignmentDifferenceInput): AgentDesktopAlignmentDifference {
  const policyDiagnostics: string[] = [];
  if (!input.id.trim()) policyDiagnostics.push('difference id is required');
  const requirementIds = normalizeRequirementIds(input.requirementIds, input.id, policyDiagnostics);
  const evidenceRefs = normalizeRefs(input.evidenceRefs, input.id, policyDiagnostics);
  const testRefs = normalizeRefs(input.testRefs, input.id, policyDiagnostics);
  const retestEvidenceRefs = normalizeOptionalRefs(input.retestEvidenceRefs ?? [], input.id, policyDiagnostics);
  const projectTodoRef = normalizeOptionalSingleRef(input.projectTodoRef, `difference ${input.id || '(missing id)'} projectTodoRef`, policyDiagnostics);
  const activeFixAreas = Object.entries(input.requires).filter(([, required]) => required).map(([area]) => area);

  if (!input.impactScope.trim()) policyDiagnostics.push(`difference ${input.id || '(missing id)'} must describe impactScope`);
  if (!input.minimumGenericFix.trim()) policyDiagnostics.push(`difference ${input.id || '(missing id)'} must describe a minimum generic fix`);
  if (!activeFixAreas.length) policyDiagnostics.push(`difference ${input.id || '(missing id)'} must mark at least one required fix area`);
  if ((input.status === 'open' || input.status === 'fixing' || input.status === 'retest-needed') && !projectTodoRef) {
    policyDiagnostics.push(`difference ${input.id || '(missing id)'} must carry a PROJECT.md TODO ref until closed`);
  }
  if (input.status === 'closed' && !retestEvidenceRefs.length) {
    policyDiagnostics.push(`difference ${input.id || '(missing id)'} must carry retest evidence refs before closing`);
  }
  if (fatalTextPattern.test(input.impactScope) || fatalTextPattern.test(input.minimumGenericFix) || fatalTextPattern.test(input.summary ?? '')) {
    policyDiagnostics.push(`difference ${input.id || '(missing id)'} describes prohibited raw or unrelated content`);
  }

  return {
    id: sanitizeIdentifier(input.id, 'difference'),
    category: input.category,
    surface: input.surface,
    requirementIds,
    status: input.status,
    impactScope: sanitizeAlignmentEvidenceText(input.impactScope, 320),
    requires: input.requires,
    minimumGenericFix: sanitizeAlignmentEvidenceText(input.minimumGenericFix, 320),
    decision: input.decision,
    evidenceRefs,
    testRefs,
    retestEvidenceRefs,
    projectTodoRef,
    summary: input.summary ? sanitizeAlignmentEvidenceText(input.summary, 320) : undefined,
    policyDiagnostics,
  };
}

function normalizeLiveDecision(input: AgentDesktopAlignmentLiveDecisionInput): AgentDesktopAlignmentLiveDecision {
  return {
    status: input.status,
    summary: sanitizeAlignmentEvidenceText(input.summary, 320),
    refs: normalizeRefs(input.refs),
  };
}

function normalizeLiveVerification(input: AgentDesktopAlignmentLiveVerificationInput): AgentDesktopAlignmentLiveVerification {
  return {
    status: input.status,
    summary: sanitizeAlignmentEvidenceText(input.summary, 320),
    refs: normalizeRefs(input.refs),
  };
}

function normalizeRedactionCheck(input: AgentDesktopAlignmentRedactionCheckInput): AgentDesktopAlignmentRedactionCheck {
  return {
    status: input.status,
    summary: sanitizeAlignmentEvidenceText(input.summary, 320),
    refs: normalizeRefs(input.refs),
  };
}

function sanitizeChange(input: AgentDesktopAlignmentChangeInput): AgentDesktopAlignmentChange {
  const refs = normalizeRefs(input.refs);
  return {
    kind: input.kind,
    summary: sanitizeAlignmentEvidenceText(input.summary, 320),
    refs,
    surfaces: input.surfaces?.filter(isKnownSurface),
  };
}

function normalizeEvidenceEntry(input: AgentDesktopAlignmentEvidenceInput): AgentDesktopAlignmentEvidenceEntry {
  const policyDiagnostics: string[] = [];
  if (!input.id.trim()) policyDiagnostics.push('evidence id is required');
  if (!sourceMatchesSide(input)) {
    policyDiagnostics.push(`evidence ${input.id || '(missing id)'} source must match ${input.side}`);
  }
  if (input.privacyScope && fatalPrivacyScopes.has(input.privacyScope)) {
    policyDiagnostics.push(`evidence ${input.id || '(missing id)'} contains prohibited ${input.privacyScope} content`);
  }
  if (fatalTextPattern.test(input.summary)) {
    policyDiagnostics.push(`evidence ${input.id || '(missing id)'} summary describes prohibited raw or unrelated content`);
  }

  const requirementIds = normalizeRequirementIds(input.requirementIds, input.id, policyDiagnostics);
  const refs = normalizeRefs(input.refs, input.id, policyDiagnostics);
  const sourceRef = input.source.ref ? normalizeRef(input.source.ref) : undefined;
  if (input.source.ref && !sourceRef) {
    policyDiagnostics.push(`evidence ${input.id || '(missing id)'} source ref is not a refs-first logical ref`);
  }

  const detailDiagnostics = inspectEvidenceDetails(input.details);
  policyDiagnostics.push(...detailDiagnostics);

  const status: AgentDesktopAlignmentEvidenceStatus = policyDiagnostics.length ? 'rejected' : 'accepted';
  const summary = status === 'accepted'
    ? sanitizeAlignmentEvidenceText(input.summary)
    : 'Rejected evidence omitted by privacy policy.';
  return {
    id: sanitizeIdentifier(input.id, 'evidence'),
    side: input.side,
    source: {
      ...input.source,
      ref: sourceRef,
    },
    requirementIds,
    refs,
    summary,
    capturedAt: input.capturedAt,
    details: status === 'accepted' ? sanitizeEvidenceDetails(input.details) : { omitted: 'policy-rejected' },
    status,
    policyDiagnostics,
  };
}

function validateAgentDesktopAlignmentEvidence(input: {
  change: AgentDesktopAlignmentChange;
  evidence: readonly AgentDesktopAlignmentEvidenceEntry[];
  coverageMatrix: readonly AgentDesktopAlignmentCoverageMatrixRow[];
}): AgentDesktopAlignmentValidationResult {
  const diagnostics: string[] = [];
  const missingRequirementIds = input.coverageMatrix
    .filter((row) => row.status !== 'covered')
    .map((row) => row.requirementId);
  const rejectedEvidenceIds = input.evidence
    .filter((entry) => entry.status === 'rejected')
    .map((entry) => entry.id);

  if (!input.change.refs.length) diagnostics.push('change record must carry at least one logical PR or repair-run ref');
  for (const row of input.coverageMatrix) {
    if (row.status === 'covered') continue;
    diagnostics.push(`${row.label} missing ${row.missingSides.join(', ')} evidence`);
  }
  for (const entry of input.evidence) {
    for (const diagnostic of entry.policyDiagnostics) diagnostics.push(diagnostic);
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    missingRequirementIds,
    rejectedEvidenceIds,
  };
}

function validateAgentDesktopAlignmentLiveLedger(input: {
  status: AgentDesktopAlignmentLiveLedgerStatus;
  rounds: readonly AgentDesktopAlignmentLiveRound[];
}): AgentDesktopAlignmentLiveLedgerValidationResult {
  const diagnostics: string[] = [];
  const rejectedEvidenceIds = unique(input.rounds.flatMap((round) => (
    round.evidence.filter((entry) => entry.status === 'rejected').map((entry) => entry.id)
  )));
  const openDifferenceIds = unique(input.rounds.flatMap((round) => (
    round.differences
      .filter((difference) => difference.status !== 'closed' && difference.status !== 'wont-fix')
      .map((difference) => difference.id)
  )));
  const missingLiveEvidence: AgentDesktopAlignmentMissingLiveEvidence[] = [];

  if (!input.rounds.length) diagnostics.push('live ledger must contain at least one comparison round');

  for (const round of input.rounds) {
    diagnostics.push(...round.policyDiagnostics);
    diagnostics.push(...validateLiveRound(round, missingLiveEvidence));
  }

  if (input.status === 'complete') {
    if (openDifferenceIds.length) diagnostics.push(`complete ledger still has open differences: ${openDifferenceIds.join(', ')}`);
    const incompleteRounds = input.rounds.filter((round) => round.status !== 'passed').map((round) => round.roundId);
    if (incompleteRounds.length) diagnostics.push(`complete ledger contains rounds that did not pass: ${incompleteRounds.join(', ')}`);
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    rejectedEvidenceIds,
    openDifferenceIds,
    missingLiveEvidence,
  };
}

function validateLiveRound(
  round: AgentDesktopAlignmentLiveRound,
  missingLiveEvidence: AgentDesktopAlignmentMissingLiveEvidence[],
): string[] {
  const diagnostics: string[] = [];
  for (const side of AGENT_DESKTOP_ALIGNMENT_REQUIRED_SIDES) {
    const observation = round.observationEntryPoints.find((entry) => entry.side === side);
    if (!observation) {
      diagnostics.push(`round ${round.roundId} missing ${side} observation entry point`);
    } else if (!observation.refs.length) {
      diagnostics.push(`round ${round.roundId} ${side} observation entry point must carry refs`);
    }
    const missingRequirementIds = round.evidenceCoverage.requirementCoverage
      .filter((coverage) => coverage.missingSides.includes(side))
      .map((coverage) => coverage.requirementId);
    if (missingRequirementIds.length) {
      missingLiveEvidence.push({
        roundId: round.roundId,
        side,
        requirementIds: missingRequirementIds,
      });
      diagnostics.push(`round ${round.roundId} missing accepted ${side} live evidence for requirements: ${missingRequirementIds.join(', ')}`);
    }
  }

  if (!round.coverage.surfaces.length) diagnostics.push(`round ${round.roundId} must list covered surfaces`);
  if (!round.coverage.requirementIds.length) diagnostics.push(`round ${round.roundId} must list covered requirements`);
  diagnostics.push(...validateLiveLoop(round));

  for (const entry of round.evidence) {
    for (const diagnostic of entry.policyDiagnostics) diagnostics.push(diagnostic);
  }
  for (const difference of round.differences) {
    for (const diagnostic of difference.policyDiagnostics) diagnostics.push(diagnostic);
  }

  if (!round.correctionDecision.refs.length) diagnostics.push(`round ${round.roundId} correction decision must carry refs`);
  if (round.verification.status !== 'not-run' && !round.verification.refs.length) {
    diagnostics.push(`round ${round.roundId} verification must carry refs when it has run`);
  }
  if (round.redactionCheck.status !== 'passed') {
    diagnostics.push(`round ${round.roundId} redaction check must pass before the round can be accepted`);
  }
  if (!round.redactionCheck.refs.length) diagnostics.push(`round ${round.roundId} redaction check must carry refs`);
  if (round.status === 'passed' && round.evidenceCoverage.requirementCoverage.some((coverage) => coverage.missingSides.length > 0)) {
    diagnostics.push(`round ${round.roundId} cannot be passed while live evidence is missing`);
  }
  if (round.status === 'passed' && round.verification.status !== 'passed') {
    diagnostics.push(`round ${round.roundId} cannot be passed until verification has passed`);
  }
  return diagnostics;
}

function validateLiveLoop(round: AgentDesktopAlignmentLiveRound): string[] {
  const diagnostics: string[] = [];
  const stepIds = round.steps.map((step) => step.id);
  for (const requiredStep of AGENT_DESKTOP_ALIGNMENT_LIVE_LOOP) {
    if (!stepIds.includes(requiredStep)) diagnostics.push(`round ${round.roundId} missing live loop step ${requiredStep}`);
  }
  const expectedPrefix = AGENT_DESKTOP_ALIGNMENT_LIVE_LOOP.slice(0, stepIds.length);
  const outOfOrder = stepIds.some((id, index) => id !== expectedPrefix[index]);
  if (outOfOrder) diagnostics.push(`round ${round.roundId} live loop steps are out of order`);
  for (const step of round.steps) {
    if ((step.status === 'completed' || step.status === 'blocked') && !step.refs.length) {
      diagnostics.push(`round ${round.roundId} step ${step.id} must carry refs when ${step.status}`);
    }
  }
  return diagnostics;
}

function refsForRequirement(
  evidence: readonly AgentDesktopAlignmentEvidenceEntry[],
  requirementId: AgentDesktopAlignmentRequirementId,
): Record<AgentDesktopAlignmentEvidenceSide, string[]> {
  const refsBySide: Record<AgentDesktopAlignmentEvidenceSide, string[]> = {
    'sciforge-browser': [],
    'cursor-agent-computer-use': [],
  };
  for (const entry of evidence) {
    if (entry.status !== 'accepted' || !entry.requirementIds.includes(requirementId)) continue;
    refsBySide[entry.side].push(...entry.refs);
  }
  return {
    'sciforge-browser': unique(refsBySide['sciforge-browser']),
    'cursor-agent-computer-use': unique(refsBySide['cursor-agent-computer-use']),
  };
}

function roundEvidenceCoverage(
  evidence: readonly AgentDesktopAlignmentEvidenceEntry[],
  requirementIds: readonly AgentDesktopAlignmentRequirementId[],
): AgentDesktopAlignmentLiveRoundEvidenceCoverage {
  const refsBySide: Record<AgentDesktopAlignmentEvidenceSide, string[]> = {
    'sciforge-browser': [],
    'cursor-agent-computer-use': [],
  };
  for (const entry of evidence) {
    if (entry.status !== 'accepted') continue;
    refsBySide[entry.side].push(...entry.refs);
  }
  const sciforgeBrowserRefs = unique(refsBySide['sciforge-browser']);
  const cursorAgentComputerUseRefs = unique(refsBySide['cursor-agent-computer-use']);
  return {
    sciforgeBrowserRefs,
    cursorAgentComputerUseRefs,
    missingSides: AGENT_DESKTOP_ALIGNMENT_REQUIRED_SIDES.filter((side) => refsBySide[side].length === 0),
    requirementCoverage: requirementIds.map((requirementId) => {
      const refsByRequirementSide = refsForRequirement(evidence, requirementId);
      const missingSides = AGENT_DESKTOP_ALIGNMENT_REQUIRED_SIDES.filter((side) => refsByRequirementSide[side].length === 0);
      return {
        requirementId,
        sciforgeBrowserRefs: refsByRequirementSide['sciforge-browser'],
        cursorAgentComputerUseRefs: refsByRequirementSide['cursor-agent-computer-use'],
        missingSides,
      };
    }),
  };
}

function coverageStatus(missingSides: readonly AgentDesktopAlignmentEvidenceSide[]): AgentDesktopAlignmentCoverageStatus {
  if (missingSides.length === 0) return 'covered';
  if (missingSides.length === 2) return 'missing-both';
  return missingSides[0] === 'sciforge-browser' ? 'missing-sciforge-browser' : 'missing-cursor-agent-computer-use';
}

function sourceMatchesSide(input: AgentDesktopAlignmentEvidenceInput) {
  const expected = sourceBySide[input.side];
  return input.source.tool === expected.tool && input.source.target === expected.target;
}

function normalizeRequirementIds(
  ids: readonly AgentDesktopAlignmentRequirementId[],
  evidenceId: string,
  diagnostics: string[],
) {
  const normalized = unique(ids.filter((id): id is AgentDesktopAlignmentRequirementId => requirementById.has(id)));
  if (!normalized.length) diagnostics.push(`evidence ${evidenceId || '(missing id)'} must map to at least one alignment requirement`);
  const unknown = ids.filter((id) => !requirementById.has(id));
  if (unknown.length) diagnostics.push(`evidence ${evidenceId || '(missing id)'} has unknown requirement ids: ${unknown.join(', ')}`);
  return normalized;
}

function normalizeRefs(refs: readonly string[], evidenceId?: string, diagnostics: string[] = []) {
  const normalized: string[] = [];
  for (const ref of refs) {
    const value = normalizeRef(ref);
    if (value) {
      normalized.push(value);
    } else {
      diagnostics.push(`${evidenceId ? `evidence ${evidenceId}` : 'change record'} contains a non-logical or sensitive ref`);
    }
  }
  if (!normalized.length) {
    diagnostics.push(`${evidenceId ? `evidence ${evidenceId}` : 'change record'} must carry at least one logical ref`);
  }
  return unique(normalized);
}

function normalizeOptionalRefs(refs: readonly string[], evidenceId?: string, diagnostics: string[] = []) {
  const normalized: string[] = [];
  for (const ref of refs) {
    const value = normalizeRef(ref);
    if (value) {
      normalized.push(value);
    } else {
      diagnostics.push(`${evidenceId ? `evidence ${evidenceId}` : 'record'} contains a non-logical or sensitive ref`);
    }
  }
  return unique(normalized);
}

function normalizeOptionalSingleRef(ref: string | undefined, label: string, diagnostics: string[]) {
  if (!ref) return undefined;
  const value = normalizeRef(ref);
  if (!value) diagnostics.push(`${label} is not a refs-first logical ref`);
  return value;
}

function normalizeRef(ref: string) {
  const value = ref.trim();
  if (!value) return undefined;
  if (/[\r\n]/.test(value)) return undefined;
  if (/^(?:https?:|data:|file:)/i.test(value)) return undefined;
  if (/\/(?:Applications|Users|home|private|var|tmp)\//i.test(value)) return undefined;
  if (/\b(?:authorization|bearer|api[-_]?key|token|secret|password|credential)=?/i.test(value)) return undefined;
  if (/^[a-z][a-z0-9+.-]*:[^\s]+$/i.test(value)) return value;
  if (/^(?:\.sciforge|docs\/test-artifacts)\/[^\s]+$/i.test(value)) return value;
  if (isSafeRepositoryRef(value)) return value;
  return undefined;
}

function isSafeRepositoryRef(value: string) {
  if (value.includes('..')) return false;
  return /^(?:PROJECT\.md|docs\/agent-desktop-alignment-evidence\/[^\s]+|src\/[^\s]+|packages\/[^\s]+)$/.test(value);
}

function inspectEvidenceDetails(value: unknown, path = 'details'): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') {
    return fatalTextPattern.test(value) ? [`${path} contains prohibited raw or unrelated content`] : [];
  }
  if (typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => inspectEvidenceDetails(entry, `${path}[${index}]`));
  }
  const diagnostics: string[] = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (fatalKeyPattern.test(key)) {
      diagnostics.push(`${childPath} must be stored as a redacted logical ref, not inline evidence`);
      continue;
    }
    diagnostics.push(...inspectEvidenceDetails(entry, childPath));
  }
  return diagnostics;
}

function sanitizeEvidenceDetails(value: unknown, key = '', depth = 0): unknown {
  if (value === undefined || value === null) return value;
  if (depth > 5) return { omitted: 'max-depth' };
  if (typeof value === 'string') return sanitizeAlignmentEvidenceText(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 40).map((entry) => sanitizeEvidenceDetails(entry, key, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [childKey, entry] of Object.entries(value as Record<string, unknown>)) {
    if (fatalKeyPattern.test(childKey)) {
      out[childKey] = { omitted: 'inline-evidence-forbidden' };
    } else if (sensitiveKeyPattern.test(childKey)) {
      out[childKey] = '[redacted]';
    } else {
      out[childKey] = sanitizeEvidenceDetails(entry, childKey, depth + 1);
    }
  }
  return out;
}

function sanitizeIdentifier(value: string, fallbackPrefix: string) {
  const normalized = value.trim().replace(/[^a-z0-9_.:-]+/gi, '-').replace(/^-+|-+$/g, '');
  return normalized || `${fallbackPrefix}:missing`;
}

function isKnownSurface(value: AgentDesktopAlignmentSurface): value is AgentDesktopAlignmentSurface {
  return value === 'sidebar' || value === 'chat' || value === 'presentation';
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}
