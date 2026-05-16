import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertExplicitArtifactSelectionEvidence,
  explicitArtifactSelectionCaseId,
  latestArtifactRef,
  runExplicitArtifactSelectionCase,
  selectedOldArtifactRef,
  type ExplicitArtifactSelectionResult,
} from './explicit-artifact-selection.js';
import type { JsonValue } from '../types.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-explicit-artifact-selection-test-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-03 preserves the clicked old artifact in explicitRefs and currentTask.explicitRefs', async () => {
  const result = await runExplicitArtifactSelectionCase({
    baseDir,
    outputRoot: join(baseDir, 'evidence'),
    now: '2026-05-16T00:00:00.000Z',
  });

  assert.equal(result.fixture.caseId, explicitArtifactSelectionCaseId);
  assert.equal(result.recordedRunRequest.body.prompt, '基于这个继续');
  assert.deepEqual((result.evidenceBundle.extra?.explicitRefs as string[] | undefined), [selectedOldArtifactRef]);
  assert.deepEqual((result.evidenceBundle.extra?.currentTaskExplicitRefs as string[] | undefined), [selectedOldArtifactRef]);
  assert.equal(result.evidenceBundle.note.status, 'passed');
  assertExplicitArtifactSelectionEvidence(result);
});

test('SA-WEB-03 guard fails if explicitRefs drift to the latest artifact', async () => {
  const result = await runExplicitArtifactSelectionCase({ baseDir });
  const drifted = structuredClone(result) as ExplicitArtifactSelectionResult;

  drifted.requestBody.explicitRefs = [{
    id: 'ref-current-report',
    kind: 'artifact',
    title: 'Current generated report',
    ref: latestArtifactRef,
    source: 'seed-workspace',
  }];

  assert.throws(
    () => assertExplicitArtifactSelectionEvidence(drifted),
    /top-level explicitRefs must point at the clicked old artifact/,
  );
});

test('SA-WEB-03 guard fails if currentTask.explicitRefs drift to the latest artifact', async () => {
  const result = await runExplicitArtifactSelectionCase({ baseDir });
  const drifted = structuredClone(result) as ExplicitArtifactSelectionResult;
  const currentTask = drifted.requestBody.currentTask as Record<string, unknown>;

  currentTask.explicitRefs = [{
    id: 'ref-current-report',
    kind: 'artifact',
    title: 'Current generated report',
    ref: latestArtifactRef,
    source: 'seed-workspace',
  }];

  assert.throws(
    () => assertExplicitArtifactSelectionEvidence(drifted),
    /currentTask\.explicitRefs must point at the clicked old artifact/,
  );
});

test('SA-WEB-03 guard fails if the result payload mixes in the latest artifact', async () => {
  const result = await runExplicitArtifactSelectionCase({ baseDir });
  const drifted = structuredClone(result) as ExplicitArtifactSelectionResult;

  drifted.toolPayload.artifacts = [
    ...((drifted.toolPayload.artifacts as JsonValue[] | undefined) ?? []),
    { id: 'fixture-current-report', ref: latestArtifactRef },
  ];

  assert.throws(
    () => assertExplicitArtifactSelectionEvidence(drifted),
    /AgentServer result payload must not include artifact:fixture-current-report/,
  );
});
