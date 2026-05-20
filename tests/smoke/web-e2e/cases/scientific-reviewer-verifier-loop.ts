import assert from 'node:assert/strict';

import type { ArtifactDeliveryRole, ObjectReference, RuntimeArtifact } from '@sciforge-ui/runtime-contract';

import {
  artifactDeliveryManifestFromSession,
  assertWebE2eContract,
  runAuditFromSession,
  verifyWebE2eContract,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
} from '../contract-verifier.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import type {
  JsonRecord,
  WebE2eArtifactDeliveryProjection,
  WebE2eExpectedProjection,
  WebE2eFixtureWorkspace,
} from '../types.js';

export const SCIENTIFIC_REVIEWER_VERIFIER_LOOP_CASE_ID = 'SA-WEB-35';

export type ScientificRequirementId = 'R-METHOD-01' | 'R-KG-01' | 'R-BIO-01' | 'R-VERIFY-01';

export interface ScientificReviewerVerifierLoopCase {
  requirementId: ScientificRequirementId;
  caseId: string;
  fixture: WebE2eFixtureWorkspace;
  rounds: ScientificRoundEvidence[];
  artifacts: ScientificArtifactEvidence[];
  browserVisibleState: WebE2eBrowserVisibleState;
  audit: ScientificAuditEvidence;
  verifierInput: WebE2eContractVerifierInput;
}

export interface ScientificRoundEvidence {
  round: 1 | 2 | 3;
  prompt: string;
  status: 'drafted' | 'reviewed' | 'repaired' | 'rejected';
  reviewerVerdict?: 'accept' | 'critique' | 'reject';
  refs: string[];
}

export interface ScientificArtifactEvidence {
  ref: string;
  kind:
    | 'protocol-package'
    | 'risk-register'
    | 'decision-log'
    | 'preregistration-checklist'
    | 'evidence-graph'
    | 'evidence-matrix'
    | 'change-my-mind'
    | 'reviewer-critique'
    | 'verification-checklist'
    | 'failure-modes'
    | 'analysis-artifact'
    | 'verifier-critique';
  version: 'v1' | 'v2';
  role: 'primary' | 'supporting' | 'audit';
  body: JsonRecord;
  supersedes?: string;
  historyRefs?: string[];
}

export interface ScientificAuditEvidence {
  requirementId: ScientificRequirementId;
  uiStatus: 'completed' | 'needs-repair';
  artifactRefs: string[];
  auditRefs: string[];
  reviewerCritiqueRefs: string[];
  verifierVerdict?: 'pass' | 'critique' | 'reject';
  completionDeclaredByVerifierOnly?: boolean;
}

export interface ScientificLiveVerificationPlan {
  schemaVersion: 'sciforge.real-task-scientific-live-verification-plan.v1';
  taskId: ScientificRequirementId;
  saWebCaseId: typeof SCIENTIFIC_REVIEWER_VERIFIER_LOOP_CASE_ID;
  status: 'ready-for-main-thread-live-verification';
  source: {
    projectPath: 'PROJECT.md';
    manifestPath: string;
    offlineContractCaseId: string;
    offlineContractIsLivePass: false;
  };
  liveEntrypoint: {
    browser: 'codex-in-app-browser-default-chat';
    preferredFrontendPort: 5177;
    preferredBackendPort: 6177;
    startedFromDefaultChatEntry: true;
    requiresRuntimeCodex: true;
    allowsFixturePass: false;
    allowsSeedDemoPass: false;
  };
  turnPlan: Array<{
    round: 1 | 2 | 3;
    promptIntent: string;
    expectedStatus: ScientificRoundEvidence['status'];
    requiredRefs: string[];
    reviewerVerdict?: ScientificRoundEvidence['reviewerVerdict'];
  }>;
  selectedRefPolicy: {
    requiresSelectedRefOrExplicitExemption: true;
    preferredSelectedRefs: string[];
    latestArtifactShortcutAllowed: false;
    fullArtifactBodyReplayAllowed: false;
  };
  requiredArtifactKinds: string[];
  taskSpecificAssertions: string[];
  passEvidenceChecklist: string[];
  releaseCheckoff: {
    manifestMustRemainNonPassedUntilLiveEvidence: true;
    mainThreadCanCheckOffAfter: string[];
  };
}

const now = '2026-05-20T00:00:00.000Z';

export async function buildScientificReviewerVerifierLoopCases(options: {
  baseDir?: string;
} = {}): Promise<ScientificReviewerVerifierLoopCase[]> {
  return [
    await buildScientificReviewerVerifierLoopCase('R-METHOD-01', options),
    await buildScientificReviewerVerifierLoopCase('R-KG-01', options),
    await buildScientificReviewerVerifierLoopCase('R-BIO-01', options),
    await buildScientificReviewerVerifierLoopCase('R-VERIFY-01', options),
  ];
}

export async function buildScientificReviewerVerifierLoopCase(
  requirementId: ScientificRequirementId,
  options: { baseDir?: string } = {},
): Promise<ScientificReviewerVerifierLoopCase> {
  const caseId = `${SCIENTIFIC_REVIEWER_VERIFIER_LOOP_CASE_ID}-${requirementId}`;
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId,
    baseDir: options.baseDir,
    now,
    title: `${requirementId} scientific reviewer/verifier offline contract`,
    prompt: promptFor(requirementId),
  });
  const spec = specFor(requirementId);
  applyScientificArtifactsToFixture(fixture, spec.artifacts, spec.visibleText);
  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  const browserVisibleState = browserStateFromFixture(fixture, spec.visibleText);
  const verifierInput: WebE2eContractVerifierInput = {
    caseId: fixture.caseId,
    expected: fixture.expectedProjection,
    browserVisibleState,
    kernelProjection: fixture.expectedProjection.conversationProjection,
    sessionBundle: { session, workspaceState: fixture.workspaceState },
    runAudit: runAuditFromSession(session, fixture.expectedProjection),
    artifactDeliveryManifest: artifactDeliveryManifestFromSession(session, fixture.expectedProjection),
  };
  assertWebE2eContract(verifierInput);
  const result: ScientificReviewerVerifierLoopCase = {
    requirementId,
    caseId,
    fixture,
    rounds: spec.rounds,
    artifacts: spec.artifacts,
    browserVisibleState,
    audit: {
      requirementId,
      uiStatus: 'completed',
      artifactRefs: spec.artifacts.filter((artifact) => artifact.role !== 'audit').map((artifact) => artifact.ref),
      auditRefs: spec.artifacts.filter((artifact) => artifact.role === 'audit').map((artifact) => artifact.ref),
      reviewerCritiqueRefs: spec.artifacts.filter((artifact) => artifact.kind === 'reviewer-critique' || artifact.kind === 'verifier-critique').map((artifact) => artifact.ref),
      verifierVerdict: requirementId === 'R-VERIFY-01' ? 'pass' : undefined,
      completionDeclaredByVerifierOnly: false,
    },
    verifierInput,
  };
  assertScientificReviewerVerifierLoopCase(result);
  return result;
}

export function assertScientificReviewerVerifierLoopCase(value: ScientificReviewerVerifierLoopCase): void {
  const verification = verifyWebE2eContract(value.verifierInput);
  assert.equal(verification.ok, true, verification.failures.join('\n'));
  assert.deepEqual(value.rounds.map((round) => round.round), [1, 2, 3], `${value.requirementId}: must cover three-turn reviewer loop`);
  assert.equal(value.audit.uiStatus, 'completed', `${value.requirementId}: terminal UI status must be completed`);
  assert.equal(value.audit.completionDeclaredByVerifierOnly, false, `${value.requirementId}: verifier critique alone must not declare completion`);

  if (value.requirementId === 'R-METHOD-01') assertMethodProtocolReviewerLoop(value);
  if (value.requirementId === 'R-KG-01') assertBiomedicalEvidenceGraphLoop(value);
  if (value.requirementId === 'R-BIO-01') assertSingleCellPerturbationReviewerLoop(value);
  if (value.requirementId === 'R-VERIFY-01') assertVerifierCritiqueRepairLoop(value);
}

export function buildScientificLiveVerificationPlan(value: ScientificReviewerVerifierLoopCase): ScientificLiveVerificationPlan {
  const preferredSelectedRefs = value.artifacts
    .filter((artifactEvidence) => artifactEvidence.role === 'primary' && artifactEvidence.version === 'v2')
    .map((artifactEvidence) => artifactEvidence.ref);
  return {
    schemaVersion: 'sciforge.real-task-scientific-live-verification-plan.v1',
    taskId: value.requirementId,
    saWebCaseId: SCIENTIFIC_REVIEWER_VERIFIER_LOOP_CASE_ID,
    status: 'ready-for-main-thread-live-verification',
    source: {
      projectPath: 'PROJECT.md',
      manifestPath: `docs/test-artifacts/real-tasks/${value.requirementId}/manifest.json`,
      offlineContractCaseId: value.caseId,
      offlineContractIsLivePass: false,
    },
    liveEntrypoint: {
      browser: 'codex-in-app-browser-default-chat',
      preferredFrontendPort: 5177,
      preferredBackendPort: 6177,
      startedFromDefaultChatEntry: true,
      requiresRuntimeCodex: true,
      allowsFixturePass: false,
      allowsSeedDemoPass: false,
    },
    turnPlan: value.rounds.map((roundEvidence) => ({
      round: roundEvidence.round,
      promptIntent: roundEvidence.prompt,
      expectedStatus: roundEvidence.status,
      requiredRefs: [...roundEvidence.refs],
      ...(roundEvidence.reviewerVerdict ? { reviewerVerdict: roundEvidence.reviewerVerdict } : {}),
    })),
    selectedRefPolicy: {
      requiresSelectedRefOrExplicitExemption: true,
      preferredSelectedRefs,
      latestArtifactShortcutAllowed: false,
      fullArtifactBodyReplayAllowed: false,
    },
    requiredArtifactKinds: value.artifacts.map((artifactEvidence) => `${artifactEvidence.kind}:${artifactEvidence.version}`),
    taskSpecificAssertions: taskSpecificAssertionsFor(value.requirementId),
    passEvidenceChecklist: [
      'task-specific-live-attempt',
      'three-turn-record',
      'visible-dom-answer',
      'screenshot',
      'runtime-audit-refs',
      'workspace-artifact-or-explicit-no-artifact-reason',
      'command-or-test-output',
      'provider-model-profile',
      'selected-ref-policy-or-explicit-exemption',
      'port-url-and-run-identifiers',
    ],
    releaseCheckoff: {
      manifestMustRemainNonPassedUntilLiveEvidence: true,
      mainThreadCanCheckOffAfter: [
        'manifest status is passed',
        'releaseEligible is true and releaseBlocking is false',
        'visible UI, artifact paths, audit refs, and provider/model/profile are recorded',
        'PROJECT.md is updated only by the main thread after live verification',
      ],
    },
  };
}

export function assertScientificLiveVerificationPlan(
  plan: ScientificLiveVerificationPlan,
  value: ScientificReviewerVerifierLoopCase,
): void {
  assert.deepEqual(plan, buildScientificLiveVerificationPlan(value), `${value.requirementId}: live verification plan must mirror the SA-WEB-35 contract`);
  assert.equal(plan.source.offlineContractIsLivePass, false, `${value.requirementId}: offline contract cannot masquerade as a live pass`);
  assert.equal(plan.liveEntrypoint.preferredFrontendPort, 5177, `${value.requirementId}: group D live browser port must be 5177`);
  assert.equal(plan.liveEntrypoint.preferredBackendPort, 6177, `${value.requirementId}: group D backend port must be 6177`);
  assert.equal(plan.liveEntrypoint.allowsFixturePass, false, `${value.requirementId}: fixture evidence cannot pass the real task`);
  assert.equal(plan.liveEntrypoint.allowsSeedDemoPass, false, `${value.requirementId}: seed/demo evidence cannot pass the real task`);
  assert.equal(plan.releaseCheckoff.manifestMustRemainNonPassedUntilLiveEvidence, true, `${value.requirementId}: checkoff requires live manifest evidence`);
}

function assertMethodProtocolReviewerLoop(value: ScientificReviewerVerifierLoopCase): void {
  const protocolV1 = artifact(value, 'protocol-package', 'v1');
  const protocolV2 = artifact(value, 'protocol-package', 'v2');
  assert.equal(protocolV2.supersedes, protocolV1.ref, 'R-METHOD-01: protocol v2 must supersede v1');
  for (const key of ['budget', 'timeline', 'exclusionCriteria']) {
    assert.notDeepEqual(protocolV2.body[key], protocolV1.body[key], `R-METHOD-01: ${key} must update in protocol package v2`);
    assert.equal(inHistory(protocolV2, key, protocolV1.body[key]), true, `R-METHOD-01: old ${key} may survive only in history`);
  }
  for (const kind of ['risk-register', 'decision-log', 'preregistration-checklist'] as const) {
    const dependent = artifact(value, kind, 'v2');
    assert.equal(dependent.body.protocolPackageRef, protocolV2.ref, `R-METHOD-01: ${kind} must point at protocol package v2`);
    assert.equal(dependent.body.version, 'v2', `R-METHOD-01: ${kind} must be exported as v2`);
  }
}

function assertBiomedicalEvidenceGraphLoop(value: ScientificReviewerVerifierLoopCase): void {
  const graph = artifact(value, 'evidence-graph', 'v2');
  const edges = arrayRecords(graph.body.edges);
  assert.ok(edges.length > 0, 'R-KG-01: evidence graph must contain edges');
  for (const edge of edges) {
    assert.ok(arrayStrings(edge.evidenceRefs).length > 0, `R-KG-01: edge ${String(edge.id ?? '')} must carry evidence refs`);
  }
  const contradicted = edges.find((edge) => edge.contradiction === true);
  assert.ok(contradicted, 'R-KG-01: contradictory paper or condition must be represented');
  assert.notEqual(contradicted.confidenceBefore, contradicted.confidenceAfter, 'R-KG-01: contradictions must change confidence');
  assert.ok(arrayStrings(contradicted.evidenceRefs).some((ref) => ref.includes('contradiction')), 'R-KG-01: contradiction edge must cite contradiction evidence');
  assert.ok(artifact(value, 'evidence-matrix', 'v2').body.graphRef === graph.ref, 'R-KG-01: evidence matrix must reference final graph');
  assert.ok(artifact(value, 'change-my-mind', 'v2').body.graphRef === graph.ref, 'R-KG-01: change-my-mind artifact must reference final graph');
}

function assertSingleCellPerturbationReviewerLoop(value: ScientificReviewerVerifierLoopCase): void {
  const protocolV1 = artifact(value, 'protocol-package', 'v1');
  const protocolV2 = artifact(value, 'protocol-package', 'v2');
  const critique = artifact(value, 'reviewer-critique', 'v2');
  const checklist = artifact(value, 'verification-checklist', 'v2');
  assert.equal(critique.body.verdict, 'reject', 'R-BIO-01: reviewer must reject the key assumption before revision');
  assert.equal(protocolV2.supersedes, protocolV1.ref, 'R-BIO-01: revised protocol must supersede the rejected package');
  assert.notDeepEqual(protocolV2.body.assumptions, protocolV1.body.assumptions, 'R-BIO-01: revision must change protocol assumptions, not only chat prose');
  assert.equal(protocolV2.body.reviewerCritiqueRef, critique.ref, 'R-BIO-01: protocol v2 must cite reviewer rejection');
  assert.equal(checklist.body.pass, false, 'R-BIO-01: verification without evidence cannot pass');
  assert.ok(arrayStrings(checklist.body.missingEvidence).length > 0, 'R-BIO-01: failed verification must list missing evidence');
  assert.ok(artifact(value, 'failure-modes', 'v2').body.protocolPackageRef === protocolV2.ref, 'R-BIO-01: failure modes must follow revised protocol');
}

function assertVerifierCritiqueRepairLoop(value: ScientificReviewerVerifierLoopCase): void {
  const analysisV1 = artifact(value, 'analysis-artifact', 'v1');
  const analysisV2 = artifact(value, 'analysis-artifact', 'v2');
  const critique = artifact(value, 'verifier-critique', 'v2');
  assert.equal(critique.body.verdict, 'reject', 'R-VERIFY-01: verifier output must be critique/rejection evidence');
  assert.equal(analysisV2.supersedes, analysisV1.ref, 'R-VERIFY-01: repaired artifact must supersede rejected analysis');
  assert.notDeepEqual(analysisV2.body.validationEvidence, analysisV1.body.validationEvidence, 'R-VERIFY-01: repair must change artifact validation evidence');
  assert.equal(analysisV2.body.verifierCritiqueRef, critique.ref, 'R-VERIFY-01: repaired artifact must cite verifier critique');
  assert.equal(value.audit.verifierVerdict, 'pass', 'R-VERIFY-01: final pass requires audit verdict after repair');
  assert.ok(value.audit.artifactRefs.includes(analysisV2.ref), 'R-VERIFY-01: audit must include repaired artifact ref');
  assert.ok(value.browserVisibleState.visibleArtifactRefs?.includes(analysisV2.ref), 'R-VERIFY-01: UI must expose repaired artifact ref');
  assert.ok(value.verifierInput.runAudit.refs.includes(critique.ref), 'R-VERIFY-01: RunAudit must retain verifier critique ref');
}

function applyScientificArtifactsToFixture(
  fixture: WebE2eFixtureWorkspace,
  artifacts: ScientificArtifactEvidence[],
  visibleText: string,
): void {
  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  const runtimeArtifacts = artifacts.map((entry) => runtimeArtifact(fixture, entry));
  session.artifacts = [...session.artifacts, ...runtimeArtifacts];
  session.executionUnits = [
    ...(session.executionUnits ?? []),
    {
      id: `eu-${fixture.caseId}-scientific-contract`,
      tool: 'web-e2e.scientific-reviewer-verifier-fixture',
      params: `requirement=${fixture.caseId}`,
      status: 'done',
      hash: `hash-${fixture.caseId}`,
      runId: fixture.runId,
      outputRef: artifacts[0]?.ref,
      outputArtifacts: artifacts.map((entry) => entry.ref.replace(/^artifact:/, '')),
      time: now,
    },
  ];
  const agentMessage = session.messages.find((message) => message.role === 'scenario');
  if (agentMessage) {
    agentMessage.content = visibleText;
    agentMessage.objectReferences = [...(agentMessage.objectReferences ?? []), ...runtimeArtifacts.map((entry) => objectReferenceFromArtifact(entry, fixture.runId))];
  }
  const run = session.runs.find((candidate) => candidate.id === fixture.runId);
  if (run) {
    run.response = visibleText;
    run.objectReferences = [...(run.objectReferences ?? []), ...runtimeArtifacts.map((entry) => objectReferenceFromArtifact(entry, fixture.runId))];
  }
  const artifactDelivery = artifactDeliveryProjection([...session.artifacts]);
  fixture.expectedProjection.artifactDelivery = artifactDelivery;
  fixture.expectedProjection.runAuditRefs = [
    ...new Set([
      ...fixture.expectedProjection.runAuditRefs,
      ...artifacts.filter((entry) => entry.role === 'audit').map((entry) => entry.ref),
      ...artifacts.filter((entry) => entry.kind === 'reviewer-critique' || entry.kind === 'verifier-critique').map((entry) => entry.ref),
    ]),
  ];
  replaceVisibleAnswerText(fixture.expectedProjection, visibleText);
  if (run?.raw && typeof run.raw === 'object') replaceRunProjectionText(run.raw as JsonRecord, fixture.expectedProjection, visibleText);
}

function browserStateFromFixture(fixture: WebE2eFixtureWorkspace, visibleText: string): WebE2eBrowserVisibleState {
  return {
    status: fixture.expectedProjection.conversationProjection.visibleAnswer?.status,
    visibleAnswerText: visibleText,
    visibleArtifactRefs: [
      ...fixture.expectedProjection.artifactDelivery.primaryArtifactRefs,
      ...fixture.expectedProjection.artifactDelivery.supportingArtifactRefs,
    ],
    primaryArtifactRefs: [...fixture.expectedProjection.artifactDelivery.primaryArtifactRefs],
    supportingArtifactRefs: [...fixture.expectedProjection.artifactDelivery.supportingArtifactRefs],
    auditRefs: [],
    diagnosticRefs: [],
    internalRefs: [],
  };
}

function specFor(requirementId: ScientificRequirementId): {
  rounds: ScientificRoundEvidence[];
  artifacts: ScientificArtifactEvidence[];
  visibleText: string;
} {
  if (requirementId === 'R-METHOD-01') {
    const protocolV1 = artifactRef(requirementId, 'protocol-package', 'v1');
    const protocolV2 = artifactRef(requirementId, 'protocol-package', 'v2');
    return {
      visibleText: 'Protocol package v2, risk register, decision log, and preregistration checklist are aligned after reviewer updates.',
      rounds: [
        round(1, 'Generate protocol package from literature/data artifacts.', 'drafted', [protocolV1]),
        round(2, 'Revise budget, timeline, and exclusion criteria.', 'reviewed', [protocolV2]),
        round(3, 'Export risk register, decision log, and preregistration checklist.', 'repaired', [
          protocolV2,
          artifactRef(requirementId, 'risk-register', 'v2'),
          artifactRef(requirementId, 'decision-log', 'v2'),
          artifactRef(requirementId, 'preregistration-checklist', 'v2'),
        ]),
      ],
      artifacts: [
        protocolArtifact(requirementId, 'v1', {
          budget: { currency: 'USD', total: 42000 },
          timeline: { weeks: 8 },
          exclusionCriteria: ['current steroid use'],
          history: [],
        }),
        protocolArtifact(requirementId, 'v2', {
          budget: { currency: 'USD', total: 56000 },
          timeline: { weeks: 12 },
          exclusionCriteria: ['current steroid use', 'recent biologic therapy', 'failed consent comprehension check'],
          history: [
            { field: 'budget', previous: { currency: 'USD', total: 42000 } },
            { field: 'timeline', previous: { weeks: 8 } },
            { field: 'exclusionCriteria', previous: ['current steroid use'] },
          ],
        }, protocolV1),
        dependentArtifact(requirementId, 'risk-register', protocolV2),
        dependentArtifact(requirementId, 'decision-log', protocolV2),
        dependentArtifact(requirementId, 'preregistration-checklist', protocolV2),
      ],
    };
  }
  if (requirementId === 'R-KG-01') {
    const graphRef = artifactRef(requirementId, 'evidence-graph', 'v2');
    return {
      visibleText: 'Biomedical evidence graph v2 includes contradiction-aware confidence, evidence matrix, and change-my-mind criteria.',
      rounds: [
        round(1, 'Generate biomedical relation graph with sources and confidence.', 'drafted', [artifactRef(requirementId, 'evidence-graph', 'v1')]),
        round(2, 'Add contradictory paper or condition.', 'reviewed', [graphRef]),
        round(3, 'Export evidence matrix and what-would-change-my-mind.', 'repaired', [
          graphRef,
          artifactRef(requirementId, 'evidence-matrix', 'v2'),
          artifactRef(requirementId, 'change-my-mind', 'v2'),
        ]),
      ],
      artifacts: [
        graphArtifact(requirementId, 'v1', false),
        graphArtifact(requirementId, 'v2', true, artifactRef(requirementId, 'evidence-graph', 'v1')),
        {
          ref: artifactRef(requirementId, 'evidence-matrix', 'v2'),
          kind: 'evidence-matrix',
          version: 'v2',
          role: 'supporting',
          body: { version: 'v2', graphRef, rows: [{ edgeId: 'edge-il6-crp', refs: ['paper:primary-il6-crp', 'paper:contradiction-condition'] }] },
        },
        {
          ref: artifactRef(requirementId, 'change-my-mind', 'v2'),
          kind: 'change-my-mind',
          version: 'v2',
          role: 'supporting',
          body: { version: 'v2', graphRef, criteria: ['prospective cohort refuting IL6->CRP under treated condition'] },
        },
      ],
    };
  }
  if (requirementId === 'R-BIO-01') {
    const protocolV1 = artifactRef(requirementId, 'protocol-package', 'v1');
    const protocolV2 = artifactRef(requirementId, 'protocol-package', 'v2');
    const critiqueRef = artifactRef(requirementId, 'reviewer-critique', 'v2');
    return {
      visibleText: 'Single-cell perturbation protocol was rejected, revised in the protocol package, and left verification failed until missing evidence exists.',
      rounds: [
        round(1, 'Generate single-cell perturbation biomarker protocol and reviewer critique.', 'drafted', [protocolV1, critiqueRef]),
        round(2, 'Add verification checklist and failure modes.', 'reviewed', [artifactRef(requirementId, 'verification-checklist', 'v2')]),
        round(3, 'Reviewer rejects key assumption; revise protocol package.', 'rejected', [protocolV2, critiqueRef], 'reject'),
      ],
      artifacts: [
        protocolArtifact(requirementId, 'v1', { assumptions: ['CD8 marker shift implies causal rescue'], modality: 'Perturb-seq' }),
        {
          ref: critiqueRef,
          kind: 'reviewer-critique',
          version: 'v2',
          role: 'audit',
          body: { verdict: 'reject', rejectedAssumption: 'CD8 marker shift implies causal rescue', refs: ['paper:perturb-negative-control'] },
        },
        {
          ref: artifactRef(requirementId, 'verification-checklist', 'v2'),
          kind: 'verification-checklist',
          version: 'v2',
          role: 'supporting',
          body: { version: 'v2', pass: false, missingEvidence: ['orthogonal protein validation', 'replicate donor perturbation'] },
        },
        {
          ref: artifactRef(requirementId, 'failure-modes', 'v2'),
          kind: 'failure-modes',
          version: 'v2',
          role: 'supporting',
          body: { version: 'v2', protocolPackageRef: protocolV2, modes: ['guide toxicity', 'batch-specific ambient RNA'] },
        },
        protocolArtifact(requirementId, 'v2', {
          assumptions: ['CD8 marker shift is only a screening signal until orthogonal rescue evidence exists'],
          reviewerCritiqueRef: critiqueRef,
          modality: 'Perturb-seq plus protein validation gate',
        }, protocolV1),
      ],
    };
  }
  const critiqueRef = artifactRef(requirementId, 'verifier-critique', 'v2');
  const analysisV1 = artifactRef(requirementId, 'analysis-artifact', 'v1');
  const analysisV2 = artifactRef(requirementId, 'analysis-artifact', 'v2');
  return {
    visibleText: 'Verifier critique rejected part of the analysis, then artifact, UI status, and audit evidence aligned after repair.',
    rounds: [
      round(1, 'Generate analysis artifact with validation criteria.', 'drafted', [analysisV1]),
      round(2, 'Verifier critiques and rejects part of the artifact.', 'rejected', [critiqueRef], 'reject'),
      round(3, 'Repair artifact and explain verification evidence changes.', 'repaired', [analysisV2, critiqueRef]),
    ],
    artifacts: [
      {
        ref: analysisV1,
        kind: 'analysis-artifact',
        version: 'v1',
        role: 'primary',
        body: { version: 'v1', validationCriteria: ['schema checks', 'effect direction'], validationEvidence: ['schema-only'], status: 'rejected' },
      },
      {
        ref: critiqueRef,
        kind: 'verifier-critique',
        version: 'v2',
        role: 'audit',
        body: { verdict: 'reject', rejectedCriteria: ['effect direction'], refs: ['audit:verifier-round-2'] },
      },
      {
        ref: analysisV2,
        kind: 'analysis-artifact',
        version: 'v2',
        role: 'primary',
        supersedes: analysisV1,
        body: {
          version: 'v2',
          validationCriteria: ['schema checks', 'effect direction'],
          validationEvidence: ['schema-check-ref', 'effect-direction-rerun-ref'],
          verifierCritiqueRef: critiqueRef,
          status: 'passed-after-repair',
        },
      },
    ],
  };
}

function promptFor(requirementId: ScientificRequirementId): string {
  return `Offline Web E2E contract for ${requirementId}: exercise reviewer/verifier loop using fixture artifacts only.`;
}

function taskSpecificAssertionsFor(requirementId: ScientificRequirementId): string[] {
  if (requirementId === 'R-METHOD-01') {
    return [
      'protocol-v2-supersedes-v1',
      'budget-timeline-exclusion-criteria-change',
      'old-values-history-only',
      'risk-register-decision-log-preregistration-checklist-reference-protocol-v2',
    ];
  }
  if (requirementId === 'R-KG-01') {
    return [
      'graph-edges-carry-evidence-refs',
      'contradictory-paper-or-condition-is-represented',
      'contradiction-changes-confidence',
      'evidence-matrix-and-change-my-mind-reference-final-graph',
    ];
  }
  if (requirementId === 'R-BIO-01') {
    return [
      'reviewer-rejects-key-assumption',
      'verification-without-evidence-does-not-pass',
      'revised-protocol-cites-reviewer-critique',
      'revision-changes-protocol-artifact-not-chat-prose-only',
    ];
  }
  return [
    'verifier-output-is-critique-not-completion',
    'repaired-analysis-supersedes-rejected-analysis',
    'validation-evidence-changes-after-repair',
    'artifact-ui-status-and-audit-refs-align-before-pass',
  ];
}

function round(
  roundNumber: 1 | 2 | 3,
  prompt: string,
  status: ScientificRoundEvidence['status'],
  refs: string[],
  reviewerVerdict?: ScientificRoundEvidence['reviewerVerdict'],
): ScientificRoundEvidence {
  return { round: roundNumber, prompt, status, refs, reviewerVerdict };
}

function protocolArtifact(
  requirementId: ScientificRequirementId,
  version: 'v1' | 'v2',
  body: JsonRecord,
  supersedes?: string,
): ScientificArtifactEvidence {
  return {
    ref: artifactRef(requirementId, 'protocol-package', version),
    kind: 'protocol-package',
    version,
    role: 'primary',
    supersedes,
    historyRefs: supersedes ? [supersedes] : [],
    body: { version, ...body },
  };
}

function dependentArtifact(
  requirementId: ScientificRequirementId,
  kind: 'risk-register' | 'decision-log' | 'preregistration-checklist',
  protocolPackageRef: string,
): ScientificArtifactEvidence {
  return {
    ref: artifactRef(requirementId, kind, 'v2'),
    kind,
    version: 'v2',
    role: 'supporting',
    body: { version: 'v2', protocolPackageRef, status: 'aligned-to-protocol-v2' },
  };
}

function graphArtifact(requirementId: ScientificRequirementId, version: 'v1' | 'v2', contradicted: boolean, supersedes?: string): ScientificArtifactEvidence {
  return {
    ref: artifactRef(requirementId, 'evidence-graph', version),
    kind: 'evidence-graph',
    version,
    role: 'primary',
    supersedes,
    body: {
      version,
      relation: 'IL6 increases CRP in treated inflammatory cohort',
      edges: contradicted
        ? [
          { id: 'edge-il6-crp', evidenceRefs: ['paper:primary-il6-crp', 'paper:contradiction-condition'], confidenceBefore: 0.82, confidenceAfter: 0.56, contradiction: true },
        ]
        : [
          { id: 'edge-il6-crp', evidenceRefs: ['paper:primary-il6-crp'], confidenceBefore: 0.82, confidenceAfter: 0.82, contradiction: false },
        ],
    },
  };
}

function artifactRef(requirementId: ScientificRequirementId, kind: ScientificArtifactEvidence['kind'], version: 'v1' | 'v2'): string {
  return `artifact:${requirementId.toLowerCase()}-${kind}-${version}`;
}

function artifact(
  value: ScientificReviewerVerifierLoopCase,
  kind: ScientificArtifactEvidence['kind'],
  version: 'v1' | 'v2',
): ScientificArtifactEvidence {
  const found = value.artifacts.find((candidate) => candidate.kind === kind && candidate.version === version);
  assert.ok(found, `${value.requirementId}: missing ${kind} ${version}`);
  return found;
}

function runtimeArtifact(fixture: WebE2eFixtureWorkspace, entry: ScientificArtifactEvidence): RuntimeArtifact {
  const id = entry.ref.replace(/^artifact:/, '');
  const deliveryRole: ArtifactDeliveryRole = entry.role === 'primary' ? 'primary-deliverable' : entry.role === 'supporting' ? 'supporting-evidence' : 'audit';
  return {
    id,
    type: entry.kind,
    producerScenario: fixture.scenarioId,
    schemaVersion: '1',
    metadata: { title: `${entry.kind} ${entry.version}`, runId: fixture.runId, body: entry.body, supersedes: entry.supersedes },
    dataRef: `.sciforge/task-results/${id}.json`,
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: entry.ref,
      role: deliveryRole,
      declaredMediaType: 'application/json',
      declaredExtension: 'json',
      contentShape: 'raw-file',
      readableRef: `.sciforge/task-results/${id}.json`,
      rawRef: `.sciforge/task-results/${id}.json`,
      previewPolicy: entry.role === 'audit' ? 'audit-only' : 'inline',
    },
    visibility: 'project-record',
  };
}

function objectReferenceFromArtifact(artifact: RuntimeArtifact, runId: string): ObjectReference {
  return {
    id: `object-${artifact.id}`,
    title: String(artifact.metadata?.title ?? artifact.id),
    kind: 'artifact' as const,
    ref: artifact.delivery?.ref ?? `artifact:${artifact.id}`,
    artifactType: artifact.type,
    runId,
    preferredView: 'report-viewer',
    presentationRole: artifact.delivery?.role,
    actions: ['focus-right-pane', 'copy-path'],
    status: 'available' as const,
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

function refsForRole(artifacts: RuntimeArtifact[], role: ArtifactDeliveryRole): string[] {
  return artifacts
    .filter((candidate) => candidate.delivery?.role === role)
    .map((candidate) => candidate.delivery?.ref ?? `artifact:${candidate.id}`);
}

function replaceVisibleAnswerText(expected: WebE2eExpectedProjection, visibleText: string): void {
  const visibleAnswer = expected.conversationProjection.visibleAnswer;
  if (visibleAnswer && 'text' in visibleAnswer) visibleAnswer.text = visibleText;
}

function replaceRunProjectionText(raw: JsonRecord, expected: WebE2eExpectedProjection, visibleText: string): void {
  const projections = [
    record(record(raw.displayIntent)?.conversationProjection),
    record(record(record(raw.displayIntent)?.taskOutcomeProjection)?.conversationProjection),
    record(record(raw.resultPresentation)?.conversationProjection),
  ];
  for (const projection of projections) {
    const visibleAnswer = record(projection?.visibleAnswer);
    if (visibleAnswer && typeof visibleAnswer.text === 'string') visibleAnswer.text = visibleText;
  }
  const displayIntent = record(raw.displayIntent);
  if (displayIntent) displayIntent.conversationProjection = expected.conversationProjection as unknown as JsonRecord;
  const resultPresentation = record(raw.resultPresentation);
  if (resultPresentation) resultPresentation.conversationProjection = expected.conversationProjection as unknown as JsonRecord;
}

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((entry): entry is JsonRecord => Boolean(record(entry))) : [];
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function inHistory(artifactEvidence: ScientificArtifactEvidence, field: string, previous: unknown): boolean {
  return arrayRecords(artifactEvidence.body.history).some((entry) => entry.field === field && assertableDeepEqual(entry.previous, previous));
}

function assertableDeepEqual(left: unknown, right: unknown): boolean {
  try {
    assert.deepEqual(left, right);
    return true;
  } catch {
    return false;
  }
}
