import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import { acceptSkillPromotionProposal, archiveSkillPromotionProposal, listSkillPromotionProposals, maybeWriteSkillPromotionProposal, rejectSkillPromotionProposal, runAcceptedSkillValidationSmoke } from '../../src/runtime/skill-promotion.js';
import { loadSkillRegistry } from '../../src/runtime/skill-registry.js';
import type { GatewayRequest, SkillAvailability, ToolPayload } from '../../src/runtime/runtime-types.js';

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

  const validation = await runAcceptedSkillValidationSmoke(workspace, accepted.id);
  assert.equal(validation.passed, true);
  assert.deepEqual(validation.missingArtifactTypes, []);
  const acceptedProposalPath = join(workspace, '.bioagent', 'skill-proposals', proposals[0].id, 'proposal.json');
  const acceptedProposalBefore = JSON.parse(await readFile(acceptedProposalPath, 'utf8'));
  const evolvedTaskPath = join(workspace, '.bioagent', 'evolved-skills', accepted.id, basename(accepted.entrypoint.path || 'task.py'));
  await writeFile(evolvedTaskPath, 'import sys\nraise RuntimeError("forced evolved skill failure")\n', 'utf8');
  const failedEvolvedRun = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'custom self evolving literature workflow with no matching seed skill',
    workspacePath: workspace,
    availableSkills: [accepted.id],
    expectedArtifactTypes: ['paper-list'],
    artifacts: [],
  });
  assert.equal(failedEvolvedRun.executionUnits[0]?.status, 'repair-needed');
  assert.match(String(failedEvolvedRun.executionUnits[0]?.failureReason || failedEvolvedRun.reasoningTrace), /forced evolved skill failure/);
  const acceptedProposalAfter = JSON.parse(await readFile(acceptedProposalPath, 'utf8'));
  assert.equal(acceptedProposalAfter.status, 'accepted');
  assert.deepEqual(acceptedProposalAfter.promotionHistory, acceptedProposalBefore.promotionHistory);
  assert.equal(acceptedProposalAfter.reviewChecklist.userConfirmedPromotion, true);

  await writeComplexSingleCellProposalsSmoke();

  console.log('[ok] self-evolving skill loop writes proposals, accepts into isolated evolved-skills, registry discovers them, and validation smoke reruns');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function writeComplexSingleCellProposalsSmoke() {
  const complexWorkspace = await mkdtemp(join(tmpdir(), 'bioagent-complex-cell-proposals-'));
  const stableSeedBefore = await stableSkillRootSnapshot('skills/seed');
  const stableInstalledBefore = await stableSkillRootSnapshot('skills/installed');
  const generatedSkill = agentGeneratedOmicsSkill();
  const cases = [
    {
      id: 'scanpy-atlas-qc-cluster-report',
      prompt: 'scanpy atlas qc cluster report for Tabula Sapiens single-cell atlas',
      artifactType: 'scanpy-atlas-qc-cluster-report',
    },
    {
      id: 'scvelo-velocity-report',
      prompt: 'scvelo velocity report for single-cell trajectory analysis',
      artifactType: 'scvelo-velocity-report',
    },
    {
      id: 'single-cell-label-transfer-qc',
      prompt: 'single-cell label-transfer qc report with reference annotations',
      artifactType: 'single-cell-label-transfer-qc',
    },
  ];

  for (const item of cases) {
    const taskRel = `.bioagent/tasks/${item.id}/task.py`;
    await mkdir(join(complexWorkspace, '.bioagent', 'tasks', item.id), { recursive: true });
    await writeFile(join(complexWorkspace, taskRel), reusableSingleCellTask(item.artifactType), 'utf8');
    const proposal = await maybeWriteSkillPromotionProposal({
      workspacePath: complexWorkspace,
      request: omicsRequest(item.prompt, complexWorkspace, [item.artifactType]),
      skill: generatedSkill,
      taskId: `task-${item.id}`,
      taskRel,
      inputRef: `.bioagent/task-inputs/task-${item.id}.json`,
      outputRef: `.bioagent/task-outputs/task-${item.id}.json`,
      stdoutRef: `.bioagent/task-logs/task-${item.id}.stdout.txt`,
      stderrRef: `.bioagent/task-logs/task-${item.id}.stderr.txt`,
      payload: successfulPayload(item.artifactType, item.prompt),
      patchSummary: `Generated reusable ${item.id} workflow.`,
    });
    assert.equal(proposal?.id, item.id);
    assert.equal(proposal?.securityGate?.passed, true);
    assert.equal(proposal?.reviewChecklist.noHardCodedAbsolutePaths, true);
    assert.equal(proposal?.reviewChecklist.noCredentialLikeText, true);
    assert.equal(proposal?.reviewChecklist.noPrivateFileReferences, true);
    assert.equal(proposal?.reviewChecklist.reproducibleDependencies, true);

    const proposalJson = JSON.parse(await readFile(join(complexWorkspace, '.bioagent', 'skill-proposals', item.id, 'proposal.json'), 'utf8'));
    assert.equal(proposalJson.source.taskCodeRef, taskRel);
    assert.equal(proposalJson.source.inputRef, `.bioagent/task-inputs/task-${item.id}.json`);
    assert.equal(proposalJson.source.outputRef, `.bioagent/task-outputs/task-${item.id}.json`);
    assert.equal(proposalJson.source.stdoutRef, `.bioagent/task-logs/task-${item.id}.stdout.txt`);
    assert.equal(proposalJson.source.stderrRef, `.bioagent/task-logs/task-${item.id}.stderr.txt`);
    assert.equal(proposalJson.validationPlan.rerunAfterAccept.mode, 'registry-discovered-workspace-task');
    assert.equal(proposalJson.reviewChecklist.userConfirmedPromotion, false);
  }

  const unsafeTaskRel = '.bioagent/tasks/unsafe/task.py';
  await mkdir(join(complexWorkspace, '.bioagent', 'tasks', 'unsafe'), { recursive: true });
  await writeFile(join(complexWorkspace, unsafeTaskRel), [
    'API_KEY = "credential-placeholder-value"',
    'PRIVATE_PATH = "/Users/alice/Documents/private.h5ad"',
    'print(API_KEY, PRIVATE_PATH)',
    '',
  ].join('\n'), 'utf8');
  const unsafeProposal = await maybeWriteSkillPromotionProposal({
    workspacePath: complexWorkspace,
    request: omicsRequest('custom omics unsafe promotion', complexWorkspace, ['unsafe']),
    skill: generatedSkill,
    taskId: 'task-unsafe',
    taskRel: unsafeTaskRel,
    payload: successfulPayload('unsafe', 'unsafe'),
  });
  assert.equal(unsafeProposal?.securityGate?.passed, false);
  await assert.rejects(
    () => acceptSkillPromotionProposal(complexWorkspace, unsafeProposal?.id || ''),
    /safety gate failed/,
  );

  const rejectTaskRel = '.bioagent/tasks/rejectable/task.py';
  await mkdir(join(complexWorkspace, '.bioagent', 'tasks', 'rejectable'), { recursive: true });
  await writeFile(join(complexWorkspace, rejectTaskRel), reusableSingleCellTask('rejectable-cell-proposal'), 'utf8');
  const rejectable = await maybeWriteSkillPromotionProposal({
    workspacePath: complexWorkspace,
    request: omicsRequest('rejectable single-cell proposal', complexWorkspace, ['rejectable-cell-proposal']),
    skill: generatedSkill,
    taskId: 'task-rejectable-cell-proposal',
    taskRel: rejectTaskRel,
    payload: successfulPayload('rejectable-cell-proposal', 'rejectable single-cell proposal'),
  });
  assert.ok(rejectable);
  const rejected = await rejectSkillPromotionProposal(complexWorkspace, rejectable.id, 'smoke rejects unsafe or unwanted proposal');
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.statusReason, 'smoke rejects unsafe or unwanted proposal');
  await assert.rejects(
    () => acceptSkillPromotionProposal(complexWorkspace, rejected.id),
    /rejected/,
  );

  const archiveTaskRel = '.bioagent/tasks/archivable/task.py';
  await mkdir(join(complexWorkspace, '.bioagent', 'tasks', 'archivable'), { recursive: true });
  await writeFile(join(complexWorkspace, archiveTaskRel), reusableSingleCellTask('archivable-cell-proposal'), 'utf8');
  const archivable = await maybeWriteSkillPromotionProposal({
    workspacePath: complexWorkspace,
    request: omicsRequest('archivable single-cell proposal', complexWorkspace, ['archivable-cell-proposal']),
    skill: generatedSkill,
    taskId: 'task-archivable-cell-proposal',
    taskRel: archiveTaskRel,
    payload: successfulPayload('archivable-cell-proposal', 'archivable single-cell proposal'),
  });
  assert.ok(archivable);
  const archived = await archiveSkillPromotionProposal(complexWorkspace, archivable.id, 'smoke archives stale proposal');
  assert.equal(archived.status, 'archived');
  assert.equal(archived.statusReason, 'smoke archives stale proposal');

  const proposals = await listSkillPromotionProposals(complexWorkspace);
  for (const item of cases) {
    assert.ok(proposals.some((proposal) => proposal.id === item.id));
    const accepted = await acceptSkillPromotionProposal(complexWorkspace, item.id);
    assert.equal(accepted.id, `workspace.omics.${item.id}`);
    const registry = await loadSkillRegistry({ workspacePath: complexWorkspace });
    const discovered = registry.find((skill) => skill.id === accepted.id);
    assert.equal(discovered?.available, true);
    assert.match(String(discovered?.manifestPath), /\.bioagent\/evolved-skills\//);
    const validation = await runAcceptedSkillValidationSmoke(complexWorkspace, accepted.id);
    assert.equal(validation.passed, true);
    assert.deepEqual(validation.missingArtifactTypes, []);
  }

  const evolvedSkillDirs = await readdir(join(complexWorkspace, '.bioagent', 'evolved-skills'));
  assert.equal(evolvedSkillDirs.length, 3);
  const stableWorkspaceSkills = await readdir(join(complexWorkspace, '.bioagent', 'skills')).catch(() => []);
  assert.equal(stableWorkspaceSkills.some((entry) => entry !== 'status.json'), false);
  assert.deepEqual(await stableSkillRootSnapshot('skills/seed'), stableSeedBefore);
  assert.deepEqual(await stableSkillRootSnapshot('skills/installed'), stableInstalledBefore);
}

function agentGeneratedOmicsSkill(): SkillAvailability {
  const checkedAt = new Date().toISOString();
  return {
    id: 'agentserver.generate.omics',
    kind: 'installed',
    available: true,
    reason: 'smoke generated task',
    checkedAt,
    manifestPath: 'agentserver://generation',
    manifest: {
      id: 'agentserver.generate.omics',
      kind: 'installed',
      description: 'Generic AgentServer task generation fallback.',
      skillDomains: ['omics'],
      inputContract: { prompt: 'string' },
      outputArtifactSchema: { type: 'runtime-artifact' },
      entrypoint: { type: 'agentserver-generation' },
      environment: { runtime: 'AgentServer' },
      validationSmoke: { mode: 'delegated' },
      examplePrompts: [],
      promotionHistory: [],
    },
  };
}

function omicsRequest(prompt: string, workspacePath: string, expectedArtifactTypes: string[]): GatewayRequest {
  return {
    skillDomain: 'omics',
    prompt,
    workspacePath,
    expectedArtifactTypes,
    selectedComponentIds: ['execution-unit-table'],
    artifacts: [],
  };
}

function successfulPayload(artifactType: string, prompt: string): ToolPayload {
  return {
    message: `${artifactType} completed.`,
    confidence: 0.91,
    claimType: 'analysis-report',
    evidenceLevel: 'smoke',
    reasoningTrace: `${artifactType} generated as reusable smoke payload.`,
    claims: [{ id: `claim.${artifactType}`, text: prompt, supportingRefs: [`artifact.${artifactType}`] }],
    uiManifest: [{ componentId: 'execution-unit-table', artifactRef: `artifact.${artifactType}`, priority: 1 }],
    executionUnits: [{ id: `unit.${artifactType}`, status: 'done', tool: 'agentserver.generated.python' }],
    artifacts: [{ id: `artifact.${artifactType}`, type: artifactType, data: { prompt } }],
  };
}

function reusableSingleCellTask(artifactType: string) {
  return String.raw`
import json
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]

with open(input_path, "r", encoding="utf-8") as handle:
    request = json.load(handle)

artifact_type = "${artifactType}"
payload = {
    "message": f"{artifact_type} validation completed.",
    "confidence": 0.9,
    "claimType": "analysis-report",
    "evidenceLevel": "validation-smoke",
    "reasoningTrace": "Accepted evolved skill reran from registry-discovered entrypoint.",
    "claims": [{"id": f"claim.{artifact_type}", "text": request.get("prompt", ""), "supportingRefs": [f"artifact.{artifact_type}"]}],
    "uiManifest": [{"componentId": "execution-unit-table", "artifactRef": f"artifact.{artifact_type}", "priority": 1}],
    "executionUnits": [{"id": f"unit.{artifact_type}", "status": "done", "tool": "evolved.workspace-task"}],
    "artifacts": [{"id": f"artifact.{artifact_type}", "type": artifact_type, "data": {"validated": True}}],
}

with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
`;
}

async function stableSkillRootSnapshot(root: string) {
  const base = resolve(root);
  const entries = await readdir(base, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath || base, entry.name).replace(`${base}/`, ''))
    .sort();
}
