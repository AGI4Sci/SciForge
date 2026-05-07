import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { runWorkspaceTask, sha1 } from '../workspace-task-runner.js';
import { composeRuntimeUiManifest } from '../runtime-ui-manifest.js';
import { clipForAgentServerJson, isRecord } from '../gateway-utils.js';
import { repairNeededPayload as buildRepairNeededPayload, type RepairPolicyRefs } from './repair-policy.js';
import { contextCompactionMetadata } from './agentserver-context-window.js';

type AttemptPlanRefsBuilder = (request: GatewayRequest, skill?: SkillAvailability, fallbackReason?: string) => Record<string, unknown>;
let attemptPlanRefsBuilder: AttemptPlanRefsBuilder = () => ({});

export function configurePayloadValidationContext(builder: AttemptPlanRefsBuilder) {
  attemptPlanRefsBuilder = builder;
}

type AgentServerGenerationFailureDiagnostics = {
  kind: 'contextWindowExceeded' | 'rateLimit' | 'agentserver';
  backend?: string;
  provider?: string;
  model?: string;
  agentId?: string;
  sessionRef?: string;
  originalErrorSummary: string;
  compaction?: Parameters<typeof contextCompactionMetadata>[0];
  retryAttempted?: boolean;
  retrySucceeded?: boolean;
};

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizeExecutionUnitStatus(value: unknown) {
  const text = typeof value === 'string' ? value : '';
  return ['planned', 'running', 'done', 'failed', 'record-only', 'repair-needed', 'self-healed', 'failed-with-reason', 'needs-human'].includes(text) ? text : 'done';
}

export async function validateAndNormalizePayload(
  payload: ToolPayload,
  request: GatewayRequest,
  skill: SkillAvailability,
  refs: { taskRel: string; outputRel: string; stdoutRel: string; stderrRel: string; runtimeFingerprint: Record<string, unknown> },
) {
  const errors = schemaErrors(payload);
  if (errors.length) {
    return repairNeededPayload(request, skill, `Task output failed schema validation: ${errors.join('; ')}`, refs);
  }
  const workspace = resolve(request.workspacePath || process.cwd());
  const normalizedArtifacts = await normalizeArtifactsForPayload(
    Array.isArray(payload.artifacts) ? payload.artifacts : [],
    workspace,
    refs,
  );
  const persistedArtifacts = await persistArtifactRefsForPayload(
    workspace,
    request,
    normalizedArtifacts,
    refs,
  );
  return {
    message: String(payload.message || `${skill.id} completed.`),
    confidence: typeof payload.confidence === 'number' ? payload.confidence : 0.5,
    claimType: String(payload.claimType || 'fact'),
    evidenceLevel: String(payload.evidenceLevel || 'runtime'),
    reasoningTrace: [
      String(payload.reasoningTrace || ''),
      `Skill: ${skill.id}`,
      `Runtime gateway refs: taskCodeRef=${refs.taskRel}, outputRef=${refs.outputRel}, stdoutRef=${refs.stdoutRel}, stderrRef=${refs.stderrRel}`,
    ].filter(Boolean).join('\n'),
    claims: Array.isArray(payload.claims) ? payload.claims : [],
    uiManifest: composeRuntimeUiManifest(
      Array.isArray(payload.uiManifest) ? payload.uiManifest : [],
      Array.isArray(payload.artifacts) ? payload.artifacts : [],
      request,
    ),
    executionUnits: (Array.isArray(payload.executionUnits) ? payload.executionUnits : []).map((unit) => isRecord(unit) ? {
      language: 'python',
      codeRef: refs.taskRel,
      stdoutRef: refs.stdoutRel,
      stderrRef: refs.stderrRel,
      outputRef: refs.outputRel,
      runtimeFingerprint: refs.runtimeFingerprint,
      skillId: skill.id,
      ...attemptPlanRefsBuilder(request, skill),
      ...unit,
      status: normalizeExecutionUnitStatus(unit.status),
    } : unit),
    artifacts: persistedArtifacts,
    logs: [{ kind: 'stdout', ref: refs.stdoutRel }, { kind: 'stderr', ref: refs.stderrRel }],
  };
}

async function persistArtifactRefsForPayload(
  workspace: string,
  request: GatewayRequest,
  artifacts: Array<Record<string, unknown>>,
  refs: { taskRel: string; outputRel: string; stdoutRel: string; stderrRel: string },
) {
  const sessionId = isRecord(request.uiState) && typeof request.uiState.sessionId === 'string'
    ? request.uiState.sessionId
    : 'sessionless';
  const out: Array<Record<string, unknown>> = [];
  for (const artifact of artifacts) {
    const id = safeArtifactId(String(artifact.id || artifact.type || 'artifact'));
    const type = safeArtifactId(String(artifact.type || artifact.id || 'artifact'));
    const artifactHash = sha1(JSON.stringify(clipForAgentServerJson(artifact, 4))).slice(0, 12);
    const rel = `.sciforge/artifacts/${safeArtifactId(sessionId)}-${type}-${id}-${artifactHash}.json`;
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    const record = {
      ...artifact,
      producerScenario: typeof artifact.producerScenario === 'string' ? artifact.producerScenario : request.skillDomain,
      producerSessionId: sessionId,
      dataRef: typeof artifact.dataRef === 'string' ? artifact.dataRef : refs.outputRel,
      metadata: {
        ...metadata,
        artifactRef: rel,
        outputRef: metadata.outputRef ?? refs.outputRel,
        taskCodeRef: metadata.taskCodeRef ?? refs.taskRel,
        stdoutRef: metadata.stdoutRef ?? refs.stdoutRel,
        stderrRef: metadata.stderrRef ?? refs.stderrRel,
        persistedAt: new Date().toISOString(),
      },
    };
    try {
      await mkdir(dirname(join(workspace, rel)), { recursive: true });
      await writeFile(join(workspace, rel), JSON.stringify(record, null, 2));
    } catch {
      // Artifact refs improve multi-turn recovery, but a write failure should not hide the task result.
    }
    out.push(record);
  }
  return out;
}

function safeArtifactId(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'artifact';
}

async function normalizeArtifactsForPayload(
  artifacts: Array<Record<string, unknown>>,
  workspace: string,
  refs?: { taskRel: string; outputRel: string; stdoutRel: string; stderrRel: string },
) {
  return await Promise.all(artifacts.map(async (artifact): Promise<Record<string, unknown>> => {
    const enriched = await enrichArtifactDataFromFileRefs(artifact, workspace);
    const metadata = isRecord(enriched.metadata) ? enriched.metadata : {};
    return {
      ...enriched,
      dataRef: typeof enriched.dataRef === 'string' ? enriched.dataRef : refs?.outputRel,
      metadata: refs ? {
        ...metadata,
        taskCodeRef: metadata.taskCodeRef ?? refs.taskRel,
        outputRef: metadata.outputRef ?? refs.outputRel,
        stdoutRef: metadata.stdoutRef ?? refs.stdoutRel,
        stderrRef: metadata.stderrRef ?? refs.stderrRel,
      } : metadata,
    };
  }));
}

async function enrichArtifactDataFromFileRefs(artifact: Record<string, unknown>, workspace: string) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const currentData = isPlainDataRecord(artifact.data) ? artifact.data : {};
  const type = String(artifact.type || artifact.id || '');
  const data: Record<string, unknown> = {
    ...await artifactDataFromPayloadRef(artifact, workspace),
    ...await artifactDataFromArtifactPath(artifact, workspace),
    ...currentData,
  };

  if (type === 'omics-differential-expression') {
    const markerRows = await readCsvRef(metadata.markerRef, workspace);
    const qcRows = await readCsvRef(metadata.qcRef, workspace);
    const compositionRows = await readCsvRef(metadata.compositionRef, workspace);
    const volcanoRows = await readCsvRef(metadata.volcanoRef, workspace);
    const umapSvgText = await readTextRef(metadata.umapSvgRef, workspace);
    const heatmapSvgText = await readTextRef(metadata.heatmapSvgRef, workspace);
    if (markerRows.length) data.markers = markerRows;
    if (qcRows.length) data.qc = qcRows;
    if (compositionRows.length) data.composition = compositionRows;
    if (volcanoRows.length) {
      data.volcano = volcanoRows;
      data.points = volcanoRows.map((row, index) => {
        const negLogP = numberFrom(row.negLogP ?? row.neg_log10_pval ?? row.neg_log10_p ?? row.pValue ?? row.pval_adj);
        return {
          gene: String(row.gene || row.label || `Gene${index + 1}`),
          logFC: numberFrom(row.logFC ?? row.log2FC ?? row.logfoldchange) ?? 0,
          negLogP,
          significant: Boolean((negLogP ?? 0) >= 1.3),
          cluster: String(row.cluster || row.cell_type || ''),
        };
      });
    }
    if (umapSvgText) data.umapSvgText = umapSvgText;
    if (heatmapSvgText) data.heatmapSvgText = heatmapSvgText;
  }

  if (type === 'research-report') {
    const markdown = await readTextRef(metadata.reportRef, workspace);
    const realDataPlanText = await readTextRef(metadata.realDataPlanRef, workspace);
    if (markdown) {
      data.markdown = markdown;
      if (!Array.isArray(data.sections)) {
        data.sections = markdownSections(markdown);
      }
    }
    const inlineMarkdown = stringField(data.markdown)
      ?? stringField(data.report)
      ?? stringField(data.content)
      ?? stringField(artifact.data)
      ?? stringField(artifact.markdown)
      ?? stringField(artifact.report)
      ?? stringField(artifact.content);
    if (inlineMarkdown) {
      data.markdown = inlineMarkdown;
      data.report = stringField(data.report) ?? inlineMarkdown;
      if (!Array.isArray(data.sections)) {
        data.sections = markdownSections(inlineMarkdown);
      }
    }
    if (realDataPlanText) {
      try {
        data.realDataPlan = JSON.parse(realDataPlanText);
      } catch {
        data.realDataPlan = realDataPlanText;
      }
    }
  }

  const pathRef = stringField(artifact.path);
  return Object.keys(data).length
    ? { ...artifact, data, dataRef: stringField(artifact.dataRef) ?? pathRef }
    : artifact;
}

async function artifactDataFromArtifactPath(artifact: Record<string, unknown>, workspace: string) {
  const path = safeWorkspaceFilePath(artifact.path, workspace);
  if (!path) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    const text = await readTextRef(artifact.path, workspace);
    const type = String(artifact.type || artifact.id || '');
    return text && /report|summary|markdown|text/i.test(type) ? { markdown: text, content: text } : {};
  }
  if (!isRecord(parsed)) return {};
  const { type: _type, id: _id, ...rest } = parsed;
  return rest;
}

async function artifactDataFromPayloadRef(artifact: Record<string, unknown>, workspace: string) {
  const ref = typeof artifact.dataRef === 'string'
    ? artifact.dataRef
    : isRecord(artifact.metadata) && typeof artifact.metadata.outputRef === 'string'
      ? artifact.metadata.outputRef
      : undefined;
  if (!ref) return {};
  const path = safeWorkspaceFilePath(ref, workspace);
  if (!path) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.artifacts)) return {};
  const wantedId = typeof artifact.id === 'string' ? artifact.id : undefined;
  const wantedType = typeof artifact.type === 'string' ? artifact.type : wantedId;
  const match = parsed.artifacts
    .filter(isRecord)
    .find((candidate) => {
      const id = typeof candidate.id === 'string' ? candidate.id : undefined;
      const type = typeof candidate.type === 'string' ? candidate.type : undefined;
      return (wantedId && id === wantedId) || (wantedType && type === wantedType);
    });
  if (!match || !isPlainDataRecord(match.data)) return {};
  return match.data;
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

async function readTextRef(value: unknown, workspace: string) {
  const path = safeWorkspaceFilePath(value, workspace);
  if (!path) return undefined;
  try {
    return await readFile(path, 'utf8');
  } catch {
    const scanpyFallback = scanpyFigureFallbackPath(path, workspace);
    if (!scanpyFallback) return undefined;
    try {
      return await readFile(scanpyFallback, 'utf8');
    } catch {
      return undefined;
    }
  }
}

async function readCsvRef(value: unknown, workspace: string) {
  const text = await readTextRef(value, workspace);
  return text ? parseCsvRows(text) : [];
}

function safeWorkspaceFilePath(value: unknown, workspace: string) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const candidate = value.trim();
  const workspaceRoot = resolve(workspace);
  const absolute = candidate.startsWith('/') ? resolve(candidate) : resolve(workspaceRoot, candidate);
  return absolute.startsWith(`${workspaceRoot}/`) || absolute === workspaceRoot ? absolute : undefined;
}

function scanpyFigureFallbackPath(path: string, workspace: string) {
  if (!path.replaceAll('\\', '/').includes('/.sciforge/task-results/figures/')) return undefined;
  const basename = path.split('/').pop();
  if (!basename) return undefined;
  const normalizedName = basename.replace(/^rank_genes_groups_/, '');
  const candidate = resolve(workspace, 'figures', normalizedName);
  return candidate.startsWith(`${resolve(workspace)}/`) ? candidate : undefined;
}

function parseCsvRows(text: string) {
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim().length));
  const header = rows[0]?.map((cell) => cell.trim()) ?? [];
  if (!header.length) return [];
  return rows.slice(1).map((row) => Object.fromEntries(header.map((key, index) => [key, coerceCsvValue(row[index] ?? '')])));
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function coerceCsvValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : trimmed;
}

function numberFrom(value: unknown) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function markdownSections(markdown: string) {
  const sections: Array<{ title: string; content: string }> = [];
  let current: { title: string; content: string } | undefined;
  for (const line of markdown.split('\n')) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      if (current) sections.push({ ...current, content: current.content.trim() });
      current = { title: heading[1].trim(), content: '' };
      continue;
    }
    if (current) current.content += `${line}\n`;
  }
  if (current) sections.push({ ...current, content: current.content.trim() });
  return sections;
}

export function repairNeededPayload(
  request: GatewayRequest,
  skill: SkillAvailability,
  reason: string,
  refs: RepairPolicyRefs = {},
): ToolPayload {
  return buildRepairNeededPayload(request, skill, reason, refs, attemptPlanRefsBuilder(request, skill, reason));
}

export function agentServerGenerationFailureReason(error: string, diagnostics?: AgentServerGenerationFailureDiagnostics) {
  if (diagnostics?.kind !== 'contextWindowExceeded') return error;
  const parts = [
    'blocker=contextWindowExceeded: AgentServer/backend exceeded its context window during task generation.',
    `failureReason=${error}`,
    diagnostics.backend ? `backend=${diagnostics.backend}` : undefined,
    diagnostics.provider ? `provider=${diagnostics.provider}` : undefined,
    diagnostics.agentId ? `session=${diagnostics.agentId}` : undefined,
    diagnostics.originalErrorSummary ? `originalError=${diagnostics.originalErrorSummary}` : undefined,
    diagnostics.compaction ? `compact=${diagnostics.compaction.ok ? 'ok' : 'failed'}:${diagnostics.compaction.strategy}:${diagnostics.compaction.message || diagnostics.compaction.reason}` : 'compact=not-run',
    diagnostics.retryAttempted ? 'retry=attempted-once' : 'retry=not-attempted',
    diagnostics.retrySucceeded === false ? 'retryResult=failed' : undefined,
  ];
  return parts.filter(Boolean).join(' | ');
}

export function agentServerFailurePayloadRefs(diagnostics?: AgentServerGenerationFailureDiagnostics): Partial<{
  blocker: string;
  agentServerRefs: Record<string, unknown>;
  recoverActions: string[];
}> {
  if (!diagnostics) return {};
  const refs = {
    blocker: diagnostics.kind,
    agentServerRefs: {
      backend: diagnostics.backend,
      provider: diagnostics.provider,
      model: diagnostics.model,
      agentId: diagnostics.agentId,
      sessionRef: diagnostics.sessionRef,
      originalErrorSummary: diagnostics.originalErrorSummary,
      contextCompaction: diagnostics.compaction ? contextCompactionMetadata(diagnostics.compaction) : undefined,
      compactResult: diagnostics.compaction,
      retryAttempted: diagnostics.retryAttempted,
      retrySucceeded: diagnostics.retrySucceeded,
    },
  };
  return diagnostics.kind === 'contextWindowExceeded'
    ? {
      ...refs,
      recoverActions: [
        'Inspect AgentServer/backend context compaction diagnostics in refs.contextCompaction.',
        'Retry after reducing artifacts, priorAttempts, logs, or selected UI state passed into this turn.',
        'Use a backend/model with a larger context window if compaction keeps failing.',
      ],
    }
    : refs;
}

export function failedTaskPayload(
  request: GatewayRequest,
  skill: SkillAvailability,
  run: Awaited<ReturnType<typeof runWorkspaceTask>>,
  parseReason?: string,
): ToolPayload {
  return repairNeededPayload(
    request,
    skill,
    parseReason ? `Task exited ${run.exitCode} and output could not be parsed: ${parseReason}` : `Task exited ${run.exitCode}: ${run.stderr || 'no stderr'}`,
    {
      taskRel: run.spec.taskRel,
      outputRel: run.outputRef,
      stdoutRel: run.stdoutRef,
      stderrRel: run.stderrRef,
    },
  );
}

export function schemaErrors(payload: unknown) {
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
