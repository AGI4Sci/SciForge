# SciForge 任务板

更新时间：2026-07-07

## 当前状态

本阶段按既定原则完成实现收口；剩余事项均需要人类先做产品 / 安全策略决策，决策前不实现。

---

## 不可变原则

- 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- 所有修改必须通用，不能为特色例子写硬编码补丁。
- LLM API 只能走 Model Router。
- 所有 text / vision / scientific / image / speech / workflow / schedule 模型调用严格 Model Router-only；Codex / Claude / local runtime 只能作为执行 runtime，不持有上游模型旁路。
- 相同功能的工作链路需要统一，不要额外生出旁路；删除冗余，代码尽可能精简。
- GUI 只是方便用户交互的壳子；新增 GUI 前必须先问：这一步是否真的需要人类交互？
- GUI 面板只允许承载检查、审批、标注、比较、选择等人类判断；纯执行能力下沉到 agent runtime / worker / workflow。
- `localhost:5173` Web 预览是一等支持面，必须有稳定 bridge、能力差异提示和白屏恢复路径。

---

## 收口规则

- 不再主动发散发现新大任务；新增任务必须明确指向原则冲突、冗余链路、性能证据或人工新决策。
- 已完成的任务在本文件中标记为 `[x]`，不要删除。
- 需要人工决策的点只记录，不实现。
- 性能相关改动先量化再实现；新增 guard / 边界检查必须说明 runtime cost。

---

## 需要人工决策后再实现

- [ ] 【Evidence DAG 高影响 gate / Remote Executor】决定哪些远程动作必须 gate：仅 `remote_submit_job`，还是同时覆盖 `remote_run`、`remote_deploy_worker`、`remote_write`、`remote_cancel_job`、协议执行和外部提交；同时决定 audit pass 定义、stale audit 策略、override token 是否签名 / 过期、以及 `approvalBypass` 是否允许绕过该 gate。
- [ ] 【Evidence DAG 高影响 gate / Project DAG promotion】决定候选结论推广 gate 的粒度：candidate-level 还是 thread-level；决定 missing / stale audit digest 策略、`conflicting` claim 是否可推广、override 字段 / 权限 / 过期时间、以及导出语义。
- [ ] 【团队治理 v1】决定 decision record 数据模型、触发条件、ledger / storage 位置、移动 / IM 可见范围，以及移动 / IM 是否能直接 approve / reject 桌面审批；决策后再实现“决策记录 + 单人审批 + 移动 / IM 监督闭环”，暂不做重型多人角色系统。

## 任务清单

- [x] 【严格 Model Router-only 收口】text / vision / scientific / image / speech / workflow / schedule 模型调用经 Model Router；Codex / Claude / local runtime 仅作为执行 runtime，不持有上游模型旁路。
- [x] 【运行时入口表达收口】主输入框保留执行 runtime 选择，但明确模型链路由 Model Router 管理，避免把 `codex` / `local` / `claude` 表达成三套上游模型配置。
- [x] 【Web 预览一等支持】稳定 `localhost:5173` Web 预览和 dev bridge；能力缺失有可见状态，设置页 / 运行时切换不白屏，5173 默认预览和恢复路径有测试覆盖。
- [x] 【科学模态风险分级】高风险科学对象执行 translate-then-reason 且 translator 未配置 / 失败时 fail closed；低风险文本化回退带显式风险标记。
- [x] 【Evidence DAG 高影响 gate / 报告导出】报告导出接入 Evidence DAG audit risk digest；blocker 阻断，major / stale / missing 需要人工 override，minor / info advisory。
- [x] 【Schedule 编译到 Workflow】保留轻量 Schedule UI，底层统一编译为 Workflow trigger / run mode，避免 ScheduleRuntime 与 WorkflowRuntime 形成两套自动化模型。
- [x] 【薄 GUI 面板准入清理 / Paper Radar】Paper Radar 面板只保留 profile 配置、结果检查、筛选、复制、打开；纯执行链路下沉为 `paperRadar.review` worker/service command。
- [x] 【薄 GUI 面板准入清理 / Figure Style】Figure Style 面板只负责编排人类选择 / 裁剪 / 查看 / 保存请求；PDF 准备 + 样式提取、StyleSpec 保存下沉为专用 IPC / worker-service 动作。
- [x] 【Model Router 配置可发现性】设置页和运行时入口展示 Model Router 本地健康、base URL、public alias、runtime key 与配置文件入口，不新增模型旁路。
