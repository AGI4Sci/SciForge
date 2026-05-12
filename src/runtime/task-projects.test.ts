import assert from 'node:assert/strict';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  appendTaskProjectGuidance,
  appendTaskStage,
  createTaskProject,
  listRecentTaskProjects,
  maybePromoteTaskProjectStageAdapter,
  prepareNextStageHandoffSummary,
  readTaskProject,
  recordStageEvidence,
  resolveTaskProjectGuidance,
  runTaskProjectStage,
  selectTaskProjectContinuationStage,
  summarizeTaskProjectForHandoff,
  updateTaskStage,
  type TaskStage,
} from './task-projects';

test('creates a task project with stable bounded workspace paths', async () => {
  const root = await workspace();
  try {
    const result = await createTaskProject(root, {
      id: 'demo-project',
      title: 'Demo Project',
      goal: 'Create staged runtime shell state.',
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    assert.equal(result.project.paths.projectJson, join('.sciforge', 'projects', 'demo-project', 'project.json'));
    assert.equal(result.project.paths.planJson, join('.sciforge', 'projects', 'demo-project', 'plan.json'));
    assert.equal(result.project.paths.stages, join('.sciforge', 'projects', 'demo-project', 'stages'));
    assert.equal(result.project.paths.src, join('.sciforge', 'projects', 'demo-project', 'src'));
    assert.equal(result.project.paths.artifacts, join('.sciforge', 'projects', 'demo-project', 'artifacts'));
    assert.equal(result.project.paths.evidence, join('.sciforge', 'projects', 'demo-project', 'evidence'));
    assert.equal(result.project.paths.logs, join('.sciforge', 'projects', 'demo-project', 'logs'));
    assert.deepEqual(result.plan.stageRefs, []);

    await access(join(root, '.sciforge', 'projects', 'demo-project', 'project.json'));
    await access(join(root, '.sciforge', 'projects', 'demo-project', 'plan.json'));
    await access(join(root, '.sciforge', 'projects', 'demo-project', 'src'));
    await access(join(root, '.sciforge', 'projects', 'demo-project', 'artifacts'));
    await access(join(root, '.sciforge', 'projects', 'demo-project', 'evidence'));
    await access(join(root, '.sciforge', 'projects', 'demo-project', 'logs'));
  } finally {
    await cleanup(root);
  }
});

test('appends multiple stages with sequential index-kind files', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'append-demo', goal: 'Append stages.', createdAt: '2026-05-09T00:00:00.000Z' });

    const first = await appendTaskStage(root, 'append-demo', {
      kind: 'plan',
      goal: 'Plan the work.',
      inputRef: 'file:.sciforge/projects/append-demo/plan.json',
      createdAt: '2026-05-09T00:01:00.000Z',
    });
    const second = await appendTaskStage(root, 'append-demo', {
      kind: 'execute',
      goal: 'Run generated code.',
      codeRef: 'file:.sciforge/projects/append-demo/src/run.ts',
      stdoutRef: 'file:.sciforge/projects/append-demo/logs/2-execute.out',
      stderrRef: 'file:.sciforge/projects/append-demo/logs/2-execute.err',
      artifactRefs: ['file:.sciforge/projects/append-demo/artifacts/result.json'],
      createdAt: '2026-05-09T00:02:00.000Z',
    });

    assert.equal(first.stage.id, '1-plan');
    assert.equal(second.stage.id, '2-execute');
    assert.deepEqual(second.plan.stageRefs, [
      'file:.sciforge/projects/append-demo/stages/1-plan.json',
      'file:.sciforge/projects/append-demo/stages/2-execute.json',
    ]);

    const stage = await readJson<TaskStage>(join(root, '.sciforge', 'projects', 'append-demo', 'stages', '2-execute.json'));
    assert.equal(stage.codeRef, 'file:.sciforge/projects/append-demo/src/run.ts');
    assert.equal(stage.stdoutRef, 'file:.sciforge/projects/append-demo/logs/2-execute.out');
    assert.deepEqual(stage.artifactRefs, ['file:.sciforge/projects/append-demo/artifacts/result.json']);
  } finally {
    await cleanup(root);
  }
});

test('updates stages to done failed and repair-needed', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'status-demo', goal: 'Track statuses.', createdAt: '2026-05-09T00:00:00.000Z' });
    await appendTaskStage(root, 'status-demo', { kind: 'plan', goal: 'Plan.', createdAt: '2026-05-09T00:01:00.000Z' });
    await appendTaskStage(root, 'status-demo', { kind: 'execute', goal: 'Execute.', status: 'running', createdAt: '2026-05-09T00:02:00.000Z' });
    await appendTaskStage(root, 'status-demo', { kind: 'repair', goal: 'Repair.', createdAt: '2026-05-09T00:03:00.000Z' });

    const done = await updateTaskStage(root, 'status-demo', '1-plan', {
      status: 'done',
      outputRef: 'file:.sciforge/projects/status-demo/artifacts/plan.json',
      updatedAt: '2026-05-09T00:04:00.000Z',
    });
    assert.equal(done.stage.completedAt, '2026-05-09T00:04:00.000Z');

    const failed = await updateTaskStage(root, 'status-demo', 2, {
      status: 'failed',
      failureReason: 'Command exited 1.',
      recoverActions: ['Inspect stderr', 'Patch input'],
      stderrRef: 'file:.sciforge/projects/status-demo/logs/2-execute.err',
      updatedAt: '2026-05-09T00:05:00.000Z',
    });
    assert.equal(failed.project.status, 'failed');
    assert.equal(failed.stage.failedAt, '2026-05-09T00:05:00.000Z');
    assert.deepEqual(failed.stage.recoverActions, ['Inspect stderr', 'Patch input']);

    const repair = await updateTaskStage(root, 'status-demo', '2-execute', {
      status: 'repair-needed',
      nextStep: 'Create a focused repair stage.',
      updatedAt: '2026-05-09T00:06:00.000Z',
    });
    assert.equal(repair.project.status, 'repair-needed');
    assert.equal(repair.stage.nextStep, 'Create a focused repair stage.');
  } finally {
    await cleanup(root);
  }
});

test('records persisted evidence refs on a stage', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'evidence-demo', goal: 'Record evidence.', createdAt: '2026-05-09T00:00:00.000Z' });
    await appendTaskStage(root, 'evidence-demo', { kind: 'verify', goal: 'Verify output.', createdAt: '2026-05-09T00:01:00.000Z' });

    const result = await recordStageEvidence(root, 'evidence-demo', 1, {
      id: 'checks',
      kind: 'test-log',
      title: 'Test checks',
      summary: 'All local checks passed.',
      data: { exitCode: 0 },
      createdAt: '2026-05-09T00:02:00.000Z',
    });

    assert.equal(result.evidenceRef, 'file:.sciforge/projects/evidence-demo/evidence/1-verify-checks.json');
    assert.deepEqual(result.stage.evidenceRefs, ['file:.sciforge/projects/evidence-demo/evidence/1-verify-checks.json']);
    const evidence = await readJson<Record<string, unknown>>(join(root, '.sciforge', 'projects', 'evidence-demo', 'evidence', '1-verify-checks.json'));
    assert.equal(evidence.stageId, '1-verify');
  } finally {
    await cleanup(root);
  }
});

test('runs a task project stage successfully with ToolPayload output', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'run-success', goal: 'Run a stage.', createdAt: '2026-05-09T00:00:00.000Z' });
    await writeStageFile(root, 'run-success', 'input.json', JSON.stringify({ sample: 1 }));
    await writeStageFile(root, 'run-success', 'run.sh', [
      'echo stage-ok',
      'cat > "$2" <<\'JSON\'',
      JSON.stringify(toolPayload({ message: 'Stage completed.', evidenceRefs: ['file:.sciforge/projects/run-success/evidence/source.json'] })),
      'JSON',
    ].join('\n'));
    await appendTaskStage(root, 'run-success', {
      kind: 'execute',
      goal: 'Execute the generated code.',
      codeRef: 'file:.sciforge/projects/run-success/src/run.sh',
      inputRef: 'file:.sciforge/projects/run-success/src/input.json',
      createdAt: '2026-05-09T00:01:00.000Z',
    });

    const result = await runTaskProjectStage(root, 'run-success', '1-execute', {
      now: fixedClock('2026-05-09T00:02:00.000Z'),
    });

    assert.equal(result.stage.status, 'done');
    assert.equal(result.outputKind, 'tool-payload');
    assert.equal(result.stage.outputRef, 'file:.sciforge/projects/run-success/evidence/1-execute-output.json');
    assert.equal(result.stage.stdoutRef, 'file:.sciforge/projects/run-success/logs/1-execute.stdout.log');
    assert.equal(result.run.stdout.trim(), 'stage-ok');
    assert.ok(result.stage.evidenceRefs.includes('file:.sciforge/projects/run-success/evidence/1-execute-output.json'));
    assert.ok(result.stage.evidenceRefs.some((ref) => ref.endsWith('1-execute-run.json')));
  } finally {
    await cleanup(root);
  }
});

test('captures ToolPayload artifact refs from dataRef path and object references', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'artifact-refs', goal: 'Capture reusable mapping refs.', createdAt: '2026-05-09T00:00:00.000Z' });
    const payload = {
      ...toolPayload({ message: 'Mapping artifact ready.' }),
      artifacts: [{
        id: 'field-mapping',
        type: 'field-mapping',
        dataRef: '.sciforge/projects/artifact-refs/artifacts/field-mapping.json',
        path: '.sciforge/projects/artifact-refs/artifacts/field-mapping.md',
        metadata: {
          artifactRef: 'artifact:artifact-refs:field-mapping',
        },
      }],
      objectReferences: [{
        kind: 'artifact',
        ref: 'artifact:artifact-refs:field-mapping',
        provenance: {
          dataRef: '.sciforge/projects/artifact-refs/artifacts/field-mapping.json',
          path: '.sciforge/projects/artifact-refs/artifacts/field-mapping.md',
        },
      }],
    };
    await writeStageFile(root, 'artifact-refs', 'run.sh', [
      'cat > "$2" <<\'JSON\'',
      JSON.stringify(payload),
      'JSON',
    ].join('\n'));
    await appendTaskStage(root, 'artifact-refs', {
      kind: 'execute',
      goal: 'Emit a field mapping artifact.',
      codeRef: 'file:.sciforge/projects/artifact-refs/src/run.sh',
      createdAt: '2026-05-09T00:01:00.000Z',
    });

    const result = await runTaskProjectStage(root, 'artifact-refs', 1, {
      now: fixedClock('2026-05-09T00:02:00.000Z'),
    });

    assert.equal(result.stage.status, 'done');
    assert.deepEqual(result.stage.artifactRefs, [
      'artifact:artifact-refs:field-mapping',
      'file:.sciforge/projects/artifact-refs/artifacts/field-mapping.json',
      'file:.sciforge/projects/artifact-refs/artifacts/field-mapping.md',
    ]);
  } finally {
    await cleanup(root);
  }
});

test('runs a task project stage successfully with WorkEvidence output', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'run-evidence', goal: 'Run evidence.', createdAt: '2026-05-09T00:00:00.000Z' });
    await writeStageFile(root, 'run-evidence', 'run.sh', [
      'cat > "$2" <<\'JSON\'',
      JSON.stringify({
        kind: 'command',
        status: 'success',
        outputSummary: 'Command produced bounded evidence.',
        resultCount: 1,
        evidenceRefs: ['file:.sciforge/projects/run-evidence/evidence/check.json'],
        recoverActions: [],
        nextStep: 'Proceed to emit stage.',
        diagnostics: ['exitCode 0'],
      }),
      'JSON',
    ].join('\n'));
    await appendTaskStage(root, 'run-evidence', {
      kind: 'verify',
      goal: 'Verify with WorkEvidence.',
      codeRef: 'file:.sciforge/projects/run-evidence/src/run.sh',
      createdAt: '2026-05-09T00:01:00.000Z',
    });

    const result = await runTaskProjectStage(root, 'run-evidence', 1, {
      now: fixedClock('2026-05-09T00:02:00.000Z'),
    });

    assert.equal(result.stage.status, 'done');
    assert.equal(result.outputKind, 'work-evidence');
    assert.equal(result.stage.workEvidence?.[0]?.resultCount, 1);
    assert.equal(result.stage.workEvidence?.[0]?.nextStep, 'Proceed to emit stage.');
    assert.deepEqual(result.stage.diagnostics, ['exitCode 0']);
    assert.ok(result.stage.evidenceRefs.includes('file:.sciforge/projects/run-evidence/evidence/check.json'));
  } finally {
    await cleanup(root);
  }
});

test('task project handoff carries WorkEvidence summaries without duplicating raw logs', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'work-evidence-handoff', goal: 'Run evidence handoff.', createdAt: '2026-05-09T00:00:00.000Z' });
    await appendTaskStage(root, 'work-evidence-handoff', {
      kind: 'research',
      goal: 'Search with bounded evidence.',
      workEvidence: [{
        kind: 'retrieval',
        status: 'empty',
        provider: 'generic-provider',
        input: { query: 'recent records' },
        resultCount: 0,
        outputSummary: 'Provider status 200 totalResults=0.',
        evidenceRefs: ['file:.sciforge/projects/work-evidence-handoff/evidence/search.json'],
        failureReason: 'No records after fallback.',
        recoverActions: ['Broaden query'],
        nextStep: 'Ask whether to broaden scope.',
        diagnostics: ['primary status 200', 'fallback status 200'],
        rawRef: 'file:.sciforge/projects/work-evidence-handoff/logs/search.raw.json',
      }],
      evidenceRefs: ['file:.sciforge/projects/work-evidence-handoff/evidence/search.json'],
      failureReason: 'No records after fallback.',
      diagnostics: ['primary status 200', 'fallback status 200'],
      recoverActions: ['Broaden query'],
      nextStep: 'Ask whether to broaden scope.',
      createdAt: '2026-05-09T00:01:00.000Z',
    });

    const summary = await summarizeTaskProjectForHandoff(root, 'work-evidence-handoff');

    assert.equal(summary.stages[0]?.workEvidence[0]?.status, 'empty');
    assert.equal(summary.stages[0]?.workEvidence[0]?.resultCount, 0);
    assert.deepEqual(summary.stages[0]?.diagnostics, ['fallback status 200', 'primary status 200']);
    assert.equal(summary.stages[0]?.nextStep, 'Ask whether to broaden scope.');
    assert.doesNotMatch(JSON.stringify(summary), /RAW_PAYLOAD/);
  } finally {
    await cleanup(root);
  }
});

test('marks task project stage failed when task exits non-zero', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'run-failure', goal: 'Fail a stage.', createdAt: '2026-05-09T00:00:00.000Z' });
    await writeStageFile(root, 'run-failure', 'run.sh', [
      'echo bad-news >&2',
      'cat > "$2" <<\'JSON\'',
      JSON.stringify(toolPayload({ message: 'Task reported failure.', status: 'failed', failureReason: 'Computation failed.' })),
      'JSON',
      'exit 7',
    ].join('\n'));
    await appendTaskStage(root, 'run-failure', {
      kind: 'execute',
      goal: 'Execute and fail.',
      codeRef: 'file:.sciforge/projects/run-failure/src/run.sh',
      createdAt: '2026-05-09T00:01:00.000Z',
    });

    const result = await runTaskProjectStage(root, 'run-failure', 1, {
      now: fixedClock('2026-05-09T00:02:00.000Z'),
    });

    assert.equal(result.stage.status, 'failed');
    assert.match(result.stage.failureReason ?? '', /exited with code 7/);
    assert.equal(result.project.status, 'failed');
    assert.match(await readFile(join(root, '.sciforge', 'projects', 'run-failure', 'logs', '1-execute.stderr.log'), 'utf8'), /bad-news/);
  } finally {
    await cleanup(root);
  }
});

test('marks task project stage failed when output cannot be parsed', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'parse-failure', goal: 'Bad JSON.', createdAt: '2026-05-09T00:00:00.000Z' });
    await writeStageFile(root, 'parse-failure', 'run.sh', 'printf "{not-json" > "$2"\n');
    await appendTaskStage(root, 'parse-failure', {
      kind: 'execute',
      goal: 'Write malformed output.',
      codeRef: 'file:.sciforge/projects/parse-failure/src/run.sh',
      createdAt: '2026-05-09T00:01:00.000Z',
    });

    const result = await runTaskProjectStage(root, 'parse-failure', 1, {
      now: fixedClock('2026-05-09T00:02:00.000Z'),
    });

    assert.equal(result.stage.status, 'failed');
    assert.match(result.stage.failureReason ?? '', /output parse failed/i);
    assert.equal(result.outputKind, undefined);
  } finally {
    await cleanup(root);
  }
});

test('marks task project stage failed when evidence guard fails', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'guard-failure', goal: 'Guard evidence.', createdAt: '2026-05-09T00:00:00.000Z' });
    await writeStageFile(root, 'guard-failure', 'run.sh', [
      'cat > "$2" <<\'JSON\'',
      JSON.stringify(toolPayload({ message: 'Verified without evidence.', claimType: 'verified', evidenceRefs: [] })),
      'JSON',
    ].join('\n'));
    await appendTaskStage(root, 'guard-failure', {
      kind: 'verify',
      goal: 'Claim verified with no refs.',
      codeRef: 'file:.sciforge/projects/guard-failure/src/run.sh',
      createdAt: '2026-05-09T00:01:00.000Z',
    });

    const result = await runTaskProjectStage(root, 'guard-failure', 1, {
      now: fixedClock('2026-05-09T00:02:00.000Z'),
    });

    assert.equal(result.stage.status, 'failed');
    assert.match(result.stage.failureReason ?? '', /Evidence guard failed/);
    assert.match(result.stage.nextStep ?? '', /repair stage/);
  } finally {
    await cleanup(root);
  }
});

test('prepares bounded next stage handoff summary', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'handoff-stage', goal: 'G'.repeat(200), createdAt: '2026-05-09T00:00:00.000Z' });
    await writeStageFile(root, 'handoff-stage', 'run.sh', [
      'cat > "$2" <<\'JSON\'',
      JSON.stringify(toolPayload({ message: 'M'.repeat(200), evidenceRefs: ['file:.sciforge/projects/handoff-stage/evidence/source.json'] })),
      'JSON',
    ].join('\n'));
    await appendTaskStage(root, 'handoff-stage', {
      kind: 'execute',
      goal: 'A'.repeat(200),
      codeRef: 'file:.sciforge/projects/handoff-stage/src/run.sh',
      createdAt: '2026-05-09T00:01:00.000Z',
    });
    await runTaskProjectStage(root, 'handoff-stage', 1, {
      now: fixedClock('2026-05-09T00:02:00.000Z'),
    });

    const summary = await prepareNextStageHandoffSummary(root, 'handoff-stage', 1, {
      maxTextChars: 80,
      maxEvidenceRefs: 1,
      maxEvidenceSummaries: 1,
    });

    assert.equal(summary.truncated, true);
    assert.match(summary.stage.goal, /truncated/);
    assert.match(summary.stageResult.outputSummary ?? '', /truncated/);
    assert.equal(summary.evidenceSummary.refs.length, 1);
    assert.deepEqual(summary.workEvidenceSummary, []);
    assert.deepEqual(summary.artifactRefs, []);
    assert.deepEqual(summary.diagnostics, []);
    assert.deepEqual(summary.recoverActions, []);
    assert.deepEqual(summary.userGuidanceQueue, []);
  } finally {
    await cleanup(root);
  }
});

test('next stage handoff includes bounded evidence diagnostics and recovery hints', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'feedback-demo', goal: 'Continue from failed evidence.', createdAt: '2026-05-09T00:00:00.000Z' });
    await appendTaskStage(root, 'feedback-demo', {
      kind: 'verify',
      goal: 'Validate search output.',
      status: 'failed',
      artifactRefs: ['file:.sciforge/projects/feedback-demo/artifacts/report.json'],
      evidenceRefs: ['file:.sciforge/projects/feedback-demo/evidence/verify.json'],
      workEvidence: [{
        kind: 'retrieval',
        status: 'repair-needed',
        provider: 'generic-search',
        input: { query: 'recent public records' },
        resultCount: 0,
        outputSummary: 'Provider returned no records and fallback was not attempted.',
        evidenceRefs: ['file:.sciforge/projects/feedback-demo/evidence/search.json'],
        failureReason: 'Missing fallback provider diagnostics.',
        recoverActions: ['Retry with a second provider.'],
        nextStep: 'Create a repair stage that records provider status.',
        diagnostics: ['provider status missing'],
      }],
      failureReason: 'Evidence guard failed.',
      diagnostics: ['schema error: evidenceRefs missing fallback trace'],
      recoverActions: ['Create repair stage from latest outputRef.'],
      nextStep: 'Repair the retrieval evidence before emit.',
      createdAt: '2026-05-09T00:01:00.000Z',
    });

    const summary = await prepareNextStageHandoffSummary(root, 'feedback-demo', 1);

    assert.deepEqual(summary.artifactRefs, ['file:.sciforge/projects/feedback-demo/artifacts/report.json']);
    assert.deepEqual(summary.diagnostics, ['schema error: evidenceRefs missing fallback trace']);
    assert.deepEqual(summary.recoverActions, ['Create repair stage from latest outputRef.']);
    assert.equal(summary.workEvidenceSummary[0]?.status, 'repair-needed');
    assert.equal(summary.workEvidenceSummary[0]?.provider, 'generic-search');
    assert.match(summary.workEvidenceSummary[0]?.failureReason ?? '', /Missing fallback/);
    assert.deepEqual(summary.workEvidenceSummary[0]?.recoverActions, ['Retry with a second provider.']);
  } finally {
    await cleanup(root);
  }
});

test('carries queued and deferred project guidance into next stage handoff', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'guidance-demo', goal: 'Continue with user guidance.', createdAt: '2026-05-09T00:00:00.000Z' });
    await appendTaskStage(root, 'guidance-demo', {
      kind: 'research',
      goal: 'Collect sources.',
      status: 'done',
      createdAt: '2026-05-09T00:01:00.000Z',
    });
    const queued = await appendTaskProjectGuidance(root, 'guidance-demo', {
      id: 'narrow-scope',
      message: 'Only include sources published after 2026-05-01.',
      source: 'user',
      stageId: '1-research',
      createdAt: '2026-05-09T00:02:00.000Z',
    });
    const deferred = await appendTaskProjectGuidance(root, 'guidance-demo', {
      id: 'format-later',
      message: 'Use a compact table in the final emit stage.',
      source: 'user',
      createdAt: '2026-05-09T00:03:00.000Z',
    });
    await resolveTaskProjectGuidance(root, 'guidance-demo', deferred.guidance.id, {
      status: 'deferred',
      reason: 'Applies to the emit stage.',
      updatedAt: '2026-05-09T00:04:00.000Z',
    });
    await appendTaskProjectGuidance(root, 'guidance-demo', {
      id: 'already-used',
      message: 'Prefer official docs when available.',
      source: 'user',
      createdAt: '2026-05-09T00:05:00.000Z',
    });
    await resolveTaskProjectGuidance(root, 'guidance-demo', 'already-used', {
      status: 'adopted',
      decision: 'Applied during source selection.',
      updatedAt: '2026-05-09T00:06:00.000Z',
    });

    const summary = await prepareNextStageHandoffSummary(root, 'guidance-demo', 1, {
      maxTextChars: 120,
    });

    assert.equal(queued.guidance.status, 'queued');
    assert.deepEqual(summary.userGuidanceQueue.map((entry) => entry.id), ['narrow-scope', 'format-later']);
    assert.equal(summary.userGuidanceQueue[0].status, 'queued');
    assert.equal(summary.userGuidanceQueue[0].stageId, '1-research');
    assert.equal(summary.userGuidanceQueue[1].status, 'deferred');
    assert.match(String(summary.userGuidanceQueue[1].reason), /emit stage/);
    assert.deepEqual(summary.userGuidanceDecisionContract.requiredStatuses, ['adopted', 'deferred', 'rejected']);
    assert.match(summary.userGuidanceDecisionContract.outputFieldHint, /guidanceDecisions/);
  } finally {
    await cleanup(root);
  }
});

test('selects the latest failed or empty-result stage for continuation instead of restarting at stage one', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'continue-demo', goal: 'Continue from recent stage.', createdAt: '2026-05-09T00:00:00.000Z' });
    await appendTaskStage(root, 'continue-demo', {
      kind: 'plan',
      goal: 'Initial plan already completed.',
      status: 'done',
      createdAt: '2026-05-09T00:01:00.000Z',
    });
    await appendTaskStage(root, 'continue-demo', {
      kind: 'research',
      goal: 'Search returned empty results after fallback.',
      status: 'failed',
      workEvidence: [{
        kind: 'retrieval',
        status: 'empty',
        provider: 'generic-search',
        input: { query: 'narrow topic' },
        resultCount: 0,
        outputSummary: 'Primary and fallback returned totalResults=0.',
        evidenceRefs: ['file:.sciforge/projects/continue-demo/evidence/search.json'],
        failureReason: 'Empty result after fallback.',
        recoverActions: ['Broaden query with user guidance.'],
        nextStep: 'Continue by repairing the latest research stage.',
        diagnostics: ['primary status 200 totalResults=0', 'fallback status 200 totalResults=0'],
      }],
      failureReason: 'Empty result after fallback.',
      nextStep: 'Continue by repairing the latest research stage.',
      createdAt: '2026-05-09T00:02:00.000Z',
    });
    await appendTaskStage(root, 'continue-demo', {
      kind: 'summarize',
      goal: 'Do not jump here before repairing research.',
      status: 'planned',
      createdAt: '2026-05-09T00:03:00.000Z',
    });
    await appendTaskProjectGuidance(root, 'continue-demo', {
      id: 'broaden',
      message: 'Broaden the query to include adjacent terminology.',
      source: 'user',
      createdAt: '2026-05-09T00:04:00.000Z',
    });

    const selection = await selectTaskProjectContinuationStage(root, 'continue-demo');
    const summary = await prepareNextStageHandoffSummary(root, 'continue-demo', selection.stage.id);

    assert.equal(selection.stage.id, '2-research');
    assert.equal(selection.reason, 'latest-failed-stage');
    assert.equal(selection.shouldRepair, true);
    assert.deepEqual(selection.activeGuidance.map((entry) => entry.id), ['broaden']);
    assert.match(summary.failureReason ?? '', /Empty result/);
    assert.deepEqual(summary.userGuidanceQueue.map((entry) => entry.id), ['broaden']);
  } finally {
    await cleanup(root);
  }
});

test('selects the latest completed stage when continuation follows user guidance after success', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'continue-guidance', goal: 'Continue after success.', createdAt: '2026-05-09T00:00:00.000Z' });
    await appendTaskStage(root, 'continue-guidance', {
      kind: 'plan',
      goal: 'Plan.',
      status: 'done',
      createdAt: '2026-05-09T00:01:00.000Z',
    });
    await appendTaskStage(root, 'continue-guidance', {
      kind: 'verify',
      goal: 'Verification completed.',
      status: 'done',
      createdAt: '2026-05-09T00:02:00.000Z',
    });
    await appendTaskProjectGuidance(root, 'continue-guidance', {
      id: 'extra-check',
      message: 'Add one more validation in the next stage.',
      source: 'user',
      createdAt: '2026-05-09T00:03:00.000Z',
    });

    const selection = await selectTaskProjectContinuationStage(root, 'continue-guidance');

    assert.equal(selection.stage.id, '2-verify');
    assert.equal(selection.reason, 'latest-completed-stage');
    assert.equal(selection.shouldRepair, false);
    assert.deepEqual(selection.activeGuidance.map((entry) => entry.id), ['extra-check']);
  } finally {
    await cleanup(root);
  }
});

test('writes a reusable skill promotion proposal for a successful stable TaskProject stage adapter', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'promotion-demo', goal: 'Promote reusable adapter.', createdAt: '2026-05-09T00:00:00.000Z' });
    await writeStageFile(root, 'promotion-demo', 'adapter.py', [
      'import json',
      'import sys',
      'with open(sys.argv[2], "w", encoding="utf-8") as handle:',
      '    json.dump({"message": "adapter ok", "confidence": 0.9, "claimType": "fact", "evidenceLevel": "verified", "reasoningTrace": "promotion test", "claims": [{"text": "ok", "evidenceRefs": ["file:.sciforge/projects/promotion-demo/evidence/source.json"]}], "uiManifest": [], "executionUnits": [{"id": "adapter", "status": "done", "evidenceRefs": ["file:.sciforge/projects/promotion-demo/evidence/source.json"]}], "artifacts": [{"id": "report", "type": "adapter-report", "data": {"ok": True}}]}, handle)',
    ].join('\n'));
    await appendTaskStage(root, 'promotion-demo', {
      kind: 'execute',
      goal: 'Run a reusable adapter.',
      codeRef: 'file:.sciforge/projects/promotion-demo/src/adapter.py',
      createdAt: '2026-05-09T00:01:00.000Z',
    });
    const run = await runTaskProjectStage(root, 'promotion-demo', 1, {
      now: fixedClock('2026-05-09T00:02:00.000Z'),
    });
    assert.equal(run.stage.status, 'done');

    const proposal = await maybePromoteTaskProjectStageAdapter(root, 'promotion-demo', 1, {
      request: {
        skillDomain: 'literature',
        prompt: 'reusable adapter report',
        workspacePath: root,
        artifacts: [],
      },
      patchSummary: 'Stable stage adapter should become reusable.',
    });

    assert.ok(proposal);
    assert.match(proposal.id, /^proposal\.workspace\.literature\.reusable-adapter-report\./);
    assert.equal(proposal.source.taskCodeRef, '.sciforge/projects/promotion-demo/src/adapter.py');
    assert.equal(proposal.source.outputRef, '.sciforge/projects/promotion-demo/evidence/1-execute-output.json');
    assert.equal(proposal.proposedManifest.entrypoint.type, 'workspace-task');
    assert.equal(proposal.proposedManifest.scopeDeclaration?.source, 'workspace-generated-task');
    const proposalJson = await readJson<Record<string, unknown>>(join(root, '.sciforge', 'skill-proposals', proposal.id, 'proposal.json'));
    assert.equal(proposalJson.id, proposal.id);
  } finally {
    await cleanup(root);
  }
});

test('summarizes task project for handoff without inlining long artifacts or logs', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, {
      id: 'summary-demo',
      goal: 'G'.repeat(300),
      createdAt: '2026-05-09T00:00:00.000Z',
    });
    await appendTaskStage(root, 'summary-demo', {
      kind: 'execute',
      goal: 'A'.repeat(400),
      outputRef: 'file:.sciforge/projects/summary-demo/artifacts/large.json',
      stdoutRef: 'file:.sciforge/projects/summary-demo/logs/stdout.txt',
      stderrRef: 'file:.sciforge/projects/summary-demo/logs/stderr.txt',
      artifactRefs: Array.from({ length: 20 }, (_, index) => `file:.sciforge/projects/summary-demo/artifacts/${index}.json`),
      evidenceRefs: Array.from({ length: 20 }, (_, index) => `file:.sciforge/projects/summary-demo/evidence/${index}.json`),
      failureReason: 'B'.repeat(300),
      nextStep: 'C'.repeat(300),
      createdAt: '2026-05-09T00:01:00.000Z',
    });

    const summary = await summarizeTaskProjectForHandoff(root, 'summary-demo', {
      maxTextChars: 80,
      maxRefsPerStage: 3,
    });

    assert.equal(summary.truncated, true);
    assert.match(summary.project.goal, /truncated/);
    assert.match(summary.stages[0]?.goal ?? '', /truncated/);
    assert.equal(summary.stages[0]?.artifactRefs.length, 3);
    assert.equal(summary.stages[0]?.evidenceRefs.length, 3);
    assert.equal(summary.stages[0]?.stdoutRef, 'file:.sciforge/projects/summary-demo/logs/stdout.txt');
    assert.equal(summary.stages[0]?.outputRef, 'file:.sciforge/projects/summary-demo/artifacts/large.json');
  } finally {
    await cleanup(root);
  }
});

test('lists recent task projects and rejects paths that escape the workspace', async () => {
  const root = await workspace();
  try {
    await createTaskProject(root, { id: 'older', goal: 'Older.', createdAt: '2026-05-09T00:00:00.000Z' });
    await createTaskProject(root, { id: 'newer', goal: 'Newer.', createdAt: '2026-05-09T00:01:00.000Z' });
    await appendTaskStage(root, 'newer', { kind: 'plan', goal: 'Run.', createdAt: '2026-05-09T00:02:00.000Z' });

    const recent = await listRecentTaskProjects(root, { limit: 2 });
    assert.deepEqual(recent.map((project) => project.id), ['newer', 'older']);

    await assert.rejects(
      createTaskProject(root, { id: '../escape', goal: 'Nope.' }),
      /Invalid task project id/,
    );
    await assert.rejects(
      appendTaskStage(root, 'newer', { kind: 'bad', goal: 'Nope.', outputRef: 'file:../outside.json' }),
      /escapes workspace/,
    );
    await assert.rejects(
      appendTaskStage(root, 'newer', { kind: '../bad', goal: 'Nope.' }),
      /Invalid task stage kind/,
    );

    const loaded = await readTaskProject(root, 'newer');
    for (const relPath of [loaded.project.paths.projectJson, loaded.project.paths.planJson, loaded.project.paths.stages]) {
      assert.ok(resolve(root, relPath).startsWith(resolve(root)));
    }
  } finally {
    await cleanup(root);
  }
});

async function workspace() {
  return await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(join(tmpdir(), 'sciforge-task-projects-')));
}

async function cleanup(root: string) {
  await rm(root, { recursive: true, force: true });
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function writeStageFile(root: string, projectId: string, name: string, text: string) {
  const path = join(root, '.sciforge', 'projects', projectId, 'src', name);
  await mkdir(join(root, '.sciforge', 'projects', projectId, 'src'), { recursive: true });
  await writeFile(path, `${text}\n`, 'utf8');
}

function fixedClock(value: string) {
  return () => value;
}

function toolPayload(options: {
  message: string;
  claimType?: string;
  evidenceRefs?: string[];
  status?: string;
  failureReason?: string;
}) {
  return {
    message: options.message,
    confidence: 0.92,
    claimType: options.claimType ?? 'fact',
    evidenceLevel: 'verified',
    reasoningTrace: 'runtime stage test',
    claims: options.evidenceRefs === undefined ? [] : [{ text: options.message, evidenceRefs: options.evidenceRefs }],
    uiManifest: [],
    executionUnits: [{
      status: options.status ?? 'done',
      failureReason: options.failureReason,
      evidenceRefs: options.evidenceRefs ?? [],
    }],
    artifacts: [],
  };
}
