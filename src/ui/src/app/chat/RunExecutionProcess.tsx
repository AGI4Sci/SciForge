import type { AgentStreamEvent, ObjectReference, SciForgeRun, SciForgeSession } from '../../domain';
import type { SupportedLocale } from '../../i18n';
import { MessageContent, type WorkspacePreviewConfig } from './MessageContent';
import { InlineObjectReferences } from './InlineObjectReferences';
import { NativeEventStream } from './RunningWorkProcess';
import { buildCursorAgentProcessModel } from './cursorAgentProcess';
import { objectReferenceForCursorRef } from './cursorProcessObjectReferences';
import { chatText } from './chatI18n';
import {
  artifactHasUserFacingDelivery,
  displayTitleForObjectReference,
  isUserFacingObjectReference,
  mergeObjectReferences,
  objectReferenceForArtifactSummary,
} from '../../../../../packages/support/object-references';
import {
  conversationProjectionArtifactRefs,
  conversationProjectionForSession,
  sanitizeUserProjectionText,
  type UiConversationProjection,
} from '../conversation-projection-view-model';

export function RunExecutionProcess({
  runId,
  session,
  onObjectFocus,
  onGuiCommand,
  locale,
}: {
  runId: string;
  session: SciForgeSession;
  trace?: string;
  onObjectFocus: (reference: ObjectReference) => void;
  onGuiCommand?: (commandText: string) => void;
  locale?: SupportedLocale;
}) {
  const run = session.runs.find((item) => item.id === runId);
  const projection = conversationProjectionForSession(session, run);
  if (!run) return null;
  const nativeEvents = nativeStreamEventsForRun(run);
  if (!nativeEvents.length) return null;
  if (!buildCursorAgentProcessModel(nativeEvents, { mode: 'recorded', limit: 18, locale, sourceRunId: runId }).groups.length) return null;
  return (
    <div
      className="execution-process-thread"
      aria-label={chatText(locale, { 'zh-CN': '有序活动', 'en-US': 'Ordered activity' })}
      data-testid="chat-process-thread"
      data-process-source="native-event-stream"
    >
      <NativeEventStream events={nativeEvents} mode="recorded" limit={18} onObjectFocus={onObjectFocus} onGuiCommand={onGuiCommand} locale={locale} sourceRunId={runId} />
    </div>
  );
}

function nativeStreamEventsForRun(run: SciForgeRun | undefined): AgentStreamEvent[] {
  const raw = isRecord(run?.raw) ? run.raw : undefined;
  const streamProcess = isRecord(raw?.streamProcess) ? raw.streamProcess : undefined;
  const events = Array.isArray(streamProcess?.events) ? streamProcess.events : [];
  const nativeEvents = events
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
  const prompt = typeof run?.prompt === 'string' && run.prompt.trim() ? run.prompt : undefined;
  if (!prompt) return nativeEvents;
  return [{
    id: `${run?.id ?? 'run'}-prompt-carrier`,
    type: 'workspace-runtime-event',
    label: 'Runtime prompt',
    createdAt: run?.createdAt ?? new Date(0).toISOString(),
    raw: {
      type: 'audit',
      native: {
        rawType: 'audit',
        commandText: prompt,
      },
    },
  }, ...nativeEvents];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function containsInternalProcessText(value: string | undefined) {
  return typeof value === 'string' && /(?:\b(?:ConversationProjection|ExecutionUnit|ArtifactDelivery|native-message|live-runtime-codex|raw\s+JSONL|raw|SSE|stdout|stderr|provider|run\s*id|runId|execution-unit)\b|(?:^|[#:/])EU-[\w-]+|^run:)/i.test(value);
}

export function RunKeyInfo({
  runId,
  session,
  onObjectFocus,
  locale,
  previewConfig,
}: {
  runId: string;
  session: SciForgeSession;
  onObjectFocus?: (reference: ObjectReference) => void;
  locale?: SupportedLocale;
  previewConfig?: WorkspacePreviewConfig;
}) {
  const keyInfo = runKeyInfoModel(session, runId);
  if (!keyInfo) return null;
  const { claims, deliverableReferences } = keyInfo;
  const artifactLinks = deliverableReferences.map((reference) => displayTitleForObjectReference(reference)).join(chatText(locale, { 'zh-CN': '、', 'en-US': ', ' }));
  const keyProse = [
    deliverableReferences.length
      ? chatText(locale, { 'zh-CN': `结果：${artifactLinks}。`, 'en-US': `Results: ${artifactLinks}.` })
      : chatText(locale, { 'zh-CN': '没有创建新的可预览结果。', 'en-US': 'No new previewable result was created.' }),
    claims.length ? chatText(locale, { 'zh-CN': `提取了 ${claims.length} 条发现。`, 'en-US': `${claims.length} findings extracted.` }) : '',
    chatText(locale, { 'zh-CN': '过程详情已在下方折叠。', 'en-US': 'Process details are folded below.' }),
  ].filter(Boolean).join(' ');
  return (
    <div className="message-key-info" aria-label={chatText(locale, { 'zh-CN': '本轮摘要', 'en-US': 'Turn summary' })}>
      <div className="message-key-info-head">
        <strong>{chatText(locale, { 'zh-CN': '结果', 'en-US': 'Results' })}</strong>
        <span>{chatText(locale, {
          'zh-CN': `${deliverableReferences.length} 个对象 · ${claims.length} 条发现`,
          'en-US': `${deliverableReferences.length} objects · ${claims.length} findings`,
        })}</span>
      </div>
      <div className="message-key-prose">
        <MessageContent
          content={keyProse}
          references={deliverableReferences}
          onObjectFocus={onObjectFocus ?? (() => undefined)}
          previewConfig={previewConfig}
        />
      </div>
      {claims.length ? (
        <div className="message-key-list">
          {claims.map((claim, index) => (
            <article
              key={`${claim.id || 'claim'}-${index}`}
              className="message-key-row"
              data-claim-ref-count={claim.evidenceReferences.length}
            >
              <span className="message-key-row-title">{sanitizeUserProjectionText(claim.text) ?? claim.text}</span>
              <small className="message-key-row-meta">{claim.evidenceLevel} · {chatText(locale, { 'zh-CN': '置信度', 'en-US': 'confidence' })} {Math.round(claim.confidence * 100)}%</small>
              {claim.evidenceReferences.length ? (
                <InlineObjectReferences references={claim.evidenceReferences} limit={4} onObjectFocus={onObjectFocus ?? (() => undefined)} />
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function runKeyInfoHasContent(session: SciForgeSession, runId: string) {
  return Boolean(runKeyInfoModel(session, runId));
}

function runKeyInfoModel(session: SciForgeSession, runId: string) {
  const run = session.runs.find((item) => item.id === runId);
  const projection = conversationProjectionForSession(session, run);
  if (!projection && run?.status === 'failed') return undefined;
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
    mergeObjectReferences(
      artifactReferences,
      objectRefs.filter((reference) => reference.kind === 'artifact' || reference.kind === 'file' || reference.kind === 'folder'),
      8,
    )
      .map(safeRunKeyInfoReference)
      .filter(isProcessObjectReference),
    [],
    8,
  ).slice(0, 4);
  const artifacts = session.artifacts.filter((artifact) => deliverableReferences.some((reference) => reference.ref === `artifact:${artifact.id}`));
  const claims = claimsForRun(session, runId, artifacts.map((artifact) => artifact.id))
    .slice(0, 3)
    .map((claim) => ({
      ...claim,
      evidenceReferences: claimEvidenceReferences(claim, session, runId),
    }));
  if (!deliverableReferences.length && !claims.length) return undefined;
  return { claims, deliverableReferences };
}

function claimEvidenceReferences(
  claim: SciForgeSession['claims'][number],
  session: SciForgeSession,
  runId: string,
) {
  const artifactIds = new Set(session.artifacts.map((artifact) => artifact.id));
  const refs = [
    ...claim.supportingRefs,
    ...claim.opposingRefs,
    ...(claim.dependencyRefs ?? []),
  ];
  return mergeObjectReferences(
    refs
      .map((ref) => objectReferenceForClaimEvidenceRef(ref, artifactIds, runId))
      .filter((reference): reference is ObjectReference => Boolean(reference))
      .map(safeRunKeyInfoReference)
      .filter((reference) => ['artifact', 'file', 'folder'].includes(reference.kind))
      .filter(isProcessObjectReference),
    [],
    4,
  );
}

function objectReferenceForClaimEvidenceRef(ref: string, artifactIds: Set<string>, runId: string): ObjectReference | undefined {
  const normalized = ref.trim();
  if (!normalized) return undefined;
  const prefixed = normalized.includes(':')
    ? normalized
    : artifactIds.has(normalized)
      ? `artifact:${normalized}`
      : looksLikeSafeWorkspaceFileRef(normalized)
        ? `file:${normalized}`
        : undefined;
  const reference = prefixed ? objectReferenceForCursorRef(prefixed) : undefined;
  if (!reference) return undefined;
  return {
    ...reference,
    id: `claim-evidence-${reference.id}`,
    runId,
    summary: 'Claim evidence',
    provenance: {
      ...reference.provenance,
      producer: 'scientific-claim',
    },
  };
}

function looksLikeSafeWorkspaceFileRef(value: string) {
  return /^[^:/?#]+(?:\/[^:/?#]+)*\.[A-Za-z0-9]{1,12}(?:#[A-Za-z0-9_.:-]+)?$/.test(value)
    && !/(?:^|\/)(?:\.sciforge|Users|Applications|Volumes|private|var|tmp|raw|stdout|stderr|provider)(?:\/|$)/i.test(value)
    && !value.includes('..')
    && !value.startsWith('~');
}

function safeRunKeyInfoReference(reference: ObjectReference): ObjectReference {
  return {
    ...reference,
    title: isPrivateRunKeyRefText(reference.title) ? displayTitleForObjectReference(reference) : reference.title,
    summary: isPrivateRunKeyRefText(reference.summary) ? undefined : reference.summary,
    provenance: {
      ...reference.provenance,
      path: isPrivateRunKeyRefText(reference.provenance?.path) ? undefined : reference.provenance?.path,
      dataRef: isPrivateRunKeyRefText(reference.provenance?.dataRef) ? undefined : reference.provenance?.dataRef,
    },
  };
}

function isPrivateRunKeyRefText(value: string | undefined) {
  return containsInternalProcessText(value)
    || (typeof value === 'string' && /(?:^|[/#:])\.sciforge(?:[/#:]|$)/i.test(value));
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
