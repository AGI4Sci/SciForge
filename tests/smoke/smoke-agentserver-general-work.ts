import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-agentserver-general-work-'));
let sawFullIntent = false;

const generatedTask = String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]

with open(input_path, "r", encoding="utf-8") as handle:
    request = json.load(handle)

payload = {
    "message": "AgentServer completed a multi-step arXiv reading/report task.",
    "confidence": 0.86,
    "claimType": "evidence-summary",
    "evidenceLevel": "preprint",
    "reasoningTrace": "Generated task received the full multi-turn goal and emitted coordinated report + paper artifacts.",
    "claims": [
        {"text": "The run produced a report artifact instead of stopping at search metadata.", "confidence": 0.86, "evidenceLevel": "preprint"}
    ],
    "uiManifest": [
        {"componentId": "report-viewer", "artifactRef": "research-report", "priority": 1},
        {"componentId": "paper-card-list", "artifactRef": "paper-list", "priority": 2},
        {"componentId": "execution-unit-table", "artifactRef": "runtime-artifact", "priority": 3}
    ],
    "executionUnits": [
        {"id": "agentserver-general-work", "status": "done", "tool": "agentserver.generated.python", "params": request.get("prompt", "")[:120]}
    ],
    "artifacts": [
        {
            "id": "research-report",
            "type": "research-report",
            "producerScenario": "literature-evidence-review",
            "schemaVersion": "1",
            "metadata": {"source": "mock-agentserver-general-work"},
            "data": {
                "markdown": "# Virtual cell arXiv report\n\nThis report summarizes the retrieved papers and next reading steps.",
                "sections": [{"title": "Summary", "content": "A coordinated report was generated."}]
            }
        },
        {
            "id": "paper-list",
            "type": "paper-list",
            "producerScenario": "literature-evidence-review",
            "schemaVersion": "1",
            "metadata": {"source": "mock-agentserver-general-work"},
            "data": {
                "papers": [
                    {"id": "arxiv:2604.00001", "title": "Virtual cell foundation model", "url": "https://arxiv.org/abs/2604.00001", "evidenceLevel": "preprint"}
                ]
            }
        }
    ]
}

with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
`;

const server = createServer(async (req, res) => {
  if (req.url !== '/api/agent-server/runs' || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const body = await readJson(req);
  const promptText = isRecord(body.input) && typeof body.input.text === 'string' ? body.input.text : '';
  sawFullIntent = promptText.includes('阅读、总结并写成系统性的报告')
    && promptText.includes('research-report')
    && promptText.includes('paper-list');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    data: {
      run: {
        id: 'mock-agentserver-general-work-run',
        status: 'completed',
        output: {
          result: {
            taskFiles: [{ path: '.bioagent/tasks/general-arxiv-report.py', language: 'python', content: generatedTask }],
            entrypoint: { language: 'python', path: '.bioagent/tasks/general-arxiv-report.py' },
            environmentRequirements: { language: 'python' },
            validationCommand: 'python .bioagent/tasks/general-arxiv-report.py <input> <output>',
            expectedArtifacts: ['paper-list', 'research-report'],
            patchSummary: 'Generated a coordinated arXiv report task.',
          },
        },
      },
    },
  }));
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: [
      'Recent multi-turn conversation:',
      'user: 我想检索arxiv上最新的虚拟细胞相关的文章，阅读、总结并写成系统性的报告',
      'assistant: arXiv search returned 8 records.',
      'user: 帮我阅读总结这些论文，写阅读报告，不仅仅是获取元信息',
    ].join('\n'),
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    availableSkills: ['agentserver.generate.literature'],
    expectedArtifactTypes: ['paper-list', 'research-report'],
    selectedComponentIds: ['paper-card-list', 'report-viewer', 'execution-unit-table'],
    uiState: {
      freshTaskGeneration: true,
      forceAgentServerGeneration: true,
      recentConversation: [
        'user: 我想检索arxiv上最新的虚拟细胞相关的文章，阅读、总结并写成系统性的报告',
        'assistant: arXiv search returned 8 records.',
        'user: 帮我阅读总结这些论文，写阅读报告，不仅仅是获取元信息',
      ],
    },
    artifacts: [],
  });

  assert.equal(sawFullIntent, true);
  assert.ok(result.artifacts.some((artifact) => artifact.type === 'research-report'));
  assert.ok(result.artifacts.some((artifact) => artifact.type === 'paper-list'));
  assert.ok(result.uiManifest.some((slot) => slot.componentId === 'report-viewer'));
  assert.ok(result.executionUnits.some((unit) => isRecord(unit) && unit.tool === 'agentserver.generated.python'));
  assert.match(String(result.reasoningTrace), /AgentServer generation run/);
  console.log('[ok] open-ended multi-turn arXiv report work routes to AgentServer generation');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function readJson(req: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
