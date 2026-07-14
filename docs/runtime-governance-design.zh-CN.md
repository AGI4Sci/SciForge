# 多 Runtime 架构治理设计

## 目标

SciForge 需要同时支持 SciForge Runtime、Codex app-server，以及后续可能新增的 runtime。架构目标是让入口、状态治理、事件语义和稳定性保护尽量共用；runtime 差异只留在 adapter 和 runtime 原生层。

```text
UI / Write / 连接手机 / Schedule
  -> AgentRuntimeHost
    -> Runtime Governance
      -> Runtime Adapter
        -> Native Runtime
```

## 分层边界

### 入口层

入口层只负责把业务请求转成统一的 `AgentRuntime*Input`：

- UI 对话、写作助手、连接手机、定时任务都调用同一个 runtime host。
- 入口可以提供场景参数，例如值守入口更严格的预算。
- 入口不直接调用 SciForge Runtime HTTP、Codex JSON-RPC 或任何 LLM API。

### 公共治理层

公共治理层挂在 `AgentRuntimeHost` 附近，处理与具体 runtime 协议无关的事情：

- turn 排队、超时、预算、状态收束。
- runtime capability 编排，例如 steer、interrupt、approval、user input。
- 事件归一后的稳定性治理，例如工具循环、重复状态、异常收尾。
- synthetic event 规范：先持久化，再发布给 UI。
- hidden prompt 与 display text 的展示边界。
- 公共测试基座和配置迁移。

公共层不能做的事：

- 不能改写 runtime 原生协议。
- 不能假设某个工具、命令或平台一定存在。
- 不能绕过 model router 或 runtime adapter 直连 LLM。

### Runtime Adapter 层

Adapter 只做协议和能力适配：

- 把统一输入转换为 runtime 原生命令。
- 把原生事件转换为 `AgentRuntimeEvent`。
- 声明 runtime capability，包括 native guard、steer、interrupt、approval、user input、event replay。
- 封装 runtime 专属错误，不把协议细节泄漏到入口层。

Adapter 不负责业务策略；同类策略应上移到公共治理层。

### Runtime 原生层

Runtime 原生层保留各自能力：

- SciForge Runtime 保留 AgentLoop、pre-exec tool host、ToolStormBreaker、request history hygiene。
- Codex app-server 保留原生 sandbox、approval、file change、thread、session、JSON-RPC 生命周期。
- 新 runtime 只要实现 adapter 合同并声明能力，就能接入公共治理层。

## Capability 合同

公共层根据 capability 决定治理方式，避免双重保护：

```text
guard.toolStorm = native | observe | unsupported
guard.toolBudget = native | observe | unsupported
guard.stuckDetection = native | observe | unsupported
controls.steer = true | false
controls.interrupt = true | false
events.replayable = true | false
events.sequenced = true | false
approval = sync | async | unsupported
userInput = sync | async | unsupported
```

示例：

- SciForge Runtime: 三类 guard 都是 `native`，由原生 AgentLoop 在执行边界处理。
- Codex: `guard.toolStorm = observe`，因为 GUI 侧主要通过已归一事件观察后纠偏；
  `toolBudget` 和 `stuckDetection` 暂时显式声明为 `unsupported`。
- Claude Code: 三类 guard 暂时都显式声明为 `unsupported`，不借 capability 暗示尚未实现的保护。

公共事件 code 只统一已经存在且语义稳定的 guard 分类：工具风暴、工具预算和卡死检测。
runtime 仍可发出私有 code；公共 parser 对已知 guard code 保真，对未知 code 保持向后兼容的
开放字符串边界。

## 工具循环治理

工具循环是公共治理能力之一，不是针对某个命令的补丁。

公共 fingerprint 至少包含：

- exact tool name + canonical args。
- tool kind，例如 command execution、tool call、file change。
- 行为族，例如 shell/date、shell/read-file、search/read。
- 同一 turn 的连续次数和总次数。

默认策略选择方案 A：

```text
软阈值命中
  -> 如果支持 steer：提示 runtime 停止同族工具，基于已有结果回答
  -> 如果不支持 steer：记录保护事件，继续观察

硬阈值命中
  -> 如果支持 interrupt：终止本轮并生成保护说明
  -> 如果不支持 interrupt：标记 degraded，交给原生 runtime 收尾
```

SciForge Runtime 的 native guard 在执行前生效；公共层只消费它的结果事件。Codex 的 observe guard 在事件后生效，优先 steer，继续重复再 interrupt。

## 配置边界

配置按治理能力命名，不按 runtime 命名：

```text
runtimeGuards.toolStorm.enabled
runtimeGuards.toolStorm.windowSize
runtimeGuards.toolStorm.threshold
runtimeGuards.budgets.defaultMaxToolEvents
runtimeGuards.budgets.remoteGuardMaxToolEvents
```

设置只读取 `runtimeGuards.toolStorm`。UI 文案使用 Runtime Guard，不再使用默认运行时专属命名。

main process 专用的内部服务凭据不得透传到任何 agent runtime 子进程。SciForge Runtime、
Codex 和 Claude Code 的启动环境统一经过共享 sanitizer；runtime 自己需要的公开配置仍由各自
adapter 显式注入。

## 拓展规则

新增 runtime 时按顺序完成：

1. 实现 `AgentRuntimeAdapter`。
2. 声明 capability。
3. 接入事件归一化和 replay。
4. 跑公共治理测试。
5. 只在 adapter 内补 runtime 私有协议。

新增治理能力时按顺序完成：

1. 先定义 runtime-neutral 事件或状态输入。
2. 再定义 capability 开关。
3. SciForge Runtime/Codex adapter 分别声明支持程度。
4. 最后删除入口层或 runtime 分支里的重复逻辑。

## 风险控制

- 过度统一会伤害 Codex 原生能力；公共层只编排，不改写协议。
- 双重保护会制造误中断；必须由 capability 决定谁负责。
- 只看 exact duplicate 会漏掉参数变体循环；fingerprint 要支持行为族。
- synthetic event 顺序错误会造成 UI 和存储不一致；必须持久化优先。
- 值守入口更容易长时间无人干预，应使用更严格预算，但仍复用同一治理层。
