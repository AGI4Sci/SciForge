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
- [ ] 3.4 消费 Team 集成提供的 package-owned Project Session projection，并增加标准 composer-context contribution；Worker 复用 existing execution session，Coordinator 使用显式 authority-bound ordinary session。覆盖 Chat-first `unbound session -> canonical project.create success receipt -> durable bind` 与所有 create failure 保持 unbound；每次从 canonical facts 生成有界 scope，验证 transfer/membership/execution fence/identity/session 切换会清除或收缩旧上下文且不绕过 Host agent capability tools。

## 4. 验证与 donor 交付

- [x] 4.1 重新生成标准 domain composition/capability artifacts 并验证 freshness，确认 Host 无 Project/domain ID switch 或手工 central feature map。
- [x] 4.2 运行 Domain SDK、renderer sidebar、Project Coordinator focused tests、typecheck、changed-file lint 与 `git diff --check`，全部通过后记录精确结果。
- [x] 4.3 运行 Repository architecture principles gate，并审计 diff 未触碰 collaboration server/contracts、membership、invitation、provisioning、dispatch、continuation、capability audience/approval 或 Provider 状态机。
- [x] 4.4 提交一个 clean、未 push 的 UI/navigation donor commit，把 commit 与集成注意事项交给 Team 唯一集成任务；Team 快照前不提 PR。

### Donor validation record (2026-08-28)

- Passed: Domain SDK 146/146, Project Coordinator 79/79, focused renderer 16/16, full repository typecheck, capability governance (290 actions), domain composition freshness (27 packages), publishable package/version audit, architecture principles gate, changed-file ESLint, `git diff --check`, and strict OpenSpec validation.
- Full `npm test` reached the root Vitest stage after every publishable domain and internal extension passed. Root Vitest reported 3426/3434 passing; six unrelated 5-second timeout failures passed 48/48 when rerun with one worker. Two host prerequisites remain independently reproducible: the current Node process reports arm64 while the selected Python reports x86_64, and Node 23 experimental SQLite lacks `fts5`. Neither failing file nor runtime prerequisite is changed by this donor.
