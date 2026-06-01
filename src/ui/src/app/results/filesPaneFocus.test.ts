import assert from 'node:assert/strict';
import test from 'node:test';
import type { ObjectReference, SciForgeConfig, SciForgeInstanceManifest, SciForgeRun, SciForgeSession } from '../../domain';
import {
  focusedWorkspaceRootForReference,
  readFocusedWorkspaceFile,
  repoRootWorkspaceFallback,
  workspaceRootFromRunRaw,
  workspaceRootFromStreamProcess,
  workspaceRootForRun,
} from './filesPaneFocus';
import type { WorkspaceFilesModuleTraceStep } from './filesPaneModulePort';

const baseConfig = {
  workspacePath: '/workspace/active',
  workspaceWriterBaseUrl: 'http://workspace-writer.local',
} as SciForgeConfig;

function run(overrides: Partial<SciForgeRun>): SciForgeRun {
  return {
    id: 'run-1',
    status: 'completed',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as SciForgeRun;
}

function session(runs: SciForgeRun[]): SciForgeSession {
  return {
    id: 'session-1',
    title: 'Session',
    scenarioId: 'demo',
    messages: [],
    runs,
  } as unknown as SciForgeSession;
}

function manifest(root: string): SciForgeInstanceManifest {
  return {
    schemaVersion: 1,
    instance: { id: 'test-instance', name: 'Test instance' },
    workspacePath: '/workspace/active',
    repo: { detected: true, root },
    capabilities: [],
  };
}

test('files pane focus reads workspace roots from raw and stream run metadata', () => {
  const rawRun = run({ raw: { runtimeMetadata: { workspacePath: '/workspace/raw' } } });
  const streamRun = run({
    id: 'run-2',
    raw: {
      streamProcess: {
        events: [
          { native: { workspace_path: '/workspace/stream' } },
        ],
      },
    },
  });

  assert.equal(workspaceRootFromRunRaw(rawRun), '/workspace/raw');
  assert.equal(workspaceRootFromStreamProcess(streamRun), '/workspace/stream');
  assert.equal(workspaceRootForRun(session([rawRun, streamRun]), 'run-2'), '/workspace/stream');
});

test('files pane focus only uses cursor-agent file provenance to override workspace root', () => {
  const rootSession = session([run({ raw: { runtimeMetadata: { workspace: '/workspace/from-run' } } })]);
  const reference: ObjectReference = {
    id: 'file-1',
    kind: 'file',
    title: 'app.ts',
    ref: 'file:src/app.ts',
    runId: 'run-1',
    provenance: { producer: 'cursor-agent-process' },
  };

  assert.equal(focusedWorkspaceRootForReference(reference, rootSession, '/workspace/fallback'), '/workspace/from-run');
  assert.equal(
    focusedWorkspaceRootForReference({ ...reference, provenance: { producer: 'other' } }, rootSession, '/workspace/fallback'),
    '/workspace/fallback',
  );
  assert.equal(focusedWorkspaceRootForReference(undefined, rootSession, '/workspace/fallback'), '/workspace/fallback');
});

test('files pane focus falls back to repo root only for safe relative cursor-agent file refs', async () => {
  const calls: Array<{ path: string; workspacePath: string }> = [];
  const reference: ObjectReference = {
    id: 'file-1',
    kind: 'file',
    title: 'app.ts',
    ref: 'file:src/app.ts',
    runId: 'run-1',
    provenance: { producer: 'cursor-agent-process' },
  };
  const result = await readFocusedWorkspaceFile({
    path: 'src/app.ts',
    config: baseConfig,
    reference,
    ports: {
      readWorkspaceFile: async (path, config) => {
        calls.push({ path, workspacePath: config.workspacePath });
        if (config.workspacePath === '/workspace/active') throw new Error('primary missing');
        return {
          path: `${config.workspacePath}/${path}`,
          name: 'app.ts',
          content: 'export const ok = true;\n',
          size: 24,
          encoding: 'utf8',
          language: 'typescript',
          mimeType: 'text/typescript',
        };
      },
      loadSciForgeInstanceManifest: async () => manifest('/workspace/repo'),
    },
  });

  assert.deepEqual(calls, [
    { path: 'src/app.ts', workspacePath: '/workspace/active' },
    { path: 'src/app.ts', workspacePath: '/workspace/repo' },
  ]);
  assert.equal(result.workspacePath, '/workspace/repo');
  assert.equal(result.file.content, 'export const ok = true;\n');
});

test('files pane focus reads through Files module port including repo-root fallback', async () => {
  const calls: Array<{ path: string; workspacePath: string }> = [];
  const reference: ObjectReference = {
    id: 'file-1',
    kind: 'file',
    title: 'app.ts',
    ref: 'file:src/app.ts',
    runId: 'run-1',
    provenance: { producer: 'cursor-agent-process' },
  };
  const result = await readFocusedWorkspaceFile({
    path: 'src/app.ts',
    config: baseConfig,
    reference,
    ports: {
      filesPort: {
        async readFile(path, config) {
          calls.push({ path, workspacePath: config.workspacePath });
          if (config.workspacePath === '/workspace/active') {
            return { ok: false, error: 'primary missing', trace: moduleTrace('failed') };
          }
          return {
            ok: true,
            value: {
              path: `${config.workspacePath}/${path}`,
              name: 'app.ts',
              content: 'export const ok = true;\n',
              size: 24,
              encoding: 'utf8',
              language: 'typescript',
              mimeType: 'text/typescript',
            },
            trace: moduleTrace('completed'),
          };
        },
      },
      loadSciForgeInstanceManifest: async () => manifest('/workspace/repo'),
    },
  });

  assert.deepEqual(calls, [
    { path: 'src/app.ts', workspacePath: '/workspace/active' },
    { path: 'src/app.ts', workspacePath: '/workspace/repo' },
  ]);
  assert.equal(result.workspacePath, '/workspace/repo');
  assert.equal(result.file.content, 'export const ok = true;\n');
});

test('files pane focus rejects unsafe fallback paths after primary read failure', async () => {
  const reference: ObjectReference = {
    id: 'file-1',
    kind: 'file',
    title: '.env',
    ref: 'file:.env',
    runId: 'run-1',
    provenance: { producer: 'cursor-agent-process' },
  };
  let manifestCalls = 0;
  await assert.rejects(
    readFocusedWorkspaceFile({
      path: '.env',
      config: baseConfig,
      reference,
      ports: {
        readWorkspaceFile: async () => {
          throw new Error('primary missing');
        },
        loadSciForgeInstanceManifest: async () => {
          manifestCalls += 1;
          return manifest('/workspace/repo');
        },
      },
    }),
    /primary missing/,
  );
  assert.equal(manifestCalls, 0);
});

test('files pane focus normalizes detected repo root fallback', async () => {
  const root = await repoRootWorkspaceFallback(baseConfig, {
    loadSciForgeInstanceManifest: async () => manifest('/workspace/repo/'),
  });
  assert.equal(root, '/workspace/repo');
});

function moduleTrace(status: 'completed' | 'failed'): WorkspaceFilesModuleTraceStep {
  return {
    moduleId: 'files',
    functionName: 'read',
    status,
    inputSummary: 'read file:src/app.ts',
    resultSummary: status,
    refs: ['file:src/app.ts'],
  };
}
