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

  it('exports final-shape event log, restored projection, refs manifest, and audit-only raw boundary', () => {
    const session = fixtureSession({
      id: 'artifact-final-shape',
      exportPolicy: 'allowed',
      dataRef: '.sciforge/sessions/2026-05-13_lit_session-final/artifacts/report.md',
      metadata: { runId: 'run-1' },
    });
    session.runs[0] = {
      ...session.runs[0]!,
      raw: {
        displayIntent: {
          conversationEventLogRef: '.sciforge/sessions/2026-05-13_lit_session-final/records/conversation-event-log.json',
          conversationEventLogDigest: 'sha256:event-log',
          conversationEventLog: {
            schemaVersion: 'sciforge.conversation-event-log.v1',
            conversationId: 'conversation-final-shape',
            events: [
              {
                id: 'event-turn',
                type: 'TurnReceived',
                actor: 'user',
                storage: 'inline',
                timestamp: '2026-05-13T00:00:00.000Z',
                turnId: 'turn-1',
                payload: { prompt: 'export final shape', summary: 'export final shape' },
              },
              {
                id: 'event-dispatch',
                type: 'Dispatched',
                actor: 'kernel',
                storage: 'inline',
                timestamp: '2026-05-13T00:00:01.000Z',
                turnId: 'turn-1',
                runId: 'run-1',
                payload: { summary: 'dispatched' },
              },
              {
                id: 'event-output',
                type: 'OutputMaterialized',
                actor: 'runtime',
                storage: 'ref',
                timestamp: '2026-05-13T00:00:02.000Z',
                turnId: 'turn-1',
                runId: 'run-1',
                payload: {
                  summary: 'materialized report',
                  refs: [
                    {
                      ref: 'artifact:artifact-final-shape',
                      digest: 'sha256:artifact',
                      mime: 'text/markdown',
                      label: 'report',
                    },
                  ],
                },
              },
              {
                id: 'event-satisfied',
                type: 'Satisfied',
                actor: 'runtime',
                storage: 'ref',
                timestamp: '2026-05-13T00:00:03.000Z',
                turnId: 'turn-1',
                runId: 'run-1',
                payload: {
                  text: 'Report is ready.',
                  summary: 'Report is ready.',
                  refs: [{ ref: 'artifact:artifact-final-shape', label: 'report' }],
                },
              },
            ],
          },
        },
      },
    };
    session.executionUnits[0] = {
      ...session.executionUnits[0]!,
      stdoutRef: '.sciforge/sessions/2026-05-13_lit_session-final/logs/stdout.log',
      stderrRef: '.sciforge/sessions/2026-05-13_lit_session-final/logs/stderr.log',
      outputArtifacts: ['artifact-final-shape'],
    };

    const decision = evaluateExecutionBundleExport(session, { activeRun: session.runs[0] });
    const bundle = buildExecutionBundle(session, decision, { activeRun: session.runs[0] });

    assert.equal(bundle.finalShape.truthSource, 'ConversationEventLog');
    assert.equal(bundle.conversationEventLogs[0]?.eventLog.conversationId, 'conversation-final-shape');
    assert.equal(bundle.restoredConversationProjections[0]?.projection.visibleAnswer?.status, 'satisfied');
    assert.equal(bundle.restoredConversationProjections[0]?.projection.visibleAnswer?.text, 'Report is ready.');
    assert.equal(
      bundle.refsManifest.refs.find((ref) => ref.ref === 'artifact:artifact-final-shape')?.boundary,
      'event-log-truth',
    );
    assert.equal(
      bundle.refsManifest.refs.find((ref) => ref.ref.endsWith('/artifacts/report.md'))?.boundary,
      'artifact-summary',
    );
    assert.equal(
      bundle.refsManifest.refs.find((ref) => ref.ref.endsWith('/logs/stdout.log'))?.boundary,
      'audit-only-raw-attachment',
    );
    assert.equal(bundle.auditOnlyRawAttachments.boundary, 'audit-only');
    assert.deepEqual(bundle.auditOnlyRawAttachments.executionUnits.map((unit) => unit.id), ['EU-export']);
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
