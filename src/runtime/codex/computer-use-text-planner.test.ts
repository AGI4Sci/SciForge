import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import type { AgentCliAdapter, AgentCliStartTurnInput, AgentCliTurn } from './agent-cli-adapter.js';
import type { NormalizedAgentEvent } from './codex-event-normalizer.js';
import { buildComputerUseTextPlannerCommand, runComputerUseCodexTextPlanner } from './computer-use-text-planner.js';

test('computer use text planner command is strict JSON-only and text-only', () => {
  const command = buildComputerUseTextPlannerCommand({
    task: 'click the visible Search field',
    observation: {
      ref: 'screen-ref',
      summary: 'Search field visible',
      visibleTexts: ['Search'],
      screenshotRefs: [{ path: '.sciforge/vision-runs/run/step-000-before.png' }],
    },
    plannerAcceptanceContract: {
      schemaVersion: 'sciforge.computer-use.planner-acceptance-contract.v1',
      source: 'gateway-ui-state',
      scenarioId: 'CU-LONG-999',
      cuNextTaskId: 'CU-NEXT-99',
      round: 1,
      roundPrompt: 'create or enter a low-risk test folder and record file list refs',
      expectedTrace: ['before screenshot refs', 'generic action ledger'],
      acceptance: ['scenario-level drag', 'scenario-level hotkey', 'scenario-level preview'],
      requirements: ['l3-workflow-refs', 'no-dom-playwright-accessibility'],
      acceptanceProgress: {
        schemaVersion: 'sciforge.computer-use-long.acceptance-progress.v1',
        minimumScenarioActionCount: 20,
        suggestedCurrentRoundActionTarget: 5,
      },
    },
    recentActions: 'No GUI actions have executed yet.',
    verifierFeedback: 'No verifier feedback yet.',
    desktopPlatform: 'darwin',
    maxStepsRemaining: 4,
  });

  assert.match(command, /Return exactly one JSON object/);
  assert.match(command, /Planner acceptance contract JSON/);
  assert.match(command, /expectedTrace/);
  assert.match(command, /generic action ledger/);
  assert.match(command, /current round as the completion scope/);
  assert.match(command, /Scenario-level acceptance, requirements, requiredEvidence, validationContract, and safetyBoundary are constraints and future-round context/);
  assert.match(command, /do not try to satisfy every scenario-level acceptance item inside one round/);
  assert.match(command, /Return done=true when the compact observation, Recent actions, and verifier feedback already support that current scope/);
  assert.match(command, /final artifact, evidence summary, action mapping, field\/control evidence summary/);
  assert.match(command, /visible typed\/exported artifact/);
  assert.match(command, /current round needs at least one non-wait GUI action in Recent actions/);
  assert.match(command, /acceptanceProgress specifies suggestedCurrentRoundActionTarget/);
  assert.match(command, /minimum evidence-producing action quota/);
  assert.match(command, /remainingScenarioActionCount/);
  assert.match(command, /do not return done=true; emit one safe low-risk visible/);
  assert.match(command, /Do not count prior-round actions or scenario-level summaries as current-round GUI evidence/);
  assert.match(command, /Do not inspect screenshots, files, GUI state, DOM, accessibility trees/);
  assert.match(command, /Never output coordinate fields/);
  assert.match(command, /single next unexecuted action/);
  assert.match(command, /Use Recent actions as authoritative history/);
  assert.match(command, /"actions":\[\{"type":"open_app","appName":"Safari"\}\]/);
  assert.match(command, /"actions":\[\{"type":"type_text","text":"literal text to type"\}\]/);
  assert.match(command, /"actions":\[\{"type":"press_key","key":"Enter"\}\]/);
  assert.match(command, /For open_app, appName is required/);
  assert.match(command, /For type_text, text is required/);
  assert.match(command, /For press_key, key is required/);
  assert.match(command, /For hotkey, keys is required/);
  assert.match(command, /Never use Command\+S, Ctrl\+S/);
  assert.match(command, /task-required Save, Save As, filename\/path, location, and file dialog UI is in scope/);
  assert.match(command, /Do not mark ordinary focus, selection, inspection, text-field, search-field, checkbox, radio, dropdown, menu, toggle, switch, or scroll actions as high risk/);
  assert.match(command, /low-risk controls, inspection, visual evidence, or action quota/);
  assert.match(command, /Never use Export, Share, Save, Save As, Submit, Send, Delete, Remove, Pay, Purchase, Authorize, Approve, Publish, Upload, Overwrite, Replace, Login, or Sign in controls as low-risk quota filler/);
  assert.match(command, /visually ambiguous toolbars or title bars/);
  assert.match(command, /Describe the intended visible label\/icon\/shape/);
  assert.match(command, /Never describe an intended target as "near" a non-target control/);
  assert.match(command, /excluded or avoided non-target controls/);
  assert.doesNotMatch(command, /PowerPoint-style|floppy-disk Save icon immediately to the right of the Home\/house icon/);
  assert.match(command, /do not claim File, Save As, Browse, filename\/path, location, or file-dialog controls are visible/);
  assert.match(command, /current compact observation is the only truth source/);
  assert.match(command, /Recent action targetDescription text and verifier pixel changes are history only/);
  assert.match(command, /For labeled save\/file controls, only target them when current observation\.visibleTexts/);
  assert.match(command, /prior click with verifier no-effect or changed=false does not prove a new dialog\/control exists/);
  assert.match(command, /Never say a dialog "should now be visible/);
  assert.match(command, /Do not type a filesystem path until the compact observation shows a visible Save\/Save As\/Open\/Choose dialog/);
  assert.match(command, /"actions":\[\{"type":"click"/);
  assert.match(command, /visibleTexts/);
  assert.doesNotMatch(command, /data:image|;base64|DOMSnapshot|accessibilityTree/);
});

test('computer use text planner adapter disables GUI extension and returns final JSON text', async () => {
  const adapter = new FakePlannerAdapter(JSON.stringify({
    done: false,
    reason: 'type into visible field',
    actions: [{ type: 'type_text', text: 'hello' }],
  }));
  const result = await runComputerUseCodexTextPlanner({
    task: 'type hello',
    observation: { summary: 'Text field focused.', visibleTexts: ['Name'] },
    recentActions: 'No GUI actions have executed yet.',
    verifierFeedback: 'No verifier feedback yet.',
    desktopPlatform: 'darwin',
    maxStepsRemaining: 3,
  }, {
    workspace: '/tmp',
    adapter,
    commandId: 'codex-computer-use-plan-test',
  });

  assert.equal(result.ok, true);
  assert.match(result.ok ? result.text : '', /"type_text"/);
  assert.equal(result.ok ? result.raw.diagnostics.emptyFinal : true, false);
  assert.equal(result.ok ? result.raw.diagnostics.sawFinalMessage : false, true);
  assert.equal(adapter.inputs[0]?.guiExtension?.enabled, false);
  assert.equal(adapter.inputs[0]?.workspacePath, '/tmp');
  assert.match(adapter.inputs[0]?.commandText ?? '', /Runtime Codex CLI\/TUI/);
});

test('computer use text planner records terminal and raw-jsonl counts for empty final output', async () => {
  const adapter = new FakePlannerAdapter([
    { type: 'audit', status: 'raw-jsonl', raw: { type: 'thread.started', payload: { id: 'thread-empty' } } },
    { type: 'audit', status: 'raw-jsonl', raw: { type: 'turn.started', payload: { id: 'thread-empty' } } },
    { type: 'done', status: 'done', message: 'Runtime Codex completed successfully.', exitCode: 0, signal: null },
  ]);

  const result = await runComputerUseCodexTextPlanner(basePlannerInput(), {
    workspace: '/tmp',
    adapter,
    commandId: 'codex-computer-use-plan-empty-final-test',
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /completed without final JSON text/);
  assert.match(result.ok ? '' : result.reason, /terminalEventCounts=done:1/);
  assert.match(result.ok ? '' : result.reason, /rawJsonlEventCounts=thread\.started:1,turn\.started:1/);
  assert.equal(result.ok ? true : result.raw.diagnostics.emptyFinal, true);
  assert.equal(result.ok ? true : result.raw.diagnostics.sawPlannerText, false);
  assert.equal(result.ok ? true : result.raw.diagnostics.abort.observed, false);
  assert.deepEqual(result.ok ? {} : result.raw.diagnostics.terminalEventCounts, { done: 1 });
  assert.deepEqual(result.ok ? {} : result.raw.diagnostics.rawJsonlEventCounts, {
    'thread.started': 1,
    'turn.started': 1,
  });
  assert.equal(result.ok ? undefined : result.raw.events[1]?.rawEventType, 'thread.started');
  assert.equal(result.ok ? undefined : result.raw.events[2]?.rawEventType, 'turn.started');
});

test('computer use text planner marks observed aborts from cancelled terminal events', async () => {
  const adapter = new FakePlannerAdapter([
    { type: 'audit', status: 'raw-jsonl', raw: { type: 'thread.started', payload: { id: 'thread-abort' } } },
    {
      type: 'cancelled',
      status: 'cancelled',
      message: 'Runtime Codex was cancelled by signal SIGTERM',
      exitCode: null,
      signal: 'SIGTERM',
    },
  ]);

  const result = await runComputerUseCodexTextPlanner(basePlannerInput(), {
    workspace: '/tmp',
    adapter,
    commandId: 'codex-computer-use-plan-aborted-test',
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /cancelled by signal SIGTERM/);
  assert.match(result.ok ? '' : result.reason, /aborted=true,sources=cancelled-event\+terminal-signal,signal=SIGTERM/);
  assert.equal(result.ok ? false : result.raw.diagnostics.abort.observed, true);
  assert.deepEqual(result.ok ? [] : result.raw.diagnostics.abort.sources, ['cancelled-event', 'terminal-signal']);
  assert.equal(result.ok ? undefined : result.raw.diagnostics.abort.signal, 'SIGTERM');
  assert.deepEqual(result.ok ? {} : result.raw.diagnostics.terminalEventCounts, { cancelled: 1 });
});

test('computer use text planner falls back to direct chat completions after Codex transport failure', async () => {
  const adapter = new FakePlannerAdapter([
    { type: 'audit', status: 'raw-jsonl', raw: { type: 'thread.started' } },
    { type: 'audit', status: 'raw-jsonl', raw: { type: 'turn.started' } },
    { type: 'failed', status: 'failed', message: 'unexpected status 502 Bad Gateway', exitCode: 1, signal: null },
  ]);
  const fetchCalls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const result = await runComputerUseCodexTextPlanner(basePlannerInput(), {
    workspace: '/tmp',
    adapter,
    commandId: 'codex-computer-use-plan-fallback-test',
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-key',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'http://provider.example/v1/',
      SCIFORGE_RUNTIME_MODEL: 'bailian/deepseek-v4-flash',
    },
    fetchImpl: async (url, init) => {
      fetchCalls.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"done":false,"reason":"fallback action","actions":[{"type":"press_key","key":"Tab"}]}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.ok ? result.text : '', /"press_key"/);
  assert.equal(fetchCalls[0]?.url, 'http://provider.example/v1/chat/completions');
  assert.equal(fetchCalls[0]?.headers.accept, 'application/json');
  assert.equal(fetchCalls[0]?.headers['accept-encoding'], 'identity');
  assert.equal(fetchCalls[0]?.body.model, 'bailian/deepseek-v4-flash');
  assert.equal(fetchCalls[0]?.body.stream, false);
  assert.equal(fetchCalls[0]?.body.max_tokens, 768);
  assert.deepEqual(fetchCalls[0]?.body.metadata, { source: 'computer-use-direct-text-planner-fallback' });
  assert.equal((fetchCalls[0]?.body.messages as Array<Record<string, unknown>>)?.[0]?.role, 'user');
  assert.match(String((fetchCalls[0]?.body.messages as Array<Record<string, unknown>>)?.[0]?.content), /Return exactly one JSON object/);
  assert.match(result.ok ? result.raw.diagnosticSummary : '', /directChatFallback=used/);
  assert.ok(result.ok && result.raw.events.some((event) => event.status === 'direct-chat-fallback-started'));
});

test('computer use text planner raw identity retry handles mislabeled compressed fallback response', async () => {
  const adapter = new FakePlannerAdapter([
    { type: 'failed', status: 'failed', message: 'Runtime Codex text planner transport timeout', exitCode: 1, signal: null },
  ]);
  const requests: Array<{ acceptEncoding: string | undefined }> = [];
  const server = createServer((request, response) => {
    requests.push({ acceptEncoding: request.headers['accept-encoding'] });
    request.resume();
    response.statusCode = 200;
    response.setHeader('content-type', 'application/json');
    response.setHeader('content-encoding', 'gzip');
    response.end(JSON.stringify({
      choices: [{ message: { content: '{"done":false,"reason":"raw fallback action","actions":[{"type":"press_key","key":"Tab"}]}' } }],
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const result = await runComputerUseCodexTextPlanner(basePlannerInput(), {
      workspace: '/tmp',
      adapter,
      commandId: 'codex-computer-use-plan-raw-fallback-test',
      env: {
        SCIFORGE_RUNTIME_API_KEY: 'test-key',
        SCIFORGE_PROXY_UPSTREAM_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        SCIFORGE_RUNTIME_MODEL: 'bailian/deepseek-v4-flash',
        SCIFORGE_COMPUTER_USE_DIRECT_TEXT_PLANNER_RETRIES: '1',
      },
    });

    assert.equal(result.ok, true);
    assert.match(result.ok ? result.text : '', /"press_key"/);
    assert.match(result.ok ? result.raw.diagnosticSummary : '', /directChatAttempts=2\/2/);
    assert.deepEqual(requests.map((request) => request.acceptEncoding), ['identity', 'identity']);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('computer use text planner redacts direct chat fallback provider errors', async () => {
  const adapter = new FakePlannerAdapter([
    { type: 'failed', status: 'failed', message: 'unexpected status 502 Bad Gateway', exitCode: 1, signal: null },
  ]);
  const result = await runComputerUseCodexTextPlanner(basePlannerInput(), {
    workspace: '/tmp',
    adapter,
    commandId: 'codex-computer-use-plan-fallback-redaction-test',
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'sk-test-secret-should-not-appear',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'http://provider.example/v1?token=upstream-secret-token',
      SCIFORGE_RUNTIME_MODEL: 'bailian/deepseek-v4-flash',
    },
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        message: 'Bearer abcdefghijklmnop failed for api_key=sk-provider-body-secret at https://provider.example/v1/chat/completions?token=query-secret',
      },
    }), { status: 401, headers: { 'content-type': 'application/json' } }),
  });

  assert.equal(result.ok, false);
  const reason = result.ok ? '' : result.reason;
  assert.match(reason, /HTTP 401/);
  assert.doesNotMatch(reason, /sk-test-secret|sk-provider-body-secret|abcdefghijklmnop|query-secret|upstream-secret-token/);
  assert.match(reason, /\[redacted-secret:/);
  assert.match(reason, /\[redacted-url:/);
});

test('computer use text planner retries direct chat fallback after transient fetch failure', async () => {
  const adapter = new FakePlannerAdapter([
    { type: 'failed', status: 'failed', message: 'unexpected status 502 Bad Gateway', exitCode: 1, signal: null },
  ]);
  let attempts = 0;

  const result = await runComputerUseCodexTextPlanner(basePlannerInput(), {
    workspace: '/tmp',
    adapter,
    commandId: 'codex-computer-use-plan-fallback-retry-test',
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-key',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'http://provider.example/v1',
      SCIFORGE_RUNTIME_MODEL: 'bailian/deepseek-v4-flash',
      SCIFORGE_COMPUTER_USE_DIRECT_TEXT_PLANNER_RETRIES: '1',
    },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('fetch failed', { cause: new Error('ECONNRESET') });
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"done":false,"reason":"retry action","actions":[{"type":"press_key","key":"Escape"}]}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
  assert.match(result.ok ? result.text : '', /"Escape"/);
  assert.match(result.ok ? result.raw.diagnosticSummary : '', /directChatAttempts=2\/2/);
  assert.ok(result.ok && result.raw.events.some((event) => event.status === 'direct-chat-fallback-retried'));
});

test('computer use text planner keeps Codex failure when direct fallback config is absent', async () => {
  const adapter = new FakePlannerAdapter([
    { type: 'failed', status: 'failed', message: 'unexpected status 502 Bad Gateway', exitCode: 1, signal: null },
  ]);

  let fetchCalled = false;
  const result = await runComputerUseCodexTextPlanner(basePlannerInput(), {
    workspace: '/tmp',
    adapter,
    commandId: 'codex-computer-use-plan-no-fallback-test',
    env: {},
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('fetch must not be called without fallback config');
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /unexpected status 502 Bad Gateway/);
  assert.match(result.ok ? '' : result.reason, /Missing env: SCIFORGE_RUNTIME_API_KEY/);
  assert.match(result.ok ? '' : result.reason, /SCIFORGE_PROXY_UPSTREAM_BASE_URL/);
  assert.match(result.ok ? '' : result.reason, /SCIFORGE_RUNTIME_MODEL/);
  assert.equal(fetchCalled, false);
});

test('computer use text planner does not direct-fallback for non-transport planner failures', async () => {
  const adapter = new FakePlannerAdapter([
    { type: 'failed', status: 'failed', message: 'Planner returned invalid JSON object', exitCode: 1, signal: null },
  ]);

  let fetchCalled = false;
  const result = await runComputerUseCodexTextPlanner(basePlannerInput(), {
    workspace: '/tmp',
    adapter,
    commandId: 'codex-computer-use-plan-invalid-json-test',
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-key',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'http://provider.example/v1',
      SCIFORGE_RUNTIME_MODEL: 'bailian/deepseek-v4-flash',
    },
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('fetch must not be called for non-transport planner failures');
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /Planner returned invalid JSON object/);
  assert.doesNotMatch(result.ok ? '' : result.reason, /Direct chat planner fallback/);
  assert.equal(fetchCalled, false);
});

function basePlannerInput() {
  return {
    task: 'type hello',
    observation: { summary: 'Text field focused.', visibleTexts: ['Name'] },
    recentActions: 'No GUI actions have executed yet.',
    verifierFeedback: 'No verifier feedback yet.',
    desktopPlatform: 'darwin',
    maxStepsRemaining: 3,
  };
}

class FakePlannerAdapter implements AgentCliAdapter {
  readonly inputs: AgentCliStartTurnInput[] = [];

  constructor(private readonly output: string | Array<Partial<NormalizedAgentEvent>>) {}

  async startTurn(input: AgentCliStartTurnInput): Promise<AgentCliTurn> {
    this.inputs.push(input);
    return {
      turnId: input.commandId ?? 'turn',
      attemptId: input.attemptId ?? 'attempt',
      events: this.events(input),
    };
  }

  async cancel(): Promise<void> {}

  private async *events(input: AgentCliStartTurnInput): AsyncIterable<NormalizedAgentEvent> {
    const base = {
      schemaVersion: 'sciforge.codex.normalized-event.v1' as const,
      timestamp: '2026-05-25T00:00:00.000Z',
      provider: 'test',
      model: 'test',
      profile: 'test',
      workspace: input.workspacePath,
      commandId: input.commandId ?? 'turn',
      attemptId: input.attemptId ?? 'attempt',
      evidenceRefs: [],
    };
    if (Array.isArray(this.output)) {
      yield { ...base, type: 'run_started', message: 'Runtime Codex started.' };
      for (const event of this.output) {
        yield { ...base, ...event } as NormalizedAgentEvent;
      }
      return;
    }
    yield { ...base, type: 'message', text: this.output, message: this.output };
    yield { ...base, type: 'done', message: 'done', exitCode: 0, signal: null };
  }
}
