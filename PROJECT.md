# SciForge 任务板

更新时间：2026-07-07

## 当前状态

已完成当前产品取舍决策，进入按决策收口实现。

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
- 已完成的任务直接从本文件删除，不再保留 `[x]` 历史列表。
- 需要人工决策的点只记录，不实现。
- 性能相关改动先量化再实现；新增 guard / 边界检查必须说明 runtime cost。

---

## 需要人工决策后再实现

当前无。

## 未完成任务

- 【严格 Model Router-only 收口】审计并修正 text / vision / scientific / image / speech / workflow / schedule 的所有模型调用；Codex / Claude / local runtime 只作为执行 runtime，经 Model Router 获取模型能力。删除上游模型直连旁路，补边界测试。
- 【运行时入口表达收口】主输入框可继续选择执行 runtime，但必须明确显示模型链路由 Model Router 管理；不要让用户误解 `codex` / `local` / `claude` 是三套独立上游模型配置。
- 【Web 预览一等支持】稳定 `localhost:5173` Web 预览和 dev bridge：能力缺失要可见提示，设置页/运行时切换不能白屏，5173 被占用时需要明确策略，浏览器自动化应能覆盖核心交互。
- 【科学模态风险分级】实现高风险科学对象阻断、低风险文本化回退的 translate-then-reason 策略；translator 未配置/失败时，高风险对象必须提示配置专家翻译，低风险对象可回退但需要显式风险标记。
- 【Evidence DAG 高影响 gate】把 Evidence DAG / audit risk digest 接入高影响动作 gate：候选结论推广、报告导出、协议执行、外部提交等动作需要审计通过或人工确认；普通探索仍保持 advisory。
- 【Schedule 编译到 Workflow】保留轻量 Schedule UI，但底层统一编译为 Workflow trigger / run mode，避免 ScheduleRuntime 与 WorkflowRuntime 形成两套自动化模型。
- 【薄 GUI 面板准入清理】按“检查 / 审批 / 标注 / 比较 / 选择”准入规则审计现有 Evidence、Paper Radar、Figure Style、Schedule、Workflow 等面板；纯执行面板下沉为 agent / worker 能力。
- 【团队治理分阶段】先实现决策记录 + 单人审批 + 移动/IM 监督闭环，再扩展多人角色和团队权限；避免一次性做重型团队系统。
- 【Model Router 配置可发现性】主界面的“模型”页主要展示用量，真实配置在设置页和输入框旁运行时菜单；需要设计一个不新增旁路的提示/健康状态，让用户能确认当前请求会走 Model Router。
