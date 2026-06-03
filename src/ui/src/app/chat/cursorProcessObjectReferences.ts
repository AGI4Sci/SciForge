import type { ObjectAction, ObjectReference, ObjectReferenceKind } from '../../domain';
import type { CursorAgentAction } from './cursorAgentProcess';

interface CursorRefSpec {
  kind: ObjectReferenceKind;
  artifactType?: string;
  preferredView?: string;
  actions?: readonly ObjectAction[];
}

const FILE_ACTIONS = ['focus-right-pane', 'reveal-in-folder', 'copy-path', 'pin'] as const satisfies readonly ObjectAction[];
const DIFF_ACTIONS = ['focus-right-pane', 'compare', 'copy-path', 'pin'] as const satisfies readonly ObjectAction[];
const INSPECT_ACTIONS = ['focus-right-pane', 'inspect', 'pin'] as const satisfies readonly ObjectAction[];
const EXTERNAL_ACTIONS = ['focus-right-pane', 'open-external', 'copy-path', 'pin'] as const satisfies readonly ObjectAction[];
const TERMINAL_ACTIONS = ['focus-right-pane', 'inspect', 'copy-path', 'pin'] as const satisfies readonly ObjectAction[];
const EVIDENCE_ACTIONS = ['focus-right-pane', 'inspect', 'pin'] as const satisfies readonly ObjectAction[];
const IMAGE_EVIDENCE_SPEC = { kind: 'artifact', artifactType: 'image-evidence', preferredView: 'image-evidence', actions: INSPECT_ACTIONS } as const satisfies CursorRefSpec;

export function objectReferenceForCursorAction(action: CursorAgentAction): ObjectReference | undefined {
  const reference = actionFocusCandidates(action)
    .map((ref) => ref ? objectReferenceForCursorRef(ref, action.filePath) : undefined)
    .find((candidate): candidate is ObjectReference => Boolean(candidate));
  if (!reference) return undefined;
  return {
    ...reference,
    runId: action.runId ?? reference.runId,
    executionUnitId: reference.executionUnitId ?? executionUnitIdFromAction(action),
  };
}

export function objectReferenceForCursorRef(ref: string, fallbackPath?: string): ObjectReference | undefined {
  const normalizedRef = ref.trim();
  if (!normalizedRef || !isTrustedCursorObjectRef(normalizedRef)) return undefined;
  const spec = cursorRefSpec(normalizedRef);
  if (!spec) return undefined;
  const path = pathForCursorRef(normalizedRef, fallbackPath, spec.kind);
  const title = titleForCursorRef(normalizedRef, path);
  return {
    id: `cursor-action-${safeObjectReferenceId(normalizedRef)}`,
    title,
    kind: spec.kind,
    ref: normalizedRef,
    artifactType: spec.artifactType,
    preferredView: spec.preferredView,
    presentationRole: 'supporting-evidence',
    actions: [...(spec.actions ?? EVIDENCE_ACTIONS)],
    status: spec.kind === 'url' ? 'external' : 'available',
    summary: 'Agent action preview',
    provenance: path
      ? { path, dataRef: normalizedRef, producer: 'cursor-agent-process' }
      : { dataRef: normalizedRef, producer: 'cursor-agent-process' },
  };
}

function actionFocusCandidates(action: CursorAgentAction): Array<string | undefined> {
  if (action.kind === 'read' || action.kind === 'file_edit' || action.kind === 'write') {
    return [action.fileRef, ...action.refs];
  }
  if (action.kind === 'shell_command' || action.kind === 'validate') {
    return [];
  }
  if (action.kind === 'diff') {
    return [];
  }
  if (action.kind === 'subagent') {
    return [...action.resultRefs, ...action.refs.filter((ref) => ref !== action.transcriptRef)];
  }
  if (action.kind === 'fetch') {
    return [...action.refs, ...action.resultRefs];
  }
  if (action.kind === 'artifact') {
    return [...action.resultRefs, ...action.refs];
  }
  return [action.fileRef, action.diffRef, action.transcriptRef, ...action.resultRefs, ...action.refs, action.stdoutRef, action.stderrRef];
}

function cursorRefSpec(ref: string): CursorRefSpec | undefined {
  const lower = ref.toLowerCase();
  if (lower.startsWith('file:')) {
    return diffLikeWorkspacePath(ref.slice('file:'.length))
      ? { kind: 'file', artifactType: 'workspace-diff', preferredView: 'workspace-diff-viewer', actions: DIFF_ACTIONS }
      : { kind: 'file', preferredView: 'workspace-file-viewer', actions: FILE_ACTIONS };
  }
  if (lower.startsWith('diff:') || lower.startsWith('patch:')) {
    return { kind: 'artifact', artifactType: 'workspace-diff', preferredView: 'workspace-diff-viewer', actions: DIFF_ACTIONS };
  }
  if (lower.startsWith('folder:') || lower.startsWith('workspace:')) return { kind: 'folder', preferredView: 'folder-viewer', actions: FILE_ACTIONS };
  if (lower.startsWith('artifact:')) {
    return isImageEvidenceArtifactRef(ref)
      ? IMAGE_EVIDENCE_SPEC
      : { kind: 'artifact', preferredView: 'generic-artifact-inspector', actions: INSPECT_ACTIONS };
  }
  if (lower.startsWith('result:') || lower.startsWith('preview:') || lower.startsWith('ui:')) {
    return { kind: 'artifact', artifactType: 'runtime-result', preferredView: 'generic-artifact-inspector', actions: INSPECT_ACTIONS };
  }
  if (lower.startsWith('scenario-package:')) return { kind: 'scenario-package', preferredView: 'scenario-package-inspector', actions: INSPECT_ACTIONS };
  if (lower.startsWith('run:') || ref.startsWith('run-')) return { kind: 'run', preferredView: 'evidence-inspector', actions: EVIDENCE_ACTIONS };
  if (isTerminalRef(ref)) return { kind: 'execution-unit', preferredView: 'terminal-session-viewer', actions: TERMINAL_ACTIONS };
  if (isBrowserRef(ref)) return { kind: 'url', preferredView: 'browser-object', actions: EXTERNAL_ACTIONS };
  if (isImageEvidenceRef(ref)) return IMAGE_EVIDENCE_SPEC;
  if (isLegacyScreenEvidenceRef(ref)) return IMAGE_EVIDENCE_SPEC;
  if (lower.startsWith('subagent:') || lower.startsWith('agent-result:') || lower.startsWith('agent-transcript:')) {
    return { kind: 'run', preferredView: 'subagent-result', actions: EVIDENCE_ACTIONS };
  }
  if (/^(?:evidence|source|citation|claim|workevidence|message):/i.test(ref)) {
    return { kind: 'run', preferredView: 'evidence-inspector', actions: EVIDENCE_ACTIONS };
  }
  return undefined;
}

function isTerminalRef(ref: string) {
  return /^(?:terminal|terminal-session|terminal-transcript|pty-transcript|shell|exec|execution-unit):/i.test(ref)
    || ref.startsWith('EU-');
}

function isBrowserRef(ref: string) {
  return /^(?:url|browser|browser-runtime|browser-session|browser-snapshot):/i.test(ref);
}

function isImageEvidenceRef(ref: string) {
  return /^(?:image|image-evidence|screenshot|annotation|browser-evidence|window-capture|screen-region|artifact-preview):/i.test(ref);
}

function isImageEvidenceArtifactRef(ref: string) {
  const payload = artifactPayload(ref);
  return Boolean(payload) && /(?:^|[_.:-])(?:image|image-evidence|screenshot|annotation|browser-evidence|window-capture|screen-region|artifact-preview|replay|window-action-evidence)(?:$|[_.:-])/i.test(payload);
}

function isLegacyScreenEvidenceRef(ref: string) {
  return /^(?:screen|virtual-app-screen|replay):/i.test(ref)
    || /^(?:computer-use|computer-use-session):/i.test(ref) && /(?:^|[/:._-])(?:frame|frames|screenshot|screenshots|capture|captures|crop|crops|image|images|replay)(?:$|[/:._-])/i.test(ref);
}

function artifactPayload(ref: string) {
  return ref.toLowerCase().startsWith('artifact:')
    ? ref.slice('artifact:'.length).replace(/^:/, '').trim()
    : '';
}

function pathForCursorRef(ref: string, fallbackPath: string | undefined, kind: ObjectReferenceKind) {
  if (ref.toLowerCase().startsWith('file:')) return ref.slice('file:'.length);
  if (ref.toLowerCase().startsWith('folder:')) return ref.slice('folder:'.length);
  if (ref.toLowerCase().startsWith('workspace:')) return ref.slice('workspace:'.length);
  if (kind === 'file' || kind === 'folder') return fallbackPath;
  return fallbackPath && isSafeCursorRelativePath(fallbackPath) ? fallbackPath : undefined;
}

function titleForCursorRef(ref: string, path: string | undefined) {
  const label = path ?? ref.replace(/^[a-z][a-z0-9+.-]*:{1,2}/i, '');
  return basename(label) || basename(ref) || 'object reference';
}

function executionUnitIdFromAction(action: CursorAgentAction) {
  if (action.kind !== 'shell_command' && action.kind !== 'validate') return undefined;
  return action.traceStepId ?? action.itemId;
}

function isTrustedCursorObjectRef(ref: string) {
  if (/\[local-path\]|\[redacted\]|\[url\]|https?:\/\//i.test(ref)) return false;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(ref)) return false;
  if (/[\r\n\t<>|?*]/.test(ref)) return false;
  if (/^(?:\/|[A-Za-z]:[\\/]|file:\/\/)/.test(ref)) return false;
  if (/^(?:audit|trace|raw|stdout|stderr|provider):/i.test(ref)) return false;
  if (/(?:^|[/:])(?:Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:[/:]|$)/i.test(ref)) return false;
  if (/(?:^|[/:])(?:raw|stdout|stderr|provider)(?:[/:]|$)/i.test(ref)) return false;
  if (ref.includes('..') || ref.startsWith('~')) return false;
  if (ref.toLowerCase().startsWith('file:')) return isSafeCursorRelativePath(ref.slice('file:'.length));
  if (ref.toLowerCase().startsWith('folder:')) return isSafeCursorRelativePath(ref.slice('folder:'.length));
  if (ref.toLowerCase().startsWith('workspace:')) return isSafeCursorRelativePath(ref.slice('workspace:'.length));
  if (ref.toLowerCase().startsWith('artifact:')) return isSafeCursorOpaquePayload(artifactPayload(ref));
  return /^[A-Za-z][A-Za-z0-9_.:/-]{1,180}$/.test(ref) || /^EU-[A-Za-z0-9_.:-]{1,128}$/.test(ref);
}

function isSafeCursorRelativePath(value: string) {
  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('/') || normalized.includes('://')) return false;
  if (/[\r\n\t<>|?*:]/.test(normalized)) return false;
  if (normalized.includes('..') || normalized.startsWith('~')) return false;
  if (/(?:^|\/)(?:Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:\/|$)/i.test(normalized)) return false;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(normalized)) return false;
  return true;
}

function isSafeCursorOpaquePayload(value: string) {
  const text = value.trim();
  if (!text || text.includes('/') || text.includes('://')) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(text)) return false;
  if (/(?:^|[_.:-])(?:raw|stdout|stderr|provider|Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:$|[_.:-])/i.test(text)) return false;
  return true;
}

function safeObjectReferenceId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'preview';
}

function basename(path: string) {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path;
}

function diffLikeWorkspacePath(path: string) {
  return /\.(?:diff|patch)$/i.test(path.trim());
}
