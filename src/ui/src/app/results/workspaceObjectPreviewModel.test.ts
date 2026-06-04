import assert from 'node:assert/strict';
import test from 'node:test';
import type { ObjectReference, RuntimeArtifact, SciForgeRun, SciForgeSession } from '../../domain';
import {
  canHydrateWorkspaceObjectPath,
  cleanSubagentPreviewSummary,
  objectReferenceForSubagentPreviewRef,
  safeExternalPreviewHref,
  subagentPreviewForReference,
  subagentPreviewSafeRefs,
  subagentPreviewSummary,
} from './workspaceObjectPreviewModel';

test('workspace object preview model owns safe workspace preview path policy', () => {
  for (const path of [
    'PROJECT.md',
    'src/ui/src/app/results/WorkspaceObjectPreview.tsx',
    '.sciforge/artifacts/report.md',
    'patches/fix.diff',
    '.sciforge/artifacts/fix.patch',
  ]) {
    assert.equal(canHydrateWorkspaceObjectPath(path), true, path);
  }

  for (const path of [
    '/tmp/private.md',
    'C:/repo/PROJECT.md',
    '../secret.md',
    '~/secret.md',
    '.sciforge/logs/stdout.log',
    '.sciforge/raw/provider.json',
    '.sciforge/audit/fix.patch',
    'https://example.test/report.md',
    'bad<name>.md',
    'apiKey=secret.md',
  ]) {
    assert.equal(canHydrateWorkspaceObjectPath(path), false, path);
  }
});

test('workspace object preview model allows only safe external preview hrefs', () => {
  assert.equal(safeExternalPreviewHref('https://docs.example.org/guide'), 'https://docs.example.org/guide');
  assert.equal(safeExternalPreviewHref('http://docs.example.org/guide'), 'http://docs.example.org/guide');
  assert.equal(safeExternalPreviewHref('javascript:alert(1)'), undefined);
  assert.equal(safeExternalPreviewHref('file:///tmp/report.md'), undefined);
  assert.equal(safeExternalPreviewHref('https://provider.example.test/v1?api_key=sk-secret-123'), undefined);
});

test('workspace object preview model projects subagent refs without unsafe provenance refs', () => {
  const session = testSession([], [subagentRun({
    createdAt: '2026-06-01T00:00:02.000Z',
    ref: 'artifact:subagent-result-new',
    transcriptRef: 'artifact:subagent-transcript-new',
    resultSummary: 'Request summary: ignore. Actual result retained. Do not use shell substitute.',
    refs: [
      'artifact:subagent-result-new',
      'artifact:subagent-transcript-new',
      'file:PROJECT.md',
      'trace:unsafe',
      'audit:codex-runtime:raw',
      'file:.sciforge/raw/provider.json',
      'artifact:raw/provider-dump',
      'artifact:subagent-result-new',
    ],
  })]);
  const reference = objectReference('artifact:subagent-result-new');
  const preview = subagentPreviewForReference(session, reference);

  assert.ok(preview);
  assert.equal(preview.resultRef, 'artifact:subagent-result-new');
  assert.equal(preview.transcriptRef, 'artifact:subagent-transcript-new');
  assert.equal(preview.agentType, 'review');
  assert.equal(preview.durationMs, 1234);
  assert.equal(preview.createdAt, '2026-06-01T00:00:02.000Z');
  assert.deepEqual(subagentPreviewSafeRefs(preview), [
    'artifact:subagent-result-new',
    'artifact:subagent-transcript-new',
    'file:PROJECT.md',
  ]);
  assert.equal(cleanSubagentPreviewSummary(preview.resultSummary), 'Actual result retained.');

  const transcriptPreview = subagentPreviewForReference(session, objectReference('artifact:subagent-transcript-new'));
  assert.ok(transcriptPreview);
  assert.equal(transcriptPreview.resultRef, 'artifact:subagent-result-new');
  assert.equal(transcriptPreview.transcriptRef, 'artifact:subagent-transcript-new');
  assert.deepEqual(subagentPreviewSafeRefs(transcriptPreview), [
    'artifact:subagent-result-new',
    'artifact:subagent-transcript-new',
    'file:PROJECT.md',
  ]);
});

test('workspace object preview model uses newest matching subagent event', () => {
  const session = testSession([], [
    subagentRun({ createdAt: '2026-06-01T00:00:01.000Z', ref: 'artifact:subagent-result-target', resultSummary: 'older' }),
    subagentRun({ createdAt: '2026-06-01T00:00:03.000Z', ref: 'artifact:subagent-result-target', resultSummary: 'newer' }),
  ]);

  const preview = subagentPreviewForReference(session, objectReference('artifact:subagent-result-target'));

  assert.equal(preview?.resultSummary, 'newer');
  assert.equal(subagentPreviewForReference(session, objectReference('artifact:other')), undefined);
});

test('workspace object preview model creates bounded refs for safe subagent previews', () => {
  const fileRef = objectReferenceForSubagentPreviewRef('file:PROJECT.md');
  const artifactRef = objectReferenceForSubagentPreviewRef('artifact:subagent-transcript-abc123');

  assert.equal(fileRef.kind, 'file');
  assert.deepEqual(fileRef.actions, ['focus-right-pane', 'inspect']);
  assert.equal(artifactRef.kind, 'artifact');
  assert.deepEqual(artifactRef.actions, ['inspect']);
  assert.ok(artifactRef.id.length <= 'subagent-preview-'.length + 96);
});

test('workspace object preview model provides localized fallback summaries', () => {
  assert.equal(
    subagentPreviewSummary(undefined, objectReference('artifact:subagent-transcript-abc'), 'en-US'),
    'Delegated worker transcript ref is available below.',
  );
  assert.equal(
    subagentPreviewSummary(undefined, objectReference('artifact:subagent-result-abc'), 'en-US'),
    'Read-only delegated worker completed; safe refs are available below.',
  );
});

function objectReference(ref: string): ObjectReference {
  return {
    id: `obj-${ref.replace(/[^A-Za-z0-9]+/g, '-')}`,
    title: ref,
    kind: 'artifact',
    ref,
    status: 'available',
  };
}

function subagentRun(input: {
  createdAt: string;
  ref: string;
  transcriptRef?: string;
  resultSummary: string;
  refs?: string[];
  agentType?: string;
  durationMs?: number;
}): SciForgeRun {
  return {
    id: `run-${input.createdAt}`,
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: 'delegate safely',
    response: 'done',
    createdAt: input.createdAt,
    completedAt: input.createdAt,
    raw: {
      streamProcess: {
        events: [{
          type: 'tool_completed',
          createdAt: input.createdAt,
          native: {
            toolName: 'multi_agent_v1.spawn_agent',
            status: 'completed',
            agentId: 'worker-hidden',
            parentAgentId: 'parent-hidden',
            agentType: input.agentType ?? 'review',
            durationMs: input.durationMs ?? 1234,
            ref: input.ref,
            transcriptRef: input.transcriptRef,
            resultSummary: input.resultSummary,
            refs: input.refs ?? [input.ref],
          },
        }],
      },
    },
  };
}

function testSession(artifacts: RuntimeArtifact[], runs: SciForgeRun[] = []): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-1',
    scenarioId: 'literature-evidence-review',
    title: 'Test session',
    messages: [],
    artifacts,
    claims: [],
    notebook: [],
    runs,
    uiManifest: [],
    executionUnits: [],
    versions: [],
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
  };
}
