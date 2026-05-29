import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  COMPUTER_USE_CHAT_LIVE_CASE_ISOLATION_PLAN_SCHEMA,
  COMPUTER_USE_CHAT_LIVE_CASE_ISOLATION_RESET_MANIFEST_SCHEMA,
  buildComputerUseChatLiveCaseIsolationResetManifest,
  buildComputerUseChatLiveCaseIsolationSeedPlan,
  e2eOptionsForCaseIsolationPlanCase,
  writeComputerUseChatLiveCaseIsolationResetManifest,
} from '../../tools/computer-use-chat-live-case-isolation.js';

test('Computer Use chat live case isolation builds materialized per-case workspace forks', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-case-isolation-plan-'));
  try {
    const plan = await buildComputerUseChatLiveCaseIsolationSeedPlan({
      matrixRunId: 'matrix-run-001',
      baseWorkspacePath: workspace,
      materialize: true,
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      cases: [
        { id: 'literature-briefing-report', taskId: 'CU-NEXT-01', scenarioId: 'CU-LONG-001', expectedStatus: 'completed' },
        { id: 'failure-recovery-repair', taskId: 'CU-NEXT-05', scenarioId: 'CU-LONG-006', expectedStatus: 'repair-needed' },
      ],
    });

    assert.equal(plan.schemaVersion, COMPUTER_USE_CHAT_LIVE_CASE_ISOLATION_PLAN_SCHEMA);
    assert.equal(plan.resetManifestSchemaVersion, COMPUTER_USE_CHAT_LIVE_CASE_ISOLATION_RESET_MANIFEST_SCHEMA);
    assert.equal(plan.issues.length, 0);
    assert.equal(plan.runnerIntegration.setWorkspacePathPerCase, true);
    assert.equal(plan.runnerIntegration.failClosedWhenResetManifestHasIssues, true);
    assert.equal(plan.cases.length, 2);
    assert.notEqual(plan.cases[0]?.workspace.caseWorkspacePath, plan.cases[1]?.workspace.caseWorkspacePath);
    assert.notEqual(plan.cases[0]?.sessionId, plan.cases[1]?.sessionId);
    assert.notEqual(plan.cases[0]?.currentTurnId, plan.cases[1]?.currentTurnId);

    for (const item of plan.cases) {
      await stat(item.workspace.caseWorkspacePath);
      await stat(join(item.workspace.caseWorkspacePath, item.workspace.seedManifestRef));
      await stat(join(item.workspace.caseWorkspacePath, item.workspace.windowStateRootRef));
      await stat(join(item.workspace.caseWorkspacePath, item.workspace.tempRootRef));
      await stat(join(item.workspace.caseWorkspacePath, item.workspace.plannerMemoryRootRef));
      assert.match(item.workspace.caseWorkspacePath, /matrix-run-001/);
      assert.match(item.workspace.resetManifestRef, /case-reset-manifest\.json$/);
      assert.match(item.isolationContract.windowStateScopeId, new RegExp(item.caseRunId));
      assert.match(item.isolationContract.plannerMemoryScopeId, new RegExp(item.caseRunId));
    }

    const e2eOptions = e2eOptionsForCaseIsolationPlanCase(plan.cases[1]!, {
      SCIFORGE_RUNTIME_API_KEY: 'local-test-secret',
    } as NodeJS.ProcessEnv);
    assert.equal(e2eOptions.workspacePath, plan.cases[1]?.workspace.caseWorkspacePath);
    assert.equal(e2eOptions.env.SCIFORGE_WORKSPACE_PATH, plan.cases[1]?.workspace.caseWorkspacePath);
    assert.equal(e2eOptions.sessionId, plan.cases[1]?.sessionId);
    assert.equal(e2eOptions.currentTurnId, plan.cases[1]?.currentTurnId);
    assert.equal(e2eOptions.env.SCIFORGE_COMPUTER_USE_CASE_ISOLATION_RESET_MANIFEST, plan.cases[1]?.workspace.resetManifestRef);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live case isolation reset manifests prove clean case boundaries', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-case-isolation-reset-'));
  try {
    const plan = await buildComputerUseChatLiveCaseIsolationSeedPlan({
      matrixRunId: 'matrix-run-clean',
      baseWorkspacePath: workspace,
      materialize: true,
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      cases: [
        { id: 'literature-briefing-report', taskId: 'CU-NEXT-01', scenarioId: 'CU-LONG-001' },
        { id: 'table-chart-analysis-report', taskId: 'CU-NEXT-02', scenarioId: 'CU-LONG-002' },
      ],
    });
    const first = plan.cases[0]!;
    const second = plan.cases[1]!;
    const firstManifest = buildComputerUseChatLiveCaseIsolationResetManifest({
      plan,
      caseId: first.id,
      now: () => new Date('2026-05-29T00:01:00.000Z'),
      observed: observedForCase(first, {
        windowRefs: [`${first.workspace.windowStateRootRef}/initial-window.json`],
        tempRefs: [`${first.workspace.tempRootRef}/scratch-a.tmp`],
        plannerRefs: [`${first.workspace.plannerMemoryRootRef}/planner-context.json`],
      }),
    });
    assert.equal(firstManifest.status, 'passed', JSON.stringify(firstManifest.issues));

    const secondManifest = buildComputerUseChatLiveCaseIsolationResetManifest({
      plan,
      caseId: second.id,
      previousManifests: [firstManifest],
      now: () => new Date('2026-05-29T00:02:00.000Z'),
      observed: observedForCase(second, {
        windowRefs: [`${second.workspace.windowStateRootRef}/initial-window.json`],
        tempRefs: [`${second.workspace.tempRootRef}/scratch-b.tmp`],
        plannerRefs: [`${second.workspace.plannerMemoryRootRef}/planner-context.json`],
      }),
    });

    assert.equal(secondManifest.schemaVersion, COMPUTER_USE_CHAT_LIVE_CASE_ISOLATION_RESET_MANIFEST_SCHEMA);
    assert.equal(secondManifest.status, 'passed', JSON.stringify(secondManifest.issues));
    assert.equal(secondManifest.previousCases.length, 1);
    assert.equal(secondManifest.checks.every((item) => item.status === 'passed'), true);
    assert.equal(secondManifest.issues.length, 0);
    const written = await writeComputerUseChatLiveCaseIsolationResetManifest({ manifest: secondManifest });
    assert.equal(written, join(second.workspace.caseWorkspacePath, second.workspace.resetManifestRef));
    const roundTrip = JSON.parse(await readFile(written, 'utf8')) as { status?: string; caseId?: string };
    assert.equal(roundTrip.status, 'passed');
    assert.equal(roundTrip.caseId, second.id);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live case isolation fails closed on prior window, temp, or planner reuse', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-case-isolation-leak-'));
  try {
    const plan = await buildComputerUseChatLiveCaseIsolationSeedPlan({
      matrixRunId: 'matrix-run-leak',
      baseWorkspacePath: workspace,
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      cases: [
        { id: 'web-research-email-draft-stop', taskId: 'CU-NEXT-03', scenarioId: 'CU-LONG-009' },
        { id: 'file-organize-index', taskId: 'CU-NEXT-04', scenarioId: 'CU-LONG-005' },
      ],
    });
    const first = plan.cases[0]!;
    const second = plan.cases[1]!;
    const firstWindowRef = `${first.workspace.windowStateRootRef}/active-email-compose.json`;
    const firstTempRef = `${first.workspace.tempRootRef}/draft-cache.tmp`;
    const firstPlannerRef = `${first.workspace.plannerMemoryRootRef}/risk-approval-context.json`;
    const firstManifest = buildComputerUseChatLiveCaseIsolationResetManifest({
      plan,
      caseId: first.id,
      observed: observedForCase(first, {
        windowRefs: [firstWindowRef],
        tempRefs: [firstTempRef],
        plannerRefs: [firstPlannerRef],
      }),
    });

    const leakedSecondManifest = buildComputerUseChatLiveCaseIsolationResetManifest({
      plan,
      caseId: second.id,
      previousManifests: [firstManifest],
      observed: {
        ...observedForCase(second, {
          windowRefs: [firstWindowRef, `${second.workspace.windowStateRootRef}/current-window.json`],
          tempRefs: [firstTempRef, `${first.workspace.tempRootRef}/leaked-draft.tmp`],
          plannerRefs: [firstPlannerRef],
        }),
        windowState: {
          scopeId: first.isolationContract.windowStateScopeId,
          refs: [firstWindowRef, `${second.workspace.windowStateRootRef}/current-window.json`],
          priorCaseMarkers: [first.id],
        },
        plannerMemory: {
          scopeId: first.isolationContract.plannerMemoryScopeId,
          refs: [firstPlannerRef],
          priorCaseMarkers: [first.id],
        },
      },
    });

    assert.equal(leakedSecondManifest.status, 'failed');
    assert.ok(leakedSecondManifest.issues.includes(`window-state-scope-mismatch:expected:${second.isolationContract.windowStateScopeId}`));
    assert.ok(leakedSecondManifest.issues.includes(`window-state-ref-reused:${firstWindowRef}`));
    assert.ok(leakedSecondManifest.issues.includes(`window-state-prior-case-marker:${first.id}`));
    assert.ok(leakedSecondManifest.issues.includes(`temp-file-ref-reused:${firstTempRef}`));
    assert.ok(leakedSecondManifest.issues.includes(`temp-file-from-previous-case-root:${first.workspace.tempRootRef}/leaked-draft.tmp`));
    assert.ok(leakedSecondManifest.issues.includes(`planner-memory-scope-mismatch:expected:${second.isolationContract.plannerMemoryScopeId}`));
    assert.ok(leakedSecondManifest.issues.includes('planner-memory-scope-reused-from-previous-case'));
    assert.ok(leakedSecondManifest.issues.includes(`planner-memory-ref-reused:${firstPlannerRef}`));
    assert.ok(leakedSecondManifest.issues.includes(`planner-memory-prior-case-marker:${first.id}`));
    assert.equal(leakedSecondManifest.checks.some((item) => item.kind === 'temp-file-reset' && item.status === 'failed'), true);
    assert.equal(leakedSecondManifest.checks.some((item) => item.kind === 'planner-memory-reset' && item.status === 'failed'), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function observedForCase(
  item: {
    sessionId: string;
    currentTurnId: string;
    workspace: { caseWorkspacePath: string; tempRootRef: string };
    isolationContract: { windowStateScopeId: string; plannerMemoryScopeId: string };
  },
  refs: {
    windowRefs: string[];
    tempRefs: string[];
    plannerRefs: string[];
  },
) {
  return {
    workspacePath: item.workspace.caseWorkspacePath,
    sessionId: item.sessionId,
    currentTurnId: item.currentTurnId,
    windowState: {
      scopeId: item.isolationContract.windowStateScopeId,
      refs: refs.windowRefs,
      priorCaseMarkers: [],
    },
    tempFiles: {
      rootRef: item.workspace.tempRootRef,
      refs: refs.tempRefs,
    },
    plannerMemory: {
      scopeId: item.isolationContract.plannerMemoryScopeId,
      refs: refs.plannerRefs,
      priorCaseMarkers: [],
    },
  };
}
