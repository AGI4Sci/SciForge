import { useState } from 'react';
import { structureSummaryMetricPresentation } from '@sciforge/interactive-views';
import { ChevronDown, ChevronUp, Clock, Download, FileCode, Lock, Shield } from 'lucide-react';
import { buildExecutionBundle, evaluateExecutionBundleExport } from '../../exportPolicy';
import { scenarios, type ScenarioId } from '../../data';
import type { EvidenceClaim, NotebookRecord, RuntimeArtifact, RuntimeExecutionUnit, SciForgeSession } from '../../domain';
import { exportJsonFile } from '../exportUtils';
import { ActionButton, Badge, Card, ClaimTag, ConfidenceBar, EmptyArtifactState, EvidenceTag, SectionHeader } from '../uiPrimitives';
import { UploadedDataUrlPreview } from './WorkspaceObjectPreview';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactParams(params: string) {
  return params.length > 128 ? `${params.slice(0, 125)}...` : params;
}

function exportExecutionBundle(session: SciForgeSession) {
  const decision = evaluateExecutionBundleExport(session);
  if (!decision.allowed) {
    window.alert(`导出被 artifact policy 阻止：${decision.blockedArtifactIds.join(', ')}`);
    return;
  }
  exportJsonFile(`execution-units-${session.scenarioId}-${session.sessionId}.json`, buildExecutionBundle(session, decision));
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

function uploadedEvidenceArtifacts(artifacts: RuntimeArtifact[]) {
  return artifacts.filter((artifact) => artifact.metadata?.source === 'user-upload' || /^uploaded-/.test(artifact.type));
}

export function EvidenceMatrix({ claims, artifacts = [] }: { claims: EvidenceClaim[]; artifacts?: RuntimeArtifact[] }) {
  const [expandedClaim, setExpandedClaim] = useState<string | null>(null);
  const [expandedUpload, setExpandedUpload] = useState<string | null>(null);
  const uploads = uploadedEvidenceArtifacts(artifacts);
  const rows = claims.map((claim, index) => ({
    id: `${claim.id || 'claim'}-${index}`,
    claim: claim.text,
    support: `${claim.supportingRefs.length} 条支持`,
    oppose: `${claim.opposingRefs.length} 条反向`,
    level: claim.evidenceLevel,
    type: claim.type,
    supportingRefs: claim.supportingRefs,
    opposingRefs: claim.opposingRefs,
    dependencyRefs: claim.dependencyRefs ?? [],
    updateReason: claim.updateReason,
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
  embedded = false,
}: {
  session: SciForgeSession;
  executionUnits: RuntimeExecutionUnit[];
  embedded?: boolean;
}) {
  const rows = executionUnits;
  return (
    <div className="stack">
      <SectionHeader
        icon={Lock}
        title="可复现执行单元"
        subtitle={embedded ? '完整 ExecutionUnit、stdout/stderr refs 和数据指纹' : '代码 + 参数 + 环境 + 数据指纹'}
        action={<ActionButton icon={Download} variant="secondary" onClick={() => exportExecutionBundle(session)}>导出 JSON Bundle</ActionButton>}
      />
      {rows.length ? (
        <div className="eu-table">
          <div className="eu-head">
            <span>EU ID</span>
            <span>Tool</span>
            <span>Params</span>
            <span>Code Artifact</span>
            <span>Status</span>
            <span>Hash</span>
          </div>
          {rows.map((unit, index) => (
            <div className="eu-row" key={`${unit.id}-${unit.hash || index}-${index}`}>
              <code>{unit.id}</code>
              <span>{unit.tool}</span>
              <code title={unit.params}>{compactParams(unit.params)}</code>
              <code title={[unit.codeRef, unit.stdoutRef, unit.stderrRef].filter(Boolean).join('\n') || unit.code || ''}>
                {unit.codeRef || unit.language || unit.code || 'n/a'}
              </code>
              <Badge variant={executionStatusVariant(unit.status)}>{unit.status}</Badge>
              <code>{unit.hash}</code>
              {executionStatusDetail(unit) ? (
                <div className="eu-detail">
                  {executionStatusDetail(unit)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : <EmptyArtifactState title="等待真实 ExecutionUnit" detail="执行面板只展示当前会话的 runtime executionUnits，不再填充 demo 执行记录。" />}
      <Card className="code-card">
        <SectionHeader icon={FileCode} title="环境定义" />
        <pre>{executionEnvironmentText(rows)}</pre>
      </Card>
    </div>
  );
}

function executionStatusVariant(status: RuntimeExecutionUnit['status']): 'info' | 'success' | 'warning' | 'danger' | 'muted' | 'coral' {
  if (status === 'done' || status === 'self-healed') return 'success';
  if (status === 'failed' || status === 'failed-with-reason') return 'danger';
  if (status === 'repair-needed') return 'warning';
  if (status === 'planned' || status === 'record-only') return 'muted';
  return 'info';
}

function executionStatusDetail(unit: RuntimeExecutionUnit) {
  const lines = [
    unit.attempt ? `attempt=${unit.attempt}` : undefined,
    unit.parentAttempt ? `parentAttempt=${unit.parentAttempt}` : undefined,
    unit.runtimeProfileId ? `runtimeProfile=${unit.runtimeProfileId}` : undefined,
    unit.routeDecision?.selectedSkill ? `selectedSkill=${unit.routeDecision.selectedSkill}` : undefined,
    unit.routeDecision?.selectedRuntime ? `selectedRuntime=${unit.routeDecision.selectedRuntime}` : undefined,
    unit.routeDecision?.fallbackReason ? `fallback=${unit.routeDecision.fallbackReason}` : undefined,
    unit.scenarioPackageRef ? `package=${unit.scenarioPackageRef.id}@${unit.scenarioPackageRef.version}` : undefined,
    unit.skillPlanRef ? `skillPlan=${unit.skillPlanRef}` : undefined,
    unit.uiPlanRef ? `uiPlan=${unit.uiPlanRef}` : undefined,
    unit.selfHealReason ? `selfHealReason=${unit.selfHealReason}` : undefined,
    unit.failureReason ? `failureReason=${unit.failureReason}` : undefined,
    unit.requiredInputs?.length ? `requiredInputs=${unit.requiredInputs.join(', ')}` : undefined,
    unit.recoverActions?.length ? `recover=${unit.recoverActions.join(' | ')}` : undefined,
    unit.nextStep ? `nextStep=${unit.nextStep}` : undefined,
    unit.patchSummary ? `patchSummary=${unit.patchSummary}` : undefined,
    unit.diffRef ? `diffRef=${unit.diffRef}` : undefined,
    unit.stdoutRef ? `stdout=${unit.stdoutRef}` : undefined,
    unit.stderrRef ? `stderr=${unit.stderrRef}` : undefined,
    unit.outputRef ? `output=${unit.outputRef}` : undefined,
  ].filter(Boolean);
  return lines.length ? lines.join(' · ') : '';
}

function executionEnvironmentText(rows: RuntimeExecutionUnit[]) {
  if (!rows.length) return 'No runtime execution units yet.';
  return rows.map((unit) => [
    `id: ${unit.id}`,
    `tool: ${unit.tool}`,
    `language: ${unit.language || 'unspecified'}`,
    `codeRef: ${unit.codeRef || unit.code || 'n/a'}`,
    `entrypoint: ${unit.entrypoint || 'n/a'}`,
    `environment: ${unit.environment || 'n/a'}`,
    `stdoutRef: ${unit.stdoutRef || 'n/a'}`,
    `stderrRef: ${unit.stderrRef || 'n/a'}`,
    `outputRef: ${unit.outputRef || 'n/a'}`,
    `runtimeProfileId: ${unit.runtimeProfileId || 'n/a'}`,
    `selectedSkill: ${unit.routeDecision?.selectedSkill || 'n/a'}`,
    `selectedRuntime: ${unit.routeDecision?.selectedRuntime || 'n/a'}`,
    `fallbackReason: ${unit.routeDecision?.fallbackReason || 'n/a'}`,
    `scenarioPackageRef: ${unit.scenarioPackageRef ? `${unit.scenarioPackageRef.id}@${unit.scenarioPackageRef.version}:${unit.scenarioPackageRef.source}` : 'n/a'}`,
    `skillPlanRef: ${unit.skillPlanRef || 'n/a'}`,
    `uiPlanRef: ${unit.uiPlanRef || 'n/a'}`,
    `attempt: ${unit.attempt || 'n/a'}`,
    `parentAttempt: ${unit.parentAttempt || 'n/a'}`,
    `selfHealReason: ${unit.selfHealReason || 'n/a'}`,
    `failureReason: ${unit.failureReason || 'n/a'}`,
    `patchSummary: ${unit.patchSummary || 'n/a'}`,
    `diffRef: ${unit.diffRef || 'n/a'}`,
    `requiredInputs: ${(unit.requiredInputs ?? []).join(', ') || 'n/a'}`,
    `recoverActions: ${(unit.recoverActions ?? []).join(' | ') || 'n/a'}`,
    `nextStep: ${unit.nextStep || 'n/a'}`,
    `databases: ${(unit.databaseVersions ?? []).join(', ') || 'n/a'}`,
  ].join('\n')).join('\n\n');
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
