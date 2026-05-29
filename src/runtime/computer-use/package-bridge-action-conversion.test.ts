import assert from 'node:assert/strict';
import { test } from 'node:test';

import { packagePlanToGenericAction } from './package-bridge-action-conversion.js';
import type { GenericVisionAction } from './types.js';

test('packagePlanToGenericAction maps package click target and grounding metadata', () => {
  const action = packagePlanToGenericAction(
    {
      kind: 'click',
      target: { description: 'Save button', region_description: 'toolbar' },
      riskLevel: 'medium',
      requiresConfirmation: true,
      confirmationText: 'Click Save',
    },
    undefined,
    { metadata: { executorX: 42, executorY: 24 } },
  );

  assert.deepEqual(action, {
    type: 'click',
    x: 42,
    y: 24,
    targetDescription: 'Save button',
    targetRegionDescription: 'toolbar',
    riskLevel: 'medium',
    requiresConfirmation: true,
    confirmationText: 'Click Save',
  });
});

test('packagePlanToGenericAction preserves active action fallbacks for hotkeys and drag targets', () => {
  const hotkeyActive: GenericVisionAction = {
    type: 'hotkey',
    keys: ['Meta', 'S'],
    targetDescription: 'editor',
    riskLevel: 'low',
  };
  assert.deepEqual(packagePlanToGenericAction({ kind: 'hotkey' }, hotkeyActive), {
    ...hotkeyActive,
    targetRegionDescription: undefined,
    requiresConfirmation: false,
    confirmationText: undefined,
  });

  const dragActive: GenericVisionAction = {
    type: 'drag',
    fromX: 1,
    fromY: 2,
    toX: 3,
    toY: 4,
    fromTargetDescription: 'source row',
    toTargetDescription: 'target row',
    riskLevel: 'low',
  };
  assert.deepEqual(
    packagePlanToGenericAction({ kind: 'drag' }, dragActive, {
      metadata: { executorFromX: 10, executorFromY: 20, executorToX: 30, executorToY: 40 },
    }),
    {
      type: 'drag',
      fromX: 10,
      fromY: 20,
      toX: 30,
      toY: 40,
      fromTargetDescription: 'source row',
      toTargetDescription: 'target row',
      riskLevel: 'low',
      requiresConfirmation: false,
      confirmationText: undefined,
      targetDescription: undefined,
      targetRegionDescription: undefined,
    },
  );
});
