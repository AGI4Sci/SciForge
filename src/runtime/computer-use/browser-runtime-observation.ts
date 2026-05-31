import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildBrowserRuntimeStableRef,
  normalizeBrowserRuntimePageQuery,
  type BrowserRuntimePageQuery,
  type BrowserRuntimePageQueryInput,
  type BrowserRuntimeStableRef,
  type BrowserRuntimeStableRefInput,
} from '@sciforge-ui/runtime-contract/browser-runtime';

import { workspaceRel } from './utils.js';

export const COMPUTER_USE_BROWSER_RUNTIME_OBSERVATION_SCHEMA =
  'sciforge.computer-use.browser-runtime-dom-ax-observation.v1' as const;
export const COMPUTER_USE_BROWSER_RUNTIME_GROUNDING_HINT_SCHEMA =
  'sciforge.computer-use.browser-runtime-grounding-hints.v1' as const;

export interface ComputerUseBrowserRuntimeObservationInput {
  sessionRef?: string;
  tabRef?: string;
  snapshotRef?: string;
  visibleDomRef?: string;
  accessibilitySnapshotRef?: string;
  playwrightEvaluateRef?: string;
  pageQuery?: BrowserRuntimePageQueryInput | BrowserRuntimePageQuery;
  stableRefs?: Array<BrowserRuntimeStableRefInput | BrowserRuntimeStableRef>;
  visibleDom?: unknown;
  accessibilitySnapshot?: unknown;
  playwrightEvaluate?: unknown;
  diagnostics?: string[];
}

export interface ComputerUseBrowserRuntimeObservationMaterialized {
  observationRef: string;
  visibleDomRef?: string;
  accessibilitySnapshotRef?: string;
  playwrightEvaluateRef?: string;
  stateSnapshotRef: string;
  groundingHintRef: string;
  groundingRefs: string[];
  stableRefs: BrowserRuntimeStableRef[];
  pageQuery: BrowserRuntimePageQuery;
  diagnostics: string[];
}

const BROWSER_RUNTIME_STABLE_REF_SCHEMA = 'sciforge.browser-runtime.stable-ref.v1';
const FORBIDDEN_INLINE_PAYLOAD_KEY = /(?:base64|dataUrl|rawScreenshot|rawPayload|rawDom|inlineDom|inlineImage|html|fullDom|providerRawPayload|accessibilityTree)$/i;
const FORBIDDEN_STABLE_REF_KEY = /^(?:ref|refs)$|(?:Ref|Refs)$/;

export async function materializeComputerUseBrowserRuntimeObservation(input: {
  workspace: string;
  runDir: string;
  prefix: string;
  scope: {
    displayGroupId?: string;
    screenId?: string;
    windowId?: string;
  };
  observedAt: string;
  screenshotRef?: string;
  browserRuntimeObservation?: unknown;
}): Promise<ComputerUseBrowserRuntimeObservationMaterialized | undefined> {
  const source = asRecord(input.browserRuntimeObservation);
  if (!source) return undefined;

  await mkdir(input.runDir, { recursive: true });
  const diagnostics = stringList(source.diagnostics);
  const displayGroupId = input.scope.displayGroupId ?? stringField(source.displayGroupId) ?? `display-group-${input.prefix}`;
  const screenId = input.scope.screenId ?? stringField(source.screenId) ?? `screen-${input.prefix}`;
  const windowId = input.scope.windowId ?? stringField(source.windowId) ?? `browser-runtime-window-${input.prefix}`;
  const pageQuery = normalizePageQuery(source.pageQuery, diagnostics);
  const stableRefs = normalizeStableRefs(source.stableRefs, diagnostics);
  if (stableRefs.length === 0) {
    diagnostics.push('browser-runtime-observation-skipped:no-stable-ref');
    return undefined;
  }
  const browserSessionRef = bundleLocalRefField(source.sessionRef, diagnostics, 'sessionRef')
    ?? await writeMetadataRef({
      workspace: input.workspace,
      path: join(input.runDir, `${input.prefix}-browser-session.json`),
      payload: {
        schemaVersion: 'sciforge.browser-runtime.session-ref.v1',
        provider: 'browser_runtime',
        observedAt: input.observedAt,
      },
    });
  const sourceSnapshotRef = bundleLocalRefField(source.snapshotRef, diagnostics, 'snapshotRef')
    ?? await writeMetadataRef({
      workspace: input.workspace,
      path: join(input.runDir, `${input.prefix}-browser-source-snapshot.json`),
      payload: {
        schemaVersion: 'sciforge.browser-runtime.snapshot-ref.v1',
        provider: 'browser_runtime',
        screenshotRef: input.screenshotRef,
        observedAt: input.observedAt,
      },
    });
  const visibleDomRef = bundleLocalRefField(source.visibleDomRef, diagnostics, 'visibleDomRef')
    ?? await writeOptionalRef({
      workspace: input.workspace,
      path: join(input.runDir, `${input.prefix}-browser-visible-dom.json`),
      payload: source.visibleDom,
      schemaVersion: 'sciforge.browser-runtime.visible-dom-ref.v1',
      refKind: 'visibleDomRef',
    });
  const accessibilitySnapshotRef = bundleLocalRefField(source.accessibilitySnapshotRef, diagnostics, 'accessibilitySnapshotRef')
    ?? await writeOptionalRef({
      workspace: input.workspace,
      path: join(input.runDir, `${input.prefix}-browser-accessibility-snapshot.json`),
      payload: source.accessibilitySnapshot,
      schemaVersion: 'sciforge.browser-runtime.accessibility-snapshot-ref.v1',
      refKind: 'accessibilitySnapshotRef',
    });
  const playwrightEvaluateRef = bundleLocalRefField(source.playwrightEvaluateRef, diagnostics, 'playwrightEvaluateRef')
    ?? await writeOptionalRef({
      workspace: input.workspace,
      path: join(input.runDir, `${input.prefix}-browser-playwright-evaluate.json`),
      payload: source.playwrightEvaluate,
      schemaVersion: 'sciforge.browser-runtime.playwright-evaluate-ref.v1',
      refKind: 'playwrightEvaluateRef',
    });
  if (!visibleDomRef && !accessibilitySnapshotRef && !playwrightEvaluateRef) {
    diagnostics.push('browser-runtime-observation-skipped:no-dom-ax-or-playwright-ref');
    return undefined;
  }

  const groundingHintPath = join(input.runDir, `${input.prefix}-browser-grounding-hints.json`);
  const groundingHintRef = workspaceRel(input.workspace, groundingHintPath);
  const groundingHints = stableRefs.map((stableRef, index) => ({
    schemaVersion: 'sciforge.computer-use.browser-runtime-grounding-hint.v1',
    hintId: `${input.prefix}-browser-hint-${index + 1}`,
    source: 'browser-runtime-stable-ref',
    displayGroupId,
    screenId,
    windowId,
    stableRef,
    groundingUse: 'candidate-target-only',
    executorLeaseSubstitute: false,
    guiActionSubstitute: false,
    artifactCausalitySubstitute: false,
    completionEvidence: false,
  }));
  await writeFile(groundingHintPath, `${JSON.stringify({
    schemaVersion: COMPUTER_USE_BROWSER_RUNTIME_GROUNDING_HINT_SCHEMA,
    ref: groundingHintRef,
    displayGroupId,
    screenId,
    windowId,
    sourceSnapshotRef,
    visibleDomRef,
    accessibilitySnapshotRef,
    playwrightEvaluateRef,
    pageQuery,
    groundingHints,
    trust: 'untrusted-page-observation',
    completionEvidenceEligible: false,
  }, null, 2)}\n`, 'utf8');

  const observationPath = join(input.runDir, `${input.prefix}-browser-dom-ax-observation.json`);
  const observationRef = workspaceRel(input.workspace, observationPath);
  const stateSnapshotRef = accessibilitySnapshotRef ?? visibleDomRef ?? playwrightEvaluateRef;
  if (!stateSnapshotRef) {
    diagnostics.push('browser-runtime-observation-skipped:no-state-snapshot-ref');
    return undefined;
  }
  await writeFile(observationPath, `${JSON.stringify({
    schemaVersion: COMPUTER_USE_BROWSER_RUNTIME_OBSERVATION_SCHEMA,
    observationId: `${input.prefix}-browser-dom-ax-observation`,
    observationRef,
    ref: observationRef,
    provider: 'browser_runtime',
    displayGroupId,
    screenId,
    windowId,
    browserSessionRef,
    browserTabRef: bundleLocalRefField(source.tabRef, diagnostics, 'tabRef'),
    sourceSnapshotRef,
    screenshotRef: input.screenshotRef,
    visibleDomRef,
    accessibilitySnapshotRef,
    playwrightEvaluateRef,
    stateSnapshotRef,
    pageQuery,
    stableElementRefs: stableRefs,
    stableRefs,
    groundingHintRef,
    groundingRefs: [groundingHintRef],
    observedAt: input.observedAt,
    trust: 'untrusted-page-observation',
    observationUse: 'observe-before-mutate-hint',
    refsFirst: true,
    currentBundleOnly: true,
    completionEvidenceEligible: false,
    executorLeaseSubstitute: false,
    guiActionSubstitute: false,
    artifactCausalitySubstitute: false,
    userLevelCompletionSubstitute: false,
    rawPayloadWritten: false,
    inlineImageWritten: false,
    inlineDomWritten: false,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    diagnostics,
  }, null, 2)}\n`, 'utf8');

  return {
    observationRef,
    visibleDomRef,
    accessibilitySnapshotRef,
    playwrightEvaluateRef,
    stateSnapshotRef,
    groundingHintRef,
    groundingRefs: [groundingHintRef],
    stableRefs,
    pageQuery,
    diagnostics,
  };
}

function normalizePageQuery(value: unknown, diagnostics: string[]): BrowserRuntimePageQuery {
  const fallback: BrowserRuntimePageQueryInput = {
    select: { role: 'button', visible: true },
    fields: ['role', 'ariaLabel', 'innerText', 'bbox', 'isVisible'],
    limit: 20,
  };
  try {
    const candidate = asRecord(value) ?? fallback;
    return normalizeBrowserRuntimePageQuery({
      select: asPageQuerySelect(candidate.select, diagnostics) ?? fallback.select,
      fields: Array.isArray(candidate.fields) ? candidate.fields as BrowserRuntimePageQueryInput['fields'] : fallback.fields,
      limit: typeof candidate.limit === 'number' ? candidate.limit : fallback.limit,
    });
  } catch (error) {
    diagnostics.push(`browser-runtime-page-query-normalized-fallback:${error instanceof Error ? error.message : String(error)}`);
    return normalizeBrowserRuntimePageQuery(fallback);
  }
}

function normalizeStableRefs(value: unknown, diagnostics: string[]): BrowserRuntimeStableRef[] {
  const entries = Array.isArray(value) ? value : [];
  const refs: BrowserRuntimeStableRef[] = [];
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) continue;
    try {
      const input = stableRefInputFromRecord(record, diagnostics);
      if (input) refs.push(buildBrowserRuntimeStableRef(input));
    } catch (error) {
      diagnostics.push(`browser-runtime-stable-ref-dropped:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return refs;
}

function stableRefInputFromRecord(record: Record<string, unknown>, diagnostics: string[]): BrowserRuntimeStableRefInput | undefined {
  if (hasForbiddenStableRefPayload(record)) {
    diagnostics.push('browser-runtime-stable-ref-dropped:unsafe-inline-or-ref-payload');
    return undefined;
  }
  const signals = record.schemaVersion === BROWSER_RUNTIME_STABLE_REF_SCHEMA
    ? asRecord(record.signals) ?? {}
    : record;
  return {
    testId: stringField(signals.testId),
    id: stringField(signals.id),
    selector: stringField(signals.selector),
    domPath: stringField(signals.domPath) ?? stringField(record.primary) ?? 'document',
    role: stringField(signals.role),
    accessibleName: stringField(signals.accessibleName),
    text: stringField(signals.text),
    bbox: rectField(signals.bbox) ?? { x: 0, y: 0, width: 1, height: 1 },
    componentPath: stringField(signals.componentPath),
    visualHash: stringField(signals.visualHash),
  };
}

function hasForbiddenStableRefPayload(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith('data:image/') || value.length > 4096;
  if (Array.isArray(value)) return value.some(hasForbiddenStableRefPayload);
  if (!isRecord(value)) return false;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_INLINE_PAYLOAD_KEY.test(key) || FORBIDDEN_STABLE_REF_KEY.test(key)) return true;
    if (hasForbiddenStableRefPayload(item)) return true;
  }
  return false;
}

async function writeMetadataRef(input: {
  workspace: string;
  path: string;
  payload: Record<string, unknown>;
}) {
  const ref = workspaceRel(input.workspace, input.path);
  await writeFile(input.path, `${JSON.stringify({
    ...input.payload,
    ref,
    refsFirst: true,
    rawPayloadWritten: false,
    inlineImageWritten: false,
  }, null, 2)}\n`, 'utf8');
  return ref;
}

async function writeOptionalRef(input: {
  workspace: string;
  path: string;
  payload: unknown;
  schemaVersion: string;
  refKind: string;
}) {
  if (input.payload === undefined) return undefined;
  const ref = workspaceRel(input.workspace, input.path);
  await writeFile(input.path, `${JSON.stringify({
    schemaVersion: input.schemaVersion,
    ref,
    refKind: input.refKind,
    payload: sanitizeRefPayload(input.payload),
    refsFirst: true,
    rawPayloadWritten: false,
    inlineImageWritten: false,
  }, null, 2)}\n`, 'utf8');
  return ref;
}

function sanitizeRefPayload(value: unknown): unknown {
  if (typeof value === 'string') return value.slice(0, 4096);
  if (Array.isArray(value)) return value.slice(0, 80).map(sanitizeRefPayload);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).slice(0, 80).map(([key, item]) => {
    if (/(?:base64|dataUrl|rawScreenshot|rawPayload|html|dom)$/i.test(key)) return [key, '[stored-as-ref-or-dropped]'];
    return [key, sanitizeRefPayload(item)];
  }));
}

function asPageQuerySelect(value: unknown, diagnostics: string[]): BrowserRuntimePageQueryInput['select'] | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  if (typeof record.ref === 'string') {
    const ref = stableTokenRefField(record.ref, diagnostics, 'pageQuery.select.ref');
    if (ref) return { ref };
  }
  if (typeof record.selector === 'string') return { selector: record.selector };
  const withinRef = stableTokenRefField(record.withinRef, diagnostics, 'pageQuery.select.withinRef');
  const role = stringField(record.role);
  const name = stringField(record.name);
  const visible = typeof record.visible === 'boolean' ? record.visible : undefined;
  if (!role && !name && visible === undefined && !withinRef) return undefined;
  return {
    role,
    name,
    visible,
    withinRef,
  };
}

function rectField(value: unknown) {
  const record = asRecord(value);
  const x = numberField(record?.x);
  const y = numberField(record?.y);
  const width = numberField(record?.width);
  const height = numberField(record?.height);
  return x === undefined || y === undefined || width === undefined || height === undefined
    ? undefined
    : { x, y, width, height };
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function bundleLocalRefField(value: unknown, diagnostics: string[], field: string) {
  const ref = stringField(value);
  if (!ref) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('/') || ref.startsWith('~') || ref.split(/[\\/]/).includes('..')) {
    diagnostics.push(`browser-runtime-ref-dropped:not-current-bundle:${field}`);
    return undefined;
  }
  return ref;
}

function stableTokenRefField(value: unknown, diagnostics: string[], field: string) {
  const ref = stringField(value);
  if (!ref) return undefined;
  if (!isStableTokenRef(ref)) {
    diagnostics.push(`browser-runtime-stable-token-ref-dropped:${field}`);
    return undefined;
  }
  return ref;
}

function isStableTokenRef(ref: string) {
  if (ref.length > 256) return false;
  if (/^(?:https?|file|data|javascript|blob|about):/i.test(ref)) return false;
  if (ref.startsWith('/') || ref.startsWith('~') || ref.startsWith('.')) return false;
  if (ref.includes('\\') || ref.includes('/')) return false;
  if (ref.split(/[\\/]/).includes('..')) return false;
  if (/\.(?:json|png|jpe?g|webp|html?|txt|md)$/i.test(ref)) return false;
  return true;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
