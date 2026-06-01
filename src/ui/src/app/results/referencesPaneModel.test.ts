import assert from 'node:assert/strict';
import test from 'node:test';
import type { ObjectReference, RuntimeArtifact, RuntimeExecutionUnit, SciForgeRun, SciForgeSession } from '../../domain';
import type { RuntimeResolvedViewPlan } from './viewPlanResolver';
import {
  buildRightPaneReferencesTraceIndex,
  groupObjectReferencesByKind,
  rightPaneCopyableReferenceText,
  rightPaneObjectReferences,
  rightPaneReferenceKindGroupLabel,
  rightPaneReferenceKindIsKnown,
  rightPaneReferenceProvenanceRows,
  rightPaneReferenceTraceRows,
} from './referencesPaneModel';

test('references pane model builds an active-run object index without duplicate refs', () => {
  const activeRun = completedRun('run-active');
  const artifact: RuntimeArtifact = {
    id: 'report-active',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { runId: 'run-active' },
    data: { markdown: '# Report' },
  };
  const fileRef: ObjectReference = {
    id: 'file-message',
    kind: 'file',
    title: 'PROJECT_right.md',
    ref: 'file:PROJECT_right.md',
    runId: 'run-active',
    status: 'available',
    provenance: { path: 'PROJECT_right.md', producer: 'message-ref' },
  };
  const executionUnit: RuntimeExecutionUnit = {
    id: 'EU-active',
    tool: 'shell_command',
    params: '{}',
    status: 'failed',
    hash: 'hash-active',
    runId: 'run-active',
    outputRef: 'artifact:terminal-output',
  };
  const session: SciForgeSession = {
    ...emptySession(),
    runs: [{
      ...activeRun,
      objectReferences: [
        { ...fileRef, id: 'file-run-duplicate' },
        {
          id: 'unknown-run-object',
          kind: 'opaque-model-output' as ObjectReference['kind'],
          title: 'Opaque',
          ref: 'opaque:object',
          summary: 'unsupported object',
        } as unknown as ObjectReference,
      ],
    }, {
      ...completedRun('run-other'),
      objectReferences: [{
        id: 'other-run-url',
        kind: 'url',
        title: 'Other URL',
        ref: 'url:https://example.org/other',
        runId: 'run-other',
      }],
    }],
    messages: [{
      id: 'message-active',
      role: 'scenario',
      content: 'message refs',
      createdAt: '2026-06-01T00:00:00.000Z',
      objectReferences: [
        fileRef,
        {
          id: 'message-other-url',
          kind: 'url',
          title: 'Other URL',
          ref: 'url:https://example.org/message-other',
          runId: 'run-other',
        },
      ],
    }],
    artifacts: [artifact],
    executionUnits: [executionUnit],
  };

  const references = rightPaneObjectReferences(session, session.runs[0]);
  const refs = references.map((reference) => reference.ref);

  assert.equal(refs.filter((ref) => ref === 'file:PROJECT_right.md').length, 1);
  assert.ok(refs.includes('artifact:report-active'));
  assert.ok(refs.includes('execution-unit:EU-active'));
  assert.ok(refs.includes('opaque:object'));
  assert.ok(!refs.includes('url:https://example.org/other'));
  assert.ok(!refs.includes('url:https://example.org/message-other'));
});

test('references pane trace index links run, projection, execution, view-plan, claim, and notebook provenance', () => {
  const activeRun = completedRun('run-trace');
  const artifact: RuntimeArtifact = {
    id: 'report-trace',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { runId: 'run-trace' },
    data: { markdown: '# Report' },
  };
  const fileRef: ObjectReference = {
    id: 'file-trace',
    kind: 'file',
    title: 'Trace source',
    ref: 'file:PROJECT_right.md',
    runId: 'run-trace',
    status: 'available',
  };
  const executionUnit: RuntimeExecutionUnit = {
    id: 'EU-trace',
    tool: 'shell_command',
    params: '{}',
    status: 'done',
    hash: 'hash-trace',
    runId: 'run-trace',
    inputData: ['file:PROJECT_right.md'],
    outputRef: 'artifact:report-trace',
    stdoutRef: 'terminal-transcript:EU-trace',
  };
  const session = {
    ...emptySession(),
    currentConversationProjection: {
      schemaVersion: 'sciforge.conversation-projection.v1',
      conversationId: 'conversation-trace',
      visibleAnswer: {
        status: 'validated',
        artifactRefs: ['artifact:report-trace'],
      },
      artifacts: [{ ref: 'artifact:report-trace', label: 'Report' }],
      executionProcess: [],
      recoverActions: [],
      runtimeMetadata: { auditRefs: ['trace:audit-trace'] },
      auditRefs: ['trace:audit-trace'],
      diagnostics: [{
        severity: 'error',
        code: 'D1',
        message: 'diagnostic with ref',
        refs: [{ ref: 'file:diagnostic.md' }],
      }],
    },
    runs: [{ ...activeRun, objectReferences: [fileRef] }],
    messages: [{
      id: 'message-trace',
      role: 'scenario',
      content: 'declared file ref',
      createdAt: '2026-06-01T00:00:00.000Z',
      objectReferences: [fileRef],
    }],
    artifacts: [artifact],
    executionUnits: [executionUnit],
    claims: [{
      id: 'claim-trace',
      text: 'The trace is connected.',
      type: 'fact',
      confidence: 0.9,
      evidenceLevel: 'experimental',
      supportingRefs: ['artifact:report-trace'],
      opposingRefs: ['file:diagnostic.md'],
      dependencyRefs: ['execution-unit:EU-trace'],
      updatedAt: '2026-06-01T00:00:00.000Z',
    }],
    notebook: [{
      id: 'note-trace',
      time: '2026-06-01T00:00:00.000Z',
      scenario: 'literature-evidence-review',
      title: 'Notebook trace',
      desc: 'links output artifact and execution',
      claimType: 'fact',
      confidence: 0.8,
      artifactRefs: ['report-trace'],
      executionUnitRefs: ['EU-trace'],
    }],
  } satisfies SciForgeSession & { currentConversationProjection: unknown };
  const viewPlan = {
    allItems: [{
      id: 'slot-trace',
      slot: { componentId: 'markdown-viewer', title: 'Report', artifactRef: 'report-trace' },
      module: { moduleId: 'markdown-viewer', componentId: 'markdown-viewer', title: 'Markdown' },
      artifact,
      section: 'primary',
      source: 'display-intent',
      status: 'bound',
    }],
    diagnostics: ['missing optional preview adapter'],
  } as unknown as Pick<RuntimeResolvedViewPlan, 'allItems' | 'diagnostics'>;
  const references = rightPaneObjectReferences(session, activeRun);

  const index = buildRightPaneReferencesTraceIndex({ session, activeRun, references, viewPlan });
  const edgeKeys = index.edges.map((edge) => `${edge.sourceRef}->${edge.targetRef}:${edge.relation}:${edge.source}`);

  assert.ok(edgeKeys.includes('run:run-trace->file:PROJECT_right.md:declares:run'));
  assert.ok(edgeKeys.includes('file:PROJECT_right.md->execution-unit:EU-trace:consumes:execution-unit'));
  assert.ok(edgeKeys.includes('execution-unit:EU-trace->artifact:report-trace:produces:execution-unit'));
  assert.ok(edgeKeys.includes('view-plan:slot-trace->artifact:report-trace:presents:view-plan'));
  assert.ok(edgeKeys.includes('artifact:report-trace->claim:claim-trace:supports:claim'));
  assert.ok(edgeKeys.includes('artifact:report-trace->notebook:note-trace:declares:notebook'));
  assert.ok(index.nodes.some((node) => node.kind === 'diagnostic' && node.ref.startsWith('diagnostic:')));
  assert.ok(rightPaneReferenceTraceRows(fileRef, index).some(([, value]) => value.includes('consumes execution-unit:EU-trace')));
});

test('references pane model groups supported refs before typed unsupported objects', () => {
  const references: ObjectReference[] = [
    { id: 'unknown', kind: 'opaque' as ObjectReference['kind'], title: 'Unknown', ref: 'opaque:1' } as unknown as ObjectReference,
    { id: 'file', kind: 'file', title: 'File', ref: 'file:README.md' },
    { id: 'url', kind: 'url', title: 'URL', ref: 'url:https://example.org' },
    { id: 'artifact', kind: 'artifact', title: 'Artifact', ref: 'artifact:report' },
  ];

  const groups = groupObjectReferencesByKind(references);

  assert.deepEqual(groups.map((group) => group.kind), ['artifact', 'file', 'url', 'unsupported']);
  assert.equal(rightPaneReferenceKindGroupLabel('unsupported'), 'unsupported object');
  assert.equal(rightPaneReferenceKindIsKnown(references[0]), false);
  assert.equal(rightPaneReferenceKindIsKnown(references[1]), true);
});

test('references pane provenance rows are refs-first, bounded, and sanitized', () => {
  const reference: ObjectReference = {
    id: 'secret-ref',
    kind: 'file',
    title: 'Secret source',
    ref: 'file:/Users/example/private/token.txt',
    runId: 'run-secret',
    executionUnitId: 'EU-secret',
    provenance: {
      path: '/Users/example/private/token.txt',
      dataRef: '.sciforge/raw/provider.log',
      producer: 'provider secret sk-1234567890',
      hash: 'hash-secret',
      size: 2048,
    },
  };

  const rows = rightPaneReferenceProvenanceRows(reference);
  const text = rows.map(([, value]) => value).join(' ');

  assert.ok(rows.length <= 8);
  assert.match(text, /\[redacted-local-path\]/);
  assert.match(text, /\[redacted-audit-ref\]/);
  assert.match(text, /\[redacted-secret\]/);
  assert.match(text, /2048 bytes/);
  assert.equal(rightPaneCopyableReferenceText('url:https://example.org/paper'), 'url:https://example.org/paper');
});

function emptySession(): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-empty',
    scenarioId: 'literature-evidence-review',
    title: 'empty',
    createdAt: '2026-06-01T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

function completedRun(id: string): SciForgeRun {
  return {
    id,
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: 'inspect refs',
    response: 'done',
    createdAt: '2026-06-01T00:00:00.000Z',
    completedAt: '2026-06-01T00:01:00.000Z',
  };
}
