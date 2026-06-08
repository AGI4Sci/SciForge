import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV,
} from '../../../packages/actions/computer-use/vscode-cowork-live-diagnostic.js';
import {
  runCurrentVSCodeCoWorkReadonlyLiveAcceptance,
} from './agent-host-vscode-cowork-current-live-acceptance.js';

test('current VSCode co-work readonly live acceptance writes blocked manifest without explicit env', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-current-vscode-readonly-live-blocked-'));
  try {
    const manifest = await runCurrentVSCodeCoWorkReadonlyLiveAcceptance({
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
    assert.equal(manifest.userProfileUsed, true);
    assert.equal(manifest.sharedSystemInputUsed, true);
    assert.equal(manifest.ordinaryChatNativeRouteUsed, false);
    assert.equal(manifest.vscodeLaunched, false);
    assert.equal(manifest.userVSCodeKilled, false);
    assert.equal(manifest.userProfileCleared, false);
    assert.deepEqual(manifest.primitiveChainObserved, []);
    assert.ok(manifest.blockedReasons.includes(`missing-env:${VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV}`));
    assert.equal(persisted.status, 'blocked');
    assert.doesNotMatch(JSON.stringify(persisted), /\/tmp|raw-|providerPayload|base64|secret|token|product-ready|kill-vscode|clear-profile/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('current VSCode co-work readonly live acceptance persists refs-first Host evidence and cleanup refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-current-vscode-readonly-live-'));
  try {
    const runnerCalls: Array<{ commandText?: string; activateCurrentVSCodeIfNeeded?: boolean }> = [];
    const manifest = await runCurrentVSCodeCoWorkReadonlyLiveAcceptance({
      workspacePath: workspace,
      outputDir: join(workspace, 'out'),
      env: {
        [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
      },
      activateCurrentVSCodeIfNeeded: true,
      now: () => new Date('2026-06-08T00:00:00.000Z'),
      runReadVisibleTextLiveDiagnostic: async (input) => {
        assert.ok(input);
        runnerCalls.push({
          commandText: input.commandText,
          activateCurrentVSCodeIfNeeded: input.activateCurrentVSCodeIfNeeded,
        });
        return {
          status: 'completed',
          message: 'Current VSCode read-only live diagnostic completed from refs-first evidence.',
          maturity: 'live-diagnostic',
          productReady: false,
          primitiveChainObserved: ['bind', 'observe', 'host-decision', 'observe', 'control(release)'],
          evidenceRefs: [
            'computer-use-session:current-vscode-cowork:acceptance',
            'window-action-session:current-vscode-cowork:acceptance',
            'window:vscode:paper',
            'observation:vscode:before',
            'observation:vscode:after',
            'image:vscode:before',
            'image:vscode:after',
            'accessibility:vscode:before',
            'accessibility:vscode:after',
            'text:vscode:visible-before',
            'text:vscode:visible-after',
            'element:vscode:editor',
            'freshness:vscode:before',
            'freshness:vscode:after',
            'decision:vscode-cowork:acceptance:read-visible-text',
            'control:current-vscode-cowork:acceptance:release',
            'https://example.invalid/SECRET_EVIDENCE',
            'raw-providerPayload:SECRET_SHOULD_NOT_LEAK',
          ],
          cleanupRefs: [
            'scoped-input-lease:current-vscode-cowork:acceptance',
            'scoped-input-adapter:current-vscode-cowork:acceptance',
            'cursor-marker:current-vscode-cowork:acceptance',
            'front-app-restore:current-vscode-cowork:acceptance',
            'mouse-position-restore:current-vscode-cowork:acceptance',
            'raw-cleanup-ref:SECRET_SHOULD_NOT_LEAK',
          ],
          agentHostInput: {
            schemaVersion: 'sciforge.codex-agent-host-input.v1',
            source: 'vscode-cowork-live-diagnostic',
            intentText: 'SECRET raw intent should stay private.',
            singleTurnOverride: false,
            refs: [
              'intent:current-vscode-cowork',
              'chat-request:vscode-cowork:acceptance',
              'window:vscode:paper',
              'observation:vscode:before',
              'text:vscode:visible-before',
              'raw-agent-host-ref:SECRET_SHOULD_NOT_LEAK',
            ],
            readiness: {},
            target: {
              kind: 'current-vscode-cowork',
              refs: ['window:vscode:paper', '/Users/example/private-paper.md'],
              vscodeCoWork: {
                operation: 'read-visible-text',
              },
            },
            observation: {
              fresh: true,
              refs: ['observation:vscode:before', 'text:vscode:visible-before', 'data:image/png;base64,SECRET_IMAGE'],
            },
            permissions: {
              refs: ['permission:current-vscode-cowork:full-access:window-action-session:current-vscode-cowork:acceptance:file-ref:vscode:paper'],
              scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
              stopCancelPath: true,
            },
          },
          runtimeTruth: {
            schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
            source: 'vscode-cowork-live-diagnostic',
            target: {
              bound: true,
              summary: 'SECRET raw title should stay private.',
              refs: ['window:vscode:paper', '/Users/example/private-paper.md'],
            },
            observation: {
              fresh: true,
              refs: ['observation:vscode:before', 'text:vscode:visible-before', 'raw-observation:SECRET_SHOULD_NOT_LEAK'],
            },
            permissions: {
              refs: ['permission:current-vscode-cowork:full-access:window-action-session:current-vscode-cowork:acceptance:file-ref:vscode:paper'],
              permissionRefs: ['permission:current-vscode-cowork:full-access:window-action-session:current-vscode-cowork:acceptance:file-ref:vscode:paper'],
              scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
              stopCancelPath: true,
            },
            sessions: {
              sessionReadyRefs: [
                'computer-use-session:current-vscode-cowork:acceptance',
                'window-action-session:current-vscode-cowork:acceptance',
                'scoped-input-lease:current-vscode-cowork:acceptance',
              ],
              targetRefs: ['window:vscode:paper'],
              inputLeaseRefs: ['scoped-input-lease:current-vscode-cowork:acceptance'],
              observationRefs: ['observation:vscode:before'],
            },
            adapter: {
              refs: ['scoped-input-adapter:current-vscode-cowork:acceptance'],
              inputIsolation: {
                refsOnly: true,
                refs: [
                  'scoped-input-lease:current-vscode-cowork:acceptance',
                  'cursor-marker:current-vscode-cowork:acceptance',
                ],
              },
            },
            refs: [
              'intent:current-vscode-cowork',
              'window:vscode:paper',
              'observation:vscode:before',
              'computer-use-session:current-vscode-cowork:acceptance',
              'raw-runtime-truth:SECRET_SHOULD_NOT_LEAK',
            ],
          },
          agentHostFinalAnswer: {
            schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
            source: 'codex-agent-host-vscode-cowork-live-diagnostic',
            status: 'completed',
            text: 'Host completed the current VSCode read-visible-text live diagnostic from refs-first evidence.',
            maturity: 'live-diagnostic',
            productReady: false,
            hostOwnsFinalAnswer: true,
            computerUseCorePlanning: false,
            primitiveChainObserved: ['bind', 'observe', 'host-decision', 'observe', 'control(release)'],
            evidenceRefs: ['observation:vscode:after', 'text:vscode:visible-after'],
            cleanupRefs: ['scoped-input-lease:current-vscode-cowork:acceptance'],
          },
        };
      },
    });
    const persistedText = await readFile(join(workspace, 'out', 'manifest.json'), 'utf8');

    assert.equal(runnerCalls.length, 1);
    assert.equal(runnerCalls[0]?.commandText, '操作我已经打开的 VSCode，读取当前可见文本。');
    assert.equal(runnerCalls[0]?.activateCurrentVSCodeIfNeeded, true);
    assert.equal(manifest.status, 'passed');
    assert.equal(manifest.passClaim, true);
    assert.equal(manifest.ordinaryChatNativeRouteUsed, true);
    assert.equal(manifest.finalAnswer.hostOwnsFinalAnswer, true);
    assert.equal(manifest.finalAnswer.computerUseCorePlanning, false);
    assert.equal(manifest.finalAnswer.userTaskCompletionClaimed, false);
    assert.deepEqual(manifest.primitiveChainObserved, ['bind', 'observe', 'host-decision', 'observe', 'control(release)']);
    assert.ok(manifest.evidenceRefs.includes('decision:vscode-cowork:acceptance:read-visible-text'));
    assert.ok(manifest.evidenceRefs.includes('text:vscode:visible-after'));
    assert.ok(manifest.releaseEvidenceRefs.includes('scoped-input-lease:current-vscode-cowork:acceptance'));
    assert.ok(manifest.releaseEvidenceRefs.includes('scoped-input-adapter:current-vscode-cowork:acceptance'));
    assert.ok(manifest.releaseEvidenceRefs.includes('cursor-marker:current-vscode-cowork:acceptance'));
    assert.ok(manifest.restorationEvidenceRefs.includes('front-app-restore:current-vscode-cowork:acceptance'));
    assert.ok(manifest.restorationEvidenceRefs.includes('mouse-position-restore:current-vscode-cowork:acceptance'));
    assert.equal(manifest.cleanup.inputLeaseReleased, true);
    assert.equal(manifest.cleanup.adapterReleased, true);
    assert.equal(manifest.cleanup.cursorReleased, true);
    assert.equal(manifest.cleanup.frontAppRestored, true);
    assert.equal(manifest.cleanup.mousePositionRestored, true);
    assert.equal(manifest.cleanup.userVSCodeProcessKilled, false);
    assert.equal(manifest.cleanup.userProfileCleared, false);
    assert.equal(manifest.hostProducerEvidence?.operation, 'read-visible-text');
    assert.ok(manifest.hostProducerEvidence?.agentHostInputRefs.includes('chat-request:vscode-cowork:acceptance'));
    assert.ok(manifest.hostProducerEvidence?.runtimeTruthRefs.includes('computer-use-session:current-vscode-cowork:acceptance'));
    assert.doesNotMatch(persistedText, /SECRET|example\.invalid|\/Users\/example|raw-|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
