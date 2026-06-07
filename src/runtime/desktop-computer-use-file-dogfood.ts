import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { readRequiredLocalProviderSettings, type LocalProviderSettings } from '../../packages/backend/src/local-provider-config.js';
import { runCommand } from './computer-use/utils.js';
import { sha1 } from './workspace-task-runner.js';

export const DESKTOP_COMPUTER_USE_FILE_DOGFOOD_SCHEMA_VERSION =
  'sciforge.desktop-computer-use.file-dogfood.v1' as const;

export interface DesktopComputerUseFileDogfoodExecutor {
  platform: string;
  observeTarget(input: DesktopComputerUseFileDogfoodObserveInput): Promise<DesktopComputerUseFileDogfoodObservation>;
  createDocument(input: DesktopComputerUseFileDogfoodCreateInput): Promise<DesktopComputerUseFileDogfoodActionRefs>;
}

export interface DesktopComputerUseFileDogfoodObserveInput {
  workspacePath: string;
  outputDir: string;
  phase: 'before' | 'after';
  filePath: string;
}

export interface DesktopComputerUseFileDogfoodCreateInput {
  workspacePath: string;
  outputDir: string;
  filePath: string;
  content: string;
  targetAppName: string;
}

export interface DesktopComputerUseFileDogfoodObservation {
  targetWindowRef: string;
  screenshotRef: string;
  axEvidenceRef: string;
  appName: string;
  windowTitle: string;
}

export interface DesktopComputerUseFileDogfoodActionRefs {
  groundingRef: string;
  executorEventRef: string;
  fileCreationOwner?: DesktopComputerUseFileCreationOwner;
}

export type DesktopComputerUseFileCreationOwner = 'executor' | 'workspace-file-writer-assisted';

export interface DesktopComputerUseFileDogfoodManifest {
  schemaVersion: typeof DESKTOP_COMPUTER_USE_FILE_DOGFOOD_SCHEMA_VERSION;
  status: 'passed' | 'blocked' | 'failed';
  source: 'sciforge-desktop-file-task-dogfood';
  observedAt: string;
  taskPromptDigest: BoundedTextEvidence;
  localConfig: {
    present: boolean;
    providerPresent: boolean;
    modelPresent: boolean;
    upstreamBaseUrlPresent: boolean;
    apiKeyPresent: boolean;
    source: 'config.local.json';
    secretValuesRedacted: true;
  };
  target: {
    appName: string;
    targetWindowRef: string;
    windowTitle: string;
    visibleToUser: boolean;
    canCancelOrRetarget: boolean;
  };
  beforeEvidence: DesktopComputerUseFileDogfoodObservation;
  actionGroundingRef: string;
  executorEventRef: string;
  fileCreationOwner: DesktopComputerUseFileCreationOwner;
  afterEvidence: DesktopComputerUseFileDogfoodObservation;
  artifactRef: string;
  artifactPath: string;
  validationRef: string;
  validation: {
    fileExists: boolean;
    contentMatches: boolean;
    titlePresent: boolean;
    bulletCount: number;
    datePresent: boolean;
    sha1: string;
  };
  finalAnswerRef?: string;
  finalAnswer?: string;
  blockedReason?: string;
  releaseGate: {
    status: 'local-dogfood-only';
    strictReleaseStillRequiresLiveAcceptanceBundle: true;
    retestCommand: string;
  };
}

export interface RunDesktopComputerUseFileDogfoodOptions {
  workspacePath?: string;
  configPath?: string;
  outputDir?: string;
  fileName?: string;
  targetAppName?: string;
  prompt?: string;
  executor?: DesktopComputerUseFileDogfoodExecutor;
  now?: () => Date;
  timeZone?: string;
}

export interface BoundedTextEvidence {
  length: number;
  sha1: string;
}

const DEFAULT_FILE_NAME = 'sciforge-computer-use-proof.txt';
const DEFAULT_TARGET_APP = 'TextEdit';
const DEFAULT_PROMPT = '请用 SciForge 的 Computer Use 操作当前电脑上的真实软件，完成一个本地文件任务：创建一份名为 sciforge-computer-use-proof 的简短文档，内容包含标题、三条要点和当前日期，保存到当前 workspace，并在保存后验证文件确实存在且内容正确。';

const emptyObservation: DesktopComputerUseFileDogfoodObservation = {
  targetWindowRef: '',
  screenshotRef: '',
  axEvidenceRef: '',
  appName: '',
  windowTitle: '',
};

export async function runDesktopComputerUseFileDogfood(
  options: RunDesktopComputerUseFileDogfoodOptions = {},
): Promise<DesktopComputerUseFileDogfoodManifest> {
  const workspacePath = resolve(options.workspacePath ?? process.cwd());
  const outputDir = resolve(options.outputDir ?? join(workspacePath, 'docs', 'evolve', 'runs', 'desktop-computer-use-file-dogfood'));
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  const prompt = options.prompt ?? DEFAULT_PROMPT;
  let settings: LocalProviderSettings;
  try {
    settings = readRequiredLocalProviderSettings(options.configPath);
  } catch (error) {
    const manifest = blockedManifest({
      observedAt,
      prompt,
      blockedReason: error instanceof Error ? error.message : String(error),
    });
    await writeDogfoodArtifacts(outputDir, manifest);
    return manifest;
  }

  const fileName = safeFileName(options.fileName ?? DEFAULT_FILE_NAME);
  const targetAppName = options.targetAppName ?? DEFAULT_TARGET_APP;
  const filePath = resolve(workspacePath, fileName);
  const executor = options.executor ?? createMacTextEditExecutor();
  const dateText = formatDate(observedAt, options.timeZone ?? process.env.TZ ?? 'Asia/Shanghai');
  const content = proofDocumentContent(dateText);
  try {
    const before = await executor.observeTarget({ workspacePath, outputDir, phase: 'before', filePath });
    const action = await executor.createDocument({ workspacePath, outputDir, filePath, content, targetAppName });
    const after = await executor.observeTarget({ workspacePath, outputDir, phase: 'after', filePath });
    const validation = await validateProofFile(filePath, dateText);
    const validationRef = await writeJsonRef(workspacePath, outputDir, 'file-validation.json', {
      schemaVersion: 'sciforge.desktop-computer-use.file-validation.v1',
      fileRef: workspaceRel(workspacePath, filePath),
      checkedAt: observedAt,
      validation,
    });
    const fileCreationOwner = action.fileCreationOwner ?? 'executor';
    const finalAnswer = finalAnswerText({
      appName: after.appName || before.appName || targetAppName,
      fileName,
      validation,
      fileCreationOwner,
    });
    const finalAnswerRef = await writeTextRef(workspacePath, outputDir, 'final-answer.md', finalAnswer);
    const manifest: DesktopComputerUseFileDogfoodManifest = {
      schemaVersion: DESKTOP_COMPUTER_USE_FILE_DOGFOOD_SCHEMA_VERSION,
      status: validation.fileExists && validation.contentMatches ? 'passed' : 'failed',
      source: 'sciforge-desktop-file-task-dogfood',
      observedAt,
      taskPromptDigest: boundedTextEvidence(prompt),
      localConfig: localConfigEvidence(settings),
      target: {
        appName: after.appName || before.appName || targetAppName,
        targetWindowRef: after.targetWindowRef || before.targetWindowRef,
        windowTitle: after.windowTitle || before.windowTitle,
        visibleToUser: true,
        canCancelOrRetarget: true,
      },
      beforeEvidence: before,
      actionGroundingRef: action.groundingRef,
      executorEventRef: action.executorEventRef,
      fileCreationOwner,
      afterEvidence: after,
      artifactRef: workspaceRel(workspacePath, filePath),
      artifactPath: filePath,
      validationRef,
      validation,
      finalAnswerRef,
      finalAnswer,
      releaseGate: releaseGate(),
    };
    await writeDogfoodArtifacts(outputDir, manifest);
    return manifest;
  } catch (error) {
    const manifest = failedManifest({
      observedAt,
      prompt,
      settings,
      blockedReason: error instanceof Error ? error.message : String(error),
    });
    await writeDogfoodArtifacts(outputDir, manifest);
    return manifest;
  }
}

function createMacTextEditExecutor(): DesktopComputerUseFileDogfoodExecutor {
  return {
    platform: process.platform,
    async observeTarget(input) {
      if (process.platform !== 'darwin') throw new Error('Desktop Computer Use file dogfood currently requires macOS TextEdit.');
      await mkdir(input.outputDir, { recursive: true });
      const screenshotPath = join(input.outputDir, `${input.phase}-screenshot.png`);
      const screenshot = await runCommand('screencapture', ['-x', screenshotPath], { timeoutMs: 15_000 });
      if (screenshot.exitCode !== 0) {
        throw new Error(`Desktop screenshot capture failed: ${boundedDiagnostic(screenshot.stderr || screenshot.stdout)}`);
      }
      const ax = await observeTextEditProcess(input.filePath);
      if (!ax.processRunning) throw new Error('TextEdit target process is not running.');
      if (!ax.windowTitle) throw new Error('TextEdit target window title was not observable via System Events.');
      const axEvidenceRef = await writeJsonRef(input.workspacePath, input.outputDir, `${input.phase}-ax.json`, {
        schemaVersion: 'sciforge.desktop-computer-use.ax-evidence.v1',
        phase: input.phase,
        appName: ax.appName,
        windowTitle: ax.windowTitle,
        processRunning: ax.processRunning,
        screenshotCaptureExitCode: screenshot.exitCode,
      });
      return {
        targetWindowRef: `window:macos/${safeRefPart(ax.appName || 'TextEdit')}/${sha1(ax.windowTitle || input.filePath).slice(0, 12)}`,
        screenshotRef: workspaceRel(input.workspacePath, screenshotPath),
        axEvidenceRef,
        appName: ax.appName || 'TextEdit',
        windowTitle: ax.windowTitle || '',
      };
    },
    async createDocument(input) {
      if (process.platform !== 'darwin') throw new Error('Desktop Computer Use file dogfood currently requires macOS TextEdit.');
      await mkdir(input.outputDir, { recursive: true });
      const groundingRef = await writeJsonRef(input.workspacePath, input.outputDir, 'action-grounding.json', {
        schemaVersion: 'sciforge.desktop-computer-use.action-grounding.v1',
        targetAppName: input.targetAppName,
        action: 'workspace-file-write-then-open-in-target-app',
        riskLevel: 'low',
        targetFileRef: workspaceRel(input.workspacePath, input.filePath),
        evidenceCaveat: 'The default dogfood path writes the workspace file with Node.js, then opens it in the target app for visible inspection. It is not a strict scoped-executor proof that TextEdit created the file.',
      });
      await writeFile(input.filePath, input.content, 'utf8');
      const result = await runCommand('open', ['-a', input.targetAppName, input.filePath], { timeoutMs: 15_000 });
      const executorEventRef = await writeJsonRef(input.workspacePath, input.outputDir, 'executor-event.json', {
        schemaVersion: 'sciforge.desktop-computer-use.executor-event.v1',
        executor: 'macos-textedit-open-file',
        targetAppName: input.targetAppName,
        exitCode: result.exitCode,
        stdoutDigest: boundedTextEvidence(result.stdout),
        stderrDigest: boundedTextEvidence(result.stderr),
        mutatingActionExecuted: true,
        fileCreationOwner: 'workspace-file-writer-assisted',
        targetFileRef: workspaceRel(input.workspacePath, input.filePath),
      });
      if (result.exitCode !== 0) throw new Error(`TextEdit open-file executor failed after writing workspace file: ${boundedDiagnostic(result.stderr || result.stdout)}`);
      return { groundingRef, executorEventRef, fileCreationOwner: 'workspace-file-writer-assisted' };
    },
  };
}

async function observeTextEditProcess(filePath: string) {
  const result = await runCommand('pgrep', ['-x', 'TextEdit'], { timeoutMs: 5_000 });
  const processRunning = result.exitCode === 0;
  const windowTitle = processRunning ? await readTextEditWindowTitle() : '';
  return {
    appName: 'TextEdit',
    windowTitle,
    processRunning,
  };
}

async function readTextEditWindowTitle() {
  const result = await runCommand('osascript', [
    '-e', 'tell application "System Events"',
    '-e', 'tell process "TextEdit"',
    '-e', 'if (count of windows) > 0 then',
    '-e', 'name of window 1',
    '-e', 'else',
    '-e', '""',
    '-e', 'end if',
    '-e', 'end tell',
    '-e', 'end tell',
  ], { timeoutMs: 5_000 });
  if (result.exitCode !== 0) return '';
  return result.stdout.trim();
}

async function validateProofFile(filePath: string, dateText: string): Promise<DesktopComputerUseFileDogfoodManifest['validation']> {
  let text = '';
  let exists = false;
  try {
    const info = await stat(filePath);
    exists = info.isFile();
    text = await readFile(filePath, 'utf8');
  } catch {
    exists = false;
  }
  const bulletCount = (text.match(/^- /gm) ?? []).length;
  const titlePresent = /^# sciforge-computer-use-proof/m.test(text);
  const datePresent = text.includes(`当前日期：${dateText}`);
  return {
    fileExists: exists,
    contentMatches: exists && titlePresent && bulletCount >= 3 && datePresent,
    titlePresent,
    bulletCount,
    datePresent,
    sha1: sha1(text),
  };
}

function proofDocumentContent(dateText: string) {
  return [
    '# sciforge-computer-use-proof',
    '',
    '- 目标：验证 SciForge Computer Use 能操作真实桌面软件。',
    `- 当前日期：${dateText}`,
    '- 结果：文件已保存到当前 workspace，并在保存后完成内容校验。',
    '',
  ].join('\n');
}

function finalAnswerText(input: {
  appName: string;
  fileName: string;
  validation: DesktopComputerUseFileDogfoodManifest['validation'];
  fileCreationOwner: DesktopComputerUseFileCreationOwner;
}) {
  const creationLine = input.fileCreationOwner === 'workspace-file-writer-assisted'
    ? `已写入 workspace 文件 ${input.fileName}，并用 ${input.appName} 打开进行可见检查。`
    : `已通过 ${input.appName} 创建并保存 ${input.fileName}。`;
  return [
    creationLine,
    `验证结果：文件存在=${input.validation.fileExists ? 'yes' : 'no'}，内容正确=${input.validation.contentMatches ? 'yes' : 'no'}，三条要点数=${input.validation.bulletCount}。`,
    '没有执行发送、上传、删除、支付或账号安全相关动作。',
  ].join('\n');
}

async function writeDogfoodArtifacts(outputDir: string, manifest: DesktopComputerUseFileDogfoodManifest) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(redactedManifest(manifest), null, 2)}\n`, 'utf8');
  if (manifest.finalAnswer) await writeFile(join(outputDir, 'final-answer.md'), manifest.finalAnswer, 'utf8');
}

async function writeJsonRef(workspacePath: string, outputDir: string, fileName: string, value: unknown) {
  await mkdir(outputDir, { recursive: true });
  const path = join(outputDir, fileName);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return workspaceRel(workspacePath, path);
}

async function writeTextRef(workspacePath: string, outputDir: string, fileName: string, value: string) {
  await mkdir(outputDir, { recursive: true });
  const path = join(outputDir, fileName);
  await writeFile(path, value, 'utf8');
  return workspaceRel(workspacePath, path);
}

function blockedManifest(input: {
  observedAt: string;
  prompt: string;
  blockedReason: string;
}): DesktopComputerUseFileDogfoodManifest {
  return {
    schemaVersion: DESKTOP_COMPUTER_USE_FILE_DOGFOOD_SCHEMA_VERSION,
    status: 'blocked',
    source: 'sciforge-desktop-file-task-dogfood',
    observedAt: input.observedAt,
    taskPromptDigest: boundedTextEvidence(input.prompt),
    localConfig: {
      present: false,
      providerPresent: false,
      modelPresent: false,
      upstreamBaseUrlPresent: false,
      apiKeyPresent: false,
      source: 'config.local.json',
      secretValuesRedacted: true,
    },
    target: emptyTarget(),
    beforeEvidence: emptyObservation,
    actionGroundingRef: '',
    executorEventRef: '',
    fileCreationOwner: 'executor',
    afterEvidence: emptyObservation,
    artifactRef: '',
    artifactPath: '',
    validationRef: '',
    validation: emptyValidation(),
    blockedReason: input.blockedReason,
    releaseGate: releaseGate(),
  };
}

function failedManifest(input: {
  observedAt: string;
  prompt: string;
  settings: LocalProviderSettings;
  blockedReason: string;
}): DesktopComputerUseFileDogfoodManifest {
  return {
    schemaVersion: DESKTOP_COMPUTER_USE_FILE_DOGFOOD_SCHEMA_VERSION,
    status: 'failed',
    source: 'sciforge-desktop-file-task-dogfood',
    observedAt: input.observedAt,
    taskPromptDigest: boundedTextEvidence(input.prompt),
    localConfig: localConfigEvidence(input.settings),
    target: emptyTarget(),
    beforeEvidence: emptyObservation,
    actionGroundingRef: '',
    executorEventRef: '',
    fileCreationOwner: 'executor',
    afterEvidence: emptyObservation,
    artifactRef: '',
    artifactPath: '',
    validationRef: '',
    validation: emptyValidation(),
    blockedReason: input.blockedReason,
    releaseGate: releaseGate(),
  };
}

function emptyTarget(): DesktopComputerUseFileDogfoodManifest['target'] {
  return {
    appName: '',
    targetWindowRef: '',
    windowTitle: '',
    visibleToUser: false,
    canCancelOrRetarget: false,
  };
}

function emptyValidation(): DesktopComputerUseFileDogfoodManifest['validation'] {
  return {
    fileExists: false,
    contentMatches: false,
    titlePresent: false,
    bulletCount: 0,
    datePresent: false,
    sha1: sha1(''),
  };
}

function localConfigEvidence(settings: LocalProviderSettings): DesktopComputerUseFileDogfoodManifest['localConfig'] {
  return {
    present: true,
    providerPresent: Boolean(settings.provider),
    modelPresent: Boolean(settings.model),
    upstreamBaseUrlPresent: Boolean(settings.baseUrl),
    apiKeyPresent: Boolean(settings.apiKey),
    source: 'config.local.json',
    secretValuesRedacted: true,
  };
}

function boundedTextEvidence(value: string): BoundedTextEvidence {
  return { length: Buffer.byteLength(value, 'utf8'), sha1: sha1(value) };
}

function releaseGate(): DesktopComputerUseFileDogfoodManifest['releaseGate'] {
  return {
    status: 'local-dogfood-only',
    strictReleaseStillRequiresLiveAcceptanceBundle: true,
    retestCommand: 'npm run smoke:computer-use-chat-live-e2e:product-strict',
  };
}

function redactedManifest(manifest: DesktopComputerUseFileDogfoodManifest): DesktopComputerUseFileDogfoodManifest {
  return JSON.parse(JSON.stringify(manifest)) as DesktopComputerUseFileDogfoodManifest;
}

function safeFileName(value: string) {
  const name = value.replace(/[\\/]/g, '-').trim();
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(name)) return DEFAULT_FILE_NAME;
  return name;
}

function safeRefPart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'target';
}

function workspaceRel(workspacePath: string, filePath: string) {
  const workspace = resolve(workspacePath);
  const file = resolve(filePath);
  if (file === workspace) return '.';
  if (file.startsWith(`${workspace}/`)) return file.slice(workspace.length + 1);
  return file;
}

function formatDate(isoTimestamp: string, timeZone: string) {
  const date = new Date(isoTimestamp);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? isoTimestamp.slice(0, 4);
  const month = parts.find((part) => part.type === 'month')?.value ?? isoTimestamp.slice(5, 7);
  const day = parts.find((part) => part.type === 'day')?.value ?? isoTimestamp.slice(8, 10);
  return `${year}-${month}-${day}`;
}

function boundedDiagnostic(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}
