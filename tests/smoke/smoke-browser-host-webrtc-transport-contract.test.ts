import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BROWSER_HOST_SESSION_PROVIDER_ID } from '../../src/runtime/browser-host-session.js';
import {
  browserHostWebRtcTransportFeasibilityReport,
  createBrowserHostWebRtcTransportCandidate,
  validateBrowserHostWebRtcTransportCandidate,
  type BrowserHostWebRtcContractSession,
  type BrowserHostWebRtcMetricSample,
  type BrowserHostWebRtcTransportKind,
} from '../../src/runtime/browser-host-webrtc-transport-contract.js';

test('BrowserHostSession WebRTC transport contract validates data channel and video track candidates as refs-first single-owner adapters', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-webrtc-contract-'));
  try {
    for (const kind of ['webrtc-data-channel', 'webrtc-video-track'] satisfies BrowserHostWebRtcTransportKind[]) {
      const session = deterministicSession(`webrtc-${kind}`);
      const candidate = createBrowserHostWebRtcTransportCandidate({
        session,
        kind,
        samples: deterministicSamples(),
      });
      const validation = validateBrowserHostWebRtcTransportCandidate(candidate);
      assert.equal(validation.ok, true, validation.errors.join('\n'));
      assert.deepEqual(validation.errors, []);
      assert.equal(candidate.owner, 'BrowserHostSession');
      assert.equal(candidate.browserHostSession.owner, 'host');
      assert.equal(candidate.browserHostSession.providerId, BROWSER_HOST_SESSION_PROVIDER_ID);
      assert.equal(candidate.browserHostSession.singleInteractiveTruth, true);
      assert.equal(candidate.browserHostSession.liveSurfaceTransport, 'host-stream');
      assert.equal(candidate.refs.hostSessionRef, `browser-host-session:${session.id}`);
      assert.equal(candidate.refs.liveSurfaceRef, `browser-host-session:${session.id}/live-surface`);
      assert.equal(candidate.refs.transportRef, `browser-host-session:${session.id}/webrtc-transport`);
      assert.equal(candidate.signaling.mode, 'refs-first');
      assert.equal(candidate.signaling.inlineSdp, false);
      assert.equal(candidate.signaling.inlineIceCandidates, false);
      assert.equal(candidate.adapter.role, 'display-input-adapter');
      assert.equal(candidate.adapter.renderTarget, 'canvas');
      assert.deepEqual(candidate.adapter.forbiddenLiveBackings, {
        iframe: false,
        proxy: false,
        domCapture: false,
        httpFrameLiveFallback: false,
        secondViewer: false,
        systemPopup: false,
      });
      assert.equal(candidate.input.owner, 'BrowserHostSession');
      assert.equal(candidate.input.hotPathCapture, 'none');
      assert.equal(candidate.metrics.sampleCount, 5);
      assert.equal(candidate.metrics.p95EndToEndMs, 39);
      assert.equal(candidate.metrics.p95DecodeMs, 13);
      assert.equal(candidate.metrics.totalDroppedFrames, 4);
      assert.equal(candidate.metrics.backpressureEventCount, 1);
      assert.equal(candidate.metrics.maxObservedBufferedBytes, 70_000);
      assert.equal(candidate.metrics.dropRate, 0.4444);
      if (kind === 'webrtc-data-channel') {
        assert.equal(candidate.media.kind, 'webrtc-data-channel');
        assert.equal(candidate.media.dataChannelRef, `browser-host-session:${session.id}/webrtc-data-channel/frames`);
        assert.equal(candidate.media.framePayloadMode, 'encoded-frame-ref');
      } else {
        assert.equal(candidate.media.kind, 'webrtc-video-track');
        assert.equal(candidate.media.videoTrackRef, `browser-host-session:${session.id}/webrtc-video-track/live`);
        assert.equal(candidate.media.framePayloadMode, 'browser-video-track');
      }

      const report = browserHostWebRtcTransportFeasibilityReport(candidate);
      assert.equal(report.validation.ok, true, report.validation.errors.join('\n'));
      assert.equal(report.refsFirst, true);
      assert.equal(report.singleInteractiveTruth, true);
      assert.equal(report.secondTruthSource, false);
      assert.equal(report.rawPayloadsCaptured, false);
      const reportPath = join(workspacePath, `${kind}-report.json`);
      await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
      const reportText = await readFile(reportPath, 'utf8');
      assert.doesNotMatch(reportText, /data:image|base64|<\s*(?:!doctype|html|body|iframe|webview)\b/i);
      assert.doesNotMatch(reportText, /\/api\/sciforge\/browser\/proxy|system-browser-window|html2canvas|\bv=0\r?\n/i);
    }
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession WebRTC transport validator rejects second viewers, iframe/proxy/DOM capture, and inline SDP payloads', () => {
  const session = deterministicSession('webrtc-invalid');
  const valid = createBrowserHostWebRtcTransportCandidate({
    session,
    kind: 'webrtc-data-channel',
    samples: deterministicSamples(),
  });
  const invalid = {
    ...valid,
    owner: 'BrowserWorkbench',
    browserHostSession: {
      ...valid.browserHostSession,
      singleInteractiveTruth: false,
      liveSurfaceRef: 'browser-viewer:webrtc-invalid/live-surface',
    },
    refs: {
      ...valid.refs,
      liveSurfaceRef: 'browser-viewer:webrtc-invalid/live-surface',
    },
    adapter: {
      ...valid.adapter,
      forbiddenLiveBackings: {
        ...valid.adapter.forbiddenLiveBackings,
        iframe: true,
        proxy: true,
        domCapture: true,
        secondViewer: true,
      },
    },
    input: {
      ...valid.input,
      owner: 'BrowserWorkbench',
    },
    inlineSdpPayload: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96',
    html: '<iframe src="/api/sciforge/browser/proxy"></iframe>',
    rawDom: '<body>captured DOM</body>',
  };
  const validation = validateBrowserHostWebRtcTransportCandidate(invalid);
  const errors = validation.errors.join('\n');
  assert.equal(validation.ok, false);
  assert.match(errors, /owner must remain BrowserHostSession/);
  assert.match(errors, /singleInteractiveTruth must be true/);
  assert.match(errors, /liveSurfaceRef must stay inside the BrowserHostSession ref namespace/);
  assert.match(errors, /refs.liveSurfaceRef must be browser-host-session:webrtc-invalid\/live-surface/);
  assert.match(errors, /adapter\.forbiddenLiveBackings\.iframe must be false/);
  assert.match(errors, /adapter\.forbiddenLiveBackings\.proxy must be false/);
  assert.match(errors, /adapter\.forbiddenLiveBackings\.domCapture must be false/);
  assert.match(errors, /adapter\.forbiddenLiveBackings\.secondViewer must be false/);
  assert.match(errors, /input\.owner must remain BrowserHostSession/);
  assert.match(errors, /inlineSdpPayload must be represented by a ref/);
  assert.match(errors, /html must be represented by a ref/);
  assert.match(errors, /rawDom must be represented by a ref/);
  assert.match(errors, /contains raw payload or forbidden live backing text/);
});

function deterministicSession(id: string): BrowserHostWebRtcContractSession {
  return {
    id,
    owner: 'host',
    providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
    status: 'ready',
    liveSurfaceTransport: 'host-stream',
    liveSurfaceRef: `browser-host-session:${id}/live-surface`,
    frameStreamRef: `browser-host-session:${id}/frame-stream`,
    singleInteractiveTruth: true,
  };
}

function deterministicSamples(): BrowserHostWebRtcMetricSample[] {
  return [
    {
      sequence: 1,
      observedAtMs: 1_000,
      captureMs: 4,
      encodeMs: 5,
      networkMs: 6,
      decodeMs: 7,
      renderMs: 4,
      endToEndMs: 22,
      frameBytes: 18_000,
      bufferedBytes: 0,
      maxBufferedBytes: 65_536,
      droppedSinceLastFrame: 0,
    },
    {
      sequence: 2,
      observedAtMs: 1_016,
      captureMs: 5,
      encodeMs: 7,
      networkMs: 10,
      decodeMs: 8,
      renderMs: 5,
      endToEndMs: 30,
      frameBytes: 19_000,
      bufferedBytes: 4_096,
      maxBufferedBytes: 65_536,
      droppedSinceLastFrame: 1,
    },
    {
      sequence: 3,
      observedAtMs: 1_032,
      captureMs: 6,
      encodeMs: 6,
      networkMs: 8,
      decodeMs: 9,
      renderMs: 7,
      endToEndMs: 31,
      frameBytes: 20_000,
      bufferedBytes: 70_000,
      maxBufferedBytes: 65_536,
      droppedSinceLastFrame: 2,
      skippedBackpressure: 1,
    },
    {
      sequence: 4,
      observedAtMs: 1_048,
      captureMs: 3,
      encodeMs: 4,
      networkMs: 5,
      decodeMs: 6,
      renderMs: 3,
      endToEndMs: 18,
      frameBytes: 17_000,
      bufferedBytes: 2_048,
      maxBufferedBytes: 65_536,
      droppedSinceLastFrame: 0,
      skippedBusy: 1,
    },
    {
      sequence: 5,
      observedAtMs: 1_064,
      captureMs: 8,
      encodeMs: 9,
      networkMs: 11,
      decodeMs: 13,
      renderMs: 8,
      endToEndMs: 39,
      frameBytes: 21_000,
      bufferedBytes: 32_768,
      maxBufferedBytes: 65_536,
      droppedSinceLastFrame: 1,
      skippedRecentInput: 1,
    },
  ];
}
