import type { ScenarioInstanceId, ScenarioPackageRef } from './app';
import type { RuntimeArtifact } from './artifacts';
import type { RuntimeExecutionUnit } from './execution';
import type { GuidanceQueueRecord, RunStatus, SciForgeMessage, TurnAcceptance, UserGoalSnapshot } from './messages';
import type { ObjectReference, SciForgeReference } from './references';
import type { UIManifestSlot } from './view';

export interface EvidenceClaim {
  id: string;
  text: string;
  type: 'fact' | 'inference' | 'hypothesis';
  confidence: number;
  evidenceLevel: 'meta' | 'rct' | 'cohort' | 'case' | 'experimental' | 'review' | 'database' | 'preprint' | 'prediction';
  supportingRefs: string[];
  opposingRefs: string[];
  dependencyRefs?: string[];
  updateReason?: string;
  updatedAt: string;
}

export interface NotebookRecord {
  id: string;
  time: string;
  scenario: ScenarioInstanceId;
  title: string;
  desc: string;
  claimType: 'fact' | 'inference' | 'hypothesis';
  confidence: number;
  artifactRefs?: string[];
  executionUnitRefs?: string[];
  beliefRefs?: string[];
  dependencyRefs?: string[];
  updateReason?: string;
}

export interface SciForgeRun {
  id: string;
  scenarioId: ScenarioInstanceId;
  scenarioPackageRef?: ScenarioPackageRef;
  skillPlanRef?: string;
  uiPlanRef?: string;
  status: RunStatus;
  prompt: string;
  response: string;
  createdAt: string;
  completedAt?: string;
  raw?: unknown;
  references?: SciForgeReference[];
  objectReferences?: ObjectReference[];
  goalSnapshot?: UserGoalSnapshot;
  acceptance?: TurnAcceptance;
  guidanceQueue?: GuidanceQueueRecord[];
}

export interface SessionVersionRecord {
  id: string;
  reason: string;
  createdAt: string;
  messageCount: number;
  runCount: number;
  artifactCount: number;
  checksum: string;
  snapshot: Omit<SciForgeSession, 'versions'>;
}

export interface RuntimeCompatibilityFingerprint {
  schemaVersion: 1;
  appStateSchemaVersion: number;
  sessionSchemaVersion: number;
  compatibilityVersion: string;
  capabilityFingerprints: string[];
}

export interface RuntimeCompatibilityDiagnostic {
  schemaVersion: 1;
  id: string;
  kind: 'missing-runtime-fingerprint' | 'schema-version-drift' | 'capability-version-drift';
  severity: 'info' | 'warning';
  reason: string;
  current: RuntimeCompatibilityFingerprint;
  persisted?: RuntimeCompatibilityFingerprint;
  affectedSessionId: string;
  affectedScenarioId: ScenarioInstanceId;
  recoverable: true;
  recoverableActions: string[];
  createdAt: string;
}

export interface SciForgeSession {
  schemaVersion: 2;
  sessionId: string;
  scenarioId: ScenarioInstanceId;
  title: string;
  createdAt: string;
  messages: SciForgeMessage[];
  runs: SciForgeRun[];
  uiManifest: UIManifestSlot[];
  claims: EvidenceClaim[];
  executionUnits: RuntimeExecutionUnit[];
  artifacts: RuntimeArtifact[];
  notebook: NotebookRecord[];
  versions: SessionVersionRecord[];
  runtimeFingerprint?: RuntimeCompatibilityFingerprint;
  runtimeCompatibilityDiagnostics?: RuntimeCompatibilityDiagnostic[];
  /** Resolved view-plan item ids hidden in the results pane only; artifacts/workspace files are untouched. */
  hiddenResultSlotIds?: string[];
  updatedAt: string;
}
