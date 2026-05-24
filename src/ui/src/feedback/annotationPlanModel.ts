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
export type AnnotationSidebarActionId = 'save-feedback' | 'preview-change' | 'apply-small-change' | 'send-to-inbox';
export type AnnotationQuickActionStatus = 'eligible' | 'needs-intent' | 'needs-inbox';

export interface AnnotationQuickActionAssessment {
  status: AnnotationQuickActionStatus;
  eligible: boolean;
  label: string;
  reason: string;
  risk: 'low' | 'medium' | 'high';
}

export interface AnnotationActionRecord {
  id: string;
  action: AnnotationSidebarActionId;
  status: 'requested' | 'completed' | 'blocked' | 'saved';
  summary: string;
  createdAt: string;
  risk?: AnnotationQuickActionAssessment['risk'];
  writesApplied?: boolean;
  runtimeRunId?: string;
  feedbackId?: string;
}

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
  actionLog?: AnnotationActionRecord[];
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

export interface AnnotationQuickActionEnvelope {
  schemaVersion: 'sciforge.annotation-quick-action-envelope.v1';
  kind: 'annotation-quick-action';
  draftId: string;
  source: typeof ANNOTATION_PLAN_SOURCE;
  action: 'apply-small-change';
  page: PageId;
  scenarioId: ScenarioInstanceId;
  sessionId: string;
  currentUrl: string;
  references: AnnotationPlanOnlyEnvelope['references'];
  riskAssessment: AnnotationQuickActionAssessment;
  allowedSideEffects: string[];
  forbiddenSideEffects: string[];
  requiresUserConfirmation: true;
  repairStartAllowed: false;
  runtimeExecutionAllowed: true;
  githubSyncAllowed: false;
  workspaceWriteAllowed: true;
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

const QUICK_ACTION_ALLOWED_SIDE_EFFECTS = [
  'runtime-execution',
  'workspace-write',
  'focused-test-command',
] as const;

const QUICK_ACTION_FORBIDDEN_SIDE_EFFECTS = [
  'repair-start',
  'github-sync',
  'commit',
  'push',
  'pull-request',
  'merge',
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
  const references = annotationEnvelopeReferences(draft);
  return {
    schemaVersion: 'sciforge.annotation-plan-only-envelope.v1',
    kind: 'annotation-plan-only',
    draftId: draft.id,
    source: ANNOTATION_PLAN_SOURCE,
    page: draft.page,
    scenarioId: draft.scenarioId,
    sessionId: draft.sessionId,
    currentUrl: draft.currentUrl,
    references,
    allowedOutputs: [...PLAN_ONLY_ALLOWED_OUTPUTS],
    forbiddenSideEffects: [...PLAN_ONLY_FORBIDDEN_SIDE_EFFECTS],
    repairStartAllowed: false,
    runtimeExecutionAllowed: false,
    githubSyncAllowed: false,
    workspaceWriteAllowed: false,
  };
}

export function buildAnnotationQuickActionEnvelope(
  draft: AnnotationPlanDraft,
  riskAssessment = assessAnnotationQuickAction(draft),
): AnnotationQuickActionEnvelope {
  return {
    schemaVersion: 'sciforge.annotation-quick-action-envelope.v1',
    kind: 'annotation-quick-action',
    draftId: draft.id,
    source: ANNOTATION_PLAN_SOURCE,
    action: 'apply-small-change',
    page: draft.page,
    scenarioId: draft.scenarioId,
    sessionId: draft.sessionId,
    currentUrl: draft.currentUrl,
    references: annotationEnvelopeReferences(draft),
    riskAssessment,
    allowedSideEffects: [...QUICK_ACTION_ALLOWED_SIDE_EFFECTS],
    forbiddenSideEffects: [...QUICK_ACTION_FORBIDDEN_SIDE_EFFECTS],
    requiresUserConfirmation: true,
    repairStartAllowed: false,
    runtimeExecutionAllowed: true,
    githubSyncAllowed: false,
    workspaceWriteAllowed: true,
  };
}

export function assessAnnotationQuickAction(draft: Pick<AnnotationPlanDraft, 'description' | 'references'>): AnnotationQuickActionAssessment {
  const intent = normalizePlanText(draft.description);
  if (!intent) {
    return {
      status: 'needs-intent',
      eligible: false,
      label: '先描述问题',
      reason: '先写一句你希望这个对象怎么变化。',
      risk: 'medium',
    };
  }
  if (draft.references.length !== 1) {
    return {
      status: 'needs-inbox',
      eligible: false,
      label: '进收件箱',
      reason: draft.references.length > 1
        ? '涉及多个对象关系，先进入收件箱确认范围。'
        : '还没有点选对象，无法安全判断小改动范围。',
      risk: 'medium',
    };
  }
  const lowered = intent.toLowerCase();
  const highRiskPattern = /(架构|重构|接口|api|数据库|权限|鉴权|登录|同步|github|repair|runtime|全局|多个|流程|状态机|删除|迁移|并发|缓存|安全|secret|token|payment|billing|auth|database|schema|migration|refactor|architecture|global|delete|remove|sync|github|runtime|repair|security|permission)/i;
  if (highRiskPattern.test(intent)) {
    return {
      status: 'needs-inbox',
      eligible: false,
      label: '进收件箱',
      reason: '这像是跨范围或有副作用的改动，需要确认、审计和执行记录。',
      risk: 'high',
    };
  }
  const lowRiskPattern = /(文案|文字|标题|按钮|标签|placeholder|提示|颜色|字号|间距|对齐|边距|宽度|高度|圆角|hover|focus|copy|text|label|button|color|font|spacing|margin|padding|align|width|height|radius)/i;
  if (lowRiskPattern.test(lowered) || intent.length <= 120) {
    return {
      status: 'eligible',
      eligible: true,
      label: '低风险',
      reason: '看起来是单对象、局部、可解释的小改动。',
      risk: 'low',
    };
  }
  return {
    status: 'needs-inbox',
    eligible: false,
    label: '进收件箱',
    reason: '范围不够明确，先保存到收件箱再确认执行。',
    risk: 'medium',
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

export function hasAnnotationPlanOnlyEnvelopeMarker(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Partial<AnnotationPlanOnlyEnvelope> & { mode?: unknown };
  return envelope.schemaVersion === 'sciforge.annotation-plan-only-envelope.v1'
    || envelope.kind === 'annotation-plan-only'
    || envelope.mode === 'annotation-plan-only';
}

export function isAnnotationPlanOnlyEnvelope(value: unknown): value is AnnotationPlanOnlyEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Partial<AnnotationPlanOnlyEnvelope>;
  return envelope.schemaVersion === 'sciforge.annotation-plan-only-envelope.v1'
    && envelope.kind === 'annotation-plan-only'
    && envelope.repairStartAllowed === false
    && envelope.runtimeExecutionAllowed === false
    && envelope.githubSyncAllowed === false
    && envelope.workspaceWriteAllowed === false
    && Array.isArray(envelope.allowedOutputs)
    && Array.isArray(envelope.forbiddenSideEffects);
}

export function advanceAnnotationPlanClarification(
  draft: AnnotationPlanDraft,
  input: { content: string; choice?: AnnotationPlanChoice; assistantContent?: string; now?: string },
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
    content: input.assistantContent?.trim() || buildPlanOnlyAssistantReply(draft, content),
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

export function appendAnnotationActionRecord(
  draft: AnnotationPlanDraft,
  input: Omit<AnnotationActionRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
): AnnotationPlanDraft {
  const createdAt = input.createdAt ?? nowIso();
  return {
    ...draft,
    actionLog: [
      ...(draft.actionLog ?? []),
      {
        id: input.id ?? makeId('annotation-action'),
        action: input.action,
        status: input.status,
        summary: input.summary,
        createdAt,
        risk: input.risk,
        writesApplied: input.writesApplied,
        runtimeRunId: input.runtimeRunId,
        feedbackId: input.feedbackId,
      },
    ],
    updatedAt: createdAt,
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
  const quickActionApplied = annotationQuickActionWasApplied(draft);
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
    actualBehavior: quickActionApplied
      ? `侧栏低风险小改动记录：${referenceRows || '无单独引用对象'}`
      : referenceRows ? `关联对象：${referenceRows}` : '全局反馈侧栏保存的意图草稿。',
    status: 'open',
    priority: 'normal',
    severity: 'normal',
    tags: annotationFeedbackTags(draft),
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
      allowedOperations: quickActionApplied
        ? ['read-feedback', 'triage-feedback', 'review-quick-action', 'create-feedback-request']
        : ['read-feedback', 'triage-feedback', 'create-feedback-request'],
      forbiddenOperations: quickActionApplied
        ? [...QUICK_ACTION_FORBIDDEN_SIDE_EFFECTS]
        : [...PLAN_ONLY_FORBIDDEN_SIDE_EFFECTS],
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
        actionLog: draft.actionLog ?? [],
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
          complexChangesRequireInboxConfirmation: true,
          lowRiskQuickActionsMayStartFromSidebar: true,
        },
      },
    },
  };
}

export function buildAnnotationQuickActionPrompt(
  draft: AnnotationPlanDraft,
  riskAssessment = assessAnnotationQuickAction(draft),
) {
  const refs = draft.references.map((item) => [
    `${referenceComposerMarker(item.reference)} ${item.reference.title}`,
    `kind=${item.reference.kind}`,
    `ref=${item.reference.ref}`,
    `selector=${item.target.selector}`,
  ].join(' | '));
  const recentContext = draft.messages.slice(-4).map((message) => `${message.role}: ${normalizePlanText(message.content)}`);
  return [
    'SciForge annotation sidebar quick action.',
    '',
    'User intent:',
    normalizePlanText(draft.description) || '(empty)',
    '',
    'Selected UI object refs:',
    ...(refs.length ? refs : ['(none)']),
    '',
    'Recent sidebar context:',
    ...(recentContext.length ? recentContext : ['(none)']),
    '',
    'Guardrails:',
    '- Apply a change only if it is a low-risk, local UI copy/style tweak for the selected object.',
    '- Do not start repair handoff, GitHub sync, commit, push, PR, merge, broad refactor, data migration, or secret/config change.',
    '- If the request needs broader reasoning, multiple-object coordination, external sync, or risky code paths, do not modify files. Respond with NEEDS_INBOX and a short reason.',
    '- If you edit files, keep the patch minimal, run the smallest relevant check if cheap, and summarize changed files plus verification.',
    '',
    `Local risk assessment: ${riskAssessment.label} (${riskAssessment.reason})`,
  ].join('\n');
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

function annotationEnvelopeReferences(draft: AnnotationPlanDraft): AnnotationPlanOnlyEnvelope['references'] {
  return draft.references.map((item) => ({
    id: item.reference.id,
    marker: referenceComposerMarker(item.reference),
    kind: item.reference.kind,
    title: item.reference.title,
    ref: item.reference.ref,
    targetSelector: item.target.selector,
    selectedText: item.selectedText,
  }));
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
    '低风险小改动在侧栏确认；复杂改动进入反馈收件箱后再执行。',
    '后续实现保留反馈证据、页面、会话和引用 token 的可追踪性。',
  ];
}

function annotationPlanChoices(draft: AnnotationPlanDraft, content: string): AnnotationPlanChoice[] {
  const hasReferences = draft.references.length > 0;
  const hasContent = Boolean(normalizePlanText(content || draft.description));
  return [
    {
      id: 'preview-change',
      label: '预览修改',
      prompt: '请先预览你会怎么改：列出目标、范围、风险和验收标准；不要修改代码。',
    },
    {
      id: 'tighten-scope',
      label: '收窄范围',
      prompt: hasReferences
        ? '请把这些引用对象的修改范围收敛成最小可执行计划。'
        : '请先说明需要点选哪些界面对象，再收敛修改范围。',
    },
    {
      id: 'acceptance',
      label: '补验收',
      prompt: '请把这条注释计划改写成可检查的验收标准。',
    },
  ].filter((choice) => hasContent || choice.id !== 'preview-change');
}

function buildPlanOnlyAssistantReply(draft: AnnotationPlanDraft, content: string) {
  const markers = draft.references.map((item) => `${referenceComposerMarker(item.reference)} ${item.reference.title}`).join('、');
  const scope = markers || '尚未点选对象';
  const summary = normalizePlanText(draft.description) || content;
  return [
    '已整理为反馈侧栏草稿。你可以继续补充、预览修改，或把复杂改动送入收件箱。',
    '',
    `范围：${scope}`,
    `草稿摘要：${summary}`,
    '',
    '建议验收：低风险小改动需要可解释、可回退；复杂改动需要进入收件箱保留确认、证据和执行记录。'
  ].join('\n');
}

function annotationFeedbackTags(draft: AnnotationPlanDraft) {
  const tags = ['annotation-plan', 'intent-first'];
  if ((draft.actionLog ?? []).some((action) => action.action === 'apply-small-change')) tags.push('quick-action');
  return tags;
}

function annotationQuickActionWasApplied(draft: AnnotationPlanDraft) {
  return (draft.actionLog ?? []).some((action) => action.action === 'apply-small-change' && action.writesApplied === true);
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
