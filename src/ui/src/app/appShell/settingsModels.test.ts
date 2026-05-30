import assert from 'node:assert/strict';
import test from 'node:test';
import { maskedSecretValue, secretInputPlaceholder, secretPresenceLabel, settingsSaveStateText } from './settingsModels';

test('formats config save state labels', () => {
  assert.equal(settingsSaveStateText({ status: 'idle' }, 'en-US'), 'After changes, click Save to write config.local.json.');
  assert.equal(settingsSaveStateText({ status: 'saving' }, 'en-US'), 'Saving to config.local.json...');
  assert.equal(settingsSaveStateText({ status: 'error', message: 'boom' }, 'en-US'), 'boom');
  assert.match(settingsSaveStateText({ status: 'saved', savedAt: '2026-05-09T12:34:56.000Z' }, 'en-US'), /Saved to config\.local\.json/);
  assert.equal(settingsSaveStateText({ status: 'idle' }, 'zh-CN'), '修改后点击保存，写入 config.local.json。');
});

test('formats secret fields as presence-only masked status', () => {
  assert.equal(secretPresenceLabel('sk-test-secret', 'API key', 'en-US'), 'API key: present (masked)');
  assert.equal(secretPresenceLabel('', 'API key', 'en-US'), 'API key: missing');
  assert.equal(secretPresenceLabel('sk-test-secret', 'API key', 'zh-CN'), 'API key: 已配置（已隐藏）');
  assert.equal(secretInputPlaceholder('github_pat_test', 'paste token', 'en-US'), 'Configured. Enter a new value to replace it, or leave blank to keep the masked secret.');
  assert.equal(secretInputPlaceholder('', 'paste token', 'en-US'), 'paste token');
  assert.equal(maskedSecretValue('sk-test-secret'), '********');
  assert.equal(maskedSecretValue(''), '');
});
