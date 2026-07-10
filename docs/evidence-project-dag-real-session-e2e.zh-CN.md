# Evidence / Project DAG 真实 session E2E

本说明对应通用 harness：

```text
scripts/evidence-project-dag-real-session-e2e.mjs
```

它只读取一个已存在的 SciForge Runtime session，通过桌面自动/手动更新共用的 canonical mapper，将可见 user/assistant、可见 reasoning 和成功完成的 tool result 送入当前 worktree 的 Evidence DAG 和 Project DAG sidecar。tool call 不单独成为证据；同一 `callId` 的完成结果使用稳定 trace ID 并覆盖调用态。sidecar 使用独立临时存储与备用端口，不读取或修改 live Evidence/Project DAG DB，也不修改目标 workspace。

## 安全边界

- Runtime 只执行 `GET /v1/threads/{id}`。
- 输入的 `sciforge:<thread-id>` 是跨 runtime identity；访问 SciForge Runtime 时默认去掉 `sciforge:` 前缀，也可用 `--runtime-thread-id` 明确覆盖。
- Model Router 只从环境变量或本机 `SciForge/sciforge-settings.json` 读取 runtime boundary 的 base URL、runtime API key 和 public alias。
- harness 不打印或写入 API key。报告只记录配置是否存在；日志经过 key/header 文本脱敏。
- 子进程使用最小环境，不继承无关 provider secret。
- 默认在完成后删除隔离 PROV、SQLite 和日志，仅保留机器可读 `result.json`。调试时可显式使用 `--keep-storage`。
- Artifact 注册仍遵守 worker 的 workspace scope 和 access policy；harness 不为单个项目伪造 Artifact、Claim 或 selector。
- mapper 保留可见 URL、DOI、citation 与 file reference；错误或未完成工具结果、approval 和系统控制项不会进入 trace。

## 运行

```bash
node scripts/evidence-project-dag-real-session-e2e.mjs \
  --runtime-url http://127.0.0.1:8900 \
  --session-id sciforge:thr_y0gllcmn \
  --workspace-root /Applications/workspace/ailab/research/molclaw \
  --evidence-port 4397 \
  --project-port 4398 \
  --continue-on-failure
```

脚本参数均为通用参数；示例 session/workspace 只是一次真实验收输入，不存在于 harness 逻辑中。

可选参数：

- `--runtime-thread-id <id>`：Runtime 原生 thread ID。
- `--settings <path>`：显式本机 SciForge settings 路径。
- `--output-dir <path>`：结果目录；默认位于 `temp/evidence-project-dag-e2e/<timestamp>/`。
- `--timeout-ms <ms>`：单阶段最长等待，默认 12 分钟。
- `--model-timeout-seconds <s>`：sidecar 单次 Model Router 请求超时。
- `--keep-storage`：保留隔离 DAG/DB/日志用于本地诊断。
- `--continue-on-failure`：记录所有可继续检查的失败；阻断异常仍会安全清理并返回非零状态。

## 验证范围

1. 只读加载真实 Runtime session，并核对 workspace。
2. 用真实可见 trace 的前缀和完整 trace 分别执行 Evidence `POST /updates`；该 trace 与桌面自动 feed、手动立即更新使用同一个 mapper。
3. 验证 committed Evidence Snapshot、A0–A2 ledger、历史快照和相同输入幂等；Artifact 验收必须存在带 SourceAnchor 的非 log 科研来源，且 locator 是真实可定位 URL/DOI，或是具有内容 digest 且当前可用的文件，不能用 runtime log 冒充通过。
4. 重启 Evidence sidecar，验证 latest committed snapshot 恢复。
5. 创建通用 Goal，通过 Project `POST /updates` 提交精确 evidence vector/captured scope。
6. 在 Project job queued/running 后停止 sidecar，再用同一个隔离 DB 重启并等待恢复。
7. 验证不可变 Project Snapshot、Project A0–A2、Claim、跨层 Artifact provenance；跨层路径必须达到至少 L2，并回到上述真实科研来源及结构化 selector。
8. 执行 L1 audit，验证 autonomous A3 Decision/assessment 和 attention frontier。
9. 通过同一 Project update lane 切换 `checkpointed`、`supervised`，验证没有人工编译旁路。
10. 读取早期 Project Snapshot digest，验证历史版本仍可访问。

## 机器可读结果

`result.json` 使用 schema `evidence-project-dag-real-session-e2e.v1`，只保存：

- 参数化输入 identity、workspace 和端口；
- 每项检查的 `passed|failed` 与非敏感计数/digest/level/state；
- 精确 blocker（若存在）；
- 隔离与清理状态。

退出码为 `0` 仅表示所有检查通过。`failed` 表示链路完成但至少一个验收条件不满足；`blocked` 表示 HTTP、Model Router、sidecar 或当前实现合同阻断后续执行。两种情况都会写出结果文件。

## 2026-07-10 最终真实验收

最终冻结代码在真实 molclaw session `sciforge:thr_y0gllcmn` 上通过全部 21 项检查：

```text
temp/evidence-project-dag-e2e/2026-07-10T04-52-53-782Z/result.json
```

结果为 `passed`（21 passed / 0 failed）。验证覆盖 canonical 真实 trace、Evidence 增量与幂等提交、Artifact/ArtifactVersion/SourceAnchor、不可变历史、Evidence 与 Project 重启恢复、精确 evidence vector、Project A0–A2、跨层 L2+ provenance、异步 L1 AuditRun、autonomous A3 Decision、延期仍可见的 attention frontier、checkpointed/supervised 共用编译链路和历史 Project Snapshot。

运行只读访问 Runtime，未读取或写入 live DAG 存储，未写 molclaw workspace；隔离 PROV、SQLite 与日志在结束时删除，机器结果记录 `storageRetained=false`。

## 早期失败记录

输入为 `sciforge:thr_y0gllcmn`，Runtime 原生 ID `thr_y0gllcmn`，workspace 为 `/Applications/workspace/ailab/research/molclaw`。脱敏机器结果：

```text
temp/evidence-project-dag-e2e/2026-07-10T02-26-50-502Z/result.json
```

已通过：Runtime 只读加载与 workspace 核对、Evidence 两个 committed snapshot、相同输入幂等、A0–A2 ledger、不可变历史文件、Evidence 重启恢复、Project durable enqueue、Project 重启恢复、`checkpointed/supervised` 共用更新链路。

首次运行只选择了 2 条 user/assistant item，遗漏真实 session 中 52 条结构化 tool result，因此没有生成 Artifact/ArtifactVersion/SourceAnchor；对应 Project 编译得到 0 claims，Project assessment、跨层 provenance、A3 Decision 和 attention frontier 无法验收。当前 harness 已删除该独立筛选旁路，改为复用 canonical mapper。该历史结果保持不可变，仅用于解释修复过程；以上最终结果才是当前实现的验收记录。
