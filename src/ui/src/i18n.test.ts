import assert from 'node:assert/strict';
import test from 'node:test';

import { documentLangForLocale, localeText, normalizeLocale } from './i18n';

test('normalizes supported app locales', () => {
  assert.equal(normalizeLocale('en'), 'en-US');
  assert.equal(normalizeLocale('en-US'), 'en-US');
  assert.equal(normalizeLocale('zh'), 'zh-CN');
  assert.equal(normalizeLocale('zh-Hans'), 'zh-CN');
  assert.equal(normalizeLocale('unexpected'), 'en-US');
});

test('selects localized copy with English fallback', () => {
  const copy = { 'zh-CN': '设置', 'en-US': 'Settings' };
  assert.equal(localeText('en-US', copy), 'Settings');
  assert.equal(localeText('zh-CN', copy), '设置');
  assert.equal(localeText(undefined, copy), 'Settings');
});

test('maps app locale to document lang', () => {
  assert.equal(documentLangForLocale('en-US'), 'en');
  assert.equal(documentLangForLocale('zh-CN'), 'zh-CN');
});
