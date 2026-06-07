import type {
  AppiumMac2WindowActionClient,
  AppiumMac2WindowActionClientResult,
  AppiumMac2WindowActionRequest,
} from './appium-mac2-window-action-adapter.js';

export type AppiumMac2SavedArtifactValidator =
  (input: { sourceXml: string; request: AppiumMac2WindowActionRequest }) => Promise<string> | string;

export type AppiumMac2Fetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export function createAppiumMac2WebDriverClient(options: {
  fetch?: AppiumMac2Fetch;
  validateSavedArtifact?: AppiumMac2SavedArtifactValidator;
  timeoutMs?: number;
} = {}): AppiumMac2WindowActionClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return async (request) => {
    const serverUrl = normalizedLoopbackWebDriverUrl(request.serverUrl);
    if (!serverUrl) {
      return blocked('Appium Mac2 WebDriver client blocked: server URL must be an http loopback URL without credentials.');
    }
    if (request.bundleId !== 'com.apple.TextEdit') {
      return blocked('Appium Mac2 WebDriver client blocked: only com.apple.TextEdit is supported.');
    }
    if (request.action === 'save' && !options.validateSavedArtifact) {
      return blocked('Appium Mac2 WebDriver client blocked: save requires a saved artifact validator.');
    }
    if (typeof fetchImpl !== 'function') {
      return blocked('Appium Mac2 WebDriver client blocked: WebDriver fetch transport is unavailable.');
    }

    let webdriverSessionId: string | undefined;
    try {
      const session = await webdriverJson(fetchImpl, `${serverUrl}/session`, {
        method: 'POST',
        timeoutMs: options.timeoutMs,
        body: {
          capabilities: {
            alwaysMatch: {
              platformName: 'mac',
              'appium:automationName': 'mac2',
              'appium:bundleId': 'com.apple.TextEdit',
              'appium:noReset': true,
            },
            firstMatch: [{}],
          },
        },
      });
      webdriverSessionId = webdriverSessionIdFrom(session);
      if (!webdriverSessionId) return blocked('Appium Mac2 WebDriver client blocked: WebDriver session response was missing a session id.');

      const actionResult = await webdriverJson(fetchImpl, `${serverUrl}/session/${encodeURIComponent(webdriverSessionId)}/actions`, {
        method: 'POST',
        timeoutMs: options.timeoutMs,
        body: { actions: [keyboardAction(request)] },
      });
      if (webdriverError(actionResult)) return blocked('Appium Mac2 WebDriver client blocked: WebDriver actions failed.');

      const source = await webdriverJson(fetchImpl, `${serverUrl}/session/${encodeURIComponent(webdriverSessionId)}/source`, {
        method: 'GET',
        timeoutMs: options.timeoutMs,
      });
      const sourceXml = webdriverStringValue(source);
      const artifactValidatorRef = request.action === 'save'
        ? await options.validateSavedArtifact?.({ sourceXml, request })
        : undefined;
      return completedRefs(request, artifactValidatorRef);
    } catch (error) {
      return blocked(`Appium Mac2 WebDriver client blocked: ${safeWebDriverFailure(error)}.`);
    } finally {
      if (webdriverSessionId) {
        await webdriverJson(fetchImpl, `${serverUrl}/session/${encodeURIComponent(webdriverSessionId)}`, {
          method: 'DELETE',
          timeoutMs: options.timeoutMs,
        }).catch(() => undefined);
      }
    }
  };
}

function completedRefs(
  request: AppiumMac2WindowActionRequest,
  artifactValidatorRef: string | undefined,
): AppiumMac2WindowActionClientResult {
  const base = `appium-mac2:textedit/actions/${request.actionId}`;
  return {
    executorEventRef: `${base}/webdriver-session`,
    inputEventRef: `${base}/${request.action}-input`,
    verifierRef: `${base}/verification/source-read`,
    afterEvidenceRef: `${base}/after-source`,
    freshnessInvalidationRef: `window-action-session:${request.sessionId}/actions/${request.actionId}/freshness-invalidation.json`,
    ...(artifactValidatorRef ? { artifactValidatorRef } : {}),
  };
}

function keyboardAction(request: AppiumMac2WindowActionRequest) {
  return {
    type: 'key',
    id: 'sciforge-textedit-keyboard',
    actions: request.action === 'save'
      ? [
        { type: 'keyDown', value: '\uE03D' },
        { type: 'keyDown', value: 's' },
        { type: 'keyUp', value: 's' },
        { type: 'keyUp', value: '\uE03D' },
      ]
      : [...(request.text ?? '')].flatMap((value) => [
        { type: 'keyDown', value },
        { type: 'keyUp', value },
      ]),
  };
}

async function webdriverJson(
  fetchImpl: AppiumMac2Fetch,
  url: string,
  input: { method: string; timeoutMs?: number; body?: unknown },
): Promise<unknown> {
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
  const timeout = controller && input.timeoutMs
    ? setTimeout(() => controller.abort(), input.timeoutMs)
    : undefined;
  try {
    const response = await fetchImpl(url, {
      method: input.method,
      headers: input.body === undefined ? undefined : { 'Content-Type': 'application/json; charset=utf-8' },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: controller?.signal,
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) return { value: { error: 'webdriver-error', status: response.status } };
    return payload;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function webdriverSessionIdFrom(value: unknown): string | undefined {
  const record = isRecord(value) ? value : {};
  const nested = isRecord(record.value) ? record.value : {};
  return stringValue(nested.sessionId) ?? stringValue(record.sessionId);
}

function webdriverStringValue(value: unknown): string {
  const record = isRecord(value) ? value : {};
  return stringValue(record.value) ?? '';
}

function webdriverError(value: unknown): boolean {
  const record = isRecord(value) ? value : {};
  const nested = isRecord(record.value) ? record.value : {};
  return Boolean(stringValue(nested.error));
}

function normalizedLoopbackWebDriverUrl(value: string): string | undefined {
  if (!value || value.length > 240) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:') return undefined;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return undefined;
  if (url.username || url.password) return undefined;
  return url.toString().replace(/\/$/, '');
}

function blocked(blockedReason: string): AppiumMac2WindowActionClientResult {
  return { blockedReason };
}

function safeWebDriverFailure(error: unknown): string {
  return error instanceof Error && /abort|timeout/i.test(error.message)
    ? 'WebDriver request timed out'
    : 'WebDriver request failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
