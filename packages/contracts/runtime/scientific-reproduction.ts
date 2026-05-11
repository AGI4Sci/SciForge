import type { RuntimeArtifact } from './artifacts';

export const SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION = 'sciforge.scientific-reproduction.v1' as const;

export const SCIENTIFIC_REPRODUCTION_ARTIFACT_TYPES = [
  'paper-claim-graph',
  'figure-to-claim-map',
  'dataset-inventory',
  'analysis-plan',
  'analysis-notebook',
  'figure-reproduction-report',
  'evidence-matrix',
  'claim-verdict',
  'negative-result-report',
  'trajectory-training-record',
  'raw-data-readiness-dossier',
] as const;

export type ScientificReproductionArtifactType = typeof SCIENTIFIC_REPRODUCTION_ARTIFACT_TYPES[number];

export const SCIENTIFIC_REPRODUCTION_CONTRACT_IDS = Object.fromEntries(
  SCIENTIFIC_REPRODUCTION_ARTIFACT_TYPES.map((type) => [
    type,
    `sciforge.scientific-reproduction.${type}.v1`,
  ]),
) as Record<ScientificReproductionArtifactType, `sciforge.scientific-reproduction.${ScientificReproductionArtifactType}.v1`>;

export type ScientificReproductionVerdict =
  | 'reproduced'
  | 'partially-reproduced'
  | 'not-reproduced'
  | 'contradicted'
  | 'insufficient-evidence'
  | 'not-tested';

export type ScientificReproductionRisk =
  | 'data-missing'
  | 'method-incomplete'
  | 'statistics-underspecified'
  | 'external-dependency'
  | 'claim-exceeds-evidence'
  | 'tool-failure'
  | 'license-or-access'
  | 'compute-budget'
  | 'other';

export type ScientificReproductionDatasetAvailability =
  | 'available'
  | 'partially-available'
  | 'unavailable'
  | 'restricted'
  | 'unknown';

export interface ScientificRef {
  ref: string;
  title?: string;
  kind?: string;
  locator?: string;
  summary?: string;
}

export interface ScientificEvidenceRef extends ScientificRef {
  role?: 'source' | 'data' | 'code' | 'stdout' | 'stderr' | 'figure' | 'table' | 'notebook' | 'trace' | 'verifier' | string;
}

export interface ScientificRiskNote {
  risk: ScientificReproductionRisk | string;
  summary: string;
  refs?: ScientificEvidenceRef[];
}

export interface ScientificReproductionArtifactBase {
  schemaVersion: typeof SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION | string;
  artifactType: ScientificReproductionArtifactType;
  sourceRefs: ScientificEvidenceRef[];
  evidenceRefs?: ScientificEvidenceRef[];
  diagnostics?: string[];
  notes?: string[];
}

export interface PaperClaimGraph extends ScientificReproductionArtifactBase {
  artifactType: 'paper-claim-graph';
  paperRefs: ScientificEvidenceRef[];
  claims: Array<{
    id: string;
    text: string;
    kind?: 'main' | 'subclaim' | 'method' | 'result' | 'interpretation' | string;
    parentClaimIds?: string[];
    figureIds?: string[];
    datasetIds?: string[];
    variables?: string[];
    dataTypes?: string[];
    methods?: string[];
    statistics?: string[];
    locatorRefs: ScientificEvidenceRef[];
    risks?: ScientificRiskNote[];
  }>;
  edges?: Array<{
    fromClaimId: string;
    toClaimId: string;
    relation: 'supports' | 'depends-on' | 'qualifies' | 'contradicts' | 'extends' | string;
    refs?: ScientificEvidenceRef[];
  }>;
}

export interface FigureToClaimMap extends ScientificReproductionArtifactBase {
  artifactType: 'figure-to-claim-map';
  figures: Array<{
    id: string;
    label: string;
    locatorRefs: ScientificEvidenceRef[];
    claimIds: string[];
    requiredDatasetIds?: string[];
    requiredAnalysisStepIds?: string[];
    reproductionRisk?: ScientificRiskNote[];
  }>;
}

export interface DatasetInventory extends ScientificReproductionArtifactBase {
  artifactType: 'dataset-inventory';
  identifierVerifications?: Array<{
    id: string;
    kind: 'bibliographic' | 'accession' | string;
    identifier?: string;
    database?: string;
    doi?: string;
    pmid?: string;
    accession?: string;
    title?: string;
    year?: string | number;
    journal?: string;
    verified: boolean;
    status?: 'verified' | 'matched' | 'confirmed' | 'failed' | 'unknown' | string;
    checkedAt?: string;
    evidenceRefs: ScientificEvidenceRef[];
  }>;
  datasets: Array<{
    id: string;
    title: string;
    sourceRefs: ScientificEvidenceRef[];
    availability: ScientificReproductionDatasetAvailability | string;
    dataTypes?: string[];
    samples?: Array<{
      id: string;
      label?: string;
      attributes?: Record<string, string | number | boolean | null>;
      refs?: ScientificEvidenceRef[];
    }>;
    license?: string;
    sizeEstimate?: string;
    accessInstructions?: string;
    missingReason?: string;
  }>;
  missingDatasets?: Array<{
    id: string;
    title: string;
    reason: string;
    sourceRefs: ScientificEvidenceRef[];
    possibleAlternatives?: ScientificEvidenceRef[];
  }>;
}

export interface AnalysisPlan extends ScientificReproductionArtifactBase {
  artifactType: 'analysis-plan';
  objective: string;
  claimIds: string[];
  steps: Array<{
    id: string;
    title: string;
    purpose: string;
    inputRefs: ScientificEvidenceRef[];
    outputRefs?: ScientificEvidenceRef[];
    methodRefs?: ScientificEvidenceRef[];
    expectedArtifacts?: ScientificReproductionArtifactType[];
    verifierRefs?: ScientificEvidenceRef[];
  }>;
  fallbackPolicy?: Array<{
    condition: string;
    action: string;
    refs?: ScientificEvidenceRef[];
  }>;
}

export interface AnalysisNotebook extends ScientificReproductionArtifactBase {
  artifactType: 'analysis-notebook';
  notebookRefs: ScientificEvidenceRef[];
  environmentRefs?: ScientificEvidenceRef[];
  cells?: Array<{
    id: string;
    purpose: string;
    codeRef?: ScientificEvidenceRef;
    outputRefs: ScientificEvidenceRef[];
    status: 'not-run' | 'success' | 'failed' | 'partial' | string;
    diagnostics?: string[];
  }>;
}

export interface FigureReproductionReport extends ScientificReproductionArtifactBase {
  artifactType: 'figure-reproduction-report';
  figureId: string;
  claimIds: string[];
  inputRefs: ScientificEvidenceRef[];
  codeRefs: ScientificEvidenceRef[];
  parameterRefs?: ScientificEvidenceRef[];
  parameters?: Record<string, unknown>;
  outputFigureRefs: ScientificEvidenceRef[];
  statisticsRefs?: ScientificEvidenceRef[];
  stdoutRefs?: ScientificEvidenceRef[];
  stderrRefs?: ScientificEvidenceRef[];
  verdict: ScientificReproductionVerdict | string;
  limitations?: string[];
}

export interface EvidenceMatrix extends ScientificReproductionArtifactBase {
  artifactType: 'evidence-matrix';
  rows: Array<{
    id: string;
    claimId: string;
    evidenceRefs: ScientificEvidenceRef[];
    methodRefs?: ScientificEvidenceRef[];
    dataRefs?: ScientificEvidenceRef[];
    codeRefs?: ScientificEvidenceRef[];
    verifierRefs?: ScientificEvidenceRef[];
    verdict: ScientificReproductionVerdict | string;
    rationale: string;
  }>;
}

export interface ClaimVerdict extends ScientificReproductionArtifactBase {
  artifactType: 'claim-verdict';
  claimId: string;
  verdict: ScientificReproductionVerdict | string;
  rationale: string;
  supportingEvidenceRefs: ScientificEvidenceRef[];
  contradictingEvidenceRefs?: ScientificEvidenceRef[];
  missingEvidence?: Array<{
    summary: string;
    refs?: ScientificEvidenceRef[];
  }>;
}

export interface NegativeResultReport extends ScientificReproductionArtifactBase {
  artifactType: 'negative-result-report';
  claimIds: string[];
  motivation: string;
  checks: Array<{
    id: string;
    question: string;
    inputRefs: ScientificEvidenceRef[];
    codeRefs?: ScientificEvidenceRef[];
    statisticsRefs?: ScientificEvidenceRef[];
    outputRefs: ScientificEvidenceRef[];
    result: ScientificReproductionVerdict | string;
    interpretation: string;
  }>;
  conclusionImpact: string;
}

export interface TrajectoryTrainingRecord extends ScientificReproductionArtifactBase {
  artifactType: 'trajectory-training-record';
  attemptRef: ScientificEvidenceRef;
  events: Array<{
    id: string;
    phase: string;
    action: string;
    observationRefs: ScientificEvidenceRef[];
    promptRef?: ScientificEvidenceRef;
    toolCallRefs?: ScientificEvidenceRef[];
    artifactRefs?: ScientificEvidenceRef[];
    decisionRationale?: string;
    outcome: 'success' | 'failure' | 'partial' | 'negative-result' | 'needs-human' | string;
  }>;
  repairHistoryRefs?: ScientificEvidenceRef[];
  finalArtifactRefs: ScientificEvidenceRef[];
}

export interface RawDataReadinessDossier extends ScientificReproductionArtifactBase {
  artifactType: 'raw-data-readiness-dossier';
  claimIds: string[];
  rawExecutionStatus: 'not-requested' | 'blocked' | 'needs-human' | 'ready' | string;
  approvalStatus: 'not-approved' | 'needs-human' | 'approved' | string;
  datasets: Array<{
    id: string;
    accession: string;
    database: string;
    sourceRefs: ScientificEvidenceRef[];
    dataLevel: 'raw' | 'processed' | 'derived' | string;
    availability: ScientificReproductionDatasetAvailability | string;
    licenseStatus: 'verified' | 'needs-human' | 'restricted' | 'unknown' | string;
    estimatedDownloadBytes: number;
    estimatedStorageBytes?: number;
    checksumRefs?: ScientificEvidenceRef[];
    notes?: string[];
  }>;
  computeBudget: {
    maxDownloadBytes: number;
    maxStorageBytes: number;
    maxCpuHours: number;
    maxMemoryGb: number;
    maxWallHours: number;
    budgetRef: ScientificEvidenceRef;
  };
  environment: {
    toolVersionRefs: ScientificEvidenceRef[];
    environmentLockRefs: ScientificEvidenceRef[];
    genomeCacheRefs: ScientificEvidenceRef[];
    annotationRefs?: ScientificEvidenceRef[];
  };
  readinessChecks: Array<{
    id: string;
    status: 'pass' | 'blocked' | 'needs-human' | 'unknown' | string;
    reason: string;
    evidenceRefs: ScientificEvidenceRef[];
  }>;
  degradationStrategy: string;
  rawExecutionGate: {
    allowed: boolean;
    reason: string;
    requiredBeforeExecution: string[];
    refs: ScientificEvidenceRef[];
  };
  n6Escalation?: {
    requestedFileClasses: string[];
    reanalysisIntent: 'qc-only' | 'alignment' | 'coverage' | 'counts' | 'peak-calling' | 'figure-reproduction' | string;
    minimalRunnablePlanRefs: ScientificEvidenceRef[];
    downsampleOrRegionFixtureRefs?: ScientificEvidenceRef[];
    stopBeforeExecutionUnlessReady: boolean;
  };
  executionAttestations?: Array<{
    id: string;
    status: 'not-run' | 'completed' | 'failed' | 'partial' | string;
    planRefs: ScientificEvidenceRef[];
    executionUnitRefs: ScientificEvidenceRef[];
    codeRefs: ScientificEvidenceRef[];
    stdoutRefs: ScientificEvidenceRef[];
    stderrRefs: ScientificEvidenceRef[];
    outputRefs: ScientificEvidenceRef[];
    observedDownloadBytes: number;
    observedStorageBytes: number;
    checksumVerificationRefs: ScientificEvidenceRef[];
    environmentVerificationRefs: ScientificEvidenceRef[];
    budgetDebitRefs: ScientificEvidenceRef[];
    startedAt?: string;
    completedAt?: string;
  }>;
  n8ExecutionReadiness?: {
    readinessMode: 'offline-fixture-dry-run' | string;
    scope: string[];
    networkPolicy: 'disabled' | 'mock-only' | string;
    downloadedBytes: number;
    fixtureExecutionGate: {
      allowed: boolean;
      reason: string;
      requiredBeforeExecution: string[];
      refs: ScientificEvidenceRef[];
    };
    fixtureInputRefs: ScientificEvidenceRef[];
    commandPlanRefs: ScientificEvidenceRef[];
    environmentProbeRefs: ScientificEvidenceRef[];
    expectedOutputContracts: Array<{
      artifactType: ScientificReproductionArtifactType | string;
      requiredRefFields: string[];
      requiredScalarFields?: string[];
    }>;
    dryRunEvidenceRefs: {
      codeRefs: ScientificEvidenceRef[];
      stdoutRefs: ScientificEvidenceRef[];
      stderrRefs: ScientificEvidenceRef[];
      outputRefs: ScientificEvidenceRef[];
      statisticsRefs?: ScientificEvidenceRef[];
    };
    promotionBlockedUntil: string[];
    stopBeforeLiveDownload: true;
  };
}

export type ScientificReproductionArtifactData =
  | PaperClaimGraph
  | FigureToClaimMap
  | DatasetInventory
  | AnalysisPlan
  | AnalysisNotebook
  | FigureReproductionReport
  | EvidenceMatrix
  | ClaimVerdict
  | NegativeResultReport
  | TrajectoryTrainingRecord
  | RawDataReadinessDossier;

export interface ScientificReproductionValidationIssue {
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface ScientificReproductionValidationResult {
  ok: boolean;
  artifactType?: ScientificReproductionArtifactType;
  issues: ScientificReproductionValidationIssue[];
  repairHints: string[];
}

export const SCIENTIFIC_REPRODUCTION_REPAIR_HINTS = {
  missingRefs: 'Replace inline large content with workspace artifact/file refs and include bounded summaries plus locators.',
  missingSource: 'Attach sourceRefs or locatorRefs that let a verifier trace the claim, dataset, figure, notebook, or action.',
  missingEvidence: 'Represent absent evidence explicitly as missingEvidence, missingDatasets, limitations, or a negative-result-report.',
  shape: 'Emit the artifact data object with schemaVersion, artifactType, sourceRefs, and the required type-specific arrays.',
} as const;

export const scientificReproductionArtifactSchemas = Object.fromEntries(
  SCIENTIFIC_REPRODUCTION_ARTIFACT_TYPES.map((artifactType) => [
    artifactType,
    {
      $id: SCIENTIFIC_REPRODUCTION_CONTRACT_IDS[artifactType],
      type: 'object',
      required: ['schemaVersion', 'artifactType', 'sourceRefs'],
      properties: {
        schemaVersion: { const: SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION },
        artifactType: { const: artifactType },
        sourceRefs: { type: 'array', items: { type: 'object', required: ['ref'] } },
        evidenceRefs: { type: 'array', items: { type: 'object', required: ['ref'] } },
      },
    },
  ]),
) as unknown as Record<ScientificReproductionArtifactType, {
  $id: string;
  type: 'object';
  required: readonly string[];
  properties: Record<string, unknown>;
}>;

const REQUIRED_ARRAYS: Partial<Record<ScientificReproductionArtifactType, string[]>> = {
  'paper-claim-graph': ['paperRefs', 'claims'],
  'figure-to-claim-map': ['figures'],
  'dataset-inventory': ['datasets'],
  'analysis-plan': ['claimIds', 'steps'],
  'analysis-notebook': ['notebookRefs'],
  'figure-reproduction-report': ['claimIds', 'inputRefs', 'codeRefs', 'outputFigureRefs'],
  'evidence-matrix': ['rows'],
  'negative-result-report': ['claimIds', 'checks'],
  'trajectory-training-record': ['events', 'finalArtifactRefs'],
  'raw-data-readiness-dossier': ['claimIds', 'datasets', 'readinessChecks'],
};

const REQUIRED_STRINGS: Partial<Record<ScientificReproductionArtifactType, string[]>> = {
  'analysis-plan': ['objective'],
  'figure-reproduction-report': ['figureId', 'verdict'],
  'claim-verdict': ['claimId', 'verdict', 'rationale'],
  'negative-result-report': ['motivation', 'conclusionImpact'],
  'raw-data-readiness-dossier': ['rawExecutionStatus', 'approvalStatus', 'degradationStrategy'],
};

const REQUIRED_REF_ARRAYS: Partial<Record<ScientificReproductionArtifactType, string[]>> = {
  'paper-claim-graph': ['sourceRefs', 'paperRefs'],
  'figure-to-claim-map': ['sourceRefs'],
  'dataset-inventory': ['sourceRefs'],
  'analysis-plan': ['sourceRefs'],
  'analysis-notebook': ['sourceRefs', 'notebookRefs'],
  'figure-reproduction-report': ['sourceRefs', 'inputRefs', 'codeRefs', 'outputFigureRefs'],
  'evidence-matrix': ['sourceRefs'],
  'claim-verdict': ['sourceRefs', 'supportingEvidenceRefs'],
  'negative-result-report': ['sourceRefs'],
  'trajectory-training-record': ['sourceRefs', 'finalArtifactRefs'],
  'raw-data-readiness-dossier': ['sourceRefs'],
};

const INLINE_LARGE_CONTENT_KEYS = [
  'rawPdf',
  'pdfText',
  'fullText',
  'rawData',
  'base64',
  'imageBytes',
  'notebookJson',
  'stdout',
  'stderr',
  'largeTable',
] as const;

const BOUNDED_TEXT_CONTENT_KEYS = [
  'sourceText',
  'sourceExcerpt',
  'text',
  'table',
  'tableText',
  'summary',
  'notes',
  'diagnostics',
] as const;

const MAX_BOUNDED_INLINE_TEXT_CHARS = 2400;

export function isScientificReproductionArtifactType(value: unknown): value is ScientificReproductionArtifactType {
  return typeof value === 'string' && SCIENTIFIC_REPRODUCTION_ARTIFACT_TYPES.includes(value as ScientificReproductionArtifactType);
}

export function isScientificReproductionArtifact(value: RuntimeArtifact): value is RuntimeArtifact & {
  type: ScientificReproductionArtifactType;
  data: ScientificReproductionArtifactData;
} {
  return isScientificReproductionArtifactType(value.type) && validateScientificReproductionArtifact(value).ok;
}

export function validateScientificReproductionArtifact(value: unknown): ScientificReproductionValidationResult {
  const data = artifactData(value);
  const issues: ScientificReproductionValidationIssue[] = [];
  if (!isRecord(data)) {
    return withHints({ ok: false, issues: [{ path: '$', message: 'Scientific reproduction artifact data must be an object.', expected: 'object', actual: typeOf(data) }] });
  }

  const artifactType = stringField(data.artifactType);
  if (!isScientificReproductionArtifactType(artifactType)) {
    issues.push({
      path: 'artifactType',
      message: `artifactType must be one of: ${SCIENTIFIC_REPRODUCTION_ARTIFACT_TYPES.join(', ')}.`,
      expected: 'scientific reproduction artifact type',
      actual: artifactType ?? typeOf(data.artifactType),
    });
  }
  if (stringField(data.schemaVersion) !== SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION) {
    issues.push({
      path: 'schemaVersion',
      message: `schemaVersion must be ${SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION}.`,
      expected: SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION,
      actual: stringField(data.schemaVersion) ?? typeOf(data.schemaVersion),
    });
  }

  if (isScientificReproductionArtifactType(artifactType)) {
    validateRequiredArrays(data, artifactType, issues);
    validateRequiredStrings(data, artifactType, issues);
    validateRefsFirst(data, artifactType, issues);
    validateTypeSpecificBasics(data, artifactType, issues);
  }

  findInlineLargeContent(data).forEach((path) => {
    issues.push({
      path,
      message: 'Large or raw scientific content must be represented by refs, not embedded inline.',
      expected: 'workspace artifact/file ref with bounded summary',
      actual: 'inline large content field',
    });
  });

  return withHints({
    ok: issues.length === 0,
    artifactType: isScientificReproductionArtifactType(artifactType) ? artifactType : undefined,
    issues,
  });
}

export function validateScientificReproductionRefsFirst(value: unknown): ScientificReproductionValidationResult {
  const data = artifactData(value);
  const issues: ScientificReproductionValidationIssue[] = [];
  if (!isRecord(data)) {
    return withHints({ ok: false, issues: [{ path: '$', message: 'Artifact data must be an object.', expected: 'object', actual: typeOf(data) }] });
  }
  const artifactType = stringField(data.artifactType);
  if (!isScientificReproductionArtifactType(artifactType)) {
    issues.push({ path: 'artifactType', message: 'A known scientific reproduction artifactType is required for refs-first validation.' });
  } else {
    validateRefsFirst(data, artifactType, issues);
  }
  findInlineLargeContent(data).forEach((path) => {
    issues.push({ path, message: 'Large or raw scientific content must be represented by refs, not embedded inline.' });
  });
  return withHints({
    ok: issues.length === 0,
    artifactType: isScientificReproductionArtifactType(artifactType) ? artifactType : undefined,
    issues,
  });
}

function validateRequiredArrays(
  data: Record<string, unknown>,
  artifactType: ScientificReproductionArtifactType,
  issues: ScientificReproductionValidationIssue[],
) {
  for (const field of REQUIRED_ARRAYS[artifactType] ?? []) {
    if (!Array.isArray(data[field])) {
      issues.push({ path: field, message: `${field} must be an array.`, expected: 'array', actual: typeOf(data[field]) });
    }
  }
}

function validateRequiredStrings(
  data: Record<string, unknown>,
  artifactType: ScientificReproductionArtifactType,
  issues: ScientificReproductionValidationIssue[],
) {
  for (const field of REQUIRED_STRINGS[artifactType] ?? []) {
    if (!stringField(data[field])) {
      issues.push({ path: field, message: `${field} must be a non-empty string.`, expected: 'non-empty string', actual: typeOf(data[field]) });
    }
  }
}

function validateRefsFirst(
  data: Record<string, unknown>,
  artifactType: ScientificReproductionArtifactType,
  issues: ScientificReproductionValidationIssue[],
) {
  for (const field of REQUIRED_REF_ARRAYS[artifactType] ?? ['sourceRefs']) {
    validateRefArray(data[field], field, issues, { requireNonEmpty: true });
  }
}

function validateTypeSpecificBasics(
  data: Record<string, unknown>,
  artifactType: ScientificReproductionArtifactType,
  issues: ScientificReproductionValidationIssue[],
) {
  if (artifactType === 'paper-claim-graph') {
    arrayRecords(data.claims).forEach((claim, index) => {
      validateStringAt(claim, 'id', `claims[${index}].id`, issues);
      validateStringAt(claim, 'text', `claims[${index}].text`, issues);
      validateRefArray(claim.locatorRefs, `claims[${index}].locatorRefs`, issues, { requireNonEmpty: true });
    });
  }
  if (artifactType === 'figure-to-claim-map') {
    arrayRecords(data.figures).forEach((figure, index) => {
      validateStringAt(figure, 'id', `figures[${index}].id`, issues);
      validateStringAt(figure, 'label', `figures[${index}].label`, issues);
      validateRefArray(figure.locatorRefs, `figures[${index}].locatorRefs`, issues, { requireNonEmpty: true });
      validateStringArray(figure.claimIds, `figures[${index}].claimIds`, issues, true);
    });
  }
  if (artifactType === 'dataset-inventory') {
    arrayRecords(data.identifierVerifications).forEach((verification, index) => {
      validateIdentifierVerification(verification, `identifierVerifications[${index}]`, issues);
    });
    arrayRecords(data.datasets).forEach((dataset, index) => {
      validateStringAt(dataset, 'id', `datasets[${index}].id`, issues);
      validateStringAt(dataset, 'title', `datasets[${index}].title`, issues);
      validateStringAt(dataset, 'availability', `datasets[${index}].availability`, issues);
      validateRefArray(dataset.sourceRefs, `datasets[${index}].sourceRefs`, issues, { requireNonEmpty: true });
    });
  }
  if (artifactType === 'figure-reproduction-report') {
    const hasParameters = isRecord(data.parameters) && Object.keys(data.parameters).length > 0;
    const hasParameterRefs = Array.isArray(data.parameterRefs) && data.parameterRefs.length > 0;
    if (!hasParameters && !hasParameterRefs) {
      issues.push({
        path: 'parameters',
        message: 'figure-reproduction-report must include bounded parameters or parameterRefs.',
        expected: 'non-empty parameters or ScientificRef[]',
        actual: `${typeOf(data.parameters)} / ${typeOf(data.parameterRefs)}`,
      });
    }
    if (hasParameterRefs) validateRefArray(data.parameterRefs, 'parameterRefs', issues, { requireNonEmpty: true });
    validateRefArray(data.statisticsRefs, 'statisticsRefs', issues, { requireNonEmpty: true });
    const hasStdoutRefs = Array.isArray(data.stdoutRefs) && data.stdoutRefs.length > 0;
    const hasStderrRefs = Array.isArray(data.stderrRefs) && data.stderrRefs.length > 0;
    if (!hasStdoutRefs && !hasStderrRefs) {
      issues.push({
        path: 'stdoutRefs',
        message: 'figure-reproduction-report must include stdoutRefs or stderrRefs.',
        expected: 'stdoutRefs or stderrRefs',
        actual: `${typeOf(data.stdoutRefs)} / ${typeOf(data.stderrRefs)}`,
      });
    }
    if (hasStdoutRefs) validateRefArray(data.stdoutRefs, 'stdoutRefs', issues, { requireNonEmpty: true });
    if (hasStderrRefs) validateRefArray(data.stderrRefs, 'stderrRefs', issues, { requireNonEmpty: true });
  }
  if (artifactType === 'analysis-plan') {
    arrayRecords(data.steps).forEach((step, index) => {
      validateStringAt(step, 'id', `steps[${index}].id`, issues);
      validateStringAt(step, 'title', `steps[${index}].title`, issues);
      validateStringAt(step, 'purpose', `steps[${index}].purpose`, issues);
      validateRefArray(step.inputRefs, `steps[${index}].inputRefs`, issues, { requireNonEmpty: true });
    });
  }
  if (artifactType === 'analysis-notebook') {
    arrayRecords(data.cells).forEach((cell, index) => {
      validateStringAt(cell, 'id', `cells[${index}].id`, issues);
      validateRefArray(cell.outputRefs, `cells[${index}].outputRefs`, issues, { requireNonEmpty: true });
    });
  }
  if (artifactType === 'evidence-matrix') {
    arrayRecords(data.rows).forEach((row, index) => {
      validateStringAt(row, 'claimId', `rows[${index}].claimId`, issues);
      validateStringAt(row, 'verdict', `rows[${index}].verdict`, issues);
      validateStringAt(row, 'rationale', `rows[${index}].rationale`, issues);
      validateRefArray(row.evidenceRefs, `rows[${index}].evidenceRefs`, issues, { requireNonEmpty: true });
    });
  }
  if (artifactType === 'negative-result-report') {
    arrayRecords(data.checks).forEach((check, index) => {
      validateStringAt(check, 'id', `checks[${index}].id`, issues);
      validateStringAt(check, 'question', `checks[${index}].question`, issues);
      validateStringAt(check, 'result', `checks[${index}].result`, issues);
      validateStringAt(check, 'interpretation', `checks[${index}].interpretation`, issues);
      validateRefArray(check.inputRefs, `checks[${index}].inputRefs`, issues, { requireNonEmpty: true });
      validateRefArray(check.codeRefs, `checks[${index}].codeRefs`, issues, { requireNonEmpty: true });
      validateRefArray(check.statisticsRefs, `checks[${index}].statisticsRefs`, issues, { requireNonEmpty: true });
      validateRefArray(check.outputRefs, `checks[${index}].outputRefs`, issues, { requireNonEmpty: true });
    });
  }
  if (artifactType === 'trajectory-training-record') {
    if (!isRef(data.attemptRef)) {
      issues.push({ path: 'attemptRef', message: 'attemptRef must be a ref object with a non-empty ref.' });
    }
    arrayRecords(data.events).forEach((event, index) => {
      validateStringAt(event, 'id', `events[${index}].id`, issues);
      validateStringAt(event, 'phase', `events[${index}].phase`, issues);
      validateStringAt(event, 'action', `events[${index}].action`, issues);
      validateStringAt(event, 'outcome', `events[${index}].outcome`, issues);
      validateRefArray(event.observationRefs, `events[${index}].observationRefs`, issues, { requireNonEmpty: true });
    });
  }
  if (artifactType === 'raw-data-readiness-dossier') {
    arrayRecords(data.datasets).forEach((dataset, index) => {
      validateStringAt(dataset, 'id', `datasets[${index}].id`, issues);
      validateStringAt(dataset, 'accession', `datasets[${index}].accession`, issues);
      validateStringAt(dataset, 'database', `datasets[${index}].database`, issues);
      validateStringAt(dataset, 'dataLevel', `datasets[${index}].dataLevel`, issues);
      validateStringAt(dataset, 'availability', `datasets[${index}].availability`, issues);
      validateStringAt(dataset, 'licenseStatus', `datasets[${index}].licenseStatus`, issues);
      validateFiniteNonNegativeNumber(dataset.estimatedDownloadBytes, `datasets[${index}].estimatedDownloadBytes`, issues);
      if (dataset.estimatedStorageBytes !== undefined) {
        validateFiniteNonNegativeNumber(dataset.estimatedStorageBytes, `datasets[${index}].estimatedStorageBytes`, issues);
      }
      validateRefArray(dataset.sourceRefs, `datasets[${index}].sourceRefs`, issues, { requireNonEmpty: true });
      if (dataset.checksumRefs !== undefined) {
        validateRefArray(dataset.checksumRefs, `datasets[${index}].checksumRefs`, issues, { requireNonEmpty: true });
      }
    });
    validateRawReadinessBudget(data.computeBudget, 'computeBudget', issues);
    validateRawReadinessEnvironment(data.environment, 'environment', issues);
    arrayRecords(data.readinessChecks).forEach((check, index) => {
      validateStringAt(check, 'id', `readinessChecks[${index}].id`, issues);
      validateStringAt(check, 'status', `readinessChecks[${index}].status`, issues);
      validateStringAt(check, 'reason', `readinessChecks[${index}].reason`, issues);
      validateRefArray(check.evidenceRefs, `readinessChecks[${index}].evidenceRefs`, issues, { requireNonEmpty: true });
    });
    validateRawExecutionGate(data.rawExecutionGate, 'rawExecutionGate', issues);
    if (data.n6Escalation !== undefined) {
      validateRawReanalysisEscalation(data.n6Escalation, 'n6Escalation', issues);
    }
    if (data.executionAttestations !== undefined) {
      if (!Array.isArray(data.executionAttestations)) {
        issues.push({ path: 'executionAttestations', message: 'executionAttestations must be an array.', expected: 'raw execution attestation[]', actual: typeOf(data.executionAttestations) });
      } else {
        arrayRecords(data.executionAttestations).forEach((attestation, index) => {
          validateRawExecutionAttestation(attestation, `executionAttestations[${index}]`, issues);
        });
      }
    }
    if (data.n8ExecutionReadiness !== undefined) {
      validateOfflineExecutionReadiness(data.n8ExecutionReadiness, 'n8ExecutionReadiness', issues);
    }
  }
}

function validateOfflineExecutionReadiness(
  value: unknown,
  path: string,
  issues: ScientificReproductionValidationIssue[],
) {
  if (!isRecord(value)) {
    issues.push({ path, message: `${path} must be an object.`, expected: 'offline fixture dry-run readiness metadata', actual: typeOf(value) });
    return;
  }
  validateStringAt(value, 'readinessMode', `${path}.readinessMode`, issues);
  validateStringArray(value.scope, `${path}.scope`, issues, true);
  validateStringAt(value, 'networkPolicy', `${path}.networkPolicy`, issues);
  validateFiniteNonNegativeNumber(value.downloadedBytes, `${path}.downloadedBytes`, issues);
  if (value.downloadedBytes !== 0) {
    issues.push({ path: `${path}.downloadedBytes`, message: `${path}.downloadedBytes must be 0 for offline dry-runs.`, expected: '0', actual: typeOf(value.downloadedBytes) });
  }
  validateRawExecutionGate(value.fixtureExecutionGate, `${path}.fixtureExecutionGate`, issues);
  validateRefArray(value.fixtureInputRefs, `${path}.fixtureInputRefs`, issues, { requireNonEmpty: true });
  validateRefArray(value.commandPlanRefs, `${path}.commandPlanRefs`, issues, { requireNonEmpty: true });
  validateRefArray(value.environmentProbeRefs, `${path}.environmentProbeRefs`, issues, { requireNonEmpty: true });
  arrayRecords(value.expectedOutputContracts).forEach((contract, index) => {
    validateStringAt(contract, 'artifactType', `${path}.expectedOutputContracts[${index}].artifactType`, issues);
    validateStringArray(contract.requiredRefFields, `${path}.expectedOutputContracts[${index}].requiredRefFields`, issues, true);
    if (contract.requiredScalarFields !== undefined) {
      validateStringArray(contract.requiredScalarFields, `${path}.expectedOutputContracts[${index}].requiredScalarFields`, issues, true);
    }
  });
  if (!Array.isArray(value.expectedOutputContracts) || value.expectedOutputContracts.length === 0) {
    issues.push({ path: `${path}.expectedOutputContracts`, message: `${path}.expectedOutputContracts must include at least one output contract.` });
  }
  const evidenceRefs = isRecord(value.dryRunEvidenceRefs) ? value.dryRunEvidenceRefs : {};
  for (const field of ['codeRefs', 'stdoutRefs', 'stderrRefs', 'outputRefs']) {
    validateRefArray(evidenceRefs[field], `${path}.dryRunEvidenceRefs.${field}`, issues, { requireNonEmpty: true });
  }
  if (evidenceRefs.statisticsRefs !== undefined) {
    validateRefArray(evidenceRefs.statisticsRefs, `${path}.dryRunEvidenceRefs.statisticsRefs`, issues, { requireNonEmpty: true });
  }
  validateStringArray(value.promotionBlockedUntil, `${path}.promotionBlockedUntil`, issues, true);
  if (value.stopBeforeLiveDownload !== true) {
    issues.push({ path: `${path}.stopBeforeLiveDownload`, message: `${path}.stopBeforeLiveDownload must be true.`, expected: 'true', actual: typeOf(value.stopBeforeLiveDownload) });
  }
}

function validateRawExecutionAttestation(
  record: Record<string, unknown>,
  path: string,
  issues: ScientificReproductionValidationIssue[],
) {
  validateStringAt(record, 'id', `${path}.id`, issues);
  validateStringAt(record, 'status', `${path}.status`, issues);
  for (const field of ['planRefs', 'executionUnitRefs', 'codeRefs', 'stdoutRefs', 'stderrRefs', 'outputRefs', 'checksumVerificationRefs', 'environmentVerificationRefs', 'budgetDebitRefs']) {
    validateRefArray(record[field], `${path}.${field}`, issues, { requireNonEmpty: true });
  }
  validateFiniteNonNegativeNumber(record.observedDownloadBytes, `${path}.observedDownloadBytes`, issues);
  validateFiniteNonNegativeNumber(record.observedStorageBytes, `${path}.observedStorageBytes`, issues);
  if (record.startedAt !== undefined) validateStringAt(record, 'startedAt', `${path}.startedAt`, issues);
  if (record.completedAt !== undefined) validateStringAt(record, 'completedAt', `${path}.completedAt`, issues);
}

function validateRawReanalysisEscalation(
  value: unknown,
  path: string,
  issues: ScientificReproductionValidationIssue[],
) {
  if (!isRecord(value)) {
    issues.push({ path, message: `${path} must be an object.`, expected: 'raw reanalysis escalation metadata', actual: typeOf(value) });
    return;
  }
  validateStringArray(value.requestedFileClasses, `${path}.requestedFileClasses`, issues, true);
  validateStringAt(value, 'reanalysisIntent', `${path}.reanalysisIntent`, issues);
  validateRefArray(value.minimalRunnablePlanRefs, `${path}.minimalRunnablePlanRefs`, issues, { requireNonEmpty: true });
  if (value.downsampleOrRegionFixtureRefs !== undefined) {
    validateRefArray(value.downsampleOrRegionFixtureRefs, `${path}.downsampleOrRegionFixtureRefs`, issues, { requireNonEmpty: true });
  }
  if (value.stopBeforeExecutionUnlessReady !== true) {
    issues.push({ path: `${path}.stopBeforeExecutionUnlessReady`, message: `${path}.stopBeforeExecutionUnlessReady must be true.`, expected: 'true', actual: typeOf(value.stopBeforeExecutionUnlessReady) });
  }
}

function validateIdentifierVerification(
  record: Record<string, unknown>,
  path: string,
  issues: ScientificReproductionValidationIssue[],
) {
  validateStringAt(record, 'id', `${path}.id`, issues);
  validateStringAt(record, 'kind', `${path}.kind`, issues);
  if (record.verified !== true) {
    issues.push({ path: `${path}.verified`, message: `${path}.verified must be true after explicit identifier verification.`, expected: 'true', actual: typeOf(record.verified) });
  }
  validateStringAt(record, 'status', `${path}.status`, issues);
  validateStringAt(record, 'checkedAt', `${path}.checkedAt`, issues);
  validateRefArray(record.evidenceRefs, `${path}.evidenceRefs`, issues, { requireNonEmpty: true });
  const kind = stringField(record.kind)?.toLowerCase() ?? '';
  if (kind === 'bibliographic') {
    if (!stringField(record.doi) && !stringField(record.pmid)) {
      issues.push({ path: `${path}.doi`, message: 'bibliographic verification must include doi or pmid.', expected: 'doi or pmid' });
    }
    for (const field of ['title', 'year', 'journal']) {
      if (!stringField(record[field]) && typeof record[field] !== 'number') {
        issues.push({ path: `${path}.${field}`, message: `bibliographic verification must include ${field}.`, expected: 'non-empty value', actual: typeOf(record[field]) });
      }
    }
  }
  if (kind === 'accession') {
    validateStringAt(record, 'accession', `${path}.accession`, issues);
    validateStringAt(record, 'database', `${path}.database`, issues);
  }
}

function validateStringAt(
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: ScientificReproductionValidationIssue[],
) {
  if (!stringField(record[field])) {
    issues.push({ path, message: `${path} must be a non-empty string.`, expected: 'non-empty string', actual: typeOf(record[field]) });
  }
}

function validateStringArray(value: unknown, path: string, issues: ScientificReproductionValidationIssue[], requireNonEmpty = false) {
  if (!Array.isArray(value) || (requireNonEmpty && value.length === 0) || value.some((entry) => !stringField(entry))) {
    issues.push({ path, message: `${path} must be an array of non-empty strings.`, expected: 'string[]', actual: typeOf(value) });
  }
}

function validateRefArray(
  value: unknown,
  path: string,
  issues: ScientificReproductionValidationIssue[],
  options: { requireNonEmpty?: boolean } = {},
) {
  if (!Array.isArray(value)) {
    issues.push({ path, message: `${path} must be an array of ref objects.`, expected: 'ScientificRef[]', actual: typeOf(value) });
    return;
  }
  if (options.requireNonEmpty && value.length === 0) {
    issues.push({ path, message: `${path} must include at least one ref.` });
  }
  value.forEach((entry, index) => {
    if (!isRef(entry)) {
      issues.push({ path: `${path}[${index}]`, message: `${path}[${index}] must include a non-empty ref string.`, expected: '{ ref: string }', actual: typeOf(entry) });
    }
  });
}

function validateRawReadinessBudget(
  value: unknown,
  path: string,
  issues: ScientificReproductionValidationIssue[],
) {
  if (!isRecord(value)) {
    issues.push({ path, message: `${path} must be an object.`, expected: 'raw-data compute budget', actual: typeOf(value) });
    return;
  }
  for (const field of ['maxDownloadBytes', 'maxStorageBytes', 'maxCpuHours', 'maxMemoryGb', 'maxWallHours']) {
    validateFiniteNonNegativeNumber(value[field], `${path}.${field}`, issues);
  }
  if (!isRef(value.budgetRef)) {
    issues.push({ path: `${path}.budgetRef`, message: `${path}.budgetRef must be a ref object with a non-empty ref.` });
  }
}

function validateRawReadinessEnvironment(
  value: unknown,
  path: string,
  issues: ScientificReproductionValidationIssue[],
) {
  if (!isRecord(value)) {
    issues.push({ path, message: `${path} must be an object.`, expected: 'raw-data execution environment', actual: typeOf(value) });
    return;
  }
  validateRefArray(value.toolVersionRefs, `${path}.toolVersionRefs`, issues, { requireNonEmpty: true });
  validateRefArray(value.environmentLockRefs, `${path}.environmentLockRefs`, issues, { requireNonEmpty: true });
  validateRefArray(value.genomeCacheRefs, `${path}.genomeCacheRefs`, issues, { requireNonEmpty: true });
  if (value.annotationRefs !== undefined) {
    validateRefArray(value.annotationRefs, `${path}.annotationRefs`, issues, { requireNonEmpty: true });
  }
}

function validateRawExecutionGate(
  value: unknown,
  path: string,
  issues: ScientificReproductionValidationIssue[],
) {
  if (!isRecord(value)) {
    issues.push({ path, message: `${path} must be an object.`, expected: 'raw execution gate', actual: typeOf(value) });
    return;
  }
  if (typeof value.allowed !== 'boolean') {
    issues.push({ path: `${path}.allowed`, message: `${path}.allowed must be boolean.`, expected: 'boolean', actual: typeOf(value.allowed) });
  }
  validateStringAt(value, 'reason', `${path}.reason`, issues);
  validateStringArray(value.requiredBeforeExecution, `${path}.requiredBeforeExecution`, issues, false);
  validateRefArray(value.refs, `${path}.refs`, issues, { requireNonEmpty: true });
}

function validateFiniteNonNegativeNumber(
  value: unknown,
  path: string,
  issues: ScientificReproductionValidationIssue[],
) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    issues.push({ path, message: `${path} must be a finite non-negative number.`, expected: 'number >= 0', actual: typeOf(value) });
  }
}

function findInlineLargeContent(value: unknown, path = '$', depth = 0): string[] {
  if (depth > 8 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findInlineLargeContent(entry, `${path}[${index}]`, depth + 1));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, entry]) => {
    const currentPath = path === '$' ? key : `${path}.${key}`;
    const keyMatch = INLINE_LARGE_CONTENT_KEYS.some((largeKey) => key.toLowerCase() === largeKey.toLowerCase());
    const boundedTextKeyMatch = BOUNDED_TEXT_CONTENT_KEYS.some((largeKey) => key.toLowerCase() === largeKey.toLowerCase());
    const current = keyMatch || inlineTextTooLarge(entry, boundedTextKeyMatch) ? [currentPath] : [];
    return [...current, ...findInlineLargeContent(entry, currentPath, depth + 1)];
  });
}

function inlineTextTooLarge(value: unknown, keyMatch: boolean): boolean {
  if (!keyMatch) return false;
  if (typeof value === 'string') return value.length > MAX_BOUNDED_INLINE_TEXT_CHARS;
  if (Array.isArray(value) || isRecord(value)) return JSON.stringify(value).length > MAX_BOUNDED_INLINE_TEXT_CHARS;
  return false;
}

function withHints(result: Omit<ScientificReproductionValidationResult, 'repairHints'>): ScientificReproductionValidationResult {
  const hintSet = new Set<string>();
  for (const issue of result.issues) {
    if (/ref|inline large/i.test(`${issue.path} ${issue.message}`)) hintSet.add(SCIENTIFIC_REPRODUCTION_REPAIR_HINTS.missingRefs);
    if (/sourceRefs|locatorRefs/i.test(issue.path)) hintSet.add(SCIENTIFIC_REPRODUCTION_REPAIR_HINTS.missingSource);
    if (/missingEvidence|missingDatasets|negative/i.test(issue.path)) hintSet.add(SCIENTIFIC_REPRODUCTION_REPAIR_HINTS.missingEvidence);
    if (/artifactType|schemaVersion|must be an array|non-empty string/i.test(issue.message)) hintSet.add(SCIENTIFIC_REPRODUCTION_REPAIR_HINTS.shape);
  }
  if (result.issues.length > 0 && hintSet.size === 0) hintSet.add(SCIENTIFIC_REPRODUCTION_REPAIR_HINTS.shape);
  return { ...result, repairHints: [...hintSet] };
}

function artifactData(value: unknown): unknown {
  if (isRecord(value) && isScientificReproductionArtifactType(value.type) && value.data !== undefined) return value.data;
  return value;
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRef(value: unknown): value is ScientificEvidenceRef {
  return isRecord(value) && Boolean(stringField(value.ref));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function typeOf(value: unknown) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}
