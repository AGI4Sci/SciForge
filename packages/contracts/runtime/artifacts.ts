import type { ScenarioInstanceId, ScenarioPackageRef } from './app';
import type { PreviewDescriptor } from './preview';

export type RuntimeArtifactVisibility = 'private-draft' | 'team-visible' | 'project-record' | 'restricted-sensitive';
export type RuntimeArtifactExportPolicy = 'allowed' | 'restricted' | 'blocked';

export interface RuntimeArtifact {
  id: string;
  type: string;
  producerScenario: ScenarioInstanceId;
  scenarioPackageRef?: ScenarioPackageRef;
  schemaVersion: string;
  metadata?: Record<string, unknown>;
  data?: unknown;
  dataRef?: string;
  path?: string;
  previewDescriptor?: PreviewDescriptor;
  visibility?: RuntimeArtifactVisibility;
  audience?: string[];
  sensitiveDataFlags?: string[];
  exportPolicy?: RuntimeArtifactExportPolicy;
}
