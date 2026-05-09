import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_AGENT_REQUEST_TIMEOUT_MS,
  DEFAULT_AGENT_SERVER_URL,
  agentHandoffSourceMetadata,
  buildSharedAgentHandoffContract,
  normalizeAgentHandoffSource,
  normalizeSharedSkillDomain,
  taskProjectSkillDomain,
} from './handoff';

test('normalizes shared skill domains for UI and CLI callers', () => {
  assert.equal(normalizeSharedSkillDomain('literature'), 'literature');
  assert.equal(normalizeSharedSkillDomain('unknown'), undefined);
  assert.equal(normalizeSharedSkillDomain(undefined), undefined);
  assert.equal(taskProjectSkillDomain('omics'), 'omics');
  assert.equal(taskProjectSkillDomain(undefined), 'knowledge');
});

test('normalizes agent handoff sources with an explicit fallback', () => {
  assert.equal(normalizeAgentHandoffSource('ui-chat', 'cli'), 'ui-chat');
  assert.equal(normalizeAgentHandoffSource('not-real', 'cli'), 'cli');
});

test('builds a shared handoff contract independent of UI and runtime', () => {
  const contract = buildSharedAgentHandoffContract('cli');

  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.source, 'cli');
  assert.equal(contract.decisionOwner, 'AgentServer');
  assert.equal(contract.dispatchPolicy, 'agentserver-decides');
  assert.equal(contract.contextPolicy, 'refs-and-bounded-summaries');
});

test('exports shared defaults for UI chat and terminal execution', () => {
  assert.equal(DEFAULT_AGENT_SERVER_URL, 'http://127.0.0.1:18080');
  assert.equal(DEFAULT_AGENT_REQUEST_TIMEOUT_MS, 900_000);
  assert.deepEqual(agentHandoffSourceMetadata('workspace-runtime').sharedContract.source, 'workspace-runtime');
});
