import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ObjectReference } from '../../domain';
import { SubagentArtifactPreview } from './workspaceObjectPreviewSubagentAdapter';

test('workspace object preview subagent adapter renders safe delegated refs without raw event payloads', () => {
  const html = renderToStaticMarkup(createElement(SubagentArtifactPreview, {
    reference: subagentReference(),
    preview: {
      agentId: 'worker-abc123',
      parentAgentId: 'codex-command-private',
      agentType: 'review',
      status: 'completed Authorization: Bearer sk-status-secret',
      durationMs: 2468,
      createdAt: '2026-06-01T00:00:00.000Z',
      resultSummary: [
        'Read-only delegated worker completed.',
        'Request summary: call multi_agent_v1.spawn_agent once.',
        'Do not use shell substitute.',
        'Remaining live parity TODO: sub-agent transcript ref evidence.',
        'Authorization: Bearer sk-summary-secret',
      ].join(' '),
      resultRef: 'artifact:subagent-result-abc123',
      transcriptRef: 'artifact:subagent-transcript-abc123',
      refs: [
        'artifact:subagent-result-abc123',
        'artifact:subagent-transcript-abc123',
        'file:PROJECT_right.md',
        'trace:unsafe-subagent',
        'file:.sciforge/raw/provider.json',
      ],
    },
    locale: 'en-US',
    onObjectReferenceFocus: () => undefined,
  }));

  assert.match(html, /Subtask result/);
  assert.match(html, /workspace-object-preview/);
  assert.match(html, /data-sciforge-reference=/);
  assert.match(html, /review/);
  assert.match(html, /Child task/);
  assert.match(html, /2\.5s/);
  assert.match(html, /artifact:subagent-result-abc123/);
  assert.match(html, /artifact:subagent-transcript-abc123/);
  assert.match(html, /file:PROJECT_right\.md/);
  assert.match(html, /<details/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.equal((html.match(/<button\b/g) ?? []).length, 3);
  assert.match(html, /Remaining live parity TODO/);
  assert.match(html, /redacted-secret/);
  assert.doesNotMatch(html, /worker-abc123|codex-command-private|Request summary|call multi_agent_v1|Do not use shell substitute/);
  assert.doesNotMatch(html, /trace:unsafe-subagent|\.sciforge\/raw|sk-status-secret|sk-summary-secret|resume/i);
});

test('workspace object preview subagent adapter falls back to code refs without focus callbacks', () => {
  const html = renderToStaticMarkup(createElement(SubagentArtifactPreview, {
    reference: subagentReference('artifact:subagent-transcript-xyz'),
    preview: {
      status: 'completed',
      refs: ['artifact:subagent-transcript-xyz'],
    },
    locale: 'en-US',
  }));

  assert.match(html, /Delegated worker transcript ref is available below/);
  assert.match(html, /<code title="artifact:subagent-transcript-xyz">artifact:subagent-transcript-xyz<\/code>/);
  assert.doesNotMatch(html, /<button/);
});

test('workspace object preview subagent adapter owns subagent JSX outside WorkspaceObjectPreview', () => {
  const componentSource = readFileSync('src/ui/src/app/results/WorkspaceObjectPreview.tsx', 'utf8');
  const adapterSource = readFileSync('src/ui/src/app/results/workspaceObjectPreviewSubagentAdapter.tsx', 'utf8');

  assert.match(componentSource, /workspaceObjectPreviewSubagentAdapter/);
  assert.doesNotMatch(componentSource, /function SubagentArtifactPreview/);
  assert.doesNotMatch(componentSource, /subagentPreviewSafeRefs|subagentPreviewSummary|objectReferenceForSubagentPreviewRef/);
  assert.match(adapterSource, /function SubagentArtifactPreview/);
  assert.match(adapterSource, /subagentPreviewSafeRefs/);
  assert.match(adapterSource, /subagentPreviewSummary/);
  assert.match(adapterSource, /objectReferenceForSubagentPreviewRef/);
  assert.match(adapterSource, /data-sciforge-reference/);
  assert.match(adapterSource, /onObjectReferenceFocus/);
  assert.doesNotMatch(adapterSource, /subagentPreviewForReference|useWorkspaceObjectPreviewHydration|hydrateWorkspaceObjectPreview|readWorkspaceFile|readPreviewDescriptor|readPreviewDerivative|workspaceObjectPreviewRoute|navigator\.clipboard/);
});

function subagentReference(ref = 'artifact:subagent-result-abc123'): ObjectReference {
  return {
    id: 'obj-subagent-result',
    title: ref,
    kind: 'artifact',
    ref,
    status: 'available',
  };
}
