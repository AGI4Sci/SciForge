export const SCENARIO_VALIDATION_ISSUE_CODES = {
  unknownArtifactSchema: 'unknown-artifact-schema',
  missingSelectedProducer: 'missing-selected-producer',
  unknownSkill: 'unknown-skill',
  unknownTool: 'unknown-tool',
  unknownFailurePolicy: 'unknown-failure-policy',
  missingSmokeTest: 'missing-smoke-test',
  policyOnlyViolation: 'scenario-package-policy-only-violation',
} as const;

export const SCENARIO_VALIDATION_MESSAGES = {
  unknownArtifactSchema: (artifactType: string) => `Unknown artifact schema: ${artifactType}`,
  missingSelectedProducer: (artifactType: string) => `No selected skill produces artifact: ${artifactType}`,
  unknownSkill: (skillId: string) => `Unknown selected skill: ${skillId}`,
  unknownTool: (toolId: string) => `Unknown selected tool: ${toolId}`,
  unknownFailurePolicy: (policyId: string) => `Unknown failure policy: ${policyId}`,
  missingSmokeTest: 'Scenario package has no smoke tests.',
} as const;
