import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SciForgeSession, RuntimeArtifact } from './domain';
import { buildExecutionBundle, evaluateExecutionBundleExport } from './exportPolicy';

describe('execution bundle export policy', () => {
  it('blocks bundle export when an artifact policy is blocked', () => {
    const session = fixtureSession({
      id: 'artifact-sensitive',
      exportPolicy: 'blocked',
      sensitiveDataFlags: ['human-subject'],
    });

    const decision = evaluateExecutionBundleExport(session);

    assert.equal(decision.allowed, false);
    assert.deepEqual(decision.blockedArtifactIds, ['artifact-sensitive']);
    assert.deepEqual(decision.sensitiveFlags, ['human-subject']);
    assert.throws(() => buildExecutionBundle(session, decision), /Export blocked/);
  });

  it('allows restricted exports but records audience and sensitive warnings', () => {
    const session = fixtureSession({
      id: 'artifact-team',
      exportPolicy: 'restricted',
      audience: ['team-a'],
      sensitiveDataFlags: ['cell-line-proprietary'],
    });

    const decision = evaluateExecutionBundleExport(session);
    const bundle = buildExecutionBundle(session, decision);

    assert.equal(decision.allowed, true);
    assert.deepEqual(bundle.exportPolicy.restrictedArtifactIds, ['artifact-team']);
    assert.deepEqual(bundle.exportPolicy.sensitiveDataFlags, ['cell-line-proprietary']);
    assert.match(bundle.exportPolicy.warnings.join('\n'), /restricted artifact artifact-team/);
    assert.equal(bundle.artifacts[0].exportPolicy, 'restricted');
    assert.deepEqual(bundle.artifacts[0].audience, ['team-a']);
    assert.deepEqual(bundle.runs[0].scenarioPackageRef, { id: 'omics-differential-exploration', version: '1.0.0', source: 'built-in' });
    assert.equal(bundle.runs[0].skillPlanRef, 'skill-plan.omics-differential-exploration.default');
    assert.deepEqual(bundle.artifacts[0].scenarioPackageRef, { id: 'omics-differential-exploration', version: '1.0.0', source: 'built-in' });
  });

  it('exports the selected run bundle refs, task graph, lineage, commands, and artifact refs without using later empty state', () => {
    const session = fixtureSession({
      id: 'artifact-run-1',
      exportPolicy: 'allowed',
      dataRef: '.sciforge/sessions/2026-05-12_omics_session-export-policy/artifacts/artifact-run-1.json',
      metadata: { runId: 'run-1' },
    });
    session.runs[0] = {
      ...session.runs[0]!,
      raw: {
        sessionBundleRef: '.sciforge/sessions/2026-05-12_omics_session-export-policy',
        refs: ['artifact:artifact-run-1', 'execution-unit:EU-export'],
        auditRefs: ['.sciforge/sessions/2026-05-12_omics_session-export-policy/records/session-bundle-audit.json'],
      },
      objectReferences: [{ id: 'obj-artifact-run-1', kind: 'artifact', ref: 'artifact:artifact-run-1', title: 'run 1 artifact' }],
    };
    session.runs.push({
      id: 'run-empty-current',
      scenarioId: 'omics-differential-exploration',
      status: 'completed',
      prompt: 'empty later run',
      response: '',
      createdAt: '2026-04-20T00:02:00.000Z',
      completedAt: '2026-04-20T00:03:00.000Z',
    });
    session.artifacts.push({
      id: 'artifact-unrelated-blocked',
      type: 'omics-differential-expression',
      producerScenario: 'omics-differential-exploration',
      schemaVersion: '1',
      exportPolicy: 'blocked',
      metadata: { runId: 'run-empty-current' },
    });
    session.executionUnits[0] = {
      ...session.executionUnits[0]!,
      code: 'python task.py --input task-input.json',
      codeRef: '.sciforge/sessions/2026-05-12_omics_session-export-policy/tasks/task.py',
      stdoutRef: '.sciforge/sessions/2026-05-12_omics_session-export-policy/logs/task.stdout.log',
      stderrRef: '.sciforge/sessions/2026-05-12_omics_session-export-policy/logs/task.stderr.log',
      verificationRef: '.sciforge/sessions/2026-05-12_omics_session-export-policy/verifications/task.json',
      inputData: ['.sciforge/sessions/2026-05-12_omics_session-export-policy/task-inputs/task.json'],
      outputArtifacts: ['artifact-run-1'],
    };

    const scopedDecision = evaluateExecutionBundleExport(session, {
      activeRun: session.runs[0],
      executionUnits: [session.executionUnits[0]!],
    });
    const bundle = buildExecutionBundle(session, scopedDecision, {
      activeRun: session.runs[0],
      executionUnits: [session.executionUnits[0]!],
    });

    assert.equal(scopedDecision.allowed, true);
    assert.equal(bundle.activeRunId, 'run-1');
    assert.deepEqual(bundle.runs.map((run) => run.id), ['run-1']);
    assert.equal(bundle.runs[0]?.sessionBundleRef, '.sciforge/sessions/2026-05-12_omics_session-export-policy');
    assert.deepEqual(bundle.executionUnits.map((unit) => unit.id), ['EU-export']);
    assert.deepEqual(bundle.artifacts.map((artifact) => artifact.id), ['artifact-run-1']);
    assert.deepEqual(bundle.sessionBundleRefs, [
      '.sciforge/sessions/2026-05-12_omics_session-export-policy',
      '.sciforge/sessions/2026-05-12_omics_session-export-policy/records/session-bundle-audit.json',
      '.sciforge/sessions/2026-05-12_omics_session-export-policy/tasks/task.py',
      '.sciforge/sessions/2026-05-12_omics_session-export-policy/logs/task.stdout.log',
      '.sciforge/sessions/2026-05-12_omics_session-export-policy/logs/task.stderr.log',
      '.sciforge/sessions/2026-05-12_omics_session-export-policy/verifications/task.json',
      '.sciforge/sessions/2026-05-12_omics_session-export-policy/task-inputs/task.json',
      '.sciforge/sessions/2026-05-12_omics_session-export-policy/artifacts/artifact-run-1.json',
    ]);
    assert.ok(bundle.taskGraph.nodes.some((node) => node.id === 'EU-export' && node.kind === 'execution-unit'));
    assert.ok(bundle.taskGraph.edges.some((edge) => edge.from === 'EU-export' && edge.to === 'artifact-run-1' && edge.kind === 'output'));
    assert.deepEqual(bundle.dataLineage[0]?.inputRefs, ['.sciforge/sessions/2026-05-12_omics_session-export-policy/task-inputs/task.json']);
    assert.equal(bundle.executionCommands[0]?.command, 'python task.py --input task-input.json');
    assert.ok(bundle.artifactRefs.includes('artifact:artifact-run-1'));
    assert.equal(bundle.runs.some((run) => run.id === 'run-empty-current'), false);
  });

  it('keeps active-run exports useful for compact single-run sessions and TaskRunCard refs', () => {
    const session = fixtureSession({
      id: 'artifact-card-ref',
      exportPolicy: 'allowed',
      dataRef: '.sciforge/sessions/2026-05-13_lit_session-card/artifacts/report.md',
    });
    session.runs[0] = {
      ...session.runs[0]!,
      raw: {
        displayIntent: {
          taskRunCard: {
            refs: [
              { kind: 'bundle', ref: '.sciforge/sessions/2026-05-13_lit_session-card' },
              { kind: 'artifact', ref: 'artifact:artifact-card-ref' },
              { kind: 'file', ref: '.sciforge/sessions/2026-05-13_lit_session-card/records/session-bundle-audit.json' },
            ],
          },
        },
      },
    };

    const decision = evaluateExecutionBundleExport(session, { activeRun: session.runs[0] });
    const bundle = buildExecutionBundle(session, decision, { activeRun: session.runs[0] });

    assert.equal(decision.allowed, true);
    assert.deepEqual(bundle.executionUnits.map((unit) => unit.id), ['EU-export']);
    assert.deepEqual(bundle.artifacts.map((artifact) => artifact.id), ['artifact-card-ref']);
    assert.ok(bundle.sessionBundleRefs.includes('.sciforge/sessions/2026-05-13_lit_session-card'));
    assert.ok(bundle.sessionBundleRefs.includes('.sciforge/sessions/2026-05-13_lit_session-card/records/session-bundle-audit.json'));
  });
});

function fixtureSession(artifact: Pick<RuntimeArtifact, 'id'> & Partial<RuntimeArtifact>): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-export-policy',
    scenarioId: 'omics-differential-exploration',
    title: 'Export policy smoke',
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-1',
      scenarioId: 'omics-differential-exploration',
      scenarioPackageRef: { id: 'omics-differential-exploration', version: '1.0.0', source: 'built-in' },
      skillPlanRef: 'skill-plan.omics-differential-exploration.default',
      uiPlanRef: 'ui-plan.omics-differential-exploration.default',
      status: 'completed',
      prompt: 'export',
      response: 'done',
      createdAt: '2026-04-20T00:00:00.000Z',
      completedAt: '2026-04-20T00:00:00.000Z',
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [{
      id: 'EU-export',
      tool: 'omics.runner',
      params: '{}',
      status: 'done',
      hash: 'hash-export',
      outputArtifacts: [artifact.id],
    }],
    artifacts: [{
      ...artifact,
      type: 'omics-differential-expression',
      producerScenario: 'omics-differential-exploration',
      scenarioPackageRef: { id: 'omics-differential-exploration', version: '1.0.0', source: 'built-in' },
      schemaVersion: '1',
    }],
    notebook: [],
    versions: [],
  };
}
