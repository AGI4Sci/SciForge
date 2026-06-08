import type { NormalizedAgentResponse, ObjectReference } from '../../domain';
import { runtimeNativeMessageLiveAcceptanceEligible } from './runtimeNativeMessage';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return out.length ? out : undefined;
}

function uniqueStringList(values: unknown[]) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

export function attachRuntimeGuiPresentationToResponse(
  response: NormalizedAgentResponse,
  result: unknown,
): NormalizedAgentResponse {
  const presentation = isRecord(result) && isRecord(result.guiPresentation)
    ? result.guiPresentation
    : isRecord(result) && isRecord(result.output) && isRecord(result.output.guiPresentation)
      ? result.output.guiPresentation
      : undefined;
  const askUser = isRecord(result) && isRecord(result.guiAskUser)
    ? result.guiAskUser
    : isRecord(result) && isRecord(result.output) && isRecord(result.output.guiAskUser)
      ? result.output.guiAskUser
      : undefined;
  const source = asString(presentation?.source);
  const presentedObjectReference = source?.startsWith('gui.present:')
    ? objectReferenceFromGuiPresentation(presentation, response.run.id)
    : undefined;
  const askSource = asString(askUser?.source);
  if (askSource?.startsWith('gui.ask_user:')) {
    const askObjectReferences = objectReferencesFromGuiAskUser(askUser, response.run.id);
    const objectReferences = appendObjectReference(
      appendObjectReferences(response.message.objectReferences, askObjectReferences),
      presentedObjectReference,
    );
    return {
      ...response,
      message: {
        ...response.message,
        content: '运行需要用户确认；确认请求已作为 refs-first 元数据保留。',
        provenance: {
          ...(response.message.provenance ?? {}),
          kind: 'live-runtime-codex',
          source: askSource,
          runtimeRequestEligible: false,
          liveAcceptanceEligible: false,
          requiresUserConfirmation: true,
          commandId: asString(askUser?.commandId),
          attemptId: asString(askUser?.attemptId),
          provider: asString(askUser?.provider),
          model: asString(askUser?.model),
          profile: asString(askUser?.profile),
          workspace: asString(askUser?.workspace),
        },
        objectReferences,
      },
      run: {
        ...response.run,
        raw: {
          ...(isRecord(response.run.raw) ? response.run.raw : {}),
          ...(presentedObjectReference ? { guiPresentation: presentation } : {}),
          guiAskUser: askUser,
        },
        objectReferences: appendObjectReference(
          appendObjectReferences(response.run.objectReferences, askObjectReferences),
          presentedObjectReference,
        ),
      },
    };
  }
  if (source?.startsWith('gui.present:')) {
    return {
      ...response,
      message: {
        ...response.message,
        content: '运行返回了 GUI 展示元数据；没有 Host-owned final answer 时不会生成用户级回答。',
        provenance: {
          ...(response.message.provenance ?? {}),
          kind: 'live-runtime-codex',
          source,
          runtimeRequestEligible: false,
          liveAcceptanceEligible: false,
          commandId: asString(presentation?.commandId),
          attemptId: asString(presentation?.attemptId),
          provider: asString(presentation?.provider),
          model: asString(presentation?.model),
          profile: asString(presentation?.profile),
          workspace: asString(presentation?.workspace),
        },
        objectReferences: appendObjectReference(response.message.objectReferences, presentedObjectReference),
      },
      run: {
        ...response.run,
        raw: {
          ...(isRecord(response.run.raw) ? response.run.raw : {}),
          guiPresentation: presentation,
        },
        objectReferences: appendObjectReference(response.run.objectReferences, presentedObjectReference),
      },
    };
  }
  const finalAnswer = isRecord(result) && isRecord(result.finalAnswerEnvelope)
    ? result.finalAnswerEnvelope
    : undefined;
  const finalAnswerSource = asString(finalAnswer?.source);
  if (finalAnswer && finalAnswerSource?.startsWith('codex.app-server.final-answer:')) {
    const finalLiveAcceptanceEligible = typeof finalAnswer.liveAcceptanceEligible === 'boolean'
      ? finalAnswer.liveAcceptanceEligible
      : runtimeNativeMessageLiveAcceptanceEligible(asString(finalAnswer.text) ?? response.message.content, result);
    return {
      ...response,
      message: {
        ...response.message,
        provenance: {
          ...(response.message.provenance ?? {}),
          kind: 'live-runtime-codex',
          source: finalAnswerSource,
          runtimeRequestEligible: false,
          liveAcceptanceEligible: finalLiveAcceptanceEligible,
          commandId: asString(finalAnswer?.commandId),
          attemptId: asString(finalAnswer?.attemptId),
          provider: asString(finalAnswer?.provider),
          model: asString(finalAnswer?.model),
          profile: asString(finalAnswer?.profile),
        },
      },
      run: {
        ...response.run,
        raw: {
          ...(isRecord(response.run.raw) ? response.run.raw : {}),
          finalAnswerEnvelope: finalAnswer,
        },
      },
    };
  }
  return response;
}

function objectReferenceFromGuiPresentation(presentation: Record<string, unknown> | undefined, runId: string): ObjectReference | undefined {
  const rawRef = asString(presentation?.ref);
  if (!rawRef) return undefined;
  const kind = objectReferenceKindFromPresentationRef(rawRef);
  const target = targetFromPresentationRef(rawRef, kind);
  const id = objectReferenceIdFromPresentationRef(kind, target);
  const hint = asString(presentation?.hint);
  const isArtifact = kind === 'artifact';
  return {
    id,
    kind,
    title: asString(presentation?.title) ?? presentationTitleFromRef(target),
    ref: kind === 'url' ? `url:${target}` : `${kind}:${target}`,
    artifactType: isArtifact ? artifactTypeFromPresentationHint(hint) : undefined,
    runId,
    executionUnitId: kind === 'execution-unit' ? target : undefined,
    preferredView: preferredViewFromPresentationHint(hint, kind),
    presentationRole: 'primary-deliverable',
    status: 'available',
    summary: rawRef,
    provenance: {
      dataRef: isArtifact || kind === 'url' ? target : undefined,
      path: kind === 'file' || kind === 'folder' ? target : undefined,
      producer: asString(presentation?.source),
    },
  };
}

function appendObjectReference(
  references: ObjectReference[] | undefined,
  reference: ObjectReference | undefined,
): ObjectReference[] | undefined {
  if (!reference) return references;
  const existing = references ?? [];
  if (existing.some((item) => item.ref === reference.ref || item.id === reference.id)) return existing;
  return [...existing, reference];
}

function appendObjectReferences(
  references: ObjectReference[] | undefined,
  nextReferences: ObjectReference[],
): ObjectReference[] | undefined {
  if (!nextReferences.length) return references;
  let merged = references ?? [];
  for (const reference of nextReferences) {
    merged = appendObjectReference(merged, reference) ?? merged;
  }
  return merged;
}

function objectReferenceKindFromPresentationRef(ref: string): ObjectReference['kind'] {
  if (/^https?:\/\//i.test(ref)) return 'url';
  const prefix = ref.match(/^([a-z-]+)::?/i)?.[1]?.toLowerCase();
  if (prefix === 'artifact' || prefix === 'file' || prefix === 'folder' || prefix === 'run' || prefix === 'execution-unit' || prefix === 'scenario-package' || prefix === 'url') {
    return prefix;
  }
  if (/[\\/]/.test(ref) || /\.[a-z0-9]+(?:$|[?#])/i.test(ref)) return 'file';
  return 'artifact';
}

function objectReferencesFromGuiAskUser(askUser: Record<string, unknown> | undefined, runId: string): ObjectReference[] {
  const refs = uniqueStringList([
    ...(asStringArray(askUser?.relatedRefs) ?? []),
    ...(asStringArray(askUser?.displayedRefs) ?? []),
  ]);
  return refs.flatMap((ref) => {
    if (!isUserFacingGuiAskRef(ref)) return [];
    return [objectReferenceFromGuiRef(ref, runId, 'supporting-evidence')];
  });
}

function objectReferenceFromGuiRef(ref: string, runId: string, presentationRole: ObjectReference['presentationRole']): ObjectReference {
  const kind = objectReferenceKindFromPresentationRef(ref);
  const target = targetFromPresentationRef(ref, kind);
  const id = objectReferenceIdFromPresentationRef(kind, target);
  const isArtifact = kind === 'artifact';
  return {
    id,
    kind,
    title: presentationTitleFromRef(target),
    ref: kind === 'url' ? `url:${target}` : `${kind}:${target}`,
    artifactType: isArtifact ? artifactTypeFromPresentationHint(undefined) : undefined,
    runId,
    executionUnitId: kind === 'execution-unit' ? target : undefined,
    preferredView: preferredViewFromPresentationHint(refHintFromPath(target), kind),
    presentationRole,
    status: 'available',
    summary: ref,
    provenance: {
      dataRef: isArtifact || kind === 'url' ? target : undefined,
      path: kind === 'file' || kind === 'folder' ? target : undefined,
      producer: 'gui.ask_user',
    },
  };
}

function isUserFacingGuiAskRef(ref: string) {
  return !/^audit:/i.test(ref) && !/\b(?:stdoutRef|stderrRef|rawRef)\b/i.test(ref);
}

function refHintFromPath(path: string): string | undefined {
  if (/\.(?:md|markdown|txt)(?:$|[?#])/i.test(path)) return 'markdown';
  if (/\.(?:png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(path)) return 'image';
  if (/\.(?:json|jsonl)(?:$|[?#])/i.test(path)) return 'auto';
  return undefined;
}

function targetFromPresentationRef(ref: string, kind: ObjectReference['kind']): string {
  if (kind === 'url') return ref.replace(/^url::?/i, '');
  return ref.replace(new RegExp(`^${kind}::?`, 'i'), '');
}

function objectReferenceIdFromPresentationRef(kind: ObjectReference['kind'], target: string): string {
  return `gui-present-${kind}-${target.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'ref'}`;
}

function presentationTitleFromRef(ref: string): string {
  const lastSegment = ref.split(/[\\/]/).filter(Boolean).at(-1) ?? ref;
  return lastSegment || ref;
}

function artifactTypeFromPresentationHint(hint: string | undefined): string {
  if (hint === 'table') return 'table';
  if (hint === 'diff') return 'diff';
  if (hint === 'image') return 'image';
  if (hint === 'notebook') return 'notebook';
  return 'research-report';
}

function preferredViewFromPresentationHint(hint: string | undefined, kind: ObjectReference['kind']): string | undefined {
  if (kind === 'file' && hint === 'markdown') return 'report-viewer';
  if (kind !== 'artifact' && kind !== 'file') return undefined;
  if (hint === 'table') return 'record-table';
  if (hint === 'diff') return 'diff-viewer';
  if (hint === 'image') return 'image-viewer';
  if (hint === 'notebook') return 'notebook-viewer';
  if (hint === 'markdown' || hint === 'auto' || !hint) return 'report-viewer';
  return undefined;
}
