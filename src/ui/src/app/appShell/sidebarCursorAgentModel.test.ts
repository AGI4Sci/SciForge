import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SIDEBAR_CURSOR_AGENT_REGION_REF,
  buildSidebarCursorAgentProjection,
  collectSidebarCursorAgentActions,
  type SidebarCursorAgentProjection,
} from './sidebarCursorAgentModel';

const internalTerms = /provider|model|profile|runtime|raw JSONL|stdout|stderr|ExecutionUnit|run-internal|codex-command|workspace command/i;

test('seed-only and empty sessions become draft threads', () => {
  const projection = buildSidebarCursorAgentProjection({
    workspace: { id: 'lab', path: '/tmp/lab' },
    projects: [{
      id: 'project-a',
      label: 'Project A',
      current: true,
      threads: [{
        sessionId: 'seed-session',
        messages: [{ id: 'seed-1', role: 'scenario', content: 'provider model runtime bootstrap' }],
      }, {
        sessionId: 'empty-session',
        messages: [],
      }],
    }],
  });

  const threads = projection.groups[0]?.threads ?? [];
  assert.equal(threads.length, 2);
  assert.deepEqual(threads.map((thread) => thread.state), ['draft', 'draft']);
  assert.deepEqual(threads.map((thread) => thread.badges), [['Draft'], ['Draft']]);
  assert.ok(threads.every((thread) => thread.title === 'New chat'));
  assert.ok(threads.every((thread) => thread.actions.some((action) => action.intent === 'discard-thread' && action.commandText)));
  assert.ok(threads.every((thread) => thread.actions.every((action) => action.intent !== 'archive-thread')));
});

test('thread projection exposes done running failed blocked draft archive and discard states', () => {
  const projection = buildSidebarCursorAgentProjection({
    workspace: { id: 'lab', path: '/tmp/lab' },
    projects: [{
      id: 'project-a',
      label: 'Project A',
      threads: [{
        sessionId: 'legacy-active',
        title: 'Legacy active alias',
        state: 'active',
      }, {
        sessionId: 'running-thread',
        title: 'Running thread',
        state: 'running',
      }, {
        sessionId: 'failed-thread',
        title: 'Failed thread',
        state: 'failed',
      }, {
        sessionId: 'blocked-thread',
        title: 'Blocked thread',
        state: 'blocked',
      }, {
        sessionId: 'draft-thread',
        title: 'Draft thread',
        state: 'draft',
      }, {
        sessionId: 'archived-thread',
        title: 'Archived thread',
        archived: true,
      }, {
        sessionId: 'discarded-thread',
        title: 'Discarded thread',
        discarded: true,
      }],
    }],
  });

  const threads = projection.groups[0]?.threads ?? [];
  const byTitle = new Map(threads.map((thread) => [thread.title, thread]));

  assert.equal(byTitle.get('Legacy active alias')?.state, 'done');
  assert.equal(byTitle.get('Running thread')?.state, 'running');
  assert.equal(byTitle.get('Failed thread')?.state, 'failed');
  assert.equal(byTitle.get('Blocked thread')?.state, 'blocked');
  assert.equal(byTitle.get('Draft thread')?.state, 'draft');
  assert.equal(byTitle.get('Archived thread')?.state, 'archived');
  assert.equal(byTitle.get('Discarded thread')?.state, 'discarded');
  assert.deepEqual(byTitle.get('Running thread')?.badges, ['Running']);
  assert.deepEqual(byTitle.get('Failed thread')?.badges, ['Failed']);
  assert.deepEqual(byTitle.get('Blocked thread')?.badges, ['Blocked']);
  assert.deepEqual(byTitle.get('Legacy active alias')?.actions.map((action) => action.intent), ['pin-thread', 'archive-thread']);
  assert.deepEqual(byTitle.get('Draft thread')?.actions.map((action) => action.intent), ['pin-thread', 'discard-thread']);
  assert.deepEqual(byTitle.get('Archived thread')?.actions.map((action) => action.intent), ['restore-thread']);
  assert.deepEqual(byTitle.get('Discarded thread')?.actions.map((action) => action.intent), ['restore-thread']);
});

test('pinned archived and discarded visible state does not leak internal runtime terms', () => {
  const projection = buildSidebarCursorAgentProjection({
    workspace: { id: 'lab', path: '/tmp/lab' },
    projects: [{
      id: 'project-a',
      label: 'Project A',
      threads: [{
        sessionId: 'pinned-thread',
        pinned: true,
        title: 'provider:model run-internal-123',
        messages: [{ id: 'user-1', role: 'user', content: 'Review assay design', createdAt: '2026-05-21T00:00:00.000Z' }],
      }, {
        sessionId: 'archived-thread',
        archived: true,
        title: 'runtime codex raw JSONL stdout stderr',
        messages: [{ id: 'user-2', role: 'user', content: 'Summarize yesterday plan', createdAt: '2026-05-20T00:00:00.000Z' }],
      }, {
        sessionId: 'discarded-thread',
        discarded: true,
        title: 'ExecutionUnit provider model profile',
        messages: [{ id: 'user-3', role: 'user', content: 'Discard exploratory note', createdAt: '2026-05-19T00:00:00.000Z' }],
      }],
    }],
  });

  const visibleState = projection.groups[0]?.threads.map((thread) => ({
    title: thread.title,
    detail: thread.detail,
    state: thread.state,
    badges: thread.badges,
    pinned: thread.pinned,
    archived: thread.archived,
    discarded: thread.discarded,
  }));

  assert.deepEqual(visibleState?.map((thread) => thread.badges), [
    ['Pinned'],
    ['Archived'],
    ['Deleted'],
  ]);
  assert.doesNotMatch(JSON.stringify(visibleState), internalTerms);
});

test('thread projection drops unsafe externally supplied badges', () => {
  const projection = buildSidebarCursorAgentProjection({
    workspace: { id: 'lab', path: '/tmp/lab' },
    projects: [{
      id: 'project-a',
      label: 'Project A',
      threads: [{
        sessionId: 'thread-with-child-badges',
        title: 'Worker thread',
        badges: [
          'Child active',
          'provider token /tmp/raw.jsonl stdout stderr',
          'Child active',
        ],
      }],
    }],
  });

  assert.deepEqual(projection.groups[0]?.threads[0]?.badges, ['Child active']);
  assert.doesNotMatch(JSON.stringify(projection.groups[0]?.threads[0]), /provider|token|stdout|stderr|raw|\/tmp/i);
});

test('archived and discarded threads expose restore command without archive or discard commands', () => {
  const projection = buildSidebarCursorAgentProjection({
    workspace: { id: 'lab', path: '/tmp/lab' },
    projects: [{
      id: 'project-a',
      label: 'Project A',
      archivedThreads: [{
        sessionId: 'archived-thread',
        archived: true,
        title: 'Archived readable note',
      }],
      discardedThreads: [{
        sessionId: 'discarded-thread',
        discarded: true,
        title: 'Discarded readable note',
      }],
    }],
  });

  const archived = projection.groups[0]?.threads.find((thread) => thread.title === 'Archived readable note');
  const discarded = projection.groups[0]?.threads.find((thread) => thread.title === 'Discarded readable note');

  for (const thread of [archived, discarded]) {
    assert.ok(thread);
    const intents = thread.actions.map((action) => action.intent);
    assert.deepEqual(intents, ['restore-thread']);
    assert.deepEqual(thread.presentationActions.map((action) => action.intent), ['select-thread']);
    assert.ok(thread.actions.some((action) => action.intent === 'restore-thread' && action.commandText?.includes('chat restore')));
    assert.match(thread.actions[0]?.impactDescription ?? '', /background child agents/i);
    assert.match(thread.actions[0]?.impactDescription ?? '', /resume candidates/i);
    assert.ok(thread.actions.every((action) => action.intent !== 'archive-thread' && action.intent !== 'discard-thread'));
  }
});

test('thread archive discard and restore commands describe background child-agent impact', () => {
  const projection = buildSidebarCursorAgentProjection({
    workspace: { id: 'lab', path: '/tmp/lab' },
    projects: [{
      id: 'project-a',
      label: 'Project A',
      threads: [{
        sessionId: 'active-parent',
        title: 'Parent with background child',
        badges: ['Background child', 'Resume ready'],
      }, {
        sessionId: 'draft-parent',
        title: 'Draft with delegated child',
        state: 'draft',
        badges: ['Background child'],
      }],
      archivedThreads: [{
        sessionId: 'archived-parent',
        archived: true,
        title: 'Archived parent with child',
        badges: ['Resume ready'],
      }],
    }],
  });

  const active = projection.groups[0]?.threads.find((thread) => thread.title === 'Parent with background child');
  const draft = projection.groups[0]?.threads.find((thread) => thread.title === 'Draft with delegated child');
  const archived = projection.groups[0]?.threads.find((thread) => thread.title === 'Archived parent with child');
  const archive = active?.actions.find((action) => action.intent === 'archive-thread');
  const discard = draft?.actions.find((action) => action.intent === 'discard-thread');
  const restore = archived?.actions.find((action) => action.intent === 'restore-thread');

  for (const action of [archive, discard, restore]) {
    assert.ok(action?.impactDescription, action?.intent);
    assert.match(action.impactDescription, /background child agents/i);
    assert.match(action.impactDescription, /parent chat/i);
    assert.match(action.impactDescription, /resume/i);
    assert.doesNotMatch(action.impactDescription, internalTerms);
  }
});

test('command actions have terminal-equivalent commandText and local selection or sort stays presentation-only', () => {
  const projection = buildSidebarCursorAgentProjection({
    workspace: { id: 'lab', path: '/tmp/lab' },
    projects: [{
      id: 'project-a',
      label: 'Project A',
      current: true,
      threads: [{
        sessionId: 'thread-a',
        title: 'Wet lab plan',
        messages: [{ id: 'user-1', role: 'user', content: 'Plan next experiment' }],
      }, {
        sessionId: 'draft-a',
        messages: [],
      }],
    }, {
      id: 'project-b',
      label: 'Project B',
      current: false,
      threads: [],
    }],
    presentation: { searchQuery: 'experiment' },
  });

  const actions = collectSidebarCursorAgentActions(projection);
  const commandIntents = new Set(actions.filter((action) => action.effect === 'agent-host-command').map((action) => action.intent));
  for (const intent of ['new-project', 'open-workspace', 'new-chat', 'search', 'archive-project', 'remove-project', 'archive-thread', 'discard-thread', 'pin-thread'] as const) {
    assert.ok(commandIntents.has(intent), `missing command action ${intent}`);
  }
  assert.ok(actions.some((action) => action.intent === 'archive-project'
    && action.scope === 'project'
    && action.label === 'Archive All'
    && action.commandText?.includes('chat archive-all')
    && action.commandText.includes('--project-ref')));
  const activeThread = projection.groups[0]?.threads.find((thread) => thread.title === 'Wet lab plan');
  const draftThread = projection.groups[0]?.threads.find((thread) => thread.state === 'draft');
  assert.deepEqual(activeThread?.actions.map((action) => action.intent), ['pin-thread', 'archive-thread']);
  assert.deepEqual(draftThread?.actions.map((action) => action.intent), ['pin-thread', 'discard-thread']);

  const mutatingActions = actions.filter((action) => action.mutates);
  assert.ok(mutatingActions.length > 0);
  assert.ok(mutatingActions.every((action) => action.commandText?.startsWith('sciforge ')));
  assert.doesNotMatch(JSON.stringify(actions), /\/tmp\/lab/);

  const localActions = actions.filter((action) => action.intent === 'select-project'
    || action.intent === 'select-thread'
    || action.intent === 'sort-threads'
    || action.intent === 'open-context');
  assert.ok(localActions.length >= 3);
  assert.ok(localActions.every((action) => action.effect === 'local-presentation'));
  assert.ok(localActions.every((action) => action.localPresentation));
  assert.ok(localActions.every((action) => action.mutates === false));
  assert.ok(localActions.every((action) => action.commandText === undefined));
  assert.ok(localActions.some((action) => action.presentationMutation === 'selection'));
  assert.ok(localActions.some((action) => action.presentationMutation === 'sort'));
  assert.ok(localActions.some((action) => action.presentationMutation === 'context'));
});

test('project group resource refs map cleanly under gui sidebar regions', () => {
  const projection = buildSidebarCursorAgentProjection({
    workspace: { id: 'workspace root', path: '/tmp/workspace root' },
    projects: [{
      id: 'project with spaces',
      label: 'Project With Spaces',
      current: true,
      currentBranch: 'main',
      localEnvironment: { label: 'Local env', detail: 'Ready', state: 'ready' },
      context: { used: 16000, limit: 64000, state: 'ready' },
      threads: [{
        sessionId: 'thread with spaces',
        title: 'Readable thread',
        messages: [{ id: 'user-1', role: 'user', content: 'hello' }],
      }],
    }],
  });

  assert.equal(projection.sidebarResourceRef, SIDEBAR_CURSOR_AGENT_REGION_REF);
  assertSidebarRefs(projection);
  assert.doesNotMatch(JSON.stringify(projection), /\/tmp\/workspace root/);
  assert.match(projection.workspace.resourceRef, /^gui:\/gui\/regions\/sidebar\/workspaces\/workspace-[a-z0-9]+$/);
  assert.match(
    projection.groups[0]?.resourceRef ?? '',
    /^gui:\/gui\/regions\/sidebar\/workspaces\/workspace-[a-z0-9]+\/projects\/project-[a-z0-9]+$/,
  );
  assert.ok(projection.groups[0]?.threads[0]?.resourceRef.startsWith(`${projection.groups[0].resourceRef}/threads/`));
});

test('status and search command projection stays public and context-aware', () => {
  const projection = buildSidebarCursorAgentProjection({
    workspace: {
      id: 'lab',
      path: '/tmp/private/lab',
      currentBranch: { name: 'feature/sidebar', detail: 'Current branch', state: 'ready' },
      localEnvironment: { label: 'Local', detail: 'Syncing workspace', state: 'syncing' },
      context: { used: 58000, limit: 64000 },
    },
    projects: [{
      id: 'project-a',
      label: 'Project A',
      current: true,
      threads: [{
        sessionId: 'thread-a',
        title: 'Context audit',
        messages: [{ id: 'user-1', role: 'user', content: 'Check context' }],
      }],
    }],
    presentation: { searchQuery: '/tmp/private/lab secret token' },
  });
  const group = projection.groups[0];
  const actions = collectSidebarCursorAgentActions(projection);
  const searchAction = actions.find((action) => action.intent === 'search' && action.scope === 'sidebar');

  assert.equal(group?.status.branch.label, 'feature/sidebar');
  assert.equal(group?.status.localEnvironment.state, 'syncing');
  assert.equal(group?.status.context.detail, '58k / 64k');
  assert.equal(group?.status.context.state, 'warning');
  assert.match(searchAction?.commandText ?? '', /\$SCIFORGE_SIDEBAR_QUERY/);
  assert.doesNotMatch(JSON.stringify(projection), /\/tmp\/private|secret token/);
});

function assertSidebarRefs(projection: SidebarCursorAgentProjection) {
  const refs = [
    projection.resourceRefs.sidebar,
    projection.resourceRefs.workspace,
    ...projection.resourceRefs.groups,
    ...projection.resourceRefs.threads,
  ];
  for (const ref of refs) {
    assert.ok(ref.startsWith(SIDEBAR_CURSOR_AGENT_REGION_REF), ref);
    assert.doesNotMatch(ref, /\s/);
  }
}
