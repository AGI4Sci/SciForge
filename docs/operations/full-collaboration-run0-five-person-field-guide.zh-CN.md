# SciForge Run-0 五人现场执行单

日期：2026-08-27

目标是在五个真人、至少三台物理机器或独立 VM 上，使用同一 Fork、同一源码 commit、
五个独立 profile，完成两个时间上重叠的文件闭环、一次拒绝改派，以及一条由 U0 真人
回答的最终决策支路。本执行单不使用 DMG，不要求安装 `opencontent-base.zip`，也不允许
共享 OIDC、Agent、Runtime 或 OpenContent credential。

## 0. 组织者先冻结唯一输入

组织者在群里只发送：

- Fork：`https://github.com/SCU-areszhang/SciForge_Loop.git`
- branch：`codex/full-collaboration-loop-recovery`
- 一个 40 位 lowercase exact commit；
- U0–U4 分工和各自独立 profile 的保存位置；
- 本执行单。

可选的私有 `opencontent-base.zip` 不属于 Run-0 输入。若以后单独验收 Skill，ZIP 和其
SHA-256 通过私有渠道发送，并使用通用 `private-skill:verify/install`；不得把 ZIP 放进 Git。

组织者必须先确认 OpenSpec 7.4 的 A-host candidate cutover 已通过并保留精确 rollback
target。当前 edge 若仍选择旧 stack，状态就是 `NO-GO`，不得让五人用登录重试掩盖部署
门禁。正式切换仍需要该次操作的明确授权。

## 1. 每位参与者从 Fork cold clone

以下命令中的 commit 由组织者替换。需要 Node.js 22.12+ 的 22.x LTS；现场推荐已验证的
22.22.1。不要从 upstream clone，也不要用 `HEAD`、tag 或“最新”代替 exact commit。

```bash
RUN0_COMMIT='<组织者发送的40位commit>'
git clone --branch codex/full-collaboration-loop-recovery --single-branch \
  https://github.com/SCU-areszhang/SciForge_Loop.git SciForge-Run0
cd SciForge-Run0
test "$(git rev-parse HEAD)" = "${RUN0_COMMIT}"
npm ci
npm run build
npm run run0:participant:check -- \
  --expected-commit "${RUN0_COMMIT}" \
  --role U0
```

每个人把最后的 `U0` 改成自己的 U0–U4。前检只有输出
`"status": "ready_for_human_login"` 才能继续。它会核对：

- 当前 clean branch 与 Fork origin 的远端 HEAD 都等于 exact commit；
- source `out/` 已构建；
- OpenContent Provider endpoint 是公开、package-owned、随 clone 到达的配置；
- 旧私有 Provider sidecar 不存在，且 Skill 不属于 Provider 前置条件；
- Cloud health/ready 与未登录 `/v1/me` 实时可达，并且无凭据的
  `worker.availability.list` 严格探针返回 `authentication_required`，证明公网已选择新
  collaboration candidate 而不是旧 schema；
- OIDC discovery 和 OpenContent HTTPS endpoint 实时可达。

任何一项失败，记录原始错误并停线；不得临时改 origin、关闭 TLS、复制他人 profile 或
安装私有 Provider 包绕过。

## 2. 用五个独立 user-data 启动 source app

每个 profile 必须位于 Git checkout 之外。示例路径仅供当前参与者自己替换：

```bash
RUN0_PROFILE_DIR='/Users/<本机用户名>/SciForge-Run0-Profiles/U0'
npm run run0:participant:launch -- \
  --expected-commit "${RUN0_COMMIT}" \
  --role U0 \
  --profile-dir "${RUN0_PROFILE_DIR}"
```

同一机器若承载两个角色，必须使用两个 checkout、两个绝对 profile 路径和相互独立的 OS
secret store；整个矩阵仍须至少三台物理机或独立 VM。普通的两个进程窗口不算两台设备。

## 3. 五人逐项点亮，不可代填

U0 先完成一次 pilot，确认新 stack 后再让 U1–U4 登录。每位真人只在自己的 Desktop：

1. 通过 system browser 登录/注册自己的 OIDC User；
2. 确认自己的 Device 为 `ACTIVE`；
3. 配置并实测自己的 Runtime/model；
4. 注册自己的 Agent，并看到 collaboration connected/online；
5. 在 Content Space 中选择公开的 OpenContent Provider，绑定自己的 OpenContent account；
6. 用自己的 Provider ACL 完成一次真实个人库或 Team 读取。

U0 pilot 还必须创建或打开一个由自己的精确 Agent 担任 Coordinator 的 Project。在
Project Coordinator 的 Worker 区确认显示“在线成员 1 / 1”和“在线 Agent 1 / 1”；同一
User 以后增加第二台在线 Device 时，成员数仍只增加一次而 Agent 数按真实 Agent 增加。
这两个数字必须来自当前 Cloud availability，不能用本机进程数或口头确认替代。

五个人都完成后，组织者记录脱敏 User/Device/Agent/Runtime/Provider readiness。任何人的
credential、Authorization header、完整账号标识或 profile 目录内容都不得进入群消息或回执。

## 4. 固定现场路径

U0 创建“多用户协作设计评审会”，provision 一个真实 OpenContent shared container，添加
exact Provider members，并确认计划。三个文件 Task 同时派发：

- P1：U1 manual 接受 `architecture-review.md`；至少经历一次 request-revision 后接受；
- P2：U2 automatic 接受 `meeting-minutes.md`；与 P1 的 execution 时间区间必须重叠；
- R：U3 明确拒绝 `risk-register.md`，U0 选择 U4 的精确 Agent，U4 通过新 execution 完成；
- H：三个结果复审通过后，Coordinator 只创建一次 `coordinator_project` HumanNeeded，
  由 U0 真人回答，Coordinator 写 decision/summary 并完成 Project。

P1 和 P2 各自必须留下真实 download → 本机 Runtime → OpenContent upload-new → review 的
闭环证据。R 必须证明旧 execution 被 fence。H 是本 happy path 唯一真人决策支路；不要在
U2 worker execution 中再造第二个 HumanNeeded。

## 5. Go/No-Go 看板

| Gate | GO 条件 | 未满足时 |
| --- | --- | --- |
| G0 Edge | 7.4 candidate/cutover 已通过，rollback target 保留 | `NO-GO / awaiting_candidate` |
| G1 Source | 五人 exact commit、Fork origin、clean、build/preflight 全通过 | `NO-GO` |
| G2 Identity | 五个真人 User、五个 ACTIVE Device、五个独立 Agent | `awaiting_real_devices` |
| G3 Runtime | 五个本机真实 Runtime/model ready | `incomplete` |
| G4 Collaboration | 五个 Agent online，U0 能看到按 User 去重的在线成员数与精确 Agent 数 | `failed` |
| G5 Content | 无 Skill 时五个 OpenContent binding/ACL 可用 | `failed` |
| G6 Happy path | P1、P2、R、H 全部有脱敏 timeline | `incomplete` |

现场先完成 happy path，再按主 Run-0 手册执行 R1–R10。任何未执行恢复项必须记
`not_run`/`blocked`，不得用单元测试替代。最后由授权 Desktop 重新下载并人工检查三个
文件；不要把实际会议秘密、prompt、credential 或可重放授权写入回执。
