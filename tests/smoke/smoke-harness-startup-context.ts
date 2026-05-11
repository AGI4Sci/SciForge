import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildStartupContextEnvelope,
  startupContextCacheHit,
  startupContextExpansionRef,
  startupContextInvalidationReasons,
} from '../../packages/agent-harness/src/startup-context';
import { agentHarnessHandoffMetadata } from '../../src/runtime/gateway/agent-harness-shadow';
import { buildContextEnvelope } from '../../src/runtime/gateway/context-envelope';
import type { GatewayRequest } from '../../src/runtime/runtime-types';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-startup-context-'));
const generatedAt = '2026-05-11T00:00:00.000Z';
const commonInput = {
  workspaceRoot: workspace,
  generatedAt,
  session: {
    sessionId: 'startup-session',
    runId: 'startup-run-1',
    backend: 'openteam_agent',
    currentPrompt: 'Summarize artifact:paper-report using existing refs.',
  },
  scenario: {
    skillDomain: 'literature',
    expectedArtifactTypes: ['research-report'],
    selectedComponentIds: ['report-viewer'],
  },
  budget: {
    latencyTier: 'quick' as const,
    maxPromptTokens: 900,
    maxToolCalls: 2,
    maxWallMs: 30_000,
  },
  currentRefs: ['artifact:paper-report'],
  artifactRefs: ['artifact:paper-report', '.sciforge/artifacts/paper-report.json'],
  recentExecutionRefs: ['execution-unit:previous-literature-run'],
  capabilityBriefs: [{
    id: 'runtime.artifact.read',
    name: 'Read artifact',
    purpose: 'Read a selected artifact by stable ref.',
    manifestRef: 'capability:runtime.artifact.read',
    inputRefs: ['artifact-ref'],
    outputRefs: ['artifact-json'],
    costClass: 'low' as const,
    latencyClass: 'short' as const,
    sideEffectClass: 'read' as const,
    artifactTypes: ['research-report'],
  }],
};

const envelope = buildStartupContextEnvelope(commonInput);
assert.equal(envelope.schemaVersion, 'sciforge.startup-context-envelope.v1');
assert.equal(envelope.workspace.root, workspace);
assert.equal(envelope.session.sessionId, 'startup-session');
assert.equal(envelope.budget.latencyTier, 'quick');
assert.equal(envelope.capabilityBriefIndex.briefs.length, 1);
assert.equal(envelope.capabilityBriefIndex.briefs[0]?.manifestRef, 'capability:runtime.artifact.read');
assert.ok(envelope.cache?.cacheKey);
assert.ok(startupContextCacheHit(envelope, envelope.cache?.cacheKey ?? '', '2026-05-11T00:03:00.000Z'));
assert.equal(
  buildStartupContextEnvelope({ ...commonInput, generatedAt: '2026-05-11T00:03:00.000Z', previousEnvelope: envelope }),
  envelope,
  'valid startup context cache should be reused when source hashes and cache key are unchanged',
);
assert.deepEqual(
  startupContextInvalidationReasons(envelope, {
    ...commonInput,
    capabilityBriefs: [{ ...commonInput.capabilityBriefs[0]!, id: 'runtime.artifact.render' }],
  }, '2026-05-11T00:03:00.000Z'),
  ['capability-registry-changed'],
);
assert.equal(startupContextExpansionRef(envelope, 'runtime.artifact.read')?.kind, 'capability-manifest');
assert.equal(envelope.noDuplicateExplorationGuard?.skipExpensiveExplorationBeforeExpansion, true);
assert.ok(envelope.noDuplicateExplorationGuard?.coveredRefs.includes('artifact:paper-report'));

const request: GatewayRequest = {
  skillDomain: 'literature',
  prompt: 'Summarize artifact:paper-report using existing refs.',
  workspacePath: workspace,
  expectedArtifactTypes: ['research-report'],
  selectedComponentIds: ['report-viewer'],
  artifacts: [{
    id: 'paper-report',
    type: 'research-report',
    ref: 'artifact:paper-report',
    path: '.sciforge/artifacts/paper-report.json',
  }],
  uiState: {
    sessionId: 'startup-session',
    currentReferences: [{ kind: 'artifact', ref: 'artifact:paper-report', title: 'Paper report' }],
    recentExecutionRefs: [{ id: 'execution-unit:previous-literature-run', outputRef: 'artifact:paper-report', status: 'done' }],
    agentHarness: {
      profileId: 'balanced-default',
      contractRef: 'runtime://agent-harness/contracts/balanced-default/startup',
      traceRef: 'runtime://agent-harness/contracts/balanced-default/startup/trace',
      summary: {
        profileId: 'balanced-default',
        contractRef: 'runtime://agent-harness/contracts/balanced-default/startup',
        traceRef: 'runtime://agent-harness/contracts/balanced-default/startup/trace',
      },
      contract: {
        latencyTier: 'quick',
        contextBudget: { maxPromptTokens: 900 },
        toolBudget: { maxToolCalls: 2, maxWallMs: 30_000 },
        capabilityPolicy: {
          sideEffects: {
            network: 'requires-approval',
            workspaceWrite: 'requires-approval',
            externalMutation: 'requires-approval',
            codeExecution: 'requires-approval',
          },
        },
      },
    },
  },
};

const contextEnvelope = buildContextEnvelope(request, { workspace, workspaceTreeSummary: [], priorAttempts: [], mode: 'full' });
const startup = contextEnvelope.startupContextEnvelope as unknown as Record<string, unknown>;
assert.equal(startup.schemaVersion, 'sciforge.startup-context-envelope.v1');
assert.equal(contextEnvelope.hashes.startupContextEnvelope, startup.hash);
assert.ok(JSON.stringify(startup).length < 18_000, 'startup envelope should remain compact');
const guard = startup.noDuplicateExplorationGuard as Record<string, unknown>;
assert.equal(guard.skipExpensiveExplorationBeforeExpansion, true);
const startupCapabilityBriefIndex = startup.capabilityBriefIndex as Record<string, unknown>;
assert.ok(Array.isArray(startupCapabilityBriefIndex.briefs), 'context envelope should include a capability brief index');

const metadata = agentHarnessHandoffMetadata(request, { startupContextEnvelope: startup }) as Record<string, unknown>;
const handoff = metadata.agentHarnessHandoff as Record<string, unknown>;
const startupSummary = handoff.startupContextSummary as Record<string, unknown>;
assert.equal(startupSummary.schemaVersion, 'sciforge.startup-context-envelope.v1');
assert.equal(handoff.startupContextRef, startupSummary.envelopeId);
assert.equal(metadata.startupContextRef, startupSummary.envelopeId);
assert.equal((startupSummary.noDuplicateExplorationGuard as Record<string, unknown>).enabled, true);

console.log('[ok] harness startup context envelope is compact, cached, expandable, guarded, and attached to handoff');
