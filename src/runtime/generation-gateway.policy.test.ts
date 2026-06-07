import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  GATEWAY_PIPELINE_STAGE_ORDER,
  GATEWAY_PIPELINE_STAGES,
  STAGE_ARTIFACT_MUTATION_FAST_PATH,
  STAGE_BROWSER_COMPUTER_USE_CAPABILITY_TRUTH,
  STAGE_CAPABILITY_PROVIDER_PREFLIGHT,
  STAGE_CODEX_RUNTIME_BRIDGE,
  STAGE_CONVERSATION_POLICY,
  STAGE_DIRECT_CONTEXT_FAST_PATH,
  STAGE_LOCAL_CODE_DEBUG_RUNTIME,
  STAGE_LOCAL_DATA_SENSITIVITY_RUNTIME,
  STAGE_LOCAL_METHODOLOGY_FINALIZER_RUNTIME,
  STAGE_LOCAL_REPRODUCIBLE_METHOD_RUNTIME,
  STAGE_LOCAL_TABULAR_ANALYSIS_RUNTIME,
  STAGE_PLAYWRIGHT_EDGE_BROWSER_RUNTIME,
  STAGE_REQUEST_CLARIFICATION_RUNTIME,
  STAGE_REQUEST_ENRICHMENT,
  STAGE_RUNTIME_EXECUTION_CONSTRAINTS,
  STAGE_RUNTIME_UNHANDLED,
  STAGE_VISION_SENSE_RUNTIME,
  runWorkspaceRuntimeGateway,
} from './generation-gateway.js';

test('default gateway pipeline does not expose legacy BrowserHostSearch as a product stage', () => {
  assert.equal(GATEWAY_PIPELINE_STAGE_ORDER.includes('browser-host-search-runtime' as any), false);
  assert.equal(GATEWAY_PIPELINE_STAGES.some((stage) => stage.name === ('browser-host-search-runtime' as any)), false);
  assert.equal(GATEWAY_PIPELINE_STAGE_ORDER.includes('agentserver-generation' as any), false);
  assert.equal(GATEWAY_PIPELINE_STAGES.some((stage) => stage.name === ('agentserver-generation' as any)), false);
  assert.equal(GATEWAY_PIPELINE_STAGE_ORDER.includes('agentserver-dispatch-constraints' as any), false);
  assert.equal(GATEWAY_PIPELINE_STAGES.some((stage) => stage.name === ('agentserver-dispatch-constraints' as any)), false);
  assert.ok(GATEWAY_PIPELINE_STAGE_ORDER.indexOf(STAGE_CODEX_RUNTIME_BRIDGE) > GATEWAY_PIPELINE_STAGE_ORDER.indexOf(STAGE_RUNTIME_EXECUTION_CONSTRAINTS));
});

test('default terminal gateway fails closed instead of falling back to AgentServer generation', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-quarantine-'));
  const originalPolicy = process.env.SCIFORGE_CONVERSATION_POLICY_MODE;
  const originalLegacy = process.env.SCIFORGE_LEGACY_AGENTSERVER_DEFAULT_DISPATCH;
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';
  delete process.env.SCIFORGE_LEGACY_AGENTSERVER_DEFAULT_DISPATCH;
  const events: any[] = [];
  try {
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Use a general agent to draft a concise answer without local files.',
      workspacePath: workspace,
      artifacts: [],
      references: [],
    }, {
      onEvent(event) {
        events.push(event);
      },
    });

    assert.equal(payload.artifacts[0]?.id, 'runtime-unhandled');
    assert.match(payload.message, /Runtime Codex|没有回落到旧 AgentServer generation/i);
    assert.doesNotMatch(JSON.stringify(payload), /agentServerRunId|agentserver-generation-literature/i);
    const stageAudits = events.filter((event) => event.type === 'gateway-pipeline-stage-audit');
    assert.ok(stageAudits.some((event) => event.raw.stage === STAGE_RUNTIME_UNHANDLED && event.raw.shortCircuit === true));
    assert.equal(stageAudits.some((event) => /agentserver/i.test(String(event.raw.stage))), false);
  } finally {
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', originalPolicy);
    restoreEnv('SCIFORGE_LEGACY_AGENTSERVER_DEFAULT_DISPATCH', originalLegacy);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runtime gateway fails closed before AgentServer when conversation policy fails without turn constraints', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-policy-fail-closed-'));
  const original = {
    mode: process.env.SCIFORGE_CONVERSATION_POLICY_MODE,
    command: process.env.SCIFORGE_CONVERSATION_POLICY_PYTHON,
  };
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'active';
  process.env.SCIFORGE_CONVERSATION_POLICY_PYTHON = '/usr/bin/false';
  try {
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Summarize current context from available refs.',
      workspacePath: workspace,
      artifacts: [],
      references: [{ ref: 'artifact:prior-report', title: 'Prior report' }],
    });

    assert.equal(payload.artifacts[0]?.id, 'runtime-execution-forbidden');
    assert.equal(payload.executionUnits[0]?.tool, 'sciforge.conversation-policy');
    assert.match(payload.message, /fail-closed|没有启动新的 runtime/);
    assert.doesNotMatch(JSON.stringify(payload), /agentserver\.generate/);
    const displayIntent = payload.displayIntent as Record<string, any>;
    assert.equal(displayIntent.conversationProjection?.schemaVersion, 'sciforge.conversation-projection.v1');
    assert.equal(displayIntent.conversationProjection?.visibleAnswer?.status, 'degraded-result');
    assert.match(String(displayIntent.conversationProjection?.visibleAnswer?.text), /fail-closed|runtime/i);
    assert.equal(displayIntent.taskOutcomeProjection?.conversationEventLog?.schemaVersion, 'sciforge.conversation-event-log.v1');
  } finally {
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original.mode);
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_PYTHON', original.command);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('stateless fresh policy timeout no longer falls through to AgentServer generation', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-policy-fresh-fallback-'));
  const original = {
    mode: process.env.SCIFORGE_CONVERSATION_POLICY_MODE,
    command: process.env.SCIFORGE_CONVERSATION_POLICY_PYTHON,
  };
  let sawGeneration = false;
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { session: { id: 'fresh-policy-fallback', status: 'active' }, recentTurns: [], currentWorkEntries: [] } }));
      return;
    }
    if (req.method !== 'POST' || String(req.url) !== '/api/agent-server/runs/stream') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    sawGeneration = true;
    const result = {
      ok: true,
      data: {
        run: {
          id: 'mock-fresh-policy-fallback',
          status: 'completed',
          output: {
            result: {
              message: 'Primer design needs GC and specificity checks to keep binding stable and avoid off-target amplification.',
              confidence: 0.88,
              claimType: 'fact',
              evidenceLevel: 'runtime',
              reasoningTrace: 'Stateless fresh fallback used AgentServer generation after policy timeout without prior context reuse.',
              claims: [],
              uiManifest: [],
              executionUnits: [{ id: 'agentserver-fresh-answer', tool: 'agentserver.generation', status: 'done' }],
              artifacts: [],
            },
          },
        },
      },
    };
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(`${JSON.stringify({ result })}\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'active';
    process.env.SCIFORGE_CONVERSATION_POLICY_PYTHON = '/usr/bin/false';
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Give three concise points about why primer design checks GC content and specificity. Do not retrieve or run code.',
      workspacePath: workspace,
      agentServerBaseUrl: `http://127.0.0.1:${address.port}`,
      artifacts: [],
      references: [],
      uiState: {
        contextReusePolicy: { mode: 'fresh', historyReuse: { allowed: false } },
        sessionMessages: [{ id: 'msg-user', role: 'user', content: 'fresh stateless question' }],
      },
    });

    assert.equal(sawGeneration, false);
    assert.equal(payload.artifacts[0]?.id, 'runtime-unhandled');
    assert.match(payload.message, /Runtime Codex|没有回落到旧 AgentServer generation/i);
    assert.equal(payload.executionUnits[0]?.status, 'needs-human');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original.mode);
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_PYTHON', original.command);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('forced AgentServer generation is ignored by the retired default path', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-forbidden-'));
  const original = process.env.SCIFORGE_CONVERSATION_POLICY_MODE;
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';
  try {
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Use existing current refs only.',
      workspacePath: workspace,
      artifacts: [],
      references: [{ ref: 'artifact:prior-report', title: 'Prior report' }],
      uiState: {
        forceAgentServerGeneration: true,
        turnExecutionConstraints: {
          schemaVersion: 'sciforge.turn-execution-constraints.v1',
          policyId: 'sciforge.current-turn-execution-constraints.v1',
          source: 'runtime-contract.turn-constraints',
          contextOnly: true,
          agentServerForbidden: true,
          workspaceExecutionForbidden: false,
          externalIoForbidden: false,
          codeExecutionForbidden: false,
          reasons: ['AgentServer dispatch is forbidden by structured current-turn constraints.'],
          evidence: { hasPriorContext: true, referenceCount: 1 },
        },
      },
    });

    assert.equal(payload.artifacts[0]?.id, 'runtime-unhandled');
    assert.equal(payload.executionUnits[0]?.tool, 'sciforge.runtime-codex');
    assert.match(payload.message, /没有回落到旧 AgentServer generation|Runtime Codex/i);
    const displayIntent = payload.displayIntent as Record<string, any>;
    assert.equal(displayIntent.conversationProjection?.schemaVersion, 'sciforge.conversation-projection.v1');
    assert.equal(displayIntent.conversationProjection?.visibleAnswer?.status, 'degraded-result');
    assert.match(String(displayIntent.conversationProjection?.visibleAnswer?.text), /Runtime Codex|runtime/i);
    assert.equal(displayIntent.taskOutcomeProjection?.conversationEventLog?.schemaVersion, 'sciforge.conversation-event-log.v1');
  } finally {
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('provider preflight blocks before sense or backend dispatch for explicit provider tasks', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-provider-preflight-first-'));
  const original = process.env.SCIFORGE_CONVERSATION_POLICY_MODE;
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';
  try {
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Require web_search provider route for recent papers; do not run backend network code.',
      workspacePath: workspace,
      selectedToolIds: ['web_search', 'local.vision-sense'],
      artifacts: [],
      references: [],
      uiState: {
        selectedToolIds: ['web_search', 'local.vision-sense'],
      },
    });

    assert.match(payload.message, /Capability provider route preflight blocked runtime dispatch|Capability provider route preflight blocked/i);
    assert.equal(payload.executionUnits[0]?.tool, 'sciforge.capability-provider-preflight');
    assert.equal(payload.executionUnits[0]?.status, 'needs-human');
    assert.match(JSON.stringify(payload), /capability-provider-preflight/);
    assert.doesNotMatch(JSON.stringify(payload), /vision-sense-observation|agentserver-response/);
    const displayIntent = payload.displayIntent as Record<string, any>;
    assert.equal(displayIntent.conversationProjection?.schemaVersion, 'sciforge.conversation-projection.v1');
  } finally {
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use vision runtime bypasses prompt-derived browser provider preflight', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-computer-use-provider-prompt-bypass-'));
  const original = process.env.SCIFORGE_CONVERSATION_POLICY_MODE;
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';
  const events: any[] = [];
  try {
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'knowledge',
      prompt: '/computer-use run open Browser, download a safe local PDF, then use generic mouse/keyboard to show the downloaded file in Finder.',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
      references: [],
      uiState: {
        selectedToolIds: ['local.vision-sense'],
        visionSenseConfig: {
          desktopBridgeEnabled: false,
          dryRun: true,
        },
      },
    }, {
      onEvent(event) {
        events.push(event);
      },
    });

    assert.match(payload.message, /generic Computer Use bridge is not ready/);
    assert.equal(payload.executionUnits[0]?.tool, 'local.vision-sense');
    assert.doesNotMatch(JSON.stringify(payload), /capability-provider-preflight|browser_fetch|browser_search/);
    const stageAudits = events.filter((event) => event.type === 'gateway-pipeline-stage-audit');
    assert.equal(stageAudits.some((event) => event.raw.stage === STAGE_CAPABILITY_PROVIDER_PREFLIGHT && event.raw.shortCircuit === true), false);
    assert.ok(stageAudits.some((event) => event.raw.stage === STAGE_VISION_SENSE_RUNTIME && event.raw.shortCircuit === true));
  } finally {
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runtime gateway answers Computer Use capability questions from grounded readiness without fixed denial text', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-capability-answer-'));
  const original = process.env.SCIFORGE_CONVERSATION_POLICY_MODE;
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';
  const events: any[] = [];
  try {
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'knowledge',
      prompt: '你有 computer use 能力么？',
      workspacePath: workspace,
      artifacts: [],
      references: [],
      uiState: {
        runtimeReadiness: {
          readiness: {
            browserHostSession: 'ready',
            nativeBridge: 'blocked',
            nativeSurface: 'blocked',
            windowActionSession: 'ready',
            computerUseAdapter: 'ready',
          },
          refs: ['runtime-health:computer-use'],
        },
      },
    }, {
      onEvent(event) {
        events.push(event);
      },
    });

    assert.match(payload.message, /Computer Use product capability is supported/i);
    assert.match(payload.message, /native-bridge-unavailable/);
    assert.doesNotMatch(payload.message, /没有直接|no direct computer use/i);
    assert.equal(payload.artifacts[0]?.type, 'runtime-capability-answer');
    const stageAudits = events.filter((event) => event.type === 'gateway-pipeline-stage-audit');
    assert.ok(stageAudits.some((event) => event.raw.stage === STAGE_BROWSER_COMPUTER_USE_CAPABILITY_TRUTH && event.raw.shortCircuit === true));
    assert.equal(stageAudits.some((event) => /agentserver/i.test(String(event.raw.stage))), false);
  } finally {
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runtime gateway sends GUI operation intent to Computer Use preflight and fails closed on missing native readiness', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-default-cu-preflight-'));
  const original = process.env.SCIFORGE_CONVERSATION_POLICY_MODE;
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';
  try {
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'knowledge',
      prompt: 'Click the visible export button in the current window.',
      workspacePath: workspace,
      artifacts: [],
      references: [],
      uiState: {
        runtimeReadiness: {
          readiness: {
            browserHostSession: 'ready',
            nativeBridge: 'ready',
            nativeSurface: 'blocked',
            windowActionSession: 'ready',
            computerUseAdapter: 'ready',
          },
        },
        computerUseTarget: {
          bound: true,
          summary: 'Current app window',
          refs: ['window-action-session:current'],
        },
        freshObservation: {
          fresh: true,
          refs: ['computer-use:observation/current-frame.png'],
        },
        computerUsePermissions: {
          refs: ['permission:turn/gui-action'],
          stopCancelPath: true,
        },
      },
    });

    assert.match(payload.message, /Computer Use preflight blocked/i);
    assert.match(payload.message, /native-surface-unavailable/);
    assert.equal(payload.artifacts[0]?.type, 'computer-use-preflight');
    assert.equal((payload.artifacts[0]?.data as any).status, 'blocked');
    assert.equal(payload.executionUnits[0]?.status, 'failed-with-reason');
    assert.doesNotMatch(JSON.stringify(payload), /agentserver\.generation|vision-sense-observation/);
  } finally {
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runtime gateway pauses GUI submission intent for hard confirmation with refs-first projection', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-default-cu-hard-confirm-'));
  const original = process.env.SCIFORGE_CONVERSATION_POLICY_MODE;
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';
  try {
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'knowledge',
      prompt: 'Submit the registration form in the current browser window.',
      workspacePath: workspace,
      artifacts: [],
      references: [],
      uiState: {
        runtimeReadiness: {
          readiness: {
            browserHostSession: 'ready',
            nativeBridge: 'ready',
            nativeSurface: 'ready',
            windowActionSession: 'ready',
            computerUseAdapter: 'ready',
          },
        },
        computerUseTarget: {
          bound: true,
          summary: 'Registration form',
          refs: ['browser-host-session:form'],
        },
        freshObservation: {
          fresh: true,
          refs: ['browser-host-session:form/frame.png'],
        },
        computerUsePermissions: {
          refs: ['permission:turn/form-draft'],
          scopedExecutorRefs: ['computer-use:executor/form-draft'],
          stopCancelPath: true,
        },
      },
    });

    assert.match(payload.message, /requires hard confirmation/i);
    assert.equal(payload.executionUnits[0]?.status, 'needs-human');
    const preflight = payload.artifacts[0]?.data as any;
    assert.equal(preflight.status, 'needs-confirmation');
    assert.equal(preflight.confirmation.action, 'Submit the registration form in the current browser window.');
    assert.equal(preflight.confirmation.authorizationProfile.id, 'high-autonomy');
    assert.deepEqual(preflight.confirmation.evidenceRefs, ['browser-host-session:form/frame.png', 'permission:turn/form-draft', 'computer-use:executor/form-draft']);
  } finally {
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('gateway pipeline audit records stage sequence and replayable registry order', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-gateway-pipeline-audit-'));
  const original = process.env.SCIFORGE_CONVERSATION_POLICY_MODE;
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';
  const events: any[] = [];
  try {
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Use existing current refs only.',
      workspacePath: workspace,
      artifacts: [],
      references: [{ ref: 'artifact:prior-report', title: 'Prior report' }],
      uiState: {
        forceAgentServerGeneration: true,
        turnExecutionConstraints: {
          schemaVersion: 'sciforge.turn-execution-constraints.v1',
          policyId: 'sciforge.current-turn-execution-constraints.v1',
          source: 'runtime-contract.turn-constraints',
          contextOnly: true,
          agentServerForbidden: true,
          workspaceExecutionForbidden: false,
          externalIoForbidden: false,
          codeExecutionForbidden: false,
          reasons: ['AgentServer dispatch is forbidden by structured current-turn constraints.'],
          evidence: { hasPriorContext: true, referenceCount: 1 },
        },
      },
    }, {
      onEvent(event) {
        events.push(event);
      },
    });

    assert.match(payload.message, /没有回落到旧 AgentServer generation|Runtime Codex/i);
    assert.deepEqual(
      GATEWAY_PIPELINE_STAGES.map((stage) => stage.name),
      GATEWAY_PIPELINE_STAGE_ORDER,
    );
    const registryAudit = events.find((event) => event.type === 'gateway-pipeline-registry-audit');
    assert.ok(registryAudit);
    assert.deepEqual(registryAudit.raw.stageOrder, GATEWAY_PIPELINE_STAGE_ORDER);
    assert.deepEqual(
      registryAudit.raw.stages.map((stage: Record<string, unknown>) => stage.name),
      GATEWAY_PIPELINE_STAGE_ORDER,
    );
    const stageAudits = events.filter((event) => event.type === 'gateway-pipeline-stage-audit');
    assert.deepEqual(
      stageAudits.map((event) => event.raw.stage),
      [
        STAGE_CONVERSATION_POLICY,
        STAGE_REQUEST_ENRICHMENT,
        STAGE_REQUEST_CLARIFICATION_RUNTIME,
        STAGE_BROWSER_COMPUTER_USE_CAPABILITY_TRUTH,
        STAGE_CAPABILITY_PROVIDER_PREFLIGHT,
        STAGE_PLAYWRIGHT_EDGE_BROWSER_RUNTIME,
        STAGE_DIRECT_CONTEXT_FAST_PATH,
        STAGE_ARTIFACT_MUTATION_FAST_PATH,
        STAGE_RUNTIME_EXECUTION_CONSTRAINTS,
        STAGE_CODEX_RUNTIME_BRIDGE,
        STAGE_VISION_SENSE_RUNTIME,
        STAGE_LOCAL_CODE_DEBUG_RUNTIME,
        STAGE_LOCAL_METHODOLOGY_FINALIZER_RUNTIME,
        STAGE_LOCAL_TABULAR_ANALYSIS_RUNTIME,
        STAGE_LOCAL_DATA_SENSITIVITY_RUNTIME,
        STAGE_LOCAL_REPRODUCIBLE_METHOD_RUNTIME,
        STAGE_RUNTIME_UNHANDLED,
      ],
    );
    assert.deepEqual(
      stageAudits.map((event) => event.raw.shortCircuit),
      [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true],
    );
    const terminalAudit = stageAudits.at(-1);
    assert.equal(terminalAudit.raw.stage, STAGE_RUNTIME_UNHANDLED);
    assert.equal(terminalAudit.raw.payloadSummary.claimType, 'runtime-diagnostic');
    assert.equal(terminalAudit.raw.payloadSummary.executionUnitCount, 1);
    assert.deepEqual(terminalAudit.raw.payloadSummary.artifactIds, ['runtime-unhandled']);
    assert.match(terminalAudit.raw.payloadSummary.message, /没有回落到旧 AgentServer generation|Runtime Codex/i);
  } finally {
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('code and external IO forbidden constraints do not reopen plain AgentServer answers', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-answer-only-constraints-'));
  const original = process.env.SCIFORGE_CONVERSATION_POLICY_MODE;
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';
  let sawAgentServerGenerate = false;
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { session: { id: 'answer-only-constraints', status: 'active' }, recentTurns: [], currentWorkEntries: [] } }));
      return;
    }
    if (req.method !== 'POST' || String(req.url) !== '/api/agent-server/runs/stream') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    sawAgentServerGenerate = true;
    const result = {
      ok: true,
      data: {
        run: {
          id: 'mock-answer-only-constraints',
          status: 'completed',
          output: {
            result: {
              message: 'GC content affects primer melting behavior; specificity reduces off-target amplification.',
              confidence: 0.88,
              claimType: 'fact',
              evidenceLevel: 'runtime',
              reasoningTrace: 'Answered without workspace code execution or external IO.',
              claims: [],
              uiManifest: [],
              executionUnits: [{ id: 'agentserver-answer-only', tool: 'agentserver.generation', status: 'done' }],
              artifacts: [],
            },
          },
        },
      },
    };
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(`${JSON.stringify({ result })}\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      prompt: 'Explain primer design checks. Do not retrieve, read files, or run code.',
      workspacePath: workspace,
      agentServerBaseUrl: `http://127.0.0.1:${address.port}`,
      artifacts: [],
      references: [],
      uiState: {
        selectedToolIds: ['default-report-view'],
        selectedActionIds: ['default-followup-action'],
        selectedVerifierIds: ['default-verifier'],
        turnExecutionConstraints: {
          schemaVersion: 'sciforge.turn-execution-constraints.v1',
          policyId: 'sciforge.current-turn-execution-constraints.v1',
          source: 'runtime-contract.turn-constraints',
          contextOnly: true,
          agentServerForbidden: false,
          workspaceExecutionForbidden: true,
          externalIoForbidden: true,
          codeExecutionForbidden: true,
          reasons: ['No retrieval or code execution requested.'],
          evidence: { hasPriorContext: false, referenceCount: 0 },
        },
      },
    });

    assert.equal(sawAgentServerGenerate, false);
    assert.equal(payload.artifacts[0]?.id, 'runtime-unhandled');
    assert.match(payload.message, /Runtime Codex|没有回落到旧 AgentServer generation/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', original);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('repair continuation no longer starts AgentServer backend generation', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-repair-bounded-stop-'));
  const originalPolicy = process.env.SCIFORGE_CONVERSATION_POLICY_MODE;
  process.env.SCIFORGE_CONVERSATION_POLICY_MODE = 'off';
  let sawAgentServerGenerate = false;
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: {
          session: { id: 'session-repair-bounded-stop', status: 'active' },
          workBudget: { status: 'healthy', approxCurrentWorkTokens: 100 },
          recentTurns: [],
          currentWorkEntries: [],
        },
      }));
      return;
    }
    if (req.method !== 'POST' || String(req.url) !== '/api/agent-server/runs/stream') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    sawAgentServerGenerate = true;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(`${JSON.stringify({
      event: {
        type: 'usage-update',
        usage: { input: 55_000, output: 5_001, total: 60_001, provider: 'mock' },
      },
    })}\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'knowledge',
      prompt: 'Continue the failed run from the compact refs and do not restart broad generation.',
      workspacePath: workspace,
      agentServerBaseUrl: `http://127.0.0.1:${address.port}`,
      maxContextWindowTokens: 120_000,
      artifacts: [],
      uiState: {
        forceAgentServerGeneration: true,
        contextReusePolicy: {
          mode: 'repair',
          priorWorkSignals: { repairTargetAvailable: true },
        },
        currentReferenceDigests: [{ ref: 'artifact:prior-digest', digestRef: '.sciforge/digests/prior.json', title: 'Prior digest' }],
        recentExecutionRefs: [{
          id: 'EU-prior-failed',
          status: 'failed-with-reason',
          outputRef: '.sciforge/task-results/prior.json',
          stdoutRef: '.sciforge/task-results/prior.stdout.txt',
          stderrRef: '.sciforge/task-results/prior.stderr.txt',
          failureReason: 'prior bounded-stop',
        }],
      },
    });

    assert.equal(sawAgentServerGenerate, false);
    assert.match(payload.message, /Runtime Codex|没有回落到旧 AgentServer generation/i);
    assert.doesNotMatch(payload.message, /backend failed/i);
    const unit = payload.executionUnits[0] as Record<string, unknown>;
    assert.equal(unit.status, 'needs-human');
    assert.equal(payload.artifacts[0]?.id, 'runtime-unhandled');
    assert.ok(Array.isArray(unit.recoverActions));
    assert.ok((unit.recoverActions as string[]).some((action) => /Runtime Codex|local runtime/i.test(action)));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    restoreEnv('SCIFORGE_CONVERSATION_POLICY_MODE', originalPolicy);
    await rm(workspace, { recursive: true, force: true });
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
