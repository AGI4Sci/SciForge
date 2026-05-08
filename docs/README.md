# SciForge 文档索引

本目录只保留帮助用户、研究者和贡献者理解 SciForge 的项目级文档。某个算法、模块或 provider 的细节文档应放回对应模块目录，例如 vision-sense 的文档位于 `packages/senses/vision-sense/vision_docs/`。

## 用户入口

1. [`../README.md`](../README.md)：项目首页，说明 SciForge 的定位、独特性、核心场景和快速启动。
2. [`UsageInstructions.md`](UsageInstructions.md)：实际操作说明，覆盖论文复现、自我进化修复、Computer Use、多 backend 切换和常用命令。
3. [`SciForge_Project_Document.md`](SciForge_Project_Document.md)：产品愿景、设计原则、当前模块边界和长期路线。

## 架构与扩展

- [`CapabilityIntegrationStandard.md`](CapabilityIntegrationStandard.md)：sense、skill、tool、action、verifier、interactive view 的集成标准。
- [`ScenarioPackageAuthoring.md`](ScenarioPackageAuthoring.md)：如何编写、验证、发布和复用 scenario package。
- [`ViewCompositionSchema.md`](ViewCompositionSchema.md)：artifact 如何通过 UIManifest 和 View Composition 渲染。
- [`SkillPromotionProposal.md`](SkillPromotionProposal.md)：workspace task 如何沉淀为可复用 skill。
- [`TimelineDecisionCollaborationModel.md`](TimelineDecisionCollaborationModel.md)：研究时间线、决策记录、协作和导出模型。
- [`CLI_UI_Shared_Agent_Usage.md`](CLI_UI_Shared_Agent_Usage.md)：UI 聊天与 CLI/终端如何共享同一套 Agent handoff contract。
- [`AgentServerTaskGenerationProtocol.md`](AgentServerTaskGenerationProtocol.md)：AgentServer 如何生成或修复 workspace-local task code，并返回 `ToolPayload`。

## 模块文档

这些文档不放在项目级 `docs/` 下，但对理解对应模块很有用：

- [`../packages/senses/vision-sense/README.md`](../packages/senses/vision-sense/README.md)：vision-sense 的能力边界、配置和测试。
- [`../packages/senses/vision-sense/vision_docs/vision_computer_use_agent_mvp.md`](../packages/senses/vision-sense/vision_docs/vision_computer_use_agent_mvp.md)：Vision + Computer Use 最小闭环。
- [`../packages/senses/vision-sense/vision_docs/vision_computer_use_agent_design_v2.md`](../packages/senses/vision-sense/vision_docs/vision_computer_use_agent_design_v2.md)：Vision + Computer Use 设计细节。
- [`../packages/senses/vision-sense/vision_docs/VISION_FIRST_HYBRID_COMPUTER_USE_STRATEGY.md`](../packages/senses/vision-sense/vision_docs/VISION_FIRST_HYBRID_COMPUTER_USE_STRATEGY.md)：视觉优先的混合 Computer Use 策略。
- [`../packages/senses/vision-sense/vision_docs/KV_GROUND_ERVICE_GUIDANCE.md`](../packages/senses/vision-sense/vision_docs/KV_GROUND_ERVICE_GUIDANCE.md)：KV-Ground 部署、路径映射和排障。

## 示例

- [`examples/workspace-scenario/package.json`](examples/workspace-scenario/package.json)：workspace scenario package 示例。

## 文档维护规则

- 项目级 `docs/` 只放能帮助理解 SciForge 整体产品、架构、使用和扩展方式的文档。
- 算法、模块、provider、runner 或具体实现细节文档放在对应 package/module 内，并在本索引中引用。
- 项目自有文档使用中文；代码标识、协议字段、命令和 package 名称可保留英文。
- 不把 demo/placeholder 说成已完成能力；失败边界必须写清楚。
- 新增核心能力时，同步更新 README、本索引和对应 package README。
