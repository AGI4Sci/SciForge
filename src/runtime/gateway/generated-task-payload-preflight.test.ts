import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types.js';
import {
  evaluateGeneratedTaskPayloadPreflight,
  generatedTaskPayloadPreflightForTaskInput,
} from './generated-task-payload-preflight.js';

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
    ['socket', 'import socket\nsocket.create_connection(("example.com", 443), timeout=10)'],
    ['http.client', 'import http.client\nhttp.client.HTTPSConnection("example.com", timeout=10)'],
    ['curl/wget', 'import subprocess\nsubprocess.run(["curl", "https://example.com"], check=False)'],
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

test('generated task preflight blocks unavailable provider SDK imports when ready web provider route exists', () => {
  const report = evaluateGeneratedTaskPayloadPreflight({
    request: readyWebProviderRequest,
    entrypoint: { path: 'task.py' },
    taskFiles: [{
      path: 'task.py',
      language: 'python',
      content: [
        'import sys',
        'from sciforge.tools import web_search',
        '_, input_path, output_path = sys.argv',
        'payload = {"message": "ok", "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": []}',
        'open(output_path, "w", encoding="utf-8").write(str(payload))',
      ].join('\n'),
    }],
  });

  assert.equal(report.status, 'blocked');
  assert.equal(report.issues.some((issue) => (
    issue.kind === 'capability-first-direct-network'
    && issue.path === 'capabilityFirstPolicy'
    && issue.reason.includes('unavailable provider SDKs')
  )), true);
});

test('generated task preflight task input preserves stable issue identity and clipped evidence', () => {
  const report = evaluateGeneratedTaskPayloadPreflight({
    request: readyWebProviderRequest,
    entrypoint: { path: 'tasks/direct-network.py' },
    taskFiles: [{
      path: 'tasks/direct-network.py',
      language: 'python',
      content: [
        'import json, sys',
        'import requests',
        'requests.get("https://example.com", timeout=10)',
        '_, input_path, output_path = sys.argv',
        'payload = {"message": "ok", "confidence": 0.5, "claimType": "fact", "evidenceLevel": "runtime", "reasoningTrace": "bad direct network", "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": []}',
        'open(output_path, "w", encoding="utf-8").write(json.dumps(payload))',
      ].join('\n'),
    }],
  });

  const taskInputPreflight = generatedTaskPayloadPreflightForTaskInput(report);
  const providerFirstIssue = taskInputPreflight.issues.find((issue) => issue.path === 'capabilityFirstPolicy');

  assert.equal(providerFirstIssue?.id, 'tasks/direct-network.py:provider-first-direct-network:web_search');
  assert.equal(providerFirstIssue?.kind, 'capability-first-direct-network');
  assert.equal(providerFirstIssue?.evidence, 'requests');
});
