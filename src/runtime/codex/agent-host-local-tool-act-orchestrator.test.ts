import assert from 'node:assert/strict';
import test from 'node:test';

import { createModuleDescription } from '../../../packages/contracts/runtime/modules.js';
import { evaluateAgentHostLocalToolAct } from './agent-host-local-tool-act-orchestrator.js';

test('Agent Host local tool Act policy allows describe query and read without side-effect approval', () => {
  for (const toolName of ['module.describe', 'module.query', 'module.read']) {
    const decision = evaluateAgentHostLocalToolAct({
      toolName,
      args: {
        moduleId: 'memory',
        ref: 'memory:project/notes',
        evidenceRefs: ['memory:project/notes', 'gui.present:fake'],
      },
      commandId: 'codex-command-local-tool-read',
      attemptId: 'attempt-1',
    });
    assert.equal(decision.status, 'auto', toolName);
    assert.doesNotMatch(JSON.stringify(decision), /gui\.present/);
    assert.ok(decision.evidenceRefs.some((ref) => ref.startsWith('runtime-truth:local-tool-act-policy/')));
  }
});

test('Agent Host local tool Act policy requires confirmation for workspace mutation intents', () => {
  const decision = evaluateAgentHostLocalToolAct({
    toolName: 'module.invoke',
    args: {
      moduleId: 'files',
      intent: 'write',
      input: { path: 'notes.md', content: 'draft' },
    },
    moduleDescription: createModuleDescription({
      moduleId: 'files',
      title: 'Files',
      summary: 'Workspace files.',
      intents: [{ name: 'write', sideEffect: 'workspace', requiresApproval: true }],
      facets: { approval: true, refs: true },
    }),
    commandId: 'codex-command-local-tool-write',
    attemptId: 'attempt-1',
  });

  assert.equal(decision.status, 'needs-confirmation');
  assert.match(decision.reason, /approval/i);
  assert.deepEqual(decision.approvalRequest, {
    moduleId: 'files',
    intent: 'write',
    sideEffect: 'workspace',
    reason: 'approval_required',
  });
});

test('Agent Host local tool Act policy blocks legacy Computer Use bounded operations', () => {
  const decision = evaluateAgentHostLocalToolAct({
    toolName: 'module.invoke',
    args: {
      moduleId: 'computer_use',
      intent: 'executeBoundedOperation',
      input: {
        operationKind: 'computer_use.perform_local_action',
        ownerModuleId: 'computer_use',
      },
    },
    moduleDescription: createModuleDescription({
      moduleId: 'computer_use',
      title: 'computer_use',
      summary: 'Bounded operation module.',
      intents: [{ name: 'executeBoundedOperation', sideEffect: 'local', returnsOperation: true }],
      facets: { approval: true, refs: true },
    }),
    commandId: 'codex-command-computer-use-bounded',
    attemptId: 'attempt-1',
  });

  assert.equal(decision.status, 'blocked');
  assert.match(decision.reason, /Computer Use primitive runtime|legacy bounded/i);
});

test('Agent Host local tool Act policy allows approved workspace mutations only with runtime control path', () => {
  const decision = evaluateAgentHostLocalToolAct({
    toolName: 'module.invoke',
    args: {
      moduleId: 'files',
      intent: 'write',
      approvalToken: 'approved-turn-token',
    },
    moduleDescription: createModuleDescription({
      moduleId: 'files',
      title: 'Files',
      summary: 'Workspace files.',
      intents: [{ name: 'write', sideEffect: 'workspace', requiresApproval: true }],
      facets: { approval: true, refs: true },
    }),
    runtimeTruth: {
      schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
      permissions: {
        refs: ['permission:turn/files-write', 'gui.present:fake-permission'],
        stopCancelPath: true,
        controlPath: {
          ready: true,
          takeoverRefs: ['lease:human-takeover/local-tools'],
          pauseRefs: ['lease:human-takeover/local-tools/pause'],
          resumeRefs: ['lease:human-takeover/local-tools/resume'],
          stopRefs: ['lease:human-takeover/local-tools/stop'],
          cancelRefs: ['cancel:runtime-codex/local-tools/attempt-1', 'https://example.invalid/leak'],
        },
      },
    },
    commandId: 'codex-command-local-tool-approved-write',
    attemptId: 'attempt-1',
  });

  assert.equal(decision.status, 'auto');
  assert.match(decision.reason, /approved/i);
  assert.ok(decision.evidenceRefs.includes('permission:turn/files-write'));
  assert.ok(decision.evidenceRefs.includes('lease:human-takeover/local-tools/stop'));
  assert.doesNotMatch(JSON.stringify(decision), /gui\.present|https?:\/\//);
});

test('Agent Host local tool Act policy blocks generic actions.execute Computer Use execution', () => {
  const decision = evaluateAgentHostLocalToolAct({
    toolName: 'module.invoke',
    args: {
      moduleId: 'actions',
      intent: 'execute',
      approvalToken: 'approved-action-token',
    },
    moduleDescription: createModuleDescription({
      moduleId: 'actions',
      title: 'Actions',
      summary: 'Action execution.',
      intents: [{ name: 'execute', sideEffect: 'workspace', requiresApproval: true }],
      facets: { approval: true, refs: true },
    }),
    runtimeTruth: {
      schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
      permissions: { refs: ['permission:turn/actions'], stopCancelPath: true },
    },
    commandId: 'codex-command-local-tool-actions-execute',
    attemptId: 'attempt-1',
  });

  assert.equal(decision.status, 'blocked');
  assert.match(decision.reason, /Computer Use Guard/i);
  assert.doesNotMatch(JSON.stringify(decision), /approval-token|approved-action-token/);
});

test('Agent Host local tool Act policy blocks approved side effects without runtime control path', () => {
  const decision = evaluateAgentHostLocalToolAct({
    toolName: 'module.invoke',
    args: {
      moduleId: 'memory',
      intent: 'write',
      approvalToken: 'approved-memory-token',
    },
    moduleDescription: createModuleDescription({
      moduleId: 'memory',
      title: 'Memory',
      summary: 'Memory.',
      intents: [{ name: 'write', sideEffect: 'workspace', requiresApproval: true }],
      facets: { approval: true, refs: true },
    }),
    runtimeTruth: {
      schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
      permissions: { refs: ['permission:turn/memory-write'], stopCancelPath: false },
    },
    commandId: 'codex-command-local-tool-no-control',
    attemptId: 'attempt-1',
  });

  assert.equal(decision.status, 'blocked');
  assert.match(decision.reason, /control path/i);
});
