import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computerUseActionObservationContextBlockReason,
  computerUseExecutorBoundary,
  computerUseInputChannelContract,
  computerUseInputChannelDescription,
  computerUseRealInputBlockReason,
  computerUseRequiresVisibleArtifact,
  computerUseSchedulerLockIdForTarget,
  computerUseSchedulerRunMetadata,
  computerUseSchedulerStepMetadata,
  computerUseSystemEventsResultLine,
  computerUseTargetEvidenceBlockReason,
  computerUseTextEntryContextBlockReason,
  computerUseVisibleArtifactGapReason,
  normalizeComputerUseCoordinateSpace,
  normalizeComputerUseIndependentInputAdapter,
  normalizeComputerUseInputIsolation,
  normalizeComputerUseWindowTargetMode,
} from './runtime-policy.js';

test('computer use runtime policy owns executor and adapter taxonomy', () => {
  assert.equal(computerUseExecutorBoundary('darwin'), 'darwin-system-events-generic-gui-executor');
  assert.equal(computerUseExecutorBoundary('linux desktop'), 'linux-desktop-generic-gui-executor');
  assert.equal(normalizeComputerUseIndependentInputAdapter('remote_desktop_session'), 'remote-desktop');
  assert.equal(normalizeComputerUseIndependentInputAdapter('virtual-hid-device'), 'virtual-hid');
  assert.equal(normalizeComputerUseIndependentInputAdapter('unknown'), undefined);
  assert.equal(computerUseSystemEventsResultLine('click', true), 'system-events click visualCursor=not-shown-system-events-primary');
});

test('computer use window target normalization lives in the package policy', () => {
  assert.equal(normalizeComputerUseWindowTargetMode('frontmost', {}), 'active-window');
  assert.equal(normalizeComputerUseWindowTargetMode(undefined, { windowId: 42 }), 'window-id');
  assert.equal(normalizeComputerUseWindowTargetMode(undefined, { appName: 'Finder' }), 'app-window');
  assert.equal(normalizeComputerUseCoordinateSpace(undefined, 'display'), 'screen');
  assert.equal(normalizeComputerUseCoordinateSpace('target-window', 'app-window'), 'window');
  assert.equal(normalizeComputerUseInputIsolation(undefined, true), 'require-focused-target');
  assert.equal(normalizeComputerUseInputIsolation('off', true), 'best-effort');
  assert.equal(
    computerUseSchedulerLockIdForTarget({ mode: 'app-window', appName: 'Example App', title: 'Draft' }, 42),
    'vision-window-app-window-42-example-app-draft',
  );
});

test('computer use input channel contract keeps policy strings package-owned', () => {
  const dryRun = computerUseInputChannelContract({
    desktopPlatform: 'darwin',
    dryRun: true,
    targetResolved: true,
    targetBound: true,
    isolation: 'require-focused-target',
    executorLockId: 'window-42',
  });
  assert.equal(dryRun.type, 'generic-mouse-keyboard');
  assert.equal(dryRun.pointerKeyboardOwnership, 'virtual-dry-run-channel');
  assert.equal(dryRun.userDeviceImpact, 'none');
  assert.equal(
    computerUseInputChannelDescription({
      contract: dryRun,
      targetResolved: true,
      captureKind: 'window',
      coordinateSpace: 'window-local',
      inputIsolation: 'require-focused-target',
    }),
    'generic-mouse-keyboard:dry-run:target-window:window-relative-grounding:require-focused-target',
  );

  const independent = computerUseInputChannelContract({
    desktopPlatform: 'darwin',
    inputAdapter: 'remote-desktop',
    targetResolved: true,
    targetBound: true,
    isolation: 'require-focused-target',
    executorLockId: 'window-42',
  });
  assert.equal(independent.currentIndependentAdapter, 'remote-desktop');
  assert.equal(independent.independentAdapterStatus, 'configured-unimplemented');
  assert.equal(independent.userDeviceImpact, 'fail-closed-unimplemented-independent-adapter');
  assert.equal(independent.failClosed, true);

  const readyIndependent = computerUseInputChannelContract({
    desktopPlatform: 'darwin',
    inputAdapter: 'remote-desktop',
    independentAdapterReady: true,
    targetResolved: true,
    targetBound: true,
    isolation: 'require-focused-target',
    executorLockId: 'window-42',
  });
  assert.equal(readyIndependent.provider, 'remote-desktop-input-adapter');
  assert.equal(readyIndependent.pointerKeyboardOwnership, 'sciforge-independent-input-adapter');
  assert.equal(readyIndependent.pointerMode, 'adapter-window-bound-pointer');
  assert.equal(readyIndependent.keyboardMode, 'adapter-window-bound-keyboard');
  assert.equal(readyIndependent.userDeviceImpact, 'none');
  assert.equal(readyIndependent.failClosed, false);

  const shared = computerUseInputChannelContract({
    desktopPlatform: 'darwin',
    allowSharedSystemInput: true,
    showVisualCursor: true,
    targetResolved: true,
    targetBound: true,
    isolation: 'require-focused-target',
    executorLockId: 'shared-system-input',
  });
  assert.equal(shared.pointerKeyboardOwnership, 'shared-system-pointer-keyboard');
  assert.equal(shared.visualPointerShape, 'cyan-diamond-magenta-outline-white-crosshair');
  assert.equal(shared.executorLockScope, 'global-shared-system-input');
  assert.equal(shared.failClosed, false);
});

test('computer use scheduler and real input policies are package-owned', () => {
  const step = computerUseSchedulerStepMetadata({
    targetResolved: true,
    stepId: 'step-1',
    lockId: 'window-42',
    lockScope: 'target-window',
    captureKind: 'window',
    inputIsolation: 'require-focused-target',
    targetBound: true,
    strictFocus: true,
  });
  assert.equal(step.mode, 'serialized-window-actions');
  assert.equal(step.actionConcurrency, 'one-real-gui-action-at-a-time-per-window');
  assert.equal(step.interferenceRisk, 'low-when-focused-target-verified');

  const run = computerUseSchedulerRunMetadata({
    targetResolved: true,
    lockId: 'shared-system-input',
    lockScope: 'shared-system-input',
    sharedSystemInput: true,
    targetBound: true,
    strictFocus: true,
  });
  assert.equal(run.actionConcurrency, 'one-real-gui-action-at-a-time-globally-for-shared-system-input');

  assert.match(
    computerUseRealInputBlockReason({ actionType: 'click', desktopPlatform: 'darwin' }),
    /shared system mouse\/keyboard input was not explicitly allowed/,
  );
  assert.equal(computerUseRealInputBlockReason({ actionType: 'open_app', desktopPlatform: 'darwin' }), '');
});

test('visible artifact completion gap policy is package-owned', () => {
  assert.equal(
    computerUseVisibleArtifactGapReason('create a short presentation artifact', [{ type: 'open_app' }]),
    '',
  );
  assert.equal(
    computerUseVisibleArtifactGapReason('create a short presentation artifact', [{ type: 'open_app' }], { finalAttempt: true }),
    'Visible artifact task did not satisfy completion acceptance: app/window bootstrap finished without visible content entry or structure-edit actions.',
  );
  assert.equal(
    computerUseVisibleArtifactGapReason('create a short presentation artifact', [{ type: 'open_app' }, { type: 'type_text' }]),
    '',
  );
  assert.equal(
    computerUseVisibleArtifactGapReason(
      'create a PowerPoint slide with three source facts as body bullets',
      [
        { type: 'type_text', text: 'http://127.0.0.1:18082/source-page.html' },
        { type: 'type_text', text: 'SciForge L3 Computer Use Acceptance' },
        { type: 'click' },
        { type: 'click' },
      ],
      { finalAttempt: true },
    ),
    'Visible artifact task did not satisfy completion acceptance: rich slide/facts tasks require visible non-navigation body text entry before completion.',
  );
  assert.equal(
    computerUseVisibleArtifactGapReason(
      'create a PowerPoint slide with three source facts as body bullets',
      [
        { type: 'type_text', text: 'SciForge L3 Computer Use Acceptance\n- TUI 主机调用 computer_use.runTask\n- KV-Ground 定位可见的浏览器和滑动控件\n- 参考文献优先追踪记录浏览器、幻灯片和伪影证据' },
      ],
      { finalAttempt: true },
    ),
    'Visible artifact task did not satisfy completion acceptance: no current visible final artifact/report ref was produced or displayed.',
  );
  assert.equal(
    computerUseVisibleArtifactGapReason('create a short presentation artifact', [{ type: 'open_app' }, { type: 'scroll' }]),
    'Visible artifact task did not satisfy completion acceptance: no visible content entry or structure-edit action was executed after app/window bootstrap.',
  );
  assert.equal(
    computerUseVisibleArtifactGapReason('open the notes app', [{ type: 'open_app' }]),
    '',
  );
  assert.equal(computerUseRequiresVisibleArtifact('save current file'), false);
  assert.equal(computerUseRequiresVisibleArtifact('save the local document'), false);
  assert.equal(computerUseRequiresVisibleArtifact('write a short summary in the comment box'), false);
  assert.equal(computerUseRequiresVisibleArtifact('metadata contains artifactRefs from a previous diagnostic run'), false);
  assert.equal(computerUseRequiresVisibleArtifact('write an evidence summary report with action mapping'), true);
  assert.equal(computerUseRequiresVisibleArtifact('export the final report artifact'), true);
});

test('filesystem path text entry is blocked outside file dialog context', () => {
  assert.match(
    computerUseTextEntryContextBlockReason({
      actionType: 'type_text',
      text: '/tmp/sciforge/acceptance-slide.pptx',
      targetAppName: 'Microsoft PowerPoint',
      targetTitle: '演示文稿2',
    }),
    /does not look like a save\/open\/file dialog/,
  );
  assert.equal(
    computerUseTextEntryContextBlockReason({
      actionType: 'type_text',
      text: '/tmp/sciforge/acceptance-slide.pptx',
      targetAppName: 'Microsoft PowerPoint',
      targetTitle: 'Save As',
    }),
    '',
  );
  assert.equal(
    computerUseTextEntryContextBlockReason({
      actionType: 'type_text',
      text: 'SciForge L3 Computer Use Acceptance',
      targetAppName: 'Microsoft PowerPoint',
      targetTitle: '演示文稿2',
    }),
    '',
  );
  assert.equal(
    computerUseTextEntryContextBlockReason({
      actionType: 'type_text',
      text: '/Tests & Validation',
      targetAppName: 'TextEdit',
      targetTitle: 'Untitled',
    }),
    '',
  );
  assert.equal(
    computerUseTextEntryContextBlockReason({
      actionType: 'type_text',
      text: [
        'Computer Use Report',
        'Visible App/Window: TextEdit',
        'Evidence Refs: step-002-before-display-1.png, step-002-before-display-2.png',
      ].join('\n'),
      targetAppName: 'TextEdit',
      targetTitle: 'Untitled',
    }),
    '',
  );
  assert.equal(
    computerUseTextEntryContextBlockReason({
      actionType: 'type_text',
      text: [
        'Computer Use Local Report',
        'Visible app/window: TextEdit',
        'Visible UI fact: The document body is ready for input.',
        'Evidence refs:',
        '- .sciforge/vision-runs/computer-use-package-live/step-003-before-display-1.png',
        '- .sciforge/vision-runs/computer-use-package-live/step-003-before-display-2.png',
      ].join('\n'),
      targetAppName: 'TextEdit',
      targetTitle: 'Untitled',
    }),
    '',
  );
  assert.match(
    computerUseTextEntryContextBlockReason({
      actionType: 'type_text',
      text: '.sciforge/vision-runs/computer-use-package-live/report.md',
      targetAppName: 'TextEdit',
      targetTitle: 'Untitled',
    }),
    /does not look like a save\/open\/file dialog/,
  );
});

test('file workflow click targets require current visible observation evidence', () => {
  assert.match(
    computerUseTargetEvidenceBlockReason({
      actionType: 'click',
      targetDescription: 'the Browse button in the visible Save As file dialog',
      targetAppName: 'Microsoft PowerPoint',
      targetTitle: '演示文稿2',
      observationSummary: 'A PowerPoint slide editor is visible with title and body placeholders.',
      visibleTexts: ['单击此处添加标题'],
    }),
    /current compact observation does not show that target/,
  );
  assert.equal(
    computerUseTargetEvidenceBlockReason({
      actionType: 'click',
      targetDescription: 'the Browse button in the visible Save As file dialog',
      targetAppName: 'Microsoft PowerPoint',
      targetTitle: 'Save As',
      observationSummary: 'A macOS Save As file dialog is visible.',
      visibleTexts: ['Save As', 'Where', 'Browse', 'Save'],
    }),
    '',
  );
  assert.equal(
    computerUseTargetEvidenceBlockReason({
      actionType: 'click',
      targetDescription: 'the disk icon in the top-left toolbar of the PowerPoint window',
      targetAppName: 'Microsoft PowerPoint',
      targetTitle: '演示文稿2',
      observationSummary: 'A PowerPoint slide editor is visible.',
      visibleTexts: ['单击此处添加标题'],
    }),
    '',
  );
});

test('combined observation context guard blocks save target hallucinations from editor observations', () => {
  const editorContext = {
    targetAppName: 'Microsoft PowerPoint',
    targetTitle: '演示文稿1',
    observationSummary: 'Captured 1 screenshot ref(s). visibleText=自动保存 | 开始 | 插入 | 绘图 | 粘贴 | 演示文稿1',
    visibleTexts: ['自动保存', '开始', '插入', '绘图', '粘贴', '演示文稿1'],
    visibleTextExtractionEnabled: true,
  };
  assert.match(
    computerUseActionObservationContextBlockReason({
      actionType: 'click',
      targetDescription: '另存为 (Save As) option in the File backstage view',
      ...editorContext,
    }),
    /current compact observation does not show that target/,
  );
  assert.match(
    computerUseActionObservationContextBlockReason({
      actionType: 'click',
      targetDescription: '浏览 (Browse) button in Save As backstage',
      ...editorContext,
    }),
    /current compact observation does not show that target/,
  );
  assert.match(
    computerUseActionObservationContextBlockReason({
      actionType: 'click',
      targetDescription: 'Save As filename text field or path field in the file dialog',
      ...editorContext,
    }),
    /current compact observation does not show that target/,
  );
  assert.equal(
    computerUseActionObservationContextBlockReason({
      actionType: 'click',
      targetDescription: 'Save As filename text field or path field in the file dialog',
      ...editorContext,
      visibleTextExtractionEnabled: false,
    }),
    '',
  );
});
