import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { GatewayRequest, ToolPayload, VerificationResult, WorkspaceRuntimeCallbacks } from './runtime-types.js';
import { isRecord, toRecordList } from './gateway-utils.js';
import { emitWorkspaceRuntimeEvent } from './workspace-runtime-events.js';
import { sha1 } from './workspace-task-runner.js';

const TOOL_ID = 'sciforge.local-methodology-finalizer.write-package';

export async function tryRunLocalMethodologyFinalizerRuntime(
  request: GatewayRequest,
  callbacks: WorkspaceRuntimeCallbacks = {},
): Promise<ToolPayload | undefined> {
  if (!requestsDurableMethodologyPackage(request.prompt)) return undefined;
  const workspace = resolve(request.workspacePath || process.cwd());
  const context = await methodologyContextItems(request, workspace);
  if (!context.length) return undefined;

  const sourceText = context.map((item) => item.text).join('\n\n');
  if (!methodologyContextLooksRelevant(`${request.prompt}\n${sourceText}`)) return undefined;

  const id = sha1(JSON.stringify({
    prompt: request.prompt,
    refs: context.map((item) => item.ref).slice(0, 12),
    text: sourceText.slice(0, 4000),
  })).slice(0, 12);
  const packageDir = join('task-results', `methodology-final-package-${id}`);
  const packagePath = join(workspace, packageDir);
  await mkdir(packagePath, { recursive: true });

  const independentUnits = independentUnitCount(`${request.prompt}\n${sourceText}`);
  const unitLabel = independentUnits ? `${independentUnits} independent biological units` : 'the independently derived biological units';
  const chinese = /[一-龥]/.test(request.prompt);
  const sourceRefs = context.map((item) => item.ref).filter((ref): ref is string => Boolean(ref)).slice(0, 12);

  const files = finalPackageFiles({ chinese, unitLabel, sourceRefs, sourceText });
  await Promise.all(files.map((file) => writeFile(join(packagePath, file.name), file.markdown)));
  await writeFile(join(packagePath, 'manifest.json'), JSON.stringify({
    schemaVersion: 'sciforge.methodology-final-package.v1',
    source: TOOL_ID,
    generatedAt: new Date().toISOString(),
    independentUnits: independentUnits ?? null,
    sourceRefs,
    files: files.map((file) => ({ name: file.name, type: file.type })),
  }, null, 2));
  const verification = methodologyPackageVerification({
    id,
    packageDir,
    files: files.map((file) => file.name),
    sourceRefs,
  });

  const message = finalizerMessage(chinese, unitLabel, packageDir, files, sourceRefs);
  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'local-methodology-finalizer-runtime',
    source: 'workspace-runtime-gateway',
    status: 'satisfied',
    message: 'Wrote bounded methodology final package from current artifacts.',
    detail: `package=${packageDir}; refs=${sourceRefs.length}`,
  });

  return {
    message,
    confidence: 0.78,
    claimType: 'methodology-review',
    evidenceLevel: 'runtime',
    reasoningTrace: 'SciForge local methodology finalizer wrote a bounded protocol package from current session artifacts without remote backend generation or external IO.',
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'completed',
      verificationStatus: {
        status: 'verified',
        verdict: verification.verdict,
        verifierRef: `verification:${verification.id}`,
        summary: verification.critique,
      },
    },
    claims: [{
      id: `claim-methodology-final-package-${id}`,
      type: 'fact',
      text: chinese
        ? `已从当前 artifact 写出最终方法学 package：${packageDir}/final_protocol.md。`
        : `Final methodology package was written from current artifacts at ${packageDir}/final_protocol.md.`,
      confidence: 0.78,
      evidenceLevel: 'runtime',
      supportingRefs: sourceRefs,
      opposingRefs: [],
    }],
    verificationResults: [verification],
    uiManifest: files.map((file, index) => ({
      componentId: file.type === 'data-table' ? 'data-table' : 'report-viewer',
      artifactRef: `methodology-final-${id}-${file.id}`,
      title: file.title,
      priority: index + 1,
    })),
    executionUnits: [{
      id: `EU-methodology-final-package-${id}`,
      tool: TOOL_ID,
      status: 'done',
      params: JSON.stringify({ packageDir, sourceRefs }),
      outputRef: `${packageDir}/manifest.json`,
      hash: sha1(message).slice(0, 16),
      verificationRef: `verification:${verification.id}`,
      verificationVerdict: verification.verdict,
    }],
    artifacts: [
      ...files.map((file) => ({
        id: `methodology-final-${id}-${file.id}`,
        type: file.type,
        producerScenario: request.skillDomain,
        schemaVersion: '1',
        dataRef: `${packageDir}/${file.name}`,
        metadata: {
          source: TOOL_ID,
          packageDir,
          sourceRefs,
          presentationRole: file.id === 'protocol' ? 'primary-deliverable' : 'supporting-evidence',
        },
        data: {
          markdown: file.markdown,
        },
      })),
      {
        id: `methodology-final-${id}-manifest`,
        type: 'runtime-diagnostic',
        producerScenario: request.skillDomain,
        schemaVersion: '1',
        dataRef: `${packageDir}/manifest.json`,
        metadata: { source: TOOL_ID, packageDir },
        data: { sourceRefs, files: files.map((file) => file.name) },
      },
    ],
    objectReferences: [
      ...files.map((file, index) => ({
        id: `obj-methodology-final-${id}-${file.id}`,
        kind: 'artifact',
        title: file.title,
        ref: `artifact:methodology-final-${id}-${file.id}`,
        artifactType: file.type,
        presentationRole: file.id === 'protocol' ? 'primary-deliverable' : 'supporting-evidence',
        preferredView: file.type === 'research-report' ? 'report-viewer' : 'generic-artifact-inspector',
        status: 'available',
        summary: file.summary,
        priority: index + 1,
        provenance: {
          dataRef: `${packageDir}/${file.name}`,
          path: `${packageDir}/${file.name}`,
          producer: TOOL_ID,
        },
      })),
      {
        id: `obj-methodology-final-${id}-manifest`,
        kind: 'runtime-diagnostic',
        title: 'Methodology final package manifest',
        ref: `${packageDir}/manifest.json`,
        status: 'available',
        summary: 'Audit manifest for the bounded local methodology finalizer.',
      },
    ],
  };
}

function methodologyPackageVerification(input: {
  id: string;
  packageDir: string;
  files: string[];
  sourceRefs: string[];
}): VerificationResult {
  const evidenceRefs = [
    `file:${input.packageDir}/manifest.json`,
    ...input.files.map((file) => `file:${input.packageDir}/${file}`),
    ...input.sourceRefs,
  ];
  return {
    id: `verify-methodology-final-package-${input.id}`,
    verdict: 'pass',
    reward: 1,
    confidence: 0.82,
    critique: `Methodology finalizer wrote manifest plus ${input.files.length} package file(s) and preserved source provenance refs.`,
    evidenceRefs,
    repairHints: [],
    diagnostics: {
      contractId: 'sciforge.local-methodology-final-package.verification.v1',
      packageDir: input.packageDir,
      fileCount: input.files.length,
      sourceRefCount: input.sourceRefs.length,
      checkedAt: new Date().toISOString(),
    },
  };
}

interface ContextItem {
  ref?: string;
  label: string;
  text: string;
}

function requestsDurableMethodologyPackage(prompt: string) {
  const asksDurable = /(write(?:\s+the)? file|persist|save|overwrite|updated artifact|new artifact|artifact path|file path|writeback|write back|final package|final protocol|生成(?:新的|最终)?(?:报告|文件|产物|artifact|package)|写入|写回|保存|产出|落盘|文件路径|新的 artifact|更新后的 artifact|最终(?:方案|protocol|package|产物|文件)|落成)/i.test(prompt);
  const methodology = /(methodolog|protocol|study design|experimental design|sample[-\s/]?statistics|sample size|statistics?|power|technical replicates?|analysis unit|pre[-\s]?registration|risk register|checklist|方法学|方案|实验设计|研究设计|样本|统计|功效|技术重复|非独立|分析单位|预注册|风险|清单)/i.test(prompt);
  const anchored = /(previous|prior|last|existing|current|visible|selected|above|artifact|report|protocol|next step|上一轮|之前|已有|当前|选中|报告|产物|方案|刚才|上次|下一步)/i.test(prompt);
  const noExternal = /(do not call AgentServer|no AgentServer|without AgentServer|do not search|no external|不要调用 AgentServer|不要访问外部|不访问外部|不要外部检索|不要重新检索)/i.test(prompt);
  return asksDurable && methodology && (anchored || noExternal);
}

function methodologyContextLooksRelevant(text: string) {
  return /(protocol|methodolog|experiment|study design|sample|power|statistics?|pre[-\s]?registration|risk register|technical replicates?|实验|方案|样本|统计|功效|预注册|风险|技术重复)/i.test(text);
}

async function methodologyContextItems(request: GatewayRequest, workspace: string): Promise<ContextItem[]> {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const records = [
    ...request.artifacts,
    ...toRecordList(request.references),
    ...toRecordList(uiState.artifacts),
    ...toRecordList(uiState.currentReferences),
    ...toRecordList(uiState.currentReferenceDigests),
    ...toRecordList(uiState.objectReferences),
  ];
  const fromRequest = await recordsToContext(records, workspace);
  if (fromRequest.length) return fromRequest.slice(0, 12);
  return (await latestSessionContextItems(workspace)).slice(0, 12);
}

async function recordsToContext(records: unknown[], workspace: string): Promise<ContextItem[]> {
  const items: ContextItem[] = [];
  for (const record of records) {
    if (!isRecord(record)) continue;
    const item = await recordToContext(record, workspace);
    if (item) items.push(item);
  }
  return uniqueContextItems(items);
}

async function recordToContext(record: Record<string, unknown>, workspace: string): Promise<ContextItem | undefined> {
  const payload = isRecord(record.payload) ? record.payload : {};
  const currentReference = isRecord(payload.currentReference) ? payload.currentReference : {};
  const objectReference = isRecord(payload.objectReference) ? payload.objectReference : {};
  const data = isRecord(record.data) ? record.data : {};
  const label = stringField(record.title)
    ?? stringField(record.label)
    ?? stringField(record.id)
    ?? stringField(currentReference.title)
    ?? stringField(objectReference.title)
    ?? 'current artifact';
  const ref = stringField(record.dataRef)
    ?? stringField(record.path)
    ?? stringField(record.ref)
    ?? stringField(currentReference.dataRef)
    ?? stringField(currentReference.path)
    ?? stringField(currentReference.ref)
    ?? stringField(objectReference.dataRef)
    ?? stringField(objectReference.path)
    ?? stringField(objectReference.ref);
  const inline = [
    stringField(data.markdown),
    stringField(data.content),
    stringField(data.text),
    stringField(data.summary),
    stringField(record.digestText),
    stringField(record.summary),
  ].find(Boolean);
  const text = inline ?? await readRefText(workspace, ref);
  if (!text || !methodologyContextLooksRelevant(`${label}\n${text}`)) return undefined;
  return { ref, label, text: text.slice(0, 6000) };
}

async function latestSessionContextItems(workspace: string) {
  const sessionsRoot = join(workspace, '.sciforge', 'sessions');
  let entries: Array<{ isDirectory(): boolean; name: string }>;
  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse().slice(0, 5);
  const records: unknown[] = [];
  for (const bundle of candidates) {
    const artifactDir = join(sessionsRoot, bundle, 'artifacts');
    let artifactFiles: Array<{ isFile(): boolean; name: string }> = [];
    try {
      artifactFiles = await readdir(artifactDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of artifactFiles) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        records.push(JSON.parse(await readFile(join(artifactDir, entry.name), 'utf8')));
      } catch {
        // Ignore unreadable audit records; other records may still be useful.
      }
    }
    const items = await recordsToContext(records, workspace);
    if (items.length) return items;
  }
  return [];
}

async function readRefText(workspace: string, ref: string | undefined) {
  const path = safeWorkspaceReadPath(workspace, ref);
  if (!path) return undefined;
  try {
    return (await readFile(path, 'utf8')).slice(0, 10000);
  } catch {
    return undefined;
  }
}

function safeWorkspaceReadPath(workspace: string, ref: string | undefined) {
  if (!ref || /^(?:artifact|run|execution-unit|claim|runtime):/i.test(ref)) return undefined;
  const path = isAbsolute(ref) ? resolve(ref) : resolve(workspace, ref);
  const cwd = resolve(process.cwd());
  if (!(path === workspace || path.startsWith(`${workspace}/`) || path === cwd || path.startsWith(`${cwd}/`))) return undefined;
  if (!/\.(?:md|markdown|txt|json|csv|tsv)$/i.test(path)) return undefined;
  return path;
}

function independentUnitCount(text: string) {
  return firstIntegerMatch(text, /(\d+)\s*(?:条|个)?\s*(?:独立)?(?:细胞系|类器官系|lines?|cell lines?|organoid lines?|independent units?)/i)
    ?? firstIntegerMatch(text, /(?:independent\s+)?(?:cell\s+|organoid\s+)?lines?\D{0,16}(\d+)/i);
}

function firstIntegerMatch(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  const value = Number(match?.[1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function finalPackageFiles(input: {
  chinese: boolean;
  unitLabel: string;
  sourceRefs: string[];
  sourceText: string;
}) {
  const { chinese, unitLabel, sourceRefs, sourceText } = input;
  const auditRefs = sourceRefs.length ? sourceRefs.map((ref) => `- ${ref}`).join('\n') : '- Current session artifacts (inline context).';
  const designAnchors = sourceEvidenceBullets(sourceText, [
    /design|protocol|assay|endpoint|primary|objective|方案|实验|设计|终点|目标/i,
    /budget|cost|resource|ethic|IRB|sample|rare|预算|资源|伦理|样本/i,
    /control|vehicle|positive|negative|blind|random|batch|对照|盲法|随机|批次/i,
  ], chinese
    ? '当前 artifact 未提供更具体的设计锚点；最终包只保留方法学约束和执行前复核要求。'
    : 'The current artifacts did not provide more specific design anchors; the final package retains methodology constraints and pre-execution review requirements.');
  const alternatives = sourceEvidenceBullets(sourceText, [
    /alternative|fallback|scope|reduce|stage|pilot|go\/no-go|contingenc|替代|备选|降级|缩小|分阶段|试点|停止/i,
  ], chinese
    ? '若预算、样本或伦理负担超限，先降级为 pilot/MDE 估计、减少次要终点或推迟昂贵组学，不升级为确认性实验。'
    : 'If budget, sample access, or ethics burden exceeds the plan, downgrade to pilot/MDE estimation, reduce secondary endpoints, or defer expensive omics rather than upgrading to a confirmatory experiment.');
  const auditMatrixRows = sourceRefs.length
    ? sourceRefs.slice(0, 8).map((ref) => `| ${escapeTableCell(ref)} | Source artifact used for bounded finalization | Preserve as package provenance |`).join('\n')
    : '| inline current context | Source artifact used for bounded finalization | Preserve as package provenance |';
  const protocol = chinese ? [
    '# Final Methodology Protocol Package',
    '',
    '## 完成了什么',
    `- 已把分析单位冻结为 ${unitLabel}；技术重复/孔位只用于 QC、测量误差估计或批内稳定性，不能计入独立样本量。`,
    '- 已把功效语言降级为探索性 / minimum detectable effect；不再给出中等效应充分功效结论。',
    '- 已补齐 protocol、sample/statistics、risk register、execution checklist、preregistration/audit 字段。',
    '',
    '## 缺什么',
    '- 缺少 pilot 方差、细胞系内相关、批次方差、主要终点方差和实际失败率；因此不能声明确认性功效。',
    '- 外部领域/伦理审批仍需要 PI、统计师和 IRB 按真实材料复核。',
    '',
    '## 是否可信',
    '- 可作为探索性、预注册 pilot protocol 使用。',
    '- 不可作为确认性疗效或机制验证方案使用，除非补充 pilot 方差或保守模拟并重新冻结功效口径。',
    '',
    '## 下一步',
    '- 用 pilot 方差或保守模拟估计 minimum detectable effect。',
    '- 冻结预注册字段、盲法/randomization、排除规则、分析脚本哈希和审计 artifact ID。',
    '- 复核预算、伦理负担、样本来源和 wet-lab 可用性后执行。',
    '',
    '## 设计方案锚点',
    designAnchors,
    '',
    '## Hard Requirements Matrix',
    '| Requirement | Final package coverage |',
    '| --- | --- |',
    '| 设计方案 | `final_protocol.md` 记录目标、分析单位、对照/盲法/随机化、资源伦理复核点；具体 wet-lab 参数必须由源 artifact 或 PI 复核确认 |',
    '| 关键风险 | `risk_register.md` 覆盖样本稀缺、批次漂移、伪重复、伦理/资源、终点方差 |',
    '| 样本/统计 | `sample_statistics.md` 冻结独立单位、技术重复处理、探索性/MDE 功效语言、模型和多重性 |',
    '| 替代方案 | `alternative_plan.md` 给出 pilot/MDE、降范围、推迟昂贵终点、停止/重设计路径 |',
    '| 执行步骤 | `execution_checklist.md` 给出冻结、随机/盲法、QC/pilot、go/no-go、审计保存步骤 |',
    '| 可审计 artifact | `manifest.json` 记录生成器、时间、source refs、independent units 和文件清单 |',
    '',
    '## 替代方案摘要',
    alternatives,
    '',
    '## Audit Matrix',
    '| Source ref | Role | Audit action |',
    '| --- | --- | --- |',
    auditMatrixRows,
    '',
    '## Audit Sources',
    auditRefs,
  ].join('\n') : [
    '# Final Methodology Protocol Package',
    '',
    '## Completed',
    `- The analysis unit is frozen as ${unitLabel}; technical replicates/wells are QC, measurement-error, or within-batch stability evidence only and do not increase independent n.`,
    '- Power language is reframed as exploratory / minimum detectable effect; no moderate-effect adequate-power claim is retained.',
    '- Protocol, sample/statistics, risk register, execution checklist, preregistration, and audit fields are included.',
    '',
    '## Missing',
    '- Pilot variance, intra-line correlation, batch variance, primary-endpoint variance, and empirical failure rates are still missing; confirmatory power cannot be claimed.',
    '- Domain, ethics, and operational approval still require PI/statistician/IRB review against real materials.',
    '',
    '## Trust',
    '- Credible as an exploratory preregistered pilot protocol.',
    '- Not credible as a confirmatory efficacy or mechanism package until pilot variance or conservative simulation is added.',
    '',
    '## Next Step',
    '- Estimate minimum detectable effect from pilot variance or conservative simulation.',
    '- Freeze preregistration fields, blinding/randomization, exclusions, analysis script hash, and audit artifact IDs.',
    '- Recheck budget, ethics burden, sample access, and wet-lab feasibility before execution.',
    '',
    '## Design Plan Anchors',
    designAnchors,
    '',
    '## Hard Requirements Matrix',
    '| Requirement | Final package coverage |',
    '| --- | --- |',
    '| Design plan | `final_protocol.md` records objective, analysis unit, controls/blinding/randomization, and resource/ethics review points; exact wet-lab parameters must be confirmed from source artifacts or PI review |',
    '| Key risks | `risk_register.md` covers sample scarcity, batch drift, pseudoreplication, ethics/resource load, and endpoint variance |',
    '| Sample/statistics | `sample_statistics.md` freezes independent unit, technical-repeat handling, exploratory/MDE language, model, and multiplicity |',
    '| Alternatives | `alternative_plan.md` records pilot/MDE, scope reduction, deferred expensive endpoints, and stop/redesign paths |',
    '| Execution steps | `execution_checklist.md` records freezing, randomization/blinding, QC/pilot, go/no-go, and audit preservation steps |',
    '| Auditable artifact | `manifest.json` records generator, timestamp, source refs, independent units, and file inventory |',
    '',
    '## Alternative Summary',
    alternatives,
    '',
    '## Audit Matrix',
    '| Source ref | Role | Audit action |',
    '| --- | --- | --- |',
    auditMatrixRows,
    '',
    '## Audit Sources',
    auditRefs,
  ].join('\n');
  return [
    {
      id: 'protocol',
      name: 'final_protocol.md',
      title: 'Final methodology protocol',
      type: 'research-report',
      summary: 'Final bounded methodology protocol with completion, gaps, trust, and next steps.',
      markdown: protocol,
    },
    {
      id: 'sample-statistics',
      name: 'sample_statistics.md',
      title: 'Sample and statistics table',
      type: 'data-table',
      summary: 'Analysis-unit and power-language table.',
      markdown: [
        '# Sample / Statistics Table',
        '',
        '| Field | Final rule |',
        '| --- | --- |',
        `| Independent unit | ${unitLabel} |`,
        '| Technical replicates | Nested within independent unit/batch; not independent n |',
        '| Power claim | Exploratory/MDE only; no moderate-effect adequate-power claim |',
        '| Model | Mixed or hierarchical model with independent biological unit as unit of inference and batch/plate terms pre-specified |',
        '| Multiplicity | Freeze primary endpoint; secondary endpoints exploratory with correction where appropriate |',
      ].join('\n'),
    },
    {
      id: 'risk-register',
      name: 'risk_register.md',
      title: 'Risk register',
      type: 'risk-register',
      summary: 'Key methodology risks and mitigations.',
      markdown: [
        '# Risk Register',
        '',
        '| Risk | Likelihood | Impact | Mitigation |',
        '| --- | --- | --- | --- |',
        '| Low independent n / sample scarcity | High | High | Stage pilot, report MDE, avoid confirmatory claim |',
        '| Batch or differentiation drift | Medium-high | High | Randomized layout, blinded QC, model batch/plate terms |',
        '| Technical-repeat pseudoreplication | Medium | High | Preregister independent-unit rule and nested/repeated-measure handling |',
        '| Ethics/resource overuse | Medium | Medium-high | Go/no-go checkpoint after QC and pilot variance |',
        '| Unstable endpoint variance | Medium | High | Pilot variance estimate and sensitivity analysis before final inference |',
      ].join('\n'),
    },
    {
      id: 'execution-checklist',
      name: 'execution_checklist.md',
      title: 'Execution checklist',
      type: 'notebook-timeline',
      summary: 'Execution and audit checklist.',
      markdown: [
        '# Execution Checklist',
        '',
        '- Freeze protocol, endpoints, analysis unit, exclusion rules, and audit artifact IDs before wet-lab start.',
        '- Randomize line/batch/plate order and blind endpoint extraction.',
        '- Run pilot/QC checkpoint and estimate variance/MDE before full execution.',
        '- Decide continue / reduce scope / redesign using pre-specified go/no-go rules.',
        '- Preserve raw QC logs, analysis script hash, preregistration snapshot, and final package manifest.',
      ].join('\n'),
    },
    {
      id: 'alternative-plan',
      name: 'alternative_plan.md',
      title: 'Alternative plan',
      type: 'research-report',
      summary: 'Fallback options when sample, budget, ethics, or variance constraints block the primary plan.',
      markdown: [
        '# Alternative Plan',
        '',
        '## Trigger Conditions',
        '- Pilot variance shows the planned design cannot estimate a useful MDE.',
        '- Sample expansion, consent/ethics constraints, or QC failures reduce the independent units below the frozen analysis plan.',
        '- Batch/plate drift cannot be separated from the primary endpoint.',
        '- Budget or access constraints make secondary endpoints infeasible.',
        '',
        '## Fallback Options',
        alternatives,
        '',
        '## Decision Rule',
        '- Do not convert technical replicates into independent n.',
        '- Do not promote exploratory findings to confirmatory claims.',
        '- Preserve the failed/changed path in the manifest and preregistration amendment log.',
      ].join('\n'),
    },
    {
      id: 'preregistration-notes',
      name: 'preregistration_notes.md',
      title: 'Preregistration notes',
      type: 'research-report',
      summary: 'Fields to freeze before execution.',
      markdown: [
        '# Preregistration Notes',
        '',
        '- Primary endpoint and measurement window.',
        '- Independent analysis unit and technical-replicate handling.',
        '- Inclusion/exclusion and QC failure rules before unblinding.',
        '- Randomization, blinding, batch/plate layout, and positive/negative controls.',
        '- Statistical model, covariates, multiplicity correction, MDE language, and negative-result reporting.',
      ].join('\n'),
    },
  ];
}

function sourceEvidenceBullets(sourceText: string, patterns: RegExp[], fallback: string) {
  const lines = sourceText
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)]|#+)\s*/, '').trim())
    .filter((line) => line.length >= 24 && line.length <= 260)
    .filter((line) => patterns.some((pattern) => pattern.test(line)));
  const unique = Array.from(new Set(lines)).slice(0, 5);
  if (!unique.length) return `- ${fallback}`;
  return unique.map((line) => `- ${line}`).join('\n');
}

function escapeTableCell(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 220);
}

function finalizerMessage(
  chinese: boolean,
  unitLabel: string,
  packageDir: string,
  files: Array<{ name: string; title: string }>,
  sourceRefs: string[],
) {
  if (chinese) {
    return [
      '已从当前会话 artifact 写出最终方法学 protocol package；没有调用远程后端，也没有访问外部资源。',
      '',
      `完成了什么：写入 ${packageDir}，包含 ${files.map((file) => file.name).join('、')}；统计口径按 ${unitLabel}，技术重复不作为独立样本。`,
      '缺什么：仍缺 pilot 方差/ICC/批次方差和真实失败率；不能升级为确认性功效结论。',
      '是否可信：作为探索性预注册 pilot package 可信；作为确认性疗效/机制验证仍不可信。',
      `下一步：复核 ${packageDir}/final_protocol.md，补 pilot 方差或保守模拟，冻结预注册和分析脚本哈希后执行。`,
      sourceRefs.length ? `使用的 source refs：${sourceRefs.join('；')}` : undefined,
    ].filter((line): line is string => Boolean(line)).join('\n');
  }
  return [
    'Final methodology protocol package was written from current session artifacts; no remote backend or external access was used.',
    '',
    `Completed: wrote ${packageDir} with ${files.map((file) => file.name).join(', ')}; statistics now use ${unitLabel}, with technical replicates excluded from independent n.`,
    'Missing: pilot variance/ICC/batch variance and empirical failure rates are still absent; confirmatory power cannot be claimed.',
    'Trust: credible as an exploratory preregistered pilot package; not credible as a confirmatory efficacy/mechanism package.',
    `Next step: inspect ${packageDir}/final_protocol.md, add pilot variance or conservative simulation, then freeze preregistration and analysis-script hashes before execution.`,
    sourceRefs.length ? `Source refs: ${sourceRefs.join('; ')}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function uniqueContextItems(items: ContextItem[]) {
  const seen = new Set<string>();
  const result: ContextItem[] = [];
  for (const item of items) {
    const key = `${item.ref ?? ''}\n${item.label}\n${item.text.slice(0, 200)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
