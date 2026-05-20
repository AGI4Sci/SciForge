import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertNativeSessionArtifactFollowupContract,
  assertNoGuiReplayOrArtifactBody,
  assertUnsupportedNativeSessionResume,
  buildNativeSessionArtifactFollowupCommand,
  nativeCodexSessionId,
  nativeSessionArtifactFollowupCaseId,
  nativeSessionDerivedArtifactRef,
  nativeSessionFollowupRequest,
  nativeSessionInitialArtifactRef,
  nativeSessionSourceArtifactBody,
  runNativeSessionArtifactFollowupCase,
  unsupportedNativeSessionResumeMetadata,
  type NativeSessionArtifactFollowupResult,
} from './native-session-artifact-followup.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-r-resume-01-native-session-artifact-followup-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('R-RESUME-01 resumes native Runtime Codex session using only new commandText plus selected refs', async () => {
  const result = await runNativeSessionArtifactFollowupCase({
    baseDir,
    now: '2026-05-20T00:00:00.000Z',
  });

  assert.equal(result.fixture.caseId, nativeSessionArtifactFollowupCaseId);
  assert.equal(result.initialRuntimeTask.codexSessionId, nativeCodexSessionId);
  assert.equal(result.followupCommand.commandText, [
    nativeSessionFollowupRequest,
    '',
    'Selected refs:',
    `- ${nativeSessionInitialArtifactRef}`,
  ].join('\n'));
  assert.deepEqual([...result.followupCommand.selectedRefs], [nativeSessionInitialArtifactRef]);
  assert.equal(result.resumeMetadata.status, 'resumed');
  assert.equal(result.resumeMetadata.derivedArtifactRef, nativeSessionDerivedArtifactRef);
  assert.deepEqual(result.contractInput.expected, result.fixture.expectedProjection);
  assertNativeSessionArtifactFollowupContract(result);
});

test('R-RESUME-01 guard fails when commandText replays GUI transcript or full artifact body', () => {
  const clean = buildNativeSessionArtifactFollowupCommand({
    codexSessionId: nativeCodexSessionId,
    selectedRefs: [nativeSessionInitialArtifactRef],
    userRequest: nativeSessionFollowupRequest,
  });
  assertNoGuiReplayOrArtifactBody(clean);

  assert.throws(
    () => assertNoGuiReplayOrArtifactBody({
      ...clean,
      commandText: `${clean.commandText}\n\nGUI transcript:\nAssistant: ${nativeSessionSourceArtifactBody}`,
    }),
    /must not replay GUI transcript/,
  );
  assert.throws(
    () => assertNoGuiReplayOrArtifactBody({
      ...clean,
      fullArtifactBody: nativeSessionSourceArtifactBody,
    }),
    /must not attach the full artifact body/,
  );
});

test('R-RESUME-01 guard fails if selected-artifact follow-up is detached from native resume metadata', async () => {
  const result = await runNativeSessionArtifactFollowupCase({ baseDir });
  const drifted = structuredClone(result) as NativeSessionArtifactFollowupResult;

  if (drifted.resumeMetadata.status !== 'resumed') {
    throw new Error('expected resumed metadata in the positive fixture');
  }
  drifted.resumeMetadata = {
    ...drifted.resumeMetadata,
    codexSessionId: 'codex-session-other',
  };

  assert.throws(
    () => assertNativeSessionArtifactFollowupContract(drifted),
    /codexSessionId/,
  );
});

test('R-RESUME-01 exposes blocked unsupported resume path when native resume is unavailable', () => {
  const metadata = unsupportedNativeSessionResumeMetadata({
    emittedAt: '2026-05-20T00:00:00.000Z',
  });

  assertUnsupportedNativeSessionResume(metadata);
  assert.equal(metadata.status, 'blocked');
  assert.equal(metadata.blockedReason, 'unsupported resume');
  assert.deepEqual([...metadata.selectedRefs], [nativeSessionInitialArtifactRef]);
});
