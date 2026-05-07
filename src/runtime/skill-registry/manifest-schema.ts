import { readFile } from 'node:fs/promises';

import type { SciForgeSkillDomain, SkillManifest } from '../runtime-types.js';

export async function readSkillManifest(path: string, kind: SkillManifest['kind']): Promise<SkillManifest> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<SkillManifest>;
  return normalizeSkillManifest(parsed, kind);
}

export function normalizeSkillManifest(parsed: Partial<SkillManifest>, kind: SkillManifest['kind']): SkillManifest {
  return {
    id: String(parsed.id || ''),
    kind: parsed.kind ?? kind,
    description: String(parsed.description || ''),
    skillDomains: Array.isArray(parsed.skillDomains) ? parsed.skillDomains as SciForgeSkillDomain[] : [],
    inputContract: recordOrEmpty(parsed.inputContract),
    outputArtifactSchema: recordOrEmpty(parsed.outputArtifactSchema),
    entrypoint: recordOrEmpty(parsed.entrypoint) as SkillManifest['entrypoint'],
    environment: recordOrEmpty(parsed.environment),
    validationSmoke: recordOrEmpty(parsed.validationSmoke),
    examplePrompts: Array.isArray(parsed.examplePrompts) ? parsed.examplePrompts.map(String) : [],
    promotionHistory: Array.isArray(parsed.promotionHistory) ? parsed.promotionHistory.filter(isRecord) : [],
    scopeDeclaration: isRecord(parsed.scopeDeclaration) ? parsed.scopeDeclaration : undefined,
  };
}

export function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
