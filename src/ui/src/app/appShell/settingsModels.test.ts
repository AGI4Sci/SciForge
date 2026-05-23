import assert from 'node:assert/strict';
import test from 'node:test';
import { maskedSecretValue, secretInputPlaceholder, secretPresenceLabel, settingsSaveStateText } from './settingsModels';

test('formats config save state labels', () => {
  assert.equal(settingsSaveStateText({ status: 'idle' }), '修改后点击“保存并生效”，SciForge 会写入 config.local.json。');
  assert.equal(settingsSaveStateText({ status: 'saving' }), '正在保存到 config.local.json...');
  assert.equal(settingsSaveStateText({ status: 'error', message: 'boom' }), 'boom');
  assert.match(settingsSaveStateText({ status: 'saved', savedAt: '2026-05-09T12:34:56.000Z' }), /已保存到 config\.local\.json/);
});

test('formats secret fields as presence-only masked status', () => {
  assert.equal(secretPresenceLabel('sk-test-secret', 'API key'), 'API key: present (masked)');
  assert.equal(secretPresenceLabel('', 'API key'), 'API key: missing');
  assert.equal(secretInputPlaceholder('github_pat_test', 'paste token'), '已配置；输入新值会替换，留空保持 masked secret 不变');
  assert.equal(secretInputPlaceholder('', 'paste token'), 'paste token');
  assert.equal(maskedSecretValue('sk-test-secret'), '********');
  assert.equal(maskedSecretValue(''), '');
});
