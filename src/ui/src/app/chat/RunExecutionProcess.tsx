import type { AgentStreamEvent, ObjectReference, RuntimeExecutionUnit, SciForgeRun, SciForgeSession } from '../../domain';
import { MessageContent } from './MessageContent';
import { NativeEventStream } from './RunningWorkProcess';
import {
  artifactHasUserFacingDelivery,
  displayTitleForObjectReference,
  isUserFacingObjectReference,
  mergeObjectReferences,
  objectReferenceForArtifactSummary,
} from '../../../../../packages/support/object-references';
import {
  conversationProjectionArtifactRefs,
  conversationProjectionAuditRefs,
  conversationProjectionForSession,
  conversationProjectionStatus,
  sanitizeUserProjectionText,
  type UiConversationProjection,
} from '../conversation-projection-view-model';
import { auditExecutionUnitsForRun } from '../results/executionUnitsForRun';

type ExecutionProcessSection = {
  id: string;
  label: string;
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
  const projection = conversationProjectionForSession(session, run);
  const units = projection ? [] : auditExecutionUnitsForRun(session, run).slice(-8);
  if (!run && !units.length && !trace) return null;
  const auditObjectReferences = projection
    ? objectReferencesForProjection(projection, session, runId)
    : objectReferencesForAudit(run, session, runId);
  const nativeEvents = nativeStreamEventsForRun(run);
  const sections = projection
    ? projectionExecutionProcessSections(projection, auditObjectReferences)
    : executionProcessSections(run, units, auditObjectReferences, trace);
  const runtimeMetadata = projection?.runtimeMetadata;
  if (!sections.length && !nativeEvents.length) return null;
  return (
    <div
      className="execution-process-thread"
      aria-label="按顺序记录的工作过程"
      data-testid="chat-process-thread"
      data-process-source={nativeEvents.length ? 'native-event-stream' : projection ? 'semantic-summary' : 'recorded-summary'}
    >
      {!nativeEvents.length && runtimeMetadata ? <RuntimeMetadataRow metadata={runtimeMetadata} /> : null}
      {nativeEvents.length ? <NativeEventStream events={nativeEvents} mode="recorded" limit={18} /> : null}
      {!nativeEvents.length && sections.length ? sections.map((section) => renderExecutionProcessSection(section, onObjectFocus)) : null}
    </div>
  );
}

function renderExecutionProcessSection(
  section: ExecutionProcessSection,
  onObjectFocus: (reference: ObjectReference) => void,
) {
  const references = mergeObjectReferences(
    section.references ?? [],
    [],
    40,
  );
  return (
    <details className="message-fold depth-2 execution-process-fold cursor-step-fold" key={section.id}>
      <summary>
        <span className="cursor-step-kind">{section.label}</span>
        <span className="cursor-step-title">{section.title}</span>
        {section.meta ? <span className="cursor-step-meta">{section.meta}</span> : null}
      </summary>
      <div className="execution-process-body">
        <MessageContent
          content={section.content}
          references={references}
          onObjectFocus={onObjectFocus}
        />
      </div>
    </details>
  );
}

function nativeStreamEventsForRun(run: SciForgeRun | undefined): AgentStreamEvent[] {
  const raw = isRecord(run?.raw) ? run.raw : undefined;
  const streamProcess = isRecord(raw?.streamProcess) ? raw.streamProcess : undefined;
  const events = Array.isArray(streamProcess?.events) ? streamProcess.events : [];
  return events
    .map((event, index): AgentStreamEvent | undefined => {
      if (!isRecord(event)) return undefined;
      if (!isRecord(event.native)) return undefined;
      const type = typeof event.type === 'string' && event.type.trim() ? event.type : 'workspace-runtime-event';
      const createdAt = typeof event.createdAt === 'string' && event.createdAt.trim()
        ? event.createdAt
        : run?.createdAt ?? new Date(0).toISOString();
      const label = typeof event.label === 'string' && event.label.trim() ? event.label : type;
      const detail = typeof event.detail === 'string' ? event.detail : undefined;
      return {
        id: `${run?.id ?? 'run'}-stream-${index}`,
        type,
        label,
        detail,
        createdAt,
        raw: event,
      };
    })
    .filter((event): event is AgentStreamEvent => Boolean(event));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function RuntimeMetadataRow({ metadata }: { metadata: NonNullable<UiConversationProjection['runtimeMetadata']> }) {
  const entries = [
    metadata.provider ? ['provider', metadata.provider] : undefined,
    metadata.model ? ['model', metadata.model] : undefined,
    metadata.profile ? ['profile', metadata.profile] : undefined,
    metadata.workspace ? ['workspace', metadata.workspace] : undefined,
    metadata.commandId ? ['command', metadata.commandId] : undefined,
  ].filter((entry): entry is [string, string] => Boolean(entry));
  if (!entries.length) return null;
  return (
    <div className="runtime-trace-row" aria-label="Runtime Codex 可见追踪元数据" data-testid="runtime-metadata-row">
      <span className="runtime-trace-label">Runtime Codex</span>
      {entries.map(([label, value]) => (
        <span className="runtime-trace-item" key={label}>
          <span className="runtime-trace-key">{label}</span>
          <span className="runtime-trace-value">{value}</span>
        </span>
      ))}
      {metadata.foldedAudit ? <span className="runtime-trace-audit">raw audit folded</span> : null}
    </div>
  );
}

function projectionExecutionProcessSections(
  projection: UiConversationProjection,
  objectReferences: ObjectReference[],
): ExecutionProcessSection[] {
  const sections: ExecutionProcessSection[] = [];
  const processLines: string[] = [];
  if (projection.currentTurn?.prompt) {
    processLines.push(`接收任务：${sanitizeProcessText(projection.currentTurn.prompt)}`);
  }
  projection.executionProcess.slice(-12).forEach((event) => {
    const status = conversationProjectionStatus(projection);
    const statusLabel = projectionStatusLabel(status);
    const summary = projectionEventTitle(event.summary || event.type, status);
    processLines.push(`- ${projectionEventKindLabel(event.type)}：${summary}（${statusLabel}）`);
  });
  const producedLines = producedObjectLines(objectReferences);
  if (producedLines.length) {
    processLines.push(...producedLines.map((line) => `- ${line}`));
  }
  if (processLines.length) {
    sections.push({
      id: 'process',
      label: '过程',
      title: `${processLines.length} 条过程摘要`,
      meta: projectionStatusLabel(conversationProjectionStatus(projection)),
      content: processLines.join('\n'),
    });
  }
  const verificationLines = projectionVerificationLines(projection);
  if (verificationLines.length) {
    sections.push({
      id: 'verification',
      label: '验证',
      title: verificationSectionTitle(verificationLines),
      content: verificationLines.join('\n'),
    });
  }
  const recoveryLines = projection.recoverActions
    .map((action) => sanitizeProcessText(action))
    .filter(Boolean)
    .map((action) => `- ${action}`);
  if (recoveryLines.length) {
    sections.push({
      id: 'recovery',
      label: '恢复线索',
      title: `${recoveryLines.length} 条可执行建议`,
      content: recoveryLines.join('\n'),
    });
  }
  const diagnosticLines = projectionDiagnosticLines(projection);
  if (diagnosticLines.length) {
    sections.push({
      id: 'diagnostics',
      label: '诊断',
      title: '可追溯摘要已保留',
      content: diagnosticLines.join('\n'),
    });
  }
  return sections.slice(0, 8);
}

function executionProcessSections(
  run: SciForgeRun | undefined,
  units: RuntimeExecutionUnit[],
  objectReferences: ObjectReference[],
  trace?: string,
): ExecutionProcessSection[] {
  const sections: ExecutionProcessSection[] = [];
  const processLines: string[] = [];
  if (run?.prompt) {
    processLines.push(`接收任务：${sanitizeProcessText(run.prompt)}`);
  }
  units.forEach((unit) => {
    const verb = executionUnitVerb(unit);
    const target = executionUnitTargetSummary(unit);
    processLines.push(`- ${verb}${target ? `：${target}` : ''}（${executionStatusLabelForUser(unit.status)}）`);
    if (unit.patchSummary) processLines.push(`  - 修改摘要：${sanitizeProcessText(unit.patchSummary)}`);
  });
  const producedLines = producedObjectLines(objectReferences);
  if (producedLines.length) processLines.push(...producedLines.map((line) => `- ${line}`));
  if (processLines.length) {
    sections.push({
      id: 'process',
      label: '过程',
      title: `${processLines.length} 条过程摘要`,
      content: processLines.join('\n'),
    });
  }
  const verificationLines = units.flatMap(executionUnitVerificationLines);
  if (verificationLines.length) {
    sections.push({
      id: 'verification',
      label: '验证',
      title: verificationSectionTitle(verificationLines),
      content: verificationLines.join('\n'),
    });
  }
  const recoveryLines = units.flatMap(executionUnitRecoveryLines);
  if (recoveryLines.length) {
    sections.push({
      id: 'recovery',
      label: '恢复线索',
      title: `${recoveryLines.length} 条可执行建议`,
      content: recoveryLines.join('\n'),
    });
  }
  const diagnosticLines = executionUnitDiagnosticLines(units);
  if (trace) {
    diagnosticLines.push(`- 过程摘录：${sanitizeProcessText(compactAuditText(trace, 1200))}`);
  }
  if (diagnosticLines.length) {
    sections.push({
      id: 'diagnostics',
      label: '诊断',
      title: '可追溯摘要已保留',
      content: diagnosticLines.join('\n'),
    });
  }
  return sections.slice(0, 8);
}

function objectReferencesForAudit(run: SciForgeRun | undefined, session: SciForgeSession, runId: string) {
  if (!run) return [];
  const runArtifactRefs = new Set((run.objectReferences ?? [])
    .filter((reference) => reference.kind === 'artifact')
    .map((reference) => reference.ref.replace(/^artifact:/i, '')));
  const runArtifacts = session.artifacts
    .filter((artifact) => (runArtifactRefs.has(artifact.id) || artifact.metadata?.runId === runId) && artifactHasUserFacingDelivery(artifact))
    .map((artifact) => objectReferenceForArtifactSummary(artifact, runId));
  return mergeObjectReferences(run.objectReferences ?? [], runArtifacts, 40).filter(isProcessObjectReference);
}

function objectReferencesForProjection(projection: UiConversationProjection, session: SciForgeSession, runId: string) {
  const artifactIds = new Set(conversationProjectionArtifactRefs(projection).map((ref) => ref.replace(/^artifact::?/i, '')));
  const projectionArtifacts = session.artifacts
    .filter((artifact) => artifactIds.has(artifact.id) && artifactHasUserFacingDelivery(artifact))
    .map((artifact) => objectReferenceForArtifactSummary(artifact, runId));
  return mergeObjectReferences(projectionArtifacts, [], 40).filter(isProcessObjectReference);
}

function isProcessObjectReference(reference: ObjectReference) {
  return isUserFacingObjectReference(reference)
    && !containsInternalProcessText(reference.ref)
    && !containsInternalProcessText(reference.title)
    && !containsInternalProcessText(reference.summary)
    && !containsInternalProcessText(reference.provenance?.path)
    && !containsInternalProcessText(reference.provenance?.dataRef);
}

function producedObjectLines(references: ObjectReference[]) {
  return references
    .filter((reference) => reference.kind === 'artifact' || reference.kind === 'file' || reference.kind === 'folder')
    .slice(0, 8)
    .map((reference) => {
      const summary = reference.summary ? `，${sanitizeProcessText(compactAuditText(reference.summary, 120))}` : '';
      return `产物：${sanitizeProcessText(displayTitleForObjectReference(reference))}${summary}`;
    });
}

function projectionStatusLabel(status: ReturnType<typeof conversationProjectionStatus>) {
  const labels: Record<ReturnType<typeof conversationProjectionStatus>, string> = {
    idle: '未执行',
    planned: '已计划',
    dispatched: '已分发',
    'partial-ready': '部分结果',
    'output-materialized': '已保存输出',
    validated: '已验证边界',
    'visible-not-live-acceptance': '回答已显示',
    satisfied: '完成',
    'degraded-result': '降级结果',
    'external-blocked': '外部阻塞',
    'repair-needed': '需恢复',
    'needs-human': '需人工处理',
    'background-running': '后台继续中',
  };
  return labels[status];
}

function projectionEventKindLabel(type: string) {
  if (/native.?codex.?message/i.test(type)) return '回答';
  if (/materialized|artifact|output/i.test(type)) return '产物';
  if (/verification|validate/i.test(type)) return '验证';
  return '过程';
}

function projectionEventTitle(summary: string, status: ReturnType<typeof conversationProjectionStatus>) {
  if (status === 'visible-not-live-acceptance' || /native.?codex.?message/i.test(summary)) {
    return '回答已在聊天中显示';
  }
  return sanitizeProcessText(compactAuditText(summary, 96));
}

function projectionVerificationLines(projection: UiConversationProjection) {
  const verdict = projection.verificationState?.verdict ?? projection.verificationState?.status;
  if (!verdict) return [];
  return [`验证状态：${verificationVerdictLabelForUser(verdict)}。`];
}

function projectionDiagnosticLines(projection: UiConversationProjection) {
  const lines: string[] = [];
  const diagnostics = projection.diagnostics
    .map((diagnostic) => sanitizeProcessText(diagnostic.message))
    .filter(Boolean)
    .slice(0, 5);
  if (diagnostics.length) lines.push(...diagnostics.map((diagnostic) => `- ${diagnostic}`));
  const auditSummary = auditRefSummary(conversationProjectionAuditRefs(projection));
  if (auditSummary) lines.push(`- 可追溯摘要：${auditSummary}。`);
  return lines;
}

function verificationSectionTitle(lines: string[]) {
  const text = lines.join('\n');
  if (/未通过|需人工|不确定/.test(text)) return '需要关注验证结果';
  if (/已验证/.test(text)) return '已完成验证';
  return '验证摘要';
}

function executionUnitVerificationLines(unit: RuntimeExecutionUnit) {
  const label = verificationLabelForUnit(unit);
  return label ? [`- ${label}`] : [];
}

function executionUnitRecoveryLines(unit: RuntimeExecutionUnit) {
  return [
    ...(unit.recoverActions ?? []).map((action) => `- ${sanitizeProcessText(compactAuditText(action, 180))}`),
    unit.nextStep ? `- 下一步：${sanitizeProcessText(compactAuditText(unit.nextStep, 180))}` : '',
    unit.selfHealReason ? `- 自修复说明：${sanitizeProcessText(compactAuditText(unit.selfHealReason, 180))}` : '',
  ].filter(Boolean);
}

function executionUnitDiagnosticLines(units: RuntimeExecutionUnit[]) {
  const lines: string[] = [];
  const failedUnits = units.filter((unit) => ['failed', 'failed-with-reason', 'repair-needed', 'needs-human'].includes(unit.status));
  if (failedUnits.length) lines.push(`- 失败边界：${failedUnits.length} 条记录需要关注。`);
  units.forEach((unit) => {
    if (unit.failureReason) lines.push(`- 失败摘要：${sanitizeProcessText(compactAuditText(unit.failureReason, 220))}`);
  });
  const refs = units.flatMap((unit) => [
    unit.codeRef,
    unit.diffRef,
    unit.outputRef,
    unit.stdoutRef,
    unit.stderrRef,
    ...(unit.inputData ?? []),
    ...(unit.outputArtifacts ?? []).map((artifactId) => `artifact:${artifactId}`),
    unit.verificationRef,
  ]).filter((ref): ref is string => Boolean(ref));
  const summary = auditRefSummary(refs);
  if (summary) lines.push(`- 可追溯摘要：${summary}。`);
  return lines.slice(0, 10);
}

function verificationLabelForUnit(unit: RuntimeExecutionUnit) {
  const verdict = unit.verificationVerdict;
  if (verdict) return `验证状态：${verificationVerdictLabelForUser(verdict)}。`;
  if (unit.status === 'running' && (unit.verificationRef || unit.outputArtifacts?.length || unit.artifacts?.length || unit.outputRef)) {
    return '验证状态：验证中。';
  }
  if (unit.status === 'done') return '验证状态：未请求额外验证。';
  return undefined;
}

function verificationVerdictLabelForUser(verdict: string) {
  const labels: Record<string, string> = {
    pass: '已验证',
    fail: '未通过',
    uncertain: '不确定',
    'needs-human': '需人工核验',
    unverified: '未验证',
    'not-required': '无需额外验证',
    'native-message': '回答已显示',
  };
  return labels[verdict] ?? sanitizeProcessText(verdict);
}

function auditRefSummary(refs: string[]) {
  const counts = refs.reduce<Record<string, number>>((accumulator, ref) => {
    const kind = auditRefKindForUser(ref);
    accumulator[kind] = (accumulator[kind] ?? 0) + 1;
    return accumulator;
  }, {});
  const parts = Object.entries(counts).map(([kind, count]) => `${count} 条${kind}`);
  return parts.join('、');
}

function auditRefKindForUser(ref: string) {
  const value = ref.toLowerCase();
  if (/stdout|stderr|jsonl|trace|debug|log/.test(value)) return '执行日志';
  if (/execution-unit/.test(value)) return '执行记录';
  if (/artifact/.test(value)) return '产物记录';
  if (/verification|validate/.test(value)) return '验证记录';
  if (/file|folder|\.[a-z0-9]+(?:[#?].*)?$/.test(value)) return '文件记录';
  if (/run/.test(value)) return '过程记录';
  return '审计记录';
}

function executionUnitVerb(unit: RuntimeExecutionUnit) {
  const text = `${unit.tool} ${unit.entrypoint || ''} ${unit.params || ''} ${unit.codeRef || ''} ${unit.diffRef || ''}`.toLowerCase();
  if (/edit|write|patch|apply|diff|save|mutate|create|生成|编辑|写入|修改/.test(text)) return '编辑文件';
  if (/read|cat|sed|rg|grep|ls|find|open|inspect|explore|读取|检索|查看|探索/.test(text)) return '探索文件';
  if (/python|node|npm|pnpm|yarn|tsx|pytest|vitest|test|build|run|exec|运行|执行/.test(text)) return '运行程序';
  return '执行步骤';
}

function executionUnitTargetSummary(unit: RuntimeExecutionUnit) {
  const refs = [
    formatExecutionRef(unit.entrypoint),
    formatExecutionRef(unit.codeRef),
    formatExecutionRef(unit.diffRef),
    formatExecutionRef(unit.outputRef),
    ...(unit.inputData ?? []).map(formatExecutionRef),
    ...(unit.outputArtifacts ?? []).map((artifactId) => `artifact:${artifactId}`),
  ].filter((ref): ref is string => Boolean(ref) && !containsInternalProcessText(ref)).slice(0, 4);
  if (!refs.length) return '';
  return `涉及 ${refs.map(executionRefLabelForUser).join('、')}`;
}

function executionRefLabelForUser(ref: string) {
  const normalized = ref.replace(/^[a-z-]+:{1,2}/i, '');
  const segment = normalized.split(/[/?#]/).filter(Boolean).at(-1) ?? normalized;
  if (!segment || containsInternalProcessText(segment)) return '记录对象';
  return sanitizeProcessText(segment);
}

function formatExecutionRef(value?: string) {
  if (!value) return '';
  if (/^(artifact|file|folder|run|execution-unit|scenario-package)::?/i.test(value) || /^https?:\/\//i.test(value)) return value;
  if (/^\.?\/?[\w.-/]+(?:\.[a-z0-9]+)(?:[#?].*)?$/i.test(value)) return `file::${value.replace(/^\.\//, '')}`;
  return value;
}

function executionStatusLabelForUser(status: RuntimeExecutionUnit['status'] | string | undefined) {
  if (status === 'done') return '完成';
  if (status === 'self-healed') return '已自修复';
  if (status === 'failed' || status === 'failed-with-reason') return '失败';
  if (status === 'repair-needed') return '需要恢复';
  if (status === 'needs-human') return '需要人工处理';
  if (status === 'record-only') return '仅记录';
  if (status === 'planned') return '已计划';
  if (status === 'running') return '进行中';
  return status ? sanitizeProcessText(status) : '未知';
}

function sanitizeProcessText(value: string) {
  return compactAuditText(sanitizeUserProjectionText(value) ?? value, 2400)
    .replace(/\bConversationProjection\b/g, '对话摘要')
    .replace(/\bExecutionUnit\b/g, '执行记录')
    .replace(/\bArtifactDelivery\b/g, '产物交付')
    .replace(/\bProjection output materialized\b/gi, '产物已保存')
    .replace(/\bProjection\b/g, '结果')
    .replace(/\bnative-message\b/gi, '回答已显示')
    .replace(/\blive-runtime-codex\b/gi, '实时回答')
    .replace(/\braw\s+JSONL\b/gi, '诊断日志')
    .replace(/\braw\b/gi, '原始记录')
    .replace(/\bSSE\b/g, '流式事件')
    .replace(/\bprovider\b/gi, '服务配置')
    .replace(/\brun\s*id\b/gi, '运行编号')
    .replace(/\brunId\b/g, '运行编号')
    .replace(/\bOutputMaterialized\b/g, '产物已保存')
    .replace(/\bSatisfied\b/g, '已完成')
    .replace(/\bNo verification requested\b/g, '未请求额外验证')
    .replace(/\bUnverified\b/g, '未验证')
    .replace(/\bVerifying\b/g, '验证中')
    .replace(/\bVerification failed\b/g, '验证未通过')
    .replace(/\bVerification passed\b/g, '已验证');
}

function containsInternalProcessText(value: string | undefined) {
  return typeof value === 'string' && /(?:\b(?:ConversationProjection|ExecutionUnit|ArtifactDelivery|native-message|live-runtime-codex|raw\s+JSONL|raw|SSE|stdout|stderr|provider|run\s*id|runId|execution-unit)\b|(?:^|[#:/])EU-[\w-]+|^run:)/i.test(value);
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
  const projection = conversationProjectionForSession(session, run);
  if (!projection && run?.status === 'failed') return null;
  const objectRefs = mergeObjectReferences(
    run?.objectReferences ?? [],
    projection ? objectReferencesForProjection(projection, session, runId) : [],
    40,
  ).filter(isUserFacingObjectReference);
  const artifactRefIds = new Set(objectRefs.filter((ref) => ref.kind === 'artifact').map((ref) => ref.ref.replace(/^artifact:/, '')));
  for (const ref of projection ? conversationProjectionArtifactRefs(projection) : []) {
    artifactRefIds.add(ref.replace(/^artifact::?/i, ''));
  }
  const artifactReferences = session.artifacts
    .filter((artifact) => (artifactRefIds.has(artifact.id) || artifact.metadata?.runId === runId) && artifactHasUserFacingDelivery(artifact))
    .map((artifact) => objectReferenceForArtifactSummary(artifact, runId))
    .filter(isUserFacingObjectReference)
    .slice(0, 4);
  const deliverableReferences = mergeObjectReferences(
    artifactReferences,
    objectRefs.filter((reference) => reference.kind === 'artifact' || reference.kind === 'file' || reference.kind === 'folder'),
    8,
  ).slice(0, 4);
  const artifacts = session.artifacts.filter((artifact) => deliverableReferences.some((reference) => reference.ref === `artifact:${artifact.id}`));
  const claims = claimsForRun(session, runId, artifacts.map((artifact) => artifact.id)).slice(0, 3);
  if (!deliverableReferences.length && !claims.length) return null;
  const artifactLinks = deliverableReferences.map((reference) => displayTitleForObjectReference(reference)).join('、');
  const keyProse = [
    deliverableReferences.length ? `关键结果：${artifactLinks}。` : '本轮没有生成新的可预览对象。',
    claims.length ? `已提取 ${claims.length} 条判断。` : '',
    '过程记录已折叠在下方。',
  ].filter(Boolean).join(' ');
  return (
    <div className="message-key-info" aria-label="本轮关键信息">
      <div className="message-key-info-head">
        <strong>本轮结果</strong>
        <span>{deliverableReferences.length} 个对象 · {claims.length} 条判断</span>
      </div>
      <div className="message-key-prose">
        <MessageContent content={keyProse} references={deliverableReferences} onObjectFocus={onObjectFocus ?? (() => undefined)} />
      </div>
      {claims.length ? (
        <div className="message-key-list">
          {claims.map((claim, index) => (
            <p key={`${claim.id || 'claim'}-${index}`} className="message-key-row">
              <span>判断：{sanitizeUserProjectionText(claim.text) ?? claim.text}</span>
              <small>{claim.evidenceLevel} · 置信度 {Math.round(claim.confidence * 100)}%</small>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
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
