import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { discoverMarkdownSkillPackages, markdownSkillPackageToRuntimeManifest } from '../skill-markdown-catalog.js';
import type { GatewayRequest, SkillAvailability } from '../runtime-types.js';
import { fileExists } from '../workspace-task-runner.js';
import { validateSkillAvailability } from './availability-validation.js';
import { readSkillManifest } from './manifest-schema.js';

export async function loadSkillRegistry(request: Pick<GatewayRequest, 'workspacePath'>): Promise<SkillAvailability[]> {
  const workspace = resolve(request.workspacePath || process.cwd());
  const skills = await loadPackageSkillAvailability();

  for (const manifestPath of await findSkillManifestFiles(join(workspace, '.sciforge', 'evolved-skills'))) {
    const manifest = await readSkillManifest(manifestPath, 'workspace');
    skills.push(await validateSkillAvailability(manifest, manifestPath));
  }

  await persistWorkspaceSkillStatus(workspace, skills);
  return skills;
}

export async function loadPackageSkillAvailability(): Promise<SkillAvailability[]> {
  const packageSkills = await discoverMarkdownSkillPackages();
  return Promise.all(
    packageSkills.map((manifest) => validateSkillAvailability(
      markdownSkillPackageToRuntimeManifest(manifest),
      resolve(process.cwd(), manifest.docs.readmePath),
    )),
  );
}

export async function findSkillManifestFiles(root: string): Promise<string[]> {
  if (!await fileExists(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await findSkillManifestFiles(path));
    if (entry.isFile() && entry.name === 'skill.json') files.push(path);
  }
  return files;
}

export async function persistWorkspaceSkillStatus(workspace: string, skills: SkillAvailability[]) {
  const statusPath = join(workspace, '.sciforge', 'skills', 'status.json');
  await mkdir(dirname(statusPath), { recursive: true });
  await writeFile(statusPath, JSON.stringify({
    updatedAt: new Date().toISOString(),
    skills: skills.map((skill) => ({
      id: skill.id,
      kind: skill.kind,
      available: skill.available,
      reason: skill.reason,
      checkedAt: skill.checkedAt,
      manifestPath: skill.manifestPath,
    })),
  }, null, 2));
}
