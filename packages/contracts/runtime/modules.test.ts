import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  createModuleDescription,
  moduleIntent,
  moduleIntentRequiresApproval,
  moduleResult,
  moduleSupportsFacet,
  moduleSupportsFunction,
} from './modules';

test('module description declares supported functions from resources and intents', () => {
  const description = createModuleDescription({
    moduleId: 'gui',
    title: 'GUI',
    summary: 'Presentation and interaction module.',
    resources: [{ kind: 'hot-region', refPrefix: 'gui:', queryable: true, readable: true }],
    intents: [{ name: 'present', sideEffect: 'local' }],
  });

  assert.equal(moduleSupportsFunction(description, 'describe'), true);
  assert.equal(moduleSupportsFunction(description, 'query'), true);
  assert.equal(moduleSupportsFunction(description, 'read'), true);
  assert.equal(moduleSupportsFunction(description, 'invoke'), true);
});

test('module functions and facets fail closed when not declared', () => {
  const description = createModuleDescription({
    moduleId: 'skills',
    title: 'Skills',
    summary: 'Skill catalog.',
    functions: { query: true, read: false, invoke: false },
    facets: { refs: true },
  });

  assert.equal(moduleSupportsFunction(description, 'query'), true);
  assert.equal(moduleSupportsFunction(description, 'read'), false);
  assert.equal(moduleSupportsFunction(description, 'invoke'), false);
  assert.equal(moduleSupportsFacet(description, 'refs'), true);
  assert.equal(moduleSupportsFacet(description, 'events'), false);
});

test('module intents expose approval and operation metadata', () => {
  const description = createModuleDescription({
    moduleId: 'connectors',
    title: 'Connectors',
    summary: 'External app connectors.',
    intents: [
      { name: 'draft_message', sideEffect: 'local' },
      { name: 'send_message', sideEffect: 'external', requiresApproval: true, returnsOperation: true },
    ],
    facets: { approval: true, events: true, refs: true },
  });

  assert.equal(moduleIntent(description, 'send_message')?.sideEffect, 'external');
  assert.equal(moduleIntentRequiresApproval(description, 'send_message'), true);
  assert.equal(moduleIntentRequiresApproval(description, 'draft_message'), false);
  assert.equal(moduleSupportsFacet(description, 'approval'), true);
});

test('module result envelopes carry the contract schema version', () => {
  const result = moduleResult({
    moduleId: 'memory',
    ok: true,
    value: { ref: 'memory:project:1' },
    refs: ['memory:project:1'],
  });

  assert.equal(result.schemaVersion, 'sciforge.module-contract.v1');
  assert.equal(result.ok, true);
  assert.deepEqual(result.refs, ['memory:project:1']);
});
