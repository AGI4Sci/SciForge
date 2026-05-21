import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { GatewayRequest, ToolPayload, VerificationResult, WorkspaceRuntimeCallbacks } from './runtime-types.js';
import { emitWorkspaceRuntimeEvent } from './workspace-runtime-events.js';
import { sha1 } from './workspace-task-runner.js';
import { workspaceTaskPythonCommandCandidates } from '../../packages/skills/runtime-policy';

const TOOL_ID = 'sciforge.local-tabular-analysis.csv';
const execFileAsync = promisify(execFile);

type ParsedRow = Record<string, unknown>;
type TableInput = { header: string[]; rows: ParsedRow[]; sourceRef?: string };
type AnalysisKind = 'paired-change' | 'cross-sectional-continuous' | 'binary-outcome';
type TableSchema = {
  analysisKind: AnalysisKind;
  subjectKey: string;
  groupKey: string;
  baselineKey?: string;
  followupKey?: string;
  outcomeKey?: string;
  baselineUnitKey?: string;
  followupUnitKey?: string;
  sharedUnitKey?: string;
  siteKey?: string;
  notesKey?: string;
  referenceGroup: string;
  comparisonGroup: string;
  unitLabel: string;
};
type CleanRow = ParsedRow & {
  baseline_value: number | null;
  followup_value: number | null;
  outcome_value: number | null;
  event_value: number | null;
  change_value: number | null;
  qc_flags: string[];
  analysis_included: boolean;
};

export async function tryRunLocalTabularAnalysisRuntime(
  request: GatewayRequest,
  callbacks: WorkspaceRuntimeCallbacks = {},
): Promise<ToolPayload | undefined> {
  if (isExplicitCodeDebugRequest(request.prompt)) return undefined;
  if (isMethodologyFinalizerRequest(request.prompt)) return undefined;
  if (!/(csv|tsv|table|tabular|dataframe|messy|缺失|clean(?:ing)?|清洗|统计|模型|图表|复现|reproducible|qc|sensitivity|robustness|limitations?|rerun|report|chart|current analysis|previous analysis|this current dataset|结果|限制|复跑|稳健|敏感性|当前分析|上次分析)/i.test(request.prompt)) {
    return undefined;
  }
  const workspace = resolve(request.workspacePath || process.cwd());
  const table = extractInlineTable(request.prompt) ?? await extractReferencedTable(request, workspace);
  if (!table || table.rows.length < 4) {
    return tryRunLocalTabularFollowupRuntime(request, workspace, callbacks);
  }
  const schema = inferTableSchema(table.header, table.rows);
  if (!schema) {
    return tryRunLocalTabularFollowupRuntime(request, workspace, callbacks);
  }

  const id = sha1(JSON.stringify({ prompt: request.prompt, header: table.header, rows: table.rows, sourceRef: table.sourceRef })).slice(0, 12);
  const rootRel = `.sciforge/local-tabular-analysis/${id}`;
  const root = join(workspace, rootRel);
  await mkdir(root, { recursive: true });

  const rawCsv = toCsv(table.header, table.rows);
  const cleaned = cleanRows(table.rows, schema);
  const included = cleaned.filter((row) => row.analysis_included && row.change_value !== null);
  if (included.length < 4) return undefined;
  const stats = summarizeAnalysis(cleaned, included, schema);
  const files = {
    raw: join(root, 'input.csv'),
    cleaned: join(root, 'cleaned.csv'),
    report: join(root, 'analysis-report.md'),
    chart: join(root, 'change-by-group.svg'),
    qcChart: join(root, 'qc-summary.svg'),
    results: join(root, 'results.json'),
    script: join(root, 'rerun_analysis.py'),
  };
  const rel = Object.fromEntries(Object.entries(files).map(([key, value]) => [key, value.slice(workspace.length + 1)])) as Record<keyof typeof files, string>;
  const cleanedHeader = [...table.header, 'baseline_value', 'followup_value', 'change_value', 'outcome_value', 'event_value', 'qc_flags', 'analysis_included'];
  const cleanedCsv = toCsv(cleanedHeader, cleaned.map((row) => Object.fromEntries(cleanedHeader.map((key) => {
    const value = key === 'qc_flags' ? row.qc_flags.join('|') : row[key as keyof CleanRow];
    return [key, value === null ? '' : String(value ?? '')];
  }))));
  const report = buildReport({ stats, rel, rowCount: cleaned.length, includedCount: included.length });
  const chart = buildSvgChart(stats.groupSummaries, stats.unitLabel, stats.measureLabel);
  const qcChart = buildQcSvgChart(cleaned);
  const script = buildRerunScript();

  await writeFile(files.raw, rawCsv, 'utf8');
  await writeFile(files.cleaned, cleanedCsv, 'utf8');
  await writeFile(files.report, report, 'utf8');
  await writeFile(files.chart, chart, 'utf8');
  await writeFile(files.qcChart, qcChart, 'utf8');
  await writeFile(files.results, JSON.stringify(stats, null, 2), 'utf8');
  await writeFile(files.script, script, 'utf8');
  const rerunVerification = await verifyRerunScript(
    workspace,
    rel.script,
    rel.raw,
    `${rootRel}/rerun-output-verification.json`,
  );

  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'local-tabular-analysis-runtime',
    source: 'workspace-runtime-gateway',
    status: 'satisfied',
    message: 'Completed local reproducible tabular analysis from CSV/TSV.',
    detail: `rows=${cleaned.length}; included=${included.length}; primaryEffect=${round(stats.primaryModel.primaryGroupCoefficient)}`,
  });

  const artifactId = `tabular-analysis-${id}`;
  const sourceDescription = table.sourceRef ? `referenced workspace CSV/TSV (${table.sourceRef})` : 'inline CSV/TSV in the current turn';
  const message = [
    `Reproducible tabular analysis completed from the ${sourceDescription}; no remote backend generation was started.`,
    '',
    `Primary model: ${stats.primaryModel.formula}. Estimated ${stats.primaryModel.comparisonLabel} coefficient: ${round(stats.primaryModel.primaryGroupCoefficient)} ${stats.unitLabel}.`,
    `Approximate 95% CI: [${stats.primaryModel.diagnostics.confidenceInterval95.join(', ')}] ${stats.unitLabel}; approximate p=${formatPValue(stats.primaryModel.diagnostics.pValueApprox)}.`,
    `QC: ${stats.qcSummary.join('; ')}.`,
    `Sensitivity: including flagged outliers gives ${stats.primaryModel.comparisonLabel} mean-change delta ${round(stats.sensitivity.includeFlaggedOutliersPrimaryDelta)} ${stats.unitLabel}; duplicate-first policy gives ${round(stats.sensitivity.keepFirstDuplicatePrimaryDelta)} ${stats.unitLabel}.`,
    `Artifacts: report=${rel.report}, cleaned data=${rel.cleaned}, charts=${rel.chart} and ${rel.qcChart}, rerun script=${rel.script}.`,
  ].join('\n');

  return {
    message,
    confidence: 0.84,
    claimType: 'analysis',
    evidenceLevel: 'runtime',
    reasoningTrace: 'SciForge local tabular analysis runtime parsed the user table or referenced workspace CSV/TSV, cleaned units/missing values/duplicates/outliers, fit a bounded OLS model, wrote workspace artifacts, and generated a rerun script.',
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'completed',
      verificationStatus: {
        status: rerunVerification.verdict === 'pass' ? 'verified' : 'unverified',
        verdict: rerunVerification.verdict,
        verifierRef: `verification:${rerunVerification.id}`,
        summary: rerunVerification.critique,
      },
    },
    claims: [{
      id: `claim-${artifactId}-primary`,
      type: 'analysis',
      text: `${stats.primaryModel.comparisonLabel} coefficient in the primary model is ${round(stats.primaryModel.primaryGroupCoefficient)} ${stats.unitLabel}.`,
      confidence: 0.84,
      evidenceLevel: 'runtime',
      supportingRefs: [`file:${rel.results}`, `file:${rel.cleaned}`, `file:${rel.script}`],
      opposingRefs: [],
    }],
    uiManifest: [
      { componentId: 'report-viewer', artifactRef: `${artifactId}-report`, title: 'Reproducible data analysis report', priority: 1 },
    ],
    executionUnits: [{
      id: `EU-${artifactId}`,
      tool: TOOL_ID,
      status: 'done',
      params: JSON.stringify({ rowCount: cleaned.length, includedCount: included.length, model: stats.primaryModel.formula }),
      hash: sha1(JSON.stringify(stats)).slice(0, 16),
      outputRef: rel.results,
      codeRef: rel.script,
      verificationRef: `verification:${rerunVerification.id}`,
      verificationVerdict: rerunVerification.verdict,
    }],
    verificationResults: [rerunVerification],
    artifacts: [
      artifact(`${artifactId}-report`, 'research-report', rel.report, { source: TOOL_ID, resultsRef: rel.results }),
      artifact(`${artifactId}-cleaned`, 'data-table', rel.cleaned, { source: TOOL_ID, rawRef: rel.raw, rowCount: cleaned.length }),
      artifact(`${artifactId}-chart`, 'figure', rel.chart, { source: TOOL_ID, resultsRef: rel.results }),
      artifact(`${artifactId}-qc-chart`, 'figure', rel.qcChart, { source: TOOL_ID, resultsRef: rel.results }),
      artifact(`${artifactId}-code`, 'notebook-timeline', rel.script, { source: TOOL_ID, command: `python ${rel.script} ${rel.raw} ${rootRel}/rerun-output.json` }),
      artifact(`${artifactId}-results`, 'statistical-result', rel.results, { source: TOOL_ID }),
    ],
    objectReferences: [
      objectRef('report', 'file', 'Analysis report', rel.report),
      objectRef('cleaned', 'file', 'Cleaned CSV', rel.cleaned),
      objectRef('chart', 'file', 'Primary effect chart', rel.chart),
      objectRef('qc-chart', 'file', 'QC inclusion chart', rel.qcChart),
      objectRef('script', 'file', 'Rerun script', rel.script),
      objectRef('results', 'file', 'Statistical results JSON', rel.results),
    ],
  };
}

async function tryRunLocalTabularFollowupRuntime(
  request: GatewayRequest,
  workspace: string,
  callbacks: WorkspaceRuntimeCallbacks,
): Promise<ToolPayload | undefined> {
  if (isExplicitCodeDebugRequest(request.prompt)) return undefined;
  if (isMethodologyFinalizerRequest(request.prompt)) return undefined;
  if (!/(current|previous|existing|this dataset|上次|当前|已有|robustness|sensitivity|limitations?|rerun|report|chart|clean(?:ing)?|qc|model|statistical|结果|限制|复跑|稳健|敏感性|清洗|统计|模型|图表)/i.test(request.prompt)) {
    return undefined;
  }
  const promptRoots = collectLocalTabularRoots(request.prompt);
  const contextRoots = collectLocalTabularRoots({
    artifacts: request.artifacts,
    references: request.references,
    uiState: request.uiState,
  });
  const rootRel = promptRoots.at(-1) ?? await newestLocalTabularRoot(workspace, contextRoots) ?? await latestLocalTabularRoot(workspace);
  if (!rootRel) return undefined;
  const reportRel = `${rootRel}/analysis-report.md`;
  const resultsRel = `${rootRel}/results.json`;
  const scriptRel = `${rootRel}/rerun_analysis.py`;
  const chartRel = `${rootRel}/change-by-group.svg`;
  const qcChartRel = `${rootRel}/qc-summary.svg`;
  const cleanedRel = `${rootRel}/cleaned.csv`;
  const report = await readFile(join(workspace, reportRel), 'utf8').catch(() => undefined);
  const results = await readFile(join(workspace, resultsRel), 'utf8').then((text) => JSON.parse(text) as Record<string, unknown>).catch(() => undefined);
  if (!report && !results) return undefined;

  const primaryModel = isRecord(results?.primaryModel) ? results.primaryModel : {};
  const coefficient = typeof primaryModel.primaryGroupCoefficient === 'number'
    ? primaryModel.primaryGroupCoefficient
    : typeof primaryModel.groupTreatmentCoefficient === 'number'
      ? primaryModel.groupTreatmentCoefficient
      : undefined;
  const comparisonLabel = [stringField(primaryModel.comparisonGroup), stringField(primaryModel.referenceGroup)].filter(Boolean).join(' vs ')
    || stringField(primaryModel.comparisonLabel)
    || 'primary comparison';
  const unitLabel = stringField(results?.unitLabel) ?? 'analysis units';
  const sensitivity = sectionFromMarkdown(report, 'Sensitivity / Robustness');
  const cleaning = sectionFromMarkdown(report, 'Cleaning Strategy');
  const qc = sectionFromMarkdown(report, 'QC');
  const model = sectionFromMarkdown(report, 'Statistical Model');
  const groupSummary = sectionFromMarkdown(report, 'Group Summary');
  const design = sectionFromMarkdown(report, 'Design Diagnostics');
  const limitations = sectionFromMarkdown(report, 'Limitations');
  const rerun = sectionFromMarkdown(report, 'Rerun Command') || `python ${scriptRel} ${rootRel}/input.csv ${rootRel}/rerun-output.json`;
  const wantsCleaning = /clean(?:ing)?|qc|清洗/i.test(request.prompt);
  const wantsModel = /model|statistical|模型|统计/i.test(request.prompt);
  const wantsChart = /chart|plot|figure|svg|visual|图表|图片|可视/i.test(request.prompt);
  const wantsDiagnostics = /confidence|interval|p[-\s]?value|p\s*值|置信|显著|sample size|样本|balance|imbalance|batch|site|center|diagnostic|诊断|平衡|批次|站点/i.test(request.prompt);
  const message = [
    `Current tabular analysis follow-up answered from existing artifacts in ${rootRel}; no remote backend generation was started.`,
    coefficient !== undefined ? `Primary model: ${comparisonLabel} coefficient ${round(coefficient)} ${unitLabel}.` : undefined,
    wantsCleaning && qc ? `QC: ${compactMarkdownBullets(qc)}` : undefined,
    wantsCleaning && cleaning ? `Cleaning strategy: ${compactMarkdownBullets(cleaning)}` : undefined,
    wantsModel && model ? `Statistical model: ${compactMarkdownBullets(model)}` : undefined,
    (wantsChart || wantsDiagnostics) && groupSummary ? `Chart interpretation: ${compactMarkdownBullets(groupSummary)} The SVG visualizes these mean changes only; use the model diagnostics and sensitivity checks for inferential support.` : undefined,
    wantsDiagnostics && design ? `Design diagnostics: ${compactMarkdownBullets(design)}` : undefined,
    sensitivity ? `Robustness: ${compactMarkdownBullets(sensitivity)}` : undefined,
    limitations ? `Limitations: ${compactMarkdownBullets(limitations)}` : undefined,
    /rerun|复跑|command/i.test(request.prompt) ? `Rerun command: ${compactMarkdownBullets(rerun)}` : undefined,
    `Artifacts: report=${reportRel}, charts=${chartRel} and ${qcChartRel}, cleaned=${cleanedRel}, results=${resultsRel}, rerun script=${scriptRel}.`,
  ].filter(Boolean).join('\n');

  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'local-tabular-analysis-followup-runtime',
    source: 'workspace-runtime-gateway',
    status: 'satisfied',
    message: 'Answered follow-up from existing local tabular analysis artifacts.',
    detail: rootRel,
  });

  const id = rootRel.split('/').at(-1) ?? sha1(rootRel).slice(0, 12);
  const artifactId = `tabular-analysis-followup-${id}`;
  const rerunVerification = await verifyRerunScript(
    workspace,
    scriptRel,
    `${rootRel}/input.csv`,
    `${rootRel}/rerun-output-followup-verification.json`,
  );
  return {
    message,
    confidence: 0.86,
    claimType: 'analysis',
    evidenceLevel: 'runtime',
    reasoningTrace: 'SciForge local tabular analysis follow-up runtime reused current analysis report/results refs and answered a continuation question without restarting the remote backend or duplicating analysis.',
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'completed',
      verificationStatus: {
        status: rerunVerification.verdict === 'pass' ? 'verified' : 'unverified',
        verdict: rerunVerification.verdict,
        verifierRef: `verification:${rerunVerification.id}`,
        summary: rerunVerification.critique,
      },
    },
    claims: coefficient !== undefined ? [{
      id: `claim-${artifactId}-primary`,
      type: 'analysis',
      text: `${comparisonLabel} coefficient in the current analysis is ${round(coefficient)} ${unitLabel}.`,
      confidence: 0.86,
      evidenceLevel: 'runtime',
      supportingRefs: [`file:${resultsRel}`, `file:${reportRel}`],
      opposingRefs: [],
    }] : [],
    uiManifest: [
      { componentId: 'report-viewer', artifactRef: `${artifactId}-report`, title: 'Current analysis report', priority: 1 },
    ],
    executionUnits: [{
      id: `EU-${artifactId}`,
      tool: `${TOOL_ID}.followup`,
      status: 'done',
      params: JSON.stringify({ rootRel, followup: request.prompt }),
      hash: sha1(JSON.stringify({ rootRel, prompt: request.prompt, coefficient })).slice(0, 16),
      outputRef: resultsRel,
      codeRef: scriptRel,
      verificationRef: `verification:${rerunVerification.id}`,
      verificationVerdict: rerunVerification.verdict,
    }],
    verificationResults: [rerunVerification],
    artifacts: [
      artifact(`${artifactId}-report`, 'research-report', reportRel, { source: `${TOOL_ID}.followup`, resultsRef: resultsRel }),
      artifact(`${artifactId}-cleaned`, 'data-table', cleanedRel, { source: `${TOOL_ID}.followup` }),
      artifact(`${artifactId}-chart`, 'figure', chartRel, { source: `${TOOL_ID}.followup`, resultsRef: resultsRel }),
      artifact(`${artifactId}-qc-chart`, 'figure', qcChartRel, { source: `${TOOL_ID}.followup`, resultsRef: resultsRel }),
      artifact(`${artifactId}-code`, 'notebook-timeline', scriptRel, { source: `${TOOL_ID}.followup`, command: `python ${scriptRel} ${rootRel}/input.csv ${rootRel}/rerun-output.json` }),
      artifact(`${artifactId}-results`, 'statistical-result', resultsRel, { source: `${TOOL_ID}.followup` }),
    ],
    objectReferences: [
      objectRef('report', 'file', 'Current analysis report', reportRel),
      objectRef('cleaned', 'file', 'Current cleaned CSV', cleanedRel),
      objectRef('chart', 'file', 'Current primary effect chart', chartRel),
      objectRef('qc-chart', 'file', 'Current QC inclusion chart', qcChartRel),
      objectRef('script', 'file', 'Current rerun script', scriptRel),
      objectRef('results', 'file', 'Current statistical results JSON', resultsRel),
    ],
  };
}

function isExplicitCodeDebugRequest(prompt: string) {
  return /\b(?:pytest|unit tests?|test_.*\.py|debug|fix|patch|root cause|implementation file|rerun tests?|代码调试|修复|补丁|复跑测试)\b/i.test(prompt)
    || /\bpython\s+-m\s+pytest\b/i.test(prompt)
    || /\.(?:py|ts|tsx|js|jsx)\b/i.test(prompt);
}

function isMethodologyFinalizerRequest(prompt: string) {
  const durableWriteback = /(write(?:\s+back)?|persist|save|final package|final protocol|artifact path|file path|写回|保存|落盘|最终(?:方案|protocol|package|文件|产物))/i.test(prompt);
  const methodology = /(methodolog|protocol|sample[-\s/]?statistics|risk register|execution checklist|preregistration|technical replicates?|方法学|方案|样本|统计|风险|预注册|技术重复)/i.test(prompt);
  return durableWriteback && methodology;
}

function extractInlineTable(prompt: string): TableInput | undefined {
  const lines = prompt.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return extractTableFromLines(lines);
}

async function extractReferencedTable(request: GatewayRequest, workspace: string): Promise<TableInput | undefined> {
  const refs = collectTableRefs(request);
  for (const ref of refs) {
    let sourceRef = ref.replace(/^file:/, '').replace(/[).,;:]+$/, '');
    sourceRef = sourceRef.startsWith('./') ? sourceRef.slice(2) : sourceRef.replace(/^\/+/, '');
    const absolute = resolve(workspace, sourceRef);
    if (absolute !== workspace && !absolute.startsWith(`${workspace}/`)) continue;
    const raw = await readFile(absolute, 'utf8').catch(() => undefined);
    if (!raw) continue;
    const table = extractTableFromLines(raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    if (table) return { ...table, sourceRef };
  }
  return undefined;
}

function collectTableRefs(request: GatewayRequest) {
  const refs = new Set<string>();
  for (const match of request.prompt.matchAll(/[A-Za-z0-9_./:-]+\.(?:csv|tsv)/gi)) {
    if (match[0]) refs.add(match[0]);
  }
  const visitUploads = (value: unknown, depth: number, uploadContext = false) => {
    if (depth > 5 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      const cleaned = value.trim();
      if (uploadContext && (/(?:^|[/.:_-])[^/]+\.csv$/i.test(cleaned) || /(?:^|[/.:_-])[^/]+\.tsv$/i.test(cleaned))) refs.add(cleaned);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 80)) visitUploads(item, depth + 1, uploadContext);
      return;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const metadata = record.metadata as Record<string, unknown> | undefined;
      const payload = record.payload as Record<string, unknown> | undefined;
      const isUpload = record.type === 'uploaded-data-file'
        || record.sourceId === 'user-upload'
        || String(metadata?.source ?? '').includes('user-upload')
        || String(record.ref ?? record.dataRef ?? record.path ?? metadata?.workspacePath ?? '').includes('.sciforge/uploads/');
      for (const key of ['ref', 'dataRef', 'path', 'workspacePath']) visitUploads(record[key], depth + 1, uploadContext || isUpload);
      visitUploads(metadata?.workspacePath, depth + 1, uploadContext || isUpload);
      visitUploads(payload?.metadata, depth + 1, uploadContext || isUpload);
    }
  };
  visitUploads(request.references, 0);
  visitUploads(request.artifacts, 0);
  return [...refs];
}

function extractTableFromLines(lines: string[]): TableInput | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    const delimiter = lines[index]!.includes('\t') ? '\t' : lines[index]!.includes(',') ? ',' : undefined;
    if (!delimiter) continue;
    const header = splitLine(lines[index]!, delimiter);
    if (header.length < 4 || !header.some((cell) => isIdentifierHeader(cell))) continue;
    const rows: ParsedRow[] = [];
    for (const line of lines.slice(index + 1)) {
      if (!line.includes(delimiter)) break;
      const cells = splitLine(line, delimiter);
      if (cells.length < Math.max(3, Math.floor(header.length * 0.6))) break;
      rows.push(Object.fromEntries(header.map((key, cellIndex) => [key, cells[cellIndex] ?? ''])));
    }
    if (rows.length) return { header, rows };
  }
  return undefined;
}

function splitLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    const next = line[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function inferTableSchema(header: string[], rows: ParsedRow[]): TableSchema | undefined {
  const subjectKey = findHeader(header, [/^(subject|sample|participant|patient|record|student|customer|user|unit|case|id)(?:_?id|_?identifier)?$/i, /(?:^|_)(?:subject|sample|participant|patient|record|student|customer|user|unit|case)?_?(?:id|identifier)$/i]);
  const groupKey = findHeader(header, [/^(group|arm|treatment|condition|cohort|class|program|variant|segment)$/i, /group|arm|treatment|condition|cohort|class|program|variant|segment/i]);
  const excluded = [subjectKey, groupKey].filter((value): value is string => Boolean(value));
  const baselineKey = findMeasurementHeader(header, rows, [/baseline.*(value|score|mg|level|measure)?/i, /^(pre|pretest|before|initial|baseline|start|entry)(?:_.*)?$/i], excluded);
  const followupKey = findMeasurementHeader(header, rows, [/week\d+|follow|post|after|endpoint|outcome|final|endline|exit/i], [...excluded, baselineKey].filter((value): value is string => Boolean(value)));
  const outcomeKey = baselineKey && followupKey
    ? undefined
    : findOutcomeHeader(header, rows, excluded);
  if (!subjectKey || !groupKey || !(baselineKey && followupKey) && !outcomeKey) return undefined;
  const groups = uniqueStrings(rows.map((row) => String(row[groupKey] ?? '').trim()).filter(Boolean));
  if (groups.length < 2) return undefined;
  const referenceGroup = groups.find((group) => /^(?:control|placebo|standard|usual|baseline|reference)$/i.test(group)) ?? groups[0]!;
  const comparisonGroup = groups.find((group) => group !== referenceGroup && /treatment|intervention|active|coaching|experimental|case/i.test(group))
    ?? groups.find((group) => group !== referenceGroup)
    ?? groups[0]!;
  const analysisKind: AnalysisKind = baselineKey && followupKey
    ? 'paired-change'
    : outcomeKey && isBinaryOutcomeColumn(rows, outcomeKey)
      ? 'binary-outcome'
      : 'cross-sectional-continuous';
  return {
    analysisKind,
    subjectKey,
    groupKey,
    baselineKey,
    followupKey,
    outcomeKey,
    baselineUnitKey: findHeader(header, [/baseline.*unit/i]),
    followupUnitKey: findHeader(header, [/(week\d+|follow|post|after|endpoint|outcome|final).*unit/i]),
    sharedUnitKey: findHeader(header, [/^unit$/i, /units?/i]),
    siteKey: findHeader(header, [/^(site|center|batch|location)$/i, /site|center|location/i]),
    notesKey: findHeader(header, [/^(note|notes|qc|flag|comment|comments)$/i, /note|qc|flag|comment/i]),
    referenceGroup,
    comparisonGroup,
    unitLabel: analysisKind === 'binary-outcome'
      ? 'probability points'
      : header.some((key) => /unit/i.test(key))
        ? 'normalized analysis units'
        : 'analysis units',
  };
}

function findHeader(header: string[], patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = header.find((key) => pattern.test(key));
    if (match) return match;
  }
  return undefined;
}

function findMeasurementHeader(header: string[], rows: ParsedRow[], patterns: RegExp[], exclude: string[]) {
  const excluded = new Set(exclude.map((key) => key.toLowerCase()));
  const candidates = header.filter((key) => !excluded.has(key.toLowerCase()) && patterns.some((pattern) => pattern.test(key)));
  return candidates.sort((left, right) => numericCellCount(rows, right) - numericCellCount(rows, left))[0];
}

function findOutcomeHeader(header: string[], rows: ParsedRow[], exclude: string[]) {
  const excluded = new Set(exclude.map((key) => key.toLowerCase()));
  const preferred = header.filter((key) => !excluded.has(key.toLowerCase()) && /^(?:outcome|score|value|measure|response|responder|event|success|converted|conversion|passed|pass|remission|endpoint)(?:_.*)?$/i.test(key));
  const candidates = preferred.length ? preferred : header.filter((key) => !excluded.has(key.toLowerCase()) && !/(note|comment|flag|unit|batch|site|center|location|date|time)/i.test(key));
  return candidates
    .map((key) => ({ key, score: numericCellCount(rows, key) + binaryCellCount(rows, key) }))
    .filter((candidate) => candidate.score >= Math.max(4, Math.ceil(rows.length * 0.5)))
    .sort((left, right) => right.score - left.score)[0]?.key;
}

function numericCellCount(rows: ParsedRow[], key: string) {
  return rows.reduce((count, row) => count + (numeric(row[key]) === null ? 0 : 1), 0);
}

function binaryCellCount(rows: ParsedRow[], key: string) {
  return rows.reduce((count, row) => count + (binary(row[key]) === null ? 0 : 1), 0);
}

function isBinaryOutcomeColumn(rows: ParsedRow[], key: string) {
  const values = rows.map((row) => binary(row[key])).filter((value): value is number => value !== null);
  return values.length >= Math.max(4, Math.ceil(rows.length * 0.5)) && new Set(values).size <= 2;
}

function isIdentifierHeader(value: string) {
  return /^(subject|sample|participant|patient|record|student|customer|user|unit|case|id)(?:_?id|_?identifier)?$/i.test(value)
    || /(?:^|_)(?:subject|sample|participant|patient|record|student|customer|user|unit|case)?_?(?:id|identifier)$/i.test(value);
}

function cleanRows(rows: ParsedRow[], schema: TableSchema): CleanRow[] {
  const latestBySubject = new Map<string, number>();
  rows.forEach((row, index) => latestBySubject.set(String(row[schema.subjectKey] || index), index));
  const preliminary = rows.map((row, index) => {
    const baselineUnit = schema.baselineUnitKey ? row[schema.baselineUnitKey] : schema.sharedUnitKey ? row[schema.sharedUnitKey] : undefined;
    const followupUnit = schema.followupUnitKey ? row[schema.followupUnitKey] : schema.sharedUnitKey ? row[schema.sharedUnitKey] : undefined;
    const baseline = schema.baselineKey ? normalizeUnit(numeric(row[schema.baselineKey]), baselineUnit) : null;
    const followup = schema.followupKey ? normalizeUnit(numeric(row[schema.followupKey]), followupUnit) : null;
    const outcome = schema.outcomeKey ? normalizeUnit(numeric(row[schema.outcomeKey]), schema.sharedUnitKey ? row[schema.sharedUnitKey] : undefined) : null;
    const event = schema.outcomeKey ? binary(row[schema.outcomeKey]) : null;
    const change = schema.analysisKind === 'paired-change'
      ? baseline === null || followup === null ? null : followup - baseline
      : schema.analysisKind === 'binary-outcome'
        ? event
        : outcome;
    const subject = String(row[schema.subjectKey] || index);
    const notes = schema.notesKey ? String(row[schema.notesKey] ?? '') : '';
    const flags = [
      schema.analysisKind === 'paired-change' && baseline === null ? 'invalid_or_missing_baseline' : undefined,
      schema.analysisKind === 'paired-change' && followup === null ? 'invalid_or_missing_followup' : undefined,
      schema.analysisKind === 'cross-sectional-continuous' && outcome === null ? 'invalid_or_missing_outcome' : undefined,
      schema.analysisKind === 'binary-outcome' && event === null ? 'invalid_or_missing_event' : undefined,
      latestBySubject.get(subject) !== index ? 'superseded_duplicate_subject' : undefined,
      /ug\/l/i.test(String(baselineUnit ?? followupUnit ?? '')) ? 'unit_converted_ug_l_to_mg_l' : undefined,
      /outlier|lab error|assay failure|异常/i.test(notes) ? 'note_flagged_outlier' : undefined,
    ].filter((flag): flag is string => Boolean(flag));
    return { ...row, baseline_value: baseline, followup_value: followup, outcome_value: outcome, event_value: event, change_value: change, qc_flags: flags, analysis_included: false };
  });
  const analysisValues = preliminary.map((row) => analysisValue(row)).filter((value): value is number => Number.isFinite(value));
  const [low, high] = schema.analysisKind === 'binary-outcome' ? [-Infinity, Infinity] : iqrFence(analysisValues);
  return preliminary.map((row) => {
    const value = analysisValue(row);
    const statisticalOutlier = value !== null && (value < low || value > high);
    const outlierFlag = schema.analysisKind === 'paired-change' ? 'iqr_change_outlier' : 'iqr_outcome_outlier';
    const qc_flags = statisticalOutlier ? [...row.qc_flags, outlierFlag] : row.qc_flags;
    const analysis_included = value !== null
      && !qc_flags.includes('superseded_duplicate_subject')
      && !qc_flags.includes('note_flagged_outlier')
      && !qc_flags.includes('iqr_change_outlier')
      && !qc_flags.includes('iqr_outcome_outlier');
    return { ...row, qc_flags, analysis_included };
  });
}

function summarizeAnalysis(cleaned: CleanRow[], included: CleanRow[], schema: TableSchema) {
  const responseKey = schema.analysisKind === 'paired-change' ? 'change_value' : schema.analysisKind === 'binary-outcome' ? 'event_value' : 'outcome_value';
  const measureLabel = schema.analysisKind === 'paired-change' ? 'mean change' : schema.analysisKind === 'binary-outcome' ? 'event rate' : 'mean outcome';
  const groups = uniqueStrings(cleaned.map((row) => String(row[schema.groupKey] ?? '').trim()).filter(Boolean));
  const groupSummaries = groups.map((group) => {
    const groupRows = included.filter((row) => String(row[schema.groupKey] || '').toLowerCase() === group.toLowerCase());
    const values = groupRows.map((row) => analysisValue(row)).filter((value): value is number => value !== null);
    return { group, n: values.length, meanChange: mean(values), medianChange: quantile(values, 0.5), measureLabel };
  });
  const primaryRows = included.map((row) => ({
    y: analysisValue(row) ?? 0,
    group: String(row[schema.groupKey] || '').toLowerCase() === schema.comparisonGroup.toLowerCase() ? 1 : 0,
    baseline: row.baseline_value ?? 0,
    site: schema.siteKey ? String(row[schema.siteKey] || 'unknown') : 'unknown',
  }));
  const sites = [...new Set(primaryRows.map((row) => row.site))].sort();
  const usesBaselineCovariate = schema.analysisKind === 'paired-change';
  const x = primaryRows.map((row) => [1, row.group, ...(usesBaselineCovariate ? [row.baseline] : []), ...sites.slice(1).map((site) => row.site === site ? 1 : 0)]);
  const modelFit = fitOls(x, primaryRows.map((row) => row.y));
  const beta = modelFit.beta;
  const includeFlaggedOutliers = groupDelta(cleaned.filter((row) => analysisValue(row) !== null && !row.qc_flags.includes('superseded_duplicate_subject')), schema);
  const keepFirstDuplicate = groupDelta(cleaned.filter((row) => analysisValue(row) !== null && !row.qc_flags.includes('note_flagged_outlier') && !row.qc_flags.includes('iqr_change_outlier') && !row.qc_flags.includes('iqr_outcome_outlier')).filter(firstDuplicatePredicate(schema)), schema);
  const comparisonLabel = `${schema.comparisonGroup} vs ${schema.referenceGroup}`;
  const formula = `${responseKey} ~ ${safeCoefficientName(schema.comparisonGroup)}${usesBaselineCovariate ? ' + baseline_value' : ''}${sites.length > 1 ? ' + site' : ''}`;
  const groupCounts = Object.fromEntries(groupSummaries.map((group) => [group.group, group.n]));
  const nonZeroGroupCounts = groupSummaries.map((group) => group.n).filter((count) => count > 0);
  const maxGroupN = nonZeroGroupCounts.length ? Math.max(...nonZeroGroupCounts) : 0;
  const minGroupN = nonZeroGroupCounts.length ? Math.min(...nonZeroGroupCounts) : 0;
  const groupCoefficient = coefficientDiagnostic(modelFit, 1);
  return {
    generatedAt: new Date().toISOString(),
    analysisKind: schema.analysisKind,
    responseKey,
    measureLabel,
    rowCount: cleaned.length,
    includedCount: included.length,
    unitLabel: schema.unitLabel,
    qcSummary: qcSummary(cleaned),
    groupSummaries,
    primaryModel: {
      formula,
      comparisonGroup: schema.comparisonGroup,
      referenceGroup: schema.referenceGroup,
      comparisonLabel,
      coefficients: Object.fromEntries(['intercept', safeCoefficientName(schema.comparisonGroup), ...(usesBaselineCovariate ? ['baseline_value'] : []), ...sites.slice(1).map((site) => `site_${site}`)].map((name, index) => [name, round(beta[index] ?? 0)])),
      primaryGroupCoefficient: beta[1] ?? 0,
      groupTreatmentCoefficient: beta[1] ?? 0,
      covariates: [...(usesBaselineCovariate ? ['baseline_value'] : []), ...sites.slice(1).map((site) => `site_${site}`)],
      diagnostics: {
        coefficientStandardError: groupCoefficient.standardError,
        confidenceInterval95: groupCoefficient.confidenceInterval95,
        tStatistic: groupCoefficient.tStatistic,
        pValueApprox: groupCoefficient.pValueApprox,
        residualDf: modelFit.residualDf,
        residualStandardError: modelFit.residualStandardError,
        inferenceNote: 'Approximate large-sample diagnostics for a small-sample descriptive OLS model; treat p values and confidence intervals as screening evidence, not confirmatory inference.',
      },
    },
    designDiagnostics: {
      groupCounts,
      imbalanceRatio: minGroupN > 0 ? round(maxGroupN / minGroupN) : 0,
      fixedEffectField: schema.siteKey,
      fixedEffectLevels: sites,
      adjustedForFixedEffects: sites.length > 1,
    },
    sensitivity: {
      includeFlaggedOutliersPrimaryDelta: includeFlaggedOutliers,
      keepFirstDuplicatePrimaryDelta: keepFirstDuplicate,
      includeFlaggedOutliersTreatmentDelta: includeFlaggedOutliers,
      keepFirstDuplicateTreatmentDelta: keepFirstDuplicate,
    },
    limitations: [
      'Small sample size; coefficients, confidence intervals, and p values are descriptive screening diagnostics and should not be treated as confirmatory inference.',
      schema.analysisKind === 'binary-outcome' ? 'Binary outcomes use a linear probability risk-difference model for reproducibility and transparency; logistic or exact methods may be preferable for confirmatory analysis.' : undefined,
      'Detected site/center/location is adjusted as fixed indicators when present; additional batch-like fields are summarized in QC but not automatically added to avoid overfitting tiny tables.',
      'Outlier handling is rule-based and should be reviewed against domain provenance.',
    ].filter((item): item is string => Boolean(item)),
  };
}

function numeric(value: unknown): number | null {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function binary(value: unknown): number | null {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (/^(1|true|yes|y|success|succeeded|pass|passed|response|responder|event|converted|conversion|remission)$/i.test(text)) return 1;
  if (/^(0|false|no|n|failure|failed|fail|nonresponse|non-responder|nonevent|not converted|no conversion|no remission)$/i.test(text)) return 0;
  const parsed = numeric(text);
  if (parsed === 0 || parsed === 1) return parsed;
  return null;
}

function normalizeUnit(value: number | null, unit: unknown) {
  if (value === null) return null;
  return /ug\/l/i.test(String(unit ?? '')) ? value / 1000 : value;
}

function iqrFence(values: number[]) {
  if (values.length < 4) return [-Infinity, Infinity];
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  return [q1 - 1.5 * iqr, q3 + 1.5 * iqr];
}

function groupDelta(rows: CleanRow[], schema: TableSchema) {
  const comparison = rows.filter((row) => String(row[schema.groupKey] || '').toLowerCase() === schema.comparisonGroup.toLowerCase()).map((row) => analysisValue(row)).filter((value): value is number => value !== null);
  const reference = rows.filter((row) => String(row[schema.groupKey] || '').toLowerCase() === schema.referenceGroup.toLowerCase()).map((row) => analysisValue(row)).filter((value): value is number => value !== null);
  return mean(comparison) - mean(reference);
}

function analysisValue(row: CleanRow) {
  return row.change_value ?? row.outcome_value ?? row.event_value ?? null;
}

function firstDuplicatePredicate(schema: TableSchema) {
  const seen = new Set<string>();
  return (row: CleanRow) => {
    const subject = String(row[schema.subjectKey] || '');
    if (!subject || seen.has(subject)) return false;
    seen.add(subject);
    return true;
  };
}

function safeCoefficientName(value: string) {
  return value.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'comparison_group';
}

function qcSummary(rows: CleanRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) for (const flag of row.qc_flags) counts.set(flag, (counts.get(flag) ?? 0) + 1);
  return [
    `${rows.length} input rows`,
    `${rows.filter((row) => row.analysis_included).length} rows included in primary model`,
    ...[...counts.entries()].map(([flag, count]) => `${count} ${flag}`),
  ];
}

function fitOls(x: number[][], y: number[]) {
  if (!x.length || !x[0]?.length) {
    return { beta: [], residualDf: 0, residualStandardError: 0, covariance: [] as number[][], standardErrors: [] as number[], tStatistics: [] as number[], pValuesApprox: [] as number[] };
  }
  const xt = transpose(x);
  const xtx = multiply(xt, x);
  const xty = multiplyVector(xt, y);
  const beta = solve(xtx, xty);
  const fitted = x.map((row) => row.reduce((sum, value, index) => sum + value * (beta[index] ?? 0), 0));
  const residuals = y.map((value, index) => value - (fitted[index] ?? 0));
  const residualDf = Math.max(0, y.length - (x[0]?.length ?? 0));
  const rss = residuals.reduce((sum, value) => sum + value * value, 0);
  const sigmaSquared = residualDf > 0 ? rss / residualDf : 0;
  const inverse = invert(xtx);
  const covariance = inverse.map((row) => row.map((value) => value * sigmaSquared));
  const standardErrors = covariance.map((row, index) => Math.sqrt(Math.max(0, row[index] ?? 0)));
  const tStatistics = beta.map((value, index) => standardErrors[index] ? value / standardErrors[index]! : 0);
  const pValuesApprox = tStatistics.map((value) => twoSidedNormalPValue(value));
  return { beta, residualDf, residualStandardError: Math.sqrt(Math.max(0, sigmaSquared)), covariance, standardErrors, tStatistics, pValuesApprox };
}

function coefficientDiagnostic(model: ReturnType<typeof fitOls>, index: number) {
  const estimate = model.beta[index] ?? 0;
  const standardError = model.standardErrors[index] ?? 0;
  const tStatistic = model.tStatistics[index] ?? 0;
  const pValueApprox = model.pValuesApprox[index] ?? 1;
  return {
    standardError: round(standardError),
    confidenceInterval95: [round(estimate - 1.96 * standardError), round(estimate + 1.96 * standardError)],
    tStatistic: round(tStatistic),
    pValueApprox: roundPValue(pValueApprox),
  };
}

function transpose(matrix: number[][]) {
  return matrix[0]!.map((_, column) => matrix.map((row) => row[column] ?? 0));
}

function multiply(a: number[][], b: number[][]) {
  return a.map((row) => b[0]!.map((_, column) => row.reduce((sum, value, index) => sum + value * (b[index]?.[column] ?? 0), 0)));
}

function multiplyVector(a: number[][], b: number[]) {
  return a.map((row) => row.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0));
}

function solve(a: number[][], b: number[]) {
  const n = b.length;
  const matrix = a.map((row, index) => [...row, b[index] ?? 0]);
  for (let pivot = 0; pivot < n; pivot += 1) {
    let max = pivot;
    for (let row = pivot + 1; row < n; row += 1) if (Math.abs(matrix[row]![pivot] ?? 0) > Math.abs(matrix[max]![pivot] ?? 0)) max = row;
    [matrix[pivot], matrix[max]] = [matrix[max]!, matrix[pivot]!];
    const divisor = matrix[pivot]![pivot] || 1e-9;
    for (let column = pivot; column <= n; column += 1) matrix[pivot]![column] = (matrix[pivot]![column] ?? 0) / divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === pivot) continue;
      const factor = matrix[row]![pivot] ?? 0;
      for (let column = pivot; column <= n; column += 1) matrix[row]![column] = (matrix[row]![column] ?? 0) - factor * (matrix[pivot]![column] ?? 0);
    }
  }
  return matrix.map((row) => row[n] ?? 0);
}

function invert(matrix: number[][]) {
  return matrix.map((_, index) => solve(matrix, matrix.map((__, rowIndex) => rowIndex === index ? 1 : 0)));
}

function twoSidedNormalPValue(tStatistic: number) {
  const z = Math.abs(tStatistic);
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(z))));
}

function normalCdf(value: number) {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function erf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function quantile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[index]!;
}

function buildReport(input: { stats: ReturnType<typeof summarizeAnalysis>; rel: Record<string, string>; rowCount: number; includedCount: number }) {
  const unitStep = input.stats.unitLabel === 'normalized analysis units'
    ? '- Normalized explicit unit columns when present, including ug/L to mg/L conversions for concentration-style inputs.'
    : '- Retained numeric analysis values in their source scale because no explicit unit columns were detected.';
  const rerunOutput = `${dirname(input.rel.raw)}/rerun-output.json`;
  const modelDiagnostics = input.stats.primaryModel.diagnostics;
  const design = input.stats.designDiagnostics;
  return [
    '# Reproducible Tabular Analysis',
    '',
    '## QC',
    ...input.stats.qcSummary.map((item) => `- ${item}`),
    '',
    '## Cleaning Strategy',
    unitStep,
    '- Parsed invalid numeric cells as missing.',
    '- Kept the latest duplicate subject/sample/participant row for the primary analysis.',
    '- Excluded note-flagged and IQR analysis-value outliers from the primary model; sensitivity checks keep them.',
    '',
    '## Statistical Model',
    `Primary model: \`${input.stats.primaryModel.formula}\`. ${input.stats.primaryModel.comparisonLabel} coefficient: ${round(input.stats.primaryModel.primaryGroupCoefficient)} ${input.stats.unitLabel}.`,
    `Approximate 95% CI for the primary coefficient: [${modelDiagnostics.confidenceInterval95.map((value) => `${value}`).join(', ')}] ${input.stats.unitLabel}; approximate p=${formatPValue(modelDiagnostics.pValueApprox)}.`,
    `Residual df=${modelDiagnostics.residualDf}; residual standard error=${round(modelDiagnostics.residualStandardError)} ${input.stats.unitLabel}.`,
    '',
    '## Group Summary',
    ...input.stats.groupSummaries.map((group) => `- ${group.group}: n=${group.n}, ${input.stats.measureLabel}=${round(group.meanChange)} ${input.stats.unitLabel}, median=${round(group.medianChange)} ${input.stats.unitLabel}`),
    '',
    '## Design Diagnostics',
    `- Group counts in the primary model: ${Object.entries(design.groupCounts).map(([group, count]) => `${group}=${count}`).join(', ') || 'none'}.`,
    `- Group imbalance ratio (largest/smallest non-empty group): ${round(design.imbalanceRatio)}.`,
    `- Fixed-effect adjustment: ${design.adjustedForFixedEffects ? `included ${design.fixedEffectField} indicators for ${design.fixedEffectLevels.join(', ')}` : 'not used because only one site/center/batch/location level was detected'}.`,
    '',
    '## Sensitivity / Robustness',
    `- Including flagged outliers: ${input.stats.primaryModel.comparisonLabel} ${input.stats.measureLabel} delta=${round(input.stats.sensitivity.includeFlaggedOutliersPrimaryDelta)} ${input.stats.unitLabel}.`,
    `- Keeping first duplicate instead of latest correction: ${input.stats.primaryModel.comparisonLabel} ${input.stats.measureLabel} delta=${round(input.stats.sensitivity.keepFirstDuplicatePrimaryDelta)} ${input.stats.unitLabel}.`,
    '',
    '## Rerun Command',
    `\`python ${input.rel.script} ${input.rel.raw} ${rerunOutput}\``,
    '',
    '## Artifacts',
    `- Cleaned data: \`${input.rel.cleaned}\``,
    `- Primary effect chart: \`${input.rel.chart}\``,
    `- QC inclusion chart: \`${input.rel.qcChart}\``,
    `- Results JSON: \`${input.rel.results}\``,
    `- Rerun script: \`${input.rel.script}\``,
    '',
    '## Limitations',
    ...input.stats.limitations.map((item) => `- ${item}`),
    '',
  ].join('\n');
}

function buildSvgChart(groups: Array<{ group: string; meanChange: number }>, unitLabel: string, measureLabel = 'mean change') {
  const maxAbs = Math.max(1, ...groups.map((group) => Math.abs(group.meanChange)));
  const axisX = 300;
  const maxWidth = 210;
  const bars = groups.map((group, index) => {
    const width = Math.max(1, (Math.abs(group.meanChange) / maxAbs) * maxWidth);
    const x = group.meanChange < 0 ? axisX - width : axisX;
    const fill = index === 0 ? '#14b8a6' : index === 1 ? '#64748b' : '#a855f7';
    const valueLabel = `${round(group.meanChange)} ${unitLabel}`;
    const labelX = group.meanChange < 0 ? Math.max(8, x - 8) : Math.min(628, x + width + 8);
    const anchor = group.meanChange < 0 ? 'end' : labelX > 560 ? 'end' : 'start';
    return `<g><text x="20" y="${70 + index * 70}" font-size="14">${escapeXml(truncateLabel(group.group, 26))}</text><rect x="${round(x)}" y="${50 + index * 70}" width="${round(width)}" height="28" fill="${fill}"/><text x="${round(labelX)}" y="${70 + index * 70}" font-size="13" text-anchor="${anchor}">${escapeXml(valueLabel)}</text></g>`;
  }).join('');
  const height = Math.max(220, 80 + groups.length * 70);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${height}" viewBox="0 0 640 ${height}"><rect width="640" height="${height}" fill="#0f172a"/><text x="20" y="30" fill="#e2e8f0" font-size="18">${escapeXml(titleCase(measureLabel))} by group</text><line x1="${axisX}" y1="45" x2="${axisX}" y2="${height - 40}" stroke="#e2e8f0" stroke-width="1"/><g fill="#e2e8f0">${bars}</g></svg>`;
}

function buildQcSvgChart(rows: CleanRow[]) {
  const included = rows.filter((row) => row.analysis_included).length;
  const excluded = rows.length - included;
  const flagCounts = new Map<string, number>();
  for (const row of rows) {
    for (const flag of row.qc_flags) flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
  }
  const bars = [
    { label: 'included in primary model', count: included, fill: '#14b8a6' },
    { label: 'excluded from primary model', count: excluded, fill: '#f97316' },
    ...[...flagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([flag, count], index) => ({
      label: flag.replaceAll('_', ' '),
      count,
      fill: ['#64748b', '#a855f7', '#0ea5e9', '#eab308', '#ec4899', '#22c55e'][index] ?? '#64748b',
    })),
  ];
  const maxCount = Math.max(1, ...bars.map((bar) => bar.count));
  const height = Math.max(240, 80 + bars.length * 46);
  const body = bars.map((bar, index) => {
    const y = 58 + index * 46;
    const width = Math.max(1, (bar.count / maxCount) * 300);
    return `<g><text x="20" y="${y + 18}" font-size="13">${escapeXml(truncateLabel(bar.label, 34))}</text><rect x="280" y="${y}" width="${round(width)}" height="24" fill="${bar.fill}"/><text x="${round(288 + width)}" y="${y + 18}" font-size="13">${bar.count}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${height}" viewBox="0 0 640 ${height}"><rect width="640" height="${height}" fill="#0f172a"/><text x="20" y="30" fill="#e2e8f0" font-size="18">QC inclusion summary</text><g fill="#e2e8f0">${body}</g></svg>`;
}

function buildRerunScript() {
  return [
    'import csv, json, math, os, re, sys',
    'input_path = sys.argv[1]',
    'output_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(input_path) or ".", "rerun-output.json")',
    'with open(input_path, newline="", encoding="utf-8") as handle:',
    '    rows = list(csv.DictReader(handle))',
    'header = list(rows[0].keys()) if rows else []',
    'def num(value):',
    '    try: return float(value)',
    '    except Exception: return None',
    'def numeric_count(key):',
    '    return sum(1 for row in rows if num(row.get(key)) is not None)',
    'def binary(value):',
    '    text = str(value or "").strip().lower()',
    '    if text in {"1","true","yes","y","success","succeeded","pass","passed","response","responder","event","converted","conversion","remission"}: return 1.0',
    '    if text in {"0","false","no","n","failure","failed","fail","nonresponse","non-responder","nonevent","not converted","no conversion","no remission"}: return 0.0',
    '    parsed = num(text)',
    '    return parsed if parsed in (0, 1) else None',
    'def binary_count(key):',
    '    return sum(1 for row in rows if binary(row.get(key)) is not None)',
    'def find(patterns):',
    '    for pattern in patterns:',
    '        for key in header:',
    '            if re.search(pattern, key, re.I): return key',
    '    return None',
    'def find_measurement(patterns, exclude=()):',
    '    excluded = {key.lower() for key in exclude if key}',
    '    candidates = [key for key in header if key.lower() not in excluded and any(re.search(pattern, key, re.I) for pattern in patterns)]',
    '    return sorted(candidates, key=numeric_count, reverse=True)[0] if candidates else None',
    'def find_outcome(exclude=()):',
    '    excluded = {key.lower() for key in exclude if key}',
    '    preferred = [key for key in header if key.lower() not in excluded and re.search(r"^(outcome|score|value|measure|response|responder|event|success|converted|conversion|passed|pass|remission|endpoint)(?:_.*)?$", key, re.I)]',
    '    candidates = preferred or [key for key in header if key.lower() not in excluded and not re.search(r"note|comment|flag|unit|batch|site|center|location|date|time", key, re.I)]',
    '    scored = [(numeric_count(key) + binary_count(key), key) for key in candidates]',
    '    scored = [(score, key) for score, key in scored if score >= max(4, math.ceil(len(rows) * 0.5))]',
    '    return sorted(scored, reverse=True)[0][1] if scored else None',
    'subject_key = find([r"^(subject|sample|participant|patient|record|student|customer|user|unit|case|id)(?:_?id|_?identifier)?$", r"(?:^|_)(?:subject|sample|participant|patient|record|student|customer|user|unit|case)?_?(?:id|identifier)$"])',
    'group_key = find([r"^(group|arm|treatment|condition|cohort|class|program|variant|segment)$", r"group|arm|treatment|condition|cohort|class|program|variant|segment"])',
    'baseline_key = find_measurement([r"baseline.*(value|score|mg|level|measure)?", r"^(pre|pretest|before|initial|baseline|start|entry)(?:_.*)?$"], [subject_key, group_key])',
    'followup_key = find_measurement([r"week\\d+|follow|post|after|endpoint|outcome|final|endline|exit"], [subject_key, group_key, baseline_key])',
    'outcome_key = None if baseline_key and followup_key else find_outcome([subject_key, group_key])',
    'baseline_unit_key = find([r"baseline.*unit"])',
    'followup_unit_key = find([r"(week\\d+|follow|post|after|endpoint|outcome|final).*unit"])',
    'shared_unit_key = find([r"^unit$", r"units?"])',
    'site_key = find([r"^(site|center|batch|location)$", r"site|center|location"])',
    'notes_key = find([r"^(note|notes|qc|flag|comment|comments)$", r"note|qc|flag|comment"])',
    'if not (subject_key and group_key and ((baseline_key and followup_key) or outcome_key)):',
    '    raise SystemExit("Input table is missing subject/group plus paired or outcome columns")',
    'binary_values = [binary(row.get(outcome_key)) for row in rows] if outcome_key else []',
    'binary_values = [value for value in binary_values if value is not None]',
    'analysis_kind = "paired-change" if baseline_key and followup_key else "binary-outcome" if outcome_key and len(binary_values) >= max(4, math.ceil(len(rows) * 0.5)) else "cross-sectional-continuous"',
    'response_key = "change_value" if analysis_kind == "paired-change" else "event_value" if analysis_kind == "binary-outcome" else "outcome_value"',
    'groups = []',
    'for row in rows:',
    '    group = str(row.get(group_key, "")).strip()',
    '    if group and group not in groups: groups.append(group)',
    'reference = next((g for g in groups if re.search(r"^(control|placebo|standard|usual|baseline|reference)$", g, re.I)), groups[0] if groups else "")',
    'comparison = next((g for g in groups if g != reference and re.search(r"treatment|intervention|active|coaching|experimental|case", g, re.I)), next((g for g in groups if g != reference), reference))',
    'def conv(value, unit):',
    '    if value is None: return None',
    '    return value / 1000.0 if "ug/l" in str(unit).lower() else value',
    'def mean(values):',
    '    values = [v for v in values if v is not None and math.isfinite(v)]',
    '    return sum(values) / len(values) if values else 0',
    'def quantile(values, q):',
    '    values = sorted([v for v in values if v is not None and math.isfinite(v)])',
    '    if not values: return 0',
    '    return values[min(len(values) - 1, max(0, round(q * (len(values) - 1))))]',
    'clean = []',
    'latest = {}',
    'for idx, row in enumerate(rows):',
    '    latest[str(row.get(subject_key) or idx)] = idx',
    'for idx, row in enumerate(rows):',
    '    baseline_unit = row.get(baseline_unit_key) if baseline_unit_key else row.get(shared_unit_key) if shared_unit_key else None',
    '    followup_unit = row.get(followup_unit_key) if followup_unit_key else row.get(shared_unit_key) if shared_unit_key else None',
    '    baseline = conv(num(row.get(baseline_key)), baseline_unit) if baseline_key else None',
    '    followup = conv(num(row.get(followup_key)), followup_unit) if followup_key else None',
    '    outcome = conv(num(row.get(outcome_key)), row.get(shared_unit_key) if shared_unit_key else None) if outcome_key else None',
    '    event = binary(row.get(outcome_key)) if outcome_key else None',
    '    change = (None if baseline is None or followup is None else followup - baseline) if analysis_kind == "paired-change" else event if analysis_kind == "binary-outcome" else outcome',
    '    subject = str(row.get(subject_key) or idx)',
    '    notes = str(row.get(notes_key, "")) if notes_key else ""',
    '    flags = []',
    '    if analysis_kind == "paired-change" and baseline is None: flags.append("invalid_or_missing_baseline")',
    '    if analysis_kind == "paired-change" and followup is None: flags.append("invalid_or_missing_followup")',
    '    if analysis_kind == "cross-sectional-continuous" and outcome is None: flags.append("invalid_or_missing_outcome")',
    '    if analysis_kind == "binary-outcome" and event is None: flags.append("invalid_or_missing_event")',
    '    if latest.get(subject) != idx: flags.append("superseded_duplicate_subject")',
    '    if "ug/l" in str(baseline_unit).lower() or "ug/l" in str(followup_unit).lower(): flags.append("unit_converted_ug_l_to_mg_l")',
    '    if re.search(r"outlier|lab error|assay failure|异常", notes, re.I): flags.append("note_flagged_outlier")',
    '    clean.append({"group": row.get(group_key), "site": row.get(site_key) if site_key else "unknown", "subject": subject, "baseline_value": baseline, "followup_value": followup, "outcome_value": outcome, "event_value": event, "change_value": change, "qc_flags": flags})',
    'changes = [r["change_value"] for r in clean if r["change_value"] is not None]',
    'q1, q3 = quantile(changes, 0.25), quantile(changes, 0.75)',
    'low, high = (-math.inf, math.inf) if analysis_kind == "binary-outcome" else (q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1))',
    'for row in clean:',
    '    if row["change_value"] is not None and (row["change_value"] < low or row["change_value"] > high): row["qc_flags"].append("iqr_change_outlier" if analysis_kind == "paired-change" else "iqr_outcome_outlier")',
    '    row["analysis_included"] = row["change_value"] is not None and not any(flag in row["qc_flags"] for flag in ["superseded_duplicate_subject", "note_flagged_outlier", "iqr_change_outlier", "iqr_outcome_outlier"])',
    'included = [r for r in clean if r["analysis_included"]]',
    'comparison_changes = [r["change_value"] for r in included if str(r.get("group")).lower() == comparison.lower()]',
    'reference_changes = [r["change_value"] for r in included if str(r.get("group")).lower() == reference.lower()]',
    'sites = sorted(set(str(r.get("site") or "unknown") for r in included))',
    'x = [[1, 1 if str(r.get("group")).lower() == comparison.lower() else 0, *([r["baseline_value"]] if analysis_kind == "paired-change" else []), *[1 if str(r.get("site")) == site else 0 for site in sites[1:]]] for r in included]',
    'y = [r["change_value"] for r in included]',
    'def solve(a, b):',
    '    n = len(b); m = [row[:] + [b[i]] for i, row in enumerate(a)]',
    '    for p in range(n):',
    '        mx = max(range(p, n), key=lambda r: abs(m[r][p]))',
    '        m[p], m[mx] = m[mx], m[p]',
    '        div = m[p][p] or 1e-9',
    '        for c in range(p, n + 1): m[p][c] /= div',
    '        for r in range(n):',
    '            if r == p: continue',
    '            factor = m[r][p]',
    '            for c in range(p, n + 1): m[r][c] -= factor * m[p][c]',
    '    return [row[n] for row in m]',
    'def matmul_t_x(x):',
    '    return [[sum(row[i] * row[j] for row in x) for j in range(len(x[0]))] for i in range(len(x[0]))]',
    'def matmul_t_y(x, y):',
    '    return [sum(row[i] * y[idx] for idx, row in enumerate(x)) for i in range(len(x[0]))]',
    'beta = solve(matmul_t_x(x), matmul_t_y(x, y)) if x else [0, 0]',
    'coef = beta[1] if len(beta) > 1 else 0',
    'def invert(a):',
    '    return [solve(a, [1 if row == col else 0 for row in range(len(a))]) for col in range(len(a))] if a else []',
    'fitted = [sum(row[i] * (beta[i] if i < len(beta) else 0) for i in range(len(row))) for row in x]',
    'residuals = [y[i] - fitted[i] for i in range(len(y))]',
    'residual_df = max(0, len(y) - (len(x[0]) if x else 0))',
    'rss = sum(value * value for value in residuals)',
    'sigma2 = rss / residual_df if residual_df else 0',
    'inv_xtx = invert(matmul_t_x(x)) if x else []',
    'se = math.sqrt(max(0, (inv_xtx[1][1] if len(inv_xtx) > 1 and len(inv_xtx[1]) > 1 else 0) * sigma2))',
    't_stat = coef / se if se else 0',
    'p_approx = max(0, min(1, 2 * (1 - (0.5 * (1 + math.erf(abs(t_stat) / math.sqrt(2)))))))',
    'mean_delta = mean(comparison_changes) - mean(reference_changes)',
    'formula = response_key + " ~ comparison_group" + (" + baseline_value" if analysis_kind == "paired-change" else "") + (" + site" if len(sites) > 1 else "")',
    'result = {"analysisKind": analysis_kind, "responseKey": response_key, "rowCount": len(rows), "includedCount": len(included), "comparisonGroup": comparison, "referenceGroup": reference, "comparisonMean": mean(comparison_changes), "referenceMean": mean(reference_changes), "meanChangeDelta": mean_delta, "primaryDelta": mean_delta, "primaryModel": {"formula": formula, "primaryGroupCoefficient": coef, "groupTreatmentCoefficient": coef, "diagnostics": {"coefficientStandardError": se, "confidenceInterval95": [coef - 1.96 * se, coef + 1.96 * se], "tStatistic": t_stat, "pValueApprox": p_approx, "residualDf": residual_df, "residualStandardError": math.sqrt(max(0, sigma2))}}}',
    'with open(output_path, "w", encoding="utf-8") as handle:',
    '    json.dump(result, handle, indent=2)',
    'print(json.dumps(result))',
    '',
  ].join('\n');
}

async function verifyRerunScript(workspace: string, scriptRel: string, rawRel: string, outputRel: string): Promise<VerificationResult> {
  const id = `local-tabular-rerun-${sha1(`${scriptRel}:${rawRel}:${outputRel}`).slice(0, 12)}`;
  const command = `python ${scriptRel} ${rawRel} ${outputRel}`;
  const candidates = workspaceTaskPythonCommandCandidates(workspace);
  for (const candidate of candidates) {
    try {
      if (candidate.includes('/')) await readFile(candidate);
      await execFileAsync(candidate, [scriptRel, rawRel, outputRel], { cwd: workspace, timeout: 10_000 });
      JSON.parse(await readFile(join(workspace, outputRel), 'utf8'));
      return {
        id,
        verdict: 'pass',
        reward: 1,
        confidence: 0.92,
        critique: 'Rerun script executed against the frozen input CSV and produced parseable JSON output.',
        evidenceRefs: [`file:${scriptRel}`, `file:${rawRel}`, `file:${outputRel}`],
        repairHints: [],
        diagnostics: {
          contractId: 'sciforge.local-tabular-analysis.rerun-verification.v1',
          command,
          checker: TOOL_ID,
          checkedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      // Try the next Python candidate.
      if (candidate === candidates.at(-1)) {
        return {
          id,
          verdict: 'fail',
          reward: 0,
          confidence: 0.88,
          critique: `Rerun script verification failed: ${error instanceof Error ? error.message : String(error)}`,
          evidenceRefs: [`file:${scriptRel}`, `file:${rawRel}`],
          repairHints: ['Inspect the rerun script and rerun it against the frozen input CSV.'],
          diagnostics: {
            contractId: 'sciforge.local-tabular-analysis.rerun-verification.v1',
            command,
            checker: TOOL_ID,
            checkedAt: new Date().toISOString(),
          },
        };
      }
    }
  }
  return {
    id,
    verdict: 'fail',
    reward: 0,
    confidence: 0.88,
    critique: 'Rerun script verification failed: no Python runtime candidate was available.',
    evidenceRefs: [`file:${scriptRel}`, `file:${rawRel}`],
    repairHints: ['Install or configure a Python runtime for workspace task verification.'],
    diagnostics: {
      contractId: 'sciforge.local-tabular-analysis.rerun-verification.v1',
      command,
      checker: TOOL_ID,
      checkedAt: new Date().toISOString(),
    },
  };
}

function collectLocalTabularRoots(value: unknown) {
  const roots: string[] = [];
  const visit = (candidate: unknown, depth: number) => {
    if (depth > 7 || candidate === null || candidate === undefined) return;
    if (typeof candidate === 'string') {
      for (const match of candidate.matchAll(/(?:file:)?(\.sciforge\/local-tabular-analysis\/[a-f0-9]{12})\/(?:analysis-report\.md|results\.json|rerun_analysis\.py|cleaned\.csv|change-by-group\.svg|qc-summary\.svg|input\.csv)/g)) {
        if (match[1]) roots.push(match[1]);
      }
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate.slice(0, 80)) visit(item, depth + 1);
      return;
    }
    if (typeof candidate === 'object') {
      for (const nested of Object.values(candidate as Record<string, unknown>).slice(0, 80)) visit(nested, depth + 1);
    }
  };
  visit(value, 0);
  return uniqueStrings(roots);
}

async function latestLocalTabularRoot(workspace: string) {
  const root = join(workspace, '.sciforge', 'local-tabular-analysis');
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const candidates: Array<{ rel: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{12}$/.test(entry.name)) continue;
    const rel = `.sciforge/local-tabular-analysis/${entry.name}`;
    const reportPath = join(workspace, rel, 'analysis-report.md');
    const resultsPath = join(workspace, rel, 'results.json');
    const [reportStat, resultsStat] = await Promise.all([
      stat(reportPath).catch(() => undefined),
      stat(resultsPath).catch(() => undefined),
    ]);
    if (!reportStat || !resultsStat) continue;
    candidates.push({ rel, mtimeMs: Math.max(reportStat.mtimeMs, resultsStat.mtimeMs) });
  }
  return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.rel;
}

async function newestLocalTabularRoot(workspace: string, roots: string[]) {
  const candidates = await Promise.all(uniqueStrings(roots).map(async (rel) => {
    const mtimeMs = await localTabularRootMtime(workspace, rel);
    return mtimeMs === undefined ? undefined : { rel, mtimeMs };
  }));
  return candidates
    .filter((candidate): candidate is { rel: string; mtimeMs: number } => Boolean(candidate))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.rel;
}

async function localTabularRootMtime(workspace: string, rel: string) {
  if (!/^\.sciforge\/local-tabular-analysis\/[a-f0-9]{12}$/.test(rel)) return undefined;
  const [reportStat, resultsStat, scriptStat] = await Promise.all([
    stat(join(workspace, rel, 'analysis-report.md')).catch(() => undefined),
    stat(join(workspace, rel, 'results.json')).catch(() => undefined),
    stat(join(workspace, rel, 'rerun_analysis.py')).catch(() => undefined),
  ]);
  const mtimes = [reportStat?.mtimeMs, resultsStat?.mtimeMs, scriptStat?.mtimeMs].filter((value): value is number => typeof value === 'number');
  return mtimes.length ? Math.max(...mtimes) : undefined;
}

function sectionFromMarkdown(markdown: string | undefined, heading: string) {
  if (!markdown) return undefined;
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = markdown.match(new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?:\\n## |$)`, 'i'));
  return match?.[1]?.trim();
}

function compactMarkdownBullets(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^- /, ''))
    .filter(Boolean)
    .join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function artifact(id: string, type: string, dataRef: string, metadata: Record<string, unknown>) {
  const extension = dataRef.split('.').pop()?.toLowerCase() || 'txt';
  const role = type === 'research-report'
    ? 'primary-deliverable'
    : type === 'statistical-result'
      ? 'diagnostic'
      : 'supporting-evidence';
  return {
    id,
    type,
    producerScenario: 'data-analysis',
    schemaVersion: '1',
    dataRef,
    path: dataRef,
    metadata,
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: `artifact:${id}`,
      role,
      declaredMediaType: mediaTypeForArtifactExtension(extension),
      declaredExtension: extension,
      contentShape: extension === 'json' ? 'json-envelope' : 'raw-file',
      readableRef: dataRef,
      previewPolicy: role === 'diagnostic' ? 'audit-only' : extension === 'svg' ? 'open-system' : 'inline',
    },
  };
}

function mediaTypeForArtifactExtension(extension: string) {
  if (extension === 'md') return 'text/markdown';
  if (extension === 'csv') return 'text/csv';
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'py') return 'text/x-python';
  if (extension === 'json') return 'application/json';
  return 'text/plain';
}

function objectRef(id: string, kind: string, title: string, ref: string) {
  return { id: `obj-${id}`, kind, title, ref: `file:${ref}`, status: 'available' };
}

function toCsv(header: string[], rows: Array<Record<string, unknown>>) {
  return [header.join(','), ...rows.map((row) => header.map((key) => csvCell(row[key])).join(','))].join('\n') + '\n';
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function round(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0;
}

function roundPValue(value: number) {
  if (!Number.isFinite(value)) return 1;
  if (value > 0 && value < 0.001) return Number(value.toExponential(2));
  return Number(value.toFixed(3));
}

function formatPValue(value: number) {
  return value > 0 && value < 0.001 ? value.toExponential(2) : value.toFixed(3);
}

function escapeXml(value: string) {
  return value.replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char] ?? char);
}

function truncateLabel(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}

function titleCase(value: string) {
  return value.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
