/**
 * Turn-control capability matrix per runtime.
 *
 * Design: “可选档位 = 模型声明的档位 ∩ 当前 runtime 能传递的档位”, “关闭必须有
 * 明确支持”, “上游默认全链路不发送思考字段”. This file is the single source of
 * truth for the *runtime* half of that intersection; the model half comes from
 * reasoning-level discovery. The matrix is intentionally data (not logic) so it
 * can be asserted against the real interfaces in tests.
 *
 * Evidence per runtime (observed in this repo, 2026-10):
 *  - codex: turn/start params carry model + reasoning_effort + service tier
 *    (`codex-service.ts` resolveCodexModelSelection / turn params). Real-wire
 *    probe (ChatGPT.app-bundled codex-cli 0.163.0-alpha.10.2 against a loopback
 *    mock, `codex-contract-probe.mjs`): no effort configured → `reasoning.effort`
 *    absent (upstream default preserved); `model_reasoning_effort=high` →
 *    `reasoning.effort:"high"` verbatim; `off` → `reasoning.effort:"off"`
 *    verbatim, so off is transmittable.
 *  - claude: the Claude Agent SDK launch maps the neutral ladder per turn to
 *    `thinking` / `effort` (`claude-code-config.ts` claudeCodeReasoningOptions);
 *    `off` maps to `thinking: {type: 'disabled'}`, so off is expressible. Model
 *    is fixed per session (the binding alias), so model selection is `session`.
 *  - dsh: model fixed at thread start, no reasoning channel
 *    (`dsh-agent-runtime-adapter.ts` default capabilities; session-locked by design).
 *  - pi: same shape (`pi-agent-runtime-adapter.ts` startThread(model), no reasoning
 *    channel; honestly reports `runtime_unsupported` for unimplemented controls).
 *
 * The HTML redesign doc’s per-model alias examples (Kimi K3 merging, DeepSeek
 * xhigh→max) are NOT generalized here: mapping stays protocol-based only, and no
 * model name ever selects a mapping rule.
 */
import type { AgentRuntimeId } from './app-settings-types'

export type AgentRuntimeTurnControlSupport = 'turn' | 'session' | 'unsupported'

export type AgentRuntimeTurnControls = Readonly<{
  /** Model selection granularity. */
  model: 'turn' | 'session'
  /** Whether an explicit reasoning level can be transferred per turn. */
  reasoningLevel: AgentRuntimeTurnControlSupport
  /** Whether an explicit “off / disabled” state can be transmitted. */
  reasoningOff: boolean
  /** Service-tier transfer. */
  serviceTier: AgentRuntimeTurnControlSupport
}>

export const AGENT_RUNTIME_TURN_CONTROLS: Readonly<Record<AgentRuntimeId, AgentRuntimeTurnControls>> = Object.freeze({
  codex: Object.freeze({ model: 'turn', reasoningLevel: 'turn', reasoningOff: true, serviceTier: 'turn' }),
  claude: Object.freeze({ model: 'session', reasoningLevel: 'turn', reasoningOff: true, serviceTier: 'unsupported' }),
  dsh: Object.freeze({ model: 'session', reasoningLevel: 'unsupported', reasoningOff: false, serviceTier: 'unsupported' }),
  pi: Object.freeze({ model: 'session', reasoningLevel: 'unsupported', reasoningOff: false, serviceTier: 'unsupported' })
})

export function agentRuntimeTurnControls(runtimeId: AgentRuntimeId): AgentRuntimeTurnControls {
  return AGENT_RUNTIME_TURN_CONTROLS[runtimeId]
}