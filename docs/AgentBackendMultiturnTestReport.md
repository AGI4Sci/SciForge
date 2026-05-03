# AgentBackend Multi-turn Test Report

Generated: 2026-05-03T05:18:09.976Z

## Test Task

Same three-round conversation for every AgentBackend:

1. Search today's latest arXiv agent-related papers, download/read full text, and produce `paper-list` plus `research-report`.
2. Continue from previous artifacts and refs, then enrich per-paper novelty, uniqueness, technical path, evidence matrix, and report.
3. Read existing context only, do not rerun/download, and summarize report completeness plus residual risks.

## Results

| Backend | Completed turns | Context reads | Preflight source | Completion | Input tokens | Output tokens | Total tokens |
| --- | ---: | ---: | --- | --- | ---: | ---: | ---: |
| codex | 3/3 | 3 | native | Pass | 25920 | 5010 | 30930 |
| openteam_agent | 3/3 | 3 | agentserver-estimate | Pass | 26460 | 5295 | 31755 |
| claude-code | 3/3 | 3 | agentserver-estimate | Pass | 27000 | 5580 | 32580 |
| hermes-agent | 3/3 | 3 | native | Pass | 27540 | 5865 | 33405 |
| openclaw | 3/3 | 3 | agentserver-estimate | Pass | 28080 | 6150 | 34230 |
| gemini | 3/3 | 3 | agentserver-estimate | Pass | 28620 | 6435 | 35055 |

## Findings

- All tested backends completed the same three-turn workflow through AgentServer generation/direct-context dispatch.
- Round 3 verified context reuse by reusing the prior `paper-list` artifact without rerunning the workspace task.
- Token usage is collected from AgentServer stream usage events; this smoke uses deterministic mock token accounting so regressions are reproducible in CI.
- OpenClaw is verified as a compatibility backend with handoff-only compact fallback unless native compact is explicitly exposed.
- Gemini is now included in frontend/backend normalization and appears as a selectable AgentBackend.
