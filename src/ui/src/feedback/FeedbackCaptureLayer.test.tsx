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
  assert.match(captureLayerSource, /移动鼠标选择页面目标，点击添加精准评论；Esc 退出。/);
  assert.match(captureLayerSource, /buildFeedbackTargetSnapshot\(element, \{ x: event\.clientX, y: event\.clientY \}\)/);
  assert.match(captureLayerSource, /setContextTarget\(contextForElement\(element, event, 'comment'\)\)/);
  assert.match(captureLayerSource, /onAnnotationModeChange\?\.\(false\)/);
  assert.match(feedbackCss, /\.feedback-highlight-box\s*\{[\s\S]*?position: fixed;[\s\S]*?pointer-events: none;/);
  assert.match(feedbackCss, /\.feedback-annotation-hint\s*\{[\s\S]*?pointer-events: auto;/);
});
