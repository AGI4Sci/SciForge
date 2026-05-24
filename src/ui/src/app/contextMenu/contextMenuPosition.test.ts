import assert from 'node:assert/strict';
import test from 'node:test';
import { fitContextMenuPosition } from './contextMenuPosition';

test('fitContextMenuPosition flips menus upward near the viewport bottom', () => {
  const viewport = { width: 800, height: 600 };
  const position = fitContextMenuPosition(120, 560, 220, 280, viewport);
  assert.equal(position.y, 280);
  assert.equal(position.x, 120);
});

test('fitContextMenuPosition clamps menus horizontally near the right edge', () => {
  const viewport = { width: 800, height: 600 };
  const position = fitContextMenuPosition(720, 120, 220, 180, viewport);
  assert.equal(position.x, 572);
  assert.equal(position.y, 120);
});
