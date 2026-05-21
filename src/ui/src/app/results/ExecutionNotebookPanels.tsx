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
    window.alert(`导出被 artifact policy 阻止：${decision.blockedArtifactIds.join(', ')}`);
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

export function EvidenceMatrix({ claims, artifacts = [] }: { claims: EvidenceClaim[]; artifacts?: RuntimeArtifact[] }) {
  const [expandedClaim, setExpandedClaim] = useState<string | null>(null);
  const [expandedUpload, setExpandedUpload] = useState<string | null>(null);
  const uploads = uploadedInteractiveEvidenceArtifacts(artifacts);
  const rows = claims.map((claim, index) => ({
    id: `${claim.id || 'claim'}-${index}`,
    claim: sanitizeUserProjectionText(claim.text) ?? claim.text,
    support: `${claim.supportingRefs.length} 条支持`,
    oppose: `${claim.opposingRefs.length} 条反向`,
    level: claim.evidenceLevel,
    type: claim.type,
    supportingRefs: claim.supportingRefs,
    opposingRefs: claim.opposingRefs,
    dependencyRefs: claim.dependencyRefs ?? [],
    updateReason: sanitizeUserProjectionText(claim.updateReason) ?? claim.updateReason,
  }));
  return (
    <div className="stack">
      <SectionHeader icon={Shield} title="证据矩阵" subtitle="claims、上传文件和可交互引用" />
      {!rows.length && !uploads.length ? <EmptyArtifactState title="等待证据" detail="上传论文 PDF、图片或运行任务后，证据矩阵会展示可预览、可引用的材料。" /> : null}
      {uploads.map((artifact) => {
        const title = asString(artifact.metadata?.title) || asString(artifact.metadata?.fileName) || artifact.id;
        const mimeType = asString(artifact.metadata?.mimeType) || asString((artifact.data as Record<string, unknown> | undefined)?.mimeType) || 'application/octet-stream';
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
                {expandedUpload === artifact.id ? '收起预览' : '预览/引用'}
              </button>
              {expandedUpload === artifact.id ? (
                <div className="uploaded-evidence-preview">
                  {previewKind === 'image' && dataUrl ? (
                    <UploadedDataUrlPreview kind="image" dataUrl={dataUrl} title={title} mimeType={mimeType} />
                  ) : null}
                  {previewKind === 'pdf' && dataUrl ? (
                    <UploadedDataUrlPreview kind="pdf" dataUrl={dataUrl} title={title} mimeType={mimeType} />
                  ) : null}
                  {previewKind !== 'image' && previewKind !== 'pdf' ? <p className="empty-state">此文件类型已加入证据矩阵，可在对话栏引用给 SciForge 使用。</p> : null}
                  <div className="source-list">
                    <code>artifact:{artifact.id}</code>
                    {artifact.dataRef ? <code>{artifact.dataRef}</code> : null}
                    <button type="button" onClick={() => void navigator.clipboard?.writeText(`artifact:${artifact.id}`)}>复制引用</button>
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
            <p>{row.support} · {row.oppose}{row.dependencyRefs.length ? ` · ${row.dependencyRefs.length} 条依赖` : ''}</p>
            {row.updateReason ? <p className="empty-state">updateReason: {row.updateReason}</p> : null}
            {row.supportingRefs.length || row.opposingRefs.length || row.dependencyRefs.length ? (
              <>
                <button className="expand-link source-toggle" onClick={() => setExpandedClaim(expandedClaim === row.id ? null : row.id)}>
                  {expandedClaim === row.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {expandedClaim === row.id ? '收起来源' : '查看来源/依赖'}
                </button>
                {expandedClaim === row.id ? (
                  <div className="source-list">
                    {row.supportingRefs.map((ref, index) => <code key={`support-${row.id}-${ref}-${index}`}>+ {ref}</code>)}
                    {row.opposingRefs.map((ref, index) => <code key={`oppose-${row.id}-${ref}-${index}`}>- {ref}</code>)}
                    {row.dependencyRefs.map((ref, index) => <code key={`dependency-${row.id}-${ref}-${index}`}>depends-on {ref}</code>)}
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
}: {
  session: SciForgeSession;
  executionUnits: RuntimeExecutionUnit[];
  activeRun?: SciForgeRun;
  embedded?: boolean;
}) {
  const rows = executionUnits;
  return (
    <div className="stack">
      <SectionHeader
        icon={Lock}
        title="可复现过程"
        subtitle={embedded ? '过程摘要、验证状态和数据指纹' : '步骤、环境和数据指纹'}
        action={<ActionButton icon={Download} variant="secondary" onClick={() => exportExecutionBundle(session, activeRun, rows)}>导出过程包</ActionButton>}
      />
      {rows.length ? (
        <div className="eu-table">
          <div className="eu-head">
            <span>步骤</span>
            <span>动作</span>
            <span>输入</span>
            <span>材料</span>
            <span>状态</span>
            <span>指纹</span>
          </div>
          {rows.map((unit, index) => (
            <div className="eu-row" key={`${unit.id}-${unit.hash || index}-${index}`}>
              <code>{index + 1}</code>
              <span>{executionActionLabel(unit)}</span>
              <code title={safeExecutionDetail(unit.params)}>{compactParams(executionInputLabel(unit.params))}</code>
              <code title={unit.code || unit.language || ''}>
                {unit.code || unit.language || auditMaterialLabel(unit)}
              </code>
              <span className="eu-status-stack">
                <Badge variant={executionStatusVariant(unit.status)}>{executionStatusLabel(unit.status)}</Badge>
                <Badge variant={executionVerificationPresentation(unit).variant}>{executionVerificationPresentation(unit).label}</Badge>
              </span>
              <code>{executionFingerprintLabel(unit.hash)}</code>
              {executionStatusDetail(unit) ? (
                <div className="eu-detail">
                  {executionStatusDetail(unit)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : <EmptyArtifactState title="等待过程记录" detail="当前会话产生可追溯过程后会显示在这里。" />}
      <Card className="code-card">
        <SectionHeader icon={FileCode} title="环境摘要" />
        <pre>{executionEnvironmentText(rows)}</pre>
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

function executionStatusDetail(unit: RuntimeExecutionUnit) {
  const verification = executionVerificationPresentation(unit);
  const lines = [
    unit.failureReason ? `失败摘要：${safeExecutionDetail(unit.failureReason)}` : undefined,
    unit.recoverActions?.length ? `恢复建议：${unit.recoverActions.map(safeExecutionDetail).join('；')}` : undefined,
    unit.nextStep ? `下一步：${safeExecutionDetail(unit.nextStep)}` : undefined,
    unit.patchSummary ? `修改摘要：${safeExecutionDetail(unit.patchSummary)}` : undefined,
    auditRefCount(unit) ? `已保留 ${auditRefCount(unit)} 条过程材料` : undefined,
    `验证：${verification.detail}`,
  ].filter(Boolean);
  return sanitizeUserProjectionText(lines.join(' · ')) ?? (lines.length ? lines.join(' · ') : '');
}

function executionEnvironmentText(rows: RuntimeExecutionUnit[]) {
  if (!rows.length) return '暂无过程记录。';
  const text = rows.map((unit) => [
    `步骤：${executionActionLabel(unit)}`,
    `语言：${safeExecutionDetail(unit.language || '未声明')}`,
    `环境：${safeExecutionDetail(unit.environment || '未声明')}`,
    `材料：${auditRefCount(unit)} 条`,
    `验证：${executionVerdictText(unit)}`,
    unit.failureReason ? `失败摘要：${safeExecutionDetail(unit.failureReason)}` : undefined,
    unit.patchSummary ? `修改摘要：${safeExecutionDetail(unit.patchSummary)}` : undefined,
    unit.nextStep ? `下一步：${safeExecutionDetail(unit.nextStep)}` : undefined,
    unit.databaseVersions?.length ? `数据版本：${unit.databaseVersions.map(safeExecutionDetail).join('、')}` : undefined,
  ].join('\n')).join('\n\n');
  return sanitizeUserProjectionText(text) ?? text;
}

function auditMaterialLabel(unit: RuntimeExecutionUnit) {
  return auditRefCount(unit) ? '过程材料已保留' : '未声明';
}

function auditRefCount(unit: RuntimeExecutionUnit) {
  return [unit.codeRef, unit.stdoutRef, unit.stderrRef, unit.outputRef, unit.diffRef, unit.verificationRef].filter(Boolean).length;
}

function executionActionLabel(unit: RuntimeExecutionUnit) {
  const haystack = `${unit.tool} ${unit.entrypoint ?? ''} ${unit.params ?? ''}`.toLowerCase();
  if (/read|cat|sed|rg|grep|ls|find|open|inspect|search|fetch|download|读取|检索|查看|下载/.test(haystack)) return '读取/检索';
  if (/edit|write|patch|apply|diff|save|create|mutate|生成|编辑|写入|修改/.test(haystack)) return '写入/生成';
  if (/verify|validate|test|check|验证|检查|测试/.test(haystack)) return '验证';
  if (/python|node|npm|tsx|pytest|run|exec|shell|运行|执行/.test(haystack)) return '执行';
  return '处理';
}

function safeExecutionDetail(value: string | undefined) {
  const compact = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!compact) return '未声明';
  return compact
    .replace(/\bsciforge\.background-completion(?:\.v\d+)?\b/gi, '后台过程')
    .replace(/\brunId\s*=\s*[\w:-]+/gi, '本轮任务')
    .replace(/\bstageId\s*=\s*[\w:-]+/gi, '当前阶段')
    .replace(/\bverification:[\w:-]+/gi, '验证线索')
    .replace(/\bexecution-unit:[\w:-]+/gi, '过程线索')
    .replace(/\bEU-[\w:-]+/g, '过程步骤')
    .replace(/\brun-[\w:-]+/gi, '本轮任务')
    .replace(/\brun:[\w:/#.-]+/gi, '运行线索')
    .replace(/\.sciforge\/[\w./-]+/gi, '本地材料')
    .replace(/\bstdout(?:Ref)?\b/gi, '输出线索')
    .replace(/\bstderr(?:Ref)?\b/gi, '错误线索')
    .replace(/\bprovider\b/gi, '外部服务')
    .replace(/\bruntimeProfile\w*/gi, '运行配置')
    .replace(/\bExecutionUnit\b/gi, '过程步骤')
    .replace(/\braw\s*JSONL\b/gi, '诊断日志')
    .replace(/\bcodex-command-[\w-]+/gi, '本轮任务')
    .slice(0, 220);
}

function executionInputLabel(params: string | undefined) {
  const safe = safeExecutionDetail(params);
  if (safe === '{}' || safe === '未声明') return safe;
  if (/本轮任务|当前阶段|运行线索|过程线索|本地材料|验证线索/.test(safe)) return '参数已归档';
  return safe;
}

function executionFingerprintLabel(hash: string | undefined) {
  const safe = safeExecutionDetail(hash);
  if (!safe || safe === '未声明') return '已记录';
  if (/本轮任务|当前阶段|运行线索|过程线索|本地材料|验证线索/.test(safe)) return '已记录';
  return safe;
}

function executionVerdictText(unit: RuntimeExecutionUnit) {
  return executionVerificationPresentation(unit).label;
}

export function NotebookTimeline({ scenarioId, notebook = [], embedded = false }: { scenarioId: ScenarioId; notebook?: NotebookRecord[]; embedded?: boolean }) {
  const filtered = notebook;
  return (
    <div className="stack">
      <SectionHeader icon={Clock} title="研究记录" subtitle={embedded ? '完整 notebook timeline 审计记录' : '从对话到可审计 notebook timeline'} />
      {!filtered.length ? <EmptyArtifactState title="等待真实 notebook 记录" detail="Notebook 只展示当前会话运行产生的记录；全局 demo timeline 仅保留在研究时间线页面。" /> : null}
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
                <p>{item.desc}</p>
                {item.updateReason ? <p className="empty-state">updateReason: {item.updateReason}</p> : null}
                {item.artifactRefs?.length || item.executionUnitRefs?.length || item.beliefRefs?.length || item.dependencyRefs?.length ? (
                  <div className="source-list">
                    {(item.artifactRefs ?? []).map((ref) => <code key={`artifact-${item.id}-${ref}`}>artifact {ref}</code>)}
                    {(item.executionUnitRefs ?? []).map((ref) => <code key={`eu-${item.id}-${ref}`}>execution {ref}</code>)}
                    {(item.beliefRefs ?? []).map((ref) => <code key={`belief-${item.id}-${ref}`}>belief {ref}</code>)}
                    {(item.dependencyRefs ?? []).map((ref) => <code key={`dependency-${item.id}-${ref}`}>depends-on {ref}</code>)}
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
