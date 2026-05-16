import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test from 'node:test';
import type { SciForgeSession } from '../domain';
import {
  appendUIActionAuditLog,
  compactUIActionPromptPreview,
  createCancelRunUIAction,
  createConcurrencyDecisionUIAction,
  createOpenDebugAuditUIAction,
  createUIAction,
  createSubmitTurnUIAction,
  createTriggerRecoverUIAction,
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
  ];

  const sessionWithLog = actions.reduce((current, action) => recordUIActionInSession(current, action, 8), session);
  const log = uiActionAuditLogForSession(sessionWithLog);

  assert.deepEqual(log.map((action) => action.type), [
    'submit-turn',
    'trigger-recover',
    'cancel-run',
    'concurrency-decision',
    'open-debug-audit',
  ]);
  assert.deepEqual(log[1].type === 'trigger-recover' ? log[1].auditRefs : [], ['audit:run']);
  assert.deepEqual(log[2].type === 'cancel-run' ? log[2].rejectedGuidanceIds : [], ['guidance-1']);
  assert.deepEqual(log[4].type === 'open-debug-audit' ? log[4].auditRefs : [], ['execution-unit:EU-1']);
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
  assert.match(resultsRenderer, /createTriggerRecoverUIAction/);
  assert.match(resultsRenderer, /createOpenDebugAuditUIAction/);

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
