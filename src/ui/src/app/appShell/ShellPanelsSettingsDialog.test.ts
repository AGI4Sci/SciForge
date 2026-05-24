import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const settingsPageSource = readFileSync(new URL('./SettingsPage.tsx', import.meta.url), 'utf8');
const catalogSource = readFileSync(new URL('./settingsModelCatalog.ts', import.meta.url), 'utf8');

test('settings API key defaults to masked stars and can be revealed explicitly', () => {
  assert.match(settingsPageSource, /maskedSecretValue\(config\.apiKey\)/);
  assert.match(settingsPageSource, /const \[apiKeyVisible, setApiKeyVisible\] = useState\(false\)/);
  assert.match(settingsPageSource, /type=\{apiKeyVisible \? 'text' : 'password'\}/);
  assert.match(settingsPageSource, /readOnly=\{apiKeyConfigured && !apiKeyVisible\}/);
  assert.match(settingsPageSource, /aria-label=\{apiKeyVisible \? '隐藏 API key' : '查看 API key'\}/);
});

test('settings copy states main chat and repair share the same LLM provider config', () => {
  assert.match(settingsPageSource, /Main chat Runtime Codex and repair Codex CLI share this provider, model, upstream Chat Completions URL, Runtime Profile, and API key/);
  assert.match(settingsPageSource, /local Responses proxy is internal compatibility plumbing/);
});

test('settings exposes provider model catalog refresh and selection', () => {
  assert.match(settingsPageSource, /Provider Models/);
  assert.match(settingsPageSource, /refreshModelCatalog\(config, setModelCatalog/);
  assert.match(catalogSource, /modelCatalogUrl\(config\)/);
  assert.match(settingsPageSource, /onChange\(\{ modelName: event\.target\.value \}\)/);
  assert.match(catalogSource, /\/api\/sciforge\/provider-models/);
});

test('settings page uses sidebar navigation layout', () => {
  assert.match(settingsPageSource, /settings-page-nav/);
  assert.match(settingsPageSource, /返回应用/);
  assert.match(settingsPageSource, /settingsSectionNavItems/);
});
