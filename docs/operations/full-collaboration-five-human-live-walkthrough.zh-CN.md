# SciForge 五真人现场闭环逐步操作手册

日期：2026-08-27

适用范围：OpenSpec `add-full-multi-user-collaboration-loop` 的 8.6–8.8 真人验收

基础环境：个人 Fork、source app、现有 `cloud-test` / `login-test`、五个真人与至少六个独立 Device profile

## 先读结论

明天不需要安装任何外部 Codex Plugin，也不需要安装 `opencontent-base.zip`。现场源码仍组合
四个独立 domain package，但用户只需要理解两个一级入口：

| Domain package / 一级入口 | 界面位置 | 用途 | 谁操作 |
| --- | --- | --- | --- |
| Identity / `Identity`（人形图标） | 顶部工具栏 | 本地账户、OIDC 登录、注册当前 Desktop | U0–U4 |
| Project Coordinator / `协同中心`（流程图标） | `概览`、`项目`、`复审` | 创建 Project、查看在线人数、生成/确认 Plan、复审、HumanNeeded、完成 Project | 主要由 U0 |
| Collaboration / `协同中心` | `我的任务`；右上角设置中的 `连接与设置` | 连接 Cloud、自动确保当前 Device Agent、设置接单策略、认领或本机忽略 Task | U0–U4 |
| Content Space / `协同中心` | `文件` | 选择 OpenContent、连接个人账号、浏览/下载/上传 | U0–U4 |

三个协作 domain package 只合并用户界面，包边界、Capability Broker、Cloud 投递、恢复状态机
和 Content Space 资源权限路径保持独立。`Artifact History` 不属于本手册的操作顺序。

设置 AgentRuntime 时另用左下角或应用菜单中的 `Settings`：

- `Settings → Agents`：选择 Codex 或 Claude Code，并使用本机真实 executable；
- `Settings → Model Router`：完成当前 profile 自己的模型登录与可用性检查。

OpenSpec 7.4 的公网 candidate 已经通过。当前代码也已经支持五人 OIDC、Device、Agent、
Cloud 在线状态、OpenContent 个人连接、Worker 手动/自动接单、结果复审、返修改派、
Coordinator HumanNeeded 和 Project completion。

当前冻结语义是 Project 级角色：创建者当前 Device 的 canonical Agent 自动成为该 Project
Coordinator；Worker 列表只显示 Cloud User。Task Offer 广播给该 User 的所有合格 Device Agent，
首个 claim 才创建 Execution。任何一个 Device 的本地忽略都不代表该 User 全局拒绝。

## 1. 推荐的真实协作例子

使用仓库已有的纯合成项目：**“多用户协作设计评审会”**。

会议目标是在 60 分钟内，由五个真人完成；其中 U3 使用两个独立 Device 验证 User 广播：

- U1 产出 `architecture-review.md`；
- U2 产出 `meeting-minutes.md`；
- U3 的 Device A 与 Device B 收到同一 `risk-register.md` Offer；A 本机忽略，B claim 并完成；
- U0 另行验证 withdraw 后向 U4 Worker User reassign，新 Offer 仍不预选 Agent；
- `architecture-review.md` 与 `meeting-minutes.md` 必须在时间上真实并行；
- U0 至少直接接受一个结果，对另一个结果要求一次返修；
- 三个当前结果都接受后，U0 发起一次 Project 级真人决策，亲自回答并完成 Project。

输入文件已经在仓库中，且不包含真实组织信息或凭据：

- `test-fixtures/collaboration/run0-meeting/agenda.md`
- `test-fixtures/collaboration/run0-meeting/requirements.md`
- `test-fixtures/collaboration/run0-meeting/risk-constraints.md`

### 五人角色

| 角色 | 真人职责 | Agent 接单策略 | 主任务 |
| --- | --- | --- | --- |
| U0 | Owner + Coordinator | `Manual acceptance` 即可 | 建 Project、确认 Plan、复审、提问、完成 |
| U1 | 架构评审 Worker | `Manual acceptance` | 手动接受并完成架构评审 |
| U2 | 会议纪要 Worker | `Automatic acceptance` | 自动接单并与 U1 并行执行 |
| U3 | 风险任务 Worker User（两台 Device） | `Manual acceptance` | Device A 本机忽略；Device B claim 并完成风险登记表 |
| U4 | 替代 Worker User | `Manual acceptance` | 验证 withdraw/reassign 后的新 User Offer |

## 2. 今晚由组织者准备

### 2.1 冻结唯一源码输入

在所有代码修复结束后，组织者只在群里发以下四项：

```text
Fork: https://github.com/SCU-areszhang/SciForge_Loop.git
Branch: codex/full-collaboration-loop-recovery
Commit: <最终40位lowercase commit>
Role: U0 / U1 / U2 / U3 / U4
```

不要发送 `HEAD`、“最新版”或 upstream 地址。五人必须使用同一个 exact commit。

完整 cold-clone、Node 版本、native addon、source build、独立 profile 和 Runtime gate 命令，
统一按 [Run-0 五人现场执行单](./full-collaboration-run0-five-person-field-guide.zh-CN.md)
第 0–3 节执行。本手册不另造第二套启动命令。

### 2.2 物理拓扑

- U0–U4 一人一台 Mac，或一人一个相互独立 VM；
- 禁止同一台 Mac 用两个 profile 冒充两台设备；
- 每个 profile 位于 Git checkout 外；
- 五人分别完成自己的 Runtime/model 登录，禁止复制别人的 profile、Keychain 或 Codex 登录目录。

### 2.3 建立现场记录表

只在团队私有记录表中收集以下非秘密字段：

| 角色 | User ID | Device 状态 | Agent ID | Runtime | 接单策略 | OpenContent |
| --- | --- | --- | --- | --- | --- | --- |
| U0 | `usr_…` | connected | `agt_…` | Codex/Claude | manual | connected |
| U1 | `usr_…` | connected | `agt_…` | Codex/Claude | manual | connected |
| U2 | `usr_…` | connected | `agt_…` | Codex/Claude | automatic | connected |
| U3-A | `usr_…` | connected | `agt_…` | Codex/Claude | manual | connected |
| U3-B | 与 U3-A 相同 | connected | 另一 `agt_…` | Codex/Claude | manual | connected |
| U4 | `usr_…` | connected | `agt_…` | Codex/Claude | manual | connected |

最终公开回执再对 ID 做稳定脱敏。表里不得记录密码、Token、Authorization header、私钥、
OpenContent credential、Codex credential 或完整 profile 内容。

## 3. 五个人逐台上线

以下步骤每个人都要自己点，不能由 U0 代做。

### 3.1 Identity：登录 Cloud 并注册 Desktop

1. 启动自己的 source app，先打开或创建一个普通 Workspace/Session，使顶部工具栏可用。
2. 点击顶部人形图标 `Identity`。
3. 若没有本地账户，填写显示名称并点击 `创建账户`；已有则选择自己的本地账户。
4. 在 `SciForge 云端` 区点击 `使用浏览器登录`。
5. 只在系统浏览器的 `login-test.sciforge.cn/realms/SciForge` 页面登录或注册。
6. 回到 SciForge；若显示 `此 Desktop 尚未连接`，点击 `注册这台 Desktop`。
7. 等待界面显示 `此 Desktop 已连接`。

通过标准：U0–U4 使用五个 OIDC User；U3-A/U3-B 是同一 U3 User 的两个不同 ACTIVE Device。不要截图密码、
浏览器授权码或 Token。

### 3.2 Settings：确认真实 Runtime

1. 打开 `Settings → Agents`。
2. 选择本机实际使用的 Codex 或 Claude Code；优先填写绝对 executable path。
3. 打开 `Settings → Model Router`，完成当前 profile 自己的模型登录。
4. 确认页面显示本地服务运行、credential/sign-in 已确认、wire protocol 已选择、trace ready。
5. 完全退出应用，按基础执行单运行 `run0:participant:runtime-check`。
6. 只有回执为 `agent_runtime_ready` 才重新正式启动。

### 3.3 Collaboration：连接 Cloud 并自动确保当前 Device Agent

1. 点击顶部流程图标 `协同中心`，再点击右上角设置，打开 `连接与设置`。
2. 在 `云端连接` 中确认地址精确为：

   ```text
   https://cloud-test.sciforge.cn
   ```

3. 首次配置点击 `保存并连接`；已保存但断开时点击 `连接` 或 `重新连接`。
4. 等待状态显示 `已连接`，并记录当前 `Inbox #`，它不应反复归零。
5. 不需要手机控制时，**不要点击 `开始手机配对`**；手机 endpoint 不是 Project/Agent 前置条件。
6. 在 `Agent 显示名称` 输入 `Run0-U0`、`Run0-U1`……对应名称。
7. 点击 `注册这台 SciForge`。
8. 等待 Agent 卡片显示 `在线`，复制卡片中的 `agt_…`；Participant 顶部复制自己的 `usr_…`。
9. 在 Agent 卡片的 `Worker 接单策略` 下拉框选择本角色策略：
   - U1、U3、U4：`手动接单`；
   - U2：`自动接单`；
   - U0：保留 `手动接单` 即可。
10. 每个人把自己的 User ID、Agent ID 和接单策略发给 U0，禁止发送 credential。

通过标准：五个不同 User、五个不同 Desktop、五个不同 Agent，且五个 `连接与设置` 面板都显示
Cloud connected、Agent online。

### 3.4 Content Space：无 Skill 连接 OpenContent

1. 点击顶部流程图标 `协同中心`，再打开 `文件`。
2. 在 `Content source` 下拉框选择 `OpenContent` 对应的公开 source。
3. 若显示 `Connect OpenContent`，点击 `Connect account`。
4. 只在操作系统私有凭据提示框中输入自己的 OpenContent 账号；SciForge 窗口中不填写凭据。
5. 等待显示 `Account connected` 和 `Connected on this device.`。
6. 在 `Libraries` 中打开一个自己有权读取的 Personal 或 Shared library。
7. 打开任意非敏感测试文件；若要验证下载，选中文件后点击 `Download`，选择本机测试目录。
8. 若有写权限，可点击 `Upload new` 上传一个带角色和时间戳的全新小文件；禁止覆盖已有文件。

通过标准：五人都能以自己的 Provider ACL 列出至少一个真实 library；无权限时必须明确拒绝，
不能退回 Mock。这个步骤**不安装** `opencontent-base.zip`。

## 4. 第一阶段：五人 Cloud 在线人数验收

这是明天在当前版本上必须先完成、且不依赖三文件入口的独立闭环。

1. U0 保持自己的 Stage4 U0 profile 和 Agent 在线。
2. U1–U4 完成第 3 节并把 `usr_…` 发给 U0。
3. U0 点击顶部流程图标 `协同中心`，打开 `概览`。
4. 若界面已有 `Stage4 U0 Coordinator Count Acceptance`，在 Project 下拉框选中它。
5. 展开 `内容供应 → Project 成员与 Task Authority`。
6. 在 `添加精确成员` 中依次输入 U1、U2、U3、U4 的 User ID，每次点击一次 `添加精确成员`，
   每次完成后等待 Project revision 刷新再加下一人。
7. 回到 `Worker 选择`，点击右上角 `刷新协调状态`。
8. 等待并核对：
   - `在线成员 5 / 5`；
   - `5/5 在线` Agent；
   - 每个 Agent 的 Runtime 为 `就绪`；
   - 每个 Agent 的接单为 `开放`；
   - U2 显示为自动接单，其余按角色矩阵。

若同一个 User 有两台在线 Device，成员数仍按 User 去重，Agent 数按真实 Agent 数统计。

证据：U0 保存一张完整 `Worker 选择` 截图；U1–U4 各保存一张 `连接与设置` 中 Cloud connected、
Agent online 的截图。该阶段通过只证明五人 Cloud 协作基础，不等于 OpenSpec 8.6 三文件闭环通过。

## 5. 第二阶段：完整 Project 闭环的目标按钮路径

本节是三个产品入口关闭后的正式路径。任何按钮不存在、禁用或行为与下述不一致时，立即停在
对应 Gate，不使用数据库、SSH 或测试脚本代点。

### 5.1 U0 创建 Project

1. U0 打开 `协同中心 → 项目`。
2. 点击 `新建项目`，展开 `创建 Project`。
3. 填写：
   - `Project 名称`：`多用户协作设计评审会`；
   - `Project 目标`：复制下方目标文本；
   - `Coordinator`：由系统采用当前 U0 Device 的 canonical Agent，只绑定本 Project；
   - `Worker User`：加入 U1–U4 的四个 exact User。

建议目标文本：

```text
在 60 分钟内完成 SciForge 多用户协作设计评审。必须生成三个可分别复审的任务：
1) 架构评审，产出 architecture-review.md；
2) 会议纪要，产出 meeting-minutes.md；
3) 风险登记，产出 risk-register.md。
架构评审与会议纪要必须并行。风险任务广播给 U3 的两台 Device；一台本机忽略，另一台 claim 并完成。
所有结果由 Coordinator 复审；至少一次 request revision；三个当前结果接受后询问 Project Owner
是否批准“保持 Project 级单 Coordinator、Worker User 广播与首 Device claim、运行时重新核验 Provider ACL”的最终方案，
收到真人回答后才完成 Project。
```

4. 选择 `Content required` 或等价文件 Project 模式，并选择三个输入 fixture 的 Content Space
   references；若界面要求手填 Agent revision、且不能选择内容模式/输入文件，记录
   `blocked: project_creation_hci` 并停止。
5. 点击 `创建 Project`。
6. 新 Project 必须自动聚焦，初始状态应为 paused/provisioning，而不是伪装 completed。

### 5.2 U0 执行 OpenContent provisioning

1. 在 `内容供应` 中点击 `预览内容供应计划`。
2. 检查完整计划只包含：创建一个 shared container、加入 U0–U4 五个 exact Provider principal、
   重新读取成员、绑定 Project root。
3. 核对 `已确认计划摘要` 后点击 `确认并执行内容供应`。
4. 等待五个成员均显示 active/bound/ready。
5. 任一成员 OpenContent ACL 不满足时，先由该成员在自己的 `协同中心 → 文件` 修复连接，再点
   `预览安全对账`；不得把 metadata 可见当成下载授权。

### 5.3 U0 生成、编辑并确认 Plan

1. 在 `Project Plan` 点击 `生成 Plan 草稿`。
2. 必须出现三张 Task 草稿卡；若数量不是三且界面不能增删，记录
   `blocked: plan_task_editor`，不得把一个 Task 当作三个。
3. 按下面内容编辑三张卡：

| Task | Worker User | 完成标准 |
| --- | --- | --- |
| 架构评审 | U1 | 引用三个合成输入；给出至少 3 条结论；输出新 `architecture-review.md` |
| 会议纪要 | U2 | 包含议题、结论、Owner 待决策项；输出新 `meeting-minutes.md` |
| 风险登记 | U3 | 至少 3 个风险、触发条件、Owner、恢复动作；输出新 `risk-register.md` |

4. `所需能力标签` 只能填写该 Worker User 至少一个在线 Runtime 真实具备的标签子集；
   不要凭空填写能力。
5. 点击 `保存 Plan 编辑`。
6. 复核每张卡的 Worker User 后，点击 `提交不可变 Plan`。
7. 在默认可见的确认卡中点击 `确认 Plan 并激活 Project`。
8. U0 记下三项 Task 的投递时间；U1/U2 必须在同一时间窗口进入执行。

### 5.4 U1 与 U2 完成两个真实并行闭环

U1：

1. 打开 `协同中心 → 我的任务 → Project 与 Task`。
2. 找到“架构评审”，核对 Worker User 是自己；界面不应提供 Agent 选择。
3. 点击 `由本设备领取`。
4. 观察状态依次进入 accepted/in progress/awaiting review；不要另开测试 driver。

U2：

1. 保持 `自动接单`，打开 `协同中心 → 我的任务 → Project 与 Task`。
2. 找到“会议纪要”；正常情况下不会出现必须手点的接受按钮。
3. 观察本地 preflight 后自动进入执行；若 Provider/Runtime 不 ready，应 fail closed 并显示原因。

两人都必须经过真实 `download → 本机 Runtime → upload-new → awaiting review`。输出文件名必须是
新文件，禁止覆盖输入。两项 execution 的 `in progress` 时间区间至少重叠一次；U0 截图 Task
队列中同时有两个 active Task。

### 5.5 U3 多 Device 广播与首个 claim

1. U3 在 Device A 与 Device B 打开 `协同中心 → 我的任务 → Project 与 Task`，两边都应看到同一 `taskOfferId`。
2. Device A 点击 `仅在本设备忽略`；确认 Cloud Task/Offer 未变，Device B 仍可操作。
3. Device B 点击 `由本设备领取`。
4. Cloud 必须只创建一个 Execution，并绑定 U3 User、Device B 及其 canonical Agent；Device A 收到 claimed 终态。
5. Device B 完成真实 `download → Runtime → upload-new`；任何第二次 claim 都必须失败且不能创建第二个 Execution。
6. 另建一个未认领测试 Offer：U0 withdraw 后选择 U4 Worker User reassign，确认新 Offer 仍没有 Execution，直到 U4 某台 Device claim。

### 5.6 U0 复审并制造一次真实返修

1. U0 打开 `协同中心 → 复审 → 结果复审`。
2. 对第一份合格结果点击 `在 Content Space 中打开产物`，人工查看后点击 `接受结果`。
3. 对另一份结果填写明确的 `返修说明`，例如：

   ```text
   请补充每项结论对应的验证证据，并把最终建议整理为三条可执行动作。
   ```

4. 在 `下一位 Worker User` 选择负责返修的 User。
5. `新 Offer 到期时间` 填未来时间。macOS 可在 Terminal 生成：

   ```bash
   date -u -v+30M '+%Y-%m-%dT%H:%M:%S.000Z'
   ```

6. 文件 Task 必须填写不同的 `新的不可覆盖输出文件名`，例如
   `architecture-review-rev2.md`。
7. 点击 `请求返修`。
8. Worker 接受新 execution，真实重新执行并上传新文件；U0 再次打开产物并点击 `接受结果`。
9. U0 对其余当前结果逐一人工查看并接受。

### 5.7 U0 完成真人决策支路

只有三个当前结果均已接受后，`结果复审` 中才应出现 `询问 Owner`。

1. U0 在 `向 Project Owner 提问` 填写：

   ```text
   基于三份已接受结果，请在 A/B 中做最终选择并说明一条理由：
   A. 批准保持 Project 级单 Coordinator、Worker User 广播/claim 及运行时 Provider ACL 重验；
   B. 暂缓，并指出必须先关闭的一个风险。
   ```

2. `回答到期时间` 填未来 30 分钟的 RFC3339 时间。
3. 点击 `询问 Owner`。
4. 同一个 U0 Human 在出现的 `Owner 回答` 中亲自输入选择和理由。
5. 点击 `提交 Owner 回答`；若界面显示确认型动作，则按真实决定点击 `批准` 或 `拒绝`。
6. 确认 Project Record 中出现一条 decision，且不是 Agent 自己伪造 HumanAnswer。
7. 在 `Project 最终总结` 输入简短结论，点击 `完成 Project`。
8. 等待状态为 completed；随后 Cloud 应拒绝继续写业务 Task，但 OpenContent 文件仍存在。

## 6. 明天的执行顺序

建议预留 90 分钟：

| 时间 | 操作 | 通过条件 |
| --- | --- | --- |
| 00:00–00:20 | 五人 cold clone、build、runtime-check | 五份 `agent_runtime_ready` |
| 00:20–00:35 | Identity、协同中心连接设置、Agent | 5 User / 5 Device / 5 Agent online |
| 00:35–00:45 | 协同中心文件连接 | 五人各自 Account connected |
| 00:45–00:55 | U0 在线人数 Gate | `5/5 members`、`5/5 Agents` |
| 00:55–01:05 | Project/provisioning/Plan | 三 Task 已投递 |
| 01:05–01:25 | U1/U2 并行、U3-A 本机忽略、U3-B claim | 两并行闭环 + 单一获胜 execution |
| 01:25–01:40 | U0 复审/返修 | 三个当前结果 accepted |
| 01:40–01:50 | HumanNeeded/完成 | decision + completed |
| 01:50–02:00 | 脱敏证据与结论 | receipt 无秘密且状态准确 |

## 7. 每个人要保存的证据

不要只拍最终 completed；闭环必须能看出因果顺序。

| 角色 | 最少证据 |
| --- | --- |
| U0 | Identity connected；5/5 在线人数；Plan confirmed；双 Task 同时 active；一次 request revision；HumanNeeded answer；Project completed |
| U1 | manual 策略；Accept Task；Runtime 执行；提交 awaiting review |
| U2 | automatic 策略；自动进入执行；提交 awaiting review |
| U3 | Reject Task；旧 execution ID；旧 execution fenced |
| U3 | 两 Device 同一 offer；A 本机忽略；B 唯一 claim；风险结果 awaiting review |

推荐文件名：

```text
U0-01-five-online.png
U0-02-plan-confirmed.png
U0-03-two-tasks-active.png
U0-04-review-revision.png
U0-05-human-answer.png
U0-06-project-completed.png
U1-01-manual-accept.png
U2-01-automatic-running.png
U3-01-rejected.png
U3-01-multi-device-claim.png
```

截图保留在验收 evidence 目录，不提交账号、邮件、credential、Token、Keychain 提示或真实敏感
内容到 Git。最终回执按主验收文档的 schema 生成。

## 8. GO / NO-GO 判定

| Gate | GO | NO-GO / 记录方式 |
| --- | --- | --- |
| G0 Public | health/ready 正常，OIDC issuer 不变 | `awaiting_candidate` |
| G1 Source | 五人同 Fork/branch/exact commit，clean source build | `failed` |
| G2 Runtime | 五份 `agent_runtime_ready` | `awaiting_real_devices` 或 `failed` |
| G3 Identity | 5 User / 5 ACTIVE Device / 5 Agent | `failed` |
| G4 Cloud | 五人 connected，U0 看见 5/5 + 5/5 | `failed` |
| G5 Provider | 无 Skill 时五个 OpenContent account 可用 | `failed` |
| G6 Project entry | U0 可从 UI 选择当前 Coordinator 及内容输入 | `blocked: project_creation_hci` |
| G7 File plan | 三个 file Task 可编辑、精确指派并确认 | `blocked: plan_task_editor` |
| G8 Parallel | U1/U2 execution 时间真实重叠 | `incomplete` |
| G9 User Offer/claim | U3-A 本机忽略不改 Cloud；U3-B 是唯一 claim winner | `blocked: user_offer_claim_hci` |
| G10 Review | 至少一次 accept、一次 request revision | `incomplete` |
| G11 Human | U0 真人回答唯一 Project HumanNeeded | `incomplete` |
| G12 Complete | 三个当前结果 accepted，Project completed | `incomplete` |

最终结论规则：

- G0–G5 全通过：可以写“五真人 Cloud + Content Space 基线通过”；
- G6–G12 也全部通过：才可以勾选 OpenSpec 8.6；
- 任何恢复矩阵尚未执行：8.7 保持 unchecked；
- 最终产物未由授权 Desktop 重新下载并人工核对：8.8 保持 unchecked；
- 不因 8.4 正式安装包暂缓而阻塞 source-app 真人闭环，但不得声称 release artifact 已验证。

## 9. 现场故障处理原则

1. 先截图并记下角色、时间、界面、Project/Task/execution 的脱敏引用。
2. 点击当前模块的 `刷新` 一次；不要连续盲点 mutation 按钮。
3. Collaboration 断线时先在 `协同中心 → 连接与设置` 使用 `重新连接`，再观察 Inbox sequence 是否续接。
4. Runtime 不 ready 时只在该人的 `Settings` 修复；禁止复制另一人的 credential/profile。
5. OpenContent unauthorized 时由该 Human 在自己的 `协同中心 → 文件` 修复；禁止 U0 分享 Provider 凭据。
6. 任何 old execution、Device revoke、Provider removal 或 outcome_unknown 都必须 fail closed。
7. 发现本手册列出的 UI 入口缺失时，状态记 `blocked`，不要通过服务器直接写数据绕过 Human 路径。

主验收合同和恢复矩阵详见
[Run-0 真实多用户会议闭环验收](./full-collaboration-run0-acceptance.md)。
