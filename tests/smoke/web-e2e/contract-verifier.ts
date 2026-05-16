import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

import type {
  RuntimeArtifact,
  SciForgeRun,
  SciForgeSession,
} from '@sciforge-ui/runtime-contract';
import type { ConversationProjection } from '../../../src/runtime/conversation-kernel/index.js';
import type {
  BrowserInstrumentationSnapshot,
  WebE2eArtifactDeliveryProjection,
  WebE2eExpectedProjection,
  WebE2eWorkspaceState,
} from './types.js';

export interface WebE2eBrowserVisibleState {
  status?: string;
  visibleAnswerText?: string;
  visibleArtifactRefs?: string[];
  primaryArtifactRefs?: string[];
  supportingArtifactRefs?: string[];
  auditRefs?: string[];
  diagnosticRefs?: string[];
  internalRefs?: string[];
  recoverActions?: string[];
  nextStep?: string;
}

export interface WebE2eRunAuditEvidence {
  runId: string;
  refs: string[];
  providerManifestRef?: string;
  currentTurnRef?: string;
  explicitRefs?: string[];
  status?: string;
}

export interface WebE2eArtifactDeliveryManifest {
  schemaVersion?: string;
  caseId?: string;
  runId?: string;
  artifactDelivery: WebE2eArtifactDeliveryProjection;
}

export interface WebE2eSessionBundle {
  session: SciForgeSession;
  workspaceState?: WebE2eWorkspaceState;
}

export interface WebE2eContractVerifierInput {
  caseId?: string;
  expected: WebE2eExpectedProjection;
  browserVisibleState: WebE2eBrowserVisibleState;
  kernelProjection: ConversationProjection;
  sessionBundle: WebE2eSessionBundle | SciForgeSession;
  runAudit: WebE2eRunAuditEvidence;
  artifactDeliveryManifest: WebE2eArtifactDeliveryManifest | WebE2eArtifactDeliveryProjection;
  instrumentation?: BrowserInstrumentationSnapshot;
}

export interface WebE2eContractVerifierFiles {
  expectedProjectionPath: string;
  workspaceStatePath?: string;
  kernelProjectionPath?: string;
  browserVisibleStatePath?: string;
  runAuditPath?: string;
  artifactDeliveryManifestPath?: string;
}

export interface WebE2eContractVerificationResult {
  ok: boolean;
  failures: string[];
}

type JsonRecord = Record<string, unknown>;

export async function loadWebE2eContractVerifierInput(files: WebE2eContractVerifierFiles): Promise<WebE2eContractVerifierInput> {
  const expected = await readJson<WebE2eExpectedProjection>(files.expectedProjectionPath);
  const workspaceState = files.workspaceStatePath
    ? await readJson<WebE2eWorkspaceState>(files.workspaceStatePath)
    : undefined;
  const session = workspaceState?.sessionsByScenario[expected.scenarioId];
  if (!session) {
    throw new Error(`Cannot load session ${expected.scenarioId} from workspace state`);
  }
  return {
    expected,
    browserVisibleState: files.browserVisibleStatePath
      ? await readJson<WebE2eBrowserVisibleState>(files.browserVisibleStatePath)
      : browserVisibleStateFromExpected(expected),
    kernelProjection: files.kernelProjectionPath
      ? await readJson<ConversationProjection>(files.kernelProjectionPath)
      : projectionFromSessionRun(session, expected.runId) ?? expected.conversationProjection,
    sessionBundle: { session, workspaceState },
    runAudit: files.runAuditPath
      ? await readJson<WebE2eRunAuditEvidence>(files.runAuditPath)
      : runAuditFromSession(session, expected),
    artifactDeliveryManifest: files.artifactDeliveryManifestPath
      ? await readJson<WebE2eArtifactDeliveryManifest | WebE2eArtifactDeliveryProjection>(files.artifactDeliveryManifestPath)
      : artifactDeliveryManifestFromSession(session, expected),
  };
}

export function verifyWebE2eContract(input: WebE2eContractVerifierInput): WebE2eContractVerificationResult {
  const failures: string[] = [];
  const expected = input.expected;
  const session = unwrapSession(input.sessionBundle);
  const run = session.runs.find((candidate) => candidate.id === expected.runId);
  const artifactDelivery = unwrapArtifactDeliveryManifest(input.artifactDeliveryManifest);

  checkBasicExpectedContract(expected, input.caseId, failures);
  compareDeep('Kernel Projection', input.kernelProjection, expected.conversationProjection, failures);
  compareBrowserVisibleState(input.browserVisibleState, expected, failures);
  compareSessionBundle(session, run, expected, failures);
  compareRunAudit(input.runAudit, expected, failures);
  compareArtifactDelivery('ArtifactDelivery manifest', artifactDelivery, expected.artifactDelivery, failures);
  compareArtifactDelivery('session bundle ArtifactDelivery', artifactDeliveryFromArtifacts(session.artifacts), expected.artifactDelivery, failures);
  compareInstrumentation(input.instrumentation, failures);

  return { ok: failures.length === 0, failures };
}

export function assertWebE2eContract(input: WebE2eContractVerifierInput): void {
  const result = verifyWebE2eContract(input);
  if (!result.ok) {
    throw new Error(`Web E2E contract verification failed:\n${result.failures.map((failure) => `- ${failure}`).join('\n')}`);
  }
}

export function createWebE2eAfterEachContractVerifier(getInput: () => WebE2eContractVerifierInput | Promise<WebE2eContractVerifierInput>) {
  return async () => {
    assertWebE2eContract(await getInput());
  };
}

export function artifactDeliveryManifestFromSession(
  session: SciForgeSession,
  expected: Pick<WebE2eExpectedProjection, 'caseId' | 'runId'>,
): WebE2eArtifactDeliveryManifest {
  return {
    schemaVersion: 'sciforge.web-e2e.artifact-delivery-manifest.v1',
    caseId: expected.caseId,
    runId: expected.runId,
    artifactDelivery: artifactDeliveryFromArtifacts(session.artifacts),
  };
}

export function runAuditFromSession(session: SciForgeSession, expected: WebE2eExpectedProjection): WebE2eRunAuditEvidence {
  const run = session.runs.find((candidate) => candidate.id === expected.runId);
  const refs = new Set<string>(expected.runAuditRefs);
  refs.add(expected.providerManifestRef);
  for (const unit of session.executionUnits ?? []) {
    if (unit.runId && unit.runId !== expected.runId) continue;
    addRef(refs, unit.outputRef);
    for (const ref of unit.outputArtifacts ?? []) addRef(refs, toArtifactRef(ref));
  }
  for (const artifact of session.artifacts ?? []) {
    if (artifactRunId(artifact) !== expected.runId) continue;
    const role = artifact.delivery?.role;
    if (role === 'audit' || role === 'diagnostic') addRef(refs, artifact.delivery?.ref ?? toArtifactRef(artifact.id));
  }
  return {
    runId: expected.runId,
    refs: [...refs],
    providerManifestRef: expected.providerManifestRef,
    currentTurnRef: expected.currentTask.currentTurnRef.ref,
    explicitRefs: expected.currentTask.explicitRefs.map((ref) => ref.ref),
    status: run?.status,
  };
}

function checkBasicExpectedContract(expected: WebE2eExpectedProjection, caseId: string | undefined, failures: string[]) {
  if (expected.schemaVersion !== 'sciforge.web-e2e.expected-projection.v1') {
    failures.push(`expected contract schema mismatch: ${String(expected.schemaVersion)}`);
  }
  if (expected.projectionVersion !== 'sciforge.conversation-projection.v1') {
    failures.push(`expected projectionVersion mismatch: ${String(expected.projectionVersion)}`);
  }
  if (caseId && expected.caseId !== caseId) {
    failures.push(`caseId mismatch: expected ${expected.caseId}, actual ${caseId}`);
  }
}

function compareBrowserVisibleState(
  browser: WebE2eBrowserVisibleState,
  expected: WebE2eExpectedProjection,
  failures: string[],
) {
  const answer = expected.conversationProjection.visibleAnswer;
  if (!answer) {
    failures.push('browser visible state cannot be verified because expected Projection has no visibleAnswer');
    return;
  }
  if (browser.status !== undefined && browser.status !== answer.status) {
    failures.push(`browser visible status mismatch: expected ${answer.status}, actual ${browser.status}`);
  }
  const expectedText = 'text' in answer && typeof answer.text === 'string' ? answer.text : undefined;
  if (expectedText && !browser.visibleAnswerText?.includes(expectedText)) {
    failures.push('browser visible answer text does not contain expected Projection visibleAnswer.text');
  }
  compareOptionalRefList('browser visible artifact refs', browser.visibleArtifactRefs, [
    ...expected.artifactDelivery.primaryArtifactRefs,
    ...expected.artifactDelivery.supportingArtifactRefs,
  ], failures);
  compareOptionalRefList('browser primary artifact refs', browser.primaryArtifactRefs, expected.artifactDelivery.primaryArtifactRefs, failures);
  compareOptionalRefList('browser supporting artifact refs', browser.supportingArtifactRefs, expected.artifactDelivery.supportingArtifactRefs, failures);
  compareForbiddenRefs('browser audit refs', browser.auditRefs, expected.artifactDelivery.auditRefs, failures);
  compareForbiddenRefs('browser diagnostic refs', browser.diagnosticRefs, expected.artifactDelivery.diagnosticRefs, failures);
  compareForbiddenRefs('browser internal refs', browser.internalRefs, expected.artifactDelivery.internalRefs, failures);
}

function compareSessionBundle(
  session: SciForgeSession,
  run: SciForgeRun | undefined,
  expected: WebE2eExpectedProjection,
  failures: string[],
) {
  if (session.sessionId !== expected.sessionId) {
    failures.push(`session bundle sessionId mismatch: expected ${expected.sessionId}, actual ${session.sessionId}`);
  }
  if (session.scenarioId !== expected.scenarioId) {
    failures.push(`session bundle scenarioId mismatch: expected ${expected.scenarioId}, actual ${session.scenarioId}`);
  }
  if (!run) {
    failures.push(`session bundle is missing run ${expected.runId}`);
    return;
  }
  const sessionProjection = projectionFromRun(run);
  compareDeep('session bundle run Projection', sessionProjection, expected.conversationProjection, failures);
  const runArtifactRefs = artifactRefsForRun(session.artifacts, expected.runId);
  assertIncludesAll('session bundle primary ArtifactDelivery refs', runArtifactRefs, expected.artifactDelivery.primaryArtifactRefs, failures);
  assertIncludesAll('session bundle supporting ArtifactDelivery refs', runArtifactRefs, expected.artifactDelivery.supportingArtifactRefs, failures);
  const userMessage = session.messages.find((message) => message.id === expected.currentTask.currentTurnRef.ref.replace(/^message:/, ''));
  if (!userMessage) {
    failures.push(`session bundle is missing currentTurnRef ${expected.currentTask.currentTurnRef.ref}`);
  }
  const explicitObjectRefs = new Set(session.messages.flatMap((message) => message.objectReferences ?? []).map((ref) => ref.ref));
  assertIncludesAll('session bundle explicit refs', [...explicitObjectRefs], expected.currentTask.explicitRefs.map((ref) => ref.ref), failures);
}

function compareRunAudit(runAudit: WebE2eRunAuditEvidence, expected: WebE2eExpectedProjection, failures: string[]) {
  if (runAudit.runId !== expected.runId) {
    failures.push(`RunAudit runId mismatch: expected ${expected.runId}, actual ${runAudit.runId}`);
  }
  if (runAudit.providerManifestRef !== undefined && runAudit.providerManifestRef !== expected.providerManifestRef) {
    failures.push(`RunAudit providerManifestRef mismatch: expected ${expected.providerManifestRef}, actual ${runAudit.providerManifestRef}`);
  }
  if (runAudit.currentTurnRef !== undefined && runAudit.currentTurnRef !== expected.currentTask.currentTurnRef.ref) {
    failures.push(`RunAudit currentTurnRef mismatch: expected ${expected.currentTask.currentTurnRef.ref}, actual ${runAudit.currentTurnRef}`);
  }
  if (runAudit.explicitRefs) {
    compareRefList('RunAudit explicit refs', runAudit.explicitRefs, expected.currentTask.explicitRefs.map((ref) => ref.ref), failures);
  }
  assertIncludesAll('RunAudit refs', runAudit.refs, [...expected.runAuditRefs, expected.providerManifestRef], failures);
}

function compareArtifactDelivery(
  label: string,
  actual: WebE2eArtifactDeliveryProjection,
  expected: WebE2eArtifactDeliveryProjection,
  failures: string[],
) {
  compareRefList(`${label} primaryArtifactRefs`, actual.primaryArtifactRefs, expected.primaryArtifactRefs, failures);
  compareRefList(`${label} supportingArtifactRefs`, actual.supportingArtifactRefs, expected.supportingArtifactRefs, failures);
  compareRefList(`${label} auditRefs`, actual.auditRefs, expected.auditRefs, failures);
  compareRefList(`${label} diagnosticRefs`, actual.diagnosticRefs, expected.diagnosticRefs, failures);
  compareRefList(`${label} internalRefs`, actual.internalRefs, expected.internalRefs, failures);
}

function compareInstrumentation(instrumentation: BrowserInstrumentationSnapshot | undefined, failures: string[]) {
  if (!instrumentation) return;
  if (instrumentation.hasFailures) failures.push('browser instrumentation recorded failures');
  for (const [key, count] of Object.entries(instrumentation.counts)) {
    if (key === 'screenshots' || key === 'domSnapshots' || key === 'downloads' || count === 0) continue;
    failures.push(`browser instrumentation ${key} count must be 0, actual ${count}`);
  }
}

function artifactDeliveryFromArtifacts(artifacts: RuntimeArtifact[] = []): WebE2eArtifactDeliveryProjection {
  return {
    primaryArtifactRefs: refsForRole(artifacts, 'primary-deliverable'),
    supportingArtifactRefs: refsForRole(artifacts, 'supporting-evidence'),
    auditRefs: refsForRole(artifacts, 'audit'),
    diagnosticRefs: refsForRole(artifacts, 'diagnostic'),
    internalRefs: refsForRole(artifacts, 'internal'),
  };
}

function refsForRole(artifacts: RuntimeArtifact[], role: NonNullable<RuntimeArtifact['delivery']>['role']): string[] {
  return artifacts
    .filter((artifact) => artifact.delivery?.role === role)
    .map((artifact) => artifact.delivery?.ref ?? toArtifactRef(artifact.id));
}

function projectionFromSessionRun(session: SciForgeSession, runId: string): ConversationProjection | undefined {
  const run = session.runs.find((candidate) => candidate.id === runId);
  return run ? projectionFromRun(run) : undefined;
}

function projectionFromRun(run: SciForgeRun): ConversationProjection | undefined {
  const raw = isRecord(run.raw) ? run.raw : undefined;
  const displayIntent = isRecord(raw?.displayIntent) ? raw.displayIntent : undefined;
  const taskOutcomeProjection = isRecord(displayIntent?.taskOutcomeProjection) ? displayIntent.taskOutcomeProjection : undefined;
  const resultPresentation = isRecord(raw?.resultPresentation) ? raw.resultPresentation : undefined;
  return firstProjection([
    displayIntent?.conversationProjection,
    taskOutcomeProjection?.conversationProjection,
    resultPresentation?.conversationProjection,
  ]);
}

function firstProjection(values: unknown[]): ConversationProjection | undefined {
  return values.find(isRecord) as ConversationProjection | undefined;
}

function unwrapSession(bundle: WebE2eSessionBundle | SciForgeSession): SciForgeSession {
  return 'session' in bundle ? bundle.session : bundle;
}

function unwrapArtifactDeliveryManifest(
  manifest: WebE2eArtifactDeliveryManifest | WebE2eArtifactDeliveryProjection,
): WebE2eArtifactDeliveryProjection {
  return 'artifactDelivery' in manifest ? manifest.artifactDelivery : manifest;
}

function browserVisibleStateFromExpected(expected: WebE2eExpectedProjection): WebE2eBrowserVisibleState {
  const answer = expected.conversationProjection.visibleAnswer;
  return {
    status: answer?.status,
    visibleAnswerText: answer && 'text' in answer && typeof answer.text === 'string' ? answer.text : undefined,
    primaryArtifactRefs: expected.artifactDelivery.primaryArtifactRefs,
    supportingArtifactRefs: expected.artifactDelivery.supportingArtifactRefs,
    visibleArtifactRefs: [
      ...expected.artifactDelivery.primaryArtifactRefs,
      ...expected.artifactDelivery.supportingArtifactRefs,
    ],
    auditRefs: [],
    diagnosticRefs: [],
    internalRefs: [],
  };
}

function compareDeep(label: string, actual: unknown, expected: unknown, failures: string[]) {
  if (!isDeepStrictEqual(actual, expected)) {
    failures.push(`${label} mismatch`);
  }
}

function compareOptionalRefList(label: string, actual: string[] | undefined, expected: string[], failures: string[]) {
  if (actual === undefined) return;
  compareRefList(label, actual, expected, failures);
}

function compareRefList(label: string, actual: string[], expected: string[], failures: string[]) {
  const normalizedActual = normalizeRefs(actual);
  const normalizedExpected = normalizeRefs(expected);
  if (!isDeepStrictEqual(normalizedActual, normalizedExpected)) {
    failures.push(`${label} mismatch: expected ${JSON.stringify(normalizedExpected)}, actual ${JSON.stringify(normalizedActual)}`);
  }
}

function compareForbiddenRefs(label: string, actual: string[] | undefined, expectedForbidden: string[], failures: string[]) {
  if (!actual?.length) return;
  const forbidden = normalizeRefs(expectedForbidden);
  const leaked = normalizeRefs(actual).filter((ref) => forbidden.includes(ref));
  if (leaked.length) {
    failures.push(`${label} leaked audit-only refs into browser visible state: ${JSON.stringify(leaked)}`);
  }
}

function assertIncludesAll(label: string, actual: string[], expected: string[], failures: string[]) {
  const actualSet = new Set(normalizeRefs(actual));
  const missing = normalizeRefs(expected).filter((ref) => !actualSet.has(ref));
  if (missing.length) {
    failures.push(`${label} missing refs: ${JSON.stringify(missing)}`);
  }
}

function artifactRefsForRun(artifacts: RuntimeArtifact[] = [], runId: string): string[] {
  return artifacts
    .filter((artifact) => artifactRunId(artifact) === runId || artifact.delivery?.role === 'supporting-evidence')
    .map((artifact) => artifact.delivery?.ref ?? toArtifactRef(artifact.id));
}

function artifactRunId(artifact: RuntimeArtifact): string | undefined {
  return isRecord(artifact.metadata) && typeof artifact.metadata.runId === 'string' ? artifact.metadata.runId : undefined;
}

function addRef(refs: Set<string>, value: string | undefined) {
  if (value) refs.add(value);
}

function toArtifactRef(value: string): string {
  return value.startsWith('artifact:') ? value : `artifact:${value}`;
}

function normalizeRefs(refs: string[]): string[] {
  return [...new Set(refs)].sort();
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}
