# @sciforge/plugin-change-inspector

Change Inspector 的唯一生产实现是本独立只读 DSH 插件。插件拥有公开工具契约、diff 投影与分页逻辑，经标准清单发现和精确版本授权加载；没有静态域 fallback、公开能力转发薄层或旧 Changes 面板入口。结果直接返回发起调用的 Agent 会话，不修改或回滚文件。

## 公开工具与 Host 边界

[正式契约](<./sciforge.dsh.json>)声明两个工具和 `agent-threads.read` port：

| DSH 工具 | 插件拥有的公开 capability id | effect |
| --- | --- | --- |
| `open_session` | `change-inspector.open-session` | `read` |
| `list_changes` | `change-inspector.list-changes` | `read` |

这是 **2 个声明工具**。Host 按通用规则另外派生 `<contribution-namespace>.dsh-session.open`，发行 caller-bound 的 `dsh-session` 资源，供这两个读工具调用；opener 不是第三个插件声明工具，也不是 Change Inspector 专属能力薄层。仅在插件启用且相应精确版本 grant 有效时注册与调用；没有授权或停用后 fail-closed，不切回静态实现。

[DSH 入口](<./src/dsh-adapter/index.ts>)通过 Cordis `inject: ['tools', 'agentThreads']` 获得通用 Host service client，调用 `agentThreads.read`。生产唯一数据来源是 Host 的真实 Agent thread aggregate。没有 `dshConfig.sessions`、工具入参 `sessionDetail`、生产 fixture 或录制会话 fallback；录制数据仅用于 [测试夹具](<./tests/fixtures/config-agent-threads.ts>)及测试 Host aggregate。

[通用 agentThreads Host](<../../src/main/extensions/agent-threads-host-service.ts>)是受控的**当前会话代理**：

- Host 从已认证 agent caller、ordinary Session、在途 authority lease 和精确 package/version/generation 的 `agent-threads.read` grant 决定身份；插件及模型不能提供 authority 或 workspace。
- 省略 `sessionId` / `runtimeId` 时读取当前 Host 会话；显式 selector 必须匹配其 thread/runtime。同 workspace 的其他 session、其他 runtime 和 runner synthetic session id 均被拒绝，不进行任意会话发现。
- Host 校验 caller workspace 授权，并比较真实快照的 canonical workspace；跨 workspace、缺少 workspace、UI caller 和缺少 ordinary Session 均拒绝。snapshot await 后、每次 artifact await 后及最终返回前均异步重新授权 workspace；每次 authorizer await 前后均执行 lease、signal、owner/version/generation 与精确批准 port fences，不能仅靠 Principal lease 判断工作区仍获授权。
- Host 使用通用无损 thread JSON 投影返回 artifacts / turns 与 watermark；外置 tool detail 仅按当前已授权 aggregate 中的 canonical artifact ref 补全，逐次复核 ref/response scope 与上述在途权限。Host 不解析 Change Inspector diff，业务投影留在插件内。
- DSH durable 目录逐 journal 排除已持久化 `captureFailure` 的线程，不让该线程阻断其他健康工作区目录；失败线程的 read page/status、startTurn、artifact read 及带 cursor 或无 cursor 的 cold subscription 仍以 `runtime_history_capture_failed` fail-closed。损坏 JSON/header/tail 不因该隔离而被吞掉。

## 输入、输出与有界投影

[插件契约](<./src/contract.ts>)与[投影实现](<./src/core/change-observation.ts>)定义：

- `open_session({ sessionId?, runtimeId? })` 返回 `{ sessionId, resourceId, snapshot }`。`resourceId` 是插件结果中的确定性标识，不是 Broker 资源句柄；Host opener 返回的资源才用于授权调用。
- `list_changes({ sessionId?, limit?, cursor? })` 返回 `{ changes, nextCursor, revision, truncated, truncationReasons }`；默认 `limit=100`，最大 500。分页针对当前有界快照中的 changes。
- 只提取 `kind: 'tool'`、`toolKind: 'file_change'` 的 unified diff，支持纯字符串和 JSON 的 `diff` / `patch` / `unified_diff` / `unifiedDiff` / 递归 `changes`。优先使用 aggregate artifacts，为空时取 turns 中 artifacts。
- plain / JSON patch 使用原字符串，trim 仅用于判断是否为空，不改变返回内容、原始字节计数或 revision hash；尾部空格、最终 LF 与 CRLF 均保留。单条 patch 上限 **64 KiB（65,536 UTF-8 bytes）**，包含截断标记并保留完整 UTF-8 字符；`patchBytes` 记录截断前原始字节数，`patchTruncated` 显示是否截断。
- canonical workspace mutation receipt 的 unified-diff header 使用 Git C-style path quoting（包括控制字符、引号与反斜杠），不用 JSON Unicode escape；自动测试经实际 Git decode 与 reverse/apply roundtrip 核对路径及文件字节。这不扩张为任意非 UTF-8 路径或所有 metadata 字段的字节保真承诺。
- 序列化 snapshot 上限 **256 KiB（262,144 bytes）**，计入 JSON escaping 和元数据；最多 5,000 条 changes，超限移除较早条目、保留连续的最新后缀。此预算针对 snapshot，不是整个工具结果或 Host 原始 aggregate。
- 每条分页 patch 摘要上限 **1 KiB（1,024 UTF-8 bytes）**，继续保留原始 `patchBytes` 与累积 `patchTruncated`。摘要自身的缩短由逐条 `patchTruncated` 表达；顶层截断状态沿用 snapshot。
- `truncationReasons` 显式列出 `patch-byte-limit`、`snapshot-byte-limit`、`change-count-limit`；没有快照截断时为空。
- revision 为 `changes-<sha256>`，覆盖会话和截断前完整变化内容及元数据，包含省略的 patch 尾部和旧条目。只读调用及非变更事件推进的 watermark 不进入 hash，避免分页自身导致 revision 变化。cursor 绑定 **session + revision**，不能跨 session 或在后续编辑后复用；过期、畸形及越界 cursor 拒绝，需从无 cursor 的第一页重读。

## 包结构与生命周期

| 路径 | 职责 |
| --- | --- |
| [contract](<./src/contract.ts>) | 插件公开 id、输入输出 schema、字节预算 |
| [agent-threads port](<./src/ports/agent-threads.ts>) | Host 授权后的最小 DTO 与只读接缝 |
| [projection](<./src/core/change-observation.ts>) | diff 提取、有界 snapshot、revision 与分页 |
| [service](<./src/core/service.ts>) | 读取授权 DTO、身份一致性检查与投影编排 |
| [operations](<./src/core/operations.ts>) | strict 输入与输出校验 |
| [DSH adapter](<./src/dsh-adapter/index.ts>) | 通用 service client 和两个工具注册 |

生产源码不导入 Host 私有实现、renderer 或测试数据。插件无定时器、socket 或磁盘存储；启停、授权失效、子进程与贡献清理由通用 Host 生命周期负责。旧静态域、旧面板及专属薄层不参与运行。

## 真实应用验收与验证边界（2026-11-03）

当前正式插件版本为 **0.1.2**。本机验收使用 SciForge 标准构建、独立 profile 与正式安装制品，官方 DSH `0.2.1-rc.4` 经 SciForge Model Router 使用 `yunshu/gpt-6.1-sol`。历史 0.1.1 任务保留了 watermark 分页失败、外置 artifact hydration 遗漏及其修复、同 workspace 其他 session / `sessionDetail` handler 拒绝、停用/重启/目录恢复证据；这些历史结果不代替本轮精确保真复验。

本轮在同一真实应用、同一 Host session 完成两回合，证据范围为原始事件 **seq > 297**：

- [原始完整事件](<../../../evidence/remediation-live-complete-events.json>)、[canonical snapshots](<../../../evidence/remediation-live-canonical-snapshots.json>)与[最终字节 verifier](<../../../evidence/remediation-live-byte-verification-final.json>)分别保留原始调用结果、完整外置 artifact 内容及核对结果。第一轮将 `pending \n` 改为 `reviewed \n`，保留尾部 1 个空格和 LF；第二轮只增为 `reviewed  \n`，即尾部 2 个空格和 LF。两轮正常 `npm test` 均 **5/5**。
- 完整 snapshot 中小 patch 为 **275 / 277 bytes**，`patchTruncated=false`，逐字节匹配 canonical executor `workspaceMutation.patchText`，before/after hash 与磁盘一致。最终 verifier 修正了初版把 receipt 字段误映射的核对错误；不以初版 false 或最终 true 布尔值取代原始证据。
- 第二轮旧 cursor 场景有真实 `handler_failed` 拒绝，消息明确 session/revision 不匹配；新 revision 的前两页各返回不同 change，revision 稳定，且相对第一轮已改变。事件档案不足以重新认证原始旧 cursor 参数的每个字节；stale cursor 另有实际 service 测试直接覆盖。这里只验证新 revision 前两页，不宣称遍历全部大历史。
- 两轮 snapshot 分别 **200,622 / 201,162 bytes**，保留的大 patch 各原始 **162,327 bytes**、返回 **65,536 bytes**，明确 `patch-byte-limit` 与 `snapshot-byte-limit`。历史记录中的 **162,326 是 trim 缺陷导致的错误值，不是正确原始大小**；五个历史 canonical 完整 patch 重建的 after bytes 仍与磁盘一致。本轮并未重新发行五次大文件 mutation。
- [独立只读复审](<../../../evidence/remediation-independent-review.md>)已核对四项审计修复及额外 cold live-only subscription fence 补修，并交叉核对上述 raw receipt、artifact、磁盘和分页；该结论限于具体修复，不构成全库、全部 live 安全场景或发布通过。

自动化与构建记录（以下 suite 有重叠，不重复累加）：

- [插件最终测试](<../../../evidence/remediation-plugin-final.txt>) **75/75**；[Host focused](<../../../evidence/remediation-host-final.txt>) **14 suites / 495 pass**。其中 provider **79**、durable + DSH bridge **22**；receipt **45** + Broker preview **3** + model-visible **6** = **54**，均为定向覆盖，不能再计入额外独立总数。
- 覆盖 raw plain/JSON patch 尾空格、LF/CRLF、65,536/65,537-byte 边界与 stale cursor；snapshot/artifact/final workspace async reauthorization；capture-failed journal 隔离及 cold read/status/startTurn/artifact/subscribe（含无 cursor）拒绝；实际 Git header decode 与 Broker 特殊路径 reverse/apply 字节重建。candidate/crash/cancel/late-completion 使用真实子进程和录制 Host aggregate，见[测试 harness](<./tests/harness.ts>)，不冒充 live GUI 故障演练。
- full typecheck、标准 build、改动文件 lint、20 域 generated composition 与 capability governance 已通过。包含 subscription 补修的[最终标准 build](<../../../evidence/remediation-application-build-final.txt>)及[最终全量 Vitest](<../../../evidence/remediation-full-vitest-final.txt>)已完成：**5,805 pass / 8 skip / 0 fail**，510 files pass / 3 skip。历史 4 fail 通过标准构建补齐 dist 和严格修正 manifest / serviceIds 测试解决，没有放宽契约。
- follow-up 已从同一AGI4Sci origin恢复真实历史，任务本地Git指针指向私有库，不改共享原仓库。[来源](<../../../evidence/followup-git-history-provenance.json>)。早期全局GIT_DIR污染仅私有fixture元数据，已恢复HEAD并停止环境覆盖；未源码commit。[最终root `npm test`](<../../../evidence/followup-full-npm-test-final.txt>)完整退出0，EvidenceDAG Python279OK，最终Vitest5805pass/8skip/0fail（510filespass/3skip）。旧identity构建脚本exact期望已对齐实际heap wrapper，未skip/宽断言。
- [changed-path architecture gate](<../../../evidence/followup-architecture-gate-final.txt>)已通过：真实baseline祖先关系、787生产源码、20域、0findings；架构测试及fulltypecheck通过。要求clean、指定codex分支和private overlay的formal Stage4不适用本任务，未宣称formal制品门禁通过。

包级复现命令：

```bash
cd plugins/change-inspector
npm run typecheck
npm test
```

follow-up已补真实安装包与故障验证：旧macarm64包经普通生产公开API/精确child归属验证，workspace撤权authorization拒绝、在途disable No live grant、crash runtime_crashed且17其他域healthy；cancel同一tool item aborted、turn interrupted，不称handler拒绝或实际迟到reply已发生。恢复后新模型回合成功读取；最终Python补修包又完成[authenticated open_session与回合结束](<../../../evidence/followup-live-faults-healthy-2026-11-03T09-51-44.762Z.json>)、[运行后seal深检0](<../../../evidence/followup-fixed-codesign-after-live.txt>)。见[故障索引](<../../../evidence/followup-live-fault-status.md>)。四fault没有在最终包全重跑，所有报告hostAwaitBoundaryProven:false，不能把tool-running事件当作精确artifact await边界。

实际打包发现Python sidecar写入pycache破坏签名资源，已由SDK ownedPythonLaunch以-B/env统一2个desktop DAG sidecar解决；RED实际缓存到GREEN18focused/SDK165/DAG225及类型/lint。独立wheel/plugin的全部Python执行器不在此修复范围。source/fixedpackaged/zip展开基础smoke均0；smoke严格installedPluginsVerified:false（17回归），不要求未安装的独立plotting。最终zip463486384bytes、SHA256 d15042724781115163cc79e210a5817fdda48074da11446e2f7188ac44a3de3f，运行前后codesign均0，见[制品核验](<../../../evidence/followup-release-verification.json>)。这是macarm64本地ad-hoc包，无Developer ID/公证/发布；DSH来自用户配置的官方安装，不冒称pinned closure自包含。

仍待验证：live精确snapshot/artifact await后撤权、capture-failed journal、特殊路径全产品演练、全部跨workspace/runtime负向、实际迟到reply及完整旧资源清理，以及其他平台/Apple签名公证/市场发布。精确await权限撤销及cold capture fence仍由自动化覆盖；正式Stage4条件不满足不等于changed-path gate失败。[本轮独立follow-up复审](<../../../evidence/followup-independent-review.md>)已完成，确认补修成立，独立35项轻量测试通过，交叉核对root exit0和原始live/制品证据，未独立重跑全库。

历史 A4、录制数据和旧面板 smoke 不能替代真实证据。本地 JSON 档案未获服务商签名或第三方不可篡改鉴真；独立复审没有独立重跑全库。通用协议状态见 [GAPS](<../GAPS.md>)，会话身份与缓存边界见 [生命周期说明](<../../docs/dsh-session-cache-lifecycle.md>)。
