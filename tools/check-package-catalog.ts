import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { discoverMarkdownSkillPackages, discoverMarkdownToolPackages } from '../src/runtime/skill-markdown-catalog.js';
import { skillPackageManifests } from '../packages/skills';
import { toolPackageManifests } from '../packages/skills/tool_skills';
import { uiComponentManifests } from '../packages/presentation/components';

type PackageManifest = {
  id?: string;
  componentId?: string;
  packageName: string;
  version: string;
  docs: { readmePath: string; agentSummary: string };
};

const manifests: PackageManifest[] = [
  ...uiComponentManifests,
];
const discoveredSkills = await discoverMarkdownSkillPackages();
const discoveredTools = await discoverMarkdownToolPackages();

const packageNames = new Set<string>();
const packageIds = new Set<string>();
const forbiddenPackageReferences = [
  'skills/seed',
  'workspace/skills',
  'scpSkillCatalog',
  'seed-skill',
  '"manifestPath"',
];

for (const manifest of manifests) {
  assert.ok(manifest.packageName.startsWith('@sciforge-'), `${manifest.packageName} must use a SciForge package scope`);
  assert.ok(manifest.version, `${manifest.packageName} must declare a version`);
  assert.ok(manifest.docs.readmePath, `${manifest.packageName} must point to README.md`);
  assert.ok(manifest.docs.agentSummary.trim(), `${manifest.packageName} must expose docs.agentSummary`);
  assert.ok(existsSync(manifest.docs.readmePath), `${manifest.packageName} README must exist at ${manifest.docs.readmePath}`);
  assert.equal(packageNames.has(manifest.packageName), false, `duplicate packageName: ${manifest.packageName}`);
  packageNames.add(manifest.packageName);

  const id = manifest.componentId ?? manifest.id;
  assert.ok(id, `${manifest.packageName} must expose id or componentId for catalog discovery`);
  assert.equal(packageIds.has(id), false, `duplicate package catalog id: ${id}`);
  packageIds.add(id);
}

const artifactPreviewPackageJson = JSON.parse(await readFile('packages/support/artifact-preview/package.json', 'utf8')) as { name?: string; private?: boolean };
assert.equal(artifactPreviewPackageJson.name, '@sciforge-ui/artifact-preview', 'artifact-preview package name must be stable');
assert.notEqual(artifactPreviewPackageJson.private, true, '@sciforge-ui/artifact-preview must be publishable');
assert.ok(existsSync('packages/support/artifact-preview/README.md'), '@sciforge-ui/artifact-preview must have README.md');
assert.ok(existsSync('packages/support/artifact-preview/index.ts'), '@sciforge-ui/artifact-preview must export runtime preview utilities');

for (const file of await packageFiles('packages')) {
  const text = await readFile(file, 'utf8');
  for (const forbidden of forbiddenPackageReferences) {
    assert.equal(text.includes(forbidden), false, `${file} must not reference legacy package source ${forbidden}`);
  }
}

assert.equal(skillPackageManifests.length, discoveredSkills.length, 'generated packages/skills index must match discovered SKILL.md count');
assert.deepEqual(
  skillPackageManifests.map((skill) => skill.docs.readmePath).sort(),
  discoveredSkills.map((skill) => skill.docs.readmePath).sort(),
  'generated packages/skills index must be regenerated from current SKILL.md files',
);
const skillIds = new Set<string>();
for (const skill of discoveredSkills) {
  assert.equal(skillIds.has(skill.id), false, `duplicate SKILL.md skill id: ${skill.id}`);
  skillIds.add(skill.id);
  assert.ok(skill.docs.readmePath.endsWith('/SKILL.md'), `${skill.id} must use SKILL.md as agent-readable source`);
  assert.ok(existsSync(skill.docs.readmePath), `${skill.id} SKILL.md must exist`);
  assert.ok(skill.description.trim(), `${skill.id} must expose a description from SKILL.md`);
  assert.ok(skill.skillDomains.length, `${skill.id} must infer at least one skill domain`);
  assert.equal(skill.source, 'package', `${skill.id} source must be package`);
  assert.notEqual(skill.tags.includes('scp-skill'), true, `${skill.id} must not use scp-skill as source/tag`);
}

assert.equal(toolPackageManifests.length, discoveredTools.length, 'generated packages/skills/tool_skills index must match discovered SKILL.md count');
assert.deepEqual(
  toolPackageManifests.map((tool) => tool.docs.readmePath).sort(),
  discoveredTools.map((tool) => tool.docs.readmePath).sort(),
  'generated packages/skills/tool_skills index must be regenerated from current SKILL.md files',
);
const toolIds = new Set<string>();
for (const tool of discoveredTools) {
  assert.equal(toolIds.has(tool.id), false, `duplicate tool SKILL.md id: ${tool.id}`);
  toolIds.add(tool.id);
  assert.ok(tool.docs.readmePath.endsWith('/SKILL.md'), `${tool.id} must use SKILL.md as agent-readable source`);
  assert.ok(existsSync(tool.docs.readmePath), `${tool.id} SKILL.md must exist`);
  assert.ok(tool.description.trim(), `${tool.id} must expose a description from SKILL.md`);
  assert.ok(tool.skillDomains.length, `${tool.id} must infer at least one skill domain`);
  assert.equal(tool.source, 'package', `${tool.id} source must be package`);
}

console.log(JSON.stringify({
  ok: true,
  packages: manifests.length + discoveredSkills.length + discoveredTools.length,
  uiComponents: uiComponentManifests.length,
  skills: discoveredSkills.length,
  tools: discoveredTools.length,
}, null, 2));

async function packageFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await packageFiles(path));
      continue;
    }
    if (entry.isFile() && /\.(json|md|ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}
