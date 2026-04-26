import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import { acceptSkillPromotionProposal, listSkillPromotionProposals } from '../../src/runtime/skill-promotion.js';
import { loadSkillRegistry } from '../../src/runtime/skill-registry.js';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-self-evolving-skill-'));
let sawGenerationRequest = false;

const generatedTask = String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]

with open(input_path, "r", encoding="utf-8") as handle:
    request = json.load(handle)

payload = {
    "message": "Generated self-evolving literature task completed.",
    "confidence": 0.84,
    "claimType": "evidence-summary",
    "evidenceLevel": "self-evolving-smoke",
    "reasoningTrace": "Generated task can become an evolved skill proposal.",
    "claims": [
        {"id": "claim.self.evolving", "text": "Generated workspace task emitted a reusable paper-list artifact.", "supportingRefs": ["artifact.self.paper-list"]}
    ],
    "uiManifest": [
        {"componentId": "paper-card-list", "artifactRef": "artifact.self.paper-list", "priority": 1},
        {"componentId": "execution-unit-table", "artifactRef": "artifact.self.paper-list", "priority": 2}
    ],
    "executionUnits": [
        {"id": "self-evolving-generated-task", "status": "done", "tool": "agentserver.generated.python", "attempt": request.get("attempt", 1)}
    ],
    "artifacts": [
        {
            "id": "artifact.self.paper-list",
            "type": "paper-list",
            "producerScenario": "literature-evidence-review",
            "schemaVersion": "1",
            "metadata": {"source": "mock-agentserver-self-evolving"},
            "data": {
                "query": request.get("prompt", ""),
                "papers": [
                    {"title": "Self-evolving skill loop smoke", "url": "https://example.invalid/self-evolving", "source": "mock"}
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
  sawGenerationRequest = true;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    data: {
      run: {
        id: 'mock-self-evolving-generation-run',
        status: 'completed',
        output: {
          result: {
            taskFiles: [{ path: '.bioagent/tasks/self-evolving-task.py', language: 'python', content: generatedTask }],
            entrypoint: { language: 'python', path: '.bioagent/tasks/self-evolving-task.py' },
            environmentRequirements: { language: 'python' },
            validationCommand: 'python .bioagent/tasks/self-evolving-task.py <input> <output>',
            expectedArtifacts: ['paper-list'],
            patchSummary: 'Generated task intended to become an evolved skill proposal.',
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
    prompt: 'custom self evolving literature workflow with no matching seed skill',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    availableSkills: ['missing.skill'],
    expectedArtifactTypes: ['paper-list'],
    selectedComponentIds: ['paper-card-list', 'execution-unit-table'],
    artifacts: [],
  });

  assert.equal(sawGenerationRequest, true);
  assert.equal(result.executionUnits[0]?.status, 'done');
  assert.match(String(result.reasoningTrace), /Skill promotion proposal/);

  const proposals = await listSkillPromotionProposals(workspace);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].status, 'needs-user-confirmation');
  assert.equal(proposals[0].reviewChecklist.userConfirmedPromotion, false);
  assert.match(proposals[0].source.taskCodeRef, /^\.bioagent\/tasks\/generated-literature-[a-f0-9]+\/self-evolving-task\.py$/);

  const stableWorkspaceSkills = await readdir(join(workspace, '.bioagent', 'skills')).catch(() => []);
  assert.equal(stableWorkspaceSkills.some((entry) => entry.includes(proposals[0].proposedManifest.id)), false);

  const accepted = await acceptSkillPromotionProposal(workspace, proposals[0].id);
  assert.equal(accepted.id, proposals[0].proposedManifest.id);
  assert.equal(accepted.entrypoint.path?.endsWith('.py'), true);

  const evolvedSkillDirs = await readdir(join(workspace, '.bioagent', 'evolved-skills'));
  assert.equal(evolvedSkillDirs.length, 1);

  const registry = await loadSkillRegistry({ workspacePath: workspace });
  const evolved = registry.find((skill) => skill.id === accepted.id);
  assert.equal(evolved?.available, true);
  assert.match(String(evolved?.manifestPath), /\.bioagent\/evolved-skills\//);
  assert.equal(registry.some((skill) => skill.manifestPath.includes('.bioagent/skills') && skill.id === accepted.id), false);

  console.log('[ok] self-evolving skill loop writes proposal, accepts into isolated evolved-skills, and registry discovers it');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
