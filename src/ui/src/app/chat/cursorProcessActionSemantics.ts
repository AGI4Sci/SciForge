import type { CursorAgentActionKind } from './cursorAgentProcess';

export function semanticCursorActionKind(input: {
  type: string;
  toolName?: string;
  operationKind?: string;
  status?: string;
  text: string;
  hasApprovalChoices?: boolean;
}): CursorAgentActionKind | undefined {
  const type = normalize(input.type);
  const toolName = normalize(input.toolName);
  const operationKind = normalize(input.operationKind);
  const status = normalize(input.status);
  const text = normalize(input.text);
  const semantic = `${type}\n${toolName}\n${operationKind}\n${status}`;
  if (input.hasApprovalChoices || /\b(?:approval_requested|human_approval_required|gui_ask_user|control_request|requires_user_confirmation|waiting_for_approval)\b/.test(semantic)) {
    return 'approval';
  }
  if (/\b(?:repair_needed|repair_required|acceptance_repair|feedback_repair|repair_handoff|self_heal|recovery_required)\b/.test(semantic)
    || /\b(?:repair_needed|repair_required|needs_repair|repairable)\b/.test(text)) {
    return 'repair';
  }
  if (/\b(?:needs_human_verification|human_verification|verifier_blocked|verification_blocked|verification_failed|acceptance_verifier|runtime_acceptance|turn_acceptance)\b/.test(semantic)
    || /\b(?:verifier_blocked|verification_blocked|needs_human_verification|human_verification_required)\b/.test(text)) {
    return 'verifier';
  }
  if (/\b(?:composer_declared_intent_ack|composer_declared_intent_projection|declared_intent_ack|ui_declared_intent_ack|model_intent_ack|capability_preference_ack|preference_acknowledged)\b/.test(semantic)
    || /\b(?:composer|model|mode|capability)\b.*\b(?:declared intent|preference)\b.*\b(?:acknowledged|accepted|shared)\b/.test(text)) {
    return 'message';
  }
  if (/\bneeds_human\b/.test(status)) return 'approval';
  return undefined;
}

function normalize(value: string | undefined) {
  return (value ?? '').trim().toLowerCase().replace(/[-\s]+/g, '_');
}
