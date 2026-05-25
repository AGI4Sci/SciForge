import assert from 'node:assert/strict';
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
    recentActions: 'No GUI actions have executed yet.',
    verifierFeedback: 'No verifier feedback yet.',
    desktopPlatform: 'darwin',
    maxStepsRemaining: 4,
  });

  assert.match(command, /Return exactly one JSON object/);
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
  assert.match(command, /do not target the AutoSave toggle or Home\/house icon/);
  assert.match(command, /small floppy-disk Save icon immediately to the right of the Home\/house icon/);
  assert.match(command, /Never describe a Save icon as "near AutoSave"/);
  assert.match(command, /AutoSave is mentioned at all, mention it only as an excluded\/avoided non-target control/);
  assert.match(command, /do not claim File, Save As, Browse, filename\/path, location, or file-dialog controls are visible/);
  assert.match(command, /current compact observation is the only truth source/);
  assert.match(command, /Recent action targetDescription text and verifier pixel changes are history only/);
  assert.match(command, /For labeled save\/file controls, only target them when current observation\.visibleTexts/);
  assert.match(command, /prior click with verifier no-effect or changed=false does not prove a new dialog\/control exists/);
  assert.match(command, /Never say a dialog "should now be visible/);
  assert.match(command, /Do not type a filesystem path until the compact observation shows a visible Save\/Save As\/Open\/Choose dialog/);
  assert.match(command, /"actions":\[\{"type":"click"/);
  assert.match(command, /visibleTexts/);
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
  assert.equal(adapter.inputs[0]?.guiExtension?.enabled, false);
  assert.equal(adapter.inputs[0]?.workspacePath, '/tmp');
  assert.match(adapter.inputs[0]?.commandText ?? '', /Runtime Codex CLI\/TUI/);
});

class FakePlannerAdapter implements AgentCliAdapter {
  readonly inputs: AgentCliStartTurnInput[] = [];

  constructor(private readonly output: string) {}

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
    yield { ...base, type: 'message', text: this.output, message: this.output };
    yield { ...base, type: 'done', message: 'done', exitCode: 0, signal: null };
  }
}
