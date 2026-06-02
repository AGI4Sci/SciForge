import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import test from 'node:test';

import { chromium, type Browser, type Page as PlaywrightPage } from 'playwright-core';

import {
  BROWSER_HOST_SESSION_PROVIDER_ID,
  type BrowserHostSessionStatus,
} from '../../src/runtime/browser-host-session-types.js';
import {
  browserHostWebRtcTransportFeasibilityReport,
  createBrowserHostWebRtcTransportCandidate,
  validateBrowserHostWebRtcTransportCandidate,
  type BrowserHostWebRtcContractSession,
  type BrowserHostWebRtcMetricSample,
} from '../../src/runtime/browser-host-webrtc-transport-contract.js';

const LOOPBACK_SCHEMA = 'sciforge.browser-host-session.webrtc-loopback-smoke.v1' as const;
const MESSAGE_COUNT = 12;
const MAX_BUFFERED_BYTES = 256 * 1024;
const artifactDir = resolve(process.cwd(), 'docs', 'test-artifacts', 'browser-host-webrtc-loopback');
const manifestPath = resolve(artifactDir, 'manifest.json');

type LoopbackBrowserResult = {
  status: 'passed' | 'blocked';
  reason?: string;
  diagnostics: string[];
  openLatencyMs: number;
  elapsedMs: number;
  requestedMessageCount: number;
  receivedMessageCount: number;
  acknowledgedMessageCount: number;
  droppedMessageCount: number;
  backpressureEventCount: number;
  maxObservedBufferedBytes: number;
  maxConfiguredBufferedBytes: number;
  localIceCandidateCount: number;
  remoteIceCandidateCount: number;
  leftConnectionState: string;
  rightConnectionState: string;
  dataChannelReadyState: string;
  samples: BrowserHostWebRtcMetricSample[];
};

type WebRtcLegacyRightPaneRefusal = {
  status: 'blocked';
  claimScope: 'legacy-transport-diagnostic-only';
  passClaim: false;
  required: {
    liveSurfaceTransport: 'native-embedded';
    singleInteractiveTruth: true;
    secondTruthSource: false;
  };
  observed: {
    transportEvidenceKind: 'webrtc-loopback-data-channel';
    liveSurfaceTransport: 'host-stream';
    singleInteractiveTruth: true;
    secondTruthSource: false;
  };
  passRefusalPolicy: {
    candidateContractDoesNotPass: true;
    loopbackSmokeDoesNotPass: true;
    httpFrameRouteDoesNotPass: true;
    secondTruthSourceDoesNotPass: true;
  };
};

type LoopbackEvidence =
  | {
    schemaVersion: typeof LOOPBACK_SCHEMA;
    status: 'skipped';
    observedAt: string;
    reason: string;
    browser: {
      engine: 'chromium';
      executablePath?: string;
      executableBasename?: string;
    };
    verificationCommand: string;
  }
  | {
    schemaVersion: typeof LOOPBACK_SCHEMA;
    status: 'blocked';
    observedAt: string;
    reason: string;
    browser: {
      engine: 'chromium';
      executablePath?: string;
      executableBasename?: string;
      version?: string;
    };
	    loopback: Omit<LoopbackBrowserResult, 'samples'>;
	    rawPayloadsCaptured: false;
	    refsFirst: true;
	    claimScope: 'legacy-transport-diagnostic-only';
	    rightPaneLiveAcceptance: WebRtcLegacyRightPaneRefusal;
	    verificationCommand: string;
	  }
	  | {
	    schemaVersion: typeof LOOPBACK_SCHEMA;
	    status: 'diagnostic';
	    observedAt: string;
	    browser: {
      engine: 'chromium';
      executablePath: string;
      executableBasename: string;
      version: string;
    };
	    loopback: Omit<LoopbackBrowserResult, 'samples'>;
	    claimScope: 'legacy-transport-diagnostic-only';
	    rightPaneLiveAcceptance: WebRtcLegacyRightPaneRefusal;
	    candidate: ReturnType<typeof createBrowserHostWebRtcTransportCandidate>;
    report: ReturnType<typeof browserHostWebRtcTransportFeasibilityReport>;
    forbiddenEvidence: {
      inlineSdp: false;
      inlineIceCandidates: false;
      rawFramePayloads: false;
      rawDom: false;
      iframe: false;
      proxy: false;
      secondViewer: false;
      systemPopup: false;
    };
    verificationCommand: string;
  };

test('BrowserHostSession WebRTC data-channel loopback validates refs-first transport feasibility in a real Chromium runtime', { timeout: 45_000 }, async (t) => {
  const browserExecutable = resolveChromiumExecutable();
  if (!browserExecutable) {
    const reason = 'No Chromium-compatible browser found. Set SCIFORGE_BROWSER_EXECUTABLE or PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to run this smoke.';
    await writeEvidence({
      schemaVersion: LOOPBACK_SCHEMA,
      status: 'skipped',
      observedAt: new Date().toISOString(),
      reason,
      browser: { engine: 'chromium' },
      verificationCommand: 'node --import tsx --test tests/smoke/smoke-browser-host-webrtc-loopback.test.ts',
    });
    t.skip(reason);
    return;
  }

  let browser: Browser | undefined;
  let browserVersion = 'unknown';
  let blockedEvidenceWritten = false;
  try {
    browser = await chromium.launch({
      executablePath: browserExecutable,
      headless: true,
      args: [
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
    browserVersion = browser.version();
    const page = await browser.newPage();
    await page.goto('about:blank');
    const result = await runWebRtcDataChannelLoopback(page, {
      label: 'browser-host-webrtc-frames',
      messageCount: MESSAGE_COUNT,
      maxBufferedBytes: MAX_BUFFERED_BYTES,
    });

    if (result.status !== 'passed') {
      await writeBlockedEvidence(browserExecutable, browserVersion, result, result.reason ?? 'WebRTC data-channel loopback did not complete.');
      blockedEvidenceWritten = true;
      throw new Error(`WebRTC loopback blocked: ${result.reason ?? 'unknown reason'}`);
    }

    assert.equal(result.acknowledgedMessageCount, MESSAGE_COUNT);
    assert.equal(result.receivedMessageCount, MESSAGE_COUNT);
    assert.equal(result.droppedMessageCount, 0);
    assert.ok(result.openLatencyMs >= 0);
    assert.ok(result.samples.length >= MESSAGE_COUNT);

    const session = deterministicLoopbackSession('webrtc-loopback-smoke');
    const candidate = createBrowserHostWebRtcTransportCandidate({
      session,
      kind: 'webrtc-data-channel',
      samples: result.samples,
    });
    const validation = validateBrowserHostWebRtcTransportCandidate(candidate);
    assert.equal(validation.ok, true, validation.errors.join('\n'));
    assert.deepEqual(validation.errors, []);
    assert.equal(candidate.signaling.inlineSdp, false);
    assert.equal(candidate.signaling.inlineIceCandidates, false);
    assert.equal(candidate.adapter.rawFramePayloads, false);
    assert.equal(candidate.metrics.sampleCount, MESSAGE_COUNT);
    assert.equal(candidate.metrics.totalDroppedFrames, 0);
    assert.equal(candidate.metrics.sequenceGapCount, 0);
    assert.equal(candidate.metrics.backpressureEventCount, result.backpressureEventCount);
    assert.equal(candidate.media.kind, 'webrtc-data-channel');
    assert.equal(candidate.media.framePayloadMode, 'encoded-frame-ref');

    const report = browserHostWebRtcTransportFeasibilityReport(candidate);
    assert.equal(report.validation.ok, true, report.validation.errors.join('\n'));
    assert.equal(report.refsFirst, true);
    assert.equal(report.singleInteractiveTruth, true);
    assert.equal(report.rawPayloadsCaptured, false);
    assert.equal(report.secondTruthSource, false);

	    const evidence: LoopbackEvidence = {
	      schemaVersion: LOOPBACK_SCHEMA,
	      status: 'diagnostic',
	      observedAt: new Date().toISOString(),
      browser: {
        engine: 'chromium',
        executablePath: browserExecutable,
        executableBasename: basename(browserExecutable),
        version: browserVersion,
	      },
	      loopback: withoutSamples(result),
	      claimScope: 'legacy-transport-diagnostic-only',
	      rightPaneLiveAcceptance: legacyWebRtcRightPaneRefusal(),
	      candidate,
      report,
      forbiddenEvidence: {
        inlineSdp: false,
        inlineIceCandidates: false,
        rawFramePayloads: false,
        rawDom: false,
        iframe: false,
        proxy: false,
        secondViewer: false,
        systemPopup: false,
      },
      verificationCommand: 'node --import tsx --test tests/smoke/smoke-browser-host-webrtc-loopback.test.ts',
	    };
	    await writeEvidence(evidence);
	    assertLegacyWebRtcRightPaneRefusal(evidence.rightPaneLiveAcceptance);
	    assertNoRawPayloads(JSON.stringify(evidence));
  } catch (error) {
    if (browser && !blockedEvidenceWritten) {
      const result = blockedLoopbackResult(error);
      await writeBlockedEvidence(browserExecutable, browserVersion, result, result.reason ?? 'Chromium WebRTC loopback failed.');
    }
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
  }
});

async function runWebRtcDataChannelLoopback(
  page: PlaywrightPage,
  input: { label: string; messageCount: number; maxBufferedBytes: number },
): Promise<LoopbackBrowserResult> {
  return await page.evaluate(async ({ label, messageCount, maxBufferedBytes }) => {
    const diagnostics: string[] = [];
    const startedAt = performance.now();
    const samples: BrowserHostWebRtcMetricSample[] = [];
    const peerCtor = globalThis.RTCPeerConnection;
    if (typeof peerCtor !== 'function') {
      return blocked('RTCPeerConnection is unavailable in this Chromium runtime.');
    }

    const left = new RTCPeerConnection({ iceServers: [] });
    const right = new RTCPeerConnection({ iceServers: [] });
    const sendTimes = new Map<number, number>();
    const frameBytes = new Map<number, number>();
    const encoder = new TextEncoder();
    let localIceCandidateCount = 0;
    let remoteIceCandidateCount = 0;
    let receivedMessageCount = 0;
    let acknowledgedMessageCount = 0;
    let backpressureEventCount = 0;
    let maxObservedBufferedBytes = 0;
    let channel: RTCDataChannel | undefined;
    let receiver: RTCDataChannel | undefined;

    try {
      left.addEventListener('icecandidate', (event) => {
        if (!event.candidate) return;
        localIceCandidateCount += 1;
        void right.addIceCandidate(event.candidate).catch((error) => {
          diagnostics.push(`right-add-ice:${browserErrorMessage(error)}`);
        });
      });
      right.addEventListener('icecandidate', (event) => {
        if (!event.candidate) return;
        remoteIceCandidateCount += 1;
        void left.addIceCandidate(event.candidate).catch((error) => {
          diagnostics.push(`left-add-ice:${browserErrorMessage(error)}`);
        });
      });

      channel = left.createDataChannel(label, { ordered: true });
      channel.bufferedAmountLowThreshold = maxBufferedBytes;
      channel.addEventListener('bufferedamountlow', () => {
        backpressureEventCount += 1;
      });
      right.addEventListener('datachannel', (event) => {
        receiver = event.channel;
        receiver.addEventListener('message', (message) => {
          receivedMessageCount += 1;
          const sequence = parseBrowserFrameRefSequence(String(message.data), receivedMessageCount);
          receiver?.send(`ack:${sequence}`);
        });
      });
      const openedAt = await establishBrowserLoopback(left, right, channel);

      channel.addEventListener('message', (message) => {
        const sequence = parseBrowserAckSequence(String(message.data));
        if (sequence <= 0) return;
        acknowledgedMessageCount += 1;
        const observedAt = performance.now();
        const sentAt = sendTimes.get(sequence) ?? observedAt;
        const bufferedBytes = Math.round(channel?.bufferedAmount ?? 0);
        maxObservedBufferedBytes = Math.max(maxObservedBufferedBytes, bufferedBytes);
        const skippedBackpressure = bufferedBytes >= maxBufferedBytes ? 1 : 0;
        if (skippedBackpressure) backpressureEventCount += 1;
        samples.push({
          sequence,
          observedAtMs: Math.round(performance.timeOrigin + observedAt),
          captureMs: 0,
          encodeMs: 0,
          networkMs: Math.round(observedAt - sentAt),
          decodeMs: 0,
          renderMs: 0,
          endToEndMs: Math.round(observedAt - sentAt),
          frameBytes: frameBytes.get(sequence) ?? 0,
          bufferedBytes,
          maxBufferedBytes,
          droppedSinceLastFrame: 0,
          skippedBackpressure,
          skippedBusy: 0,
          skippedRecentInput: 0,
        });
      });

      await waitForBrowserDataChannelState(channel, 'open', 5_000);
      for (let sequence = 1; sequence <= messageCount; sequence += 1) {
        const payload = `encoded-frame-ref:${sequence}`;
        const byteLength = encoder.encode(payload).byteLength;
        frameBytes.set(sequence, byteLength);
        if (channel.bufferedAmount >= maxBufferedBytes) backpressureEventCount += 1;
        sendTimes.set(sequence, performance.now());
        channel.send(payload);
        maxObservedBufferedBytes = Math.max(maxObservedBufferedBytes, Math.round(channel.bufferedAmount));
        await waitForBrowserMacrotask();
      }

      await waitForBrowserCondition(() => acknowledgedMessageCount >= messageCount, 8_000);
      samples.sort((leftSample, rightSample) => leftSample.sequence - rightSample.sequence);
      const elapsedMs = Math.round(performance.now() - startedAt);
      const droppedMessageCount = Math.max(0, messageCount - acknowledgedMessageCount);
      return {
        status: droppedMessageCount === 0 ? 'passed' : 'blocked',
        reason: droppedMessageCount === 0 ? undefined : `Only ${acknowledgedMessageCount}/${messageCount} WebRTC data-channel messages were acknowledged.`,
        diagnostics,
        openLatencyMs: Math.round(openedAt - startedAt),
        elapsedMs,
        requestedMessageCount: messageCount,
        receivedMessageCount,
        acknowledgedMessageCount,
        droppedMessageCount,
        backpressureEventCount,
        maxObservedBufferedBytes,
        maxConfiguredBufferedBytes: maxBufferedBytes,
        localIceCandidateCount,
        remoteIceCandidateCount,
        leftConnectionState: left.connectionState,
        rightConnectionState: right.connectionState,
        dataChannelReadyState: channel.readyState,
        samples,
      } satisfies LoopbackBrowserResult;
    } catch (error) {
      return blocked(browserErrorMessage(error));
    } finally {
      channel?.close();
      receiver?.close();
      left.close();
      right.close();
    }

    function blocked(reason: string): LoopbackBrowserResult {
      return {
        status: 'blocked',
        reason,
        diagnostics,
        openLatencyMs: 0,
        elapsedMs: Math.round(performance.now() - startedAt),
        requestedMessageCount: messageCount,
        receivedMessageCount,
        acknowledgedMessageCount,
        droppedMessageCount: Math.max(0, messageCount - acknowledgedMessageCount),
        backpressureEventCount,
        maxObservedBufferedBytes,
        maxConfiguredBufferedBytes: maxBufferedBytes,
        localIceCandidateCount,
        remoteIceCandidateCount,
        leftConnectionState: left.connectionState,
        rightConnectionState: right.connectionState,
        dataChannelReadyState: channel?.readyState ?? 'missing',
        samples,
      };
    }

    function browserErrorMessage(error: unknown): string {
      return error instanceof Error ? error.message : String(error);
    }

    async function establishBrowserLoopback(peerLeft: RTCPeerConnection, peerRight: RTCPeerConnection, dataChannel: RTCDataChannel): Promise<number> {
      const openPromise = new Promise<number>((resolvePromise, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for WebRTC data channel open.')), 5_000);
        dataChannel.addEventListener('open', () => {
          clearTimeout(timeout);
          resolvePromise(performance.now());
        }, { once: true });
        dataChannel.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('WebRTC data channel emitted an error before opening.'));
        }, { once: true });
      });
      const offer = await peerLeft.createOffer();
      await peerLeft.setLocalDescription(offer);
      await peerRight.setRemoteDescription(offer);
      const answer = await peerRight.createAnswer();
      await peerRight.setLocalDescription(answer);
      await peerLeft.setRemoteDescription(answer);
      return await openPromise;
    }

    async function waitForBrowserDataChannelState(dataChannel: RTCDataChannel, readyState: RTCDataChannelState, timeoutMs: number): Promise<void> {
      if (dataChannel.readyState === readyState) return;
      await waitForBrowserCondition(() => dataChannel.readyState === readyState, timeoutMs);
    }

    async function waitForBrowserCondition(predicate: () => boolean, timeoutMs: number): Promise<void> {
      const conditionStartedAt = performance.now();
      while (!predicate()) {
        if (performance.now() - conditionStartedAt > timeoutMs) throw new Error(`Timed out after ${timeoutMs}ms.`);
        await waitForBrowserMacrotask();
      }
    }

    function waitForBrowserMacrotask(): Promise<void> {
      return new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    }

    function parseBrowserFrameRefSequence(value: string, fallback: number): number {
      const match = /^encoded-frame-ref:(\d+)$/.exec(value);
      return match ? Math.max(0, Number(match[1])) : fallback;
    }

    function parseBrowserAckSequence(value: string): number {
      const match = /^ack:(\d+)$/.exec(value);
      return match ? Math.max(0, Number(match[1])) : 0;
    }
  }, input);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deterministicLoopbackSession(id: string): BrowserHostWebRtcContractSession {
  const now = new Date().toISOString();
  void now;
  return {
    id,
    owner: 'host',
    providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
    status: 'ready' satisfies BrowserHostSessionStatus,
    liveSurfaceTransport: 'host-stream',
    liveSurfaceRef: `browser-host-session:${id}/live-surface`,
    frameStreamRef: `browser-host-session:${id}/frame-stream`,
    singleInteractiveTruth: true,
  };
}

async function writeBlockedEvidence(
  executablePath: string,
  browserVersion: string,
  result: LoopbackBrowserResult,
  reason: string,
): Promise<void> {
  await writeEvidence({
    schemaVersion: LOOPBACK_SCHEMA,
    status: 'blocked',
    observedAt: new Date().toISOString(),
    reason,
    browser: {
      engine: 'chromium',
      executablePath,
      executableBasename: basename(executablePath),
      version: browserVersion,
    },
	    loopback: withoutSamples(result),
	    rawPayloadsCaptured: false,
	    refsFirst: true,
	    claimScope: 'legacy-transport-diagnostic-only',
	    rightPaneLiveAcceptance: legacyWebRtcRightPaneRefusal(),
	    verificationCommand: 'node --import tsx --test tests/smoke/smoke-browser-host-webrtc-loopback.test.ts',
	  });
}

async function writeEvidence(evidence: LoopbackEvidence): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  assertNoRawPayloads(text);
  if ('rightPaneLiveAcceptance' in evidence) assertLegacyWebRtcRightPaneRefusal(evidence.rightPaneLiveAcceptance);
  await writeFile(manifestPath, text, 'utf8');
}

function legacyWebRtcRightPaneRefusal(): WebRtcLegacyRightPaneRefusal {
  return {
    status: 'blocked',
    claimScope: 'legacy-transport-diagnostic-only',
    passClaim: false,
    required: {
      liveSurfaceTransport: 'native-embedded',
      singleInteractiveTruth: true,
      secondTruthSource: false,
    },
    observed: {
      transportEvidenceKind: 'webrtc-loopback-data-channel',
      liveSurfaceTransport: 'host-stream',
      singleInteractiveTruth: true,
      secondTruthSource: false,
    },
    passRefusalPolicy: {
      candidateContractDoesNotPass: true,
      loopbackSmokeDoesNotPass: true,
      httpFrameRouteDoesNotPass: true,
      secondTruthSourceDoesNotPass: true,
    },
  };
}

function assertLegacyWebRtcRightPaneRefusal(refusal: WebRtcLegacyRightPaneRefusal): void {
  assert.equal(refusal.status, 'blocked');
  assert.equal(refusal.claimScope, 'legacy-transport-diagnostic-only');
  assert.equal(refusal.passClaim, false);
  assert.equal(refusal.required.liveSurfaceTransport, 'native-embedded');
  assert.equal(refusal.required.singleInteractiveTruth, true);
  assert.equal(refusal.required.secondTruthSource, false);
  assert.equal(refusal.observed.transportEvidenceKind, 'webrtc-loopback-data-channel');
  assert.equal(refusal.observed.liveSurfaceTransport, 'host-stream');
  assert.equal(refusal.observed.singleInteractiveTruth, true);
  assert.equal(refusal.observed.secondTruthSource, false);
  assert.deepEqual(Object.values(refusal.passRefusalPolicy), [true, true, true, true]);
}

function withoutSamples(result: LoopbackBrowserResult): Omit<LoopbackBrowserResult, 'samples'> {
  const { samples: _samples, ...summary } = result;
  return summary;
}

function blockedLoopbackResult(error: unknown): LoopbackBrowserResult {
  return {
    status: 'blocked',
    reason: errorMessage(error),
    diagnostics: [],
    openLatencyMs: 0,
    elapsedMs: 0,
    requestedMessageCount: MESSAGE_COUNT,
    receivedMessageCount: 0,
    acknowledgedMessageCount: 0,
    droppedMessageCount: MESSAGE_COUNT,
    backpressureEventCount: 0,
    maxObservedBufferedBytes: 0,
    maxConfiguredBufferedBytes: MAX_BUFFERED_BYTES,
    localIceCandidateCount: 0,
    remoteIceCandidateCount: 0,
    leftConnectionState: 'unknown',
    rightConnectionState: 'unknown',
    dataChannelReadyState: 'unknown',
    samples: [],
  };
}

function assertNoRawPayloads(text: string): void {
  assert.doesNotMatch(text, /data:image|base64|<\s*(?:!doctype|html|body|iframe|webview)\b/i);
  assert.doesNotMatch(text, /\/api\/sciforge\/browser\/proxy|system-browser-window|html2canvas/i);
  assert.doesNotMatch(text, /\bv=0\r?\n|a=candidate:|candidate:[0-9]+ [0-9]+ udp/i);
}

function resolveChromiumExecutable(): string | undefined {
  const candidates = [
    process.env.SCIFORGE_BROWSER_EXECUTABLE,
    process.env.SCIFORGE_BROWSER_HOST_EXECUTABLE_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    ...playwrightChromiumCandidates(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ].filter((value): value is string => Boolean(value?.trim()));
  return candidates.find((candidate) => existsSync(candidate));
}

function playwrightChromiumCandidates(): string[] {
  const home = process.env.HOME;
  if (!home) return [];
  const cacheDirs = [
    `${home}/Library/Caches/ms-playwright`,
    `${home}/.cache/ms-playwright`,
  ];
  const candidates: string[] = [];
  for (const cacheDir of cacheDirs) {
    try {
      candidates.push(
        ...readdirSync(cacheDir)
          .filter((entry) => /^chromium-\d+$/.test(entry))
          .sort()
          .reverse()
          .flatMap((entry) => [
            `${cacheDir}/${entry}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
            `${cacheDir}/${entry}/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
            `${cacheDir}/${entry}/chrome-linux/chrome`,
          ]),
      );
    } catch {
      // Missing Playwright cache is handled by the caller as a typed skipped smoke.
    }
  }
  return candidates;
}
