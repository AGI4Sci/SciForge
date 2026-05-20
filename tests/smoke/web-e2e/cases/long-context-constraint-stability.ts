import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  RuntimeArtifact,
  RuntimeExecutionUnit,
  SciForgeMessage,
  SciForgeRun,
} from '@sciforge-ui/runtime-contract';
import type { ConversationProjection } from '../../../../src/runtime/conversation-kernel/index.js';
import {
  artifactDeliveryManifestFromSession,
  assertWebE2eContract,
  runAuditFromSession,
  verifyWebE2eContract,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
  type WebE2eRunAuditEvidence,
} from '../contract-verifier.js';
import {
  createWebE2eEvidenceBundleManifest,
  type WebE2eEvidenceBundleManifest,
} from '../evidence-bundle.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import type {
  WebE2eArtifactDeliveryProjection,
  WebE2eExpectedProjection,
  WebE2eFixtureWorkspace,
  WebE2eInitialRef,
} from '../types.js';

export const LONG_CONTEXT_CONSTRAINT_STABILITY_CASE_ID = 'SA-WEB-30';
export const LONG_CONTEXT_ORIGINAL_CONSTRAINT = 'Original constraint: final answers must stay prose-only and must not include unrelated literature or data artifact refs.';
export const LONG_CONTEXT_NOISE_PROMPT = 'Now do unrelated literature and data work: draft paper notes, inspect noisy CSV failures, and keep long context artifacts for audit only.';
export const LONG_CONTEXT_FINAL_PROMPT = 'What was my original constraint, and does the current result obey it?';
export const LONG_CONTEXT_FINAL_ANSWER = [
  'The original constraint was: final answers must stay prose-only and must not include unrelated literature or data artifact refs.',
  'The current result obeys it because this answer is prose-only, names no unrelated artifact refs, and uses only bounded audit evidence.',
].join(' ');

export const LONG_CONTEXT_UNRELATED_ARTIFACT_REFS = [
  'artifact:r-mem-01-literature-notes',
  'artifact:r-mem-01-failed-csv-diagnostics',
  'artifact:r-mem-01-long-context-noise',
] as const;

const now = '2026-05-20T00:00:00.000Z';
const sessionId = 'session-r-mem-01';
const scenarioId = 'scenario-r-mem-01';
const finalRunId = 'run-r-mem-01-final';
const noiseRunId = 'run-r-mem-01-noise';
const constraintRef = 'projection:r-mem-01-original-constraint';
const boundedAuditRefs = [
  constraintRef,
  'message:msg-r-mem-01-user-final',
  'audit:r-mem-01-ref-selection-summary',
  'file:.sciforge/provider-manifest.json',
] as const;
const maxAuditRefCount = 6;

type LongContextTurnId = 'original-constraint' | 'unrelated-noise' | 'constraint-check';

export interface LongContextConstraintTurn {
  turnId: LongContextTurnId;
  prompt: string;
  recoveredConstraint?: string;
  generatedArtifactRefs: string[];
  auditRefs: string[];
  evidenceBytes: number;
}

export interface LongContextConstraintStabilityResult {
  fixture: WebE2eFixtureWorkspace;
  turns: LongContextConstraintTurn[];
  browserVisibleState: WebE2eBrowserVisibleState;
  runAudit: WebE2eRunAuditEvidence;
  verifierInput: WebE2eContractVerifierInput;
  evidenceBundle: WebE2eEvidenceBundleManifest;
}

export async function runLongContextConstraintStabilityCase(options: {
  baseDir?: string;
  outputRoot?: string;
  now?: string;
} = {}): Promise<LongContextConstraintStabilityResult> {
  const fixedNow = options.now ?? now;
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId: LONG_CONTEXT_CONSTRAINT_STABILITY_CASE_ID,
    baseDir: options.baseDir,
    scenarioId,
    sessionId,
    runId: finalRunId,
    now: fixedNow,
    title: 'R-MEM-01 long context constraint stability Web E2E case',
    prompt: LONG_CONTEXT_FINAL_PROMPT,
  });

  const turns = longContextTurns();
  await finalizeLongContextConstraintFixture(fixture, turns, fixedNow);

  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  const browserVisibleState = browserVisibleStateFromExpected(fixture.expectedProjection);
  const runAudit = runAuditFromSession(session, fixture.expectedProjection);
  const verifierInput: WebE2eContractVerifierInput = {
    caseId: fixture.caseId,
    expected: fixture.expectedProjection,
    browserVisibleState,
    kernelProjection: fixture.expectedProjection.conversationProjection,
    sessionBundle: { session, workspaceState: fixture.workspaceState },
    runAudit,
    artifactDeliveryManifest: artifactDeliveryManifestFromSession(session, fixture.expectedProjection),
  };
  assertWebE2eContract(verifierInput);

  const evidenceBundle = createWebE2eEvidenceBundleManifest({
    caseId: fixture.caseId,
    generatedAt: fixedNow,
    outputRoot: options.outputRoot,
    runs: [
      {
        runId: noiseRunId,
        eventIds: ['event:r-mem-01-noise-artifacts', 'event:r-mem-01-noise-failure'],
        status: 'failed-then-summarized',
        resultDigest: 'sha256:r-mem-01-noise-summary',
      },
      {
        runId: finalRunId,
        eventIds: ['event:r-mem-01-constraint-check'],
        status: 'completed',
        resultDigest: 'sha256:r-mem-01-final-constraint-check',
      },
    ],
    projection: {
      projectionVersion: fixture.expectedProjection.projectionVersion,
      terminalState: fixture.expectedProjection.conversationProjection.visibleAnswer?.status,
    },
    note: {
      status: 'passed',
      summary: 'R-MEM-01 recovered the original constraint after unrelated artifact-heavy context and kept final refs bounded.',
    },
    extra: {
      recoveredConstraint: LONG_CONTEXT_ORIGINAL_CONSTRAINT,
      unrelatedArtifactRefs: [...LONG_CONTEXT_UNRELATED_ARTIFACT_REFS],
      maxAuditRefCount,
      finalAuditRefCount: runAudit.refs.length,
    },
  });

  const result: LongContextConstraintStabilityResult = {
    fixture,
    turns,
    browserVisibleState,
    runAudit,
    verifierInput,
    evidenceBundle,
  };
  assertLongContextConstraintStabilityCase(result);
  return result;
}

export function assertLongContextConstraintStabilityCase(result: LongContextConstraintStabilityResult): void {
  const verification = verifyWebE2eContract(result.verifierInput);
  assert.equal(verification.ok, true, verification.failures.join('\n'));

  assert.deepEqual(result.turns.map((turn) => turn.turnId), [
    'original-constraint',
    'unrelated-noise',
    'constraint-check',
  ]);
  assert.equal(result.turns[0]?.prompt, LONG_CONTEXT_ORIGINAL_CONSTRAINT);
  assert.equal(result.turns[2]?.prompt, LONG_CONTEXT_FINAL_PROMPT);
  assert.equal(
    result.turns[2]?.recoveredConstraint,
    LONG_CONTEXT_ORIGINAL_CONSTRAINT,
    'final turn must recover the original constraint verbatim',
  );

  const answer = result.browserVisibleState.visibleAnswerText ?? '';
  assert.match(answer, /final answers must stay prose-only/i, 'final answer must restate the original constraint');
  assert.match(answer, /current result obeys it/i, 'final answer must judge whether the current result obeys the constraint');
  assert.doesNotMatch(answer, /artifact:r-mem-01-/i, 'unrelated artifact refs must not pollute the final visible answer');
  assert.deepEqual(result.browserVisibleState.visibleArtifactRefs, [], 'final visible answer must not expose unrelated artifacts');
  assert.deepEqual(result.browserVisibleState.primaryArtifactRefs, [], 'final turn must not promote unrelated artifacts as primary output');
  assert.deepEqual(result.browserVisibleState.supportingArtifactRefs, [], 'final turn must not promote unrelated artifacts as supporting output');

  const noisyTurn = result.turns[1];
  assert.ok(noisyTurn, 'noise turn must exist');
  assert.deepEqual(noisyTurn.generatedArtifactRefs, [...LONG_CONTEXT_UNRELATED_ARTIFACT_REFS]);
  assert.ok(noisyTurn.evidenceBytes > 16_000, 'noise turn must simulate long context pressure');

  const finalTurn = result.turns[2];
  assert.ok(finalTurn, 'final turn must exist');
  assert.ok(finalTurn.auditRefs.length <= maxAuditRefCount, 'final turn audit refs must remain bounded');
  assert.ok(result.runAudit.refs.length <= maxAuditRefCount, 'run audit evidence must remain bounded');
  assert.equal(result.runAudit.currentTurnRef, 'message:msg-r-mem-01-user-final');
  assert.deepEqual(result.runAudit.explicitRefs, [], 'final check must rely on recovered stable constraint, not explicit noisy artifact refs');

  for (const ref of LONG_CONTEXT_UNRELATED_ARTIFACT_REFS) {
    assert.ok(noisyTurn.generatedArtifactRefs.includes(ref), `${ref}: fixture must create unrelated artifact noise`);
    assert.doesNotMatch(answer, new RegExp(escapeRegExp(ref)), `${ref}: final answer must not mention unrelated artifact ref`);
    assert.ok(!result.runAudit.refs.includes(ref), `${ref}: final run audit must not include unrelated artifact refs`);
    assert.ok(!finalTurn.auditRefs.includes(ref), `${ref}: bounded final audit must not include unrelated artifact refs`);
  }

  assert.deepEqual(result.evidenceBundle.extra?.unrelatedArtifactRefs, [...LONG_CONTEXT_UNRELATED_ARTIFACT_REFS]);
  assert.equal(result.evidenceBundle.extra?.maxAuditRefCount, maxAuditRefCount);
}

function longContextTurns(): LongContextConstraintTurn[] {
  return [
    {
      turnId: 'original-constraint',
      prompt: LONG_CONTEXT_ORIGINAL_CONSTRAINT,
      generatedArtifactRefs: [],
      auditRefs: [constraintRef],
      evidenceBytes: LONG_CONTEXT_ORIGINAL_CONSTRAINT.length,
    },
    {
      turnId: 'unrelated-noise',
      prompt: LONG_CONTEXT_NOISE_PROMPT,
      generatedArtifactRefs: [...LONG_CONTEXT_UNRELATED_ARTIFACT_REFS],
      auditRefs: [
        ...LONG_CONTEXT_UNRELATED_ARTIFACT_REFS,
        'failure:r-mem-01-csv-parse',
        'audit:r-mem-01-long-context-truncation',
      ],
      evidenceBytes: 48_000,
    },
    {
      turnId: 'constraint-check',
      prompt: LONG_CONTEXT_FINAL_PROMPT,
      recoveredConstraint: LONG_CONTEXT_ORIGINAL_CONSTRAINT,
      generatedArtifactRefs: [],
      auditRefs: [...boundedAuditRefs],
      evidenceBytes: 1_024,
    },
  ];
}

async function finalizeLongContextConstraintFixture(
  fixture: WebE2eFixtureWorkspace,
  turns: LongContextConstraintTurn[],
  fixedNow: string,
): Promise<void> {
  await writeNoiseArtifacts(fixture, fixedNow);

  fixture.runId = finalRunId;
  fixture.expectedProjection.runId = finalRunId;
  fixture.expectedProjection.currentTask = {
    currentTurnRef: currentTurnRef(),
    explicitRefs: [],
    selectedRefs: [currentTurnRef(), stableConstraintRef()],
  };
  fixture.expectedProjection.conversationProjection = conversationProjection();
  fixture.expectedProjection.runAuditRefs = [
    constraintRef,
    'audit:r-mem-01-ref-selection-summary',
  ];

  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  session.messages = messages(fixedNow);
  session.runs = runs(fixedNow);
  session.executionUnits = executionUnits(fixedNow);
  session.uiManifest = [];
  session.claims = [];
  session.artifacts = artifacts(fixture, fixedNow);
  session.updatedAt = fixedNow;
  fixture.expectedProjection.artifactDelivery = artifactDeliveryProjection(session.artifacts);

  const finalTurn = turns[2];
  assert.ok(finalTurn);
  finalTurn.auditRefs = [...boundedAuditRefs];
}

async function writeNoiseArtifacts(fixture: WebE2eFixtureWorkspace, fixedNow: string): Promise<void> {
  const artifactDir = join(fixture.sciforgeDir, 'artifacts');
  await writeFile(
    join(artifactDir, 'r-mem-01-literature-notes.md'),
    [
      '# Unrelated Literature Notes',
      '',
      `Generated at ${fixedNow}.`,
      'This file is intentionally unrelated to the original prose-only constraint.',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(artifactDir, 'r-mem-01-failed-csv-diagnostics.json'),
    `${JSON.stringify({ schemaVersion: 'sciforge.web-e2e.r-mem-01-failure.v1', error: 'CSV row width drift', recovered: false }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(artifactDir, 'r-mem-01-long-context-noise.txt'),
    `${Array.from({ length: 300 }, (_, index) => `noise-line-${String(index + 1).padStart(3, '0')}: unrelated context filler for bounded-memory testing`).join('\n')}\n`,
    'utf8',
  );
}

function messages(fixedNow: string): SciForgeMessage[] {
  return [
    userMessage('msg-r-mem-01-user-original', LONG_CONTEXT_ORIGINAL_CONSTRAINT, fixedNow),
    scenarioMessage('msg-r-mem-01-agent-original', 'Stored the original prose-only/no-unrelated-artifact-ref constraint as a stable projection.', fixedNow),
    userMessage('msg-r-mem-01-user-noise', LONG_CONTEXT_NOISE_PROMPT, fixedNow),
    scenarioMessage('msg-r-mem-01-agent-noise', 'Created unrelated literature notes, failed CSV diagnostics, and long context noise as audit-only artifacts.', fixedNow),
    userMessage('msg-r-mem-01-user-final', LONG_CONTEXT_FINAL_PROMPT, fixedNow),
    scenarioMessage('msg-r-mem-01-agent-final', LONG_CONTEXT_FINAL_ANSWER, fixedNow),
  ];
}

function userMessage(id: string, content: string, fixedNow: string): SciForgeMessage {
  return { id, role: 'user', content, createdAt: fixedNow, status: 'completed', objectReferences: [] };
}

function scenarioMessage(id: string, content: string, fixedNow: string): SciForgeMessage {
  return { id, role: 'scenario', content, createdAt: fixedNow, status: 'completed', objectReferences: [] };
}

function runs(fixedNow: string): SciForgeRun[] {
  return [
    {
      id: noiseRunId,
      scenarioId,
      status: 'failed',
      prompt: LONG_CONTEXT_NOISE_PROMPT,
      response: 'Unrelated literature/data work generated audit-only artifacts and one CSV parse failure.',
      createdAt: fixedNow,
      completedAt: fixedNow,
      objectReferences: [],
      raw: {
        displayIntent: {
          source: 'runtime-dispatch',
          conversationProjection: noiseProjection(),
        },
        resultPresentation: {
          conversationProjection: noiseProjection(),
        },
      },
    },
    {
      id: finalRunId,
      scenarioId,
      status: 'completed',
      prompt: LONG_CONTEXT_FINAL_PROMPT,
      response: LONG_CONTEXT_FINAL_ANSWER,
      createdAt: fixedNow,
      completedAt: fixedNow,
      objectReferences: [],
      raw: {
        displayIntent: {
          primaryGoal: LONG_CONTEXT_ORIGINAL_CONSTRAINT,
          source: 'runtime-dispatch',
          conversationProjection: conversationProjection(),
          taskOutcomeProjection: { conversationProjection: conversationProjection() },
        },
        resultPresentation: {
          conversationProjection: conversationProjection(),
        },
      },
    },
  ];
}

function executionUnits(fixedNow: string): RuntimeExecutionUnit[] {
  return [
    {
      id: 'eu-r-mem-01-noise',
      tool: 'offline-web-e2e-fixture.long-context-noise',
      params: 'literature=data failures=csv longContext=true',
      status: 'failed',
      hash: 'r-mem-01-noise',
      runId: noiseRunId,
      outputRef: '.sciforge/artifacts/r-mem-01-long-context-noise.txt',
      outputArtifacts: [
        'r-mem-01-literature-notes',
        'r-mem-01-failed-csv-diagnostics',
        'r-mem-01-long-context-noise',
      ],
      time: fixedNow,
    },
    {
      id: 'eu-r-mem-01-final',
      tool: 'offline-web-e2e-fixture.constraint-recovery',
      params: 'recover=original-constraint boundedRefs=true',
      status: 'done',
      hash: 'r-mem-01-final',
      runId: finalRunId,
      outputRef: undefined,
      outputArtifacts: [],
      time: fixedNow,
    },
  ];
}

function artifacts(fixture: WebE2eFixtureWorkspace, fixedNow: string): RuntimeArtifact[] {
  const noiseArtifacts: RuntimeArtifact[] = [
    artifact(fixture, 'r-mem-01-literature-notes', 'research-report', 'artifact:r-mem-01-literature-notes', '.sciforge/artifacts/r-mem-01-literature-notes.md', noiseRunId, 'audit', fixedNow),
    artifact(fixture, 'r-mem-01-failed-csv-diagnostics', 'diagnostic-report', 'artifact:r-mem-01-failed-csv-diagnostics', '.sciforge/artifacts/r-mem-01-failed-csv-diagnostics.json', noiseRunId, 'diagnostic', fixedNow),
    artifact(fixture, 'r-mem-01-long-context-noise', 'context-noise', 'artifact:r-mem-01-long-context-noise', '.sciforge/artifacts/r-mem-01-long-context-noise.txt', noiseRunId, 'internal', fixedNow),
  ];
  return [
    ...fixture.seedArtifacts.filter((seedArtifact) => seedArtifact.delivery?.role !== 'primary-deliverable' && seedArtifact.delivery?.role !== 'supporting-evidence'),
    ...noiseArtifacts,
  ];
}

function artifact(
  fixture: WebE2eFixtureWorkspace,
  id: string,
  type: string,
  ref: string,
  relPath: string,
  runId: string,
  role: NonNullable<RuntimeArtifact['delivery']>['role'],
  fixedNow: string,
): RuntimeArtifact {
  return {
    id,
    type,
    producerScenario: fixture.scenarioId,
    schemaVersion: '1',
    metadata: { title: id, path: relPath, runId, createdAt: fixedNow },
    dataRef: relPath,
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref,
      role,
      declaredMediaType: relPath.endsWith('.json') ? 'application/json' : relPath.endsWith('.md') ? 'text/markdown' : 'text/plain',
      declaredExtension: relPath.split('.').pop() ?? 'txt',
      contentShape: 'raw-file',
      readableRef: relPath,
      rawRef: relPath,
      previewPolicy: role === 'internal' ? 'unsupported' : 'audit-only',
    },
    visibility: 'project-record',
  };
}

function conversationProjection(): ConversationProjection {
  return {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: LONG_CONTEXT_CONSTRAINT_STABILITY_CASE_ID,
    visibleAnswer: {
      status: 'satisfied',
      text: LONG_CONTEXT_FINAL_ANSWER,
      artifactRefs: [],
    },
    activeRun: { id: finalRunId, status: 'satisfied' },
    artifacts: [],
    executionProcess: [
      {
        eventId: 'event-r-mem-01-constraint-check',
        type: 'HarnessDecisionRecorded',
        summary: 'Recovered the original constraint from stable projection and ignored unrelated artifact-heavy noise.',
        timestamp: now,
      },
      {
        eventId: 'event-r-mem-01-satisfied',
        type: 'Satisfied',
        summary: 'Final answer obeys prose-only/no-unrelated-artifact-ref constraint.',
        timestamp: now,
      },
    ],
    recoverActions: [],
    auditRefs: [...boundedAuditRefs],
    verificationState: { status: 'not-required' },
    diagnostics: [{
      severity: 'info',
      code: 'r-mem-01-bounded-audit',
      message: 'Final constraint check used bounded refs and did not surface unrelated artifacts.',
      refs: boundedAuditRefs.map((ref) => ({ ref })),
    }],
  };
}

function noiseProjection(): ConversationProjection {
  return {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: `${LONG_CONTEXT_CONSTRAINT_STABILITY_CASE_ID}:noise`,
    visibleAnswer: {
      status: 'repair-needed',
      text: 'Unrelated literature/data work produced audit-only artifacts and a recoverable CSV failure.',
      artifactRefs: [...LONG_CONTEXT_UNRELATED_ARTIFACT_REFS],
    },
    activeRun: { id: noiseRunId, status: 'repair-needed' },
    artifacts: LONG_CONTEXT_UNRELATED_ARTIFACT_REFS.map((ref) => ({ ref, label: ref.replace(/^artifact:/, '') })),
    executionProcess: [],
    recoverActions: ['Summarize noisy context before continuing.'],
    auditRefs: [
      ...LONG_CONTEXT_UNRELATED_ARTIFACT_REFS,
      'failure:r-mem-01-csv-parse',
      'audit:r-mem-01-long-context-truncation',
    ],
    verificationState: { status: 'failed' },
    diagnostics: [],
  };
}

function browserVisibleStateFromExpected(expected: WebE2eExpectedProjection): WebE2eBrowserVisibleState {
  const answer = expected.conversationProjection.visibleAnswer;
  return {
    status: answer?.status,
    visibleAnswerText: answer?.text,
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
  return artifacts.filter((artifactItem) => artifactItem.delivery?.role === role).map((artifactItem) => artifactItem.delivery?.ref ?? `artifact:${artifactItem.id}`);
}

function currentTurnRef(): WebE2eInitialRef {
  return {
    id: 'turn-r-mem-01-final',
    kind: 'user-turn',
    title: 'Final constraint check turn',
    ref: 'message:msg-r-mem-01-user-final',
    source: 'current-turn',
  };
}

function stableConstraintRef(): WebE2eInitialRef {
  return {
    id: 'ref-r-mem-01-original-constraint',
    kind: 'message',
    title: 'Original prose-only constraint',
    ref: constraintRef,
    source: 'run-audit',
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
