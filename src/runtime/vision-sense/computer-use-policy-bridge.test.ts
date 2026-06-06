import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  actionLedgerCompletionPolicy,
  shouldCompleteFromFileRefsOnlyPolicy,
} from './computer-use-policy-bridge.js';
import type { LoopStep } from '../computer-use/types.js';

test('computer-use policy bridge evaluates planner-only evidence tasks without Python', async () => {
  const previous = process.env.SCIFORGE_VISION_SENSE_PYTHON;
  process.env.SCIFORGE_VISION_SENSE_PYTHON = '/definitely/missing/python';
  try {
    assert.equal(await shouldCompleteFromFileRefsOnlyPolicy('Summarize the trace refs and action ledger report.'), true);
    assert.equal(await shouldCompleteFromFileRefsOnlyPolicy('Click the visible search field.'), false);
  } finally {
    if (previous === undefined) delete process.env.SCIFORGE_VISION_SENSE_PYTHON;
    else process.env.SCIFORGE_VISION_SENSE_PYTHON = previous;
  }
});

test('computer-use policy bridge evaluates action-ledger completion without Python', async () => {
  const previous = process.env.SCIFORGE_VISION_SENSE_PYTHON;
  process.env.SCIFORGE_VISION_SENSE_PYTHON = '/definitely/missing/python';
  try {
    const steps = [0, 1, 2].map((index): LoopStep => ({
      id: `step-${index}`,
      kind: 'gui-execution',
      status: 'done',
      plannedAction: {
        type: 'click',
        targetDescription: `candidate evidence result link ${index + 1}`,
      },
      verifier: {
        status: 'checked',
        pixelDiff: { possiblyNoEffect: false },
      },
    }));

    const result = await actionLedgerCompletionPolicy('screening candidate evidence links', steps);

    assert.equal(result?.complete, true);
    assert.equal(result?.kind, 'candidate-evidence-screening');
  } finally {
    if (previous === undefined) delete process.env.SCIFORGE_VISION_SENSE_PYTHON;
    else process.env.SCIFORGE_VISION_SENSE_PYTHON = previous;
  }
});
