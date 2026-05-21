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
    '/gui/capabilities',
    '/gui/debug',
    '/gui/hot-region.json',
    '/gui/intent-log.json',
    '/gui/regions',
    '/gui/renderers',
    '/gui/shell.json',
  ]);
  assert.equal(shell.schemaVersion, 'sciforge.gui-context.v1');
  assert.equal(shell.revision, 7);
  assert.deepEqual(shell.availableGuiTools, [
    'gui.present',
    'gui.ask_user',
    'gui.notify',
    'gui.set_status',
    'gui.apply_batch',
    'gui.get_context',
    'gui.list',
    'gui.read',
    'gui.search',
    'gui.stat',
    'gui.watch',
  ]);
  assert.equal(hotRegion.hotRegion.primaryRef, 'artifact:report');
  assert.deepEqual(intentLog.entries, []);
});

test('GuiProtocol exposes presentation catalog and renderer resources from package manifests', () => {
  const gui = createGuiProtocolController({
    revision: 8,
    updatedAt: '2026-05-21T00:00:00.000Z',
  });

  const capabilityEntries = gui.list({ path: '/gui/capabilities' });
  const rendererEntries = gui.list({ path: '/gui/renderers' });
  const catalog = JSON.parse(gui.read({ path: '/gui/capabilities/presentation.json' }).content) as {
    schemaVersion: string;
    source: string;
    components: Array<{
      componentId: string;
      acceptsArtifactTypes: string[];
      previewKinds: string[];
      lifecycleLayer: string;
      safety: { writesWorkspace: boolean; executesCode: boolean };
      agentSummary?: string;
    }>;
  };
  const report = JSON.parse(gui.read({ path: '/gui/renderers/report-viewer.json' }).content) as {
    schemaVersion: string;
    componentId: string;
    previewKinds: string[];
    boundary: { taskCapability: boolean; providerRoute: boolean; importsReactComponent: boolean };
  };
  const search = gui.search({ scope: '/gui/capabilities', query: 'markdown research report', kinds: ['artifact-type', 'preview-kind', 'visible-text'] });
  const scopedSearch = gui.search({ scope: '/gui/capabilities', query: 'report', kinds: ['visible-text', 'renderer', 'artifact-type', 'preview-kind'] });
  const catalogStat = gui.stat({ path: '/gui/capabilities/presentation.json' });
  const rendererStat = gui.stat({ path: '/gui/renderers/report-viewer.json' });
  const boundedRead = gui.read({ path: '/gui/capabilities/presentation.json', maxBytes: 80 });
  const broadSearch = gui.search({ scope: '/gui/capabilities', query: 'renderer presentation markdown table json report artifact preview component' });

  assert.deepEqual(capabilityEntries.map((entry) => entry.path), ['/gui/capabilities/presentation.json']);
  assert.ok(rendererEntries.some((entry) => entry.path === '/gui/renderers/report-viewer.json'));
  assert.equal(catalog.schemaVersion, 'sciforge.gui-presentation-catalog.v1');
  assert.equal(catalog.source, 'packages/presentation/components');
  assert.ok(catalog.components.some((component) => component.componentId === 'report-viewer'));
  assert.ok(catalog.components.every((component) => component.lifecycleLayer === 'presentation'));
  assert.ok(catalog.components.every((component) => component.safety.writesWorkspace === false && component.safety.executesCode === false));
  assert.equal(report.schemaVersion, 'sciforge.gui-renderer.v1');
  assert.equal(report.componentId, 'report-viewer');
  assert.ok(report.previewKinds.includes('markdown'));
  assert.deepEqual(report.boundary, {
    taskCapability: false,
    providerRoute: false,
    algorithmRecommendation: false,
    importsReactComponent: false,
  });
  assert.ok(search.some((entry) => entry.path === '/gui/renderers/report-viewer.json'));
  assert.ok(scopedSearch.length > 0);
  assert.ok(scopedSearch.every((entry) => entry.path === '/gui/capabilities/presentation.json' || entry.path.startsWith('/gui/renderers/')));
  assert.equal(catalogStat.path, '/gui/capabilities/presentation.json');
  assert.equal(catalogStat.readonly, true);
  assert.equal(catalogStat.kind, 'file');
  assert.equal(rendererStat.path, '/gui/renderers/report-viewer.json');
  assert.equal(rendererStat.readonly, true);
  assert.equal(boundedRead.content.length, 80);
  assert.equal(boundedRead.truncated, true);
  assert.ok(broadSearch.length <= 25);
  assert.ok(broadSearch.every((entry) => entry.text.length <= 320));
  assert.throws(() => gui.read({ path: '/gui/renderers/not-a-component.json' }), /Unknown GUI resource file/);
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
    intent: 'focus-existing',
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

test('GuiProtocol ask_user creates modal state with terminal-equivalent command affordances', () => {
  const gui = createGuiProtocolController({
    revision: 2,
    focusedPanel: 'results',
    hotRegion: {
      panel: 'results',
      selectedRefs: ['artifact:report'],
      interactionMode: 'reading',
      lastChangeAt: '2026-05-19T00:00:00.000Z',
    },
  });

  const result = gui.askUser({
    kind: 'confirmation',
    title: 'Delete report?',
    message: 'Confirm before removing the visible report.',
    choices: [
      { label: 'Delete', commandText: '/approve approval-456', style: 'danger' },
      { label: 'Cancel', commandText: '/reject approval-456' },
      { label: 'Unsafe legacy', commandText: 'deleteFile("report.md")' },
    ],
  });
  const shell = JSON.parse(gui.read({ path: '/gui/shell.json' }).content) as { pendingModal: { kind: string } };
  const hot = JSON.parse(gui.read({ path: '/gui/hot-region.json' }).content) as { hotRegion: { panel: string; interactionMode: string; availableActions: Array<{ commandText: string }> } };
  const modalActions = JSON.parse(gui.read({ path: '/gui/regions/modal/actions.json' }).content) as { actions: Array<{ commandText: string }> };
  const log = JSON.parse(gui.read({ path: '/gui/intent-log.json' }).content) as { entries: Array<{ tool: string; applied: boolean }> };

  assert.equal(result.ok, true);
  assert.equal(result.placement?.panel, 'modal');
  assert.equal(shell.pendingModal.kind, 'confirmation');
  assert.equal(hot.hotRegion.panel, 'modal');
  assert.equal(hot.hotRegion.interactionMode, 'modal');
  assert.deepEqual(hot.hotRegion.availableActions.map((action) => action.commandText), ['/approve approval-456', '/reject approval-456']);
  assert.deepEqual(modalActions.actions.map((action) => action.commandText), ['/approve approval-456', '/reject approval-456']);
  assert.deepEqual(log.entries.map((entry) => [entry.tool, entry.applied]), [['gui.ask_user', true]]);
});

test('GuiProtocol apply_batch supports GUI-local all-or-nothing and best-effort transactions', () => {
  const atomic = createGuiProtocolController({
    revision: 10,
    focusedPanel: 'results',
    hotRegion: {
      panel: 'results',
      selectedRefs: ['artifact:report'],
      interactionMode: 'reading',
      lastChangeAt: '2026-05-19T00:00:00.000Z',
    },
  });

  const rejected = atomic.applyBatch({
    atomicity: 'all-or-nothing',
    ops: [
      { tool: 'set_status', args: { text: 'Opening diff', tone: 'running' } },
      { tool: 'present', args: { intent: 'show-diff', content: { kind: 'diff', value: 'diff --git a/report.md b/report.md' }, precondition: { expectedRevision: 999 } } },
    ],
  });
  const rejectedLog = JSON.parse(atomic.read({ path: '/gui/intent-log.json' }).content) as { entries: Array<{ tool: string; applied: boolean; reason: string | null }> };

  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'stale-precondition');
  assert.deepEqual(rejected.operationResults.map((item) => [item.tool, item.ok, item.reason]), [
    ['set_status', false, 'state-conflict'],
    ['present', false, 'stale-precondition'],
  ]);
  assert.deepEqual(rejectedLog.entries.map((entry) => [entry.tool, entry.applied, entry.reason]), [['gui.apply_batch', false, 'stale-precondition']]);

  const bestEffort = createGuiProtocolController({ revision: 20 });
  const partial = bestEffort.applyBatch({
    atomicity: 'best-effort',
    ops: [
      { tool: 'set_status', args: { text: 'Rendering result', tone: 'running' } },
      { tool: 'present', args: { intent: 'show-diff', content: { kind: 'diff', value: 'diff --git a/report.md b/report.md' }, precondition: { expectedRevision: 999 } } },
      { tool: 'notify', args: { level: 'success', message: 'Rendered what was available.' } },
    ],
  });

  assert.equal(partial.ok, true);
  assert.deepEqual(partial.operationResults.map((item) => [item.tool, item.ok, item.reason]), [
    ['set_status', true, null],
    ['present', false, 'stale-precondition'],
    ['notify', true, null],
  ]);
});

test('GuiProtocol watch reports semantic resource revisions without raw DOM disclosure', () => {
  const gui = createGuiProtocolController({ revision: 12, updatedAt: '2026-05-19T00:00:00.000Z' });

  const current = gui.watch({ path: '/gui/hot-region.json', sinceRevision: 12 });
  const changed = gui.watch({ path: '/gui/hot-region.json', sinceRevision: 11 });
  const debug = gui.watch({ path: '/gui/debug/intent-log.json', sinceRevision: 0 });

  assert.deepEqual(current.events, []);
  assert.equal(changed.semanticOnly, true);
  assert.equal(changed.includesRawDom, false);
  assert.deepEqual(changed.events.map((event) => [event.kind, event.path, event.revision, event.disclosure]), [
    ['changed', '/gui/hot-region.json', 12, 'hot-region'],
  ]);
  assert.equal(debug.disclosure, 'debug');
  assert.equal(debug.includesRawDom, false);
});
