import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildWebE2eFixtureWorkspace } from './fixture-workspace-builder.js';
import {
  artifactDeliveryManifestFromSession,
  assertWebE2eContract,
  createWebE2eAfterEachContractVerifier,
  loadWebE2eContractVerifierInput,
  runAuditFromSession,
  verifyWebE2eContract,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
} from './contract-verifier.js';
import type { WebE2eFixtureWorkspace } from './types.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-web-e2e-contract-verifier-test-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-22 accepts fully aligned browser, Projection, session, audit, delivery, and expected contract state', async () => {
  const fixture = await fixtureWorkspace('SA-WEB-22-happy');
  const input = verifierInput(fixture);

  const result = verifyWebE2eContract(input);

  assert.deepEqual(result, { ok: true, failures: [] });
  await createWebE2eAfterEachContractVerifier(() => input)();
});

test('SA-WEB-22 fails when browser visible state exposes audit-only ArtifactDelivery refs', async () => {
  const fixture = await fixtureWorkspace('SA-WEB-22-browser-leak');
  const input = verifierInput(fixture, {
    auditRefs: ['artifact:fixture-run-audit'],
    diagnosticRefs: ['artifact:fixture-diagnostic-log'],
    internalRefs: ['artifact:fixture-provider-manifest'],
  });

  const result = verifyWebE2eContract(input);

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /browser audit refs leaked audit-only refs/);
  assert.match(result.failures.join('\n'), /browser diagnostic refs leaked audit-only refs/);
  assert.match(result.failures.join('\n'), /browser internal refs leaked audit-only refs/);
});

test('SA-WEB-22 fails when Kernel Projection drifts from the expected case contract', async () => {
  const fixture = await fixtureWorkspace('SA-WEB-22-kernel-drift');
  const input = verifierInput(fixture);
  input.kernelProjection = structuredClone(input.kernelProjection);
  if (input.kernelProjection.visibleAnswer && 'text' in input.kernelProjection.visibleAnswer) {
    input.kernelProjection.visibleAnswer.text = 'A different answer leaked from runtime memory.';
  }

  const result = verifyWebE2eContract(input);

  assert.equal(result.ok, false);
  assert.ok(result.failures.includes('Kernel Projection mismatch'));
});

test('SA-WEB-22 fails when the session bundle loses the expected Projection or explicit refs', async () => {
  const fixture = await fixtureWorkspace('SA-WEB-22-session-drift');
  const input = verifierInput(fixture);
  input.sessionBundle = structuredClone(fixture.workspaceState.sessionsByScenario[fixture.scenarioId]);
  input.sessionBundle.messages = input.sessionBundle.messages.map((message) => ({ ...message, objectReferences: [] }));
  const run = input.sessionBundle.runs[0];
  if (run?.raw && typeof run.raw === 'object') {
    delete (run.raw as { resultPresentation?: unknown }).resultPresentation;
    const displayIntent = (run.raw as { displayIntent?: { conversationProjection?: unknown } }).displayIntent;
    if (displayIntent) delete displayIntent.conversationProjection;
  }

  const result = verifyWebE2eContract(input);

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /session bundle explicit refs missing refs/);
});

test('SA-WEB-22 fails when RunAudit or ArtifactDelivery manifest misses required refs', async () => {
  const fixture = await fixtureWorkspace('SA-WEB-22-audit-delivery-drift');
  const input = verifierInput(fixture);
  input.runAudit = {
    ...input.runAudit,
    refs: input.runAudit.refs.filter((ref) => ref !== 'artifact:fixture-run-audit'),
  };
  input.artifactDeliveryManifest = {
    schemaVersion: 'sciforge.web-e2e.artifact-delivery-manifest.v1',
    caseId: fixture.caseId,
    runId: fixture.runId,
    artifactDelivery: {
      ...fixture.expectedProjection.artifactDelivery,
      primaryArtifactRefs: [],
    },
  };

  const result = verifyWebE2eContract(input);

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /RunAudit refs missing refs/);
  assert.match(result.failures.join('\n'), /ArtifactDelivery manifest primaryArtifactRefs mismatch/);
});

test('SA-WEB-22 loader builds after-each verifier input from workspace files', async () => {
  const fixture = await fixtureWorkspace('SA-WEB-22-loader');
  const input = await loadWebE2eContractVerifierInput({
    expectedProjectionPath: fixture.expectedProjectionPath,
    workspaceStatePath: fixture.workspaceStatePath,
  });

  assertWebE2eContract(input);
});

async function fixtureWorkspace(caseId: string): Promise<WebE2eFixtureWorkspace> {
  return await buildWebE2eFixtureWorkspace({
    caseId,
    baseDir,
    now: '2026-05-16T00:00:00.000Z',
    workspaceWriterBaseUrl: 'http://127.0.0.1:29991',
    agentServerBaseUrl: 'http://127.0.0.1:29992',
  });
}

function verifierInput(
  fixture: WebE2eFixtureWorkspace,
  browserOverrides: Partial<WebE2eBrowserVisibleState> = {},
): WebE2eContractVerifierInput {
  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  const expectedAnswer = fixture.expectedProjection.conversationProjection.visibleAnswer;
  const visibleAnswerText = expectedAnswer && 'text' in expectedAnswer ? expectedAnswer.text : undefined;
  return {
    caseId: fixture.caseId,
    expected: fixture.expectedProjection,
    browserVisibleState: {
      status: expectedAnswer?.status,
      visibleAnswerText,
      primaryArtifactRefs: fixture.expectedProjection.artifactDelivery.primaryArtifactRefs,
      supportingArtifactRefs: fixture.expectedProjection.artifactDelivery.supportingArtifactRefs,
      visibleArtifactRefs: [
        ...fixture.expectedProjection.artifactDelivery.primaryArtifactRefs,
        ...fixture.expectedProjection.artifactDelivery.supportingArtifactRefs,
      ],
      auditRefs: [],
      diagnosticRefs: [],
      internalRefs: [],
      ...browserOverrides,
    },
    kernelProjection: fixture.expectedProjection.conversationProjection,
    sessionBundle: { session, workspaceState: fixture.workspaceState },
    runAudit: runAuditFromSession(session, fixture.expectedProjection),
    artifactDeliveryManifest: artifactDeliveryManifestFromSession(session, fixture.expectedProjection),
  };
}
