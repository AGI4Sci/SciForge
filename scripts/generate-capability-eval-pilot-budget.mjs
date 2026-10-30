import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const inputPath = path.join(root, 'eval-cases/capability/pilot-runs.json');
const liveIndexPath = path.join(root, 'eval-cases/capability/live-evidence-index.jsonl');
const outputPath = path.join(root, 'eval-cases/capability/pilot-budget-report.json');
const markdownPath = path.join(root, 'docs/generated/capability-eval-pilot-budget.md');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const readJsonl = (filePath) => fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const writeJson = (filePath, value) => fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
const relative = (filePath) => path.relative(root, filePath).split(path.sep).join('/');

const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
};

const finalUsageFromTrace = (tracePath) => {
  if (!fs.existsSync(tracePath)) return null;
  const usage = [];
  for (const line of fs.readFileSync(tracePath, 'utf8').split('\n')) {
    if (!line) continue;
    const record = JSON.parse(line);
    if (record.payload?.eventKind !== 'usage') continue;
    const event = record.payload.event;
    if (event?.usage) usage.push({ sequence: event.sequence ?? 0, usage: event.usage });
  }
  usage.sort((a, b) => a.sequence - b.sequence);
  return usage.at(-1)?.usage ?? null;
};

const traceForRun = (runDirectory) => {
  const traceDirectory = path.join(root, runDirectory, 'traces');
  if (!fs.existsSync(traceDirectory)) return null;
  const traceName = fs.readdirSync(traceDirectory).find((name) => name.endsWith('.jsonl'));
  return traceName ? path.join(traceDirectory, traceName) : null;
};

const loadCandidate = (candidate) => {
  const runDirectory = path.join(root, candidate.runDirectory);
  const reportPath = path.join(runDirectory, 'latest.json');
  if (!fs.existsSync(reportPath)) {
    return { candidate, status: 'unexecuted', reason: 'missing-live-report' };
  }

  const report = readJson(reportPath);
  const tracePath = traceForRun(candidate.runDirectory);
  const usage = finalUsageFromTrace(tracePath);
  const metrics = report.metrics ?? {};
  const outcome = report.inconclusive > 0 ? 'INCONCLUSIVE' : report.passed > 0 ? 'PASS' : 'FAIL';
  return {
    candidate,
    status: 'observed',
    outcome,
    reportPath: relative(reportPath),
    tracePath: tracePath ? relative(tracePath) : null,
    caseCount: report.totalCases ?? null,
    taskLatencyMs: metrics.averageTaskLatencyMs ?? null,
    toolCalls: metrics.averageToolCalls ?? null,
    capabilityToolCalls: metrics.averageCapabilityToolCalls ?? null,
    retryCount: metrics.averageRetryCount ?? null,
    modelUsage: usage
      ? {
          inputTokens: usage.inputTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
          reasoningTokens: usage.reasoningTokens ?? null,
          totalTokens: usage.totalTokens ?? null,
          cacheReadTokens: usage.cacheReadTokens ?? null,
          cacheWriteTokens: usage.cacheWriteTokens ?? null,
          modelContextWindow: usage.modelContextWindow ?? null
        }
      : null
  };
};

const aggregateType = (records) => {
  const observed = records.filter((record) => record.status === 'observed');
  const latencies = observed.map((record) => record.taskLatencyMs).filter(Number.isFinite);
  const tokens = observed.map((record) => record.modelUsage?.totalTokens).filter(Number.isFinite);
  return {
    planned: records.length,
    observed: observed.length,
    passed: observed.filter((record) => record.outcome === 'PASS').length,
    failed: observed.filter((record) => record.outcome === 'FAIL').length,
    inconclusive: observed.filter((record) => record.outcome === 'INCONCLUSIVE').length,
    latencyMs: {
      average: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
      p50: percentile(latencies, 0.5),
      max: latencies.length ? Math.max(...latencies) : null
    },
    totalTokens: tokens.length ? tokens.reduce((sum, value) => sum + value, 0) : null,
    averageTokens: tokens.length ? Math.round(tokens.reduce((sum, value) => sum + value, 0) / tokens.length) : null,
    maxTokens: tokens.length ? Math.max(...tokens) : null,
    usageEvidence: observed.filter((record) => record.modelUsage !== null).length
  };
};

const makeMarkdown = (report) => {
  const lines = [
    '# Capability Evaluation Pilot Budget',
    '',
    '本报告由 `pilot-runs.json` 与已保存的 live raw trace/report 确定性生成。Token 用量取每条 trace 最后一个 usage 事件；不会把缺失 usage 当作 0。',
    '',
    `- 试跑候选: ${report.summary.plannedCandidates}`,
    `- 实际纳入预算的运行: ${report.summary.observedRuns}`,
    `- 预算停止: ${report.budgetStop.triggered ? `是（${report.budgetStop.reason}）` : '否'}`,
    `- 已观察总 token: ${report.summary.observedTotalTokens ?? 'N/A'}`,
    `- 已观察总墙钟时间: ${report.summary.observedWallClockMs ?? 'N/A'} ms`,
    `- 配置: maxRuns=${report.policy.maxRuns}, maxTotalTokens=${report.policy.maxTotalTokens}, maxWallClockMs=${report.policy.maxWallClockMs}, maxRetries=${report.policy.maxRetries}`,
    '',
    '| 类型 | 计划 | 纳入 | 通过 | 失败 | 平均耗时(ms) | P50(ms) | 最大耗时(ms) | 平均 token | 最大 token |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  ];
  for (const [type, stats] of Object.entries(report.byType)) {
    lines.push(`| ${type} | ${stats.planned} | ${stats.observed} | ${stats.passed} | ${stats.failed} | ${stats.latencyMs.average ?? 'N/A'} | ${stats.latencyMs.p50 ?? 'N/A'} | ${stats.latencyMs.max ?? 'N/A'} | ${stats.averageTokens ?? 'N/A'} | ${stats.maxTokens ?? 'N/A'} |`);
  }
  lines.push('', '## 未执行项', '');
  for (const item of report.unexecutedItems) {
    lines.push(`- ${item.kind}: \`${item.id}\` — ${item.reason}`);
  }
  const denominator = readJson(path.join(root, 'eval-cases/capability/full-execution-plan.json')).denominator.agentVisibleActions
  lines.push('', '## 解释', '', `- 试跑只用于校准耗时、模型用量和预算，不改变 ${denominator} action 分母。`, '- live 失败仍保留为失败样本；预算未纳入的项不是通过，也不是失败，而是明确的未执行。', '- 全量 action 的 live/replay 结果以 `live-evidence-index.jsonl` 和 `full-execution-plan.json` 为准。', '');
  return `${lines.join('\n')}\n`;
};

const generate = () => {
  const config = readJson(inputPath);
  const liveIndex = readJsonl(liveIndexPath);
  const policy = config.policy;
  const selected = [];
  const unexecutedItems = [];
  let usedTokens = 0;
  let usedWallClockMs = 0;
  let budgetStop = null;

  for (const candidate of config.candidates) {
    const loaded = loadCandidate(candidate);
    const candidateTokens = loaded.modelUsage?.totalTokens ?? null;
    const candidateWallClockMs = loaded.taskLatencyMs ?? null;
    if (budgetStop) {
      unexecutedItems.push({ kind: 'pilot-candidate', id: candidate.id, reason: `budget-stopped:${budgetStop.reason}` });
      continue;
    }
    if (selected.length >= policy.maxRuns) {
      budgetStop = { triggered: true, reason: 'maxRuns', candidateId: candidate.id };
      unexecutedItems.push({ kind: 'pilot-candidate', id: candidate.id, reason: 'budget-stopped:maxRuns' });
      continue;
    }
    if (candidateTokens !== null && usedTokens + candidateTokens > policy.maxTotalTokens) {
      budgetStop = { triggered: true, reason: 'maxTotalTokens', candidateId: candidate.id, usedTokens, candidateTokens };
      unexecutedItems.push({ kind: 'pilot-candidate', id: candidate.id, reason: 'budget-stopped:maxTotalTokens' });
      continue;
    }
    if (candidateWallClockMs !== null && usedWallClockMs + candidateWallClockMs > policy.maxWallClockMs) {
      budgetStop = { triggered: true, reason: 'maxWallClockMs', candidateId: candidate.id, usedWallClockMs, candidateWallClockMs };
      unexecutedItems.push({ kind: 'pilot-candidate', id: candidate.id, reason: 'budget-stopped:maxWallClockMs' });
      continue;
    }
    selected.push(loaded);
    if (candidateTokens !== null) usedTokens += candidateTokens;
    if (candidateWallClockMs !== null) usedWallClockMs += candidateWallClockMs;
  }

  const byType = {};
  for (const candidate of config.candidates) {
    byType[candidate.type] ??= [];
    const selectedRecord = selected.find((record) => record.candidate.id === candidate.id);
    byType[candidate.type].push(selectedRecord ?? { candidate, status: 'unexecuted' });
  }
  const typeSummary = Object.fromEntries(Object.entries(byType).map(([type, records]) => [type, aggregateType(records)]));

  for (const entry of liveIndex) {
    if (entry.status === 'no-live-evidence') {
      unexecutedItems.push({ kind: 'action-anchor', id: entry.actionId, reason: 'no-live-evidence-in-current-index' });
    }
  }

  const report = {
    schemaVersion: 'sciforge.capability-eval.pilot-budget-report.v1',
    generatedAt: 'generated',
    policy,
    source: {
      pilotConfig: relative(inputPath),
      liveEvidenceIndex: relative(liveIndexPath),
      candidateReports: selected.map((record) => record.reportPath).filter(Boolean),
      candidateTraces: selected.map((record) => record.tracePath).filter(Boolean)
    },
    summary: {
      plannedCandidates: config.candidates.length,
      observedRuns: selected.length,
      observedPasses: selected.filter((record) => record.outcome === 'PASS').length,
      observedFailures: selected.filter((record) => record.outcome === 'FAIL').length,
      observedInconclusive: selected.filter((record) => record.outcome === 'INCONCLUSIVE').length,
      observedTotalTokens: selected.reduce((sum, record) => sum + (record.modelUsage?.totalTokens ?? 0), 0) || null,
      observedWallClockMs: selected.reduce((sum, record) => sum + (record.taskLatencyMs ?? 0), 0) || null,
      actionAnchorsWithoutLiveEvidence: liveIndex.filter((entry) => entry.status === 'no-live-evidence').length
    },
    budgetStop: budgetStop ?? { triggered: false },
    byType: typeSummary,
    runs: selected,
    unexecutedItems
  };

  return { report, markdown: makeMarkdown(report) };
};

const check = process.argv.includes('--check');
const { report, markdown } = generate();
if (check) {
  const currentReport = readJson(outputPath);
  const currentMarkdown = fs.readFileSync(markdownPath, 'utf8');
  if (JSON.stringify(currentReport) !== JSON.stringify(report) || currentMarkdown !== markdown) {
    console.error('Capability pilot budget artifacts are stale. Run npm run capability:eval:pilot-budget.');
    process.exit(1);
  }
  console.log('Capability pilot budget artifacts are fresh.');
} else {
  writeJson(outputPath, report);
  fs.writeFileSync(markdownPath, markdown);
  console.log(`Generated capability pilot budget report: ${report.summary.observedRuns}/${report.summary.plannedCandidates} candidates observed; budget stop=${report.budgetStop.triggered ? report.budgetStop.reason : 'none'}.`);
}
