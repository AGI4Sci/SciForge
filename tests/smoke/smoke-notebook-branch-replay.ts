import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  NOTEBOOK_BRANCH_CONTRACT_ID,
  buildNotebookBranchReplayPlan,
  notebookBranchPlanAllowsContinuation,
} from '@sciforge-ui/runtime-contract/notebook-branch';
import {
  appendTaskStage,
  createTaskProject,
  forkTaskProjectStage,
  runTaskProjectStage,
} from '../../src/runtime/task-projects.js';
import type { WorkspaceTaskRunResult, WorkspaceTaskSpec } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-notebook-branch-'));
try {
  const plan = buildNotebookBranchReplayPlan({
    notebookId: 'smoke-notebook',
    sourceBranchId: 'main',
    branchId: 'alpha-001',
    forkFromStepId: 'fit-model',
    parameterChanges: [{ key: 'model.alpha', before: 0.05, after: 0.01 }],
    steps: [{
      id: 'load-data',
      index: 1,
      outputRefs: ['file:.sciforge/projects/smoke-notebook/artifacts/1-clean.csv'],
    }, {
      id: 'fit-model',
      index: 2,
      parameters: { model: { alpha: 0.05 } },
      inputRefs: ['file:.sciforge/projects/smoke-notebook/artifacts/1-clean.csv'],
      outputRefs: ['file:.sciforge/projects/smoke-notebook/artifacts/2-fit.json'],
      artifactRefs: ['artifact:smoke-notebook:fit-v1'],
      codeRefs: ['file:.sciforge/projects/smoke-notebook/src/2-fit.py'],
      stdoutRefs: ['file:.sciforge/projects/smoke-notebook/logs/2-fit.stdout.log'],
      stderrRefs: ['file:.sciforge/projects/smoke-notebook/logs/2-fit.stderr.log'],
    }, {
      id: 'plot-result',
      index: 3,
      inputRefs: ['file:.sciforge/projects/smoke-notebook/artifacts/2-fit.json'],
      outputRefs: ['file:.sciforge/projects/smoke-notebook/artifacts/3-plot.png'],
      artifactRefs: ['artifact:smoke-notebook:plot-v1'],
    }],
  });

  assert.equal(plan.contract, NOTEBOOK_BRANCH_CONTRACT_ID);
  assert.equal(notebookBranchPlanAllowsContinuation(plan), true);
  assert.deepEqual(plan.retainedSteps.map((step) => step.sourceStepId), ['load-data']);
  assert.deepEqual(plan.rerunSteps.map((step) => step.sourceStepId), ['fit-model', 'plot-result']);
  assert.ok(plan.affectedRefs.some((ref) => ref.ref === 'file:.sciforge/projects/smoke-notebook/artifacts/3-plot.png'));
  assert.ok(!plan.affectedRefs.some((ref) => ref.ref === 'file:.sciforge/projects/smoke-notebook/artifacts/1-clean.csv'));

  await createTaskProject(workspace, {
    id: 'smoke-notebook',
    goal: 'Run a multi-step notebook and branch from the middle step.',
    createdAt: '2026-05-13T00:00:00.000Z',
  });
  await mkdir(join(workspace, '.sciforge', 'projects', 'smoke-notebook', 'artifacts'), { recursive: true });
  await writeFile(join(workspace, '.sciforge', 'projects', 'smoke-notebook', 'artifacts', '1-clean.csv'), 'sample,value\nA,1\n', 'utf8');
  await appendTaskStage(workspace, 'smoke-notebook', {
    kind: 'execute',
    goal: 'Load input data.',
    status: 'done',
    outputRef: 'file:.sciforge/projects/smoke-notebook/artifacts/1-clean.csv',
    createdAt: '2026-05-13T00:01:00.000Z',
  });
  await appendTaskStage(workspace, 'smoke-notebook', {
    kind: 'execute',
    goal: 'Fit model.',
    status: 'done',
    codeRef: 'file:.sciforge/projects/smoke-notebook/src/2-fit.py',
    inputRef: 'file:.sciforge/projects/smoke-notebook/artifacts/1-clean.csv',
    outputRef: 'file:.sciforge/projects/smoke-notebook/artifacts/2-fit.json',
    artifactRefs: ['artifact:smoke-notebook:fit-v1'],
    metadata: { parameters: { model: { alpha: 0.05 } } },
    createdAt: '2026-05-13T00:02:00.000Z',
  });
  await appendTaskStage(workspace, 'smoke-notebook', {
    kind: 'summarize',
    goal: 'Render report from fit output.',
    status: 'done',
    inputRef: 'file:.sciforge/projects/smoke-notebook/artifacts/2-fit.json',
    outputRef: 'file:.sciforge/projects/smoke-notebook/artifacts/3-report.md',
    artifactRefs: ['artifact:smoke-notebook:report-v1'],
    createdAt: '2026-05-13T00:03:00.000Z',
  });

  const forked = await forkTaskProjectStage(workspace, 'smoke-notebook', {
    baseStageId: '2-execute',
    branchId: 'alpha-001',
    parameterChanges: [{ key: 'model.alpha', before: 0.05, after: 0.01 }],
    createdAt: '2026-05-13T00:04:00.000Z',
  });
  assert.equal(forked.stage.id, '4-execute');
  assert.equal(forked.branchMetadata.sideEffectPolicy, 'fork-before-write');
  assert.ok(forked.branchMetadata.invalidatedRefs.includes('file:.sciforge/projects/smoke-notebook/artifacts/2-fit.json'));
  assert.ok(forked.branchMetadata.invalidatedRefs.includes('file:.sciforge/projects/smoke-notebook/artifacts/3-report.md'));

  const run = await runTaskProjectStage(workspace, 'smoke-notebook', forked.stage.id, {
    now: () => '2026-05-13T00:05:00.000Z',
    runner: async (_workspace: string, spec: WorkspaceTaskSpec): Promise<WorkspaceTaskRunResult> => {
      await mkdir(join(workspace, '.sciforge', 'projects', 'smoke-notebook', 'evidence'), { recursive: true });
      await mkdir(join(workspace, '.sciforge', 'projects', 'smoke-notebook', 'logs'), { recursive: true });
      const payload = {
        message: 'Branch fit completed with alpha=0.01.',
        confidence: 0.9,
        claimType: 'execution',
        evidenceLevel: 'runtime',
        reasoningTrace: 'notebook branch smoke',
        claims: [],
        uiManifest: [{ componentId: 'notebook-timeline', artifactRef: 'artifact:smoke-notebook:fit-alpha-001' }],
        executionUnits: [{
          id: 'branch-fit-alpha-001',
          status: 'done',
          tool: 'task-project.branch',
          evidenceRefs: [forked.branchEvidenceRef],
        }],
        artifacts: [{
          id: 'fit-alpha-001',
          type: 'notebook-branch-result',
          dataRef: '.sciforge/projects/smoke-notebook/artifacts/2-fit-alpha-001.json',
          metadata: {
            artifactRef: 'artifact:smoke-notebook:fit-alpha-001',
            derivation: {
              kind: 'notebook-branch',
              parentArtifactRef: 'artifact:smoke-notebook:fit-v1',
              sourceRefs: [forked.branchEvidenceRef, 'file:.sciforge/projects/smoke-notebook/artifacts/1-clean.csv'],
              verificationStatus: 'verified',
            },
          },
        }],
      };
      await writeFile(join(workspace, spec.outputRel), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      await writeFile(join(workspace, spec.stdoutRel), 'alpha=0.01\n', 'utf8');
      await writeFile(join(workspace, spec.stderrRel), '', 'utf8');
      return {
        spec: { ...spec, taskRel: spec.taskRel ?? spec.entrypoint },
        workspace,
        command: 'mock-notebook-branch-runner',
        args: [],
        exitCode: 0,
        stdout: 'alpha=0.01\n',
        stderr: '',
        outputRef: spec.outputRel,
        stdoutRef: spec.stdoutRel,
        stderrRef: spec.stderrRel,
        runtimeFingerprint: { runner: 'smoke-notebook-branch' },
      };
    },
  });

  assert.equal(run.stage.status, 'done');
  assert.ok(run.stage.artifactRefs.includes('artifact:smoke-notebook:fit-alpha-001'));
  assert.ok(run.stage.evidenceRefs.includes(forked.branchEvidenceRef));
  assert.ok(run.stage.outputRef?.endsWith('/4-execute-output.json'));
  assert.deepEqual(run.stage.metadata?.branch, forked.branchMetadata);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log('[ok] notebook branch replay retains upstream refs, invalidates downstream refs, forks TaskProject stage, and records branch output lineage');
