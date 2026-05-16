import type {
  ObjectReference,
  RuntimeArtifact,
  SciForgeSession,
} from '@sciforge-ui/runtime-contract';
import type {
  ConversationProjection,
  ConversationRef,
} from '../../../src/runtime/conversation-kernel/index.js';

export type WebE2eCaseId = string;

export type WebE2eSeedFileKind = 'csv' | 'pdf' | 'text' | 'markdown' | 'json' | 'log';

export interface WebE2eSeedFile {
  kind: WebE2eSeedFileKind;
  relPath: string;
  absolutePath: string;
  mediaType: string;
  digest: string;
  sizeBytes: number;
}

export interface WebE2eInitialRef {
  id: string;
  kind: 'user-turn' | 'message' | 'artifact' | 'file' | 'run' | 'provider-manifest';
  title: string;
  ref: string;
  source: 'current-turn' | 'explicit-selection' | 'seed-workspace' | 'provider-manifest' | 'run-audit';
  artifactType?: string;
  digest?: string;
}

export interface WebE2eProviderCapability {
  id: string;
  providerId: string;
  capabilityId: string;
  workerId: string;
  status: 'available' | 'unavailable' | 'degraded';
  fixtureMode: 'scripted-mock' | 'real-provider-optional';
}

export interface WebE2eProviderManifest {
  schemaVersion: 'sciforge.web-e2e.provider-manifest.v1';
  caseId: WebE2eCaseId;
  generatedAt: string;
  capabilities: WebE2eProviderCapability[];
  refs: ConversationRef[];
}

export interface WebE2eCurrentTaskProjection {
  currentTurnRef: WebE2eInitialRef;
  explicitRefs: WebE2eInitialRef[];
  selectedRefs: WebE2eInitialRef[];
}

export interface WebE2eArtifactDeliveryProjection {
  primaryArtifactRefs: string[];
  supportingArtifactRefs: string[];
  auditRefs: string[];
  diagnosticRefs: string[];
  internalRefs: string[];
}

export interface WebE2eExpectedProjection {
  schemaVersion: 'sciforge.web-e2e.expected-projection.v1';
  projectionVersion: 'sciforge.conversation-projection.v1';
  caseId: WebE2eCaseId;
  sessionId: string;
  scenarioId: string;
  runId: string;
  currentTask: WebE2eCurrentTaskProjection;
  conversationProjection: ConversationProjection;
  artifactDelivery: WebE2eArtifactDeliveryProjection;
  runAuditRefs: string[];
  providerManifestRef: string;
}

export interface WebE2eWorkspaceState {
  schemaVersion: 2;
  workspacePath: string;
  sessionsByScenario: Record<string, SciForgeSession>;
  archivedSessions: SciForgeSession[];
  alignmentContracts: unknown[];
  timelineEvents?: unknown[];
  updatedAt: string;
}

export interface WebE2eFixtureWorkspace {
  caseId: WebE2eCaseId;
  workspacePath: string;
  sciforgeDir: string;
  workspaceStatePath: string;
  configLocalPath: string;
  providerManifestPath: string;
  expectedProjectionPath: string;
  sessionId: string;
  scenarioId: string;
  runId: string;
  seedFiles: WebE2eSeedFile[];
  seedArtifacts: RuntimeArtifact[];
  initialRefs: WebE2eInitialRef[];
  objectReferences: ObjectReference[];
  providerManifest: WebE2eProviderManifest;
  expectedProjection: WebE2eExpectedProjection;
  workspaceState: WebE2eWorkspaceState;
}

export interface BuildWebE2eFixtureWorkspaceOptions {
  caseId: WebE2eCaseId;
  baseDir?: string;
  workspacePath?: string;
  scenarioId?: string;
  sessionId?: string;
  runId?: string;
  title?: string;
  prompt?: string;
  now?: string;
  workspaceWriterBaseUrl?: string;
  agentServerBaseUrl?: string;
  providerCapabilities?: WebE2eProviderCapability[];
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

export interface ScriptableAgentServerProvider {
  id: string;
  providerId?: string;
  capabilityId: string;
  workerId?: string;
  status?: 'available' | 'unavailable' | 'degraded';
  metadata?: JsonRecord;
}

export type ScriptableAgentServerContextWindowState = JsonRecord & {
  source?: string;
  backend?: string;
  provider?: string;
  model?: string;
  status?: 'healthy' | 'watch' | 'near-limit' | 'exceeded' | 'compacting' | 'blocked' | 'unknown';
  contextWindowTokens?: number;
  contextWindowLimit?: number;
  contextWindowRatio?: number;
  autoCompactThreshold?: number;
  compactCapability?: string;
  lastCompactedAt?: string;
  digest?: string;
};

export interface ScriptableAgentServerContext {
  agentId?: string;
  sessionId?: string;
  status?: string;
  recentTurns?: JsonRecord[];
  currentWorkEntries?: JsonRecord[];
  operationalGuidance?: JsonRecord;
  workBudget?: JsonRecord;
  state?: ScriptableAgentServerContextWindowState;
  rawPayload?: JsonRecord;
}

export interface ScriptableAgentServerCompact {
  status?: 'completed' | 'compacted' | 'skipped' | 'failed';
  reason?: string;
  before?: ScriptableAgentServerContextWindowState;
  after?: ScriptableAgentServerContextWindowState;
  rawPayload?: JsonRecord;
}

export interface ScriptableAgentServerToolPayload extends JsonRecord {
  message: string;
  confidence: number;
  claimType: string;
  evidenceLevel: string;
  claims: JsonValue[];
  uiManifest: JsonValue[];
  executionUnits: JsonValue[];
  artifacts: JsonValue[];
}

export type ScriptableAgentServerMockStep =
  | {
    kind: 'event';
    event: JsonRecord;
  }
  | {
    kind: 'status';
    message: string;
    status?: string;
    fields?: JsonRecord;
  }
  | {
    kind: 'textDelta';
    delta: string;
    fields?: JsonRecord;
  }
  | {
    kind: 'usage';
    usage: JsonRecord;
    message?: string;
  }
  | {
    kind: 'contextWindow';
    state?: ScriptableAgentServerContextWindowState;
  }
  | {
    kind: 'toolPayload';
    payload?: ScriptableAgentServerToolPayload;
    runStatus?: string;
  }
  | {
    kind: 'failure';
    message: string;
    code?: string;
    runStatus?: string;
    recoverActions?: string[];
    details?: JsonRecord;
  }
  | {
    kind: 'degraded';
    message?: string;
    reason?: string;
    payload?: ScriptableAgentServerToolPayload;
    recoverActions?: string[];
    runStatus?: string;
  }
  | {
    kind: 'backgroundCheckpoint';
    checkpointRefs: string[];
    message?: string;
    payload?: ScriptableAgentServerToolPayload;
    runStatus?: string;
    terminal?: boolean;
  };

export interface ScriptableAgentServerMockScript {
  id?: string;
  runId?: string;
  steps: ScriptableAgentServerMockStep[];
}

export interface ScriptableAgentServerRunExchange {
  requestIndex: number;
  path: string;
  method: string;
}

export type ScriptableAgentServerMockScriptFactory = (
  request: JsonRecord,
  exchange: ScriptableAgentServerRunExchange,
) => ScriptableAgentServerMockScript | ScriptableAgentServerMockStep[];

export interface ScriptableAgentServerMockOptions {
  seed?: string;
  fixedNow?: string;
  script?: ScriptableAgentServerMockScript | ScriptableAgentServerMockStep[] | ScriptableAgentServerMockScriptFactory;
  discovery?: {
    providers?: ScriptableAgentServerProvider[];
    workers?: JsonRecord[];
    rawPayload?: JsonRecord;
  };
  context?: ScriptableAgentServerContext;
  compact?: ScriptableAgentServerCompact;
  defaultToolPayload?: ScriptableAgentServerToolPayload;
}

export interface ScriptableAgentServerRecordedRequest {
  path: string;
  method: string;
  body: JsonRecord;
  digest: string;
}

export interface ScriptableAgentServerMockHandle {
  baseUrl: string;
  port: number;
  requests: {
    discovery: string[];
    context: ScriptableAgentServerRecordedRequest[];
    compact: ScriptableAgentServerRecordedRequest[];
    runs: ScriptableAgentServerRecordedRequest[];
  };
  setScript(script: ScriptableAgentServerMockOptions['script']): void;
  setDiscoveryProviders(providers: ScriptableAgentServerProvider[]): void;
  digest(value: unknown): string;
  close(): Promise<void>;
}

export type BrowserInstrumentationEventKind =
  | 'console'
  | 'pageerror'
  | 'requestfailed'
  | 'response';

export type BrowserInstrumentationEvidenceKind =
  | 'screenshot'
  | 'dom-snapshot'
  | 'download';

export type BrowserInstrumentationSeverity = 'warning' | 'error';

export type BrowserInstrumentationLocation = {
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
};

export type BrowserConsoleEvent = {
  kind: 'console';
  severity: BrowserInstrumentationSeverity;
  type: string;
  text: string;
  location?: BrowserInstrumentationLocation;
  timestamp: string;
  pageLabel?: string;
};

export type BrowserPageErrorEvent = {
  kind: 'pageerror';
  severity: 'error';
  message: string;
  name?: string;
  stack?: string;
  timestamp: string;
  pageLabel?: string;
};

export type BrowserRequestFailedEvent = {
  kind: 'requestfailed';
  severity: 'error';
  url: string;
  method: string;
  resourceType: string;
  errorText?: string;
  timestamp: string;
  pageLabel?: string;
};

export type BrowserResponseFailureEvent = {
  kind: 'response';
  severity: 'error';
  url: string;
  method: string;
  resourceType: string;
  status: number;
  statusText: string;
  timestamp: string;
  pageLabel?: string;
};

export type BrowserInstrumentationEvent =
  | BrowserConsoleEvent
  | BrowserPageErrorEvent
  | BrowserRequestFailedEvent
  | BrowserResponseFailureEvent;

export type BrowserScreenshotEvidence = {
  kind: 'screenshot';
  id: string;
  path: string;
  fullPage: boolean;
  timestamp: string;
  pageLabel?: string;
  viewport?: {
    width: number;
    height: number;
  } | null;
};

export type BrowserDomSnapshotEvidence = {
  kind: 'dom-snapshot';
  id: string;
  path?: string;
  url: string;
  title: string;
  byteLength: number;
  sha256: string;
  truncated: boolean;
  timestamp: string;
  pageLabel?: string;
};

export type BrowserDownloadEvidence = {
  kind: 'download';
  id: string;
  suggestedFilename: string;
  url: string;
  path?: string;
  failure?: string;
  byteLength?: number;
  sha256?: string;
  timestamp: string;
  pageLabel?: string;
};

export type BrowserInstrumentationEvidence =
  | BrowserScreenshotEvidence
  | BrowserDomSnapshotEvidence
  | BrowserDownloadEvidence;

export type BrowserInstrumentationCounts = {
  consoleWarnings: number;
  consoleErrors: number;
  pageErrors: number;
  requestFailures: number;
  responseFailures: number;
  screenshots: number;
  domSnapshots: number;
  downloads: number;
};

export type BrowserInstrumentationSnapshot = {
  schemaVersion: 1;
  label?: string;
  capturedAt: string;
  counts: BrowserInstrumentationCounts;
  hasFailures: boolean;
  events: BrowserInstrumentationEvent[];
  evidence: BrowserInstrumentationEvidence[];
};
