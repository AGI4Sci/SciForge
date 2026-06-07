import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composerComputerUseCommandRequiresExactTerminalText,
  composerPromptIsComputerUseSlashCommand,
  composerPromptMentionsRelativeModality,
} from './ui-composer-intent-policy.js';

test('composer intent policy identifies debug computer-use slash commands', () => {
  assert.equal(composerPromptIsComputerUseSlashCommand('/computer-use approve ref'), true);
  assert.equal(composerPromptIsComputerUseSlashCommand('/computer use repair'), true);
  assert.equal(composerPromptIsComputerUseSlashCommand('click the visible button'), false);
});

test('composer intent policy scopes exact terminal text computer-use commands', () => {
  assert.equal(composerComputerUseCommandRequiresExactTerminalText('/computer-use permission-recheck'), true);
  assert.equal(composerComputerUseCommandRequiresExactTerminalText('/computer-use approve approval-ref'), false);
});

test('composer intent policy detects relative modality references', () => {
  assert.equal(composerPromptMentionsRelativeModality('summarize the screenshot above'), true);
  assert.equal(composerPromptMentionsRelativeModality('分析上面的图片'), true);
  assert.equal(composerPromptMentionsRelativeModality('请读取这张酒店凭证，回答主要字段'), true);
  assert.equal(composerPromptMentionsRelativeModality('summarize the current plan'), false);
});
