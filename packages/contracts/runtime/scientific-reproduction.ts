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
  | TrajectoryTrainingRecord;

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
};

const REQUIRED_STRINGS: Partial<Record<ScientificReproductionArtifactType, string[]>> = {
  'analysis-plan': ['objective'],
  'figure-reproduction-report': ['figureId', 'verdict'],
  'claim-verdict': ['claimId', 'verdict', 'rationale'],
  'negative-result-report': ['motivation', 'conclusionImpact'],
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
    arrayRecords(data.datasets).forEach((dataset, index) => {
      validateStringAt(dataset, 'id', `datasets[${index}].id`, issues);
      validateStringAt(dataset, 'title', `datasets[${index}].title`, issues);
      validateStringAt(dataset, 'availability', `datasets[${index}].availability`, issues);
      validateRefArray(dataset.sourceRefs, `datasets[${index}].sourceRefs`, issues, { requireNonEmpty: true });
    });
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

function findInlineLargeContent(value: unknown, path = '$', depth = 0): string[] {
  if (depth > 8 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findInlineLargeContent(entry, `${path}[${index}]`, depth + 1));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, entry]) => {
    const currentPath = path === '$' ? key : `${path}.${key}`;
    const keyMatch = INLINE_LARGE_CONTENT_KEYS.some((largeKey) => key.toLowerCase() === largeKey.toLowerCase());
    const current = keyMatch ? [currentPath] : [];
    return [...current, ...findInlineLargeContent(entry, currentPath, depth + 1)];
  });
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
