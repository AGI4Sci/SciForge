import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadSkillRegistry, matchSkill } from '../../src/runtime/skill-registry.js';
import type { SkillAvailability } from '../../src/runtime/runtime-types.js';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-skill-registry-'));
const brokenSkillDir = join(workspace, '.bioagent', 'evolved-skills', 'broken.skill');
await mkdir(brokenSkillDir, { recursive: true });
await writeFile(join(brokenSkillDir, 'skill.json'), JSON.stringify({
  id: 'broken.skill',
  kind: 'workspace',
  description: 'Broken workspace skill used by registry smoke.',
  skillDomains: ['literature'],
  inputContract: { prompt: 'string' },
  outputArtifactSchema: { type: 'paper-list' },
  entrypoint: { type: 'workspace-task', command: 'python', path: './missing-task.py' },
  environment: { language: 'python' },
  validationSmoke: { mode: 'workspace-task', prompt: 'KRAS', expectedArtifactType: 'paper-list' },
  examplePrompts: ['KRAS literature broken skill'],
  promotionHistory: [],
}, null, 2));

const skills = await loadSkillRegistry({ workspacePath: workspace });
const byId = new Map(skills.map((skill) => [skill.id, skill]));

const scpMarkdownSkills = skills.filter((skill) => skill.id.startsWith('scp.') && skill.manifest.entrypoint.type === 'markdown-skill');
assert.equal(scpMarkdownSkills.length, 121, 'SCP Markdown skills should be available to the runtime registry');
for (const id of [
  'scp.protein-blast-search',
  'scp.protein-properties-calculation',
  'scp.tcga-gene-expression',
  'scp.biomedical-web-search',
]) {
  assert.equal(byId.get(id)?.available, true, `${id} should be available`);
  assert.equal(byId.get(id)?.manifest.entrypoint.type, 'markdown-skill');
}

const broken = byId.get('broken.skill');
assert.equal(broken?.available, false);
assert.match(String(broken?.reason), /Entrypoint not found/);

const matched = matchSkill({
  skillDomain: 'literature',
  prompt: 'KRAS literature broken skill',
  workspacePath: workspace,
  artifacts: [],
  availableSkills: ['broken.skill'],
}, skills);
assert.equal(matched, undefined, 'unavailable skills must not be matched even when explicitly allowed');

const knowledgeMatched = matchSkill({
  skillDomain: 'knowledge',
  prompt: 'BRAF V600E melanoma target prioritization with ChEMBL drug-target network, data table, evidence matrix',
  workspacePath: workspace,
  artifacts: [],
}, skills);
assert.notEqual(knowledgeMatched?.id, 'inspector.generic_file_table_log', 'raw knowledge prompts with "data table" should not route to the generic inspector');

const blastMatched = matchSkill({
  skillDomain: 'knowledge',
  prompt: 'BLASTP protein sequence alignment result table for sequence=MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKT',
  workspacePath: workspace,
  artifacts: [],
}, skills);
assert.equal(blastMatched?.id, 'scp.protein-blast-search', 'BLAST protein sequence prompts should route to a SKILL.md BLAST skill');

const proteinPropertiesMatched = matchSkill({
  skillDomain: 'knowledge',
  prompt: 'Calculate protein physicochemical properties molecular weight isoelectric point and instability index for sequence MKWVTFISLLFLFSSAYSRGVFRRDTHKSEIAHRFKDLGE',
  workspacePath: workspace,
  artifacts: [],
}, skills);
assert.equal(proteinPropertiesMatched?.id, 'scp.protein-properties-calculation', 'SCP protein properties Markdown skill should be matchable');

const tcgaMatched = matchSkill({
  skillDomain: 'omics',
  prompt: 'Query TCGA gene expression for EGFR in LUAD tumor versus normal and include survival context',
  workspacePath: workspace,
  artifacts: [],
}, skills);
assert.equal(tcgaMatched?.id, 'scp.tcga-gene-expression', 'SCP TCGA Markdown skill should be matchable in omics');

const status = JSON.parse(await readFile(join(workspace, '.bioagent', 'skills', 'status.json'), 'utf8')) as {
  skills: Array<Pick<SkillAvailability, 'id' | 'available' | 'reason'>>;
};
const statusBroken = status.skills.find((skill) => skill.id === 'broken.skill');
assert.equal(statusBroken?.available, false);
assert.match(String(statusBroken?.reason), /Entrypoint not found/);

console.log('[ok] skill registry smoke writes status and excludes unavailable workspace skills');
