import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { currentTurnContextPolicy, sendSciForgeToolMessage } from './sciforgeToolsClient';
import type { SendAgentMessageInput } from '../domain';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('sendSciForgeToolMessage routing', () => {
  it('keeps the raw user prompt authoritative even when a local skill is mentioned', async () => {
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

    await sendSciForgeToolMessage({
      ...baseInput(),
      prompt: '请使用已注册本地 workspace skill structure.rcsb_latest_or_entry；不要生成新代码，不要调用 AgentServer。对 PDB 6LUD 运行真实 RCSB metadata/coordinate retrieval。',
    });

    assert.equal(requestBody?.prompt, '请使用已注册本地 workspace skill structure.rcsb_latest_or_entry；不要生成新代码，不要调用 AgentServer。对 PDB 6LUD 运行真实 RCSB metadata/coordinate retrieval。');
    assert.deepEqual(requestBody?.availableSkills, ['agentserver.generate.structure']);
    const uiState = requestBody?.uiState as Record<string, unknown>;
    assert.equal(uiState.agentDispatchPolicy, 'agentserver-decides');
    assert.equal(uiState.rawUserPrompt, requestBody?.prompt);
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
          executionUnits: [{ id: 'EU-agentserver', tool: 'sciforge.workspace-runtime-gateway', status: 'repair-needed' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
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
    assert.equal(requestBody?.prompt, '继续，结合文献证据写 EGFR L858R/T790M/C797S 奥希替尼耐药解释报告，并说明不能推断的内容。');
    const uiState = requestBody?.uiState as Record<string, unknown>;
    assert.equal(uiState.agentDispatchPolicy, 'agentserver-decides');
  });

  it('summarizes uploaded binary artifacts without forwarding data URLs to AgentServer', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message: 'upload reference received',
          confidence: 0.8,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          uiManifest: [],
          executionUnits: [{ id: 'EU-upload-ref', tool: 'sciforge.workspace-runtime-gateway', status: 'done' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const pdfDataUrl = `data:application/pdf;base64,${Buffer.from('fake-pdf-binary'.repeat(80_000)).toString('base64')}`;
    await sendSciForgeToolMessage({
      ...baseInput(),
      sessionId: 'session-upload',
      scenarioId: 'literature-evidence-review',
      agentDomain: 'literature',
      artifacts: [{
        id: 'upload-pdf',
        type: 'uploaded-pdf',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        dataRef: '.sciforge/uploads/session-upload/upload-pdf.pdf',
        path: '.sciforge/uploads/session-upload/upload-pdf.pdf',
        metadata: { fileName: 'paper.pdf', mimeType: 'application/pdf', size: 1234, source: 'user-upload' },
        data: { fileName: 'paper.pdf', mimeType: 'application/pdf', dataUrl: pdfDataUrl },
      }],
      prompt: '阅读上传 PDF 并总结。',
    });

    const serialized = JSON.stringify(requestBody);
    assert.ok(!serialized.includes(pdfDataUrl.slice(0, 50_000)), 'uploaded PDF dataUrl leaked into AgentServer request');
    const artifacts = requestBody?.artifacts as Array<Record<string, unknown>>;
    assert.equal(artifacts[0].dataRef, '.sciforge/uploads/session-upload/upload-pdf.pdf');
    assert.equal(artifacts[0].path, '.sciforge/uploads/session-upload/upload-pdf.pdf');
    assert.equal('data' in artifacts[0], false);
    assert.ok(artifacts[0].dataSummary);
    assert.deepEqual(requestBody?.expectedArtifactTypes, ['research-report']);
    assert.deepEqual((requestBody?.uiState as Record<string, unknown>).expectedArtifactTypes, ['research-report']);
    assert.deepEqual((requestBody?.uiState as Record<string, unknown>).selectedComponentIds, ['report-viewer']);
  });

  it('does not force scenario-default evidence objects for generic uploaded-file questions', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message: 'backend decides',
          confidence: 0.8,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          uiManifest: [],
          executionUnits: [{ id: 'EU-generic-upload', tool: 'sciforge.workspace-runtime-gateway', status: 'done' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...baseInput(),
      scenarioId: 'literature-evidence-review',
      agentName: 'Literature',
      agentDomain: 'literature',
      prompt: '看一下这个 pdf-extract skill 能不能用，能用的话帮我处理上传的 PDF。',
      availableComponentIds: ['report-viewer', 'unknown-artifact-inspector'],
      artifacts: [{
        id: 'upload-pdf',
        type: 'uploaded-pdf',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        dataRef: '.sciforge/uploads/session-upload/paper.pdf',
        path: '.sciforge/uploads/session-upload/paper.pdf',
        metadata: { fileName: 'paper.pdf', mimeType: 'application/pdf', size: 1234, source: 'user-upload' },
      }],
    });

    assert.deepEqual(requestBody?.expectedArtifactTypes, []);
    assert.deepEqual(requestBody?.availableComponentIds, ['report-viewer', 'unknown-artifact-inspector']);
    const uiState = requestBody?.uiState as Record<string, unknown>;
    assert.deepEqual(uiState.expectedArtifactTypes, []);
    assert.deepEqual(uiState.selectedComponentIds, []);
    assert.deepEqual(uiState.availableComponentIds, ['report-viewer', 'unknown-artifact-inspector']);
    assert.equal(uiState.artifactExpectationMode, 'backend-decides');
  });

  it('routes fresh arxiv literature report requests to Codex-backed AgentServer generation', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message: 'agentserver generation requested',
          confidence: 0.5,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          uiManifest: [],
          executionUnits: [{ id: 'EU-agentserver-literature', tool: 'sciforge.workspace-runtime-gateway', status: 'repair-needed' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...baseInput(),
      scenarioId: 'literature-evidence-review',
      agentName: 'Literature',
      agentDomain: 'literature',
      scenarioOverride: {
        title: '文献证据评估',
        description: '帮我检索arxiv上最新的agent相关论文，阅读并写一份调研报告',
        skillDomain: 'literature',
        scenarioMarkdown: '需要 paper-list、research-report、knowledge-graph。',
        defaultComponents: ['paper-card-list', 'report-viewer', 'evidence-matrix', 'execution-unit-table'],
        allowedComponents: ['paper-card-list', 'report-viewer', 'evidence-matrix', 'execution-unit-table'],
        fallbackComponent: 'unknown-artifact-inspector',
      },
      prompt: '帮我检索arxiv上最新的agent相关论文，阅读并写一份调研报告',
      scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
    });

    assert.deepEqual(requestBody?.availableSkills, ['agentserver.generate.literature']);
    assert.equal(requestBody?.agentBackend, 'codex');
    assert.equal(requestBody?.prompt, '帮我检索arxiv上最新的agent相关论文，阅读并写一份调研报告');
    const uiState = requestBody?.uiState as Record<string, unknown>;
    assert.equal(uiState.agentDispatchPolicy, 'agentserver-decides');
  });

  it('isolates stale session artifacts for fresh latest/arxiv retrieval requests', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message: 'fresh arxiv search started',
          confidence: 0.8,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          uiManifest: [],
          executionUnits: [{ id: 'EU-fresh', tool: 'sciforge.workspace-runtime-gateway', status: 'done' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...baseInput(),
      scenarioId: 'literature-evidence-review',
      agentName: 'Literature',
      agentDomain: 'literature',
      prompt: '帮我检索今天arxiv上最新的agent相关论文，并提供一个简要的总结报告',
      messages: [
        { id: 'msg-old-user', role: 'user', content: '阅读这篇单细胞 PDF', createdAt: '2026-05-01T00:00:00.000Z', status: 'completed' },
        { id: 'msg-old-system', role: 'scenario', content: '论文总结：mouse spermatogenesis', createdAt: '2026-05-01T00:01:00.000Z', status: 'completed' },
      ],
      artifacts: [{
        id: 'paper-list-old',
        type: 'paper-list',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
        dataRef: '.sciforge/artifacts/old-paper-list.json',
        data: { papers: [{ title: 'Single-cell RNA-seq uncovers dynamic processes in mouse spermatogenesis' }] },
      }],
      executionUnits: [{
        id: 'EU-old',
        tool: 'literature.old-pdf-reader',
        params: 'old-pdf',
        status: 'done',
        hash: 'oldhash',
        outputRef: '.sciforge/task-results/old/output.json',
      }],
      runs: [{
        id: 'run-old',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: '阅读上传的单细胞 PDF',
        response: 'mouse spermatogenesis summary',
        createdAt: '2026-05-01T00:00:00.000Z',
        completedAt: '2026-05-01T00:01:00.000Z',
      }],
      scenarioOverride: {
        title: '文献证据评估',
        description: '检索最新文献',
        skillDomain: 'literature',
        scenarioMarkdown: '需要 paper-list、research-report。',
        defaultComponents: ['paper-card-list', 'report-viewer', 'execution-unit-table'],
        allowedComponents: ['paper-card-list', 'report-viewer', 'execution-unit-table'],
        fallbackComponent: 'unknown-artifact-inspector',
      },
    });

    assert.deepEqual(requestBody?.artifacts, []);
    const uiState = requestBody?.uiState as Record<string, unknown>;
    assert.deepEqual(uiState.recentExecutionRefs, []);
    assert.deepEqual(uiState.recentRuns, []);
    assert.deepEqual(uiState.recentConversation, ['user: 帮我检索今天arxiv上最新的agent相关论文，并提供一个简要的总结报告']);
    assert.deepEqual(uiState.contextIsolation, { isolated: true, reason: 'fresh-retrieval-request' });
  });

  it('keeps explicit references even when the prompt looks like a fresh retrieval', () => {
    const policy = currentTurnContextPolicy({
      ...baseInput(),
      prompt: '检索最新相关论文并对比这份 PDF',
      references: [{ id: 'ref-pdf', kind: 'file', title: 'paper.pdf', ref: 'file:.sciforge/uploads/paper.pdf' }],
      artifacts: [{ id: 'upload-pdf', type: 'uploaded-pdf', producerScenario: 'literature-evidence-review', schemaVersion: '1' }],
    });

    assert.deepEqual(policy, { isolated: false, reason: 'explicit-user-reference' });
  });

  it('passes scenario artifact hints into the AgentServer contract without prompt keyword routing', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message: 'agentserver generation requested',
          confidence: 0.5,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          uiManifest: [],
          executionUnits: [{ id: 'EU-agentserver-literature', tool: 'sciforge.workspace-runtime-gateway', status: 'repair-needed' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...baseInput(),
      scenarioId: 'literature-evidence-review',
      agentName: 'Literature',
      agentDomain: 'literature',
      scenarioOverride: {
        title: '文献证据评估',
        description: '离线证据矩阵 smoke',
        skillDomain: 'literature',
        scenarioMarkdown: '需要 paper-list、evidence-matrix、notebook-timeline、research-report。',
        defaultComponents: ['paper-card-list', 'evidence-matrix', 'notebook-timeline', 'report-viewer', 'execution-unit-table'],
        allowedComponents: ['paper-card-list', 'evidence-matrix', 'notebook-timeline', 'report-viewer', 'execution-unit-table'],
        fallbackComponent: 'unknown-artifact-inspector',
      },
      prompt: '请基于 mini-corpus 生成 paper-list、evidence-matrix、notebook-timeline、research-report。',
    });

    assert.deepEqual(requestBody?.expectedArtifactTypes, ['paper-list', 'evidence-matrix', 'notebook-timeline', 'research-report']);
    const uiState = requestBody?.uiState as Record<string, unknown>;
    assert.deepEqual(uiState.expectedArtifactTypes, ['paper-list', 'evidence-matrix', 'notebook-timeline', 'research-report']);
    assert.deepEqual(uiState.scopeCheck, {
      source: 'structured-scenario-hint',
      decisionOwner: 'AgentServer',
      note: 'SciForge does not route or reject current-turn intent by keyword; AgentServer decides from rawUserPrompt and context.',
    });
  });

  it('does not mark repair-needed backend results as completed', async () => {
    const events: string[] = [];
    globalThis.fetch = (async () => new Response(JSON.stringify({
      ok: true,
      result: {
        message: 'SciForge runtime gateway needs repair before the report can be delivered.',
        confidence: 0.2,
        claimType: 'fact',
        evidenceLevel: 'runtime',
        uiManifest: [],
        executionUnits: [{
          id: 'EU-agentserver-literature',
          tool: 'sciforge.workspace-runtime-gateway',
          status: 'repair-needed',
          failureReason: 'AgentServer returned taskFiles path-only reference but SciForge could not read workspace file.',
        }],
        artifacts: [{
          id: 'research-report',
          type: 'research-report',
          schemaVersion: '1',
          metadata: {
            status: 'repair-needed',
            failureReason: 'Report was not produced.',
          },
          data: {},
        }],
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

    const response = await sendSciForgeToolMessage({
      ...baseInput(),
      scenarioId: 'literature-evidence-review',
      agentName: 'Literature',
      agentDomain: 'literature',
      scenarioOverride: {
        title: '文献证据评估',
        description: '帮我检索arxiv上最新的agent相关论文，下载、阅读全文，并撰写总结报告',
        skillDomain: 'literature',
        scenarioMarkdown: '需要 paper-list、research-report。',
        defaultComponents: ['paper-card-list', 'report-viewer', 'execution-unit-table'],
        allowedComponents: ['paper-card-list', 'report-viewer', 'execution-unit-table'],
        fallbackComponent: 'unknown-artifact-inspector',
      },
      prompt: '帮我检索今天arxiv上最新的agent相关论文，下载、阅读全文，并撰写总结报告',
    }, {
      onEvent: (event) => {
        if (event.type === 'project-tool-done') events.push(String(event.detail || ''));
      },
    });

    assert.equal(response.run.status, 'failed');
    assert.equal(response.message.status, 'failed');
    assert.match(response.message.content, /needs repair|未完成|repair/i);
    assert.match(events.at(-1) || '', /未完成|repair-needed|failed-with-reason/);
    assert.equal(response.executionUnits[0]?.status, 'repair-needed');
  });

  it('does not fail context answers that mention a prior repair-needed state', async () => {
    const events: string[] = [];
    globalThis.fetch = (async () => new Response(JSON.stringify({
      ok: true,
      result: {
        message: '上一轮进入 repair-needed，因为 AgentServer 返回了 path-only taskFiles；本轮已基于已有 paper-list 完成摘要。',
        confidence: 0.92,
        claimType: 'context-summary',
        evidenceLevel: 'agentserver-context',
        uiManifest: [{ componentId: 'report-viewer', artifactRef: 'research-report', priority: 1 }],
        executionUnits: [{
          id: 'agentserver-direct-context',
          tool: 'agentserver.direct-text',
          status: 'done',
        }],
        artifacts: [{
          id: 'research-report',
          type: 'research-report',
          schemaVersion: '1',
          data: { markdown: '上一轮进入 repair-needed；本轮已完成上下文摘要。' },
        }],
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

    const response = await sendSciForgeToolMessage({
      ...baseInput(),
      scenarioId: 'literature-evidence-review',
      agentName: 'Literature',
      agentDomain: 'literature',
      scenarioOverride: {
        title: '文献证据评估',
        description: '基于已有文献证据回答追问',
        skillDomain: 'literature',
        scenarioMarkdown: '需要 paper-list、research-report。',
        defaultComponents: ['paper-card-list', 'report-viewer', 'execution-unit-table'],
        allowedComponents: ['paper-card-list', 'report-viewer', 'execution-unit-table'],
        fallbackComponent: 'unknown-artifact-inspector',
      },
      prompt: '不要生成新脚本，也不要检索新论文。请只解释上一轮为什么 repair-needed，并总结已有证据。',
    }, {
      onEvent: (event) => {
        if (event.type === 'project-tool-done') events.push(String(event.detail || ''));
      },
    });

    assert.equal(response.run.status, 'completed');
    assert.equal(response.message.status, 'completed');
    assert.doesNotMatch(events.at(-1) || '', /未完成/);
    assert.match(response.message.content, /repair-needed/);
  });

  it('keeps provider usage separate from explicit context-window telemetry in streams', async () => {
    const events: Array<Record<string, any>> = [];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        [
          {
            event: {
              type: 'usage-update',
              usage: { input: 178_700, output: 2_318, total: 181_018, provider: 'codex' },
            },
          },
          {
            event: {
              type: 'contextWindowState',
              usage: { inputTokens: 178_700, outputTokens: 2_318, total: 181_018, provider: 'codex' },
              source: 'model-provider',
              message: 'provider usage only; not a backend context-window state',
            },
          },
          {
            event: {
              type: 'contextWindowState',
              contextWindowState: {
                usedTokens: 20_000,
                windowTokens: 200_000,
                source: 'native',
                backend: 'codex',
              },
            },
          },
          {
            result: {
              message: 'done',
              confidence: 0.9,
              claimType: 'fact',
              evidenceLevel: 'runtime',
              uiManifest: [],
              executionUnits: [{ id: 'EU-stream', tool: 'sciforge.workspace-runtime-gateway', status: 'done' }],
              artifacts: [],
            },
          },
        ].forEach((line) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`)));
        controller.close();
      },
    });
    globalThis.fetch = (async () => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    })) as typeof fetch;

    await sendSciForgeToolMessage(baseInput(), {
      onEvent: (event) => {
        events.push(event as Record<string, any>);
      },
    });

    const usageEvent = events.find((event) => event.type === 'usage-update');
    const usageOnlyContextEvent = events.find((event) => event.type === 'contextWindowState' && /provider usage only/.test(String(event.detail || '')));
    const contextEvent = events.find((event) => event.type === 'contextWindowState' && event.contextWindowState);
    assert.equal(usageEvent?.usage?.total, 181_018);
    assert.equal(usageEvent?.contextWindowState, undefined);
    assert.equal(usageOnlyContextEvent?.usage?.total, 181_018);
    assert.equal(usageOnlyContextEvent?.contextWindowState, undefined);
    assert.equal(contextEvent?.contextWindowState?.usedTokens, 20_000);
    assert.equal(contextEvent?.contextWindowState?.windowTokens, 200_000);
  });

  it('does not treat "do not use package skill" repair prompts as local skill requests', async () => {
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
          executionUnits: [{ id: 'EU-literature', tool: 'sciforge.workspace-runtime-gateway', status: 'repair-needed' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...baseInput(),
      scenarioId: 'literature-evidence-review',
      agentName: 'Literature',
      agentDomain: 'literature',
      scenarioOverride: {
        title: 'T059 literature',
        description: 'external API failure repair loop',
        skillDomain: 'literature',
        scenarioMarkdown: '必须由 SciForge/AgentServer 自己生成 workspace-local task。',
        defaultComponents: ['paper-card-list', 'evidence-matrix', 'execution-unit-table'],
        allowedComponents: ['paper-card-list', 'evidence-matrix', 'execution-unit-table'],
        fallbackComponent: 'unknown-artifact-inspector',
      },
      prompt: 'T059 literature Round 1：不要使用 literature.pubmed_search package skill；请由 SciForge/AgentServer 自己生成 workspace-local task，故意制造 external API failure，失败时显示 failureReason、stdoutRef/stderrRef 和 ExecutionUnit。',
      scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
    });

    assert.deepEqual(requestBody?.availableSkills, ['agentserver.generate.literature']);
    const uiState = requestBody?.uiState as Record<string, unknown>;
    assert.equal(uiState.agentDispatchPolicy, 'agentserver-decides');
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
          executionUnits: [{ id: 'EU-omics', tool: 'sciforge.workspace-runtime-gateway', status: 'repair-needed' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
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
      prompt: 'T059 omics：只能由 SciForge/AgentServer 自己生成 workspace-local task。',
    });

    assert.equal(requestBody?.scenarioId, 'omics-differential-exploration');
    assert.equal(requestBody?.skillDomain, 'omics');
    assert.deepEqual(requestBody?.availableSkills, ['agentserver.generate.omics']);
    assert.deepEqual(requestBody?.scenarioPackageRef, { id: 'omics-differential-exploration', version: '1.0.0', source: 'built-in' });
    const uiState = requestBody?.uiState as Record<string, unknown>;
    assert.equal(uiState.agentDispatchPolicy, 'agentserver-decides');
  });

  it('forwards Scenario Builder selected skills and tools to the workspace runtime', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message: 'ok',
          confidence: 0.8,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          uiManifest: [],
          executionUnits: [],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...baseInput(),
      scenarioId: 'literature-evidence-review',
      agentName: 'Literature',
      agentDomain: 'literature',
      scenarioOverride: {
        title: 'Builder-selected tooling',
        description: 'Use selected capabilities when they fit.',
        skillDomain: 'literature',
        scenarioMarkdown: 'Prefer selected tools over self-contained code when appropriate.',
        defaultComponents: ['report-viewer', 'evidence-matrix'],
        allowedComponents: ['report-viewer', 'evidence-matrix'],
        fallbackComponent: 'unknown-artifact-inspector',
        selectedSkillIds: ['scp.biomedical-web-search'],
        selectedToolIds: ['clawhub.playwright-mcp'],
      },
      prompt: '检索并总结最新 agent 论文。',
    });

    assert.deepEqual(requestBody?.availableSkills, ['scp.biomedical-web-search', 'agentserver.generate.literature']);
    assert.deepEqual(requestBody?.selectedToolIds, ['clawhub.playwright-mcp']);
    const uiState = requestBody?.uiState as Record<string, unknown>;
    assert.deepEqual(uiState.selectedSkillIds, ['scp.biomedical-web-search', 'agentserver.generate.literature']);
    assert.deepEqual(uiState.selectedToolIds, ['clawhub.playwright-mcp']);
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
          executionUnits: [{ id: 'EU-structure', tool: 'sciforge.workspace-runtime-gateway', status: 'repair-needed' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
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

  it('passes generic workspace refs and full recent context for continuation questions', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message: 'storage refs answered',
          confidence: 0.8,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          uiManifest: [],
          executionUnits: [{ id: 'EU-storage', tool: 'sciforge.workspace-runtime-gateway', status: 'done' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...baseInput(),
      sessionId: 'session-alpha',
      messages: [
        { id: 'u1', role: 'user', content: '生成一个结果文件并写报告', createdAt: '2026-04-26T00:00:00.000Z', status: 'completed' },
        { id: 'a1', role: 'scenario', content: '已生成报告和数据表。', createdAt: '2026-04-26T00:00:10.000Z', status: 'completed' },
      ],
      runs: [{
        id: 'run-alpha',
        scenarioId: 'workspace-structure-exploration-t055-test',
        status: 'completed',
        prompt: '生成一个结果文件并写报告',
        response: '已生成报告和数据表。',
        createdAt: '2026-04-26T00:00:00.000Z',
        completedAt: '2026-04-26T00:00:10.000Z',
      }],
      artifacts: [{
        id: 'generic-result',
        type: 'runtime-artifact',
        producerScenario: 'workspace-structure-exploration-t055-test',
        schemaVersion: '1',
        dataRef: '.sciforge/task-results/run-alpha.json',
        metadata: { outputRef: '.sciforge/task-results/run-alpha.json' },
        data: {
          files: [{ name: 'result.csv', localPath: '.sciforge/outputs/result.csv' }],
          markdown: 'Report text',
        },
      }],
      executionUnits: [{
        id: 'EU-alpha',
        tool: 'generated.workspace-task',
        params: 'n/a',
        status: 'done',
        hash: 'hash',
        codeRef: '.sciforge/tasks/generated-alpha/main.py',
        outputRef: '.sciforge/task-results/run-alpha.json',
        stdoutRef: '.sciforge/logs/run-alpha.stdout.log',
        stderrRef: '.sciforge/logs/run-alpha.stderr.log',
      }],
      prompt: '这些产物存在哪里？',
    });

    const uiState = requestBody?.uiState as Record<string, unknown>;
    assert.deepEqual(uiState.recentConversation, [
      'user: 生成一个结果文件并写报告',
      'scenario: 已生成报告和数据表。',
      'user: 这些产物存在哪里？',
    ]);
    assert.deepEqual((uiState.workspacePersistence as Record<string, unknown>).sessionRef, '.sciforge/sessions/session-alpha.json');
    const artifacts = requestBody?.artifacts as Array<Record<string, unknown>>;
    assert.equal(artifacts[0].workspaceArtifactRef, '.sciforge/artifacts/session-alpha-generic-result.json');
    assert.deepEqual(artifacts[0].fileRefs, ['.sciforge/task-results/run-alpha.json', '.sciforge/outputs/result.csv']);
    const accessPolicy = uiState.artifactAccessPolicy as Record<string, unknown>;
    assert.equal(accessPolicy.mode, 'refs-first-bounded-read');
    assert.match(String(accessPolicy.defaultAction), /metadata/);
    assert.deepEqual(accessPolicy.reusableArtifactRefs, [
      'artifact:generic-result',
      'file:.sciforge/task-results/run-alpha.json',
      'file:.sciforge/outputs/result.csv',
    ]);
    const agentContext = uiState.agentContext as Record<string, unknown>;
    assert.deepEqual(agentContext.artifactAccessPolicy, accessPolicy);
  });

  it('compacts long chat history before sending workspace runtime context', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message: 'compact context answered',
          confidence: 0.8,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          uiManifest: [],
          executionUnits: [{ id: 'EU-compact-context', tool: 'sciforge.workspace-runtime-gateway', status: 'done' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const longAnswer = `开头 ${'token-heavy-content '.repeat(200)} 结尾`;
    await sendSciForgeToolMessage({
      ...baseInput(),
      sessionId: 'session-compact-history',
      messages: [
        { id: 'u1', role: 'user', content: '读取上传的 PDF 并做摘要', createdAt: '2026-04-26T00:00:00.000Z', status: 'completed' },
        { id: 'a1', role: 'scenario', content: longAnswer, createdAt: '2026-04-26T00:00:10.000Z', status: 'completed' },
      ],
      artifacts: [{
        id: 'prior-report',
        type: 'research-report',
        producerScenario: 'workspace-structure-exploration-t055-test',
        schemaVersion: '1',
        dataRef: '.sciforge/artifacts/prior-report.json',
        metadata: { outputRef: '.sciforge/task-results/prior.json' },
        data: { markdown: longAnswer },
      }],
      prompt: '继续，只补充局限性。',
    });

    const uiState = requestBody?.uiState as Record<string, unknown>;
    const recentConversation = uiState.recentConversation as string[];
    assert.equal(recentConversation.length, 3);
    assert.match(recentConversation[1], /\[.*chars omitted\]/);
    assert.ok(recentConversation[1].length < 1300);
    const agentContext = uiState.agentContext as Record<string, unknown>;
    assert.deepEqual(agentContext.recentConversation, recentConversation);
    const scenario = agentContext.scenario as Record<string, unknown>;
    assert.equal(typeof scenario.markdownPreview, 'string');
    assert.equal(typeof scenario.markdownChars, 'number');
    assert.equal('markdown' in scenario, false);
  });

  it('keeps a stable 12+ turn ledger and prefers latest artifacts for continuation context', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message: 'multi-turn context answered',
          confidence: 0.8,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          uiManifest: [],
          executionUnits: [{ id: 'EU-multi-turn-context', tool: 'sciforge.workspace-runtime-gateway', status: 'done' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const messages = Array.from({ length: 22 }, (_, index) => ({
      id: `msg-${index + 1}`,
      role: index % 2 === 0 ? 'user' as const : 'scenario' as const,
      content: `Round ${index + 1}: ${index % 2 === 0 ? '用户提出复杂约束' : '系统回答并生成 workspace refs'}，保持追加顺序。`,
      createdAt: `2026-05-03T00:${String(index).padStart(2, '0')}:00.000Z`,
      status: 'completed' as const,
    }));
    const artifacts = Array.from({ length: 10 }, (_, index) => ({
      id: `artifact-${index + 1}`,
      type: 'runtime-artifact',
      producerScenario: 'generic-multi-turn-test',
      schemaVersion: '1',
      dataRef: `.sciforge/artifacts/artifact-${index + 1}.json`,
      metadata: { runId: `run-${index + 1}` },
      data: { markdown: `artifact ${index + 1}` },
    }));
    const executionUnits = Array.from({ length: 10 }, (_, index) => ({
      id: `EU-${index + 1}`,
      tool: 'generated.workspace-task',
      params: '{}',
      status: 'done' as const,
      hash: `hash-${index + 1}`,
      outputRef: `.sciforge/task-results/run-${index + 1}.json`,
    }));

    await sendSciForgeToolMessage({
      ...baseInput(),
      sessionId: 'session-multi-turn-ledger',
      messages,
      artifacts,
      executionUnits,
      prompt: '继续第 23 轮：只基于已有上下文和最新 workspace refs 继续分析，不要重新理解整个任务背景。',
    });

    const uiState = requestBody?.uiState as Record<string, unknown>;
    const recentConversation = uiState.recentConversation as string[];
    assert.equal(recentConversation.length, 17);
    assert.match(recentConversation[0], /Round 7:/);
    assert.match(recentConversation.at(-1) ?? '', /第 23 轮/);
    const ledger = uiState.conversationLedger as Array<Record<string, unknown>>;
    assert.equal(ledger.length, 22);
    assert.equal(ledger[0].id, 'msg-1');
    assert.equal(ledger.at(-1)?.id, 'msg-22');
    assert.equal(typeof ledger[0].contentDigest, 'string');
    const reusePolicy = uiState.contextReusePolicy as Record<string, unknown>;
    assert.equal(reusePolicy.mode, 'stable-ledger-plus-recent-window');
    const accessPolicy = uiState.artifactAccessPolicy as Record<string, unknown>;
    assert.equal(accessPolicy.mode, 'refs-first-bounded-read');
    assert.match(JSON.stringify(accessPolicy), /bounded reads/i);

    const requestArtifacts = requestBody?.artifacts as Array<Record<string, unknown>>;
    assert.deepEqual(requestArtifacts.map((artifact) => artifact.id), [
      'artifact-3', 'artifact-4', 'artifact-5', 'artifact-6',
      'artifact-7', 'artifact-8', 'artifact-9', 'artifact-10',
    ]);
    const recentExecutionRefs = uiState.recentExecutionRefs as Array<Record<string, unknown>>;
    assert.deepEqual(recentExecutionRefs.map((unit) => unit.id), [
      'EU-3', 'EU-4', 'EU-5', 'EU-6', 'EU-7', 'EU-8', 'EU-9', 'EU-10',
    ]);
    const agentContext = uiState.agentContext as Record<string, unknown>;
    assert.deepEqual(agentContext.conversationLedger, ledger);
    assert.deepEqual(agentContext.contextReusePolicy, reusePolicy);
  });

  it('passes explicit chat references to workspace runtime context', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message: 'referenced context used',
          confidence: 0.8,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          uiManifest: [],
          executionUnits: [{ id: 'EU-reference', tool: 'sciforge.workspace-runtime-gateway', status: 'done' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await sendSciForgeToolMessage({
      ...baseInput(),
      messages: [{
        id: 'msg-source',
        role: 'scenario',
        content: '上一轮结论：volcano plot 中 ABC1 显著上调。',
        createdAt: '2026-04-26T00:00:00.000Z',
        status: 'completed',
      }],
      references: [{
        id: 'ref-message-msg-source',
        kind: 'message',
        title: 'Agent · 上一轮结论',
        ref: 'message:msg-source',
        sourceId: 'msg-source',
        summary: '上一轮结论：volcano plot 中 ABC1 显著上调。',
        payload: {
          role: 'scenario',
          content: '上一轮结论：volcano plot 中 ABC1 显著上调。',
          createdAt: '2026-04-26T00:00:00.000Z',
        },
      }, {
        id: 'ref-chart-volcano',
        kind: 'chart',
        title: 'volcano plot',
        ref: 'artifact:volcano-plot',
        sourceId: 'volcano-plot',
        runId: 'run-volcano',
        summary: 'differential-expression chart',
      }],
      prompt: '基于引用对象继续解释。',
    });

    const references = requestBody?.references as Array<Record<string, unknown>>;
    assert.equal(references.length, 2);
    assert.equal(references[0].ref, 'message:msg-source');
    assert.equal(references[1].kind, 'chart');
    const uiState = requestBody?.uiState as Record<string, unknown>;
    assert.deepEqual(uiState.currentReferences, references);
    const agentContext = uiState.agentContext as Record<string, unknown>;
    assert.deepEqual(agentContext.currentReferences, references);
  });

  it('keeps composer markers concise while preserving selected reference payload', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message: 'selected text reference used',
          confidence: 0.8,
          claimType: 'fact',
          evidenceLevel: 'runtime',
          uiManifest: [],
          executionUnits: [{ id: 'EU-selected-reference', tool: 'sciforge.workspace-runtime-gateway', status: 'done' }],
          artifacts: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const selectedText = 'low sample size weakens the conclusion and must be treated as a limitation';
    await sendSciForgeToolMessage({
      ...baseInput(),
      prompt: '※1 这个限制会不会推翻结论？',
      references: [{
        id: 'ref-text-limitation',
        kind: 'ui',
        title: '选中文本 · low sample size',
        ref: 'ui-text:message:msg-limitation#abc',
        sourceId: 'msg-limitation',
        summary: selectedText,
        locator: { textRange: selectedText.slice(0, 32), region: 'message:msg-limitation' },
        payload: {
          composerMarker: '※1',
          selectedText,
          sourceRef: 'message:msg-limitation',
          sourceKind: 'message',
        },
      }],
    });

    assert.equal(requestBody?.prompt, '※1 这个限制会不会推翻结论？');
    assert.doesNotMatch(String(requestBody?.prompt), /low sample size weakens/);
    const references = requestBody?.references as Array<Record<string, unknown>>;
    assert.equal(references[0].ref, 'ui-text:message:msg-limitation#abc');
    assert.equal((references[0].payload as Record<string, unknown>).composerMarker, '※1');
    assert.equal((references[0].payload as Record<string, unknown>).sourceRef, 'message:msg-limitation');
    assert.equal((references[0].payload as Record<string, unknown>).selectedText, selectedText);
    const uiState = requestBody?.uiState as Record<string, unknown>;
    const agentContext = uiState.agentContext as Record<string, unknown>;
    assert.deepEqual(agentContext.currentReferences, references);
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
      workspacePath: '/tmp/sciforge-test-workspace',
      agentBackend: 'codex',
      modelProvider: 'native',
      modelBaseUrl: '',
      modelName: '',
      apiKey: '',
      requestTimeoutMs: 300000,
      maxContextWindowTokens: 200000,
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
