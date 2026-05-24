import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFeedbackEvidenceStatus,
  buildFeedbackRuntimeSnapshot,
  compactSelectedText,
  feedbackEvidenceRefs,
  referenceForFeedbackTarget,
  scrubFeedbackScreenshotEvidence,
  scrubFeedbackText,
} from './captureModel';
import type { FeedbackScreenshotEvidence, FeedbackTargetSnapshot, SciForgeSession } from '../domain';

const session: SciForgeSession = {
  schemaVersion: 2,
  sessionId: 'session-generic',
  scenarioId: 'scenario-any',
  title: 'Generic scenario',
  messages: [
    {
      id: 'message-1',
      role: 'user',
      content: 'Run a task.',
      createdAt: '2026-05-07T00:00:00.000Z',
    },
  ],
  runs: [
    {
      id: 'run-1',
      scenarioId: 'scenario-any',
      status: 'completed',
      prompt: 'Run a task.',
      response: 'Done.',
      createdAt: '2026-05-07T00:01:00.000Z',
      completedAt: '2026-05-07T00:02:00.000Z',
    },
  ],
  artifacts: [
    {
      id: 'artifact-1',
      type: 'markdown',
      producerScenario: 'scenario-any',
      schemaVersion: '1',
      data: '# Report',
      metadata: { title: 'Report' },
    },
  ],
  executionUnits: [
    {
      id: 'unit-1',
      tool: 'local-runner',
      status: 'done',
      params: 'input',
      hash: 'hash-1',
    },
  ],
  uiManifest: [
    {
      componentId: 'result-panel',
      title: 'Results',
    },
  ],
  claims: [],
  notebook: [],
  versions: [],
  createdAt: '2026-05-07T00:00:00.000Z',
  updatedAt: '2026-05-07T00:02:00.000Z',
};

const target: FeedbackTargetSnapshot = {
  selector: 'main.generic-panel > button.primary',
  stableSelector: 'button[aria-label="Submit generic action"]',
  path: 'html > body > main > button',
  domPath: 'html > body > main > button',
  text: '提交',
  textSnippet: '提交',
  tagName: 'button',
  role: 'button',
  label: 'Submit generic action',
  ariaLabel: 'Submit generic action',
  rect: { x: 10, y: 20, width: 120, height: 36 },
  commentPoint: { x: 70, y: 38 },
};

const screenshot: FeedbackScreenshotEvidence = {
  schemaVersion: 1,
  captureMode: 'full-page',
  dataUrl: 'data:image/png;base64,abc123',
  rawDataUrl: 'data:image/png;base64,raw123',
  annotatedDataUrl: 'data:image/png;base64,annotated123',
  mediaType: 'image/png',
  width: 640,
  height: 360,
  capturedAt: '2026-05-07T00:00:00.000Z',
  targetRect: target.rect,
  targetAnnotations: [{
    label: '※1',
    rect: target.rect,
    commentPoint: target.commentPoint,
    selector: target.stableSelector,
    title: target.label,
  }],
  commentPoint: target.commentPoint,
  scrollX: 0,
  scrollY: 120,
  annotationLabel: '1',
  includeForAgent: false,
};

test('builds runtime snapshots from explicit session inputs', () => {
  const snapshot = buildFeedbackRuntimeSnapshot({
    page: 'workbench',
    scenarioId: 'scenario-any',
    session,
    url: 'http://localhost:5173/',
    appVersion: 'test-build',
  });

  assert.equal(snapshot.page, 'workbench');
  assert.equal(snapshot.sessionId, 'session-generic');
  assert.equal(snapshot.activeRunId, 'run-1');
  assert.equal(snapshot.messageCount, 1);
  assert.deepEqual(snapshot.artifactSummary, [{ id: 'artifact-1', type: 'markdown', title: 'Report' }]);
  assert.deepEqual(snapshot.executionSummary, [{ id: 'unit-1', tool: 'local-runner', status: 'done' }]);
  assert.deepEqual(snapshot.uiManifest, ['result-panel']);
});

test('compacts selected text without depending on the current page', () => {
  assert.equal(compactSelectedText('  one\n\n two\tthree  '), 'one two three');
  assert.equal(
    compactSelectedText('Authorization: Bearer sk-selected-secret-abcdefghijklmnopqrstuvwxyz'),
    'authorization: [redacted-feedback-secret]',
  );

  const longText = 'a'.repeat(2500);
  const compact = compactSelectedText(longText);
  assert.equal(compact.length, 2403);
  assert.match(compact, /\.\.\.$/);
});

test('builds stable UI object references for feedback targets', () => {
  const reference = referenceForFeedbackTarget(target, '', 'object');

  assert.equal(reference.kind, 'ui');
  assert.equal(reference.ref, 'ui:button[aria-label="Submit generic action"]');
  assert.equal(reference.title, '提交');
  assert.deepEqual((reference.payload as { composerMarkerHint?: string }).composerMarkerHint, 'object');
});

test('builds stable selected-text references for feedback targets', () => {
  const reference = referenceForFeedbackTarget(target, '用户选择的一段通用文本', 'selection');

  assert.equal(reference.kind, 'ui');
  assert.match(reference.id, /^ref-context-text-/);
  assert.match(reference.ref, /^ui-text:ui:button\[aria-label="Submit generic action"\]#/);
  assert.equal(reference.summary, '用户选择的一段通用文本');
  assert.deepEqual(reference.locator, {
    textRange: '用户选择的一段通用文本',
    region: 'ui:button[aria-label="Submit generic action"]',
  });
});

test('scrubs selector, target text, and refs before building feedback references', () => {
  const unsafeTarget: FeedbackTargetSnapshot = {
    ...target,
    selector: 'button[data-token="sk-selector-secret-abcdefghijklmnopqrstuvwxyz"]',
    stableSelector: 'button[data-token="sk-selector-secret-abcdefghijklmnopqrstuvwxyz"]',
    path: 'html > body > /Users/research/.secrets/provider-token.txt',
    text: 'Loaded Authorization: Bearer sk-text-secret-abcdefghijklmnopqrstuvwxyz',
    ariaLabel: 'Open /Users/research/.secrets/provider-token.txt',
  };
  const reference = referenceForFeedbackTarget(
    unsafeTarget,
    'selected token=sk-selected-secret-abcdefghijklmnopqrstuvwxyz from /Users/research/.secrets/provider-token.txt',
    'selection',
  );
  const json = JSON.stringify(reference);

  assert.doesNotMatch(json, /sk-(selector|text|selected)-secret/i);
  assert.doesNotMatch(json, /\/Users\/research\/\.secrets/i);
  assert.match(json, /redacted-feedback-secret/);
  assert.match(json, /redacted-feedback-path/);
});

test('builds complete and partial evidence integrity flags', () => {
  const runtime = buildFeedbackRuntimeSnapshot({
    page: 'workbench',
    scenarioId: 'scenario-any',
    session,
    url: 'http://localhost:5173/',
    appVersion: 'test-build',
  });
  const complete = buildFeedbackEvidenceStatus({ screenshot, target, runtime });

  assert.equal(complete.status, 'complete');
  assert.equal(complete.rawScreenshot, true);
  assert.equal(complete.annotatedScreenshot, true);
  assert.equal(complete.targetSnapshot, true);
  assert.equal(complete.runtimeSnapshot, true);
  assert.equal(complete.scrubbed, true);
  assert.deepEqual(complete.diagnostics, []);

  const partial = buildFeedbackEvidenceStatus({
    target,
    runtime,
    diagnostics: ['screenshot failed at secret=sk-diagnostic-secret-abcdefghijklmnopqrstuvwxyz'],
  });

  assert.equal(partial.status, 'partial');
  assert.equal(partial.rawScreenshot, false);
  assert.equal(partial.annotatedScreenshot, false);
  assert.match(partial.diagnostics.join(' '), /redacted-feedback-secret/);
  assert.doesNotMatch(partial.diagnostics.join(' '), /sk-diagnostic-secret/i);

  const structureFallback = buildFeedbackEvidenceStatus({
    screenshot: { ...screenshot, captureMode: 'page-structure-fallback' },
    target,
    runtime,
  });

  assert.equal(structureFallback.status, 'partial');
  assert.match(structureFallback.diagnostics.join(' '), /page structure fallback/);
});

test('creates stable local evidence refs without leaking secret-like feedback ids', () => {
  const refs = feedbackEvidenceRefs('feedback-token=sk-feedback-secret-abcdefghijklmnopqrstuvwxyz');
  const json = JSON.stringify(refs);

  assert.match(refs.evidenceBundleRef, /^feedback-bundle:/);
  assert.match(refs.rawScreenshotRef, /\/screenshots\/raw\.png$/);
  assert.match(refs.annotatedScreenshotRef, /\/screenshots\/annotated\.png$/);
  assert.doesNotMatch(json, /sk-feedback-secret/i);
});

test('scrubs screenshot data and refs while preserving valid image data URLs', () => {
  const scrubbed = scrubFeedbackScreenshotEvidence({
    ...screenshot,
    dataUrl: 'Authorization: Bearer sk-screenshot-secret-abcdefghijklmnopqrstuvwxyz',
    rawScreenshotRef: '/Users/research/.secrets/raw.png',
    annotatedScreenshotRef: 'feedback-bundle:feedback-1/screenshots/annotated.png',
    note: 'token=sk-note-secret-abcdefghijklmnopqrstuvwxyz',
  });

  assert.equal(scrubbed.rawDataUrl, 'data:image/png;base64,raw123');
  assert.match(scrubbed.dataUrl, /redacted-provider-body\]:screenshot-data/);
  assert.equal(scrubbed.captureMode, 'full-page');
  assert.deepEqual(scrubbed.targetAnnotations?.map((annotation) => annotation.label), ['※1']);
  assert.equal(scrubbed.scrollY, 120);
  assert.equal(scrubbed.rawScreenshotRef, '[redacted-feedback-path]');
  assert.equal(scrubbed.annotatedScreenshotRef, 'feedback-bundle:feedback-1/screenshots/annotated.png');
  assert.match(scrubbed.note ?? '', /redacted-feedback-secret/);
});

test('scrubs standalone feedback text for provider bodies, secrets, and local paths', () => {
  const scrubbed = scrubFeedbackText('<html>provider Authorization: Bearer sk-html-secret-abcdefghijklmnopqrstuvwxyz rawProviderBody</html>');
  const path = scrubFeedbackText('loaded /Applications/workspace/ailab/research/app/SciForge/.secrets/token.txt');

  assert.match(scrubbed, /redacted-provider-body/);
  assert.doesNotMatch(scrubbed, /sk-html-secret|<html>/i);
  assert.equal(path, `loaded [redacted-feedback-path]`);
});
