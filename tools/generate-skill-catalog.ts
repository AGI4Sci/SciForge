import { writeFile } from 'node:fs/promises';

import { discoverMarkdownSkillPackages, discoverMarkdownToolPackages } from '../packages/skills/markdown-catalog';

const skills = await discoverMarkdownSkillPackages();
const tools = await discoverMarkdownToolPackages();

await writeFile('packages/skills/types.ts', [
  "export type SkillPackageSource = 'package' | 'workspace' | 'generated';",
  "export interface SkillPackageManifest { [key: string]: unknown; id: string; packageName: string; kind: 'skill'; version: string; label: string; description: string; source: SkillPackageSource; skillDomains: string[]; inputContract: Record<string, unknown>; outputArtifactTypes: string[]; entrypointType: 'markdown-skill'; requiredCapabilities: Array<{ capability: string; level: string }>; failureModes: string[]; examplePrompts: string[]; docs: { readmePath: string; agentSummary: string; }; packageRoot: string; tags: string[]; scpToolId?: string; scpHubUrl?: string; }",
  '',
].join('\n'));

await writeFile('packages/skills/catalog.ts', [
  "import type { SkillPackageManifest } from './types';",
  '',
  `export const skillPackageManifests = ${JSON.stringify(skills, null, 2)} as const satisfies readonly SkillPackageManifest[];`,
  '',
].join('\n'));

await writeFile('packages/skills/index.ts', [
  "export { skillPackageManifests } from './catalog';",
  "export { scoreSkillByPackagePolicy, skillAllowedByPackagePolicy } from './matching-policy';",
  "export type { MatchableSkill, MatchableSkillManifest, SkillDomain } from './matching-policy';",
  "export type { SkillPackageManifest, SkillPackageSource } from './types';",
  '',
].join('\n'));

await writeFile('packages/skills/tool_skills/types.ts', [
  "export type ToolPackageSource = 'package' | 'workspace' | 'generated';",
  "export interface SensePluginManifest { id: string; modality: string; inputContract: { textField: string; modalitiesField: string; acceptedModalities: string[]; }; outputContract: { kind: 'text'; formats: string[]; commandSchema?: Record<string, unknown>; }; executionBoundary: 'text-signal-only' | 'direct-executor' | 'hybrid'; safety: { defaultRiskLevel: 'low' | 'medium' | 'high'; highRiskPolicy: 'reject' | 'require-confirmation' | 'allow'; }; }",
  "export interface ToolPackageManifest { [key: string]: unknown; id: string; packageName: string; kind: 'tool'; version: string; label: string; description: string; source: ToolPackageSource; toolType: 'database' | 'runner' | 'connector' | 'llm-backend' | 'visual-runtime' | 'sense-plugin'; skillDomains: string[]; producesArtifactTypes?: string[]; requiredConfig?: string[]; docs: { readmePath: string; agentSummary: string; }; packageRoot: string; tags: string[]; provider?: string; sourceUrl?: string; mcpCommand?: string; mcpArgs?: string[]; sensePlugin?: SensePluginManifest; }",
  '',
].join('\n'));

await writeFile('packages/skills/tool_skills/index.ts', [
  "import type { ToolPackageManifest } from './types';",
  '',
  `export const toolPackageManifests = ${JSON.stringify(tools, null, 2)} as const satisfies readonly ToolPackageManifest[];`,
  '',
  "export type { SensePluginManifest, ToolPackageManifest, ToolPackageSource } from './types';",
  '',
].join('\n'));

console.log(JSON.stringify({
  ok: true,
  skills: skills.length,
  tools: tools.length,
  skillMarkdownFiles: skills.map((skill) => skill.docs.readmePath),
  toolMarkdownFiles: tools.map((tool) => tool.docs.readmePath),
}, null, 2));
