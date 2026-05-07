# SciForge 文档索引

本目录保存 SciForge 的项目级文档。文档默认使用中文；保留英文的地方通常是代码标识、协议字段、命令或后续绘图用 prompt。

## 推荐阅读顺序

1. [`../README.md`](../README.md)：面向用户和贡献者的项目入口。
2. [`SciForge_Project_Document.md`](SciForge_Project_Document.md)：产品愿景、架构原则和长期路线。
3. [`CapabilityIntegrationStandard.md`](CapabilityIntegrationStandard.md)：sense、skill、tool、action、verifier、interactive view 的集成标准。
4. [`CLI_UI_Shared_Agent_Usage.md`](CLI_UI_Shared_Agent_Usage.md)：UI 聊天和 CLI/终端如何共享同一套 Agent handoff contract。
5. [`AgentServerTaskGenerationProtocol.md`](AgentServerTaskGenerationProtocol.md)：AgentServer 如何生成 workspace-local task code 和 `ToolPayload`。
6. [`ScenarioPackageAuthoring.md`](ScenarioPackageAuthoring.md)：如何编写、发布和复用 scenario package。
7. [`ViewCompositionSchema.md`](ViewCompositionSchema.md)：artifact 如何通过 UIManifest 和 View Composition 渲染。
8. [`SkillPromotionProposal.md`](SkillPromotionProposal.md)：workspace task 如何沉淀为 skill proposal。
9. [`TimelineDecisionCollaborationModel.md`](TimelineDecisionCollaborationModel.md)：研究时间线、决策记录和协作模型。

## Vision 与 Computer Use

视觉和 GUI 操作相关文档位于 [`vision_tool/`](vision_tool/)：

- [`vision_computer_use_agent_mvp.md`](vision_tool/vision_computer_use_agent_mvp.md)：最小可用闭环。
- [`vision_computer_use_agent_design_v2.md`](vision_tool/vision_computer_use_agent_design_v2.md)：完整设计。
- [`VISION_FIRST_HYBRID_COMPUTER_USE_STRATEGY.md`](vision_tool/VISION_FIRST_HYBRID_COMPUTER_USE_STRATEGY.md)：视觉优先的混合策略。
- [`KV_GROUND_ERVICE_GUIDANCE.md`](vision_tool/KV_GROUND_ERVICE_GUIDANCE.md)：KV-Ground 部署和路径映射说明。

当前边界：

- `vision-sense` 是 sense：只把截图/图像等模态转成可审计文本结果。
- `computer-use` 是 action：消费任意 sense provider 的观察结果，执行 GUI action loop。
- TypeScript runtime 负责窗口绑定、截图、坐标映射、executor adapter、scheduler lock、trace 和 UI 回传。
- 所有截图/trace 记忆默认 file-ref-only，不内联 base64。

## 文档维护规则

- 项目自有文档使用中文。
- 代码标识、协议字段、命令、package 名称和绘图 prompt 可保留英文。
- 不把 demo/placeholder 说成已完成能力；失败边界必须写清楚。
- 不重写第三方或已安装 skill 的原始 `SKILL.md`，除非明确是在维护该 skill 本身。
- 新增核心能力时，同步更新 README、CapabilityIntegrationStandard 和对应 package README。
