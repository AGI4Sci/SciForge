export const SIDEBAR_CURSOR_AGENT_REGION_ID = 'sidebar' as const;
export const SIDEBAR_CURSOR_AGENT_REGION_PATH = '/gui/regions/sidebar' as const;
export const SIDEBAR_CURSOR_AGENT_REGION_REF = 'gui:/gui/regions/sidebar' as const;

export type SidebarCursorAgentThreadState = 'active' | 'draft' | 'archived' | 'discarded';
export type SidebarCursorAgentSortMode = 'updatedAt' | 'createdAt' | 'manual';
export type SidebarCursorAgentStatusState = 'ready' | 'syncing' | 'warning' | 'unavailable' | 'unknown';
export type SidebarCursorAgentActionEffect = 'agent-host-command' | 'local-presentation';
export type SidebarCursorAgentPresentationMutation = 'selection' | 'sort' | 'context' | 'navigation';

export type SidebarCursorAgentActionIntent =
  | 'new-project'
  | 'open-workspace'
  | 'new-chat'
  | 'search'
  | 'open-automations'
  | 'open-customize'
  | 'open-repositories'
  | 'archive-project'
  | 'archive-thread'
  | 'discard-thread'
  | 'restore-thread'
  | 'remove-project'
  | 'pin-thread'
  | 'unpin-thread'
  | 'select-project'
  | 'select-thread'
  | 'sort-threads'
  | 'open-context';

export interface SidebarCursorAgentMessageInput {
  id?: string;
  role?: string;
  content?: string;
  createdAt?: string;
  seed?: boolean;
}

export interface SidebarCursorAgentThreadInput {
  id?: string;
  sessionId?: string;
  scenarioId?: string;
  title?: string;
  detail?: string;
  createdAt?: string;
  updatedAt?: string;
  messages?: SidebarCursorAgentMessageInput[];
  state?: SidebarCursorAgentThreadState;
  pinned?: boolean;
  archived?: boolean;
  discarded?: boolean;
}

export interface SidebarCursorAgentBranchInput {
  name?: string;
  detail?: string;
  state?: SidebarCursorAgentStatusState;
}

export interface SidebarCursorAgentLocalEnvironmentInput {
  label?: string;
  detail?: string;
  state?: SidebarCursorAgentStatusState;
}

export interface SidebarCursorAgentContextInput {
  label?: string;
  detail?: string;
  used?: number;
  limit?: number;
  state?: SidebarCursorAgentStatusState;
}

export interface SidebarCursorAgentWorkspaceInput {
  id?: string;
  label?: string;
  path?: string;
  currentBranch?: string | SidebarCursorAgentBranchInput;
  localEnvironment?: string | SidebarCursorAgentLocalEnvironmentInput;
  context?: SidebarCursorAgentContextInput;
}

export interface SidebarCursorAgentProjectInput {
  id?: string;
  label?: string;
  path?: string;
  detail?: string;
  current?: boolean;
  currentBranch?: string | SidebarCursorAgentBranchInput;
  localEnvironment?: string | SidebarCursorAgentLocalEnvironmentInput;
  context?: SidebarCursorAgentContextInput;
  threads?: SidebarCursorAgentThreadInput[];
  sessions?: SidebarCursorAgentThreadInput[];
  archivedThreads?: SidebarCursorAgentThreadInput[];
  discardedThreads?: SidebarCursorAgentThreadInput[];
  pinnedThreadIds?: string[];
}

export interface SidebarCursorAgentSelectionInput {
  projectId?: string;
  threadId?: string;
}

export interface SidebarCursorAgentPresentationInput {
  sort?: SidebarCursorAgentSortMode;
  searchQuery?: string;
  includeArchived?: boolean;
  includeDiscarded?: boolean;
}

export interface SidebarCursorAgentProjectionInput {
  workspace?: SidebarCursorAgentWorkspaceInput;
  projects?: SidebarCursorAgentProjectInput[];
  selection?: SidebarCursorAgentSelectionInput;
  presentation?: SidebarCursorAgentPresentationInput;
}

export interface SidebarCursorAgentStatus {
  label: string;
  detail: string;
  state: SidebarCursorAgentStatusState;
}

export interface SidebarCursorAgentAction {
  id: string;
  intent: SidebarCursorAgentActionIntent;
  label: string;
  scope: 'workspace' | 'project' | 'thread' | 'sidebar';
  effect: SidebarCursorAgentActionEffect;
  targetRef: string;
  commandText?: string;
  mutates: boolean;
  localPresentation: boolean;
  presentationMutation?: SidebarCursorAgentPresentationMutation;
}

export interface SidebarCursorAgentThread {
  id: string;
  resourceRef: string;
  title: string;
  detail: string;
  state: SidebarCursorAgentThreadState;
  pinned: boolean;
  archived: boolean;
  discarded: boolean;
  selected: boolean;
  updatedAt: string;
  createdAt: string;
  badges: string[];
  actions: SidebarCursorAgentAction[];
  presentationActions: SidebarCursorAgentAction[];
}

export interface SidebarCursorAgentProjectGroup {
  id: string;
  resourceRef: string;
  label: string;
  detail: string;
  current: boolean;
  selected: boolean;
  status: {
    branch: SidebarCursorAgentStatus;
    localEnvironment: SidebarCursorAgentStatus;
    context: SidebarCursorAgentStatus;
  };
  threads: SidebarCursorAgentThread[];
  actions: SidebarCursorAgentAction[];
  presentationActions: SidebarCursorAgentAction[];
}

export interface SidebarCursorAgentWorkspace {
  id: string;
  resourceRef: string;
  label: string;
  detail: string;
}

export interface SidebarCursorAgentProjection {
  schemaVersion: 1;
  kind: 'cursor-agent-like-sidebar';
  sidebarResourceRef: typeof SIDEBAR_CURSOR_AGENT_REGION_REF;
  workspace: SidebarCursorAgentWorkspace;
  groups: SidebarCursorAgentProjectGroup[];
  actions: SidebarCursorAgentAction[];
  presentationActions: SidebarCursorAgentAction[];
  resourceRefs: {
    sidebar: typeof SIDEBAR_CURSOR_AGENT_REGION_REF;
    workspace: string;
    groups: string[];
    threads: string[];
  };
}

export interface SidebarCursorAgentGuiRegionDetail {
  regionId: typeof SIDEBAR_CURSOR_AGENT_REGION_ID;
  viewId: 'cursor-agent-like-sidebar';
  visibleRefs: string[];
  selectionSummary: string;
  rendererState: {
    kind: 'cursor-agent-like-sidebar';
    projection: SidebarCursorAgentProjection;
  };
  affordances: Array<{ label: string; commandText: string; style?: 'primary' | 'secondary' | 'danger' }>;
  summary: string;
  title: string;
}

export function buildSidebarCursorAgentProjection(
  input: SidebarCursorAgentProjectionInput = {},
): SidebarCursorAgentProjection {
  const workspace = buildWorkspaceProjection(input.workspace);
  const sort = input.presentation?.sort ?? 'updatedAt';
  const groups = (input.projects ?? []).map((project, index) => buildProjectGroupProjection({
    project,
    workspace,
    workspaceInput: input.workspace,
    index,
    sort,
    selection: input.selection,
    presentation: input.presentation,
  }));
  const actions = [
    buildNewProjectAction(workspace.resourceRef, workspace.detail),
    buildOpenWorkspaceAction(workspace.resourceRef),
    buildSearchAction(SIDEBAR_CURSOR_AGENT_REGION_REF, input.presentation?.searchQuery),
  ];
  const presentationActions = [
    buildSortAction(SIDEBAR_CURSOR_AGENT_REGION_REF, 'updatedAt'),
    buildSortAction(SIDEBAR_CURSOR_AGENT_REGION_REF, 'createdAt'),
    buildSortAction(SIDEBAR_CURSOR_AGENT_REGION_REF, 'manual'),
    buildOpenRepositoriesAction(SIDEBAR_CURSOR_AGENT_REGION_REF),
    buildOpenAutomationsAction(SIDEBAR_CURSOR_AGENT_REGION_REF),
    buildOpenCustomizeAction(SIDEBAR_CURSOR_AGENT_REGION_REF),
  ];

  return {
    schemaVersion: 1,
    kind: 'cursor-agent-like-sidebar',
    sidebarResourceRef: SIDEBAR_CURSOR_AGENT_REGION_REF,
    workspace,
    groups,
    actions,
    presentationActions,
    resourceRefs: {
      sidebar: SIDEBAR_CURSOR_AGENT_REGION_REF,
      workspace: workspace.resourceRef,
      groups: groups.map((group) => group.resourceRef),
      threads: groups.flatMap((group) => group.threads.map((thread) => thread.resourceRef)),
    },
  };
}

export function collectSidebarCursorAgentActions(
  projection: SidebarCursorAgentProjection,
): SidebarCursorAgentAction[] {
  return [
    ...projection.actions,
    ...projection.presentationActions,
    ...projection.groups.flatMap((group) => [
      ...group.actions,
      ...group.presentationActions,
      ...group.threads.flatMap((thread) => [...thread.actions, ...thread.presentationActions]),
    ]),
  ];
}

export function sidebarCursorAgentResourceRef(...segments: string[]): string {
  const suffix = segments.map(resourceSegment).filter(Boolean).join('/');
  return suffix ? `${SIDEBAR_CURSOR_AGENT_REGION_REF}/${suffix}` : SIDEBAR_CURSOR_AGENT_REGION_REF;
}

export function sidebarCursorAgentRegionDetail(
  projection: SidebarCursorAgentProjection,
): SidebarCursorAgentGuiRegionDetail {
  const allActions = collectSidebarCursorAgentActions(projection);
  return {
    regionId: SIDEBAR_CURSOR_AGENT_REGION_ID,
    viewId: 'cursor-agent-like-sidebar',
    visibleRefs: projection.resourceRefs.threads.length
      ? projection.resourceRefs.threads
      : [projection.resourceRefs.workspace],
    selectionSummary: sidebarSelectionSummary(projection),
    rendererState: {
      kind: 'cursor-agent-like-sidebar',
      projection,
    },
    affordances: allActions
      .filter((action) => action.commandText)
      .map((action) => ({
        label: action.label,
        commandText: action.commandText!,
        style: action.intent === 'discard-thread' ? 'danger' as const : undefined,
      })),
    summary: sidebarProjectionSummary(projection),
    title: 'Project chats',
  };
}

export function containsSidebarCursorAgentInternalTerm(value: string): boolean {
  return /\b(?:ExecutionUnit|execution-unit|provider|model|profile|runtime\s+codex|runtime|live-runtime-codex|native-message|raw\s+JSONL|stdout|stderr|ConversationProjection|ArtifactDelivery|codex-command|run\s+id|workspace\s+command|Authorization|api\s*key|secret|token|credential)\b/i.test(value)
    || /\brun-[a-z0-9][a-z0-9_-]*\b/i.test(value)
    || /https?:\/\/|(?:^|\s)(?:\/Users|\/Applications|\/Volumes|\/private|\/var\/folders|\/tmp)\/|\bsk-[A-Za-z0-9._-]+/i.test(value);
}

function buildWorkspaceProjection(input: SidebarCursorAgentWorkspaceInput | undefined): SidebarCursorAgentWorkspace {
  const rawKey = firstNonEmpty(input?.id, input?.label, basename(input?.path), 'workspace');
  const label = safeVisibleLine(input?.label, basename(input?.path) || 'Workspace', 48);
  const detail = input?.path ? `Local workspace: ${safeVisibleLine(basename(input.path), 'workspace', 48)}` : 'Local workspace';
  const publicId = stablePublicId('workspace', rawKey);
  const resourceRef = sidebarCursorAgentResourceRef('workspaces', publicId);
  return {
    id: publicId,
    resourceRef,
    label,
    detail,
  };
}

function buildProjectGroupProjection(args: {
  project: SidebarCursorAgentProjectInput;
  workspace: SidebarCursorAgentWorkspace;
  workspaceInput?: SidebarCursorAgentWorkspaceInput;
  index: number;
  sort: SidebarCursorAgentSortMode;
  selection?: SidebarCursorAgentSelectionInput;
  presentation?: SidebarCursorAgentPresentationInput;
}): SidebarCursorAgentProjectGroup {
  const projectKey = firstNonEmpty(args.project.id, args.project.label, basename(args.project.path), `project-${args.index + 1}`);
  const label = safeVisibleLine(args.project.label, basename(args.project.path) || `Project ${args.index + 1}`, 48);
  const publicId = stablePublicId('project', projectKey);
  const detail = safeVisibleLine(args.project.detail, 'Project workspace', 96);
  const resourceRef = `${args.workspace.resourceRef}/projects/${resourceSegment(publicId)}`;
  const rawThreads = collectProjectThreadInputs(args.project);
  const pinnedThreadIds = new Set(args.project.pinnedThreadIds ?? []);
  const threads = rawThreads
    .map((thread, index) => buildThreadProjection({
      thread,
      index,
      groupRef: resourceRef,
      projectRef: resourceRef,
      pinned: thread.pinned === true || pinnedThreadIds.has(firstNonEmpty(thread.id, thread.sessionId, thread.scenarioId)),
      selection: args.selection,
    }))
    .filter((thread) => args.presentation?.includeArchived !== false || !thread.archived)
    .filter((thread) => args.presentation?.includeDiscarded !== false || !thread.discarded);
  sortThreads(threads, args.sort);

  return {
    id: publicId,
    resourceRef,
    label,
    detail,
    current: args.project.current === true,
    selected: selectionMatches(args.selection?.projectId, projectKey, publicId),
    status: {
      branch: normalizeBranchStatus(args.project.currentBranch ?? args.workspaceInput?.currentBranch),
      localEnvironment: normalizeLocalEnvironmentStatus(args.project.localEnvironment ?? args.workspaceInput?.localEnvironment),
      context: normalizeContextStatus(args.project.context ?? args.workspaceInput?.context),
    },
    threads,
    actions: [
      buildNewChatAction(resourceRef),
      buildSearchAction(resourceRef, args.presentation?.searchQuery),
      buildArchiveProjectAction(resourceRef),
      ...(!args.project.current ? [buildRemoveProjectAction(resourceRef)] : []),
    ],
    presentationActions: [
      buildSelectProjectAction(resourceRef),
      buildOpenContextAction(resourceRef),
    ],
  };
}

function buildThreadProjection(args: {
  thread: SidebarCursorAgentThreadInput;
  index: number;
  groupRef: string;
  projectRef: string;
  pinned: boolean;
  selection?: SidebarCursorAgentSelectionInput;
}): SidebarCursorAgentThread {
  const rawKey = firstNonEmpty(args.thread.id, args.thread.sessionId, args.thread.scenarioId, `draft-${args.index + 1}`);
  const publicId = stablePublicId('thread', rawKey);
  const state = resolveThreadState(args.thread);
  const resourceRef = `${args.groupRef}/threads/${resourceSegment(publicId)}`;
  const title = buildThreadTitle(args.thread, state);
  const detail = buildThreadDetail(args.thread, state);
  const pinned = args.pinned && state !== 'discarded';
  const archived = state === 'archived';
  const discarded = state === 'discarded';
  return {
    id: publicId,
    resourceRef,
    title,
    detail,
    state,
    pinned,
    archived,
    discarded,
    selected: selectionMatches(args.selection?.threadId, rawKey, publicId),
    updatedAt: safeTimestamp(args.thread.updatedAt ?? args.thread.createdAt),
    createdAt: safeTimestamp(args.thread.createdAt ?? args.thread.updatedAt),
    badges: threadBadges(state, pinned),
    actions: buildThreadCommandActions(resourceRef, args.projectRef, state, pinned),
    presentationActions: [
      buildSelectThreadAction(resourceRef),
    ],
  };
}

function collectProjectThreadInputs(project: SidebarCursorAgentProjectInput): SidebarCursorAgentThreadInput[] {
  return [
    ...(project.threads ?? []),
    ...(project.sessions ?? []),
    ...(project.archivedThreads ?? []).map((thread) => ({ ...thread, archived: true })),
    ...(project.discardedThreads ?? []).map((thread) => ({ ...thread, discarded: true })),
  ];
}

function resolveThreadState(thread: SidebarCursorAgentThreadInput): SidebarCursorAgentThreadState {
  if (thread.discarded || thread.state === 'discarded') return 'discarded';
  if (thread.archived || thread.state === 'archived') return 'archived';
  if (thread.state === 'draft') return 'draft';
  if (thread.state === 'active') return 'active';
  return hasUserVisibleThreadActivity(thread) ? 'active' : 'draft';
}

function hasUserVisibleThreadActivity(thread: SidebarCursorAgentThreadInput): boolean {
  const safeTitle = safeVisibleLine(thread.title, '', 48);
  if (safeTitle) return true;
  const safeDetail = safeVisibleLine(thread.detail, '', 64);
  if (safeDetail) return true;
  return semanticMessages(thread).length > 0;
}

function buildThreadTitle(thread: SidebarCursorAgentThreadInput, state: SidebarCursorAgentThreadState): string {
  const title = safeVisibleLine(thread.title, '', 54);
  if (title) return title;
  const firstUser = semanticMessages(thread).find((message) => message.role === 'user')?.content;
  const promptTitle = safeVisibleLine(firstUser, '', 54);
  if (promptTitle) return promptTitle;
  if (state === 'draft') return 'New chat';
  if (state === 'archived') return 'Archived chat';
  if (state === 'discarded') return 'Deleted chat';
  return 'Untitled chat';
}

function buildThreadDetail(thread: SidebarCursorAgentThreadInput, state: SidebarCursorAgentThreadState): string {
  const detail = safeVisibleLine(thread.detail, '', 72);
  if (detail) return detail;
  if (state === 'draft') return 'Draft ready';
  if (state === 'archived') return 'Archived';
  if (state === 'discarded') return 'Deleted';

  const latest = [...semanticMessages(thread)].reverse()[0];
  const snippet = safeVisibleLine(latest?.content, '', 72);
  if (!snippet) return 'Ready to continue';
  if (latest?.role === 'user') return `Last prompt: ${snippet}`;
  if (latest?.role === 'assistant' || latest?.role === 'scenario') return `Last reply: ${snippet}`;
  return `Last update: ${snippet}`;
}

function semanticMessages(thread: SidebarCursorAgentThreadInput): SidebarCursorAgentMessageInput[] {
  return (thread.messages ?? []).filter((message) => {
    if (message.seed === true) return false;
    if ((message.id ?? '').startsWith('seed')) return false;
    return Boolean(safeVisibleLine(message.content, '', 96));
  });
}

function threadBadges(state: SidebarCursorAgentThreadState, pinned: boolean): string[] {
  const badges: string[] = [];
  if (pinned) badges.push('Pinned');
  if (state === 'draft') badges.push('Draft');
  if (state === 'archived') badges.push('Archived');
  if (state === 'discarded') badges.push('Deleted');
  return badges;
}

function buildThreadCommandActions(
  threadRef: string,
  projectRef: string,
  state: SidebarCursorAgentThreadState,
  pinned: boolean,
): SidebarCursorAgentAction[] {
  const actions: SidebarCursorAgentAction[] = [];
  if (state === 'archived' || state === 'discarded') {
    actions.push(commandAction({
      intent: 'restore-thread',
      label: 'Restore chat',
      scope: 'thread',
      targetRef: threadRef,
      mutates: true,
      commandText: commandText('chat', 'restore', ['--project-ref', projectRef, '--thread-ref', threadRef]),
    }));
    return actions;
  }

  actions.push(commandAction({
    intent: pinned ? 'unpin-thread' : 'pin-thread',
    label: pinned ? 'Unpin chat' : 'Pin chat',
    scope: 'thread',
    targetRef: threadRef,
    mutates: true,
    commandText: commandText('chat', pinned ? 'unpin' : 'pin', ['--project-ref', projectRef, '--thread-ref', threadRef]),
  }));
  if (state === 'draft') {
    actions.push(commandAction({
      intent: 'discard-thread',
      label: 'Discard draft',
      scope: 'thread',
      targetRef: threadRef,
      mutates: true,
      commandText: commandText('chat', 'discard', ['--project-ref', projectRef, '--thread-ref', threadRef]),
    }));
    return actions;
  }
  actions.push(commandAction({
    intent: 'archive-thread',
    label: 'Archive chat',
    scope: 'thread',
    targetRef: threadRef,
    mutates: true,
    commandText: commandText('chat', 'archive', ['--project-ref', projectRef, '--thread-ref', threadRef]),
  }));
  return actions;
}

function buildNewProjectAction(workspaceRef: string, workspaceDetail: string): SidebarCursorAgentAction {
  return commandAction({
    intent: 'new-project',
    label: 'New project',
    scope: 'workspace',
    targetRef: workspaceRef,
    mutates: true,
    commandText: commandText('project', 'new', ['--from-sidebar', '', '--workspace-ref', workspaceRef, '--workspace-label', workspaceDetail || 'Local workspace']),
  });
}

function buildOpenWorkspaceAction(workspaceRef: string): SidebarCursorAgentAction {
  return commandAction({
    intent: 'open-workspace',
    label: 'Open Workspace',
    scope: 'workspace',
    targetRef: workspaceRef,
    mutates: true,
    commandText: commandText('project', 'open-workspace', ['--from-sidebar', '', '--workspace-ref', workspaceRef]),
  });
}

function buildNewChatAction(projectRef: string): SidebarCursorAgentAction {
  return commandAction({
    intent: 'new-chat',
    label: 'New chat',
    scope: 'project',
    targetRef: projectRef,
    mutates: true,
    commandText: commandText('chat', 'new', ['--project-ref', projectRef]),
  });
}

function buildArchiveProjectAction(projectRef: string): SidebarCursorAgentAction {
  return commandAction({
    intent: 'archive-project',
    label: 'Archive All',
    scope: 'project',
    targetRef: projectRef,
    mutates: true,
    commandText: commandText('chat', 'archive-all', ['--project-ref', projectRef]),
  });
}

function buildRemoveProjectAction(projectRef: string): SidebarCursorAgentAction {
  return commandAction({
    intent: 'remove-project',
    label: 'Remove from Sidebar',
    scope: 'project',
    targetRef: projectRef,
    mutates: true,
    commandText: commandText('project', 'remove-from-sidebar', ['--project-ref', projectRef, '--keep-files']),
  });
}

function buildSearchAction(targetRef: string, query: string | undefined): SidebarCursorAgentAction {
  const trimmed = (query ?? '').trim();
  const safeQuery = trimmed && !containsSidebarCursorAgentInternalTerm(trimmed)
    ? compactLine(trimmed, 96)
    : '';
  return commandAction({
    intent: 'search',
    label: 'Search',
    scope: targetRef === SIDEBAR_CURSOR_AGENT_REGION_REF ? 'sidebar' : 'project',
    targetRef,
    mutates: false,
    commandText: commandText('sidebar', 'search', ['--target-ref', targetRef, '--query', safeQuery || '$SCIFORGE_SIDEBAR_QUERY']),
  });
}

function buildSelectProjectAction(projectRef: string): SidebarCursorAgentAction {
  return localPresentationAction({
    intent: 'select-project',
    label: 'Select project',
    scope: 'project',
    targetRef: projectRef,
    presentationMutation: 'selection',
  });
}

function buildSelectThreadAction(threadRef: string): SidebarCursorAgentAction {
  return localPresentationAction({
    intent: 'select-thread',
    label: 'Select chat',
    scope: 'thread',
    targetRef: threadRef,
    presentationMutation: 'selection',
  });
}

function buildSortAction(targetRef: string, sort: SidebarCursorAgentSortMode): SidebarCursorAgentAction {
  return localPresentationAction({
    intent: 'sort-threads',
    label: sort === 'manual' ? 'Use manual order' : sort === 'createdAt' ? 'Sort by created time' : 'Sort by updated time',
    scope: 'sidebar',
    targetRef,
    presentationMutation: 'sort',
  });
}

function buildOpenContextAction(projectRef: string): SidebarCursorAgentAction {
  return localPresentationAction({
    intent: 'open-context',
    label: 'Open context status',
    scope: 'project',
    targetRef: projectRef,
    presentationMutation: 'context',
  });
}

function buildOpenRepositoriesAction(sidebarRef: string): SidebarCursorAgentAction {
  return localPresentationAction({
    intent: 'open-repositories',
    label: 'Open Repositories',
    scope: 'sidebar',
    targetRef: sidebarRef,
    presentationMutation: 'navigation',
  });
}

function buildOpenAutomationsAction(sidebarRef: string): SidebarCursorAgentAction {
  return localPresentationAction({
    intent: 'open-automations',
    label: 'Open Automations',
    scope: 'sidebar',
    targetRef: sidebarRef,
    presentationMutation: 'navigation',
  });
}

function buildOpenCustomizeAction(sidebarRef: string): SidebarCursorAgentAction {
  return localPresentationAction({
    intent: 'open-customize',
    label: 'Open Customize',
    scope: 'sidebar',
    targetRef: sidebarRef,
    presentationMutation: 'navigation',
  });
}

function commandAction(args: {
  intent: SidebarCursorAgentActionIntent;
  label: string;
  scope: SidebarCursorAgentAction['scope'];
  targetRef: string;
  commandText: string;
  mutates: boolean;
}): SidebarCursorAgentAction {
  return {
    id: `${args.intent}:${stablePublicId('action', `${args.targetRef}:${args.commandText}`)}`,
    intent: args.intent,
    label: args.label,
    scope: args.scope,
    effect: 'agent-host-command',
    targetRef: args.targetRef,
    commandText: args.commandText,
    mutates: args.mutates,
    localPresentation: false,
  };
}

function localPresentationAction(args: {
  intent: SidebarCursorAgentActionIntent;
  label: string;
  scope: SidebarCursorAgentAction['scope'];
  targetRef: string;
  presentationMutation: SidebarCursorAgentPresentationMutation;
}): SidebarCursorAgentAction {
  return {
    id: `${args.intent}:${stablePublicId('presentation', `${args.targetRef}:${args.presentationMutation}`)}`,
    intent: args.intent,
    label: args.label,
    scope: args.scope,
    effect: 'local-presentation',
    targetRef: args.targetRef,
    mutates: false,
    localPresentation: true,
    presentationMutation: args.presentationMutation,
  };
}

function commandText(noun: string, verb: string, args: string[]): string {
  const parts = ['sciforge', noun, verb];
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag) continue;
    parts.push(flag);
    if (value) parts.push(value.startsWith('$') ? `"${value}"` : shellQuote(value));
  }
  return parts.join(' ');
}

function normalizeBranchStatus(input: string | SidebarCursorAgentBranchInput | undefined): SidebarCursorAgentStatus {
  if (typeof input === 'string') {
    return {
      label: safeVisibleLine(input, 'No branch', 48),
      detail: 'Current branch',
      state: input.trim() ? 'ready' : 'unknown',
    };
  }
  return {
    label: safeVisibleLine(input?.name, 'No branch', 48),
    detail: safeVisibleLine(input?.detail, 'Current branch', 72),
    state: input?.state ?? (input?.name?.trim() ? 'ready' : 'unknown'),
  };
}

function normalizeLocalEnvironmentStatus(
  input: string | SidebarCursorAgentLocalEnvironmentInput | undefined,
): SidebarCursorAgentStatus {
  if (typeof input === 'string') {
    return {
      label: safeVisibleLine(input, 'Local environment', 48),
      detail: 'Ready',
      state: input.trim() ? 'ready' : 'unknown',
    };
  }
  return {
    label: safeVisibleLine(input?.label, 'Local environment', 48),
    detail: safeVisibleLine(input?.detail, 'Ready', 72),
    state: input?.state ?? ((input?.label?.trim() || input?.detail?.trim()) ? 'ready' : 'unknown'),
  };
}

function normalizeContextStatus(input: SidebarCursorAgentContextInput | undefined): SidebarCursorAgentStatus {
  const usage = formatContextUsage(input?.used, input?.limit);
  const inferredState = inferContextStatusState(input?.used, input?.limit);
  return {
    label: safeVisibleLine(input?.label, 'Context', 48),
    detail: safeVisibleLine(input?.detail, usage || 'Ready', 72),
    state: input?.state ?? inferredState,
  };
}

function inferContextStatusState(used: number | undefined, limit: number | undefined): SidebarCursorAgentStatusState {
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    if (typeof used === 'number' && Number.isFinite(used)) {
      return used / limit >= 0.9 ? 'warning' : 'ready';
    }
    return 'ready';
  }
  return 'unknown';
}

function sidebarSelectionSummary(projection: SidebarCursorAgentProjection): string {
  const selectedGroup = projection.groups.find((group) => group.selected || group.current);
  const selectedThread = selectedGroup?.threads.find((thread) => thread.selected);
  return [
    selectedGroup ? `Project: ${selectedGroup.label}` : undefined,
    selectedThread ? `Chat: ${selectedThread.title}` : undefined,
  ].filter(Boolean).join(' · ') || `${projection.groups.length} projects`;
}

function sidebarProjectionSummary(projection: SidebarCursorAgentProjection): string {
  const projectCount = projection.groups.length;
  const threadCount = projection.groups.reduce((count, group) => count + group.threads.length, 0);
  const draftCount = projection.groups.reduce((count, group) => count + group.threads.filter((thread) => thread.state === 'draft').length, 0);
  const pinnedCount = projection.groups.reduce((count, group) => count + group.threads.filter((thread) => thread.pinned).length, 0);
  const archivedCount = projection.groups.reduce((count, group) => count + group.threads.filter((thread) => thread.archived).length, 0);
  const discardedCount = projection.groups.reduce((count, group) => count + group.threads.filter((thread) => thread.discarded).length, 0);
  const parts = [
    `${projectCount} project${projectCount === 1 ? '' : 's'}`,
    `${threadCount} chat${threadCount === 1 ? '' : 's'}`,
    draftCount ? `${draftCount} draft` : '',
    pinnedCount ? `${pinnedCount} pinned` : '',
    archivedCount ? `${archivedCount} archived` : '',
    discardedCount ? `${discardedCount} discarded` : '',
  ].filter(Boolean);
  return parts.join(', ');
}

function sortThreads(threads: SidebarCursorAgentThread[], sort: SidebarCursorAgentSortMode): void {
  if (sort === 'manual') return;
  threads.sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    const stateDelta = threadStateRank(left.state) - threadStateRank(right.state);
    if (stateDelta !== 0) return stateDelta;
    const leftTime = Date.parse(sort === 'createdAt' ? left.createdAt : left.updatedAt);
    const rightTime = Date.parse(sort === 'createdAt' ? right.createdAt : right.updatedAt);
    return rightTime - leftTime;
  });
}

function threadStateRank(state: SidebarCursorAgentThreadState): number {
  if (state === 'draft') return 0;
  if (state === 'active') return 1;
  if (state === 'archived') return 2;
  return 3;
}

function formatContextUsage(used: number | undefined, limit: number | undefined): string {
  if (typeof used === 'number' && Number.isFinite(used) && typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    return `${formatCompactNumber(used)} / ${formatCompactNumber(limit)}`;
  }
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) return `${formatCompactNumber(limit)} available`;
  return '';
}

function formatCompactNumber(value: number): string {
  const rounded = Math.max(0, Math.round(value));
  if (rounded >= 1000) return `${Math.round(rounded / 100) / 10}k`;
  return String(rounded);
}

function safeVisibleLine(value: string | undefined, fallback: string, maxLength: number): string {
  const compact = compactLine(value, maxLength);
  if (!compact || containsSidebarCursorAgentInternalTerm(compact)) return fallback;
  return compact;
}

function compactLine(value: string | undefined, maxLength: number): string {
  const compact = (value ?? '').replace(/[`*_>#\-[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function basename(path: string | undefined): string {
  const compact = (path ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = compact.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value?.trim())?.trim() ?? '';
}

function selectionMatches(selection: string | undefined, rawKey: string, publicId: string): boolean {
  if (!selection) return false;
  return selection === rawKey || selection === publicId;
}

function safeTimestamp(value: string | undefined): string {
  const parsed = Date.parse(value ?? '');
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return '1970-01-01T00:00:00.000Z';
}

function stablePublicId(prefix: string, raw: string): string {
  return `${prefix}-${hashString(raw || prefix)}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function resourceSegment(value: string): string {
  const safe = value.trim() || 'item';
  return encodeURIComponent(safe).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
