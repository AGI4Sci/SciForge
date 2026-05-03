import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { SciForgeSkillDomain, GatewayRequest, SkillAvailability } from '../runtime-types.js';
import { clipForAgentServerJson, clipForAgentServerPrompt, hashJson, isRecord, toRecordList, toStringList } from '../gateway-utils.js';
import { expectedArtifactTypesForRequest, selectedComponentIdsForRequest } from './gateway-request.js';

export type AgentServerContextMode = 'full' | 'delta';

export function buildContextEnvelope(
  request: GatewayRequest,
  params: {
    workspace: string;
    workspaceTreeSummary?: Array<{ path: string; kind: 'file' | 'folder'; sizeBytes?: number }>;
    priorAttempts?: unknown[];
    selectedSkill?: SkillAvailability;
    repairRefs?: Record<string, unknown>;
    mode?: AgentServerContextMode;
    agentId?: string;
    agentServerCoreSnapshotAvailable?: boolean;
  },
) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const recentExecutionRefs = toRecordList(uiState.recentExecutionRefs);
  const recentConversation = toStringList(uiState.recentConversation);
  const conversationLedger = toRecordList(uiState.conversationLedger);
  const contextReusePolicy = isRecord(uiState.contextReusePolicy) ? uiState.contextReusePolicy : undefined;
  const mode = params.mode ?? contextEnvelopeMode(request);
  const workspaceTree = params.workspaceTreeSummary ?? [];
  const visibleRecentConversation = recentConversation
    .slice(mode === 'full' ? -6 : -4)
    .map((entry) => clipForAgentServerPrompt(entry, mode === 'full' ? 900 : 700))
    .filter(Boolean);
  return {
    version: 'sciforge.context-envelope.v1',
    mode,
    createdAt: new Date().toISOString(),
    hashes: {
      workspaceTree: hashJson(workspaceTree),
      artifacts: hashJson(request.artifacts),
      recentExecutionRefs: hashJson(recentExecutionRefs),
      priorAttempts: hashJson(params.priorAttempts ?? []),
    },
    projectFacts: mode === 'full' ? {
      project: 'SciForge',
      runtimeRole: 'scenario-first AI4Science workspace runtime',
      taskCodePolicy: 'Generate or repair task code in the active workspace, but compose installed/workspace tools when they are a better fit than hand-written code.',
      toolPayloadContract: ['message', 'confidence', 'claimType', 'evidenceLevel', 'reasoningTrace', 'claims', 'displayIntent', 'uiManifest', 'executionUnits', 'artifacts', 'objectReferences'],
    } : {
      project: 'SciForge',
      taskCodePolicyRef: 'sciforge.generated-task.v1',
      toolPayloadContractRef: 'sciforge.toolPayload.v1',
    },
    orchestrationBoundary: {
      decisionOwner: 'AgentServer',
      sciForgeRole: 'protocol validation, workspace execution, artifact/ref persistence, repair request dispatch, and UI display only',
      currentUserRequestIsAuthoritative: true,
      agentId: params.agentId,
      agentServerCoreSnapshotAvailable: params.agentServerCoreSnapshotAvailable === true,
      contextModeReason: mode === 'delta'
        ? 'SciForge sent compact delta refs plus hashes for a multi-turn backend session.'
        : 'SciForge sent a full handoff because AgentServer Core context was unavailable or the turn had no reusable session refs.',
    },
    workspaceFacts: mode === 'full' ? {
      workspacePath: params.workspace,
      sciforgeDir: '.sciforge',
      taskDir: '.sciforge/tasks/',
      taskResultDir: '.sciforge/task-results/',
      logDir: '.sciforge/logs/',
      artifactDir: '.sciforge/artifacts/',
      workspaceTreeSummary: workspaceTree,
      workspaceTreeHash: hashJson(workspaceTree),
      workspaceTreeEntryCount: workspaceTree.length,
    } : {
      workspacePath: params.workspace,
      dirs: {
        task: '.sciforge/tasks/',
        result: '.sciforge/task-results/',
        log: '.sciforge/logs/',
        artifact: '.sciforge/artifacts/',
      },
      workspaceTreeHash: hashJson(workspaceTree),
      workspaceTreeEntryCount: workspaceTree.length,
    },
    scenarioFacts: {
      skillDomain: request.skillDomain,
      scenarioPackageRef: request.scenarioPackageRef,
      skillPlanRef: request.skillPlanRef,
      uiPlanRef: request.uiPlanRef,
      expectedArtifactTypes: expectedArtifactTypesForRequest(request),
      selectedComponentIds: selectedComponentIdsForRequest(request),
      selectedToolIds: request.selectedToolIds ?? toStringList(request.uiState?.selectedToolIds),
      selectedSkill: params.selectedSkill ? {
        id: params.selectedSkill.id,
        kind: params.selectedSkill.kind,
        entrypointType: params.selectedSkill.manifest.entrypoint.type,
        manifestPath: params.selectedSkill.manifestPath,
      } : undefined,
    },
    sessionFacts: {
      sessionId: typeof uiState.sessionId === 'string' ? uiState.sessionId : undefined,
      currentPrompt: typeof uiState.currentPrompt === 'string' ? uiState.currentPrompt : request.prompt,
      currentUserRequest: currentUserRequestText(request.prompt),
      recentConversation: visibleRecentConversation,
      conversationLedger: summarizeConversationLedger(conversationLedger, mode),
      contextReusePolicy: contextReusePolicy ? clipForAgentServerJson(contextReusePolicy, 3) : undefined,
      recentRuns: Array.isArray(uiState.recentRuns)
        ? (mode === 'full' ? uiState.recentRuns : uiState.recentRuns.slice(-4).map((entry) => clipForAgentServerJson(entry, 2)))
        : undefined,
    },
    longTermRefs: {
      artifacts: summarizeArtifactRefs(request.artifacts),
      recentExecutionRefs: summarizeExecutionRefs(recentExecutionRefs),
      priorAttempts: summarizeTaskAttemptsForAgentServer(params.priorAttempts ?? []).slice(0, mode === 'full' ? 4 : 2),
      repairRefs: params.repairRefs,
    },
    continuityRules: mode === 'full' ? [
      'Use workspace refs as the source of truth for files, logs, generated code, and artifacts.',
      'Use conversationLedger to recover long-running session continuity; use recentConversation only to infer current intent.',
      'For continuation or repair requests, continue from priorAttempts/artifacts instead of restarting an unrelated task.',
      'If a requested local ref does not exist, say so explicitly and point to the nearest available output/log/artifact ref.',
    ] : [
      'Workspace refs are source of truth.',
      'Continue from AgentServer session memory, conversationLedger, recentExecutionRefs, and artifacts; answer missing refs honestly.',
    ],
  };
}

export async function workspaceTreeSummary(workspace: string) {
  const root = resolve(workspace);
  const out: Array<{ path: string; kind: 'file' | 'folder'; sizeBytes?: number }> = [];
  async function walk(dir: string, prefix = '') {
    if (out.length >= 80) return;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= 80) return;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (shouldSkipWorkspaceTreeEntry(rel, entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push({ path: rel, kind: 'folder' });
        if (shouldDescendWorkspaceTreeEntry(rel)) await walk(path, rel);
      } else if (entry.isFile()) {
        let sizeBytes = 0;
        try {
          sizeBytes = (await stat(path)).size;
        } catch {
          // Size is optional.
        }
        out.push({ path: rel, kind: 'file', sizeBytes });
      }
    }
  }
  await walk(root);
  return out;
}

function shouldSkipWorkspaceTreeEntry(rel: string, name: string) {
  if (name === 'node_modules' || name === '.git') return true;
  if (rel === '.bioagent' || rel.startsWith('.bioagent/')) return true;
  if (rel.startsWith('.sciforge/') && rel.split('/').length > 2) return true;
  if (/^\.sciforge\/(?:artifacts|task-results|logs|sessions|versions)\//.test(rel)) return true;
  return false;
}

function shouldDescendWorkspaceTreeEntry(rel: string) {
  if (rel.startsWith('.sciforge/')) return false;
  if (/^\.sciforge\/(?:artifacts|task-results|logs|sessions|versions)$/.test(rel)) return false;
  return rel.split('/').length < 3;
}

export function expectedArtifactSchema(request: GatewayRequest | SciForgeSkillDomain): Record<string, unknown> {
  const skillDomain = typeof request === 'string' ? request : request.skillDomain;
  const types = typeof request === 'string' ? [] : expectedArtifactTypesForRequest(request);
  if (types.length) return { types };
  if (typeof request !== 'string') {
    return {
      types: [],
      mode: 'backend-decides',
      note: 'No current-turn artifact type was explicitly required; infer the minimal output from rawUserPrompt and explicit references.',
    };
  }
  if (skillDomain === 'literature') return { type: 'paper-list' };
  if (skillDomain === 'structure') return { type: 'structure-summary' };
  if (skillDomain === 'omics') return { type: 'omics-differential-expression' };
  return { type: 'knowledge-graph' };
}

function contextEnvelopeMode(request: GatewayRequest): AgentServerContextMode {
  const recentConversation = toStringList(request.uiState?.recentConversation);
  const recentExecutionRefs = toRecordList(request.uiState?.recentExecutionRefs);
  return recentConversation.length > 1 || recentExecutionRefs.length > 0 || request.artifacts.length > 0 ? 'delta' : 'full';
}

function currentUserRequestText(prompt: string) {
  const lines = prompt.split('\n').map((line) => line.trim()).filter(Boolean);
  const userLine = [...lines].reverse().find((line) => /^user\s*:/i.test(line));
  return userLine ? userLine.replace(/^user\s*:\s*/i, '') : prompt;
}

function summarizeArtifactRefs(artifacts: Array<Record<string, unknown>>) {
  return artifacts.slice(-8).map((artifact) => ({
    id: artifact.id,
    type: artifact.type,
    dataRef: artifact.dataRef,
    metadata: isRecord(artifact.metadata) ? clipForAgentServerJson(artifact.metadata, 2) : undefined,
    dataSummary: isRecord(artifact.data) ? clipForAgentServerJson(artifact.data, 2) : undefined,
  }));
}

function summarizeExecutionRefs(refs: Array<Record<string, unknown>>) {
  return refs.slice(-8).map((ref) => clipForAgentServerJson(ref, 2));
}

function summarizeConversationLedger(ledger: Array<Record<string, unknown>>, mode: AgentServerContextMode) {
  if (!ledger.length) return undefined;
  const budget = mode === 'full' ? 24 : 18;
  const tail = ledger.slice(-budget).map((entry) => clipForAgentServerJson(entry, 3));
  const omitted = Math.max(0, ledger.length - tail.length);
  return {
    totalTurns: ledger.length,
    omittedPrefixTurns: omitted,
    ordering: 'append-only-session-order',
    tail,
  };
}

function summarizeTaskAttemptsForAgentServer(attempts: unknown[]) {
  return attempts.filter(isRecord).map((attempt) => clipForAgentServerJson(attempt, 2));
}
