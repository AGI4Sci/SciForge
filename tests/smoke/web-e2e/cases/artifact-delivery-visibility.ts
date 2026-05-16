import {
  artifactDeliveryManifestFromSession,
  assertWebE2eContract,
  runAuditFromSession,
  verifyWebE2eContract,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
} from '../contract-verifier.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import type { WebE2eFixtureWorkspace } from '../types.js';

export const ARTIFACT_DELIVERY_VISIBILITY_CASE_ID = 'SA-WEB-09-artifact-delivery-visibility';

export interface ArtifactDeliveryVisibilityCaseResult {
  fixture: WebE2eFixtureWorkspace;
  input: WebE2eContractVerifierInput;
}

export async function buildArtifactDeliveryVisibilityCase(): Promise<ArtifactDeliveryVisibilityCaseResult> {
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId: ARTIFACT_DELIVERY_VISIBILITY_CASE_ID,
    now: '2026-05-16T00:00:00.000Z',
    title: 'ArtifactDelivery visibility Web E2E case',
    prompt: 'Show only primary and supporting artifacts in the main result; keep diagnostics in audit.',
  });
  const input = artifactDeliveryVisibilityVerifierInput(fixture);
  assertWebE2eContract(input);
  return { fixture, input };
}

export function artifactDeliveryVisibilityVerifierInput(
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
      primaryArtifactRefs: [...fixture.expectedProjection.artifactDelivery.primaryArtifactRefs],
      supportingArtifactRefs: [...fixture.expectedProjection.artifactDelivery.supportingArtifactRefs],
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

export function verifyArtifactDeliveryVisibilityCase(input: WebE2eContractVerifierInput) {
  return verifyWebE2eContract(input);
}
