import assert from 'node:assert/strict';
import test from 'node:test';
import { createGuiProtocolController } from '../../ui/src/app/guiProtocol.js';
import {
  createGuiModuleDescription,
  createGuiModuleHandler,
  guiResourceRef,
  pathFromGuiResourceRef,
} from './gui-module-handler.js';

test('GUI module describe exposes presentation-only resources, intents, and facets', () => {
  const description = createGuiModuleDescription();

  assert.equal(description.moduleId, 'gui');
  assert.equal(description.functions.describe, true);
  assert.equal(description.functions.query, true);
  assert.equal(description.functions.read, true);
  assert.equal(description.functions.invoke, true);
  assert.ok(description.resources?.some((resource) => resource.refPrefix === 'gui:' && resource.queryable && resource.readable));
  assert.deepEqual(description.intents?.map((intent) => [intent.name, intent.sideEffect]), [
    ['present', 'local'],
    ['ask_user', 'local'],
    ['notify', 'local'],
    ['set_status', 'local'],
    ['apply_batch', 'local'],
    ['watch', 'none'],
  ]);
  assert.equal(description.facets?.refs, true);
  assert.equal(description.facets?.batch, true);
  assert.equal(JSON.stringify(description).includes('provider route'), false);
});

test('GUI module query/read map list, search, and stat into module resources', () => {
  const controller = createGuiProtocolController({
    revision: 12,
    focusedPanel: 'results',
    hotRegion: {
      panel: 'results',
      selectedRefs: ['artifact:report'],
      interactionMode: 'reading',
      lastChangeAt: '2026-05-29T00:00:00.000Z',
      availableActions: [{ label: 'Ask', commandText: 'ask --ref artifact:report' }],
    },
    regions: [{
      regionId: 'results',
      title: 'Results',
      summary: 'Report is visible.',
      visibleRefs: ['artifact:report'],
      affordances: [{ label: 'Ask', commandText: 'ask --ref artifact:report' }],
    }],
  });
  const handler = createGuiModuleHandler(controller);

  const listed = handler.query({ moduleId: 'gui', filters: { path: '/gui' } });
  assert.equal(listed.ok, true);
  assert.ok((listed.value as { entries: Array<{ ref: string }> }).entries.some((entry) => entry.ref === guiResourceRef('/gui/hot-region.json')));

  const searched = handler.query({ moduleId: 'gui', query: 'artifact:report', kind: 'ref' });
  assert.equal(searched.ok, true);
  assert.ok((searched.value as { matches: Array<{ ref: string }> }).matches.some((match) => match.ref.includes('/gui/')));

  const read = handler.read({ ref: guiResourceRef('/gui/hot-region.json'), includeMeta: true });
  assert.equal(read.ok, true);
  assert.equal((read.value as { path: string; meta: { readonly: boolean } }).path, '/gui/hot-region.json');
  assert.equal((read.value as { meta: { readonly: boolean } }).meta.readonly, true);
  assert.equal(pathFromGuiResourceRef(guiResourceRef('/gui/shell.json')), '/gui/shell.json');
});

test('GUI module invoke applies only GUI-local presentation intents', () => {
  const controller = createGuiProtocolController({ revision: 3 });
  const handler = createGuiModuleHandler(controller);

  const present = handler.invoke({
    moduleId: 'gui',
    intent: 'present',
    input: {
      intent: 'show-result',
      ref: 'artifact:answer',
      title: 'Answer',
      content: { kind: 'markdown', value: 'Visible answer.' },
      precondition: { expectedRevision: 3 },
    },
  });
  assert.equal(present.ok, true);
  assert.equal((present.value as { appliedRevision: number }).appliedRevision, 4);

  const rejected = handler.invoke({ moduleId: 'gui', intent: 'not-real', input: {} });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error ?? '', /unsupported_intent:not-real/);
});
