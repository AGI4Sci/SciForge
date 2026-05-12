import type { ScenarioInstanceId, ScenarioPackageRef } from './app';
import type { PreviewDescriptor } from './preview';

export type RuntimeArtifactVisibility = 'private-draft' | 'team-visible' | 'project-record' | 'restricted-sensitive';
export type RuntimeArtifactExportPolicy = 'allowed' | 'restricted' | 'blocked';
export type RuntimeArtifactDerivationVerificationStatus = 'verified' | 'unverified' | 'needs-review' | 'failed';

export interface RuntimeArtifactDerivation {
  schemaVersion: 'sciforge.artifact-derivation.v1';
  kind: 'summary' | 'translation' | 'glossary' | 'correction' | 'rewrite' | string;
  parentArtifactRef?: string;
  sourceRefs: string[];
  sourceLanguage?: string;
  targetLanguage?: string;
  verificationStatus?: RuntimeArtifactDerivationVerificationStatus;
}

export interface RuntimeArtifactMetadata extends Record<string, unknown> {
  language?: string;
  role?: string;
  derivation?: RuntimeArtifactDerivation;
}

export interface RuntimeArtifact {
  id: string;
  type: string;
  producerScenario: ScenarioInstanceId;
  scenarioPackageRef?: ScenarioPackageRef;
  schemaVersion: string;
  metadata?: RuntimeArtifactMetadata;
  data?: unknown;
  dataRef?: string;
  path?: string;
  previewDescriptor?: PreviewDescriptor;
  visibility?: RuntimeArtifactVisibility;
  audience?: string[];
  sensitiveDataFlags?: string[];
  exportPolicy?: RuntimeArtifactExportPolicy;
}
