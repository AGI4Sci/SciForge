import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { evaluateGeneratedTaskGuardFinding } from './generated-task-validation-guard.js';
import { evaluateResultMetricConsistency } from './result-metric-consistency-guard.js';

const request = {
  skillDomain: 'knowledge',
  prompt: 'Run a paper reproduction and report whether it succeeded.',
  artifacts: [],
} as GatewayRequest;

function payload(overrides: Partial<ToolPayload> = {}): ToolPayload {
  return {
    message: 'ODE parameter fitting completed successfully.',
    confidence: 0.8,
    claimType: 'reproduction',
    evidenceLevel: 'runtime',
    reasoningTrace: 'Ran the generated experiment.',
    claims: [{
      id: 'claim-1',
      text: 'The reproduction succeeded and recovers the parameters closely.',
      type: 'reproduction',
      confidence: 0.8,
    }],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'report' }],
    executionUnits: [{ id: 'run-1', status: 'done' }],
    artifacts: [{
      id: 'output',
      type: 'text',
      content: [
        'True parameters: r=0.8, K=100.0',
        'Fitted parameters: r=64.9299, K=73.6002',
        'RMSE: 28.6483',
        'Parameter error (r): 8016.24%',
        'Parameter error (K): 26.40%',
      ].join('\n'),
    }, {
      id: 'report',
      type: 'research-report',
      data: {
        markdown: 'The fitted parameters are close and the reproduction succeeded.',
      },
    }],
    ...overrides,
  } as ToolPayload;
}

test('result metric consistency guard flags success claims contradicted by high parameter error', () => {
  const finding = evaluateResultMetricConsistency(payload(), request);

  assert.ok(finding);
  assert.equal(finding.severity, 'repair-needed');
  assert.equal(finding.failedMetrics[0]?.label, 'parameter error (r)');
  assert.equal(finding.failedMetrics[0]?.value, 8016.24);
  assert.match(finding.successClaims.join('\n'), /succeeded|close/i);
});

test('generated task guard evaluates metric consistency before generic work evidence', () => {
  const finding = evaluateGeneratedTaskGuardFinding(payload(), request);

  assert.ok(finding);
  assert.equal(finding.source, 'result-metric-consistency');
});

test('result metric consistency guard does not flag honest failed reports', () => {
  const finding = evaluateResultMetricConsistency(payload({
    message: 'The reproduction failed; the parameter error is too high.',
    claims: [{
      id: 'claim-1',
      text: 'The reproduction is not reproduced because r error is 8016.24%.',
      type: 'reproduction',
      confidence: 0.8,
    }],
    artifacts: [{
      id: 'output',
      type: 'text',
      content: 'Parameter error (r): 8016.24%',
    }],
  }), request);

  assert.equal(finding, undefined);
});
