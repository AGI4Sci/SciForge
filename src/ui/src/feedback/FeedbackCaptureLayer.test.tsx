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
  assert.match(captureLayerSource, /点击页面对象引用到主对话；可连续点选多个对象，右键添加反馈评论，Esc 退出。/);
  assert.match(captureLayerSource, /已引用 \$\{annotationReferenceCount\} 个对象到主对话；继续点选，或在输入栏描述关系。/);
  assert.match(captureLayerSource, /buildFeedbackTargetSnapshot\(element, \{ x: event\.clientX, y: event\.clientY \}\)/);
  assert.match(captureLayerSource, /function addAnnotationReference\(element: Element, event: MouseEvent\)/);
  assert.match(captureLayerSource, /referenceForFeedbackTarget\(context\.target, context\.selectedText, 'object'\)/);
  assert.match(captureLayerSource, /onReference\(reference\)/);
  assert.match(captureLayerSource, /setAnnotationReferenceCount\(\(count\) => count \+ 1\)/);
  assert.match(captureLayerSource, /addAnnotationReference\(element, event\)/);
  assert.match(captureLayerSource, /setContextTarget\(contextForElement\(element, event, 'comment'\)\)/);
  assert.match(captureLayerSource, /onAnnotationModeChange\?\.\(false\)/);
  assert.match(feedbackCss, /\.feedback-highlight-box\s*\{[\s\S]*?position: fixed;[\s\S]*?pointer-events: none;/);
  assert.match(feedbackCss, /\.feedback-annotation-hint\s*\{[\s\S]*?pointer-events: auto;/);
});
