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

test('generated task preflight ignores artifact JSON dumps that are not outputPath payloads', () => {
  const report = evaluateGeneratedTaskPayloadPreflight({
    entrypoint: { path: 'tasks/generate_report.py' },
    taskFiles: [{
      path: 'tasks/generate_report.py',
      language: 'python',
      content: [
        'import json, sys',
        '_, input_path, output_path = sys.argv',
        'artifact_path = "work_packages.json"',
        'with open(artifact_path, "w", encoding="utf-8") as f:',
        '    json.dump({"work_packages": [], "monthly_timeline": [], "total_budget": 120000}, f)',
        'payload = {"message": "ok", "confidence": 1, "claimType": "report", "evidenceLevel": "generated", "reasoningTrace": "wrote report", "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": [{"id": "report", "type": "research-report", "path": artifact_path}]}',
        'with open(output_path, "w", encoding="utf-8") as f:',
        '    json.dump(payload, f)',
      ].join('\n'),
    }],
  });

  assert.equal(report.status, 'ready');
  assert.equal(report.issues.some((issue) => /missing.*ToolPayload envelope/i.test(issue.reason)), false);
});

test('generated task preflight blocks treating outputPath as artifact directory', () => {
  const report = evaluateGeneratedTaskPayloadPreflight({
    entrypoint: { path: 'tasks/generate_report.py' },
    taskFiles: [{
      path: 'tasks/generate_report.py',
      language: 'python',
      content: [
        'import json, os, sys',
        '_, input_path, output_path = sys.argv',
        'out_dir = os.path.join(output_path, "research-package")',
        'os.makedirs(out_dir, exist_ok=True)',
        'report_path = os.path.join(out_dir, "research_report.md")',
        'payload = {"message": "ok", "confidence": 1, "claimType": "report", "evidenceLevel": "generated", "reasoningTrace": "wrote report", "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": [{"id": "research-report", "type": "research-report", "path": report_path}]}',
        'with open(output_path, "w", encoding="utf-8") as f:',
        '    json.dump(payload, f)',
      ].join('\n'),
    }],
  });

  assert.equal(report.status, 'blocked');
  const issue = report.issues.find((entry) => entry.id === 'tasks/generate_report.py:outputPath-used-as-directory');
  assert.equal(issue?.severity, 'repair-needed');
  assert.equal(issue?.path, 'outputPath');
  assert.match(issue?.reason ?? '', /outputPath as a directory/);
  assert.match(report.guidance.join('\n'), /Path\(output_path\)\.parent/);
});

test('generated task preflight allows artifacts beside outputPath parent', () => {
  const report = evaluateGeneratedTaskPayloadPreflight({
    entrypoint: { path: 'tasks/generate_report.py' },
    taskFiles: [{
      path: 'tasks/generate_report.py',
      language: 'python',
      content: [
        'import json, sys',
        'from pathlib import Path',
        '_, input_path, output_path = sys.argv',
        'artifact_dir = Path(output_path).parent / "research-package"',
        'artifact_dir.mkdir(parents=True, exist_ok=True)',
        'report_path = artifact_dir / "research_report.md"',
        'payload = {"message": "ok", "confidence": 1, "claimType": "report", "evidenceLevel": "generated", "reasoningTrace": "wrote report", "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": [{"id": "research-report", "type": "research-report", "path": str(report_path)}]}',
        'with open(output_path, "w", encoding="utf-8") as f:',
        '    json.dump(payload, f)',
      ].join('\n'),
    }],
  });

  assert.equal(report.status, 'ready');
  assert.equal(report.issues.some((issue) => issue.id.includes('outputPath-used-as-directory')), false);
});

test('generated task preflight allows artifact refs whose id and type can be derived at boundary', () => {
  const report = evaluateGeneratedTaskPayloadPreflight({
    entrypoint: { path: 'tasks/generate_report.py' },
    taskFiles: [{
      path: 'tasks/generate_report.py',
      language: 'python',
      content: [
        'import json, os, sys',
        '_, input_path, output_path = sys.argv',
        'output_dir = os.path.join(os.path.dirname(output_path), "research-package")',
        'artifact_refs = [',
        '    {"ref": os.path.join(output_dir, "README.md"), "kind": "artifact"},',
        '    {"ref": os.path.join(output_dir, "timeline_budget.md"), "kind": "artifact"},',
        ']',
        'payload = {"message": "ok", "confidence": 1, "claimType": "report", "evidenceLevel": "generated", "reasoningTrace": "wrote report", "claims": [], "uiManifest": [{"componentId": "report-viewer", "artifactRef": os.path.join(output_dir, "README.md")}], "executionUnits": [], "artifacts": artifact_refs}',
        'with open(output_path, "w", encoding="utf-8") as f:',
        '    json.dump(payload, f)',
      ].join('\n'),
    }],
  });

  assert.notEqual(report.status, 'blocked');
  assert.ok(report.issues.every((issue) => issue.severity === 'guidance'));
  assert.ok(report.issues.some((issue) => /identity can be derived/.test(issue.reason)));
});
