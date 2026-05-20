import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import {
  assertLiteratureCurrentAndSelectedReportCase,
  buildLiteratureCurrentAndSelectedReportCase,
} from './web-e2e/cases/literature-current-and-selected-report.js';
import {
  assertLiteratureEvidenceConflictCase,
  runLiteratureEvidenceConflictCase,
} from './web-e2e/cases/literature-evidence-conflict.js';

const defaultChatEntrypoint = 'codex-in-app-browser-default-chat';
const taskSpecificLiveAttempt = 'task-specific-live-attempt';
const syntheticEvidencePattern = /\b(?:fixture|mock|seed|demo)\b/i;

const outputRoot = await mkdtemp(join(tmpdir(), 'sciforge-real-task-literature-web-gates-'));

try {
  const currentAndSelected = buildLiteratureCurrentAndSelectedReportCase();
  assertLiteratureCurrentAndSelectedReportCase(currentAndSelected);

  const conflictAndDynamicWeb = await runLiteratureEvidenceConflictCase(outputRoot);
  assertLiteratureEvidenceConflictCase(conflictAndDynamicWeb);
  await assertOwnedRealTaskEvidenceArtifacts();

  console.log('[ok] real-task literature/web gates cover R-LIT-01, R-LIT-02, R-LIT-03, and R-WEB-01 offline contracts');
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}

type RealTaskManifest = {
  taskId?: string;
  status?: string;
  releaseEligible?: boolean;
  releaseBlocking?: boolean;
  attemptScope?: string;
  currentRunEvidenceScope?: string;
  evidenceRefs?: string[];
  screenshotRefs?: string[];
  auditRefs?: string[];
  artifactPaths?: string[];
  noArtifactReason?: string;
  visibleAnswer?: string | { text?: string };
  source?: {
    entrypoint?: string;
    evidenceMode?: string;
    runtimeSource?: string;
    devServices?: string;
    harnessMode?: string;
  };
  turns?: Array<{
    turnId?: string;
    prompt?: string;
    visibleAnswer?: string;
    evidenceSource?: string;
    screenshotRefs?: string[];
    auditRefs?: string[];
  }>;
  selectedRefEvidence?: {
    selectedRefs?: string[];
    followupRunIds?: string[];
    latestArtifactUsed?: boolean;
  };
};

type SelectedScopeAudit = {
  taskId?: string;
  status?: string;
  latestArtifactUsed?: boolean;
  followupRunIds?: string[];
  selectedRefs?: string[];
  oldFollowUpCommandId?: string;
  newFollowUpCommandId?: string;
};

type Rlit03EvidenceMatrix = {
  latestArtifactUsed?: boolean;
  selectedRefs?: string[];
  followUps?: {
    oldFollowUpCommandId?: string;
    newFollowUpCommandId?: string;
  };
  durableRefs?: {
    old?: { ref?: string };
    new?: { ref?: string };
  };
};

async function assertOwnedRealTaskEvidenceArtifacts(): Promise<void> {
  const realTaskRoot = join(process.cwd(), 'docs', 'test-artifacts', 'real-tasks');
  for (const taskId of ['R-LIT-01', 'R-LIT-02', 'R-WEB-01']) {
    const taskDir = join(realTaskRoot, taskId);
    const manifest = await readJson<RealTaskManifest>(join(realTaskRoot, taskId, 'manifest.json'));
    assert.equal(manifest.taskId, taskId, `${taskId}: manifest task id`);
    await assertLiteratureOrWebManifestStatus(taskId, taskDir, manifest);
  }

  const lit03Dir = join(realTaskRoot, 'R-LIT-03');
  const manifest = await readJson<RealTaskManifest>(join(lit03Dir, 'manifest.json'));
  const audit = await readJson<SelectedScopeAudit>(join(lit03Dir, 'selected-scope-audit.json'));
  const matrix = await readJson<Rlit03EvidenceMatrix>(join(lit03Dir, 'r-lit-03-evidence-matrix.json'));

  assert.equal(manifest.taskId, 'R-LIT-03');
  assert.ok(manifest.status === 'passed' || manifest.status === 'partial', 'R-LIT-03: selected-ref task must be passed or partial');
  if (manifest.status === 'passed') {
    await assertPassedLiveDefaultChatManifest('R-LIT-03', lit03Dir, manifest);
  } else {
    assert.equal(manifest.releaseEligible, false, 'R-LIT-03: partial evidence cannot release');
    assert.equal(manifest.releaseBlocking, true, 'R-LIT-03: partial evidence remains release blocking');
    assert.equal(manifest.attemptScope, taskSpecificLiveAttempt);
    assert.equal(manifest.currentRunEvidenceScope, taskSpecificLiveAttempt);
    await assertEvidenceRefsExist('R-LIT-03', lit03Dir, manifest.evidenceRefs ?? []);
  }
  assert.equal(manifest.selectedRefEvidence?.latestArtifactUsed, false, 'R-LIT-03: selected follow-ups must not use latest artifact');
  const selectedRefs = manifest.selectedRefEvidence?.selectedRefs ?? [];
  assert.equal(selectedRefs.length, 2, 'R-LIT-03: manifest must record two selected reports');
  assert.ok(
    selectedRefs.every((ref) => /^artifact:r-lit-03-/.test(ref)),
    'R-LIT-03: selected reports must be durable R-LIT-03 artifact refs',
  );
  assert.ok(
    new Set(selectedRefs).size === selectedRefs.length,
    'R-LIT-03: selected report refs must be distinct',
  );

  assert.deepEqual(
    new Set(selectedRefs),
    new Set(manifest.selectedRefEvidence?.selectedRefs ?? []),
    'R-LIT-03: manifest selected refs must be stable',
  );

  assert.equal(audit.taskId, 'R-LIT-03');
  assert.equal(audit.status, manifest.status);
  assert.equal(audit.latestArtifactUsed, false);
  assert.deepEqual(
    new Set(audit.selectedRefs ?? []),
    new Set(selectedRefs),
    'R-LIT-03: audit must record the manifest selected reports',
  );
  const auditFollowupRunIds = audit.followupRunIds
    ?? [audit.oldFollowUpCommandId, audit.newFollowUpCommandId].filter((value): value is string => typeof value === 'string');
  assert.deepEqual(
    new Set(auditFollowupRunIds),
    new Set(manifest.selectedRefEvidence?.followupRunIds ?? []),
    'R-LIT-03: audit and manifest follow-up command ids must match',
  );

  assert.equal(matrix.latestArtifactUsed, false);
  const matrixSelectedRefs = matrix.selectedRefs
    ?? [matrix.durableRefs?.old?.ref, matrix.durableRefs?.new?.ref].filter((value): value is string => typeof value === 'string');
  assert.deepEqual(
    new Set(matrixSelectedRefs),
    new Set(selectedRefs),
    'R-LIT-03: matrix must record the manifest selected reports',
  );
  assert.ok(auditFollowupRunIds.includes(matrix.followUps?.oldFollowUpCommandId ?? ''), 'R-LIT-03: matrix old follow-up id must come from the live audit');
  assert.ok(auditFollowupRunIds.includes(matrix.followUps?.newFollowUpCommandId ?? ''), 'R-LIT-03: matrix new follow-up id must come from the live audit');
  assertNoSyntheticEvidence('R-LIT-03: selected follow-up ids', [
    matrix.followUps?.oldFollowUpCommandId,
    matrix.followUps?.newFollowUpCommandId,
    ...auditFollowupRunIds,
    ...(manifest.selectedRefEvidence?.followupRunIds ?? []),
  ]);
  assert.doesNotMatch(matrix.followUps?.newFollowUpCommandId ?? '', /pending/i, 'R-LIT-03: matrix cannot leave the new follow-up as pending');

  for (const ref of [...(manifest.evidenceRefs ?? []), ...(manifest.artifactPaths ?? [])]) {
    if (isVirtualRef(ref)) continue;
    await access(resolveWorkspacePath(lit03Dir, ref));
  }
}

async function assertLiteratureOrWebManifestStatus(
  taskId: string,
  taskDir: string,
  manifest: RealTaskManifest,
): Promise<void> {
  if (manifest.status === 'passed') {
    await assertPassedLiveDefaultChatManifest(taskId, taskDir, manifest);
    return;
  }

  assert.ok(
    manifest.status === 'blocked' || manifest.status === 'partial',
    `${taskId}: status must be passed, blocked, or partial`,
  );
  assert.equal(manifest.releaseEligible, false, `${taskId}: blocked/partial evidence is not release eligible`);
  assert.equal(manifest.releaseBlocking, true, `${taskId}: blocked/partial evidence must remain release blocking`);
  await assertEvidenceRefsExist(taskId, taskDir, manifest.evidenceRefs ?? []);
}

async function assertPassedLiveDefaultChatManifest(
  taskId: string,
  taskDir: string,
  manifest: RealTaskManifest,
): Promise<void> {
  assert.equal(manifest.releaseEligible, true, `${taskId}: passed evidence must be release eligible`);
  assert.equal(manifest.releaseBlocking, false, `${taskId}: passed evidence must not remain release blocking`);
  assert.equal(manifest.attemptScope, taskSpecificLiveAttempt, `${taskId}: passed attempt must be task-specific live evidence`);
  assert.equal(
    manifest.currentRunEvidenceScope,
    taskSpecificLiveAttempt,
    `${taskId}: passed current evidence scope must be task-specific live evidence`,
  );
  assert.equal(manifest.source?.entrypoint, defaultChatEntrypoint, `${taskId}: passed evidence must start from the Codex default chat`);
  assert.ok((manifest.turns ?? []).length >= 3, `${taskId}: passed evidence must include at least three turns`);

  const evidenceRefs = manifest.evidenceRefs ?? [];
  const screenshotRefs = uniqueRefs([
    ...(manifest.screenshotRefs ?? []),
    ...(manifest.turns ?? []).flatMap((turn) => turn.screenshotRefs ?? []),
    ...evidenceRefs.filter(isScreenshotLikeRef),
  ]);
  const auditRefs = uniqueRefs([
    ...(manifest.auditRefs ?? []),
    ...(manifest.turns ?? []).flatMap((turn) => turn.auditRefs ?? []),
    ...evidenceRefs.filter(isAuditLikeRef),
  ]);
  const artifactRefs = manifest.artifactPaths ?? [];

  assert.ok(hasVisibleEvidence(manifest), `${taskId}: passed evidence must include a visible answer or visible DOM ref`);
  assert.ok(screenshotRefs.length > 0, `${taskId}: passed evidence must include screenshot refs`);
  assert.ok(auditRefs.length > 0, `${taskId}: passed evidence must include audit refs`);
  assert.ok(evidenceRefs.length > 0, `${taskId}: passed evidence must include evidence refs`);
  assert.ok(
    artifactRefs.length > 0 || hasText(manifest.noArtifactReason),
    `${taskId}: passed evidence must include artifact refs or an explicit noArtifactReason`,
  );

  assertNoSyntheticEvidence(`${taskId}: source/evidence cannot be synthetic`, [
    manifest.source?.entrypoint,
    manifest.source?.evidenceMode,
    manifest.source?.runtimeSource,
    manifest.source?.devServices,
    manifest.source?.harnessMode,
    ...evidenceRefs,
    ...screenshotRefs,
    ...auditRefs,
    ...artifactRefs,
    ...(manifest.turns ?? []).map((turn) => turn.evidenceSource),
  ]);

  await assertEvidenceRefsExist(taskId, taskDir, evidenceRefs);
  await assertEvidenceRefsExist(`${taskId}: screenshot`, taskDir, screenshotRefs);
  await assertEvidenceRefsExist(`${taskId}: audit`, taskDir, auditRefs);
  if (artifactRefs.length > 0) {
    await assertEvidenceRefsExist(`${taskId}: artifact`, taskDir, artifactRefs);
  }
}

async function assertEvidenceRefsExist(taskId: string, baseDir: string, refs: string[]): Promise<void> {
  assert.ok(refs.length > 0, `${taskId}: evidence refs must be recorded`);
  for (const ref of refs) {
    assert.ok(hasText(ref), `${taskId}: evidence ref must be non-empty`);
    if (isVirtualRef(ref)) continue;
    await access(resolveWorkspacePath(baseDir, ref));
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function isAuditLikeRef(value: string): boolean {
  return /^(?:audit|audit-raw):|runtime-codex|raw-jsonl|normalized-events|stderr|audit/i.test(value);
}

function isVirtualRef(value: string): boolean {
  return /^(?:artifact|audit|audit-raw|agentserver):/i.test(value);
}

function isScreenshotLikeRef(value: string): boolean {
  return /\.(?:png|jpe?g|webp)$/i.test(value) || /screenshot/i.test(value);
}

function resolveWorkspacePath(baseDir: string, value: string): string {
  if (isAbsolute(value)) return value;
  if (value.startsWith('file:')) return value.slice('file:'.length);
  if (value.startsWith('workspace://')) return join(process.cwd(), value.slice('workspace://'.length));
  if (value.startsWith('workspace/')) return join(process.cwd(), value);
  return join(baseDir, value);
}

function hasVisibleEvidence(manifest: RealTaskManifest): boolean {
  return (
    hasVisibleAnswer(manifest.visibleAnswer) ||
    (manifest.turns ?? []).some((turn) => hasText(turn.visibleAnswer)) ||
    (manifest.evidenceRefs ?? []).some((ref) => /(?:visible|dom|default-chat)/i.test(ref))
  );
}

function hasVisibleAnswer(value: RealTaskManifest['visibleAnswer']): boolean {
  if (typeof value === 'string') return hasText(value);
  return hasText(value?.text);
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertNoSyntheticEvidence(label: string, values: unknown[]): void {
  for (const value of values) {
    if (!hasText(value)) continue;
    assert.doesNotMatch(value, syntheticEvidencePattern, label);
  }
}

function uniqueRefs(values: string[]): string[] {
  return Array.from(new Set(values.filter(hasText)));
}
