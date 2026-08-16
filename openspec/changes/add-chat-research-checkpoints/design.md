## Context

Artifact Versions 应当是稳定 Artifact identity、不可变 Version、CAS 字节、current 指针、比较、恢复与 Bundle 的唯一 owner。Research Checkpoints 只拥有对话记录策略、turn boundary lease 和 producer journal；Research Dossier 只组合 owner 的精确读取。把这三层分开，才能避免聊天域建立第二套版本库，也避免展示层回退到 `latest`。

可信归因必须证明 producer 因果关系，而不只是“文件在相近时间发生变化”。当前窄可信路径是 Host-authenticated `apply_patch/fileChange` receipt；外部 Terminal、IDE、普通 `exec_command`、文件 watcher、Git diff、mtime、stdout、退出码或事后 hash 都不具备该证明。

## Goals

- 新对话在第一条 turn dispatch 前默认建立持久记录边界。
- before-turn boundary 使用 Host-persisted `issuerEpoch`、单调 attempt ordinal、random delivery attempt 与 workspace-bound lease；Turn Artifact Outbox V4 是 pending-start/watch/intent/settlement 的 durable owner。
- settlement 至少一次重试；应用重启只按 Host-authoritative owner snapshot reconciliation，不按 runtime generation 或时间 cutoff 猜测终态。
- 双 ACK 后有界 receipt 只进入同 `issuerEpoch` 的 exact retired ordinal ranges；不用 Bloom，ordinal gap 不能作为 release 证据，一个 thread 的 pending gap 不阻塞其他 thread。
- automatic policy 独立于 recording、默认 enabled，并用 `policyRevision` 乐观并发；Dossier 在 waiting/active/stopped 状态提供 Start/Stop，普通聊天不提供控制。首轮前 Stop 可持久 opt out，Start re-enable 后下一 completed turn 才创建 checkpoint v1。
- 一个 recording 始终推进同一个 checkpoint Artifact identity。
- 可信输出拥有独立稳定 Artifact history，并与 checkpoint 原子提交。
- 每个 domain runtime 以 package-scoped caller identity 调用能力；特权行为由通用 grant 决定，而不是由 owner 硬编码 consumer ID。
- 响应丢失、重启和 restore-as-new 不产生重复版本或改写旧历史。
- 连续 turn 在前一输出已本地精确验证但 Artifact commit 尚未完成时，使用 pending deterministic predecessor overlay，而不是读取陈旧 current。
- provider delivery 无权威终态时保持 durable ambiguous/fail-closed，可由 Host 后续 reconciliation，不能误报 rejected。
- pending-start 不扫描文本/history 自动绑定；只有 provider accepted handle 自动绑定，ambiguous start 只能经 generic governed list/resolve/release 且精确验证 scope/turn/item。
- disabled attempt 持久记录为 `skipped`，同 attempt 的 response-loss replay 仍 skip，不受后来 policy 变化影响。
- 默认持久化文本净化凭据，新 checkpoint/output 禁止导出。
- 容量满时写前 fail closed，不自动删除已提交历史。
- 主聊天保持简洁，科研档案只显示研究员需要关注的内容。
- 保持上游 V1 wire 兼容，所有扩展能力 additive。
- Domain SDK 使用 `0.2.0`、保留 V1 wire 的 Artifact Versions 使用 `1.1.0` 发布边界，并能从 packed tarball 独立安装。

## Non-Goals

- 把普通 Terminal、IDE、PTY、`exec_command` 或任意脚本写入升级为可信。
- 从 workspace scan、watcher、Git diff、mtime、stdout 或退出码推断因果关系。
- 自动回填旧对话、自动内容合并或 Git/workspace 全量回滚。
- 以 checkpoint receipt 自证可复现、科学正确或 Evidence L4。
- 在本 change 中增加或修改 Scientific Compute controlled-script 能力。

## Decisions

### 1. Artifact Versions 是唯一版本 owner

所有正式写入经 Capability Broker 到 Artifact Versions。V1 action/input/output/issue 和空选择器行为保持上游 strict 客户端兼容；requested identity、staged object、range read、rich list/describe 与 directory Bundle 使用 V2 action。多候选 commit 以 expected-current 和幂等 key 保障原子性。

Caller-selected Artifact/Version identity 是通用受控权限。Artifact Versions 只检查 Broker 授予的 grant，不识别 Research Checkpoints 或任何具体 domain ID。该授权不得形成第二条 commit API、测试专用旁路或 owner 内的 consumer switch。

### 2. Domain runtime 使用 package-scoped invoker

Host composition 为每个已安装 domain runtime 创建 scoped system invoker。caller identity 从生成式 package composition 的权威 package identity 派生，不由 domain 自报，也不复用全局 `domain-runtime` caller。Broker 根据通用 SDK contract 和 manifest/grant contribution 授权；添加或移除 domain 不要求在 application core 中增加 action-ID 或 domain-ID 分支。

### 3. 默认 checkpoint 边界是持久 lease

Host 持久保存稳定 installation `issuerEpoch`，并在每次 provider delivery attempt 前分配该 epoch 内单调、不可复用的 `deliveryAttemptOrdinal` 与随机 `deliveryAttemptId`。Host 先把 pending-start owner 持久化到 workspace-bound Turn Artifact Outbox V4，再取得 required before-turn lease。`boundaryLeaseId` 绑定该 delivery attempt，而不是由 `clientDirectiveId` 决定；同一 directive 的新 delivery attempt 不得复用旧 lease。任一持久化步骤失败都不得 delivery 给 provider。

Research Checkpoints 在一次原子 store mutation 中复查 automatic policy、确定或创建 `recordingId`，并把 lease、recording 与 exact binding snapshot 绑定为 `open`。snapshot 直接内嵌在 lease，不维护全局 binding revision/history。连续 turn 若遇到前一 turn 已本地精确验证但 Artifact commit 未完成的输出，snapshot 叠加其稳定 operation identity 与 exact bytes/ref 作为 deterministic pending predecessor；不等待 commit，也不回退陈旧 current。

Turn Artifact Outbox V4 持久拥有四类权威状态：pending-start、provider-accepted watch、completed artifact intent、terminal settlement。pending-start 不读取文本、latest turn 或历史猜测恢复；只有 provider `startTurn` 返回的 authoritative handle 可自动绑定 watch。若 handle response ambiguous，start 保持 durable。通用 governed list/resolve/release 是唯一人工恢复路径：list/release 验证 runtime/thread/workspace owner scope；resolve 还分页读取 provider history，验证 exact turn 与 user-message item 后才绑定。显式 release 才生成 rejected settlement。

settlement 经 durable handoff 至少一次重试，直到 consumer receipt 持久化。completed intent/settlement 驱动 lease 进入 `consumed`；权威 failed/cancelled/rejected settlement 驱动 `released`。delivery 是否发生或终态不明确时，Outbox owner 与 `open` lease 保持 durable ambiguous/fail-closed，不能凭异常路径推断 rejected。replay 按 runtime/thread 隔离失败，一个 pending/settlement gap 不阻塞其他 thread。

启动 reconciliation 必须取得 Host 的完整 durable owner snapshot，验证 `issuerEpoch`、`nextDeliveryAttemptOrdinal`、exact retired ranges，以及每个 owner 的 ordinal/attempt/workspace/runtime/thread/directive/turn scope，再按 phase 对齐状态。一个已签发 ordinal 必须仍有 owner/receipt，或位于精确 retired range；中间 gap 是 corruption，不是 orphan 证据。唯一可清理的本地终态 lease 是 Host 已用 exact range 证明退休的 ordinal；仍 `open` 却已被 Host 退休必须 fail closed。不得用 runtime generation、Bloom、年龄或时间 cutoff 猜测。

lifecycle consumer ACK 与相关 artifact delivery ACK 都 durable，且 start/watch/intent/settlement 均已清除后，Host 才能把有界 receipt 退休到 exact ordinal ranges。Research Checkpoints 在双 ACK 前保留匹配终态证据；重复 reconciliation 与 settlement 必须幂等且拒绝冲突终态。

### 4. 自动记录策略与 recording 生命周期分离

automatic policy 是 workspace/runtime/thread 级持久状态，与 recording 是否存在、是否 active 分离；未存储时默认 `{ enabled: true, policyRevision: 0 }`。canonical status 总是返回 `policyRevision`；Start/Stop 输入必须携带 `expectedPolicyRevision`，stale revision 在任何状态变化前拒绝，成功 receipt 返回新 revision。Research Dossier 始终从 owner canonical status 提供 Start/Stop，普通聊天和 composer 不提供控制。

`waiting + enabled` 可以在首个 turn 前 `stop`：策略写入 `disabled`，因为没有 recording，receipt 的 `recording` 为 null。active recording 上 `stop` 同时关闭该 recording。disabled attempt 仍以同一 Host attempt identity 写入不可变 `skipped` decision，不绑定 recording 或 snapshot；同 attempt 的 response-loss replay 仍返回 skip，即使 policy 已被 Start 改回 enabled。disabled 期间的 turn 永久 unrecorded。`start` 以 expected revision 把策略恢复为 `enabled`，但不立即生成 checkpoint Version；下一 accepted/completed turn 才创建 v1。策略跨重启保留，历史 recording 与版本链均不删除。

### 5. `apply_patch/fileChange` 只接受完整闭包

可信输出必须来自成功 Codex executor receipt，并绑定 runtime、thread、turn、client directive、call ID 与 executor sequence。更新从 before-turn 冻结父版本严格重放 raw hunks，结果必须与独立捕获的 terminal digest/length 完全一致。路径逃逸、敏感文件、symlink、缺父版本、删除、receipt 不匹配或 ambient overwrite 均 fail closed。

### 6. 隐私先于 digest 和持久化

Research Checkpoints 在生成 source ID、manifest digest、operation identity 和 journal 内容前，先执行结构化凭据/URL 净化，再调用 Host 的 opaque-secret sanitizer，最后再次执行结构化净化。新 checkpoint/output 显式使用 `visibility: workspace` 与 `allowExport: false`。旧不可变内容不静默重写。

### 7. 容量策略不删除可信历史

Artifact index、workspace CAS、active staging 和 checkpoint store 均有写前硬预算与有界记录。超限保持旧 index/current 不变。只允许清理无引用 staging/orphan；已提交不可变版本不为腾空间自动删除。committed checkpoint journal 只保留 summary/ref，读取时通过 exact Artifact owner 恢复 manifest，禁止 latest fallback。

enabled boundary lease 是临时恢复状态而不是永久历史。它原子绑定 recording 与 exact binding snapshot；`released` 清空 snapshot，`consumed` 在 completed artifact intent/event 获得 durable owner 后清空。disabled attempt 保存无 recording/bindings 的 `skipped` decision。仍有 Outbox owner 或 ambiguous delivery 的 `open` lease 不得为腾空间、进程 generation 或年龄静默丢弃；终态 receipts 只在双 ACK 后进入 exact retired ordinal ranges。

### 8. 科研档案是研究决策页

聊天 committed contribution 仅显示“打开科研档案”，携带 exact Version ID 和 expected digest。科研档案默认回答：本轮做了什么、产物与来源是什么、版本位置在哪里、有哪些可信限制、下一步能做什么。非适用 projection 不渲染；access、ref、digest 或 owner scope 不一致则 fail closed。

## Migration

1. 保持 Host receipt、Artifact Versions V2、Research Checkpoints、Research Dossier 和 UI 的单一规范路径。
2. 把 global runtime invoker 替换为按 package identity 创建的 scoped invoker，并把 caller-selected identity 改为通用 grant。
3. 将 Turn Artifact Outbox 升级为 V4 durable owner，持久化 `issuerEpoch`、单调 ordinal、随机 attempt 与 pending-start，再绑定 provider-accepted watch、completed intent 或 terminal settlement，并对 settlement 使用至少一次重试。
4. 将现有 before-turn snapshot 迁移为 workspace-bound lease；lease 原子绑定 recording 与 exact snapshot，disabled attempt 写 `skipped`，启动只用包含 exact retired ranges 的完整 Host snapshot reconciliation。
5. 为连续 turn 加入 pending deterministic predecessor overlay；只有本地精确验证的 operation/bytes 才能覆盖 committed predecessor。
6. 将 automatic policy 与 recording 分离并保持默认 `enabled`；status/Start/Stop 使用 `policyRevision`/expected revision，Dossier 在 waiting/active/stopped 状态提供 owner controls，Stop receipt 允许 `recording: null`，Start 后由下一 completed turn 创建 v1。
7. 将 Domain SDK 升级到 `0.2.0`、Artifact Versions 升级到 `1.1.0`，同步下游依赖、lock 与生成式 composition。
8. 移除跨包相对导入私有 `src` 的测试，改走公开 Broker/composition contract。
9. 不在本 change 中保留 Scientific Compute controlled-script 源码、capability、测试或生成结果。

## Failure Semantics

- pre-dispatch start 或 lease 持久化失败：不 delivery provider；Host 用 durable owner 状态决定是否 settlement。
- 权威 failed/cancelled/rejected terminal settlement：至少一次投递并幂等 release lease，不创建成功 checkpoint。
- provider delivery/terminal 状态 ambiguous：保留 Outbox owner 与 `open` lease，durable fail closed；不得转换为 rejected 或按时间自动释放。
- pending-start ambiguous：不扫描文本/history 自动绑定；只有 exact accepted handle 或 governed resolve 验证 scope/turn/item 后绑定，显式 governed release 才能 rejected。
- 启动 reconciliation：只依据包含 epoch/next ordinal/exact retired ranges/owners 的完整 Host snapshot；ordinal gap、scope/phase 冲突或 retired-open lease fail closed。
- disabled attempt：持久 `skipped` decision；同 attempt response-loss replay 必须保持 skipped，不能按新 policy 追溯记录。
- pending predecessor 不满足稳定 operation identity 或 exact byte/ref 验证：不得进入下一 lease overlay，也不得回退到陈旧 current 冒充连续 lineage。
- stale current：整个候选批次零推进，并保留显式 resolution 状态。
- commit response loss：同一稳定 identity 重放原 transaction，不重跑 producer。
- exact owner read 不匹配：Dossier/Checkpoint read fail closed，不回退 current/latest。
- caller 缺少通用 requested-identity grant：Broker 在进入 owner handler 前拒绝。
- 容量超限：发布前拒绝，旧 durable state 保持不变。

## Verification Requirements

- 使用真实 production composition 验证 package-scoped caller：自动 turn 产生 authenticated `apply_patch/fileChange` 输出，并让输出与 checkpoint 在同一事务成功提交。
- 覆盖 Outbox V4 issuer epoch、单调 ordinal、pending-start/provider-accepted watch/completed-intent/terminal-settlement、至少一次 settlement retry/receipt、双 ACK exact-range retirement、重复终态和应用重启；证明无 Bloom/time cutoff。
- 覆盖 pending-start 不扫描历史、accepted handle 自动绑定、governed list/resolve/release 的 scope/turn/item 校验、ambiguous delivery 保持 open/fail-closed，以及一个 pending gap 不阻塞其他 thread。
- 覆盖 completed-to-consumed、权威 failed/cancelled/rejected-to-released、完整 Host snapshot/ordinal-gap/retired-range reconciliation。
- 覆盖 lease 与 `recordingId`/exact snapshot 原子绑定，以及连续 turn 使用本地验证的 pending deterministic predecessor overlay。
- 覆盖 status `policyRevision`、Start/Stop expected revision、默认 `waiting + enabled`、Dossier pre-first Stop 返回 nullable recording、disabled attempt `skipped` 与 response-loss replay、Start re-enable、下一 completed turn 创建 v1，以及普通聊天无控制。
- 从 `npm pack` 生成的 Domain SDK、Artifact Versions 与 Research Checkpoints tarball 建立独立临时安装，验证导出、依赖版本和最小运行路径，不依赖 workspace symlink。
- 通过公开 Broker/composition 路径运行包级与集成测试；测试不得相对导入其他 domain 的私有 `src`。
- 在最终 staged-equivalent source 上重新运行 package tests/typechecks、root tests/typecheck/build、composition/capability governance、真实 Electron source 与 packaged path、diff/secret/绝对路径/大文件扫描。
- npm audit 的已知漏洞、未执行门禁和失败必须分别记录，不能用包级通过替代仓库或 Electron 通过。
