import assert from 'node:assert/strict';
import test from 'node:test';
import { settingsSaveStateText } from './settingsModels';

test('formats config save state labels', () => {
  assert.equal(settingsSaveStateText({ status: 'idle' }), '修改后点击“保存并生效”，SciForge 会写入 config.local.json。');
  assert.equal(settingsSaveStateText({ status: 'saving' }), '正在保存到 config.local.json...');
  assert.equal(settingsSaveStateText({ status: 'error', message: 'boom' }), 'boom');
  assert.match(settingsSaveStateText({ status: 'saved', savedAt: '2026-05-09T12:34:56.000Z' }), /已保存到 config\.local\.json/);
});
