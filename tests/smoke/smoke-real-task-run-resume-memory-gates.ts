import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertRealTaskProjectBoardTask } from './real-task-project-board.js';
import { currentProjectMappingsForSaWebTag } from './web-e2e/case-tags.js';

const root = process.cwd();

const [
  projectText,
  packageJson,
  matrixText,
  serviceLifecycleModule,
  serviceLifecycleTest,
  cancellationEvidenceModule,
  cancellationEvidenceTest,
  nativeSessionArtifactFollowupCase,
  nativeSessionArtifactFollowupTest,
  workspaceStateTest,
  evidenceSchemaTest,
  longContextCase,
  longContextTest,
] = await Promise.all([
  readText('PROJECT.md'),
  readJson<{ scripts?: Record<string, string> }>('package.json'),
  readText('tests/smoke/smoke-real-task-matrix.ts'),
  readText('src/runtime/codex/service-lifecycle-evidence.ts'),
  readText('src/runtime/codex/service-lifecycle-evidence.test.ts'),
  readText('src/runtime/codex/cancellation-evidence.ts'),
  readText('src/runtime/codex/cancellation-evidence.test.ts'),
  readText('tests/smoke/web-e2e/cases/native-session-artifact-followup.ts'),
  readText('tests/smoke/web-e2e/cases/native-session-artifact-followup.test.ts'),
  readText('src/ui/src/app/appShell/workspaceState.test.ts'),
  readText('tests/smoke/real-task-evidence-schema.test.ts'),
  readText('tests/smoke/web-e2e/cases/long-context-constraint-stability.ts'),
  readText('tests/smoke/web-e2e/cases/long-context-constraint-stability.test.ts'),
]);

const requiredTasks = ['R-RUN-01', 'R-RUN-02', 'R-RESUME-01', 'R-RESUME-02', 'R-MEM-01'] as const;
for (const taskId of requiredTasks) assertRealTaskProjectBoardTask(projectText, taskId, { root });

assertMatrixTask('R-RUN-01', ['smoke:runtime-codex-browser-acceptance', 'smoke:service-lifecycle', 'smoke:runtime-codex-service-lifecycle-evidence', 'smoke:real-task-run-resume-memory-gates']);
assertMatrixTask('R-RUN-02', ['smoke:web-multiturn-final', 'smoke:background-completion', 'smoke:runtime-codex-cancellation-evidence', 'smoke:real-task-run-resume-memory-gates']);
assertMatrixTask('R-RESUME-01', ['smoke:runtime-codex-artifact-followup', 'smoke:runtime-codex-browser-acceptance', 'smoke:web-multiturn-final', 'smoke:real-task-run-resume-memory-gates']);
assertMatrixTask('R-RESUME-02', ['smoke:web-multiturn-final', 'smoke:project-session-memory', 'smoke:real-task-run-resume-memory-gates']);
assertMatrixTask('R-MEM-01', ['smoke:project-session-memory', 'smoke:web-multiturn-final', 'smoke:real-task-run-resume-memory-gates']);

assert.equal(packageJson.scripts?.['smoke:service-lifecycle'], 'tsx tests/smoke/smoke-service-lifecycle.ts && tsx tests/smoke/smoke-dev-ui-health.ts');
assert.equal(packageJson.scripts?.['smoke:runtime-codex-service-lifecycle-evidence'], 'node --import tsx --test src/runtime/codex/service-lifecycle-evidence.test.ts');
assert.equal(packageJson.scripts?.['smoke:runtime-codex-cancellation-evidence'], 'node --import tsx --test src/runtime/codex/cancellation-evidence.test.ts');
assert.equal(packageJson.scripts?.['smoke:runtime-codex-artifact-followup'], 'node --import tsx --test src/ui/src/app/chat/sessionTransforms.test.ts src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts');
assert.equal(packageJson.scripts?.['smoke:project-session-memory'], 'tsx tests/smoke/smoke-project-session-memory-recovery.ts');
assert.equal(packageJson.scripts?.['smoke:real-task-run-resume-memory-gates'], 'node --import tsx tests/smoke/smoke-real-task-run-resume-memory-gates.ts');

assertSourceConcepts('R-RUN-01 service lifecycle evidence module', serviceLifecycleModule, [
  /SERVICE_LIFECYCLE_EVIDENCE_SCHEMA_VERSION = 'sciforge\.service-lifecycle-evidence\.v1'/,
  /actualPort/,
  /staleProcessCleanup/,
  /portConflictRecovery/,
  /codeChangeRestarts/,
  /browserRefreshes/,
  /readinessChecks/,
  /assumesDefaultPort/,
  /planServiceLifecycleRecovery/,
]);
assertSourceConcepts('R-RUN-01 service lifecycle tests', serviceLifecycleTest, [
  /accepts recovered actual port with cleanup, restart, refresh, readiness, and pass claim evidence/,
  /rejects pass claims that assume the default port and omit cleanup or refresh evidence/,
  /plans missing service lifecycle recovery evidence before a pass can be claimed/,
  /requires readiness checks and claims to name the actual URL port/,
]);

assertSourceConcepts('R-RUN-02 cancellation evidence module', cancellationEvidenceModule, [
  /CANCELLATION_EVIDENCE_SCHEMA_VERSION = 'sciforge\.cancellation-evidence\.v1'/,
  /partialArtifacts/,
  /irreversibleSideEffects/,
  /unsafeRemainder/,
  /safeRemainder/,
  /boundaryless-resume-blocked/,
  /safe-remainder-only/,
]);
assertSourceConcepts('R-RUN-02 cancellation evidence tests', cancellationEvidenceTest, [
  /records user cancellation evidence and plans only safe remainder/,
  /blocks system abort from boundaryless cancelled-run resume/,
  /blocks irreversible side effects from safe continuation/,
  /artifact:notebook\.partial/,
  /side-effect:hpc-job-42/,
]);

assertSourceConcepts('R-RESUME-01 native artifact follow-up case', nativeSessionArtifactFollowupCase, [
  /nativeSessionArtifactFollowupCaseId = 'SA-WEB-29'/,
  /codexSessionId/,
  /runtime-codex\.resume-commandText/,
  /Selected refs:/,
  /assertNoGuiReplayOrArtifactBody/,
  /unsupported resume/,
  /derivedArtifactRef/,
]);
assertSourceConcepts('R-RESUME-01 native artifact follow-up tests', nativeSessionArtifactFollowupTest, [
  /using only new commandText plus selected refs/,
  /guard fails when commandText replays GUI transcript or full artifact body/,
  /detached from native resume metadata/,
  /blocked unsupported resume path/,
]);

assertSourceConcepts('R-RESUME-02 restore/native continuity schema', evidenceSchemaTest, [
  /R-RESUME-02 passed evidence accepts restored GUI source plus native Codex continuity/,
  /restoredGuiStateSource/,
  /nativeContinuity/,
  /codexSessionId/,
  /resumeCommand/,
  /Projection-only evidence cannot satisfy Runtime Codex native continuity/,
]);
assertSourceConcepts('R-RESUME-02 persisted recover focus', workspaceStateTest, [
  /recoverable focus survives reload for persisted Runtime Codex failed run state/,
  /codexSessionId:\s*'019e3e82-164d-79b2-a5d4-b16241620b10'/,
  /workspaceRecoveryFocusForState/,
]);

assertSourceConcepts('R-MEM-01 long-context case module', longContextCase, [
  /LONG_CONTEXT_CONSTRAINT_STABILITY_CASE_ID = 'SA-WEB-30'/,
  /LONG_CONTEXT_ORIGINAL_CONSTRAINT/,
  /LONG_CONTEXT_UNRELATED_ARTIFACT_REFS/,
  /final turn must recover the original constraint verbatim/,
  /unrelated artifact refs must not pollute the final visible answer/,
  /run audit evidence must remain bounded/,
]);
assertSourceConcepts('R-MEM-01 long-context case tests', longContextTest, [
  /recovers the original constraint after unrelated long-context artifact noise/,
  /guard fails if the final turn forgets the original constraint/,
  /guard fails if unrelated artifact refs pollute the final answer/,
  /guard fails if final refs or audit evidence become unbounded/,
]);

assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-29').some(
    (mapping) => mapping.taskId === 'R-RESUME-01' && mapping.contractAssertions.includes('native-session-artifact-followup'),
  ),
  'R-RESUME-01 must map to SA-WEB-29 native session artifact follow-up',
);
for (const [taskId, assertion] of [
  ['R-RUN-01', 'service-lifecycle-recovery'],
  ['R-RUN-02', 'cancel-partial-continuation'],
  ['R-RESUME-02', 'browser-refresh-recovery'],
] as const) {
  assert.ok(
    currentProjectMappingsForSaWebTag('SA-WEB-37').some(
      (mapping) => mapping.taskId === taskId && mapping.contractAssertions.includes(assertion),
    ),
    `${taskId} must map to SA-WEB-37 ${assertion}`,
  );
}
assert.ok(
  currentProjectMappingsForSaWebTag('SA-WEB-30').some(
    (mapping) => mapping.taskId === 'R-MEM-01' && mapping.contractAssertions.includes('long-context-constraint-stability'),
  ),
  'R-MEM-01 must map to SA-WEB-30 long-context constraint stability',
);

assert.match(
  projectText,
  /共享 browser gate[\s\S]*不能替代 31 个 R-\* 任务各自的三轮 live evidence/i,
  'PROJECT.md must keep the shared browser pass vs task-specific live evidence boundary explicit',
);

console.log('[ok] real-task run/resume/memory gates cover R-RUN-01/02, R-RESUME-01/02, and R-MEM-01 while requiring checked PROJECT tasks to have passed task-specific live evidence');

function assertMatrixTask(taskId: string, gates: string[]): void {
  assert.match(matrixText, new RegExp(`task\\('${taskId}'`), `${taskId}: must be present in the real-task matrix`);
  for (const gate of gates) {
    assert.match(matrixText, new RegExp(`task\\('${taskId}'[\\s\\S]*${escapeRegExp(gate)}`), `${taskId}: matrix must require ${gate}`);
  }
}

function assertSourceConcepts(label: string, source: string, patterns: RegExp[]): void {
  for (const pattern of patterns) {
    assert.match(source, pattern, `${label}: source must include ${pattern}`);
  }
}

async function readText(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8');
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
