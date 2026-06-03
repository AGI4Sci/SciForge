export const VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF =
  'adapter-profile:virtual-app-screen/generic-host-api' as const;
export const VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_PROFILE_ID = 'vscode-editor' as const;
export const VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV =
  'SCIFORGE_VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST' as const;
export const VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA =
  'sciforge.computer-use.virtual-app-screen-real-host-session-evidence.v1' as const;
export const VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_MANIFEST_SCHEMA =
  'sciforge.computer-use.virtual-app-screen-app-profile-preflight.v1' as const;
const VIRTUAL_APP_SCREEN_APP_PROFILE_CURRENT_PASS_PLATFORM_PROVIDER = 'macos';

export interface VirtualAppScreenAppProfile {
  profileId: string;
  aliases: string[];
  adapterProfileRef: string;
  targetAppKind: string;
  targetAppName: string;
  targetAppRef: string;
  registryMetadataOnly: true;
  dogfoodSequencingGuard?: VirtualAppScreenAppProfileDogfoodSequencingGuard;
}

export type VirtualAppScreenAppProfileResolution =
  | ({ status: 'resolved' } & VirtualAppScreenAppProfile)
  | { status: 'blocked'; requestedProfile: string; blockedReason: string };

export interface VirtualAppScreenAppProfileDogfoodSequencingGuard {
  requiredProfileId: typeof VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_PROFILE_ID;
  requiredManifestEnv: typeof VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV;
  requiredSchemaVersion: typeof VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA;
  sequencingOnly: true;
}

export type VirtualAppScreenAppProfileDogfoodGate =
  | {
      status: 'sequencing-ready';
      profileId: string;
      targetAppRef: string;
      adapterProfileRef: string;
      requiredProfileId: typeof VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_PROFILE_ID;
      requiredManifestEnv: typeof VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV;
      requiredSchemaVersion: typeof VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA;
      evidenceManifestRef?: string;
      targetEvidenceManifestRef?: string;
      blockedReason?: string;
      sequencingOnly: true;
      realDogfoodPassClaim: false;
    }
  | {
      status: 'not-required';
      profileId: string;
      targetAppRef: string;
      adapterProfileRef: string;
      sequencingOnly: true;
      realDogfoodPassClaim: false;
    }
  | {
      status: 'blocked';
      requestedProfile: string;
      profileId?: string;
      targetAppRef?: string;
      adapterProfileRef?: string;
      requiredProfileId: typeof VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_PROFILE_ID;
      requiredManifestEnv: typeof VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV;
      requiredSchemaVersion: typeof VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA;
      blockedReason: string;
      sequencingOnly: true;
      realDogfoodPassClaim: false;
    };

export type VirtualAppScreenAppProfileTargetDogfoodPassGate =
  | {
      status: 'passed';
      profileId: string;
      targetAppRef: string;
      adapterProfileRef: string;
      requiredProfileId: typeof VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_PROFILE_ID;
      requiredManifestEnv: typeof VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV;
      requiredSchemaVersion: typeof VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA;
      evidenceManifestRef?: string;
      appProfilePreflightRef?: string;
      targetEvidenceManifestRef?: string;
      sequencingOnly: false;
      realDogfoodPassClaim: true;
    }
  | {
      status: 'blocked';
      requestedProfile: string;
      profileId?: string;
      targetAppRef?: string;
      adapterProfileRef?: string;
      requiredProfileId: typeof VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_PROFILE_ID;
      requiredManifestEnv: typeof VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV;
      requiredSchemaVersion: typeof VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA;
      blockedReason: string;
      sequencingOnly: false;
      realDogfoodPassClaim: false;
    };

export type VirtualAppScreenAppProfileAvailabilityStatus = 'available' | 'unavailable' | 'unknown';

export interface VirtualAppScreenAppProfileAvailabilityInput {
  status?: VirtualAppScreenAppProfileAvailabilityStatus;
  evidenceRef?: string;
  checkedBy?: string;
  reason?: string;
  appPath?: string;
  bundleId?: string;
  command?: string;
}

export interface VirtualAppScreenAppProfileAvailabilityRecord {
  status: VirtualAppScreenAppProfileAvailabilityStatus;
  evidenceRef?: string;
  checkedBy?: string;
  reason?: string;
  appPath?: string;
  bundleId?: string;
  command?: string;
}

export interface VirtualAppScreenAppProfilePreflightLaunchContract {
  status: 'ready' | 'blocked';
  hostApiRouteRef?: typeof VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF;
  adapterProfileRef?: string;
  targetAppKind?: string;
  targetAppRef?: string;
  registryMetadataOnly?: true;
  blockedReason?: string;
}

export type VirtualAppScreenAppProfilePreflightManifest = {
  schemaVersion: typeof VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_MANIFEST_SCHEMA;
  status: 'launch-spec-ready' | 'target-app-unavailable' | 'blocked';
  requestedProfile: string;
  profileId?: string;
  targetAppKind?: string;
  targetAppName?: string;
  targetAppRef?: string;
  adapterProfileRef?: string;
  launchContract: VirtualAppScreenAppProfilePreflightLaunchContract;
  appAvailability: VirtualAppScreenAppProfileAvailabilityRecord;
  blockedReason?: string;
  realDogfoodPassClaim: false;
};

const vscodeRealClosedLoopGuard: VirtualAppScreenAppProfileDogfoodSequencingGuard = {
  requiredProfileId: VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_PROFILE_ID,
  requiredManifestEnv: VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
  requiredSchemaVersion: VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA,
  sequencingOnly: true,
};

const profiles: VirtualAppScreenAppProfile[] = [
  {
    profileId: 'vscode-editor',
    aliases: [
      'vscode-editor-low-risk',
      'vscode-local-native-virtual-display',
      'code',
      'visual-studio-code',
    ],
    adapterProfileRef: 'adapter-profile:virtual-app-screen/vscode-local-native-virtual-display',
    targetAppKind: 'vscode',
    targetAppName: 'VSCode',
    targetAppRef: 'app:profile/vscode-editor',
    registryMetadataOnly: true,
  },
  {
    profileId: 'word',
    aliases: ['microsoft-word', 'ms-word'],
    adapterProfileRef: VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF,
    targetAppKind: 'word',
    targetAppName: 'Microsoft Word',
    targetAppRef: 'app:profile/word',
    registryMetadataOnly: true,
    dogfoodSequencingGuard: vscodeRealClosedLoopGuard,
  },
  {
    profileId: 'powerpoint',
    aliases: ['ppt', 'microsoft-powerpoint', 'ms-powerpoint'],
    adapterProfileRef: VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF,
    targetAppKind: 'powerpoint',
    targetAppName: 'Microsoft PowerPoint',
    targetAppRef: 'app:profile/powerpoint',
    registryMetadataOnly: true,
    dogfoodSequencingGuard: vscodeRealClosedLoopGuard,
  },
  {
    profileId: 'generic-editor',
    aliases: [],
    adapterProfileRef: 'adapter-profile:virtual-app-screen/generic-contract-editor',
    targetAppKind: 'generic-editor',
    targetAppName: 'Generic Editor',
    targetAppRef: 'app:profile/generic-editor',
    registryMetadataOnly: true,
  },
];

export function resolveVirtualAppScreenAppProfile(options: {
  profile?: string;
  targetAppRef?: string;
}): VirtualAppScreenAppProfileResolution {
  const requestedProfile = normalizedProfile(options.profile ?? profileFromTargetAppRef(options.targetAppRef));
  if (!requestedProfile) {
    return blockedProfile('unknown');
  }
  for (const profile of profiles) {
    if (requestedProfile === profile.profileId || profile.aliases.includes(requestedProfile)) {
      return { status: 'resolved', ...profile };
    }
  }
  return blockedProfile(requestedProfile);
}

export function virtualAppScreenAppProfileBlockedReason(resolution: VirtualAppScreenAppProfileResolution) {
  return resolution.status === 'blocked'
    ? resolution.blockedReason
    : undefined;
}

export function evaluateVirtualAppScreenAppProfileDogfoodGate(options: {
  profile?: string;
  targetAppRef?: string;
  vsCodeRealClosedLoopEvidenceManifest?: unknown;
  evidenceManifestRef?: string;
  targetRealSessionEvidenceManifest?: unknown;
  targetEvidenceManifestRef?: string;
  appProfilePreflightManifest?: unknown;
}): VirtualAppScreenAppProfileDogfoodGate {
  const resolution = resolveVirtualAppScreenAppProfile({
    profile: options.profile,
    targetAppRef: options.targetAppRef,
  });
  if (resolution.status === 'blocked') {
    return blockedDogfoodGate({
      requestedProfile: resolution.requestedProfile,
      blockedReason: resolution.blockedReason,
    });
  }
  const guard = resolution.dogfoodSequencingGuard;
  if (!guard) {
    return {
      status: 'not-required',
      profileId: resolution.profileId,
      targetAppRef: resolution.targetAppRef,
      adapterProfileRef: resolution.adapterProfileRef,
      sequencingOnly: true,
      realDogfoodPassClaim: false,
    };
  }
  const preflightProblem = options.appProfilePreflightManifest === undefined
    ? undefined
    : validateAppProfilePreflightManifest(options.appProfilePreflightManifest, {
      profileId: resolution.profileId,
      targetAppRef: resolution.targetAppRef,
    });
  const manifestProblem = validateRealSessionEvidenceManifest(options.vsCodeRealClosedLoopEvidenceManifest, {
    targetAppProfile: VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_PROFILE_ID,
    targetAppRef: 'app:profile/vscode-editor',
    platformProvider: VIRTUAL_APP_SCREEN_APP_PROFILE_CURRENT_PASS_PLATFORM_PROVIDER,
    missingManifestReason: 'VS Code real closed-loop evidence manifest is missing.',
  });
  if (manifestProblem) {
    return blockedDogfoodGate({
      requestedProfile: resolution.profileId,
      profileId: resolution.profileId,
      targetAppRef: resolution.targetAppRef,
      adapterProfileRef: resolution.adapterProfileRef,
      blockedReason: [
        `VirtualAppScreen app profile "${resolution.profileId}" dogfood is sequenced after VS Code real closed-loop evidence.`,
        `Set ${guard.requiredManifestEnv} to a passed ${guard.requiredSchemaVersion} manifest with targetAppProfile=vscode-editor before running app-profile dogfood.`,
        manifestProblem,
      ].join(' '),
    });
  }
  if (preflightProblem) {
    return blockedDogfoodGate({
      requestedProfile: resolution.profileId,
      profileId: resolution.profileId,
      targetAppRef: resolution.targetAppRef,
      adapterProfileRef: resolution.adapterProfileRef,
      blockedReason: [
        `VirtualAppScreen app profile "${resolution.profileId}" preflight manifest is invalid.`,
        preflightProblem,
      ].join(' '),
    });
  }
  const targetManifestProblem = validateRealSessionEvidenceManifest(options.targetRealSessionEvidenceManifest, {
    targetAppProfile: resolution.profileId,
    targetAppRef: resolution.targetAppRef,
    platformProvider: VIRTUAL_APP_SCREEN_APP_PROFILE_CURRENT_PASS_PLATFORM_PROVIDER,
    missingManifestReason: [
      `Current-run real session evidence manifest for targetAppProfile=${resolution.profileId} is missing.`,
      'VS Code real closed-loop evidence only clears sequencing.',
    ].join(' '),
  });
  if (!targetManifestProblem) {
    return {
      status: 'sequencing-ready',
      profileId: resolution.profileId,
      targetAppRef: resolution.targetAppRef,
      adapterProfileRef: resolution.adapterProfileRef,
      requiredProfileId: guard.requiredProfileId,
      requiredManifestEnv: guard.requiredManifestEnv,
      requiredSchemaVersion: guard.requiredSchemaVersion,
      evidenceManifestRef: options.evidenceManifestRef,
      targetEvidenceManifestRef: options.targetEvidenceManifestRef,
      blockedReason: 'VirtualAppScreen app-profile preflight is not real dogfood evidence; this gate records profile launch/app availability state only and never sets a real target-app dogfood pass.',
      sequencingOnly: true,
      realDogfoodPassClaim: false,
    };
  }
  return {
    status: 'sequencing-ready',
    profileId: resolution.profileId,
    targetAppRef: resolution.targetAppRef,
    adapterProfileRef: resolution.adapterProfileRef,
    requiredProfileId: guard.requiredProfileId,
    requiredManifestEnv: guard.requiredManifestEnv,
    requiredSchemaVersion: guard.requiredSchemaVersion,
    evidenceManifestRef: options.evidenceManifestRef,
    targetEvidenceManifestRef: options.targetEvidenceManifestRef,
    blockedReason: targetManifestProblem,
    sequencingOnly: true,
    realDogfoodPassClaim: false,
  };
}

export function evaluateVirtualAppScreenAppProfileTargetDogfoodPassGate(options: {
  profile?: string;
  targetAppRef?: string;
  vsCodeRealClosedLoopEvidenceManifest?: unknown;
  evidenceManifestRef?: string;
  appProfilePreflightManifest?: unknown;
  appProfilePreflightRef?: string;
  targetRealSessionEvidenceManifest?: unknown;
  targetEvidenceManifestRef?: string;
}): VirtualAppScreenAppProfileTargetDogfoodPassGate {
  const resolution = resolveVirtualAppScreenAppProfile({
    profile: options.profile,
    targetAppRef: options.targetAppRef,
  });
  if (resolution.status === 'blocked') {
    return blockedTargetDogfoodPassGate({
      requestedProfile: resolution.requestedProfile,
      blockedReason: resolution.blockedReason,
    });
  }

  const guard = resolution.dogfoodSequencingGuard;
  if (!guard) {
    return blockedTargetDogfoodPassGate({
      requestedProfile: resolution.profileId,
      profileId: resolution.profileId,
      targetAppRef: resolution.targetAppRef,
      adapterProfileRef: resolution.adapterProfileRef,
      blockedReason: `VirtualAppScreen app profile "${resolution.profileId}" does not have a target-app dogfood sequencing guard.`,
    });
  }

  const sequencingProblem = validateRealSessionEvidenceManifest(options.vsCodeRealClosedLoopEvidenceManifest, {
    targetAppProfile: VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_PROFILE_ID,
    targetAppRef: 'app:profile/vscode-editor',
    platformProvider: VIRTUAL_APP_SCREEN_APP_PROFILE_CURRENT_PASS_PLATFORM_PROVIDER,
    missingManifestReason: 'VS Code real closed-loop evidence manifest is missing.',
  });
  if (sequencingProblem) {
    return blockedTargetDogfoodPassGate({
      requestedProfile: resolution.profileId,
      profileId: resolution.profileId,
      targetAppRef: resolution.targetAppRef,
      adapterProfileRef: resolution.adapterProfileRef,
      blockedReason: [
        `VirtualAppScreen app profile "${resolution.profileId}" target dogfood pass is sequenced after VS Code real closed-loop evidence.`,
        sequencingProblem,
      ].join(' '),
    });
  }

  const preflightProblem = validateLaunchSpecReadyAppProfilePreflightManifest(options.appProfilePreflightManifest, {
    profileId: resolution.profileId,
    targetAppRef: resolution.targetAppRef,
  });
  if (preflightProblem) {
    return blockedTargetDogfoodPassGate({
      requestedProfile: resolution.profileId,
      profileId: resolution.profileId,
      targetAppRef: resolution.targetAppRef,
      adapterProfileRef: resolution.adapterProfileRef,
      blockedReason: [
        `VirtualAppScreen app profile "${resolution.profileId}" target dogfood pass requires launch-spec-ready preflight evidence.`,
        preflightProblem,
      ].join(' '),
    });
  }

  const targetManifestProblem = validateRealSessionEvidenceManifest(options.targetRealSessionEvidenceManifest, {
    targetAppProfile: resolution.profileId,
    targetAppRef: resolution.targetAppRef,
    platformProvider: VIRTUAL_APP_SCREEN_APP_PROFILE_CURRENT_PASS_PLATFORM_PROVIDER,
    missingManifestReason: `Current-run real session evidence manifest for targetAppProfile=${resolution.profileId} is missing.`,
  });
  if (targetManifestProblem) {
    return blockedTargetDogfoodPassGate({
      requestedProfile: resolution.profileId,
      profileId: resolution.profileId,
      targetAppRef: resolution.targetAppRef,
      adapterProfileRef: resolution.adapterProfileRef,
      blockedReason: [
        `VirtualAppScreen app profile "${resolution.profileId}" target dogfood pass requires a matching current-run real session evidence manifest.`,
        targetManifestProblem,
      ].join(' '),
    });
  }

  const evidenceRefProblem = validateTargetDogfoodPassEvidenceRefs(options);
  if (evidenceRefProblem) {
    return blockedTargetDogfoodPassGate({
      requestedProfile: resolution.profileId,
      profileId: resolution.profileId,
      targetAppRef: resolution.targetAppRef,
      adapterProfileRef: resolution.adapterProfileRef,
      blockedReason: [
        `VirtualAppScreen app profile "${resolution.profileId}" target dogfood pass requires refs-backed evidence refs.`,
        evidenceRefProblem,
      ].join(' '),
    });
  }

  return {
    status: 'passed',
    profileId: resolution.profileId,
    targetAppRef: resolution.targetAppRef,
    adapterProfileRef: resolution.adapterProfileRef,
    requiredProfileId: guard.requiredProfileId,
    requiredManifestEnv: guard.requiredManifestEnv,
    requiredSchemaVersion: guard.requiredSchemaVersion,
    evidenceManifestRef: options.evidenceManifestRef,
    appProfilePreflightRef: options.appProfilePreflightRef,
    targetEvidenceManifestRef: options.targetEvidenceManifestRef,
    sequencingOnly: false,
    realDogfoodPassClaim: true,
  };
}

function validateTargetDogfoodPassEvidenceRefs(options: {
  evidenceManifestRef?: string;
  appProfilePreflightRef?: string;
  targetEvidenceManifestRef?: string;
}): string | undefined {
  const missing = [
    stringRef(options.evidenceManifestRef) ? undefined : 'evidenceManifestRef',
    stringRef(options.appProfilePreflightRef) ? undefined : 'appProfilePreflightRef',
    stringRef(options.targetEvidenceManifestRef) ? undefined : 'targetEvidenceManifestRef',
  ].filter((field): field is string => Boolean(field));
  return missing.length ? `Missing evidence refs: ${missing.join(', ')}.` : undefined;
}

function stringRef(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function evaluateVirtualAppScreenAppProfilePreflight(options: {
  profile?: string;
  targetAppRef?: string;
  availability?: VirtualAppScreenAppProfileAvailabilityInput;
}): VirtualAppScreenAppProfilePreflightManifest {
  const requestedProfile = normalizedProfile(options.profile ?? profileFromTargetAppRef(options.targetAppRef)) ?? 'unknown';
  const appAvailability = normalizeAppProfileAvailability(options.availability);
  const resolution = resolveVirtualAppScreenAppProfile({
    profile: options.profile,
    targetAppRef: options.targetAppRef,
  });

  if (resolution.status === 'blocked') {
    return blockedPreflightManifest({
      requestedProfile: resolution.requestedProfile,
      appAvailability,
      blockedReason: resolution.blockedReason,
    });
  }

  if (resolution.adapterProfileRef !== VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF) {
    return blockedPreflightManifest({
      requestedProfile,
      profile: resolution,
      appAvailability,
      blockedReason: [
        `VirtualAppScreen app profile "${resolution.profileId}" preflight requires the generic Host API route.`,
        `adapterProfileRef=${VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF} is required; got ${resolution.adapterProfileRef}.`,
      ].join(' '),
    });
  }

  if (appAvailability.status !== 'available') {
    return {
      ...basePreflightManifest(requestedProfile, resolution, appAvailability),
      status: 'target-app-unavailable',
      launchContract: readyGenericHostLaunchContract(resolution),
      blockedReason: appAvailability.reason
        ?? `Target app availability for "${resolution.targetAppName}" was not injected as available; preflight does not probe local machines.`,
      realDogfoodPassClaim: false,
    };
  }

  return {
    ...basePreflightManifest(requestedProfile, resolution, appAvailability),
    status: 'launch-spec-ready',
    launchContract: readyGenericHostLaunchContract(resolution),
    realDogfoodPassClaim: false,
  };
}

function profileFromTargetAppRef(ref: string | undefined) {
  const match = ref?.trim().match(/^app:profile\/([A-Za-z0-9._/-]+)$/);
  return match?.[1];
}

function normalizedProfile(value: string | undefined) {
  const profile = value?.trim();
  if (!profile) return undefined;
  return profile.match(/^app:profile\/([A-Za-z0-9._/-]+)$/)?.[1] ?? profile;
}

function normalizeAppProfileAvailability(
  availability: VirtualAppScreenAppProfileAvailabilityInput | undefined,
): VirtualAppScreenAppProfileAvailabilityRecord {
  return {
    status: availabilityStatusFromUnknown(availability?.status),
    ...optionalStringField('evidenceRef', availability?.evidenceRef),
    ...optionalStringField('checkedBy', availability?.checkedBy),
    ...optionalStringField('reason', availability?.reason),
    ...optionalStringField('appPath', availability?.appPath),
    ...optionalStringField('bundleId', availability?.bundleId),
    ...optionalStringField('command', availability?.command),
  };
}

function availabilityStatusFromUnknown(value: unknown): VirtualAppScreenAppProfileAvailabilityStatus {
  return value === 'available' || value === 'unavailable' || value === 'unknown'
    ? value
    : 'unknown';
}

function optionalStringField<const Key extends string>(key: Key, value: unknown): { [K in Key]?: string } {
  return typeof value === 'string' && value.trim()
    ? { [key]: value } as { [K in Key]?: string }
    : {};
}

function basePreflightManifest(
  requestedProfile: string,
  profile: VirtualAppScreenAppProfile,
  appAvailability: VirtualAppScreenAppProfileAvailabilityRecord,
): Omit<VirtualAppScreenAppProfilePreflightManifest, 'status' | 'launchContract' | 'blockedReason' | 'realDogfoodPassClaim'> {
  return {
    schemaVersion: VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_MANIFEST_SCHEMA,
    requestedProfile,
    profileId: profile.profileId,
    targetAppKind: profile.targetAppKind,
    targetAppName: profile.targetAppName,
    targetAppRef: profile.targetAppRef,
    adapterProfileRef: profile.adapterProfileRef,
    appAvailability,
  };
}

function readyGenericHostLaunchContract(
  profile: VirtualAppScreenAppProfile,
): VirtualAppScreenAppProfilePreflightLaunchContract {
  return {
    status: 'ready',
    hostApiRouteRef: VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF,
    adapterProfileRef: profile.adapterProfileRef,
    targetAppKind: profile.targetAppKind,
    targetAppRef: profile.targetAppRef,
    registryMetadataOnly: profile.registryMetadataOnly,
  };
}

function blockedPreflightManifest(options: {
  requestedProfile: string;
  profile?: VirtualAppScreenAppProfile;
  appAvailability: VirtualAppScreenAppProfileAvailabilityRecord;
  blockedReason: string;
}): VirtualAppScreenAppProfilePreflightManifest {
  return {
    schemaVersion: VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_MANIFEST_SCHEMA,
    status: 'blocked',
    requestedProfile: options.requestedProfile,
    profileId: options.profile?.profileId,
    targetAppKind: options.profile?.targetAppKind,
    targetAppName: options.profile?.targetAppName,
    targetAppRef: options.profile?.targetAppRef,
    adapterProfileRef: options.profile?.adapterProfileRef,
    launchContract: {
      status: 'blocked',
      adapterProfileRef: options.profile?.adapterProfileRef,
      targetAppKind: options.profile?.targetAppKind,
      targetAppRef: options.profile?.targetAppRef,
      blockedReason: options.blockedReason,
    },
    appAvailability: options.appAvailability,
    blockedReason: options.blockedReason,
    realDogfoodPassClaim: false,
  };
}

function blockedProfile(requestedProfile: string): VirtualAppScreenAppProfileResolution {
  return {
    status: 'blocked',
    requestedProfile,
    blockedReason: `VirtualAppScreen app profile "${requestedProfile}" is not registered for native provider resolution.`,
  };
}

function blockedDogfoodGate(options: {
  requestedProfile: string;
  profileId?: string;
  targetAppRef?: string;
  adapterProfileRef?: string;
  blockedReason: string;
}): VirtualAppScreenAppProfileDogfoodGate {
  return {
    status: 'blocked',
    requestedProfile: options.requestedProfile,
    profileId: options.profileId,
    targetAppRef: options.targetAppRef,
    adapterProfileRef: options.adapterProfileRef,
    requiredProfileId: VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_PROFILE_ID,
    requiredManifestEnv: VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
    requiredSchemaVersion: VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA,
    blockedReason: options.blockedReason,
    sequencingOnly: true,
    realDogfoodPassClaim: false,
  };
}

function blockedTargetDogfoodPassGate(options: {
  requestedProfile: string;
  profileId?: string;
  targetAppRef?: string;
  adapterProfileRef?: string;
  blockedReason: string;
}): VirtualAppScreenAppProfileTargetDogfoodPassGate {
  return {
    status: 'blocked',
    requestedProfile: options.requestedProfile,
    profileId: options.profileId,
    targetAppRef: options.targetAppRef,
    adapterProfileRef: options.adapterProfileRef,
    requiredProfileId: VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_PROFILE_ID,
    requiredManifestEnv: VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
    requiredSchemaVersion: VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA,
    blockedReason: options.blockedReason,
    sequencingOnly: false,
    realDogfoodPassClaim: false,
  };
}

function validateRealSessionEvidenceManifest(
  manifest: unknown,
  requirements: {
    targetAppProfile: string;
    targetAppRef: string;
    platformProvider: string;
    missingManifestReason: string;
  },
): string | undefined {
  const record = objectRecord(manifest);
  if (!record) {
    return requirements.missingManifestReason;
  }

  const failures = [
    record.schemaVersion === VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA
      ? undefined
      : `schemaVersion=${VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA} is required.`,
    record.status === 'passed' ? undefined : 'status=passed is required.',
    record.targetAppProfile === requirements.targetAppProfile
      ? undefined
      : `targetAppProfile=${requirements.targetAppProfile} is required.`,
    record.platformProvider === requirements.platformProvider
      ? undefined
      : `platformProvider=${requirements.platformProvider} is required for current app-profile dogfood pass claims.`,
    record.diagnosticOnly === false ? undefined : 'diagnosticOnly=false is required.',
    record.refsFirst === true ? undefined : 'refsFirst=true is required.',
    validateManifestValidation(record.validation),
    validateDogfoodRefs(record.dogfoodRefs, requirements.targetAppRef),
    validateRealVirtualAppScreenClaim(record.userAcceptanceInput),
    forbiddenEvidenceStringFailure(record),
  ].filter((failure): failure is string => Boolean(failure));

  return failures.length ? failures.join(' ') : undefined;
}

function validateManifestValidation(value: unknown): string | undefined {
  const validation = objectRecord(value);
  if (!validation) return 'validation.ok=true and validation.missing=[] are required.';
  if (validation.ok !== true) return 'validation.ok=true is required.';
  const missing = Array.isArray(validation.missing) ? validation.missing : [];
  return missing.length === 0 ? undefined : 'validation.missing=[] is required.';
}

function validateAppProfilePreflightManifest(
  manifest: unknown,
  requirements: {
    profileId: string;
    targetAppRef: string;
  },
): string | undefined {
  const record = objectRecord(manifest);
  if (!record) {
    return 'app-profile preflight manifest is required.';
  }
  const launchContract = objectRecord(record.launchContract);
  const appAvailability = objectRecord(record.appAvailability);
  const failures = [
    record.schemaVersion === VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_MANIFEST_SCHEMA
      ? undefined
      : `schemaVersion=${VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_MANIFEST_SCHEMA} is required.`,
    isAppProfilePreflightStatus(record.status)
      ? undefined
      : 'status must be launch-spec-ready, target-app-unavailable, or blocked.',
    record.profileId === requirements.profileId
      ? undefined
      : `profileId=${requirements.profileId} is required.`,
    record.targetAppRef === requirements.targetAppRef
      ? undefined
      : `targetAppRef=${requirements.targetAppRef} is required.`,
    record.adapterProfileRef === VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF
      ? undefined
      : `adapterProfileRef=${VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF} is required.`,
    record.realDogfoodPassClaim === false
      ? undefined
      : 'realDogfoodPassClaim=false is required for app-profile preflight manifests.',
    launchContract ? undefined : 'launchContract is required.',
    appAvailability ? undefined : 'appAvailability is required.',
  ];

  if (record.status === 'launch-spec-ready') {
    failures.push(
      launchContract?.status === 'ready' ? undefined : 'launchContract.status=ready is required.',
      launchContract?.hostApiRouteRef === VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF
        ? undefined
        : `launchContract.hostApiRouteRef=${VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF} is required.`,
      appAvailability?.status === 'available' ? undefined : 'appAvailability.status=available is required.',
    );
  }

  return failures.filter((failure): failure is string => Boolean(failure)).join(' ') || undefined;
}

function validateLaunchSpecReadyAppProfilePreflightManifest(
  manifest: unknown,
  requirements: {
    profileId: string;
    targetAppRef: string;
  },
): string | undefined {
  const generalProblem = validateAppProfilePreflightManifest(manifest, requirements);
  if (generalProblem) return generalProblem;

  const record = objectRecord(manifest);
  const launchContract = objectRecord(record?.launchContract);
  const appAvailability = objectRecord(record?.appAvailability);
  const failures = [
    record?.status === 'launch-spec-ready'
      ? undefined
      : 'status=launch-spec-ready is required.',
    launchContract?.status === 'ready'
      ? undefined
      : 'launchContract.status=ready is required.',
    appAvailability?.status === 'available'
      ? undefined
      : 'appAvailability.status=available is required.',
  ].filter((failure): failure is string => Boolean(failure));

  return failures.join(' ') || undefined;
}

function isAppProfilePreflightStatus(value: unknown): value is VirtualAppScreenAppProfilePreflightManifest['status'] {
  return value === 'launch-spec-ready' || value === 'target-app-unavailable' || value === 'blocked';
}

function validateDogfoodRefs(value: unknown, targetAppRef: string): string | undefined {
  const refs = objectRecord(value);
  if (!refs) return 'dogfoodRefs are required.';
  const currentRunConsistencyProblem = validateDogfoodCurrentRunConsistency(refs);

  const failures = [
    refs.targetAppRef === targetAppRef
      ? undefined
      : `dogfoodRefs.targetAppRef=${targetAppRef} is required.`,
    hostRefFailure(refs.realHostProviderSessionRef, 'dogfoodRefs.realHostProviderSessionRef'),
    hostRefFailure(refs.realOptInRunRef, 'dogfoodRefs.realOptInRunRef'),
    hostRefFailure(refs.sessionRef, 'dogfoodRefs.sessionRef'),
    hostRefFailure(refs.liveSurfaceRef, 'dogfoodRefs.liveSurfaceRef'),
    hostRefFailure(refs.currentFrameRef, 'dogfoodRefs.currentFrameRef'),
    hostRefFailure(refs.currentRunPointerRef, 'dogfoodRefs.currentRunPointerRef'),
    hostRefFailure(refs.evidenceLedgerRef, 'dogfoodRefs.evidenceLedgerRef'),
    hostRefArrayFailure(refs.realPlatformEvidenceRefs, 'dogfoodRefs.realPlatformEvidenceRefs'),
    hostRefArrayFailure(refs.realAgentQueueEvidenceRefs, 'dogfoodRefs.realAgentQueueEvidenceRefs'),
    hostRefArrayFailure(refs.minimalEvidenceReplayRefs, 'dogfoodRefs.minimalEvidenceReplayRefs'),
    hostRefArrayFailure(refs.inputAcceptedRefs, 'dogfoodRefs.inputAcceptedRefs'),
    hostRefArrayFailure(refs.automationBarrierRefs, 'dogfoodRefs.automationBarrierRefs'),
    hostRefArrayFailure(refs.backgroundEvidenceRefs, 'dogfoodRefs.backgroundEvidenceRefs'),
    currentRunConsistencyProblem,
  ].filter((failure): failure is string => Boolean(failure));

  return failures.length ? failures.join(' ') : undefined;
}

function validateDogfoodCurrentRunConsistency(refs: Record<string, unknown>): string | undefined {
  if (typeof refs.evidenceLedgerRef !== 'string' || !refs.evidenceLedgerRef.trim()) {
    return undefined;
  }
  const evidenceLedgerRef = refs.evidenceLedgerRef.trim();
  const realPlatformEvidenceRefs = Array.isArray(refs.realPlatformEvidenceRefs)
    ? refs.realPlatformEvidenceRefs.filter((entry): entry is string => typeof entry === 'string')
    : [];
  if (!realPlatformEvidenceRefs.includes(evidenceLedgerRef)) {
    return 'dogfoodRefs.realPlatformEvidenceRefs must include dogfoodRefs.evidenceLedgerRef.';
  }

  const minimalEvidenceReplayRefs = Array.isArray(refs.minimalEvidenceReplayRefs)
    ? refs.minimalEvidenceReplayRefs.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const eventPrefix = `${evidenceLedgerRef}/events/`;
  const badReplayRef = minimalEvidenceReplayRefs.find((ref) => !ref.startsWith(eventPrefix));
  if (badReplayRef) {
    return `dogfoodRefs.minimalEvidenceReplayRefs must be scoped to dogfoodRefs.evidenceLedgerRef events: ${badReplayRef}.`;
  }

  return undefined;
}

function validateRealVirtualAppScreenClaim(value: unknown): string | undefined {
  const input = objectRecord(value);
  const claims = Array.isArray(input?.evidenceClaims) ? input.evidenceClaims : [];
  const claim = claims.map(objectRecord).find((entry) => entry?.kind === 'real-virtual-app-screen');
  if (!claim) return 'userAcceptanceInput.evidenceClaims must include a real-virtual-app-screen claim.';
  const failures = [
    claim.status === 'present' ? undefined : 'real-virtual-app-screen claim status=present is required.',
    claim.diagnosticOnly === false ? undefined : 'real-virtual-app-screen claim diagnosticOnly=false is required.',
    hostRefFailure(claim.realHostProviderSessionRef, 'real-virtual-app-screen claim realHostProviderSessionRef'),
    hostRefFailure(claim.realOptInRunRef, 'real-virtual-app-screen claim realOptInRunRef'),
    hostRefArrayFailure(claim.realPlatformEvidenceRefs, 'real-virtual-app-screen claim realPlatformEvidenceRefs'),
  ].filter((failure): failure is string => Boolean(failure));
  return failures.length ? failures.join(' ') : undefined;
}

function hostRefFailure(value: unknown, label: string): string | undefined {
  return typeof value === 'string' && isNativeHostProductRef(value)
    ? undefined
    : `${label} must be a Host-owned real evidence ref.`;
}

function hostRefArrayFailure(value: unknown, label: string): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return `${label} must include Host-owned real evidence refs.`;
  }
  return value.every((entry) => typeof entry === 'string' && isNativeHostProductRef(entry))
    ? undefined
    : `${label} must include only Host-owned real evidence refs.`;
}

function isNativeHostProductRef(ref: string): boolean {
  return ref.startsWith('computer-use:native-host/')
    && !forbiddenEvidenceString(ref)
    && !/^computer-use:native-host\/replay(?:[/:]|$)/iu.test(ref);
}

function forbiddenEvidenceStringFailure(value: unknown): string | undefined {
  const ref = stringValues(value).find((candidate) => forbiddenEvidenceString(candidate));
  return ref
    ? `manifest must not reference fixture, mock, snapshot, or replay evidence: ${ref}.`
    : undefined;
}

function forbiddenEvidenceString(value: string): boolean {
  return /(?:^|[:/.-])(?:fixture|fixtures|mock|mocks|snapshot|snapshots|snapshot-fixture|replay-fixture)(?:[:/.-]|$)/iu.test(value);
}

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((entry) => stringValues(entry));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((entry) => stringValues(entry));
  }
  return [];
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
