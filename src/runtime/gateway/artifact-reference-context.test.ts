import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { TURN_EXECUTION_CONSTRAINTS_SCHEMA_VERSION } from '@sciforge-ui/runtime-contract/turn-constraints';
import type { GatewayRequest } from '../runtime-types.js';
import { collectArtifactReferenceContext } from './artifact-reference-context.js';

test('turn constraints forbid expanding old artifact files into direct context', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-artifact-context-'));
  try {
    await mkdir(join(workspace, '.sciforge', 'artifacts'), { recursive: true });
    await writeFile(join(workspace, '.sciforge', 'artifacts', 'old-report.json'), JSON.stringify({
      id: 'old-report',
      type: 'research-report',
      producerScenario: 'literature',
      data: { markdown: 'OLD_REPORT_BODY_SHOULD_NOT_BE_READ' },
    }));

    const context = await collectArtifactReferenceContext(baseRequest(workspace, {
      uiState: {
        turnExecutionConstraints: directContextTurnExecutionConstraints(),
      },
    }));

    assert.deepEqual(context?.combinedArtifacts.map((artifact) => artifact.id), ['current-runtime-ref']);
    assert.doesNotMatch(JSON.stringify(context), /OLD_REPORT_BODY_SHOULD_NOT_BE_READ/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('artifact reference context can still expand files when turn constraints allow it', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-artifact-context-'));
  try {
    await mkdir(join(workspace, '.sciforge', 'artifacts'), { recursive: true });
    await writeFile(join(workspace, '.sciforge', 'artifacts', 'old-report.json'), JSON.stringify({
      id: 'old-report',
      type: 'research-report',
      producerScenario: 'literature',
      data: { markdown: 'allowed bounded report body' },
    }));

    const context = await collectArtifactReferenceContext(baseRequest(workspace));

    assert.ok(context?.combinedArtifacts.some((artifact) => artifact.id === 'old-report'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('current reference turns do not merge stale artifact files by default', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-artifact-context-'));
  try {
    await mkdir(join(workspace, '.sciforge', 'artifacts'), { recursive: true });
    await writeFile(join(workspace, '.sciforge', 'artifacts', 'old-report.json'), JSON.stringify({
      id: 'old-report',
      type: 'research-report',
      producerScenario: 'literature',
      data: { markdown: 'OLD_REPORT_BODY_SHOULD_NOT_BE_READ' },
    }));

    const context = await collectArtifactReferenceContext(baseRequest(workspace, {
      uiState: {
        currentReferenceDigests: [{
          id: 'digest-1',
          status: 'ok',
          sourceRef: 'file:current.md',
          digestText: 'Current bounded digest.',
        }],
      },
    }));

    assert.deepEqual(context?.combinedArtifacts.map((artifact) => artifact.id), ['current-runtime-ref']);
    assert.doesNotMatch(JSON.stringify(context), /OLD_REPORT_BODY_SHOULD_NOT_BE_READ/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function baseRequest(workspacePath: string, overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    skillDomain: 'literature',
    prompt: 'Summarize current refs.',
    workspacePath,
    artifacts: [{
      id: 'current-runtime-ref',
      type: 'runtime-diagnostic',
      metadata: { source: 'current-turn' },
    }],
    ...overrides,
  };
}

function directContextTurnExecutionConstraints() {
  return {
    schemaVersion: TURN_EXECUTION_CONSTRAINTS_SCHEMA_VERSION,
    policyId: 'sciforge.current-turn-execution-constraints.v1',
    source: 'runtime-contract.turn-constraints',
    contextOnly: true,
    agentServerForbidden: true,
    workspaceExecutionForbidden: true,
    externalIoForbidden: true,
    codeExecutionForbidden: true,
    preferredCapabilityIds: ['runtime.direct-context-answer'],
    executionModeHint: 'direct-context-answer',
    initialResponseModeHint: 'direct-context-answer',
    reasons: ['current-context-only directive'],
    evidence: {
      hasPriorContext: true,
      referenceCount: 1,
      artifactCount: 1,
      executionRefCount: 0,
      runCount: 0,
    },
  };
}
