import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { sendBioAgentToolMessage } from './bioagentToolsClient';
import type { SendAgentMessageInput } from '../domain';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('sendBioAgentToolMessage routing', () => {
  it('honors an explicit registered local structure skill request', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message: 'local structure task completed',
          confidence: 0.9,
          claimType: 'fact',
          evidenceLevel: 'database',
          uiManifest: [{ componentId: 'molecule-viewer', artifactRef: 'structure-summary', priority: 1 }],
          executionUnits: [{
            id: 'EU-local-structure',
            tool: 'RCSB.core.entry',
            status: 'done',
            skillId: 'structure.rcsb_latest_or_entry',
          }],
          artifacts: [{
            id: 'structure-summary',
            type: 'structure-summary',
            schemaVersion: '1',
            data: { pdbId: '6LUD' },
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await sendBioAgentToolMessage({
      ...baseInput(),
      prompt: '请使用已注册本地 workspace skill structure.rcsb_latest_or_entry；不要生成新代码，不要调用 AgentServer。对 PDB 6LUD 运行真实 RCSB metadata/coordinate retrieval。',
    });

    assert.deepEqual(requestBody?.availableSkills, ['structure.rcsb_latest_or_entry']);
    const uiState = requestBody?.uiState as Record<string, unknown>;
    assert.equal(uiState.forceAgentServerGeneration, false);
  });

  it('keeps open-ended structure report requests on AgentServer generation', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message: 'repair-needed',
          confidence: 0.2,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          uiManifest: [],
          executionUnits: [{ id: 'EU-agentserver', tool: 'bioagent.workspace-runtime-gateway', status: 'repair-needed' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await sendBioAgentToolMessage({
      ...baseInput(),
      artifacts: [{
        id: 'structure-summary',
        type: 'structure-summary',
        producerScenario: 'workspace-structure-exploration-t055-test',
        schemaVersion: '1',
        data: { pdbId: '6LUD' },
      }],
      prompt: '继续，结合文献证据写 EGFR L858R/T790M/C797S 奥希替尼耐药解释报告，并说明不能推断的内容。',
    });

    assert.deepEqual(requestBody?.availableSkills, ['agentserver.generate.structure']);
    const uiState = requestBody?.uiState as Record<string, unknown>;
    assert.equal(uiState.forceAgentServerGeneration, true);
  });

  it('does not treat "do not use seed skill" repair prompts as local skill requests', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message: 'repair-needed',
          confidence: 0.2,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          uiManifest: [],
          executionUnits: [{ id: 'EU-literature', tool: 'bioagent.workspace-runtime-gateway', status: 'repair-needed' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await sendBioAgentToolMessage({
      ...baseInput(),
      scenarioId: 'literature-evidence-review',
      agentName: 'Literature',
      agentDomain: 'literature',
      scenarioOverride: {
        title: 'T059 literature',
        description: 'external API failure repair loop',
        skillDomain: 'literature',
        scenarioMarkdown: '必须由 BioAgent/AgentServer 自己生成 workspace-local task。',
        defaultComponents: ['paper-card-list', 'evidence-matrix', 'execution-unit-table'],
        allowedComponents: ['paper-card-list', 'evidence-matrix', 'execution-unit-table'],
        fallbackComponent: 'unknown-artifact-inspector',
      },
      prompt: 'T059 literature Round 1：不要使用 literature.pubmed_search seed skill；请由 BioAgent/AgentServer 自己生成 workspace-local task，故意制造 external API failure，失败时显示 failureReason、stdoutRef/stderrRef 和 ExecutionUnit。',
      scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
    });

    assert.deepEqual(requestBody?.availableSkills, ['agentserver.generate.literature']);
    const uiState = requestBody?.uiState as Record<string, unknown>;
    assert.equal(uiState.forceAgentServerGeneration, true);
  });

  it('lets a Scenario Builder domain override replace the built-in scenario route', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message: 'repair-needed',
          confidence: 0.2,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          uiManifest: [],
          executionUnits: [{ id: 'EU-omics', tool: 'bioagent.workspace-runtime-gateway', status: 'repair-needed' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await sendBioAgentToolMessage({
      ...baseInput(),
      scenarioId: 'literature-evidence-review',
      agentName: 'Literature shell',
      agentDomain: 'literature',
      scenarioOverride: {
        title: 'Builder-switched omics',
        description: 'Omics repair loop from Scenario Builder.',
        skillDomain: 'omics',
        scenarioMarkdown: 'Use generated omics workspace-local task.',
        defaultComponents: ['report-viewer', 'volcano-plot', 'execution-unit-table'],
        allowedComponents: ['report-viewer', 'volcano-plot', 'execution-unit-table'],
        fallbackComponent: 'unknown-artifact-inspector',
      },
      scenarioPackageRef: { id: 'omics-differential-exploration', version: '1.0.0', source: 'built-in' },
      skillPlanRef: 'skill-plan.omics-differential-exploration.default',
      uiPlanRef: 'ui-plan.omics-differential-exploration.default',
      prompt: 'T059 omics：只能由 BioAgent/AgentServer 自己生成 workspace-local task。',
    });

    assert.equal(requestBody?.scenarioId, 'omics-differential-exploration');
    assert.equal(requestBody?.skillDomain, 'omics');
    assert.deepEqual(requestBody?.availableSkills, ['agentserver.generate.omics']);
    assert.deepEqual(requestBody?.scenarioPackageRef, { id: 'omics-differential-exploration', version: '1.0.0', source: 'built-in' });
    const uiState = requestBody?.uiState as Record<string, unknown>;
    assert.equal(uiState.forceAgentServerGeneration, true);
  });

  it('does not leak stale local conversation into a clean package first run', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message: 'repair-needed',
          confidence: 0.2,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          uiManifest: [],
          executionUnits: [{ id: 'EU-structure', tool: 'bioagent.workspace-runtime-gateway', status: 'repair-needed' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await sendBioAgentToolMessage({
      ...baseInput(),
      messages: [{
        id: 'msg-stale',
        role: 'user',
        content: 'T059 fixed structure Round 1：请故意制造坏 JSON schema failure。',
        createdAt: '2026-04-26T00:00:00.000Z',
        status: 'completed',
      }, {
        id: 'msg-current',
        role: 'user',
        content: 'Round 1：制定结构选择策略，检索 PDB/AlphaFold/UniProt refs。',
        createdAt: '2026-04-26T00:01:00.000Z',
        status: 'completed',
      }],
      prompt: 'Round 1：制定结构选择策略，检索 PDB/AlphaFold/UniProt refs。',
    });

    assert.equal(String(requestBody?.prompt).includes('T059 fixed structure'), false);
    assert.equal(String(requestBody?.prompt).includes('Round 1：制定结构选择策略'), true);
    const uiState = requestBody?.uiState as Record<string, unknown>;
    assert.deepEqual(uiState.recentConversation, ['user: Round 1：制定结构选择策略，检索 PDB/AlphaFold/UniProt refs。']);
  });
});

function baseInput(): SendAgentMessageInput {
  return {
    scenarioId: 'workspace-structure-exploration-t055-test',
    agentName: 'Structure',
    agentDomain: 'structure',
    prompt: '',
    roleView: 'PI',
    messages: [],
    artifacts: [],
    executionUnits: [],
    runs: [],
    config: {
      schemaVersion: 1,
      agentServerBaseUrl: 'http://127.0.0.1:18080',
      workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
      workspacePath: '/tmp/bioagent-test-workspace',
      modelProvider: 'native',
      modelBaseUrl: '',
      modelName: '',
      apiKey: '',
      requestTimeoutMs: 300000,
      updatedAt: '2026-04-26T00:00:00.000Z',
    },
    scenarioOverride: {
      title: 'T055 structure test',
      description: '分析 EGFR L858R/T790M/C797S 变异对 ATP 结合口袋和奥希替尼耐药的影响。',
      skillDomain: 'structure',
      scenarioMarkdown: '需要 structure-summary、residue table、viewer manifest、research-report。',
      defaultComponents: ['report-viewer', 'molecule-viewer', 'evidence-matrix', 'execution-unit-table'],
      allowedComponents: ['report-viewer', 'molecule-viewer', 'evidence-matrix', 'execution-unit-table'],
      fallbackComponent: 'unknown-artifact-inspector',
    },
    scenarioPackageRef: { id: 'workspace-structure-exploration-t055-test', version: '1.0.0', source: 'workspace' },
    skillPlanRef: 'skill-plan.t055-test',
    uiPlanRef: 'ui-plan.t055-test',
  };
}
