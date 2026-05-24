import assert from 'node:assert/strict';
import test from 'node:test';
import type { FeedbackRuntimeSnapshot, FeedbackTargetSnapshot, SciForgeReference } from '../domain';
import {
  addAnnotationReferenceToDraft,
  appendAnnotationActionRecord,
  annotationPlanEnvelopeAllowsOnlyDrafting,
  assessAnnotationQuickAction,
  buildAnnotationPlanFeedbackComment,
  buildAnnotationPlanOnlyEnvelope,
  buildAnnotationQuickActionEnvelope,
  buildAnnotationQuickActionPrompt,
  createAnnotationPlanDraft,
  hasAnnotationPlanOnlyEnvelopeMarker,
  isAnnotationPlanOnlyEnvelope,
  removeAnnotationReferenceFromDraft,
  updateAnnotationPlanDescription,
} from './annotationPlanModel';
import { referenceComposerMarker } from '../../../../packages/support/object-references';

const now = '2026-05-24T00:00:00.000Z';

test('annotation plan assigns stable composer markers without a second reference model', () => {
  const draft = createAnnotationPlanDraft({
    page: 'workbench',
    scenarioId: 'literature',
    sessionId: 'session-1',
    url: 'http://127.0.0.1:5173/',
    now,
  });
  const withFirst = addAnnotationReferenceToDraft(draft, { reference: reference('a'), target: target('a'), now });
  const withSecond = addAnnotationReferenceToDraft(withFirst, { reference: reference('b'), target: target('b'), now });
  const withoutFirst = removeAnnotationReferenceFromDraft(withSecond, 'ref-a', now);
  const withThird = addAnnotationReferenceToDraft(withoutFirst, { reference: reference('c'), target: target('c'), now });

  assert.equal(referenceComposerMarker(withSecond.references[0].reference), '※1');
  assert.equal(referenceComposerMarker(withSecond.references[1].reference), '※2');
  assert.equal(referenceComposerMarker(withThird.references.find((item) => item.reference.id === 'ref-b')!.reference), '※2');
  assert.equal(referenceComposerMarker(withThird.references.find((item) => item.reference.id === 'ref-c')!.reference), '※1');
});

test('annotation plan envelope is structurally plan-only', () => {
  const draft = updateAnnotationPlanDescription(createAnnotationPlanDraft({
    page: 'components',
    scenarioId: 'components',
    sessionId: 'session-1',
    url: 'http://127.0.0.1:5173/components',
    now,
  }), '调整这个按钮的反馈文案', now);
  const envelope = buildAnnotationPlanOnlyEnvelope(draft);

  assert.equal(envelope.kind, 'annotation-plan-only');
  assert.equal(envelope.workspaceWriteAllowed, false);
  assert.equal(envelope.runtimeExecutionAllowed, false);
  assert.equal(envelope.githubSyncAllowed, false);
  assert.equal(envelope.repairStartAllowed, false);
  assert.ok(envelope.forbiddenSideEffects.includes('code-change'));
  assert.ok(annotationPlanEnvelopeAllowsOnlyDrafting(envelope));
  assert.ok(isAnnotationPlanOnlyEnvelope(envelope));
  assert.ok(hasAnnotationPlanOnlyEnvelopeMarker(envelope));
  assert.equal(isAnnotationPlanOnlyEnvelope({ ...envelope, runtimeExecutionAllowed: true }), false);
  assert.equal(hasAnnotationPlanOnlyEnvelopeMarker({ kind: 'annotation-plan-only' }), true);
});

test('annotation quick actions are a separate low-risk sidebar lane', () => {
  const draft = addAnnotationReferenceToDraft(updateAnnotationPlanDescription(createAnnotationPlanDraft({
    page: 'components',
    scenarioId: 'components',
    sessionId: 'session-1',
    url: 'http://127.0.0.1:5173/components',
    now,
  }), '把这个按钮文案改得更清楚', now), {
    reference: reference('button'),
    target: target('button'),
    now,
  });
  const assessment = assessAnnotationQuickAction(draft);
  const envelope = buildAnnotationQuickActionEnvelope(draft, assessment);
  const prompt = buildAnnotationQuickActionPrompt(draft, assessment);

  assert.equal(assessment.eligible, true);
  assert.equal(assessment.risk, 'low');
  assert.equal(envelope.kind, 'annotation-quick-action');
  assert.equal(envelope.runtimeExecutionAllowed, true);
  assert.equal(envelope.workspaceWriteAllowed, true);
  assert.equal(envelope.githubSyncAllowed, false);
  assert.equal(envelope.repairStartAllowed, false);
  assert.ok(envelope.forbiddenSideEffects.includes('push'));
  assert.match(prompt, /NEEDS_INBOX/);
  assert.match(prompt, /low-risk, local UI copy\/style tweak/);
});

test('annotation quick action routes broad changes to inbox', () => {
  const draft = addAnnotationReferenceToDraft(updateAnnotationPlanDescription(createAnnotationPlanDraft({
    page: 'workbench',
    scenarioId: 'literature',
    sessionId: 'session-1',
    url: 'http://127.0.0.1:5173/',
    now,
  }), '重构全局 repair 状态机并同步 GitHub', now), {
    reference: reference('panel'),
    target: target('panel'),
    now,
  });
  const assessment = assessAnnotationQuickAction(draft);

  assert.equal(assessment.eligible, false);
  assert.equal(assessment.status, 'needs-inbox');
  assert.equal(assessment.risk, 'high');
});

test('annotation plan saves as feedback inbox record with explicit repair boundary', () => {
  const draft = addAnnotationReferenceToDraft(updateAnnotationPlanDescription(createAnnotationPlanDraft({
    page: 'feedback',
    scenarioId: 'feedback',
    sessionId: 'session-1',
    url: 'http://127.0.0.1:5173/feedback',
    now,
  }), '把这组筛选控件收敛成更清晰的反馈入口', now), {
    reference: reference('filter'),
    target: target('filter'),
    now,
  });
  const draftWithAction = appendAnnotationActionRecord(draft, {
    action: 'apply-small-change',
    status: 'completed',
    summary: '低风险小改动已记录',
    writesApplied: true,
    createdAt: now,
  });
  const record = buildAnnotationPlanFeedbackComment({
    draft: draftWithAction,
    feedbackId: 'feedback-1',
    now,
    author: { authorId: 'user-1', authorName: 'Tester' },
    target: target('filter'),
    viewport: { width: 1200, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
    runtime: runtime(),
    refs: {
      rawScreenshotRef: '.sciforge/feedback/feedback-1/raw.png',
      annotatedScreenshotRef: '.sciforge/feedback/feedback-1/annotated.png',
      evidenceBundleRef: '.sciforge/feedback/feedback-1/comment.json',
    },
  });

  assert.equal(record.status, 'open');
  assert.deepEqual(record.tags, ['annotation-plan', 'intent-first', 'quick-action']);
  assert.equal(record.metadata?.source, 'annotation-plan');
  assert.equal((record.metadata?.annotationPlan as { planState?: string }).planState, 'draft-ready');
  assert.equal(((record.metadata?.annotationPlan as { actionLog?: unknown[] }).actionLog ?? []).length, 1);
  assert.equal(record.repairPolicy?.requiresUserConfirmation, true);
  assert.ok(record.repairPolicy?.allowedOperations.includes('review-quick-action'));
  assert.ok(record.repairPolicy?.forbiddenOperations.includes('push'));
  assert.ok(record.repairPolicy?.allowedOperations.includes('triage-feedback'));
});

function reference(id: string): SciForgeReference {
  return {
    id: `ref-${id}`,
    kind: 'ui',
    title: `控件 ${id}`,
    ref: `ui:#${id}`,
    summary: `UI object ${id}`,
  };
}

function target(id: string): FeedbackTargetSnapshot {
  return {
    selector: `#${id}`,
    stableSelector: `#${id}`,
    path: `html > body > #${id}`,
    domPath: `html > body > #${id}`,
    text: `控件 ${id}`,
    textSnippet: `控件 ${id}`,
    tagName: 'button',
    role: 'button',
    label: `控件 ${id}`,
    ariaLabel: `控件 ${id}`,
    rect: { x: 10, y: 20, width: 120, height: 32 },
  };
}

function runtime(): FeedbackRuntimeSnapshot {
  return {
    page: 'feedback',
    url: 'http://127.0.0.1:5173/feedback',
    scenarioId: 'feedback',
    sessionId: 'session-1',
    sessionTitle: 'Feedback',
    messageCount: 0,
    artifactSummary: [],
    executionSummary: [],
    uiManifest: [],
    appVersion: 'test',
  };
}
