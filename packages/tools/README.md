# @sciforge-tool/packages

Tool 是 skill 可以调用的执行资源，例如数据库、runner、connector、MCP server、LLM backend 或视觉 runtime。Tool 不决定用户意图；skill 决定是否需要某个 tool，并传入最小执行 contract。

## Agent 使用契约

- Runtime discovery 会递归读取 `packages/tools/**/SKILL.md`；目录深度不重要。
- 配置或调用前，只读取被选中的 tool 的 `SKILL.md`。
- Tool `source` 统一视为 `package`；ClawHub、SCP、local 等来源只作为 metadata/tags。
- Tool 文档应说明安装、配置和调用细节；策略判断、用户意图解释和 artifact policy 应写在 skill 中。

## 新增 Tool

在 `packages/tools` 下任意目录放置 `SKILL.md`，catalog generator 会把它映射到 UI 展示和验证入口。
