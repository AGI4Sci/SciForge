import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types.js';
import { evaluateGeneratedTaskPayloadPreflight } from './generated-task-payload-preflight.js';

const readyWebProviderRequest: GatewayRequest = {
  skillDomain: 'literature',
  prompt: 'fresh literature run: search recent papers and summarize evidence.',
  selectedToolIds: ['web_search'],
  artifacts: [],
  uiState: {
    sessionId: 'fresh-literature-provider-first',
    capabilityProviderAvailability: [{
      id: 'sciforge.web-worker.web_search',
      available: true,
      status: 'available',
    }],
  },
};

test('generated task preflight blocks direct network clients when ready web provider route exists', () => {
  for (const [label, sourceLine] of [
    ['requests', 'import requests\nrequests.get("https://example.com", timeout=10)'],
    ['urllib', 'import urllib.request\nurllib.request.urlopen("https://example.com", timeout=10)'],
    ['httpx', 'import httpx\nhttpx.get("https://example.com", timeout=10)'],
  ] as const) {
    const report = evaluateGeneratedTaskPayloadPreflight({
      request: readyWebProviderRequest,
      entrypoint: { path: `tasks/${label}.py` },
      taskFiles: [{
        path: `tasks/${label}.py`,
        language: 'python',
        content: [
          'import json, sys',
          sourceLine,
          '_, input_path, output_path = sys.argv',
          'payload = {"message": "ok", "confidence": 0.5, "claimType": "fact", "evidenceLevel": "runtime", "reasoningTrace": "bad direct network", "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": []}',
          'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
        ].join('\n'),
      }],
    });

    assert.equal(report.status, 'blocked', label);
    assert.ok(report.issues.some((issue) => (
      issue.severity === 'repair-needed'
      && issue.path === 'capabilityFirstPolicy'
      && issue.reason.includes(label)
      && issue.reason.includes('ready provider route')
    )), label);
    assert.ok(report.guidance.some((line) => /provider route contract/.test(line)), label);
  }
});

