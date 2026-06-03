import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_ARTIFACT_SCHEMA,
  availabilityByProfileFromEnv,
  availabilityByProfileFromLocalProbe,
  buildVirtualAppScreenAppProfilePreflightArtifact,
} from '../../tools/virtual-app-screen-app-profile-preflight.js';
import {
  VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF,
} from '../../src/runtime/computer-use/virtual-app-screen-app-profiles.js';

const execFileAsync = promisify(execFile);

test('VirtualAppScreen app-profile preflight artifact records injected availability for target profiles without dogfood pass claims', () => {
  const artifact = buildVirtualAppScreenAppProfilePreflightArtifact({
    runId: 'app-profile-preflight-manual',
    generatedAt: '2026-06-03T00:00:00.000Z',
    checkedBy: 'test-injected-availability',
    availabilityByProfile: {
      word: {
        status: 'available',
        appPath: '/Applications/Microsoft Word.app',
      },
      powerpoint: {
        status: 'unavailable',
        reason: 'fixture says Microsoft PowerPoint is not installed',
      },
    },
  });

  assert.equal(artifact.schemaVersion, VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_ARTIFACT_SCHEMA);
  assert.equal(artifact.status, 'recorded');
  assert.equal(artifact.runId, 'app-profile-preflight-manual');
  assert.equal(artifact.generatedAt, '2026-06-03T00:00:00.000Z');
  assert.deepEqual(artifact.targetProfiles, ['word', 'powerpoint']);
  assert.equal(artifact.realDogfoodPassClaim, false);
  assert.deepEqual(artifact.summary, {
    total: 2,
    launchSpecReady: 1,
    targetAppUnavailable: 1,
    blocked: 0,
    available: 1,
    unavailable: 1,
    unknown: 0,
  });

  const word = artifact.preflights.find((preflight) => preflight.profileId === 'word');
  assert.ok(word);
  assert.equal(word.status, 'launch-spec-ready');
  assert.equal(word.appAvailability.status, 'available');
  assert.equal(word.appAvailability.checkedBy, 'test-injected-availability');
  assert.equal(word.appAvailability.appPath, '/Applications/Microsoft Word.app');
  assert.equal(word.launchContract.hostApiRouteRef, VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF);
  assert.equal(word.realDogfoodPassClaim, false);

  const powerpoint = artifact.preflights.find((preflight) => preflight.profileId === 'powerpoint');
  assert.ok(powerpoint);
  assert.equal(powerpoint.status, 'target-app-unavailable');
  assert.match(powerpoint.blockedReason ?? '', /Microsoft PowerPoint is not installed/u);
  assert.equal(powerpoint.realDogfoodPassClaim, false);

  assert.ok(artifact.preflights.every((preflight) => preflight.adapterProfileRef === VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF));
  assert.ok(artifact.preflights.every((preflight) => preflight.targetAppRef !== 'app:profile/vscode-editor'));
  assert.ok(artifact.preflights.every((preflight) => preflight.realDogfoodPassClaim === false));
});

test('VirtualAppScreen app-profile preflight env reader accepts explicit operator injection by default', () => {
  const availability = availabilityByProfileFromEnv({
    SCIFORGE_VIRTUAL_APP_SCREEN_APP_PROFILE_WORD_STATUS: 'available',
    SCIFORGE_VIRTUAL_APP_SCREEN_APP_PROFILE_WORD_APP_PATH: '/Applications/Microsoft Word.app',
    SCIFORGE_VIRTUAL_APP_SCREEN_APP_PROFILE_POWERPOINT_STATUS: 'unavailable',
    SCIFORGE_VIRTUAL_APP_SCREEN_APP_PROFILE_POWERPOINT_REASON: 'Microsoft PowerPoint is not installed on this machine',
  });

  assert.deepEqual(availability, {
    word: {
      status: 'available',
      appPath: '/Applications/Microsoft Word.app',
    },
    powerpoint: {
      status: 'unavailable',
      reason: 'Microsoft PowerPoint is not installed on this machine',
    },
  });
});

test('VirtualAppScreen app-profile local probe records installed-app availability without dogfood pass claims', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'virtual-app-screen-app-profile-local-probe-'));
  const applicationsDir = join(workspace, 'Applications');
  await mkdir(join(applicationsDir, 'Microsoft Word.app', 'Contents', 'MacOS'), { recursive: true });
  await writeFile(join(applicationsDir, 'Microsoft Word.app', 'Contents', 'MacOS', 'Microsoft Word'), '');

  const availability = await availabilityByProfileFromLocalProbe({
    platform: 'darwin',
    applicationsDirs: [applicationsDir],
  });

  assert.equal(availability.word?.status, 'available');
  assert.equal(availability.word?.checkedBy, 'local-installed-app-probe/darwin');
  assert.equal(availability.word?.appPath, join(applicationsDir, 'Microsoft Word.app'));
  assert.equal(availability.word?.bundleId, 'com.microsoft.Word');
  assert.equal(availability.powerpoint?.status, 'unavailable');
  assert.match(availability.powerpoint?.reason ?? '', /No installed app candidate matched/u);

  const artifact = buildVirtualAppScreenAppProfilePreflightArtifact({
    runId: 'local-probe-preflight',
    generatedAt: '2026-06-03T00:00:00.000Z',
    availabilityByProfile: availability,
  });

  assert.equal(artifact.realDogfoodPassClaim, false);
  assert.equal(artifact.summary.launchSpecReady, 1);
  assert.equal(artifact.summary.targetAppUnavailable, 1);
  assert.equal(artifact.realRunCommandTemplates.find((template) => template.profileId === 'word')?.status, 'ready');
  assert.equal(artifact.realRunCommandTemplates.find((template) => template.profileId === 'powerpoint')?.status, 'blocked');
  assert.ok(artifact.preflights.every((preflight) => preflight.realDogfoodPassClaim === false));
});

test('VirtualAppScreen app-profile local probe handles PowerPoint app paths with spaces as non-pass templates', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'virtual-app-screen-app-profile-powerpoint-probe-'));
  const applicationsDir = join(workspace, 'Applications');
  const appPath = join(applicationsDir, 'Microsoft PowerPoint.app');
  const commandPath = join(appPath, 'Contents', 'MacOS', 'Microsoft PowerPoint');
  await mkdir(join(appPath, 'Contents', 'MacOS'), { recursive: true });
  await writeFile(commandPath, '');

  const availability = await availabilityByProfileFromLocalProbe({
    platform: 'darwin',
    applicationsDirs: [applicationsDir],
  });
  const powerpoint = availability.powerpoint;

  assert.equal(powerpoint?.status, 'available');
  assert.equal(powerpoint?.bundleId, 'com.microsoft.Powerpoint');
  assert.equal(powerpoint?.appPath, appPath);
  assert.equal(powerpoint?.command, commandPath);

  const artifact = buildVirtualAppScreenAppProfilePreflightArtifact({
    runId: 'powerpoint-local-probe-preflight',
    generatedAt: '2026-06-03T00:00:00.000Z',
    availabilityByProfile: availability,
  });
  const template = artifact.realRunCommandTemplates.find((entry) => entry.profileId === 'powerpoint');

  assert.equal(artifact.realDogfoodPassClaim, false);
  assert.equal(artifact.summary.launchSpecReady, 1);
  assert.equal(template?.status, 'ready');
  assert.equal(template?.realDogfoodPassClaim, false);
  assert.match(template?.targetManifestPath ?? '', /powerpoint-current-run\/manifest\.json/u);
  assert.match(template?.command ?? '', /SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_COMMAND='\/usr\/bin\/open'/u);
  assert.match(template?.command ?? '', /SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON=/u);
  assert.doesNotMatch(template?.command ?? '', /Microsoft PowerPoint\.app\/Contents\/MacOS\/Microsoft PowerPoint/u);
});

test('VirtualAppScreen app-profile preflight real-run templates launch editable Office current-run files without bundle or app path shortcuts', async () => {
  const artifact = buildVirtualAppScreenAppProfilePreflightArtifact({
    runId: 'office-current-run-template-preflight',
    generatedAt: '2026-06-03T00:00:00.000Z',
    checkedBy: 'test-office-current-run-template',
    availabilityByProfile: {
      word: {
        status: 'available',
        bundleId: 'com.microsoft.Word',
      },
      powerpoint: {
        status: 'available',
        bundleId: 'com.microsoft.Powerpoint',
      },
    },
  });

  await assertOfficeCurrentRunTemplate(artifact, {
    profileId: 'word',
    bundleId: 'com.microsoft.Word',
    mode: 'document',
    targetFile: 'tests/fixtures/virtual-app-screen-app-profile-target-documents/word-current-run.docx',
    rejectTitlePattern: /(?:^Microsoft Word$|^Word$|Open Recent|Templates?|Template Gallery|Sign In|Protected View|Read[- ]?Only)/u,
    acceptedTitle: 'word-current-run.docx - Word',
    rejectedTitle: 'Microsoft Word - Open Recent',
  });
  await assertOfficeCurrentRunTemplate(artifact, {
    profileId: 'powerpoint',
    bundleId: 'com.microsoft.Powerpoint',
    mode: 'presentation',
    targetFile: 'tests/fixtures/virtual-app-screen-app-profile-target-documents/powerpoint-current-run.pptx',
    rejectTitlePattern: /(?:^Microsoft PowerPoint$|^PowerPoint$|New Presentation|Templates?|Template Gallery|Sign In|Protected View|Read[- ]?Only)/u,
    acceptedTitle: 'powerpoint-current-run.pptx - PowerPoint',
    rejectedTitle: 'New Presentation - PowerPoint',
  });
});

test('VirtualAppScreen app-profile preflight package scripts expose smoke and artifact entrypoints', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.equal(
    packageJson.scripts?.['smoke:virtual-app-screen-app-profile-preflight'],
    'node --import tsx --test tests/smoke/virtual-app-screen-app-profile-preflight-tool.test.ts',
  );
  assert.equal(
    packageJson.scripts?.['virtual-app-screen-app-profile-preflight'],
    'node --import tsx tools/virtual-app-screen-app-profile-preflight.ts',
  );
});

test('VirtualAppScreen app-profile preflight CLI writes a refs-first non-pass artifact from injected JSON', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'virtual-app-screen-app-profile-preflight-'));
  const availabilityPath = join(workspace, 'availability.json');
  const manifestPath = join(workspace, 'nested-artifacts', 'manifest.json');
  await writeFile(availabilityPath, JSON.stringify({
    word: {
      status: 'available',
      bundleId: 'com.microsoft.Word',
      evidenceRef: 'computer-use:native-host/app-availability/word/available.json',
    },
    powerpoint: {
      status: 'unavailable',
      reason: 'Microsoft PowerPoint is absent from this dogfood machine',
    },
  }, null, 2));

  const { stdout } = await execFileAsync('node', [
    '--import',
    'tsx',
    'tools/virtual-app-screen-app-profile-preflight.ts',
    '--run-id',
    'cli-app-profile-preflight',
    '--generated-at',
    '2026-06-03T00:00:00.000Z',
    '--checked-by',
    'operator-injected-json',
    '--availability-json',
    availabilityPath,
    '--out',
    manifestPath,
  ]);

  assert.match(stdout, /^\[recorded\] VirtualAppScreen app-profile preflight/);
  assert.match(stdout, /profiles=word,powerpoint/);
  assert.match(stdout, /realDogfoodPassClaim=false/);

  const artifact = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(artifact.schemaVersion, VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_ARTIFACT_SCHEMA);
  assert.equal(artifact.realDogfoodPassClaim, false);
  assert.equal(artifact.preflights.length, 2);
  assert.equal(artifact.preflights[0].profileId, 'word');
  assert.equal(artifact.preflights[0].status, 'launch-spec-ready');
  assert.equal(artifact.preflights[0].appAvailability.bundleId, 'com.microsoft.Word');
  assert.equal(artifact.preflights[0].appAvailability.checkedBy, 'operator-injected-json');
  assert.ok(artifact.preflights.every((preflight: { realDogfoodPassClaim?: unknown }) => preflight.realDogfoodPassClaim === false));
  assert.ok(JSON.stringify(artifact).includes('/Applications/Visual Studio Code.app') === false);
});

test('VirtualAppScreen app-profile preflight CLI can explicitly probe local app paths without claiming dogfood pass', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'virtual-app-screen-app-profile-preflight-probe-'));
  const applicationsDir = join(workspace, 'Applications');
  const manifestPath = join(workspace, 'nested-artifacts', 'manifest.json');
  await mkdir(join(applicationsDir, 'Microsoft Word.app', 'Contents', 'MacOS'), { recursive: true });
  await writeFile(join(applicationsDir, 'Microsoft Word.app', 'Contents', 'MacOS', 'Microsoft Word'), '');

  const { stdout } = await execFileAsync('node', [
    '--import',
    'tsx',
    'tools/virtual-app-screen-app-profile-preflight.ts',
    '--run-id',
    'cli-app-profile-local-probe',
    '--generated-at',
    '2026-06-03T00:00:00.000Z',
    '--probe-local-apps',
    '--probe-platform',
    'darwin',
    '--probe-applications-dir',
    applicationsDir,
    '--out',
    manifestPath,
  ]);

  assert.match(stdout, /^\[recorded\] VirtualAppScreen app-profile preflight/);
  assert.match(stdout, /localProbe=true/);
  assert.match(stdout, /realDogfoodPassClaim=false/);

  const artifact = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(artifact.schemaVersion, VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_ARTIFACT_SCHEMA);
  assert.equal(artifact.realDogfoodPassClaim, false);
  assert.equal(artifact.summary.launchSpecReady, 1);
  assert.equal(artifact.preflights.find((preflight: { profileId?: string }) => preflight.profileId === 'word')?.status, 'launch-spec-ready');
  const wordTemplate = artifact.realRunCommandTemplates.find((template: { profileId?: string }) => template.profileId === 'word');
  assert.equal(wordTemplate?.status, 'ready');
  assert.equal(wordTemplate?.realDogfoodPassClaim, false);
  assert.match(wordTemplate?.command ?? '', /SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_HUMAN_INPUT='1'/u);
  assert.match(wordTemplate?.command ?? '', /SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON=/u);
  assert.match(wordTemplate?.command ?? '', /smoke-virtual-app-screen-macos-real-human-input-opt-in\.test\.ts/u);
  assert.match(wordTemplate?.targetManifestPath ?? '', /word-current-run\/manifest\.json/u);
  assert.ok(artifact.preflights.every((preflight: { realDogfoodPassClaim?: unknown }) => preflight.realDogfoodPassClaim === false));
});

async function assertOfficeCurrentRunTemplate(
  artifact: ReturnType<typeof buildVirtualAppScreenAppProfilePreflightArtifact>,
  expected: {
    profileId: 'word' | 'powerpoint';
    bundleId: string;
    mode: 'document' | 'presentation';
    targetFile: string;
    rejectTitlePattern: RegExp;
    acceptedTitle: string;
    rejectedTitle: string;
  },
): Promise<void> {
  const template = artifact.realRunCommandTemplates.find((entry) => entry.profileId === expected.profileId);

  assert.equal(template?.status, 'ready', expected.profileId);
  if (template?.status !== 'ready') return;

  const targetAppJson = template.targetAppJson as Record<string, unknown>;
  const targetFile = targetAppJson.args && Array.isArray(targetAppJson.args) ? targetAppJson.args[2] : undefined;
  assert.equal(targetAppJson.command, '/usr/bin/open');
  assert.deepEqual(targetAppJson.args, ['-b', expected.bundleId, targetFile]);
  assert.equal(targetAppJson.bundleId, undefined);
  assert.equal(targetAppJson.appPath, undefined);
  assert.equal(targetAppJson.windowTitlePattern, undefined);
  assert.equal(typeof targetFile, 'string');
  assert.equal(targetFile, expected.targetFile);
  assert.doesNotMatch(String(targetFile), /^docs\/test-artifacts\//u);
  assert.equal((await stat(expected.targetFile)).isFile(), true);
  assert.match(template.command, /SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_COMMAND='\/usr\/bin\/open'/u);
  assert.doesNotMatch(template.command, /SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_BUNDLE_ID=/u);
  assert.doesNotMatch(template.command, /SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_APP_PATH=/u);
  assert.match(template.command, /SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON=/u);
  assert.match(template.command, /SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_WINDOW_TIMEOUT_MS='45000'/u);

  assert.deepEqual(targetAppJson.editableWindowReadiness, {
    required: true,
    mode: expected.mode,
    requireAxWindow: true,
    requireNonEmptyTitle: true,
    requireEditableSurfaceEvidence: true,
    rejectTitlePattern: expected.rejectTitlePattern.source,
  });
  const rejectTitlePattern = new RegExp(expected.rejectTitlePattern.source, 'u');
  assert.equal(rejectTitlePattern.test(expected.acceptedTitle), false);
  assert.equal(rejectTitlePattern.test(expected.rejectedTitle), true);
}
