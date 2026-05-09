import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeAgentResponse } from './responseNormalization';

test('normalizes verification metadata without leaking Verification footer into chat text', () => {
  const response = normalizeAgentResponse('literature-evidence-review', '继续上一轮', {
    ok: true,
    data: {
      run: { id: 'run-verification-footer', status: 'completed' },
      output: {
        message: JSON.stringify({
          message: '这是给用户的实际回答。\n\nVerification: unverified. 默认使用轻量验证。',
          confidence: 0.72,
          claimType: 'fact',
          evidenceLevel: 'prediction',
          verificationResults: [{
            verdict: 'unverified',
            confidence: 0,
            critique: '默认使用轻量验证。',
            evidenceRefs: ['execution-unit:EU-1'],
            repairHints: [],
          }],
          displayIntent: {
            verification: { verdict: 'unverified', visible: true },
          },
          claims: [],
          uiManifest: [],
          executionUnits: [{ id: 'EU-1', tool: 'analysis.task', status: 'done', params: '{}' }],
          artifacts: [],
        }),
      },
    },
  });

  assert.equal(response.message.content, '这是给用户的实际回答。');
  assert.doesNotMatch(response.run.response, /Verification:/);
  const raw = response.run.raw as Record<string, unknown>;
  assert.equal((raw.verificationResults as Array<Record<string, unknown>>)[0]?.verdict, 'unverified');
});
