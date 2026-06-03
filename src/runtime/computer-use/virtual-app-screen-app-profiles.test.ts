import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateVirtualAppScreenAppProfilePreflight,
  VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_MANIFEST_SCHEMA,
  VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF,
  resolveVirtualAppScreenAppProfile,
  virtualAppScreenAppProfileBlockedReason,
} from './virtual-app-screen-app-profiles.js';

test('VirtualAppScreen app profile resolver maps VSCode aliases to provider target app kind', () => {
  for (const profile of [
    'vscode-editor',
    'vscode-editor-low-risk',
    'vscode-local-native-virtual-display',
    'code',
    'visual-studio-code',
    'app:profile/vscode-editor',
  ]) {
    const resolved = resolveVirtualAppScreenAppProfile({ profile });

    assert.equal(resolved.status, 'resolved');
    if (resolved.status !== 'resolved') continue;
    assert.equal(resolved.profileId, 'vscode-editor');
    assert.equal(resolved.adapterProfileRef, 'adapter-profile:virtual-app-screen/vscode-local-native-virtual-display');
    assert.equal(resolved.targetAppKind, 'vscode');
    assert.equal(resolved.targetAppName, 'VSCode');
    assert.equal(resolved.targetAppRef, 'app:profile/vscode-editor');
    assert.equal(resolved.registryMetadataOnly, true);
  }
});

test('VirtualAppScreen app profile resolver maps generic Host API app aliases to provider target contract', () => {
  const cases = [
    {
      aliases: ['word', 'microsoft-word', 'ms-word', 'app:profile/word'],
      profileId: 'word',
      targetAppKind: 'word',
      targetAppName: 'Microsoft Word',
      targetAppRef: 'app:profile/word',
    },
    {
      aliases: ['powerpoint', 'ppt', 'microsoft-powerpoint', 'ms-powerpoint', 'app:profile/powerpoint'],
      profileId: 'powerpoint',
      targetAppKind: 'powerpoint',
      targetAppName: 'Microsoft PowerPoint',
      targetAppRef: 'app:profile/powerpoint',
    },
  ] as const;

  for (const appProfile of cases) {
    for (const profile of appProfile.aliases) {
      const resolved = resolveVirtualAppScreenAppProfile({ profile });

      assert.equal(resolved.status, 'resolved', profile);
      if (resolved.status !== 'resolved') continue;
      assert.equal(resolved.profileId, appProfile.profileId);
      assert.equal(resolved.adapterProfileRef, VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF);
      assert.equal(resolved.targetAppKind, appProfile.targetAppKind);
      assert.equal(resolved.targetAppName, appProfile.targetAppName);
      assert.equal(resolved.targetAppRef, appProfile.targetAppRef);
      assert.equal(resolved.registryMetadataOnly, true);
    }
  }
});

test('VirtualAppScreen app profile resolver fails closed for retired or ambiguous product shortcuts', () => {
  for (const profile of ['obsidian', 'slack', 'chrome-remote-desktop', 'crd', 'remote-desktop', 'obs', 'doc', 'deck', 'slides']) {
    const resolved = resolveVirtualAppScreenAppProfile({ profile });

    assert.equal(resolved.status, 'blocked');
    if (resolved.status !== 'blocked') continue;
    assert.equal(resolved.requestedProfile, profile);
    assert.match(resolved.blockedReason, new RegExp(profile));
  }
});

test('VirtualAppScreen app profile resolver fails closed for unknown profiles', () => {
  const resolved = resolveVirtualAppScreenAppProfile({ profile: 'unknown-editor' });

  assert.deepEqual(resolved, {
    status: 'blocked',
    requestedProfile: 'unknown-editor',
    blockedReason: 'VirtualAppScreen app profile "unknown-editor" is not registered for native provider resolution.',
  });
  assert.match(virtualAppScreenAppProfileBlockedReason(resolved) ?? '', /unknown-editor/);
});

test('VirtualAppScreen app profile resolver keeps generic editor as an explicit contract profile', () => {
  const resolved = resolveVirtualAppScreenAppProfile({ profile: 'generic-editor' });

  assert.equal(resolved.status, 'resolved');
  if (resolved.status !== 'resolved') return;
  assert.equal(resolved.profileId, 'generic-editor');
  assert.equal(resolved.targetAppKind, 'generic-editor');
  assert.equal(resolved.targetAppRef, 'app:profile/generic-editor');
  assert.equal(resolved.registryMetadataOnly, true);
});

test('VirtualAppScreen app profile preflight emits launch-spec-ready manifests for injected available generic Host API apps', () => {
  for (const profile of ['word', 'powerpoint'] as const) {
    const preflight = evaluateVirtualAppScreenAppProfilePreflight({
      profile,
      availability: {
        status: 'available',
        evidenceRef: `computer-use:native-host/app-availability/${profile}/available.json`,
        checkedBy: 'test-injected-availability',
      },
    });

    assert.equal(preflight.schemaVersion, VIRTUAL_APP_SCREEN_APP_PROFILE_PREFLIGHT_MANIFEST_SCHEMA);
    assert.equal(preflight.status, 'launch-spec-ready', profile);
    assert.equal(preflight.profileId, profile);
    assert.equal(preflight.targetAppRef, `app:profile/${profile}`);
    assert.equal(preflight.adapterProfileRef, VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF);
    assert.equal(preflight.launchContract.status, 'ready');
    assert.equal(preflight.launchContract.hostApiRouteRef, VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF);
    assert.equal(preflight.appAvailability.status, 'available');
    assert.equal(preflight.appAvailability.checkedBy, 'test-injected-availability');
    assert.equal(preflight.realDogfoodPassClaim, false);
  }
});

test('VirtualAppScreen app profile preflight records unavailable injected app availability without probing the machine', () => {
  const preflight = evaluateVirtualAppScreenAppProfilePreflight({
    profile: 'powerpoint',
    availability: {
      status: 'unavailable',
      reason: 'fixture says Microsoft PowerPoint is not installed',
      evidenceRef: 'computer-use:native-host/app-availability/powerpoint/unavailable.json',
      checkedBy: 'test-injected-availability',
    },
  });

  assert.equal(preflight.status, 'target-app-unavailable');
  assert.equal(preflight.profileId, 'powerpoint');
  assert.equal(preflight.appAvailability.status, 'unavailable');
  assert.match(preflight.blockedReason ?? '', /Microsoft PowerPoint is not installed/u);
  assert.equal(preflight.realDogfoodPassClaim, false);

  const unknownAvailability = evaluateVirtualAppScreenAppProfilePreflight({
    profile: 'word',
    availability: { status: 'unknown', checkedBy: 'test-injected-availability' },
  });

  assert.equal(unknownAvailability.status, 'target-app-unavailable');
  assert.equal(unknownAvailability.appAvailability.status, 'unknown');
  assert.match(unknownAvailability.blockedReason ?? '', /does not probe local machines/u);
  assert.equal(unknownAvailability.realDogfoodPassClaim, false);
});

test('VirtualAppScreen app profile preflight fails closed for shortcuts, unknown profiles, and non generic Host API profiles', () => {
  for (const profile of ['obsidian', 'slack', 'chrome-remote-desktop', 'doc', 'deck', 'unknown-editor', 'vscode-editor', 'generic-editor']) {
    const preflight = evaluateVirtualAppScreenAppProfilePreflight({
      profile,
      availability: { status: 'available' },
    });

    assert.equal(preflight.status, 'blocked', profile);
    assert.equal(preflight.requestedProfile, profile);
    assert.equal(preflight.realDogfoodPassClaim, false);
  }
});
