import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { CapabilityEvolutionCandidate, CapabilityEvolutionCandidateSet, CapabilityEvolutionCompactSummary } from '../../packages/contracts/runtime/capability-evolution.js';
import { skillPromotionDomain } from '../../packages/skills/runtime-policy';
import { buildCapabilityEvolutionCandidateSet } from './capability-evolution-ledger.js';
import type { GatewayRequest, SkillAvailability, SkillManifest, SkillPromotionProposal, ToolPayload } from './runtime-types.js';
import { loadSkillRegistry } from './skill-registry.js';
import { fileExists, runWorkspaceTask, sha1 } from './workspace-task-runner.js';

type PromotionSafetyGate = NonNullable<SkillPromotionProposal['securityGate']>;

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
  const sourceTaskText = await readFile(sourceTask, 'utf8');
  const proposal = buildSkillPromotionProposal({ ...params, workspacePath: workspace, sourceTaskText });
  const proposalDir = join(workspace, '.sciforge', 'skill-proposals', safeName(proposal.id));
  await mkdir(proposalDir, { recursive: true });
  await writeFile(join(proposalDir, 'proposal.json'), JSON.stringify(proposal, null, 2));
  await writeFile(join(proposalDir, 'README.md'), proposalReadme(proposal), 'utf8');
  return proposal;
}

export async function writeSkillPromotionProposalsFromCapabilityEvolutionSummary(params: {
  workspacePath: string;
  summary: CapabilityEvolutionCompactSummary;
  request?: Pick<GatewayRequest, 'prompt' | 'skillDomain'>;
  now?: () => Date;
}): Promise<SkillPromotionProposal[]> {
  return writeSkillPromotionProposalsFromCapabilityEvolutionCandidates({
    workspacePath: params.workspacePath,
    candidateSet: buildCapabilityEvolutionCandidateSet(params.summary),
    request: params.request,
    now: params.now,
  });
}

export async function writeSkillPromotionProposalsFromCapabilityEvolutionCandidates(params: {
  workspacePath: string;
  candidateSet: CapabilityEvolutionCandidateSet;
  request?: Pick<GatewayRequest, 'prompt' | 'skillDomain'>;
  now?: () => Date;
}): Promise<SkillPromotionProposal[]> {
  const workspace = resolve(params.workspacePath || process.cwd());
  const createdAt = (params.now ?? (() => new Date()))().toISOString();
  const proposals = params.candidateSet.promotionCandidates
    .filter((candidate) => candidate.proposalKind === 'composed-capability')
    .map((candidate) => buildLedgerSkillPromotionProposal({
      workspacePath: workspace,
      candidate,
      candidateSet: params.candidateSet,
      request: params.request,
      createdAt,
    }));
  for (const proposal of proposals) {
    const proposalDir = join(workspace, '.sciforge', 'skill-proposals', safeName(proposal.id));
    await mkdir(proposalDir, { recursive: true });
    await writeFile(join(proposalDir, 'proposal.json'), JSON.stringify(proposal, null, 2));
    await writeFile(join(proposalDir, 'README.md'), proposalReadme(proposal), 'utf8');
  }
  return proposals;
}

export async function listSkillPromotionProposals(workspacePath: string): Promise<SkillPromotionProposal[]> {
  const workspace = resolve(workspacePath || process.cwd());
  const root = join(workspace, '.sciforge', 'skill-proposals');
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
  const proposalPath = join(workspace, '.sciforge', 'skill-proposals', safeName(proposalId), 'proposal.json');
  const parsed = JSON.parse(await readFile(proposalPath, 'utf8'));
  if (!isSkillPromotionProposal(parsed)) throw new Error(`Invalid skill promotion proposal: ${proposalId}`);
  if (parsed.status === 'rejected' || parsed.status === 'archived') {
    throw new Error(`Skill promotion proposal is ${parsed.status}: ${proposalId}`);
  }
  if (parsed.source.kind === 'capability-evolution-ledger') {
    throw new Error(`Ledger-sourced skill promotion proposal must be materialized before accept: ${proposalId}`);
  }
  const manifest = parsed.proposedManifest;
  const sourceTask = join(workspace, parsed.source.taskCodeRef);
  if (!await fileExists(sourceTask)) throw new Error(`Promotion source task is missing: ${parsed.source.taskCodeRef}`);
  const securityGate: PromotionSafetyGate = evaluatePromotionSafetyGate(await readFile(sourceTask, 'utf8'));
  if (!securityGate.passed) {
    throw new Error(`Skill promotion safety gate failed: ${securityGate.findings.join('; ')}`);
  }
  const skillDir = join(workspace, '.sciforge', 'evolved-skills', safeName(manifest.id));
  await mkdir(skillDir, { recursive: true });
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

export async function rejectSkillPromotionProposal(workspacePath: string, proposalId: string, reason?: string): Promise<SkillPromotionProposal> {
  return updateSkillPromotionProposalStatus(workspacePath, proposalId, 'rejected', reason);
}

export async function archiveSkillPromotionProposal(workspacePath: string, proposalId: string, reason?: string): Promise<SkillPromotionProposal> {
  return updateSkillPromotionProposalStatus(workspacePath, proposalId, 'archived', reason);
}

async function updateSkillPromotionProposalStatus(
  workspacePath: string,
  proposalId: string,
  status: Extract<SkillPromotionProposal['status'], 'rejected' | 'archived'>,
  reason?: string,
): Promise<SkillPromotionProposal> {
  const workspace = resolve(workspacePath || process.cwd());
  const proposalPath = join(workspace, '.sciforge', 'skill-proposals', safeName(proposalId), 'proposal.json');
  const parsed = JSON.parse(await readFile(proposalPath, 'utf8'));
  if (!isSkillPromotionProposal(parsed)) throw new Error(`Invalid skill promotion proposal: ${proposalId}`);
  if (parsed.status === 'accepted') throw new Error(`Accepted skill promotion proposal cannot be ${status}: ${proposalId}`);
  const next: SkillPromotionProposal = {
    ...parsed,
    status,
    statusUpdatedAt: new Date().toISOString(),
    statusReason: reason?.trim() || undefined,
  };
  await writeFile(proposalPath, JSON.stringify(next, null, 2));
  return next;
}

export async function runAcceptedSkillValidationSmoke(workspacePath: string, skillId: string) {
  const workspace = resolve(workspacePath || process.cwd());
  const registry = await loadSkillRegistry({ workspacePath: workspace });
  const skill = registry.find((item) => item.id === skillId && item.available && item.manifestPath.includes(`${join('.sciforge', 'evolved-skills')}`));
  if (!skill) throw new Error(`Accepted evolved skill is not discoverable in registry: ${skillId}`);
  if (skill.manifest.entrypoint.type !== 'workspace-task' || !skill.manifest.entrypoint.path) {
    throw new Error(`Accepted evolved skill is not a workspace task: ${skillId}`);
  }
  const entrypointPath = resolve(dirname(skill.manifestPath), skill.manifest.entrypoint.path);
  const expectedArtifactTypes = Array.isArray(skill.manifest.validationSmoke.expectedArtifactTypes)
    ? skill.manifest.validationSmoke.expectedArtifactTypes.map(String)
    : [];
  const runId = `validation-${safeName(skill.id)}-${sha1(`${skill.id}:${Date.now()}`).slice(0, 8)}`;
  const run = await runWorkspaceTask(workspace, {
    id: runId,
    language: languageForManifest(skill.manifest),
    entrypoint: basename(entrypointPath),
    codeTemplatePath: entrypointPath,
    input: {
      prompt: String(skill.manifest.validationSmoke.prompt || skill.manifest.examplePrompts[0] || ''),
      validationSmoke: true,
      skillId,
    },
    outputRel: `.sciforge/validation/${safeName(skill.id)}/output.json`,
    stdoutRel: `.sciforge/validation/${safeName(skill.id)}/stdout.txt`,
    stderrRel: `.sciforge/validation/${safeName(skill.id)}/stderr.txt`,
    taskRel: `.sciforge/validation/${safeName(skill.id)}/${basename(entrypointPath)}`,
    timeoutMs: 120000,
  });
  const payload: unknown = JSON.parse(await readFile(join(workspace, run.outputRef), 'utf8'));
  const schemaErrors = payloadSchemaErrors(payload);
  const artifacts = isRecord(payload) && Array.isArray(payload.artifacts) ? payload.artifacts : [];
  const artifactTypes = artifacts
    .map((artifact: unknown) => isRecord(artifact) ? String(artifact.type || '') : '')
    .filter(Boolean);
  const missingArtifactTypes = expectedArtifactTypes.filter((type) => !artifactTypes.includes(type));
  const passed = run.exitCode === 0 && !schemaErrors.length && !missingArtifactTypes.length;
  return {
    passed,
    skillId,
    exitCode: run.exitCode,
    outputRef: run.outputRef,
    stdoutRef: run.stdoutRef,
    stderrRef: run.stderrRef,
    schemaErrors,
    expectedArtifactTypes,
    artifactTypes,
    missingArtifactTypes,
  };
}

function shouldProposeSkill(skill: SkillAvailability, taskRel: string, selfHealed?: boolean) {
  if (skill.kind === 'workspace' && skill.manifestPath.includes(`${join('.sciforge', 'evolved-skills')}`)) return false;
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
  sourceTaskText: string;
}): SkillPromotionProposal {
  const artifactTypes = uniqueStrings(params.payload.artifacts.map((artifact) => String(artifact.type || artifact.id || '')).filter(Boolean));
  const stableProposalSlug = complexSingleCellProposalSlug(params.request.prompt);
  const skillId = stableProposalSlug
    ? `workspace.${params.request.skillDomain}.${stableProposalSlug}`
    : `workspace.${params.request.skillDomain}.${slugForPrompt(params.request.prompt)}.${sha1(`${params.taskRel}:${artifactTypes.join(',')}`).slice(0, 8)}`;
  const proposalId = stableProposalSlug
    ? stableProposalSlug
    : `proposal.${skillId}.${sha1(`${params.taskId}:${params.outputRef || ''}`).slice(0, 10)}`;
  const securityGate: PromotionSafetyGate = evaluatePromotionSafetyGate(params.sourceTaskText);
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
      sourceInputRef: params.inputRef,
      sourceOutputRef: params.outputRef,
      sourceStdoutRef: params.stdoutRef,
      sourceStderrRef: params.stderrRef,
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
      rerunAfterAccept: {
        mode: 'registry-discovered-workspace-task',
        expectedStatus: 'done',
      },
    },
    securityGate,
    reviewChecklist: {
      noHardCodedUserData: securityGate.passed,
      noHardCodedAbsolutePaths: securityGate.checks.noHardCodedAbsolutePaths,
      noCredentialLikeText: securityGate.checks.noCredentialLikeText,
      noPrivateFileReferences: securityGate.checks.noPrivateFileReferences,
      reproducibleDependencies: securityGate.checks.reproducibleDependencies,
      reproducibleEntrypoint: true,
      artifactSchemaValidated: true,
      failureModeIsExplicit: params.payload.executionUnits.every((unit) => !isRecord(unit) || unit.status === 'done' || unit.status === 'self-healed'),
      userConfirmedPromotion: false,
    },
  };
}

function buildLedgerSkillPromotionProposal(params: {
  workspacePath: string;
  candidate: CapabilityEvolutionCandidate;
  candidateSet: CapabilityEvolutionCandidateSet;
  request?: Pick<GatewayRequest, 'prompt' | 'skillDomain'>;
  createdAt: string;
}): SkillPromotionProposal {
  const capabilityIds = uniqueStrings(params.candidate.suggestedUpdates?.capabilityIds ?? []);
  const skillDomain = skillPromotionDomain(params.request?.skillDomain);
  const skillId = params.candidate.suggestedCapabilityId
    ?? `workspace.${skillDomain}.${slugForPrompt(params.candidate.observedPattern ?? params.candidate.id)}`;
  const proposalId = `ledger.${safeName(params.candidate.id.replace(/^proposal:/, ''))}`;
  const prompt = params.request?.prompt
    ?? params.candidate.reason
    ?? `Review ledger promotion candidate ${params.candidate.id}`;
  const manifest: SkillManifest = {
    id: skillId,
    kind: 'workspace',
    description: `Ledger-suggested composed skill candidate from ${params.candidate.supportCount} supporting records.`,
    skillDomains: [skillDomain],
    inputContract: {
      source: 'capability-evolution-ledger',
      observedPattern: params.candidate.observedPattern,
      capabilityIds,
      sourceRef: params.candidate.sourceRef,
    },
    outputArtifactSchema: {
      source: 'ledger-evidence',
      supportingRecordRefs: params.candidate.supportingRecordRefs,
    },
    entrypoint: {
      type: 'markdown-skill',
    },
    environment: {
      sourceRuntime: 'capability-evolution-ledger',
      supportCount: params.candidate.supportCount,
      confidence: params.candidate.confidence,
    },
    validationSmoke: {
      mode: 'ledger-evidence-review',
      prompt,
      sourceRef: params.candidate.sourceRef,
      supportingRecordRefs: params.candidate.supportingRecordRefs,
    },
    examplePrompts: [prompt],
    promotionHistory: [{
      source: 'capability-evolution-ledger',
      candidateId: params.candidate.id,
      candidateSetRef: params.candidateSet.sourceRef,
      supportingRecordRefs: params.candidate.supportingRecordRefs,
      supportCount: params.candidate.supportCount,
      confidence: params.candidate.confidence,
      createdAt: params.createdAt,
    }],
    scopeDeclaration: {
      source: 'capability-evolution-ledger',
      status: 'needs-user-confirmation',
      supportedTasks: [`Compose and review repeated capability chain: ${capabilityIds.join(', ') || params.candidate.observedPattern || params.candidate.id}.`],
      unsupportedTasks: ['Accepting without materializing a package manifest, validator, repair hints, and executable provider.'],
    },
  };
  return {
    id: proposalId,
    status: 'needs-user-confirmation',
    createdAt: params.createdAt,
    source: {
      kind: 'capability-evolution-ledger',
      workspacePath: params.workspacePath,
      taskCodeRef: params.candidate.sourceRef ?? params.candidate.supportingRecordRefs[0] ?? '.sciforge/capability-evolution-ledger/records.jsonl',
      successfulExecutionUnitRefs: [],
      ledgerSourceRef: params.candidate.sourceRef,
      ledgerCandidateRef: params.candidate.id,
      ledgerRecordRefs: params.candidate.supportingRecordRefs,
    },
    proposedManifest: manifest,
    generalizationNotes: [
      'Generated from Capability Evolution Ledger compact evidence.',
      'Review the supporting ledger records by ref; this proposal intentionally does not inline glue code, stdout, stderr, or full logs.',
      'Materialize a package composed capability with manifest, validator, repair hints, and provider before accepting into the registry.',
    ],
    validationPlan: {
      smokePrompts: [prompt],
      expectedArtifactTypes: [],
      requiredEnvironment: manifest.environment,
    },
    securityGate: {
      passed: true,
      checks: {
        noHardCodedAbsolutePaths: true,
        noCredentialLikeText: true,
        noPrivateFileReferences: true,
        reproducibleDependencies: true,
      },
      findings: [],
    },
    reviewChecklist: {
      noHardCodedUserData: false,
      noHardCodedAbsolutePaths: true,
      noCredentialLikeText: true,
      noPrivateFileReferences: true,
      reproducibleDependencies: true,
      reproducibleEntrypoint: false,
      artifactSchemaValidated: false,
      failureModeIsExplicit: true,
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
    '- Check generated code for hard-coded user data, credentials, absolute paths, private file references, and hidden network assumptions.',
    '- Run the validation smoke prompt before accepting.',
    '- Accepting the proposal installs it into `.sciforge/evolved-skills/` for future registry matching without modifying seed or preinstalled skills.',
    proposal.securityGate?.passed ? '- Safety gate: passed.' : `- Safety gate: failed (${proposal.securityGate?.findings.join('; ') || 'unknown'}).`,
  ].filter(Boolean).join('\n');
}

function evaluatePromotionSafetyGate(sourceTaskText: string): PromotionSafetyGate {
  const findings: string[] = [];
  if (hardCodedAbsolutePathPattern().test(sourceTaskText)) {
    findings.push('hard-coded absolute path detected');
  }
  if (credentialLikePattern().test(sourceTaskText)) {
    findings.push('credential-like text detected');
  }
  if (privateFileReferencePattern().test(sourceTaskText)) {
    findings.push('private file reference detected');
  }
  if (unreproducibleDependencyPattern().test(sourceTaskText)) {
    findings.push('unreproducible dependency detected');
  }
  const checks = {
    noHardCodedAbsolutePaths: !findings.includes('hard-coded absolute path detected'),
    noCredentialLikeText: !findings.includes('credential-like text detected'),
    noPrivateFileReferences: !findings.includes('private file reference detected'),
    reproducibleDependencies: !findings.includes('unreproducible dependency detected'),
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    findings,
  };
}

function hardCodedAbsolutePathPattern() {
  return /(?:["'`])(?:\/(?:Users|home|Applications|Volumes|private|tmp)\/[^"'`\s]+|[A-Za-z]:\\[^"'`\s]+)(?:["'`])/;
}

function credentialLikePattern() {
  return /\b(?:api[_-]?key|secret(?:_key)?|access[_-]?token|auth[_-]?token|password|passwd|bearer)\b\s*[:=]\s*["'`][^"'`\s]{8,}["'`]|-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/i;
}

function privateFileReferencePattern() {
  return /(?:\.env\b|id_rsa\b|id_ed25519\b|\.ssh\/|\.aws\/credentials|\.kube\/config|\/Users\/[^"'`\s]+\/(?:Desktop|Documents|Downloads)\/)/i;
}

function unreproducibleDependencyPattern() {
  return /\b(?:pip|uv)\s+install\s+(?:git\+|https?:\/\/|--editable|-e\s+)|\b(?:curl|wget)\s+https?:\/\/\S+\s*(?:\||>|&&)/i;
}

function payloadSchemaErrors(payload: unknown) {
  if (!isRecord(payload)) return ['payload is not an object'];
  const errors: string[] = [];
  for (const key of ['message', 'claims', 'uiManifest', 'executionUnits', 'artifacts']) {
    if (!(key in payload)) errors.push(`missing ${key}`);
  }
  if (!Array.isArray(payload.claims)) errors.push('claims must be an array');
  if (!Array.isArray(payload.uiManifest)) errors.push('uiManifest must be an array');
  if (!Array.isArray(payload.executionUnits)) errors.push('executionUnits must be an array');
  if (!Array.isArray(payload.artifacts)) errors.push('artifacts must be an array');
  return errors;
}

function languageForManifest(manifest: SkillManifest) {
  const language = String(manifest.environment.language || manifest.entrypoint.command || 'python').toLowerCase();
  if (language.includes('r')) return 'r' as const;
  if (language.includes('shell') || language.includes('sh')) return 'shell' as const;
  return 'python' as const;
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

function complexSingleCellProposalSlug(prompt: string) {
  const text = prompt.toLowerCase();
  if (/\bscanpy\b/.test(text) && /\batlas\b/.test(text) && /\bqc\b/.test(text) && /\bcluster/.test(text)) {
    return 'scanpy-atlas-qc-cluster-report';
  }
  if (/\bscvelo\b/.test(text) && /\bvelocity\b/.test(text)) {
    return 'scvelo-velocity-report';
  }
  if (/\blabel[- ]?transfer\b/.test(text) && /\b(single[- ]?cell|cell)\b/.test(text) && /\bqc\b/.test(text)) {
    return 'single-cell-label-transfer-qc';
  }
  return undefined;
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
