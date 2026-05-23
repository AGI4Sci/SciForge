import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./ShellPanelsSettingsDialog.tsx', import.meta.url), 'utf8');

test('settings API key defaults to masked stars and can be revealed explicitly', () => {
  assert.match(source, /maskedSecretValue\(config\.apiKey\)/);
  assert.match(source, /const \[apiKeyVisible, setApiKeyVisible\] = useState\(false\)/);
  assert.match(source, /type=\{apiKeyVisible \? 'text' : 'password'\}/);
  assert.match(source, /readOnly=\{apiKeyConfigured && !apiKeyVisible\}/);
  assert.match(source, /aria-label=\{apiKeyVisible \? '隐藏 API key' : '查看 API key'\}/);
});

test('settings copy states main chat and repair share the same LLM provider config', () => {
  assert.match(source, /Main chat Runtime Codex and repair Codex CLI share this provider, model, upstream Chat Completions URL, Runtime Profile, and API key/);
  assert.match(source, /local Responses proxy is internal compatibility plumbing/);
});
