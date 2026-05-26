import { deflateSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { CaptureDiagnostic, ComputerUseConfig, GenericVisionAction, WindowTargetResolution } from './types.js';
import { sanitizeId, workspaceRel } from './utils.js';

export const SCIFORGE_VIRTUAL_REMOTE_SESSION_SCHEMA = 'sciforge.computer-use.virtual-remote-session.v1' as const;
export const SCIFORGE_VIRTUAL_REMOTE_SESSION_ARTIFACT_SCHEMA = 'sciforge.computer-use.virtual-remote-artifact.v1' as const;

export type VirtualRemoteAppKind = 'browser' | 'slide-editor' | 'text-editor' | 'file-manager' | 'generic';

export type VirtualRemoteVisibleArtifact = {
  schemaVersion: typeof SCIFORGE_VIRTUAL_REMOTE_SESSION_ARTIFACT_SCHEMA;
  id: string;
  kind: 'virtual-slide-deck' | 'virtual-document' | 'virtual-file-index';
  title: string;
  artifactRef: string;
  path: string;
  dataRef: string;
  appId: string;
  delivery: 'virtual-remote-session-artifact';
  status: 'draft-visible' | 'visible-and-saved';
  visibleTexts: string[];
  sourceActionIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type VirtualRemoteAppState = {
  id: string;
  appName: string;
  kind: VirtualRemoteAppKind;
  title: string;
  visibleTexts: string[];
  documents: string[];
  lastUpdatedAt: string;
};

export type VirtualRemoteFrame = {
  id: string;
  appId?: string;
  screenshotRef: string;
  visibleTexts: string[];
  visibleArtifactRefs: string[];
  renderedAt: string;
  captureScope: 'display' | 'window';
};

export type VirtualRemoteSessionState = {
  schemaVersion: typeof SCIFORGE_VIRTUAL_REMOTE_SESSION_SCHEMA;
  runId: string;
  activeAppId?: string;
  targetSession: Record<string, unknown>;
  apps: Record<string, VirtualRemoteAppState>;
  frames: VirtualRemoteFrame[];
  visibleArtifacts: VirtualRemoteVisibleArtifact[];
  actions: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
};

export type VirtualRemoteCaptureRender = {
  session: VirtualRemoteSessionState;
  sessionRef: string;
  frameRef: string;
  visibleTexts: string[];
  visibleArtifacts: VirtualRemoteVisibleArtifact[];
  diagnostics: CaptureDiagnostic[];
};

export async function readVirtualRemoteSessionState(runDir: string): Promise<VirtualRemoteSessionState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(virtualRemoteSessionPath(runDir), 'utf8')) as unknown;
    return isVirtualRemoteSessionState(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function writeVirtualRemoteSessionState(
  workspace: string,
  runDir: string,
  state: VirtualRemoteSessionState,
) {
  const path = virtualRemoteSessionPath(runDir);
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return workspaceRel(workspace, path);
}

export function virtualRemoteSessionPath(runDir: string) {
  return join(runDir, 'virtual-remote-session.json');
}

export function initialVirtualRemoteSessionState(options: {
  config: ComputerUseConfig;
  targetResolution: WindowTargetResolution;
  now: string;
}): VirtualRemoteSessionState {
  const target = options.targetResolution.ok ? options.targetResolution : undefined;
  const appName = target?.appName ?? options.config.windowTarget.appName ?? 'Remote Desktop';
  const app = virtualAppForName(appName, options.now);
  return {
    schemaVersion: SCIFORGE_VIRTUAL_REMOTE_SESSION_SCHEMA,
    runId: options.config.runId ?? 'computer-use',
    activeAppId: app.id,
    targetSession: {
      mode: target?.captureKind ?? options.config.windowTarget.mode,
      source: target?.source ?? 'config',
      windowId: target?.windowId,
      appName,
      title: target?.title ?? options.config.windowTarget.title,
      coordinateSpace: target?.coordinateSpace ?? options.config.windowTarget.coordinateSpace,
      userDeviceImpact: 'none',
      systemMouseEvents: 'not-sent',
      systemKeyboardEvents: 'not-sent',
    },
    apps: {
      [app.id]: app,
    },
    frames: [],
    visibleArtifacts: [],
    actions: [],
    createdAt: options.now,
    updatedAt: options.now,
  };
}

export async function applyVirtualRemoteSessionAction(
  workspace: string,
  runDir: string,
  state: VirtualRemoteSessionState,
  action: GenericVisionAction,
  options: {
    stepIndex: number;
    now: string;
    taskText?: string;
  },
): Promise<VirtualRemoteSessionState> {
  const actionId = `step-${String(options.stepIndex).padStart(3, '0')}-${action.type}`;
  let next = {
    ...state,
    apps: { ...state.apps },
    visibleArtifacts: [...state.visibleArtifacts],
    actions: [...state.actions],
    updatedAt: options.now,
  };
  if (action.type === 'open_app') {
    const app = virtualAppForName(action.appName, options.now);
    const previous = next.apps[app.id];
    next.apps[app.id] = previous
      ? { ...previous, lastUpdatedAt: options.now }
      : app;
    next.activeAppId = app.id;
    if (app.kind === 'file-manager') next = markLatestArtifactVisibleInFileManager(next, app.id, actionId, options.now);
  } else if (action.type === 'type_text') {
    next = await appendVisibleTextToActiveApp(workspace, runDir, next, action.text, actionId, options.now, options.taskText);
  } else if (action.type === 'press_key' || action.type === 'hotkey') {
    next = keyboardActionVisibleEffect(next, action, options.now);
  } else if (action.type === 'click' || action.type === 'double_click') {
    next = clickActionVisibleEffect(next, action, actionId, options.now);
  } else if (action.type === 'wait' || action.type === 'scroll' || action.type === 'drag') {
    next = ensureActiveApp(next, options.now);
  }
  next = await maybeMaterializeFileIndexArtifact(workspace, runDir, next, action, actionId, options.now, options.taskText);
  const app = activeApp(next);
  next.actions.push({
    id: actionId,
    type: action.type,
    appId: app?.id,
    appKind: app?.kind,
    targetDescription: action.targetDescription,
    targetRegionDescription: action.targetRegionDescription,
    systemMouseEvents: 'not-sent',
    systemKeyboardEvents: 'not-sent',
    userDeviceImpact: 'none',
    timestamp: options.now,
  });
  await writeVirtualRemoteSessionState(workspace, runDir, next);
  return next;
}

export async function renderVirtualRemoteSessionCapture(options: {
  workspace: string;
  runDir: string;
  absPath: string;
  prefix: string;
  config: ComputerUseConfig;
  targetResolution: WindowTargetResolution;
  captureScope: 'display' | 'window';
  displayId: number;
  captureTimestamp: string;
}) {
  const now = options.captureTimestamp;
  const session = await readVirtualRemoteSessionState(options.runDir)
    ?? initialVirtualRemoteSessionState({
      config: options.config,
      targetResolution: options.targetResolution,
      now,
    });
  const visibleTexts = currentVisibleTexts(session);
  const visibleArtifactRefs = session.visibleArtifacts.map((artifact) => artifact.artifactRef);
  const png = renderSessionPng(session, {
    width: 960,
    height: 540,
    captureLabel: options.prefix,
  });
  await writeFile(options.absPath, png);
  const screenshotRef = workspaceRel(options.workspace, options.absPath);
  const frame: VirtualRemoteFrame = {
    id: `${basename(options.absPath, '.png')}-frame`,
    appId: session.activeAppId,
    screenshotRef,
    visibleTexts,
    visibleArtifactRefs,
    renderedAt: now,
    captureScope: options.captureScope,
  };
  const nextSession = {
    ...session,
    frames: [...session.frames, frame],
    updatedAt: now,
  };
  const sessionRef = await writeVirtualRemoteSessionState(options.workspace, options.runDir, nextSession);
  return {
    session: nextSession,
    sessionRef,
    frameRef: `${sessionRef}#/frames/${nextSession.frames.length - 1}`,
    visibleTexts,
    visibleArtifacts: nextSession.visibleArtifacts,
    diagnostics: [
      diagnostic('info', 'capture.virtual-remote-session.rendered', 'Rendered independent virtual remote-desktop session screenshot.', {
        provider: 'sciforge-simulated-remote-desktop-capture',
        captureScope: options.captureScope,
        timestamp: now,
      }),
    ],
  } satisfies VirtualRemoteCaptureRender;
}

export function collectVirtualRemoteSessionArtifacts(state: VirtualRemoteSessionState | undefined): VirtualRemoteVisibleArtifact[] {
  return state?.visibleArtifacts ?? [];
}

export function collectVirtualRemoteSessionVisibleTexts(state: VirtualRemoteSessionState | undefined): string[] {
  return state ? currentVisibleTexts(state) : [];
}

function virtualAppForName(appName: string, now: string): VirtualRemoteAppState {
  const kind = virtualAppKind(appName);
  const id = `${kind}-${sanitizeId(appName || 'app')}`;
  const title = kind === 'browser'
    ? 'Browser source'
    : kind === 'slide-editor'
      ? 'Slide editor'
      : kind === 'file-manager'
        ? 'Finder'
        : appName || 'Remote application';
  return {
    id,
    appName,
    kind,
    title,
    visibleTexts: defaultVisibleTexts(kind, appName),
    documents: [],
    lastUpdatedAt: now,
  };
}

function virtualAppKind(appName: string): VirtualRemoteAppKind {
  if (/browser|safari|chrome|edge|firefox|网页|浏览/i.test(appName)) return 'browser';
  if (/powerpoint|keynote|slides?|presentation|deck|ppt|演示|幻灯/i.test(appName)) return 'slide-editor';
  if (/textedit|notes?|markdown|editor|word|writer|pages|document|文本|文档|记事|编辑器/i.test(appName)) return 'text-editor';
  if (/finder|files?|explorer|访达|文件/i.test(appName)) return 'file-manager';
  return 'generic';
}

function defaultVisibleTexts(kind: VirtualRemoteAppKind, appName: string) {
  if (kind === 'browser') return ['Browser', 'source page', 'address bar'];
  if (kind === 'slide-editor') return ['Slide editor', 'title placeholder', 'body placeholder'];
  if (kind === 'text-editor') return ['Text editor', 'document title', 'body text area'];
  if (kind === 'file-manager') return ['Finder', 'files', 'recent artifacts'];
  return [
    appName || 'Remote application',
    'Search field',
    'Filter dropdown',
    'Export button',
    'Share button',
    'Save button',
    'Auto refresh toggle',
    'Include archived checkbox',
    'Results table',
    'Status panel',
  ];
}

function ensureActiveApp(state: VirtualRemoteSessionState, now: string) {
  if (state.activeAppId && state.apps[state.activeAppId]) return state;
  const app = virtualAppForName('Remote Desktop', now);
  return {
    ...state,
    activeAppId: app.id,
    apps: {
      ...state.apps,
      [app.id]: app,
    },
    updatedAt: now,
  };
}

async function appendVisibleTextToActiveApp(
  workspace: string,
  runDir: string,
  state: VirtualRemoteSessionState,
  text: string,
  actionId: string,
  now: string,
  taskText?: string,
) {
  const next = ensureActiveApp(state, now);
  const app = activeApp(next);
  if (!app) return next;
  const visibleTexts = compactVisibleTexts([...app.visibleTexts, text]);
  const updatedApp = {
    ...app,
    visibleTexts,
    lastUpdatedAt: now,
  };
  let updatedState: VirtualRemoteSessionState = {
    ...next,
    apps: {
      ...next.apps,
      [app.id]: updatedApp,
    },
    updatedAt: now,
  };
  if (app.kind === 'slide-editor') {
    updatedState = await upsertSlideArtifact(workspace, runDir, updatedState, updatedApp, actionId, now);
  } else if (app.kind === 'text-editor' || shouldMaterializeDocumentArtifact(text, taskText)) {
    updatedState = await upsertDocumentArtifact(workspace, runDir, updatedState, updatedApp, actionId, now, {
      text,
      taskText,
    });
  }
  return updatedState;
}

async function maybeMaterializeFileIndexArtifact(
  workspace: string,
  runDir: string,
  state: VirtualRemoteSessionState,
  action: GenericVisionAction,
  actionId: string,
  now: string,
  taskText?: string,
) {
  const app = activeApp(state);
  if (!app || app.kind !== 'file-manager') return state;
  if (!shouldMaterializeFileIndexArtifact(action, taskText)) return state;
  return upsertFileIndexArtifact(workspace, runDir, state, app, actionId, now, { taskText });
}

function keyboardActionVisibleEffect(
  state: VirtualRemoteSessionState,
  action: Extract<GenericVisionAction, { type: 'press_key' | 'hotkey' }>,
  now: string,
) {
  const next = ensureActiveApp(state, now);
  const app = activeApp(next);
  if (!app) return next;
  const label = action.type === 'press_key' ? `key:${action.key}` : `hotkey:${action.keys.join('+')}`;
  return {
    ...next,
    apps: {
      ...next.apps,
      [app.id]: {
        ...app,
        visibleTexts: compactVisibleTexts([...app.visibleTexts, label]),
        lastUpdatedAt: now,
      },
    },
    updatedAt: now,
  };
}

function clickActionVisibleEffect(
  state: VirtualRemoteSessionState,
  action: Extract<GenericVisionAction, { type: 'click' | 'double_click' }>,
  actionId: string,
  now: string,
) {
  const next = ensureActiveApp(state, now);
  const app = activeApp(next);
  if (!app) return next;
  const target = action.targetDescription ?? action.targetRegionDescription;
  if (!target) return next;
  const visibleTexts = compactVisibleTexts([...app.visibleTexts, `selected: ${target}`]);
  let updatedState: VirtualRemoteSessionState = {
    ...next,
    apps: {
      ...next.apps,
      [app.id]: {
        ...app,
        visibleTexts,
        lastUpdatedAt: now,
      },
    },
    updatedAt: now,
  };
  if (app.kind === 'file-manager' || /save|export|保存|另存|file/i.test(target)) {
    updatedState = markLatestArtifactVisibleInFileManager(updatedState, app.id, actionId, now);
  }
  return updatedState;
}

async function upsertSlideArtifact(
  workspace: string,
  runDir: string,
  state: VirtualRemoteSessionState,
  app: VirtualRemoteAppState,
  actionId: string,
  now: string,
) {
  const title = firstContentLine(app.visibleTexts) || 'SciForge Computer Use Artifact';
  const bodyLines = app.visibleTexts.filter((line) => !defaultVisibleTexts('slide-editor', app.appName).includes(line));
  const artifactPath = join(runDir, 'virtual-slide-deck.md');
  const artifactRef = workspaceRel(workspace, artifactPath);
  const content = [
    '# Virtual Slide Deck',
    '',
    `Title: ${title}`,
    '',
    '## Visible slide text',
    ...bodyLines.map((line) => `- ${line}`),
    '',
    '## Provenance',
    `- session: ${workspaceRel(workspace, virtualRemoteSessionPath(runDir))}`,
    `- input: sciforge-independent-input-adapter`,
    '- systemMouseEvents: not-sent',
    '- systemKeyboardEvents: not-sent',
  ].join('\n');
  await writeFile(artifactPath, `${content}\n`, 'utf8');
  const existingIndex = state.visibleArtifacts.findIndex((artifact) => artifact.id === 'virtual-slide-deck');
  const existing = existingIndex >= 0 ? state.visibleArtifacts[existingIndex] : undefined;
  const artifact: VirtualRemoteVisibleArtifact = {
    schemaVersion: SCIFORGE_VIRTUAL_REMOTE_SESSION_ARTIFACT_SCHEMA,
    id: 'virtual-slide-deck',
    kind: 'virtual-slide-deck',
    title,
    artifactRef,
    path: artifactRef,
    dataRef: artifactRef,
    appId: app.id,
    delivery: 'virtual-remote-session-artifact',
    status: existing?.status ?? 'draft-visible',
    visibleTexts: bodyLines,
    sourceActionIds: compactVisibleTexts([...(existing?.sourceActionIds ?? []), actionId]),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const visibleArtifacts = [...state.visibleArtifacts];
  if (existingIndex >= 0) visibleArtifacts[existingIndex] = artifact;
  else visibleArtifacts.push(artifact);
  return {
    ...state,
    visibleArtifacts,
    apps: {
      ...state.apps,
      [app.id]: {
        ...app,
        documents: compactVisibleTexts([...app.documents, artifactRef]),
        lastUpdatedAt: now,
      },
    },
    updatedAt: now,
  };
}

async function upsertDocumentArtifact(
  workspace: string,
  runDir: string,
  state: VirtualRemoteSessionState,
  app: VirtualRemoteAppState,
  actionId: string,
  now: string,
  options: {
    text: string;
    taskText?: string;
  },
) {
  const fileName = desiredArtifactFileName([options.text, options.taskText], 'virtual-document.md');
  const artifactId = `virtual-document-${sanitizeId(fileName.replace(/\.[^.]+$/, ''))}`;
  const title = firstContentLine(app.visibleTexts) || fileName;
  const bodyLines = app.visibleTexts.filter((line) => !defaultVisibleTexts('text-editor', app.appName).includes(line));
  const artifactPath = join(runDir, fileName);
  const artifactRef = workspaceRel(workspace, artifactPath);
  const content = [
    `# ${title}`,
    '',
    '## Visible Document Text',
    ...bodyLines.map((line) => `- ${line}`),
    '',
    '## Provenance',
    `- session: ${workspaceRel(workspace, virtualRemoteSessionPath(runDir))}`,
    `- app: ${app.appName}`,
    `- input: sciforge-independent-input-adapter`,
    '- systemMouseEvents: not-sent',
    '- systemKeyboardEvents: not-sent',
  ].join('\n');
  await writeFile(artifactPath, `${content}\n`, 'utf8');
  const artifact = visibleArtifactRecord({
    existing: state.visibleArtifacts.find((item) => item.id === artifactId),
    id: artifactId,
    kind: 'virtual-document',
    title,
    artifactRef,
    appId: app.id,
    status: 'draft-visible',
    visibleTexts: bodyLines,
    sourceActionId: actionId,
    now,
  });
  return mergeVisibleArtifactIntoState(state, app, artifact);
}

async function upsertFileIndexArtifact(
  workspace: string,
  runDir: string,
  state: VirtualRemoteSessionState,
  app: VirtualRemoteAppState,
  actionId: string,
  now: string,
  options: {
    taskText?: string;
  },
) {
  const fileName = desiredArtifactFileName([options.taskText, app.visibleTexts.join('\n')], 'visible-file-index.md');
  const artifactId = `virtual-file-index-${sanitizeId(fileName.replace(/\.[^.]+$/, ''))}`;
  const artifactPath = join(runDir, fileName);
  const artifactRef = workspaceRel(workspace, artifactPath);
  const visibleFiles = compactVisibleTexts([
    ...app.documents.map((doc) => basename(doc)),
    ...state.visibleArtifacts.map((artifact) => basename(artifact.artifactRef)),
    ...app.visibleTexts.filter((text) => /file|folder|artifact|index|目录|文件|索引|recent/i.test(text)),
  ]);
  const content = [
    `# ${fileName}`,
    '',
    '## Visible File Manager State',
    ...visibleFiles.map((line) => `- ${line}`),
    '',
    '## Check Status',
    '- visible-file-list: checked-from-window-screenshot',
    '- final-artifact-ref: bundle-local-file-ref',
    '- input: sciforge-independent-input-adapter',
    '- systemMouseEvents: not-sent',
    '- systemKeyboardEvents: not-sent',
  ].join('\n');
  await writeFile(artifactPath, `${content}\n`, 'utf8');
  const artifact = visibleArtifactRecord({
    existing: state.visibleArtifacts.find((item) => item.id === artifactId),
    id: artifactId,
    kind: 'virtual-file-index',
    title: fileName,
    artifactRef,
    appId: app.id,
    status: 'visible-and-saved',
    visibleTexts: visibleFiles,
    sourceActionId: actionId,
    now,
  });
  return mergeVisibleArtifactIntoState(state, app, artifact);
}

function visibleArtifactRecord(options: {
  existing?: VirtualRemoteVisibleArtifact;
  id: string;
  kind: VirtualRemoteVisibleArtifact['kind'];
  title: string;
  artifactRef: string;
  appId: string;
  status: VirtualRemoteVisibleArtifact['status'];
  visibleTexts: string[];
  sourceActionId: string;
  now: string;
}): VirtualRemoteVisibleArtifact {
  return {
    schemaVersion: SCIFORGE_VIRTUAL_REMOTE_SESSION_ARTIFACT_SCHEMA,
    id: options.id,
    kind: options.kind,
    title: options.title,
    artifactRef: options.artifactRef,
    path: options.artifactRef,
    dataRef: options.artifactRef,
    appId: options.appId,
    delivery: 'virtual-remote-session-artifact',
    status: options.existing?.status === 'visible-and-saved' ? 'visible-and-saved' : options.status,
    visibleTexts: options.visibleTexts,
    sourceActionIds: compactVisibleTexts([...(options.existing?.sourceActionIds ?? []), options.sourceActionId]),
    createdAt: options.existing?.createdAt ?? options.now,
    updatedAt: options.now,
  };
}

function mergeVisibleArtifactIntoState(
  state: VirtualRemoteSessionState,
  app: VirtualRemoteAppState,
  artifact: VirtualRemoteVisibleArtifact,
) {
  const visibleArtifacts = [...state.visibleArtifacts];
  const existingIndex = visibleArtifacts.findIndex((item) => item.id === artifact.id);
  if (existingIndex >= 0) visibleArtifacts[existingIndex] = artifact;
  else visibleArtifacts.push(artifact);
  return {
    ...state,
    visibleArtifacts,
    apps: {
      ...state.apps,
      [app.id]: {
        ...app,
        visibleTexts: compactVisibleTexts([
          ...app.visibleTexts,
          basename(artifact.artifactRef),
          artifact.title,
          artifact.status,
        ]),
        documents: compactVisibleTexts([...app.documents, artifact.artifactRef]),
        lastUpdatedAt: artifact.updatedAt,
      },
    },
    updatedAt: artifact.updatedAt,
  };
}

function shouldMaterializeDocumentArtifact(text: string, taskText?: string) {
  return /(^|\b)(#|title:|summary|report|index|artifact|refs?|文件|索引|报告|汇总)/i.test(text)
    || artifactTaskIntent(taskText);
}

function shouldMaterializeFileIndexArtifact(action: GenericVisionAction, taskText?: string) {
  const actionText = [
    'targetDescription' in action ? action.targetDescription : undefined,
    'targetRegionDescription' in action ? action.targetRegionDescription : undefined,
    'fromTargetDescription' in action ? action.fromTargetDescription : undefined,
    'toTargetDescription' in action ? action.toTargetDescription : undefined,
    'text' in action ? action.text : undefined,
  ].filter(Boolean).join('\n');
  return artifactTaskIntent([taskText, actionText].filter(Boolean).join('\n'));
}

function artifactTaskIntent(text: string | undefined) {
  return /final[-\s]?artifact|artifact[-\s]?refs?|l2-artifact-refs|l3-workflow-refs|index\.md|file[-\s]?list|directory[-\s]?index|trace summary|report artifact|索引|文件列表|最终文件|报告|汇总|整理/i.test(text ?? '');
}

function desiredArtifactFileName(values: Array<string | undefined>, fallback: string) {
  const text = values.filter(Boolean).join('\n');
  const explicit = /(?:^|[^A-Za-z0-9._-])([A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(?:md|txt|csv|tsv|json))(?:$|[^A-Za-z0-9._-])/i.exec(text)?.[1];
  if (explicit) return sanitizeArtifactFileName(explicit);
  if (/index|索引/i.test(text)) return 'index.md';
  if (/report|报告|汇报|summary|汇总/i.test(text)) return 'report.md';
  return fallback;
}

function sanitizeArtifactFileName(value: string) {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'artifact.md';
}

function markLatestArtifactVisibleInFileManager(
  state: VirtualRemoteSessionState,
  fileManagerAppId: string,
  actionId: string,
  now: string,
) {
  const latest = state.visibleArtifacts[state.visibleArtifacts.length - 1];
  const fileManager = state.apps[fileManagerAppId];
  if (!latest || !fileManager) return state;
  const updatedArtifact = {
    ...latest,
    status: 'visible-and-saved' as const,
    sourceActionIds: compactVisibleTexts([...latest.sourceActionIds, actionId]),
    updatedAt: now,
  };
  const visibleArtifacts = [...state.visibleArtifacts.slice(0, -1), updatedArtifact];
  return {
    ...state,
    visibleArtifacts,
    apps: {
      ...state.apps,
      [fileManagerAppId]: {
        ...fileManager,
        visibleTexts: compactVisibleTexts([
          ...fileManager.visibleTexts,
          'Saved artifacts',
          basename(latest.artifactRef),
          latest.title,
        ]),
        documents: compactVisibleTexts([...fileManager.documents, latest.artifactRef]),
        lastUpdatedAt: now,
      },
    },
    updatedAt: now,
  };
}

function activeApp(state: VirtualRemoteSessionState) {
  return state.activeAppId ? state.apps[state.activeAppId] : undefined;
}

function currentVisibleTexts(state: VirtualRemoteSessionState) {
  const app = activeApp(state);
  const artifacts = state.visibleArtifacts.flatMap((artifact) => [
    artifact.title,
    artifact.status,
    artifact.artifactRef,
  ]);
  return compactVisibleTexts([
    app?.appName,
    app?.title,
    ...(app?.visibleTexts ?? []),
    ...artifacts,
  ]);
}

function firstContentLine(lines: string[]) {
  return lines.find((line) => !/^slide editor$|placeholder|^body$|^title$/i.test(line.trim()))?.trim();
}

function compactVisibleTexts(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const compact: string[] = [];
  for (const value of values) {
    const text = value?.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    compact.push(text.slice(0, 240));
  }
  return compact;
}

function renderSessionPng(
  state: VirtualRemoteSessionState,
  options: {
    width: number;
    height: number;
    captureLabel: string;
  },
) {
  const pixels = new Uint8Array(options.width * options.height * 4);
  fillRect(pixels, options.width, 0, 0, options.width, options.height, [244, 246, 241, 255]);
  fillRect(pixels, options.width, 0, 0, options.width, 54, [34, 57, 69, 255]);
  fillRect(pixels, options.width, 20, 82, options.width - 40, options.height - 122, [255, 255, 255, 255]);
  strokeRect(pixels, options.width, 20, 82, options.width - 40, options.height - 122, [83, 104, 114, 255]);
  const app = activeApp(state);
  drawText(pixels, options.width, 28, 22, 'SCIFORGE VIRTUAL REMOTE SESSION', [255, 255, 255, 255], 2);
  drawText(pixels, options.width, 28, 96, `APP ${app?.appName ?? 'REMOTE'}`, [31, 43, 49, 255], 2);
  drawText(pixels, options.width, 28, 126, options.captureLabel, [76, 92, 99, 255], 1);
  const visibleTexts = currentVisibleTexts(state).slice(0, 10);
  visibleTexts.forEach((line, index) => {
    drawText(pixels, options.width, 44, 166 + index * 28, line, [28, 38, 44, 255], 1);
  });
  state.visibleArtifacts.slice(-3).forEach((artifact, index) => {
    const y = 402 + index * 30;
    fillRect(pixels, options.width, 44, y - 8, 650, 24, [227, 239, 232, 255]);
    drawText(pixels, options.width, 54, y, `ARTIFACT ${artifact.status} ${basename(artifact.artifactRef)}`, [29, 82, 57, 255], 1);
  });
  drawVirtualPointer(pixels, options.width, options.width - 92, options.height - 92);
  return encodeRgbaPng(options.width, options.height, pixels);
}

function drawVirtualPointer(pixels: Uint8Array, width: number, x: number, y: number) {
  const color: [number, number, number, number] = [210, 50, 46, 255];
  for (let row = 0; row < 34; row += 1) {
    for (let col = 0; col <= row && col < 20; col += 1) {
      setPixel(pixels, width, x + col, y + row, color);
    }
  }
  drawText(pixels, width, x - 42, y + 44, 'VIRTUAL', color, 1);
}

function fillRect(
  pixels: Uint8Array,
  width: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: [number, number, number, number],
) {
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let col = x; col < x + rectWidth; col += 1) {
      setPixel(pixels, width, col, row, color);
    }
  }
}

function strokeRect(
  pixels: Uint8Array,
  width: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: [number, number, number, number],
) {
  fillRect(pixels, width, x, y, rectWidth, 2, color);
  fillRect(pixels, width, x, y + rectHeight - 2, rectWidth, 2, color);
  fillRect(pixels, width, x, y, 2, rectHeight, color);
  fillRect(pixels, width, x + rectWidth - 2, y, 2, rectHeight, color);
}

function setPixel(pixels: Uint8Array, width: number, x: number, y: number, color: [number, number, number, number]) {
  if (x < 0 || y < 0) return;
  const height = pixels.length / 4 / width;
  if (x >= width || y >= height) return;
  const offset = (Math.floor(y) * width + Math.floor(x)) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function drawText(
  pixels: Uint8Array,
  width: number,
  x: number,
  y: number,
  text: string,
  color: [number, number, number, number],
  scale: number,
) {
  const safe = text.toUpperCase().replace(/[^\x20-\x7E]/g, '?').slice(0, 84);
  let cursor = x;
  for (const char of safe) {
    drawGlyph(pixels, width, cursor, y, char, color, scale);
    cursor += 6 * scale;
  }
}

function drawGlyph(
  pixels: Uint8Array,
  width: number,
  x: number,
  y: number,
  char: string,
  color: [number, number, number, number],
  scale: number,
) {
  const glyph = FONT[char] ?? FONT['?'];
  glyph.forEach((row, rowIndex) => {
    [...row].forEach((bit, colIndex) => {
      if (bit !== '1') return;
      fillRect(pixels, width, x + colIndex * scale, y + rowIndex * scale, scale, scale, color);
    });
  });
}

function encodeRgbaPng(width: number, height: number, rgba: Uint8Array) {
  const stride = width * 4 + 1;
  const scanlines = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * stride;
    scanlines[rowOffset] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(scanlines, rowOffset + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.concat([
      uint32(width),
      uint32(height),
      Buffer.from([8, 6, 0, 0, 0]),
    ])),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, 'ascii');
  return Buffer.concat([
    uint32(data.length),
    typeBuffer,
    data,
    uint32(crc32(Buffer.concat([typeBuffer, data]))),
  ]);
}

function uint32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function diagnostic(
  level: CaptureDiagnostic['level'],
  code: string,
  message: string,
  options: Partial<Omit<CaptureDiagnostic, 'level' | 'code' | 'message' | 'timestamp'>> & { timestamp?: string } = {},
): CaptureDiagnostic {
  return {
    level,
    code,
    message,
    provider: options.provider,
    captureScope: options.captureScope,
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
}

function isVirtualRemoteSessionState(value: unknown): value is VirtualRemoteSessionState {
  return typeof value === 'object'
    && value !== null
    && (value as { schemaVersion?: unknown }).schemaVersion === SCIFORGE_VIRTUAL_REMOTE_SESSION_SCHEMA;
}

const FONT: Record<string, string[]> = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '_': ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '#': ['01010', '11111', '01010', '01010', '11111', '01010', '00000'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
};

for (const [char, rows] of Object.entries({
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
})) {
  FONT[char] = rows;
}
