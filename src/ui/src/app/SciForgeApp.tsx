import { useEffect, useMemo, useRef, useState } from 'react';
import {
  builtInScenarioIdForRuntimeInput,
  createBuiltInScenarioRecord,
} from '@sciforge/scenario-core/scenario-routing-policy';
import { builtInScenarioPackageRef } from '@sciforge/scenario-core/scenario-package';
import { SCENARIO_SPECS } from '@sciforge/scenario-core/scenario-specs';
import { referenceComposerMarker } from '../../../../packages/support/object-references';
import { scenarios, type ScenarioId, type PageId } from '../data';
import { AnnotationSidebar } from '../feedback/AnnotationSidebar';
import { FeedbackCaptureLayer, type AnnotationReferenceInput } from '../feedback/FeedbackCaptureLayer';
import { AppContextMenuLayer } from './contextMenu/AppContextMenuLayer';
import {
  buildFeedbackEvidenceStatus,
  buildFeedbackRuntimeSnapshot,
  buildFeedbackTargetSnapshot,
  captureFeedbackScreenshotEvidence,
  feedbackEvidenceRefs,
  scrubSciForgeReference,
} from '../feedback/captureModel';
import {
  addAnnotationReferenceToDraft,
  advanceAnnotationPlanClarification,
  appendAnnotationActionRecord,
  assessAnnotationQuickAction,
  buildAnnotationPlanFeedbackComment,
  buildAnnotationPlanOnlyEnvelope,
  buildAnnotationQuickActionEnvelope,
  buildAnnotationQuickActionPrompt,
  createAnnotationPlanDraft,
  discardAnnotationPlanDraft,
  ensureAnnotationReferenceMarkers,
  loadPersistedAnnotationPlanDraft,
  markAnnotationPlanDraftSaved,
  persistAnnotationPlanDraft,
  refreshAnnotationPlanDraftContext,
  removeAnnotationReferenceFromDraft,
  updateAnnotationPlanDescription,
  type AnnotationActionRecord,
  type AnnotationPlanChoice,
  type AnnotationPlanDraft,
  type AnnotationPlanReferenceRecord,
} from '../feedback/annotationPlanModel';
import {
  makeId,
  nowIso,
  type AgentStreamEvent,
  type SciForgeSession,
  type SciForgeWorkspaceState,
  type SciForgeConfig,
  type FeedbackCommentRecord,
  type ObjectReference,
  type PreviewDescriptor,
  type RuntimeArtifact,
  type ScenarioInstanceId,
  type ScenarioRuntimeOverride,
  type SciForgeReference,
  type TimelineEventRecord,
} from '../domain';
import { compactWorkspaceStateForStorage, createInitialWorkspaceState, createSession, loadWorkspaceState, saveWorkspaceState, shouldUsePersistedWorkspaceState } from '../sessionStore';
import {
  activeSessionFor as workspaceActiveSessionFor,
  clearArchivedSessions as clearScenarioArchivedSessions,
  deleteActiveChat,
  deleteArchivedSessions as deleteScenarioArchivedSessions,
  deleteSessionMessage,
  editSessionMessage,
  archiveActiveSession as archiveScenarioActiveSession,
  archiveAllActiveSessions as archiveAllScenarioActiveSessions,
  forkActiveSession as forkScenarioActiveSession,
  isRetainedHistorySession,
  restoreArchivedSession as restoreScenarioArchivedSession,
  startNewChat,
} from '../workspace/sessionWorkspace';
import { markReusableRunInWorkspace } from '../workspace/reusableTaskWorkspace';
import { loadDesktopRuntimeConfigDefaults, loadSciForgeConfig, normalizeFeedbackGithubRepo, normalizeWorkspaceRootPath, saveSciForgeConfig, applyWorkspaceProjectSwitch, updateConfig, type DesktopAnnotationMode } from '../config';
import {
  loadFileBackedSciForgeConfig,
  loadSciForgeInstanceManifest,
  loadPersistedWorkspaceState,
  loadPersistedWorkspaceStateForProject,
  persistWorkspaceState,
  saveFileBackedSciForgeConfig,
} from '../api/workspaceClient';
import { ComponentWorkbenchPage, type ComponentWorkbenchMode } from './ComponentWorkbenchPage';
import { previewPackageAutoRunPrompt, type WorkspaceFileEditorState } from './ResultsRenderer';
import type { HandoffAutoRunRequest } from './results/viewPlanResolver';
import { useRuntimeHealth } from './runtimeHealthPanel';
import { cx } from './uiPrimitives';
import { documentLangForLocale, localeText, normalizeLocale, type SupportedLocale } from '../i18n';
import { I18nProvider } from '../i18nContext';
import { resolveSearchNavigation, workbenchNavigationForScenario } from './appShell/navigation';
import { SettingsPage, Sidebar, TopBar, type ConfigSaveState, type SidebarProjectThreadGroup } from './appShell/ShellPanels';
import { runPromptOrchestrator } from './chat/runOrchestrator';
import { highlightFeedbackTargetSnapshot } from './chat/referenceFocus';
import type { SettingsSectionId } from './appShell/settingsPageModel';
import { buildWorkspaceDirectorySwitchPatch, buildWorkspaceProjectActivation, findPeerInstanceForSidebarProject, isCurrentSidebarProject, removeSidebarProjectFromConfig } from './appShell/sidebarProjectModel';
import {
  buildSidebarProjectSessionsByPath,
  loadPeerSidebarProjectSessionSnapshots,
  peerSidebarProjectSessionTargets,
  type SidebarProjectSessionsByPath,
} from './appShell/sidebarProjectSessions';
import type { SidebarWorkspaceIntent } from './appShell/sidebarWorkspaceIntent';
import { sidebarProjectPath } from './appShell/sidebarProjectModel';
import {
  APP_BUILD_ID,
  loadFeedbackAuthor,
  mergeFileBackedConfig,
  saveFeedbackAuthor,
  scenarioLabelForInstance,
} from './appShell/appHelpers';
import {
  appendTimelineEventToWorkspace,
  applySessionUpdateToWorkspace,
  createArtifactHandoffTransition,
  createPreviewPackageAutoRunRequest,
  touchWorkspaceUpdatedAt,
  workspaceRecoveryFocusForState,
} from './appShell/workspaceState';
import {
  buildArchivedSessionCountsByScenario,
  buildArchivedSessionsByScenario,
  draftForWorkspaceScenario,
  defaultPublishedRuntimeComponentIds,
  updateWorkspaceDraftRecord,
  workspaceCanDiscardSidebarChat,
  workspaceHasArchivableSidebarChat,
  workspaceHasArchivableSidebarChats,
  type WorkspaceScenarioDraftRecord,
} from './sciforgeApp/appStateModels';
import { FeedbackInboxPage } from './sciforgeApp/FeedbackInboxPage';
import { Workbench } from './sciforgeApp/SciForgeWorkbench';
import { loadStoredAppNavigation, saveStoredAppNavigation } from './sciforgeApp/navigationStorage';
import { createSciForgeFeedbackActions } from './SciForgeAppFeedbackActions';

const MIN_WORKSPACE_LOADING_VISIBLE_MS = 600;

type AnnotationRunToken = {
  sequence: number;
  draftId: string;
  sessionId: string;
  scenarioId: ScenarioInstanceId;
};

type AppAnnotationMode = DesktopAnnotationMode;

function currentBrowserUrl() {
  return typeof window === 'undefined' ? 'about:blank' : window.location.href;
}

function desktopAnnotationPurposeForMode(mode: Exclude<AppAnnotationMode, 'sciforge-page'>) {
  return mode === 'app-window' ? 'comment-explicit-app-window' : 'comment-screen-region';
}

const desktopAnnotationReferenceKeys = [
  ['annotationRef', 'annotation'],
  ['imageRef', 'image'],
  ['windowRef', 'window'],
  ['targetRef', 'target'],
  ['cropRef', 'crop'],
  ['screenshotRef', 'screenshot'],
] as const;

const validSciForgeReferenceKinds = new Set<SciForgeReference['kind']>([
  'file',
  'file-region',
  'message',
  'task-result',
  'chart',
  'table',
  'table-range',
  'structure-selection',
  'ui',
]);

type DesktopAnnotationSourceKind = typeof desktopAnnotationReferenceKeys[number][1];

export function desktopAnnotationReferenceInputsFromResult(result: unknown): AnnotationReferenceInput[] {
  const inputs: AnnotationReferenceInput[] = [];
  const seen = new Set<string>();
  const root = recordFromUnknown(result);
  if (root && (root.ok === false || root.status === 'blocked')) return inputs;

  function pushReference(candidate: unknown, sourceKind: DesktopAnnotationSourceKind, targetCandidate: unknown = root ?? candidate, selectedText?: unknown) {
    const reference = desktopAnnotationReferenceFromCandidate(candidate, sourceKind, root);
    if (!reference || seen.has(reference.id)) return;
    seen.add(reference.id);
    inputs.push({
      reference,
      target: desktopAnnotationTargetFromCandidate(targetCandidate, sourceKind, reference),
      selectedText: desktopAnnotationString(selectedText) || undefined,
    });
  }

  if (root?.reference) {
    pushReference(root.reference, 'annotation', root, root.comment);
  }

  const references = root && Array.isArray(root.references) ? root.references : [];
  for (const item of references) {
    const record = recordFromUnknown(item);
    if (record?.reference) {
      pushReference(record.reference, 'annotation', record.target ?? record, record.selectedText ?? record.comment ?? root?.comment);
    } else {
      pushReference(item, 'annotation', root, root?.comment);
    }
  }

  const refsRecord = recordFromUnknown(root?.refs);
  for (const [key, sourceKind] of desktopAnnotationReferenceKeys) {
    if (root && key in root) pushReference(root[key], sourceKind, root, root.comment);
    if (refsRecord && key in refsRecord) pushReference(refsRecord[key], sourceKind, root, root?.comment);
  }

  return inputs;
}

function desktopAnnotationReferenceFromCandidate(
  candidate: unknown,
  sourceKind: DesktopAnnotationSourceKind,
  root?: Record<string, unknown>,
): SciForgeReference | undefined {
  const record = recordFromUnknown(candidate);
  const rawRef = record
    ? desktopAnnotationString(record.ref)
      || desktopAnnotationString(record.url)
      || desktopAnnotationString(record.localRef)
      || desktopAnnotationString(record.id)
    : desktopAnnotationString(candidate);
  if (!rawRef) return undefined;
  const id = record
    ? desktopAnnotationString(record.id) || `ref-desktop-${sourceKind}-${desktopAnnotationHash(rawRef)}`
    : `ref-desktop-${sourceKind}-${desktopAnnotationHash(rawRef)}`;
  const originalKind = record?.kind;
  const reference: SciForgeReference = {
    id,
    kind: validSciForgeReferenceKinds.has(originalKind as SciForgeReference['kind'])
      ? originalKind as SciForgeReference['kind']
      : 'ui',
    title: desktopAnnotationString(record?.title) || desktopAnnotationTitle(sourceKind),
    ref: rawRef.startsWith('desktop-annotation:')
      ? rawRef
      : `desktop-annotation:${sourceKind}:${rawRef}`,
    summary: desktopAnnotationString(record?.summary)
      || desktopAnnotationString(record?.comment)
      || desktopAnnotationString(root?.comment)
      || undefined,
    locator: {
      region: desktopAnnotationLocatorRegion(root ?? record),
    },
    payload: desktopAnnotationReferencePayload(root ?? record, sourceKind, originalKind),
  };
  return scrubSciForgeReference(reference);
}

function desktopAnnotationTargetFromCandidate(
  candidate: unknown,
  sourceKind: DesktopAnnotationSourceKind,
  reference: SciForgeReference,
): AnnotationReferenceInput['target'] {
  const record = recordFromUnknown(candidate);
  const targetRecord = recordFromUnknown(record?.target) ?? recordFromUnknown(record?.targetRef);
  const bounds = desktopAnnotationBounds(targetRecord?.bounds)
    ?? desktopAnnotationBounds(targetRecord?.rect)
    ?? desktopAnnotationBounds(record?.bounds)
    ?? desktopAnnotationBounds(record?.rect)
    ?? { x: 0, y: 0, width: 1, height: 1 };
  const title = desktopAnnotationString(targetRecord?.title)
    || desktopAnnotationString(record?.targetTitle)
    || desktopAnnotationString(record?.windowTitle)
    || reference.title
    || desktopAnnotationTitle(sourceKind);
  const selector = `desktop-annotation:${sourceKind}:${reference.id}`;
  return {
    selector,
    stableSelector: selector,
    path: selector,
    domPath: selector,
    text: title,
    textSnippet: title,
    tagName: 'DESKTOP-ANNOTATION',
    role: 'region',
    label: title,
    ariaLabel: title,
    rect: bounds,
    commentPoint: {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    },
  };
}

function desktopAnnotationReferencePayload(record: Record<string, unknown> | undefined, sourceKind: DesktopAnnotationSourceKind, originalKind: unknown) {
  if (!record) return { source: 'desktop-global-annotation', sourceKind };
  const metadata = recordFromUnknown(record.metadata);
  const actionMetadata = desktopAnnotationActionMetadata(record, metadata);
  const bounds = desktopAnnotationBounds(actionMetadata.bounds) ?? desktopAnnotationBounds(actionMetadata.rect);
  return {
    source: 'desktop-global-annotation',
    sourceKind,
    annotationSourceKind: desktopAnnotationString(actionMetadata.sourceKind) || undefined,
    bridgeReferenceKind: typeof originalKind === 'string' ? originalKind : undefined,
    coordinateSpace: desktopAnnotationString(actionMetadata.coordinateSpace) || undefined,
    bounds,
    screenBounds: desktopAnnotationBounds(actionMetadata.screenBounds),
    windowBounds: desktopAnnotationBounds(actionMetadata.windowBounds),
    windowLocalBounds: desktopAnnotationBounds(actionMetadata.windowLocalBounds),
    displayId: desktopAnnotationDisplayId(actionMetadata, metadata),
    scale: desktopAnnotationScale(actionMetadata, metadata),
    annotationRef: desktopAnnotationRefString(actionMetadata.annotationRef) || undefined,
    imageRef: desktopAnnotationRefString(actionMetadata.imageRef) || undefined,
    windowRef: desktopAnnotationRefString(actionMetadata.windowRef) || undefined,
    cropRef: desktopAnnotationRefString(actionMetadata.cropRef) || undefined,
    screenshotRef: desktopAnnotationRefString(actionMetadata.screenshotRef) || undefined,
    targetRef: desktopAnnotationRefString(actionMetadata.targetRef) || undefined,
    hash: desktopAnnotationString(actionMetadata.hash) || undefined,
    provenanceRefs: desktopAnnotationStringList(actionMetadata.provenanceRefs),
    windowBinding: desktopAnnotationWindowBinding(actionMetadata.windowBinding, actionMetadata),
    app: desktopAnnotationBoundedMetadata(actionMetadata.app ?? actionMetadata.application),
    process: desktopAnnotationBoundedMetadata(actionMetadata.process ?? actionMetadata.processInfo),
    candidates: desktopAnnotationBoundedMetadata(actionMetadata.candidates ?? actionMetadata.windowCandidates),
    createdAt: desktopAnnotationString(actionMetadata.createdAt) || undefined,
  };
}

function desktopAnnotationActionMetadata(record: Record<string, unknown>, metadata?: Record<string, unknown>) {
  const refs = recordFromUnknown(record.refs);
  const merged: Record<string, unknown> = {};
  for (const source of [metadata, record, refs]) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return merged;
}

function desktopAnnotationLocatorRegion(record: Record<string, unknown> | undefined) {
  const coordinateSpace = desktopAnnotationString(record?.coordinateSpace) || 'screen';
  const bounds = desktopAnnotationBounds(record?.bounds) ?? desktopAnnotationBounds(record?.rect);
  if (!bounds) return `desktop:${coordinateSpace}`;
  return `desktop:${coordinateSpace}:${Math.round(bounds.x)},${Math.round(bounds.y)},${Math.round(bounds.width)}x${Math.round(bounds.height)}`;
}

function desktopAnnotationBounds(value: unknown): { x: number; y: number; width: number; height: number } | undefined {
  const record = recordFromUnknown(value);
  if (!record) return undefined;
  const x = desktopAnnotationNumber(record.x ?? record.left);
  const y = desktopAnnotationNumber(record.y ?? record.top);
  const width = desktopAnnotationNumber(record.width ?? record.w);
  const height = desktopAnnotationNumber(record.height ?? record.h);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return {
    x,
    y,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

function desktopAnnotationNumber(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

function desktopAnnotationDisplayId(record: Record<string, unknown>, metadata?: Record<string, unknown>) {
  const display = recordFromUnknown(record.display) ?? recordFromUnknown(metadata?.display);
  return desktopAnnotationString(record.displayId)
    || desktopAnnotationString(record.screenId)
    || desktopAnnotationString(metadata?.displayId)
    || desktopAnnotationString(metadata?.screenId)
    || desktopAnnotationString(display?.id)
    || undefined;
}

function desktopAnnotationScale(record: Record<string, unknown>, metadata?: Record<string, unknown>) {
  return desktopAnnotationNumber(record.scale)
    ?? desktopAnnotationNumber(record.displayScale)
    ?? desktopAnnotationNumber(record.devicePixelRatio)
    ?? desktopAnnotationNumber(metadata?.scale)
    ?? desktopAnnotationNumber(metadata?.displayScale)
    ?? desktopAnnotationNumber(metadata?.devicePixelRatio);
}

function desktopAnnotationStringList(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const values = Array.from(new Set(value.map(desktopAnnotationString).filter(Boolean)));
  return values.length ? values.slice(0, 20) : undefined;
}

function desktopAnnotationWindowBinding(value: unknown, root: Record<string, unknown>) {
  const record = recordFromUnknown(value);
  if (!record) return undefined;
  const status = desktopAnnotationString(record.status);
  if (!status) return undefined;
  const isBound = status === 'auto-bound' || status === 'manual-bound';
  const binding: Record<string, unknown> = {
    status,
    confidence: desktopAnnotationNumber(record.confidence),
    reason: desktopAnnotationString(record.reason) || undefined,
    windowRef: isBound ? desktopAnnotationRefString(record.windowRef) || undefined : undefined,
    appName: desktopAnnotationString(record.appName ?? record.app) || undefined,
    bundleId: desktopAnnotationString(record.bundleId) || undefined,
    pid: desktopAnnotationNumber(record.pid),
    title: desktopAnnotationString(record.title ?? record.windowTitle) || undefined,
    windowBounds: desktopAnnotationBounds(record.windowBounds) ?? desktopAnnotationBounds(root.windowBounds),
    windowLocalBounds: desktopAnnotationBounds(record.windowLocalBounds) ?? desktopAnnotationBounds(root.windowLocalBounds),
    candidates: desktopAnnotationWindowBindingCandidates(record.candidates),
  };
  return Object.fromEntries(Object.entries(binding).filter(([, entry]) => entry !== undefined));
}

function desktopAnnotationWindowBindingCandidates(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const candidates = value
    .map((item) => {
      const record = recordFromUnknown(item);
      if (!record) return undefined;
      const candidate = {
        windowRef: desktopAnnotationRefString(record.windowRef) || undefined,
        appName: desktopAnnotationString(record.appName ?? record.app) || undefined,
        bundleId: desktopAnnotationString(record.bundleId) || undefined,
        pid: desktopAnnotationNumber(record.pid),
        title: desktopAnnotationString(record.title ?? record.windowTitle) || undefined,
        confidence: desktopAnnotationNumber(record.confidence),
        reason: desktopAnnotationString(record.reason) || undefined,
        windowBounds: desktopAnnotationBounds(record.windowBounds),
        windowLocalBounds: desktopAnnotationBounds(record.windowLocalBounds),
      };
      return Object.fromEntries(Object.entries(candidate).filter(([, entry]) => entry !== undefined));
    })
    .filter((item) => Boolean(item && Object.keys(item).length)) as Array<Record<string, unknown>>;
  return candidates.length ? candidates.slice(0, 5) : undefined;
}

function desktopAnnotationTitle(sourceKind: DesktopAnnotationSourceKind) {
  if (sourceKind === 'image') return 'Desktop annotation image';
  if (sourceKind === 'window') return 'Desktop target window';
  if (sourceKind === 'crop') return 'Desktop annotation crop';
  if (sourceKind === 'screenshot') return 'Desktop annotation screenshot';
  if (sourceKind === 'target') return 'Desktop annotation target';
  return 'Desktop annotation';
}

function desktopAnnotationString(value: unknown) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || /^data:image\//i.test(text) || /;base64,/i.test(text)) return '';
  return text.slice(0, 512);
}

function desktopAnnotationRefString(value: unknown) {
  const record = recordFromUnknown(value);
  return record
    ? desktopAnnotationString(record.ref)
      || desktopAnnotationString(record.url)
      || desktopAnnotationString(record.localRef)
      || desktopAnnotationString(record.id)
    : desktopAnnotationString(value);
}

function desktopAnnotationBoundedMetadata(value: unknown, depth = 0): unknown {
  if (value === undefined || value === null || depth > 3) return undefined;
  if (typeof value === 'string') return desktopAnnotationString(value) || undefined;
  if (typeof value === 'number') return desktopAnnotationNumber(value);
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 10)
      .map((item) => desktopAnnotationBoundedMetadata(item, depth + 1))
      .filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  const record = recordFromUnknown(value);
  if (!record) return undefined;
  const bounded: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record).slice(0, 24)) {
    if (!desktopAnnotationSafeMetadataKey(key)) continue;
    const normalized = desktopAnnotationBounds(entry) ?? desktopAnnotationBoundedMetadata(entry, depth + 1);
    if (normalized !== undefined) bounded[key] = normalized;
  }
  return Object.keys(bounded).length ? bounded : undefined;
}

function desktopAnnotationSafeMetadataKey(key: string) {
  return !/(?:action|session|executable|command|handler|route|token|secret|password|raw|base64|dataUrl)/i.test(key);
}

function desktopAnnotationDiagnosticMessage(value: unknown) {
  const record = recordFromUnknown(value);
  if (!record) return '';
  const diagnostic = recordFromUnknown(record.diagnostic)
    ?? recordFromUnknown(record.metadata)
    ?? recordFromUnknown(record.diagnostics);
  const message = desktopAnnotationString(record.message)
    || desktopAnnotationString(record.reason)
    || desktopAnnotationString(diagnostic?.message)
    || desktopAnnotationString(diagnostic?.reason)
    || desktopAnnotationString(diagnostic?.code);
  return message.slice(0, 240);
}

function desktopAnnotationHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash).toString(36);
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function SciForgeApp() {
  const initialNavigation = useMemo(() => loadStoredAppNavigation(), []);
  const [page, setPage] = useState<PageId>(initialNavigation.page);
  const [scenarioId, setScenarioId] = useState<ScenarioInstanceId>(initialNavigation.scenarioId);
  const [config, setConfig] = useState<SciForgeConfig>(() => loadSciForgeConfig());
  const [configFileHydrated, setConfigFileHydrated] = useState(false);
  const [detectedFeedbackGithubRepo, setDetectedFeedbackGithubRepo] = useState<string | undefined>();
  const returnPageRef = useRef<PageId>(initialNavigation.page);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('general');
  const [workspaceState, setWorkspaceState] = useState<SciForgeWorkspaceState>(() => {
    const state = loadWorkspaceState();
    const loadedConfig = loadSciForgeConfig();
    return { ...state, workspacePath: normalizeWorkspaceRootPath(loadedConfig.workspacePath || state.workspacePath) };
  });
  const [workspaceStatus, setWorkspaceStatus] = useState('');
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [workspaceLoadingVisible, setWorkspaceLoadingVisible] = useState(true);
  const [handoffAutoRun, setHandoffAutoRun] = useState<HandoffAutoRunRequest | undefined>();
  const [workbenchWorkspaceFileEditor, setWorkbenchWorkspaceFileEditor] = useState<WorkspaceFileEditorState | null>(null);
  const [componentWorkbenchMode, setComponentWorkbenchMode] = useState<ComponentWorkbenchMode>('marketplace');
  const [feedbackAuthor, setFeedbackAuthor] = useState(() => loadFeedbackAuthor());
  const [feedbackAnnotationModeActive, setFeedbackAnnotationModeActive] = useState(false);
  const [desktopAnnotationModeActive, setDesktopAnnotationModeActive] = useState(false);
  const [annotationSidebarOpen, setAnnotationSidebarOpen] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationPlanDraft | null>(() => {
    const draft = loadPersistedAnnotationPlanDraft();
    return draft ? ensureAnnotationReferenceMarkers(draft) : null;
  });
  const [annotationStreamEvents, setAnnotationStreamEvents] = useState<AgentStreamEvent[]>([]);
  const [annotationSaving, setAnnotationSaving] = useState(false);
  const [annotationPlanningRunning, setAnnotationPlanningRunning] = useState(false);
  const [annotationQuickActionRunning, setAnnotationQuickActionRunning] = useState(false);
  const annotationDraftRef = useRef<AnnotationPlanDraft | null>(annotationDraft);
  const annotationPlanRunTokenRef = useRef(0);
  const annotationQuickActionRunTokenRef = useRef(0);
  const [configSaveState, setConfigSaveState] = useState<ConfigSaveState>({ status: 'idle' });
  const [scenarioOverrides, setScenarioOverrides] = useState<Partial<Record<ScenarioInstanceId, ScenarioRuntimeOverride>>>({});
  const [selectedRuntimeComponentIds, setSelectedRuntimeComponentIds] = useState<string[]>(() => defaultPublishedRuntimeComponentIds());
  const [draftsByWorkspace, setDraftsByWorkspace] = useState<WorkspaceScenarioDraftRecord>(() => ({}));
  const [messageScrollTops, setMessageScrollTops] = useState<Record<ScenarioInstanceId, number>>(() => createBuiltInScenarioRecord(0));
  const [workspaceRecoveryFocusKey, setWorkspaceRecoveryFocusKey] = useState<string | undefined>();
  const [peerProjectSessionsByPath, setPeerProjectSessionsByPath] = useState<SidebarProjectSessionsByPath>({});
  const [pendingSidebarThread, setPendingSidebarThread] = useState<{
    scenarioId: ScenarioInstanceId;
    sessionId: string;
    workspacePath: string;
  } | null>(null);
  const [pendingSidebarNewChat, setPendingSidebarNewChat] = useState<{
    scenarioId: ScenarioInstanceId;
    workspacePath: string;
  } | null>(null);
  const [chatReferenceRequest, setChatReferenceRequest] = useState<{ id: string; reference: SciForgeReference } | null>(null);
  const locale = normalizeLocale(config.locale);
  const t = (copy: Record<SupportedLocale, string>) => localeText(locale, copy);

  const sessions = workspaceState.sessionsByScenario;
  const archivedSessionsByAgent = useMemo(
    () => buildArchivedSessionsByScenario(workspaceState.archivedSessions),
    [workspaceState.archivedSessions],
  );
  const archivedCountByAgent = useMemo(
    () => buildArchivedSessionCountsByScenario(archivedSessionsByAgent),
    [archivedSessionsByAgent],
  );
  const peerSessionRefreshKey = useMemo(
    () => JSON.stringify(peerSidebarProjectSessionTargets(config)),
    [config],
  );
  const projectSessionsByPath = useMemo(
    () => buildSidebarProjectSessionsByPath(config, workspaceState, peerProjectSessionsByPath),
    [config, workspaceState, peerProjectSessionsByPath],
  );

  useEffect(() => {
    if (page !== 'settings') saveStoredAppNavigation({ page, scenarioId });
  }, [page, scenarioId]);

  useEffect(() => {
    annotationDraftRef.current = annotationDraft;
  }, [annotationDraft]);

  function openSettings(section: SettingsSectionId = 'general') {
    returnPageRef.current = page === 'settings' ? returnPageRef.current : page;
    setSettingsSection(section);
    setPage('settings');
  }

  function closeSettings() {
    setPage(returnPageRef.current);
  }

  useEffect(() => {
    if (!configFileHydrated) return;
    let cancelled = false;
    void loadPeerSidebarProjectSessionSnapshots(config).then((snapshots) => {
      if (!cancelled) setPeerProjectSessionsByPath(snapshots);
    });
    return () => {
      cancelled = true;
    };
  }, [config, configFileHydrated, peerSessionRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let desktopRuntimeConfig: Partial<SciForgeConfig> | undefined;
      let fileConfig: SciForgeConfig | undefined;
      let fileConfigError: unknown;
      try {
        desktopRuntimeConfig = await loadDesktopRuntimeConfigDefaults();
      } catch {
        desktopRuntimeConfig = undefined;
      }
      try {
        const configForFileLoad = desktopRuntimeConfig ? updateConfig(config, desktopRuntimeConfig) : config;
        fileConfig = await loadFileBackedSciForgeConfig(configForFileLoad);
      } catch (error) {
        fileConfigError = error;
      }
      if (cancelled) return;
      if (fileConfig || desktopRuntimeConfig) {
        setConfig((current) => {
          const fileMerged = fileConfig ? mergeFileBackedConfig(current, fileConfig) : current;
          const next = desktopRuntimeConfig ? updateConfig(fileMerged, desktopRuntimeConfig) : fileMerged;
          saveSciForgeConfig(next);
          return next;
        });
        const nextWorkspacePath = desktopRuntimeConfig?.workspacePath || fileConfig?.workspacePath;
        if (nextWorkspacePath) {
          setWorkspaceState((current) => ({
            ...current,
            workspacePath: normalizeWorkspaceRootPath(nextWorkspacePath || current.workspacePath),
          }));
        }
        setWorkspaceStatus(desktopRuntimeConfig
          ? t({
            'zh-CN': '已从 Electron runtime config 加载桌面运行时配置',
            'en-US': 'Loaded desktop runtime config from Electron runtime config',
          })
          : t({
            'zh-CN': '已从 config.local.json 加载统一配置',
            'en-US': 'Loaded unified config from config.local.json',
          }));
      } else if (fileConfigError) {
        setWorkspaceStatus(t({
          'zh-CN': `config.local.json 未加载：${fileConfigError instanceof Error ? fileConfigError.message : String(fileConfigError)}`,
          'en-US': `config.local.json was not loaded: ${fileConfigError instanceof Error ? fileConfigError.message : String(fileConfigError)}`,
        }));
      }
      setConfigFileHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function hydrateWorkspaceSnapshot(path: string, runtimeConfig: SciForgeConfig, mode: 'prefer-newer' | 'force' = 'prefer-newer') {
    const requestedPath = normalizeWorkspaceRootPath(path);
    setWorkspaceHydrated(false);
    setWorkspaceRecoveryFocusKey(undefined);
    try {
      const persisted = await loadPersistedWorkspaceState(requestedPath, runtimeConfig);
      if (persisted) {
        const restoredPath = normalizeWorkspaceRootPath(persisted.workspacePath || requestedPath);
        setWorkspaceState((current) => {
          const incoming = { ...persisted, workspacePath: restoredPath };
          return mode === 'force' || shouldUsePersistedWorkspaceState(current, incoming) ? incoming : current;
        });
        if (restoredPath && runtimeConfig.workspacePath !== restoredPath) {
          setConfig((current) => {
            if (current.workspacePath === restoredPath) return current;
            const next = updateConfig(current, { workspacePath: restoredPath });
            saveSciForgeConfig(next);
            return next;
          });
        }
        setWorkspaceStatus(t({
          'zh-CN': `已从 ${restoredPath || '最近工作区'}/.sciforge 恢复工作区`,
          'en-US': `Restored workspace from ${restoredPath || 'recent workspace'}/.sciforge`,
        }));
      } else {
        if (requestedPath) {
          setWorkspaceState({ ...createInitialWorkspaceState(), workspacePath: requestedPath });
        }
        setWorkspaceStatus(requestedPath
          ? t({
            'zh-CN': `未找到 ${requestedPath}/.sciforge/workspace-state.json`,
            'en-US': `Did not find ${requestedPath}/.sciforge/workspace-state.json`,
          })
          : t({
            'zh-CN': '未找到最近工作区快照',
            'en-US': 'Did not find a recent workspace snapshot',
          }));
      }
    } catch (err) {
      setWorkspaceStatus(t({
        'zh-CN': `Workspace snapshot 未加载：${err instanceof Error ? err.message : String(err)}`,
        'en-US': `Workspace snapshot was not loaded: ${err instanceof Error ? err.message : String(err)}`,
      }));
    } finally {
      setWorkspaceHydrated(true);
    }
  }

  useEffect(() => {
    if (!configFileHydrated) return;
    let cancelled = false;
    const workspacePath = normalizeWorkspaceRootPath(config.workspacePath);
    const loadStartedAt = Date.now();
    loadPersistedWorkspaceState(workspacePath, config)
      .then((persisted) => {
        if (cancelled) return;
        if (persisted) {
          const restoredPath = normalizeWorkspaceRootPath(persisted.workspacePath || workspacePath);
          setWorkspaceState((current) => {
            const currentUpdatedAt = Date.parse(current.updatedAt || '');
            if (Number.isFinite(currentUpdatedAt) && currentUpdatedAt > loadStartedAt) return current;
            const incoming = { ...persisted, workspacePath: restoredPath };
            return shouldUsePersistedWorkspaceState(current, incoming, { explicitWorkspacePath: Boolean(workspacePath) }) ? incoming : current;
          });
          setConfig((current) => {
            if (current.workspacePath === restoredPath) return current;
            const next = updateConfig(current, { workspacePath: restoredPath });
            saveSciForgeConfig(next);
            return next;
          });
          setWorkspaceStatus(t({
            'zh-CN': `已从 ${restoredPath}/.sciforge 恢复工作区`,
            'en-US': `Restored workspace from ${restoredPath}/.sciforge`,
          }));
        } else {
          if (workspacePath) {
            setWorkspaceState({ ...createInitialWorkspaceState(), workspacePath });
          }
          setWorkspaceStatus(workspacePath
            ? t({
              'zh-CN': `未找到 ${workspacePath}/.sciforge/workspace-state.json`,
              'en-US': `Did not find ${workspacePath}/.sciforge/workspace-state.json`,
            })
            : t({
              'zh-CN': '未找到最近工作区快照',
              'en-US': 'Did not find a recent workspace snapshot',
            }));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setWorkspaceStatus(t({
            'zh-CN': `Workspace snapshot 未加载：${err instanceof Error ? err.message : String(err)}`,
            'en-US': `Workspace snapshot was not loaded: ${err instanceof Error ? err.message : String(err)}`,
          }));
        }
      })
      .finally(() => {
        if (!cancelled) setWorkspaceHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [configFileHydrated, config.workspacePath, config.workspaceWriterBaseUrl]);

  useEffect(() => {
    if (!workspaceHydrated) return;
    if (pendingSidebarThread || pendingSidebarNewChat) return;
    if (workspaceRecoveryFocusKey) return;
    const focus = workspaceRecoveryFocusForState(workspaceState);
    setWorkspaceRecoveryFocusKey(focus ? `${focus.sessionId}:${focus.activeRunId}` : 'none');
    if (!focus) return;
    setScenarioId(focus.scenarioId);
    setPage('workbench');
  }, [workspaceHydrated, workspaceRecoveryFocusKey, workspaceState, pendingSidebarThread, pendingSidebarNewChat]);

  useEffect(() => {
    if (!workspaceHydrated) return;
    if (sidebarProjectPath(config.workspacePath) !== sidebarProjectPath(workspaceState.workspacePath)) return;
    saveWorkspaceState(workspaceState);
    if (workspaceState.workspacePath.trim()) {
      persistWorkspaceState(compactWorkspaceStateForStorage(workspaceState), config)
        .then(() => setWorkspaceStatus(`已同步到 ${workspaceState.workspacePath}/.sciforge`))
        .catch((err) => setWorkspaceStatus(`Workspace writer 未连接：${err instanceof Error ? err.message : String(err)}`));
    }
  }, [workspaceState, config, workspaceHydrated]);

  useEffect(() => {
    if (!configFileHydrated) return;
    let cancelled = false;
    loadSciForgeInstanceManifest(config)
      .then((manifest) => {
        if (cancelled) return;
        setDetectedFeedbackGithubRepo(normalizeFeedbackGithubRepo(manifest.repo.remote));
      })
      .catch(() => {
        if (!cancelled) setDetectedFeedbackGithubRepo(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [configFileHydrated, config.workspacePath, config.workspaceWriterBaseUrl]);

  useEffect(() => {
    if (!configFileHydrated) return;
    saveSciForgeConfig(config);
    setConfigSaveState({ status: 'saving' });
    saveFileBackedSciForgeConfig(config)
      .then(() => {
        const savedAt = nowIso();
        setConfigSaveState({ status: 'saved', savedAt });
        setWorkspaceStatus('已保存到 config.local.json');
      })
      .catch((err) => {
        const message = `config.local.json 未保存：${err instanceof Error ? err.message : String(err)}`;
        setConfigSaveState({ status: 'error', message });
        setWorkspaceStatus(message);
      });
  }, [config, configFileHydrated]);

  const workspaceLoadingActive = !configFileHydrated || !workspaceHydrated;
  useEffect(() => {
    if (workspaceLoadingActive) {
      setWorkspaceLoadingVisible(true);
      return;
    }
    const timer = window.setTimeout(() => setWorkspaceLoadingVisible(false), MIN_WORKSPACE_LOADING_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [workspaceLoadingActive]);

  useEffect(() => {
    if (page !== 'workbench') setWorkbenchWorkspaceFileEditor(null);
  }, [page]);

  useEffect(() => {
    saveFeedbackAuthor(feedbackAuthor);
  }, [feedbackAuthor]);

  useEffect(() => {
    persistAnnotationPlanDraft(annotationDraft);
  }, [annotationDraft]);

  function updateWorkspace(mutator: (state: SciForgeWorkspaceState) => SciForgeWorkspaceState) {
    setWorkspaceState((current) => {
      const next = mutator(current);
      return next === current ? current : touchWorkspaceUpdatedAt(next, nowIso());
    });
  }

  function updateSession(nextSession: SciForgeSession, reason = 'session update') {
    updateWorkspace((current) => applySessionUpdateToWorkspace(current, nextSession, reason));
  }

  function appendTimelineEvent(event: TimelineEventRecord) {
    updateWorkspace((current) => appendTimelineEventToWorkspace(current, event));
  }

  function annotationDraftContext() {
    return {
      page,
      scenarioId,
      sessionId: activeSession.sessionId,
      url: currentBrowserUrl(),
    };
  }

  function annotationRuntimeLaneId(draft: AnnotationPlanDraft, phase: 'plan' | 'quick-action') {
    return `annotation:${draft.sessionId}:${draft.id}:${phase}`;
  }

  function beginAnnotationPlanRun(draft: AnnotationPlanDraft): AnnotationRunToken {
    const sequence = annotationPlanRunTokenRef.current + 1;
    annotationPlanRunTokenRef.current = sequence;
    return {
      sequence,
      draftId: draft.id,
      sessionId: draft.sessionId,
      scenarioId: draft.scenarioId,
    };
  }

  function beginAnnotationQuickActionRun(draft: AnnotationPlanDraft): AnnotationRunToken {
    const sequence = annotationQuickActionRunTokenRef.current + 1;
    annotationQuickActionRunTokenRef.current = sequence;
    return {
      sequence,
      draftId: draft.id,
      sessionId: draft.sessionId,
      scenarioId: draft.scenarioId,
    };
  }

  function annotationRunMatchesDraft(token: AnnotationRunToken, draft: AnnotationPlanDraft | null) {
    return Boolean(
      draft
      && draft.id === token.draftId
      && draft.sessionId === token.sessionId
      && draft.scenarioId === token.scenarioId,
    );
  }

  function annotationPlanRunIsCurrent(token: AnnotationRunToken) {
    return annotationPlanRunTokenRef.current === token.sequence
      && annotationRunMatchesDraft(token, annotationDraftRef.current);
  }

  function annotationQuickActionRunIsCurrent(token: AnnotationRunToken) {
    return annotationQuickActionRunTokenRef.current === token.sequence
      && annotationRunMatchesDraft(token, annotationDraftRef.current);
  }

  function commitAnnotationDraftIfCurrent(token: AnnotationRunToken, draft: AnnotationPlanDraft, kind: 'plan' | 'quick-action') {
    const stillCurrent = kind === 'plan'
      ? annotationPlanRunIsCurrent(token)
      : annotationQuickActionRunIsCurrent(token);
    if (!stillCurrent) return false;
    annotationDraftRef.current = draft;
    setAnnotationDraft(draft);
    return true;
  }

  function ensureAnnotationDraft(current: AnnotationPlanDraft | null) {
    const context = annotationDraftContext();
    if (current && current.status !== 'saved' && current.status !== 'discarded') {
      return ensureAnnotationReferenceMarkers(refreshAnnotationPlanDraftContext(current, context));
    }
    return createAnnotationPlanDraft(context);
  }

  function prepareAnnotationDraft() {
    setAnnotationSidebarOpen(true);
    setAnnotationDraft((current) => {
      const next = ensureAnnotationDraft(current);
      annotationDraftRef.current = next;
      return next;
    });
  }

  function startWebAnnotationSelectionMode() {
    prepareAnnotationDraft();
    setFeedbackAnnotationModeActive((current) => !current);
  }

  async function toggleAnnotationSelectionMode() {
    if (feedbackAnnotationModeActive) {
      setFeedbackAnnotationModeActive(false);
      return;
    }
    if (desktopAnnotationModeActive) {
      setDesktopAnnotationModeActive(false);
      setFeedbackAnnotationModeActive(false);
      return;
    }
    await selectAnnotationMode('screen-region');
  }

  async function selectAnnotationMode(mode: AppAnnotationMode) {
    if (feedbackAnnotationModeActive || desktopAnnotationModeActive) {
      setFeedbackAnnotationModeActive(false);
      setDesktopAnnotationModeActive(false);
      return;
    }
    if (mode === 'sciforge-page') {
      startWebAnnotationSelectionMode();
      return;
    }
    await startDesktopAnnotationMode(mode);
  }

  async function startDesktopAnnotationMode(mode: Exclude<AppAnnotationMode, 'sciforge-page'>) {
    const bridge = typeof window === 'undefined' ? undefined : window.sciforgeDesktop;
    if (!bridge) {
      setWorkspaceStatus(t({
        'zh-CN': `Desktop global annotation bridge is unavailable for ${mode}; blocked until desktop permissions or preload bridge are available. SciForge page annotation can still use DOM comments.`,
        'en-US': `Desktop global annotation bridge is unavailable for ${mode}; blocked until desktop permissions or preload bridge are available. SciForge page annotation can still use DOM comments.`,
      }));
      return;
    }
    const startAnnotation = bridge.startAnnotation ?? bridge.startDesktopAnnotation;
    if (!startAnnotation) {
      setWorkspaceStatus(t({
        'zh-CN': `Desktop global annotation bridge is missing startAnnotation; Desktop global annotation bridge is unavailable for ${mode}. SciForge page annotation can still use DOM comments.`,
        'en-US': `Desktop global annotation bridge is missing startAnnotation; Desktop global annotation bridge is unavailable for ${mode}. SciForge page annotation can still use DOM comments.`,
      }));
      return;
    }

    prepareAnnotationDraft();
    setFeedbackAnnotationModeActive(false);
    setDesktopAnnotationModeActive(true);
    try {
      const result = await startAnnotation({
        schemaVersion: 'sciforge.desktop.annotation.start.v1',
        source: 'sciforge-topbar',
        purpose: desktopAnnotationPurposeForMode(mode),
        mode,
        locale,
        context: annotationDraftContext(),
        createdAt: nowIso(),
      });
      const added = handleDesktopAnnotationResult(result);
      if (!added) {
        setWorkspaceStatus(desktopAnnotationDiagnosticMessage(result)
          || `Desktop global annotation returned no refs for ${mode}.`);
      }
    } catch (error) {
      setWorkspaceStatus(t({
        'zh-CN': `Desktop global annotation bridge is unavailable for ${mode}; blocked: ${error instanceof Error ? error.message : String(error)}`,
        'en-US': `Desktop global annotation bridge is unavailable for ${mode}; blocked: ${error instanceof Error ? error.message : String(error)}`,
      }));
    } finally {
      setDesktopAnnotationModeActive(false);
    }
  }

  function closeAnnotationSidebar() {
    setAnnotationSidebarOpen(false);
    setFeedbackAnnotationModeActive(false);
    setDesktopAnnotationModeActive(false);
  }

  function addAnnotationReferenceToCurrentDraft(input: AnnotationReferenceInput, options: { webSelectionActive: boolean }) {
    setAnnotationSidebarOpen(true);
    setFeedbackAnnotationModeActive(options.webSelectionActive);
    setAnnotationDraft((current) => {
      const next = addAnnotationReferenceToDraft(ensureAnnotationDraft(current), input);
      annotationDraftRef.current = next;
      return next;
    });
  }

  function handleAnnotationReference(input: AnnotationReferenceInput) {
    addAnnotationReferenceToCurrentDraft(input, { webSelectionActive: true });
  }

  function handleDesktopAnnotationResult(result: unknown) {
    let added = false;
    for (const input of desktopAnnotationReferenceInputsFromResult(result)) {
      addAnnotationReferenceToCurrentDraft(input, { webSelectionActive: false });
      added = true;
    }
    return added;
  }

  function handleAnnotationDescriptionChange(description: string) {
    setAnnotationSidebarOpen(true);
    setAnnotationDraft((current) => {
      const next = updateAnnotationPlanDescription(ensureAnnotationDraft(current), description);
      annotationDraftRef.current = next;
      return next;
    });
  }

  async function runAnnotationPlanOnlyTurn(content: string, choice?: AnnotationPlanChoice) {
    const prompt = content.trim();
    if (!prompt) return;
    const draftForTurn = ensureAnnotationDraft(annotationDraft);
    annotationDraftRef.current = draftForTurn;
    const runToken = beginAnnotationPlanRun(draftForTurn);
    const baseScenarioId = builtInScenarioIdForRuntimeInput({ scenarioId, scenarioOverride: activeScenarioOverride });
    const scenario = scenarios.find((item) => item.id === baseScenarioId) ?? scenarios[0];
    const queuedEvent: AgentStreamEvent = {
      id: makeId('evt'),
      type: 'queued',
      label: 'Submitted',
      detail: prompt,
      createdAt: nowIso(),
    };
    setAnnotationPlanningRunning(true);
    setAnnotationStreamEvents([queuedEvent]);
    const emitAnnotationEvent = (event: AgentStreamEvent) => {
      if (!annotationPlanRunIsCurrent(runToken)) return;
      setAnnotationStreamEvents((current) => [...current, event].slice(-48));
    };
    try {
      const result = await runPromptOrchestrator({
        prompt,
        baseSession: activeSession,
        references: draftForTurn.references.map((item) => item.reference),
        scenarioId,
        baseScenarioId,
        scenarioName: scenario.name,
        scenarioDomain: scenario.domain,
        role: 'annotation planner',
        config,
        scenarioOverride: activeScenarioOverride,
        availableComponentIds: selectedRuntimeComponentIds,
        defaultComponentIds: activeScenarioOverride?.defaultComponents?.length
          ? activeScenarioOverride.defaultComponents
          : SCENARIO_SPECS[baseScenarioId].componentPolicy.defaultComponents,
        scenarioPackageRef: activeScenarioOverride?.scenarioPackageRef ?? builtInScenarioPackageRef(baseScenarioId),
        skillPlanRef: activeScenarioOverride?.skillPlanRef ?? `skill-plan.${baseScenarioId}.annotation-plan-only`,
        uiPlanRef: activeScenarioOverride?.uiPlanRef ?? `ui-plan.${baseScenarioId}.annotation-plan-only`,
        streamEvents: [],
        signal: new AbortController().signal,
        userAbortRequested: () => false,
        activeSession: () => activeSession,
        onStreamEvent: emitAnnotationEvent,
        turnMode: 'annotation-plan-only',
        conversationEnvelope: buildAnnotationPlanOnlyEnvelope(draftForTurn),
        conversationLaneId: annotationRuntimeLaneId(draftForTurn, 'plan'),
        runtimeResumePolicy: 'none',
      });
      const assistantContent = result.status === 'completed'
        ? result.finalResponse.message.content
        : `Feedback planning failed: ${result.message}`;
      const currentDraft = annotationDraftRef.current;
      if (annotationRunMatchesDraft(runToken, currentDraft)) {
        const nextDraft = advanceAnnotationPlanClarification(currentDraft, { content: prompt, choice, assistantContent });
        if (commitAnnotationDraftIfCurrent(runToken, nextDraft, 'plan')) {
          setWorkspaceStatus('Feedback plan is ready. You can preview it, make a small edit, or save it to the inbox.');
        }
      }
    } finally {
      if (annotationPlanRunTokenRef.current === runToken.sequence) setAnnotationPlanningRunning(false);
    }
  }

  function handleAnnotationClarify(content: string) {
    void runAnnotationPlanOnlyTurn(content);
  }

  function handleAnnotationChoice(choice: AnnotationPlanChoice) {
    void runAnnotationPlanOnlyTurn(choice.prompt, choice);
  }

  function focusAnnotationReference(reference: AnnotationPlanReferenceRecord) {
    highlightFeedbackTargetSnapshot(reference.target, reference.reference, reference.selectedText);
  }

  async function runAnnotationQuickAction() {
    const draftForTurn = ensureAnnotationDraft(annotationDraft);
    const assessment = assessAnnotationQuickAction(draftForTurn);
    const now = nowIso();
    if (!assessment.eligible) {
      const draftWithRoute = appendAnnotationActionRecord(draftForTurn, {
        action: 'send-to-inbox',
        status: 'blocked',
        summary: assessment.reason,
        risk: assessment.risk,
        createdAt: now,
      });
      annotationDraftRef.current = draftWithRoute;
      setAnnotationDraft(draftWithRoute);
      setWorkspaceStatus(`This feedback needs inbox confirmation: ${assessment.reason}`);
      await persistAnnotationDraftToInbox(draftWithRoute, {
        action: 'send-to-inbox',
        openInboxAfterSave: true,
        statusText: 'Complex change saved to the feedback inbox',
      });
      return;
    }

    const draftWithRequest = appendAnnotationActionRecord(draftForTurn, {
      action: 'apply-small-change',
      status: 'requested',
      summary: assessment.reason,
      risk: assessment.risk,
      createdAt: now,
    });
    const runToken = beginAnnotationQuickActionRun(draftWithRequest);
    const prompt = buildAnnotationQuickActionPrompt(draftWithRequest, assessment);
    const baseScenarioId = builtInScenarioIdForRuntimeInput({ scenarioId, scenarioOverride: activeScenarioOverride });
    const scenario = scenarios.find((item) => item.id === baseScenarioId) ?? scenarios[0];
    const queuedEvent: AgentStreamEvent = {
      id: makeId('evt'),
      type: 'queued',
      label: 'Small edit submitted',
      detail: assessment.reason,
      createdAt: nowIso(),
    };
    annotationDraftRef.current = draftWithRequest;
    setAnnotationDraft(draftWithRequest);
    setAnnotationQuickActionRunning(true);
    setAnnotationStreamEvents([queuedEvent]);
    const emitAnnotationEvent = (event: AgentStreamEvent) => {
      if (!annotationQuickActionRunIsCurrent(runToken)) return;
      setAnnotationStreamEvents((current) => [...current, event].slice(-48));
    };
    try {
      const result = await runPromptOrchestrator({
        prompt,
        baseSession: activeSession,
        references: draftWithRequest.references.map((item) => item.reference),
        scenarioId,
        baseScenarioId,
        scenarioName: scenario.name,
        scenarioDomain: scenario.domain,
        role: 'annotation quick action',
        config,
        scenarioOverride: activeScenarioOverride,
        availableComponentIds: selectedRuntimeComponentIds,
        defaultComponentIds: activeScenarioOverride?.defaultComponents?.length
          ? activeScenarioOverride.defaultComponents
          : SCENARIO_SPECS[baseScenarioId].componentPolicy.defaultComponents,
        scenarioPackageRef: activeScenarioOverride?.scenarioPackageRef ?? builtInScenarioPackageRef(baseScenarioId),
        skillPlanRef: activeScenarioOverride?.skillPlanRef ?? `skill-plan.${baseScenarioId}.annotation-quick-action`,
        uiPlanRef: activeScenarioOverride?.uiPlanRef ?? `ui-plan.${baseScenarioId}.annotation-quick-action`,
        streamEvents: annotationStreamEvents,
        signal: new AbortController().signal,
        userAbortRequested: () => false,
        activeSession: () => activeSession,
        onStreamEvent: emitAnnotationEvent,
        turnMode: 'annotation-quick-action',
        conversationEnvelope: buildAnnotationQuickActionEnvelope(draftWithRequest, assessment),
        conversationLaneId: annotationRuntimeLaneId(draftWithRequest, 'quick-action'),
        runtimeResumePolicy: 'none',
      });
      const assistantContent = result.status === 'completed'
        ? result.finalResponse.message.content
        : `Quick edit did not finish: ${result.message}`;
      const needsInbox = result.status !== 'completed'
        || /\bNEEDS_INBOX\b|需要.*收件箱|未修改|没有修改|no files changed|no changes/i.test(assistantContent);
      const runtimeRunId = result.status === 'completed' ? result.finalResponse.run.id : undefined;
      const draftWithResult = appendAnnotationActionRecord(draftWithRequest, {
        action: 'apply-small-change',
        status: needsInbox ? 'blocked' : 'completed',
        summary: needsInbox ? 'Quick edit was not applied and needs inbox confirmation.' : 'Small low-risk edit was submitted from the sidebar.',
        risk: assessment.risk,
        writesApplied: !needsInbox,
        runtimeRunId,
        createdAt: nowIso(),
      });
      const nextDraft = advanceAnnotationPlanClarification(draftWithResult, {
        content: 'Apply small edit',
        choice: {
          id: 'apply-small-change',
          label: 'Apply small edit',
          prompt,
        },
        assistantContent,
      });
      if (commitAnnotationDraftIfCurrent(runToken, nextDraft, 'quick-action')) {
        await persistAnnotationDraftToInbox(nextDraft, {
          action: needsInbox ? 'send-to-inbox' : 'apply-small-change',
          statusText: needsInbox ? 'Quick edit moved to the feedback inbox' : 'Small edit result saved to the feedback inbox',
        });
      }
    } catch (error) {
      const draftWithFailure = appendAnnotationActionRecord(draftWithRequest, {
        action: 'apply-small-change',
        status: 'blocked',
        summary: error instanceof Error ? error.message : String(error),
        risk: assessment.risk,
        writesApplied: false,
        createdAt: nowIso(),
      });
      if (commitAnnotationDraftIfCurrent(runToken, draftWithFailure, 'quick-action')) {
        await persistAnnotationDraftToInbox(draftWithFailure, {
          action: 'send-to-inbox',
          statusText: 'Quick edit was blocked and moved to the feedback inbox',
        });
      }
    } finally {
      if (annotationQuickActionRunTokenRef.current === runToken.sequence) setAnnotationQuickActionRunning(false);
    }
  }

  function discardAnnotationDraft() {
    setAnnotationDraft((current) => current ? discardAnnotationPlanDraft(current) : current);
    annotationDraftRef.current = null;
    setAnnotationDraft(null);
    setAnnotationSidebarOpen(false);
    setFeedbackAnnotationModeActive(false);
  }

  async function saveAnnotationDraft(options: { openInboxAfterSave?: boolean; action?: AnnotationActionRecord['action']; statusText?: string } = {}) {
    if (!annotationDraft || annotationDraft.status === 'saved') return;
    await persistAnnotationDraftToInbox(annotationDraft, {
      action: options.action ?? 'save-feedback',
      openInboxAfterSave: options.openInboxAfterSave,
      statusText: options.statusText ?? 'Feedback saved to the inbox',
    });
  }

  async function persistAnnotationDraftToInbox(
    draftToSave: AnnotationPlanDraft,
    options: { openInboxAfterSave?: boolean; action?: AnnotationActionRecord['action']; statusText?: string } = {},
  ) {
    if (draftToSave.status === 'saved') return;
    setAnnotationSaving(true);
    try {
      const now = nowIso();
      const feedbackId = makeId('feedback');
      const refs = feedbackEvidenceRefs(feedbackId);
      const draftForComment = appendAnnotationActionRecord(draftToSave, {
        action: options.action ?? 'save-feedback',
        status: 'saved',
        summary: options.statusText ?? 'Feedback saved to the inbox',
        feedbackId,
        createdAt: now,
      });
      const firstReference = draftForComment.references[0];
      const target = firstReference?.target ?? buildFeedbackTargetSnapshot(document.body);
      const annotations = draftForComment.references.map((item) => ({
        label: referenceComposerMarker(item.reference),
        target: item.target,
      }));
      const screenshot = await captureFeedbackScreenshotEvidence(target, now, {
        annotationLabel: annotations[0]?.label ?? 'plan',
        annotations: annotations.length ? annotations : [{ label: 'plan', target }],
      });
      const screenshotWithRefs = screenshot
        ? {
          ...screenshot,
          rawScreenshotRef: refs.rawScreenshotRef,
          annotatedScreenshotRef: refs.annotatedScreenshotRef,
        }
        : undefined;
      const runtime = buildFeedbackRuntimeSnapshot({
        page,
        scenarioId,
        session: activeSession,
        url: currentBrowserUrl(),
        appVersion: APP_BUILD_ID,
      });
      const evidenceStatus = buildFeedbackEvidenceStatus({
        screenshot: screenshotWithRefs,
        target,
        runtime,
        diagnostics: screenshotWithRefs ? [] : ['screenshot capture failed; saved annotation plan target and runtime evidence only'],
      });
      const comment = buildAnnotationPlanFeedbackComment({
        draft: draftForComment,
        feedbackId,
        now,
        author: feedbackAuthor,
        target,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        },
        runtime,
        screenshot: screenshotWithRefs,
        refs,
        evidenceStatus,
      });
      feedbackActions.addFeedbackComment(comment);
      setAnnotationDraft((current) => {
        const next = current ? markAnnotationPlanDraftSaved(current.id === draftForComment.id ? draftForComment : current, feedbackId, now) : current;
        annotationDraftRef.current = next;
        return next;
      });
      setFeedbackAnnotationModeActive(false);
      setWorkspaceStatus(`${options.statusText ?? 'Feedback saved to the inbox'}: ${feedbackId}`);
      if (options.openInboxAfterSave) {
        setPage('feedback');
        setAnnotationSidebarOpen(false);
      }
    } catch (error) {
      setWorkspaceStatus(`Feedback was not saved: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAnnotationSaving(false);
    }
  }

  function openFeedbackInboxFromAnnotation() {
    setPage('feedback');
    setAnnotationSidebarOpen(false);
    setFeedbackAnnotationModeActive(false);
  }

  function setWorkspacePath(value: string) {
    const workspacePath = normalizeWorkspaceRootPath(value);
    const patch = buildWorkspaceDirectorySwitchPatch(config, workspacePath);
    if (!patch) {
      setWorkspaceStatus(t({
        'zh-CN': '请选择一个有效的工作区目录。',
        'en-US': 'Choose a valid workspace directory.',
      }));
      return;
    }
    const nextConfig = updateConfig(config, patch);
    setConfig(nextConfig);
    saveSciForgeConfig(nextConfig);
    void hydrateWorkspaceSnapshot(nextConfig.workspacePath, nextConfig, 'force');
  }

  function handleSidebarWorkspaceIntent(intent: SidebarWorkspaceIntent) {
    setWorkspacePath(intent.workspacePath);
  }

  function activateWorkspaceProject(
    project: Parameters<typeof buildWorkspaceProjectActivation>[1],
    thread?: { scenarioId: ScenarioInstanceId; sessionId: string },
  ) {
    const targetPath = sidebarProjectPath(project.detail || config.workspacePath);
    const patch = buildWorkspaceProjectActivation(config, project);
    if (patch) {
      const departingPath = sidebarProjectPath(config.workspacePath);
      if (departingPath) {
        setPeerProjectSessionsByPath((current) => ({
          ...current,
          [departingPath]: {
            sessionsByScenario: workspaceState.sessionsByScenario,
            archivedSessions: workspaceState.archivedSessions ?? [],
          },
        }));
      }
    }
    if (thread) {
      const needsSwitch = Boolean(patch) || sidebarProjectPath(config.workspacePath) !== targetPath;
      if (needsSwitch) {
        setPendingSidebarThread({
          ...thread,
          workspacePath: sidebarProjectPath(patch?.workspacePath || targetPath),
        });
      } else {
        restoreArchivedSession(thread.scenarioId, thread.sessionId);
        setScenarioId(thread.scenarioId);
        setPage('workbench');
        return;
      }
    }
    if (!patch) return;
    updateRuntimeConfig(patch);
  }

  function updateRuntimeConfig(patch: Partial<SciForgeConfig>) {
    setConfig((current) => {
      const next = ('workspacePath' in patch && !('workspaceWriterBaseUrl' in patch))
        ? applyWorkspaceProjectSwitch(current, patch)
        : updateConfig(current, patch);
      saveSciForgeConfig(next);
      if ('workspacePath' in patch) {
        void hydrateWorkspaceSnapshot(next.workspacePath, next, 'force');
      }
      return next;
    });
  }

  function saveRuntimeConfigNow() {
    const next = updateConfig(config, {});
    saveSciForgeConfig(next);
    setConfigSaveState({ status: 'saving' });
    saveFileBackedSciForgeConfig(next)
      .then(() => {
        const savedAt = nowIso();
        setConfigSaveState({ status: 'saved', savedAt });
        setWorkspaceStatus(t({
          'zh-CN': '设置已保存并对下一次 Codex Runtime 请求生效',
          'en-US': 'Settings saved and will apply to the next Codex Runtime request',
        }));
      })
      .catch((err) => {
        const message = t({
          'zh-CN': `设置未保存：${err instanceof Error ? err.message : String(err)}`,
          'en-US': `Settings were not saved: ${err instanceof Error ? err.message : String(err)}`,
        });
        setConfigSaveState({ status: 'error', message });
        setWorkspaceStatus(message);
      });
  }

  function updateDraft(nextScenarioId: ScenarioInstanceId, value: string) {
    const draftWorkspacePath = workspaceState.workspacePath || config.workspacePath;
    setDraftsByWorkspace((current) => updateWorkspaceDraftRecord(current, draftWorkspacePath, nextScenarioId, value));
  }

  function updateMessageScrollTop(nextScenarioId: ScenarioInstanceId, value: number) {
    setMessageScrollTops((current) => {
      if (Math.abs((current[nextScenarioId] ?? 0) - value) < 1) return current;
      return { ...current, [nextScenarioId]: value };
    });
  }

  function applyScenarioOverride(nextScenarioId: ScenarioInstanceId, override: ScenarioRuntimeOverride) {
    setScenarioOverrides((current) => ({ ...current, [nextScenarioId]: override }));
  }

  function activeSessionFor(state: SciForgeWorkspaceState, nextScenarioId: ScenarioInstanceId) {
    return workspaceActiveSessionFor(state, nextScenarioId, `${scenarioLabelForInstance(nextScenarioId)} 新聊天`);
  }

  function newChat(nextScenarioId: ScenarioInstanceId) {
    updateWorkspace((current) => startNewChat(current, nextScenarioId, `${scenarioLabelForInstance(nextScenarioId)} 新聊天`));
  }

  function deleteChat(nextScenarioId: ScenarioInstanceId) {
    updateWorkspace((current) => deleteActiveChat(current, nextScenarioId, `${scenarioLabelForInstance(nextScenarioId)} 新聊天`));
  }

  function forkChat(nextScenarioId: ScenarioInstanceId) {
    updateWorkspace((current) => forkScenarioActiveSession(current, nextScenarioId));
  }

  function restoreArchivedSession(nextScenarioId: ScenarioInstanceId, sessionId: string) {
    updateWorkspace((current) => restoreScenarioArchivedSession(
      current,
      nextScenarioId,
      sessionId,
      nowIso(),
      `${scenarioLabelForInstance(nextScenarioId)} 新聊天`,
    ));
  }

  function startProjectNewChat(project: SidebarProjectThreadGroup) {
    if (project.current) {
      setScenarioId(scenarioId);
      setPage('workbench');
      newChat(scenarioId);
      return;
    }
    const targetPath = sidebarProjectPath(project.detail || config.workspacePath);
    setPendingSidebarNewChat({ scenarioId, workspacePath: targetPath });
    activateWorkspaceProject(project);
  }

  useEffect(() => {
    if (!pendingSidebarThread || !workspaceHydrated) return;
    const currentPath = normalizeWorkspaceRootPath(config.workspacePath);
    if (currentPath !== pendingSidebarThread.workspacePath) return;
    const { scenarioId: nextScenarioId, sessionId } = pendingSidebarThread;
    const active = workspaceState.sessionsByScenario[nextScenarioId];
    if (active?.sessionId !== sessionId) {
      restoreArchivedSession(nextScenarioId, sessionId);
    }
    setScenarioId(nextScenarioId);
    setPage('workbench');
    setPendingSidebarThread(null);
  }, [pendingSidebarThread, workspaceHydrated, config.workspacePath, workspaceState.sessionsByScenario]);

  useEffect(() => {
    if (!pendingSidebarNewChat || !workspaceHydrated) return;
    const currentPath = normalizeWorkspaceRootPath(config.workspacePath);
    if (currentPath !== pendingSidebarNewChat.workspacePath) return;
    const { scenarioId: nextScenarioId } = pendingSidebarNewChat;
    setScenarioId(nextScenarioId);
    setPage('workbench');
    newChat(nextScenarioId);
    setPendingSidebarNewChat(null);
  }, [pendingSidebarNewChat, workspaceHydrated, config.workspacePath]);

  async function archiveThread(nextScenarioId: ScenarioInstanceId, sessionId: string, project?: SidebarProjectThreadGroup) {
    if (project && !isCurrentSidebarProject(config, project)) {
      const peerState = await loadPeerSidebarProjectWorkspaceState(project);
      const nextState = archiveScenarioActiveSession(
        peerState.state,
        nextScenarioId,
        sessionId,
        `${scenarioLabelForInstance(nextScenarioId)} 新聊天`,
      );
      if (nextState === peerState.state) {
        return false;
      }
      await persistPeerSidebarProjectWorkspaceState(peerState, nextState);
      return true;
    }
    if (!workspaceHasArchivableSidebarChat(workspaceState, nextScenarioId, sessionId)) return false;
    updateWorkspace((current) => archiveScenarioActiveSession(
      current,
      nextScenarioId,
      sessionId,
      `${scenarioLabelForInstance(nextScenarioId)} 新聊天`,
    ));
    return true;
  }

  async function discardThread(nextScenarioId: ScenarioInstanceId, sessionId: string, project?: SidebarProjectThreadGroup) {
    if (project && !isCurrentSidebarProject(config, project)) {
      const peerState = await loadPeerSidebarProjectWorkspaceState(project);
      const nextState = deleteActiveChat(
        peerState.state,
        nextScenarioId,
        `${scenarioLabelForInstance(nextScenarioId)} 新聊天`,
        undefined,
        sessionId,
      );
      if (nextState === peerState.state) return false;
      await persistPeerSidebarProjectWorkspaceState(peerState, nextState);
      return true;
    }
    if (!workspaceCanDiscardSidebarChat(workspaceState, nextScenarioId, sessionId)) return false;
    updateWorkspace((current) => {
      return deleteActiveChat(current, nextScenarioId, `${scenarioLabelForInstance(nextScenarioId)} 新聊天`, undefined, sessionId);
    });
    return true;
  }

  async function restoreSidebarThread(nextScenarioId: ScenarioInstanceId, sessionId: string, project?: SidebarProjectThreadGroup) {
    if (project && !isCurrentSidebarProject(config, project)) {
      const peerState = await loadPeerSidebarProjectWorkspaceState(project);
      if (!peerState.state.archivedSessions.some((session) => session.scenarioId === nextScenarioId && session.sessionId === sessionId)) {
        return false;
      }
      const nextState = restoreScenarioArchivedSession(
        peerState.state,
        nextScenarioId,
        sessionId,
        nowIso(),
        `${scenarioLabelForInstance(nextScenarioId)} 新聊天`,
      );
      if (nextState === peerState.state) return false;
      await persistPeerSidebarProjectWorkspaceState(peerState, nextState);
      return true;
    }
    if (!workspaceState.archivedSessions.some((session) => session.scenarioId === nextScenarioId && session.sessionId === sessionId)) {
      return false;
    }
    restoreArchivedSession(nextScenarioId, sessionId);
    return true;
  }

  function archiveAllChats() {
    if (!workspaceHasArchivableSidebarChats(workspaceState)) return false;
    updateWorkspace((current) => archiveAllScenarioActiveSessions(
      current,
      (nextScenarioId) => `${scenarioLabelForInstance(nextScenarioId)} 新聊天`,
    ));
    return true;
  }

  async function loadPeerSidebarProjectWorkspaceState(project: SidebarProjectThreadGroup): Promise<{
    targetPath: string;
    writerBaseUrl: string;
    state: SciForgeWorkspaceState;
  }> {
    const targetPath = sidebarProjectPath(project.detail);
    const peer = findPeerInstanceForSidebarProject(config, project);
    if (!targetPath || !peer) {
      throw new Error(`${project.label} 没有可写入的项目状态。`);
    }
    const writerBaseUrl = peer.workspaceWriterUrl?.trim() || config.workspaceWriterBaseUrl;
    const cachedBundle = projectSessionsByPath[targetPath];
    let state = await loadPersistedWorkspaceStateForProject(targetPath, config, writerBaseUrl);
    if (!state && cachedBundle) {
      state = {
        ...createInitialWorkspaceState(),
        workspacePath: targetPath,
        sessionsByScenario: cachedBundle.sessionsByScenario as SciForgeWorkspaceState['sessionsByScenario'],
        archivedSessions: cachedBundle.archivedSessions ?? [],
        updatedAt: nowIso(),
      };
    }
    if (!state) {
      throw new Error(`${project.label} 没有可写入的项目状态。`);
    }
    return { targetPath, writerBaseUrl, state };
  }

  async function persistPeerSidebarProjectWorkspaceState(
    peerState: { targetPath: string; writerBaseUrl: string },
    nextState: SciForgeWorkspaceState,
  ) {
    await persistWorkspaceState(compactWorkspaceStateForStorage(nextState), {
      ...config,
      workspacePath: peerState.targetPath,
      workspaceWriterBaseUrl: peerState.writerBaseUrl,
    });
    setPeerProjectSessionsByPath((current) => ({
      ...current,
      [peerState.targetPath]: {
        sessionsByScenario: nextState.sessionsByScenario,
        archivedSessions: nextState.archivedSessions ?? [],
      },
    }));
  }

  async function archiveSidebarProjectChats(project: SidebarProjectThreadGroup) {
    if (isCurrentSidebarProject(config, project)) {
      if (!workspaceHasArchivableSidebarChats(workspaceState)) {
        return false;
      }
      return archiveAllChats();
    }

    const peerState = await loadPeerSidebarProjectWorkspaceState(project);
    if (!workspaceHasArchivableSidebarChats(peerState.state)) {
      return false;
    }

    const nextState = archiveAllScenarioActiveSessions(
      peerState.state,
      (scenarioId) => `${scenarioLabelForInstance(scenarioId)} 新聊天`,
    );
    if (nextState === peerState.state) return false;
    await persistPeerSidebarProjectWorkspaceState(peerState, nextState);
    return true;
  }

  function removeSidebarProject(project: SidebarProjectThreadGroup) {
    const patch = removeSidebarProjectFromConfig(config, project);
    if (!patch) throw new Error('Open another workspace before removing this project from the sidebar. Local files are not deleted.');
    updateRuntimeConfig(patch);
  }

  function deleteArchivedSessions(nextScenarioId: ScenarioInstanceId, sessionIds: string[]) {
    if (!sessionIds.length) return;
    updateWorkspace((current) => deleteScenarioArchivedSessions(current, nextScenarioId, sessionIds));
  }

  function clearArchivedSessions(nextScenarioId: ScenarioInstanceId) {
    updateWorkspace((current) => clearScenarioArchivedSessions(current, nextScenarioId));
  }

  function editMessage(nextScenarioId: ScenarioInstanceId, messageId: string, content: string) {
    updateSession(editSessionMessage(workspaceState, nextScenarioId, messageId, content, nowIso()), `edit message ${messageId}`);
  }

  function deleteMessage(nextScenarioId: ScenarioInstanceId, messageId: string) {
    updateSession(deleteSessionMessage(workspaceState, nextScenarioId, messageId, nowIso()), `delete message ${messageId}`);
  }

  function markReusableRun(nextScenarioId: ScenarioInstanceId, runId: string) {
    updateWorkspace((current) => markReusableRunInWorkspace(current, nextScenarioId, runId, nowIso()));
  }

  function clearAllArchivedSessions() {
    updateWorkspace((current) => ({
      ...current,
      archivedSessions: current.archivedSessions.filter((session) => isRetainedHistorySession(session)),
    }));
  }

  function restoreArchivedAndOpen(nextScenarioId: ScenarioInstanceId, sessionId: string) {
    restoreArchivedSession(nextScenarioId, sessionId);
    setScenarioId(nextScenarioId);
    setPage('workbench');
    closeSettings();
  }

  function handleSearch(query: string) {
    const target = resolveSearchNavigation(query, scenarios);
    if (!target) return;
    if (target.scenarioId) setScenarioId(target.scenarioId);
    setPage(target.page);
  }

  function openComponentWorkbench(mode: ComponentWorkbenchMode) {
    setWorkspaceRecoveryFocusKey((current) => current ?? 'manual-component-navigation');
    setComponentWorkbenchMode(mode);
    setPage('components');
  }

  function requestChatReference(reference: SciForgeReference) {
    setChatReferenceRequest({ id: `chat-ref-${Date.now()}`, reference });
    if (page !== 'workbench') setPage('workbench');
  }

  function consumeChatReferenceRequest(requestId: string) {
    setChatReferenceRequest((current) => (current?.id === requestId ? null : current));
  }

  function handleArtifactHandoff(targetScenario: ScenarioId, artifact: RuntimeArtifact) {
    const now = nowIso();
    const transition = createArtifactHandoffTransition(scenarios, targetScenario, artifact, {
      now,
      notebookTime: new Date(now).toLocaleString('zh-CN', { hour12: false }),
    });
    setWorkspaceState(transition.apply);
    const target = workbenchNavigationForScenario(transition.targetScenario);
    setScenarioId(target.scenarioId);
    setPage(target.page);
    setHandoffAutoRun(transition.autoRunRequest);
  }

  function consumeHandoffAutoRun(requestId: string) {
    setHandoffAutoRun((current) => current?.id === requestId ? undefined : current);
  }

  function handlePreviewPackageRequest(
    targetScenario: ScenarioInstanceId,
    reference: ObjectReference,
    path?: string,
    descriptor?: PreviewDescriptor,
  ) {
    const target = workbenchNavigationForScenario(targetScenario);
    setScenarioId(target.scenarioId);
    setPage(target.page);
    setHandoffAutoRun(createPreviewPackageAutoRunRequest(targetScenario, previewPackageAutoRunPrompt(reference, path, descriptor)));
  }

  const activeScenarioOverride = scenarioOverrides[scenarioId];
  const activeBuiltInScenarioId = builtInScenarioIdForRuntimeInput({ scenarioId, scenarioOverride: activeScenarioOverride });
  const activeSession = sessions[scenarioId] ?? createSession(scenarioId, `${scenarioLabelForInstance(scenarioId)} 新聊天`);
  const feedbackActions = createSciForgeFeedbackActions({
    config,
    workspaceState,
    updateWorkspace,
    setWorkspaceStatus,
  });
  const appHealthItems = useRuntimeHealth(config, Object.keys(sessions).length);
  const workspaceLoadingDetail = !configFileHydrated
    ? t({
      'zh-CN': '正在加载本地配置...',
      'en-US': 'Loading local config...',
    })
    : !workspaceHydrated
      ? t({
        'zh-CN': '正在恢复 .sciforge/workspace-state.json...',
        'en-US': 'Restoring .sciforge/workspace-state.json...',
      })
      : workspaceLoadingVisible
        ? t({
          'zh-CN': '正在完成 workspace 状态刷新；反馈计数、筛选和操作范围已经恢复，将在片刻后切换为 loaded。',
          'en-US': 'Finishing workspace state refresh; feedback counts, filters, and action scopes are restored and will switch to loaded shortly.',
        })
      : workspaceStatus || t({
        'zh-CN': '工作区已就绪',
        'en-US': 'Workspace ready',
      });

  return (
    <I18nProvider locale={config.locale}>
    <div className={cx('app-shell', `theme-${config.theme ?? 'dark'}`)} lang={documentLangForLocale(config.locale)}>
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      {page === 'settings' ? (
        <SettingsPage
          config={config}
          onChange={updateRuntimeConfig}
          saveState={configSaveState}
          onSave={saveRuntimeConfigNow}
          onBack={closeSettings}
          initialSection={settingsSection}
          archivedSessions={workspaceState.archivedSessions ?? []}
          scenarioLabelFor={scenarioLabelForInstance}
          onRestoreArchivedSession={restoreArchivedAndOpen}
          onDeleteArchivedSessions={deleteArchivedSessions}
          onClearArchivedSessions={clearAllArchivedSessions}
        />
      ) : (
        <>
      <Sidebar
        page={page}
        setPage={setPage}
        scenarioId={scenarioId}
        setScenarioId={setScenarioId}
        config={config}
        sessionsByScenario={sessions}
        archivedSessions={workspaceState.archivedSessions ?? []}
        onProjectNewChat={startProjectNewChat}
        onArchiveThread={archiveThread}
        onDiscardThread={discardThread}
        onRestoreThread={restoreSidebarThread}
        onArchiveProjectChats={archiveSidebarProjectChats}
        onRemoveSidebarProject={removeSidebarProject}
        onSearchNavigate={handleSearch}
        onOpenAutomations={() => openComponentWorkbench('automations')}
        onOpenCustomize={() => openComponentWorkbench('marketplace')}
        onSettingsOpen={() => openSettings()}
        onWorkspaceIntent={handleSidebarWorkspaceIntent}
        workspaceStatus={workspaceStatus}
        onWorkspacePathChange={setWorkspacePath}
        onWorkspaceProjectActivate={activateWorkspaceProject}
        projectSessionsByPath={projectSessionsByPath}
        activeWorkspacePath={workspaceState.workspacePath}
        deferWorkbenchFilePreview={page === 'workbench'}
        onWorkbenchFileOpened={(file) => setWorkbenchWorkspaceFileEditor({ file, draft: file.content })}
        workbenchEditorFilePath={workbenchWorkspaceFileEditor?.file.path ?? null}
        onWorkbenchEditorPathInvalidated={() => setWorkbenchWorkspaceFileEditor(null)}
        onReferenceToChat={requestChatReference}
      />
      <div className="main-shell">
        <TopBar
          onSearch={handleSearch}
          onSettingsOpen={() => openSettings()}
          theme={config.theme}
          onThemeToggle={() => updateRuntimeConfig({ theme: (config.theme ?? 'dark') === 'dark' ? 'light' : 'dark' })}
          healthItems={appHealthItems}
          annotationModeActive={feedbackAnnotationModeActive || desktopAnnotationModeActive}
          onAnnotationModeToggle={toggleAnnotationSelectionMode}
          onAnnotationModeSelect={selectAnnotationMode}
        />
        <div className="content-shell">
          {page === 'workbench' ? (
            workspaceLoadingActive ? (
              <main className="workspace-loading-panel" role="status" aria-busy="true">
                {workspaceLoadingDetail}
              </main>
            ) : (
            <Workbench
              scenarioId={scenarioId}
              config={config}
              session={activeSession}
              draft={draftForWorkspaceScenario(draftsByWorkspace, workspaceState.workspacePath || config.workspacePath, scenarioId)}
              savedScrollTop={messageScrollTops[scenarioId] ?? 0}
              onDraftChange={updateDraft}
              onScrollTopChange={updateMessageScrollTop}
              onSessionChange={updateSession}
              onNewChat={newChat}
              onDeleteChat={deleteChat}
              onForkChat={forkChat}
              onArchiveChat={(nextScenarioId) => void archiveThread(nextScenarioId, activeSessionFor(workspaceState, nextScenarioId).sessionId)}
              archivedSessions={archivedSessionsByAgent[scenarioId] ?? []}
              onRestoreArchivedSession={restoreArchivedSession}
              onDeleteArchivedSessions={deleteArchivedSessions}
              onClearArchivedSessions={clearArchivedSessions}
              onEditMessage={editMessage}
              onDeleteMessage={deleteMessage}
              archivedCount={archivedCountByAgent[scenarioId] ?? 0}
              onArtifactHandoff={handleArtifactHandoff}
              autoRunRequest={handoffAutoRun}
              onAutoRunConsumed={consumeHandoffAutoRun}
              scenarioOverride={activeScenarioOverride}
              onScenarioOverrideChange={applyScenarioOverride}
              onConfigChange={updateRuntimeConfig}
              onOpenSettings={openSettings}
              onTimelineEvent={appendTimelineEvent}
              onMarkReusableRun={markReusableRun}
              onPreviewPackageRequest={handlePreviewPackageRequest}
              workspaceFileEditor={workbenchWorkspaceFileEditor}
              onWorkspaceFileEditorChange={setWorkbenchWorkspaceFileEditor}
              onExternalReferenceRequest={requestChatReference}
              onExternalReferenceConsumed={consumeChatReferenceRequest}
              externalReferenceRequest={chatReferenceRequest ?? undefined}
              availableComponentIds={selectedRuntimeComponentIds}
              onAvailableComponentIdsChange={setSelectedRuntimeComponentIds}
            />
            )
          ) : page === 'components' ? (
            <ComponentWorkbenchPage mode={componentWorkbenchMode} config={config} />
          ) : (
            <FeedbackInboxPage
              config={config}
              comments={workspaceState.feedbackComments ?? []}
              requests={workspaceState.feedbackRequests ?? []}
              repairRuns={workspaceState.feedbackRepairRuns ?? []}
              repairResults={workspaceState.feedbackRepairResults ?? []}
              repairActions={workspaceState.feedbackRepairActions ?? []}
              repairGuidance={workspaceState.feedbackRepairGuidance ?? []}
              onStatusChange={feedbackActions.updateFeedbackStatus}
              onDelete={feedbackActions.deleteFeedbackComments}
              onRestore={feedbackActions.restoreFeedbackComments}
              onCreateRequest={feedbackActions.createFeedbackRequest}
              onRepairRunWritten={feedbackActions.recordFeedbackRepairRun}
              onRepairResultWritten={feedbackActions.recordFeedbackRepairResult}
              onRepairActionWritten={feedbackActions.recordFeedbackRepairAction}
              onRepairGuidanceWritten={feedbackActions.recordFeedbackRepairGuidance}
              onFeedbackEvidenceUploaded={feedbackActions.recordFeedbackEvidenceUpload}
              feedbackGithubRepo={config.feedbackGithubRepo}
              detectedGithubRepo={detectedFeedbackGithubRepo}
              feedbackGithubToken={config.feedbackGithubToken}
              workspaceLoading={workspaceLoadingVisible}
              workspaceLoadingDetail={workspaceLoadingVisible
                ? workspaceLoadingDetail
                : workspaceStatus || 'workspace snapshot loaded'}
              githubSyncedOpenIssues={workspaceState.githubSyncedOpenIssues ?? []}
              onReplaceGithubSyncedOpenIssues={feedbackActions.replaceGithubSyncedOpenIssues}
              onImportGithubOpenIssues={feedbackActions.importGithubOpenIssuesAsFeedback}
              onGithubIssueSyncPending={feedbackActions.recordGithubIssueSyncPending}
              onGithubIssueSyncFailed={feedbackActions.recordGithubIssueSyncFailed}
              onGithubIssueCreated={feedbackActions.recordGithubIssueCreated}
              onGithubIssueClosed={feedbackActions.recordGithubIssueClosed}
              onOpenGithubSettings={() => openSettings('feedback')}
            />
          )}
        </div>
      </div>
      <AnnotationSidebar
        open={annotationSidebarOpen}
        draft={annotationDraft}
        selectionActive={feedbackAnnotationModeActive || desktopAnnotationModeActive}
        saving={annotationSaving}
        page={page}
        onClose={closeAnnotationSidebar}
        onToggleSelection={toggleAnnotationSelectionMode}
        onDescriptionChange={handleAnnotationDescriptionChange}
        onClarify={handleAnnotationClarify}
        onChoice={handleAnnotationChoice}
	        onRemoveReference={(referenceId) => setAnnotationDraft((current) => {
	          const next = current ? removeAnnotationReferenceFromDraft(current, referenceId) : current;
	          annotationDraftRef.current = next;
	          return next;
	        })}
        onReferenceFocus={focusAnnotationReference}
        onDiscard={discardAnnotationDraft}
        onSave={saveAnnotationDraft}
        onSendToInbox={() => void saveAnnotationDraft({
          openInboxAfterSave: true,
          action: 'send-to-inbox',
          statusText: 'Complex change saved to the feedback inbox',
        })}
	        onApplySmallChange={() => void runAnnotationQuickAction()}
	        onOpenInbox={openFeedbackInboxFromAnnotation}
	        planningRunning={annotationPlanningRunning}
	        quickActionRunning={annotationQuickActionRunning}
	        streamEvents={annotationStreamEvents}
	      />
      <AppContextMenuLayer
        annotationModeActive={feedbackAnnotationModeActive}
        onReferenceToChat={requestChatReference}
      />
      <FeedbackCaptureLayer
        page={page}
        scenarioId={scenarioId}
        session={activeSession}
        appVersion={APP_BUILD_ID}
        author={feedbackAuthor}
        onAuthorChange={setFeedbackAuthor}
        onSubmit={feedbackActions.addFeedbackComment}
        onAnnotationReference={handleAnnotationReference}
        annotationReferenceCount={annotationDraft?.references.length ?? 0}
        annotationModeActive={feedbackAnnotationModeActive}
        onAnnotationModeChange={setFeedbackAnnotationModeActive}
      />
        </>
      )}
    </div>
    </I18nProvider>
  );
}
