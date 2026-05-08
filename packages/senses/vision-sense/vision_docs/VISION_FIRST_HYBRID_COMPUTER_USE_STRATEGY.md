# SciForge 视觉优先的混合 Computer Use 策略

## 背景

SciForge 的 `vision-sense` 应被定位为视觉感官：输入文本和窗口图像，输出文本化观察、目标描述、候选区域、坐标、置信度和执行建议。它不应该直接承担所有桌面执行责任。

可靠的 Computer Use 不应只依赖纯视觉坐标点击。纯视觉路径最通用，可以覆盖 canvas、自绘 UI、图片按钮和非标准控件，但在长程任务中容易受窗口遮挡、焦点变化、缩放、滚动状态和模型误差影响。结构化能力则能提供更稳定的控件语义，例如按钮、文本框、disabled 状态、菜单项和浏览器 DOM 操作。

因此推荐采用“视觉优先、结构化为辅、系统输入兜底”的混合策略。

## 总体原则

1. **视觉负责理解，不独占执行**
   - `vision-sense` 负责观察目标窗口、理解页面状态、识别目标和给出可执行意图。
   - 输出保持文本化，可以包含 JSON、代码、坐标、目标描述和置信度。

2. **执行由模块化 adapter 完成**
   - `computer-use` 不直接等同于系统鼠标键盘。
   - 所有执行都通过 `InputAdapterProvider` 或等价 broker 统一调度。

3. **能语义执行就语义执行**
   - 浏览器任务优先走 Playwright/CDP。
   - 原生 App 可用 Accessibility 时优先走 AX action 或 set value。
   - 语义路径失败或不可用时，再回退到视觉 grounding + 坐标操作。

4. **共享系统输入只能作为受控兜底**
   - macOS 当前用户会话只有一套真实鼠标键盘。
   - CGEvent/System Events 无法给不同 SciForge 进程提供真正独立的鼠标键盘。
   - 使用 shared system input 时必须全局互斥、显式允许、目标窗口聚焦校验，并显示 SciForge 专用指针。

## 推荐架构

```text
User Task
  -> VisionSense
       输入: 文本 + 目标窗口截图
       输出: 文本观察 / UI 目标描述 / 候选区域 / 坐标 / 置信度 / 执行意图
  -> Action Router
       根据目标、置信度和 adapter 可用性选择执行路径
  -> InputAdapterProvider
       browser-sandbox
       accessibility-per-window
       remote-desktop-session
       shared-system-input
  -> Verifier
       使用目标窗口 before/after 截图、像素差异和视觉判断确认动作是否生效
  -> Trace Recorder
       记录窗口目标、截图引用、adapter、坐标系、锁、动作和失败诊断
```

## Adapter 分层

### browser-sandbox

适用场景：

- Web 应用
- localhost 调试页面
- 表单、按钮、滚动、文件选择前的页面操作

执行方式：

- 每个 worker 一个独立 browser context/page。
- 截图、点击、输入、滚动走 Playwright/CDP。
- 不移动用户系统鼠标，也不抢用户键盘。

优点：

- 并行能力强。
- 可隔离 cookie、storage、viewport 和焦点。
- 对网页任务最稳定。

限制：

- 不能操作 Word、Finder、系统设置等原生桌面应用。

### accessibility-per-window

适用场景：

- 原生 App 的标准控件
- 文本输入框、按钮、菜单、列表、弹窗

执行方式：

- 通过 macOS Accessibility API 定位目标窗口和控件。
- 使用 AX action、set value、menu command 等语义操作。

优点：

- 通常不需要移动用户鼠标。
- 可读取控件角色、名称、状态。
- 比坐标点击更稳定。

限制：

- 自绘 UI、canvas、游戏、复杂图形编辑器可能没有足够 AX 语义。
- 仍需窗口聚焦和权限管理。

### remote-desktop-session

适用场景：

- 长程复杂 Computer Use 测试
- 多 worker 并行桌面任务
- 需要操作真实原生软件且不能影响用户

执行方式：

- 每个 worker 一个独立 VM、VNC、RDP、云桌面或容器桌面。
- 每个 session 拥有自己的显示、鼠标、键盘、窗口栈和焦点。

优点：

- 真正隔离。
- 可并行执行原生应用任务。
- 不影响用户当前桌面。

限制：

- 部署成本较高。
- 需要会话生命周期、资源配额、截图和输入协议适配。

### shared-system-input

适用场景：

- 本机 smoke test
- 单进程、用户明确允许的低风险验证
- 其他 adapter 不可用时的临时兜底

执行方式：

- macOS CGEvent/System Events。
- 通过系统鼠标、键盘和当前焦点执行。

必须满足：

- 默认 fail-closed。
- 必须显式允许。
- 必须全局互斥锁，而不是只按窗口锁。
- 必须校验目标窗口或目标 App 聚焦。
- 必须显示 SciForge 专用视觉指针，和用户默认鼠标区分。
- 不允许并行真实动作。

限制：

- 会影响用户鼠标键盘。
- 不同 SciForge 进程不能真正互不干扰。
- 不能宣称拥有独立输入设备。

## Action Router 策略

Action Router 接收 `vision-sense` 的文本化意图后，按以下优先级选择执行路径：

1. 如果目标是浏览器页面，且 browser adapter 可用，使用 `browser-sandbox`。
2. 如果目标窗口存在稳定 Accessibility 控件，使用 `accessibility-per-window`。
3. 如果任务需要真实桌面隔离，使用 `remote-desktop-session`。
4. 如果只能走坐标，使用 KV-Ground 或 VLM grounder 得到窗口内坐标，再交给可用 adapter 执行。
5. 如果只剩 shared system input，则进入受控兜底路径；没有显式允许时 fail-closed。

每次动作后必须由 Verifier 检查：

- before/after 是否仍是同一目标窗口。
- 目标窗口截图是否发生预期变化。
- 动作是否产生了可见结果。
- 是否需要恢复、重试或请求用户确认。

## 坐标和窗口边界

SciForge 应坚持 window-based，而不是 screen-based：

- 截图以目标窗口为单位。
- Grounder 输出窗口截图坐标。
- Executor 负责把窗口坐标映射到 adapter 坐标。
- Trace 同时记录窗口坐标、映射坐标、窗口 bounds 和截图引用。

这样可以避免多屏、窗口移动、缩放和并行 worker 时的坐标混乱。

## 并发模型

推荐并发策略：

- `browser-sandbox`：按 browser context/page 并行。
- `remote-desktop-session`：按 session 并行。
- `accessibility-per-window`：可按目标窗口保守并行，但对同一 App 或同一进程应加锁。
- `shared-system-input`：全局串行，任何真实动作都必须拿全局锁。

因此，长程测试池可以并行规划、截图分析和结果验证，但真实 GUI 动作必须根据 adapter 类型调度。

## 风险边界

以下动作必须默认阻断或请求上游确认：

- 删除文件、邮件、云端数据。
- 发送消息、提交表单、发布内容。
- 授权登录、创建 API key、保存密码。
- 支付、下单、订阅、取消预约。
- 传输敏感数据或上传用户文件。

`vision-sense` 可以识别并标注风险，但最终拦截应在 `computer-use` Safety Gate 和 adapter 执行前完成。

## Trace 要求

每次 Computer Use 运行应记录：

- `windowTarget`：目标窗口、App、title、bounds、displayId。
- `screenshotRefs`：before/after 图像路径、hash、尺寸。
- `inputChannelContract`：adapter 类型、是否影响用户设备、是否独立。
- `scheduler`：锁粒度、锁 id、并发策略。
- `action`：动作类型、目标描述、坐标、风险等级。
- `grounding`：KV-Ground/VLM 输出、置信度和失败原因。
- `verifier`：结果判断、像素差异、是否同一窗口。
- `failureDiagnostics`：失败分类和修复建议。

Trace 必须避免内联 base64 图像，只保存文件引用和摘要。

## 实施建议

短期：

- 保持 shared system input 默认 fail-closed。
- 对 shared system input 使用全局互斥锁。
- 保持 SciForge 可视化指针。
- 完善 KV-Ground 的远端路径映射或截图上传配置。

中期：

- 实现 `browser-sandbox` adapter，用于 Web/SciForge 页面自身测试。
- 实现 `accessibility-per-window` adapter，用于标准原生控件。
- Action Router 支持按 adapter 能力选择执行路径。

长期：

- 实现 `remote-desktop-session` adapter。
- 为长程测试池分配独立远程桌面 worker。
- 将 planner/grounder/verifier 并行化，真实动作由 adapter scheduler 串行或隔离并行。

## 结论

SciForge 的 Computer Use 不应追求“纯视觉点击一切”。更可靠的方向是：

```text
视觉理解为主
结构化执行优先
远程/浏览器隔离实现并行
共享系统输入只做受控兜底
```

这样既能保留视觉模型的通用性，又能获得长程任务需要的稳定性、可验证性和并发安全。
