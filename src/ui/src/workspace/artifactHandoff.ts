import {
  makeId,
  type RuntimeArtifact,
  type SciForgeMessage,
  type SciForgeSession,
  type SciForgeWorkspaceState,
  type ScenarioInstanceId,
  type TimelineEventRecord,
} from '../domain';
import { createSession, versionSession } from '../sessionStore';

const HANDOFF_ARTIFACT_LIMIT = 24;
const HANDOFF_NOTEBOOK_LIMIT = 24;
const HANDOFF_TIMELINE_LIMIT = 200;

export interface ArtifactHandoffLabels {
  sourceScenarioName: string;
  targetScenarioName: string;
}

export interface ArtifactHandoffOptions {
  now: string;
  notebookTime: string;
  messageId?: string;
  noteId?: string;
  timelineId?: string;
}

export function applyArtifactHandoffToWorkspace(
  state: SciForgeWorkspaceState,
  targetScenario: ScenarioInstanceId,
  artifact: RuntimeArtifact,
  labels: ArtifactHandoffLabels,
  options: ArtifactHandoffOptions,
): SciForgeWorkspaceState {
  const targetSession = state.sessionsByScenario[targetScenario] ?? createSession(targetScenario, `${labels.targetScenarioName} 新聊天`);
  const nextTargetSession = buildArtifactHandoffSession(targetSession, targetScenario, artifact, labels, options);
  return {
    ...state,
    timelineEvents: [
      buildArtifactHandoffTimelineEvent(targetScenario, artifact, options),
      ...(state.timelineEvents ?? []),
    ].slice(0, HANDOFF_TIMELINE_LIMIT),
    sessionsByScenario: {
      ...state.sessionsByScenario,
      [targetScenario]: nextTargetSession,
    },
    updatedAt: options.now,
  };
}

export function buildArtifactHandoffMessage(
  artifact: RuntimeArtifact,
  labels: ArtifactHandoffLabels,
  options: ArtifactHandoffOptions,
): SciForgeMessage {
  return {
    id: options.messageId ?? makeId('handoff'),
    role: 'user',
    content: [
      `请基于来自${labels.sourceScenarioName}的 artifact 继续分析。`,
      `artifact id: ${artifact.id}`,
      `artifact type: ${artifact.type}`,
      `目标：按${labels.targetScenarioName}的 input contract 生成下一步 claims、ExecutionUnit 和 UIManifest。`,
    ].join('\n'),
    createdAt: options.now,
    status: 'completed',
  };
}

function buildArtifactHandoffSession(
  targetSession: SciForgeSession,
  targetScenario: ScenarioInstanceId,
  artifact: RuntimeArtifact,
  labels: ArtifactHandoffLabels,
  options: ArtifactHandoffOptions,
): SciForgeSession {
  const artifacts = targetSession.artifacts.some((item) => item.id === artifact.id)
    ? targetSession.artifacts
    : [artifact, ...targetSession.artifacts].slice(0, HANDOFF_ARTIFACT_LIMIT);
  return versionSession({
    ...targetSession,
    messages: [...targetSession.messages, buildArtifactHandoffMessage(artifact, labels, options)],
    artifacts,
    notebook: [{
      id: options.noteId ?? makeId('note'),
      time: options.notebookTime,
      scenario: targetScenario,
      title: `接收 ${artifact.type}`,
      desc: `来自 ${labels.sourceScenarioName} 的 ${artifact.id} 已进入当前 Scenario 上下文。`,
      claimType: 'fact' as const,
      confidence: 1,
      artifactRefs: [artifact.id],
      updateReason: 'artifact handoff',
    }, ...targetSession.notebook].slice(0, HANDOFF_NOTEBOOK_LIMIT),
    updatedAt: options.now,
  }, `handoff artifact ${artifact.id}`);
}

function buildArtifactHandoffTimelineEvent(
  targetScenario: ScenarioInstanceId,
  artifact: RuntimeArtifact,
  options: ArtifactHandoffOptions,
): TimelineEventRecord {
  return {
    id: options.timelineId ?? makeId('timeline'),
    actor: 'SciForge Handoff',
    action: 'artifact.handoff',
    subject: `${artifact.producerScenario}:${artifact.id} -> ${targetScenario}`,
    artifactRefs: [artifact.id],
    executionUnitRefs: [],
    beliefRefs: [],
    branchId: targetScenario,
    visibility: 'project-record',
    decisionStatus: 'not-a-decision',
    createdAt: options.now,
  };
}
