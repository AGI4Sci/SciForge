import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContextEnvelope, expectedArtifactSchema, workspaceTreeSummary } from '../../src/runtime/gateway/context-envelope.js';
import { normalizeGatewayRequest, selectedComponentIdsForRequest } from '../../src/runtime/gateway/gateway-request.js';
import { normalizeArtifactsForPayload, persistArtifactRefsForPayload } from '../../src/runtime/gateway/artifact-materializer.js';
import { coerceAgentServerToolPayload, parseGenerationResponse } from '../../src/runtime/gateway/payload-normalizer.js';
import { repairNeededPayload } from '../../src/runtime/gateway/repair-policy.js';
import type { SkillAvailability } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-gateway-modules-'));
try {
  await writeFile(join(workspace, 'report.md'), '## Summary\nGateway split smoke passed.\n', 'utf8');
  await writeFile(join(workspace, '.bioagent-artifact-root-marker.txt'), 'not hidden by prefix alone\n', 'utf8');
  await writeFile(join(workspace, '.gitkeep'), 'keep\n', 'utf8');
  await mkdir(join(workspace, '.bioagent', 'artifacts'), { recursive: true });
  await writeFile(join(workspace, '.bioagent', 'artifacts', 'stale-paper-list.json'), '{"stale":true}\n', 'utf8');
  await mkdir(join(workspace, '.sciforge', 'artifacts'), { recursive: true });
  await writeFile(join(workspace, '.sciforge', 'artifacts', 'old-large-report.txt'), 'old report\n', 'utf8');
  const request = normalizeGatewayRequest({
    skillDomain: 'literature',
    prompt: 'Summarize the uploaded report',
    workspacePath: workspace,
    agentServerBaseUrl: 'http://127.0.0.1:3000/',
    llmEndpoint: { provider: 'openai', baseUrl: 'http://127.0.0.1:4000/', modelName: 'test-model' },
    expectedArtifactTypes: ['research-report', 'research-report'],
    selectedComponentIds: ['report-viewer'],
    uiState: {
      sessionId: 'session-gateway',
      recentConversation: ['user: summarize report', 'assistant: ready'],
      conversationLedger: Array.from({ length: 20 }, (_, index) => ({
        turn: index + 1,
        id: `msg-${index + 1}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        contentDigest: `digest-${index + 1}`,
        contentPreview: `Round ${index + 1}`,
      })),
      contextReusePolicy: { mode: 'stable-ledger-plus-recent-window', ordering: 'append-only-session-order' },
      expectedArtifactTypes: ['paper-list'],
      selectedComponentIds: ['paper-card-list'],
    },
    artifacts: [{ id: 'prior-report', type: 'research-report' }],
  });

  assert.equal(request.agentServerBaseUrl, 'http://127.0.0.1:3000');
  assert.deepEqual(selectedComponentIdsForRequest(request), ['report-viewer', 'paper-card-list']);
  assert.deepEqual(expectedArtifactSchema(request), { types: ['research-report', 'paper-list'] });

  const tree = await workspaceTreeSummary(workspace);
  assert.ok(tree.some((entry) => entry.path === 'report.md'));
  assert.ok(tree.some((entry) => entry.path === '.bioagent-artifact-root-marker.txt'));
  assert.ok(!tree.some((entry) => entry.path === '.bioagent' || entry.path.startsWith('.bioagent/')));
  assert.ok(tree.some((entry) => entry.path === '.sciforge/artifacts'));
  assert.ok(!tree.some((entry) => entry.path.startsWith('.sciforge/artifacts/')));

  const envelope = buildContextEnvelope(request, { workspace, workspaceTreeSummary: tree });
  assert.equal(envelope.version, 'sciforge.context-envelope.v1');
  assert.equal(envelope.mode, 'delta');
  assert.deepEqual(envelope.scenarioFacts.expectedArtifactTypes, ['research-report', 'paper-list']);
  assert.equal(envelope.sessionFacts.conversationLedger?.totalTurns, 20);
  assert.equal(envelope.sessionFacts.conversationLedger?.omittedPrefixTurns, 2);
  assert.equal((envelope.sessionFacts.contextReusePolicy as Record<string, unknown> | undefined)?.mode, 'stable-ledger-plus-recent-window');

  const normalizedArtifacts = await normalizeArtifactsForPayload([{
    id: 'research-report',
    type: 'research-report',
    path: 'report.md',
  }], workspace, {
    taskRel: '.sciforge/tasks/task.py',
    outputRel: '.sciforge/task-results/task.json',
    stdoutRel: '.sciforge/logs/task.stdout.log',
    stderrRel: '.sciforge/logs/task.stderr.log',
  });
  assert.equal((normalizedArtifacts[0].data as Record<string, unknown>).markdown, '## Summary\nGateway split smoke passed.\n');

  const persisted = await persistArtifactRefsForPayload(workspace, request, normalizedArtifacts, {
    taskRel: '.sciforge/tasks/task.py',
    outputRel: '.sciforge/task-results/task.json',
    stdoutRel: '.sciforge/logs/task.stdout.log',
    stderrRel: '.sciforge/logs/task.stderr.log',
  });
  const artifactRef = String((persisted[0].metadata as Record<string, unknown>).artifactRef);
  assert.match(artifactRef, /^\.sciforge\/artifacts\/session-gateway-research-report-research-report-/);
  assert.match(await readFile(join(workspace, artifactRef), 'utf8'), /Gateway split smoke passed/);

  const directPayload = coerceAgentServerToolPayload({
    message: 'Direct answer',
    artifacts: [{ id: 'research-report', type: 'research-report' }],
  });
  assert.equal(directPayload?.message, 'Direct answer');
  assert.equal(directPayload?.uiManifest[0].componentId, 'report-viewer');

  const generation = parseGenerationResponse({
    taskFiles: [{ path: '.sciforge/tasks/task.py', content: 'print(1)' }],
    entrypoint: 'python .sciforge/tasks/task.py --flag',
    expectedArtifacts: [{ type: 'research-report' }],
  });
  assert.equal(generation?.entrypoint.path, '.sciforge/tasks/task.py');
  assert.deepEqual(generation?.entrypoint.args, ['--flag']);

  const skill: SkillAvailability = {
    id: 'agentserver.generation.literature',
    kind: 'installed',
    available: true,
    reason: 'smoke',
    checkedAt: new Date().toISOString(),
    manifestPath: 'agentserver',
    manifest: {
      id: 'agentserver.generation.literature',
      kind: 'installed',
      description: 'smoke',
      skillDomains: ['literature'],
      inputContract: {},
      outputArtifactSchema: {},
      entrypoint: { type: 'agentserver-generation' },
      environment: {},
      validationSmoke: {},
      examplePrompts: [],
      promotionHistory: [],
    },
  };
  const repair = repairNeededPayload(request, skill, 'AgentServer base URL missing', {}, { scenarioPackageId: 'smoke' });
  assert.equal(repair.executionUnits[0].status, 'repair-needed');
  assert.ok(String(repair.executionUnits[0].params).includes('AgentServer base URL missing'));

  console.log('[ok] runtime gateway modules expose request/context/payload/artifact/repair boundaries');
} finally {
  await rm(workspace, { recursive: true, force: true });
}
