import { dirname, resolve } from 'node:path';

import type { SkillAvailability, SkillManifest } from '../runtime-types.js';
import { fileExists } from '../workspace-task-runner.js';

export async function validateSkillAvailability(
  manifest: SkillManifest,
  manifestPath: string,
): Promise<SkillAvailability> {
  const checkedAt = new Date().toISOString();
  const missing = requiredManifestFields
    .filter((key) => !(key in manifest) || manifest[key] === undefined || manifest[key] === '');

  if (missing.length) {
    return unavailable(manifest, manifestPath, checkedAt, `Manifest missing ${missing.join(', ')}`);
  }
  if (!manifest.skillDomains.length) {
    return unavailable(manifest, manifestPath, checkedAt, 'Manifest skillDomains is empty');
  }
  if (manifest.entrypoint.type === 'workspace-task' && manifest.entrypoint.path) {
    const entrypointPath = resolve(dirname(manifestPath), manifest.entrypoint.path);
    if (!await fileExists(entrypointPath)) {
      return unavailable(manifest, manifestPath, checkedAt, `Entrypoint not found: ${entrypointPath}`);
    }
  }
  if (manifest.entrypoint.type === 'markdown-skill' && manifest.entrypoint.path) {
    const markdownPath = resolve(process.cwd(), manifest.entrypoint.path);
    if (!await fileExists(markdownPath)) {
      return unavailable(manifest, manifestPath, checkedAt, `Markdown skill not found: ${manifest.entrypoint.path}`);
    }
  }

  return {
    id: manifest.id,
    kind: manifest.kind,
    available: true,
    reason: 'Manifest validation passed',
    checkedAt,
    manifestPath,
    manifest,
  };
}

const requiredManifestFields: Array<keyof SkillManifest> = [
  'id',
  'description',
  'inputContract',
  'outputArtifactSchema',
  'entrypoint',
  'environment',
  'validationSmoke',
  'examplePrompts',
  'promotionHistory',
];

function unavailable(
  manifest: SkillManifest,
  manifestPath: string,
  checkedAt: string,
  reason: string,
): SkillAvailability {
  return {
    id: manifest.id || manifestPath,
    kind: manifest.kind,
    available: false,
    reason,
    checkedAt,
    manifestPath,
    manifest,
  };
}
