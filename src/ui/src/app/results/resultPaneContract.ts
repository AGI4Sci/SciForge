import type { ObjectAction, ObjectReference, ObjectReferenceKind } from '../../domain';
import { objectActions, objectReferenceKinds } from '../../runtimeContracts';
import type { ResultPaneTab } from './ResultShell';

export const RESULT_PANE_TABS = [
  'primary',
  'browser',
  'image',
  'terminal',
  'files',
  'evidence',
] as const satisfies readonly ResultPaneTab[];

export const RESULT_PANE_LIFECYCLE_STATES = [
  'loading',
  'empty',
  'ready',
  'error',
  'blocked',
] as const;

export type ResultPaneLifecycleState = typeof RESULT_PANE_LIFECYCLE_STATES[number];
export type ResultPaneObjectStateKind = ResultPaneLifecycleState | 'unsupported';
export type ResultPaneRoutePurpose = 'focus' | 'open';
export type ResultPaneRouteReason = 'preferred-view' | 'ref-prefix' | 'artifact-type' | 'object-kind' | 'fallback' | 'unsupported';

export type ResultPaneRedactionHint =
  | 'refs-first'
  | 'no-raw-dump'
  | 'mask-secrets'
  | 'bounded-preview'
  | 'workspace-relative-only'
  | 'no-absolute-paths'
  | 'no-provider-payloads'
  | 'native-only-live-surface'
  | 'no-full-dom'
  | 'no-auth-headers'
  | 'no-raw-screenshot-bytes'
  | 'no-private-coordinates'
  | 'no-executor-params'
  | 'terminal-equivalent-only'
  | 'no-gui-computer-use-execution'
  | 'bounded-logs'
  | 'no-env-dump'
  | 'cite-refs-only'
  | 'redact-internal-audit';

export interface ResultPaneStateDescriptor {
  state: ResultPaneLifecycleState;
  title: string;
  description: string;
  refPolicy: 'none' | 'optional' | 'required';
}

export interface ResultPaneRequiredRef {
  name: string;
  description: string;
  prefixes: readonly string[];
  requiredFor: readonly ResultPaneLifecycleState[];
}

export interface ResultPaneAttachStateDescriptor {
  state: string;
  title: string;
  description: string;
  placeholderEvidence: false;
}

export interface ResultPaneContract {
  pane: ResultPaneTab;
  objectKinds: readonly ObjectReferenceKind[];
  refPrefixes: readonly string[];
  states: Record<ResultPaneLifecycleState, ResultPaneStateDescriptor>;
  attachStates?: Record<string, ResultPaneAttachStateDescriptor>;
  allowedActions: readonly ObjectAction[];
  requiredRefs: readonly ResultPaneRequiredRef[];
  redactionHints: readonly ResultPaneRedactionHint[];
  acceptedPayloadRefs?: readonly string[];
  rejectedPayloadFields?: readonly string[];
}

export interface ResultPaneRoute {
  pane: ResultPaneTab;
  purpose: ResultPaneRoutePurpose;
  reason: ResultPaneRouteReason;
  composerInsertion: false;
  matched?: string;
  objectKind?: string;
  objectRef?: string;
  artifactType?: string;
  preferredView?: string;
}

export interface ResultPaneResolvedObjectSummary {
  id: string;
  title: string;
  kind: ObjectReferenceKind;
  ref: string;
  artifactType?: string;
  preferredView?: string;
  status?: ObjectReference['status'];
  runId?: string;
  executionUnitId?: string;
}

export interface ResultPaneUnsupportedObjectSummary {
  kind: 'unsupported';
  valueType: string;
  hasRef: boolean;
  declaredKind?: string;
  refPrefix?: string;
  preferredView?: string;
  title?: string;
}

export interface ResultPaneKnownObjectState {
  state: ResultPaneLifecycleState;
  pane: ResultPaneTab;
  route: ResultPaneRoute;
  object: ResultPaneResolvedObjectSummary;
  contract: ResultPaneContract;
  allowedActions: readonly ObjectAction[];
  requiredRefs: readonly ResultPaneRequiredRef[];
  redactionHints: readonly ResultPaneRedactionHint[];
  diagnostics: readonly string[];
}

export interface ResultPaneUnsupportedObjectState {
  state: 'unsupported';
  pane: ResultPaneTab;
  route: ResultPaneRoute;
  object: ResultPaneUnsupportedObjectSummary;
  allowedActions: readonly [];
  requiredRefs: readonly ResultPaneRequiredRef[];
  redactionHints: readonly ResultPaneRedactionHint[];
  diagnostics: readonly string[];
}

export type ResultPaneObjectState = ResultPaneKnownObjectState | ResultPaneUnsupportedObjectState;

const COMMON_REDACTION_HINTS = [
  'refs-first',
  'no-raw-dump',
  'mask-secrets',
] as const satisfies readonly ResultPaneRedactionHint[];

type CanonicalResultPaneTab = Exclude<ResultPaneTab, 'screen'>;

export const RESULT_PANE_CONTRACTS: Record<CanonicalResultPaneTab, ResultPaneContract> = {
  primary: defineResultPaneContract({
    pane: 'primary',
    objectKinds: ['artifact', 'scenario-package'],
    refPrefixes: ['artifact:', 'result:', 'preview:', 'ui:', 'scenario-package:'],
    states: paneStates('Primary result'),
    allowedActions: ['focus-right-pane', 'inspect', 'pin', 'compare'],
    requiredRefs: [{
      name: 'primaryObjectRef',
      description: 'Stable object ref for the primary deliverable or typed inspector payload.',
      prefixes: ['artifact:', 'result:', 'preview:', 'ui:', 'scenario-package:'],
      requiredFor: ['ready', 'error', 'blocked'],
    }],
    redactionHints: [...COMMON_REDACTION_HINTS, 'bounded-preview', 'no-provider-payloads'],
  }),
  browser: defineResultPaneContract({
    pane: 'browser',
    objectKinds: ['url', 'artifact'],
    refPrefixes: ['url:', 'http://', 'https://', 'browser:', 'browser-runtime:', 'browser-session:', 'browser-snapshot:', 'browser-host-session:'],
    states: paneStates('Browser object'),
    allowedActions: ['focus-right-pane', 'open-external', 'copy-path', 'pin'],
    requiredRefs: [{
      name: 'browserRef',
      description: 'URL or browser runtime ref; DOM, screenshots, console, and network data stay behind refs.',
      prefixes: ['url:', 'http://', 'https://', 'browser:', 'browser-runtime:', 'browser-session:', 'browser-snapshot:', 'browser-host-session:'],
      requiredFor: ['ready', 'error', 'blocked'],
    }],
    acceptedPayloadRefs: [
      'liveSurfaceRef',
      'frameStreamRef',
      'frameRef',
      'screenshotRef',
      'domSnapshotRef',
      'axSnapshotRef',
      'consoleLogRef',
      'networkLogRef',
      'searchResultRef',
    ],
    rejectedPayloadFields: [
      'frameUrl',
      'framePreviewUrl',
      'frameRenderer',
      'frameTransport',
      'liveTransportHandoff',
      'rawFrame',
      'frameData',
      'frameBytes',
      'frameBase64',
      'screenshotBase64',
      'rawScreenshot',
      'rawDom',
      'domHtml',
      'rawConsoleLog',
      'rawNetworkLog',
      'proxyUrl',
      'webviewTag',
      'webrtcCandidate',
    ],
    redactionHints: [...COMMON_REDACTION_HINTS, 'native-only-live-surface', 'no-full-dom', 'no-auth-headers', 'bounded-preview'],
  }),
  image: defineResultPaneContract({
    pane: 'image',
    objectKinds: ['artifact', 'file', 'execution-unit'],
    refPrefixes: [
      'image:',
      'image-evidence:',
      'screenshot:',
      'annotation:',
      'crop:',
      'browser-evidence:',
      'window-capture:',
      'screen-region:',
      'artifact-preview:',
      'replay:',
      'computer-use:frame',
      'computer-use:frames',
      'screen:',
      'virtual-app-screen:',
    ],
    states: paneStates('Image evidence object'),
    allowedActions: ['focus-right-pane', 'inspect', 'open-external', 'copy-path', 'pin'],
    requiredRefs: [{
      name: 'imageRef',
      description: 'Stable image evidence ref; binary image bytes, raw screenshots, and data URLs stay outside the thread payload.',
      prefixes: ['image:', 'image-evidence:', 'screenshot:', 'annotation:', 'crop:', 'browser-evidence:', 'window-capture:', 'screen-region:', 'artifact-preview:', 'replay:', 'computer-use:frame', 'computer-use:frames', 'screen:', 'virtual-app-screen:'],
      requiredFor: ['ready', 'error', 'blocked'],
    }, {
      name: 'provenanceRef',
      description: 'Provenance ref describing source, time, dimensions, hash, and target for the image evidence.',
      prefixes: ['provenance:', 'evidence:', 'browser-evidence:', 'annotation:', 'crop:', 'artifact:', 'replay:', 'computer-use:'],
      requiredFor: ['ready', 'error', 'blocked'],
    }],
    redactionHints: [
      ...COMMON_REDACTION_HINTS,
      'no-raw-screenshot-bytes',
      'no-private-coordinates',
      'no-provider-payloads',
      'no-executor-params',
      'no-gui-computer-use-execution',
      'bounded-preview',
    ],
    acceptedPayloadRefs: [
      'imageRef',
      'ref',
      'sourceKind',
      'mime',
      'width',
      'height',
      'sha256',
      'createdAt',
      'bounds',
      'cropBounds',
      'provenanceRef',
      'provenanceRefs',
      'annotationRefs',
      'targetRef',
      'windowRef',
      'browserSessionRef',
      'artifactRef',
      'redactionRef',
      'status',
    ],
    rejectedPayloadFields: [
      'rawScreenshot',
      'screenshot',
      'screenshotBase64',
      'imageBase64',
      'base64',
      'base64Screenshot',
      'dataUrl',
      'frameBase64',
      'frameData',
      'rawFrame',
      'rawTrace',
      'traceJson',
      'rawJson',
      'providerJson',
      'providerRoute',
      'providerParams',
      'desktopBridge',
      'executorLease',
      'executorLeaseParams',
      'executorParams',
      'schedulerParams',
      'frameUrl',
      'framePreviewUrl',
      'thumbnailPreviewUrl',
      'rawUrl',
      'inputLeaseRef',
      'actionAdapterRef',
      'liveSurfaceRef',
      'frameStreamRef',
      'sessionRef',
    ],
  }),
  terminal: defineResultPaneContract({
    pane: 'terminal',
    objectKinds: ['execution-unit', 'artifact'],
    refPrefixes: ['terminal:', 'terminal-session:', 'terminal-transcript:', 'pty-transcript:', 'shell:', 'exec:', 'execution-unit:', 'EU-'],
    states: paneStates('Terminal object'),
    allowedActions: ['focus-right-pane', 'inspect', 'copy-path', 'pin'],
    requiredRefs: [{
      name: 'executionRef',
      description: 'Host-owned terminal session, transcript, PTY transcript, or execution-unit ref for terminal reconstruction.',
      prefixes: ['terminal:', 'terminal-session:', 'terminal-transcript:', 'pty-transcript:', 'shell:', 'exec:', 'execution-unit:', 'EU-'],
      requiredFor: ['ready', 'error', 'blocked'],
    }],
    redactionHints: [...COMMON_REDACTION_HINTS, 'bounded-logs', 'no-env-dump'],
  }),
  files: defineResultPaneContract({
    pane: 'files',
    objectKinds: ['file', 'folder', 'artifact'],
    refPrefixes: ['file:', 'folder:', 'workspace:', '.sciforge/'],
    states: paneStates('Workspace object'),
    allowedActions: ['focus-right-pane', 'open-external', 'reveal-in-folder', 'copy-path', 'pin', 'compare'],
    requiredRefs: [{
      name: 'workspaceRef',
      description: 'Workspace-relative file or folder ref; absolute local paths are not required by the pane.',
      prefixes: ['file:', 'folder:', 'workspace:', '.sciforge/'],
      requiredFor: ['ready', 'error', 'blocked'],
    }],
    redactionHints: [...COMMON_REDACTION_HINTS, 'workspace-relative-only', 'no-absolute-paths', 'bounded-preview'],
  }),
  evidence: defineResultPaneContract({
    pane: 'evidence',
    objectKinds: ['run', 'artifact', 'file', 'folder', 'execution-unit', 'url', 'scenario-package'],
    refPrefixes: [
      'run:',
      'run-',
      'evidence:',
      'source:',
      'citation:',
      'claim:',
      'workEvidence:',
      'trace:',
      'subagent:',
      'artifact:subagent-result-',
      'artifact:subagent-transcript-',
      'transcript:',
      'agent-result:',
      'agent-transcript:',
      'audit:',
      'ledger:',
      'message:',
      'artifact:',
      'file:',
      'folder:',
      'workspace:',
      'terminal:',
      'terminal-session:',
      'terminal-transcript:',
      'pty-transcript:',
      'execution-unit:',
      'url:',
      'http://',
      'https://',
      'scenario-package:',
    ],
    states: paneStates('References object'),
    allowedActions: ['focus-right-pane', 'inspect', 'open-external', 'copy-path', 'pin', 'compare'],
    requiredRefs: [{
      name: 'referenceRef',
      description: 'Object ref used by the References pane to inspect focus target, provenance, and cited context.',
      prefixes: [
        'run:',
        'run-',
        'evidence:',
        'source:',
        'citation:',
        'claim:',
        'workEvidence:',
        'trace:',
        'subagent:',
        'artifact:subagent-result-',
        'artifact:subagent-transcript-',
        'transcript:',
        'agent-result:',
        'agent-transcript:',
        'audit:',
        'ledger:',
        'message:',
        'artifact:',
        'file:',
        'folder:',
        'workspace:',
        'terminal:',
        'terminal-session:',
        'terminal-transcript:',
        'pty-transcript:',
        'execution-unit:',
        'url:',
        'http://',
        'https://',
        'scenario-package:',
      ],
      requiredFor: ['ready', 'error', 'blocked'],
    }],
    redactionHints: [...COMMON_REDACTION_HINTS, 'cite-refs-only', 'redact-internal-audit'],
  }),
};

const OBJECT_KIND_ROUTE: Record<ObjectReferenceKind, ResultPaneTab> = {
  artifact: 'primary',
  file: 'files',
  folder: 'files',
  run: 'evidence',
  'execution-unit': 'terminal',
  url: 'browser',
  'scenario-package': 'primary',
};

const PREFERRED_VIEW_ROUTES: Array<{ pane: ResultPaneTab; pattern: RegExp; label: string }> = [
  { pane: 'browser', pattern: /\b(?:browser|web|url|site|page|dom)\b/i, label: 'browser' },
  { pane: 'image', pattern: /\b(?:image|visual|screen|screenshot|desktop|replay|vision|annotation|crop)\b/i, label: 'image' },
  { pane: 'terminal', pattern: /\b(?:terminal|shell|console|execution|notebook-timeline)\b/i, label: 'terminal' },
  { pane: 'files', pattern: /\b(?:workspace-file|file-viewer|folder|editor|diff|patch|compare|comparison)\b/i, label: 'files' },
  { pane: 'evidence', pattern: /\b(?:evidence|reference|references|source|citation|audit|ledger|subagent|agent-result|agent-transcript)\b/i, label: 'evidence' },
  { pane: 'primary', pattern: /\b(?:primary|result|report|viewer|figure|plot|table|matrix|structure|graph|inspector|preview)\b/i, label: 'primary' },
];

const ARTIFACT_TYPE_ROUTES: Array<{ pane: ResultPaneTab; pattern: RegExp; label: string }> = [
  { pane: 'browser', pattern: /\b(?:browser|browser-runtime|browser-snapshot|web-page|webpage|dom-snapshot)\b/i, label: 'browser-artifact' },
  { pane: 'image', pattern: /\b(?:image|image-evidence|annotation|annotation-crop|screenshot|browser-evidence|window-capture|screen-region|artifact-image|artifact-preview|replay-frame|replay|virtual-screen|screen|app-screen|desktop-frame)\b/i, label: 'image-artifact' },
  { pane: 'terminal', pattern: /\b(?:terminal|terminal-transcript|pty|shell|execution-log|command-output)\b/i, label: 'terminal-artifact' },
];

export function resultPaneContractForTab(tab: ResultPaneTab): ResultPaneContract {
  return RESULT_PANE_CONTRACTS[canonicalResultPaneTab(tab)];
}

export function requiredRefsForResultPane(tab: ResultPaneTab): readonly ResultPaneRequiredRef[] {
  return resultPaneContractForTab(tab).requiredRefs;
}

export function redactionHintsForResultPane(tab: ResultPaneTab): readonly ResultPaneRedactionHint[] {
  return resultPaneContractForTab(tab).redactionHints;
}

export function focusResultPaneRouteForObjectReference(reference: unknown): ResultPaneRoute {
  return resolveResultPaneRoute(reference, { purpose: 'focus' });
}

export function openResultPaneRouteForObjectReference(reference: unknown): ResultPaneRoute {
  return resolveResultPaneRoute(reference, { purpose: 'open' });
}

export function resolveResultPaneRoute(reference: unknown, options: { purpose?: ResultPaneRoutePurpose } = {}): ResultPaneRoute {
  const purpose = options.purpose ?? 'focus';
  const record = isRecord(reference) ? reference : undefined;
  const rawStringRef = typeof reference === 'string' ? cleanInlineString(reference) : undefined;
  const objectKind = cleanInlineString(record?.kind);
  const objectRef = cleanInlineString(record?.ref);
  const routeRef = objectRef ?? rawStringRef;
  const artifactType = cleanInlineString(record?.artifactType);
  const preferredView = cleanInlineString(record?.preferredView);
  const preferredRoute = paneForPreferredView(preferredView);
  if (preferredRoute) {
    return {
      pane: preferredRoute.pane,
      purpose,
      reason: 'preferred-view',
      composerInsertion: false,
      matched: preferredRoute.label,
      objectKind,
      objectRef,
      artifactType,
      preferredView,
    };
  }
  const artifactTypeRoute = objectKind === 'artifact' ? paneForArtifactType(artifactType) : undefined;
  if (artifactTypeRoute) {
    return {
      pane: artifactTypeRoute.pane,
      purpose,
      reason: 'artifact-type',
      composerInsertion: false,
      matched: artifactTypeRoute.label,
      objectKind,
      objectRef,
      artifactType,
      preferredView,
    };
  }
  const refRoute = paneForRefPrefix(routeRef);
  if (refRoute) {
    return {
      pane: refRoute.pane,
      purpose,
      reason: 'ref-prefix',
      composerInsertion: false,
      matched: refRoute.prefix,
      objectKind,
      objectRef: routeRef,
      artifactType,
      preferredView,
    };
  }
  if (isObjectReferenceKind(objectKind)) {
    return {
      pane: OBJECT_KIND_ROUTE[objectKind],
      purpose,
      reason: 'object-kind',
      composerInsertion: false,
      matched: objectKind,
      objectKind,
      objectRef,
      artifactType,
      preferredView,
    };
  }
  return {
    pane: 'primary',
    purpose,
    reason: objectKind || objectRef || artifactType || preferredView ? 'fallback' : 'unsupported',
    composerInsertion: false,
    objectKind,
    objectRef,
    artifactType,
    preferredView,
  };
}

export function resolveResultPaneObjectState(
  value: unknown,
  options: { state?: ResultPaneLifecycleState; purpose?: ResultPaneRoutePurpose } = {},
): ResultPaneObjectState {
  const route = resolveResultPaneRoute(value, { purpose: options.purpose });
  const pane = route.pane;
  const contract = resultPaneContractForTab(pane);
  if (!isSupportedResultPaneObjectReference(value)) {
    return {
      state: 'unsupported',
      pane,
      route: unsupportedRoute(route),
      object: unsupportedObjectSummary(value),
      allowedActions: [],
      requiredRefs: contract.requiredRefs,
      redactionHints: uniqueRedactionHints([...contract.redactionHints, ...COMMON_REDACTION_HINTS]),
      diagnostics: unsupportedObjectDiagnostics(value),
    };
  }
  const state = options.state ?? lifecycleStateForObjectReference(value);
  return {
    state,
    pane,
    route,
    object: objectSummary(value),
    contract,
    allowedActions: allowedActionsForResultPaneObject(value, pane),
    requiredRefs: contract.requiredRefs,
    redactionHints: contract.redactionHints,
    diagnostics: [],
  };
}

export function allowedActionsForResultPaneObject(reference: unknown, pane: ResultPaneTab): readonly ObjectAction[] {
  const contract = resultPaneContractForTab(pane);
  const declared = isRecord(reference) && Array.isArray(reference.actions)
    ? reference.actions.filter(isObjectAction)
    : contract.allowedActions;
  const allowed = declared.filter((action) => contract.allowedActions.includes(action));
  return uniqueObjectActions(allowed);
}

export function isSupportedResultPaneObjectReference(value: unknown): value is ObjectReference {
  if (!isRecord(value)) return false;
  return isObjectReferenceKind(cleanInlineString(value.kind))
    && Boolean(cleanInlineString(value.id))
    && Boolean(cleanInlineString(value.title))
    && Boolean(cleanInlineString(value.ref));
}

function defineResultPaneContract(contract: ResultPaneContract): ResultPaneContract {
  return contract;
}

function paneStates(label: string): Record<ResultPaneLifecycleState, ResultPaneStateDescriptor> {
  return {
    loading: {
      state: 'loading',
      title: `${label} loading`,
      description: 'The pane is waiting on a typed ref or projection update.',
      refPolicy: 'optional',
    },
    empty: {
      state: 'empty',
      title: `${label} empty`,
      description: 'The pane has no user-facing object for the current selection.',
      refPolicy: 'optional',
    },
    ready: {
      state: 'ready',
      title: `${label} ready`,
      description: 'The pane can render from declared typed refs.',
      refPolicy: 'required',
    },
    error: {
      state: 'error',
      title: `${label} error`,
      description: 'The pane should show a bounded diagnostic without dumping raw payloads.',
      refPolicy: 'required',
    },
    blocked: {
      state: 'blocked',
      title: `${label} blocked`,
      description: 'The pane should explain the blocking condition and preserve refs for retry.',
      refPolicy: 'required',
    },
  };
}

function paneForPreferredView(preferredView: string | undefined): { pane: ResultPaneTab; label: string } | undefined {
  if (!preferredView) return undefined;
  const match = PREFERRED_VIEW_ROUTES.find((route) => route.pattern.test(preferredView));
  return match ? { pane: match.pane, label: match.label } : undefined;
}

function paneForArtifactType(artifactType: string | undefined): { pane: ResultPaneTab; label: string } | undefined {
  if (!artifactType) return undefined;
  const match = ARTIFACT_TYPE_ROUTES.find((route) => route.pattern.test(artifactType));
  return match ? { pane: match.pane, label: match.label } : undefined;
}

function paneForRefPrefix(ref: string | undefined): { pane: ResultPaneTab; prefix: string } | undefined {
  if (!ref) return undefined;
  let best: { pane: ResultPaneTab; prefix: string } | undefined;
  for (const pane of RESULT_PANE_TABS) {
    const match = RESULT_PANE_CONTRACTS[pane].refPrefixes.find((prefix) => refStartsWithPrefix(ref, prefix));
    if (!match) continue;
    if (!best || match.length > best.prefix.length) best = { pane, prefix: match };
  }
  return best;
}

function canonicalResultPaneTab(tab: ResultPaneTab): CanonicalResultPaneTab {
  return tab === 'screen' ? 'image' : tab;
}

function lifecycleStateForObjectReference(reference: ObjectReference): ResultPaneLifecycleState {
  if (reference.status === 'blocked') return 'blocked';
  if (reference.status === 'missing') return 'empty';
  if (reference.status === 'expired') return 'error';
  return 'ready';
}

function objectSummary(reference: ObjectReference): ResultPaneResolvedObjectSummary {
  return {
    id: reference.id,
    title: reference.title,
    kind: reference.kind,
    ref: reference.ref,
    artifactType: reference.artifactType,
    preferredView: reference.preferredView,
    status: reference.status,
    runId: reference.runId,
    executionUnitId: reference.executionUnitId,
  };
}

function unsupportedObjectSummary(value: unknown): ResultPaneUnsupportedObjectSummary {
  const record = isRecord(value) ? value : undefined;
  const ref = cleanInlineString(record?.ref);
  const title = redactInlineText(cleanInlineString(record?.title));
  return {
    kind: 'unsupported',
    valueType: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    hasRef: Boolean(ref),
    declaredKind: redactInlineText(cleanInlineString(record?.kind)),
    refPrefix: refPrefixFor(ref),
    preferredView: redactInlineText(cleanInlineString(record?.preferredView)),
    title,
  };
}

function unsupportedObjectDiagnostics(value: unknown): readonly string[] {
  if (!isRecord(value)) return ['Result object must be a typed object reference.'];
  const diagnostics: string[] = [];
  const kind = cleanInlineString(value.kind);
  if (!isObjectReferenceKind(kind)) diagnostics.push('Result object kind is unsupported.');
  if (!cleanInlineString(value.id)) diagnostics.push('Result object id is required.');
  if (!cleanInlineString(value.title)) diagnostics.push('Result object title is required.');
  if (!cleanInlineString(value.ref)) diagnostics.push('Result object ref is required.');
  return diagnostics.length ? diagnostics : ['Result object contract is unsupported.'];
}

function unsupportedRoute(route: ResultPaneRoute): ResultPaneRoute {
  return {
    pane: route.pane,
    purpose: route.purpose,
    reason: route.reason === 'fallback' ? 'unsupported' : route.reason,
    composerInsertion: false,
    matched: route.matched,
    objectKind: redactInlineText(route.objectKind),
    preferredView: redactInlineText(route.preferredView),
  };
}

function cleanInlineString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function refPrefixFor(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  const lower = ref.toLowerCase();
  if (lower.startsWith('http://')) return 'http://';
  if (lower.startsWith('https://')) return 'https://';
  if (lower.startsWith('.sciforge/')) return '.sciforge/';
  if (ref.startsWith('EU-')) return 'EU-';
  if (lower.startsWith('run-')) return 'run-';
  const match = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(ref);
  return match?.[0];
}

function refStartsWithPrefix(ref: string, prefix: string): boolean {
  if (prefix === 'EU-') return ref.startsWith(prefix);
  return ref.toLowerCase().startsWith(prefix.toLowerCase());
}

function isObjectReferenceKind(value: unknown): value is ObjectReferenceKind {
  return typeof value === 'string' && objectReferenceKinds.includes(value as ObjectReferenceKind);
}

function isObjectAction(value: unknown): value is ObjectAction {
  return typeof value === 'string' && objectActions.includes(value as ObjectAction);
}

function uniqueObjectActions(actions: readonly ObjectAction[]): readonly ObjectAction[] {
  return [...new Set(actions)];
}

function uniqueRedactionHints(hints: readonly ResultPaneRedactionHint[]): readonly ResultPaneRedactionHint[] {
  return [...new Set(hints)];
}

function redactInlineText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/sk-[A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/\b(?:authorization|api[-_ ]?key|token|secret|password|credential)\b\s*[:=]\s*[^,\s;]+/gi, '[redacted]')
    .slice(0, 120);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
