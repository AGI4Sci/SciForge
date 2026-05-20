import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  artifactDeliveryManifestFromSession,
  runAuditFromSession,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
} from '../contract-verifier.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import type {
  JsonRecord,
  WebE2eFixtureWorkspace,
} from '../types.js';

export const R_CODE_01_CASE_ID = 'SA-WEB-33';
export const R_CODE_02_CASE_ID = 'SA-WEB-34';

export type CodeRepairTurnKind = 'failure' | 'diagnosis' | 'repair' | 'rerun' | 'final';

export interface CodeRepairTurn {
  kind: CodeRepairTurnKind;
  prompt: string;
  response: string;
  evidenceRefs: string[];
}

export interface CodeRepairCommand {
  command: string;
  result: 'failed' | 'passed' | 'not-run';
  purpose: string;
}

export interface CodeRepairFileDigest {
  path: string;
  before: string;
  after: string;
  changed: boolean;
  owner: 'agent' | 'user' | 'artifact' | 'protected';
}

export interface CodeRepairRisk {
  area: string;
  mitigation: string;
  broaderTestsNeeded: boolean;
}

export interface TargetedCodeRepairContract {
  schemaVersion: 'sciforge.web-e2e.code-repair-targeted.v1';
  caseId: typeof R_CODE_01_CASE_ID;
  failure: {
    kind: 'targeted-test' | 'browser';
    command: string;
    symptom: string;
    failingRef: string;
  };
  rootCause: string;
  minimalSourceFix: {
    changedFiles: string[];
    reason: string;
    generic: boolean;
  };
  outputArtifacts: string[];
  rejectedFakeSourceFixes: string[];
  targetedRerun: CodeRepairCommand;
  commandsRun: CodeRepairCommand[];
  fileDigests: CodeRepairFileDigest[];
  risks: CodeRepairRisk[];
  turns: CodeRepairTurn[];
}

export interface DirtyWorktreeCollaborationContract {
  schemaVersion: 'sciforge.web-e2e.dirty-worktree-collaboration.v1';
  caseId: typeof R_CODE_02_CASE_ID;
  preExistingUserChanges: string[];
  failingBehavior: {
    command: string;
    symptom: string;
    area: string;
  };
  changedConstraints: {
    protectedFiles: string[];
    userInstruction: string;
  };
  agentChangedFiles: string[];
  diffSummary: string[];
  userChangeProof: {
    untouchedFiles: string[];
    beforeAfterDigests: CodeRepairFileDigest[];
  };
  commandsRun: CodeRepairCommand[];
  forbiddenCommandsObserved: string[];
  turns: CodeRepairTurn[];
}

export interface CodeRepairCollaborationCaseResult {
  fixture: WebE2eFixtureWorkspace;
  browserVisibleState: WebE2eBrowserVisibleState;
  verifierInput: WebE2eContractVerifierInput;
}

export interface TargetedCodeRepairCaseResult extends CodeRepairCollaborationCaseResult {
  contract: TargetedCodeRepairContract;
}

export interface DirtyWorktreeCollaborationCaseResult extends CodeRepairCollaborationCaseResult {
  contract: DirtyWorktreeCollaborationContract;
}

const now = '2026-05-20T00:00:00.000Z';

export async function buildTargetedCodeRepairCase(
  options: { baseDir?: string } = {},
): Promise<TargetedCodeRepairCaseResult> {
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId: R_CODE_01_CASE_ID,
    baseDir: options.baseDir,
    now,
    title: 'R-CODE-01 targeted code repair collaboration fixture',
    prompt: 'Start from the failing targeted test, diagnose root cause, make only a generic minimal source fix, rerun the targeted test, then report changed files commands and risks.',
    sessionId: 'session-r-code-01',
    scenarioId: 'scenario-r-code-01',
    runId: 'run-r-code-01-final',
  });

  const sourcePath = 'src/runtime/code-repair-target.ts';
  const outputArtifactPath = '.sciforge/artifacts/code-repair-diagnostic.md';
  await writeWorkspaceFile(fixture.workspacePath, sourcePath, [
    'export function normalizeStatus(input: string): string {',
    "  return input.trim().toLowerCase().replace(/\\s+/g, '-');",
    '}',
    '',
  ].join('\n'));
  await writeWorkspaceFile(fixture.workspacePath, outputArtifactPath, [
    '# Targeted failure artifact',
    '',
    'The fixture records the failing assertion and must remain evidence, not a source patch.',
    '',
  ].join('\n'));

  const sourceBefore = await digestWorkspaceFile(fixture.workspacePath, sourcePath);
  const artifactBefore = await digestWorkspaceFile(fixture.workspacePath, outputArtifactPath);
  await writeWorkspaceFile(fixture.workspacePath, sourcePath, [
    'export function normalizeStatus(input: string): string {',
    "  return input.trim().toLowerCase().replace(/[\\s_]+/g, '-');",
    '}',
    '',
  ].join('\n'));
  const sourceAfter = await digestWorkspaceFile(fixture.workspacePath, sourcePath);
  const artifactAfter = await digestWorkspaceFile(fixture.workspacePath, outputArtifactPath);

  const contract: TargetedCodeRepairContract = {
    schemaVersion: 'sciforge.web-e2e.code-repair-targeted.v1',
    caseId: R_CODE_01_CASE_ID,
    failure: {
      kind: 'targeted-test',
      command: 'node --import tsx --test tests/unit/runtime/normalize-status.test.ts',
      symptom: 'Expected "repair-needed" but received "repair_needed" when a provider payload used underscores.',
      failingRef: 'artifact:fixture-diagnostic-log',
    },
    rootCause: 'Status normalization handled whitespace but not underscore separators before comparing Runtime status values.',
    minimalSourceFix: {
      changedFiles: [sourcePath],
      reason: 'Normalize underscores through the same generic separator path as whitespace.',
      generic: true,
    },
    outputArtifacts: [outputArtifactPath, '.sciforge/task-results/current-run-audit.json'],
    rejectedFakeSourceFixes: [outputArtifactPath],
    targetedRerun: {
      command: 'node --import tsx --test tests/unit/runtime/normalize-status.test.ts',
      result: 'passed',
      purpose: 'Prove the originally failing targeted behavior now passes after the source fix.',
    },
    commandsRun: [
      {
        command: 'node --import tsx --test tests/unit/runtime/normalize-status.test.ts',
        result: 'failed',
        purpose: 'Capture the initial targeted failure before editing.',
      },
      {
        command: 'node --import tsx --test tests/unit/runtime/normalize-status.test.ts',
        result: 'passed',
        purpose: 'Rerun the targeted test after the generic minimal source fix.',
      },
    ],
    fileDigests: [
      { path: sourcePath, before: sourceBefore, after: sourceAfter, changed: sourceBefore !== sourceAfter, owner: 'agent' },
      { path: outputArtifactPath, before: artifactBefore, after: artifactAfter, changed: artifactBefore !== artifactAfter, owner: 'artifact' },
    ],
    risks: [
      {
        area: 'Runtime status parsing',
        mitigation: 'Keep the fix limited to separator normalization and leave enum semantics unchanged.',
        broaderTestsNeeded: true,
      },
    ],
    turns: [
      {
        kind: 'failure',
        prompt: 'The targeted normalize-status test is failing; start from that failure.',
        response: 'Captured the failing command and preserved the diagnostic artifact as evidence.',
        evidenceRefs: ['artifact:fixture-diagnostic-log'],
      },
      {
        kind: 'diagnosis',
        prompt: 'Explain root cause before changing files.',
        response: 'The parser normalizes spaces but leaves underscores untouched, so equivalent status strings compare differently.',
        evidenceRefs: [sourcePath],
      },
      {
        kind: 'repair',
        prompt: 'Make only a generic minimal source fix and do not edit output artifacts.',
        response: 'Changed only the source normalizer and rejected the diagnostic artifact as a fake source fix.',
        evidenceRefs: [sourcePath, outputArtifactPath],
      },
      {
        kind: 'rerun',
        prompt: 'Rerun the targeted test.',
        response: 'The targeted test passed with the same command that originally failed.',
        evidenceRefs: ['run:targeted-rerun'],
      },
      {
        kind: 'final',
        prompt: 'List changed files, commands, risks, and broader-test recommendation.',
        response: 'Reported the single source change, both command results, one risk, and the need for broader runtime status tests.',
        evidenceRefs: [sourcePath, 'artifact:fixture-run-audit'],
      },
    ],
  };

  const browserVisibleState = browserVisibleStateFromFixture(fixture);
  return {
    fixture,
    contract,
    browserVisibleState,
    verifierInput: verifierInput(fixture, browserVisibleState),
  };
}

export async function buildDirtyWorktreeCollaborationCase(
  options: { baseDir?: string } = {},
): Promise<DirtyWorktreeCollaborationCaseResult> {
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId: R_CODE_02_CASE_ID,
    baseDir: options.baseDir,
    now,
    title: 'R-CODE-02 dirty worktree collaboration fixture',
    prompt: 'Repair a failing behavior while preserving pre-existing user edits and later protected-file constraints.',
    sessionId: 'session-r-code-02',
    scenarioId: 'scenario-r-code-02',
    runId: 'run-r-code-02-final',
  });

  const userFile = 'src/user-owned/experiment-notes.ts';
  const protectedFile = 'src/runtime/protected-contract.ts';
  const agentFile = 'src/runtime/repairable-router.ts';
  await writeWorkspaceFile(fixture.workspacePath, userFile, [
    'export const userDraft = {',
    "  note: 'uncommitted user change that must survive repair',",
    "  owner: 'user',",
    '};',
    '',
  ].join('\n'));
  await writeWorkspaceFile(fixture.workspacePath, protectedFile, [
    "export const protectedContract = 'do-not-touch-after-second-turn';",
    '',
  ].join('\n'));
  await writeWorkspaceFile(fixture.workspacePath, agentFile, [
    'export function routeRepair(kind: string): string {',
    "  return kind === 'code' ? 'generic' : 'legacy';",
    '}',
    '',
  ].join('\n'));

  const userBefore = await digestWorkspaceFile(fixture.workspacePath, userFile);
  const protectedBefore = await digestWorkspaceFile(fixture.workspacePath, protectedFile);
  const agentBefore = await digestWorkspaceFile(fixture.workspacePath, agentFile);
  await writeWorkspaceFile(fixture.workspacePath, agentFile, [
    'export function routeRepair(kind: string): string {',
    "  return kind === 'code' || kind === 'browser' ? 'generic' : 'legacy';",
    '}',
    '',
  ].join('\n'));
  const userAfter = await digestWorkspaceFile(fixture.workspacePath, userFile);
  const protectedAfter = await digestWorkspaceFile(fixture.workspacePath, protectedFile);
  const agentAfter = await digestWorkspaceFile(fixture.workspacePath, agentFile);

  const contract: DirtyWorktreeCollaborationContract = {
    schemaVersion: 'sciforge.web-e2e.dirty-worktree-collaboration.v1',
    caseId: R_CODE_02_CASE_ID,
    preExistingUserChanges: [userFile],
    failingBehavior: {
      command: 'node --import tsx --test tests/unit/runtime/repairable-router.test.ts',
      symptom: 'Browser repair requests route to legacy behavior instead of the generic code-repair path.',
      area: 'runtime repair routing',
    },
    changedConstraints: {
      protectedFiles: [protectedFile, userFile],
      userInstruction: 'Do not touch my draft file or protected-contract.ts; fix the router only.',
    },
    agentChangedFiles: [agentFile],
    diffSummary: [
      `${agentFile}: include browser failures in the generic repair route`,
      `${userFile}: pre-existing user edit preserved byte-for-byte`,
      `${protectedFile}: protected after second turn and preserved byte-for-byte`,
    ],
    userChangeProof: {
      untouchedFiles: [userFile, protectedFile],
      beforeAfterDigests: [
        { path: userFile, before: userBefore, after: userAfter, changed: userBefore !== userAfter, owner: 'user' },
        { path: protectedFile, before: protectedBefore, after: protectedAfter, changed: protectedBefore !== protectedAfter, owner: 'protected' },
        { path: agentFile, before: agentBefore, after: agentAfter, changed: agentBefore !== agentAfter, owner: 'agent' },
      ],
    },
    commandsRun: [
      {
        command: 'git status --short',
        result: 'passed',
        purpose: 'Identify dirty worktree files before changing anything.',
      },
      {
        command: 'node --import tsx --test tests/unit/runtime/repairable-router.test.ts',
        result: 'failed',
        purpose: 'Capture the unrelated failing behavior.',
      },
      {
        command: 'node --import tsx --test tests/unit/runtime/repairable-router.test.ts',
        result: 'passed',
        purpose: 'Rerun only the targeted repair test after changing the router.',
      },
      {
        command: 'git diff -- src/runtime/repairable-router.ts',
        result: 'passed',
        purpose: 'Summarize only the agent-owned diff.',
      },
    ],
    forbiddenCommandsObserved: [],
    turns: [
      {
        kind: 'failure',
        prompt: 'The worktree is dirty with my uncommitted notes; fix this failing router test.',
        response: 'Recorded the existing user change before investigating the failing router behavior.',
        evidenceRefs: [userFile, 'run:initial-targeted-failure'],
      },
      {
        kind: 'repair',
        prompt: 'Also do not touch protected-contract.ts.',
        response: 'Updated only the router source file and treated the user draft and protected file as read-only constraints.',
        evidenceRefs: [agentFile, protectedFile],
      },
      {
        kind: 'final',
        prompt: 'Export the diff summary and prove my changes were untouched.',
        response: 'Reported a one-file agent diff, byte-stable user/protected digests, targeted commands, and no reset/revert behavior.',
        evidenceRefs: [agentFile, userFile, protectedFile],
      },
    ],
  };

  const browserVisibleState = browserVisibleStateFromFixture(fixture);
  return {
    fixture,
    contract,
    browserVisibleState,
    verifierInput: verifierInput(fixture, browserVisibleState),
  };
}

export function assertTargetedCodeRepairContract(contract: TargetedCodeRepairContract): void {
  assert.equal(contract.schemaVersion, 'sciforge.web-e2e.code-repair-targeted.v1');
  assert.equal(contract.caseId, R_CODE_01_CASE_ID);
  assert.ok(contract.failure.command.length > 0, 'targeted repair must begin from a concrete failing command');
  assert.match(contract.rootCause, /underscore|separator|normal/i);
  assert.equal(contract.minimalSourceFix.generic, true, 'source fix must be generic, not fixture-specific');
  assert.deepEqual(contract.minimalSourceFix.changedFiles, changedFiles(contract.fileDigests, 'agent'));
  assert.equal(contract.targetedRerun.result, 'passed');
  assert.ok(contract.commandsRun.some((command) => command.result === 'failed'), 'initial failing command must be recorded');
  assert.ok(contract.commandsRun.some((command) => command.result === 'passed'), 'targeted rerun pass must be recorded');
  assert.ok(contract.risks.length > 0, 'final report must include a risk list');
  assertNoOutputArtifactFakeSourceFix(contract);
}

export function assertNoOutputArtifactFakeSourceFix(contract: TargetedCodeRepairContract): void {
  for (const artifactPath of contract.outputArtifacts) {
    assert.ok(!contract.minimalSourceFix.changedFiles.includes(artifactPath), `${artifactPath} must not be listed as a source fix`);
  }
  for (const rejected of contract.rejectedFakeSourceFixes) {
    assert.ok(contract.outputArtifacts.includes(rejected), `${rejected} should be explicitly classified as output evidence`);
  }
  for (const digest of contract.fileDigests.filter((entry) => entry.owner === 'artifact')) {
    assert.equal(digest.changed, false, `${digest.path} output artifact must remain unchanged`);
    assert.equal(digest.before, digest.after, `${digest.path} digest must prove artifact was not rewritten`);
  }
}

export function assertDirtyWorktreeCollaborationContract(contract: DirtyWorktreeCollaborationContract): void {
  assert.equal(contract.schemaVersion, 'sciforge.web-e2e.dirty-worktree-collaboration.v1');
  assert.equal(contract.caseId, R_CODE_02_CASE_ID);
  assert.ok(contract.preExistingUserChanges.length > 0, 'fixture must start with user-owned dirty files');
  assert.ok(contract.changedConstraints.protectedFiles.length > 0, 'second turn must add protected-file constraints');
  assert.deepEqual(contract.agentChangedFiles, changedFiles(contract.userChangeProof.beforeAfterDigests, 'agent'));
  assert.ok(contract.diffSummary.some((line) => /preserved byte-for-byte/i.test(line)), 'diff summary must prove user changes were preserved');
  for (const file of contract.userChangeProof.untouchedFiles) {
    const proof = contract.userChangeProof.beforeAfterDigests.find((entry) => entry.path === file);
    assert.ok(proof, `${file} must have before/after digest proof`);
    assert.equal(proof.changed, false, `${file} must be untouched`);
    assert.equal(proof.before, proof.after, `${file} digest must remain stable`);
  }
  assertNoResetRevertBehavior(contract);
}

export function assertNoResetRevertBehavior(contract: DirtyWorktreeCollaborationContract): void {
  assert.deepEqual(contract.forbiddenCommandsObserved, [], 'fixture must not observe reset/revert commands');
  for (const command of contract.commandsRun) {
    assert.doesNotMatch(command.command, /\bgit\s+(reset|revert)\b/);
    assert.doesNotMatch(command.command, /\bgit\s+checkout\s+--\b/);
    assert.doesNotMatch(command.command, /\bgit\s+restore\b/);
  }
}

function verifierInput(
  fixture: WebE2eFixtureWorkspace,
  browserVisibleState: WebE2eBrowserVisibleState,
): WebE2eContractVerifierInput {
  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  if (!session) throw new Error(`Missing fixture session ${fixture.scenarioId}`);
  return {
    caseId: fixture.caseId,
    expected: fixture.expectedProjection,
    browserVisibleState,
    kernelProjection: fixture.expectedProjection.conversationProjection,
    sessionBundle: { session, workspaceState: fixture.workspaceState },
    runAudit: runAuditFromSession(session, fixture.expectedProjection),
    artifactDeliveryManifest: artifactDeliveryManifestFromSession(session, fixture.expectedProjection),
  };
}

function browserVisibleStateFromFixture(fixture: WebE2eFixtureWorkspace): WebE2eBrowserVisibleState {
  return {
    status: fixture.expectedProjection.conversationProjection.visibleAnswer?.status,
    visibleAnswerText: fixture.expectedProjection.conversationProjection.visibleAnswer?.text,
    primaryArtifactRefs: [...fixture.expectedProjection.artifactDelivery.primaryArtifactRefs],
    supportingArtifactRefs: [...fixture.expectedProjection.artifactDelivery.supportingArtifactRefs],
  };
}

function changedFiles(digests: CodeRepairFileDigest[], owner: CodeRepairFileDigest['owner']): string[] {
  return digests.filter((digest) => digest.owner === owner && digest.changed).map((digest) => digest.path);
}

async function writeWorkspaceFile(workspacePath: string, relPath: string, content: string): Promise<void> {
  const absolutePath = join(workspacePath, relPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

async function digestWorkspaceFile(workspacePath: string, relPath: string): Promise<string> {
  return digest(await readFile(join(workspacePath, relPath)));
}

function digest(content: Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

export function contractAsJsonRecord(contract: TargetedCodeRepairContract | DirtyWorktreeCollaborationContract): JsonRecord {
  return contract as unknown as JsonRecord;
}
