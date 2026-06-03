import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeRightPaneBrowserUrl } from './browserPaneModel';
import { rightPaneBrowserRequiresExternalHost } from './browserPaneHostAdapter';

test('browser host adapter owns native-only BrowserHostSession rendering extraction from ResultsRenderer', () => {
  const adapterSource = readFileSync(new URL('./browserPaneHostAdapter.tsx', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../ResultsRenderer.tsx', import.meta.url), 'utf8');
  const surfaceSource = readFileSync(new URL('./rightPaneSurfaceAdapter.tsx', import.meta.url), 'utf8');
  const styleSource = readFileSync(new URL('../../styles/app-04.css', import.meta.url), 'utf8');
  const browserWorkbenchSource = readFileSync(new URL('../../../../../packages/presentation/components/browser-workbench/render.tsx', import.meta.url), 'utf8');
  const viteConfigSource = readFileSync(new URL('../../../../../vite.config.ts', import.meta.url), 'utf8');

  assert.match(adapterSource, /export function RightPaneBrowserTool/);
  assert.match(adapterSource, /startBrowserHostSession/);
  assert.match(adapterSource, /attachBrowserHostSessionSurface/);
  assert.match(adapterSource, /detachBrowserHostSessionSurface/);
  assert.match(adapterSource, /browserHostSessionUsesNativeSurface/);
  assert.match(adapterSource, /data-browser-native-surface/);
  assert.match(adapterSource, /renderBrowserWorkbench/);
  assert.match(adapterSource, /browserHostSessionForFocusedObjectReference/);
  assert.match(adapterSource, /browserAddressForFocusedObjectReference/);
  assert.match(adapterSource, /const initialHostSession = browserHostSessionForFocusedObjectReference\(focusedObjectReference, session\)/);
  assert.match(adapterSource, /const rightPaneBrowserHostSessionCache = new Map<string, BrowserHostSessionState>\(\);/);
  assert.match(adapterSource, /browserHostSessionMatchesTarget\(initialHostSession, normalizedUrl\) && browserHostSessionHasUsableLiveSurface\(initialHostSession\)/);
  assert.match(adapterSource, /cachedRightPaneBrowserHostSession\(hostSessionCacheKey, normalizedUrl\)/);
  assert.match(adapterSource, /cacheRightPaneBrowserHostSession\(hostSessionCacheKey, normalizedUrl, hostSession\)/);
  assert.match(adapterSource, /function browserHostSessionHasUsableLiveSurface\(session: BrowserHostSessionState \| undefined\) \{[\s\S]*return browserHostSessionUsesNativeSurface\(session\)[\s\S]*session\?\.singleInteractiveTruth === true[\s\S]*session\?\.secondTruthSource === false[\s\S]*Boolean\(session\.liveSurfaceRef\);[\s\S]*\}/);
  assert.match(adapterSource, /function browserHostSessionUsesNativeSurface\(session: BrowserHostSessionState \| undefined\) \{\s*return session\?\.liveSurfaceTransport === 'native-embedded';\s*\}/);
  assert.match(adapterSource, /frameTransport: browserHostSessionHasUsableLiveSurface\(hostSession\) \? 'native-embedded' : undefined/);
  assert.match(adapterSource, /loadingProgress: browserState\.loadingProgress/);
  assert.match(adapterSource, /const hostSurfaceError = needsBrowserHost[\s\S]*!browserHostSessionHasUsableLiveSurface\(projectedHostSession\)[\s\S]*Native embedded BrowserHostSession surface is blocked/);
  assert.match(adapterSource, /hostError: hostSurfaceError/);
  assert.match(adapterSource, /if \(hostError \|\| !needsBrowserHost \|\| !hostSession \|\| !browserHostSessionHasUsableLiveSurface\(hostSession\)/);
  assert.match(adapterSource, /attachBrowserHostSessionSurface\(\{[\s\S]*sessionId: sessionState\.id,[\s\S]*liveSurfaceRef: sessionState\.liveSurfaceRef,[\s\S]*bounds,[\s\S]*visible: true,[\s\S]*focus: nativeSurfaceSessionRef\.current !== sessionState\.id/);
  assert.match(adapterSource, /nativeSurfaceSessionRef\.current = sessionState\.id/);
  assert.match(adapterSource, /if \(!bridge\?\.attachBrowserHostSessionSurface\) \{[\s\S]*detachNativeBrowserSurface\(sessionState\.id\);[\s\S]*Native embedded BrowserHostSession attach bridge is unavailable/);
  assert.match(adapterSource, /if \(nativeBrowserHostSurfaceResultFailed\(result\)\) \{[\s\S]*detachNativeBrowserSurface\(sessionState\.id\);[\s\S]*retry the same session or hand off externally/);
  assert.match(adapterSource, /detachNativeBrowserSurface\(\)/);
  assert.match(adapterSource, /preflightBrowserHostSessionWriter/);
  assert.match(adapterSource, /refreshNativeSurfaceBridgeDiagnostic/);
  assert.match(adapterSource, /probeBrowserHostNativeSurfaceHealth/);
  assert.match(adapterSource, /nativeSurfaceBridge: nativeSurfaceBridgeDiagnostic/);
  assert.match(adapterSource, /native-bridge-unavailable/);
  assert.match(adapterSource, /const rightPaneBridge = desktopBridge \? true : routeBridge/);
  assert.match(adapterSource, /readBrowserHostSessionState/);
  assert.match(adapterSource, /startRuntimeServices/);
  assert.match(adapterSource, /startRuntimeServices\(\{ requireBrowserHostNativeSurface: true \}\)/);
  assert.match(adapterSource, /const runtime = await startRuntimeServices\(\{ requireBrowserHostNativeSurface: true \}\);[\s\S]*if \(runtime\.ok !== true\) throw new Error\(browserRuntimeServicesError\(runtime\)\);/);
  assert.match(adapterSource, /function browserRuntimeServicesError/);
  assert.match(adapterSource, /sendBrowserHostComputerUseAction/);
  assert.match(adapterSource, /sendBrowserHostSessionAction/);
  assert.match(adapterSource, /bufferedTextRef/);
  assert.match(adapterSource, /bufferedScrollRef/);
  assert.match(adapterSource, /pendingCursorRef/);
  assert.match(adapterSource, /pendingMouseMoveRef/);
  assert.match(adapterSource, /mouseMoveRequestInFlightRef/);
  assert.match(adapterSource, /actionId\?: string;[\s\S]*uiEventReceivedAt\?: string;/);
  assert.match(adapterSource, /function requestHostMouseMove\(action: RightPaneBrowserHostAction\)[\s\S]*pendingMouseMoveRef\.current = action[\s\S]*flushPendingHostMouseMove/);
  assert.match(adapterSource, /function flushPendingHostMouseMove\(\)[\s\S]*mouseMoveRequestInFlightRef\.current = true[\s\S]*await sendHostAction\(action, 'none'\)[\s\S]*if \(pendingMouseMoveRef\.current\) void flushPendingHostMouseMove\(\)/);
  assert.match(adapterSource, /dispatchHostAction\(timedAction, 'none'\)/);
  assert.match(adapterSource, /dispatchHostAction\(browserHostActionWithUiTiming\(\{ action: 'type', text,[\s\S]*uiEventReceivedAt: textReceivedAt[\s\S]*\}\), 'none'\)/);
  assert.match(adapterSource, /dispatchHostAction\(browserHostActionWithUiTiming\(\{ action: 'scroll'[\s\S]*uiEventReceivedAt: scrollReceivedAt[\s\S]*\}\), 'none'\)/);
  assert.match(adapterSource, /type: 'mouse_down'/);
  assert.match(adapterSource, /type: 'mouse_move'/);
  assert.match(adapterSource, /type: 'mouse_up'/);
  assert.match(adapterSource, /type: 'wheel'/);
  assert.match(adapterSource, /type: 'cursor'/);
  assert.match(adapterSource, /type: 'press_key'/);
  assert.match(adapterSource, /type: 'hotkey'/);

  assert.doesNotMatch(adapterSource, /browserHostSessionFrameStreamUrl|connectHostFrameStream|parseBrowserHostFrameStreamMessage|reportHostFrameStreamIssue/);
  assert.doesNotMatch(adapterSource, /BROWSER_HOST_FRAME_STREAM|frameStreamSocketRef|frameStreamReceivedBinaryRef|frameStreamCandidateTransportRef/);
  assert.doesNotMatch(adapterSource, /hostFrameObjectUrlRef|pendingBinaryFrameSessionRef|pendingCanvasBinaryFrameRef|createObjectURL|revokeObjectURL/);
  assert.doesNotMatch(adapterSource, /drawBrowserHostCanvas|BrowserHostCanvasBinaryFrame|createImageBitmap|new Image\(|browserHostCanvasBinaryElement/);
  assert.doesNotMatch(adapterSource, /browserHostSessionCanUseHostFrameStream|browserHostSessionUsesCanvasBinaryRenderer|browserHostCanvasBinaryFrameTransport/);
  assert.doesNotMatch(adapterSource, /BrowserWorkbenchLiveTransportHandoff|liveTransportHandoff|frameRenderer:|canvas-binary|webrtc-data-channel|websocket-binary|host-stream/);
  assert.doesNotMatch(adapterSource, /window\.open\(|html2canvas|toDataURL|captureStream|getDisplayMedia|document\.body/);
  assert.doesNotMatch(adapterSource, /type: 'drag', fromX/);

  assert.match(styleSource, /\.right-pane-browser-surface \.browser-workbench-viewer-actions\s*\{[\s\S]*?display: none/);
  assert.match(styleSource, /\.right-pane-browser-surface \.browser-workbench-viewer-diagnostics\s*\{[\s\S]*?position: absolute[\s\S]*?width: 1px[\s\S]*?height: 1px[\s\S]*?clip-path: inset\(50%\)[\s\S]*?pointer-events: none/);
  assert.match(styleSource, /\.right-pane-browser-surface \.browser-workbench-viewer-refs\s*\{[\s\S]*?display: none/);

  assert.match(browserWorkbenchSource, /browser-workbench-host-frame-native/);
  assert.match(browserWorkbenchSource, /data-browser-native-surface/);
  assert.match(browserWorkbenchSource, /data-browser-native-surface-stability-key/);
  assert.match(browserWorkbenchSource, /data-browser-loading-progress-state/);
  assert.match(browserWorkbenchSource, /data-browser-live-surface-transport=\{hostSession\?\.liveSurfaceTransport\}/);
  assert.match(browserWorkbenchSource, /data-browser-diagnostic-live-surface-transport/);
  assert.match(browserWorkbenchSource, /sanitizeBrowserWorkbenchDiagnosticText/);
  assert.match(browserWorkbenchSource, /data-browser-writer-url/);
  assert.match(browserWorkbenchSource, /data-browser-health-capability/);
  assert.match(browserWorkbenchSource, /data-browser-native-adapter-url/);
  assert.match(browserWorkbenchSource, /data-browser-last-action-timing/);
  assert.match(browserWorkbenchSource, /data-browser-last-blocked-reason/);
  assert.doesNotMatch(browserWorkbenchSource, /<iframe|<webview|<canvas|<img/);
  assert.doesNotMatch(browserWorkbenchSource, /browser-workbench-host-keyboard-input|data-browser-host-keyboard-path|browserWorkbenchFramePoint|setPointerCapture/);
  assert.doesNotMatch(browserWorkbenchSource, /BrowserWorkbenchLiveTransportHandoff|BrowserWorkbenchFrameRenderer|frameRenderer|liveTransportHandoff/);
  assert.doesNotMatch(browserWorkbenchSource, /canvas-binary|webrtc-data-channel|websocket-binary|host-stream/);

  assert.match(viteConfigSource, /const body = await readJsonBody\(req\)/);
  assert.match(viteConfigSource, /requireBrowserHostNativeSurface/);
  assert.match(viteConfigSource, /browserRuntimeWorkspaceCapabilities\(requireBrowserHostNativeSurface\)/);
  assert.match(viteConfigSource, /browserRuntimeWorkspaceEndpoints\(requireBrowserHostNativeSurface\)/);
  assert.match(viteConfigSource, /native-surface-adapter-missing/);
  assert.doesNotMatch(viteConfigSource, /BROWSER_HOST_SESSION_RUNTIME_ENDPOINT_TOKENS = \[[^\]]*frame-stream/);

  assert.match(surfaceSource, /from '.\/browserPaneHostAdapter'/);
  assert.doesNotMatch(rendererSource, /function RightPaneBrowserTool/);
  assert.doesNotMatch(rendererSource, /startBrowserHostSession/);
  assert.doesNotMatch(rendererSource, /renderBrowserWorkbench/);
});

test('browser host adapter routes search text and edit keys into BrowserHostSession without host-shell capture', () => {
  const adapterSource = readFileSync(new URL('./browserPaneHostAdapter.tsx', import.meta.url), 'utf8');

  assert.match(adapterSource, /if \(timedAction\.action === 'type' && timedAction\.text\) \{[\s\S]*bufferedTextRef\.current \+= timedAction\.text;[\s\S]*scheduleBufferedHostActionFlush\(\);[\s\S]*return;[\s\S]*\}/);
  assert.match(adapterSource, /if \(timedAction\.action === 'press'\) \{[\s\S]*flushBufferedHostActions\(\);[\s\S]*dispatchHostAction\(timedAction, 'none'\);[\s\S]*return;[\s\S]*\}/);
  assert.match(adapterSource, /if \(text\) dispatchHostAction\(browserHostActionWithUiTiming\(\{ action: 'type', text, uiEventReceivedAt: textReceivedAt \}\), 'none'\);/);
  assert.match(adapterSource, /const computerUseAction = browserHostComputerUseActionFromHostAction\(action\);[\s\S]*sendBrowserHostComputerUseAction\([\s\S]*action: computerUseAction,[\s\S]*capture,[\s\S]*workspaceWriterBaseUrl: currentSession\.workspaceWriterBaseUrl/);
  assert.match(adapterSource, /if \(action\.action === 'type'\) return \{ type: 'type_text', text: action\.text \?\? '' \};/);
  assert.match(adapterSource, /if \(action\.action === 'press'\) return browserHostComputerUseKeyAction\(action\.key\);/);
  assert.match(adapterSource, /function browserHostComputerUseKeyAction\(key: string \| undefined\): BrowserHostComputerUseAction \{[\s\S]*return keys\.length > 1 \? \{ type: 'hotkey', keys \} : \{ type: 'press_key', key: normalized \};[\s\S]*\}/);
  assert.doesNotMatch(adapterSource, /document\.querySelector\(['"][^'"]*(?:chat|composer)|\.focus\(\)[\s\S]*composer|window\.dispatchEvent\([\s\S]*KeyboardEvent/);
});

test('browser host adapter exposes a route-backed native attach bridge when bounded health is ready', () => {
  const adapterSource = readFileSync(new URL('./browserPaneHostAdapter.tsx', import.meta.url), 'utf8');

  assert.match(adapterSource, /function browserHostNativeSurfaceAttachBridge\(/);
  assert.match(adapterSource, /const desktopBridge = desktopBrowserHostSurfaceBridge\(\);[\s\S]*if \(desktopBridge\?\.attachBrowserHostSessionSurface\) return desktopBridge/);
  assert.match(adapterSource, /nativeSurfaceBridgeDiagnostic[\s\S]*routeStatus === 'reachable'[\s\S]*capability === 'ready'/);
  assert.match(adapterSource, /const routeBridge = routeStatus === 'reachable'[\s\S]*browserHostNativeSurfaceRouteHealthTrusted\(healthJson\);[\s\S]*const rightPaneBridge = desktopBridge \? true : routeBridge/);
  assert.match(adapterSource, /const response = await fetch\(/);
  assert.match(adapterSource, /\$\{attachPath\}`/);
  assert.match(adapterSource, /method: 'POST'/);
  assert.match(adapterSource, /body: JSON\.stringify/);
  assert.match(adapterSource, /sessionId: sessionState\.id/);
  assert.match(adapterSource, /liveSurfaceRef: sessionState\.liveSurfaceRef/);
  assert.match(adapterSource, /bounds,/);
  assert.match(adapterSource, /visible: true/);
  assert.match(adapterSource, /focus: booleanRecordField\(inputRecord, 'focus'\) !== false/);
  assert.match(adapterSource, /const stateUrl = new URL\(/);
  assert.match(adapterSource, /\$\{statePath\}`/);
  assert.match(adapterSource, /stateUrl\.searchParams\.set\('sessionId', sessionState\.id\)/);
  assert.match(adapterSource, /browserHostNativeSurfaceRouteStateTrusted\(stateJson, sessionState\)/);
  assert.match(adapterSource, /stringRecordField\(stateJson, 'liveSurfaceTransport'\) === 'native-embedded'/);
  assert.match(adapterSource, /booleanRecordField\(stateJson, 'singleInteractiveTruth'\) === true/);
  assert.match(adapterSource, /booleanRecordField\(stateJson, 'secondTruthSource'\) === false/);
  assert.match(adapterSource, /booleanRecordField\(stateJson, 'rightPaneBridge'\) === true/);
  assert.match(adapterSource, /booleanRecordField\(stateJson, 'passClaim'\) !== false/);

  assert.doesNotMatch(adapterSource, /rawUrl|rawDom|rawScreenshot|base64|providerPayload|secretPayload/);
});

test('browser host adapter clears pending auto-open busy state when cancelled', () => {
  const adapterSource = readFileSync(new URL('./browserPaneHostAdapter.tsx', import.meta.url), 'utf8');

  assert.match(adapterSource, /return \(\) => \{[\s\S]*cancelled = true;[\s\S]*pollStopped = true;[\s\S]*if \(pollTimer !== undefined && typeof window !== 'undefined'\) window\.clearTimeout\(pollTimer\);[\s\S]*if \(rightPaneBrowserUrlsEquivalent\(pendingHostOpenUrlRef\.current, normalizedUrl\)\) pendingHostOpenUrlRef\.current = undefined;[\s\S]*setBusy\(false\);[\s\S]*\};/);
});

test('browser host adapter requires host-owned sessions only for external HTTP targets', () => {
  const external = normalizeRightPaneBrowserUrl('www.google.com');
  assert.equal(external, 'https://www.google.com');
  assert.equal(rightPaneBrowserRequiresExternalHost(external), true);
  assert.equal(rightPaneBrowserRequiresExternalHost('https://example.org/path'), true);
  assert.equal(rightPaneBrowserRequiresExternalHost('http://localhost:5173/'), false);
  assert.equal(rightPaneBrowserRequiresExternalHost('http://127.0.0.1:5173/'), false);
  assert.equal(rightPaneBrowserRequiresExternalHost('http://[::1]:5173/'), false);
  assert.equal(rightPaneBrowserRequiresExternalHost('about:blank'), false);
  assert.equal(rightPaneBrowserRequiresExternalHost('file:///tmp/demo.html'), false);
  assert.equal(rightPaneBrowserRequiresExternalHost('https://%'), false);
});
