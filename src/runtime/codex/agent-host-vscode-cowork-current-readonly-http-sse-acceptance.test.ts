import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV,
} from '../../../packages/actions/computer-use/vscode-cowork-live-diagnostic.js';
import type { AgentCliAdapter, AgentCliStartTurnInput } from './agent-cli-adapter.js';
import {
  runCurrentVSCodeCoWorkReadonlyHttpSseAcceptance,
} from './agent-host-vscode-cowork-current-readonly-http-sse-acceptance.js';

test('current VSCode co-work read-only HTTP/SSE acceptance writes blocked manifest without explicit env', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-current-vscode-readonly-http-sse-blocked-'));
  try {
    const manifest = await runCurrentVSCodeCoWorkReadonlyHttpSseAcceptance({
      workspacePath: workspace,
      outputDir: join(workspace, 'out'),
      env: {},
      now: () => new Date('2026-06-08T00:00:00.000Z'),
    });
    const persisted = JSON.parse(await readFile(join(workspace, 'out', 'manifest.json'), 'utf8')) as typeof manifest;

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.equal(manifest.productReady, false);
    assert.equal(manifest.maturity, 'live-diagnostic');
    assert.equal(manifest.operation, 'read-visible-text');
    assert.equal(manifest.httpSseTransportUsed, false);
    assert.equal(manifest.adapterBoundaryUsed, false);
    assert.equal(manifest.userProfileUsed, true);
    assert.equal(manifest.sharedSystemInputUsed, true);
    assert.equal(manifest.vscodeLaunched, false);
    assert.equal(manifest.userVSCodeKilled, false);
    assert.equal(manifest.userProfileCleared, false);
    assert.ok(manifest.blockedReasons.includes(`missing-env:${VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV}`));
    assert.equal(persisted.status, 'blocked');
    assert.doesNotMatch(JSON.stringify(persisted), /raw-|providerPayload|base64|secret|token|product-ready|kill-vscode|clear-profile/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('current VSCode co-work read-only HTTP/SSE acceptance persists refs-first events and cleanup refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-current-vscode-readonly-http-sse-'));
  try {
    const adapter = new ReadonlyHttpSseAdapter();
    const manifest = await runCurrentVSCodeCoWorkReadonlyHttpSseAcceptance({
      workspacePath: workspace,
      outputDir: join(workspace, 'out'),
      env: {
        [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
      },
      now: () => new Date('2026-06-08T00:00:00.000Z'),
      createAdapter: () => adapter,
    });
    const persistedText = await readFile(join(workspace, 'out', 'manifest.json'), 'utf8');

    assert.equal(adapter.startTurnInputs.length, 1);
    assert.match(adapter.startTurnInputs[0]?.commandText ?? '', /VSCode/);
    assert.equal((adapter.startTurnInputs[0]?.agentHostInput as Record<string, unknown> | undefined)?.schemaVersion, 'sciforge.codex-agent-host-input.v1');
    assert.equal(((adapter.startTurnInputs[0]?.agentHostInput as Record<string, unknown>)?.target as Record<string, unknown> | undefined)?.kind, 'current-vscode-cowork');
    assert.equal(manifest.status, 'passed');
    assert.equal(manifest.passClaim, true);
    assert.equal(manifest.productReady, false);
    assert.equal(manifest.httpSseTransportUsed, true);
    assert.equal(manifest.adapterBoundaryUsed, true);
    assert.equal(manifest.sseEventsObserved.includes('realtime_session'), true);
    assert.equal(manifest.sseEventsObserved.includes('turn'), true);
    assert.equal(manifest.sseEventsObserved.includes('done'), true);
    assert.equal(manifest.runtimeRequest.commandId, 'current-vscode-cowork-readonly-http-sse-live');
    assert.equal(manifest.runtimeRequest.eventTransport, 'sse');
    assert.equal(manifest.runtimeRequest.targetKind, 'current-vscode-cowork');
    assert.equal(manifest.runtimeRequest.operation, 'read-visible-text');
    assert.deepEqual(manifest.primitiveChainObserved, ['bind', 'observe', 'host-decision', 'observe', 'control(release)']);
    assert.equal(manifest.finalAnswer.hostOwnsFinalAnswer, true);
    assert.equal(manifest.finalAnswer.computerUseCorePlanning, false);
    assert.equal(manifest.finalAnswer.userTaskCompletionClaimed, false);
    assert.ok(manifest.evidenceRefs.includes('decision:vscode-cowork:http-sse-readonly:read-visible-text'));
    assert.ok(manifest.evidenceRefs.includes('observation:vscode:http-sse-after-read'));
    assert.ok(manifest.evidenceRefs.includes('text:vscode:http-sse-visible'));
    assert.ok(manifest.hostProducerEvidence?.operation === 'read-visible-text');
    assert.ok(manifest.releaseEvidenceRefs.includes('scoped-input-lease:current-vscode-cowork:http-sse-readonly'));
    assert.ok(manifest.restorationEvidenceRefs.includes('front-app-restore:current-vscode-cowork:http-sse-readonly'));
    assert.equal(manifest.cleanup.inputLeaseReleased, true);
    assert.equal(manifest.cleanup.adapterReleased, true);
    assert.equal(manifest.cleanup.cursorReleased, true);
    assert.equal(manifest.cleanup.frontAppRestored, true);
    assert.equal(manifest.cleanup.mousePositionRestored, true);
    assert.equal(manifest.cleanup.userVSCodeProcessKilled, false);
    assert.equal(manifest.cleanup.userProfileCleared, false);
    assert.doesNotMatch(persistedText, /SECRET|example\.invalid|\/Users\/example|raw-|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

class ReadonlyHttpSseAdapter implements AgentCliAdapter {
  readonly startTurnInputs: AgentCliStartTurnInput[] = [];

  async startTurn(input: AgentCliStartTurnInput) {
    this.startTurnInputs.push(input);
    const commandId = input.commandId ?? 'current-vscode-cowork-readonly-http-sse-live';
    const attemptId = input.attemptId ?? 'current-vscode-cowork-readonly-http-sse-live-attempt-1';
    return {
      turnId: commandId,
      attemptId,
      events: this.events(commandId, attemptId),
    };
  }

  async cancel() {}

  private async *events(commandId: string, attemptId: string) {
    const base = {
      schemaVersion: 'sciforge.codex.normalized-event.v1' as const,
      timestamp: new Date('2026-06-08T00:00:00.000Z').toISOString(),
      provider: 'host-owned-runtime',
      model: 'computer-use-native-route',
      profile: 'host-owned',
      workspace: 'workspace:current',
      commandId,
      attemptId,
      evidenceRefs: ['audit:codex-runtime:current-vscode-cowork-readonly-http-sse-live:normalized-events'],
    };
    yield {
      ...base,
      type: 'message' as const,
      text: 'Host observed current VSCode visible text from refs-first evidence.',
    };
    yield {
      ...base,
      type: 'done' as const,
      status: 'completed',
      message: 'Current VSCode read-only HTTP/SSE diagnostic completed.',
      primitiveChainObserved: ['bind', 'observe', 'host-decision', 'observe', 'control(release)'],
      evidenceRefs: [
        'computer-use-session:current-vscode-cowork:http-sse-readonly',
        'window-action-session:current-vscode-cowork:http-sse-readonly',
        'window:vscode:http-sse-readonly',
        'observation:vscode:http-sse-before-read',
        'observation:vscode:http-sse-after-read',
        'image:vscode:http-sse-before-read',
        'image:vscode:http-sse-after-read',
        'accessibility:vscode:http-sse-before-read',
        'accessibility:vscode:http-sse-after-read',
        'text:vscode:http-sse-visible',
        'element:vscode:http-sse-editor',
        'freshness:vscode:http-sse-before-read',
        'freshness:vscode:http-sse-after-read',
        'decision:vscode-cowork:http-sse-readonly:read-visible-text',
        'raw-providerPayload:SECRET_SHOULD_NOT_LEAK',
      ],
      cleanupRefs: [
        'scoped-input-lease:current-vscode-cowork:http-sse-readonly',
        'scoped-input-adapter:current-vscode-cowork:http-sse-readonly',
        'cursor-marker:current-vscode-cowork:http-sse-readonly',
        'front-app-restore:current-vscode-cowork:http-sse-readonly',
        'mouse-position-restore:current-vscode-cowork:http-sse-readonly',
        'raw-cleanup-ref:SECRET_SHOULD_NOT_LEAK',
      ],
      hostProducerEvidence: {
        schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-live-producer-evidence.v1',
        targetKind: 'current-vscode-cowork',
        operation: 'read-visible-text',
        agentHostInputRefs: ['intent:current-vscode-cowork', 'chat-request:vscode-cowork:http-sse-readonly'],
        targetRefs: ['window:vscode:http-sse-readonly', 'file-ref:vscode:http-sse-readonly'],
        observationRefs: ['observation:vscode:http-sse-after-read', 'text:vscode:http-sse-visible'],
        permissionRefs: ['permission:current-vscode-cowork:full-access:http-sse-readonly'],
        runtimeTruthRefs: ['runtime-truth:current-vscode-cowork:http-sse-readonly'],
        sessionReadyRefs: ['computer-use-session:current-vscode-cowork:http-sse-readonly'],
        inputLeaseRefs: ['scoped-input-lease:current-vscode-cowork:http-sse-readonly'],
        adapterRefs: ['scoped-input-adapter:current-vscode-cowork:http-sse-readonly'],
        evidenceRefs: ['chat-request:vscode-cowork:http-sse-readonly', 'window:vscode:http-sse-readonly'],
      },
      agentHostFinalAnswer: {
        schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
        source: 'codex-agent-host-vscode-cowork-http-sse-acceptance',
        status: 'completed',
        text: 'Host completed current VSCode read-only HTTP/SSE diagnostic from refs-first evidence.',
        maturity: 'live-diagnostic',
        productReady: false,
        hostOwnsFinalAnswer: true,
        computerUseCorePlanning: false,
        primitiveChainObserved: ['bind', 'observe', 'host-decision', 'observe', 'control(release)'],
        evidenceRefs: ['decision:vscode-cowork:http-sse-readonly:read-visible-text', 'observation:vscode:http-sse-after-read'],
        cleanupRefs: ['scoped-input-lease:current-vscode-cowork:http-sse-readonly'],
      },
      privatePayload: {
        path: '/Users/example/private-paper.md',
        providerPayload: 'SECRET_SHOULD_NOT_LEAK',
      },
    };
  }
}
