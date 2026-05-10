import { basename, dirname, extname, join, resolve } from 'node:path';

export type SkillPackageDomain = 'literature' | 'structure' | 'omics' | 'knowledge';
export const SKILL_ENTRYPOINT_TYPES = ['workspace-task', 'inspector', 'agentserver-generation', 'markdown-skill'] as const;
export type SkillEntrypointType = typeof SKILL_ENTRYPOINT_TYPES[number];
export const SKILL_ENTRYPOINT_TYPE = {
  WORKSPACE_TASK: 'workspace-task',
  INSPECTOR: 'inspector',
  AGENTSERVER_GENERATION: 'agentserver-generation',
  MARKDOWN_SKILL: 'markdown-skill',
} as const satisfies Record<string, SkillEntrypointType>;
export const EVOLVED_SKILLS_RELATIVE_DIR = '.sciforge/evolved-skills';

export interface RuntimePolicySkillManifest {
  id: string;
  kind: 'package' | 'workspace' | 'installed';
  description: string;
  skillDomains: SkillPackageDomain[];
  inputContract: Record<string, unknown>;
  outputArtifactSchema: Record<string, unknown>;
  entrypoint: {
    type: SkillEntrypointType;
    command?: string;
    path?: string;
  };
  environment: Record<string, unknown>;
  validationSmoke: Record<string, unknown>;
  examplePrompts: string[];
  promotionHistory: Array<Record<string, unknown>>;
  scopeDeclaration?: Record<string, unknown>;
}

export interface RuntimePolicySkillAvailability {
  id: string;
  kind: RuntimePolicySkillManifest['kind'];
  available: boolean;
  reason: string;
  checkedAt: string;
  manifestPath: string;
  manifest: RuntimePolicySkillManifest;
}

export interface SkillAvailabilityFileProbe {
  id: string;
  path: string;
  unavailableReason: string;
}

export interface SkillAvailabilityValidationPlan {
  missingFields: string[];
  missingDomainsReason?: string;
  fileProbes: SkillAvailabilityFileProbe[];
}

export interface SkillRuntimeRoutePolicyInput {
  entrypoint?: RuntimePolicySkillManifest['entrypoint'] | { type?: string };
  scenarioPackageSource?: string;
  agentServerRuntimeProfileId?: string;
}

export interface SkillRuntimeRoutePolicy {
  runtimeProfileId?: string;
  selectedRuntime?: string;
}

export interface AgentServerGeneratedTaskContractResponse {
  entrypoint: {
    path: string;
    language?: string;
  };
  taskFiles: Array<{
    path: string;
    language?: string;
    content?: string;
  }>;
}

export const AGENTSERVER_GENERATED_TASK_RETRY_EVENT_TYPE = 'agentserver-generation-retry' as const;
export const AGENTSERVER_GENERATED_TASK_MATERIALIZED_EVENT_TYPE = 'workspace-task-materialized' as const;
export const AGENTSERVER_SUPPLEMENTAL_GENERATION_EVENT_TYPE = 'workspace-task-start' as const;

const skillPromotionDomainFallback: SkillPackageDomain = 'literature';
const skillPackageDomainSet = new Set<SkillPackageDomain>(['literature', 'structure', 'omics', 'knowledge']);
const workspaceTaskPythonRuntimeDirs = ['.venv-sciforge', '.venv-sciforge-omics', '.venv'];

export function planSkillAvailabilityValidation(
  manifest: RuntimePolicySkillManifest,
  context: { manifestPath: string; cwd: string },
): SkillAvailabilityValidationPlan {
  return {
    missingFields: requiredManifestFields
      .filter((key) => !(key in manifest) || manifest[key] === undefined || manifest[key] === ''),
    missingDomainsReason: manifest.skillDomains.length ? undefined : 'Manifest skillDomains is empty',
    fileProbes: entrypointFileProbes(manifest, context),
  };
}

export function skillAvailabilityFailureReason(
  plan: SkillAvailabilityValidationPlan,
  failedProbe?: SkillAvailabilityFileProbe,
): string | undefined {
  if (plan.missingFields.length) return `Manifest missing ${plan.missingFields.join(', ')}`;
  if (plan.missingDomainsReason) return plan.missingDomainsReason;
  return failedProbe?.unavailableReason;
}

export function agentServerGenerationSkillAvailability(
  skillDomain: SkillPackageDomain,
  checkedAt: string,
): RuntimePolicySkillAvailability {
  return {
    id: `agentserver.generate.${skillDomain}`,
    kind: 'package',
    available: true,
    reason: 'No executable skill matched; caller should fall through to AgentServer task generation.',
    checkedAt,
    manifestPath: '@sciforge/skills/runtime-policy#agentserver-generation',
    manifest: {
      id: `agentserver.generate.${skillDomain}`,
      kind: 'package',
      description: 'Generic AgentServer task generation fallback.',
      skillDomains: [skillDomain],
      inputContract: { prompt: 'string', workspacePath: 'string' },
      outputArtifactSchema: { type: 'runtime-artifact' },
      entrypoint: { type: SKILL_ENTRYPOINT_TYPE.AGENTSERVER_GENERATION },
      environment: { runtime: 'AgentServer' },
      validationSmoke: { mode: 'delegated' },
      examplePrompts: [],
      promotionHistory: [],
    },
  };
}

export function taskProjectStageAdapterSkillAvailability(
  skillDomain: SkillPackageDomain,
  checkedAt: string,
): RuntimePolicySkillAvailability {
  return {
    id: `agentserver.generate.${skillDomain}.task-project-stage-adapter`,
    kind: 'installed',
    available: true,
    reason: 'TaskProject stable stage adapter promotion candidate.',
    checkedAt,
    manifestPath: '@sciforge/skills/runtime-policy#task-project-stage-adapter',
    manifest: {
      id: `agentserver.generate.${skillDomain}.task-project-stage-adapter`,
      kind: 'installed',
      description: 'Generic AgentServer TaskProject stage adapter generation fallback.',
      skillDomains: [skillDomain],
      inputContract: { prompt: 'string', projectId: 'string', stageId: 'string' },
      outputArtifactSchema: { type: 'runtime-artifact' },
      entrypoint: { type: SKILL_ENTRYPOINT_TYPE.AGENTSERVER_GENERATION },
      environment: { runtime: 'AgentServer', sourceRuntime: 'task-project' },
      validationSmoke: { mode: 'delegated-task-project-stage' },
      examplePrompts: [],
      promotionHistory: [],
    },
  };
}

export function skillRuntimeRoutePolicy(input: SkillRuntimeRoutePolicyInput): SkillRuntimeRoutePolicy {
  const entrypointType = input.entrypoint?.type;
  if (entrypointType === SKILL_ENTRYPOINT_TYPE.AGENTSERVER_GENERATION) {
    return {
      runtimeProfileId: input.agentServerRuntimeProfileId,
      selectedRuntime: 'agentserver-generation',
    };
  }
  if (entrypointType === SKILL_ENTRYPOINT_TYPE.MARKDOWN_SKILL) {
    return {
      runtimeProfileId: input.agentServerRuntimeProfileId,
      selectedRuntime: 'agentserver-markdown-skill',
    };
  }
  if (entrypointType === SKILL_ENTRYPOINT_TYPE.WORKSPACE_TASK) {
    return {
      runtimeProfileId: 'workspace-python',
      selectedRuntime: 'workspace-python',
    };
  }
  if (entrypointType) {
    return {
      runtimeProfileId: input.scenarioPackageSource === 'built-in' ? 'package-skill' : undefined,
      selectedRuntime: entrypointType,
    };
  }
  return {
    runtimeProfileId: input.scenarioPackageSource === 'built-in' ? 'package-skill' : undefined,
  };
}

export function skillPromotionDomain(input: unknown): SkillPackageDomain {
  return isSkillPackageDomain(input) ? input : skillPromotionDomainFallback;
}

export function skillManifestPathIsEvolvedWorkspaceSkill(manifestPath: string) {
  return normalizePath(manifestPath).includes(EVOLVED_SKILLS_RELATIVE_DIR);
}

export function skillEntrypointIsWorkspaceTask(entrypoint: { type?: string; path?: string } | undefined): entrypoint is { type: typeof SKILL_ENTRYPOINT_TYPE.WORKSPACE_TASK; path: string } {
  return entrypoint?.type === SKILL_ENTRYPOINT_TYPE.WORKSPACE_TASK && typeof entrypoint.path === 'string' && entrypoint.path.length > 0;
}

export function skillManifestHasWorkspaceTaskEntrypoint(
  manifest: Pick<RuntimePolicySkillManifest, 'entrypoint'>,
): manifest is Pick<RuntimePolicySkillManifest, 'entrypoint'> & { entrypoint: { type: typeof SKILL_ENTRYPOINT_TYPE.WORKSPACE_TASK; command?: string; path: string } } {
  return skillEntrypointIsWorkspaceTask(manifest.entrypoint);
}

export function skillManifestUsesAgentServerGeneration(manifest: Pick<RuntimePolicySkillManifest, 'entrypoint'>) {
  return manifest.entrypoint.type === SKILL_ENTRYPOINT_TYPE.AGENTSERVER_GENERATION;
}

export function skillPromotionShouldPropose(input: {
  skillKind: RuntimePolicySkillManifest['kind'];
  skillId: string;
  manifestPath: string;
  entrypoint?: RuntimePolicySkillManifest['entrypoint'] | { type?: string };
  taskRel: string;
  selfHealed?: boolean;
}) {
  if (input.skillKind === 'workspace' && skillManifestPathIsEvolvedWorkspaceSkill(input.manifestPath)) return false;
  if (input.selfHealed) return true;
  if (input.entrypoint?.type === SKILL_ENTRYPOINT_TYPE.AGENTSERVER_GENERATION) return true;
  if (input.skillId.startsWith('agentserver.generate.')) return true;
  return normalizePath(input.taskRel).includes('/generated-');
}

export function skillRuntimeLanguageForManifest(manifest: Pick<RuntimePolicySkillManifest, 'environment' | 'entrypoint'>) {
  const language = String(manifest.environment.language || manifest.entrypoint.command || 'python').toLowerCase();
  if (language.includes('r')) return 'r' as const;
  if (language.includes('shell') || language.includes('sh')) return 'shell' as const;
  return 'python' as const;
}

export function skillRuntimeTaskFileNameForManifest(manifest: Pick<RuntimePolicySkillManifest, 'entrypoint'>) {
  const current = typeof manifest.entrypoint.path === 'string' ? basename(manifest.entrypoint.path) : 'task.py';
  return current.endsWith('.py') ? current : 'task.py';
}

export function workspaceTaskPythonCommandCandidates(workspacePath: string) {
  const workspace = resolve(workspacePath || '.');
  return [
    ...workspaceTaskPythonRuntimeDirs.map((dir) => join(workspace, dir, 'bin', 'python')),
    'python3',
  ];
}

function isSkillPackageDomain(value: unknown): value is SkillPackageDomain {
  return typeof value === 'string' && skillPackageDomainSet.has(value as SkillPackageDomain);
}

function normalizePath(value: string) {
  return value.replaceAll('\\', '/');
}

export function agentServerExecutionModePromptPolicyLines() {
  return [
    'Do not ask SciForge to decide scientific, topical, retrieval, or domain intent. The executionModeRecommendation fields are advisory handoff metadata; AgentServer must make the actual domain/tool/stage decision.',
    'executionModeRecommendation=direct-context-answer: only use this when the answer can be produced entirely from existing context, current refs/digests, artifacts, or prior execution refs already present in the handoff. Do not use direct-context-answer for fresh search/fetch/current-events, even if the user asks a simple question.',
    'executionModeRecommendation=thin-reproducible-adapter: use this for simple search/fetch/current-events lookups with no explicit report/table/download/batch requirement. Keep it lightweight, but preserve code/input/output/log/evidence refs: return AgentServerGenerationResponse with a minimal bounded adapter task unless the backend already has durable tool/result refs it can expose in a ToolPayload.',
    'executionModeRecommendation=single-stage-task: use this for one bounded local computation, file transform, narrow analysis, or simple artifact generation that can be run and validated in one workspace task. Return one AgentServerGenerationResponse, not a multi-stage project plan.',
    'executionModeRecommendation=multi-stage-project: use this for complex research, durable artifacts, multi-file outputs, local-file processing, code/command execution, batch retrieval, full-document reading, reports/tables/notebooks, or multi-artifact validation. Do not generate a complete end-to-end pipeline in one response; return only the next stage spec/patch/task plus the expected refs/artifacts for that stage.',
    'executionModeRecommendation=repair-or-continue-project: use this when the current turn refers to a previous failure, existing project/stage, user guidance queue, continuation, repair, or rerun. Inspect only the cited project/stage refs and return a minimal repair/continue stage instead of starting unrelated fresh work.',
    'Multi-stage/project guidance: for multi-stage-project, plan the durable project internally but return only the immediately executable next stage; later stages must be represented as bounded stage hints, not as a one-shot generated pipeline.',
    'Project guidance adoption contract: when a TaskProject handoff includes userGuidanceQueue, the next stage plan/result must declare every queued or deferred guidance item as adopted, deferred, or rejected, with a short reason in executionUnits[].guidanceDecisions. Do not silently ignore guidance.',
    'Reproducibility principle: when the answer depends on fresh external retrieval, local files, commands, or generated artifacts, prefer AgentServerGenerationResponse so SciForge can archive runnable code/input/output/log refs.',
    'For lightweight search/news/current-events lookups with no explicit report/table/download/batch requirement, still keep the work reproducible, but use a minimal bounded adapter task: one executable file, small provider list, capped results, short timeouts, no workspace exploration, no full-document download, and no bespoke long research pipeline.',
    'Return a direct ToolPayload for lightweight retrieval only when the backend already has durable tool/result refs and can expose WorkEvidence-style provider/query/status/resultCount/evidenceRefs/failureReason/recoverActions/nextStep in the payload; otherwise generate the minimal adapter task.',
    'For heavy or durable work, return AgentServerGenerationResponse with taskFiles, entrypoint, environmentRequirements, validationCommand, expectedArtifacts, and patchSummary. Heavy work includes local file processing, code/command execution, batch retrieval, full-document download/reading, explicit report/table/notebook deliverables, multi-file outputs, or repair/rerun of a prior task. For multi-stage-project, scope this to the next stage only.',
  ];
}

export function agentServerGeneratedTaskPromptPolicyLines() {
  return [
    'Hard contract: taskFiles MUST be an array of objects with path, language, and non-empty content unless the file was physically written in the workspace before returning. Never return taskFiles as string paths only.',
    'Hard contract: entrypoint.path MUST reference one of the returned taskFiles or a file that was physically written in the workspace before returning.',
    'If you physically write task files into the workspace, prefer a compact path-only taskFiles object (path + language, content may be omitted/empty) and return JSON immediately. Do not cat/read full generated source back into the final response just to inline it.',
    'Entrypoint contract: entrypoint.path must be executable task code supported by the runner (.py/.r/.sh, or language=cli with an explicit command). Do not set a markdown/text/json/pdf/report artifact as entrypoint. For report-only answers, return a direct ToolPayload; for generated tasks, make the executable write report/data artifacts.',
    'Generated task interface contract: executable task code must read the SciForge inputPath argument for prompt/current refs/artifacts and write a valid ToolPayload JSON to the outputPath argument. Do not generate static scripts that merely embed the current answer or a document-specific report in source code.',
  ];
}

export function agentServerGeneratedTaskRetryDetail(kind: 'entrypoint' | 'path-only-task-files' | 'task-interface') {
  if (kind === 'entrypoint') {
    return 'Retrying AgentServer generation once; entrypoint must be executable code, while reports/data must be emitted as artifacts or direct ToolPayload content.';
  }
  if (kind === 'path-only-task-files') {
    return 'Retrying AgentServer generation once; taskFiles must include inline content or be physically written before returning.';
  }
  return 'Retrying AgentServer generation once; generated tasks must consume the SciForge task input and write the declared output payload, not bake the current answer into static code.';
}

export function agentServerGeneratedEntrypointContractReason(
  response: AgentServerGeneratedTaskContractResponse,
  options: { normalizePath?: (path: string) => string } = {},
) {
  const normalizePath = options.normalizePath ?? ((path: string) => path);
  const entryRel = normalizePath(response.entrypoint.path);
  const ext = extname(entryRel).toLowerCase();
  const language = String(response.entrypoint.language || '').toLowerCase();
  const executableExts = new Set(['.py', '.r', '.R', '.sh', '.bash', '.zsh']);
  const artifactExts = new Set(['.md', '.markdown', '.txt', '.json', '.csv', '.tsv', '.pdf', '.png', '.jpg', '.jpeg', '.html']);
  if (artifactExts.has(ext) && !executableExts.has(ext)) {
    return `AgentServer returned a non-executable artifact/report as entrypoint: ${entryRel}. Return a direct ToolPayload for report-only answers, or use an executable task file that writes the report artifact.`;
  }
  if ((language === 'python' || !language) && ext && !['.py'].includes(ext)) {
    return `AgentServer entrypoint language/path mismatch: language=${language || 'python'} path=${entryRel}.`;
  }
  if (['.js', '.mjs', '.ts'].includes(ext) && language !== 'cli') {
    return `AgentServer entrypoint ${entryRel} uses ${ext}, but SciForge generated task runner supports python/r/shell paths or explicit cli commands.`;
  }
  const entryFile = response.taskFiles.find((file) => normalizePath(file.path) === entryRel);
  if (entryFile && artifactExts.has(ext) && !/^(python|r|shell|cli)$/i.test(String(entryFile.language || ''))) {
    return `AgentServer taskFiles marks artifact-like entrypoint ${entryRel} as ${entryFile.language || 'unknown'} instead of executable code.`;
  }
  return undefined;
}

export function agentServerGeneratedTaskInterfaceContractReason(input: {
  entryRel: string;
  language?: string;
  source: string;
}) {
  const language = String(input.language || '').toLowerCase();
  const ext = extname(input.entryRel).toLowerCase();
  const source = input.source.slice(0, 240_000);
  const readsInput = generatedTaskSourceReadsInputArg(source, language, ext);
  const writesOutput = generatedTaskSourceWritesOutputArg(source, language, ext);
  if (!readsInput || !writesOutput) {
    const missing = [
      readsInput ? '' : 'read the SciForge inputPath argument',
      writesOutput ? '' : 'write the SciForge outputPath argument',
    ].filter(Boolean).join(' and ');
    return [
      `AgentServer generated task ${input.entryRel} does not ${missing}.`,
      'Generated workspace tasks must be reusable adapters that read request/current-reference data from argv inputPath and write a valid ToolPayload to argv outputPath.',
      'For report-only answers already reasoned by AgentServer, return a direct ToolPayload instead of static code that embeds the current report.',
    ].join(' ');
  }
  return undefined;
}

export function agentServerPathOnlyTaskFilesReason(files: string[]) {
  return `AgentServer returned path-only taskFiles that were not present in the workspace and had no inline content: ${files.join(', ')}`;
}

export function agentServerPathOnlyStrictRetryDirectPayloadReason(reason: string) {
  return `${reason}. Strict retry returned a direct ToolPayload instead of executable taskFiles.`;
}

export function agentServerPathOnlyStrictRetryStillMissingReason(reason: string, files: string[]) {
  return [
    reason,
    `Strict retry still returned path-only taskFiles without inline content or workspace files: ${files.join(', ')}`,
  ].join('. ');
}

export function agentServerStablePayloadTaskId(input: {
  kind: string;
  skillDomain: string;
  skillId: string;
  prompt: string;
  runId?: string;
  shortHash: (value: string) => string;
}) {
  const domain = agentServerPayloadTaskDomain(input.skillDomain);
  const hash = input.shortHash(`${input.kind}:${input.skillId}:${input.prompt}:${input.runId || 'unknown'}`);
  return `agentserver-${input.kind}-${domain}-${hash}`;
}

export function agentServerPayloadTaskDomain(skillDomain: string) {
  return skillDomain.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'runtime';
}

export function agentServerFreshRetrievalPromptPolicyLines() {
  return [
    'For fresh retrieval/analysis/report requests, do not inspect prior task-attempt files to learn old failures. Generate an inputPath/outputPath task that performs the requested retrieval/analysis at execution time and writes bounded artifacts.',
  ];
}

export function agentServerRepairPromptPolicyLines() {
  return [
    'For repair requests, inspect the failureReason plus stdoutRef/stderrRef/outputRef/codeRef and report whether logs are readable before editing or rerunning.',
  ];
}

export function agentServerExternalIoReliabilityContractLines() {
  return [
    'External I/O reliability contract: generated or repaired tasks that call remote APIs, web feeds, model endpoints, package registries, databases, or downloadable files must use bounded timeouts, descriptive User-Agent/contact metadata when applicable, limited retries with exponential backoff, and explicit handling for 429/5xx/network timeout/empty-result cases.',
    'Binary/text contract: downloadable binary resources such as PDFs, images, archives, and model files must be fetched and processed as bytes until an explicit decoder/parser converts them to text. Do not apply bytes regex/patterns to decoded strings or string regex/patterns to bytes; keep helpers named and typed distinctly, for example fetch_bytes versus fetch_text.',
    'Batch retrieval budget contract: for multi-item external retrieval, enforce an overall wall-clock budget, per-item timeouts, and a capped expensive-fetch subset; before the budget is exhausted, write a valid ToolPayload with partial/failed-with-reason execution units and honest retrieval notes instead of timing out without an output file.',
    'For provider-specific APIs, follow the provider query syntax and prefer standard URL encoders/client libraries over handwritten query strings; when a strict query is empty or invalid, record that fact and try a broader/provider-appropriate fallback before concluding no results.',
    'An empty external search is not a successful literature result by itself: record the exact query strings, HTTP statuses/errors, totalResults when available, fallback attempts, and whether the empty result came from rate limiting, invalid query syntax, no matching records, or network failure.',
    'If all external retrieval attempts fail, the task must still write a valid ToolPayload with executionUnits.status="failed-with-reason", concise failureReason, stdoutRef/stderrRef/outputRef evidence refs when available, recoverActions, nextStep, and any partial artifacts that are honest and useful. Do not leave the user with only a traceback, an endless stream wait, or a missing output file.',
    'Prefer installed/workspace client libraries or capability tools for remote retrieval when they provide rate-limit handling, pagination, or caching; otherwise keep custom HTTP code small, auditable, and source-agnostic.',
  ];
}

const requiredManifestFields: Array<keyof RuntimePolicySkillManifest> = [
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

function entrypointFileProbes(
  manifest: RuntimePolicySkillManifest,
  context: { manifestPath: string; cwd: string },
): SkillAvailabilityFileProbe[] {
  if (manifest.entrypoint.type === SKILL_ENTRYPOINT_TYPE.WORKSPACE_TASK && manifest.entrypoint.path) {
    const entrypointPath = resolve(dirname(context.manifestPath), manifest.entrypoint.path);
    return [{
      id: 'entrypoint',
      path: entrypointPath,
      unavailableReason: `Entrypoint not found: ${entrypointPath}`,
    }];
  }
  if (manifest.entrypoint.type === SKILL_ENTRYPOINT_TYPE.MARKDOWN_SKILL && manifest.entrypoint.path) {
    const markdownPath = resolve(context.cwd, manifest.entrypoint.path);
    return [{
      id: 'markdown-skill',
      path: markdownPath,
      unavailableReason: `Markdown skill not found: ${manifest.entrypoint.path}`,
    }];
  }
  return [];
}

function generatedTaskSourceReadsInputArg(source: string, language: string, ext: string) {
  if (language === 'python' || ext === '.py') return /\bsys\.argv\b|argparse|click\.|typer\.|input[_-]?path/i.test(source);
  if (['javascript', 'typescript', 'node'].includes(language) || ['.js', '.mjs', '.ts'].includes(ext)) return /\bprocess\.argv\b|parseArgs|input[_-]?path/i.test(source);
  if (['shell', 'bash', 'zsh', 'sh'].includes(language) || ['.sh', '.bash', '.zsh'].includes(ext)) return /(^|[^\\])\$\{?1\}?|\binput[_-]?path\b/i.test(source);
  if (language === 'r' || ['.r', '.R'].includes(ext)) return /commandArgs|input[_-]?path/i.test(source);
  return /argv|args|input[_-]?path/i.test(source);
}

function generatedTaskSourceWritesOutputArg(source: string, language: string, ext: string) {
  if (language === 'python' || ext === '.py') return /\bsys\.argv\b|argparse|click\.|typer\.|output[_-]?path/i.test(source);
  if (['javascript', 'typescript', 'node'].includes(language) || ['.js', '.mjs', '.ts'].includes(ext)) return /\bprocess\.argv\b|parseArgs|output[_-]?path/i.test(source);
  if (['shell', 'bash', 'zsh', 'sh'].includes(language) || ['.sh', '.bash', '.zsh'].includes(ext)) return /(^|[^\\])\$\{?2\}?|\boutput[_-]?path\b/i.test(source);
  if (language === 'r' || ['.r', '.R'].includes(ext)) return /commandArgs|output[_-]?path/i.test(source);
  return /argv|args|output[_-]?path/i.test(source);
}
