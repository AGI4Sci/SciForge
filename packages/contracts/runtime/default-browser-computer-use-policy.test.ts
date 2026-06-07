import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateBrowserEvidenceNeed,
  semanticBrowserSearchQueryFromPrompt,
} from './default-browser-computer-use-policy.js';

test('Browser evidence query keeps source-constrained arXiv topic instead of low-information temporal words', () => {
  const prompt = '搜索一下今天 arxiv 上 agentic rl 相关的文章，并用中文总结今天新增的论文标题、作者、链接和一句话结论。';

  assert.equal(semanticBrowserSearchQueryFromPrompt(prompt), 'site:arxiv.org agentic rl');
  const decision = evaluateBrowserEvidenceNeed({ prompt });

  assert.equal(decision.decision, 'search');
  if (decision.decision === 'search') {
    assert.equal(decision.query, 'site:arxiv.org agentic rl');
  }
});

test('Browser evidence query adds site constraint for explicit public domains and drops presentation instructions', () => {
  const prompt = '请搜索 example.com 上 pricing docs，并总结链接和来源';

  assert.equal(semanticBrowserSearchQueryFromPrompt(prompt), 'site:example.com pricing docs');
});

test('Browser evidence query preserves temporal words for ordinary non-source-constrained searches', () => {
  const prompt = '搜索一下今天旧金山天气';

  assert.equal(semanticBrowserSearchQueryFromPrompt(prompt), '今天旧金山天气');
});

test('Browser evidence query does not treat dotted model names as source domains', () => {
  const prompt = '搜索 GPT-4.1 pricing';

  assert.equal(semanticBrowserSearchQueryFromPrompt(prompt), 'GPT-4.1 pricing');
});

test('Browser evidence query does not force source aliases without source context', () => {
  const prompt = '搜索 Reddit 对 huggingface 的评价';

  assert.equal(semanticBrowserSearchQueryFromPrompt(prompt), 'Reddit 对 huggingface 的评价');
});
