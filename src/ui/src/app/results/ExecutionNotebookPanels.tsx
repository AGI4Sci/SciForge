import { useState } from 'react';
import { structureSummaryMetricPresentation, uploadedInteractiveEvidenceArtifacts } from '@sciforge/interactive-views';
import { ChevronDown, ChevronUp, Clock, Download, FileCode, Lock, Shield } from 'lucide-react';
import { buildExecutionBundle, evaluateExecutionBundleExport } from '../../exportPolicy';
import { scenarios, type ScenarioId } from '../../data';
import type { EvidenceClaim, NotebookRecord, RuntimeArtifact, RuntimeExecutionUnit, SciForgeRun, SciForgeSession } from '../../domain';
import { exportJsonFile } from '../exportUtils';
import { ActionButton, Badge, Card, ClaimTag, ConfidenceBar, EmptyArtifactState, EvidenceTag, SectionHeader } from '../uiPrimitives';
import { UploadedDataUrlPreview } from './WorkspaceObjectPreview';
import { executionStatusLabel, executionVerificationPresentation, type ExecutionPresentationVariant } from './executionStatusPresentation';
import { sanitizeUserProjectionText } from '../conversation-projection-view-model';
import { boundedRightPaneText, rightPaneInlineLabel } from './previewSafety';
import { resultCountText, resultText, type ResultLocale } from './resultLocale';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactParams(params: string) {
  return params.length > 128 ? `${params.slice(0, 125)}...` : params;
}

function exportExecutionBundle(session: SciForgeSession, activeRun: SciForgeRun | undefined, executionUnits: RuntimeExecutionUnit[]) {
  const decision = evaluateExecutionBundleExport(session, { activeRun, executionUnits });
  if (!decision.allowed) {
    window.alert(`Export blocked by artifact policy: ${decision.blockedArtifactIds.join(', ')}`);
    return;
  }
  const runSuffix = activeRun ? `-${activeRun.id}` : '';
  exportJsonFile(`execution-units-${session.scenarioId}-${session.sessionId}${runSuffix}.json`, buildExecutionBundle(session, decision, { activeRun, executionUnits }));
}

function formatResultFileBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function MetricGrid({ metrics = {} }: { metrics?: Record<string, unknown> }) {
  const presentation = structureSummaryMetricPresentation(metrics);
  const rows = presentation.rows;
  if (!rows.length) {
    const emptyState = presentation.emptyState!;
    return <EmptyArtifactState title={emptyState.title} detail={emptyState.detail} />;
  }
  return (
    <div className="metric-grid">
      {rows.map(({ label, value, color }) => (
        <Card className="metric" key={label}>
          <span>{label}</span>
          <strong style={{ color }}>{value}</strong>
        </Card>
      ))}
    </div>
  );
}

export function EvidenceMatrix({ claims, artifacts = [], locale }: { claims: EvidenceClaim[]; artifacts?: RuntimeArtifact[]; locale?: ResultLocale }) {
  const [expandedClaim, setExpandedClaim] = useState<string | null>(null);
  const [expandedUpload, setExpandedUpload] = useState<string | null>(null);
  const uploads = uploadedInteractiveEvidenceArtifacts(artifacts);
  const rows = claims.map((claim, index) => ({
    id: `${claim.id || 'claim'}-${index}`,
    claim: sanitizeUserProjectionText(claim.text) ?? claim.text,
    support: resultCountText(locale, claim.supportingRefs.length, {
      zh: (count) => `${count} 条支持`,
      en: (count) => `${count} supporting`,
    }),
    oppose: resultCountText(locale, claim.opposingRefs.length, {
      zh: (count) => `${count} 条反向`,
      en: (count) => `${count} opposing`,
    }),
    level: claim.evidenceLevel,
    type: claim.type,
    supportingRefs: claim.supportingRefs,
    opposingRefs: claim.opposingRefs,
    dependencyRefs: claim.dependencyRefs ?? [],
    updateReason: sanitizeUserProjectionText(claim.updateReason) ?? claim.updateReason,
  }));
  return (
    <div className="stack">
      <SectionHeader icon={Shield} title={resultText(locale, { 'zh-CN': '引用', 'en-US': 'References' })} subtitle={resultText(locale, { 'zh-CN': '声明、上传文件和可交互引用', 'en-US': 'Claims, uploads, and interactive references' })} />
      {!rows.length && !uploads.length ? <EmptyArtifactState title={resultText(locale, { 'zh-CN': '等待引用', 'en-US': 'Waiting for references' })} detail={resultText(locale, { 'zh-CN': '上传 PDF、图片，或运行任务后，可复用引用会显示在这里。', 'en-US': 'Upload PDFs, images, or run a task to make reusable references appear here.' })} /> : null}
      {uploads.map((artifact) => {
        const title = rightPaneInlineLabel(asString(artifact.metadata?.title) || asString(artifact.metadata?.fileName) || artifact.id);
        const mimeType = rightPaneInlineLabel(asString(artifact.metadata?.mimeType) || asString((artifact.data as Record<string, unknown> | undefined)?.mimeType) || 'application/octet-stream');
        const size = typeof artifact.metadata?.size === 'number' ? artifact.metadata.size : undefined;
        const data = isRecord(artifact.data) ? artifact.data : {};
        const dataUrl = asString(data.dataUrl);
        const previewKind = asString(data.previewKind);
        return (
          <Card className="evidence-row uploaded-evidence-row" key={artifact.id}>
            <div className="evidence-main">
              <h3>{title}</h3>
              <p>{artifact.type} · {mimeType}{size ? ` · ${formatResultFileBytes(size)}` : ''}</p>
              <button className="expand-link source-toggle" onClick={() => setExpandedUpload(expandedUpload === artifact.id ? null : artifact.id)}>
                {expandedUpload === artifact.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {expandedUpload === artifact.id
                  ? resultText(locale, { 'zh-CN': '隐藏预览', 'en-US': 'Hide preview' })
                  : resultText(locale, { 'zh-CN': '预览 / 引用', 'en-US': 'Preview / reference' })}
              </button>
              {expandedUpload === artifact.id ? (
                <div className="uploaded-evidence-preview">
                  {previewKind === 'image' && dataUrl ? (
                    <UploadedDataUrlPreview kind="image" dataUrl={dataUrl} title={title} mimeType={mimeType} />
                  ) : null}
                  {previewKind === 'pdf' && dataUrl ? (
                    <UploadedDataUrlPreview kind="pdf" dataUrl={dataUrl} title={title} mimeType={mimeType} />
                  ) : null}
                  {previewKind !== 'image' && previewKind !== 'pdf' ? <p className="empty-state">{resultText(locale, { 'zh-CN': '此文件可作为可复用聊天引用。', 'en-US': 'This file is available as a reusable chat reference.' })}</p> : null}
                  <div className="source-list">
                    <code>artifact:{artifact.id}</code>
                    {artifact.dataRef ? <code>{rightPaneInlineLabel(artifact.dataRef)}</code> : null}
                    <button type="button" onClick={() => void navigator.clipboard?.writeText(`artifact:${artifact.id}`)}>{resultText(locale, { 'zh-CN': '复制引用', 'en-US': 'Copy reference' })}</button>
                  </div>
                </div>
              ) : null}
            </div>
            <Badge variant="info">uploaded</Badge>
            <Badge variant="muted">{previewKind || 'file'}</Badge>
          </Card>
        );
      })}
      {rows.map((row) => (
        <Card className="evidence-row" key={row.id}>
          <div className="evidence-main">
            <h3>{row.claim}</h3>
            <p>{row.support} · {row.oppose}{row.dependencyRefs.length ? ` · ${resultCountText(locale, row.dependencyRefs.length, {
              zh: (count) => `${count} 条依赖`,
              en: (count) => `${count} dependencies`,
            })}` : ''}</p>
            {row.updateReason ? <p className="empty-state">updateReason: {row.updateReason}</p> : null}
            {row.supportingRefs.length || row.opposingRefs.length || row.dependencyRefs.length ? (
              <>
                <button className="expand-link source-toggle" onClick={() => setExpandedClaim(expandedClaim === row.id ? null : row.id)}>
                  {expandedClaim === row.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {expandedClaim === row.id
                    ? resultText(locale, { 'zh-CN': '收起来源', 'en-US': 'Hide sources' })
                    : resultText(locale, { 'zh-CN': '查看来源/依赖', 'en-US': 'Show sources/dependencies' })}
                </button>
                {expandedClaim === row.id ? (
                  <div className="source-list">
                    {row.supportingRefs.map((ref, index) => <code key={`support-${row.id}-${ref}-${index}`}>+ {rightPaneInlineLabel(ref)}</code>)}
                    {row.opposingRefs.map((ref, index) => <code key={`oppose-${row.id}-${ref}-${index}`}>- {rightPaneInlineLabel(ref)}</code>)}
                    {row.dependencyRefs.map((ref, index) => <code key={`dependency-${row.id}-${ref}-${index}`}>depends-on {rightPaneInlineLabel(ref)}</code>)}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          <EvidenceTag level={row.level} />
          <ClaimTag type={row.type} />
        </Card>
      ))}
    </div>
  );
}

export function ExecutionPanel({
  session,
  executionUnits,
  activeRun,
  embedded = false,
  locale,
}: {
  session: SciForgeSession;
  executionUnits: RuntimeExecutionUnit[];
  activeRun?: SciForgeRun;
  embedded?: boolean;
  locale?: ResultLocale;
}) {
  const rows = executionUnits;
  return (
    <div className="stack">
      <SectionHeader
        icon={Lock}
        title={resultText(locale, { 'zh-CN': '活动', 'en-US': 'Activity' })}
        subtitle={embedded
          ? resultText(locale, { 'zh-CN': '步骤摘要、检查和指纹', 'en-US': 'Step summaries, checks, and fingerprints' })
          : resultText(locale, { 'zh-CN': '步骤、环境和指纹', 'en-US': 'Steps, environment, and fingerprints' })}
        action={<ActionButton icon={Download} variant="secondary" onClick={() => exportExecutionBundle(session, activeRun, rows)}>{resultText(locale, { 'zh-CN': '导出日志', 'en-US': 'Export log' })}</ActionButton>}
      />
      {rows.length ? (
        <div className="eu-table">
          <div className="eu-head">
            <span>{resultText(locale, { 'zh-CN': '步骤', 'en-US': 'Step' })}</span>
            <span>{resultText(locale, { 'zh-CN': '动作', 'en-US': 'Action' })}</span>
            <span>{resultText(locale, { 'zh-CN': '输入', 'en-US': 'Input' })}</span>
            <span>{resultText(locale, { 'zh-CN': '材料', 'en-US': 'Material' })}</span>
            <span>{resultText(locale, { 'zh-CN': '状态', 'en-US': 'Status' })}</span>
            <span>{resultText(locale, { 'zh-CN': '指纹', 'en-US': 'Fingerprint' })}</span>
          </div>
          {rows.map((unit, index) => (
            <div className="eu-row" key={`${unit.id}-${unit.hash || index}-${index}`}>
              <code>{index + 1}</code>
              <span>{executionActionLabel(unit, locale)}</span>
              <code title={safeExecutionDetail(unit.params, locale)}>{compactParams(executionInputLabel(unit.params, locale))}</code>
              <code title={safeExecutionDetail(unit.code || unit.language || '', locale)}>
                {safeExecutionDetail(unit.code || unit.language || auditMaterialLabel(unit, locale), locale)}
              </code>
              <span className="eu-status-stack">
                <Badge variant={executionStatusVariant(unit.status)}>{executionStatusLabel(unit.status, locale)}</Badge>
                <Badge variant={executionVerificationPresentation(unit, locale).variant}>{executionVerificationPresentation(unit, locale).label}</Badge>
              </span>
              <code>{executionFingerprintLabel(unit.hash, locale)}</code>
              {executionStatusDetail(unit, locale) ? (
                <div className="eu-detail">
                  {executionStatusDetail(unit, locale)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : <EmptyArtifactState title={resultText(locale, { 'zh-CN': '等待活动', 'en-US': 'Waiting for activity' })} detail={resultText(locale, { 'zh-CN': '此对话中的可追踪步骤会显示在这里。', 'en-US': 'Traceable steps from this conversation will appear here.' })} />}
      <Card className="code-card">
        <SectionHeader icon={FileCode} title={resultText(locale, { 'zh-CN': '环境', 'en-US': 'Environment' })} />
        <pre>{executionEnvironmentText(rows, locale)}</pre>
      </Card>
    </div>
  );
}

function executionStatusVariant(status: RuntimeExecutionUnit['status']): ExecutionPresentationVariant {
  if (status === 'done' || status === 'self-healed') return 'success';
  if (status === 'failed' || status === 'failed-with-reason') return 'danger';
  if (status === 'repair-needed') return 'warning';
  if (status === 'planned' || status === 'record-only') return 'muted';
  return 'info';
}

function executionStatusDetail(unit: RuntimeExecutionUnit, locale?: ResultLocale) {
  const verification = executionVerificationPresentation(unit, locale);
  const lines = [
    unit.failureReason ? `${resultText(locale, { 'zh-CN': '失败', 'en-US': 'Failure' })}: ${safeExecutionDetail(unit.failureReason, locale)}` : undefined,
    unit.recoverActions?.length ? `${resultText(locale, { 'zh-CN': '恢复', 'en-US': 'Recovery' })}: ${unit.recoverActions.map((action) => safeExecutionDetail(action, locale)).join('; ')}` : undefined,
    unit.nextStep ? `${resultText(locale, { 'zh-CN': '下一步', 'en-US': 'Next' })}: ${safeExecutionDetail(unit.nextStep, locale)}` : undefined,
    unit.patchSummary ? `${resultText(locale, { 'zh-CN': '更改', 'en-US': 'Changes' })}: ${safeExecutionDetail(unit.patchSummary, locale)}` : undefined,
    auditRefCount(unit) ? resultCountText(locale, auditRefCount(unit), {
      zh: (count) => `已保存 ${count} 条支持记录`,
      en: (count) => `${count} supporting record${count === 1 ? '' : 's'} saved`,
    }) : undefined,
    `${resultText(locale, { 'zh-CN': '检查', 'en-US': 'Check' })}: ${verification.detail}`,
  ].filter(Boolean);
  return sanitizeUserProjectionText(lines.join(' · ')) ?? (lines.length ? lines.join(' · ') : '');
}

function executionEnvironmentText(rows: RuntimeExecutionUnit[], locale?: ResultLocale) {
  if (!rows.length) return resultText(locale, { 'zh-CN': '还没有活动。', 'en-US': 'No activity yet.' });
  const text = rows.map((unit) => [
    `${resultText(locale, { 'zh-CN': '步骤', 'en-US': 'Step' })}: ${executionActionLabel(unit, locale)}`,
    `${resultText(locale, { 'zh-CN': '语言', 'en-US': 'Language' })}: ${safeExecutionDetail(unit.language || resultText(locale, { 'zh-CN': '未声明', 'en-US': 'Not declared' }), locale)}`,
    `${resultText(locale, { 'zh-CN': '环境', 'en-US': 'Environment' })}: ${safeExecutionDetail(unit.environment || resultText(locale, { 'zh-CN': '未声明', 'en-US': 'Not declared' }), locale)}`,
    `${resultText(locale, { 'zh-CN': '来源', 'en-US': 'Sources' })}: ${auditRefCount(unit)}`,
    `${resultText(locale, { 'zh-CN': '检查', 'en-US': 'Check' })}: ${executionVerdictText(unit, locale)}`,
    unit.failureReason ? `${resultText(locale, { 'zh-CN': '失败', 'en-US': 'Failure' })}: ${safeExecutionDetail(unit.failureReason, locale)}` : undefined,
    unit.patchSummary ? `${resultText(locale, { 'zh-CN': '更改', 'en-US': 'Changes' })}: ${safeExecutionDetail(unit.patchSummary, locale)}` : undefined,
    unit.nextStep ? `${resultText(locale, { 'zh-CN': '下一步', 'en-US': 'Next' })}: ${safeExecutionDetail(unit.nextStep, locale)}` : undefined,
    unit.databaseVersions?.length ? `${resultText(locale, { 'zh-CN': '数据版本', 'en-US': 'Data versions' })}: ${unit.databaseVersions.map((version) => safeExecutionDetail(version, locale)).join(', ')}` : undefined,
  ].join('\n')).join('\n\n');
  return boundedRightPaneText(sanitizeUserProjectionText(text) ?? text, 4_000);
}

function auditMaterialLabel(unit: RuntimeExecutionUnit, locale?: ResultLocale) {
  return auditRefCount(unit)
    ? resultText(locale, { 'zh-CN': '来源已保存', 'en-US': 'Sources saved' })
    : resultText(locale, { 'zh-CN': '未声明', 'en-US': 'Not declared' });
}

function auditRefCount(unit: RuntimeExecutionUnit) {
  return [unit.codeRef, unit.stdoutRef, unit.stderrRef, unit.outputRef, unit.diffRef, unit.verificationRef].filter(Boolean).length;
}

function executionActionLabel(unit: RuntimeExecutionUnit, locale?: ResultLocale) {
  const haystack = `${unit.tool} ${unit.entrypoint ?? ''} ${unit.params ?? ''}`.toLowerCase();
  if (/read|cat|sed|rg|grep|ls|find|open|inspect|search|fetch|download|读取|检索|查看|下载/.test(haystack)) return resultText(locale, { 'zh-CN': '读取 / 搜索', 'en-US': 'Read / search' });
  if (/edit|write|patch|apply|diff|save|create|mutate|生成|编辑|写入|修改/.test(haystack)) return resultText(locale, { 'zh-CN': '写入 / 编辑', 'en-US': 'Write / edit' });
  if (/verify|validate|test|check|验证|检查|测试/.test(haystack)) return resultText(locale, { 'zh-CN': '检查', 'en-US': 'Check' });
  if (/python|node|npm|tsx|pytest|run|exec|shell|运行|执行/.test(haystack)) return resultText(locale, { 'zh-CN': '运行', 'en-US': 'Run' });
  return resultText(locale, { 'zh-CN': '工作', 'en-US': 'Work' });
}

function safeExecutionDetail(value: string | undefined, locale?: ResultLocale) {
  const compact = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!compact) return resultText(locale, { 'zh-CN': '未声明', 'en-US': 'Not declared' });
  const safe = compact
    .replace(/\bsciforge\.background-completion(?:\.v\d+)?\b/gi, 'background activity')
    .replace(/\brunId\s*=\s*[\w:-]+/gi, 'current run')
    .replace(/\bstageId\s*=\s*[\w:-]+/gi, 'current step')
    .replace(/\bverification:[\w:-]+/gi, 'check reference')
    .replace(/\bexecution-unit:[\w:-]+/gi, 'activity reference')
    .replace(/\bEU-[\w:-]+/g, 'activity step')
    .replace(/\brun-[\w:-]+/gi, 'current run')
    .replace(/\brun:[\w:/#.-]+/gi, 'run reference')
    .replace(/\.sciforge\/[\w./-]+/gi, 'local source')
    .replace(/\bstdout(?:Ref)?\b/gi, 'output reference')
    .replace(/\bstderr(?:Ref)?\b/gi, 'error reference')
    .replace(/\bprovider\b/gi, 'service')
    .replace(/\bruntimeProfile\w*/gi, 'runtime settings')
    .replace(/\bExecutionUnit\b/gi, 'activity step')
    .replace(/\braw\s*JSONL\b/gi, 'supporting log')
    .replace(/\bcodex-command-[\w-]+/gi, 'current run')
    .slice(0, 220);
  return boundedRightPaneText(safe, 220);
}

function executionInputLabel(params: string | undefined, locale?: ResultLocale) {
  const safe = safeExecutionDetail(params, locale);
  if (safe === '{}' || safe === resultText(locale, { 'zh-CN': '未声明', 'en-US': 'Not declared' })) return safe;
  if (/current run|current step|run reference|activity reference|local source|check reference/.test(safe)) return resultText(locale, { 'zh-CN': '参数已保存', 'en-US': 'Parameters saved' });
  return safe;
}

function executionFingerprintLabel(hash: string | undefined, locale?: ResultLocale) {
  const safe = safeExecutionDetail(hash, locale);
  if (!safe || safe === resultText(locale, { 'zh-CN': '未声明', 'en-US': 'Not declared' })) return resultText(locale, { 'zh-CN': '已保存', 'en-US': 'Saved' });
  if (/current run|current step|run reference|activity reference|local source|check reference/.test(safe)) return resultText(locale, { 'zh-CN': '已保存', 'en-US': 'Saved' });
  return safe;
}

function executionVerdictText(unit: RuntimeExecutionUnit, locale?: ResultLocale) {
  return executionVerificationPresentation(unit, locale).label;
}

export function NotebookTimeline({
  scenarioId,
  notebook = [],
  embedded = false,
  locale,
}: {
  scenarioId: ScenarioId;
  notebook?: NotebookRecord[];
  embedded?: boolean;
  locale?: ResultLocale;
}) {
  const filtered = notebook;
  return (
    <div className="stack">
      <SectionHeader
        icon={Clock}
        title={resultText(locale, { 'zh-CN': '笔记本', 'en-US': 'Notebook' })}
        subtitle={embedded
          ? resultText(locale, { 'zh-CN': '对话时间线', 'en-US': 'Conversation timeline' })
          : resultText(locale, { 'zh-CN': '已保存的研究时间线', 'en-US': 'Saved research timeline' })}
      />
      {!filtered.length ? (
        <EmptyArtifactState
          title={resultText(locale, { 'zh-CN': '等待笔记条目', 'en-US': 'Waiting for notebook entries' })}
          detail={resultText(locale, { 'zh-CN': '此对话中的条目会显示在这里。', 'en-US': 'Entries from this conversation will appear here.' })}
        />
      ) : null}
      <div className="timeline-list">
        {filtered.map((item, index) => {
          const scenario = scenarios.find((entry) => entry.id === item.scenario) ?? scenarios[0];
          return (
            <Card className="timeline-card" key={`${item.id || item.title}-${item.time || index}-${index}`}>
              <div className="timeline-dot" style={{ background: scenario.color }} />
              <div>
                <div className="timeline-meta">
                  <span>{item.time}</span>
                  <ClaimTag type={item.claimType} />
                  <ConfidenceBar value={item.confidence} />
                </div>
                <h3>{item.title}</h3>
                <p>{boundedRightPaneText(item.desc, 800)}</p>
                {item.updateReason ? <p className="empty-state">updateReason: {boundedRightPaneText(item.updateReason, 500)}</p> : null}
                {item.artifactRefs?.length || item.executionUnitRefs?.length || item.beliefRefs?.length || item.dependencyRefs?.length ? (
                  <div className="source-list">
                    {(item.artifactRefs ?? []).map((ref) => <code key={`artifact-${item.id}-${ref}`}>artifact {rightPaneInlineLabel(ref)}</code>)}
                    {(item.executionUnitRefs ?? []).map((ref) => <code key={`eu-${item.id}-${ref}`}>execution {rightPaneInlineLabel(ref)}</code>)}
                    {(item.beliefRefs ?? []).map((ref) => <code key={`belief-${item.id}-${ref}`}>belief {rightPaneInlineLabel(ref)}</code>)}
                    {(item.dependencyRefs ?? []).map((ref) => <code key={`dependency-${item.id}-${ref}`}>depends-on {rightPaneInlineLabel(ref)}</code>)}
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
