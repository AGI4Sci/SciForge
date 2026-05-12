import type { ObjectReference, RuntimeArtifact, RuntimeExecutionUnit, SciForgeRun, SciForgeSession } from '../../domain';
import { Badge } from '../uiPrimitives';
import { MessageContent, objectReferencesFromInlineTokens } from './MessageContent';
import { ObjectReferenceChips } from './ReferenceChips';
import {
  mergeObjectReferences,
  objectReferenceForArtifactSummary,
} from '../../../../../packages/support/object-references';
import { executionStatusLabel, executionStatusShortLabel } from '../results/executionStatusPresentation';
import { executionUnitsForRun } from '../results/executionUnitsForRun';

type ExecutionProcessStep = {
  id: string;
  kind: string;
  title: string;
  meta?: string;
  content: string;
  references?: ObjectReference[];
};

export function RunExecutionProcess({
  runId,
  session,
  trace,
  onObjectFocus,
}: {
  runId: string;
  session: SciForgeSession;
  trace?: string;
  onObjectFocus: (reference: ObjectReference) => void;
}) {
  const run = session.runs.find((item) => item.id === runId);
  const units = executionUnitsForRun(session, run).slice(-8);
  if (!run && !units.length && !trace) return null;
  const auditObjectReferences = objectReferencesForAudit(run, session, runId);
  const steps = executionProcessSteps(run, units, auditObjectReferences, trace);
  if (!steps.length) return null;
  return (
    <div className="execution-process-thread" aria-label="按顺序记录的工作过程">
      {steps.map((step) => {
        const references = mergeObjectReferences(
          objectReferencesFromInlineTokens(step.content, runId),
          step.references ?? auditObjectReferences,
          40,
        );
        return (
          <details className="message-fold depth-2 execution-process-fold cursor-step-fold" key={step.id}>
            <summary>
              <span className="cursor-step-kind">{step.kind}</span>
              <span className="cursor-step-title">{step.title}</span>
              {step.meta ? <span className="cursor-step-meta">{step.meta}</span> : null}
            </summary>
            <div className="execution-process-body">
              <MessageContent
                content={step.content}
                references={references}
                onObjectFocus={onObjectFocus}
              />
            </div>
          </details>
        );
      })}
    </div>
  );
}

function executionProcessSteps(
  run: SciForgeRun | undefined,
  units: RuntimeExecutionUnit[],
  objectReferences: ObjectReference[],
  trace?: string,
): ExecutionProcessStep[] {
  const steps: ExecutionProcessStep[] = [];
  if (run?.prompt) {
    steps.push({
      id: 'prompt',
      kind: 'Received',
      title: compactAuditText(run.prompt, 96),
      content: `接收任务：${run.prompt}`,
    });
  }
  units.forEach((unit, index) => {
    const verb = executionUnitVerb(unit);
    const target = executionUnitTarget(unit);
    const details = executionUnitDetails(unit);
    steps.push({
      id: `unit-${unit.id || index}`,
      kind: cursorStepKindForUnit(unit, verb),
      title: `${unit.tool}${target ? ` · ${target}` : ''}`,
      meta: [executionStatusLabel(unit.status), unit.time].filter(Boolean).join(' · '),
      content: [
        `${verb}：${unit.tool}${target ? `，${target}` : ''}。`,
        `状态：${executionStatusLabel(unit.status)}${unit.time ? `，时间：${unit.time}` : ''}。`,
        ...details.map((detail) => `- ${detail}`),
      ].join('\n'),
    });
  });
  producedObjectLines(objectReferences).forEach((line, index) => {
    steps.push({
      id: `object-${index}`,
      kind: 'Created',
      title: compactAuditText(line, 96),
      content: line,
      references: objectReferences,
    });
  });
  if (trace) {
    steps.push({
      id: 'trace',
      kind: 'Thought',
      title: 'briefly',
      content: `过程摘要与完整 trace：${compactAuditText(trace, 1200)}`,
    });
  }
  return steps.slice(0, 24);
}

function objectReferencesForAudit(run: SciForgeRun | undefined, session: SciForgeSession, runId: string) {
  if (!run) return [];
  const runArtifactRefs = new Set((run.objectReferences ?? [])
    .filter((reference) => reference.kind === 'artifact')
    .map((reference) => reference.ref.replace(/^artifact:/i, '')));
  const runArtifacts = session.artifacts
    .filter((artifact) => runArtifactRefs.has(artifact.id) || artifact.metadata?.runId === runId)
    .map((artifact) => objectReferenceForArtifactSummary(artifact, runId));
  return mergeObjectReferences(run.objectReferences ?? [], runArtifacts, 40);
}

function cursorStepKindForUnit(unit: RuntimeExecutionUnit, verb: string) {
  if (unit.status === 'failed' || unit.status === 'failed-with-reason' || unit.status === 'repair-needed' || unit.status === 'needs-human') {
    return executionStatusShortLabel(unit.status);
  }
  if (verb === '探索文件') return 'Explored';
  if (verb === '编辑文件') return 'Edited';
  if (verb === '运行程序') return 'Ran';
  return 'Checked';
}

function producedObjectLines(references: ObjectReference[]) {
  return references
    .filter((reference) => reference.kind === 'artifact' || reference.kind === 'file' || reference.kind === 'folder')
    .slice(0, 8)
    .map((reference) => `产生/引用对象：${reference.title}（${reference.ref}）${reference.summary ? `，${compactAuditText(reference.summary, 120)}` : ''}`);
}

function executionUnitVerb(unit: RuntimeExecutionUnit) {
  const text = `${unit.tool} ${unit.entrypoint || ''} ${unit.params || ''} ${unit.codeRef || ''} ${unit.diffRef || ''}`.toLowerCase();
  if (/edit|write|patch|apply|diff|save|mutate|create|生成|编辑|写入|修改/.test(text)) return '编辑文件';
  if (/read|cat|sed|rg|grep|ls|find|open|inspect|explore|读取|检索|查看|探索/.test(text)) return '探索文件';
  if (/python|node|npm|pnpm|yarn|tsx|pytest|vitest|test|build|run|exec|运行|执行/.test(text)) return '运行程序';
  return '执行步骤';
}

function executionUnitTarget(unit: RuntimeExecutionUnit) {
  const refs = [
    formatExecutionRef(unit.entrypoint),
    formatExecutionRef(unit.codeRef),
    formatExecutionRef(unit.diffRef),
    formatExecutionRef(unit.outputRef),
    formatExecutionRef(unit.stdoutRef),
    formatExecutionRef(unit.stderrRef),
    ...(unit.inputData ?? []).map(formatExecutionRef),
    ...(unit.outputArtifacts ?? []).map((artifactId) => `artifact:${artifactId}`),
  ].filter(Boolean).slice(0, 4);
  return refs.length ? `涉及 ${refs.join('、')}` : '';
}

function executionUnitDetails(unit: RuntimeExecutionUnit) {
  const priorityDetails = [
    unit.failureReason ? `失败原因：${unit.failureReason}` : '',
    unit.recoverActions?.length ? `恢复动作：${unit.recoverActions.map((action) => compactAuditText(action, 180)).join('；')}` : '',
    unit.nextStep ? `下一步：${compactAuditText(unit.nextStep, 180)}` : '',
    unit.selfHealReason ? `自修复说明：${unit.selfHealReason}` : '',
  ];
  const supportingDetails = [
    unit.params ? `参数：${compactAuditText(unit.params, 180)}` : '',
    unit.codeRef ? `代码位置：${formatExecutionRef(unit.codeRef)}` : '',
    unit.code ? `执行代码：${compactAuditText(unit.code, 220)}` : '',
    unit.diffRef ? `编辑 diff：${formatExecutionRef(unit.diffRef)}` : '',
    unit.stdoutRef ? `标准输出：${formatExecutionRef(unit.stdoutRef)}` : '',
    unit.stderrRef ? `错误输出：${formatExecutionRef(unit.stderrRef)}` : '',
    unit.outputRef ? `输出：${formatExecutionRef(unit.outputRef)}` : '',
    unit.patchSummary ? `修改摘要：${unit.patchSummary}` : '',
  ];
  return [...priorityDetails, ...supportingDetails].filter(Boolean).slice(0, 5);
}

function formatExecutionRef(value?: string) {
  if (!value) return '';
  if (/^(artifact|file|folder|run|execution-unit|scenario-package)::?/i.test(value) || /^https?:\/\//i.test(value)) return value;
  if (/^\.?\/?[\w.-/]+(?:\.[a-z0-9]+)(?:[#?].*)?$/i.test(value)) return `file::${value.replace(/^\.\//, '')}`;
  return value;
}

function compactAuditText(value: string, limit: number) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

export function RunKeyInfo({
  runId,
  session,
  onObjectFocus,
}: {
  runId: string;
  session: SciForgeSession;
  onObjectFocus?: (reference: ObjectReference) => void;
}) {
  const run = session.runs.find((item) => item.id === runId);
  if (run?.status === 'failed') return null;
  const objectRefs = run?.objectReferences ?? [];
  const artifactRefIds = new Set(objectRefs.filter((ref) => ref.kind === 'artifact').map((ref) => ref.ref.replace(/^artifact:/, '')));
  const artifacts = session.artifacts
    .filter((artifact) => artifactRefIds.has(artifact.id) || artifact.metadata?.runId === runId)
    .slice(0, 4);
  const artifactReferences = artifacts.map((artifact) => objectReferenceForArtifactSummary(artifact, runId));
  const claims = claimsForRun(session, runId, artifacts.map((artifact) => artifact.id)).slice(0, 3);
  if (!artifacts.length && !claims.length) return null;
  const objectNames = artifacts.map(artifactTitle).join('、') || '暂无新对象';
  return (
    <div className="message-key-info" aria-label="本轮关键信息">
      <div className="message-key-info-head">
        <strong>本轮结果</strong>
        <span>{artifacts.length} objects · {claims.length} claims</span>
      </div>
      <p className="message-key-prose">
        {artifacts.length ? `关键对象：${objectNames}。` : '本轮没有生成新的可预览对象。'}
        {claims.length ? ` 已提取 ${claims.length} 条判断。` : ''}
        <span> 过程记录已折叠在下方。</span>
      </p>
      {artifactReferences.length ? (
        <ObjectReferenceChips references={artifactReferences} onFocus={onObjectFocus ?? (() => undefined)} />
      ) : null}
      {claims.length ? (
        <div className="message-key-list">
          {claims.map((claim) => (
            <p key={claim.id} className="message-key-row">
              <span>判断：{claim.text}</span>
              <small>{claim.evidenceLevel} · confidence {Math.round(claim.confidence * 100)}%</small>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function artifactTitle(artifact: RuntimeArtifact) {
  return String(artifact.metadata?.title || artifact.metadata?.name || artifact.id);
}

function claimsForRun(session: SciForgeSession, runId: string, artifactIds: string[]) {
  const run = session.runs.find((item) => item.id === runId);
  const runRefTokens = new Set([
    runId,
    `run:${runId}`,
    ...artifactIds,
    ...artifactIds.map((id) => `artifact:${id}`),
    ...(run?.objectReferences ?? []).map((reference) => reference.ref),
  ].filter(Boolean));
  const start = run?.createdAt ? Date.parse(run.createdAt) : Number.NaN;
  const end = run?.completedAt ? Date.parse(run.completedAt) : Number.NaN;
  return session.claims.filter((claim) => {
    const refs = [...claim.supportingRefs, ...claim.opposingRefs, ...(claim.dependencyRefs ?? [])];
    if (refs.some((ref) => runRefTokens.has(ref))) return true;
    const updated = Date.parse(claim.updatedAt);
    return Number.isFinite(start)
      && Number.isFinite(updated)
      && updated >= start
      && (!Number.isFinite(end) || updated <= end + 5000);
  });
}
