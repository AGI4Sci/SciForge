import { clipForAgentServerJson, clipForAgentServerPrompt, isRecord, toRecordList, toStringList } from '../gateway-utils.js';
import type { AgentServerContextMode } from './context-envelope.js';
import { summarizeConversationLedger, summarizeConversationPolicyForAgentServer } from './context-envelope.js';

export function summarizeUiStateForAgentServer(uiState: unknown, mode: AgentServerContextMode) {
  if (!isRecord(uiState)) return undefined;
  const ledger = toRecordList(uiState.conversationLedger);
  const contextReusePolicy = isRecord(uiState.contextReusePolicy) ? uiState.contextReusePolicy : undefined;
  return {
    sessionId: typeof uiState.sessionId === 'string' ? uiState.sessionId : undefined,
    currentPrompt: clipForAgentServerPrompt(uiState.currentPrompt, mode === 'full' ? 1600 : 1200),
    rawUserPrompt: clipForAgentServerPrompt(uiState.rawUserPrompt, mode === 'full' ? 1600 : 1200),
    recentConversation: toStringList(uiState.recentConversation)
      .slice(mode === 'full' ? -6 : -4)
      .map((entry) => clipForAgentServerPrompt(entry, mode === 'full' ? 900 : 700))
      .filter(Boolean),
    currentReferences: Array.isArray(uiState.currentReferences)
      ? uiState.currentReferences.slice(0, 8).map((entry) => clipForAgentServerJson(entry, 2))
      : undefined,
    currentReferenceDigests: Array.isArray(uiState.currentReferenceDigests)
      ? uiState.currentReferenceDigests.slice(0, 8).map((entry) => clipForAgentServerJson(entry, 4))
      : undefined,
    scopeCheck: isRecord(uiState.scopeCheck) ? clipForAgentServerJson(uiState.scopeCheck, 3) : undefined,
    selectedComponentIds: toStringList(uiState.selectedComponentIds),
    selectedSkillIds: toStringList(uiState.selectedSkillIds),
    selectedToolIds: toStringList(uiState.selectedToolIds),
    selectedSenseIds: toStringList(uiState.selectedSenseIds),
    selectedActionIds: toStringList(uiState.selectedActionIds),
    selectedVerifierIds: toStringList(uiState.selectedVerifierIds),
    verificationPolicy: isRecord(uiState.verificationPolicy) ? clipForAgentServerJson(uiState.verificationPolicy, 2) : undefined,
    verificationResult: isRecord(uiState.verificationResult) ? clipForAgentServerJson(uiState.verificationResult, 2) : undefined,
    conversationPolicySummary: summarizeConversationPolicyForAgentServer(uiState.conversationPolicy ?? uiState),
    recentRuns: Array.isArray(uiState.recentRuns)
      ? uiState.recentRuns.slice(-4).map((entry) => clipForAgentServerJson(entry, 2))
      : undefined,
    conversationLedger: summarizeConversationLedger(ledger, mode),
    contextReusePolicy: contextReusePolicy ? clipForAgentServerJson(contextReusePolicy, 3) : undefined,
    contextMode: mode,
  };
}
