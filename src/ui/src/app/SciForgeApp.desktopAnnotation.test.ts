import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Script, createContext } from 'node:vm';
import { transformSync } from 'esbuild';

const appSource = readFileSync(new URL('./SciForgeApp.tsx', import.meta.url), 'utf8');
const topBarSource = readFileSync(new URL('./appShell/TopBar.tsx', import.meta.url), 'utf8');
const configSource = readFileSync(new URL('../config.ts', import.meta.url), 'utf8');

function desktopAnnotationModel() {
  const start = appSource.indexOf('const desktopAnnotationReferenceKeys');
  const end = appSource.indexOf('export function SciForgeApp');
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = [
    'const scrubSciForgeReference = (reference) => reference;',
    appSource.slice(start, end),
    'module.exports = { desktopAnnotationReferenceInputsFromResult };',
  ].join('\n');
  const { code } = transformSync(source, { loader: 'tsx', format: 'cjs', target: 'es2022' });
  const sandbox = { module: { exports: {} }, exports: {} };
  new Script(code).runInContext(createContext(sandbox));
  return sandbox.module.exports as {
    desktopAnnotationReferenceInputsFromResult: (result: unknown) => Array<{ reference: { payload?: Record<string, unknown> } }>;
  };
}

test('global annotation bridge contract uses mode-based one-shot annotation only', () => {
  assert.match(configSource, /type DesktopAnnotationMode = 'sciforge-page' \| 'screen-region' \| 'app-window'/);
  assert.match(configSource, /startAnnotation\?:/);
  assert.match(configSource, /startDesktopAnnotation\?:/);
  assert.match(configSource, /cancelAnnotation\?:/);
  assert.match(configSource, /getAnnotationState\?:/);
  for (const method of [
    'updateDesktopAnnotationSelection',
    'submitDesktopAnnotationSelection',
  ]) {
    assert.doesNotMatch(configSource, new RegExp(`${method}\\?:`));
  }
});

test('top bar presents Annotate as a three-mode menu separate from Global Vision', () => {
  assert.match(topBarSource, /Global Annotate/);
  assert.match(topBarSource, /choose SciForge page, Screen region, or App window/i);
  assert.match(topBarSource, /screen region/i);
  assert.match(topBarSource, /SciForge page/);
  assert.match(topBarSource, /App window/);
  assert.match(topBarSource, /aria-haspopup="menu"/);
  assert.match(topBarSource, /onAnnotationModeSelect/);
  assert.match(topBarSource, /data-annotation-mode=\{item\.mode\}/);
  assert.match(topBarSource, /Global Vision only senses screen/i);
  assert.match(topBarSource, /title=\{annotationButtonTitle\}/);
  assert.match(topBarSource, /aria-label=\{annotationButtonLabel\}/);
  assert.match(topBarSource, /'en-US': 'Annotate'/);
  assert.doesNotMatch(topBarSource, /Open annotations/);
});

test('SciForgeApp starts explicit annotation mode and never polls or submits selection', () => {
  assert.match(appSource, /type AppAnnotationMode = DesktopAnnotationMode/);
  assert.match(appSource, /function toggleAnnotationSelectionMode/);
  assert.match(appSource, /async function selectAnnotationMode\(mode: AppAnnotationMode\)/);
  assert.match(appSource, /async function startDesktopAnnotationMode\(mode: Exclude<AppAnnotationMode, 'sciforge-page'>\)/);
  assert.match(appSource, /function startWebAnnotationSelectionMode/);
  assert.match(appSource, /window\.sciforgeDesktop/);
  assert.match(appSource, /const startAnnotation = bridge\.startAnnotation \?\? bridge\.startDesktopAnnotation/);
  assert.match(appSource, /purpose: desktopAnnotationPurposeForMode\(mode\)/);
  assert.match(appSource, /mode,/);
  assert.match(appSource, /mode === 'sciforge-page'/);
  assert.doesNotMatch(appSource, /getAnnotationState\?\.\(/);
  assert.doesNotMatch(appSource, /updateDesktopAnnotationSelection\?\.\(/);
  assert.doesNotMatch(appSource, /submitDesktopAnnotationSelection\?\.\(/);
  assert.match(appSource, /desktopAnnotationReferenceInputsFromResult/);
  assert.match(appSource, /function addAnnotationReferenceToCurrentDraft/);
  assert.match(appSource, /function handleDesktopAnnotationResult/);
  assert.match(appSource, /for \(const input of desktopAnnotationReferenceInputsFromResult\(result\)\) \{\s*addAnnotationReferenceToCurrentDraft\(input, \{ webSelectionActive: false \}\);/);
  assert.match(appSource, /setFeedbackAnnotationModeActive\(false\)/);
});

test('desktop annotation references preserve annotation mode evidence metadata', () => {
  assert.match(appSource, /const actionMetadata = desktopAnnotationActionMetadata\(record, metadata\)/);
  assert.match(appSource, /windowBinding:\s*desktopAnnotationWindowBinding\(actionMetadata\.windowBinding, actionMetadata\)/);
  assert.match(appSource, /app:\s*desktopAnnotationBoundedMetadata\(actionMetadata\.app \?\? actionMetadata\.application\)/);
  assert.match(appSource, /process:\s*desktopAnnotationBoundedMetadata\(actionMetadata\.process \?\? actionMetadata\.processInfo\)/);
  assert.match(appSource, /candidates:\s*desktopAnnotationBoundedMetadata\(actionMetadata\.candidates \?\? actionMetadata\.windowCandidates\)/);
});

test('desktop annotation composer payload preserves refs-first manual-bound window metadata without action execution fields', () => {
  const { desktopAnnotationReferenceInputsFromResult } = desktopAnnotationModel();
  const [input] = desktopAnnotationReferenceInputsFromResult({
    reference: { id: 'annotation-manual-window', ref: 'annotation:manual-window', kind: 'ui' },
    metadata: {
      windowBinding: { status: 'unbound', reason: 'stale metadata should not win' },
      windowLocalBounds: { x: 1, y: 2, width: 3, height: 4 },
    },
    refs: {
      windowRef: { ref: 'desktop-window:app:paper-reader:window-42' },
      windowLocalBounds: { x: 120, y: 180, width: 300, height: 220 },
      windowBinding: {
        status: 'manual-bound',
        confidence: 1,
        reason: 'User selected the app window while annotating.',
        windowRef: { ref: 'desktop-window:app:paper-reader:window-42' },
        appName: 'Paper Reader',
        bundleId: 'com.example.paper-reader',
        pid: 4242,
        title: 'Attention Is All You Need.pdf',
        windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
        windowLocalBounds: { x: 120, y: 180, width: 300, height: 220 },
        windowActionSessionRef: 'window-action-session:should-not-project',
        actionRef: 'window-action-ref:should-not-project',
        guiExecutable: true,
      },
      app: {
        name: 'Paper Reader',
        bundleId: 'com.example.paper-reader',
        actionHandler: 'should-not-project',
      },
      process: {
        pid: 4242,
        name: 'Paper Reader',
        actionCommand: 'should-not-project',
      },
      candidates: [{
        windowRef: { ref: 'desktop-window:app:paper-reader:window-42' },
        appName: 'Paper Reader',
        bundleId: 'com.example.paper-reader',
        pid: 4242,
        title: 'Attention Is All You Need.pdf',
        confidence: 1,
        windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
        windowLocalBounds: { x: 120, y: 180, width: 300, height: 220 },
        actionRef: 'window-action-ref:should-not-project',
      }],
    },
  });

  const payload = JSON.parse(JSON.stringify(input?.reference.payload));
  assert.ok(payload);
  assert.equal(payload.windowRef, 'desktop-window:app:paper-reader:window-42');
  assert.deepEqual(payload.windowLocalBounds, { x: 120, y: 180, width: 300, height: 220 });
  assert.deepEqual(payload.windowBinding, {
    status: 'manual-bound',
    confidence: 1,
    reason: 'User selected the app window while annotating.',
    windowRef: 'desktop-window:app:paper-reader:window-42',
    appName: 'Paper Reader',
    bundleId: 'com.example.paper-reader',
    pid: 4242,
    title: 'Attention Is All You Need.pdf',
    windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
    windowLocalBounds: { x: 120, y: 180, width: 300, height: 220 },
  });
  assert.deepEqual(payload.app, {
    name: 'Paper Reader',
    bundleId: 'com.example.paper-reader',
  });
  assert.deepEqual(payload.process, {
    pid: 4242,
    name: 'Paper Reader',
  });
  assert.deepEqual(payload.candidates, [{
    windowRef: { ref: 'desktop-window:app:paper-reader:window-42' },
    appName: 'Paper Reader',
    bundleId: 'com.example.paper-reader',
    pid: 4242,
    title: 'Attention Is All You Need.pdf',
    confidence: 1,
    windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
    windowLocalBounds: { x: 120, y: 180, width: 300, height: 220 },
  }]);
  assert.doesNotMatch(JSON.stringify(payload), /WindowActionSession|window-action-session|window-action-ref|windowActionSessionRef|actionRef|guiExecutable|actionHandler|actionCommand/);
});

test('desktop annotation composer payload preserves unbound windowBinding candidates without promoting an action target', () => {
  const { desktopAnnotationReferenceInputsFromResult } = desktopAnnotationModel();
  const [input] = desktopAnnotationReferenceInputsFromResult({
    reference: { id: 'annotation-unbound-window', ref: 'annotation:unbound-window', kind: 'ui' },
    metadata: {
      sourceKind: 'screen-region',
      windowBinding: {
        status: 'unbound',
        confidence: 0.36,
        reason: 'Top candidate was below the automatic binding threshold.',
        windowRef: 'desktop-window:should-not-promote',
        candidates: [{
          windowRef: { ref: 'desktop-window:app:paper-reader:window-42' },
          appName: 'Paper Reader',
          bundleId: 'com.example.paper-reader',
          pid: 4242,
          title: 'Attention Is All You Need.pdf',
          confidence: 0.36,
          reason: 'Partial overlap with selected region.',
          windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
          windowLocalBounds: { x: 700, y: 60, width: 120, height: 90 },
          windowActionSessionRef: 'window-action-session:should-not-project',
          actionRef: 'window-action-ref:should-not-project',
        }],
      },
    },
  });

  const payload = JSON.parse(JSON.stringify(input?.reference.payload));
  assert.ok(payload);
  assert.equal(payload.windowRef, undefined);
  assert.deepEqual(payload.windowBinding, {
    status: 'unbound',
    confidence: 0.36,
    reason: 'Top candidate was below the automatic binding threshold.',
    candidates: [{
      windowRef: 'desktop-window:app:paper-reader:window-42',
      appName: 'Paper Reader',
      bundleId: 'com.example.paper-reader',
      pid: 4242,
      title: 'Attention Is All You Need.pdf',
      confidence: 0.36,
      reason: 'Partial overlap with selected region.',
      windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
      windowLocalBounds: { x: 700, y: 60, width: 120, height: 90 },
    }],
  });
  assert.doesNotMatch(JSON.stringify(payload), /WindowActionSession|window-action-session|window-action-ref|windowActionSessionRef|actionRef|guiExecutable/);
});

test('desktop annotation composer ignores blocked start results even if a legacy bridge includes refs', () => {
  const { desktopAnnotationReferenceInputsFromResult } = desktopAnnotationModel();
  const inputs = desktopAnnotationReferenceInputsFromResult({
    ok: false,
    status: 'blocked',
    annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/phantom',
    screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/phantom',
    cropRef: 'desktop-annotation:workspace/workspace-a/session/session-a/crop/phantom',
    imageRef: 'desktop-annotation:workspace/workspace-a/session/session-a/image/phantom',
    windowBinding: {
      status: 'blocked',
      reason: 'desktop.annotation.screen-region-interactive-capture-unavailable',
    },
    diagnostics: [{
      code: 'desktop.annotation.screen-region-interactive-capture-unavailable',
      level: 'warning',
    }],
  });

  assert.equal(inputs.length, 0);
});

test('SciForgeApp falls back to DOM annotation only for SciForge page mode', () => {
  assert.match(appSource, /if \(mode === 'sciforge-page'\) \{\s*startWebAnnotationSelectionMode\(\);/);
  assert.match(appSource, /Desktop global annotation bridge is missing startAnnotation/);
  assert.match(appSource, /Desktop global annotation bridge is unavailable for/);
  assert.doesNotMatch(appSource, /Desktop global annotation is unavailable; falling back to web DOM annotation/);
});
