# Full Collaboration Stage 3 恢复与安全运维手册

本文描述 `Coordinator—Worker—Human—Content Space` 协作闭环在断线、重启、
offer 超时、撤权、Coordinator 转移、改派和 Provider 不确定写入后的唯一恢复
路径。本文不是部署授权，也不是 production cutover 手册；Stage 4 的 packaged、
真机和 live recovery matrix 仍需独立执行。

## 1. 不可变原则

1. Cloud PostgreSQL 是 Project、Membership、Task、Execution、Offer、fence、
   Inbox sequence、receipt、revision、authority epoch、idempotency 和 recovery
   journal 的事实来源。WSS 只发送 `inbox.available`，不得据此推进业务状态。
2. Desktop 本地 store 是 processed message、local sequence、ACK intent/outbox、
   Worker execution journal 和 Runtime Session/directive binding 的事实来源。
3. Runtime 或 Provider 写入不参加 Cloud/Desktop 分布式事务。它们必须使用
   durable prepare → dispatch → observation/journal；任何无法确认的 Provider
   结果进入 `outcome_unknown`。
4. `task.offer.withdraw` 是唯一 offer 撤回命令。`revoke` 只表示 Device/Agent
   authority revoke；Desktop 不得上报 timeout，公开 REST/SDK 也没有 timeout
   命令。
5. 旧 execution 永久保留为不可变审计事实。只有当前 Coordinator Agent 可在
   合法 terminal predecessor 后 reassign；每次 reassign 创建新的 `executionId`。

## 2. 正常启动与重连顺序

### Cloud 启动

1. 在服务接受流量前运行 `migrations.ts` 的正式 route 检测和 catalog fingerprint
   校验。仅允许 `fresh-v4`、`upstream-v4`、`public-v5`、`staging-v9`、`a-v11`、
   `current-v12`、`current-v13`、`current-v14`；未知或漂移 catalog 必须 fail closed。
2. migration 在单一 PostgreSQL connection 和显式 transaction 内完成；失败先
   rollback，再释放 connection。不得用部分 DDL、手工改 version 或跳过 fingerprint
   使服务进入 ready。
3. repository 和 service 构建完成后，执行同一个 Cloud-owned offer expiry
   reconciliation。它仅根据服务端当前时间与持久化 `expiresAt` 处理过期 offer，
   幂等且不创建 successor execution。
4. 只有 migration、repository readiness 和启动 reconciliation 均完成后才开放
   `readyz`、REST 和 WSS。

### Desktop 启动或重连

1. Identity 先验证当前 OIDC Principal lease、Device、Agent、credential generation
   和 Cloud origin。Collaboration 不接收 OIDC Token、Agent credential、Provider
   credential 或 Authorization header。
2. 打开 package-owned local store；把中断的本地消息和 Cloud outbox work 恢复为
   可安全 reconciliation 的状态。
3. Worker 在第一次 Runtime turn 前，由唯一 AgentExecution Host 创建 Session；
   `runtimeId`、`threadId` 与稳定 `clientDirectiveId` 必须先写入 execution journal，
   然后才把 invocation 标记为 dispatched。重启后用同一三元组查询 Host directive
   ledger，恢复同一 turn，不新建第二个 Runtime turn 或 execution。
4. Agent command authority 就绪后，从本地 `lastInboxSequence` 调用 `inbox.pull`，
   按有界 page 连续 drain，直至 durable Inbox 已追平。WSS hint 只能唤醒同一 drain。
5. 每条消息的幂等 handler 成功后，在一个 Desktop 本地事务中同时写 processed
   fact、推进 sequence 并加入稳定 `inbox.ack` outbox。事务前崩溃会重放同一幂等
   handler；事务后重放的 duplicate page/message 不产生第二份业务事实或 ACK。
6. 当前 Coordinator Agent 通过同一 Cloud workspace/Inbox 状态看到 Worker result、
   HumanNeeded/HumanAnswer、fence、recovery action 和 successor 入口；不得从 WSS
   payload、Desktop 猜测或 Provider metadata 推导下一步。

## 3. Offer、timeout、撤权与改派

| 事件 | Cloud 原子事实 | 允许的下一步 | 禁止行为 |
| --- | --- | --- | --- |
| Worker reject | Offer rejected；Execution fenced `offer_rejected`；Task `revision_requested`；Inbox、receipt 同事务 | 当前 Coordinator Agent reassign | 复用 executionId；旧 Worker 继续写 |
| Coordinator withdraw | Offer withdrawn；Execution fenced `offer_withdrawn` | 当前 Coordinator Agent reassign | 新增 revoke alias；Desktop timeout |
| Cloud timeout | 按服务端时间处理持久化 `expiresAt`；Execution fenced `offer_timed_out` | 先保持 terminal fact，再由当前 Coordinator 明确 reassign | timeout 自动创建 successor；多条 scheduler/REST fallback |
| Agent revoke | Agent、credential、availability 与其 current executions 同事务撤权/fence | 当前 Coordinator 可从 fenced predecessor reassign | 旧 Agent command/WSS/Runtime/file write |
| Device revoke | Device 及其 active Agents、credentials、availability 与 current executions 同事务撤权/fence | 当前 Coordinator 可改派至 eligible active Agent | 只删本地 credential 而保留 Cloud execution open |
| Coordinator transfer | Owner OIDC User 选择同一 Owner 的另一个 active Agent；Project revision 与 coordinator authority epoch 前进 | 新 Coordinator 读取 durable Inbox/workspace 后继续 | 旧 Coordinator 任何 coordinator-only write；Human 直接写 ProjectRecord/completion |

每次恢复操作都必须携带当前 revision、authority epoch 和稳定 idempotency key。
revision/epoch 冲突应重新读取 Cloud 事实，而不是修改本地 expected 值重试。旧 execution
上的 offer decision、start/fail、TaskResult、HumanNeeded、resource/file association、
review 和 recovery 写入一律应得到 fence/authority 拒绝。

## 4. Provider removal 与 `outcome_unknown`

Membership、Provider Observation、Content Readiness 与 Task Authority 是四类独立事实。
Project metadata 或可见 locator 不授予 Provider ACL。Worker 只能用自己的 Provider
Connection 执行 DownloadCheck/download/upload-new；不得 fallback 到 Owner、其他成员、
Mock 或 Fake。

Provider external write 的处理顺序如下：

1. Cloud 持久化 exact operation prepare；Desktop 持久化相同 logical invocation、
   request digest 与 execution tuple。
2. Cloud journal 进入 dispatched 后，Desktop 在本地记录 effect dispatched，才调用
   Content Space 的唯一 system capability。
3. 有确切 receipt/observation 时写 `observed_success` 或 `observed_failure`。
4. 响应丢失、连接中断或无法证明结果时写 durable `outcome_unknown`，停止自动 retry、
   Runtime result submit 和第二次 upload。
5. Owner HCI 可请求 Content Space 用原 root、expected safe name、logical invocation、
   request digest、binding/execution facts做 exact observe。观察前后都要重新读取 Cloud
   tuple；只有完全一致的 observed output 才通过 OIDC User recovery command link，随后
   Worker 从 Inbox 恢复并提交保留的结果，不重跑 Runtime 或 upload。
6. 无法精确确认时，Owner 可 abandon。旧 execution 保留
   `manual_recovery_abandoned` fence；Human 只批准 successor retry，真正的 reassign
   由当前 Coordinator Agent 发出。
7. successor 必须使用新 `executionId` 和该 Task 历史中从未使用的新安全输出名；
   binding revision、input locators、output target/mode/media type/max bytes 均保持不变。

Provider removal 后，即使 metadata 仍可见，原 User 的 Provider access 也必须返回
unauthorized；其他成员各自的 readiness/connection 不得被连带降级。

## 5. PostgreSQL 事故处理

- migration 前应使用组织批准的备份机制取得可验证备份；本文不授权对任何现有数据库
  执行备份、restore 或 schema mutation。
- migration 失败时保持服务 non-ready，保存安全的 route/fingerprint/error code，确认
  transaction 已 rollback。不得手工删除 ledger、Inbox、receipt 或修改 schema version
  以“修复”启动。
- forward-only migration 不提供原地 downgrade。若必须回退，应把备份恢复到独立数据库，
  校验 catalog 和事实一致性后，再通过单独批准的切换流程处理。
- Cloud restart 验证至少比较同一 Task/Execution/Offer revision 与 fence、Inbox sequence、
  receipt response、idempotency replay 和 external-operation journal。只看 row count 不足以
  证明恢复一致。
- 事务中途失败必须同时看不到 Task/Execution/Offer 变化、Inbox 和 business receipt；
  audit/journal 若按设计在独立拒绝事务记录，不得被误判为业务半提交。

## 6. 安全观测与告警

公共入口必须先执行以下控制：REST JSON body 默认不超过 64 KiB，配置值也不得超过
1 MiB；WSS 只接受不超过 8 KiB 的严格文本 ping，关闭 compression，并拒绝不在
allowlist 中的已提供 browser Origin。所有 write body 的 `idempotencyKey` 必须与
`Idempotency-Key` header 完全一致。`inbox.pull` 的 recipient 类型必须与认证 User/Agent
一致，服务端 page 上限为 200；`inbox.ack` 在一个 Cloud transaction 中校验消息归属、
推进 monotonic cursor 并持久化 receipt，duplicate/stale ACK 只能收敛，不能倒退 cursor。

Endpoint challenge create 使用 PostgreSQL 中按 User、Provider、realm 和五分钟窗口持久化
的计数；同一窗口最多五个不同请求，第六个返回安全 `rate_limited`。幂等 receipt 检查先于
计数，duplicate 不消耗新额度；已返回的一次性 challenge code 或 sealed credential 不得
因重放再次披露，只返回安全 conflict 或非秘密的既有事实。

允许记录的诊断字段限于安全 ID、operation type、revision/epoch、Inbox sequence、
fence reason、journal state、safe failure code、时间和计数。不得记录 request/response
原文、OIDC issuer subject、Token、Authorization、Device/Agent/Provider credential、私钥、
签名、nonce、Provider 原始错误或本地绝对文件内容。

建议告警：

- startup migration route/fingerprint 拒绝或 rollback；
- expiry reconciliation 连续失败；
- Inbox sequence gap、ACK 长期 pending 或同一 message handler 重复失败；
- authority revoke 后仍出现 command/WSS/Runtime/file attempt；
- Coordinator authority epoch 冲突持续增长；
- `outcome_unknown` 长时间未被 observe/link 或 abandon；
- successor output name 与 Task 历史冲突；
- WSS authentication/origin/oversize 拒绝异常增长。

排障时先暂停新业务动作并读取唯一事实，不能通过删除旧 execution、重置 cursor、清空
receipt、伪造 ACK、直接改数据库或盲重试 Provider write 来恢复。若 exact authority、
revision 或外部结果无法确认，保持 fenced / `outcome_unknown`，等待 Owner 与当前
Coordinator 从正式 HCI 和 Cloud Inbox 继续。

## 7. 验收边界

Stage 3 自动化证据应覆盖真实 PostgreSQL migration/rollback/transaction/restart、Cloud
offer/revoke/reassign fence、REST/SDK/WSS security、Desktop Inbox refill/ACK、稳定 Runtime
Session/directive 以及 Provider uncertain recovery。它证明 source production path 的恢复
语义，但不能代替 Stage 4 packaged artifact、六个真实账号/Device/Agent/Provider 和 live
recovery matrix；OpenSpec 8.3、8.4、8.7 在相应证据完成前保持 unchecked。
