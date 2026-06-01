import type { ScenarioId } from '../../data';
import type { ObjectReference, SciForgeMessage, SciForgeWorkspaceState } from '../../domain';
import { artifactTypeForPath, workspacePathBasename } from '../../../../../packages/support/object-references';
import {
  createRightPaneScopedSmokeStorageSeed,
  RIGHT_PANE_SCOPED_SMOKE_SELECTORS,
  type RightPaneScopedSmokeDomElement,
  type RightPaneScopedSmokeDomLike,
  type RightPaneScopedSmokeSeedInput,
  type RightPaneScopedSmokeStorageSeed,
} from './rightPaneScopedSmokeState';
import { canHydrateWorkspaceObjectPath } from './workspaceObjectPreviewModel';

export const RIGHT_PANE_OBJECT_HYDRATION_SMOKE_DEFAULT_FILE_PATH = 'reports/right-pane-object-preview.md';

export const RIGHT_PANE_OBJECT_HYDRATION_SMOKE_SELECTORS = {
  ...RIGHT_PANE_SCOPED_SMOKE_SELECTORS,
  objectReferenceLink: '.object-reference-chip, .markdown-object-ref.message-object-link, .message-object-link',
  objectFocusBanner: '[data-testid="right-pane-object-focus-banner"]',
  workspaceObjectPreview: '.workspace-object-preview',
  workspaceObjectPreviewReference: '.workspace-object-preview[data-sciforge-reference]',
  filePreviewState: '[data-component-id="workspace-file-viewer"] [data-file-preview-state]',
  fileViewModeSourceCommand: '[data-component-id="workspace-file-viewer"] [data-file-view-mode-command="source"]',
  fileViewModePreviewCommand: '[data-component-id="workspace-file-viewer"] [data-file-view-mode-command="preview"]',
  fileViewModePreview: '[data-component-id="workspace-file-viewer"] [data-file-view-mode="preview"]',
  selectedFileRow: '[data-component-id="workspace-file-viewer"] .workspace-file-viewer-row.is-selected',
} as const;

export interface RightPaneObjectHydrationSmokeSeedInput extends RightPaneScopedSmokeSeedInput {
  filePath?: string;
  fileTitle?: string;
  messageContent?: string;
}

export interface RightPaneObjectHydrationSmokeStorageSeed extends RightPaneScopedSmokeStorageSeed {
  fileReference: ObjectReference;
  filePath: string;
}

export interface RightPaneObjectHydrationSmokeEvidenceInput {
  blockedByClient?: unknown;
  rootMounted?: unknown;
  title?: unknown;
  selectedTabLabel?: unknown;
  objectReferenceLinkCount?: unknown;
  objectFocusBannerCount?: unknown;
  objectFocusTitle?: unknown;
  workspaceObjectPreviewCount?: unknown;
  workspaceObjectPreviewReferenceCount?: unknown;
  filesViewerCount?: unknown;
  fileRowCount?: unknown;
  selectedFileRowLabel?: unknown;
  filePreviewState?: unknown;
  fileViewModeSourceCommandCount?: unknown;
  fileViewModePreviewCommandCount?: unknown;
  fileViewModePreviewCount?: unknown;
}

export interface RightPaneObjectHydrationSmokeEvidence {
  blockedByClient: boolean;
  rootMounted: boolean;
  title: string;
  selectedTabLabel: string;
  objectReferenceLinkCount: number;
  objectFocusBannerCount: number;
  objectFocusTitle: string;
  workspaceObjectPreviewCount: number;
  workspaceObjectPreviewReferenceCount: number;
  filesViewerCount: number;
  fileRowCount: number;
  selectedFileRowLabel: string;
  filePreviewState: string;
  fileViewModeSourceCommandCount: number;
  fileViewModePreviewCommandCount: number;
  fileViewModePreviewCount: number;
}

export function createRightPaneObjectHydrationSmokeStorageSeed(
  input: RightPaneObjectHydrationSmokeSeedInput,
): RightPaneObjectHydrationSmokeStorageSeed {
  const filePath = cleanSmokeFilePath(input.filePath ?? RIGHT_PANE_OBJECT_HYDRATION_SMOKE_DEFAULT_FILE_PATH);
  const scenarioId = input.scenarioId ?? 'literature-evidence-review';
  const seed = createRightPaneScopedSmokeStorageSeed({
    ...input,
    activeTab: input.activeTab ?? 'primary',
    scenarioId,
  });
  const fileReference = rightPaneObjectHydrationSmokeFileReference({
    filePath,
    title: input.fileTitle,
  });
  const workspaceState = withObjectHydrationSmokeSession({
    workspaceState: seed.workspaceState,
    scenarioId,
    reference: fileReference,
    messageContent: input.messageContent,
    updatedAt: input.updatedAt,
  });
  return {
    ...seed,
    workspaceState,
    fileReference,
    filePath,
    entries: seed.entries.map((entry) =>
      entry.key === seed.keys.workspace
        ? { ...entry, value: JSON.stringify(workspaceState) }
        : entry),
  };
}

export function rightPaneObjectHydrationSmokeFileReference(input: {
  filePath: string;
  title?: string;
}): ObjectReference {
  const filePath = cleanSmokeFilePath(input.filePath);
  const title = boundedObjectHydrationSmokeLabel(input.title || workspacePathBasename(filePath) || filePath);
  return {
    id: `right-pane-object-hydration-${smokeIdSegment(filePath)}`,
    kind: 'file',
    title,
    ref: `file:${filePath}`,
    artifactType: artifactTypeForPath(filePath, 'file'),
    presentationRole: 'supporting-evidence',
    actions: ['focus-right-pane', 'reveal-in-folder', 'copy-path', 'pin'],
    status: 'available',
    summary: 'Workspace-relative file ref for right-pane preview and Files hydration smoke.',
    provenance: {
      path: filePath,
      producer: 'right-pane-object-hydration-smoke',
    },
  };
}

export function createRightPaneObjectHydrationSmokeEvidence(
  input: RightPaneObjectHydrationSmokeEvidenceInput,
): RightPaneObjectHydrationSmokeEvidence {
  return {
    blockedByClient: Boolean(input.blockedByClient),
    rootMounted: Boolean(input.rootMounted),
    title: boundedObjectHydrationSmokeLabel(input.title),
    selectedTabLabel: boundedObjectHydrationSmokeLabel(input.selectedTabLabel),
    objectReferenceLinkCount: boundedObjectHydrationSmokeCount(input.objectReferenceLinkCount),
    objectFocusBannerCount: boundedObjectHydrationSmokeCount(input.objectFocusBannerCount),
    objectFocusTitle: boundedObjectHydrationSmokeLabel(input.objectFocusTitle),
    workspaceObjectPreviewCount: boundedObjectHydrationSmokeCount(input.workspaceObjectPreviewCount),
    workspaceObjectPreviewReferenceCount: boundedObjectHydrationSmokeCount(input.workspaceObjectPreviewReferenceCount),
    filesViewerCount: boundedObjectHydrationSmokeCount(input.filesViewerCount),
    fileRowCount: boundedObjectHydrationSmokeCount(input.fileRowCount),
    selectedFileRowLabel: boundedObjectHydrationSmokeLabel(input.selectedFileRowLabel),
    filePreviewState: boundedObjectHydrationSmokeLabel(input.filePreviewState),
    fileViewModeSourceCommandCount: boundedObjectHydrationSmokeCount(input.fileViewModeSourceCommandCount),
    fileViewModePreviewCommandCount: boundedObjectHydrationSmokeCount(input.fileViewModePreviewCommandCount),
    fileViewModePreviewCount: boundedObjectHydrationSmokeCount(input.fileViewModePreviewCount),
  };
}

export function collectRightPaneObjectHydrationSmokeSignals(
  documentLike: RightPaneScopedSmokeDomLike,
  options: { blockedByClient?: unknown } = {},
): RightPaneObjectHydrationSmokeEvidence {
  const selectors = RIGHT_PANE_OBJECT_HYDRATION_SMOKE_SELECTORS;
  const selectedTab = one(documentLike, selectors.selectedTab);
  const objectFocusBanner = one(documentLike, selectors.objectFocusBanner);
  const selectedFileRow = one(documentLike, selectors.selectedFileRow);
  const filePreviewState = one(documentLike, selectors.filePreviewState);
  return createRightPaneObjectHydrationSmokeEvidence({
    blockedByClient: options.blockedByClient,
    rootMounted: count(documentLike, selectors.root) > 0,
    title: documentLike.title,
    selectedTabLabel: selectedTab?.textContent,
    objectReferenceLinkCount: count(documentLike, selectors.objectReferenceLink),
    objectFocusBannerCount: count(documentLike, selectors.objectFocusBanner),
    objectFocusTitle: objectFocusBanner?.textContent,
    workspaceObjectPreviewCount: count(documentLike, selectors.workspaceObjectPreview),
    workspaceObjectPreviewReferenceCount: count(documentLike, selectors.workspaceObjectPreviewReference),
    filesViewerCount: count(documentLike, selectors.filesViewer),
    fileRowCount: count(documentLike, selectors.fileRows),
    selectedFileRowLabel: selectedFileRow?.textContent,
    filePreviewState: attr(filePreviewState, 'data-file-preview-state'),
    fileViewModeSourceCommandCount: count(documentLike, selectors.fileViewModeSourceCommand),
    fileViewModePreviewCommandCount: count(documentLike, selectors.fileViewModePreviewCommand),
    fileViewModePreviewCount: count(documentLike, selectors.fileViewModePreview),
  });
}

export function rightPaneObjectHydrationSmokeEvidenceShowsPreviewAndFiles(
  evidence: Pick<RightPaneObjectHydrationSmokeEvidence,
    'blockedByClient'
    | 'rootMounted'
    | 'objectReferenceLinkCount'
    | 'objectFocusBannerCount'
    | 'workspaceObjectPreviewCount'
    | 'workspaceObjectPreviewReferenceCount'
    | 'filesViewerCount'
    | 'filePreviewState'
    | 'fileViewModeSourceCommandCount'
    | 'fileViewModePreviewCommandCount'>,
) {
  return !evidence.blockedByClient
    && evidence.rootMounted
    && evidence.objectReferenceLinkCount > 0
    && evidence.objectFocusBannerCount > 0
    && evidence.workspaceObjectPreviewCount > 0
    && evidence.workspaceObjectPreviewReferenceCount > 0
    && evidence.filesViewerCount > 0
    && Boolean(evidence.filePreviewState)
    && evidence.fileViewModeSourceCommandCount > 0
    && evidence.fileViewModePreviewCommandCount > 0;
}

function withObjectHydrationSmokeSession(input: {
  workspaceState: SciForgeWorkspaceState;
  scenarioId: ScenarioId;
  reference: ObjectReference;
  messageContent?: string;
  updatedAt?: string;
}): SciForgeWorkspaceState {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const previousSession = input.workspaceState.sessionsByScenario[input.scenarioId];
  const message: SciForgeMessage = {
    id: 'message-right-pane-object-hydration-smoke',
    role: 'scenario',
    content: input.messageContent
      ?? `Open workspace object ${input.reference.ref} in the right pane.`,
    createdAt: updatedAt,
    updatedAt,
    status: 'completed',
    objectReferences: [input.reference],
    provenance: {
      kind: 'fixture',
      source: 'right-pane-object-hydration-smoke',
      runtimeRequestEligible: false,
      liveAcceptanceEligible: false,
    },
  };
  return {
    ...input.workspaceState,
    sessionsByScenario: {
      ...input.workspaceState.sessionsByScenario,
      [input.scenarioId]: {
        ...previousSession,
        scenarioId: input.scenarioId,
        title: 'Right pane object hydration smoke',
        messages: [message],
        runs: [],
        artifacts: [],
        updatedAt,
      },
    },
  };
}

function cleanSmokeFilePath(value: unknown) {
  const path = typeof value === 'string' ? value.trim().replace(/\\/g, '/') : '';
  if (!canHydrateWorkspaceObjectPath(path)) {
    throw new Error('right pane object hydration smoke requires a safe workspace-relative file path');
  }
  return path;
}

function smokeIdSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'file';
}

function boundedObjectHydrationSmokeCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(99, Math.max(0, Math.trunc(value)))
    : 0;
}

function boundedObjectHydrationSmokeLabel(value: unknown) {
  const raw = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!raw) return '';
  if (/data:image|base64|authorization|api[-_ ]?key|bearer\s+|secret|password|credential/i.test(raw)) {
    return '[redacted]';
  }
  return raw.length > 96 ? `${raw.slice(0, 93).trim()}...` : raw;
}

function all(documentLike: RightPaneScopedSmokeDomLike, selector: string) {
  return Array.from(documentLike.querySelectorAll(selector) ?? []);
}

function one(documentLike: RightPaneScopedSmokeDomLike, selector: string) {
  return documentLike.querySelector(selector);
}

function count(documentLike: RightPaneScopedSmokeDomLike, selector: string) {
  return all(documentLike, selector).length;
}

function attr(element: RightPaneScopedSmokeDomElement | null | undefined, name: string) {
  return element?.getAttribute?.(name) ?? '';
}
