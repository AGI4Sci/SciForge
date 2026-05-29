import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  expandComputerUseChatCurrentRunEvidenceRefs,
  isComputerUseChatWorkspaceLocalRef,
  pathForComputerUseChatWorkspaceRef,
  readComputerUseChatJsonRefs,
  readOptionalComputerUseChatJsonRecord,
} from '../../tools/computer-use-chat-live-evidence-refs.js';

test('Computer Use chat live evidence refs resolve only workspace-local refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-evidence-paths-'));
  try {
    const localRef = '.sciforge/vision-runs/current-run/vision-trace.json';
    assert.equal(pathForComputerUseChatWorkspaceRef(workspace, localRef), resolve(workspace, localRef));
    assert.equal(pathForComputerUseChatWorkspaceRef(workspace, `file:${localRef}`), resolve(workspace, localRef));
    assert.equal(pathForComputerUseChatWorkspaceRef(workspace, '../outside.json'), undefined);
    assert.equal(pathForComputerUseChatWorkspaceRef(workspace, 'artifact:.sciforge/vision-runs/current-run/vision-trace.json'), undefined);
    assert.equal(pathForComputerUseChatWorkspaceRef(workspace, 'https://example.test/vision-trace.json'), undefined);
    assert.equal(isComputerUseChatWorkspaceLocalRef(localRef), true);
    assert.equal(isComputerUseChatWorkspaceLocalRef('/tmp/vision-trace.json'), false);
    assert.equal(isComputerUseChatWorkspaceLocalRef('artifact:vision-trace.json'), false);
    assert.equal(isComputerUseChatWorkspaceLocalRef('.sciforge/../vision-trace.json'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live evidence refs expand run task chain and directory listing manifests', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-evidence-expand-'));
  try {
    const runDirRef = '.sciforge/vision-runs/current-run';
    const runTaskChainRef = `${runDirRef}/tui-host-run-task-chain.json`;
    const directoryListingRef = `${runDirRef}/directory-listing.json`;
    const traceRef = `${runDirRef}/vision-trace.json`;
    const acceptanceManifestRef = `${runDirRef}/cu-user-acceptance-manifest.json`;
    const completionGradeRef = `${runDirRef}/completion-grade-diagnostics.json`;

    await writeJson(join(workspace, runTaskChainRef), {
      schemaVersion: 'sciforge.computer-use.tui-host-run-task-chain.v1',
      refs: {
        traceRef,
        directoryListingRef,
      },
      links: [
        { kind: 'directory-listing', recordRef: directoryListingRef },
      ],
    });
    await writeJson(join(workspace, directoryListingRef), {
      schemaVersion: 'sciforge.computer-use.evidence-directory-listing.v1',
      fileRefs: [
        acceptanceManifestRef,
        completionGradeRef,
      ],
    });
    await writeJson(join(workspace, traceRef), { schemaVersion: 'trace.v1' });
    await writeJson(join(workspace, acceptanceManifestRef), { schemaVersion: 'acceptance.v1' });
    await writeJson(join(workspace, completionGradeRef), { schemaVersion: 'grade.v1' });

    const issues: string[] = [];
    const expanded = await expandComputerUseChatCurrentRunEvidenceRefs([runTaskChainRef], workspace, issues);

    assert.deepEqual(issues, []);
    assert.deepEqual(expanded.sort(), [
      acceptanceManifestRef,
      completionGradeRef,
      directoryListingRef,
      runTaskChainRef,
      traceRef,
    ].sort());
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live evidence refs report unreadable and non-object json issues', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-evidence-read-'));
  try {
    const objectRef = '.sciforge/vision-runs/current-run/object.json';
    const arrayRef = '.sciforge/vision-runs/current-run/array.json';
    const missingRef = '.sciforge/vision-runs/current-run/missing.json';
    await writeJson(join(workspace, objectRef), { ok: true });
    await writeFileWithParents(join(workspace, arrayRef), '[]\n');

    const issues: string[] = [];
    const records = await readComputerUseChatJsonRefs([
      objectRef,
      arrayRef,
      missingRef,
      'artifact:.sciforge/vision-runs/current-run/object.json',
    ], workspace, issues);

    assert.deepEqual(records, [{ ok: true }]);
    assert.deepEqual(issues.sort(), [
      `not-json-object:${arrayRef}`,
      `read-failed:${missingRef}`,
    ].sort());
    assert.deepEqual(await readOptionalComputerUseChatJsonRecord(join(workspace, objectRef)), { ok: true });
    assert.equal(await readOptionalComputerUseChatJsonRecord(join(workspace, missingRef)), undefined);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFileWithParents(path, `${JSON.stringify(payload, null, 2)}\n`);
}

async function writeFileWithParents(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}
