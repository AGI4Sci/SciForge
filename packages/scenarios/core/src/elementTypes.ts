import type { ScenarioId, UIManifestSlot } from './contracts';
import type { ArtifactSchemaField, SkillDomain } from './scenarioSpecs';

export type ElementKind =
  | 'skill'
  | 'tool'
  | 'artifact-schema'
  | 'ui-component'
  | 'view-preset'
  | 'role-policy'
  | 'failure-policy';

export interface ElementManifestBase {
  id: string;
  kind: ElementKind;
  version: string;
  label: string;
  description: string;
  source: 'built-in' | 'package' | 'workspace' | 'generated';
  tags?: string[];
}

export interface CapabilityRequirement {
  capability: string;
  level: 'none' | 'basic' | 'deterministic' | 'schema-checked' | 'self-healing' | 'external-tool';
}

export interface SkillElement extends ElementManifestBase {
  kind: 'skill';
  skillDomains: SkillDomain[];
  inputContract: Record<string, unknown>;
  outputArtifactTypes: string[];
  entrypointType: 'workspace-task' | 'inspector' | 'agentserver-generation' | 'markdown-skill';
  requiredCapabilities: CapabilityRequirement[];
  failureModes: string[];
  examplePrompts: string[];
  manifestPath?: string;
}

export interface ToolElement extends ElementManifestBase {
  kind: 'tool';
  toolType: 'database' | 'runner' | 'connector' | 'llm-backend' | 'visual-runtime' | 'sense-plugin';
  skillDomains: SkillDomain[];
  producesArtifactTypes?: string[];
  requiredConfig?: string[];
}

export interface ArtifactSchemaElement extends ElementManifestBase {
  kind: 'artifact-schema';
  artifactType: string;
  fields: ArtifactSchemaField[];
  producerSkillIds: string[];
  consumerComponentIds: string[];
  handoffTargets: ScenarioId[];
}

export interface UIComponentElement extends ElementManifestBase {
  kind: 'ui-component';
  componentId: string;
  acceptsArtifactTypes: string[];
  requiredFields: string[];
  emptyState: {
    title: string;
    detail: string;
  };
  recoverActions: string[];
  viewParams: string[];
  interactionEvents: string[];
  roleDefaults: string[];
  fallback: string;
}

export interface ViewPresetElement extends ElementManifestBase {
  kind: 'view-preset';
  componentIds: string[];
  artifactTypes: string[];
  slots: UIManifestSlot[];
}

export interface RolePolicyElement extends ElementManifestBase {
  kind: 'role-policy';
  roleId: string;
  defaultVisibleComponents: string[];
  preferredViewParams: string[];
}

export interface FailurePolicyElement extends ElementManifestBase {
  kind: 'failure-policy';
  failureMode: string;
  recoverActions: string[];
  fallbackComponentId: string;
}

export type ElementManifest =
  | SkillElement
  | ToolElement
  | ArtifactSchemaElement
  | UIComponentElement
  | ViewPresetElement
  | RolePolicyElement
  | FailurePolicyElement;

export interface ElementRegistry {
  skills: SkillElement[];
  tools: ToolElement[];
  artifacts: ArtifactSchemaElement[];
  components: UIComponentElement[];
  viewPresets: ViewPresetElement[];
  rolePolicies: RolePolicyElement[];
  failurePolicies: FailurePolicyElement[];
}

export interface RegistryValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  elementId?: string;
}

export interface RegistryValidationReport {
  ok: boolean;
  issues: RegistryValidationIssue[];
}
