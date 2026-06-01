import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ObjectReference, SciForgeConfig, SciForgeSession } from '../../domain';
import {
  focusedWorkspaceFileConfigForState,
  focusedWorkspaceFilePathForReference,
  shouldHydrateFocusedWorkspaceFile,
} from './filesPaneFocusHydration';
import type { WorkspaceFileEditorState } from './filesPaneModel';

test('focused file hydration helper owns ResultsRenderer file-ref side effect extraction', () => {
  const helperSource = readFileSync(new URL('./filesPaneFocusHydration.ts', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../ResultsRenderer.tsx', import.meta.url), 'utf8');

  assert.match(helperSource, /export function useFocusedWorkspaceFileHydration/);
  assert.match(helperSource, /readFocusedWorkspaceFile/);
  assert.match(helperSource, /pathForObjectReference/);
  assert.match(rendererSource, /from '.\/results\/filesPaneFocusHydration'/);
  assert.doesNotMatch(rendererSource, /readFocusedWorkspaceFile/);
  assert.doesNotMatch(rendererSource, /canHydrateWorkspaceObjectPath/);
  assert.doesNotMatch(rendererSource, /pathForObjectReference/);
  assert.doesNotMatch(rendererSource, /workspaceFileViewerDraftForFile/);
});

test('focused file hydration resolves only safe file object paths', () => {
  const session = sessionFixture();
  const fileRef: ObjectReference = {
    id: 'file-ref',
    kind: 'file',
    title: 'app.ts',
    ref: 'file:src/app.ts',
  };

  assert.equal(focusedWorkspaceFilePathForReference(fileRef, session), 'src/app.ts');
  assert.equal(focusedWorkspaceFilePathForReference({ ...fileRef, kind: 'url', ref: 'https://example.org' }, session), '');
  assert.equal(focusedWorkspaceFilePathForReference({ ...fileRef, ref: 'file:../secret.txt' }, session), '');
});

test('focused file hydration config follows matching editor workspace root without leaking stale roots', () => {
  const config = { workspacePath: '/workspace/current' } as SciForgeConfig;
  const matchingEditor = editorFixture('/workspace/repo', 'focus:file-a');
  const staleEditor = editorFixture('/workspace/stale', 'focus:other');

  assert.equal(focusedWorkspaceFileConfigForState({
    config,
    activeFilesWorkspaceFileEditor: null,
    workspaceFileEditor: matchingEditor,
    focusedWorkspaceFileRequestKey: 'focus:file-a',
    focusedWorkspaceRoot: '/workspace/current',
  }).workspacePath, '/workspace/repo');

  assert.equal(focusedWorkspaceFileConfigForState({
    config,
    activeFilesWorkspaceFileEditor: null,
    workspaceFileEditor: staleEditor,
    focusedWorkspaceFileRequestKey: 'focus:file-a',
    focusedWorkspaceRoot: '/workspace/current',
  }).workspacePath, '/workspace/current');

  assert.equal(focusedWorkspaceFileConfigForState({
    config,
    activeFilesWorkspaceFileEditor: editorFixture('/workspace/files-tab', 'focus:file-b'),
    workspaceFileEditor: matchingEditor,
    focusedWorkspaceFileRequestKey: 'focus:file-a',
    focusedWorkspaceRoot: '/workspace/current',
  }).workspacePath, '/workspace/files-tab');
});

test('focused file hydration skips execution focus and already hydrated editors', () => {
  const config = { workspacePath: '/workspace/current' } as SciForgeConfig;
  const currentEditor = editorFixture('/workspace/current', 'focus:file-a');

  assert.equal(shouldHydrateFocusedWorkspaceFile({
    executionFocus: true,
    focusedWorkspaceFilePath: 'src/app.ts',
    currentEditor: null,
    focusedWorkspaceFileRequestKey: 'focus:file-a',
    workspaceFileConfig: config,
  }), false);
  assert.equal(shouldHydrateFocusedWorkspaceFile({
    executionFocus: false,
    focusedWorkspaceFilePath: '',
    currentEditor: null,
    focusedWorkspaceFileRequestKey: 'focus:file-a',
    workspaceFileConfig: config,
  }), false);
  assert.equal(shouldHydrateFocusedWorkspaceFile({
    executionFocus: false,
    focusedWorkspaceFilePath: 'src/app.ts',
    currentEditor,
    focusedWorkspaceFileRequestKey: 'focus:file-a',
    workspaceFileConfig: config,
  }), false);
  assert.equal(shouldHydrateFocusedWorkspaceFile({
    executionFocus: false,
    focusedWorkspaceFilePath: 'src/app.ts',
    currentEditor: { ...currentEditor, focusRequestKey: 'focus:other' },
    focusedWorkspaceFileRequestKey: 'focus:file-a',
    workspaceFileConfig: config,
  }), false);
  assert.equal(shouldHydrateFocusedWorkspaceFile({
    executionFocus: false,
    focusedWorkspaceFilePath: 'src/other.ts',
    currentEditor,
    focusedWorkspaceFileRequestKey: 'focus:file-other',
    workspaceFileConfig: config,
  }), true);
});

function sessionFixture(): SciForgeSession {
  return {
    id: 'session-file-hydration',
    title: 'Files hydration',
    scenarioId: 'demo',
    messages: [],
    runs: [],
  } as unknown as SciForgeSession;
}

function editorFixture(workspacePath: string, focusRequestKey: string): WorkspaceFileEditorState {
  return {
    workspacePath,
    focusRequestKey,
    file: {
      path: `${workspacePath}/src/app.ts`,
      name: 'app.ts',
      content: 'export const ok = true;\n',
      size: 24,
      encoding: 'utf8',
      language: 'typescript',
      mimeType: 'text/typescript',
    },
    draft: 'export const ok = true;\n',
    editMode: false,
  };
}
