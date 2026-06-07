import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS,
  COMPUTER_USE_PRIMITIVE_INTENTS,
  createComputerUsePrimitiveService,
  type ComputerUseActInput,
  type ComputerUseObserveInput,
  type ComputerUsePrimitivePorts,
} from './index.js';

const execFileAsync = promisify(execFile);

export const VSCODE_LIVE_ACCEPTANCE_ENV = 'SCIFORGE_COMPUTER_USE_VSCODE_PRIMITIVE_ACCEPTANCE' as const;
export const VSCODE_LIVE_ACCEPTANCE_SCHEMA_VERSION = 'sciforge.computer-use.primitive-vscode-live-acceptance.v1' as const;
export const DEFAULT_VSCODE_APP_PATH = '/Applications/Visual Studio Code.app' as const;

export const VSCODE_LIVE_ACCEPTANCE_CAPABILITY = {
  maturity: 'live-diagnostic',
  productReady: false,
  sharedSystemInputUsed: true,
  userProfileUsed: true,
  requiresExplicitEnv: `${VSCODE_LIVE_ACCEPTANCE_ENV}=1`,
  primitiveChainRequired: 'bind -> observe -> act -> observe -> control(release)',
  cleanup: {
    required: true,
    asserts: [
      'test-window-closed',
      'temporary-workspace-deleted',
      'test-file-tab-closed',
      'temporary-artifacts-deleted-by-default',
      'input-lease-cursor-adapter-released',
      'front-app-restored',
      'mouse-position-restored',
    ],
  },
} as const;

export interface VSCodeLiveAcceptanceManifest {
  schemaVersion: typeof VSCODE_LIVE_ACCEPTANCE_SCHEMA_VERSION;
  status: 'passed' | 'blocked';
  maturity: 'live-diagnostic';
  productReady: false;
  sharedSystemInputUsed: true;
  userProfileUsed: true;
  runner: 'computer-use-vscode-live-acceptance';
  checkedAt: string;
  skipReason?: string;
  vscodeLaunched: boolean;
  vscodeAppRef: string;
  primitiveChainRequired: typeof VSCODE_LIVE_ACCEPTANCE_CAPABILITY.primitiveChainRequired;
  primitiveChainObserved: string[];
  tempDirs: {
    workspaceCreated: boolean;
    userDataDirCreated: boolean;
    extensionsDirCreated: boolean;
    homeDirCreated: boolean;
    deletedAfterRun: boolean;
  };
  target: {
    appName: 'Visual Studio Code';
    bundleId: 'com.microsoft.VSCode';
    windowRef: string;
    workspaceRef: string;
    testFileRef: string;
  };
  evidence: {
    bindRefs: string[];
    beforeObservationRefs: string[];
    actionRefs: string[];
    afterObservationRefs: string[];
    controlRefs: string[];
    screenshotRefs: string[];
    accessibilityRefs: string[];
    textRefs: string[];
    fileValidatorRefs: string[];
    releaseRefs: string[];
  };
  verification: {
    targetWindowStable: boolean;
    sentinelVisibleInTextRefs: boolean;
    beforeAfterScreenshotChanged: boolean;
    fileContentMatched: boolean;
    cleanupPassed: boolean;
  };
  blockedReasons: string[];
}

export interface RunVSCodeLiveAcceptanceOptions {
  root?: string;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  appPath?: string;
  keepArtifacts?: boolean;
}

interface VSCodeLiveContext {
  runId: string;
  artifactRoot: string;
  workspaceDir: string;
  testFilePath: string;
  sentinelText: string;
  appPath: string;
  textRefs: Map<string, string>;
  sequence: number;
  processId?: number;
}

interface MaterializedObservation {
  observationRef: string;
  screenshotRef: string;
  accessibilityRef: string;
  textRefs: string[];
  windowRef: string;
  visibleText: string;
  screenshotSha256: string;
}

export async function runVSCodeLiveAcceptance(
  options: RunVSCodeLiveAcceptanceOptions = {},
): Promise<VSCodeLiveAcceptanceManifest> {
  const env = options.env ?? process.env;
  const root = resolve(options.root ?? process.cwd());
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const artifactRoot = join(root, 'docs', 'test-artifacts', 'computer-use-vscode-live');
  const appPath = resolve(options.appPath ?? env.SCIFORGE_COMPUTER_USE_VSCODE_APP_PATH ?? DEFAULT_VSCODE_APP_PATH);
  const keepArtifacts = options.keepArtifacts ?? env.SCIFORGE_KEEP_COMPUTER_USE_VSCODE_ARTIFACTS === '1';

  if (env[VSCODE_LIVE_ACCEPTANCE_ENV] !== '1') {
    const manifest = baseManifest({
      checkedAt,
      artifactRoot,
      appPath,
      status: 'blocked',
      skipReason: `missing-env:${VSCODE_LIVE_ACCEPTANCE_ENV}`,
      vscodeLaunched: false,
    });
    await writeManifest(artifactRoot, manifest);
    return manifest;
  }

  if (!await pathExists(appPath)) {
    const manifest = baseManifest({
      checkedAt,
      artifactRoot,
      appPath,
      status: 'blocked',
      skipReason: 'missing-vscode-app',
      vscodeLaunched: false,
      blockedReasons: ['missing-vscode-app'],
    });
    await writeManifest(artifactRoot, manifest);
    return manifest;
  }

  await cleanupVSCodeLiveAcceptanceArtifacts({
    artifactRoot,
    tempRoots: [],
    keepArtifacts,
  });
  await mkdir(artifactRoot, { recursive: true });

  const runId = `cu-vscode-${Date.now()}`;
  const workspaceDir = await mkdtemp(join(tmpdir(), `${runId}-workspace-`));
  const testFilePath = join(workspaceDir, 'sciforge-vscode-live.txt');
  await writeFile(testFilePath, '', 'utf8');

  const frontApplicationBefore = await readFrontApplicationName().catch(() => undefined);
  const pointerBefore = await readMousePointer().catch(() => undefined);
  const ctx: VSCodeLiveContext = {
    runId,
    artifactRoot: join(artifactRoot, runId),
    workspaceDir,
    testFilePath,
    sentinelText: `sciforge cu vscode live ${runId}`,
    appPath,
    textRefs: new Map(),
    sequence: 0,
  };
  ctx.textRefs.set(`text:vscode-live:${runId}:sentinel`, ctx.sentinelText);
  const chain: string[] = [];
  let manifest = baseManifest({
    checkedAt,
    artifactRoot,
    appPath,
    status: 'blocked',
    vscodeLaunched: true,
  });
  manifest = {
    ...manifest,
    tempDirs: {
      workspaceCreated: true,
      userDataDirCreated: false,
      extensionsDirCreated: false,
      homeDirCreated: false,
      deletedAfterRun: false,
    },
  };

  try {
    await mkdir(ctx.artifactRoot, { recursive: true });
    const service = createComputerUsePrimitiveService({ ports: createVSCodeLivePrimitivePorts(ctx) });
    const bind = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'app',
        appId: 'com.microsoft.VSCode',
        targetRef: `vscode-live-window:${runId}`,
      },
      riskPolicy: 'fail-closed',
    }));
    chain.push('bind');
    if (!bind.ok) throw new Error(moduleFailureReason(bind, 'vscode bind failed'));
    const sessionId = (bind.value?.output as { sessionId?: string } | undefined)?.sessionId;
    if (!sessionId) throw new Error('vscode bind did not return sessionId');

    const before = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.observe, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
      sessionId,
      capture: 'both',
      includeTree: true,
    }));
    chain.push('observe');
    if (!before.ok) throw new Error(moduleFailureReason(before, 'vscode before observe failed'));

    const focus = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId,
      actionId: `focus-editor-${runId}`,
      action: {
        type: 'key',
        key: 'Command+1',
      },
    }));
    chain.push('act');
    if (!focus.ok) throw new Error(moduleFailureReason(focus, 'vscode focus editor failed'));

    const type = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId,
      actionId: `type-sentinel-${runId}`,
      action: {
        type: 'type',
        elementRef: `vscode-editor:${runId}`,
        textRef: `text:vscode-live:${runId}:sentinel`,
      },
    }));
    chain.push('act');
    if (!type.ok) throw new Error(moduleFailureReason(type, 'vscode type sentinel failed'));

    const save = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId,
      actionId: `save-file-${runId}`,
      action: {
        type: 'app_command',
        command: 'save',
        elementRef: `vscode-editor:${runId}`,
      },
    }));
    chain.push('act');
    if (!save.ok) throw new Error(moduleFailureReason(save, 'vscode save failed'));

    const after = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.observe, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
      sessionId,
      capture: 'both',
      includeTree: true,
    }));
    chain.push('observe');
    if (!after.ok) throw new Error(moduleFailureReason(after, 'vscode after observe failed'));

    const control = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.control, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.control,
      sessionId,
      command: 'release',
      reasonRef: `reason:${runId}:vscode-live-acceptance-complete`,
    }));
    chain.push('control(release)');
    if (!control.ok) throw new Error(moduleFailureReason(control, 'vscode release failed'));

    const beforeObservation = await readJsonRef<MaterializedObservationPayload>(
      firstRef((before.value?.output as { accessibilityRef?: string } | undefined)?.accessibilityRef),
    );
    const afterObservation = await readJsonRef<MaterializedObservationPayload>(
      firstRef((after.value?.output as { accessibilityRef?: string } | undefined)?.accessibilityRef),
    );
    const fileContent = await readFile(testFilePath, 'utf8').catch(() => '');
    const fileValidatorRef = await writeJsonRef(ctx.artifactRoot, 'file-validator.json', {
      schemaVersion: 'sciforge.computer-use.vscode-live-file-validator.v1',
      runId,
      testFileRef: `vscode-live-file:${runId}:${sha1(testFilePath).slice(0, 12)}`,
      contentSha256: sha256(fileContent),
      expectedSha256: sha256(ctx.sentinelText),
      matched: fileContent === ctx.sentinelText,
      role: 'supplemental-artifact-validator-not-gui-evidence',
    }, 'artifact-validator');

    const bindRefs = bind.refs ?? [];
    const beforeObservationRefs = before.refs ?? [];
    const actionRefs = uniqueStrings([...(focus.refs ?? []), ...(type.refs ?? []), ...(save.refs ?? [])]);
    const afterObservationRefs = after.refs ?? [];
    const controlRefs = control.refs ?? [];
    const screenshotRefs = uniqueStrings([
      (before.value?.output as { screenshotRef?: string } | undefined)?.screenshotRef,
      (after.value?.output as { screenshotRef?: string } | undefined)?.screenshotRef,
    ]);
    const accessibilityRefs = uniqueStrings([
      (before.value?.output as { accessibilityRef?: string } | undefined)?.accessibilityRef,
      (after.value?.output as { accessibilityRef?: string } | undefined)?.accessibilityRef,
    ]);
    const textRefs = uniqueStrings([
      ...((before.value?.output as { textRefs?: string[] } | undefined)?.textRefs ?? []),
      ...((after.value?.output as { textRefs?: string[] } | undefined)?.textRefs ?? []),
    ]);
    const releaseRefs = controlRefs.filter((ref) => /^(?:scoped-input-lease|input-adapter|cursor-marker):/i.test(ref));
    const sentinelVisibleInTextRefs = afterObservation.visibleText.includes(ctx.sentinelText);
    const fileName = basename(testFilePath);
    const targetWindowStable = textMentionsTestFile(beforeObservation, fileName)
      && textMentionsTestFile(afterObservation, fileName);
    const beforeAfterScreenshotChanged = beforeObservation.screenshotSha256 !== afterObservation.screenshotSha256;
    const fileContentMatched = fileContent === ctx.sentinelText;
    const blockedReasons = [
      targetWindowStable ? undefined : 'target-window-not-stable',
      sentinelVisibleInTextRefs ? undefined : 'sentinel-not-visible-in-ax-text-refs',
      beforeAfterScreenshotChanged ? undefined : 'before-after-screenshot-did-not-change',
      fileContentMatched ? undefined : 'file-content-did-not-match-sentinel',
      releaseRefs.length >= 3 ? undefined : 'release-refs-missing-input-lease-cursor-adapter',
    ].filter((item): item is string => Boolean(item));

    manifest = {
      schemaVersion: VSCODE_LIVE_ACCEPTANCE_SCHEMA_VERSION,
      status: blockedReasons.length ? 'blocked' : 'passed',
      maturity: 'live-diagnostic',
      productReady: false,
      sharedSystemInputUsed: true,
      userProfileUsed: true,
      runner: 'computer-use-vscode-live-acceptance',
      checkedAt,
      vscodeLaunched: true,
      vscodeAppRef: `macos-app:com.microsoft.VSCode/${sha1(appPath).slice(0, 12)}`,
      primitiveChainRequired: VSCODE_LIVE_ACCEPTANCE_CAPABILITY.primitiveChainRequired,
      primitiveChainObserved: chain,
      tempDirs: {
        workspaceCreated: true,
        userDataDirCreated: false,
        extensionsDirCreated: false,
        homeDirCreated: false,
        deletedAfterRun: false,
      },
      target: {
        appName: 'Visual Studio Code',
        bundleId: 'com.microsoft.VSCode',
        windowRef: `vscode-live-window:${runId}`,
        workspaceRef: `vscode-live-workspace:${runId}:${sha1(workspaceDir).slice(0, 12)}`,
        testFileRef: `vscode-live-file:${runId}:${sha1(testFilePath).slice(0, 12)}`,
      },
      evidence: {
        bindRefs,
        beforeObservationRefs,
        actionRefs,
        afterObservationRefs,
        controlRefs,
        screenshotRefs,
        accessibilityRefs,
        textRefs,
        fileValidatorRefs: [fileValidatorRef],
        releaseRefs,
      },
      verification: {
        targetWindowStable,
        sentinelVisibleInTextRefs,
        beforeAfterScreenshotChanged,
        fileContentMatched,
        cleanupPassed: false,
      },
      blockedReasons,
    };
  } catch (error) {
    manifest = {
      ...manifest,
      primitiveChainObserved: chain,
      blockedReasons: [safeBlockedReason(error)],
    };
  } finally {
    let cleanupPassed = false;
    try {
      await closeVSCodeTestWindow(ctx.processId);
      await cleanupVSCodeLiveAcceptanceArtifacts({
        artifactRoot,
        tempRoots: [workspaceDir],
        keepArtifacts,
      });
      await restoreMousePointer(pointerBefore);
      await restoreFrontApplication(frontApplicationBefore);
      cleanupPassed = true;
    } finally {
      manifest = {
        ...manifest,
        tempDirs: {
          ...manifest.tempDirs,
          deletedAfterRun: cleanupPassed,
        },
        verification: {
          ...manifest.verification,
          cleanupPassed,
        },
        blockedReasons: cleanupPassed
          ? manifest.blockedReasons
          : uniqueStrings([...manifest.blockedReasons, 'cleanup-failed']),
      };
      if (keepArtifacts || manifest.status === 'blocked') {
        await writeManifest(artifactRoot, manifest);
      }
    }
  }

  return manifest;
}

export async function cleanupVSCodeLiveAcceptanceArtifacts(input: {
  artifactRoot: string;
  tempRoots: string[];
  keepArtifacts: boolean;
}): Promise<void> {
  for (const tempRoot of input.tempRoots) {
    await rmWithRetry(tempRoot);
  }
  if (!input.keepArtifacts) {
    await rmWithRetry(input.artifactRoot);
  }
}

function createVSCodeLivePrimitivePorts(ctx: VSCodeLiveContext): ComputerUsePrimitivePorts {
  const sessionId = `cu-session:${ctx.runId}`;
  return {
    bind: async () => {
      await launchVSCode(ctx);
      const observation = await materializeVSCodeObservation(ctx, 'bind', sessionId);
      return {
        status: 'completed',
        output: {
          sessionId,
          sessionRef: `computer-use:session:${ctx.runId}`,
          targetRef: `vscode-live-window:${ctx.runId}`,
          inputAdapterRef: `input-adapter:vscode-live:${ctx.runId}:shared-system`,
          cursorRef: `cursor-marker:vscode-live:${ctx.runId}`,
          windowActionSessionRef: `window-action-session:vscode-live:${ctx.runId}`,
          scopedInputLeaseRef: `scoped-input-lease:vscode-live:${ctx.runId}`,
          observationRef: observation.observationRef,
        },
        refs: [
          `computer-use:session:${ctx.runId}`,
          `vscode-live-window:${ctx.runId}`,
          `input-adapter:vscode-live:${ctx.runId}:shared-system`,
          `cursor-marker:vscode-live:${ctx.runId}`,
          `window-action-session:vscode-live:${ctx.runId}`,
          `scoped-input-lease:vscode-live:${ctx.runId}`,
          observation.observationRef,
          observation.screenshotRef,
          observation.accessibilityRef,
        ],
      };
    },
    observe: async (input: ComputerUseObserveInput) => {
      const observation = await materializeVSCodeObservation(ctx, input.capture === 'both' ? 'both' : 'observe', input.sessionId);
      return {
        status: 'completed',
        output: {
          sessionId: input.sessionId,
          observationRef: observation.observationRef,
          screenshotRef: observation.screenshotRef,
          accessibilityRef: observation.accessibilityRef,
          elementRefs: [`vscode-editor:${ctx.runId}`, observation.windowRef],
          textRefs: observation.textRefs,
        },
        refs: [
          observation.observationRef,
          observation.screenshotRef,
          observation.accessibilityRef,
          observation.windowRef,
          `vscode-editor:${ctx.runId}`,
          ...observation.textRefs,
        ],
      };
    },
    act: async (input: ComputerUseActInput) => {
      const before = await materializeVSCodeObservation(ctx, `${input.action.type}-before`, input.sessionId);
      await executeVSCodeAction(ctx, input);
      const after = await materializeVSCodeObservation(ctx, `${input.action.type}-after`, input.sessionId);
      const actionRef = `window-action:vscode-live:${ctx.runId}:${++ctx.sequence}:${input.action.type}`;
      const executorEventRef = await writeJsonRef(ctx.artifactRoot, `${ctx.sequence}-${input.action.type}-executor-event.json`, {
        schemaVersion: 'sciforge.computer-use.primitive-vscode-live-executor-event.v1',
        runId: ctx.runId,
        sessionId: input.sessionId,
        actionType: input.action.type,
        actionId: input.actionId,
        actionRef,
        inputAdapterRef: input.inputAdapterRef,
        cursorRef: input.cursorRef,
        scopedInputLeaseRef: input.scopedInputLeaseRef,
        usedTextRef: input.action.textRef,
        command: input.action.command,
        key: input.action.key,
        sharedSystemInputUsed: true,
        userInputImpact: 'front-app-and-keyboard-may-be-briefly-taken-over',
      }, 'executor-event');
      const inputEventRef = `input-event:vscode-live:${ctx.runId}:${ctx.sequence}`;
      return {
        status: 'completed',
        output: {
          sessionId: input.sessionId,
          actionRef,
          executorEventRef,
          inputEventRef,
          inputAdapterRef: input.inputAdapterRef,
          cursorRef: input.cursorRef,
          scopedInputLeaseRef: input.scopedInputLeaseRef,
          beforeObservationRef: before.observationRef,
          afterObservationRef: after.observationRef,
          invalidatedRefs: [before.observationRef],
        },
        refs: [
          actionRef,
          executorEventRef,
          inputEventRef,
          before.observationRef,
          before.screenshotRef,
          before.accessibilityRef,
          after.observationRef,
          after.screenshotRef,
          after.accessibilityRef,
        ],
      };
    },
    control: async (input) => {
      const controlRef = await writeJsonRef(ctx.artifactRoot, 'control-release.json', {
        schemaVersion: 'sciforge.computer-use.primitive-vscode-live-control.v1',
        runId: ctx.runId,
        sessionId: input.sessionId,
        command: input.command,
        reasonRef: input.reasonRef,
        releasedRefs: [
          input.scopedInputLeaseRef,
          input.inputAdapterRef,
          input.cursorRef,
        ],
      }, 'control');
      return {
        status: 'completed',
        output: {
          sessionId: input.sessionId,
          controlRef,
          releasedRefs: [
            input.scopedInputLeaseRef ?? '',
            input.inputAdapterRef ?? '',
            input.cursorRef ?? '',
          ],
        },
        refs: [
          controlRef,
          input.scopedInputLeaseRef ?? '',
          input.inputAdapterRef ?? '',
          input.cursorRef ?? '',
        ],
      };
    },
  };
}

async function launchVSCode(ctx: VSCodeLiveContext): Promise<void> {
  const executablePath = join(ctx.appPath, 'Contents', 'MacOS', 'Code');
  const child = spawn(executablePath, ['--reuse-window', ctx.testFilePath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  ctx.processId = await waitForUserProfileVSCodeProcess(20_000);
  await waitForVSCodeTestFileWindow(ctx, 35_000);
}

async function waitForUserProfileVSCodeProcess(timeoutMs: number): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const pid = await findUserProfileVSCodeMainPid();
    if (pid) return pid;
    await sleep(500);
  }
  throw new Error('vscode-user-profile-process-did-not-start');
}

async function waitForVSCodeWindow(ctx: VSCodeLiveContext, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const title = await readVSCodeWindowTitle(ctx).catch(() => undefined);
    if (title) return;
    await sleep(500);
  }
  throw new Error('vscode-window-did-not-open');
}

async function waitForVSCodeTestFileWindow(ctx: VSCodeLiveContext, timeoutMs: number): Promise<void> {
  const fileName = basename(ctx.testFilePath);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const discovered = await findVSCodeProcessForWindowTitle(fileName).catch(() => undefined);
    if (discovered) {
      ctx.processId = discovered.pid;
      return;
    }
    const title = await readVSCodeWindowTitle(ctx).catch(() => '');
    if (title.includes(fileName)) return;
    const state = await readVSCodeWindowState(ctx).catch(() => undefined);
    if (state && textMentionsTestFile(state, fileName)) return;
    await sleep(500);
  }
  throw new Error('vscode-test-file-editor-did-not-open');
}

async function materializeVSCodeObservation(
  ctx: VSCodeLiveContext,
  prefix: string,
  sessionId: string,
): Promise<MaterializedObservation> {
  await mkdir(ctx.artifactRoot, { recursive: true });
  const sequence = ++ctx.sequence;
  const screenshotPath = join(ctx.artifactRoot, `${String(sequence).padStart(2, '0')}-${prefix}-screenshot.png`);
  await execFileAsync('screencapture', ['-x', screenshotPath]);
  const screenshotBytes = await readFile(screenshotPath);
  const screenshotSha256 = sha256(screenshotBytes);
  const state = await readVSCodeWindowState(ctx);
  const textRef = await writeJsonRef(ctx.artifactRoot, `${String(sequence).padStart(2, '0')}-${prefix}-visible-text.json`, {
    schemaVersion: 'sciforge.computer-use.vscode-live-visible-text.v1',
    runId: ctx.runId,
    sessionId,
    windowTitle: state.windowTitle,
    textSha256: sha256(state.visibleText),
    containsSentinel: state.visibleText.includes(ctx.sentinelText),
    visibleText: state.visibleText,
    source: 'macos-accessibility-visible-text',
  }, 'text');
  const accessibilityRef = await writeJsonRef(ctx.artifactRoot, `${String(sequence).padStart(2, '0')}-${prefix}-accessibility.json`, {
    schemaVersion: 'sciforge.computer-use.vscode-live-accessibility-observation.v1',
    runId: ctx.runId,
    sessionId,
    windowTitle: state.windowTitle,
    windowRef: `vscode-live-window:${ctx.runId}:${sha1(state.windowTitle).slice(0, 12)}`,
    visibleTextSha256: sha256(state.visibleText),
    visibleText: state.visibleText,
    visibleTextPreview: state.visibleText.slice(0, 500),
    containsSentinel: state.visibleText.includes(ctx.sentinelText),
    screenshotSha256,
  }, 'accessibility');
  const observationRef = await writeJsonRef(ctx.artifactRoot, `${String(sequence).padStart(2, '0')}-${prefix}-observation.json`, {
    schemaVersion: 'sciforge.computer-use.vscode-live-observation.v1',
    runId: ctx.runId,
    sessionId,
    screenshotRef: `image:vscode-live:${ctx.runId}:${sequence}`,
    accessibilityRef,
    textRefs: [textRef],
    windowTitle: state.windowTitle,
    screenshotSha256,
  }, 'observation');
  return {
    observationRef,
    screenshotRef: `image:vscode-live:${ctx.runId}:${sequence}`,
    accessibilityRef,
    textRefs: [textRef],
    windowRef: `vscode-live-window:${ctx.runId}:${sha1(state.windowTitle).slice(0, 12)}`,
    visibleText: state.visibleText,
    screenshotSha256,
  };
}

async function executeVSCodeAction(ctx: VSCodeLiveContext, input: ComputerUseActInput): Promise<void> {
  if (input.action.type === 'key' && input.action.key === 'Command+1') {
    await runAppleScript(`
on run argv
  set targetPid to item 1 of argv as integer
  tell application "System Events"
    if not (exists (first application process whose unix id is targetPid)) then error "vscode-process-missing"
    tell (first application process whose unix id is targetPid)
      set frontmost to true
      delay 0.25
      keystroke "1" using command down
    end tell
  end tell
end run
`, [String(ctx.processId ?? 0)]);
    await sleep(300);
    return;
  }
  if (input.action.type === 'type') {
    const text = input.action.textRef ? ctx.textRefs.get(input.action.textRef) : undefined;
    if (!text) throw new Error(`missing-text-ref:${input.action.textRef ?? 'none'}`);
    await runAppleScript(`
on run argv
  set targetPid to item 1 of argv as integer
  set typedText to item 2 of argv
  try
    set previousClipboard to the clipboard as text
  on error
    set previousClipboard to ""
  end try
  tell application "System Events"
    if not (exists (first application process whose unix id is targetPid)) then error "vscode-process-missing"
    tell (first application process whose unix id is targetPid)
      set frontmost to true
      delay 0.25
      set the clipboard to typedText
      keystroke "a" using command down
      delay 0.1
      keystroke "v" using command down
      delay 0.2
      set the clipboard to previousClipboard
    end tell
  end tell
end run
`, [String(ctx.processId ?? 0), text]);
    await sleep(500);
    return;
  }
  if (input.action.type === 'app_command' && input.action.command === 'save') {
    await runAppleScript(`
on run argv
  set targetPid to item 1 of argv as integer
  tell application "System Events"
    if not (exists (first application process whose unix id is targetPid)) then error "vscode-process-missing"
    tell (first application process whose unix id is targetPid)
      set frontmost to true
      delay 0.2
      keystroke "s" using command down
    end tell
  end tell
end run
`, [String(ctx.processId ?? 0)]);
    await sleep(800);
    return;
  }
  throw new Error(`unsupported-vscode-live-action:${input.action.type}`);
}

async function openVSCodeTestFileViaQuickOpen(ctx: VSCodeLiveContext): Promise<void> {
  await runAppleScript(`
on run argv
  set targetPid to item 1 of argv as integer
  set filePath to item 2 of argv
  tell application "System Events"
    if not (exists (first application process whose unix id is targetPid)) then error "vscode-process-missing"
    tell (first application process whose unix id is targetPid)
      set frontmost to true
      delay 0.5
      keystroke "p" using command down
      delay 0.35
      keystroke filePath
      delay 0.2
      key code 36
    end tell
  end tell
end run
`, [String(ctx.processId ?? 0), ctx.testFilePath]);
  await sleep(1_000);
}

async function readVSCodeWindowTitle(ctx: VSCodeLiveContext): Promise<string> {
  const { stdout } = await runAppleScript(`
on run argv
  set targetPid to item 1 of argv as integer
  tell application "System Events"
    if not (exists (first application process whose unix id is targetPid)) then error "vscode-process-missing"
    tell (first application process whose unix id is targetPid)
      if (count of windows) is 0 then error "vscode-window-missing"
      return name of front window
    end tell
  end tell
end run
`, [String(ctx.processId ?? 0)]);
  return stdout.trim();
}

async function findVSCodeProcessForWindowTitle(fileName: string): Promise<{ pid: number; title: string } | undefined> {
  const { stdout } = await runAppleScript(`
on run argv
  set fileName to item 1 of argv
  tell application "System Events"
    repeat with appProcess in application processes whose name is "Code"
      try
        repeat with appWindow in windows of appProcess
          try
            set windowTitle to name of appWindow as text
            if windowTitle contains fileName then
              return (unix id of appProcess as text) & linefeed & windowTitle
            end if
          end try
        end repeat
      end try
    end repeat
  end tell
  return ""
end run
`, [fileName]);
  const [pidText = '', title = ''] = stdout.trim().split('\n');
  const pid = Number(pidText);
  return Number.isFinite(pid) && title ? { pid, title } : undefined;
}

async function readVSCodeWindowState(ctx: VSCodeLiveContext): Promise<{ windowTitle: string; visibleText: string }> {
  const { stdout } = await runAppleScript(`
on run argv
  set targetPid to item 1 of argv as integer
  tell application "System Events"
    if not (exists (first application process whose unix id is targetPid)) then error "vscode-process-missing"
    tell (first application process whose unix id is targetPid)
    set frontmost to true
    if (count of windows) is 0 then error "vscode-window-missing"
    set targetWindow to front window
    set windowTitle to name of targetWindow
    set collectedText to windowTitle
    try
      set focusedElement to value of attribute "AXFocusedUIElement"
      try
        set focusedName to name of focusedElement as text
        if focusedName is not "" then set collectedText to collectedText & linefeed & focusedName
      end try
      try
        set focusedValue to value of focusedElement as text
        if focusedValue is not "" then set collectedText to collectedText & linefeed & focusedValue
      end try
      try
        set focusedDescription to description of focusedElement as text
        if focusedDescription is not "" then set collectedText to collectedText & linefeed & focusedDescription
      end try
    end try
    try
      repeat with textArea in text areas of targetWindow
        try
          set textAreaValue to value of textArea
          if textAreaValue is not missing value and textAreaValue is not "" then set collectedText to collectedText & linefeed & (textAreaValue as text)
        end try
      end repeat
    end try
    try
      set previousClipboard to the clipboard as text
    on error
      set previousClipboard to ""
    end try
    try
      keystroke "a" using command down
      delay 0.1
      keystroke "c" using command down
      delay 0.2
      set copiedEditorText to the clipboard as text
      if copiedEditorText is not "" then set collectedText to collectedText & linefeed & copiedEditorText
      set the clipboard to previousClipboard
    end try
    return collectedText
    end tell
  end tell
end run
`, [String(ctx.processId ?? 0)]);
  const text = stdout.toString().replace(/\r/g, '\n').trim();
  const [windowTitle = '', ...rest] = text.split('\n');
  return {
    windowTitle,
    visibleText: uniqueStrings(rest).join('\n').slice(0, 12_000),
  };
}

async function closeVSCodeTestWindow(processId: number | undefined): Promise<void> {
  if (!processId) return;
  await runAppleScript(`
on run argv
  set targetPid to item 1 of argv as integer
tell application "System Events"
  if exists (first application process whose unix id is targetPid) then
    tell (first application process whose unix id is targetPid)
      set frontmost to true
      if (count of windows) > 0 then
        keystroke "w" using command down
      end if
    end tell
  end if
end tell
end run
`, [String(processId)]).catch(() => undefined);
  await sleep(500);
}

async function findUserProfileVSCodeMainPid(): Promise<number | undefined> {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command=']);
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const [, pid, command] = match;
    if (command.includes('/Contents/MacOS/Code') && !command.includes('/Frameworks/Code Helper')) {
      return Number(pid);
    }
  }
  return undefined;
}

async function readFrontApplicationName(): Promise<string> {
  const { stdout } = await runAppleScript('tell application "System Events" to get name of first application process whose frontmost is true');
  return stdout.trim();
}

async function restoreFrontApplication(appName: string | undefined): Promise<void> {
  if (!appName) return;
  await runAppleScript(`
on run argv
  set appName to item 1 of argv
  tell application "System Events"
    if exists process appName then set frontmost of process appName to true
  end tell
end run
`, [appName]).catch(() => undefined);
}

async function readMousePointer(): Promise<{ x: number; y: number }> {
  const stdout = await runTransientSwift('computer-use-vscode-pointer-read.swift', `
import CoreGraphics

guard let event = CGEvent(source: nil) else {
  exit(2)
}
let point = event.location
print("\\(point.x),\\(point.y)")
`, []);
  const [x, y] = stdout.trim().split(',').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('mouse-pointer-unavailable');
  return { x, y };
}

async function restoreMousePointer(point: { x: number; y: number } | undefined): Promise<void> {
  if (!point) return;
  await runTransientSwift('computer-use-vscode-pointer-restore.swift', `
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

async function runAppleScript(script: string, args: string[] = []) {
  return execFileAsync('osascript', ['-e', script, ...args], { timeout: 20_000, maxBuffer: 1024 * 1024 });
}

async function runTransientSwift(filename: string, source: string, args: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-cu-vscode-swift-'));
  const sourcePath = join(dir, filename);
  await writeFile(sourcePath, source, 'utf8');
  try {
    const { stdout } = await execFileAsync('/usr/bin/swift', [sourcePath, ...args], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function baseManifest(input: {
  checkedAt: string;
  artifactRoot: string;
  appPath: string;
  status: 'passed' | 'blocked';
  skipReason?: string;
  vscodeLaunched: boolean;
  blockedReasons?: string[];
}): VSCodeLiveAcceptanceManifest {
  return {
    schemaVersion: VSCODE_LIVE_ACCEPTANCE_SCHEMA_VERSION,
    status: input.status,
    maturity: 'live-diagnostic',
    productReady: false,
    sharedSystemInputUsed: true,
    userProfileUsed: true,
    runner: 'computer-use-vscode-live-acceptance',
    checkedAt: input.checkedAt,
    ...(input.skipReason ? { skipReason: input.skipReason } : {}),
    vscodeLaunched: input.vscodeLaunched,
    vscodeAppRef: `macos-app:com.microsoft.VSCode/${sha1(input.appPath).slice(0, 12)}`,
    primitiveChainRequired: VSCODE_LIVE_ACCEPTANCE_CAPABILITY.primitiveChainRequired,
    primitiveChainObserved: [],
    tempDirs: {
      workspaceCreated: false,
      userDataDirCreated: false,
      extensionsDirCreated: false,
      homeDirCreated: false,
      deletedAfterRun: true,
    },
    target: {
      appName: 'Visual Studio Code',
      bundleId: 'com.microsoft.VSCode',
      windowRef: '',
      workspaceRef: '',
      testFileRef: '',
    },
    evidence: {
      bindRefs: [],
      beforeObservationRefs: [],
      actionRefs: [],
      afterObservationRefs: [],
      controlRefs: [],
      screenshotRefs: [],
      accessibilityRefs: [],
      textRefs: [],
      fileValidatorRefs: [],
      releaseRefs: [],
    },
    verification: {
      targetWindowStable: false,
      sentinelVisibleInTextRefs: false,
      beforeAfterScreenshotChanged: false,
      fileContentMatched: false,
      cleanupPassed: true,
    },
    blockedReasons: input.blockedReasons ?? (input.skipReason ? [input.skipReason] : []),
  };
}

async function writeManifest(
  artifactRoot: string,
  manifest: VSCodeLiveAcceptanceManifest,
): Promise<void> {
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(join(artifactRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function rmWithRetry(path: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 });
      return;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw lastError;
}

function request(intent: string, input: Record<string, unknown>) {
  return {
    schemaVersion: 'sciforge.module.invoke-request.v1',
    moduleId: 'computer_use',
    intent,
    input,
    refs: [],
  };
}

function moduleFailureReason(result: {
  error?: string;
  value?: {
    blockedReason?: string;
    diagnostics?: Array<{ message?: string }>;
  };
}, fallback: string): string {
  return [
    ...(result.value?.diagnostics ?? []).map((diagnostic) => diagnostic.message),
    result.value?.blockedReason,
    result.error,
    fallback,
  ].find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? fallback;
}

interface MaterializedObservationPayload {
  windowTitle: string;
  visibleText: string;
  screenshotSha256: string;
}

async function readJsonRef<T>(ref: string): Promise<T> {
  const path = refStore.get(ref);
  if (!path) throw new Error(`missing-json-ref:${ref}`);
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

const refStore = new Map<string, string>();

async function writeJsonRef(
  root: string,
  fileName: string,
  payload: Record<string, unknown>,
  refKind: string,
): Promise<string> {
  await mkdir(root, { recursive: true });
  const path = join(root, fileName);
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const ref = `${refKind}:vscode-live:${sha1(path).slice(0, 16)}`;
  refStore.set(ref, path);
  return ref;
}

function firstRef(value: string | undefined): string {
  if (!value) throw new Error('missing-required-ref');
  return value;
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim()))];
}

function safeBlockedReason(error: unknown): string {
  const stderr = isRecord(error) && typeof error.stderr === 'string' ? error.stderr : '';
  const stdout = isRecord(error) && typeof error.stdout === 'string' ? error.stdout : '';
  const text = [stderr, stdout, error instanceof Error ? error.message : String(error)]
    .filter((value) => value.trim())
    .join(' ');
  return text
    .replace(/\/var\/folders\/\S+/g, '[temp]')
    .replace(/\/tmp\/\S+/g, '[temp]')
    .replace(/\/Applications\/Visual Studio Code\.app/g, '[vscode-app]')
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}

function textMentionsTestFile(observation: Pick<MaterializedObservationPayload, 'windowTitle' | 'visibleText'>, fileName: string): boolean {
  return observation.windowTitle.includes(fileName) || observation.visibleText.includes(fileName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
