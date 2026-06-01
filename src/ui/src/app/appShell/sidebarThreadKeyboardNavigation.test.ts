import assert from 'node:assert/strict';
import test from 'node:test';
import { sidebarThreadKeyboardTargetIndex } from './sidebarThreadKeyboardNavigation';

test('sidebar thread keyboard navigation moves through visible rows', () => {
  assert.equal(sidebarThreadKeyboardTargetIndex({ key: 'ArrowDown', currentIndex: 0, total: 4 }), 1);
  assert.equal(sidebarThreadKeyboardTargetIndex({ key: 'ArrowDown', currentIndex: 3, total: 4 }), 3);
  assert.equal(sidebarThreadKeyboardTargetIndex({ key: 'ArrowUp', currentIndex: 2, total: 4 }), 1);
  assert.equal(sidebarThreadKeyboardTargetIndex({ key: 'ArrowUp', currentIndex: 0, total: 4 }), 0);
  assert.equal(sidebarThreadKeyboardTargetIndex({ key: 'Home', currentIndex: 2, total: 4 }), 0);
  assert.equal(sidebarThreadKeyboardTargetIndex({ key: 'End', currentIndex: 2, total: 4 }), 3);
});

test('sidebar thread keyboard navigation ignores unrelated keys and invalid focus state', () => {
  assert.equal(sidebarThreadKeyboardTargetIndex({ key: 'Enter', currentIndex: 1, total: 3 }), undefined);
  assert.equal(sidebarThreadKeyboardTargetIndex({ key: 'ArrowDown', currentIndex: -1, total: 3 }), undefined);
  assert.equal(sidebarThreadKeyboardTargetIndex({ key: 'ArrowDown', currentIndex: 3, total: 3 }), undefined);
  assert.equal(sidebarThreadKeyboardTargetIndex({ key: 'ArrowDown', currentIndex: 0, total: 0 }), undefined);
});
