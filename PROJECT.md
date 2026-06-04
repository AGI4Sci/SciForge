# SciForge 项目协议

最后更新：2026-06-04

## 当前目标

SciForge 当前主线是实现 [`docs/ModelRouterArchitecture.md`](docs/ModelRouterArchitecture.md)：
提供一个 Codex provider-compatible 的 Model Router `/v1/responses` 服务，让外部调用者看到一个统一的多模态 LLM API。

MVP 只支持视觉模态。Router 是薄的确定性 orchestrator，不是新的 agent host：

```text
SciForge / Codex app-server / Computer Use
  -> Model Router /v1/responses
  -> text reasoner
  -> vision translator
  -> refs-first trace bundle
```

主文本模型负责推理；视觉模型只把 `instruction + image/ref` 转成文本观察。模型按 workspace/profile 配置，不在算法里区分或写死 DeepSeek/Qwen。

## 不可变规则

- 旧逻辑代码和最终目标冲突的时候，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- 所有修改必须通用，不能为当前页面、截图、URL、文件名、agent id 或历史 run 写硬编码补丁。
- 业务代码单文件超过约 2000 行时必须拆分或登记拆分任务。
- 已完成 TODO 必须打勾，并补充日期、evidence refs、验证命令和最终状态。
- GUI 不是 agent host；任务推理、模型选择、tool/capability 编排和 completion 判断归 Agent Host 或 provider/runtime owner。
- 大对象必须 refs-first；截图、图片、provider payload、trace、日志和 artifact 不得作为 raw/base64 长期进入聊天正文或主上下文。
- 不得静默 fallback 到未注册 provider/model/profile；缺配置必须 fail closed 或显式降级说明。
- 不使用 `git reset --hard` 或 `git checkout --` 擦除用户改动。

## 当前任务板：Model Router MVP

### P0：Provider-compatible Model Router

- [ ] 新增独立 `model-router` backend 服务，对外暴露 `/v1/responses`，不把现有 `codex-responses-proxy` 扩成多模态编排器。
- [ ] 支持纯文本请求直通 text reasoner，行为等价于当前文本 provider proxy。
- [ ] 支持视觉请求：解析 inline image、image URL 和 SciForge ref，内部统一成 `ModalityRef`。
- [ ] 按 workspace/profile 解析 `textReasoner` 与 `translators.vision`；请求可携带 profile，缺省使用服务默认 profile。
- [ ] 未知 profile、未注册模型、缺少 secret 或非法 provider 配置必须 fail closed。
- [ ] 主文本模型可通过严格 JSON 协议请求 `need_more_visual_info`；Router 只校验 schema、target 和 round budget。
- [ ] 补问次数由 profile 配置，默认 `maxSupplementRounds=2`。
- [ ] Streaming 默认只流最终答案；视觉转译、补问和内部控制轮只写 trace。
- [ ] 每次请求写 `.sciforge/model-router-traces/**` refs-first bundle，记录 profile/model/ref/hash/round/error summary，不写 API key、完整 raw provider payload 或长期 base64。
- [ ] 视觉转译失败时降级回答：最终答案必须明确说明图像无法检查，不能假装看过图。

### P0：主聊天图片理解

- [ ] 主聊天 composer 支持上传图片作为当前 turn 上下文，并通过 Model Router 进入视觉理解流程。
- [ ] 主聊天消息流支持展示图像数据，不依赖右侧结果栏。
- [ ] 图片默认显示缩略图；点击后在主聊天内查看原图。
- [ ] 图片消息只引用 workspace file/ref/raw preview URL，不把 base64 长期保存到 session 或 trace。
- [ ] 图片理解验收场景需要 diverse 且复杂：科研图表、显微/实验图像、UI 截图、包含小字/图例/坐标轴的图像问答。

### P0：Computer Use 统一模型入口

- [ ] Computer Use 算法不再区分文本推理模型和 VLM 模型；只依赖统一 Model Router provider。
- [ ] Computer Use 的 screenshot/crop/grounding/verifier prompt 均通过 Router 的 vision translator role 转译为文本观察。
- [ ] Computer Use trace 记录 router trace refs、window screenshot refs、hash、尺寸、target、round/error summary。
- [ ] 复杂软件操作验收必须覆盖 diverse 场景：浏览器科研检索、文档/表格编辑、文件管理、IDE/终端、跨窗口恢复与 verifier 复查。
- [ ] 失败时保留 refs-first diagnosis，不把截图 base64、raw provider payload 或 GUI 私有状态写入主结果。

### P1：配置与产品入口

- [ ] Runtime Codex 默认 provider 指向 Model Router，而不是直接指向 DeepSeek proxy。
- [ ] Settings / runtime audit 只展示公开 alias 和统一 router profile，不暴露 provider URL、API key 或 raw model slug。
- [ ] `docs/Architecture.md`、`docs/NativeExtensionOwnershipMap.md` 和 Computer Use 相关文档同步移除“文本模型/VLM 分开配置”的产品假设。
- [ ] 增加 release/runbook：如何配置默认 profile、workspace/profile override、trace root、text reasoner 和 vision translator。

## 验收标准

1. 主聊天栏支持图片理解任务：用户可上传图片，图片在主聊天中以缩略图展示，点击查看原图；同一 turn 能围绕图片进行准确问答。验收场景至少覆盖科研图表、实验/显微图像、UI 截图和复杂标注/图例图片。
2. Computer Use 通过统一 Model Router 服务完成软件操作：算法内部不再区分 text reasoner 与 VLM；复杂场景至少覆盖浏览器检索、文档/表格编辑、文件管理、IDE/终端和跨窗口恢复。
3. 对外 provider 面保持 `/v1/responses` compatible：纯文本请求可直通，视觉请求内部转译，最终只返回 answer/stream。
4. Router 补问循环受 profile 限制，默认最多 2 次；非法 JSON、未知 target、超限或视觉失败不会触发未授权调用。
5. `.sciforge/model-router-traces/**` 生成可审计 trace；不得包含 API key、Authorization、secret、长期 base64、完整 raw provider payload、raw screenshot 或未脱敏私密 URL/本地路径。
6. `git diff --check`、focused backend tests、focused chat UI tests、focused Computer Use policy tests 和 `npm run typecheck` 通过；不能运行的 live/opt-in 验收必须登记 blocker 与替代证据边界。

## 必读文档

- [`docs/ModelRouterArchitecture.md`](docs/ModelRouterArchitecture.md)：当前实现目标。
- [`docs/Architecture.md`](docs/Architecture.md)：Agent Host Semantic Pipeline 和 GUI-as-extension。
- [`docs/NativeExtensionOwnershipMap.md`](docs/NativeExtensionOwnershipMap.md)：native / runtime / GUI ownership。
- [`packages/backend/README.md`](packages/backend/README.md)：provider proxy 和 Runtime Codex provider 边界。
- [`packages/observe/vision/README.md`](packages/observe/vision/README.md)：视觉转文本与 refs-first trace 原则。
