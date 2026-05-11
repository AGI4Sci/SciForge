import type { SkillPackageManifest } from './types';
import type { ToolPackageManifest } from './tool_skills/types';

const PACKAGE_ROUTING_TAGS = new Set([
  '',
  'package',
  'agentserver-generation',
  'artifact-emission',
  'schema-checked',
  'self-healing',
  'research-report',
  'structure-summary',
  'sequence-alignment',
  'knowledge-graph',
  'vision-trace',
  'supporting-runtime-data',
]);

const TOOL_PACKAGE_DEFAULT_OUTPUT_ARTIFACT_TYPES = ['supporting-runtime-data'];

export function compactSkillCapabilityRoutingTags(tags: readonly string[]): string[] {
  return tags.filter((tag) => !PACKAGE_ROUTING_TAGS.has(tag.trim()));
}

export function skillPackageRepairActions(failureCode: string): string[] {
  if (failureCode.includes('backend') || failureCode.includes('unavailable')) {
    return ['fallback-skill', 'request-provider-configuration'];
  }
  if (failureCode.includes('schema')) return ['validate-artifact-contract', 'repair-output-schema'];
  if (failureCode.includes('input')) return ['request-missing-input', 'reuse-available-refs'];
  return ['fallback-skill', 'retry-with-compact-context'];
}

export function skillPackageRequiredConfig(skill: SkillPackageManifest): string[] {
  return skill.scpToolId ? ['scp-hub-api-key'] : [];
}

export function toolPackageOutputArtifactTypes(tool: ToolPackageManifest): string[] {
  return [...(tool.producesArtifactTypes?.length ? tool.producesArtifactTypes : TOOL_PACKAGE_DEFAULT_OUTPUT_ARTIFACT_TYPES)];
}

export function toolPackageUnavailableRepairHints() {
  return [{
    failureCode: 'tool-provider-unavailable',
    summary: 'Select a fallback tool provider or report the missing package configuration.',
    recoverActions: ['fallback-tool-provider', 'request-tool-configuration'],
  }];
}
