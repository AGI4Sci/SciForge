import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCapabilitiesResourceModuleHandler,
  createMemoryResourceModuleHandler,
  createResourceModuleHandlers,
  createSkillsResourceModuleHandler,
} from './resource-modules.js';

test('skills module describes, queries catalog fields, and reads skill summaries', () => {
  const skills = createSkillsResourceModuleHandler();

  const description = skills.describe();
  assert.equal(description.moduleId, 'skills');
  assert.equal(description.functions.describe, true);
  assert.equal(description.functions.query, true);
  assert.equal(description.functions.read, true);
  assert.equal(description.functions.invoke, false);

  const query = skills.query?.({
    moduleId: 'skills',
    query: 'scientific reproduction negative-results',
    limit: 5,
  });
  assert.equal(query?.ok, true);
  const queryValue = query?.value as { items: Array<{ id: string; ref: string; tags: string[] }> };
  assert.ok(queryValue.items.some((item) => item.id === 'scientific-reproduction'));
  assert.ok(queryValue.items.every((item) => item.ref.startsWith('skill:')));

  const read = skills.read?.({ ref: 'skill:scientific-reproduction' });
  assert.equal(read?.ok, true);
  const readValue = read?.value as {
    id: string;
    description: string;
    outputs: string[];
    requiredCapabilities: Array<{ capability: string }>;
  };
  assert.equal(readValue.id, 'scientific-reproduction');
  assert.match(readValue.description, /bioinformatics reproduction/i);
  assert.ok(readValue.outputs.includes('evidence-matrix'));
  assert.ok(readValue.requiredCapabilities.some((item) => item.capability));
  assert.doesNotMatch(JSON.stringify(read), /https?:\/\/|\/Applications\/|token=|secret=/i);
});

test('memory module queries and reads caller-provided fixture refs only', () => {
  const memory = createMemoryResourceModuleHandler({
    fixtures: [{
      ref: 'memory:project:kinase-plan',
      scope: 'project',
      title: 'Kinase plan',
      summary: 'Prior plan mentions token=abc123 and http://internal.example.local/run',
      content: 'Use /Applications/workspace/private-file only as a redaction fixture.',
      tags: ['kinase', 'plan'],
      sourceRef: 'task:123',
      updatedAt: '2026-05-29T00:00:00.000Z',
    }],
  });

  const query = memory.query?.({ moduleId: 'memory', query: 'kinase', scope: 'project' });
  assert.equal(query?.ok, true);
  const queryValue = query?.value as { items: Array<{ ref: string; summary: string }> };
  assert.deepEqual(queryValue.items.map((item) => item.ref), ['memory:project:kinase-plan']);
  assert.match(queryValue.items[0]!.summary, /\[redacted-secret\]/);
  assert.match(queryValue.items[0]!.summary, /\[redacted-url\]/);

  const read = memory.read?.({ ref: 'memory:project:kinase-plan', includeMeta: true });
  assert.equal(read?.ok, true);
  assert.doesNotMatch(JSON.stringify(read), /abc123|http:\/\/internal|\/Applications\/workspace/i);
  assert.match(JSON.stringify(read), /\[redacted-path\]/);

  const missing = memory.read?.({ ref: 'memory:project:missing' });
  assert.equal(missing?.ok, false);
});

test('memory invoke returns approval and dry-run mutation results without persistence', () => {
  const memory = createMemoryResourceModuleHandler({
    fixtures: [{
      ref: 'memory:user:stable',
      scope: 'user',
      title: 'Stable preference',
      summary: 'Prefer compact summaries.',
    }],
  });

  const approval = memory.invoke?.({
    moduleId: 'memory',
    intent: 'write',
    input: {
      scope: 'project',
      title: 'New note',
      content: 'secret=should-not-leak',
    },
    traceParent: 'module-step-1',
  });
  assert.equal(approval?.ok, false);
  assert.match(approval?.operationRef ?? '', /^memory:operation:/);
  assert.equal(approval?.approvalRequest?.reason, 'approval_required');
  assert.doesNotMatch(JSON.stringify(approval), /should-not-leak/);

  for (const intent of ['write', 'update', 'forget'] as const) {
    const result = memory.invoke?.({
      moduleId: 'memory',
      intent,
      approvalToken: 'approved-fixture-token',
      input: intent === 'write'
        ? { scope: 'session', summary: 'approved dry run' }
        : { ref: 'memory:user:stable', summary: 'approved dry run' },
    });
    assert.equal(result?.ok, true);
    const value = result?.value as { persisted: boolean; status: string; intent: string };
    assert.equal(value.persisted, false);
    assert.equal(value.status, 'accepted-not-persisted');
    assert.equal(value.intent, intent);
  }

  const after = memory.query?.({ moduleId: 'memory', query: 'approved dry run' });
  assert.equal((after?.value as { total: number }).total, 0);
});

test('capabilities module queries, reads, and invokes discovery operations', () => {
  const capabilities = createCapabilitiesResourceModuleHandler({ auditSeed: 'resource-module-test' });

  const description = capabilities.describe();
  assert.equal(description.moduleId, 'capabilities');
  assert.equal(description.functions.query, true);
  assert.equal(description.functions.read, true);
  assert.equal(description.functions.invoke, true);

  const query = capabilities.query?.({
    moduleId: 'capabilities',
    query: 'Need to search recent arxiv papers, fetch PDFs, and produce an evidence matrix.',
    limit: 4,
  });
  assert.equal(query?.ok, true);
  const queryValue = query?.value as {
    items: Array<Record<string, unknown>>;
    discoveryRef: string;
    auditRef: string;
  };
  assert.ok(queryValue.items.length > 0);
  assert.ok(queryValue.items.length <= 4);
  assert.match(queryValue.discoveryRef, /^capability-discovery:search:/);
  assert.doesNotMatch(JSON.stringify(queryValue.items), /rank|score|confidence/i);

  const read = capabilities.read?.({ ref: 'capability:web_search' });
  assert.equal(read?.ok, true);
  const readValue = read?.value as { capabilityId: string; summary: string; executionContract: string };
  assert.equal(readValue.capabilityId, 'web_search');
  assert.match(readValue.executionContract, /invoke_capability/);

  const search = capabilities.invoke?.({
    moduleId: 'capabilities',
    intent: 'search',
    input: {
      goal: 'Search the web for papers and create a research report.',
      desiredArtifacts: ['research-report'],
      constraints: { maxCandidates: 3, latencyTier: 'quick' },
    },
  });
  assert.equal(search?.ok, true);
  assert.equal((search?.value as { contract: string }).contract, 'sciforge.capability-discovery.v1');

  const explain = capabilities.invoke?.({
    moduleId: 'capabilities',
    intent: 'explain',
    input: { capabilityIds: ['web_search'], audience: 'user' },
  });
  assert.equal(explain?.ok, true);
  assert.match((explain?.value as { text: string }).text, /does not execute/);

  const plan = capabilities.invoke?.({
    moduleId: 'capabilities',
    intent: 'plan',
    input: { goal: 'Search web', candidateIds: ['web_search'] },
  });
  assert.equal(plan?.ok, true);
  assert.equal((plan?.value as { completionEvidence: string }).completionEvidence, 'not-evidence');

  const expand = capabilities.invoke?.({
    moduleId: 'capabilities',
    intent: 'expand',
    input: { capabilityIds: ['web_search'], include: ['failureModes'] },
  });
  assert.equal(expand?.ok, true);
  assert.deepEqual(expand?.refs, ['capability:web_search']);
  assert.doesNotMatch(JSON.stringify([query, read, search, explain, plan, expand]), /endpoint|baseUrl|invokeUrl|workspaceRoots|auth|token|secret|\/Applications\/workspace/i);
});

test('resource module factory returns the three resource handlers', () => {
  const handlers = createResourceModuleHandlers({
    memory: { fixtures: [] },
    capabilities: { auditSeed: 'factory-test' },
  });

  assert.deepEqual(Object.keys(handlers).sort(), ['capabilities', 'memory', 'skills']);
  assert.equal(handlers.skills.describe().moduleId, 'skills');
  assert.equal(handlers.memory.describe().moduleId, 'memory');
  assert.equal(handlers.capabilities.describe().moduleId, 'capabilities');
});
