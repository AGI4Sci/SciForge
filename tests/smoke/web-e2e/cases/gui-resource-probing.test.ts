import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  GUI_RESOURCE_PROBING_CASE_ID,
  assertGuiResourceProbingCase,
  runGuiResourceProbingCase,
  type GuiResourceProbingCaseResult,
} from './gui-resource-probing.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-sa-web-23-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-23 probes shell and hot-region first, then reads region-detail only for a narrow commandText question', async () => {
  const result = await runGuiResourceProbingCase({ baseDir });

  assert.equal(result.fixture.caseId, GUI_RESOURCE_PROBING_CASE_ID);
  assertGuiResourceProbingCase(result);
  assert.deepEqual(
    result.operations.filter((operation) => operation.tool === 'gui.read').map((operation) => operation.path),
    ['/gui/shell.json', '/gui/hot-region.json', '/gui/regions/chat-composer.detail.json'],
  );
});

test('SA-WEB-23 fails focused verification if region-detail is read before hot-region', async () => {
  const result = await runGuiResourceProbingCase({ baseDir });
  const polluted: GuiResourceProbingCaseResult = {
    ...result,
    operations: result.operations.map((operation) => ({ ...operation })),
  };
  const shellRead = polluted.operations.find((operation) => operation.path === '/gui/shell.json');
  const detailRead = polluted.operations.find((operation) => operation.tool === 'gui.read' && operation.path === '/gui/regions/chat-composer.detail.json');
  const hotRegionRead = polluted.operations.find((operation) => operation.path === '/gui/hot-region.json');
  assert.ok(shellRead);
  assert.ok(detailRead);
  assert.ok(hotRegionRead);
  polluted.operations = [
    { ...shellRead, step: 1 },
    { ...detailRead, step: 2 },
    { ...hotRegionRead, step: 3 },
  ];

  assert.throws(
    () => assertGuiResourceProbingCase(polluted),
    /progressive probing must begin with shell and hot-region resources/,
  );
});

test('SA-WEB-23 fails focused verification if a full DOM or debug snapshot is requested', async () => {
  const result = await runGuiResourceProbingCase({ baseDir });
  const polluted: GuiResourceProbingCaseResult = {
    ...result,
    operations: [
      ...result.operations.map((operation) => ({ ...operation })),
      {
        step: 99,
        tool: 'gui.read',
        phase: 'narrow-question',
        path: '/gui/dom-snapshot.full.json',
        reason: 'debug fallback',
        resultRef: 'gui-resource://gui/dom-snapshot.full.json@17',
      },
    ],
  };

  assert.throws(
    () => assertGuiResourceProbingCase(polluted),
    /full DOM\/debug snapshot must not be requested/,
  );
});
