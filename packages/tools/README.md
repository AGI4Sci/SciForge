# @bioagent-tool/packages

## Agent quick contract
- A tool is an execution resource a skill may call: database, runner, connector, MCP server, LLM backend, or visual runtime.
- Runtime discovery recursively reads every `packages/tools/**/SKILL.md`; nested directory depth is irrelevant.
- Read only the selected tool's `SKILL.md` before configuring or invoking it.
- Tool `source` is `package`; provider-specific origins such as ClawHub, SCP, or local are metadata/tags, not separate source classes.
- Tools do not decide user intent. Skills decide whether a tool is appropriate and pass the smallest required execution contract.

## Human notes
The boundary is: skill 是 agent 可选择的工作策略，tool 是 skill 可调用的执行资源。

This package root is Markdown-first. Add a tool by placing a `SKILL.md` anywhere under `packages/tools`; the generated catalog mirrors those files for UI display and validation. A tool package should document install/config/invocation details, but strategy, user-intent interpretation, and artifact policy belong in skills.
