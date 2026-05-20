import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import type {
  ObjectReference,
  RuntimeArtifact,
  SciForgeRun,
} from '@sciforge-ui/runtime-contract';

import {
  artifactDeliveryManifestFromSession,
  assertWebE2eContract,
  runAuditFromSession,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
} from '../contract-verifier.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import type {
  JsonRecord,
  WebE2eArtifactDeliveryProjection,
  WebE2eExpectedProjection,
  WebE2eFixtureWorkspace,
  WebE2eInitialRef,
} from '../types.js';

export const nativeSessionArtifactFollowupCaseId = 'SA-WEB-29';
export const nativeCodexSessionId = 'codex-session-r-resume-01-native';
export const nativeSessionInitialArtifactRef = 'artifact:r-resume-01-source-report';
export const nativeSessionDerivedArtifactRef = 'artifact:r-resume-01-derived-report';
export const nativeSessionResumeAuditRef = 'artifact:r-resume-01-resume-audit';
export const nativeSessionFollowupRequest = 'Using the selected artifact only, derive the risk matrix and include native resume metadata.';

export const nativeSessionSourceArtifactBody = [
  '# Runtime Codex source report',
  '',
  'Prior reasoning: calibration drift is the controlling risk, with assay saturation as a secondary risk.',
  'This body is intentionally longer than the selected ref and must not be replayed inside commandText.',
].join('\n');

const forbiddenGuiTranscript = [
  'GUI transcript:',
  'User: create the Runtime Codex source report',
  'Assistant: here is the full artifact body',
].join('\n');

export interface NativeSessionArtifactFollowupCommand {
  type: 'runtime-codex.resume-commandText';
  commandText: string;
  codexSessionId: string;
  selectedRefs: readonly string[];
  replayedGuiTranscript?: string;
  fullArtifactBody?: string;
}

export type NativeSessionResumeMetadata =
  | {
    status: 'resumed';
    nativeResumeAvailable: true;
    codexSessionId: string;
    previousRunId: string;
    resumedRunId: string;
    source: 'runtime-codex-native-resume';
    selectedRefs: readonly string[];
    derivedArtifactRef: string;
    emittedAt: string;
    commandTextDigest: string;
  }
  | NativeSessionUnsupportedResumeMetadata;

export interface NativeSessionUnsupportedResumeMetadata {
  status: 'blocked';
  nativeResumeAvailable: false;
  blocked: true;
  blockedReason: 'unsupported resume';
  source: 'runtime-codex-native-resume';
  selectedRefs: readonly string[];
  attemptedCommandText: string;
  emittedAt: string;
}

export interface NativeSessionArtifactFollowupResult {
  fixture: WebE2eFixtureWorkspace;
  initialRuntimeTask: {
    runId: string;
    codexSessionId: string;
    artifactRef: string;
  };
  followupCommand: NativeSessionArtifactFollowupCommand;
  resumeMetadata: NativeSessionResumeMetadata;
  browserVisibleState: WebE2eBrowserVisibleState;
  contractInput: WebE2eContractVerifierInput;
}

export async function runNativeSessionArtifactFollowupCase(options: {
  baseDir?: string;
  now?: string;
} = {}): Promise<NativeSessionArtifactFollowupResult> {
  const now = options.now ?? '2026-05-20T00:00:00.000Z';
  const initialRunId = `run-${nativeSessionArtifactFollowupCaseId.toLowerCase()}-initial`;
  const fixture = withNativeSessionArtifactFollowupFixture(await buildWebE2eFixtureWorkspace({
    caseId: nativeSessionArtifactFollowupCaseId,
    baseDir: options.baseDir,
    now,
    prompt: nativeSessionFollowupRequest,
  }), { initialRunId, now });

  const followupCommand = buildNativeSessionArtifactFollowupCommand({
    codexSessionId: nativeCodexSessionId,
    selectedRefs: [nativeSessionInitialArtifactRef],
    userRequest: nativeSessionFollowupRequest,
  });
  const resumeMetadata: NativeSessionResumeMetadata = {
    status: 'resumed',
    nativeResumeAvailable: true,
    codexSessionId: nativeCodexSessionId,
    previousRunId: initialRunId,
    resumedRunId: fixture.runId,
    source: 'runtime-codex-native-resume',
    selectedRefs: [nativeSessionInitialArtifactRef],
    derivedArtifactRef: nativeSessionDerivedArtifactRef,
    emittedAt: now,
    commandTextDigest: digest(followupCommand.commandText),
  };

  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  const browserVisibleState = browserVisibleStateFromExpected(fixture.expectedProjection);
  const contractInput: WebE2eContractVerifierInput = {
    caseId: fixture.caseId,
    expected: fixture.expectedProjection,
    browserVisibleState,
    kernelProjection: fixture.expectedProjection.conversationProjection,
    sessionBundle: { session, workspaceState: fixture.workspaceState },
    runAudit: runAuditFromSession(session, fixture.expectedProjection),
    artifactDeliveryManifest: artifactDeliveryManifestFromSession(session, fixture.expectedProjection),
  };
  assertWebE2eContract(contractInput);

  const result = {
    fixture,
    initialRuntimeTask: {
      runId: initialRunId,
      codexSessionId: nativeCodexSessionId,
      artifactRef: nativeSessionInitialArtifactRef,
    },
    followupCommand,
    resumeMetadata,
    browserVisibleState,
    contractInput,
  };
  assertNativeSessionArtifactFollowupContract(result);
  return result;
}

export function buildNativeSessionArtifactFollowupCommand(input: {
  codexSessionId: string;
  selectedRefs: readonly string[];
  userRequest: string;
}): NativeSessionArtifactFollowupCommand {
  return {
    type: 'runtime-codex.resume-commandText',
    codexSessionId: input.codexSessionId,
    selectedRefs: input.selectedRefs,
    commandText: [
      input.userRequest,
      '',
      'Selected refs:',
      ...input.selectedRefs.map((ref) => `- ${ref}`),
    ].join('\n'),
  };
}

export function unsupportedNativeSessionResumeMetadata(input: {
  selectedRefs?: readonly string[];
  userRequest?: string;
  emittedAt?: string;
} = {}): NativeSessionUnsupportedResumeMetadata {
  const selectedRefs = input.selectedRefs ?? [nativeSessionInitialArtifactRef];
  return {
    status: 'blocked',
    nativeResumeAvailable: false,
    blocked: true,
    blockedReason: 'unsupported resume',
    source: 'runtime-codex-native-resume',
    selectedRefs,
    attemptedCommandText: buildNativeSessionArtifactFollowupCommand({
      codexSessionId: nativeCodexSessionId,
      selectedRefs,
      userRequest: input.userRequest ?? nativeSessionFollowupRequest,
    }).commandText,
    emittedAt: input.emittedAt ?? '2026-05-20T00:00:00.000Z',
  };
}

export function assertNativeSessionArtifactFollowupContract(result: NativeSessionArtifactFollowupResult): void {
  const { fixture, followupCommand, resumeMetadata } = result;
  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  assert.ok(session, 'native session artifact follow-up must include a session bundle');

  const initialRun = session.runs.find((run) => run.id === result.initialRuntimeTask.runId);
  assert.equal(nativeCodexSessionIdFromRun(initialRun), result.initialRuntimeTask.codexSessionId, 'initial Runtime Codex run must expose codexSessionId');
  assert.equal(result.initialRuntimeTask.artifactRef, nativeSessionInitialArtifactRef);

  assert.equal(followupCommand.codexSessionId, result.initialRuntimeTask.codexSessionId, 'follow-up must resume the exposed Codex session');
  assert.deepEqual([...followupCommand.selectedRefs], [nativeSessionInitialArtifactRef], 'follow-up command must carry selected refs');
  assert.match(followupCommand.commandText, new RegExp(escapeRegExp(nativeSessionFollowupRequest)), 'commandText must include the new user request');
  assert.match(followupCommand.commandText, new RegExp(escapeRegExp(nativeSessionInitialArtifactRef)), 'commandText must include the selected artifact ref');
  assertNoGuiReplayOrArtifactBody(followupCommand);

  assert.equal(resumeMetadata.status, 'resumed', 'successful path must emit resumed metadata');
  assert.equal(resumeMetadata.nativeResumeAvailable, true, 'successful path must be native resume');
  assert.equal(resumeMetadata.codexSessionId, result.initialRuntimeTask.codexSessionId, 'resume metadata codexSessionId must match the initial Runtime Codex task');
  assert.equal(resumeMetadata.previousRunId, result.initialRuntimeTask.runId, 'resume metadata previousRunId must point at the initial Runtime Codex task');
  assert.equal(resumeMetadata.resumedRunId, fixture.runId, 'resume metadata resumedRunId must point at the follow-up run');
  assert.deepEqual([...resumeMetadata.selectedRefs], [nativeSessionInitialArtifactRef]);
  assert.equal(resumeMetadata.derivedArtifactRef, nativeSessionDerivedArtifactRef);
  assert.equal(resumeMetadata.commandTextDigest, digest(followupCommand.commandText));

  const derivedArtifact = session.artifacts.find((artifact) => artifact.delivery?.ref === nativeSessionDerivedArtifactRef);
  assert.ok(derivedArtifact, 'follow-up must materialize a derived artifact');
  assert.equal(derivedArtifact.metadata?.derivation?.parentArtifactRef, nativeSessionInitialArtifactRef, 'derived artifact must point at the selected source ref');
  assert.deepEqual(derivedArtifact.metadata?.derivation?.sourceRefs, [nativeSessionInitialArtifactRef], 'derived artifact must record selected source refs');
  assert.deepEqual(derivedArtifact.metadata?.resumeMetadata, resumeMetadata);

  assert.ok(
    fixture.expectedProjection.conversationProjection.visibleAnswer?.artifactRefs?.includes(nativeSessionDerivedArtifactRef),
    'visible final answer must expose the derived artifact ref',
  );
  assertWebE2eContract(result.contractInput);
}

export function assertUnsupportedNativeSessionResume(metadata: NativeSessionResumeMetadata): void {
  assert.equal(metadata.status, 'blocked', 'native resume unavailable path must be blocked');
  assert.equal(metadata.nativeResumeAvailable, false, 'blocked path must not pretend native resume is available');
  assert.equal(metadata.blocked, true);
  assert.equal(metadata.blockedReason, 'unsupported resume');
  assert.deepEqual([...metadata.selectedRefs], [nativeSessionInitialArtifactRef]);
  assert.match(metadata.attemptedCommandText, new RegExp(escapeRegExp(nativeSessionFollowupRequest)));
  assert.match(metadata.attemptedCommandText, new RegExp(escapeRegExp(nativeSessionInitialArtifactRef)));
  assert.doesNotMatch(JSON.stringify(metadata), /"codexSessionId"|"resumedRunId"|"derivedArtifactRef"/);
}

export function assertNoGuiReplayOrArtifactBody(command: NativeSessionArtifactFollowupCommand): void {
  assert.equal(command.replayedGuiTranscript, undefined, 'follow-up must not attach a replayed GUI transcript');
  assert.equal(command.fullArtifactBody, undefined, 'follow-up must not attach the full artifact body');
  assert.doesNotMatch(command.commandText, /GUI transcript:|Assistant:|full artifact body/i, 'commandText must not replay GUI transcript');
  assert.doesNotMatch(command.commandText, new RegExp(escapeRegExp(nativeSessionSourceArtifactBody)), 'commandText must not replay the full artifact body');
  assert.doesNotMatch(command.commandText, new RegExp(escapeRegExp(forbiddenGuiTranscript)), 'commandText must not replay GUI transcript text');
}

function withNativeSessionArtifactFollowupFixture(
  fixture: WebE2eFixtureWorkspace,
  input: { initialRunId: string; now: string },
): WebE2eFixtureWorkspace {
  const next = structuredClone(fixture) as WebE2eFixtureWorkspace;
  const selectedSourceRef = selectedRef(
    'ref-r-resume-01-source-report',
    'Runtime Codex source report',
    nativeSessionInitialArtifactRef,
    'supporting-evidence',
  );
  const derivedRef = selectedRef(
    'ref-r-resume-01-derived-report',
    'Derived resume risk matrix',
    nativeSessionDerivedArtifactRef,
    'primary-deliverable',
  );
  const resumeAuditRef = selectedRef(
    'ref-r-resume-01-resume-audit',
    'Native resume metadata audit',
    nativeSessionResumeAuditRef,
    'audit',
  );
  const providerRef = next.expectedProjection.providerManifestRef;

  const artifacts = [
    sourceArtifact(next.scenarioId, input.initialRunId),
    derivedArtifact(next.scenarioId, next.runId, input.initialRunId, input.now),
    resumeAuditArtifact(next.scenarioId, next.runId),
    providerManifestArtifact(next.scenarioId, next.runId),
  ];
  const artifactDelivery = artifactDeliveryProjection(artifacts);
  const text = 'Native Codex resume used codexSessionId codex-session-r-resume-01-native and selected artifact:r-resume-01-source-report to create artifact:r-resume-01-derived-report.';
  next.expectedProjection.currentTask = {
    currentTurnRef: next.expectedProjection.currentTask.currentTurnRef,
    explicitRefs: [],
    selectedRefs: [selectedSourceRef],
  };
  next.expectedProjection.conversationProjection = {
    ...next.expectedProjection.conversationProjection,
    visibleAnswer: {
      status: 'satisfied',
      text,
      artifactRefs: [nativeSessionDerivedArtifactRef],
    },
    activeRun: { id: next.runId, status: 'satisfied' },
    artifacts: [{ ref: nativeSessionDerivedArtifactRef, label: 'Derived resume risk matrix' }],
    recoverActions: [],
    auditRefs: [nativeSessionResumeAuditRef],
  };
  next.expectedProjection.artifactDelivery = artifactDelivery;
  next.expectedProjection.runAuditRefs = [nativeSessionResumeAuditRef, providerRef];

  const session = next.workspaceState.sessionsByScenario[next.scenarioId];
  session.artifacts = artifacts;
  session.executionUnits = [{
    id: 'eu-r-resume-01-native-resume',
    tool: 'runtime.codex.native-resume',
    params: `codexSessionId=${nativeCodexSessionId} selectedRefs=${nativeSessionInitialArtifactRef}`,
    status: 'done',
    hash: 'r-resume-01-native-resume',
    runId: next.runId,
    outputRef: '.sciforge/task-results/r-resume-01-resume-audit.json',
    outputArtifacts: ['r-resume-01-derived-report', 'r-resume-01-resume-audit'],
    time: input.now,
  }];
  session.uiManifest = [
    { componentId: 'report-viewer', title: 'Derived resume risk matrix', artifactRef: 'r-resume-01-derived-report', priority: 1 },
  ];
  session.messages = [{
    id: next.expectedProjection.currentTask.currentTurnRef.ref.replace(/^message:/, ''),
    role: 'user',
    content: nativeSessionFollowupRequest,
    createdAt: input.now,
    status: 'completed',
    objectReferences: [objectReferenceFor(selectedSourceRef, input.initialRunId)],
  }, {
    id: 'msg-r-resume-01-final',
    role: 'scenario',
    content: text,
    createdAt: input.now,
    status: 'completed',
    objectReferences: [objectReferenceFor(derivedRef, next.runId), objectReferenceFor(resumeAuditRef, next.runId)],
  }];
  session.updatedAt = input.now;
  next.seedArtifacts = artifacts;
  next.initialRefs = [next.expectedProjection.currentTask.currentTurnRef, selectedSourceRef, derivedRef, resumeAuditRef];
  next.objectReferences = [objectReferenceFor(selectedSourceRef, input.initialRunId), objectReferenceFor(derivedRef, next.runId), objectReferenceFor(resumeAuditRef, next.runId)];
  session.runs = [
    initialCodexRun(next, input.initialRunId, input.now),
    finalResumeRun(next, input.initialRunId, input.now),
  ];
  return next;
}

function initialCodexRun(fixture: WebE2eFixtureWorkspace, initialRunId: string, now: string): SciForgeRun {
  return {
    id: initialRunId,
    scenarioId: fixture.scenarioId,
    status: 'completed',
    prompt: 'Create the Runtime Codex source report and expose codexSessionId.',
    response: 'Created artifact:r-resume-01-source-report from native Runtime Codex session.',
    createdAt: now,
    completedAt: now,
    objectReferences: [objectReferenceFor(selectedRef('ref-r-resume-01-source-report', 'Runtime Codex source report', nativeSessionInitialArtifactRef, 'supporting-evidence'), initialRunId)],
    raw: {
      runtime: 'codex',
      codexSessionId: nativeCodexSessionId,
      artifacts: [nativeSessionInitialArtifactRef],
      displayIntent: {
        conversationProjection: {
          schemaVersion: 'sciforge.conversation-projection.v1',
          conversationId: nativeSessionArtifactFollowupCaseId,
          visibleAnswer: {
            status: 'satisfied',
            text: 'Created Runtime Codex source report.',
            artifactRefs: [nativeSessionInitialArtifactRef],
          },
          activeRun: { id: initialRunId, status: 'satisfied' },
          artifacts: [{ ref: nativeSessionInitialArtifactRef, label: 'Runtime Codex source report' }],
          executionProcess: [],
          recoverActions: [],
          auditRefs: [],
        },
      },
    },
  };
}

function finalResumeRun(fixture: WebE2eFixtureWorkspace, initialRunId: string, now: string): SciForgeRun {
  return {
    id: fixture.runId,
    scenarioId: fixture.scenarioId,
    status: 'completed',
    prompt: nativeSessionFollowupRequest,
    response: fixture.expectedProjection.conversationProjection.visibleAnswer?.text ?? 'Native resume complete.',
    createdAt: now,
    completedAt: now,
    objectReferences: fixture.objectReferences,
    raw: {
      runtime: 'codex',
      nativeResume: {
        source: 'runtime-codex-native-resume',
        codexSessionId: nativeCodexSessionId,
        previousRunId: initialRunId,
        resumedRunId: fixture.runId,
        selectedRefs: [nativeSessionInitialArtifactRef],
      },
      displayIntent: {
        conversationProjection: fixture.expectedProjection.conversationProjection,
        taskOutcomeProjection: {
          conversationProjection: fixture.expectedProjection.conversationProjection,
        },
      },
      resultPresentation: {
        conversationProjection: fixture.expectedProjection.conversationProjection,
      },
    },
  };
}

function sourceArtifact(scenarioId: string, runId: string): RuntimeArtifact {
  return artifact({
    id: 'r-resume-01-source-report',
    type: 'research-report',
    scenarioId,
    runId,
    title: 'Runtime Codex source report',
    dataRef: '.sciforge/artifacts/r-resume-01-source-report.md',
    role: 'supporting-evidence',
    mediaType: 'text/markdown',
    extension: 'md',
    metadata: {
      bodyDigest: digest(nativeSessionSourceArtifactBody),
      codexSessionId: nativeCodexSessionId,
    },
  });
}

function derivedArtifact(scenarioId: string, runId: string, initialRunId: string, now: string): RuntimeArtifact {
  return artifact({
    id: 'r-resume-01-derived-report',
    type: 'resume-risk-matrix',
    scenarioId,
    runId,
    title: 'Derived resume risk matrix',
    dataRef: '.sciforge/artifacts/r-resume-01-derived-report.md',
    role: 'primary-deliverable',
    mediaType: 'text/markdown',
    extension: 'md',
    metadata: {
      derivation: {
        schemaVersion: 'sciforge.artifact-derivation.v1',
        kind: 'selected-artifact-followup',
        parentArtifactRef: nativeSessionInitialArtifactRef,
        sourceRefs: [nativeSessionInitialArtifactRef],
        verificationStatus: 'verified',
      },
      resumeCodexSessionId: nativeCodexSessionId,
      resumePreviousRunId: initialRunId,
      resumeRunId: runId,
      resumeMetadata: {
        status: 'resumed',
        nativeResumeAvailable: true,
        codexSessionId: nativeCodexSessionId,
        previousRunId: initialRunId,
        resumedRunId: runId,
        source: 'runtime-codex-native-resume',
        selectedRefs: [nativeSessionInitialArtifactRef],
        derivedArtifactRef: nativeSessionDerivedArtifactRef,
        emittedAt: now,
        commandTextDigest: digest(buildNativeSessionArtifactFollowupCommand({
          codexSessionId: nativeCodexSessionId,
          selectedRefs: [nativeSessionInitialArtifactRef],
          userRequest: nativeSessionFollowupRequest,
        }).commandText),
      },
    },
  });
}

function resumeAuditArtifact(scenarioId: string, runId: string): RuntimeArtifact {
  return artifact({
    id: 'r-resume-01-resume-audit',
    type: 'native-resume-audit',
    scenarioId,
    runId,
    title: 'Native resume metadata audit',
    dataRef: '.sciforge/task-results/r-resume-01-resume-audit.json',
    role: 'audit',
    mediaType: 'application/json',
    extension: 'json',
    previewPolicy: 'audit-only',
  });
}

function providerManifestArtifact(scenarioId: string, runId: string): RuntimeArtifact {
  return artifact({
    id: 'fixture-provider-manifest',
    type: 'provider-manifest',
    scenarioId,
    runId,
    title: 'Provider manifest',
    dataRef: '.sciforge/provider-manifest.json',
    role: 'internal',
    mediaType: 'application/json',
    extension: 'json',
    previewPolicy: 'unsupported',
  });
}

function artifact(input: {
  id: string;
  type: string;
  scenarioId: string;
  runId: string;
  title: string;
  dataRef: string;
  role: NonNullable<RuntimeArtifact['delivery']>['role'];
  mediaType: string;
  extension: string;
  previewPolicy?: NonNullable<RuntimeArtifact['delivery']>['previewPolicy'];
  metadata?: JsonRecord;
}): RuntimeArtifact {
  return {
    id: input.id,
    type: input.type,
    producerScenario: input.scenarioId,
    schemaVersion: '1',
    metadata: { title: input.title, path: input.dataRef, runId: input.runId, ...input.metadata },
    dataRef: input.dataRef,
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: `artifact:${input.id}`,
      role: input.role,
      declaredMediaType: input.mediaType,
      declaredExtension: input.extension,
      contentShape: 'raw-file',
      readableRef: input.previewPolicy === 'unsupported' ? undefined : input.dataRef,
      rawRef: input.dataRef,
      previewPolicy: input.previewPolicy ?? 'inline',
    },
    visibility: input.role === 'internal' ? 'private-draft' : 'project-record',
  };
}

function artifactDeliveryProjection(artifacts: RuntimeArtifact[]): WebE2eArtifactDeliveryProjection {
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
    .map((artifact) => artifact.delivery?.ref ?? `artifact:${artifact.id}`);
}

function selectedRef(id: string, title: string, ref: string, role: ObjectReference['presentationRole']): WebE2eInitialRef {
  return {
    id,
    kind: 'artifact',
    title,
    ref,
    source: role === 'audit' ? 'run-audit' : 'seed-workspace',
    artifactType: role === 'primary-deliverable' ? 'resume-risk-matrix' : role === 'audit' ? 'native-resume-audit' : 'research-report',
    digest: `sha256:${id}`,
  };
}

function objectReferenceFor(ref: WebE2eInitialRef, runId: string): ObjectReference {
  return {
    id: `object-${ref.id}`,
    title: ref.title,
    kind: 'artifact',
    ref: ref.ref,
    artifactType: ref.artifactType,
    runId,
    preferredView: ref.artifactType === 'native-resume-audit' ? 'record-table' : 'report-viewer',
    presentationRole: ref.source === 'run-audit' ? 'audit' : ref.artifactType === 'resume-risk-matrix' ? 'primary-deliverable' : 'supporting-evidence',
    actions: ['focus-right-pane', 'copy-path'],
    status: 'available',
  };
}

function nativeCodexSessionIdFromRun(run: SciForgeRun | undefined): string | undefined {
  const raw = run?.raw;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = (raw as { codexSessionId?: unknown }).codexSessionId;
  return typeof value === 'string' ? value : undefined;
}

function browserVisibleStateFromExpected(expected: WebE2eExpectedProjection): WebE2eBrowserVisibleState {
  const answer = expected.conversationProjection.visibleAnswer;
  return {
    status: answer?.status,
    visibleAnswerText: answer && 'text' in answer ? answer.text : undefined,
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

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
