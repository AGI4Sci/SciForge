# Native Extension Ownership Map

Last updated: 2026-05-19

This document mirrors [`native-extension-ownership-map.json`](native-extension-ownership-map.json). The JSON file is the gateable manifest; this page is the readable summary.

Run `npm run smoke:native-extension-ownership` to validate the manifest, command verbs, and readable policy shape.

| Area | Owner | Target | GUI/runtime boundary |
|---|---|---|---|
| Capability discovery | Codex-native plugin / skill / tool / MCP | `/capabilities search`, `expand`, `plan`, `explain`; `gui.present` / `gui.ask_user` for display | GUI only emits text commands. GUI and runtime do not rank capabilities. |
| Harness / policy / budget / repair | Codex TUI native extension | Codex policy plugin, skill, or MCP surface | GUI may show or ask; it does not choose strategy. |
| Provider route | Codex provider / MCP / tool ecosystem | Custom model provider, local provider proxy, MCP server, Codex tool | Runtime audits profile/provider/model/workspace/command id and fails closed; no silent OpenAI fallback. |
| Verifier | Codex-native verifier tool / skill | Tool, skill, MCP verifier | Verifier output is evidence or critique. GUI does not infer completion from raw logs. |
| Skill promotion | Codex skill / plugin / MCP / slash command | Native Codex extension artifact | Workspace proposals are staging only, not the final promotion target. |
| Computer Use | Sense plugin plus upstream desktop bridge | `packages/observe/vision`, `packages/actions/computer-use`, desktop bridge | React/UI does not execute Computer Use. Raw screenshot/log payloads stay in folded audit/debug refs. |
| Dual-instance self-repair | Retired unless Codex-native | Codex-native repair workflow, skill/plugin, or external supervisor | Two SciForge app instances are not the default repair runtime. |

Boundary rule: if a feature changes task capability, chooses a provider, repairs execution, verifies truth, or promotes a skill, it belongs to the TUI/Codex native extension ecosystem. SciForge GUI only contributes presentation, confirmation, focus, folded audit/debug, and terminal-equivalent text.
