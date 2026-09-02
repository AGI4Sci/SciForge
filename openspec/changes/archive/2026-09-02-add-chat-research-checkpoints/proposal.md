## Why

SciForge 已有 Artifact Versions 底座，但普通研究对话仍可能只留下聊天文本和无法验证因果关系的文件变化。研究员需要一条默认、精确、可恢复且可以明确关闭的版本链，同时系统必须避免把 Terminal、编辑器或后台脚本的时间相关变化误报为可信产物。

## What Changes

- 新增 `@sciforge/domain-research-checkpoints`：Host 在 provider delivery 前持久化 installation `issuerEpoch`、单调 attempt ordinal 与随机 `deliveryAttemptId`，并建立 workspace-bound boundary lease；enabled lease 原子绑定 `recordingId` 与 exact binding snapshot，每个完成 turn 生成一个不可变 Research Checkpoint。
- Turn Artifact Outbox V4 持久拥有 pending-start/watch/completed-intent/terminal-settlement 全链路状态，以至少一次重试投递 settlement；双 ACK 后有界 receipt 只退休为同 epoch 的精确 ordinal ranges，不使用 Bloom 或时间 cutoff，一个 pending gap 不阻塞其他 thread。
- pending-start 不从文本或历史自动恢复；只有 provider accepted 的权威 handle 自动 bind。ambiguous start 保持 durable，由通用 governed list/resolve/release 显式处理并验证 runtime/thread/workspace scope，resolve 还要验证 exact provider turn/user-message item。
- 自动策略独立于 recording，默认 `enabled`，canonical status 带 `policyRevision`，Start/Stop 必须提交 `expectedPolicyRevision`。Research Dossier 始终提供控制，普通聊天不提供；首轮前 Stop 可返回 `recording: null`，disabled attempt 持久为 `skipped` 且 response-loss replay 仍 skip，Start re-enable 后下一 completed turn 才创建 checkpoint v1。
- 将 Host 认证的 Codex `apply_patch/fileChange` 输出与 checkpoint 放入同一个 Artifact Versions 原子事务；普通 Terminal、IDE、`exec_command` 和 ambient 写入继续标记为 `untracked/incomplete`。
- Host 为每个 domain runtime 注入 package-scoped invoker，并通过通用 capability grant 授权 caller-selected identity；Artifact Versions 不识别或硬编码 Research Checkpoints 的 domain ID。
- 新增持久 producer journal、before-turn lease、响应丢失幂等恢复、ambiguous provider delivery fail-closed reconciliation、连续 turn 的 pending deterministic predecessor overlay、restore-as-new、显式 legacy/incomplete import、文本凭据净化和容量硬门。
- 主聊天只保留中性的“打开科研档案”精确入口；大型 checkpoint 卡、版本徽章、产物预览、警告和 composer 记录状态条移入或收敛到科研档案。
- 科研档案改为研究员优先的只读组合视图：默认展示研究结果、来源、产物、版本位置和可行动限制；内部 ID、digest、receipt 与原始状态码折叠为技术详情。
- Artifact Versions 保持既有 V1 wire/selector 语义，新增 requested identity、staging、range、丰富列表和目录 Bundle 使用显式 V2 action。
- `@sciforge/domain-sdk` 升级到 `0.2.0`，保留 V1 wire 的 `@sciforge/domain-artifact-versions` 升级到 `1.1.0`；下游包使用匹配的版本范围，并以 packed tarball 独立安装 smoke 验证发布边界。

## Capabilities

### New Capabilities

- `chat-research-checkpoints`
- `research-dossier`

### Modified Capabilities

- `research-artifact-versioning`
- `agent-runtime-turn-handoff`
- `chat-timeline`
- `domain-package-composition`

## Impact

- Host AgentRuntime 生命周期、Codex/Claude adapter、Turn Artifact Outbox V4/handoff、至少一次 settlement 与 package-scoped capability invocation。
- Artifact Versions、Research Checkpoints、Research Dossier 与 Domain SDK 合约及版本。
- Electron main/renderer composition、聊天与右侧科研档案 UI。
- npm lock、capability governance、OpenSpec、中文交付文档、packed-install smoke 和 production-composition Electron 测试。

Scientific Compute controlled-script beta 不属于本变更范围，应在独立 change/PR 中设计、实现和验证。

原分支的一次干净安装 audit 摘要报告 14 项依赖漏洞（4 moderate、10 high），只作为历史基线；最终 staged-equivalent source 必须重新安装、重新记录数量并完成可达性和升级影响审核，不使用破坏性自动 `audit fix` 掩盖兼容风险。普通 Terminal、IDE、PTY、`exec_command` 和未托管脚本写入仍是明确非目标，继续保持 `untracked/incomplete`。
