import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import type { ModuleInvokeRequest } from '@sciforge-ui/runtime-contract/modules';
import {
  COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS,
  COMPUTER_USE_PRIMITIVE_INTENTS,
  COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
  createComputerUsePrimitiveService,
  type ComputerUseActInput,
  type ComputerUseObserveInput,
  type ComputerUsePrimitivePorts,
} from './index.js';

const execFileAsync = promisify(execFile);
const liveEnabled = process.env.SCIFORGE_COMPUTER_USE_TEXTEDIT_PRIMITIVE_ACCEPTANCE === '1';
const TEXTEDIT_LIVE_ACCEPTANCE_ENV = 'SCIFORGE_COMPUTER_USE_TEXTEDIT_PRIMITIVE_ACCEPTANCE=1' as const;
const TEXTEDIT_LIVE_ARTIFACT_BASE = join(process.cwd(), 'docs', 'test-artifacts', 'computer-use-primitive-textedit-live');
const TEXTEDIT_LIVE_ACCEPTANCE_CAPABILITY = {
  maturity: 'live-diagnostic',
  productReady: false,
  sharedSystemInputUsed: true,
  multiSessionIsolationGate: true,
  requiresExplicitEnv: TEXTEDIT_LIVE_ACCEPTANCE_ENV,
  cleanup: {
    required: true,
    asserts: [
      'no-matching-test-documents',
      'no-test-owned-textedit-process',
      'no-test-artifacts-by-default',
    ],
  },
} as const;

test('TextEdit live acceptance is explicitly diagnostic until session-local input is product-backed', () => {
  assert.equal(TEXTEDIT_LIVE_ACCEPTANCE_CAPABILITY.maturity, 'live-diagnostic');
  assert.equal(TEXTEDIT_LIVE_ACCEPTANCE_CAPABILITY.productReady, false);
  assert.equal(TEXTEDIT_LIVE_ACCEPTANCE_CAPABILITY.sharedSystemInputUsed, true);
  assert.equal(TEXTEDIT_LIVE_ACCEPTANCE_CAPABILITY.multiSessionIsolationGate, true);
  assert.equal(TEXTEDIT_LIVE_ACCEPTANCE_CAPABILITY.requiresExplicitEnv, 'SCIFORGE_COMPUTER_USE_TEXTEDIT_PRIMITIVE_ACCEPTANCE=1');
  assert.equal(TEXTEDIT_LIVE_ACCEPTANCE_CAPABILITY.cleanup.required, true);
  assert.deepEqual(TEXTEDIT_LIVE_ACCEPTANCE_CAPABILITY.cleanup.asserts, [
    'no-matching-test-documents',
    'no-test-owned-textedit-process',
    'no-test-artifacts-by-default',
  ]);
});

test('TextEdit live acceptance cleanup removes stale artifacts and drag source by default', async () => {
  const artifactBase = await mkdtemp(join(tmpdir(), 'sciforge-cu-textedit-live-artifacts-'));
  const staleRunDir = join(artifactBase, 'cu-primitive-textedit-stale');
  const staleSwiftSource = join(artifactBase, 'computer-use-primitive-textedit-live-drag.swift');
  await mkdir(staleRunDir, { recursive: true });
  await writeFile(join(staleRunDir, 'manifest.json'), '{}\n', 'utf8');
  await writeFile(staleSwiftSource, 'stale swift source\n', 'utf8');

  try {
    await cleanupTextEditLiveArtifacts({
      artifactBase,
      dragSwiftSource: staleSwiftSource,
      keepArtifacts: false,
    });

    assert.equal(await pathExists(staleRunDir), false);
    assert.equal(await pathExists(staleSwiftSource), false);
    await assertTextEditLiveArtifactsClean({
      artifactBase,
      dragSwiftSource: staleSwiftSource,
      keepArtifacts: false,
    });
  } finally {
    await rm(artifactBase, { recursive: true, force: true });
  }
});

test('TextEdit live cleanup stops an empty pre-existing TextEdit process after diagnostic acceptance', () => {
  assert.equal(shouldStopTextEditAfterLiveCleanup({ running: false, matchingDocuments: 0, allDocuments: 0 }), true);
  assert.equal(shouldStopTextEditAfterLiveCleanup({ running: true, matchingDocuments: 0, allDocuments: 0 }), true);
  assert.equal(shouldStopTextEditAfterLiveCleanup({ running: true, matchingDocuments: 0, allDocuments: 1 }), false);
});

test('TextEdit live cleanup may stop when only other live test documents remain', () => {
  assert.equal(shouldStopTextEditAfterLiveCleanup({
    running: true,
    matchingDocuments: 1,
    liveTestDocuments: 2,
    allDocuments: 2,
  }), true);
  assert.equal(shouldStopTextEditAfterLiveCleanup({
    running: true,
    matchingDocuments: 1,
    liveTestDocuments: 1,
    allDocuments: 2,
  }), false);
});

test('TextEdit live cleanup force-stops a test-owned TextEdit process even after markers are closed', () => {
  assert.equal(shouldForceStopTextEditAfterLiveCleanup({
    shouldBeStopped: true,
    running: true,
    matchingDocuments: 0,
    liveTestDocuments: 0,
    allDocuments: 2,
  }), true);
  assert.equal(shouldForceStopTextEditAfterLiveCleanup({
    shouldBeStopped: false,
    running: true,
    matchingDocuments: 0,
    liveTestDocuments: 0,
    allDocuments: 2,
  }), false);
});

test('Computer Use primitives operate a real TextEdit window end to end', {
  skip: liveEnabled ? undefined : 'set SCIFORGE_COMPUTER_USE_TEXTEDIT_PRIMITIVE_ACCEPTANCE=1 to run the live TextEdit primitive acceptance',
  timeout: 60_000,
}, async () => {
  const runNumber = String(Date.now());
  const runId = `cu-primitive-textedit-${runNumber}`;
  const artifactBase = TEXTEDIT_LIVE_ARTIFACT_BASE;
  const artifactRoot = join(artifactBase, runId);
  const keepArtifacts = process.env.SCIFORGE_KEEP_COMPUTER_USE_TEXTEDIT_ARTIFACTS === '1';
  await cleanupTextEditLiveArtifacts({
    artifactBase,
    dragSwiftSource: textEditLiveDragSwiftSourcePath(),
    keepArtifacts,
  });
  const initialTextEditState = await readTextEditLiveRunState(runId);
  if (initialTextEditState.matchingDocuments > 0) {
    await cleanupTextEditLiveRun(runId, initialTextEditState.matchingDocuments === initialTextEditState.allDocuments);
  }
  const cleanTextEditStateBefore = await readTextEditLiveRunState(runId);
  const stopTextEditAfterCleanup = shouldStopTextEditAfterLiveCleanup(cleanTextEditStateBefore);
  const frontApplicationBefore = await readFrontApplicationName().catch(() => undefined);
  const pointerBefore = await readMousePointer().catch(() => undefined);
  await mkdir(artifactRoot, { recursive: true });

  const placeholderText = `SCIFORGE_CU_LIVE_${runId}_PLACEHOLDER\n`;
  const expectedText = [
    `SCIFORGE_CU_LIVE_${runId}`,
    ...Array.from({ length: 36 }, (_, index) => `line-${String(index + 1).padStart(2, '0')}-20260607${runNumber}`),
  ].join('\n');
  const textRefs = new Map([
    ['text:cu-live-content', expectedText],
  ]);
  const ports = createTextEditPrimitivePorts({ artifactRoot, runId, placeholderText, textRefs });
  const service = createComputerUsePrimitiveService({ ports });

  try {
    const bind = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'app',
        appId: 'com.apple.TextEdit',
        targetRef: `textedit-live-doc:${runId}`,
      },
      riskPolicy: 'fail-closed',
    }));
    assert.equal(bind.ok, true, bind.error);
    const bindOutput = bind.value?.output as { sessionId: string };

    const procedure = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.runProcedure, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.runProcedure,
      sessionId: bindOutput.sessionId,
      procedureRef: `procedure:${runId}:write-observe`,
      steps: [
        {
          id: 'observe-before',
          primitive: 'observe',
          input: {
            schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
            sessionId: bindOutput.sessionId,
            capture: 'both',
          },
        },
        {
          id: 'select-all',
          primitive: 'act',
          input: {
            schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
            sessionId: bindOutput.sessionId,
            action: {
              type: 'app_command',
              command: 'select_all',
            },
          },
        },
        {
          id: 'delete-placeholder',
          primitive: 'act',
          input: {
            schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
            sessionId: bindOutput.sessionId,
            action: {
              type: 'app_command',
              command: 'delete',
            },
            approvalRef: `approval:${runId}:delete-placeholder-in-owned-test-document`,
          },
        },
        {
          id: 'type-content',
          primitive: 'act',
          input: {
            schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
            sessionId: bindOutput.sessionId,
            action: {
              type: 'type',
              elementRef: `textedit:document:${runId}`,
              textRef: 'text:cu-live-content',
            },
          },
        },
        {
          id: 'click-document',
          primitive: 'act',
          input: {
            schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
            sessionId: bindOutput.sessionId,
            action: {
              type: 'click',
              elementRef: `textedit:document:${runId}`,
            },
          },
        },
        {
          id: 'double-click-document',
          primitive: 'act',
          input: {
            schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
            sessionId: bindOutput.sessionId,
            action: {
              type: 'double_click',
              elementRef: `textedit:document:${runId}`,
            },
          },
        },
        {
          id: 'caret-right',
          primitive: 'act',
          input: {
            schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
            sessionId: bindOutput.sessionId,
            action: {
              type: 'key',
              key: 'ArrowRight',
            },
          },
        },
        {
          id: 'scroll-down',
          primitive: 'act',
          input: {
            schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
            sessionId: bindOutput.sessionId,
            action: {
              type: 'scroll',
              elementRef: `textedit:document:${runId}`,
              direction: 'down',
              amount: 1,
            },
          },
        },
        {
          id: 'drag-selection',
          primitive: 'act',
          input: {
            schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
            sessionId: bindOutput.sessionId,
            action: {
              type: 'drag',
              elementRef: `textedit:document:${runId}`,
              point: {
                x: 24,
                y: 24,
                coordinateSpace: 'element',
              },
              toPoint: {
                x: 180,
                y: 24,
                coordinateSpace: 'element',
              },
            },
          },
        },
        {
          id: 'wait-for-ui',
          primitive: 'act',
          input: {
            schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
            sessionId: bindOutput.sessionId,
            action: {
              type: 'wait',
              durationMs: 120,
            },
          },
        },
        {
          id: 'observe-after',
          primitive: 'observe',
          input: {
            schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
            sessionId: bindOutput.sessionId,
            capture: 'both',
          },
        },
      ],
    }));
    assert.equal(procedure.ok, true, procedure.error);

    const control = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.control, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.control,
      sessionId: bindOutput.sessionId,
      command: 'release',
      reasonRef: `reason:${runId}:acceptance-complete`,
    }));
    assert.equal(control.ok, true, control.error);

    const procedureOutput = procedure.value?.output as {
      stepResults: Array<{ stepId: string; primitive: string; status: string; refs: string[] }>;
    };
    assert.deepEqual(procedureOutput.stepResults.map((step) => [step.stepId, step.primitive, step.status]), [
      ['observe-before', 'observe', 'completed'],
      ['select-all', 'act', 'completed'],
      ['delete-placeholder', 'act', 'completed'],
      ['type-content', 'act', 'completed'],
      ['click-document', 'act', 'completed'],
      ['double-click-document', 'act', 'completed'],
      ['caret-right', 'act', 'completed'],
      ['scroll-down', 'act', 'completed'],
      ['drag-selection', 'act', 'completed'],
      ['wait-for-ui', 'act', 'completed'],
      ['observe-after', 'observe', 'completed'],
    ]);
    assert.ok(procedureOutput.stepResults.every((step) => step.refs.length > 0));
    assert.equal(JSON.stringify(procedure.value?.output).includes('completionTruth'), false);
    const observeAfterRefs = procedureOutput.stepResults.find((step) => step.stepId === 'observe-after')?.refs;
    const afterObservation = await readJsonRef<{ contentSha256: string; contentPreview: string }>(
      requiredRef(observeAfterRefs, 'accessibility:'),
    );
    assert.equal(afterObservation.contentSha256, sha256(expectedText));

    const manifest = {
      schemaVersion: 'sciforge.computer-use.primitive-textedit-live-acceptance.v1',
      runId,
      targetRef: `textedit-live-doc:${runId}`,
      expectedSha256: sha256(expectedText),
      observedSha256: afterObservation.contentSha256,
      observedPreview: afterObservation.contentPreview,
      bindRefs: bind.refs,
      procedureRefs: procedure.refs,
      controlRefs: control.refs,
      stepResults: procedureOutput.stepResults,
      evidenceDir: artifactRoot,
      productPathClassification: TEXTEDIT_LIVE_ACCEPTANCE_CAPABILITY,
      cleanup: keepArtifacts ? 'artifacts-kept-by-env' : 'artifacts-removed-by-default',
    };
    await writeFile(join(artifactRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    assert.deepEqual(manifest.observedSha256, manifest.expectedSha256);
    assert.ok(observeAfterRefs?.some((ref) => ref.startsWith('observation:')));
    assert.ok(observeAfterRefs?.some((ref) => ref.startsWith('image:')));
  } finally {
    let cleanupError: unknown;
    try {
      await cleanupTextEditLiveRun(runId, stopTextEditAfterCleanup);
      await assertTextEditLiveRunClean(runId, stopTextEditAfterCleanup);
    } catch (error) {
      cleanupError = error;
    }
    if (!keepArtifacts) {
      await rm(artifactRoot, { recursive: true, force: true });
      await removeDirectoryIfEmpty(artifactBase);
    }
    await assertTextEditLiveArtifactsClean({
      artifactBase,
      dragSwiftSource: textEditLiveDragSwiftSourcePath(),
      keepArtifacts,
    });
    await restoreMousePointer(pointerBefore);
    await restoreFrontApplication(frontApplicationBefore);
    if (cleanupError) throw cleanupError;
  }
});

test('Computer Use TextEdit live acceptance binds independent session adapters for two sessions', {
  skip: liveEnabled ? undefined : 'set SCIFORGE_COMPUTER_USE_TEXTEDIT_PRIMITIVE_ACCEPTANCE=1 to run the live TextEdit session isolation acceptance',
  timeout: 60_000,
}, async () => {
  const runNumber = String(Date.now());
  const runIds = [
    `cu-primitive-textedit-${runNumber}-session-a`,
    `cu-primitive-textedit-${runNumber}-session-b`,
  ];
  const artifactBase = TEXTEDIT_LIVE_ARTIFACT_BASE;
  const artifactRoot = join(artifactBase, `session-isolation-${runNumber}`);
  const keepArtifacts = process.env.SCIFORGE_KEEP_COMPUTER_USE_TEXTEDIT_ARTIFACTS === '1';
  await cleanupTextEditLiveArtifacts({
    artifactBase,
    dragSwiftSource: textEditLiveDragSwiftSourcePath(),
    keepArtifacts,
  });
  const initialTextEditState = await readTextEditLiveRunState(runIds[0]);
  if (initialTextEditState.matchingDocuments > 0) {
    await cleanupTextEditLiveRun(runIds[0], initialTextEditState.matchingDocuments === initialTextEditState.allDocuments);
  }
  const cleanTextEditStateBefore = await readTextEditLiveRunState(runIds[0]);
  const stopTextEditAfterCleanup = shouldStopTextEditAfterLiveCleanup(cleanTextEditStateBefore);
  const frontApplicationBefore = await readFrontApplicationName().catch(() => undefined);
  const pointerBefore = await readMousePointer().catch(() => undefined);
  await mkdir(artifactRoot, { recursive: true });

  const service = createComputerUsePrimitiveService({
    ports: createTextEditSessionIsolationPorts({ artifactRoot, runIds }),
  });

  try {
    const first = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'app',
        appId: 'com.apple.TextEdit',
        targetRef: `textedit-live-doc:${runIds[0]}`,
      },
      riskPolicy: 'fail-closed',
    }));
    assert.equal(first.ok, true, first.error);

    const second = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'app',
        appId: 'com.apple.TextEdit',
        targetRef: `textedit-live-doc:${runIds[1]}`,
      },
      riskPolicy: 'fail-closed',
    }));
    assert.equal(second.ok, true, second.error);

    const firstOutput = first.value?.output as {
      sessionId: string;
      inputAdapterRef: string;
      cursorRef: string;
      scopedInputLeaseRef: string;
    };
    const secondOutput = second.value?.output as {
      sessionId: string;
      inputAdapterRef: string;
      cursorRef: string;
      scopedInputLeaseRef: string;
    };
    assert.notEqual(firstOutput.sessionId, secondOutput.sessionId);
    assert.notEqual(firstOutput.inputAdapterRef, secondOutput.inputAdapterRef);
    assert.notEqual(firstOutput.cursorRef, secondOutput.cursorRef);
    assert.notEqual(firstOutput.scopedInputLeaseRef, secondOutput.scopedInputLeaseRef);

    for (const output of [firstOutput, secondOutput]) {
      const release = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.control, {
        schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.control,
        sessionId: output.sessionId,
        command: 'release',
        reasonRef: `reason:${output.sessionId}:session-isolation-complete`,
      }));
      assert.equal(release.ok, true, release.error);
      const releaseRefs = release.refs ?? [];
      assert.ok(releaseRefs.includes(output.inputAdapterRef));
      assert.ok(releaseRefs.includes(output.cursorRef));
      assert.ok(releaseRefs.includes(output.scopedInputLeaseRef));
    }
  } finally {
    let cleanupError: unknown;
    try {
      for (const runId of runIds) {
        await cleanupTextEditLiveRun(runId, stopTextEditAfterCleanup);
      }
      await assertTextEditLiveRunClean(runIds[0], stopTextEditAfterCleanup);
    } catch (error) {
      cleanupError = error;
    }
    if (!keepArtifacts) {
      await rm(artifactRoot, { recursive: true, force: true });
      await removeDirectoryIfEmpty(artifactBase);
    }
    await assertTextEditLiveArtifactsClean({
      artifactBase,
      dragSwiftSource: textEditLiveDragSwiftSourcePath(),
      keepArtifacts,
    });
    await restoreMousePointer(pointerBefore);
    await restoreFrontApplication(frontApplicationBefore);
    if (cleanupError) throw cleanupError;
  }
});

test('Computer Use TextEdit live acceptance blocks concurrent shared system input sessions', {
  skip: liveEnabled ? undefined : 'set SCIFORGE_COMPUTER_USE_TEXTEDIT_PRIMITIVE_ACCEPTANCE=1 to run the live TextEdit shared-input conflict acceptance',
  timeout: 60_000,
}, async () => {
  const runNumber = String(Date.now());
  const runIds = [
    `cu-primitive-textedit-${runNumber}-shared-a`,
    `cu-primitive-textedit-${runNumber}-shared-b`,
  ];
  const artifactBase = TEXTEDIT_LIVE_ARTIFACT_BASE;
  const artifactRoot = join(artifactBase, `shared-input-conflict-${runNumber}`);
  const keepArtifacts = process.env.SCIFORGE_KEEP_COMPUTER_USE_TEXTEDIT_ARTIFACTS === '1';
  await cleanupTextEditLiveArtifacts({
    artifactBase,
    dragSwiftSource: textEditLiveDragSwiftSourcePath(),
    keepArtifacts,
  });
  const initialTextEditState = await readTextEditLiveRunState(runIds[0]);
  if (initialTextEditState.matchingDocuments > 0) {
    await cleanupTextEditLiveRun(runIds[0], initialTextEditState.matchingDocuments === initialTextEditState.allDocuments);
  }
  const cleanTextEditStateBefore = await readTextEditLiveRunState(runIds[0]);
  const stopTextEditAfterCleanup = shouldStopTextEditAfterLiveCleanup(cleanTextEditStateBefore);
  const frontApplicationBefore = await readFrontApplicationName().catch(() => undefined);
  const pointerBefore = await readMousePointer().catch(() => undefined);
  await mkdir(artifactRoot, { recursive: true });

  let releaseFirstAction!: () => void;
  const firstActionReleased = new Promise<void>((resolve) => {
    releaseFirstAction = resolve;
  });
  let markFirstActionStarted!: () => void;
  const firstActionStarted = new Promise<void>((resolve) => {
    markFirstActionStarted = resolve;
  });
  const handlerRunIds: string[] = [];
  const service = createComputerUsePrimitiveService({
    ports: createTextEditSharedSystemInputConflictPorts({
      artifactRoot,
      runIds,
      firstActionStarted: markFirstActionStarted,
      firstActionReleased,
      handlerRunIds,
    }),
  });

  try {
    const first = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'app',
        appId: 'com.apple.TextEdit',
        targetRef: `textedit-live-doc:${runIds[0]}`,
      },
      riskPolicy: 'fail-closed',
    }));
    const second = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'app',
        appId: 'com.apple.TextEdit',
        targetRef: `textedit-live-doc:${runIds[1]}`,
      },
      riskPolicy: 'fail-closed',
    }));
    assert.equal(first.ok, true, first.error);
    assert.equal(second.ok, true, second.error);
    const firstOutput = first.value?.output as { sessionId: string };
    const secondOutput = second.value?.output as { sessionId: string };
    for (const sessionId of [firstOutput.sessionId, secondOutput.sessionId]) {
      const observed = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.observe, {
        schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
        sessionId,
        capture: 'both',
      }));
      assert.equal(observed.ok, true, observed.error);
    }

    const firstAct = service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: firstOutput.sessionId,
      action: {
        type: 'click',
        elementRef: `textedit:document:${runIds[0]}`,
      },
    }));
    await firstActionStarted;

    const secondAct = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: secondOutput.sessionId,
      action: {
        type: 'click',
        elementRef: `textedit:document:${runIds[1]}`,
      },
    }));
    assert.equal(secondAct.ok, false);
    assert.match(secondAct.error ?? '', /shared_system_input_lease_busy/);
    assert.deepEqual(handlerRunIds, [runIds[0]]);

    releaseFirstAction();
    const completedFirst = await firstAct;
    assert.equal(completedFirst.ok, true, completedFirst.error);
    assert.equal(completedFirst.value?.status, 'completed');
    const completedOutput = completedFirst.value?.output as { executorEventRef: string };
    const executorEvent = await readJsonRef<{ sharedSystemInputUsed: boolean; userInputImpact: string }>(
      completedOutput.executorEventRef,
    );
    assert.equal(executorEvent.sharedSystemInputUsed, true);
    assert.match(executorEvent.userInputImpact, /front-app-and-mouse/);
  } finally {
    releaseFirstAction();
    let cleanupError: unknown;
    try {
      for (const runId of runIds) {
        await cleanupTextEditLiveRun(runId, stopTextEditAfterCleanup);
      }
      await assertTextEditLiveRunClean(runIds[0], stopTextEditAfterCleanup);
    } catch (error) {
      cleanupError = error;
    }
    if (!keepArtifacts) {
      await rm(artifactRoot, { recursive: true, force: true });
      await removeDirectoryIfEmpty(artifactBase);
    }
    await assertTextEditLiveArtifactsClean({
      artifactBase,
      dragSwiftSource: textEditLiveDragSwiftSourcePath(),
      keepArtifacts,
    });
    await restoreMousePointer(pointerBefore);
    await restoreFrontApplication(frontApplicationBefore);
    if (cleanupError) throw cleanupError;
  }
});

function createTextEditPrimitivePorts(input: {
  artifactRoot: string;
  runId: string;
  placeholderText: string;
  textRefs: Map<string, string>;
}): ComputerUsePrimitivePorts {
  const sessionId = `cu-session:${input.runId}`;
  let sequence = 0;

  return {
    bind: async () => {
      await openTextEditDocument(input.runId, input.placeholderText);
      const observation = await materializeObservation({
        artifactRoot: input.artifactRoot,
        prefix: 'bind',
        runId: input.runId,
        sessionId,
        sequence: ++sequence,
      });
      return {
        status: 'completed',
        output: {
          sessionId,
          sessionRef: `computer-use:session:${input.runId}`,
          targetRef: `textedit-live-doc:${input.runId}`,
          inputAdapterRef: `input-adapter:textedit-live:${input.runId}`,
          cursorRef: `cursor-marker:textedit-live:${input.runId}`,
          windowActionSessionRef: `window-action-session:${input.runId}`,
          scopedInputLeaseRef: `scoped-input-lease:${input.runId}`,
          observationRef: observation.observationRef,
        },
        refs: [
          `computer-use:session:${input.runId}`,
          `window-action-session:${input.runId}`,
          `input-adapter:textedit-live:${input.runId}`,
          `cursor-marker:textedit-live:${input.runId}`,
          `scoped-input-lease:${input.runId}`,
          observation.observationRef,
          observation.screenshotRef,
          observation.accessibilityRef,
        ],
      };
    },
    observe: async (observeInput: ComputerUseObserveInput) => {
      const observation = await materializeObservation({
        artifactRoot: input.artifactRoot,
        prefix: observeInput.capture === 'both' ? 'both' : 'observe',
        runId: input.runId,
        sessionId: observeInput.sessionId,
        sequence: ++sequence,
      });
      return {
        status: 'completed',
        output: {
          sessionId: observeInput.sessionId,
          observationRef: observation.observationRef,
          screenshotRef: observation.screenshotRef,
          accessibilityRef: observation.accessibilityRef,
          elementRefs: [`textedit:document:${input.runId}`],
          textRefs: [...input.textRefs.keys()],
        },
        refs: [
          observation.observationRef,
          observation.screenshotRef,
          observation.accessibilityRef,
          `textedit:document:${input.runId}`,
          ...input.textRefs.keys(),
        ],
      };
    },
    act: async (actInput: ComputerUseActInput) => {
      const beforeObservation = await materializeObservation({
        artifactRoot: input.artifactRoot,
        prefix: `${actInput.action.type}-before`,
        runId: input.runId,
        sessionId: actInput.sessionId,
        sequence: ++sequence,
      });
      await executeTextEditAction(actInput, input.textRefs);
      const actionSequence = ++sequence;
      const afterObservation = await materializeObservation({
        artifactRoot: input.artifactRoot,
        prefix: `${actInput.action.type}-after`,
        runId: input.runId,
        sessionId: actInput.sessionId,
        sequence: ++sequence,
      });
      const actionRef = `window-action:${input.runId}:${actionSequence}:${actInput.action.type}`;
      const executorEventRef = await writeJsonRef(input.artifactRoot, `${sequence}-${actInput.action.type}-executor-event.json`, {
        schemaVersion: 'sciforge.computer-use.primitive-live-executor-event.v1',
        runId: input.runId,
        sessionId: actInput.sessionId,
        actionType: actInput.action.type,
        actionRef,
        inputAdapterRef: actInput.inputAdapterRef,
        cursorRef: actInput.cursorRef,
        scopedInputLeaseRef: actInput.scopedInputLeaseRef,
        usedTextRef: actInput.action.textRef,
        command: actInput.action.command,
        key: actInput.action.key,
        direction: actInput.action.direction,
        amount: actInput.action.amount,
        durationMs: actInput.action.durationMs,
        point: actInput.action.point,
        toPoint: actInput.action.toPoint,
        sharedSystemInputUsed: true,
        note: 'Live TextEdit acceptance uses TextEdit accessibility actions and System Events against the front TextEdit window.',
      }, 'executor-event');
      return {
        status: 'completed',
        output: {
          sessionId: actInput.sessionId,
          actionRef,
          executorEventRef,
          inputEventRef: `input-event:${input.runId}:${actionSequence}`,
          beforeObservationRef: beforeObservation.observationRef,
          afterObservationRef: afterObservation.observationRef,
          invalidatedRefs: [beforeObservation.observationRef],
        },
        refs: [
          actionRef,
          executorEventRef,
          `input-event:${input.runId}:${actionSequence}`,
          beforeObservation.observationRef,
          beforeObservation.screenshotRef,
          beforeObservation.accessibilityRef,
          afterObservation.observationRef,
          afterObservation.screenshotRef,
          afterObservation.accessibilityRef,
        ],
      };
    },
    control: async (controlInput) => {
      const controlRef = await writeJsonRef(input.artifactRoot, 'control-release.json', {
        schemaVersion: 'sciforge.computer-use.primitive-live-control.v1',
        runId: input.runId,
        sessionId: controlInput.sessionId,
        command: controlInput.command,
        reasonRef: controlInput.reasonRef,
      }, 'control');
      return {
        status: 'completed',
        output: {
          sessionId: controlInput.sessionId,
          controlRef,
          releasedRefs: [`scoped-input-lease:${input.runId}`],
        },
        refs: [controlRef, `scoped-input-lease:${input.runId}`],
      };
    },
  };
}

function createTextEditSessionIsolationPorts(input: {
  artifactRoot: string;
  runIds: string[];
}): ComputerUsePrimitivePorts {
  let sequence = 0;

  return {
    bind: async (bindInput) => {
      const fallbackRunId = input.runIds[Math.min(sequence, input.runIds.length - 1)] ?? `cu-primitive-textedit-${Date.now()}`;
      const runId = runIdFromTargetRef(bindInput.target.targetRef) ?? fallbackRunId;
      const sessionId = `cu-session:${runId}`;
      await openTextEditDocument(runId, `SCIFORGE_CU_LIVE_${runId}_SESSION_ISOLATION\n`);
      const observation = await materializeObservation({
        artifactRoot: input.artifactRoot,
        prefix: `bind-${runId}`,
        runId,
        sessionId,
        sequence: ++sequence,
      });
      return {
        status: 'completed',
        output: {
          sessionId,
          sessionRef: `computer-use:session:${runId}`,
          targetRef: `textedit-live-doc:${runId}`,
          inputAdapterRef: `input-adapter:textedit-live:${runId}`,
          cursorRef: `cursor-marker:textedit-live:${runId}`,
          windowActionSessionRef: `window-action-session:${runId}`,
          scopedInputLeaseRef: `scoped-input-lease:${runId}`,
          observationRef: observation.observationRef,
        },
        refs: [
          `computer-use:session:${runId}`,
          `textedit-live-doc:${runId}`,
          `input-adapter:textedit-live:${runId}`,
          `cursor-marker:textedit-live:${runId}`,
          `window-action-session:${runId}`,
          `scoped-input-lease:${runId}`,
          observation.observationRef,
          observation.screenshotRef,
          observation.accessibilityRef,
        ],
      };
    },
    control: async (controlInput) => {
      const runId = runIdFromSessionId(controlInput.sessionId);
      const controlRef = await writeJsonRef(input.artifactRoot, `${++sequence}-control-${runId}.json`, {
        schemaVersion: 'sciforge.computer-use.primitive-live-control.v1',
        runId,
        sessionId: controlInput.sessionId,
        command: controlInput.command,
        reasonRef: controlInput.reasonRef,
        inputAdapterRef: controlInput.inputAdapterRef,
        cursorRef: controlInput.cursorRef,
        scopedInputLeaseRef: controlInput.scopedInputLeaseRef,
      }, 'control');
      return {
        status: 'completed',
        output: {
          sessionId: controlInput.sessionId,
          controlRef,
          releasedRefs: [
            controlInput.scopedInputLeaseRef ?? '',
            controlInput.inputAdapterRef ?? '',
            controlInput.cursorRef ?? '',
          ],
        },
        refs: [
          controlRef,
          controlInput.scopedInputLeaseRef ?? '',
          controlInput.inputAdapterRef ?? '',
          controlInput.cursorRef ?? '',
        ],
      };
    },
  };
}

function createTextEditSharedSystemInputConflictPorts(input: {
  artifactRoot: string;
  runIds: string[];
  firstActionStarted: () => void;
  firstActionReleased: Promise<void>;
  handlerRunIds: string[];
}): ComputerUsePrimitivePorts {
  let sequence = 0;
  let activeSharedInputLeaseRef: string | undefined;

  return {
    bind: async (bindInput) => {
      const fallbackRunId = input.runIds[Math.min(sequence, input.runIds.length - 1)] ?? `cu-primitive-textedit-${Date.now()}`;
      const runId = runIdFromTargetRef(bindInput.target.targetRef) ?? fallbackRunId;
      const sessionId = `cu-session:${runId}`;
      await openTextEditDocument(runId, `SCIFORGE_CU_LIVE_${runId}_SHARED_INPUT\n`);
      const observation = await materializeObservation({
        artifactRoot: input.artifactRoot,
        prefix: `bind-${runId}`,
        runId,
        sessionId,
        sequence: ++sequence,
      });
      return {
        status: 'completed',
        output: {
          sessionId,
          sessionRef: `computer-use:session:${runId}`,
          targetRef: `textedit-live-doc:${runId}`,
          inputAdapterRef: `input-adapter:textedit-live-shared-system:${runId}`,
          cursorRef: `cursor-marker:textedit-live-shared-system:${runId}`,
          windowActionSessionRef: `window-action-session:${runId}`,
          scopedInputLeaseRef: `scoped-input-lease:${runId}`,
          observationRef: observation.observationRef,
        },
        refs: [
          `computer-use:session:${runId}`,
          `textedit-live-doc:${runId}`,
          `input-adapter:textedit-live-shared-system:${runId}`,
          `cursor-marker:textedit-live-shared-system:${runId}`,
          `window-action-session:${runId}`,
          `scoped-input-lease:${runId}`,
          observation.observationRef,
          observation.screenshotRef,
          observation.accessibilityRef,
        ],
      };
    },
    observe: async (observeInput) => {
      const runId = runIdFromSessionId(observeInput.sessionId);
      const observation = await materializeObservation({
        artifactRoot: input.artifactRoot,
        prefix: `shared-observe-${runId}`,
        runId,
        sessionId: observeInput.sessionId,
        sequence: ++sequence,
      });
      return {
        status: 'completed',
        output: {
          sessionId: observeInput.sessionId,
          observationRef: observation.observationRef,
          screenshotRef: observation.screenshotRef,
          accessibilityRef: observation.accessibilityRef,
          elementRefs: [`textedit:document:${runId}`],
          textRefs: [`text:shared-input:${runId}`],
        },
        refs: [
          observation.observationRef,
          observation.screenshotRef,
          observation.accessibilityRef,
          `textedit:document:${runId}`,
          `text:shared-input:${runId}`,
        ],
      };
    },
    act: async (actInput) => {
      const runId = runIdFromSessionId(actInput.sessionId);
      if (activeSharedInputLeaseRef) {
        return {
          status: 'blocked',
          blockedReason: 'shared_system_input_lease_busy',
          refs: [
            'shared-system-input:global/focus-input-lease',
            activeSharedInputLeaseRef,
            `input-adapter:textedit-live-shared-system:${runId}`,
          ],
        };
      }

      const sharedInputLeaseRef = `shared-system-input-lease:textedit-live/${runId}`;
      activeSharedInputLeaseRef = sharedInputLeaseRef;
      input.handlerRunIds.push(runId);
      input.firstActionStarted();
      try {
        const beforeObservation = await materializeObservation({
          artifactRoot: input.artifactRoot,
          prefix: `shared-${runId}-before`,
          runId,
          sessionId: actInput.sessionId,
          sequence: ++sequence,
        });
        await executeTextEditAction(actInput, new Map());
        await input.firstActionReleased;
        const afterObservation = await materializeObservation({
          artifactRoot: input.artifactRoot,
          prefix: `shared-${runId}-after`,
          runId,
          sessionId: actInput.sessionId,
          sequence: ++sequence,
        });
        const actionSequence = ++sequence;
        const actionRef = `window-action:${runId}:${actionSequence}:${actInput.action.type}`;
        const executorEventRef = await writeJsonRef(input.artifactRoot, `${actionSequence}-shared-input-executor-event.json`, {
          schemaVersion: 'sciforge.computer-use.primitive-live-shared-input-executor-event.v1',
          runId,
          sessionId: actInput.sessionId,
          actionType: actInput.action.type,
          actionRef,
          inputAdapterRef: actInput.inputAdapterRef,
          cursorRef: actInput.cursorRef,
          scopedInputLeaseRef: actInput.scopedInputLeaseRef,
          sharedInputLeaseRef,
          sharedSystemInputUsed: true,
          userInputImpact: 'front-app-and-mouse-may-be-briefly-taken-over',
        }, 'executor-event');
        return {
          status: 'completed',
          output: {
            sessionId: actInput.sessionId,
            actionRef,
            executorEventRef,
            inputEventRef: `input-event:${runId}:${actionSequence}`,
            beforeObservationRef: beforeObservation.observationRef,
            afterObservationRef: afterObservation.observationRef,
            invalidatedRefs: [beforeObservation.observationRef],
          },
          refs: [
            actionRef,
            executorEventRef,
            `input-event:${runId}:${actionSequence}`,
            sharedInputLeaseRef,
            beforeObservation.observationRef,
            beforeObservation.screenshotRef,
            beforeObservation.accessibilityRef,
            afterObservation.observationRef,
            afterObservation.screenshotRef,
            afterObservation.accessibilityRef,
          ],
        };
      } finally {
        if (activeSharedInputLeaseRef === sharedInputLeaseRef) {
          activeSharedInputLeaseRef = undefined;
        }
      }
    },
    control: async (controlInput) => {
      const runId = runIdFromSessionId(controlInput.sessionId);
      const controlRef = await writeJsonRef(input.artifactRoot, `${++sequence}-shared-control-${runId}.json`, {
        schemaVersion: 'sciforge.computer-use.primitive-live-control.v1',
        runId,
        sessionId: controlInput.sessionId,
        command: controlInput.command,
        reasonRef: controlInput.reasonRef,
      }, 'control');
      return {
        status: 'completed',
        output: {
          sessionId: controlInput.sessionId,
          controlRef,
          releasedRefs: [
            controlInput.scopedInputLeaseRef ?? '',
            controlInput.inputAdapterRef ?? '',
            controlInput.cursorRef ?? '',
          ],
        },
        refs: [
          controlRef,
          controlInput.scopedInputLeaseRef ?? '',
          controlInput.inputAdapterRef ?? '',
          controlInput.cursorRef ?? '',
        ],
      };
    },
  };
}

async function openTextEditDocument(runId: string, initialText: string) {
  await runAppleScript(`
on run argv
  set initialText to item 2 of argv
  tell application "TextEdit"
    activate
    make new document with properties {text:initialText}
  end tell
  delay 0.5
  tell application "System Events"
    tell process "TextEdit"
      set frontmost to true
      if (count of windows) > 0 then
        perform action "AXRaise" of front window
        if exists text area 1 of scroll area 1 of front window then
          set focused of text area 1 of scroll area 1 of front window to true
        end if
      end if
    end tell
  end tell
end run
`, [runId, initialText]);
}

async function executeTextEditAction(input: ComputerUseActInput, textRefs: Map<string, string>) {
  const action = input.action;
  if (action.type === 'click') {
    await runSystemEvents('click text area 1 of scroll area 1 of front window');
    return;
  }

  if (action.type === 'double_click') {
    await runSystemEvents(`
click text area 1 of scroll area 1 of front window
delay 0.05
click text area 1 of scroll area 1 of front window
`);
    return;
  }

  if (action.type === 'type') {
    const text = action.textRef ? textRefs.get(action.textRef) : undefined;
    assert.ok(text, `missing live acceptance textRef ${action.textRef}`);
    await runAppleScript(`
on run argv
  set typedText to item 1 of argv
  tell application "TextEdit" to activate
  delay 0.15
  tell application "System Events"
    tell process "TextEdit"
      set frontmost to true
      set value of text area 1 of scroll area 1 of front window to typedText
    end tell
  end tell
end run
`, [text]);
    return;
  }

  if (action.type === 'key' && action.key === 'Return') {
    await runSystemEvents('key code 36');
    return;
  }

  if (action.type === 'key' && action.key === 'ArrowRight') {
    await runSystemEvents('key code 124');
    return;
  }

  if (action.type === 'app_command' && action.command === 'select_all') {
    await runSystemEvents('keystroke "a" using command down');
    return;
  }

  if (action.type === 'app_command' && action.command === 'delete') {
    await runSystemEvents('key code 51');
    return;
  }

  if (action.type === 'app_command' && action.command === 'save') {
    await runSystemEvents('keystroke "s" using command down');
    await delay(700);
    return;
  }

  if (action.type === 'scroll') {
    const pages = Math.max(1, Math.round(action.amount ?? 1));
    const scrollAction = action.direction === 'up' ? 'AXScrollUp' : 'AXScrollDown';
    await runAppleScript(`
on run argv
  set scrollAction to item 1 of argv
  set pages to item 2 of argv as integer
  tell application "TextEdit" to activate
  delay 0.15
  tell application "System Events"
    tell process "TextEdit"
      set frontmost to true
      repeat pages times
        try
          perform action scrollAction of scroll area 1 of front window
        on error
          if scrollAction is "AXScrollUp" then
            key code 116
          else
            key code 121
          end if
        end try
      end repeat
    end tell
  end tell
end run
`, [scrollAction, String(pages)]);
    return;
  }

  if (action.type === 'drag') {
    assert.ok(action.point, 'drag requires start point');
    assert.ok(action.toPoint, 'drag requires end point');
    const [from, to] = await Promise.all([
      resolveTextEditPoint(action.point),
      resolveTextEditPoint(action.toPoint),
    ]);
    await dragMouse(from, to);
    return;
  }

  if (action.type === 'wait') {
    await delay(action.durationMs ?? 500);
    return;
  }

  throw new Error(`unsupported TextEdit live action: ${action.type}:${action.command ?? action.key ?? ''}`);
}

async function resolveTextEditPoint(point: { x: number; y: number; coordinateSpace: string }) {
  const stdout = await runAppleScript(`
on run argv
  set localX to item 1 of argv as number
  set localY to item 2 of argv as number
  set coordinateSpace to item 3 of argv as text
  tell application "TextEdit" to activate
  delay 0.1
  tell application "System Events"
    tell process "TextEdit"
      set frontmost to true
      if coordinateSpace is "screen" then
        set originX to 0
        set originY to 0
      else if coordinateSpace is "window" then
        set windowPosition to position of front window
        set originX to item 1 of windowPosition
        set originY to item 2 of windowPosition
      else
        set elementPosition to position of text area 1 of scroll area 1 of front window
        set originX to item 1 of elementPosition
        set originY to item 2 of elementPosition
      end if
    end tell
  end tell
  return ((originX + localX) as integer) & "," & ((originY + localY) as integer)
end run
`, [String(point.x), String(point.y), point.coordinateSpace]);
  const [xText, yText] = stdout.split(',');
  const x = Number(xText);
  const y = Number(yText);
  assert.equal(Number.isFinite(x), true, `invalid resolved x coordinate: ${stdout}`);
  assert.equal(Number.isFinite(y), true, `invalid resolved y coordinate: ${stdout}`);
  return { x, y };
}

async function dragMouse(from: { x: number; y: number }, to: { x: number; y: number }) {
  const swiftSource = textEditLiveDragSwiftSourcePath();
  await writeFile(swiftSource, `
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count == 5,
      let fromX = Double(args[1]),
      let fromY = Double(args[2]),
      let toX = Double(args[3]),
      let toY = Double(args[4]) else {
  exit(2)
}

let source = CGEventSource(stateID: .hidSystemState)

func post(_ type: CGEventType, _ point: CGPoint) {
  guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
    exit(3)
  }
  event.post(tap: .cghidEventTap)
}

let start = CGPoint(x: fromX, y: fromY)
let end = CGPoint(x: toX, y: toY)
post(.mouseMoved, start)
usleep(80_000)
post(.leftMouseDown, start)
for step in 1...8 {
  let ratio = Double(step) / 8.0
  let point = CGPoint(x: fromX + (toX - fromX) * ratio, y: fromY + (toY - fromY) * ratio)
  post(.leftMouseDragged, point)
  usleep(25_000)
}
post(.leftMouseUp, end)
usleep(80_000)
`, 'utf8');
  try {
    await execFileAsync('/usr/bin/swift', [
      swiftSource,
      String(from.x),
      String(from.y),
      String(to.x),
      String(to.y),
    ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  } finally {
    await rm(swiftSource, { force: true });
  }
}

async function cleanupTextEditLiveRun(runId: string, quitWhenEmpty: boolean) {
  await runAppleScript(`
on run argv
  set runMarker to item 1 of argv
  set quitWhenEmpty to item 2 of argv is "true"
  set hadMatchingDocument to false
  if application "TextEdit" is running then
    tell application "TextEdit"
      repeat with i from (count of documents) to 1 by -1
        try
          set d to document i
          set docName to name of d as text
          set docText to text of d as text
          if my isLiveTestDocument(docName, docText, runMarker) then
            set hadMatchingDocument to true
            close d saving no
          end if
        end try
      end repeat
    end tell
    delay 0.5
    tell application "System Events"
      if exists process "TextEdit" then
        tell process "TextEdit"
          repeat with w in (windows as list)
            try
              set windowName to name of w as text
              if (windowName contains runMarker or hadMatchingDocument) and exists sheet 1 of w then
                tell sheet 1 of w
                  if exists button "不存储" then
                    click button "不存储"
                  else if exists button "Don't Save" then
                    click button "Don't Save"
                  else if exists button "删除" then
                    click button "删除"
                  else if exists button "Delete" then
                    click button "Delete"
                  else if exists button "取消" then
                    click button "取消"
                  else if exists button "Cancel" then
                    click button "Cancel"
                  end if
                end tell
              end if
            end try
          end repeat
        end tell
      end if
    end tell
    delay 0.5
    tell application "TextEdit"
      repeat with i from (count of documents) to 1 by -1
        try
          set d to document i
          set docName to name of d as text
          set docText to text of d as text
          if my isLiveTestDocument(docName, docText, runMarker) then
            close d saving no
          end if
        end try
      end repeat
      if quitWhenEmpty and (count of documents) is 0 then quit saving no
    end tell
  end if
end run

on isLiveTestDocument(docName, docText, runMarker)
  return docName contains runMarker or docText contains runMarker or docName contains "cu-primitive-textedit-" or docText contains "cu-primitive-textedit-" or docText contains "SCIFORGE_CU_LIVE_"
end isLiveTestDocument
`, [runId, String(quitWhenEmpty)]);
  await delay(500);
  await stopTextEditIfOnlyLiveDocuments(runId);
}

async function assertTextEditLiveRunClean(runId: string, shouldBeStopped: boolean) {
  await stopTextEditIfOnlyLiveDocuments(runId);
  let state = await readTextEditLiveRunState(runId);
  if (shouldForceStopTextEditAfterLiveCleanup({ shouldBeStopped, ...state })) {
    await forceStopTextEditProcess();
    state = await readTextEditLiveRunState(runId);
  }
  assert.equal(state.matchingDocuments, 0, `TextEdit still has ${state.matchingDocuments} live test document(s) for ${runId}`);
  if (shouldBeStopped) {
    assert.equal(state.running, false, `TextEdit is still running with ${state.allDocuments} document(s) after live cleanup for ${runId}`);
    assert.equal(await isTextEditProcessRunning(), false, `TextEdit process is still running after live cleanup for ${runId}`);
  }
}

async function forceStopTextEditProcess() {
  await runAppleScript('tell application "TextEdit" to quit saving no').catch(() => undefined);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await delay(250);
    if (!await isTextEditProcessRunning()) return;
    await execFileAsync('pkill', ['-TERM', '-x', 'TextEdit'], { timeout: 5_000 }).catch(() => undefined);
  }
  await execFileAsync('pkill', ['-9', '-x', 'TextEdit'], { timeout: 5_000 }).catch(() => undefined);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await delay(250);
    if (!await isTextEditProcessRunning()) return;
  }
}

async function stopTextEditIfOnlyLiveDocuments(runId: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const state = await readTextEditLiveRunState(runId);
    const processRunning = await isTextEditProcessRunning();
    if (!state.running && !processRunning) return;
    const onlyLiveDocumentsRemain = state.allDocuments === 0 || state.liveTestDocuments === state.allDocuments;
    if (!onlyLiveDocumentsRemain) return;

    await forceStopTextEditProcess();
  }
}

async function readTextEditLiveRunState(runId: string) {
  if (!await isTextEditProcessRunning()) {
    return {
      running: false,
      matchingDocuments: 0,
      liveTestDocuments: 0,
      allDocuments: 0,
    };
  }
  const stdout = await runAppleScript(`
	on run argv
	  set runMarker to item 1 of argv
	  set matchingLiveTestDocuments to 0
	  set allLiveTestDocuments to 0
	  set allDocuments to 0
	  set runningFlag to "false"
	  if application "TextEdit" is running then
    set runningFlag to "true"
    tell application "TextEdit"
      set allDocuments to count of documents
      repeat with d in (documents as list)
        try
	          set docName to name of d as text
	          set docText to text of d as text
	          if my isCurrentRunDocument(docName, docText, runMarker) then
	            set matchingLiveTestDocuments to matchingLiveTestDocuments + 1
	          end if
	          if my isAnyLiveTestDocument(docName, docText, runMarker) then
	            set allLiveTestDocuments to allLiveTestDocuments + 1
	          end if
	        end try
	      end repeat
	    end tell
	  end if
	  return runningFlag & "," & (matchingLiveTestDocuments as text) & "," & (allLiveTestDocuments as text) & "," & (allDocuments as text)
	end run

	on isCurrentRunDocument(docName, docText, runMarker)
	  return docName contains runMarker or docText contains runMarker
	end isCurrentRunDocument

	on isAnyLiveTestDocument(docName, docText, runMarker)
	  return my isCurrentRunDocument(docName, docText, runMarker) or docName contains "cu-primitive-textedit-" or docText contains "cu-primitive-textedit-" or docText contains "SCIFORGE_CU_LIVE_"
	end isAnyLiveTestDocument
	`, [runId]);
  const [runningText, matchingText, liveTestText, allText] = stdout.split(',');
  const matchingDocuments = Number(matchingText);
  const liveTestDocuments = Number(liveTestText);
  const allDocuments = Number(allText);
  assert.equal(Number.isFinite(matchingDocuments), true, `invalid TextEdit matching document count: ${stdout}`);
  assert.equal(Number.isFinite(liveTestDocuments), true, `invalid TextEdit live test document count: ${stdout}`);
  assert.equal(Number.isFinite(allDocuments), true, `invalid TextEdit all document count: ${stdout}`);
  return {
    running: runningText === 'true',
    matchingDocuments,
    liveTestDocuments,
    allDocuments,
  };
}

function shouldStopTextEditAfterLiveCleanup(state: {
  running: boolean;
  matchingDocuments: number;
  liveTestDocuments?: number;
  allDocuments: number;
}) {
  const liveTestDocuments = state.liveTestDocuments ?? state.matchingDocuments;
  return !state.running || state.allDocuments === 0 || liveTestDocuments === state.allDocuments;
}

function shouldForceStopTextEditAfterLiveCleanup(state: {
  shouldBeStopped: boolean;
  running: boolean;
  matchingDocuments: number;
  liveTestDocuments: number;
  allDocuments: number;
}) {
  if (!state.running) return false;
  if (state.liveTestDocuments === state.allDocuments && state.allDocuments > 0) return true;
  return state.shouldBeStopped;
}

async function isTextEditRunning() {
  const stdout = await runAppleScript('return application "TextEdit" is running');
  return stdout === 'true';
}

async function isTextEditProcessRunning() {
  try {
    await execFileAsync('pgrep', ['-x', 'TextEdit'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function materializeObservation(input: {
  artifactRoot: string;
  prefix: string;
  runId: string;
  sessionId: string;
  sequence: number;
}) {
  const label = `${String(input.sequence).padStart(2, '0')}-${input.prefix}`;
  const app = await readTextEditState();
  const accessibilityRef = await writeJsonRef(input.artifactRoot, `${label}-accessibility.json`, {
    schemaVersion: 'sciforge.computer-use.primitive-live-accessibility-summary.v1',
    runId: input.runId,
    sessionId: input.sessionId,
    appName: 'TextEdit',
    windowTitle: app.windowTitle,
    documentName: app.documentName,
    contentSha256: sha256(app.documentText),
    contentPreview: app.documentText.slice(0, 120),
  }, 'accessibility');
  const observationRef = await writeJsonRef(input.artifactRoot, `${label}-observation.json`, {
    schemaVersion: 'sciforge.computer-use.primitive-live-observation.v1',
    runId: input.runId,
    sessionId: input.sessionId,
    observationSequence: input.sequence,
    accessibilityRef,
    windowTitle: app.windowTitle,
    documentName: app.documentName,
    contentSha256: sha256(app.documentText),
    contentLength: app.documentText.length,
  }, 'observation');
  const screenshotPath = join(input.artifactRoot, `${label}-screenshot.png`);
  await execFileAsync('screencapture', ['-x', screenshotPath], { timeout: 15_000 });
  const screenshotRef = refFor(input.artifactRoot, screenshotPath, 'image');

  return {
    observationRef,
    screenshotRef,
    accessibilityRef,
  };
}

async function readTextEditState() {
  const stdout = await runAppleScript(`
tell application "TextEdit"
  if (count of documents) is 0 then
    set docName to ""
    set docText to ""
  else
    set docName to name of front document
    set docText to text of front document
  end if
end tell
tell application "System Events"
  tell process "TextEdit"
    if (count of windows) is 0 then
      set windowName to ""
    else
      set windowName to name of front window
    end if
  end tell
end tell
return docName & linefeed & "SCIFORGE_STATE_SEPARATOR" & linefeed & windowName & linefeed & "SCIFORGE_STATE_SEPARATOR" & linefeed & docText
`);
  const [documentName = '', windowTitle = '', documentText = ''] = stdout.split(/\r?\nSCIFORGE_STATE_SEPARATOR\r?\n/);
  return {
    documentName: documentName.trim(),
    windowTitle: windowTitle.trim(),
    documentText,
  };
}

async function runSystemEvents(command: string) {
  await runAppleScript(`
tell application "TextEdit" to activate
delay 0.15
tell application "System Events"
  tell process "TextEdit"
    set frontmost to true
    ${command}
  end tell
end tell
`);
}

async function runAppleScript(script: string, args: string[] = []) {
  const result = await execFileAsync('osascript', ['-e', script, ...args], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trimEnd();
}

async function readFrontApplicationName() {
  const name = await runAppleScript('tell application "System Events" to return name of first application process whose frontmost is true');
  return name.trim() || undefined;
}

async function restoreFrontApplication(name: string | undefined) {
  if (!name || name === 'TextEdit') return;
  await runAppleScript(`
on run argv
  set appName to item 1 of argv
  try
    tell application appName to activate
  end try
end run
`, [name]).catch(() => undefined);
}

async function readMousePointer() {
  const stdout = await runTransientSwift('computer-use-textedit-pointer-read.swift', `
import CoreGraphics

guard let event = CGEvent(source: nil) else {
  exit(2)
}
let point = event.location
print("\\(point.x),\\(point.y)")
`, []);
  const [xText, yText] = stdout.trim().split(',');
  const x = Number(xText);
  const y = Number(yText);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

async function restoreMousePointer(point: { x: number; y: number } | undefined) {
  if (!point) return;
  await runTransientSwift('computer-use-textedit-pointer-restore.swift', `
import CoreGraphics

let args = CommandLine.arguments
guard args.count == 3,
      let x = Double(args[1]),
      let y = Double(args[2]) else {
  exit(2)
}
let point = CGPoint(x: x, y: y)
guard let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) else {
  exit(3)
}
event.post(tap: .cghidEventTap)
`, [String(point.x), String(point.y)]).catch(() => undefined);
}

async function runTransientSwift(filename: string, source: string, args: string[]) {
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-cu-textedit-swift-'));
  const sourcePath = join(dir, filename);
  await writeFile(sourcePath, source, 'utf8');
  try {
    const result = await execFileAsync('/usr/bin/swift', [sourcePath, ...args], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeJsonRef(root: string, filename: string, payload: unknown, kind: string) {
  const path = join(root, filename);
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return refFor(root, path, kind);
}

function refFor(root: string, path: string, kind: string) {
  return `${kind}:${relative(process.cwd(), path).replaceAll('\\', '/')}`;
}

async function readJsonRef<T>(ref: string): Promise<T> {
  const separator = ref.indexOf(':');
  assert.ok(separator > 0, `invalid ref ${ref}`);
  const refPath = ref.slice(separator + 1);
  return JSON.parse(await readFile(join(process.cwd(), refPath), 'utf8')) as T;
}

function requiredRef(refs: string[] | undefined, prefix: string) {
  const ref = refs?.find((candidate) => candidate.startsWith(prefix));
  assert.ok(ref, `missing ${prefix} ref`);
  return ref;
}

function runIdFromTargetRef(targetRef: string | undefined) {
  const prefix = 'textedit-live-doc:';
  if (!targetRef?.startsWith(prefix)) return undefined;
  const runId = targetRef.slice(prefix.length);
  return runId.trim() ? runId : undefined;
}

function runIdFromSessionId(sessionId: string) {
  const prefix = 'cu-session:';
  return sessionId.startsWith(prefix) ? sessionId.slice(prefix.length) : sessionId;
}

function request(intent: string, input: Record<string, unknown>): ModuleInvokeRequest {
  return {
    moduleId: COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
    intent,
    input,
  };
}

function sha256(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

async function removeDirectoryIfEmpty(path: string) {
  try {
    await rmdir(path);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: string }).code
      : undefined;
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY') {
      throw error;
    }
  }
}

async function cleanupTextEditLiveArtifacts(input: {
  artifactBase: string;
  dragSwiftSource: string;
  keepArtifacts: boolean;
}) {
  if (!input.keepArtifacts) {
    await rm(input.artifactBase, { recursive: true, force: true });
  }
  await rm(input.dragSwiftSource, { force: true });
}

async function assertTextEditLiveArtifactsClean(input: {
  artifactBase: string;
  dragSwiftSource: string;
  keepArtifacts: boolean;
}) {
  assert.equal(await pathExists(input.dragSwiftSource), false, `stale live drag Swift source remains at ${input.dragSwiftSource}`);
  if (!input.keepArtifacts) {
    assert.equal(await pathExists(input.artifactBase), false, `live acceptance artifact directory remains at ${input.artifactBase}`);
  }
}

function textEditLiveDragSwiftSourcePath() {
  return join(process.cwd(), 'docs', 'test-artifacts', 'computer-use-primitive-textedit-live-drag.swift');
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
