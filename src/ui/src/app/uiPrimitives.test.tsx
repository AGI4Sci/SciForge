import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverActionLabel } from './uiPrimitives';

test('recover action labels keep component selection actions package-authored', () => {
  assert.equal(recoverActionLabel('run-current-scenario'), '运行当前场景');
  assert.equal(recoverActionLabel('import-package:omics-suite'), '导入 omics-suite package');
  assert.equal(recoverActionLabel('fallback-component:record-table'), 'fallback-component:record-table');
});
