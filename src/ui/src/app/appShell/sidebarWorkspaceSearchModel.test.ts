import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSidebarWorkspaceFileMatches,
  resolveSidebarWorkspaceFilePath,
  sidebarWorkspaceSearchShouldDescend,
} from './sidebarWorkspaceSearchModel';
import type { WorkspaceEntry } from '../../api/workspaceClient';

test('workspace search resolves safe file click targets and rejects unsafe relative paths', () => {
  assert.equal(
    resolveSidebarWorkspaceFilePath('/workspace/research', 'docs/report.md'),
    '/workspace/research/docs/report.md',
  );
  assert.equal(resolveSidebarWorkspaceFilePath('/workspace/research', '../config.local.json'), '');
  assert.equal(resolveSidebarWorkspaceFilePath('/workspace/research', 'docs/../config.local.json'), '');
  assert.equal(resolveSidebarWorkspaceFilePath('/workspace/research', '.sciforge/sessions/trace.jsonl'), '');
  assert.equal(resolveSidebarWorkspaceFilePath('/workspace/research', 'logs/stdout.log'), '');
  assert.equal(resolveSidebarWorkspaceFilePath('', 'docs/report.md'), '');
});

test('workspace search caps large result sets and ignores peer workspace or private entries', () => {
  const entries: WorkspaceEntry[] = [
    ...Array.from({ length: 10 }, (_, index) => ({
      kind: 'file' as const,
      name: `report-${index + 1}.md`,
      path: `/workspace/main/docs/report-${index + 1}.md`,
    })),
    { kind: 'file', name: 'report-peer.md', path: '/workspace/peer/docs/report-peer.md' },
    { kind: 'file', name: 'report-secret.md', path: '/workspace/main/.sciforge/report-secret.md' },
    { kind: 'file', name: 'report-raw.log', path: '/workspace/main/logs/report-raw.log' },
    { kind: 'file', name: 'report-outside.md', path: '/workspace/main/../outside/report-outside.md' },
  ];

  const matches = buildSidebarWorkspaceFileMatches('report', entries, '/workspace/main');

  assert.equal(matches.length, 8);
  assert.deepEqual(matches.map((match) => match.workspaceRelativePath), [
    'docs/report-1.md',
    'docs/report-2.md',
    'docs/report-3.md',
    'docs/report-4.md',
    'docs/report-5.md',
    'docs/report-6.md',
    'docs/report-7.md',
    'docs/report-8.md',
  ]);
  assert.doesNotMatch(JSON.stringify(matches), /workspace\/|peer|\.sciforge|logs|outside|raw|secret|\/Applications|\/tmp/i);
});

test('workspace search does not descend into private folders', () => {
  assert.equal(sidebarWorkspaceSearchShouldDescend({ kind: 'folder', name: 'src', path: '/workspace/main/src' }, '/workspace/main'), true);
  assert.equal(sidebarWorkspaceSearchShouldDescend({ kind: 'folder', name: '.sciforge', path: '/workspace/main/.sciforge' }, '/workspace/main'), false);
  assert.equal(sidebarWorkspaceSearchShouldDescend({ kind: 'folder', name: 'logs', path: '/workspace/main/logs' }, '/workspace/main'), false);
});
