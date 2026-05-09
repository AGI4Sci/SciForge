import type { AgentStreamEvent } from './domain';

export type WorkEventKind =
  | 'plan'
  | 'explore'
  | 'search'
  | 'fetch'
  | 'analyze'
  | 'read'
  | 'write'
  | 'command'
  | 'wait'
  | 'validate'
  | 'emit'
  | 'artifact'
  | 'recover'
  | 'diagnostic'
  | 'message'
  | 'other';

export type WorkEventCounts = Record<WorkEventKind, number> & { total: number };

const visibleRunningWorkKinds = new Set<WorkEventKind>([
  'explore',
  'search',
  'fetch',
  'analyze',
  'read',
  'write',
  'command',
  'wait',
  'validate',
  'emit',
  'artifact',
  'recover',
]);

export interface StructuredWorkEventSummary {
  operationKind?: WorkEventKind;
  project?: {
    id?: string;
    title?: string;
    status?: string;
    progress?: string;
  };
  stage?: {
    id?: string;
    title?: string;
    index?: number;
    kind?: string;
    status?: string;
    summary?: string;
  };
  evidence?: string;
  failure?: string;
  nextStep?: string;
  recoverActions: string[];
  diagnostics: string[];
  detail: string;
}

const TASK_STAGE_SCHEMA_VERSION = 'sciforge.task-stage.v1';
const TASK_PROJECT_HANDOFF_SCHEMA_VERSIONS = new Set([
  'sciforge.task-project-handoff.v1',
  'sciforge.task-project-handoff-summary.v1',
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function emptyWorkEventCounts(): WorkEventCounts {
  return {
    total: 0,
    plan: 0,
    explore: 0,
    search: 0,
    fetch: 0,
    analyze: 0,
    read: 0,
    write: 0,
    command: 0,
    wait: 0,
    validate: 0,
    emit: 0,
    artifact: 0,
    recover: 0,
    diagnostic: 0,
    message: 0,
    other: 0,
  };
}

export function classifyWorkEvent(
  event: AgentStreamEvent,
  detail = '',
  shortDetail = '',
): WorkEventKind {
  if (event.contextWindowState || event.contextCompaction || event.type === 'usage-update') return 'diagnostic';
  const structured = structuredWorkEventSummary(event);
  if (structured?.operationKind) return structured.operationKind;
  const raw = isRecord(event.raw) ? event.raw : {};
  const toolName = typeof raw.toolName === 'string' ? raw.toolName : '';
  const haystack = `${event.type} ${event.label} ${toolName} ${detail} ${shortDetail}`.toLowerCase();

  if (/current-plan|run-plan|stage-start|plan:|计划|规划/.test(haystack)) return 'plan';
  if (/acceptance-repair|repair|recover|retry|fallback|恢复|重试|修复/.test(haystack)) return 'recover';
  if (/verifier|validation|validate|acceptance|验收|校验|验证/.test(haystack)) return 'validate';
  if (/taskfiles|agentservergenerationresponse|write_file|wrote \d+ bytes|\.sciforge\/tasks|生成任务文件|生成脚本|写入脚本|\.(?:py|r|sh|js|ts)\b/.test(haystack)) return 'write';
  if (/search|grep|rg\b|检索|搜索/.test(haystack)) return 'search';
  if (/fetch|curl|wget|download|抓取|下载/.test(haystack)) return 'fetch';
  if (/analy[sz]e|analysis|reason|infer|summari[sz]e|compare|统计|分析|推理|总结|比对/.test(haystack)) return 'analyze';
  if (/explore|browse|list|ls\b|find\b|tree\b|scan|discover|探索|列出|浏览|枚举/.test(haystack)) return 'explore';
  if (/\bread\b|cat\b|sed\b|open\b|读取|查看/.test(haystack)) return 'read';
  if (/write|patch|edit|save|create|写入|编辑|修改/.test(haystack)) return 'write';
  if (/run_command|command|python|node|npm|pnpm|yarn|tsx|pytest|bash|执行命令|运行/.test(haystack)) return 'command';
  if (/wait|waiting|silent|等待|stream 仍在等待/.test(haystack)) return 'wait';
  if (/emit|final|publish|report|输出|发布|汇总/.test(haystack)) return 'emit';
  if (/artifact|object reference|executionunit|paper-list|evidence-matrix|产物|报告对象/.test(haystack)) return 'artifact';
  if (/error|failed|failure|blocked|timeout|exception|失败|阻断|超时/.test(haystack)) return 'diagnostic';
  if (event.type === 'text-delta') return 'message';
  return 'other';
}

export function summarizeWorkEvent(kind: WorkEventKind, detail: string) {
  if (!detail) return '';
  if (kind === 'explore') return `Explored ${detail}`;
  if (kind === 'search') return `Searched ${detail}`;
  if (kind === 'fetch') return `Fetched ${detail}`;
  if (kind === 'analyze') return `Analyzed ${detail}`;
  if (kind === 'read') return `Read ${detail}`;
  if (kind === 'write') return `Wrote ${detail}`;
  if (kind === 'command') return `Ran ${detail}`;
  if (kind === 'wait') return `Waiting ${detail}`;
  if (kind === 'validate') return `Validated ${detail}`;
  if (kind === 'emit') return `Emitted ${detail}`;
  if (kind === 'artifact') return `Created ${detail}`;
  if (kind === 'recover') return `Recovered ${detail}`;
  return detail;
}

export function summarizeWorklog(
  operations: WorkEventCounts,
  counts: { total: number; key: number; background: number },
  guidanceCount: number,
) {
  const parts = [
    operations.explore ? `${operations.explore} 探索` : '',
    operations.search ? `${operations.search} 搜索` : '',
    operations.fetch ? `${operations.fetch} 抓取` : '',
    operations.analyze ? `${operations.analyze} 分析` : '',
    operations.read ? `${operations.read} 读取` : '',
    operations.write ? `${operations.write} 写入` : '',
    operations.command ? `${operations.command} 执行` : '',
    operations.wait ? `${operations.wait} 等待` : '',
    operations.validate ? `${operations.validate} 验证` : '',
    operations.emit ? `${operations.emit} 输出` : '',
    operations.artifact ? `${operations.artifact} 产物` : '',
    operations.recover ? `${operations.recover} 恢复` : '',
    guidanceCount ? `${guidanceCount} 引导` : '',
  ].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return `${counts.total} 条操作 · ${counts.key} 关键 · ${counts.background} 过程`;
}

export function formatRawWorkEventOutput(event: AgentStreamEvent) {
  const raw = event.raw ?? { type: event.type, label: event.label, detail: event.detail };
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(raw);
  }
}

export function structuredWorkEventSummary(event: AgentStreamEvent): StructuredWorkEventSummary | undefined {
  const raw = event.raw ?? {};
  const evidences = uniqueWorkEvidence([
    ...collectWorkEvidence(event.workEvidence),
    ...collectWorkEvidence(raw),
  ]);
  const projectSummary = collectTaskProjectSummary(raw);
  const stage = collectTaskStages(raw)[0] ?? projectSummary?.currentStage;
  const evidence = evidences[0];
  if (!evidence && !stage && !projectSummary) return undefined;
  const project = projectSummary?.project ?? (stage && stringField(stage.projectId)
    ? { id: stringField(stage.projectId), status: undefined, title: undefined, progress: undefined }
    : undefined);

  const operationKind = stage
    ? operationKindForStage(stage)
    : evidence
      ? operationKindForEvidence(evidence)
      : undefined;
  const stageFailure = isRecord(stage?.failure) ? stage.failure : undefined;
  const recoverActions = uniqueStrings([
    ...stringList(evidence?.recoverActions),
    ...stringList(stageFailure?.recoverActions),
    ...stringList(stage?.recoverActions),
  ]);
  const failure = firstString(evidence?.failureReason, stage?.failureReason, stageFailure?.reason);
  const nextStep = firstString(
    evidence?.nextStep,
    stage?.nextStep,
    stage?.metadata && isRecord(stage.metadata) ? stage.metadata.nextStep : undefined,
    recoverActions[0],
  );
  const evidenceText = firstString(
    firstStageWorkEvidenceSummary(stage),
    evidence?.outputSummary,
    stringList(evidence?.evidenceRefs)[0],
    stringList(stage?.evidenceRefs)[0],
    stringList(stage?.artifactRefs)[0],
    stringList(stage?.outputRefs)[0],
    stringField(stage?.outputRef),
  );
  const diagnostics = uniqueStrings([
    ...stringList(evidence?.diagnostics),
    ...stringList(stage?.diagnostics),
    ...stringList(stage?.logRefs),
    ...stringList([stage?.stdoutRef, stage?.stderrRef]),
  ]);
  const detail = structuredDetail({
    operationKind,
    project,
    stage,
    evidence: evidenceText,
    failure,
    nextStep,
    recoverActions,
    diagnostics,
  });

  return {
    operationKind,
    project,
    stage: stage
      ? {
        id: stringField(stage.id),
        title: stringField(stage.title),
        index: numberField(stage.index),
        kind: stringField(stage.kind),
        status: stringField(stage.status),
        summary: stringField(stage.summary),
      }
      : undefined,
    evidence: evidenceText,
    failure,
    nextStep,
    recoverActions,
    diagnostics,
    detail,
  };
}

function uniqueWorkEvidence(records: Record<string, unknown>[]) {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = JSON.stringify({
      kind: record.kind,
      status: record.status,
      provider: record.provider,
      input: record.input,
      resultCount: record.resultCount,
      failureReason: record.failureReason,
      rawRef: record.rawRef,
    });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function summarizeGeneratedTaskFiles(value: string) {
  if (!/taskFiles|AgentServerGenerationResponse/i.test(value)) return '';
  const paths = Array.from(value.matchAll(/"path"\s*:\s*"([^"]+)"/g))
    .map((match) => match[1])
    .filter((path) => /(?:^|\/)tasks\/|\.py$|\.R$|\.sh$|\.js$|\.ts$/i.test(path));
  const uniquePaths = Array.from(new Set(paths)).slice(0, 3);
  if (!uniquePaths.length) return '生成任务文件与运行入口。';
  return `生成任务文件：${uniquePaths.join('、')}`;
}

export function isVisibleRunningWorkKind(kind: WorkEventKind) {
  return visibleRunningWorkKinds.has(kind);
}

function collectTaskProjectSummary(value: unknown): {
  project?: StructuredWorkEventSummary['project'];
  currentStage?: Record<string, unknown>;
} | undefined {
  const candidates = collectRecords(value).filter((record) => {
    const schema = stringField(record.schemaVersion);
    return Boolean(schema && TASK_PROJECT_HANDOFF_SCHEMA_VERSIONS.has(schema) && isRecord(record.project) && Array.isArray(record.stages));
  });
  const summary = candidates[0];
  if (!summary) return undefined;
  const project = isRecord(summary.project) ? summary.project : {};
  const stages = Array.isArray(summary.stages) ? summary.stages.filter(isRecord) : [];
  const currentStage = stages.find((stage) => ['running', 'failed', 'blocked'].includes(stringField(stage.status) ?? ''))
    ?? stages.find((stage) => stringField(stage.status) === 'planned')
    ?? stages.at(-1);
  const done = stages.filter((stage) => stringField(stage.status) === 'done').length;
  const total = stages.length;
  const running = currentStage ? `${stageLabel(currentStage)}${currentStage.status ? ` · ${currentStage.status}` : ''}` : undefined;
  return {
    project: {
      id: stringField(project.id),
      title: stringField(project.title),
      status: stringField(project.status),
      progress: total ? `${done}/${total} stages${running ? ` · ${running}` : ''}` : running,
    },
    currentStage,
  };
}

function collectTaskStages(value: unknown) {
  return collectRecords(value).filter(isTaskStageRecord);
}

function collectWorkEvidence(value: unknown) {
  return collectRecords(value).filter(isWorkEvidenceRecord);
}

function collectRecords(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6 || value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => collectRecords(entry, depth + 1));
  if (!isRecord(value)) return [];
  return [value, ...Object.values(value).flatMap((entry) => collectRecords(entry, depth + 1))];
}

function operationKindForEvidence(evidence: Record<string, unknown>): WorkEventKind {
  const kind = stringField(evidence.kind)?.toLowerCase() ?? '';
  const status = stringField(evidence.status)?.toLowerCase() ?? '';
  if (status === 'failed' || status === 'repair-needed' || status === 'failed-with-reason') return stringList(evidence.recoverActions).length ? 'recover' : 'diagnostic';
  if (kind === 'retrieval' || kind === 'search') return 'search';
  if (kind === 'fetch') return 'fetch';
  if (kind === 'read') return 'read';
  if (kind === 'validate' || kind === 'verification') return 'validate';
  if (kind === 'command') return 'command';
  if (kind === 'artifact' || kind === 'emit') return 'emit';
  if (kind === 'claim' || kind === 'analysis') return 'analyze';
  return 'other';
}

function operationKindForStage(stage: Record<string, unknown>): WorkEventKind {
  const status = stringField(stage.status)?.toLowerCase() ?? '';
  const failure = isRecord(stage.failure) ? stage.failure : undefined;
  const stageEvidence = Array.isArray(stage.workEvidence) ? stage.workEvidence.filter(isRecord).find(isWorkEvidenceRecord) : undefined;
  const evidenceStatus = stringField(stageEvidence?.status)?.toLowerCase() ?? '';
  if (status === 'failed' || status === 'blocked' || status === 'repair-needed') {
    return stringList(failure?.recoverActions).length || stringList(stage.recoverActions).length ? 'recover' : 'diagnostic';
  }
  if (evidenceStatus === 'failed' || evidenceStatus === 'blocked' || evidenceStatus === 'repair-needed' || evidenceStatus === 'failed-with-reason') {
    return stringList(stageEvidence?.recoverActions).length || stringList(stage.recoverActions).length ? 'recover' : 'diagnostic';
  }
  const kind = stringField(stage.kind)?.toLowerCase() ?? '';
  if (/search|retriev|query/.test(kind)) return 'search';
  if (/fetch|download|crawl/.test(kind)) return 'fetch';
  if (/valid|verify|check|accept/.test(kind)) return 'validate';
  if (/emit|report|final|artifact|publish|output/.test(kind)) return 'emit';
  if (/analy|summar|reason|compare|compute|stat/.test(kind)) return 'analyze';
  return 'other';
}

function isTaskStageRecord(record: Record<string, unknown>) {
  return stringField(record.schemaVersion) === TASK_STAGE_SCHEMA_VERSION
    && Boolean(stringField(record.projectId))
    && numberField(record.index) !== undefined
    && Boolean(stringField(record.kind))
    && Boolean(stringField(record.status));
}

function isWorkEvidenceRecord(record: Record<string, unknown>) {
  const schema = stringField(record.schemaVersion);
  if (schema?.startsWith('sciforge.task-')) return false;
  if (stringField(record.projectId) && numberField(record.index) !== undefined) return false;
  return Boolean(stringField(record.kind))
    && Boolean(stringField(record.status))
    && Array.isArray(record.evidenceRefs)
    && Array.isArray(record.recoverActions);
}

function firstStageWorkEvidenceSummary(stage: Record<string, unknown> | undefined) {
  const records = Array.isArray(stage?.workEvidence) ? stage.workEvidence.filter(isRecord).filter(isWorkEvidenceRecord) : [];
  return firstString(
    records[0]?.outputSummary,
    records[0]?.failureReason,
    stringList(records[0]?.evidenceRefs)[0],
  );
}

function structuredDetail(summary: {
  operationKind?: WorkEventKind;
  project?: StructuredWorkEventSummary['project'];
  stage?: Record<string, unknown>;
  evidence?: string;
  failure?: string;
  nextStep?: string;
  recoverActions: string[];
  diagnostics: string[];
}) {
  const parts = [
    summary.project ? `Project: ${summary.project.title || summary.project.id || 'project'}${summary.project.status ? ` · ${summary.project.status}` : ''}${summary.project.progress ? ` · ${summary.project.progress}` : ''}` : '',
    summary.stage ? `Stage: ${stageLabel(summary.stage)}${summary.stage.status ? ` · ${summary.stage.status}` : ''}` : '',
    summary.stage?.summary ? `Summary: ${summary.stage.summary}` : '',
    summary.evidence ? `Evidence: ${summary.evidence}` : '',
    summary.failure ? `Failure: ${summary.failure}` : '',
    summary.recoverActions.length ? `Recover: ${summary.recoverActions.slice(0, 2).join(' · ')}` : '',
    summary.diagnostics.length ? `Diagnostic: ${summary.diagnostics.slice(0, 2).join(' · ')}` : '',
    summary.nextStep ? `Next: ${summary.nextStep}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

function stageLabel(stage: Record<string, unknown>) {
  const index = numberField(stage.index);
  const kind = stringField(stage.kind);
  const title = stringField(stage.title);
  const prefix = index === undefined ? '' : `${index + 1}. `;
  return `${prefix}${title || kind || stringField(stage.id) || 'stage'}`;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = stringField(value);
    if (text) return text;
  }
  return undefined;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
