import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  evaluateVirtualAppScreenAppProfilePreflight,
  type VirtualAppScreenAppProfileAvailabilityInput,
  type VirtualAppScreenAppProfilePreflightManifest,
} from '../src/runtime/computer-use/virtual-app-screen-app-profiles.js';

export const VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_ARTIFACT_SCHEMA =
  'sciforge.computer-use.virtual-app-screen-app-profile-preflight-artifact.v1' as const;

export type VirtualAppScreenAppProfilePreflightTarget = 'word' | 'powerpoint';
export type VirtualAppScreenAppProfileAvailabilityByProfile = Partial<Record<
  VirtualAppScreenAppProfilePreflightTarget,
  VirtualAppScreenAppProfileAvailabilityInput
>>;

export interface VirtualAppScreenAppProfilePreflightArtifact {
  schemaVersion: typeof VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_ARTIFACT_SCHEMA;
  status: 'recorded';
  runId: string;
  generatedAt: string;
  targetProfiles: VirtualAppScreenAppProfilePreflightTarget[];
  realDogfoodPassClaim: false;
  summary: {
    total: number;
    launchSpecReady: number;
    targetAppUnavailable: number;
    blocked: number;
    available: number;
    unavailable: number;
    unknown: number;
  };
  preflights: VirtualAppScreenAppProfilePreflightManifest[];
  realRunCommandTemplates: VirtualAppScreenAppProfileRealRunCommandTemplate[];
}

const TARGET_PROFILES: VirtualAppScreenAppProfilePreflightTarget[] = [
  'word',
  'powerpoint',
];
const OFFICE_REAL_RUN_WINDOW_TIMEOUT_MS = '45000';

export type VirtualAppScreenAppProfileRealRunCommandTemplate =
  | {
      status: 'ready';
      profileId: VirtualAppScreenAppProfilePreflightTarget;
      platform: 'darwin';
      targetManifestPath: string;
      command: string;
      targetAppJson: Record<string, unknown>;
      sequencingOnly: true;
      realDogfoodPassClaim: false;
    }
  | {
      status: 'blocked';
      profileId: VirtualAppScreenAppProfilePreflightTarget;
      platform: 'darwin';
      blockedReason: string;
      sequencingOnly: true;
      realDogfoodPassClaim: false;
    };

const DARWIN_APP_PROBE_SPECS: Record<VirtualAppScreenAppProfilePreflightTarget, {
  appNames: string[];
  bundleId: string;
  executableRelativePath?: string;
  processMatch: string;
  editableMode: 'document' | 'presentation';
  editableTargetFilePath: string;
  editableRejectTitlePattern: string;
}> = {
  word: {
    appNames: ['Microsoft Word.app'],
    bundleId: 'com.microsoft.Word',
    executableRelativePath: 'Contents/MacOS/Microsoft Word',
    processMatch: 'Microsoft Word|com\\.microsoft\\.Word',
    editableMode: 'document',
    editableTargetFilePath: 'tests/fixtures/virtual-app-screen-app-profile-target-documents/word-current-run.docx',
    editableRejectTitlePattern: '(?:^Microsoft Word$|^Word$|Open Recent|Templates?|Template Gallery|Sign In|Protected View|Read[- ]?Only)',
  },
  powerpoint: {
    appNames: ['Microsoft PowerPoint.app'],
    bundleId: 'com.microsoft.Powerpoint',
    executableRelativePath: 'Contents/MacOS/Microsoft PowerPoint',
    processMatch: 'Microsoft PowerPoint|PowerPoint|com\\.microsoft\\.Powerpoint',
    editableMode: 'presentation',
    editableTargetFilePath: 'tests/fixtures/virtual-app-screen-app-profile-target-documents/powerpoint-current-run.pptx',
    editableRejectTitlePattern: '(?:^Microsoft PowerPoint$|^PowerPoint$|New Presentation|Templates?|Template Gallery|Sign In|Protected View|Read[- ]?Only)',
  },
};

export function buildVirtualAppScreenAppProfilePreflightArtifact(options: {
  runId: string;
  generatedAt: string;
  checkedBy?: string;
  availabilityByProfile?: VirtualAppScreenAppProfileAvailabilityByProfile;
}): VirtualAppScreenAppProfilePreflightArtifact {
  const preflights = TARGET_PROFILES.map((profile) => evaluateVirtualAppScreenAppProfilePreflight({
    profile,
    availability: availabilityWithDefaultCheckedBy(options.availabilityByProfile?.[profile], options.checkedBy),
  }));
  return {
    schemaVersion: VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_ARTIFACT_SCHEMA,
    status: 'recorded',
    runId: options.runId,
    generatedAt: options.generatedAt,
    targetProfiles: [...TARGET_PROFILES],
    realDogfoodPassClaim: false,
    summary: summarizePreflights(preflights),
    preflights,
    realRunCommandTemplates: preflights.map((preflight) => realRunCommandTemplateForPreflight(preflight)),
  };
}

export function availabilityByProfileFromEnv(env: Record<string, string | undefined>): VirtualAppScreenAppProfileAvailabilityByProfile {
  return {
    word: availabilityFromEnv(env, 'WORD'),
    powerpoint: availabilityFromEnv(env, 'POWERPOINT'),
  };
}

export async function availabilityByProfileFromLocalProbe(options: {
  platform?: string;
  applicationsDirs?: readonly string[];
} = {}): Promise<VirtualAppScreenAppProfileAvailabilityByProfile> {
  const platform = options.platform ?? process.platform;
  const checkedBy = `local-installed-app-probe/${platform}`;
  if (platform !== 'darwin') {
    return Object.fromEntries(TARGET_PROFILES.map((profile) => [profile, {
      status: 'unknown',
      checkedBy,
      reason: `Local installed-app probe is not implemented for platform=${platform}.`,
    } satisfies VirtualAppScreenAppProfileAvailabilityInput])) as VirtualAppScreenAppProfileAvailabilityByProfile;
  }

  const applicationsDirs = options.applicationsDirs?.length
    ? [...options.applicationsDirs]
    : defaultDarwinApplicationsDirs();
  return Object.fromEntries(await Promise.all(TARGET_PROFILES.map(async (profile) => [
    profile,
    await probeDarwinAppAvailability(profile, applicationsDirs, checkedBy),
  ]))) as VirtualAppScreenAppProfileAvailabilityByProfile;
}

function availabilityFromEnv(
  env: Record<string, string | undefined>,
  token: string,
): VirtualAppScreenAppProfileAvailabilityInput {
  const prefix = `SCIFORGE_VIRTUAL_APP_SCREEN_APP_PROFILE_${token}_`;
  const availability: VirtualAppScreenAppProfileAvailabilityInput = {
    status: availabilityStatus(env[`${prefix}STATUS`]),
    evidenceRef: stringField(env[`${prefix}EVIDENCE_REF`]),
    checkedBy: stringField(env[`${prefix}CHECKED_BY`]),
    reason: stringField(env[`${prefix}REASON`]),
    appPath: stringField(env[`${prefix}APP_PATH`]),
    bundleId: stringField(env[`${prefix}BUNDLE_ID`]),
    command: stringField(env[`${prefix}COMMAND`]),
  };
  return stripUndefined(availability);
}

async function probeDarwinAppAvailability(
  profile: VirtualAppScreenAppProfilePreflightTarget,
  applicationsDirs: readonly string[],
  checkedBy: string,
): Promise<VirtualAppScreenAppProfileAvailabilityInput> {
  const spec = DARWIN_APP_PROBE_SPECS[profile];
  for (const applicationsDir of applicationsDirs) {
    for (const appName of spec.appNames) {
      const appPath = join(applicationsDir, appName);
      if (!(await pathExists(appPath))) continue;
      const command = spec.executableRelativePath
        ? join(appPath, spec.executableRelativePath)
        : undefined;
      return stripUndefined({
        status: 'available',
        checkedBy,
        appPath,
        bundleId: spec.bundleId,
        command: command && await pathExists(command) ? command : undefined,
      });
    }
  }
  return {
    status: 'unavailable',
    checkedBy,
    reason: `No installed app candidate matched ${spec.appNames.join(', ')} in ${applicationsDirs.join(', ')}.`,
    bundleId: spec.bundleId,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function defaultDarwinApplicationsDirs(): string[] {
  return [
    '/Applications',
    process.env.HOME ? join(process.env.HOME, 'Applications') : undefined,
  ].filter((entry): entry is string => Boolean(entry));
}

function availabilityWithDefaultCheckedBy(
  availability: VirtualAppScreenAppProfileAvailabilityInput | undefined,
  checkedBy: string | undefined,
): VirtualAppScreenAppProfileAvailabilityInput {
  const normalized: VirtualAppScreenAppProfileAvailabilityInput = {
    ...availability,
    checkedBy: availability?.checkedBy ?? checkedBy,
  };
  return stripUndefined(normalized);
}

function summarizePreflights(preflights: VirtualAppScreenAppProfilePreflightManifest[]) {
  return {
    total: preflights.length,
    launchSpecReady: preflights.filter((preflight) => preflight.status === 'launch-spec-ready').length,
    targetAppUnavailable: preflights.filter((preflight) => preflight.status === 'target-app-unavailable').length,
    blocked: preflights.filter((preflight) => preflight.status === 'blocked').length,
    available: preflights.filter((preflight) => preflight.appAvailability.status === 'available').length,
    unavailable: preflights.filter((preflight) => preflight.appAvailability.status === 'unavailable').length,
    unknown: preflights.filter((preflight) => preflight.appAvailability.status === 'unknown').length,
  };
}

function realRunCommandTemplateForPreflight(
  preflight: VirtualAppScreenAppProfilePreflightManifest,
): VirtualAppScreenAppProfileRealRunCommandTemplate {
  const profile = preflight.profileId as VirtualAppScreenAppProfilePreflightTarget | undefined;
  if (!profile || !TARGET_PROFILES.includes(profile)) {
    return blockedRealRunTemplate(profile ?? 'word', preflight.blockedReason ?? 'Preflight profile is not a target app profile.');
  }
  if (preflight.status !== 'launch-spec-ready') {
    return blockedRealRunTemplate(
      profile,
      preflight.blockedReason ?? `App profile ${profile} is not launch-spec-ready.`,
    );
  }

  const spec = DARWIN_APP_PROBE_SPECS[profile];
  const bundleId = preflight.appAvailability.bundleId ?? spec.bundleId;
  if (!bundleId) {
    return blockedRealRunTemplate(
      profile,
      `App profile ${profile} launch-spec-ready preflight is missing a bundle id for macOS editable current-run launch.`,
    );
  }

  const targetManifestPath = `docs/test-artifacts/virtual-app-screen-real-app-session/${profile}-current-run/manifest.json`;
  const targetFile = spec.editableTargetFilePath;
  const command = '/usr/bin/open';
  const args = ['-b', bundleId, targetFile];
  const targetAppJson = stripUndefined({
    kind: preflight.targetAppKind,
    name: preflight.targetAppName,
    command,
    args,
    processMatch: spec.processMatch,
    editableWindowReadiness: {
      required: true,
      mode: spec.editableMode,
      requireAxWindow: true,
      requireNonEmptyTitle: true,
      requireEditableSurfaceEvidence: true,
      rejectTitlePattern: spec.editableRejectTitlePattern,
    },
  });
  return {
    status: 'ready',
    profileId: profile,
    platform: 'darwin',
    targetManifestPath,
    command: [
      envAssignment('SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_HUMAN_INPUT', '1'),
      envAssignment('SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_DRIVER', '1'),
      envAssignment('SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS', '1'),
      envAssignment('SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_PERMISSION_GRANTS', '1'),
      envAssignment('SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_WINDOW_TIMEOUT_MS', OFFICE_REAL_RUN_WINDOW_TIMEOUT_MS),
      envAssignment('SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND', preflight.targetAppKind),
      envAssignment('SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_NAME', preflight.targetAppName),
      envAssignment('SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_COMMAND', command),
      envAssignment('SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON', JSON.stringify(args)),
      envAssignment('SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_PROCESS_MATCH', spec.processMatch),
      envAssignment('SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON', JSON.stringify(targetAppJson)),
      envAssignment('SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND', 'npm'),
      envAssignment(
        'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON',
        JSON.stringify(['run', 'virtual-app-screen-macos-pid-scoped-ax-hook', '--silent']),
      ),
      envAssignment('SCIFORGE_VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_MANIFEST', targetManifestPath),
      'node --import tsx --test tests/smoke/smoke-virtual-app-screen-macos-real-human-input-opt-in.test.ts',
    ].filter((part): part is string => Boolean(part)).join(' '),
    targetAppJson,
    sequencingOnly: true,
    realDogfoodPassClaim: false,
  };
}

function blockedRealRunTemplate(
  profileId: VirtualAppScreenAppProfilePreflightTarget,
  blockedReason: string,
): VirtualAppScreenAppProfileRealRunCommandTemplate {
  return {
    status: 'blocked',
    profileId,
    platform: 'darwin',
    blockedReason,
    sequencingOnly: true,
    realDogfoodPassClaim: false,
  };
}

function envAssignment(name: string, value: string | undefined): string | undefined {
  return value ? `${name}=${shellQuote(value)}` : undefined;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function availabilityStatus(value: string | undefined): VirtualAppScreenAppProfileAvailabilityInput['status'] | undefined {
  return value === 'available' || value === 'unavailable' || value === 'unknown' ? value : undefined;
}

function stringField(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function cliArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function cliArgs(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function cliFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const runId = cliArg('--run-id') ?? `app-profile-preflight-${Date.now()}`;
  const generatedAt = cliArg('--generated-at') ?? new Date().toISOString();
  const checkedBy = cliArg('--checked-by');
  const availabilityJson = cliArg('--availability-json');
  const out = cliArg('--out');
  const localProbe = cliFlag('--probe-local-apps') || cliFlag('--probe-local-installed-apps');
  const availabilityByProfile = availabilityJson
    ? JSON.parse(await readFile(availabilityJson, 'utf8')) as VirtualAppScreenAppProfileAvailabilityByProfile
    : localProbe
      ? await availabilityByProfileFromLocalProbe({
        platform: cliArg('--probe-platform'),
        applicationsDirs: cliArgs('--probe-applications-dir'),
      })
    : availabilityByProfileFromEnv(process.env);
  const artifact = buildVirtualAppScreenAppProfilePreflightArtifact({
    runId,
    generatedAt,
    checkedBy,
    availabilityByProfile,
  });
  if (out) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(
    `[recorded] VirtualAppScreen app-profile preflight runId=${runId} profiles=${artifact.targetProfiles.join(',')} localProbe=${localProbe} realDogfoodPassClaim=false\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
