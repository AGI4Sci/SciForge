import type {
  WindowActionAdapterContext,
  WindowActionAdapterHandlers,
  WindowActionAdapterResult,
  WindowActionEvidenceRef,
} from '../window-action-session.js';

export interface AppiumMac2WindowActionRequest {
  serverUrl: string;
  bundleId: 'com.apple.TextEdit';
  actionId: string;
  action: 'type' | 'save';
  text?: string;
  sessionId: string;
  targetWindowRef: string;
  targetArtifactPath?: string;
}

export interface AppiumMac2WindowActionClientResult {
  executorEventRef?: string;
  inputEventRef?: string;
  verifierRef?: string;
  artifactValidatorRef?: string;
  freshnessInvalidationRef?: string;
  afterEvidenceRef?: string;
  blockedReason?: string;
}

export type AppiumMac2WindowActionClient =
  (request: AppiumMac2WindowActionRequest) => Promise<AppiumMac2WindowActionClientResult> | AppiumMac2WindowActionClientResult;

export function createAppiumMac2WindowActionAdapter(options: {
  serverUrl?: string;
  executorEnabled?: boolean;
  client?: AppiumMac2WindowActionClient;
}): NonNullable<WindowActionAdapterHandlers['appium-mac2']> {
  return async (context) => {
    const serverUrl = normalizedLoopbackAppiumUrl(options.serverUrl);
    if (!serverUrl) {
      return blocked('Appium Mac2 adapter blocked: server URL must be an http loopback URL.');
    }
    if (options.executorEnabled !== true) {
      return blocked('Appium Mac2 adapter blocked: target-bound executor is not explicitly enabled.');
    }
    if (!isTextEditContext(context)) {
      return blocked('Appium Mac2 adapter blocked: only the TextEdit bundle com.apple.TextEdit is supported in this executor slice.');
    }
    if (context.input.action !== 'type' && context.input.action !== 'save') {
      return blocked(`Appium Mac2 adapter blocked: unsupported action ${context.input.action}.`);
    }
    if (!options.client) {
      return blocked('Appium Mac2 adapter blocked: no target-bound WebDriver client is registered.');
    }
    const actionId = context.input.actionId ?? `${context.session.id}-${context.input.action}`;
    const clientResult = await options.client({
      serverUrl,
      bundleId: 'com.apple.TextEdit',
      actionId,
      action: context.input.action,
      ...(context.input.text ? { text: context.input.text } : {}),
      sessionId: context.session.id,
      targetWindowRef: context.session.windowRef,
      ...(context.input.targetDescription ? { targetArtifactPath: context.input.targetDescription } : {}),
    });
    if (clientResult.blockedReason) return blocked(clientResult.blockedReason);
    const executorEventRef = boundedRef(clientResult.executorEventRef);
    const inputEventRef = boundedRef(clientResult.inputEventRef);
    const verifierRef = boundedRef(clientResult.verifierRef);
    const afterEvidenceRef = boundedRef(clientResult.afterEvidenceRef);
    const freshnessInvalidationRef = boundedRef(clientResult.freshnessInvalidationRef);
    const artifactValidatorRef = boundedRef(clientResult.artifactValidatorRef);
    const missing = [
      executorEventRef ? undefined : 'executor-event ref',
      inputEventRef ? undefined : 'input-event ref',
      verifierRef ? undefined : 'verifier ref',
      afterEvidenceRef ? undefined : 'after evidence ref',
      freshnessInvalidationRef ? undefined : 'freshness-invalidation ref',
      context.input.action === 'save' && !artifactValidatorRef ? 'artifact-validator ref' : undefined,
    ].filter((item): item is string => Boolean(item));
    if (missing.length) return blocked(`Appium Mac2 adapter blocked: client result missing ${missing.join(', ')}.`);
    const completedRefs = {
      executorEventRef: executorEventRef as string,
      inputEventRef: inputEventRef as string,
      verifierRef: verifierRef as string,
      afterEvidenceRef: afterEvidenceRef as string,
      freshnessInvalidationRef: freshnessInvalidationRef as string,
    };
    return {
      status: 'completed',
      evidenceRefs: refs([
        { kind: 'executor-event', ref: completedRefs.executorEventRef },
        { kind: 'input-event', ref: completedRefs.inputEventRef },
        { kind: 'verification', ref: completedRefs.verifierRef },
        { kind: 'freshness-invalidation', ref: completedRefs.freshnessInvalidationRef },
        ...(artifactValidatorRef ? [{ kind: 'artifact-validator', ref: artifactValidatorRef }] : []),
      ]),
      inputEventRefs: refs([{ kind: 'input-event', ref: completedRefs.inputEventRef }]),
      artifactValidatorRefs: artifactValidatorRef ? refs([{ kind: 'artifact-validator', ref: artifactValidatorRef }]) : [],
      afterEvidenceRefs: refs([{ kind: 'after-evidence', ref: completedRefs.afterEvidenceRef }]),
    };
  };
}

function blocked(reason: string): WindowActionAdapterResult {
  return {
    status: 'blocked',
    blockedReason: reason,
    evidenceRefs: [{ kind: 'appium-mac2-readiness', ref: 'appium-mac2:textedit/readiness/blocked' }],
  };
}

function normalizedLoopbackAppiumUrl(value: string | undefined): string | undefined {
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

function isTextEditContext(context: WindowActionAdapterContext): boolean {
  return context.session.app.id === 'com.apple.TextEdit' || context.input.target.app?.id === 'com.apple.TextEdit';
}

function refs(items: WindowActionEvidenceRef[]): WindowActionEvidenceRef[] {
  return items.filter((item) => Boolean(item.ref));
}

function boundedRef(value: string | undefined): string | undefined {
  if (!value || value.length > 240) return undefined;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer/i.test(value)) return undefined;
  if (/^(?:appium-mac2:|window-action-session:|action-ledger:|evidence:|workEvidence:|desktop-native:|native-host:|audit:)/i.test(value)) return value;
  return undefined;
}
