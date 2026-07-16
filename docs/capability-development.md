# SciForge 能力开发与注册规范

SciForge 的产品能力只有一条合法链路：调用方通过通用 capability transport 进入
`CapabilityBroker`，broker 再调用应用 registry 中唯一注册的 provider。UI、agent 和
system 只是不同 audience，不得各自实现业务入口。

本规范适用于所有新功能和已迁移功能，不按文件格式、页面或单个案例打补丁。

## 强制机制

能力治理采用 fail-closed，而不是靠开发者记住检查：

1. `defineCapability` 和 `CapabilityRegistry` 在应用启动及测试构造时拒绝缺字段、重复
   action ID、缺 handler、无效 schema，以及不安全的 audience/effect/approval 组合。
2. `npm run capability:check` 从唯一 composition root
   `src/main/capabilities/app-registry.ts` 实例化 registry，并校验生成文档和架构边界。
3. 根项目的 `pretest` 与 `prebuild` 自动运行 `capability:check`。未注册、文档漂移或存在
   旁路时，测试和发布构建均不能继续。
4. 每个 provider 必须运行公共 provider contract suite；领域测试只补充领域语义，不得
   代替公共契约测试。
5. `docs/generated/capabilities.md` 只能由 registry 生成。手改生成文件不能通过检查。

`capability:check` 会拒绝：

- visible context 或 renderer 暴露 registry 中不存在的 action；
- 手写 `accessHint`、工具名或独立的 agent access 布尔开关；
- 同一个 action 注册多个 provider；
- 已标记完成迁移的领域仍保留 renderer/main 直连业务 IPC；
- registry 构造时执行服务、I/O 或其他副作用；
- 生成参考与当前 registry 不一致。

## 新能力的必经流程

### 1. 先定义契约

在 shared contract 中定义并测试输入、输出和错误形状，然后使用 `defineCapability` 声明：

- 全局唯一、稳定的 action ID 和版本；
- 说明文字；
- `ui`、`agent`、`system` audiences；
- global、workspace、resource scope；
- `read`、workspace mutation、external mutation 等 effect；
- approval policy；
- JSON-compatible input/output schema；
- semantic revision 和 idempotency 策略；
- 唯一可执行 handler。

不要先写按钮、IPC 或 prompt，再反向补一份“看起来差不多”的契约。没有完整定义时，
功能必须保持不可见。

### 2. 实现唯一 provider

Provider 适配既有领域 service；它不复制领域行为，也不直接操作 renderer 状态。
Mutation 必须由 broker 统一完成输入验证、scope/policy 校验、revision、idempotency、audit
和 `resource.changed` 发布。

Registry 构造必须是纯操作。handler 可以闭包引用注入依赖，但 service 调用和 I/O 只能
发生在 handler 真正执行时。这样生成器可以用不可执行的 typed proxy dependencies
构造同一个 registry，杜绝第二份文档清单。

### 3. 注册到唯一 composition root

把 provider 加入 `createAppCapabilityRegistry(deps)`，并在
`MIGRATED_CAPABILITY_DOMAINS` 中登记 action ID 的首段 domain 及所有已删除的旧 transport
prefix。治理检查要求每个已注册 domain 都有且只有一项原子迁移政策；只注册 action 而不
声明边界也会失败。禁止创建 renderer registry、agent registry、文档 registry 或兼容
alias。注册失败必须阻止功能暴露，不能降级成截图、shell 或文件直写旁路。

只有不能表达为业务能力的纯 UI transport（例如原生文件选择器）可以通过
`allowedDirectTransports` 按完整 channel 名逐项放行。禁止 wildcard、prefix 级豁免或把
业务读写接口伪装成 UI transport；放行项不进入 agent audience，也不得承载业务执行。

Agent 可访问性只能来自 definition 的 `audiences`，不得出现以下设计：

```ts
// 禁止：与可执行 action 脱节
agentAccess: true
accessHint: 'Use some_tool ...'
```

### 4. UI、agent 和 system 使用同一 transport

- UI 使用通用 discover/observe/invoke/events client，不新增领域业务 IPC。
- Agent 只使用稳定的 discover/observe/invoke/events 元工具，action 在调用时从 registry
  发现，不扁平注入新工具名。
- Visible context 发布 opaque resource handle 和 registry-derived operation descriptor，
  不发布内部 session ID、sidecar path、action count 或文字提示。
- System/automation 也通过同一个 broker，并携带明确 caller context。

Resource handle 默认只允许签发它的 audience 使用。只有确需在 UI、agent 或 system 间共享的
资源才能在 `CapabilityResourceRegistration.audiences` 显式声明可转移范围；broker 仍会校验
workspace、TTL、防伪和各 action 自身的 audience policy。不得通过放宽全局句柄校验实现共享。

### 5. 运行公共 provider contract suite

每个 provider 的 fixture 至少覆盖：

- action 能被声明的 audience 发现，且对未声明 audience 不可见；
- 非法输入在 handler 运行前失败；
- UI 和 agent 调用同一个 handler/provider；
- mutation 的 stale revision 无副作用地失败；
- 相同 invocation ID 的等价重试只执行一次；
- 成功 mutation 写入 audit，并发布一次 resource change event；
- scope、approval 和不安全 audience 组合被拒绝。

公共 suite 通过后，再添加格式、领域数据和错误恢复等业务测试。

### 6. 生成并验证

```sh
npm run capability:generate
npm run capability:check
npm test
```

提交 capability definition、provider、contract test 和
`docs/generated/capabilities.md`。缺少其中任何一项均视为功能未完成。

## 已有领域的原子迁移

一个领域的 UI 与 agent 切换到 broker 后，必须在同一个变更中：

1. 在 app registry 的 `MIGRATED_CAPABILITY_DOMAINS` 中声明领域及旧 transport prefix；
2. 删除旧业务 IPC、prompt hint、agent access 布尔开关和手动刷新链；
3. 删除兼容 alias 和第二 provider；
4. 让 renderer 订阅通用 resource change event 后重新 observe；
5. 运行 architecture check，确认领域 transport prefix 已完全消失。

不要先标记迁移完成再保留过渡旁路；也不要为旧任务或单个文件格式保留兼容分支。

## Review 清单

- [ ] 是否先提交了 input/output/policy/revision/idempotency 契约？
- [ ] action 是否只在 app registry 注册一次且绑定唯一 handler？
- [ ] UI、agent、system 是否全部走 broker？
- [ ] agent audience 和 visible operation 是否完全由 registry 派生？
- [ ] provider contract suite 是否覆盖 discovery、policy、revision、idempotency、audit、event？
- [ ] mutation 是否没有 direct IPC、sidecar/file write 或手动 refresh 旁路？
- [ ] 是否运行 `capability:generate` 并提交生成参考？
- [ ] `capability:check`、测试和构建是否通过？
