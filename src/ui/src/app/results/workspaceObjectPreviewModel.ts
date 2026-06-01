import type { ObjectReference, SciForgeSession } from '../../domain';
import { boundedRightPaneText, rightPaneTextIsSensitive } from './previewSafety';
import { resultText, type ResultLocale } from './resultLocale';

export interface SubagentArtifactPreviewModel {
  agentId?: string;
  parentAgentId?: string;
  status?: string;
  createdAt?: string;
  resultSummary?: string;
  resultRef?: string;
  transcriptRef?: string;
  refs: string[];
}

export function canHydrateWorkspaceObjectPath(value: string | undefined) {
  const path = value?.trim().replace(/\\/g, '/');
  if (!path) return false;
  if (/^(?:\/|[A-Za-z]:\/|~\/?)/.test(path) || path.includes('://')) return false;
  if (/[\r\n\t<>|?*:]/.test(path)) return false;
  if (path.split('/').some((part) => part === '..')) return false;
  if (/^(?:Users|Applications|Volumes|private|var|tmp)(?:\/|$)/i.test(path)) return false;
  if (/^\.sciforge\//i.test(path) && !/^\.sciforge\/artifacts\//i.test(path)) return false;
  if (/(?:^|\/)(?:audit|logs?|stdout|stderr|raw)(?:\/|\.|$)/i.test(path)) return false;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(path)) return false;
  return true;
}

export function subagentPreviewForReference(session: SciForgeSession, reference: ObjectReference): SubagentArtifactPreviewModel | undefined {
  if (!/^artifact:subagent-(?:result|transcript)-[A-Za-z0-9_.:-]+$/i.test(reference.ref)) return undefined;
  for (const run of [...session.runs].reverse()) {
    for (const event of [...streamProcessEvents(run.raw)].reverse()) {
      const native = recordField(event.native);
      if (!native) continue;
      const refs = stringArrayField(native.refs);
      const resultRef = stringField(native.ref) ?? refs.find((ref) => /^artifact:subagent-result-/i.test(ref));
      const transcriptRef = stringField(native.transcriptRef) ?? refs.find((ref) => /^artifact:subagent-transcript-/i.test(ref));
      if (![resultRef, transcriptRef, ...refs].includes(reference.ref)) continue;
      return {
        agentId: stringField(native.agentId),
        parentAgentId: stringField(native.parentAgentId),
        status: stringField(native.status),
        createdAt: stringField(event.createdAt),
        resultSummary: stringField(native.resultSummary),
        resultRef,
        transcriptRef,
        refs,
      };
    }
  }
  return undefined;
}

export function subagentPreviewSafeRefs(preview: Pick<SubagentArtifactPreviewModel, 'resultRef' | 'transcriptRef' | 'refs'>) {
  return uniqueStrings([
    preview.resultRef,
    preview.transcriptRef,
    ...preview.refs,
  ].filter((ref): ref is string => typeof ref === 'string' && safeSubagentPreviewRef(ref)));
}

export function subagentPreviewSummary(value: string | undefined, reference: ObjectReference, locale?: ResultLocale) {
  const cleaned = cleanSubagentPreviewSummary(value);
  if (cleaned) return cleaned;
  return reference.ref.includes('transcript')
    ? resultText(locale, { 'zh-CN': '委托 worker transcript 引用如下。', 'en-US': 'Delegated worker transcript ref is available below.' })
    : resultText(locale, { 'zh-CN': '只读委托 worker 已完成；安全引用如下。', 'en-US': 'Read-only delegated worker completed; safe refs are available below.' });
}

export function cleanSubagentPreviewSummary(value: string | undefined) {
  const text = stripTruncatedSubagentPreviewPromptTail(boundedRightPaneText(value ?? '', 1600)).trim();
  if (!text) return '';
  const segments = text
    .split(/(?:\r?\n|(?<=[.!?。！？])\s+)/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const cleaned = segments
    .filter((segment) => !isPromptEchoSubagentSummarySegment(segment))
    .join(' ')
    .trim();
  return cleaned === text && isPromptEchoSubagentSummarySegment(cleaned) ? '' : cleaned;
}

export function objectReferenceForSubagentPreviewRef(ref: string): ObjectReference {
  const kind = ref.startsWith('file:') ? 'file' : 'artifact';
  const title = ref.startsWith('file:') ? ref.slice('file:'.length) : ref;
  return {
    id: `subagent-preview-${ref.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 96)}`,
    title,
    kind,
    ref,
    status: 'available',
    actions: kind === 'artifact' ? ['inspect'] : ['focus-right-pane', 'inspect'],
    presentationRole: kind === 'artifact' ? 'audit' : 'supporting-evidence',
  };
}

export function safeExternalPreviewHref(value: string): string | undefined {
  if (rightPaneTextIsSensitive(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function stripTruncatedSubagentPreviewPromptTail(value: string) {
  return value.replace(/\s*\.\.\.\s*[^.!?。！？]{0,120}\bsubstitute\b[.!?。！？]?/gi, '');
}

function isPromptEchoSubagentSummarySegment(segment: string) {
  const text = segment.toLowerCase();
  return /\b(?:request|prompt|input)\s+summary\b/.test(text)
    || /\bdo not (?:edit|modify|write|use\s+(?:shell|ordinary|terminal)|use shell substitute)\b/.test(text)
    || /\bdo not use\b.*\bsubstitute\b/.test(text)
    || (/\bsubstitute\b/.test(text) && /(?:\.\.\.|shell|ordinary|terminal|do not|use)/.test(text))
    || /\bif (?:no|unavailable|current runtime lacks|there is no)\b/.test(text)
    || /^(?:read[-\s]?only|只读)\.?$/.test(text)
    || /^read\b.*\bonly\b\.?$/.test(text)
    || /^sub[-\s]?agent\s+reads?\b/.test(text)
    || /^delegated\s+worker\s+reads?\b/.test(text)
    || /^report\b.*\b(?:open difference|evidence refs?|refs needed|current status|todo)\b/.test(text)
    || /^main agent\b.*\bsummar/i.test(segment)
    || (/\bno_subagent_tool_available\b/.test(text) && /\b(?:if|prompt|request|summary)\b/.test(text));
}

function streamProcessEvents(raw: unknown): Record<string, unknown>[] {
  const record = recordField(raw);
  const process = recordField(record?.streamProcess);
  const events = process?.events;
  return Array.isArray(events) ? events.filter(recordField) : [];
}

function safeSubagentPreviewRef(ref: string) {
  const value = ref.trim();
  if (!value || rightPaneTextIsSensitive(value)) return false;
  if (value.startsWith('file:')) return canHydrateWorkspaceObjectPath(value.slice('file:'.length));
  if (!value.startsWith('artifact:')) return false;
  const artifactRef = value.slice('artifact:'.length).trim();
  if (!artifactRef || artifactRef.startsWith('/') || artifactRef.startsWith('~') || artifactRef.includes('://')) return false;
  if (/[\r\n\t<>|?*]/.test(artifactRef)) return false;
  if (artifactRef.split('/').some((part) => part === '..')) return false;
  if (/(?:^|\/)(?:\.sciforge|raw|provider|stdout|stderr|trace|tmp|private)(?:\/|$)/i.test(artifactRef)) return false;
  return true;
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArrayField(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
