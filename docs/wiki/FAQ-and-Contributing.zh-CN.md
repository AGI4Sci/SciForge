# FAQ 与贡献

## FAQ

### SciForge 是不是另一个大模型？

不是。SciForge 是 GUI、运行时治理和科研 artifact / 证据层；模型通过 Model Router 接入，Agent 执行由 Codex 或 Claude Code 完成。

### 为什么不让 Agent 自动做完？

科研任务的目标、风险和“足够好的证据”通常需要人的判断。SciForge 把审批、追问、暂停、diff、批注和证据审阅做成一等界面；模型越强，干预点可以越少，但不需要消失。

### Codex / Claude Code 与 SciForge 是竞争关系吗？

不是。SciForge 复用成熟 runtime 的执行能力，补上科学工作区、数据搜集、证据链和研究交接；runtime 的原生会话、认证和工具边界仍由各自项目负责。

### 我可以直接把远程 provider URL 填进 GUI 吗？

Model Router 的 GUI Base URL 默认要求本机 loopback。把远程 provider 配在 Router 的成员 profile 中，或使用受控的本地 sidecar / 转发，不要让 renderer 直接绕过 Router。

### 卸载会删除研究数据吗？

不会默认删除。workspace、`.sciforge/`、设置、runtime data 和 traces 需要分别管理；彻底清理前先备份和检查敏感信息。

### 如何判断 Agent 的结论可不可信？

回到来源和过程：查看 tool result、raw translator output、trace、Evidence DAG 的 supports / contradicts 边，以及人工 review packet。没有来源或只有单一路径的主张应降低结论强度。

## 文档与代码入口

- [README](../../README.md)：项目价值、能力总览和 showcase 入口。
- [`docs/agent-runtime-contract.md`](../agent-runtime-contract.md)：runtime-neutral contract。
- [`docs/CONTRIBUTING.zh-CN.md`](../CONTRIBUTING.zh-CN.md)：贡献规范。
- [`docs/DEVELOPMENT.zh-CN.md`](../DEVELOPMENT.zh-CN.md)：分支、PR 和验证流程。

## 提交贡献

推荐流程：

1. 从唯一长期分支 `gui` 创建短期分支，保持一个 PR 一个主题，并将 PR 提回 `gui`。
2. 文档、UI、runtime 和 worker 的改动尽量保持边界清晰；不要提交密钥、私有路径或大体积产物。
3. 行为改变补测试，使用方式改变同步 Wiki / README / DEVELOPMENT 文档。
4. PR 描述写清 Summary、Why、Validation、Tests 和必要的截图或 GIF。

提交前至少运行：

```bash
npm run typecheck
npm run build
npm run test
```

Wiki 本身是仓库内的版本化文档。新增页面后，请从 [`Home.md`](./Home.md) 加入口，并在页面底部补充相关源码或规范链接。
