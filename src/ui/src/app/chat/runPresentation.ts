import { presentStreamEvent } from '../../streamEventPresentation';
import type { AgentStreamEvent, GuidanceQueueRecord, NormalizedAgentResponse, SciForgeSession } from '../../domain';
import type { SupportedLocale } from '../../i18n';
import type { BadgeVariant } from '../uiPrimitives';
import { attachGuidanceQueueToResponse, attachProcessRecoveryToFailedSession } from './sessionTransforms';
import { chatText } from './chatI18n';

export function guidanceStatusLabel(status: GuidanceQueueRecord['status'], locale?: SupportedLocale) {
  if (status === 'merged') return chatText(locale, { 'zh-CN': '引导已合并', 'en-US': 'Guidance merged' });
  if (status === 'rejected') return chatText(locale, { 'zh-CN': '引导已拒绝', 'en-US': 'Guidance rejected' });
  if (status === 'deferred') return chatText(locale, { 'zh-CN': '引导待下一轮', 'en-US': 'Guidance deferred' });
  return chatText(locale, { 'zh-CN': '引导已排队', 'en-US': 'Guidance queued' });
}

export function guidanceBadgeVariant(status: GuidanceQueueRecord['status']): BadgeVariant {
  if (status === 'merged') return 'success';
  if (status === 'rejected') return 'danger';
  return 'warning';
}

export function attachStreamProcessToResponse(response: NormalizedAgentResponse, events: AgentStreamEvent[], guidanceQueue: GuidanceQueueRecord[] = []): NormalizedAgentResponse {
  const responseWithGuidance = attachGuidanceQueueToResponse(
    response,
    guidanceQueue,
    'deferred',
    '当前 run 已经在执行中，追加引导已接收并等待下一轮合并处理。',
  );
  if (!events.length) return responseWithGuidance;
  return {
    ...responseWithGuidance,
    run: {
      ...responseWithGuidance.run,
      raw: {
        ...(typeof responseWithGuidance.run.raw === 'object' && responseWithGuidance.run.raw !== null ? responseWithGuidance.run.raw : {}),
        streamProcess: {
          eventCount: events.length,
          events: events.slice(-80).map(nativeStreamEventRecord),
        },
      },
    },
  };
}

export function attachStreamProcessToFailedSession(session: SciForgeSession, failedRunId: string, events: AgentStreamEvent[]): SciForgeSession {
  return attachProcessRecoveryToFailedSession({
    session,
    failedRunId,
    events: events.slice(-80).map(nativeStreamEventRecord),
  });
}

function nativeStreamEventRecord(event: AgentStreamEvent) {
  const presentation = presentStreamEvent(event);
  const raw = isRecord(event.raw) ? event.raw : {};
  const native = isRecord(raw.native) ? raw.native : {};
  const nativeRaw = isRecord(native.raw) ? native.raw : {};
  const nestedRaw = isRecord(raw.raw) ? raw.raw : {};
  const nestedEvent = isRecord(nestedRaw.event) ? nestedRaw.event : {};
  const sourceRecords = [raw, native, nativeRaw, nestedRaw, nestedEvent];
  const sourceField = (...keys: string[]) => firstRecordField(sourceRecords, keys);
  return {
    type: event.type,
    label: safeTextField(event.label, 400),
    detail: safeTextField(presentation.detail || presentation.usageDetail),
    createdAt: event.createdAt,
    native: {
      backend: safeIdentifierField(sourceField('backend')),
      rawType: safeIdentifierField(sourceField('type', 'rawType')),
      toolName: safeIdentifierField(sourceField('toolName')),
      command: safeTextField(sourceField('command'), 2000),
      path: safeRelativePathField(sourceField('path')),
      file: safeRelativePathField(sourceField('file')),
      filename: safeRelativePathField(sourceField('filename')),
      filePath: safeRelativePathField(sourceField('filePath', 'file_path')),
      fileRef: safeFileRefField(sourceField('fileRef', 'file_ref')),
      ref: safeExplicitPreviewRefField(sourceField('ref')),
      outputSummary: safeActionSummaryField(sourceField('outputSummary', 'output_summary'), 2000),
      status: safeIdentifierField(sourceField('status')),
      exitCode: numberField(sourceField('exitCode', 'exit_code')),
      diff: safeDiffTextField(sourceField('diff', 'patch', 'stdout', 'output', 'outputSummary', 'output_summary', 'result')),
      diffRef: safeOpaqueRefField(sourceField('diffRef', 'diff_ref')),
      stdoutRef: safeOpaqueRefField(sourceField('stdoutRef', 'stdout_ref')),
      stderrRef: safeOpaqueRefField(sourceField('stderrRef', 'stderr_ref')),
      transcriptRef: safeOpaqueRefField(sourceField('transcriptRef', 'transcript_ref')),
      agentId: safeIdentifierField(sourceField('agentId', 'agent_id')),
      parentAgentId: safeIdentifierField(sourceField('parentAgentId', 'parent_agent_id')),
      resultSummary: safeActionSummaryField(sourceField('resultSummary', 'result_summary', 'summary'), 2000),
      refs: safeRefListField(sourceField('refs')),
      workEvidence: safeWorkEvidenceRecords(event.workEvidence ?? sourceField('workEvidence', 'work_evidence')),
      itemId: safeIdentifierField(sourceField('itemId')),
      traceStepId: safeIdentifierField(sourceField('traceStepId')),
      text: safeTextField(sourceField('text'), 2000),
      message: safeTextField(sourceField('message'), 2000),
    },
  };
}

export function compactFailureNotice(value: string, locale?: SupportedLocale) {
  const primary = value
    .replace(/\n\s*工作过程摘要[:：][\s\S]*$/i, '')
    .replace(/\n\s*Backend stream[:：][\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!primary) return chatText(locale, {
    'zh-CN': '任务未完成。工作日志仍保留在过程详情中。',
    'en-US': 'The task did not finish. The work log is still available in the process details.',
  });
  if (looksLikeRawFailureNotice(primary)) {
    const httpStatus = primary.match(/\bHTTP\s+(\d{3})(?:\s+([A-Za-z][A-Za-z -]{2,40}))?/i);
    const reason = httpStatus
      ? `HTTP ${httpStatus[1]}${httpStatus[2] ? ` ${httpStatus[2].trim()}` : ''}`
      : /timeout|timed out|超时/i.test(primary)
        ? 'workspace timeout'
        : 'workspace failure';
    return chatText(locale, {
      'zh-CN': `任务未完成：${reason}。敏感响应文本、端点和日志已从主回答隐藏。`,
      'en-US': `The task did not finish: ${reason}. Sensitive response text, endpoints, and logs are hidden from the main answer.`,
    });
  }
  if (primary.length <= 180) return primary;
  return `${primary.slice(0, 160).replace(/\s+\S*$/, '')}...`;
}

function looksLikeRawFailureNotice(value: string) {
  return /^[{[]/.test(value)
    || /\b(?:stdoutRef|stderrRef|rawRef|runtimeEventsRef)\b/i.test(value)
    || /\bhttps?:\/\/[^\s"'<>]+/i.test(value)
    || /\bHTTP\s+(?:401|403|429|5\d\d)\b/i.test(value)
    || /\b(?:Invalid token|Unauthorized|Forbidden)\b/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function firstRecordField(records: Array<Record<string, unknown>>, keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      if (record[key] !== undefined) return record[key];
    }
  }
  return undefined;
}

function safeRelativePathField(value: unknown): string | undefined {
  const text = stringField(value)?.replace(/\\/g, '/').trim();
  if (!text || text.startsWith('/') || text.includes('://')) return undefined;
  if (text.split('/').some((part) => part === '..')) return undefined;
  if (/(?:^|\/)(?:Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:\/|$)/i.test(text)) return undefined;
  if (/[\r\n\t<>|?*:]/.test(text)) return undefined;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return undefined;
  return text;
}

function safeFileRefField(value: unknown): string | undefined {
  const text = stringField(value);
  if (!text) return undefined;
  if (text.startsWith('file:')) {
    const path = safeRelativePathField(text.slice('file:'.length));
    return path ? `file:${path}` : undefined;
  }
  if (text.startsWith('artifact:')) return safeArtifactRefField(text.slice('artifact:'.length));
  const path = safeRelativePathField(text);
  return path ? `file:${path}` : undefined;
}

function safeExplicitPreviewRefField(value: unknown): string | undefined {
  const text = stringField(value);
  if (!text) return undefined;
  if (text.startsWith('file:')) {
    const path = safeRelativePathField(text.slice('file:'.length));
    return path ? `file:${path}` : undefined;
  }
  if (text.startsWith('artifact:')) return safeArtifactRefField(text.slice('artifact:'.length));
  return undefined;
}

function safeOpaqueRefField(value: unknown): string | undefined {
  const text = stringField(value);
  if (!text || text.includes('://') || text.startsWith('/') || /\[local-path\]|\[redacted\]|\[url\]/i.test(text)) return undefined;
  if (text.startsWith('artifact:')) return safeArtifactRefField(text.slice('artifact:'.length));
  if (!isSafeOpaqueRefPayload(text)) return undefined;
  return text;
}

function safeRefListField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs = value
    .map((entry) => safeExplicitPreviewRefField(entry) ?? safeOpaqueRefField(entry))
    .filter((entry): entry is string => Boolean(entry));
  const unique = Array.from(new Set(refs));
  return unique.length ? unique : undefined;
}

function safeTextField(value: unknown, limit = 4000): string | undefined {
  const text = stringField(value);
  if (!text) return undefined;
  const redacted = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, 'Bearer [redacted]')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat|sk|rk|pk|pat|token)[_-][A-Za-z0-9_-]{12,}\b/gi, '[redacted]')
    .replace(
      /\b(api[-_]?key|apiKey|access[-_]?token|auth[-_]?token|token|secret|password|credential|authorization)\b(\s*[:=]\s*["']?)([^"',\s);}\]]+)/gi,
      (_match, label: string, separator: string) => `${label}${separator}[redacted]`,
    )
    .replace(/https?:\/\/[^\s"'<>\\)]+/gi, '[redacted-url]')
    .replace(/\/(?:Applications|Users|home|private|var|tmp)\/[^\s"'<>\\)]+/gi, '[redacted-path]')
    .replace(/\b[A-Za-z]:\\Users\\[^\s"'<>]+/gi, '[redacted-path]')
    .replace(/\b[A-Za-z0-9+/]{240,}={0,2}\b/g, '[redacted-long-token]')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!redacted) return undefined;
  if (redacted.length <= limit) return redacted;
  return `${redacted.slice(0, Math.max(0, limit - 180)).replace(/\s+\S*$/, '')}\n...\n${redacted.slice(-120)}`;
}

function safeActionSummaryField(value: unknown, limit = 4000): string | undefined {
  const text = safeTextField(value, limit);
  if (!text || looksLikeBackendEnvelopeSummary(text)) return undefined;
  return text;
}

function looksLikeBackendEnvelopeSummary(value: string) {
  const text = value.trim();
  if (!text) return false;
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    return /"?(?:item|type|command|cwd|processId|raw|stdout|stderr|completedAtMs|source)"?\s*:/.test(text)
      || /\b(?:commandExecution|unifiedExec|stdoutRef|stderrRef|rawRef|runtimeEventsRef)\b/i.test(text);
  }
  return /\b(?:commandExecution|unifiedExec|stdoutRef|stderrRef|rawRef|runtimeEventsRef)\b/i.test(text);
}

function safeIdentifierField(value: unknown): string | undefined {
  const text = stringField(value)?.replace(/\\/g, '/').trim();
  if (!text) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(text)) return undefined;
  if (text.startsWith('/') || text.startsWith('~') || text.includes('://')) return undefined;
  if (text.includes('..')) return undefined;
  if (/^(?:audit|trace|raw|stdout|stderr|provider):/i.test(text)) return undefined;
  if (/(?:^|[_.:-])(?:stdout|stderr|raw|log|logs|Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:$|[_.:-])/i.test(text)) return undefined;
  if (/\[local-path\]|\[redacted\]|\[url\]/i.test(text)) return undefined;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return undefined;
  return text;
}

function safeDiffTextField(value: unknown): string | undefined {
  const text = stringField(value);
  if (!text) return undefined;
  if (!looksLikeUnifiedDiff(text)) return undefined;
  const redacted = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat|sk|rk|pk|pat|token)[_-][A-Za-z0-9_-]{12,}\b/gi, '[redacted]')
    .replace(
      /\b(api[-_]?key|apiKey|access[-_]?token|auth[-_]?token|token|secret|password|credential|authorization)\b(\s*[:=]\s*["']?)([^"',\s);}\]]+)/gi,
      (_match, label: string, separator: string) => `${label}${separator}[redacted]`,
    )
    .replace(/https?:\/\/[^\s"'<>\\)]+/gi, '[redacted-url]')
    .replace(/\/(?:Applications|Users|home|private|var|tmp)\/[^\s"'<>\\)]+/gi, '[redacted-path]')
    .replace(/\b[A-Za-z]:\\Users\\[^\s"'<>]+/gi, '[redacted-path]')
    .replace(/\b[A-Za-z0-9+/]{240,}={0,2}\b/g, '[redacted-long-token]')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (!redacted) return undefined;
  if (redacted.length <= 12_000) return redacted;
  return `${redacted.slice(0, 9_500).replace(/\s+\S*$/, '')}\n...\n${redacted.slice(-1_500)}`;
}

function looksLikeUnifiedDiff(value: string | undefined) {
  const text = value?.trim();
  if (!text) return false;
  return /^diff --git\s+/m.test(text)
    || /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m.test(text)
    || (/^---\s+\S+/m.test(text) && /^\+\+\+\s+\S+/m.test(text));
}

function safeArtifactRefField(value: unknown): string | undefined {
  const payload = stringField(value);
  if (!payload || !isSafeOpaqueRefPayload(payload)) return undefined;
  return `artifact:${payload}`;
}

function isSafeOpaqueRefPayload(value: string) {
  const text = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(text)) return false;
  if (/^(?:audit|trace|raw|stdout|stderr|provider):/i.test(text)) return false;
  if (/(?:^|[_.:-])(?:stdout|stderr|raw|log|logs)(?:$|[_.:-])/i.test(text)) return false;
  if (text.includes('..') || text.startsWith('~')) return false;
  if (/(?:^|[_.:-])(?:Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:$|[_.:-])/i.test(text)) return false;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return false;
  return true;
}

function safeWorkEvidenceRecords(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined;
  const records = value
    .filter(isRecord)
    .map((record) => {
      const input = isRecord(record.input) ? record.input : undefined;
      const path = safeRelativePathField(input?.path ?? input?.file ?? input?.filename ?? input?.filePath ?? input?.file_path ?? record.path ?? record.file ?? record.filename ?? record.filePath ?? record.file_path);
      const evidenceRefs = stringList(record.evidenceRefs ?? record.evidence_refs)
        .map(safeExplicitPreviewRefField)
        .filter((ref): ref is string => Boolean(ref));
      if (!path && !evidenceRefs.length) return undefined;
      const safeRecord: Record<string, unknown> = {
        kind: stringField(record.kind),
        status: stringField(record.status),
        input: path ? { path } : undefined,
        evidenceRefs: evidenceRefs.length ? evidenceRefs : undefined,
      };
      return Object.fromEntries(Object.entries(safeRecord).filter(([, entry]) => entry !== undefined));
    })
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .filter((record) => Object.keys(record).length > 0);
  return records.length ? records : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function latestTokenUsage(events: AgentStreamEvent[]) {
  return [...events].reverse().find((event) => event.usage)?.usage;
}
