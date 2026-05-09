import { dirname, resolve } from 'node:path';

export type SkillPackageDomain = 'literature' | 'structure' | 'omics' | 'knowledge';

export interface RuntimePolicySkillManifest {
  id: string;
  kind: 'package' | 'workspace' | 'installed';
  description: string;
  skillDomains: SkillPackageDomain[];
  inputContract: Record<string, unknown>;
  outputArtifactSchema: Record<string, unknown>;
  entrypoint: {
    type: 'workspace-task' | 'inspector' | 'agentserver-generation' | 'markdown-skill';
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
      entrypoint: { type: 'agentserver-generation' },
      environment: { runtime: 'AgentServer' },
      validationSmoke: { mode: 'delegated' },
      examplePrompts: [],
      promotionHistory: [],
    },
  };
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
    'Entrypoint contract: entrypoint.path must be executable task code supported by the runner (.py/.r/.sh, or language=cli with an explicit command). Do not set a markdown/text/json/pdf/report artifact as entrypoint. For report-only answers, return a direct ToolPayload; for generated tasks, make the executable write report/data artifacts.',
    'Generated task interface contract: executable task code must read the SciForge inputPath argument for prompt/current refs/artifacts and write a valid ToolPayload JSON to the outputPath argument. Do not generate static scripts that merely embed the current answer or a document-specific report in source code.',
  ];
}

export function agentServerFreshRetrievalPromptPolicyLines() {
  return [
    'For fresh retrieval/analysis/report requests, do not inspect prior task-attempt files to learn old failures. Generate an inputPath/outputPath task that performs the requested retrieval/analysis at execution time and writes bounded artifacts.',
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
  if (manifest.entrypoint.type === 'workspace-task' && manifest.entrypoint.path) {
    const entrypointPath = resolve(dirname(context.manifestPath), manifest.entrypoint.path);
    return [{
      id: 'entrypoint',
      path: entrypointPath,
      unavailableReason: `Entrypoint not found: ${entrypointPath}`,
    }];
  }
  if (manifest.entrypoint.type === 'markdown-skill' && manifest.entrypoint.path) {
    const markdownPath = resolve(context.cwd, manifest.entrypoint.path);
    return [{
      id: 'markdown-skill',
      path: markdownPath,
      unavailableReason: `Markdown skill not found: ${manifest.entrypoint.path}`,
    }];
  }
  return [];
}
