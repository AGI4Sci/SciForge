import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV,
} from '../../../packages/actions/computer-use/vscode-cowork-live-diagnostic.js';
import {
  runCurrentVSCodeCoWorkInsertDraftLiveAcceptance,
} from './agent-host-vscode-cowork-current-insert-draft-live-acceptance.js';

test('current VSCode co-work insert-draft live acceptance writes blocked manifest without explicit env', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-current-vscode-insert-draft-live-blocked-'));
  try {
    let runnerCalled = false;
    const manifest = await runCurrentVSCodeCoWorkInsertDraftLiveAcceptance({
      workspacePath: workspace,
      outputDir: join(workspace, 'out'),
      env: {},
      draftTextRef: 'text-ref:current-vscode-cowork:draft:p9c',
      resolveDraftTextRef: () => 'private draft body hidden behind text ref',
      now: () => new Date('2026-06-08T00:00:00.000Z'),
      runInsertDraftLiveDiagnostic: async () => {
        runnerCalled = true;
        throw new Error('insert runner should not run without env');
      },
    });
    const persisted = JSON.parse(await readFile(join(workspace, 'out', 'manifest.json'), 'utf8')) as typeof manifest;

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.equal(manifest.productReady, false);
    assert.equal(manifest.maturity, 'live-diagnostic');
    assert.equal(manifest.operation, 'insert-draft');
    assert.equal(manifest.draftTextRef, 'text-ref:current-vscode-cowork:draft:p9c');
    assert.equal(manifest.userProfileUsed, true);
    assert.equal(manifest.sharedSystemInputUsed, true);
    assert.equal(manifest.vscodeLaunched, false);
    assert.equal(manifest.userVSCodeKilled, false);
    assert.equal(manifest.userProfileCleared, false);
    assert.deepEqual(manifest.primitiveChainObserved, []);
    assert.ok(manifest.blockedReasons.includes(`missing-env:${VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV}`));
    assert.equal(persisted.status, 'blocked');
    assert.equal(runnerCalled, false);
    assert.doesNotMatch(JSON.stringify(persisted), /draft body|raw-|providerPayload|base64|secret|token|product-ready|kill-vscode|clear-profile/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('current VSCode co-work insert-draft live acceptance passes private draft resolver without leaking raw text', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-current-vscode-insert-draft-live-resolver-'));
  try {
    const privateDraft = 'private draft body that must stay out of public artifacts';
    let resolvedDraft: string | undefined;
    const manifest = await runCurrentVSCodeCoWorkInsertDraftLiveAcceptance({
      workspacePath: workspace,
      outputDir: join(workspace, 'out'),
      env: {
        [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
      },
      draftTextRef: 'text-ref:current-vscode-cowork:draft:p9c',
      now: () => new Date('2026-06-08T00:00:00.000Z'),
      resolveDraftTextRef: (textRef) => textRef === 'text-ref:current-vscode-cowork:draft:p9c'
        ? privateDraft
        : undefined,
      runInsertDraftLiveDiagnostic: async (input) => {
        resolvedDraft = await input.resolveTextRef?.('text-ref:current-vscode-cowork:draft:p9c');
        return {
          status: 'blocked',
          message: 'synthetic resolver assertion run',
          maturity: 'live-diagnostic',
          productReady: false,
          primitiveChainObserved: [],
          evidenceRefs: ['text-ref:current-vscode-cowork:draft:p9c'],
          cleanupRefs: [],
        };
      },
    });
    const persistedText = await readFile(join(workspace, 'out', 'manifest.json'), 'utf8');

    assert.equal(resolvedDraft, privateDraft);
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.draftTextRef, 'text-ref:current-vscode-cowork:draft:p9c');
    assert.doesNotMatch(persistedText, /private draft body|raw-|providerPayload|base64|secret|token/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('current VSCode co-work insert-draft live acceptance blocks before desktop without private draft resolver', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-current-vscode-insert-draft-live-no-resolver-'));
  try {
    let runnerCalled = false;
    const manifest = await runCurrentVSCodeCoWorkInsertDraftLiveAcceptance({
      workspacePath: workspace,
      outputDir: join(workspace, 'out'),
      env: {
        [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
      },
      draftTextRef: 'text-ref:current-vscode-cowork:draft:p9c',
      now: () => new Date('2026-06-08T00:00:00.000Z'),
      runInsertDraftLiveDiagnostic: async () => {
        runnerCalled = true;
        throw new Error('runner should not touch desktop without private resolver');
      },
    });

    assert.equal(runnerCalled, false);
    assert.equal(manifest.status, 'blocked');
    assert.ok(manifest.blockedReasons.includes('missing-private-draft-text-resolver'));
    assert.equal(manifest.cleanup.inputLeaseReleased, false);
    assert.equal(manifest.cleanup.adapterReleased, false);
    assert.equal(manifest.cleanup.cursorReleased, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('current VSCode co-work insert-draft live acceptance blocks completed runner without focused editor evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-current-vscode-insert-draft-live-no-focused-editor-'));
  try {
    const manifest = await runCurrentVSCodeCoWorkInsertDraftLiveAcceptance({
      workspacePath: workspace,
      outputDir: join(workspace, 'out'),
      env: {
        [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
      },
      draftTextRef: 'text-ref:current-vscode-cowork:draft:p9c',
      resolveDraftTextRef: (textRef) => textRef === 'text-ref:current-vscode-cowork:draft:p9c'
        ? 'private draft body for injected runner'
        : undefined,
      now: () => new Date('2026-06-08T00:00:00.000Z'),
      runInsertDraftLiveDiagnostic: async () => ({
        status: 'completed',
        message: 'Current VSCode insert-draft live diagnostic completed one refs-first act.',
        maturity: 'live-diagnostic',
        productReady: false,
        primitiveChainObserved: ['bind', 'observe', 'host-decision', 'act', 'observe', 'control(release)'],
        evidenceRefs: [
          'computer-use-session:current-vscode-cowork:insert-acceptance',
          'window-action-session:current-vscode-cowork:insert-acceptance',
          'window:vscode:paper',
          'file-ref:vscode:paper',
          'observation:vscode:before-insert',
          'observation:vscode:after-insert',
          'image:vscode:before-insert',
          'image:vscode:after-insert',
          'accessibility:vscode:before-insert',
          'accessibility:vscode:after-insert',
          'text:vscode:visible-before-insert',
          'text:vscode:visible-after-insert',
          'element:vscode:editor',
          'freshness:vscode:before-insert',
          'freshness:vscode:after-insert',
          'decision:vscode-cowork:insert-acceptance:insert-draft',
          'text-ref:current-vscode-cowork:draft:p9c',
          'action:current-vscode-cowork:insert-acceptance:insert-draft',
          'executor-event:current-vscode-cowork:insert-acceptance:insert-draft',
          'input-event:current-vscode-cowork:insert-acceptance:insert-draft',
          'stale-invalidation:current-vscode-cowork:insert-acceptance:insert-draft',
        ],
        cleanupRefs: [
          'scoped-input-lease:current-vscode-cowork:insert-acceptance',
          'scoped-input-adapter:current-vscode-cowork:insert-acceptance',
          'cursor-marker:current-vscode-cowork:insert-acceptance',
          'front-app-restore:current-vscode-cowork:insert-acceptance',
          'mouse-position-restore:current-vscode-cowork:insert-acceptance',
        ],
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'vscode-cowork-live-diagnostic',
          intentText: 'private intent omitted from manifest assertions',
          singleTurnOverride: false,
          refs: [
            'intent:current-vscode-cowork',
            'chat-request:vscode-cowork:insert-acceptance',
            'window:vscode:paper',
            'observation:vscode:before-insert',
            'text-ref:current-vscode-cowork:draft:p9c',
          ],
          readiness: {},
          target: {
            kind: 'current-vscode-cowork',
            refs: ['window:vscode:paper', 'file-ref:vscode:paper'],
            vscodeCoWork: {
              operation: 'insert-draft',
              draftTextRef: 'text-ref:current-vscode-cowork:draft:p9c',
            },
          },
          observation: {
            fresh: true,
            refs: ['observation:vscode:before-insert', 'text:vscode:visible-before-insert'],
          },
          permissions: {
            refs: ['permission:current-vscode-cowork:full-access:window-action-session:current-vscode-cowork:insert-acceptance:file-ref:vscode:paper'],
            scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
            stopCancelPath: true,
          },
        },
        runtimeTruth: {
          schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
          source: 'vscode-cowork-live-diagnostic',
          target: {
            bound: true,
            refs: ['window:vscode:paper', 'file-ref:vscode:paper'],
          },
          observation: {
            fresh: true,
            refs: ['observation:vscode:after-insert', 'text:vscode:visible-after-insert'],
          },
          permissions: {
            refs: ['permission:current-vscode-cowork:full-access:window-action-session:current-vscode-cowork:insert-acceptance:file-ref:vscode:paper'],
            permissionRefs: ['permission:current-vscode-cowork:full-access:window-action-session:current-vscode-cowork:insert-acceptance:file-ref:vscode:paper'],
            scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
            stopCancelPath: true,
          },
          sessions: {
            sessionReadyRefs: [
              'computer-use-session:current-vscode-cowork:insert-acceptance',
              'window-action-session:current-vscode-cowork:insert-acceptance',
              'scoped-input-lease:current-vscode-cowork:insert-acceptance',
            ],
            targetRefs: ['window:vscode:paper'],
            inputLeaseRefs: ['scoped-input-lease:current-vscode-cowork:insert-acceptance'],
            observationRefs: ['observation:vscode:after-insert'],
          },
          adapter: {
            refs: ['scoped-input-adapter:current-vscode-cowork:insert-acceptance'],
            inputIsolation: {
              refsOnly: true,
              refs: [
                'scoped-input-lease:current-vscode-cowork:insert-acceptance',
                'cursor-marker:current-vscode-cowork:insert-acceptance',
              ],
            },
          },
          refs: [
            'intent:current-vscode-cowork',
            'window:vscode:paper',
            'observation:vscode:after-insert',
            'computer-use-session:current-vscode-cowork:insert-acceptance',
          ],
        },
        agentHostFinalAnswer: {
          schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
          source: 'codex-agent-host-vscode-cowork-live-diagnostic',
          status: 'completed',
          text: 'Host completed one current VSCode insert-draft act from refs-first evidence.',
          maturity: 'live-diagnostic',
          productReady: false,
          hostOwnsFinalAnswer: true,
          computerUseCorePlanning: false,
          primitiveChainObserved: ['bind', 'observe', 'host-decision', 'act', 'observe', 'control(release)'],
          evidenceRefs: ['action:current-vscode-cowork:insert-acceptance:insert-draft', 'observation:vscode:after-insert'],
          cleanupRefs: ['scoped-input-lease:current-vscode-cowork:insert-acceptance'],
        },
      }),
    });

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.ok(manifest.blockedReasons.includes('missing-focused-editor-ref'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('current VSCode co-work insert-draft live acceptance blocks completed runner without mutation verifier evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-current-vscode-insert-draft-live-no-verifier-'));
  try {
    const manifest = await runCurrentVSCodeCoWorkInsertDraftLiveAcceptance({
      workspacePath: workspace,
      outputDir: join(workspace, 'out'),
      env: {
        [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
      },
      draftTextRef: 'text-ref:current-vscode-cowork:draft:p9c',
      resolveDraftTextRef: (textRef) => textRef === 'text-ref:current-vscode-cowork:draft:p9c'
        ? 'private draft body for injected runner'
        : undefined,
      now: () => new Date('2026-06-08T00:00:00.000Z'),
      runInsertDraftLiveDiagnostic: async () => ({
        status: 'completed',
        message: 'Current VSCode insert-draft live diagnostic completed one refs-first act.',
        maturity: 'live-diagnostic',
        productReady: false,
        primitiveChainObserved: ['bind', 'observe', 'host-decision', 'act', 'observe', 'control(release)'],
        evidenceRefs: [
          'computer-use-session:current-vscode-cowork:insert-acceptance',
          'window-action-session:current-vscode-cowork:insert-acceptance',
          'window:vscode:paper',
          'file-ref:vscode:paper',
          'observation:vscode:before-insert',
          'observation:vscode:after-insert',
          'image:vscode:before-insert',
          'image:vscode:after-insert',
          'accessibility:vscode:before-insert',
          'accessibility:vscode:after-insert',
          'text:vscode:visible-before-insert',
          'text:vscode:visible-after-insert',
          'element:vscode:editor',
          'focused-editor:vscode:insert-acceptance',
          'freshness:vscode:before-insert',
          'freshness:vscode:after-insert',
          'decision:vscode-cowork:insert-acceptance:insert-draft',
          'text-ref:current-vscode-cowork:draft:p9c',
          'action:current-vscode-cowork:insert-acceptance:insert-draft',
          'executor-event:current-vscode-cowork:insert-acceptance:insert-draft',
          'input-event:current-vscode-cowork:insert-acceptance:insert-draft',
          'stale-invalidation:current-vscode-cowork:insert-acceptance:insert-draft',
        ],
        cleanupRefs: [
          'scoped-input-lease:current-vscode-cowork:insert-acceptance',
          'scoped-input-adapter:current-vscode-cowork:insert-acceptance',
          'cursor-marker:current-vscode-cowork:insert-acceptance',
          'front-app-restore:current-vscode-cowork:insert-acceptance',
          'mouse-position-restore:current-vscode-cowork:insert-acceptance',
        ],
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'vscode-cowork-live-diagnostic',
          intentText: 'private intent omitted from manifest assertions',
          singleTurnOverride: false,
          refs: [
            'intent:current-vscode-cowork',
            'chat-request:vscode-cowork:insert-acceptance',
            'window:vscode:paper',
            'observation:vscode:before-insert',
            'focused-editor:vscode:insert-acceptance',
            'text-ref:current-vscode-cowork:draft:p9c',
          ],
          readiness: {},
          target: {
            kind: 'current-vscode-cowork',
            refs: ['window:vscode:paper', 'file-ref:vscode:paper'],
            vscodeCoWork: {
              operation: 'insert-draft',
              draftTextRef: 'text-ref:current-vscode-cowork:draft:p9c',
            },
          },
          observation: {
            fresh: true,
            refs: ['observation:vscode:before-insert', 'text:vscode:visible-before-insert', 'focused-editor:vscode:insert-acceptance'],
          },
          permissions: {
            refs: ['permission:current-vscode-cowork:full-access:window-action-session:current-vscode-cowork:insert-acceptance:file-ref:vscode:paper'],
            scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
            stopCancelPath: true,
          },
        },
        runtimeTruth: {
          schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
          source: 'vscode-cowork-live-diagnostic',
          target: {
            bound: true,
            refs: ['window:vscode:paper', 'file-ref:vscode:paper'],
          },
          observation: {
            fresh: true,
            refs: ['observation:vscode:after-insert', 'text:vscode:visible-after-insert', 'focused-editor:vscode:insert-acceptance'],
          },
          permissions: {
            refs: ['permission:current-vscode-cowork:full-access:window-action-session:current-vscode-cowork:insert-acceptance:file-ref:vscode:paper'],
            permissionRefs: ['permission:current-vscode-cowork:full-access:window-action-session:current-vscode-cowork:insert-acceptance:file-ref:vscode:paper'],
            scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
            stopCancelPath: true,
          },
          sessions: {
            sessionReadyRefs: [
              'computer-use-session:current-vscode-cowork:insert-acceptance',
              'window-action-session:current-vscode-cowork:insert-acceptance',
              'scoped-input-lease:current-vscode-cowork:insert-acceptance',
            ],
            targetRefs: ['window:vscode:paper'],
            inputLeaseRefs: ['scoped-input-lease:current-vscode-cowork:insert-acceptance'],
            observationRefs: ['observation:vscode:after-insert', 'focused-editor:vscode:insert-acceptance'],
          },
          adapter: {
            refs: ['scoped-input-adapter:current-vscode-cowork:insert-acceptance'],
            inputIsolation: {
              refsOnly: true,
              refs: [
                'scoped-input-lease:current-vscode-cowork:insert-acceptance',
                'cursor-marker:current-vscode-cowork:insert-acceptance',
              ],
            },
          },
          refs: [
            'intent:current-vscode-cowork',
            'window:vscode:paper',
            'observation:vscode:after-insert',
            'focused-editor:vscode:insert-acceptance',
            'computer-use-session:current-vscode-cowork:insert-acceptance',
          ],
        },
        agentHostFinalAnswer: {
          schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
          source: 'codex-agent-host-vscode-cowork-live-diagnostic',
          status: 'completed',
          text: 'Host completed one current VSCode insert-draft act from refs-first evidence.',
          maturity: 'live-diagnostic',
          productReady: false,
          hostOwnsFinalAnswer: true,
          computerUseCorePlanning: false,
          primitiveChainObserved: ['bind', 'observe', 'host-decision', 'act', 'observe', 'control(release)'],
          evidenceRefs: ['action:current-vscode-cowork:insert-acceptance:insert-draft', 'observation:vscode:after-insert', 'focused-editor:vscode:insert-acceptance'],
          cleanupRefs: ['scoped-input-lease:current-vscode-cowork:insert-acceptance'],
        },
      }),
    });

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.ok(manifest.blockedReasons.includes('missing-mutation-verifier-ref'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('current VSCode co-work insert-draft live acceptance persists action and cleanup refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-current-vscode-insert-draft-live-'));
  try {
    const runnerCalls: Array<{ commandText?: string; draftTextRef?: string; activateCurrentVSCodeIfNeeded?: boolean }> = [];
    const manifest = await runCurrentVSCodeCoWorkInsertDraftLiveAcceptance({
      workspacePath: workspace,
      outputDir: join(workspace, 'out'),
      env: {
        [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
      },
      draftTextRef: 'text-ref:current-vscode-cowork:draft:p9c',
      resolveDraftTextRef: (textRef) => textRef === 'text-ref:current-vscode-cowork:draft:p9c'
        ? 'private draft body for injected runner'
        : undefined,
      activateCurrentVSCodeIfNeeded: true,
      now: () => new Date('2026-06-08T00:00:00.000Z'),
      runInsertDraftLiveDiagnostic: async (input) => {
        runnerCalls.push({
          commandText: input.commandText,
          draftTextRef: input.draftTextRef,
          activateCurrentVSCodeIfNeeded: input.activateCurrentVSCodeIfNeeded,
        });
        return {
          status: 'completed',
          message: 'Current VSCode insert-draft live diagnostic completed one refs-first act.',
          maturity: 'live-diagnostic',
          productReady: false,
          primitiveChainObserved: ['bind', 'observe', 'host-decision', 'act', 'observe', 'control(release)'],
          evidenceRefs: [
            'computer-use-session:current-vscode-cowork:insert-acceptance',
            'window-action-session:current-vscode-cowork:insert-acceptance',
            'window:vscode:paper',
            'observation:vscode:before-insert',
            'observation:vscode:after-insert',
            'image:vscode:before-insert',
            'image:vscode:after-insert',
            'accessibility:vscode:before-insert',
            'accessibility:vscode:after-insert',
            'text:vscode:visible-before-insert',
            'text:vscode:visible-after-insert',
            'element:vscode:editor',
            'focused-editor:vscode:insert-acceptance',
            'verifier:current-vscode-cowork:insert-acceptance:insert-draft',
            'freshness:vscode:before-insert',
            'freshness:vscode:after-insert',
            'decision:vscode-cowork:insert-acceptance:insert-draft',
            'text-ref:current-vscode-cowork:draft:p9c',
            'action:current-vscode-cowork:insert-acceptance:insert-draft',
            'executor-event:current-vscode-cowork:insert-acceptance:insert-draft',
            'input-event:current-vscode-cowork:insert-acceptance:insert-draft',
            'stale-invalidation:current-vscode-cowork:insert-acceptance:insert-draft',
            'raw-providerPayload:SECRET_SHOULD_NOT_LEAK',
          ],
          cleanupRefs: [
            'scoped-input-lease:current-vscode-cowork:insert-acceptance',
            'scoped-input-adapter:current-vscode-cowork:insert-acceptance',
            'cursor-marker:current-vscode-cowork:insert-acceptance',
            'front-app-restore:current-vscode-cowork:insert-acceptance',
            'mouse-position-restore:current-vscode-cowork:insert-acceptance',
            'raw-cleanup-ref:SECRET_SHOULD_NOT_LEAK',
          ],
          agentHostInput: {
            schemaVersion: 'sciforge.codex-agent-host-input.v1',
            source: 'vscode-cowork-live-diagnostic',
            intentText: 'SECRET raw intent should stay private.',
            singleTurnOverride: false,
            refs: [
              'intent:current-vscode-cowork',
              'chat-request:vscode-cowork:insert-acceptance',
              'window:vscode:paper',
              'observation:vscode:before-insert',
              'focused-editor:vscode:insert-acceptance',
              'text-ref:current-vscode-cowork:draft:p9c',
            ],
            readiness: {},
            target: {
              kind: 'current-vscode-cowork',
              refs: ['window:vscode:paper', 'file-ref:vscode:paper', '/Users/example/private-paper.md'],
              vscodeCoWork: {
                operation: 'insert-draft',
                draftTextRef: 'text-ref:current-vscode-cowork:draft:p9c',
              },
            },
            observation: {
              fresh: true,
              refs: ['observation:vscode:before-insert', 'text:vscode:visible-before-insert', 'focused-editor:vscode:insert-acceptance'],
            },
            permissions: {
              refs: ['permission:current-vscode-cowork:full-access:window-action-session:current-vscode-cowork:insert-acceptance:file-ref:vscode:paper'],
              scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
              stopCancelPath: true,
            },
          },
          runtimeTruth: {
            schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
            source: 'vscode-cowork-live-diagnostic',
            target: {
              bound: true,
              refs: ['window:vscode:paper', 'file-ref:vscode:paper', '/Users/example/private-paper.md'],
            },
            observation: {
              fresh: true,
              refs: ['observation:vscode:after-insert', 'text:vscode:visible-after-insert', 'focused-editor:vscode:insert-acceptance'],
            },
            permissions: {
              refs: ['permission:current-vscode-cowork:full-access:window-action-session:current-vscode-cowork:insert-acceptance:file-ref:vscode:paper'],
              permissionRefs: ['permission:current-vscode-cowork:full-access:window-action-session:current-vscode-cowork:insert-acceptance:file-ref:vscode:paper'],
              scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
              stopCancelPath: true,
            },
            sessions: {
              sessionReadyRefs: [
                'computer-use-session:current-vscode-cowork:insert-acceptance',
                'window-action-session:current-vscode-cowork:insert-acceptance',
                'scoped-input-lease:current-vscode-cowork:insert-acceptance',
              ],
              targetRefs: ['window:vscode:paper'],
              inputLeaseRefs: ['scoped-input-lease:current-vscode-cowork:insert-acceptance'],
              observationRefs: ['observation:vscode:after-insert', 'focused-editor:vscode:insert-acceptance'],
            },
            adapter: {
              refs: ['scoped-input-adapter:current-vscode-cowork:insert-acceptance'],
              inputIsolation: {
                refsOnly: true,
                refs: [
                  'scoped-input-lease:current-vscode-cowork:insert-acceptance',
                  'cursor-marker:current-vscode-cowork:insert-acceptance',
                ],
              },
            },
            refs: [
              'intent:current-vscode-cowork',
              'window:vscode:paper',
              'observation:vscode:after-insert',
              'focused-editor:vscode:insert-acceptance',
              'computer-use-session:current-vscode-cowork:insert-acceptance',
            ],
          },
          agentHostFinalAnswer: {
            schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
            source: 'codex-agent-host-vscode-cowork-live-diagnostic',
            status: 'completed',
            text: 'Host completed one current VSCode insert-draft act from refs-first evidence.',
            maturity: 'live-diagnostic',
            productReady: false,
            hostOwnsFinalAnswer: true,
            computerUseCorePlanning: false,
            primitiveChainObserved: ['bind', 'observe', 'host-decision', 'act', 'observe', 'control(release)'],
            evidenceRefs: [
              'action:current-vscode-cowork:insert-acceptance:insert-draft',
              'observation:vscode:after-insert',
              'focused-editor:vscode:insert-acceptance',
              'verifier:current-vscode-cowork:insert-acceptance:insert-draft',
            ],
            cleanupRefs: ['scoped-input-lease:current-vscode-cowork:insert-acceptance'],
            completionTruth: {
              schemaVersion: 'sciforge.computer-use.completion-truth.v1',
              scope: 'action',
              status: 'satisfied',
              validator: 'vscode-cowork-insert-draft-live-diagnostic',
              evidenceRefs: [
                'action:current-vscode-cowork:insert-acceptance:insert-draft',
                'verifier:current-vscode-cowork:insert-acceptance:insert-draft',
              ],
            },
          },
        };
      },
    });
    const persistedText = await readFile(join(workspace, 'out', 'manifest.json'), 'utf8');

    assert.equal(runnerCalls.length, 1);
    assert.equal(runnerCalls[0]?.commandText, '在我当前打开的 VSCode 文件里插入这段草稿。');
    assert.equal(runnerCalls[0]?.draftTextRef, 'text-ref:current-vscode-cowork:draft:p9c');
    assert.equal(runnerCalls[0]?.activateCurrentVSCodeIfNeeded, true);
    assert.equal(manifest.status, 'passed');
    assert.equal(manifest.passClaim, true);
    assert.equal(manifest.operation, 'insert-draft');
    assert.equal(manifest.draftTextRef, 'text-ref:current-vscode-cowork:draft:p9c');
    assert.equal(manifest.finalAnswer.hostOwnsFinalAnswer, true);
    assert.equal(manifest.finalAnswer.computerUseCorePlanning, false);
    assert.equal(manifest.finalAnswer.userTaskCompletionClaimed, false);
    assert.deepEqual(manifest.primitiveChainObserved, ['bind', 'observe', 'host-decision', 'act', 'observe', 'control(release)']);
    assert.ok(manifest.actionEvidenceRefs.includes('action:current-vscode-cowork:insert-acceptance:insert-draft'));
    assert.ok(manifest.actionEvidenceRefs.includes('executor-event:current-vscode-cowork:insert-acceptance:insert-draft'));
    assert.ok(manifest.actionEvidenceRefs.includes('input-event:current-vscode-cowork:insert-acceptance:insert-draft'));
    assert.ok(manifest.actionEvidenceRefs.includes('stale-invalidation:current-vscode-cowork:insert-acceptance:insert-draft'));
    assert.ok(manifest.evidenceRefs.includes('text-ref:current-vscode-cowork:draft:p9c'));
    assert.ok(manifest.evidenceRefs.includes('focused-editor:vscode:insert-acceptance'));
    assert.ok(manifest.mutationVerifierRefs.includes('verifier:current-vscode-cowork:insert-acceptance:insert-draft'));
    assert.ok(manifest.cleanup.inputLeaseReleased);
    assert.ok(manifest.cleanup.adapterReleased);
    assert.ok(manifest.cleanup.cursorReleased);
    assert.ok(manifest.cleanup.frontAppRestored);
    assert.ok(manifest.cleanup.mousePositionRestored);
    assert.equal(manifest.cleanup.userVSCodeProcessKilled, false);
    assert.equal(manifest.cleanup.userProfileCleared, false);
    assert.equal(manifest.hostProducerEvidence?.operation, 'insert-draft');
    assert.ok(manifest.hostProducerEvidence?.agentHostInputRefs.includes('chat-request:vscode-cowork:insert-acceptance'));
    assert.doesNotMatch(persistedText, /SECRET|example\.invalid|\/Users\/example|draft body|raw-|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
