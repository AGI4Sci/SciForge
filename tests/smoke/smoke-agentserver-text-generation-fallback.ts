import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-text-generation-fallback-'));
const taskRel = '.sciforge/tasks/text-fallback/generated-task.py';
const taskCode = String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]
payload = {
  "message": "Recovered text generation task executed.",
  "confidence": 0.8,
  "claimType": "fact",
  "evidenceLevel": "runtime",
  "reasoningTrace": "AgentServer returned generation JSON as plain text",
  "claims": [],
  "uiManifest": [{"componentId": "report-viewer", "artifactRef": "text-fallback-report"}],
  "executionUnits": [{"id": "text-fallback-task", "status": "done", "tool": "agentserver.text-fallback"}],
  "artifacts": [{"id": "text-fallback-report", "type": "research-report", "data": {"markdown": "Text fallback task ran."}}]
}
with open(output_path, "w", encoding="utf-8") as handle:
  json.dump(payload, handle, indent=2)
`;

const server = createServer(async (req, res) => {
  if (req.url !== '/api/agent-server/runs/stream' || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const result = {
    ok: true,
    data: {
      run: {
        id: 'mock-text-generation-run',
        status: 'completed',
        output: {
          success: true,
          result: [
            '```json',
            '{',
            '  "taskFiles": [{"path": ".sciforge/tasks/text-fallback/generated-task.py", "language": "python"}],',
            '  "entrypoint": {"language": "python", "path": ".sciforge/tasks/text-fallback/generated-task.py", "command": "python3 .sciforge/tasks/text-fallback/generated-task.py {inputPath} {outputPath}"}',
            '}',
            '```',
            '',
            '```python',
            `# ${taskRel}`,
            taskCode,
            '```',
          ].join('\n'),
        },
      },
    },
  };
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  res.end(JSON.stringify({ result }) + '\n');
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'Generate and run a task even when AgentServer returns taskFiles JSON as plain text.',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    availableSkills: ['missing.skill'],
    expectedArtifactTypes: ['research-report'],
    uiState: { forceAgentServerGeneration: true },
    artifacts: [],
  });
  assert.equal(result.executionUnits[0]?.status, 'done');
  assert.equal(result.executionUnits[0]?.tool, 'agentserver.text-fallback');
  assert.match(result.reasoningTrace, /text|fenced|plain|fallback|Recovered/i);
  assert.ok(result.artifacts.some((artifact) => artifact.id === 'text-fallback-report'));
  console.log('[ok] AgentServer plain-text taskFiles response is recovered and executed');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
