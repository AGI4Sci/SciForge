---
name: sciforge-computer-use
description: Legacy diagnostic only. Use the retired repo-local SciForge Computer Use MCP tools only for package-local refs-first debugging, not for product/default Computer Use acceptance.
---

# SciForge Computer Use

Use this skill only for legacy diagnostics through the repo-local `sciforge-computer-use` MCP server declared in the repository `.mcp.json`. The product Computer Use path is TypeScript-only: Agent Host -> WindowActionSession -> TypeScript host-port contract -> current evidence bundle.

## Boundary

- Treat Codex app-server or Codex CLI as the L2 host. The package is an L1/L0 Computer Use adapter, not a task brain.
- Public tools are limited to `get_app_state`, `observe`, `click`, `type_text`, `scroll`, `press_key`, `propose_action`, `execute_scoped_action`, and `get_replay_refs`.
- Do not pass provider routes, GUI private state, scheduler internals, executor adapter refs, lease ids, lease scopes, or bare global coordinates as tool arguments.
- Mutating facade tools require current app-state, screenshot, accessibility snapshot, before-evidence, and grounding refs in the same screen/window scope.
- High-risk actions must stop at `needs-confirmation` and return approval refs. Confirmation and user-level completion stay with the L2 host.
- Package-local diagnostic calls may return `blocked` after writing proposal, lease, executor-event, and evidence refs. That is expected; this retired Python MCP path must not be promoted to product/default acceptance.

## Tools

- `get_app_state` / `observe`: read-only app state and visible screen refs.
- `click`: scoped click facade projected to proposal, lease, executor event, and evidence refs.
- `type_text`: scoped text facade projected to proposal, lease, executor event, and evidence refs.
- `scroll`: scoped scroll facade projected to proposal, lease, executor event, and evidence refs.
- `press_key`: scoped key facade projected to proposal, lease, executor event, and evidence refs.
- `propose_action`: proposal-only primitive for generic actions and risk classification.
- `execute_scoped_action`: execute an already proposed scoped action through refs-first evidence.
- `get_replay_refs`: read replay bundle refs for the display group.

## Legacy Diagnostic Commands

```bash
python -m sciforge_computer_use.plugin_probe --output-dir /tmp/sciforge-computer-use-plugin-probe --run-fixture
python -m sciforge_computer_use.native_tool --tool get_app_state --payload-json '{"displayGroupId":"dg-main","screenId":"screen-a"}' --output-dir /tmp/sciforge-computer-use-native-tool
```
