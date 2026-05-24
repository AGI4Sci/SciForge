import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const captureLayerSource = readFileSync(new URL('./FeedbackCaptureLayer.tsx', import.meta.url), 'utf8');
const feedbackCss = readFileSync(new URL('../styles/app-feedback.css', import.meta.url), 'utf8');

test('feedback capture layer exposes a visible annotation selection mode', () => {
  assert.match(captureLayerSource, /annotationModeActive/);
  assert.match(captureLayerSource, /onAnnotationModeChange/);
  assert.match(captureLayerSource, /feedback-annotation-hint/);
  assert.match(captureLayerSource, /注释模式/);
  assert.match(captureLayerSource, /点击页面对象加入注释侧栏；右键可打开精准反馈评论，Esc 退出。/);
  assert.match(captureLayerSource, /已加入 \$\{annotationReferenceCount\} 个对象到注释侧栏；继续点选，或在侧栏描述关系。/);
  assert.match(captureLayerSource, /buildFeedbackTargetSnapshot\(element, \{ x: event\.clientX, y: event\.clientY \}\)/);
  assert.match(captureLayerSource, /function addAnnotationReference\(element: Element, event: MouseEvent\)/);
  assert.match(captureLayerSource, /referenceForFeedbackTarget\(context\.target, context\.selectedText, 'object'\)/);
  assert.match(captureLayerSource, /onAnnotationReference\(\{ reference, target: context\.target, selectedText: context\.selectedText \}\)/);
  assert.match(captureLayerSource, /annotationReferenceCount = 0/);
  assert.match(captureLayerSource, /addAnnotationReference\(element, event\)/);
  assert.match(captureLayerSource, /commentTargetForElement\(element, event\)/);
  assert.match(captureLayerSource, /onAnnotationModeChange\?\.\(false\)/);
  assert.doesNotMatch(captureLayerSource, /<button type="button" onClick=\{openComment\}>添加评论<\/button>/);
  assert.doesNotMatch(captureLayerSource, /mode === 'menu'/);
  assert.doesNotMatch(captureLayerSource, /主对话/);
  assert.match(feedbackCss, /\.feedback-highlight-box\s*\{[\s\S]*?position: fixed;[\s\S]*?pointer-events: none;/);
  assert.match(feedbackCss, /\.feedback-annotation-hint\s*\{[\s\S]*?pointer-events: auto;/);
});
