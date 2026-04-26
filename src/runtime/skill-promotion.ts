import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { GatewayRequest, SkillAvailability, SkillManifest, SkillPromotionProposal, ToolPayload } from './runtime-types.js';
import { fileExists, sha1 } from './workspace-task-runner.js';

export async function maybeWriteSkillPromotionProposal(params: {
  workspacePath: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  taskId: string;
  taskRel: string;
  inputRef?: string;
  outputRef?: string;
  stdoutRef?: string;
  stderrRef?: string;
  payload: ToolPayload;
  selfHealed?: boolean;
  patchSummary?: string;
}): Promise<SkillPromotionProposal | undefined> {
  if (!shouldProposeSkill(params.skill, params.taskRel, params.selfHealed)) return undefined;
  const workspace = resolve(params.workspacePath || process.cwd());
  const sourceTask = join(workspace, params.taskRel);
  if (!await fileExists(sourceTask)) return undefined;
  const proposal = buildSkillPromotionProposal({ ...params, workspacePath: workspace });
  const proposalDir = join(workspace, '.bioagent', 'skill-proposals', safeName(proposal.id));
  await mkdir(proposalDir, { recursive: true });
  await writeFile(join(proposalDir, 'proposal.json'), JSON.stringify(proposal, null, 2));
  await writeFile(join(proposalDir, 'README.md'), proposalReadme(proposal), 'utf8');
  return proposal;
}

export async function listSkillPromotionProposals(workspacePath: string): Promise<SkillPromotionProposal[]> {
  const workspace = resolve(workspacePath || process.cwd());
  const root = join(workspace, '.bioagent', 'skill-proposals');
  if (!await fileExists(root)) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const proposals: SkillPromotionProposal[] = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    try {
      const parsed = JSON.parse(await readFile(join(root, entry.name, 'proposal.json'), 'utf8'));
      if (isSkillPromotionProposal(parsed)) proposals.push(parsed);
    } catch {
      // Skip malformed proposals; direct accept reports the parse error.
    }
  }
  return proposals.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function acceptSkillPromotionProposal(workspacePath: string, proposalId: string): Promise<SkillManifest> {
  const workspace = resolve(workspacePath || process.cwd());
  const proposalPath = join(workspace, '.bioagent', 'skill-proposals', safeName(proposalId), 'proposal.json');
  const parsed = JSON.parse(await readFile(proposalPath, 'utf8'));
  if (!isSkillPromotionProposal(parsed)) throw new Error(`Invalid skill promotion proposal: ${proposalId}`);
  const manifest = parsed.proposedManifest;
  const skillDir = join(workspace, '.bioagent', 'evolved-skills', safeName(manifest.id));
  await mkdir(skillDir, { recursive: true });
  const sourceTask = join(workspace, parsed.source.taskCodeRef);
  if (!await fileExists(sourceTask)) throw new Error(`Promotion source task is missing: ${parsed.source.taskCodeRef}`);
  const taskName = taskFileNameForManifest(manifest);
  await copyFile(sourceTask, join(skillDir, taskName));
  const installedManifest: SkillManifest = {
    ...manifest,
    kind: 'workspace',
    entrypoint: {
      ...manifest.entrypoint,
      type: 'workspace-task',
      command: manifest.entrypoint.command || 'python',
      path: `./${taskName}`,
    },
    promotionHistory: [
      ...manifest.promotionHistory,
      {
        proposalId: parsed.id,
        acceptedAt: new Date().toISOString(),
        sourceTaskCodeRef: parsed.source.taskCodeRef,
        sourceOutputRef: parsed.source.outputRef,
        sourceExecutionUnitRefs: parsed.source.successfulExecutionUnitRefs,
      },
    ],
  };
  await writeFile(join(skillDir, 'skill.json'), JSON.stringify(installedManifest, null, 2));
  const accepted: SkillPromotionProposal = {
    ...parsed,
    status: 'accepted',
    reviewChecklist: {
      ...parsed.reviewChecklist,
      userConfirmedPromotion: true,
    },
  };
  await writeFile(proposalPath, JSON.stringify(accepted, null, 2));
  return installedManifest;
}

function shouldProposeSkill(skill: SkillAvailability, taskRel: string, selfHealed?: boolean) {
  if (selfHealed) return true;
  if (skill.manifest.entrypoint.type === 'agentserver-generation') return true;
  if (skill.id.startsWith('agentserver.generate.')) return true;
  return taskRel.includes('/generated-');
}

function buildSkillPromotionProposal(params: {
  workspacePath: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  taskId: string;
  taskRel: string;
  inputRef?: string;
  outputRef?: string;
  stdoutRef?: string;
  stderrRef?: string;
  payload: ToolPayload;
  selfHealed?: boolean;
  patchSummary?: string;
}): SkillPromotionProposal {
  const artifactTypes = uniqueStrings(params.payload.artifacts.map((artifact) => String(artifact.type || artifact.id || '')).filter(Boolean));
  const skillId = `workspace.${params.request.skillDomain}.${slugForPrompt(params.request.prompt)}.${sha1(`${params.taskRel}:${artifactTypes.join(',')}`).slice(0, 8)}`;
  const proposalId = `proposal.${skillId}.${sha1(`${params.taskId}:${params.outputRef || ''}`).slice(0, 10)}`;
  const manifest: SkillManifest = {
    id: skillId,
    kind: 'workspace',
    description: `Workspace-generated skill candidate from: ${params.request.prompt.slice(0, 160)}`,
    skillDomains: [params.request.skillDomain],
    inputContract: {
      prompt: 'Free-text prompt used to parameterize this generated workspace task.',
      sourceAttempt: params.taskId,
    },
    outputArtifactSchema: artifactTypes.length === 1 ? { type: artifactTypes[0] } : { types: artifactTypes },
    entrypoint: {
      type: 'workspace-task',
      command: 'python',
      path: './task.py',
    },
    environment: {
      language: 'python',
      sourceRuntime: params.skill.id,
      selfHealed: params.selfHealed === true,
    },
    validationSmoke: {
      mode: 'workspace-task',
      prompt: params.request.prompt,
      expectedArtifactTypes: artifactTypes,
    },
    examplePrompts: [params.request.prompt],
    promotionHistory: [{
      sourceTaskId: params.taskId,
      sourceTaskCodeRef: params.taskRel,
      sourceOutputRef: params.outputRef,
      sourceSkillId: params.skill.id,
      patchSummary: params.patchSummary,
      createdAt: new Date().toISOString(),
    }],
    scopeDeclaration: {
      source: 'workspace-generated-task',
      taskCodeRef: params.taskRel,
      status: 'needs-user-confirmation',
      supportedTasks: [`Repeat or adapt the successful workspace task for ${params.request.skillDomain} prompts.`],
      unsupportedTasks: ['Promotion without reviewing generated code, dependencies, and hard-coded user data.'],
    },
  };
  return {
    id: proposalId,
    status: 'needs-user-confirmation',
    createdAt: new Date().toISOString(),
    source: {
      workspacePath: params.workspacePath,
      taskCodeRef: params.taskRel,
      inputRef: params.inputRef,
      outputRef: params.outputRef,
      stdoutRef: params.stdoutRef,
      stderrRef: params.stderrRef,
      successfulExecutionUnitRefs: params.payload.executionUnits
        .filter((unit) => isRecord(unit))
        .map((unit) => String(unit.id || unit.codeRef || params.taskId))
        .filter(Boolean),
    },
    proposedManifest: manifest,
    generalizationNotes: [
      'Generated automatically after a successful workspace task run.',
      'Review task code for hard-coded user data, credentials, absolute paths, and over-specific prompt assumptions before accepting.',
      params.selfHealed ? 'This candidate came from a self-healed run; keep the repair diff as evidence before promotion.' : 'This candidate came from AgentServer-generated task code.',
    ],
    validationPlan: {
      smokePrompts: [params.request.prompt],
      expectedArtifactTypes: artifactTypes,
      requiredEnvironment: manifest.environment,
    },
    reviewChecklist: {
      noHardCodedUserData: false,
      reproducibleEntrypoint: true,
      artifactSchemaValidated: true,
      failureModeIsExplicit: params.payload.executionUnits.every((unit) => !isRecord(unit) || unit.status === 'done' || unit.status === 'self-healed'),
      userConfirmedPromotion: false,
    },
  };
}

function proposalReadme(proposal: SkillPromotionProposal) {
  return [
    `# ${proposal.proposedManifest.id}`,
    '',
    proposal.proposedManifest.description,
    '',
    '## Source',
    `- task: ${proposal.source.taskCodeRef}`,
    proposal.source.outputRef ? `- output: ${proposal.source.outputRef}` : '',
    proposal.source.stdoutRef ? `- stdout: ${proposal.source.stdoutRef}` : '',
    proposal.source.stderrRef ? `- stderr: ${proposal.source.stderrRef}` : '',
    '',
    '## Required Review',
    '- Check generated code for hard-coded user data, credentials, absolute paths, and hidden network assumptions.',
    '- Run the validation smoke prompt before accepting.',
    '- Accepting the proposal installs it into `.bioagent/evolved-skills/` for future registry matching without modifying seed or preinstalled skills.',
  ].filter(Boolean).join('\n');
}

function taskFileNameForManifest(manifest: SkillManifest) {
  const current = typeof manifest.entrypoint.path === 'string' ? basename(manifest.entrypoint.path) : 'task.py';
  return current.endsWith('.py') ? current : 'task.py';
}

function slugForPrompt(prompt: string) {
  const ascii = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return ascii || 'generated-task';
}

function safeName(value: string) {
  return basename(value.replace(/[^a-zA-Z0-9._-]+/g, '_')).slice(0, 160);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSkillPromotionProposal(value: unknown): value is SkillPromotionProposal {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && isRecord(value.source)
    && isRecord(value.proposedManifest)
    && typeof value.createdAt === 'string';
}
