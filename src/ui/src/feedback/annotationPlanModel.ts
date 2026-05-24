import type {
  FeedbackCommentRecord,
  FeedbackEvidenceStatus,
  FeedbackRuntimeSnapshot,
  FeedbackScreenshotEvidence,
  FeedbackTargetSnapshot,
  SciForgeMessage,
  SciForgeReference,
  ScenarioInstanceId,
} from '../domain';
import type { PageId } from '../data';
import { makeId, nowIso } from '../domain';
import {
  referenceComposerMarker,
  sciForgeReferenceKindLabel,
  withComposerMarker,
} from '../../../../packages/support/object-references';

export const ANNOTATION_PLAN_SOURCE = 'annotation-plan';
export const ANNOTATION_PLAN_STORAGE_KEY = 'sciforge.annotationPlanDraft.v1';

export type AnnotationPlanStatus = 'drafting' | 'clarifying' | 'ready-to-save' | 'saved' | 'discarded';

export interface AnnotationPlanReferenceRecord {
  id: string;
  reference: SciForgeReference;
  target: FeedbackTargetSnapshot;
  selectedText?: string;
  addedAt: string;
}

export interface AnnotationPlanChoice {
  id: string;
  label: string;
  prompt: string;
}

export interface AnnotationPlanDraft {
  schemaVersion: 1;
  id: string;
  status: AnnotationPlanStatus;
  page: PageId;
  scenarioId: ScenarioInstanceId;
  sessionId: string;
  originalUrl: string;
  currentUrl: string;
  references: AnnotationPlanReferenceRecord[];
  description: string;
  messages: SciForgeMessage[];
  createdAt: string;
  updatedAt: string;
  savedFeedbackId?: string;
}

export interface AnnotationPlanOnlyEnvelope {
  schemaVersion: 'sciforge.annotation-plan-only-envelope.v1';
  kind: 'annotation-plan-only';
  draftId: string;
  source: typeof ANNOTATION_PLAN_SOURCE;
  page: PageId;
  scenarioId: ScenarioInstanceId;
  sessionId: string;
  currentUrl: string;
  references: Array<{
    id: string;
    marker: string;
    kind: SciForgeReference['kind'];
    title: string;
    ref: string;
    targetSelector: string;
    selectedText?: string;
  }>;
  allowedOutputs: string[];
  forbiddenSideEffects: string[];
  repairStartAllowed: false;
  runtimeExecutionAllowed: false;
  githubSyncAllowed: false;
  workspaceWriteAllowed: false;
}

export interface BuildAnnotationPlanFeedbackCommentInput {
  draft: AnnotationPlanDraft;
  feedbackId: string;
  now: string;
  author: { authorId: string; authorName: string };
  target: FeedbackTargetSnapshot;
  viewport: FeedbackCommentRecord['viewport'];
  runtime: FeedbackRuntimeSnapshot;
  screenshot?: FeedbackScreenshotEvidence;
  refs: {
    rawScreenshotRef: string;
    annotatedScreenshotRef: string;
    evidenceBundleRef: string;
  };
  evidenceStatus?: FeedbackEvidenceStatus;
}

const PLAN_ONLY_FORBIDDEN_SIDE_EFFECTS = [
  'workspace-write',
  'repair-start',
  'runtime-execution',
  'github-sync',
  'code-change',
  'terminal-command',
  'commit',
  'push',
  'pull-request',
] as const;

const PLAN_ONLY_ALLOWED_OUTPUTS = [
  'clarifying-question',
  'plan-summary',
  'feedback-draft',
  'acceptance-criteria',
] as const;

export function createAnnotationPlanDraft(input: {
  page: PageId;
  scenarioId: ScenarioInstanceId;
  sessionId: string;
  url: string;
  now?: string;
}): AnnotationPlanDraft {
  const now = input.now ?? nowIso();
  return {
    schemaVersion: 1,
    id: makeId('annotation-plan'),
    status: 'drafting',
    page: input.page,
    scenarioId: input.scenarioId,
    sessionId: input.sessionId,
    originalUrl: input.url,
    currentUrl: input.url,
    references: [],
    description: '',
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function refreshAnnotationPlanDraftContext(
  draft: AnnotationPlanDraft,
  input: { page: PageId; scenarioId: ScenarioInstanceId; sessionId: string; url: string; now?: string },
) {
  return {
    ...draft,
    page: input.page,
    scenarioId: input.scenarioId,
    sessionId: input.sessionId,
    currentUrl: input.url,
    updatedAt: input.now ?? nowIso(),
  };
}

export function updateAnnotationPlanDescription(
  draft: AnnotationPlanDraft,
  description: string,
  now = nowIso(),
): AnnotationPlanDraft {
  return {
    ...draft,
    description,
    status: draft.status === 'saved' || draft.status === 'discarded' ? draft.status : annotationPlanReadyToSave({ ...draft, description }) ? 'ready-to-save' : 'drafting',
    updatedAt: now,
  };
}

export function addAnnotationReferenceToDraft(
  draft: AnnotationPlanDraft,
  input: { reference: SciForgeReference; target: FeedbackTargetSnapshot; selectedText?: string; now?: string },
): AnnotationPlanDraft {
  const now = input.now ?? nowIso();
  const existingIndex = draft.references.findIndex((item) => sameReference(item.reference, input.reference));
  if (existingIndex >= 0) {
    const nextReferences = draft.references.map((item, index) => index === existingIndex
      ? {
        ...item,
        target: input.target,
        selectedText: input.selectedText || item.selectedText,
      }
      : item);
    const nextDraft = { ...draft, references: nextReferences, updatedAt: now };
    return {
      ...nextDraft,
      status: annotationPlanReadyToSave(nextDraft) ? 'ready-to-save' : 'drafting',
    };
  }
  const reference = withComposerMarker(input.reference, draft.references.map((item) => item.reference));
  const nextDraft = {
    ...draft,
    references: [
      ...draft.references,
      {
        id: reference.id,
        reference,
        target: input.target,
        selectedText: input.selectedText || undefined,
        addedAt: now,
      },
    ],
    updatedAt: now,
  };
  return {
    ...nextDraft,
    status: annotationPlanReadyToSave(nextDraft) ? 'ready-to-save' : 'drafting',
  };
}

export function removeAnnotationReferenceFromDraft(
  draft: AnnotationPlanDraft,
  referenceId: string,
  now = nowIso(),
): AnnotationPlanDraft {
  const nextDraft = {
    ...draft,
    references: draft.references.filter((item) => item.reference.id !== referenceId && item.id !== referenceId),
    updatedAt: now,
  };
  return {
    ...nextDraft,
    status: annotationPlanReadyToSave(nextDraft) ? 'ready-to-save' : 'drafting',
  };
}

export function discardAnnotationPlanDraft(draft: AnnotationPlanDraft, now = nowIso()): AnnotationPlanDraft {
  return {
    ...draft,
    status: 'discarded',
    updatedAt: now,
  };
}

export function markAnnotationPlanDraftSaved(
  draft: AnnotationPlanDraft,
  savedFeedbackId: string,
  now = nowIso(),
): AnnotationPlanDraft {
  return {
    ...draft,
    status: 'saved',
    savedFeedbackId,
    updatedAt: now,
  };
}

export function buildAnnotationPlanOnlyEnvelope(draft: AnnotationPlanDraft): AnnotationPlanOnlyEnvelope {
  return {
    schemaVersion: 'sciforge.annotation-plan-only-envelope.v1',
    kind: 'annotation-plan-only',
    draftId: draft.id,
    source: ANNOTATION_PLAN_SOURCE,
    page: draft.page,
    scenarioId: draft.scenarioId,
    sessionId: draft.sessionId,
    currentUrl: draft.currentUrl,
    references: draft.references.map((item) => ({
      id: item.reference.id,
      marker: referenceComposerMarker(item.reference),
      kind: item.reference.kind,
      title: item.reference.title,
      ref: item.reference.ref,
      targetSelector: item.target.selector,
      selectedText: item.selectedText,
    })),
    allowedOutputs: [...PLAN_ONLY_ALLOWED_OUTPUTS],
    forbiddenSideEffects: [...PLAN_ONLY_FORBIDDEN_SIDE_EFFECTS],
    repairStartAllowed: false,
    runtimeExecutionAllowed: false,
    githubSyncAllowed: false,
    workspaceWriteAllowed: false,
  };
}

export function annotationPlanEnvelopeAllowsOnlyDrafting(envelope: AnnotationPlanOnlyEnvelope) {
  return envelope.kind === 'annotation-plan-only'
    && envelope.repairStartAllowed === false
    && envelope.runtimeExecutionAllowed === false
    && envelope.githubSyncAllowed === false
    && envelope.workspaceWriteAllowed === false
    && PLAN_ONLY_FORBIDDEN_SIDE_EFFECTS.every((sideEffect) => envelope.forbiddenSideEffects.includes(sideEffect));
}

export function advanceAnnotationPlanClarification(
  draft: AnnotationPlanDraft,
  input: { content: string; choice?: AnnotationPlanChoice; now?: string },
): AnnotationPlanDraft {
  const now = input.now ?? nowIso();
  const content = normalizePlanText(input.content || input.choice?.prompt || '');
  if (!content) return draft;
  const userMessage: SciForgeMessage = {
    id: makeId('annotation-user'),
    role: 'user',
    content,
    references: draft.references.map((item) => item.reference),
    createdAt: now,
    provenance: annotationMessageProvenance(),
  };
  const assistantChoices = annotationPlanChoices(draft, content);
  const assistantMessage: SciForgeMessage = {
    id: makeId('annotation-assistant'),
    role: 'scenario',
    content: buildPlanOnlyAssistantReply(draft, content),
    references: draft.references.map((item) => item.reference),
    createdAt: now,
    provenance: {
      ...annotationMessageProvenance(),
      annotationChoices: assistantChoices,
    },
  };
  const nextDraft = {
    ...draft,
    status: annotationPlanReadyToSave(draft) ? 'ready-to-save' : 'clarifying',
    messages: [...draft.messages, userMessage, assistantMessage],
    updatedAt: now,
  };
  return {
    ...nextDraft,
    status: annotationPlanReadyToSave(nextDraft) ? 'ready-to-save' : 'clarifying',
  };
}

export function annotationPlanLatestChoices(draft: AnnotationPlanDraft): AnnotationPlanChoice[] {
  const message = [...draft.messages].reverse().find((item) => item.role === 'scenario');
  const choices = message?.provenance?.annotationChoices;
  if (!Array.isArray(choices)) return annotationPlanChoices(draft, '');
  return choices.filter(isAnnotationPlanChoice);
}

export function buildAnnotationPlanFeedbackComment(input: BuildAnnotationPlanFeedbackCommentInput): FeedbackCommentRecord {
  const draft = input.draft;
  const screenshot = input.screenshot
    ? {
      ...input.screenshot,
      rawScreenshotRef: input.refs.rawScreenshotRef,
      annotatedScreenshotRef: input.refs.annotatedScreenshotRef,
    }
    : undefined;
  const summary = annotationPlanSummary(draft);
  const expectedBehavior = annotationPlanExpectedBehavior(draft);
  const referenceRows = draft.references.map((item) => `${referenceComposerMarker(item.reference)} ${item.reference.title}`).join(', ');
  return {
    id: input.feedbackId,
    schemaVersion: 1,
    authorId: input.author.authorId,
    authorName: input.author.authorName.trim() || 'Anonymous',
    comment: summary,
    expectedBehavior,
    actualBehavior: referenceRows ? `关联对象：${referenceRows}` : '全局注释侧栏保存的 plan-only 反馈草稿。',
    status: 'open',
    priority: 'normal',
    severity: 'normal',
    tags: ['annotation-plan', 'plan-only'],
    createdAt: input.now,
    updatedAt: input.now,
    target: input.target,
    viewport: input.viewport,
    runtime: input.runtime,
    screenshotRef: input.refs.annotatedScreenshotRef,
    rawScreenshotRef: input.refs.rawScreenshotRef,
    annotatedScreenshotRef: input.refs.annotatedScreenshotRef,
    evidenceBundleRef: input.refs.evidenceBundleRef,
    evidenceStatus: input.evidenceStatus,
    screenshot,
    repairPolicy: {
      defaultCommit: false,
      defaultPush: false,
      defaultMerge: false,
      requiresUserConfirmation: true,
      allowedOperations: ['read-feedback', 'triage-feedback', 'create-feedback-request'],
      forbiddenOperations: [...PLAN_ONLY_FORBIDDEN_SIDE_EFFECTS],
    },
    metadata: {
      source: ANNOTATION_PLAN_SOURCE,
      annotationPlan: {
        schemaVersion: 1,
        source: ANNOTATION_PLAN_SOURCE,
        planState: 'draft-ready',
        draftId: draft.id,
        conversationEnvelope: buildAnnotationPlanOnlyEnvelope(draft),
        references: draft.references.map((item) => ({
          id: item.reference.id,
          marker: referenceComposerMarker(item.reference),
          kind: item.reference.kind,
          kindLabel: sciForgeReferenceKindLabel(item.reference.kind),
          title: item.reference.title,
          ref: item.reference.ref,
          summary: item.reference.summary,
          target: item.target,
          selectedText: item.selectedText,
        })),
        messages: draft.messages,
        clarificationSummary: annotationPlanClarificationSummary(draft),
        suggestedChange: summary,
        acceptanceCriteria: annotationPlanAcceptanceCriteria(draft),
        pageUrl: draft.currentUrl,
        originalUrl: draft.originalUrl,
        page: draft.page,
        scenarioId: draft.scenarioId,
        sessionId: draft.sessionId,
        savedAt: input.now,
        repairPolicy: {
          explicitInboxActionRequired: true,
          planOnlySidebarMustNotStartRepair: true,
          planOnlySidebarMustNotWriteWorkspace: true,
        },
      },
    },
  };
}

export function persistAnnotationPlanDraft(draft: AnnotationPlanDraft | null) {
  if (typeof window === 'undefined') return;
  if (!draft || draft.status === 'discarded' || draft.status === 'saved') {
    window.localStorage.removeItem(ANNOTATION_PLAN_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(ANNOTATION_PLAN_STORAGE_KEY, JSON.stringify(draft));
}

export function loadPersistedAnnotationPlanDraft(): AnnotationPlanDraft | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(ANNOTATION_PLAN_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isAnnotationPlanDraft(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function annotationMessageProvenance() {
  return {
    kind: 'annotation-plan-only',
    source: 'global-annotation-sidebar',
    runtimeRequestEligible: false,
    liveAcceptanceEligible: false,
  };
}

function annotationPlanReadyToSave(draft: Pick<AnnotationPlanDraft, 'description' | 'references' | 'messages'>) {
  return draft.references.length > 0 || Boolean(normalizePlanText(draft.description)) || draft.messages.some((message) => normalizePlanText(message.content));
}

function annotationPlanSummary(draft: AnnotationPlanDraft) {
  const description = normalizePlanText(draft.description);
  if (description) return description;
  const latestUser = [...draft.messages].reverse().find((message) => message.role === 'user' && normalizePlanText(message.content));
  if (latestUser) return normalizePlanText(latestUser.content);
  const markers = draft.references.map((item) => `${referenceComposerMarker(item.reference)} ${item.reference.title}`).join('、');
  return markers ? `请根据 ${markers} 梳理这组界面对象的修改计划。` : '全局注释侧栏保存的计划草稿。';
}

function annotationPlanExpectedBehavior(draft: AnnotationPlanDraft) {
  const criteria = annotationPlanAcceptanceCriteria(draft);
  return criteria.map((item) => `- ${item}`).join('\n');
}

function annotationPlanClarificationSummary(draft: AnnotationPlanDraft) {
  const assistant = [...draft.messages].reverse().find((message) => message.role === 'scenario');
  return assistant?.content ?? annotationPlanSummary(draft);
}

function annotationPlanAcceptanceCriteria(draft: AnnotationPlanDraft) {
  const markers = draft.references.map((item) => referenceComposerMarker(item.reference)).join('、');
  return [
    markers ? `相关对象 ${markers} 的目标状态与保存的反馈描述一致。` : '反馈描述中的目标状态可以被人工复核。',
    '从反馈收件箱显式开始 repair 之前，不触发代码修改、终端执行、GitHub 同步或运行时调用。',
    '后续实现保留反馈证据、页面、会话和引用 token 的可追踪性。',
  ];
}

function annotationPlanChoices(draft: AnnotationPlanDraft, content: string): AnnotationPlanChoice[] {
  const hasReferences = draft.references.length > 0;
  const hasContent = Boolean(normalizePlanText(content || draft.description));
  return [
    {
      id: 'tighten-scope',
      label: '收窄范围',
      prompt: hasReferences
        ? '请把这些引用对象的修改范围收敛成最小可执行计划。'
        : '请先说明需要点选哪些界面对象，再收敛修改范围。',
    },
    {
      id: 'acceptance',
      label: '补验收标准',
      prompt: '请把这条注释计划改写成可检查的验收标准。',
    },
    {
      id: 'save-ready',
      label: '保存草稿',
      prompt: hasContent ? '这份计划已经可以保存到反馈收件箱。' : '请先补一句问题或期望，再保存到反馈收件箱。',
    },
  ];
}

function buildPlanOnlyAssistantReply(draft: AnnotationPlanDraft, content: string) {
  const markers = draft.references.map((item) => `${referenceComposerMarker(item.reference)} ${item.reference.title}`).join('、');
  const scope = markers || '尚未点选对象';
  const summary = normalizePlanText(draft.description) || content;
  return [
    '已按 plan-only 注释记录，不会启动修复、运行时执行、GitHub 同步或工作区写入。',
    '',
    `范围：${scope}`,
    `草稿摘要：${summary}`,
    '',
    '建议验收：从反馈收件箱显式发起 repair 之前，只把这条内容作为可审阅的计划草稿；后续实现需要保留引用 token 和证据链。'
  ].join('\n');
}

function normalizePlanText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function sameReference(a: SciForgeReference, b: SciForgeReference) {
  return a.id === b.id || a.ref === b.ref;
}

function isAnnotationPlanChoice(value: unknown): value is AnnotationPlanChoice {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<AnnotationPlanChoice>;
  return typeof item.id === 'string' && typeof item.label === 'string' && typeof item.prompt === 'string';
}

function isAnnotationPlanDraft(value: unknown): value is AnnotationPlanDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<AnnotationPlanDraft>;
  return draft.schemaVersion === 1
    && typeof draft.id === 'string'
    && typeof draft.page === 'string'
    && typeof draft.scenarioId === 'string'
    && typeof draft.sessionId === 'string'
    && typeof draft.originalUrl === 'string'
    && typeof draft.currentUrl === 'string'
    && typeof draft.description === 'string'
    && Array.isArray(draft.references)
    && Array.isArray(draft.messages);
}
