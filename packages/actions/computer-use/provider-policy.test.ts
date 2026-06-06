import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computerUseActionRequestExecutorProvider,
  computerUseCaptureHostPortProvider,
  computerUseCaptureDiagnostics,
  computerUseCaptureProviderIds,
  computerUseCaptureProviderName,
  computerUseExecuteHostPortProvider,
  computerUseHostPortLists,
  computerUseHostPortProviderIds,
  computerUseHostPortsContractIds,
  computerUseHostPortsPolicySummary,
  computerUseModelRouterCallPointManifest,
  computerUseModelRouterCapabilityIds,
  computerUseModelRouterTraceEvent,
  computerUseTraceHandoffContract,
  computerUseVisionFailureObservation,
  validateComputerUseModelRouterCall,
  computerUseWindowCaptureProvider,
} from './provider-policy.js';

test('computer use capture provider policy owns stable provider ids', () => {
  assert.equal(
    computerUseCaptureProviderName({ desktopPlatform: 'darwin', captureScope: 'display' }),
    computerUseCaptureProviderIds.macosDisplayCapture,
  );
  assert.equal(
    computerUseCaptureProviderName({ desktopPlatform: 'macos', captureScope: 'window' }),
    computerUseCaptureProviderIds.macosWindowCapture,
  );
  assert.equal(
    computerUseCaptureProviderName({ desktopPlatform: 'linux', captureScope: 'display' }),
    'linux-display-capture-provider',
  );
});

test('computer use window capture policy reports unsupported providers consistently', () => {
  assert.equal(
    computerUseWindowCaptureProvider({ desktopPlatform: 'linux', windowId: 42 }),
    'linux-window-provider-unavailable',
  );
  assert.equal(
    computerUseWindowCaptureProvider({ desktopPlatform: '', windowId: 42 }),
    'unknown-window-provider-unavailable',
  );
  assert.equal(
    computerUseWindowCaptureProvider({ desktopPlatform: 'darwin', windowId: 42 }),
    computerUseCaptureProviderIds.macosWindowCapture,
  );
  assert.equal(
    computerUseWindowCaptureProvider({ desktopPlatform: 'linux', dryRun: true, windowId: 42 }),
    computerUseCaptureProviderIds.dryRunWindowPng,
  );
  assert.equal(computerUseCaptureDiagnostics.displayProviderResult.code, 'capture.display.provider-result');
  assert.equal(computerUseCaptureDiagnostics.focusRegionProviderResult.code, 'capture.focus-region.provider-result');
  assert.equal(computerUseCaptureDiagnostics.windowProviderResult.code, 'capture.window.provider-result');
  assert.equal(computerUseCaptureDiagnostics.windowUnsupportedProvider.code, 'capture.window.unsupported-provider');
});

test('computer use host port policy names thin host adapter providers', () => {
  assert.equal(computerUseHostPortsContractIds.schemaVersion, 'sciforge.computer-use.host-ports.v1');
  assert.deepEqual(computerUseHostPortLists.required, ['capture', 'plan', 'locate', 'execute', 'verify']);
  assert.deepEqual(computerUseHostPortLists.forbidden, ['requestApproval', 'gui.present', 'gui.ask_user']);
  assert.equal(
    computerUseCaptureHostPortProvider({ enabled: true, mode: 'app-window' }),
    computerUseHostPortProviderIds.targetWindowCapture,
  );
  assert.equal(
    computerUseCaptureHostPortProvider({ enabled: false, mode: 'app-window' }),
    computerUseHostPortProviderIds.displayCapture,
  );
  assert.equal(
    computerUseActionRequestExecutorProvider({ desktopPlatform: 'Darwin', dryRun: false }),
    'darwin-host-port-executor',
  );
  assert.equal(
    computerUseExecuteHostPortProvider({ desktopPlatform: 'Darwin', dryRun: false }),
    'darwin-generic-gui-executor',
  );
  assert.equal(
    computerUseExecuteHostPortProvider({ desktopPlatform: 'Darwin', dryRun: true }),
    'dry-run-generic-gui-executor',
  );

  const policy = computerUseHostPortsPolicySummary({
    desktopPlatform: 'darwin',
    windowTarget: { enabled: true, mode: 'window-id' },
  });
  assert.equal(policy.providers.capture, computerUseHostPortProviderIds.targetWindowCapture);
  assert.equal(policy.providers.crop, computerUseHostPortProviderIds.focusRegionCrop);
  assert.equal(policy.providers.plan, computerUseModelRouterCapabilityIds.computerUsePlanner);
  assert.equal(policy.providers.query, computerUseModelRouterCapabilityIds.screenshotTranslator);
  assert.equal(policy.providers.locate, computerUseModelRouterCapabilityIds.groundingTranslator);
  assert.equal(policy.providers.verify, computerUseModelRouterCapabilityIds.verifierTranslator);
  assert.equal(policy.providers.writeTrace, computerUseHostPortProviderIds.writeTrace);
  assert.deepEqual(policy.routerRoles, {
    screenshot: computerUseModelRouterCapabilityIds.screenshotTranslator,
    crop: computerUseModelRouterCapabilityIds.cropTranslator,
    grounding: computerUseModelRouterCapabilityIds.groundingTranslator,
    verifier: computerUseModelRouterCapabilityIds.verifierTranslator,
  });
  assert.equal(policy.legacyAdapters, undefined);
  assert.equal(policy.traceHandoff.presentationTarget, computerUseTraceHandoffContract.presentationTarget);
  assert.deepEqual(policy.traceHandoff.forbiddenInlinePayloads, [
    'rawScreenshot',
    'rawProviderPayload',
    'providerRequestBody',
    'providerResponseBody',
    'base64',
    'data:image',
    'image_base64',
    'inlineImageBytes',
  ]);
  assert.doesNotMatch(JSON.stringify(policy.providers), new RegExp([
    'runtime-codex',
    ['kv', '-', 'ground'].join(''),
    'qwen',
    'vlm',
  ].join('|'), 'i'));

  const fallbackPolicy = computerUseHostPortsPolicySummary({ desktopPlatform: 'darwin' });
  assert.equal(fallbackPolicy.providers.locate, computerUseModelRouterCapabilityIds.groundingTranslator);
  assert.equal(fallbackPolicy.legacyAdapters, undefined);
});

test('computer use model calls are Model Router owned with public profiles only', () => {
  const manifest = computerUseModelRouterCallPointManifest();

  assert.deepEqual(
    manifest.callPoints.map((callPoint) => callPoint.id),
    [
      'local-action-planner',
      'screenshot-describe',
      'crop-inspect',
      'ocr-vision-observation-summarize',
      'candidate-disambiguation',
      'grounding-translator',
      'before-after-compare',
      'verifier-explanation',
    ],
  );
  assert.equal(manifest.endpoint, '/v1/responses');
  assert.deepEqual(manifest.publicProfiles, ['textReasoner', 'translators.vision']);
  assert.equal(
    manifest.callPoints.find((callPoint) => callPoint.id === 'local-action-planner')?.profile,
    'textReasoner',
  );
  for (const callPoint of manifest.callPoints.filter((point) => point.id !== 'local-action-planner')) {
    assert.equal(callPoint.profile, 'translators.vision');
  }

  assert.deepEqual(
    validateComputerUseModelRouterCall({
      callPoint: 'grounding-translator',
      endpoint: '/v1/responses',
      profile: 'translators.vision',
      role: 'translators.vision',
      modalityRefs: ['evidence:frame-001.png'],
    }),
    [],
  );

  const violations = validateComputerUseModelRouterCall({
    callPoint: 'grounding-translator',
    endpoint: 'https://private-provider.example/v1/chat/completions',
    profile: 'qwen-vl-private',
    role: 'translators.vision',
    modalityRefs: ['data:image/png;base64,AAAA'],
    providerConfig: {
      apiKey: 'sk-secret',
      baseUrl: 'https://private-provider.example/v1',
      model: 'qwen2.5-vl-private',
      provider: 'private-upstream',
    },
  });

  assert.ok(violations.includes('endpoint.must-be-model-router-responses'));
  assert.ok(violations.includes('profile.unregistered'));
  assert.ok(violations.includes('modality-ref.inline-payload-forbidden'));
  assert.ok(violations.some((violation) => violation === 'provider-config.direct-provider-field:apiKey'));
  assert.ok(violations.some((violation) => violation === 'provider-config.direct-provider-field:baseUrl'));
  assert.ok(violations.some((violation) => violation === 'provider-config.direct-provider-field:model'));
  assert.ok(violations.some((violation) => violation === 'provider-config.direct-provider-field:provider'));
});

test('computer use model-router trace stays refs-first and bounds provider errors', () => {
  const trace = computerUseModelRouterTraceEvent({
    callPoint: 'screenshot-describe',
    role: 'translators.vision',
    profile: 'translators.vision',
    modalityRefs: [{
      ref: 'evidence:frame-001.png',
      width: 1280,
      height: 720,
      sha256: 'abc123',
      bytes: 1024,
    }],
    latencyMs: 42,
    status: 'failed',
    error: 'provider https://private-provider.example/v1 rejected sk-secret using raw model qwen2.5-vl-private because the payload was too large '.repeat(6),
    providerRequestBody: { image_base64: 'AAAA', apiKey: 'sk-secret' },
  });

  assert.deepEqual(trace, {
    schemaVersion: 'sciforge.computer-use.model-router-trace.v1',
    endpoint: '/v1/responses',
    callPoint: 'screenshot-describe',
    profile: 'translators.vision',
    role: 'translators.vision',
    modalityRefs: ['evidence:frame-001.png'],
    dimensions: [{ ref: 'evidence:frame-001.png', width: 1280, height: 720 }],
    contentHashes: [{ ref: 'evidence:frame-001.png', sha256: 'abc123', bytes: 1024 }],
    latencyMs: 42,
    status: 'failed',
    errorSummary: '[redacted-provider-detail]',
  });
  assert.doesNotMatch(
    JSON.stringify(trace),
    /private-provider|sk-secret|qwen|providerRequestBody|image_base64|AAAA|base64/i,
  );
});

test('computer use vision failures are explicit and never claim visual observation', () => {
  assert.deepEqual(
    computerUseVisionFailureObservation({
      mode: 'unavailable',
      reason: 'router profile not configured',
    }),
    {
      status: 'observation-unavailable',
      seenImage: false,
      reason: 'router profile not configured',
    },
  );

  assert.deepEqual(
    computerUseVisionFailureObservation({
      mode: 'text-fallback',
      reason: 'vision translator blocked',
      textFallback: 'Host exact text fallback from AX tree',
    }),
    {
      status: 'text-fallback',
      seenImage: false,
      reason: 'vision translator blocked',
      textFallback: 'Host exact text fallback from AX tree',
    },
  );
});
