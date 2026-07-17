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
- 归一化 execution attempt/receipt 后的稳定性治理，例如语义失败、重复读取、异常收尾。
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

- SciForge Runtime 保留 AgentLoop、pre-exec tool host 和 request history hygiene；pre-exec
  host 调用公共 `ExecutionGovernorCore`，不再维护 runtime 私有的重复检测器。
- Codex app-server 保留原生 sandbox、approval、file change、thread、session、JSON-RPC 生命周期。
- 新 runtime 只要实现 adapter 合同并声明能力，就能接入公共治理层。

## Capability 合同

公共层根据 capability 决定治理方式，避免双重保护：

```text
guard.execution = preexec | observe | unsupported
controls.steer = true | false
controls.interrupt = true | false
events.replayable = true | false
events.sequenced = true | false
approval = sync | async | unsupported
userInput = sync | async | unsupported
```

示例：

- SciForge Runtime: `guard.execution = preexec`，在工具执行前把 attempt 交给公共 governor。
- Codex: `guard.execution = observe`，把归一化 lifecycle event 交给同一个 governor 记录 receipt
  并在事件后纠偏。

## Execution 治理

Execution 治理是公共能力，不是针对某个命令或单个模型的补丁。所有 runtime adapter 都输出：

- `ExecutionAttempt`：call ID、工具/provider、kind、canonical arguments、resource identity；
- `ExecutionReceipt`：success/error/cancelled、结构化 error code、failure class、evidence delta、
  state changed；
- 同一套 exact fingerprint、semantic fingerprint、read coverage 与 failure streak。

公共语义至少覆盖：

- exact tool name + canonical args。
- tool kind，例如 command execution、tool call、file change。
- 行为族和资源身份，例如 shell GUI automation、surface inspection、search/read。
- volatile token、revision、request ID 或坐标变化不能重置同一语义失败 streak。
- 成功且获得新 evidence 的分块读取、受信 computer-use 和真实 state change 不得被误杀。

默认策略选择方案 A：

```text
软阈值命中
  -> 如果支持 steer：提示 runtime 停止同族工具，基于已有结果回答
  -> 如果不支持 steer：记录保护事件，继续观察

硬阈值命中
  -> 如果支持 interrupt：终止本轮并生成保护说明
  -> 如果不支持 interrupt：标记 degraded，交给原生 runtime 收尾
```

SciForge Runtime 在执行前消费 governor decision，并在完成后记录 receipt。Codex adapter 从动态
MCP/command lifecycle 构造相同 attempt/receipt，优先 steer，继续同类语义失败再 interrupt。
如果 registry 显示 `surface.inspect` 对 agent 可用，shell 截图和窗口自动化必须以结构化
`owned_surface_policy_denied` 失败；这条政策由实际 capability availability 驱动，不能靠 prompt。

## Capability agent surface

Codex 与 SciForge Runtime 对模型只公开四个稳定元工具：`sciforge_discover`、
`sciforge_observe`、`sciforge_invoke`、`sciforge_events`。两者都进入 main 进程同一个
`CapabilityAgentToolSurface` 和同一个 app registry：

```text
Codex adapter -------------------------> CapabilityAgentToolSurface
SciForge Runtime -> transparent bridge -> CapabilityAgentToolSurface
                                              -> CapabilityBroker
                                              -> App Registry / Providers
```

桥接层只能传输请求和 caller context，并负责超时、原子消息写入及结构化错误；不得复制
registry/provider。模型不可见 thread ID、turn ID、workspace path、revision、snapshot token、
坐标和 invocation ID。应用能力的可用性由实时 registry discovery 决定，不由 provider metadata
或手写 prompt 伪造。

## 配置边界

配置按治理能力命名，不按 runtime 命名：

```text
runtimeGuards.execution.enabled
runtimeGuards.execution.windowSize
runtimeGuards.execution.exactRepeatThreshold
runtimeGuards.execution.semanticFailureThreshold
runtimeGuards.budgets.defaultMaxToolEvents
runtimeGuards.budgets.remoteGuardMaxToolEvents
```

设置只读取 runtime-neutral execution governance 配置。UI 文案使用 Runtime Guard，不再使用
默认运行时或旧检测器专属命名。

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
- 双重 decision engine 会制造误中断；adapter 只能决定执行时机，判定逻辑必须来自同一个
  `ExecutionGovernorCore`。
- 只看 exact duplicate 会漏掉参数变体循环；fingerprint 要支持行为族。
- synthetic event 顺序错误会造成 UI 和存储不一致；必须持久化优先。
- 值守入口更容易长时间无人干预，应使用更严格预算，但仍复用同一治理层。
