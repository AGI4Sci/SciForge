import assert from 'node:assert/strict';
import test from 'node:test';
import { createGuiProtocolController } from './guiProtocol';

test('GuiProtocol exposes shell, hot-region, and intent-log resources as bounded semantic reads', () => {
  const gui = createGuiProtocolController({
    revision: 7,
    focusedPanel: 'results',
    layoutMode: 'desktop',
    updatedAt: '2026-05-19T00:00:00.000Z',
    hotRegion: {
      panel: 'results',
      primaryRef: 'artifact:report',
      selectedRefs: ['artifact:report'],
      interactionMode: 'reading',
      lastChangeOrigin: 'user',
      lastChangeAt: '2026-05-19T00:00:00.000Z',
      availableActions: [{ label: 'Ask about report', commandText: 'ask --ref artifact:report "Summarize it"' }],
    },
    regions: [{
      regionId: 'results',
      title: 'Results',
      summary: 'Report artifact is visible in the results panel.',
      visibleRefs: ['artifact:report'],
      affordances: [{ label: 'Ask about report', commandText: 'ask --ref artifact:report "Summarize it"' }],
    }],
  });

  const rootEntries = gui.list({ path: '/gui' });
  const shell = JSON.parse(gui.read({ path: '/gui/shell.json' }).content) as Record<string, unknown>;
  const hotRegion = JSON.parse(gui.read({ path: '/gui/hot-region.json' }).content) as { hotRegion: { primaryRef: string } };
  const intentLog = JSON.parse(gui.read({ path: '/gui/intent-log.json', maxBytes: 2000 }).content) as { entries: unknown[] };

  assert.deepEqual(rootEntries.map((entry) => entry.path), [
    '/gui/debug',
    '/gui/hot-region.json',
    '/gui/intent-log.json',
    '/gui/regions',
    '/gui/shell.json',
  ]);
  assert.equal(shell.schemaVersion, 'sciforge.gui-context.v1');
  assert.equal(shell.revision, 7);
  assert.deepEqual(shell.availableGuiTools, [
    'gui.present',
    'gui.notify',
    'gui.set_status',
    'gui.list',
    'gui.read',
    'gui.search',
    'gui.stat',
  ]);
  assert.equal(hotRegion.hotRegion.primaryRef, 'artifact:report');
  assert.deepEqual(intentLog.entries, []);
});

test('GuiProtocol searches semantic refs/actions and stats resources without raw DOM coupling', () => {
  const gui = createGuiProtocolController({
    revision: 3,
    focusedPanel: 'composer',
    hotRegion: {
      panel: 'composer',
      selectedRefs: ['file:data/results.csv'],
      interactionMode: 'editing',
      availableActions: [
        { label: 'Run selected table', commandText: 'analyze --ref file:data/results.csv' },
        { label: 'Business mutation', commandText: 'triggerRecover({ runId: "run-1" })' },
        { label: 'Legacy mutation', commandText: '   ' },
      ],
      lastChangeAt: '2026-05-19T00:00:00.000Z',
    },
    regions: [{
      regionId: 'composer',
      title: 'Composer draft',
      summary: 'Draft references the results.csv table.',
      visibleRefs: ['file:data/results.csv'],
      affordances: [{ label: 'Run selected table', commandText: 'analyze --ref file:data/results.csv' }],
    }],
  });

  const refMatches = gui.search({ query: 'results.csv', scope: '/gui', kinds: ['ref'] });
  const actionMatches = gui.search({ query: 'Run selected', scope: '/gui/regions/composer', kinds: ['action'] });
  const stat = gui.stat({ path: '/gui/regions/composer/summary.md' });

  assert.equal(refMatches[0]?.ref, 'file:data/results.csv');
  assert.equal(actionMatches[0]?.action?.commandText, 'analyze --ref file:data/results.csv');
  assert.deepEqual(
    (JSON.parse(gui.read({ path: '/gui/hot-region.json' }).content) as { hotRegion: { availableActions: Array<{ commandText: string }> } }).hotRegion.availableActions.map((action) => action.commandText),
    ['analyze --ref file:data/results.csv'],
  );
  assert.equal(stat.path, '/gui/regions/composer/summary.md');
  assert.equal(stat.kind, 'file');
  assert.equal(stat.readonly, true);
  assert.equal(stat.disclosure, 'region-detail');
  assert.ok(stat.sizeBytes > 0);
});

test('GuiProtocol intent tools return negotiation schema and append intent log entries', () => {
  const gui = createGuiProtocolController({
    revision: 11,
    focusedPanel: 'results',
    hotRegion: {
      panel: 'results',
      selectedRefs: ['artifact:report'],
      interactionMode: 'reading',
      lastChangeAt: '2026-05-19T00:00:00.000Z',
    },
  });

  const present = gui.present({
    intent: 'show-artifact',
    ref: 'artifact:report',
    hint: 'markdown',
    title: 'Report',
    precondition: { expectedRevision: 11, ifSelectedRef: 'artifact:report' },
  });
  const notify = gui.notify({ level: 'success', message: 'Report displayed.' });
  const status = gui.setStatus({ text: 'Idle', tone: 'neutral' });
  const log = JSON.parse(gui.read({ path: '/gui/intent-log.json' }).content) as { entries: Array<Record<string, unknown>> };

  for (const result of [present, notify, status]) {
    assert.equal(Object.hasOwn(result, 'ok'), true);
    assert.equal(Object.hasOwn(result, 'appliedRevision'), true);
    assert.equal(Object.hasOwn(result, 'deferred'), true);
    assert.equal(Object.hasOwn(result, 'reason'), true);
    assert.equal(Object.hasOwn(result, 'suggestions'), true);
    assert.equal(result.ok, true);
    assert.equal(result.deferred, false);
    assert.equal(result.reason, null);
    assert.deepEqual(result.suggestions, []);
  }
  assert.equal(present.appliedRevision, 12);
  assert.equal(present.placement?.panel, 'results');
  assert.deepEqual(log.entries.map((entry) => entry.tool), ['gui.present', 'gui.notify', 'gui.set_status']);
  assert.deepEqual(log.entries.map((entry) => entry.applied), [true, true, true]);
});

test('GuiProtocol defers presentation intents when presentation policy protects user editing', () => {
  const gui = createGuiProtocolController({
    revision: 4,
    focusedPanel: 'composer',
    hotRegion: {
      panel: 'composer',
      selectedRefs: ['artifact:draft'],
      interactionMode: 'editing',
      lastChangeOrigin: 'user',
      lastChangeAt: new Date().toISOString(),
    },
  });

  const result = gui.present({
    intent: 'show-diff',
    content: { kind: 'diff', value: 'diff --git a/report.md b/report.md' },
    precondition: { expectedRevision: 4, avoidIfUserEditing: true },
  });
  const log = JSON.parse(gui.read({ path: '/gui/intent-log.json' }).content) as { entries: Array<Record<string, unknown>> };

  assert.equal(result.ok, false);
  assert.equal(result.appliedRevision, null);
  assert.equal(result.deferred, true);
  assert.equal(result.reason, 'user-editing');
  assert.deepEqual(result.suggestions, [{ action: 'defer', until: 'editing-complete' }, { action: 'notify-only' }]);
  assert.equal(result.currentRevision, 4);
  assert.equal(log.entries[0]?.applied, false);
  assert.equal(log.entries[0]?.reason, 'user-editing');
});
