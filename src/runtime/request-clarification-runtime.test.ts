import assert from 'node:assert/strict';
import test from 'node:test';

import { tryRunRequestClarificationRuntime } from './request-clarification-runtime.js';
import type { GatewayRequest } from './runtime-types.js';

test('request clarification runtime asks before ambiguous platform trending work requests', () => {
  const payload = tryRunRequestClarificationRuntime(request('搜索今天huggingface上最火的工作'));

  assert.ok(payload);
  assert.equal(payload.displayIntent?.status, 'needs-human');
  assert.equal(payload.displayIntent?.taskOutcome, 'needs-human');
  assert.equal(payload.executionUnits[0]?.status, 'needs-human');
  assert.match(payload.message, /Hugging Face/i);
  assert.match(payload.message, /工作/);
  assert.match(payload.message, /papers|models|datasets|Spaces|jobs/i);
});

test('request clarification runtime asks for missing referent outside search routes', () => {
  const payload = tryRunRequestClarificationRuntime(request('帮我处理一下这个'));

  assert.ok(payload);
  assert.equal(payload.displayIntent?.status, 'needs-human');
  assert.match(payload.message, /这个|具体对象|文件|页面/);
});

test('request clarification runtime allows clear search and referenced follow-up requests', () => {
  assert.equal(tryRunRequestClarificationRuntime(request('通过内置浏览器搜索伊朗局势')), undefined);
  assert.equal(tryRunRequestClarificationRuntime({
    ...request('帮我处理一下这个'),
    references: [{ ref: 'artifact:selected-report' }],
  }), undefined);
});

function request(prompt: string): GatewayRequest {
  return {
    skillDomain: 'knowledge',
    prompt,
    workspacePath: '/tmp/sciforge-work',
    selectedToolIds: [],
    artifacts: [],
  };
}
