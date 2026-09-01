## 1. 通用 renderer 导航合同

- [x] 1.1 在 Domain SDK 增加严格版本化的 `workbench.navigation-section` contract、render context/value guard，以及现有普通 Sessions 的有界 presentation catalog/canonical selection action；用正反合同测试验证无 domain 字段或并行 Session 实现。
- [x] 1.2 增加 renderer-owned navigation section registry/slot，验证稳定顺序、重复 ID、invalid value、dispose/rollback，且不改变其他 `renderer.extension` 消费路径。

## 2. Host 侧栏组合

- [x] 2.1 让 Workbench/Sidebar 从已安装 registry 通用渲染 navigation sections，并验证 active Thread 与无 Thread 的 draft session 都能作为 presentation owner、section 只能通过 canonical callback 选择现有 Session。
- [x] 2.2 将现有用户可见 “Projects” 文案改为 “Local Workspaces”，以 renderer/Sidebar 测试证明 Workspace/Thread 搜索、归档、创建与选择行为未变。

## 3. Project Coordinator 侧栏体验

- [x] 3.1 在 Project Coordinator manifest/definition/renderer entry 增加 package-owned navigation contribution，更新同包版本与依赖冻结测试，并验证标准生成组合可发现/移除它。
- [x] 3.2 实现 Cloud Projects section 的 canonical workspace read、身份清除、loading/empty/error/offline、可见性/有界刷新、创建后 invalidation 与 Project 状态轨道，并用 component tests 覆盖 stale-read 抑制和不乐观合成 Project。
- [x] 3.3 实现 Project row、绑定的普通 Session aliases 与 Tasks/Files/Decisions/Activity-Recovery 子入口，扩展严格的 package-owned activation intent；验证 Session alias 委托现有选择、New Project 只打开既有创建 HCI、无 Thread 时使用 draft session、缺失可选 Files view 时回退 overview。
- [x] 3.4 消费 Team 集成提供的 package-owned Project Session projection，并增加标准 composer-context contribution；Worker 复用 existing execution session，Coordinator 使用显式 authority-bound ordinary session。覆盖 Chat-first `unbound session -> canonical project.create success receipt -> durable bind` 与所有 create failure 保持 unbound；每次从 canonical facts 生成有界 scope，验证 transfer/membership/execution fence/identity/session 切换会清除或收缩旧上下文且不绕过 Host agent capability tools。

## 4. 最终 Team 集成验证

- [x] 4.1 重新生成标准 domain composition/capability artifacts 并验证 freshness，确认 Host 无 Project/domain ID switch 或手工 central feature map。
- [x] 4.2 运行 Domain SDK、Collaboration、Project Coordinator、renderer、Host Broker 与 exact Worker consumer 的 focused/full tests、typecheck、changed-file lint 和 `git diff --check`，记录本次最终代码的精确结果。
- [x] 4.3 运行 publishable version audit、Repository architecture principles gate 与 strict OpenSpec validation；审计 collaboration contracts/server/provider、membership/invitation/provisioning/dispatch/continuation、Agent capability audience/approval 与 Session projection 均只有最终 canonical path。
- [x] 4.4 提交 clean、未部署且未删除 Cloud 数据的 Team 集成 commits，并记录最终 commit、剩余外部多设备验收条件及任何独立宿主 prerequisite。

### Final integration validation record (2026-08-28)

- Canonical path coverage: `project.create` durable intent and receipt-gated ordinary Session binding; draft/paused/active Plan readiness; Cloud-authoritative Worker User assignments; invitation, Project Team-root provisioning and readiness; User-targeted Offer and Device Agent claim; current-revision file binding; Runtime/Content Space execution; Result/review/ProjectRecord/final completion; and the single Cloud-facts continuation/recovery path. The ordinary sidebar Session and Agent capability broker use the same package handlers as the UI and introduce no Project-specific chat or second state machine.
- Focused/full packages: Domain SDK 147/147, Collaboration domain 111/111, Collaboration contracts 116/116, Collaboration server 163 passed with 10 explicitly skipped integration cases, Project Coordinator 110/110, Zulip Provider 39/39, and isolated Host Broker/runtime boundary 17/17. The source full-path tracer passes both canonical scenarios, including logical file declaration resolved to the attested binding at Offer time and same-profile restart/reconnect reconciliation without a duplicate Offer.
- Repository gates: full typecheck passed across 27 packages plus Web/Node; generated composition is fresh for 27 packages; capability governance passed for 292 registered actions; publishable version audit found no issue in 10 changed publishable packages; ESLint passed for all 110 changed JavaScript/TypeScript files; `git diff --check` passed.
- Architecture/OpenSpec: architecture-principles tests passed 27/27 plus private-package tests 3/3, and the 613-path changed-production audit reported zero findings. Strict validation passed for both `add-agentic-project-workspace-sidebar` and `add-full-multi-user-collaboration-loop`.
- Root regression: every workspace/package stage passed. Root Vitest passed 371/373 files and 3444/3446 tests; the only two failures are independent host prerequisites: the selected packaged Python reports `x86_64` while Node runs `arm64`, and this Node build's experimental SQLite lacks `fts5`. An earlier Remote SSH temporary-directory cleanup race passed on isolated rerun (138/138) and also passed in the final root run.
- This snapshot has not been deployed and no Cloud data was deleted. The exact clean candidate SHA is reported from Git at handoff rather than embedded self-referentially here. Remaining external acceptance requires four real OIDC Users, their Desktop/Device Agents and Provider Connections, a project-scoped Team-root, and an exact compatible Cloud/Desktop revision. Windows, cross-Coordinator-device transfer, dynamic membership/removeMember, timeout/reoffer and phone IM remain explicitly outside this completion record; no synthetic test is represented as that live evidence.
