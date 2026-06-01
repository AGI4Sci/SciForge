import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test from 'node:test';
import type { SciForgeSession } from '../domain';
import {
  appendUIActionAuditLog,
  commandTextForAskRef,
  commandTextForCapabilityPreference,
  commandTextForOpen,
  commandTextForRecover,
  commandTextForRerun,
  createApproveResultUIAction,
  compactUIActionPromptPreview,
  createCancelRunUIAction,
  createChatPanelActionUIAction,
  createCommandTextUIAction,
  createConcurrencyDecisionUIAction,
  createLoadArtifactPreviewUIAction,
  createOpenDebugAuditUIAction,
  createRequestRetryUIAction,
  createSelectObjectUIAction,
  createUIAction,
  createSubmitTurnUIAction,
  createTriggerRecoverUIAction,
  createUpdateCapabilityPreferenceUIAction,
  recordUIActionInSession,
  uiActionAuditLogForSession,
  uiActionReferenceRefs,
} from './uiActionBoundary';

const session: SciForgeSession = {
  schemaVersion: 2,
  sessionId: 'session-ui-action',
  scenarioId: 'literature-evidence-review',
  title: 'ui action boundary',
  createdAt: '2026-05-16T00:00:00.000Z',
  updatedAt: '2026-05-16T00:00:00.000Z',
  messages: [],
  runs: [],
  uiManifest: [],
  claims: [],
  executionUnits: [],
  artifacts: [],
  notebook: [],
  versions: [],
  hiddenResultSlotIds: [],
};

test('UIAction normalizes submit-turn write boundary metadata', () => {
  const action = createUIAction({
    id: 'ui-action-submit',
    session,
    createdAt: '2026-05-16T00:00:01.000Z',
    type: 'submit-turn',
    promptPreview: compactUIActionPromptPreview(`make report ${'with refs '.repeat(40)}`),
    referenceRefs: uiActionReferenceRefs([
      { id: 'ref-1', kind: 'task-result', ref: 'artifact:report', title: 'report' },
      { id: 'ref-2', kind: 'task-result', ref: 'artifact:report', title: 'report duplicate' },
    ]),
  });

  assert.equal(action.kind, 'UIAction');
  assert.equal(action.type, 'submit-turn');
  assert.equal(action.sessionId, 'session-ui-action');
  assert.deepEqual(action.referenceRefs, ['artifact:report']);
  assert.ok(action.promptPreview.endsWith('...'));
});

test('UIAction audit log is append-only and bounded', () => {
  const actions = Array.from({ length: 4 }, (_, index) => createUIAction({
    id: `ui-action-${index}`,
    session,
    createdAt: `2026-05-16T00:00:0${index}.000Z`,
    type: 'cancel-run',
    runId: `run-${index}`,
    rejectedGuidanceIds: [],
  }));

  const log = actions.reduce((current, action) => appendUIActionAuditLog(current, action, 2), [] as typeof actions);

  assert.deepEqual(log.map((action) => action.id), ['ui-action-2', 'ui-action-3']);
});

test('UIAction creators cover every final write intent and can be recorded on the session audit log', () => {
  const actions = [
    createCommandTextUIAction({
      id: 'ui-action-command',
      session,
      createdAt: '2026-05-16T00:00:59.000Z',
      source: 'recover',
      commandText: '/recover "run-failed" --with-evidence',
      runId: 'run-failed',
      auditRefs: ['audit:run', 'audit:run'],
    }),
    createSubmitTurnUIAction({
      id: 'ui-action-submit',
      session,
      createdAt: '2026-05-16T00:01:00.000Z',
      prompt: 'continue with projected refs',
      references: [{ id: 'ref-report', kind: 'task-result', ref: 'artifact:report', title: 'report' }],
    }),
    createTriggerRecoverUIAction({
      id: 'ui-action-recover',
      session,
      createdAt: '2026-05-16T00:01:01.000Z',
      runId: 'run-failed',
      recoverAction: 'Resume from projection refs and inspect audit first.',
      auditRefs: ['audit:run', 'audit:run'],
    }),
    createSelectObjectUIAction({
      id: 'ui-action-select',
      session,
      createdAt: '2026-05-16T00:01:01.100Z',
      objectRef: 'artifact:report',
      intent: 'ask-followup',
    }),
    createLoadArtifactPreviewUIAction({
      id: 'ui-action-load-preview',
      session,
      createdAt: '2026-05-16T00:01:01.200Z',
      artifactRef: 'artifact:large-report',
      byteLimit: 4096,
    }),
    createRequestRetryUIAction({
      id: 'ui-action-request-retry',
      session,
      createdAt: '2026-05-16T00:01:01.300Z',
      runId: 'run-failed',
      scope: 'with-repair-evidence',
      auditRefs: ['artifact:candidate', 'artifact:candidate'],
    }),
    createApproveResultUIAction({
      id: 'ui-action-approve',
      session,
      createdAt: '2026-05-16T00:01:01.400Z',
      runId: 'run-candidate',
      approval: 'reject-result',
      note: 'needs verification before final answer',
    }),
    createUpdateCapabilityPreferenceUIAction({
      id: 'ui-action-capability',
      session,
      createdAt: '2026-05-16T00:01:01.500Z',
      preference: { prefer: 'web_search', apiKey: 'SHOULD_NOT_PERSIST' },
    }),
    createCancelRunUIAction({
      id: 'ui-action-cancel',
      session,
      createdAt: '2026-05-16T00:01:02.000Z',
      runId: 'run-active',
      rejectedGuidanceIds: ['guidance-1', 'guidance-1'],
    }),
    createConcurrencyDecisionUIAction({
      id: 'ui-action-concurrency',
      session,
      createdAt: '2026-05-16T00:01:03.000Z',
      activeRunId: 'run-active',
      decision: 'queue-guidance',
      prompt: 'add one more constraint',
    }),
    createOpenDebugAuditUIAction({
      id: 'ui-action-audit',
      session,
      createdAt: '2026-05-16T00:01:04.000Z',
      runId: 'run-active',
      auditRefs: ['execution-unit:EU-1', 'execution-unit:EU-1'],
    }),
    createChatPanelActionUIAction({
      id: 'ui-action-chat-action',
      session,
      createdAt: '2026-05-16T00:01:05.000Z',
      action: 'copy-messages',
      effect: 'clipboard',
      commandText: '/chat copy --messages --semantic-transcript',
      copiedTextKind: 'messages',
      auditRefs: ['chat-action:copy-messages', 'chat-action:copy-messages'],
    }),
  ];

  const sessionWithLog = actions.reduce((current, action) => recordUIActionInSession(current, action, 16), session);
  const log = uiActionAuditLogForSession(sessionWithLog);

  assert.deepEqual(log.map((action) => action.type), [
    'command-text',
    'submit-turn',
    'trigger-recover',
    'select-object',
    'load-artifact-preview',
    'request-retry',
    'approve-result',
    'update-capability-preference',
    'cancel-run',
    'concurrency-decision',
    'open-debug-audit',
    'chat-panel-action',
  ]);
  assert.deepEqual(log[0].type === 'command-text' ? log[0].auditRefs : [], ['audit:run']);
  assert.deepEqual(log[2].type === 'trigger-recover' ? log[2].auditRefs : [], ['audit:run']);
  assert.equal(log[3].type === 'select-object' ? log[3].intent : '', 'ask-followup');
  assert.equal(log[4].type === 'load-artifact-preview' ? log[4].byteLimit : 0, 4096);
  assert.deepEqual(log[5].type === 'request-retry' ? log[5].auditRefs : [], ['artifact:candidate']);
  assert.equal(log[6].type === 'approve-result' ? log[6].approval : '', 'reject-result');
  assert.deepEqual(log[7].type === 'update-capability-preference' ? log[7].preference : {}, { prefer: 'web_search' });
  assert.deepEqual(log[8].type === 'cancel-run' ? log[8].rejectedGuidanceIds : [], ['guidance-1']);
  assert.deepEqual(log[10].type === 'open-debug-audit' ? log[10].auditRefs : [], ['execution-unit:EU-1']);
  assert.equal(log[11].type === 'chat-panel-action' ? log[11].action : '', 'copy-messages');
  assert.deepEqual(log[11].type === 'chat-panel-action' ? log[11].auditRefs : [], ['chat-action:copy-messages']);
});

test('commandText generators produce terminal-equivalent text for GUI affordances', () => {
  assert.equal(commandTextForAskRef('artifact:report', 'Summarize it'), 'ask --ref "artifact:report" "Summarize it"');
  assert.equal(commandTextForOpen('.sciforge/artifacts/report.md'), 'open ".sciforge/artifacts/report.md"');
  assert.equal(commandTextForOpen('.sciforge/artifacts', { reveal: true }), 'open --reveal ".sciforge/artifacts"');
  assert.equal(
    commandTextForRerun({ runId: 'run-1', scope: 'with-repair-evidence', reason: 'missing refs', auditRefs: ['artifact:report'] }),
    '/rerun "run-1" --with-repair-evidence --reason "missing refs" --ref "artifact:report"',
  );
  assert.equal(
    commandTextForRecover({ runId: 'run-2', recoverAction: 'Import and verify candidate artifacts.', auditRefs: ['artifact:partial-report'] }),
    '/recover "run-2" --with-evidence --action "Import and verify candidate artifacts." --ref "artifact:partial-report"',
  );
  assert.equal(
    commandTextForCapabilityPreference({ prefer: ['literature.search', 'pdf.extract'], apiKey: 'SHOULD_NOT_LEAK' }),
    '/capabilities plan --prefer "literature.search" "pdf.extract"',
  );
});

test('model picker preferences are declared public intents rather than provider config', () => {
  const action = createUpdateCapabilityPreferenceUIAction({
    id: 'ui-action-model-intent',
    session,
    createdAt: '2026-05-16T00:02:00.000Z',
    preference: {
      intent: 'composer-model-selection',
      source: 'composer-model-menu',
      modelIntentId: 'assistant-fast',
      publicLabel: 'Assistant Fast',
      mode: 'assistant',
      capabilityTier: 'fast',
      provider: 'SHOULD_NOT_PERSIST',
      modelName: 'SHOULD_NOT_PERSIST',
      baseUrl: 'https://provider.example/private',
      apiKey: 'SHOULD_NOT_PERSIST',
      token: 'SHOULD_NOT_PERSIST',
    },
  });

  assert.equal(action.type, 'update-capability-preference');
  assert.deepEqual(action.preference, {
    intent: 'composer-model-selection',
    source: 'composer-model-menu',
    modelIntentId: 'assistant-fast',
    publicLabel: 'Assistant Fast',
    mode: 'assistant',
    capabilityTier: 'fast',
  });
});

test('capability command text only uses native discovery verbs', () => {
  const commands = [
    commandTextForCapabilityPreference({ prefer: ['literature.search', 'pdf.extract'] }),
    commandTextForCapabilityPreference({ request: 'explain discovery readiness' }),
  ];

  for (const command of commands) {
    const verb = /^\/capabilities\s+(\S+)/.exec(command)?.[1];
    assert.ok(['search', 'expand', 'plan', 'explain'].includes(verb ?? ''), command);
  }
});

test('UI action boundary is the only app-level creator surface for final write intents', async () => {
  const files = await collectAppSourceFiles(join(process.cwd(), 'src/ui/src/app'));
  const sourceByFile = new Map<string, string>();
  for (const file of files) sourceByFile.set(relative(process.cwd(), file).replaceAll('\\', '/'), await readFile(file, 'utf8'));

  const chatPanel = sourceByFile.get('src/ui/src/app/ChatPanel.tsx') ?? '';
  const resultsRenderer = sourceByFile.get('src/ui/src/app/ResultsRenderer.tsx') ?? '';
  assert.match(chatPanel, /createSubmitTurnUIAction/);
  assert.match(chatPanel, /createCancelRunUIAction/);
  assert.match(chatPanel, /createConcurrencyDecisionUIAction/);
  assert.match(chatPanel, /createChatPanelActionUIAction/);
  assert.match(resultsRenderer, /requestRecoverCommandTextAction/);
  assert.doesNotMatch(resultsRenderer, /requestRecoverActionThroughUserActionApi/);
  assert.match(resultsRenderer, /requestOpenDebugAuditThroughUserActionApi/);

  const illegalDirectActionCreates = [...sourceByFile.entries()]
    .filter(([file]) => file !== 'src/ui/src/app/uiActionBoundary.ts' && file !== 'src/ui/src/app/uiActionBoundary.test.ts')
    .flatMap(([file, source]) => source.match(/\bcreateUIAction\s*\(/g)?.map((match) => `${file}:${match}`) ?? []);
  assert.deepEqual(illegalDirectActionCreates, [], 'components must use typed UIAction creators instead of ad hoc UIAction construction');

  const directKernelWrites = [...sourceByFile.entries()]
    .flatMap(([file, source]) => {
      const hits = source.match(/\b(?:createWorkspaceKernel|appendEvent|registerRef)\s*\(/g) ?? [];
      return hits.map((hit) => `${file}:${hit}`);
    });
  assert.deepEqual(directKernelWrites, [], 'UI app code must not write Workspace Kernel directly; write intents go through UIAction');
});

async function collectAppSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectAppSourceFiles(path);
    if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) return [path];
    return [];
  }));
  return nested.flat();
}
