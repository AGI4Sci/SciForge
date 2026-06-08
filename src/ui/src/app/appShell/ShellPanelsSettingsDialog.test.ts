import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const settingsPageSource = readFileSync(new URL('./SettingsPage.tsx', import.meta.url), 'utf8');
const catalogSource = readFileSync(new URL('./settingsModelCatalog.ts', import.meta.url), 'utf8');

test('settings does not expose runtime provider API keys or base URLs in the GUI', () => {
  assert.doesNotMatch(settingsPageSource, /apiKeyVisible/);
  assert.doesNotMatch(settingsPageSource, /Show API key|显示 API key|Hide API key|隐藏 API key/);
  assert.doesNotMatch(settingsPageSource, /maskedSecretValue\(config\.apiKey\)/);
  assert.doesNotMatch(settingsPageSource, /onChange\(\{ apiKey: event\.target\.value \}\)/);
  assert.doesNotMatch(settingsPageSource, /onChange\(\{ modelBaseUrl: event\.target\.value \}\)/);
  assert.doesNotMatch(settingsPageSource, /Provider Base URL/);
  assert.doesNotMatch(settingsPageSource, />API Key</);
});

test('settings copy states main chat and repair use Model Router instead of raw provider config', () => {
  assert.match(settingsPageSource, /call models through a Model Router profile/);
  assert.match(settingsPageSource, /Router member-model config only/);
});

test('settings does not expose provider model catalog refresh as a direct endpoint path', () => {
  assert.doesNotMatch(settingsPageSource, /Provider Models/);
  assert.doesNotMatch(settingsPageSource, /refreshModelCatalog\(config, setModelCatalog/);
  assert.match(catalogSource, /modelCatalogUrl\(config\)/);
  assert.match(catalogSource, /\/api\/sciforge\/provider-models/);
});

test('settings page uses sidebar navigation layout', () => {
  assert.match(settingsPageSource, /settings-page-nav/);
  assert.match(settingsPageSource, /Back to app/);
  assert.match(settingsPageSource, /settingsSectionNavItemsForLocale/);
});

test('settings page exposes app-wide language switching', () => {
  assert.match(settingsPageSource, /应用语言/);
  assert.match(settingsPageSource, /App language/);
  assert.match(settingsPageSource, /SUPPORTED_LOCALES/);
  assert.match(settingsPageSource, /onChange\(\{ locale: normalizeLocale\(event\.target\.value\) \}\)/);
});
