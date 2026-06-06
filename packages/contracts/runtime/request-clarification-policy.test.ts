import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRequestClarificationNeed } from './request-clarification-policy.js';

test('request clarification policy asks for ambiguous platform ranking targets', () => {
  const need = resolveRequestClarificationNeed({
    prompt: '搜索今天 huggingface 上最火的工作',
  });

  assert.equal(need?.reason, 'ambiguous-platform-ranking-target');
  assert.equal(need?.language, 'zh');
  assert.deepEqual(need?.requiredInputs, ['target category', 'ranking surface']);
  assert.match(need?.message ?? '', /Hugging Face/);
  assert.match(need?.message ?? '', /Daily Papers\/papers、models、datasets、Spaces，还是 jobs\/职位/);
});

test('request clarification policy allows concrete platform ranking targets and referenced follow-ups', () => {
  assert.equal(resolveRequestClarificationNeed({
    prompt: '搜索 Hugging Face Daily Papers 今天热门论文',
  }), undefined);
  assert.equal(resolveRequestClarificationNeed({
    prompt: '帮我处理一下这个',
    references: [{ ref: 'artifact:selected-report' }],
  }), undefined);
});
