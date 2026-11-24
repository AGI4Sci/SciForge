# 任务的一次复查

协作 Worker 可以结束当前模型轮次，约定稍后核实同一任务。等待期间不启动模型轮次；SciForge 应用和已有 Runtime 宿主可以保持运行。复查只延续已授权任务，不授予重复外部写入、提交交付或采纳科研结论的权限。

## 契约与状态

Worker 的严格结果信封新增第三个分支：

```json
{
  "result": {
    "schemaVersion": 1,
    "outcome": "deferred",
    "followup": {
      "key": "training-result",
      "at": "2026-11-16T09:00:00+08:00",
      "about": "读取已经提交的作业结果，保留阴性结果；不要重新提交训练。"
    }
  }
}
```

示例时间须替换成当前时间之后一分钟至七天内的时间。每个 Execution 最多八次复查。登录、授权或本人恢复连接的阻塞继续走 `needs_human`。`key` 是有界标识；回执不接受脚本、工具、工作目录或授权目标。

Collaboration 在原 `state.json` 的 TaskRun 中保存复查，绑定源 invocation/turn、Runtime/Session、要求 digest 和输入资源引用。每个源 invocation 只创建一次意图。状态为 `waiting → dispatching → completed`；失去权限、任务停止、要求或输入变化、成员在会话输入新指令时取消。错过到期时间超过一天，或复查轮次失败时保留 `unknown`，不自动重新执行业务。completed 仅指该复查轮次已处理，不代表 Delivery、采纳或科学验收完成。

需要人时仍由 Cloud HumanNeeded / HumanAnswer、原 Inbox 和原 Session 续办。普通回答不获得动作批准；明确批准仍绑定请求版本和原 confirmation，不增加批准数据库。

## 唯一执行与时钟入口

- SDK Host API `1.19.0` 的 lifecycle context 提供可取消的 `wakeups.schedule(at, callback)`。宿主只发时间通知，没有任务身份、命令或执行权限。
- 时钟复用 `ScheduleRuntime` 的 tick；意图由 Collaboration 持久化，激活后重新登记，不新建定时数据库或模型轮询器。普通定时任务开关只控制普通定时任务；已由任务约定的复查沿任务生命周期取消。关闭应用撤销本机回调，重开按持久意图核对。
- 所有领域完成激活后才启动时钟。回调绑定 lifecycle signal，停用后到达的旧回调不能唤醒领域。
- 到期经原 TaskAdapter 队列、最新 Cloud preflight、Session admission 和 AgentExecution 运行。重复回调只进入原队列；已保存结果按原 followup invocation 重读，未结 invocation 复用原 durable directive。
- 结果格式修复使用原 Session 的工具空列表，只允许重写回执，不允许重做业务。

任务列表与详情区分等待和结果未知。详情保留依据与时间；会话与退回任务入口继续使用原实现。列表只采用当前用户、当前 Task/Execution 的本机复查记录，旧执行不能覆盖当前状态。

## 回归要求与限制

回归应覆盖等待期间不调用模型、重启恢复、重复唤醒、结果重放、缺失意图补回、权限撤销、输入变化、错过复查以及结果未知；还应检查生命周期取消、领域停用、单次触发、等待状态显示和禁止误报完成，以及相邻的编辑版本与创建恢复边界。

使用临时存储与 fake Runtime/Cloud 的测试不能作为真实模型、真实 Cloud 或科研效果的证据；真实平台、操作系统原生交互及安装包验收未由本文证明。本文说明技术合同和需要验证的边界，不记载私有交付或发布状态。

本能力只做一次已授权模型核实；尚未提供外部作业探测器、任意外部作业持久接管或独立于应用的后台服务。长期等待适合由业务来源产生恢复事件，不能靠反复唤醒长会话节省费用。外部副作用仍需业务幂等与回读核对。
