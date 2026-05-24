import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sidebarSource = readFileSync(new URL('./AnnotationSidebar.tsx', import.meta.url), 'utf8');
const sidebarCss = readFileSync(new URL('../styles/app-feedback.css', import.meta.url), 'utf8');

test('annotation sidebar renders plan-only references, choices, and save controls', () => {
  assert.match(sidebarSource, /aria-label="全局注释侧栏"/);
  assert.match(sidebarSource, /annotation-plan/);
  assert.match(sidebarSource, /仅澄清，不改代码/);
  assert.match(sidebarSource, /SciForgeReferenceChips/);
  assert.match(sidebarSource, /ChatComposer/);
  assert.match(sidebarSource, /主 composer shell · annotation-plan-only/);
  assert.match(sidebarSource, /showReferencePicker=\{false\}/);
  assert.match(sidebarSource, /showFileUpload=\{false\}/);
  assert.match(sidebarSource, /showCollapseButton=\{false\}/);
  assert.doesNotMatch(sidebarSource, /<textarea/);
  assert.match(sidebarSource, /RunningWorkProcess/);
  assert.match(sidebarSource, /streamEvents/);
  assert.match(sidebarSource, /referenceComposerMarker/);
  assert.match(sidebarSource, /annotationPlanLatestChoices/);
  assert.match(sidebarSource, /onChoice\(choice\)/);
  assert.match(sidebarSource, /onSave/);
  assert.match(sidebarSource, /onDiscard/);
  assert.match(sidebarSource, /打开收件箱/);
  assert.match(sidebarCss, /\.annotation-sidebar\s*\{[\s\S]*?position: relative;[\s\S]*?flex: 0 0 clamp\(340px, 30vw, 440px\);/);
  assert.match(sidebarCss, /\.annotation-sidebar\s*\{[\s\S]*?height: 100vh;/);
  assert.match(sidebarCss, /@media \(max-width: 760px\)[\s\S]*?\.annotation-sidebar\s*\{[\s\S]*?height: min\(78vh, 620px\);/);
});
