# SciForge - PROJECT.md

最后更新：2026-05-09

## 关键原则

- AgentServer 是项目无关的通用大脑和 fallback backend；SciForge 不维护写死工具清单，优先通过 skill registry、workspace-local task code 和 AgentServer 动态探索/写代码解决请求。
- 正常用户请求必须交给 AgentServer/agent backend 真实理解和回答；SciForge 不设置、不维护、不返回预设回复模板，只允许输出协议校验、执行恢复、安全边界和错误诊断类系统信息。
- Self-evolving skills 是核心原则：任务代码先在当前 workspace 中生成、修复和验证；稳定成功后，经用户确认再沉淀到 skill library 或 package skill package 候选。
- 所有修改必须通用、可泛化到任何场景，不能在代码里面硬编码和为当前案例打补丁
- 算法相关的代码优先用Python实现，方便人类用户优化、检查算法
- Python conversation-policy package 是多轮对话策略算法的唯一真相源；TypeScript 只能保留 transport、runtime 执行边界和 UI 渲染，不再维护一套并行的策略推断算法。
- T096/T097 的 execution mode 策略只允许来自 Python classifier；TypeScript 的职责是字段透传、runtime shell、guard 调用、ref 持久化和 UI fallback，不允许用 prompt regex 或 provider/scenario 分支重建策略。
- 当 observe、skills、actions、verifiers、interactive views 增多时，主 agent 只消费 capability broker 生成的紧凑 capability brief；能力模块默认是 typed service/adapter，只有开放式、多步推理模块才声明内部 planner/小 agent，interactive views 只负责按 schema 渲染。
- 真实任务应输出标准 artifact JSON、日志和 ExecutionUnit；不得用 demo/空结果伪装成功。
- 错误必须进入下一轮上下文：failureReason、日志/代码引用、缺失输入、recoverActions、nextStep 和 attempt history 都要保留。
- 多轮对话要以 workspace refs 为长期事实来源，以最近消息为短期意图来源；“继续、修复、基于上一轮、文件在哪里”必须能接上当前 session。
- 代码路径保持唯一真相源：发现冗余链路时删除、合并或降级旧链路，避免长期并行实现。
- 代码膨胀必须自动触发治理：源码文件超过 1000 行进入 watch list；超过 1500 行必须在 PROJECT.md 有模块化拆分任务、语义 part 计划或生成文件豁免；超过 2000 行优先拆分；超过 3000 行视为维护风险。后续开发若让文件越过阈值，应优先抽模块、删除冗余逻辑或补拆分 TODO，而不是继续堆主文件。
- 长文件拆分必须按职责命名，不能机械切成 `part1/part2`；如果暂时不能完全解耦，也要拆成有语义的文件，例如 `*-event-normalizer`、`*-runner`、`*-diagnostics`、`*-state-machine`，并保持主入口只做流程编排。
- `npm run smoke:long-file-budget` 是代码膨胀守门 smoke：超过阈值且未被 PROJECT.md 跟踪的长文件应让验证失败，从而自动触发模块化、去重或任务补录。
- Computer Use 必须走 window-based 主路径：观察、grounding、坐标映射和动作执行都绑定目标窗口/窗口内容坐标，而不是全屏全局猜测；并行长测必须隔离目标窗口、输入通道和 trace，不抢占用户真实鼠标键盘。

## 任务板

### T101 清空 src/shared 并收敛 src 边界

状态：已完成；`src/shared` 已物理删除，所有旧共享协议已迁入 package/runtime contract 或能力 package，执行编排进入 runtime，boundary smoke 已阻止 `src/shared` 复活。本任务目标是把 `src/shared` 彻底清空：共享协议进入 `packages/contracts/runtime` 或后续 `packages/contracts/*`，执行逻辑进入 `src/runtime/*`，界面逻辑进入 `src/ui/*`。`shared` 这个名字只说明“被多个地方 import”，没有说明 owner、稳定性、依赖方向和安全边界，容易变成杂物间；后续新增代码禁止进入 `src/shared`。

正式原则：

- `src/` 只保留产品实现边界：`src/ui` 是前端产品 app，`src/runtime` 是本地 runtime/gateway/server/adapters。
- 跨 UI/runtime 的稳定协议不放在 `src/shared`，应进入 `packages/contracts/runtime/*`，后续如 T100 落地物理目录，可迁入 `packages/contracts/*`。
- 有执行行为、provider 选择、调用编排、文件/网络/AgentServer 交互的逻辑不放在 shared；它属于 `src/runtime/*`。
- UI state、展示转换、交互模型、React 组件和用户可见 presentation helper 不放在 shared；它属于 `src/ui/*` 或 `packages/presentation/*`。
- packages 不能反向 import `src/shared`。如果 package 需要类型或 fixture，应从 package 自身或 `packages/contracts/runtime` 获取。
- `src/shared` 不保留兼容 re-export；module-boundary smoke 禁止新增 `src/shared/**`。

当前 `src/shared` 文件归宿：

- `src/shared/agentHandoff.ts` -> `packages/contracts/runtime/handoff.ts`：AgentServer handoff source、默认 URL/timeout、shared handoff contract 和 source metadata。
- `src/shared/agentHandoffPayload.ts` -> `packages/contracts/runtime/handoff-payload.ts`：UI/CLI/runtime handoff payload contract、verification/human approval/failure recovery policy set。
- `src/shared/capabilityRegistry.ts` -> `packages/contracts/runtime/capabilities.ts`：capability summary/contract/registry metadata；后续结合 T100 的 lifecycle metadata 和 skill/observe/action/verifier/presentation taxonomy。
- `src/shared/senseProvider.ts` -> `packages/contracts/runtime/observe.ts`：rename sense -> observe，保留 provider capability brief、input modality、request/response、safety/privacy boundary 等纯 contract。
- `src/shared/senseOrchestration.ts` -> 拆分：纯 invocation plan/record 类型进入 `packages/contracts/runtime/observe.ts`；provider 选择和 `runSenseInvocationPlan` 执行逻辑进入 `src/runtime/observe/orchestration.ts`。
- `src/shared/verifiers/agentRubric.ts` -> `packages/verifiers/agent-rubric/index.ts` 或 `packages/verifiers/agent-rubric/contracts.ts`：agent rubric verifier request/result/provider contract 和 mock provider；`packages/verifiers/agent-rubric/fixture.ts` 不再反向 import `src/shared`。
- 对应 tests 迁到目标文件旁边：contract tests 进入 `packages/contracts/runtime/*`，runtime orchestration tests 进入 `src/runtime/observe/*`，verifier tests 进入 `packages/verifiers/agent-rubric/*`。

最终 `src` 目录视图：

```text
src/
  ui/          product app: React, app state, UI adapters, user interactions
  runtime/     local runtime: gateway, server, adapters, execution orchestration
```

已完成迁移：

- `agentHandoff` / `agentHandoffPayload` / `capabilityRegistry` 迁入 `packages/contracts/runtime/{handoff,handoff-payload,capabilities}.ts`，UI/runtime imports 已改为 package subpath。
- `senseProvider` contract 迁入 `packages/contracts/runtime/observe.ts`，`senseOrchestration` 的执行编排迁入 `src/runtime/observe/orchestration.ts`。
- `agentRubric` 迁入 `packages/verifiers/agent-rubric/index.ts`，fixture 不再反向依赖 `src/shared`。
- `src/shared` 目录和旧 tests 已删除。
- docs 与 module-boundary smoke 已更新为“共享协议进 packages contract，执行逻辑进 runtime，界面逻辑进 ui”。

Todo：

- [x] 新增 `packages/contracts/runtime/handoff.ts` 和 `handoff-payload.ts`，迁移 `agentHandoff` / `agentHandoffPayload` contract 与 tests；更新 UI/runtime imports。
- [x] 新增 `packages/contracts/runtime/capabilities.ts`，迁移 capability summary/contract/registry metadata 与 tests；和 T100 lifecycle metadata 对齐。
- [x] 新增 `packages/contracts/runtime/observe.ts`，迁移 sense provider contract 并 rename 为 observe terminology，保留旧 sense 字段兼容策略。
- [x] 新增 `src/runtime/observe/orchestration.ts`，承接 observe invocation provider 选择与运行逻辑；更新 runtime 调用方和 tests。
- [x] 迁移 `src/shared/verifiers/agentRubric.ts` 到 `packages/verifiers/agent-rubric`，修复 `packages/verifiers/agent-rubric/fixture.ts` 的反向依赖。
- [x] 不保留 `src/shared/*` 临时 re-export；所有生产 import 已转向新入口。
- [x] 删除 `src/shared` 目录及其 tests。
- [x] 扩展 `tools/check-module-boundaries.ts`：禁止新增 `src/shared/**`，禁止 `packages/**` import `src/**`，并检查 top-level package lifecycle metadata。
- [x] 更新 `docs/Extending.md`、`packages/README.md`、`docs/README.md`、`docs/Architecture.md`：新增能力决策树明确 contract/runtime/ui 三分法。

验收标准：

- [x] `find src/shared` 返回空或目录不存在；没有生产代码从 `src/shared` import。
- [x] `packages/**` 不再 import `src/shared/**` 或任何 `src/**` 私有文件。
- [x] UI/runtime 共享类型全部来自 `packages/contracts/runtime/*` 或公开 package exports。
- [x] Observe 命名替代 sense 命名进入新 contract；旧 sense 命名只作为兼容字段或能力 id 兼容存在。
- [x] `npm run smoke:module-boundaries` 能阻止新增 `src/shared` 文件和 package 反向依赖。
- [x] `npm run typecheck`、相关 package/runtime tests、`npm run smoke:runtime-contracts`、`npm run smoke:module-boundaries` 通过。

### T100 Packages 能力分层与目录组织原则

状态：已完成；`packages/tools` 已删除并迁入 `packages/skills/tool_skills`，`packages/senses/vision-sense` 已迁入 `packages/observe/vision`，package lifecycle metadata、owner note、scaffold template、文档和 boundary smoke 已落地。本任务固化 packages taxonomy、owner 边界和渐进迁移计划。当前 `packages` 已经包含 actions、skills、verifiers、ui-components、runtime-contract、scenario-core、design-system、artifact-preview、object-references、conversation-policy-python、computer-use、observe 等能力。正式方向是：`senses` 迁移为更直观的 `observe`；取消泛化顶层 `tools`；凡是通过 `SKILL.md` 被 agent 使用的能力入口统一归入 `packages/skills`；有副作用的真实执行 provider 继续归入 `packages/actions`，由 action contract 统一承载 approval、trace、sandbox、rollback 和 safety guard。

正式原则：

- 不按技术栈组织 package，优先按 agent 能力生命周期组织：`contract -> reason -> skill -> observe -> act -> verify/evaluate -> present`。技术栈只作为 package 内部实现细节，例如 Python/TypeScript/native adapter。
- `Observe` 和 `Sense` 合并成一个概念：对外目录使用 `packages/observe`，语义是 observe layer。它只把外部环境、文件、图像、网页、仪器状态或其它模态转换成可审计 observation，不产生副作用。旧 `packages/senses` 已删除。
- `Reasoning` 不建议做成一个泛化大包。稳定策略算法应拆成明确子域，例如 `conversation-policy-python`、未来的 `planning-policy`、`routing-policy`、`memory-policy`；开放式推理仍由 AgentServer 或 workspace task code 承担。
- `Skill` 是 agent 可读的能力入口。凡是主要通过 `SKILL.md` 被 agent 使用的能力，都应进入 `packages/skills`，再用子目录区分粒度：`tool_skills` 放单步/窄功能工具型 skill，`pipeline_skills` 放多步流程型 skill，`domain_skills` 放领域知识/方法型 skill，`meta_skills` 放能力选择、调试、沉淀和自进化工作流。
- 顶层 `tools` 不作为长期并列层保留。旧 `packages/tools` 应迁移为 `packages/skills/tool_skills` 的 skill-facing catalog；只有不面向 `SKILL.md`、而是 runtime 内部 adapter/SDK/helper 的代码，才留在 `actions`、`observe`、`support` 或具体 package 内部。
- `Action` 只放会改变环境或执行外部副作用的 provider，例如 Computer Use、浏览器动作、文件写入、notebook/kernel、远程服务调用、未来实验设备控制。安全策略、approval、trace 和回滚提示必须是 action contract 的一部分。
- `Presentation` 建议统一称为 `presentation` 或 `views`，长期把 `ui-components` 和 `interactive-views` 收敛到同一个语义层：它们负责 artifact render、交互事件和 object refs，不承担 action provider 或 verifier verdict。
- `Verifiers` 建议升级语义为 `evaluate` 层，但目录可先保留 `verifiers` 兼容。它负责 result/trace/artifact/state 的 verdict、critique、reward、repair hints 和 evidence refs。
- `Contracts` 必须独立于 UI/runtime 私有实现。共享 artifact、object ref、runtime event、verification、scenario、presentation manifest 等类型应进入 contract package 或各能力 public exports，禁止 packages 反向 import `src/ui` / `src/runtime`。

目标长期目录视图：

```text
packages/contracts/              stable cross-package contracts
packages/reasoning/              deterministic policy engines and planners
packages/skills/                 SKILL.md-facing abilities and catalogs
packages/skills/tool_skills/      single-purpose tool skills
packages/skills/pipeline_skills/  multi-step workflow skills
packages/skills/domain_skills/    domain methods and reusable scientific protocols
packages/skills/meta_skills/      skill authoring, debugging, promotion, and routing skills
packages/observe/                observe layer: environment/modality -> observation
packages/actions/                side-effecting action providers
packages/verifiers/              evaluate layer: result/trace/state -> verdict/critique/evidence
packages/presentation/           artifact renderers, interactive views, design primitives
packages/scenarios/              scenario compilation, validation, runtime smoke fixtures
packages/support/                preview/reference helpers and migration compatibility shims
```

当前包到长期目录的目标映射：

- `packages/contracts/runtime`：contracts 第一块真相源；声明 `lifecycleLayer=contracts`。
- `packages/scenarios/core`：负责 scenario/package 编译、质量门和运行时 smoke，不放 UI renderer 或 action provider。
- `packages/reasoning/conversation-policy`：继续作为多轮策略算法唯一真相源，算法优先 Python 实现。
- `packages/skills` -> 保留为 skill-facing 总入口，并拆出 `tool_skills`、`pipeline_skills`、`domain_skills`、`meta_skills`；现有 `installed/*` 可以先保留，后续按 skill 类型逐步归档。`SKILL.md` 是这里的核心入口形态。
- `packages/senses/vision-sense` -> 已迁移为 `packages/observe/vision`，保留 observe-only 语义。
- `packages/actions/computer-use`：Computer Use Python action loop、manifest、safety 和 trace 已收敛到同一个 action provider 目录；不再保留顶层 `packages/computer-use`。
- `packages/tools` -> 已迁移为 `packages/skills/tool_skills`；如果其中某个 tool 会改变环境，应拆成 `skills/tool_skills/*` 的 `SKILL.md` 入口加 `actions/*` 的执行 provider，而不是把副作用实现藏在 skill 目录。
- `packages/verifiers` -> 先保留，长期可提供 `packages/evaluate` alias；不要把 verifier 混入 presentation 或 runtime gateway。
- `packages/presentation/{components,interactive-views,design-system}`：artifact renderer、interactive view alias 和低层 design primitives。
- `packages/support/{artifact-preview,object-references}`：preview/reference helper；如果发现纯类型/规范化契约，继续上移到 `contracts`。

迁移策略：

- 第一阶段已完成：文档、owner note、boundary smoke 和 lifecycle metadata 已落地。
- 第二阶段已完成第一批物理迁移：`packages/senses/vision-sense` -> `packages/observe/vision`，`packages/tools` -> `packages/skills/tool_skills`。
- 第三阶段已完成当前 repo imports 迁移：runtime、tests、docs、catalog generator 和 package-lock 不再依赖旧目录。
- 第四阶段已完成 owner 收敛：Computer Use 的实现和 manifest 真相源是 `packages/actions/computer-use`；renderer registry 真相源是 `packages/presentation/components`，`packages/presentation/interactive-views` 作为语义别名；纯 contract 类型进入 `packages/contracts/runtime`，artifact/object helper 留在 support packages。
- 第五阶段已完成长期目录物理迁移：contracts、reasoning、scenarios、presentation、support 都进入目标目录视图；保留 npm package name/componentId 兼容，不保留旧顶层目录。

Todo：

- [x] 在 `packages/README.md` 增加 lifecycle taxonomy 表：每层的职责、允许依赖、禁止依赖、典型输入输出、对应验证命令和新增 package 落点，并明确 `observe` 替代 `senses`、`skills/tool_skills` 替代顶层 `tools`。
- [x] 为新增/迁移目录补齐 owner note：`packages/observe/README.md`、`packages/skills/{tool_skills,pipeline_skills,domain_skills,meta_skills}/README.md`。
- [x] 在 top-level package manifest 中增加轻量 metadata，例如 `sciforge.lifecycleLayer`、`sciforge.skillKind`、`sciforge.skillFacing`、`sciforge.sideEffects`、`sciforge.publicContract`、`sciforge.runtimeAdapter`，让 registry 和 smoke 可以自动检查边界。
- [x] 扩展 `tools/check-module-boundaries.ts`：按 lifecycle metadata 校验 top-level package，并禁止 `src/shared` 和 package -> src 私有反向依赖。
- [x] 收敛 Computer Use：Python action loop、contract、safety、trace 与 action manifest 都以 `packages/actions/computer-use` 为唯一真相源；runtime adapter 不复制 provider loop。
- [x] 收敛 presentation：当前 registry 真相源是 `packages/presentation/components`；`packages/presentation/interactive-views` 是语义别名；`packages/presentation/design-system` 只做 primitives/tokens。
- [x] 给 `packages/skills/tool_skills`、`packages/skills/pipeline_skills`、`packages/skills/domain_skills`、`packages/skills/meta_skills` 建立目录规则：skill 描述策略和调用边界，action provider 承担副作用，observe provider 承担环境读取，verifier 承担评估。
- [x] 迁移旧 `packages/tools` 到 `packages/skills/tool_skills`，并让 catalog generator/checker 的唯一真相源指向新目录。
- [x] 迁移旧 `packages/senses/vision-sense` 到 `packages/observe/vision`，并更新 runtime adapter、README、package paths、smoke 和 Python tests 中的命名。
- [x] 将 `artifact-preview`、`object-references` 与 `runtime-contract` 的关系写清楚：纯 contract 进入 `runtime-contract`，便捷 helper、normalizer 和转换函数保留 support package，避免 contract/helper 混杂。
- [x] 新增 package scaffold 模板：`packages/support/templates/package-scaffold` 根据 lifecycle layer 和 skill kind 提供 README、manifest metadata、exports 和 smoke placeholder，减少开发者凭感觉放目录。
- [x] 更新 `docs/Extending.md`：把新增能力的决策树改为“先判断是否是 SKILL.md-facing 能力，再选 lifecycle layer，再选集成等级，再选 runtime adapter”，并补充 Observe/Skill/Action/Verifier/Presentation 的区别。

验收标准：

- [x] 新开发者看 `packages/README.md` 能在 2 分钟内判断一个新能力应该进入哪个 layer，以及它允许依赖哪些 package。
- [x] 新增 top-level package 都带 `lifecycleLayer` metadata；新增 skill kind 目录有 owner note；module-boundary smoke 能发现明显放错层或反向依赖。
- [x] `computer-use`、`vision-sense -> observe/vision`、`ui-components/interactive-views`、`skills/tool_skills` 这几组容易混淆的边界都有明确 owner note。
- [x] 顶层 `packages/tools` 不再作为新增能力落点；新增 SKILL.md-facing 能力必须进入 `packages/skills/{tool_skills,pipeline_skills,domain_skills,meta_skills}`。
- [x] 顶层 `packages/senses` 不再作为新增 observe 能力落点；新增观察能力必须进入 `packages/observe`。
- [x] 本轮已完成 `packages/tools` 与 `packages/senses/vision-sense` 的物理迁移；`contracts/presentation/support` 已明确 owner 和兼容别名，物理目录重命名可作为后续兼容迁移。

### T099 代码边界治理与模块化重组

状态：进行中；本轮已完成 contract/package boundary、UI 大文件两轮拆分、runtime gateway/project/server 三轮拆分、文档漂移修正和 module boundary smoke。`packages/support/object-references` / `packages/support/artifact-preview` 已不再反向依赖 `src/ui/src/domain.ts`；`domain.ts` 已降到约 658 行，稳定 session/message/stream/view/execution/event contract 已下沉到 `packages/contracts/runtime/*`；`ChatPanel.tsx`、`SciForgeApp.tsx`、`ResultsRenderer.tsx`、`Dashboard.tsx`、`ShellPanels.tsx`、`task-projects.ts`、`generation-gateway.ts` 已降到 1500 行以下；`workspace-server.ts` 已抽出 file preview 与 workspace open gateway 模块但仍略高于 1500 行。本任务基于 2026-05-09 对 `src` 和 `packages` 的结构巡检，目标是把“产品 app、runtime 执行壳、策略算法、能力 package、稳定 contract、交互 renderer”拆成更清晰的所有权边界，让多人并行开发时可以按目录负责、按 contract 集成、按 smoke 守门，而不是在 `SciForgeApp.tsx`、`ChatPanel.tsx`、`workspace-server.ts`、`generation-gateway.ts` 这类大入口文件里互相踩线。

当前观察：

- `src/ui/src` 是最大协作热点，既包含 app shell、chat、results、scenario builder、feedback、workspace state、runtime client，也包含大量共享 domain 类型。需要把 feature state、展示组件、transport client 和稳定 contract 分层，否则前端多人协作容易集中冲突。
- 当前长文件 watch list 已经暴露主要拆分点：`src/ui/src/app/ChatPanel.tsx`、`src/ui/src/app/SciForgeApp.tsx`、`src/ui/src/app/ResultsRenderer.tsx`、`src/ui/src/domain.ts`、`src/ui/src/app/appShell/ShellPanels.tsx`、`src/ui/src/app/Dashboard.tsx`，以及 runtime 侧的 `src/runtime/workspace-server.ts`、`src/runtime/generation-gateway.ts`、`src/runtime/task-projects.ts`、`src/runtime/workspace-task-input.ts`。
- `packages` 的总体方向已经收敛：`conversation-policy-python` 负责策略算法，`scenario-core` 负责无 UI compiler，`ui-components` 负责 renderer registry，`interactive-views` 是语义别名，`design-system` 负责 primitives，`object-references` 负责长期引用 helper，`computer-use` / `observe` / `actions` / `verifiers` 负责能力闭环。package 反向依赖 app 私有类型已由 boundary smoke 守住。
- UI 里存在多处深层相对路径直接 import `packages/*`，例如 `src/ui/src/componentWorkbenchDemo.ts`、`src/ui/src/scenarioCompiler/*`、`src/ui/src/app/*`。这能工作，但会让 package exports、边界 smoke 和 ownership 变弱；长期应通过 package entrypoint/subpath exports 或专门 app adapter 消费。
- `src/runtime/vision-sense` 与 `packages/observe/vision`、`src/runtime/computer-use` 与 `packages/actions/computer-use` 已形成“runtime bridge + provider package”的雏形，需要明确哪边拥有算法/contract，哪边只负责 SciForge Gateway 适配，避免未来继续复制 planner/grounding/action loop。
- `docs/Extending.md` 已更新为当前 verifier/runtime contract 真相源，旧 `src/shared` ABI 不再作为新增能力入口。

目标边界：

- `packages/*` 只依赖稳定 package 或标准库，不反向 import `src/ui` / `src/runtime`。需要共享的 `RuntimeArtifact`、`ObjectReference`、`PreviewDescriptor`、session/message/stream 最小 contract，应进入新的稳定 contract package 或现有 contract package 的明确子域。
- `src/runtime` 是执行壳和服务边界：HTTP route、GatewayRequest enrichment、AgentServer adapter、workspace task runner、WorkEvidence guard、file preview、config、feedback repair 等按模块拆开；入口文件只做 env 读取、route 注册和流程编排。
- `src/ui/src` 是产品 app：app shell、chat、results、feedback、scenario builder、workspace settings、runtime health 等按 feature slice 组织；跨 feature 只通过 domain contract、store action 和 typed client 交流。
- `packages/reasoning/conversation-policy` 继续是策略算法唯一真相源；TypeScript 只做字段透传、执行、渲染和 fail-closed guard。
- `packages/presentation/components` / `packages/presentation/interactive-views` 只渲染 artifact 并发出声明事件，不直接写 workspace、不调用 AgentServer、不承担 verifier verdict。

Todo：

- [x] 新增 package/module dependency boundary smoke：禁止 `packages/*` import `src/ui/*`、`src/runtime/*`，禁止 UI 绕过 package exports 深 import package internals；允许的兼容例外必须在 allowlist 中写明迁移任务和到期条件。已新增 `tools/check-module-boundaries.ts`、`npm run smoke:module-boundaries`，并接入 `verify:fast`；当前 UI 深 import 历史例外以 warning 输出。
- [x] 抽出稳定 app/runtime contract：把 `RuntimeArtifact`、`ObjectReference`、`PreviewDescriptor`、必要 session/message/stream 类型从 `src/ui/src/domain.ts` 移到独立 contract 入口；更新 `packages/support/object-references`、`packages/support/artifact-preview` 和 UI/runtime 调用方，`src/ui/src/domain.ts` 只保留兼容 re-export 和 UI 局部 factories。已新增 `packages/contracts/runtime/app.ts`、`artifacts.ts`、`preview.ts`、`references.ts` 并让 package 通过 `@sciforge-ui/runtime-contract/*` 消费稳定类型；session/message/stream 后续继续从 `domain.ts` 拆。
- [x] 拆分 `src/ui/src/domain.ts`：按 `artifact-contracts`、`session-contracts`、`message-contracts`、`runtime-events`、`factories` 组织，确保 packages 消费纯类型 contract，UI feature 消费 app-level helpers。已新增 `packages/contracts/runtime/messages.ts`、`session.ts`、`stream.ts`、`execution.ts`、`events.ts`、`view.ts`，`domain.ts` 保留兼容 re-export 和 UI helper。
- [x] 收敛 `src/ui/src/scenarioCompiler/*` wrapper：优先从 `@sciforge/scenario-core` entrypoint 或明确 subpath exports 导入；如需要新增 subpath exports，在 `packages/scenarios/core/package.json` 和 tests 中固化，避免 UI 维护第二套 compiler facade。已为 `@sciforge/scenario-core` 增加 compiler/registry/quality/runtime subpath exports，UI bridge 不再深 import `packages/scenarios/core/src/*`。
- [x] 拆分 `src/ui/src/app/SciForgeApp.tsx`：把 workspace/session state、scenario builder state、feedback inbox、settings/config、navigation/search、runtime health 分别沉到 `appShell` hooks/actions 或 feature containers；`SciForgeApp` 只做顶层 composition。第一轮已抽出 `src/ui/src/app/appShell/appHelpers.ts`，文件降到约 1431 行；更细的 feature container 继续后续拆。
- [x] 拆分 `src/ui/src/app/ChatPanel.tsx`：将 composer、message list、running work process、reference chips、handoff/autocomplete、message actions 和 keyboard/focus handlers 拆成 `app/chat/*` 模块，并保留现有 tests 覆盖主流程。已抽出 `ContextWindowMeter.tsx`、`ReferenceChips.tsx`、`RunExecutionProcess.tsx`、`runPresentation.ts`，文件降到约 1249 行。
- [x] 拆分 `src/ui/src/app/ResultsRenderer.tsx`：把 artifact normalization、view plan resolution、preview/open actions、workspace object preview、legacy visualization adapters 和 renderer shell 分开；新 renderer 只通过 `packages/presentation/components` contract 接入。第一轮已抽出 `src/ui/src/app/results/resultArtifactHelpers.ts`，文件降到约 1361 行。
- [x] 拆分 `src/ui/src/app/appShell/ShellPanels.tsx` 与 `Dashboard.tsx`：把 settings dialog、sidebar/topbar、session list、health cards 和 dashboard data projection 分离，减少 app shell 与业务 feature 互相 import。已新增 `dashboardModels.ts`、`explorerModels.ts`、`settingsModels.ts` 和对应 tests，`Dashboard.tsx` 降到约 756 行，`ShellPanels.tsx` 降到约 998 行。
- [ ] 拆分 `src/runtime/workspace-server.ts`：按 `routes/config`、`routes/workspace-state`、`routes/feedback-repair`、`routes/file-preview`、`routes/scenario-library`、`routes/workspace-open`、`server/http` 组织；入口只注册 routes 和启动 server。已抽出 `src/runtime/server/file-preview.ts` 与 `src/runtime/server/workspace-open.ts`，文件降到约 1560 行；后续继续拆 config/workspace-state/feedback/scenario routes。
- [x] 拆分 `src/runtime/generation-gateway.ts`：把 conversation-policy preflight、AgentServer adapter orchestration、direct-context fast path、generated task path、verification/finalization、telemetry emission 明确成 state-machine steps，主文件只表达流程顺序。已抽出 `src/runtime/gateway/agent-backend-config.ts`、`runtime-routing.ts`、`agentserver-stream.ts`、`generated-task-response-text.ts`，文件降到约 1340 行；后续可继续把 verification/finalization 拆成更细 state-machine step，但已退出长文件风险区。
- [x] 拆分 `src/runtime/task-projects.ts`：把 schema/types、project persistence、stage persistence、guidance adoption helpers、handoff summary、promotion proposal 适配拆成语义文件；保留兼容 exports，避免 T097/T096 调用方一次性大迁移。已抽出 `src/runtime/task-project-contracts.ts`、`task-project-store.ts`、`task-project-state.ts`、`task-project-handoff.ts` 并保留 `task-projects.ts` re-export，文件降到约 945 行；后续可继续拆 stage-level handoff builder。
- [x] 明确 Computer Use / Vision Sense 双目录职责：`packages/actions/computer-use` 与 `packages/observe/vision` 拥有算法、contract 和 pytest；`src/runtime/computer-use` 与 `src/runtime/vision-sense` 只拥有 Gateway adapter、workspace refs、runtime events 和安全 guard 接入。
- [x] 更新 `docs/Extending.md`：修正 verifier ABI 真相源，改为当前 `src/runtime/runtime-types.ts` / `src/runtime/gateway/verification-results.ts` / `packages/verifiers` contract，避免新能力接入沿用已删除文件。同步更新 `docs/README.md`。
- [x] 为每个主要目录补轻量 owner note：`src/ui/src/app/README.md`、`src/runtime/README.md`、`packages/README.md` 或等效 architecture note，说明新增代码应该放在哪里、不能 import 什么、对应验证命令是什么。
- [x] 在 `npm run packages:check` 或新增 `npm run smoke:module-boundaries` 中串起 package boundary、ui-components boundary、long-file-budget 和 stale-doc 检查；每次模块化迁移都必须跑 `npm run typecheck`、相关 unit tests 和对应 smoke。

线程状态：

- [x] Thread A - Contract/package boundary：已完成；新增 `packages/contracts/runtime/app.ts`、`artifacts.ts`、`preview.ts`、`references.ts`，更新 `index.ts` 和 subpath exports；`packages/support/object-references`、`packages/support/artifact-preview` 改为依赖 `@sciforge-ui/runtime-contract/*`，`src/ui/src/domain.ts` 保持兼容 re-export。验证命令：`node --import tsx --test packages/support/object-references/index.test.ts packages/support/artifact-preview/index.test.ts`、`npm run smoke:object-references`、`npm run smoke:runtime-contracts`、`npm run typecheck`。
- [x] Thread B - UI feature split：已完成第一轮；`ChatPanel.tsx` 抽出 `ContextWindowMeter.tsx`、`ReferenceChips.tsx`、`RunExecutionProcess.tsx`、`runPresentation.ts`，`ResultsRenderer.tsx` 抽出 `results/resultArtifactHelpers.ts`，`SciForgeApp.tsx` 抽出 `appShell/appHelpers.ts`。验证命令：`node --import tsx --test src/ui/src/app/ChatPanel.test.ts src/ui/src/app/ResultsRenderer.test.ts src/ui/src/app/chat/*.test.ts src/ui/src/app/results/*.test.ts`、`npm run typecheck`、`npm run build`。
- [x] Thread C - Runtime service split first pass：已完成第一轮；新增 `src/runtime/task-project-contracts.ts` 和 `src/runtime/gateway/agent-backend-config.ts`，`task-projects.ts` 继续兼容 re-export，`generation-gateway.ts` 保留现有行为。验证命令：`node --import tsx --test src/runtime/task-projects.test.ts`、`npx tsx tests/smoke/smoke-runtime-gateway-modules.ts`、`npm run typecheck`。
- [x] Thread D/E - Documentation and boundary smoke：已完成；新增 `tools/check-module-boundaries.ts`、`npm run smoke:module-boundaries` 并接入 `verify:fast`，修正文档 verifier ABI，补 `src/runtime/README.md`、`src/ui/src/app/README.md` 和 `packages/README.md` owner note。验证命令：`npm run smoke:module-boundaries`、`npm run smoke:docs-scenario-package`、`npm run smoke:long-file-budget`。
- [x] Thread A2 - Domain/session contract split：已完成；新增 `packages/contracts/runtime/messages.ts`、`session.ts`、`stream.ts`、`execution.ts`、`events.ts`、`view.ts`，更新 package exports 和 README，`src/ui/src/domain.ts` 保持兼容 re-export。验证命令：`npm run typecheck`、`npm run smoke:runtime-contracts`、`npm run smoke:module-boundaries`。
- [x] Thread B2 - UI app shell split：已完成；新增 `src/ui/src/app/appShell/dashboardModels.ts`、`explorerModels.ts`、`settingsModels.ts` 及 tests，进一步拆分 `Dashboard.tsx` 和 `ShellPanels.tsx`。验证命令：`node --import tsx --test src/ui/src/app/appShell/*.test.ts src/ui/src/app/chat/*.test.ts src/ui/src/app/results/*.test.ts`、`npm run typecheck`、`npm run build`。
- [x] Thread C2 - Runtime server split：已完成；新增 `src/runtime/server/file-preview.ts`，从 `workspace-server.ts` 抽出 preview descriptor、derivative、range streaming、mime/language/schema/hash helpers，HTTP API 行为保持兼容。验证命令：`npx tsx tests/smoke/smoke-workspace-file-api.ts`、`npx tsx tests/smoke/smoke-runtime-gateway-modules.ts`、`npm run typecheck`。
- [x] Thread C3 - Runtime workspace open split：已完成；新增 `src/runtime/server/workspace-open.ts`，从 `workspace-server.ts` 抽出 Workspace Open Gateway 路径解析、临时预览白名单、高风险扩展名拦截和 dry-run/open 调用，HTTP 响应保持兼容。验证命令：`npm run typecheck`、`npx tsx tests/smoke/smoke-workspace-file-api.ts`、`npx tsx tests/smoke/smoke-workspace-open-gateway.ts`、`npm run smoke:long-file-budget`。
- [x] Thread G3 - Runtime generation gateway split：已完成；新增 `src/runtime/gateway/runtime-routing.ts`、`agentserver-stream.ts`、`generated-task-response-text.ts`，从 `generation-gateway.ts` 抽出 runtime profile/plan ref/payload failure 判断、AgentServer streaming guard 与 generated task response text 解析，文件降到约 1340 行。验证命令：`npm run typecheck`、`npx tsx tests/smoke/smoke-runtime-gateway-modules.ts`、`npm run smoke:long-file-budget`。
- [x] Thread TP3 - Task projects persistence/handoff split：已完成；新增 `src/runtime/task-project-store.ts`、`task-project-state.ts`、`task-project-handoff.ts`，从 `task-projects.ts` 抽出路径安全、JSON 读写、状态计算、stage 查找、项目级 handoff 摘要构造，文件降到约 945 行。验证命令：`npm run typecheck`、`npx tsx src/runtime/task-projects.test.ts`。
- [x] Scenario-core public export cleanup：已完成；`src/ui/src/scenarioCompiler/*` 和 `src/ui/src/scenarioSpecs.ts` 改走 `@sciforge/scenario-core/*` public subpath exports，减少 module-boundary warning。验证命令：`node --import tsx --test src/ui/src/scenarioCompiler/*.test.ts`、`npm run smoke:module-boundaries`、`npm run typecheck`。

并行写域建议：

- Thread A - Contract/package boundary：负责抽稳定 contract、修 `packages/support/object-references` / `packages/support/artifact-preview` 反向依赖、加 boundary smoke；不改 UI 视觉行为。
- Thread B - UI feature split：负责 `SciForgeApp.tsx`、`ChatPanel.tsx`、`ResultsRenderer.tsx`、`ShellPanels.tsx` 的纯结构拆分和 tests 迁移；不改 runtime gateway。
- Thread C - Runtime service split：负责 `workspace-server.ts`、`generation-gateway.ts`、`task-projects.ts` 拆分；不改 Python 策略算法。
- Thread D - Capability package alignment：负责 Computer Use / Vision Sense / verifier docs 与 package/runtime adapter 边界；不改 app shell。
- Thread E - Documentation and smoke：负责 architecture notes、stale doc 修复、module boundary smoke 和 CI script 串联；只做守门和文档，不做大规模搬代码。

验收标准：

- [x] `packages/*` 不再依赖 `src/ui` / `src/runtime` 私有文件；共享类型来自稳定 contract package 或公开 package exports。
- [ ] 主要 app/runtime 入口文件回到编排职责，超过 1500 行的非生成源码均有已执行的语义拆分或明确豁免。本轮已拆 `ChatPanel`、`SciForgeApp`、`ResultsRenderer`、`Dashboard`、`ShellPanels`、`task-projects`、`workspace-server`、`generation-gateway`；剩余超过 1500 行的是 `workspace-server.ts`（约 1560 行），已有 T099 跟踪并需继续拆 config/workspace-state/feedback/scenario routes。
- [x] 新增能力、renderer、scenario、runtime route、chat UI feature 时能根据目录说明找到唯一落点，不需要修改无关大入口文件。`packages/README.md` 与 `packages/support/templates/package-scaffold` 已补单一真相源和 package scaffold。
- [x] `npm run typecheck`、`npm run test`、`npm run packages:check`、`npm run smoke:long-file-budget` 和新增 module boundary smoke 通过。本轮额外验证 `npm run build`、`npm run smoke:runtime-contracts`、`npm run smoke:object-references`、`npm run smoke:docs-scenario-package`、`npx tsx tests/smoke/smoke-runtime-gateway-modules.ts` 通过。

### T098 Conversation Latency Policy 与多轮快速响应策略集中化

状态：进行中；Thread A-F 已完成，本轮已完成单一真相源清理：Python conversation-policy 继续作为 latency/response/background/cache 策略唯一真相源，TypeScript 已移除遗留 capability/verification 策略生成入口，UI handoff 只透传显式配置，runtime verification 不再用 prompt 关键词推断风险。剩余工作集中在多轮 direct-context 快速路径真实运行优化，以及真实 backend 慢/429/timeout/取消路径的长跑观察。目标是把“多轮对话什么时候直接回答、什么时候启动 workspace task、什么时候先给快速可读回复、什么时候后台补全、什么时候阻塞 verification/context compaction”集中到 Python conversation-policy 中，形成跨 scenario、跨 backend、跨任务类型的通用低等待策略。当前系统已经有 Python conversation-policy、execution classifier、context policy、memory/handoff/recovery、WorkEvidence 和主对话 WorkEvent，但多轮 direct-context 真实路径、真实 provider 慢/429/timeout/取消路径仍需要长跑校准。本任务要把这些策略收拢为可测试、可调参、可审计的 `latencyPolicy` / `responsePlan` / `backgroundPlan`，TypeScript 只负责执行策略结果、展示状态和保留 runtime safety guard。

范围边界：

- Python 是策略唯一真相源：首包 SLA、是否 direct-context、是否允许后台补全、是否阻塞 verification、是否阻塞 context compaction、是否复用缓存、是否降级为轻量回答等策略判断都应在 `packages/reasoning/conversation-policy` 中产生。
- TypeScript 是执行壳：`runOrchestrator`、`sciforgeToolsClient`、runtime gateway 和 UI 只消费 Python policy 输出，负责 abort/retry、stream、workspace refs、UI 状态和高风险 safety enforcement，不复制 prompt regex、复杂度评分或策略推断。
- 高风险 action 仍必须 fail-closed：低等待优化不能绕过 human approval、危险动作 verification、artifact/schema guard、WorkEvidence guard 或用户显式要求的强验证。
- 低风险/信息型/继续型任务应优先降低体感等待：允许先返回短可读 answer/status，再让后台 stage 补 artifact、验证、报告或更完整结果。
- 所有策略必须面向通用任务形态，不能为某个 scenario、provider、prompt、论文站点、国家新闻、固定文案或截图案例写分支。
- 任务完成后必须更新本节 `状态`、Todo checkbox、验收结果和剩余风险；任何线程完成子任务后都要在本节写入实际文件路径、测试命令和未完成项。

建议新增/扩展的策略 contract：

```json
{
  "latencyPolicy": {
    "firstVisibleResponseMs": 8000,
    "firstEventWarningMs": 12000,
    "silentRetryMs": 45000,
    "allowBackgroundCompletion": true,
    "blockOnContextCompaction": false,
    "blockOnVerification": false,
    "reason": "low-risk continuation can answer from current context while background evidence completes"
  },
  "responsePlan": {
    "initialResponseMode": "direct-context-answer | quick-status | streaming-draft | wait-for-result",
    "finalizationMode": "append-final | replace-draft | update-artifacts-only",
    "userVisibleProgress": ["planning", "search", "fetch", "validate", "emit"],
    "fallbackMessagePolicy": "truthful-partial-with-next-step"
  },
  "backgroundPlan": {
    "enabled": true,
    "tasks": ["verification", "artifact-materialization", "report-expansion"],
    "handoffRefsRequired": true,
    "cancelOnNewUserTurn": false
  },
  "cachePolicy": {
    "reuseScenarioPlan": true,
    "reuseSkillPlan": true,
    "reuseReferenceDigests": true,
    "reuseLastSuccessfulStage": true
  }
}
```

Todo：

- [x] 在 `packages/reasoning/conversation-policy` 新增 `latency_policy.py`：输入 goalSnapshot、contextPolicy、executionModePlan、capabilityBrief、selected actions/verifiers、recent failures、context budget、current refs 和 user guidance，输出通用 `latencyPolicy`，覆盖 first visible response SLA、silent stream warning/retry、是否允许后台补全、context compaction 是否阻塞、verification 是否阻塞。
- [x] 新增 `response_plan.py` 或扩展 `service.py` 的 `userVisiblePlan`：输出 `initialResponseMode`、`finalizationMode`、`progressPhases`、`fallbackMessagePolicy` 和后台补全说明；要求 direct-context 和 low-risk continuation 可快速回复，multi-stage/high-risk/action 任务按策略等待或给明确进展。
- [x] 新增 `cache_policy.py`：集中判断 scenario plan、skill plan、UI plan、reference digest、artifact index、last successful stage 和 backend session 是否可复用；TypeScript 只执行缓存读取/写入，不自行判断复用资格。
- [x] 将 Python response schema、TS bridge normalizer 和 GatewayRequest enrichment 接入 `latencyPolicy`、`responsePlan`、`backgroundPlan`、`cachePolicy`；缺失时只能回落为安全默认值，不能在 TS 中用 prompt regex 重建策略。
- [x] 清理遗留 TS 策略源：`packages/contracts/runtime/capabilities.ts` 只保留 capability metadata 与 contract registry，旧 `buildCapabilityBrief` / prompt scoring / verifier selection / risk inference 已删除；未被生产路径引用的 verification policy builder 已删除，`sciforgeToolsClient` 不再合成 verification/human approval 默认策略，runtime verification risk 只看显式 policy、结构化 action/evidence 和 executionUnits。
- [x] 改造 `runOrchestrator` preflight compaction：由 `latencyPolicy.blockOnContextCompaction` 决定是否阻塞发送；允许后台预压缩/非阻塞压缩，把结果写入 stream event 和下一轮 context，而不是让普通追问卡在发送前。
- [x] 改造 `sciforgeToolsClient` 静默等待、45s 重连和 timeout 逻辑：阈值来自 `latencyPolicy`；UI 展示由 `responsePlan.userVisibleProgress` 和 T095 WorkEvent 消费，避免硬编码散在多个位置。
- [x] 改造 verification 使用方式：低风险回答不因 `unverified` / lightweight verification 阻塞用户可读回复；高风险 action、显式 human approval、危险 side effect 继续由 runtime verification gate fail-closed；Verification 只以结构化 badge/artifact/ref 进入 UI 和下一轮上下文。
- [x] 增加后台补全 runtime 协议：支持一个 run 先落地 initial assistant message，再通过 run update / artifact update / finalization event 追加最终结果；必须保留 runId、stage refs、WorkEvidence、verification refs 和 cancellation semantics。
- [x] 增加多轮 direct-context 快速路径：继续解释上一轮结果、询问文件位置、追问已有 artifact/claim/table 时，不启动完整 workspace task；若需要新外部 I/O 或新 artifact，再按 executionModePlan 走 thin adapter/single-stage/multi-stage。
- [x] 增加通用 fixtures 和 smoke：覆盖简单追问、上一轮 artifact 追问、低风险 current-events、文献检索、长报告、失败修复、高风险 action、context 接近阈值、backend silent stream、用户中途追加引导；断言策略来自 Python、TS 只透传执行。
- [x] 增加 telemetry/diagnostics：记录 time-to-first-visible-response、time-to-first-backend-event、context compaction wait、verification wait、background completion duration、cache hit/miss 和 fallback reason，输出为低噪声 WorkEvidence/Run diagnostics。

验收标准：

- [x] 任意 scenario 的低风险多轮追问能在策略 SLA 内出现用户可读反馈，且不丢失后续 artifact、verification、WorkEvidence 和 final answer。
- [x] Python conversation-policy 是 latency/response/cache/background 策略唯一真相源；TypeScript 中不新增 prompt/scenario/provider 专用策略分支。
- [x] context compaction、verification 和 artifact materialization 可以按策略后台执行；只有高风险 action、安全边界、schema/WorkEvidence fail-closed 才阻塞最终成功。
- [x] 后台补全不会制造幽灵状态：每次初始回复、后台 stage、最终更新都绑定 runId/stageId/ref，并能被下一轮上下文读取。
- [ ] 真实 backend 慢、无首事件、429、timeout、空结果、用户取消和中途追加引导都有通用恢复路径和 UI 状态。

验收命令：

- `python3 -m pytest packages/reasoning/conversation-policy/tests`
- `node --import tsx --test src/runtime/conversation-policy/*.test.ts`
- `node --import tsx --test src/ui/src/app/chat/*.test.ts src/ui/src/api/agentClient/*.test.ts`
- `npx tsx tests/smoke/smoke-t097-execution-mode-matrix.ts`
- `npx tsx tests/smoke/smoke-t096-work-evidence-provider-fixtures.ts`
- `npm run smoke:t098-latency`
- `node --import tsx --test packages/contracts/runtime/capabilities.test.ts src/ui/src/api/sciforgeToolsClient.policy.test.ts`
- `npx tsx tests/smoke/smoke-runtime-gateway-modules.ts`
- `npx tsx tests/smoke/smoke-browser-workflows.ts`
- `npx tsc --noEmit`
- `npm run build`

并行协调：

- Thread A/B 可以最先并行启动，二者只写 `packages/reasoning/conversation-policy/src/sciforge_conversation/*` 和 `packages/reasoning/conversation-policy/tests/*`；A 负责 latency 策略，B 负责 response/background/cache 策略，避免同时编辑同一个新文件。
- Thread C 在 A/B 的 response shape 基本稳定后启动；如果 A/B 尚未完成，C 只能先加向后兼容的 optional schema 和 fixture，不得臆造策略算法。
- Thread D 依赖 C 的 TS bridge 字段；在 C 合入前只允许准备 tests/harness，不要把策略判断写进 UI/runtime。
- Thread E 可以与 C/D 并行做 session transform 和 runtime event contract，但不得改 Python 策略；如需要新增策略字段，先在本节记录并与 A/B 对齐。
- Thread F 可以从第一天开始补 telemetry/smoke fixtures，但所有 assertions 必须验证“策略来自 Python response，TS 只执行/展示”，不能把测试写成固定 prompt 或固定场景快照。
- 所有线程都要遵守 disjoint write set：如果必须修改同一文件，先在本节“线程状态”写明冲突文件和合并顺序，再继续。
- 每个线程结束时必须更新本节：勾选完成项、补充实际修改文件、测试命令、失败/跳过原因、剩余风险；不能只在最终回复里说明。

线程状态：

- [x] Thread A - Python latency policy：已完成；新增 `packages/reasoning/conversation-policy/src/sciforge_conversation/latency_policy.py`，接入 `contracts.py` / `service.py` / `__init__.py`，新增 `packages/reasoning/conversation-policy/tests/test_latency_policy.py`。覆盖 direct context、low-risk continuation、light lookup、multi-stage project、repair、high-risk action、context near limit；验证命令 `cd packages/reasoning/conversation-policy && uv run --with pytest python -m pytest tests` 通过（67 passed）。剩余风险：本机 `python3` 是 3.9.6，低于包要求 `>=3.10`，直接运行 `python3 -m pytest packages/reasoning/conversation-policy/tests` 会在既有 `@dataclass(slots=True)` collection 阶段失败；需 CI/开发环境使用 Python 3.10+ 或 uv 托管解释器。
- [x] Thread B - Python response/background/cache plan：已完成；新增 `packages/reasoning/conversation-policy/src/sciforge_conversation/response_plan.py` 和 `packages/reasoning/conversation-policy/src/sciforge_conversation/cache_policy.py`，接入 `contracts.py` / `service.py` / `__init__.py`，新增 `packages/reasoning/conversation-policy/tests/test_response_cache_policy.py` 并更新 `test_contracts.py`。覆盖全部 execution mode 与 low/medium/high 风险等级，验证 responsePlan/backgroundPlan/cachePolicy 输出及 ref/artifact/stage/backend session 缓存复用/失效。验证命令 `python3 -m pytest packages/reasoning/conversation-policy/tests` 通过（67 passed）。剩余风险：TS bridge/runtime 尚未消费这些字段，后台补全 runId/stageId/ref 协议仍由后续线程完成。
- [x] Thread C - TypeScript bridge and request enrichment：已完成；更新 `src/runtime/conversation-policy/contracts.ts` / `apply.ts` normalizer 与 enrichment，透传 `latencyPolicy`、`responsePlan`、`backgroundPlan`、`cachePolicy` 到 `uiState.conversationPolicy` 和 `uiState.*Policy` 顶层稳定位置；缺失字段回落为 fail-closed 安全默认（verification/context compaction 阻塞、background/cache 不声明完成或复用）。更新 `src/runtime/gateway/context-envelope.ts` 和 `src/runtime/gateway/agentserver-prompts.ts` 只展示裁剪后的 `conversationPolicySummary`，未新增 prompt regex。新增 `src/runtime/conversation-policy/policy.test.ts` 覆盖字段透传、缺失默认、prompt/envelope 无整份策略复制。验证命令 `node --import tsx --test src/runtime/conversation-policy/*.test.ts` 通过（3 passed），`npx tsc --noEmit` 通过。剩余风险：runtime/UI 尚未按这些策略执行，后台补全 runId/stageId/ref 协议仍由 Thread D/E 完成。
- [x] Thread D - UI/runtime orchestration execution shell：已完成；新增 `src/ui/src/latencyPolicy.ts` 作为 TS 执行壳读取器，只消费 Python 输出的 `latencyPolicy` / `responsePlan` 字段，不做 prompt/scenario 策略推断。更新 `src/ui/src/app/chat/runOrchestrator.ts`，preflight context compaction 读取最近 policy 的 `blockOnContextCompaction`，为 `false` 时发送继续、压缩后台执行并通过 stream event 记录。更新 `src/ui/src/api/sciforgeToolsClient.ts`，silent wait warning、silent first-event retry 和可选 request timeout 从当前轮 `conversation-policy` stream event 的 `latencyPolicy` 更新，缺失时保留安全默认；`responsePlan.initialResponseMode` 生成通用 `process-progress` quick/direct/wait 状态。更新 `src/ui/src/processProgress.ts` 及 tests，覆盖 quick-status/direct-context 可见反馈；更新 `src/ui/src/app/chat/runOrchestrator.targetInstance.test.ts` 和新增 `src/ui/src/api/sciforgeToolsClient.policy.test.ts`，覆盖非阻塞 compaction、policy silent retry 阈值和 quick status。为保持验收类型检查，`src/runtime/generation-gateway.ts` 补 `await applyRuntimeVerificationPolicy(...)`，不改变 verification-policy / WorkEvidence / schema guard 语义。验证命令：`node --import tsx --test src/runtime/conversation-policy/policy.test.ts src/ui/src/processProgress.test.ts src/ui/src/app/chat/runOrchestrator.targetInstance.test.ts src/ui/src/api/sciforgeToolsClient.policy.test.ts`、`npx tsc --noEmit`、`npm run build` 均通过。剩余风险：当前轮 preflight 只能使用发送前已有的最近 policy；当前轮 Python policy 要等 workspace stream 返回后才能驱动 transport 阈值和 quick status，首包前策略预取/后台补全完整协议仍由后续线程继续收敛。
- [x] Thread E - Background completion protocol and persistence：已完成；新增通用 `sciforge.background-completion.v1` runtime event / session transform contract，覆盖 initial response、background stage update、finalization，保持 runId/stageId/ref 一致；`applyBackgroundCompletionEventToSession` 支持同一 run 的 artifact / verification / WorkEvidence / final response 追加，失败与用户取消写入 `failureReason` / `recoverActions` / `nextStep`，下一轮 `requestPayloadForTurn` 可读取后台结果。更新 workspace timeline 对既有 run 状态变化的持久化事件，新增 runtime contract schema/smoke 与 long task smoke。验证命令：`node --import tsx --test src/ui/src/app/chat/sessionTransforms.test.ts src/ui/src/app/appShell/workspaceState.test.ts`、`npx tsx tests/smoke/smoke-background-completion-protocol.ts`、`npx tsx tests/smoke/smoke-runtime-contract-schemas.ts`。
- [x] Thread F - Telemetry and end-to-end latency smoke：已完成；新增 `src/runtime/gateway/latency-telemetry.ts` 并接入 `src/runtime/generation-gateway.ts`，在每轮 runtime 结束时输出一条低噪声 `latency-diagnostics` event，同时把摘要挂入 payload `logs` 和 `workEvidence`，覆盖 time-to-first-visible-response、time-to-first-backend-event、context compaction wait、verification wait、cache hit/miss 和 fallback reason。`src/ui/src/app/chat/sessionTransforms.ts` 的 background completion raw diagnostics 记录 `backgroundCompletionDurationMs`。新增 `tests/smoke/smoke-t098-latency-diagnostics-matrix.ts` 与 `npm run smoke:t098-latency`，本地 Python policy 生成 10 类通用 fixtures：普通追问、上一轮 artifact 追问、低风险 current-events、文献检索、长报告、失败修复、高风险 action、context near limit、backend silent stream、用户中途追加引导；断言 `latencyPolicy` / `responsePlan` / `backgroundPlan` / `cachePolicy` 来自 Python response，TS 只透传/执行。smoke 暴露并修复一个明确策略缺口：`packages/reasoning/conversation-policy/src/sciforge_conversation/response_plan.py` 和 `cache_policy.py` 现在会把 `policyHints.selectedActions` 纳入 high-risk action 风险计算，`packages/reasoning/conversation-policy/tests/test_response_cache_policy.py` 已覆盖 high-risk action 禁止 background/cache reuse。后续补齐剩余 T098 TODO：`packages/reasoning/conversation-policy/src/sciforge_conversation/execution_classifier.py` 不再把 runtime planning skill `scenario.*.agentserver-generation` 误当 selected action，从而让已有 artifact/table 追问进入 Python `direct-context-answer`；新增 `src/runtime/gateway/direct-context-fast-path.ts`，在 Python 明确选择 direct-context 且没有 AgentServer base URL 时，从现有 artifacts/refs/execution refs 生成可审计 ToolPayload，不启动 workspace task；有 AgentServer 时仍保持 AgentServer owns orchestration 的 direct payload 路径。`src/runtime/gateway/verification-policy.ts` 将 `latencyPolicy.blockOnVerification=false` 写入 verification artifact/displayIntent 的 `nonBlocking` 标记，低风险 `unverified`/lightweight verification 只作为 badge/artifact/ref 进入 UI 和下一轮上下文，高风险 action 仍 fail-closed。验证命令：`python3 -m pytest packages/reasoning/conversation-policy/tests/test_execution_classifier.py packages/reasoning/conversation-policy/tests/test_response_cache_policy.py` 通过（24 passed），`npm run smoke:t098-latency && npm run smoke:background-completion` 通过，`npx tsc --noEmit` 通过，`npm run build` 通过。剩余风险：当前 telemetry 记录的是 runtime gateway 与 background session transform 的低噪声诊断摘要；真实 provider 的 429/timeout/用户取消路径还需要长跑 smoke 或 live backend 观测来校准 SLA 分布。
- [x] Single truth source cleanup：已完成；`packages/contracts/runtime/capabilities.ts` 只保留 capability metadata 与 lazy contract registry，删除旧 TS `buildCapabilityBrief`、prompt scoring、risk inference 和 verifier selection；删除未被生产路径引用的 verification policy builder，避免维护第二套 verification policy builder；`src/ui/src/api/sciforgeToolsClient.ts` 只透传显式 `scenarioOverride.verificationPolicy` / `humanApprovalPolicy` / `unverifiedReason`，不再合成默认策略；`src/runtime/gateway/verification-policy.ts` 不再从用户 prompt 关键词推断 high risk，只从显式 policy、结构化 selected actions/action side effects、uiState policy 和 executionUnits safety evidence 推断，同时保留 action provider self-report 的 fail-closed gate。验证命令：`node --import tsx --test packages/contracts/runtime/capabilities.test.ts src/ui/src/api/sciforgeToolsClient.policy.test.ts`、`npx tsx tests/smoke/smoke-runtime-gateway-modules.ts`、`uv run --with pytest python -m pytest tests`（在 `packages/reasoning/conversation-policy`）、`npm run smoke:t098-latency`、`npx tsc --noEmit`、`npm run build` 均通过。剩余风险：真实 provider 的慢/429/timeout/取消分布仍需 live backend 长跑校准；transport safe default 仍保留为执行壳兜底，不承担策略选择。

并行实现 prompts：

#### Thread A - Python latency policy

```text
你负责实现 T098 的 Python latency policy。只修改 packages/reasoning/conversation-policy 及其 tests，必要时更新 PROJECT.md 中 T098 状态。

目标：
- 新增 sciforge_conversation/latency_policy.py，输出 latencyPolicy。
- 输入应来自 service.py 已有 policy_input、goalSnapshot、contextPolicy、executionModePlan、capabilityBrief、recovery/failure/guidance/context budget 等通用字段。
- 策略必须通用，不得按 scenario/provider/prompt 特例。
- 覆盖 firstVisibleResponseMs、firstEventWarningMs、silentRetryMs、allowBackgroundCompletion、blockOnContextCompaction、blockOnVerification、reason。
- 高风险 action / selected action / human approval required / failed verification 必须 block；direct-context、低风险 continuation、已有 artifact 追问可非阻塞。

验收：
- 新增 pytest fixtures 覆盖 direct context、low-risk continuation、light lookup、multi-stage project、repair、high-risk action、context near limit。
- python3 -m pytest packages/reasoning/conversation-policy/tests 通过。
- 更新 PROJECT.md 的 T098 Thread A 进度和剩余风险。
```

#### Thread B - Python response/background/cache plan

```text
你负责实现 T098 的 responsePlan/backgroundPlan/cachePolicy。优先在 packages/reasoning/conversation-policy 内实现，必要时只做最小 TS contract 类型补充，不改 UI 行为。

目标：
- 新增或扩展 response_plan.py、cache_policy.py。
- service.py 输出 responsePlan、backgroundPlan、cachePolicy，并进入 ConversationPolicyResponse contract。
- responsePlan 至少包含 initialResponseMode、finalizationMode、userVisibleProgress、fallbackMessagePolicy。
- backgroundPlan 至少包含 enabled、tasks、handoffRefsRequired、cancelOnNewUserTurn。
- cachePolicy 至少覆盖 scenario/skill/UI plan、reference digests、artifact index、last successful stage/backend session 是否可复用。
- 所有决策基于通用 executionMode/contextPolicy/capability/risk/failure/ref 信号。

验收：
- pytest 覆盖所有 mode 和风险等级。
- 不在 TS 中复制策略判断。
- 更新 PROJECT.md 的 T098 Thread B 进度。
```

#### Thread C - TypeScript bridge and request enrichment

```text
你负责把 Python T098 策略字段接入 TypeScript bridge 和 GatewayRequest enrichment。不要实现策略算法，只做 schema、normalization、透传、安全默认值。

目标：
- 更新 src/runtime/conversation-policy/contracts.ts、apply.ts、python-bridge.ts 相关 normalizer。
- requestWithPolicyResponse 将 latencyPolicy、responsePlan、backgroundPlan、cachePolicy 写入 uiState.conversationPolicy 以及稳定顶层位置（如 uiState.latencyPolicy 等），供 runtime/UI 消费。
- buildContextEnvelope 和 agentserver-prompts 只展示裁剪后的策略摘要，不能新增 prompt regex。
- 缺失字段使用安全默认：block verification/action safety、允许普通 UI 继续但不声明后台完成。

验收：
- 新增/更新 TS unit tests，断言字段透传、缺失默认、无策略复制。
- node --import tsx --test src/runtime/conversation-policy/*.test.ts 通过。
- npx tsc --noEmit 通过。
- 更新 PROJECT.md 的 T098 Thread C 进度。
```

#### Thread D - UI/runtime orchestration execution shell

```text
你负责让 UI/runtime 按 T098 policy 执行，但不在 TS 中推断策略。重点改 runOrchestrator、sciforgeToolsClient、process progress 和 running message。

目标：
- runOrchestrator preflight compaction 读取 latencyPolicy.blockOnContextCompaction；false 时不阻塞发送，改为后台/stream event 记录。
- sciforgeToolsClient silent wait/retry/timeout 阈值读取 latencyPolicy；缺失时保留现有安全默认。
- 支持 responsePlan.initialResponseMode 的最小 UI 行为：quick-status/direct-context 不必等完整 workspace task 才显示可读反馈；复杂任务仍显示明确进展。
- 不绕过 runtime verification-policy、WorkEvidence guard、schema validation。
- 所有 UI 文案和状态通用，不写固定 scenario/prompt。

验收：
- 更新 chat/runOrchestrator、sciforgeToolsClient 相关 tests。
- browser smoke 或 unit fixture 覆盖 context compaction 非阻塞、silent retry 阈值来自 policy、quick status 可见。
- npm run build、npx tsc --noEmit 通过。
- 更新 PROJECT.md 的 T098 Thread D 进度。
```

#### Thread E - Background completion protocol and persistence

```text
你负责设计并实现 T098 后台补全协议。重点是 runId/stageId/ref 的一致性，不做策略算法。

目标：
- 定义 initial response、background stage update、finalization event 的通用 runtime event / session transform contract。
- 一个 run 可以先写入初始 assistant message，再追加 artifact/verification/WorkEvidence/final response 更新。
- 后台补全必须可取消、可被新用户 turn 继承上下文、可在失败时写 failureReason/recoverActions/nextStep。
- 更新 sessionTransforms、workspace state persistence、object references，确保下一轮能看到后台补全结果。
- 不为某个场景写专用状态。

验收：
- 单测覆盖初始回复、后台成功、后台失败、用户取消、新用户 turn 期间后台完成、artifact update、verification update。
- smoke 覆盖一个通用 long task 先回复后补全。
- 更新 PROJECT.md 的 T098 Thread E 进度。
```

#### Thread F - Telemetry and end-to-end latency smoke

```text
你负责 T098 诊断与验收矩阵，不改核心策略除非测试暴露明确缺口。

目标：
- 增加 time-to-first-visible-response、time-to-first-backend-event、compaction wait、verification wait、background completion duration、cache hit/miss、fallback reason 的低噪声 telemetry。
- 新增通用 smoke fixtures：普通追问、上一轮 artifact 追问、低风险 current-events、文献检索、长报告、失败修复、高风险 action、context near limit、backend silent stream、用户中途追加引导。
- 验证策略字段来自 Python response，TS 只执行/展示。
- 给 PROJECT.md T098 更新可量化验收结果和剩余风险。

验收：
- 新增 smoke 可稳定本地运行，不依赖真实外网或单一 provider。
- npm run build、npx tsc --noEmit、相关 smoke 通过。
```

### T097 任务复杂度路由与 Reproducible Task Project Runtime

状态：已完成本轮验收，继续观察真实 backend mode 遵循和产品运行中的证据质量。本轮已完成 Python classifier、TS 字段透传、Task Project runtime/runner、WorkEvidence guard 接入、AgentServer prompt 边界、运行中 UI 最小展示、repair/continue stage 锚点、guidance adoption contract、guidance adoption runtime guard 和 stage adapter promotion proposal 入口。T097 负责任务复杂度路由和多阶段 Task Project runtime：每个用户请求先经过 Python 策略层判断任务类型、复杂度、不确定性、可复现需求和交互风险，再选择合适执行模式：已有上下文直答、薄可复现 adapter、单阶段 workspace task、多阶段 Task Project、或 repair/continuation。复杂任务应拆成可执行 stage，agent 每次只写/修改当前阶段所需代码，SciForge 执行后把阶段证据、失败和用户追加引导反馈给 agent，再进入下一阶段。

接口边界补充：`executionModePlan` 的策略字段由 `packages/reasoning/conversation-policy/src/sciforge_conversation/execution_classifier.py` 产生；TS 只在 `src/runtime/conversation-policy/apply.ts`、`src/runtime/gateway/context-envelope.ts`、`src/runtime/gateway/agentserver-prompts.ts` 中做字段映射、裁剪和 prompt contract 展示。缺失时只能回退为 `unknown` / `backend-decides`，不能用 prompt regex 自行判断 mode。

与 T096 的关系：T097 决定“这轮应该怎么跑、拆几段、何时继续或修复”；T096 定义“每段运行必须留下什么证据、怎样判断失败、怎样把失败归一成可恢复上下文”。T097 的 Project/Stage runner 消费 T096 的 `WorkEvidence` schema 与 guard，不另建一套证据语义。

核心原则：

- 算法优先 Python：任务分类、复杂度评分、stage 规划、继续/修复策略应在 `packages/reasoning/conversation-policy` 中实现，方便学生阅读、修改和写实验；TypeScript 只保留 request transport、workspace project/stage runner、artifact/ref 持久化和 UI 展示。
- Runtime shell 优先 TypeScript：project/stage 目录创建、输入输出落盘、命令执行、stream 转发、证据归档、UI 状态和 AgentServer 往返属于 TypeScript 执行壳；TypeScript 不复制 Python 的分类、复杂度评分或 stage 规划算法。
- 可复现性优先：依赖新检索、文件、命令、工具或产物的结果必须留下 project/stage code、input、output、stdout/stderr、WorkEvidence 和 artifact refs；只有纯解释已有上下文时才允许直接 ToolPayload。
- 分阶段优先于一次性大脚本：对长任务、高不确定性任务、多 provider 检索、多 artifact 产出、外部 I/O、需要用户中途纠偏的任务，AgentServer 应先生成 stage spec / 当前阶段代码，运行后再基于阶段反馈继续。
- 轻量任务不应走重型 pipeline：简单 search/fetch/current-events 查询可以走薄 adapter 或单阶段 project，限制 provider 数、结果数、超时和输出体积，但仍保留可复现证据链。
- Agent backend 负责策略和代码，SciForge 负责项目状态机、stage 执行、证据归档、失败守门、用户可见进度和下一轮 handoff。
- 所有路由规则、stage 类型和 adapter contract 必须面向通用任务形态；不得为单一 provider、scenario、prompt、论文站点、backend 或固定文案写特例。

简化流程：

```text
user request
  -> Python classifier
  -> execution mode
  -> AgentServer stage/task generation
  -> SciForge runner
  -> WorkEvidence
  -> next stage / repair / final payload
```

执行模式草案：

- `direct-context-answer`：只基于已有 refs / digest / session state 回答，不产生新外部 I/O。
- `thin-reproducible-adapter`：简单外部检索或轻量工具调用；生成最小 adapter/stage，输出 WorkEvidence 和简短结果。
- `single-stage-task`：一次可完成的本地计算、文件转换、窄范围分析或简单 artifact 生成。
- `multi-stage-project`：需要 plan -> search/fetch/read/analyze/validate/emit 多阶段反馈的任务。
- `repair-or-continue-project`：基于已有 project/stage 的失败、用户追加引导或上一轮 artifact 继续。

Todo：

- [x] 在 `packages/reasoning/conversation-policy` 新增任务复杂度分类器：输入 prompt、refs、artifacts、expectedArtifactTypes、selected capabilities、recent failures，输出 `executionMode`、`complexityScore`、`uncertaintyScore`、`reproducibilityLevel`、`stagePlanHint` 和选择理由。
- [x] 为 Python 分类器建立可编辑规则与 fixture：覆盖简单问答、轻量搜索、新闻/current-events、文献调研、全文下载、代码修改、文件探索、长任务、repair、continuation、用户运行中追加引导；断言不依赖单一 provider/scenario/prompt。
- [x] 定义 Task Project schema 与持久化 helpers：`.sciforge/projects/<project-id>/project.json`、`plan.json`、`stages/<n>-<kind>.json`、`src/`、`artifacts/`、`evidence/`、`logs/`，每个 stage 记录 codeRef/inputRef/outputRef/stdoutRef/stderrRef/evidenceRefs/failureReason/nextStep，并支持 project/stage 创建、读取、更新、evidence refs 记录、bounded handoff 摘要和 recent project 列表。
- [x] 在 TypeScript runtime 增加 Project/Stage runner：创建 project、写入 stage code/input、执行当前 stage、调用 T096 guard 归档 WorkEvidence、验证 stage 输出、决定是否请求 AgentServer 生成下一 stage。
- [x] 改造 AgentServer handoff：把 Python 分类结果、执行模式和当前 project/stage/WorkEvidence 摘要放入 `CURRENT TURN SNAPSHOT`；要求多阶段模式下只返回下一阶段 patch/spec，不一次性生成整条 pipeline。
- [x] 将 Python `executionModePlan` 接入 GatewayRequest enrichment、context envelope 的 `sessionFacts`/`scenarioFacts` 和 AgentServer prompt；TypeScript 只透传稳定字段，缺失时回落到 `unknown`/`backend-decides`。
- [x] 增加 stage feedback loop 的 runtime handoff 基础：每阶段完成后把 T096 WorkEvidence 摘要、diagnostics/schema errors/verifier 摘要、artifact refs、recoverActions、用户追加 guidance 和失败诊断压成结构化摘要回传给 agent；handoff 已包含紧凑 guidance adoption contract，runtime guard 会要求 active guidance 都有结构化 adopted/deferred/rejected 决策和 reason，缺失时进入 repair-needed。
- [x] 增加中途可见进度 UI：主对话最小展示当前 project、stage、状态、最近 evidence/failure/recover/diagnostic/nextStep；右侧阶段性 artifact 展示继续作为后续增强。
- [x] 支持用户中途干预的 runtime 基础：追加消息进入 project guidance queue，下一阶段 handoff 读取 queued/deferred guidance，并提供 adopted/deferred/rejected 状态记录 helper；continuation selection 已把 repair/continue 锚定到最近 failed/repair-needed/blocked stage，成功后追加 guidance 时锚定最近 completed stage，避免从 stage one 重跑。
- [x] 建立 promotion 路径：成功稳定的 stage adapter 可以被提议为 reusable skill/package；Task Project 保留从一次性代码到可复用能力的演化证据，复用现有 skill-promotion safety gate、proposal manifest、validation smoke 和人工确认流程。
- [x] 增加 T097 端到端 smoke：同一任务分别触发 direct-context、thin adapter、single-stage、multi-stage、repair/continue 五种模式，断言选择理由、执行 refs、stage 证据、UI 状态和 repair guidance adoption 都稳定。
- [x] 补齐基础 UI+runtime 端到端矩阵：`tests/smoke/smoke-t097-execution-mode-matrix.ts` 用同一套 execution mode fixtures 验证 Python decision 字段、AgentServer handoff、runner refs、WorkEvidence、UI runtime 状态和 repair/continue handoff。
- [x] 补齐 browser 级 RunningWorkProcess DOM smoke：`tests/smoke/smoke-browser-workflows.ts` 使用通用 TaskProject/TaskStage/WorkEvidence fixture 验证默认紧凑展示 project/stage/status/evidence/failure/recover/diagnostic/nextStep，raw output 只在二级折叠中出现，且结构化字段优先于文本 fallback。

验收标准：

- [x] AgentServer handoff 已明确 direct-context/thin-adapter/single-stage/multi-stage/repair-continue 边界，要求 multi-stage 只返回下一阶段；仍需端到端运行矩阵持续验证 backend 遵循程度。
- [ ] 每个依赖外部 I/O 或本地执行的回答都有可复现 project/stage 证据链。
- [x] Python 分类策略可通过 fixture 独立测试和调参，TypeScript 不维护并行复杂度判断算法。
- [x] 多阶段 project 的 runtime handoff 能在失败、空结果、用户追加约束后从最近 stage 继续；backend 若遗漏采用/延后/拒绝声明，会被 guidance adoption guard fail closed 到 repair-needed。

验收命令：

- `npx tsc --noEmit`
- `node --import tsx --test src/runtime/gateway/guidance-adoption-guard.test.ts`
- `node --import tsx --test src/runtime/task-projects.test.ts`
- `node --import tsx --test src/runtime/gateway/context-envelope.test.ts`
- `npx tsx tests/smoke/smoke-t097-execution-mode-matrix.ts`
- `npx tsx tests/smoke/smoke-agentserver-handoff-current-turn.ts`
- `python3 -m pytest packages/reasoning/conversation-policy/tests`

### T096 WorkEvidence 结构化证据与通用恢复守门

状态：已完成本轮验收，继续观察真实 provider 字段漂移。本任务承接外部检索失败被伪装成成功结果的问题，目标是在不重写 agent backend 通用 search/fetch/read/command 能力的前提下，让 SciForge 提供一层薄的结构化证据 contract、失败归一化和 runtime guard。Agent backend 继续负责推理、选择 provider、制定 fallback 策略；SciForge 只负责把关键执行事实整理成低噪声、可审计、可恢复的信息，并阻止“空结果/缺证据/失败被吞掉”进入成功状态。

字段边界补充：WorkEvidence 的通用字段是 `kind`、`status`、`provider`、`input`、`resultCount`、`outputSummary`、`evidenceRefs`、`failureReason`、`recoverActions`、`nextStep`、`diagnostics`、`rawRef`。`diagnostics` 和 `outputSummary` 只放低噪声事实，raw stdout、HTTP body、网页正文和长日志必须留在 refs。TaskStage 可以嵌入 `workEvidence` 摘要，但 TaskStage 不是 WorkEvidence，避免让 project schema 和 evidence schema 互相冒充。

与 T097 的关系：T096 是证据 schema、guard 和失败归一化层；T097 是任务复杂度路由和多阶段 project runtime 层。T096 不决定任务是否要拆成多阶段，也不维护复杂度算法；T097 不重新定义证据字段或失败语义，而是在每个 stage 边界调用 T096 的 WorkEvidence contract。

核心原则：

- SciForge 不维护领域专用搜索策略，不硬编码某个 provider、某个 scenario 或某条 prompt 的答案；只定义通用证据形状、失败语义和恢复边界。
- Backend 可以使用自己的原子工具和通用能力，但返回给 SciForge 的 search/fetch/read/write/command/validate 结果必须能被归一成 provider/query/status/resultCount/evidenceRefs/failureReason/recoverActions 等可审计字段或摘要。
- 可复现性优先于纯直答：凡是依赖新外部检索、本地文件、命令或产物生成的回答，默认应留下可运行任务、输入、输出、日志和证据 refs；轻量查询也应是薄 adapter/spec，而不是不可复现的临场自然语言回答。
- 轻量查询的优化目标不是绕过写代码，而是避免为一次性搜索生成重型 pipeline：优先复用稳定 runtime capability 或生成最小 adapter，限制 provider 数、结果数、超时、下载范围和输出体积。
- Raw stdout、HTTP body、网页正文和长日志继续保存在 workspace refs；handoff 给 agent 的默认内容应是结构化摘要、证据引用和可行动 nextStep。
- 外部检索、下载、API 调用、数据库查询等 I/O 任务如果没有明确失败诊断、provider status、fallback 尝试或可信空结果说明，不得被标记为高置信成功。
- Python 负责证据相关策略解释、repair/continuation 决策和可调规则；TypeScript 负责 runtime 执行壳里的事件适配、schema 校验、guard 调用、ref 持久化和 UI 投影。
- WorkEvidence 是跨 provider、跨 scenario、跨 backend 的通用 contract；不得为单一 provider、scenario、prompt 或固定错误文本增加专用成功/失败规则。

Todo：

- [x] 新增通用 `work-evidence-guard`：对 ToolPayload 做跨领域 evidence 检查，先覆盖“外部检索返回 0 结果但缺少 provider status / fallback / failed-with-reason”的 repair-needed 守门。
- [x] 将 generated task runner 接入 evidence guard：schema 合法、exitCode 为 0 但证据不足的检索结果也进入 repair，而不是展示为成功。
- [x] 为 generated task runner guard 增加 attempt history / repair smoke：覆盖 exitCode=0 且 0 result 无诊断进入 repair-needed、0 result 有 provider/fallback 诊断放行、command failed evidence 进入 repair-needed、正常 generated task 放行，并验证 refs 与 `failureReason` 保留。
- [x] 在 AgentServer generation/repair prompt 中补充外部 I/O reliability contract：要求 bounded timeout、retry/backoff、provider status、fallback 记录、失败时写 `failed-with-reason` ToolPayload。
- [x] 定义 runtime-side `WorkEvidence` schema：覆盖 `kind`、`status`、`provider`、`input`、`resultCount`、`outputSummary`、`evidenceRefs`、`failureReason`、`recoverActions`、`nextStep`、`diagnostics`、`rawRef`，作为 UI WorkEvent 之外的审计/恢复真相源。
- [x] 新增 TypeScript backend tool event adapter：把 Codex/Claude/Gemini/Hermes/OpenTeam Agent 等 backend 的通用 search/fetch/read/command/validate tool stream 归一成 `WorkEvidence`，UI 的 `WorkEventKind` 优先消费该结构或降级到现有文本 classifier；不按 provider/scenario/prompt/固定错误文本写专用分支。
- [x] 将 `WorkEvidence` 摘要写入 Task Project stage 记录和 bounded handoff，让 agent backend 能从 project/stage 继续读取低噪声执行事实。
- [x] 将 `WorkEvidence` 摘要继续接入 attempt history / repair context 全链路，避免 repair/continuation 反复读取 raw logs。
- [x] 将轻量可复现 adapter 的证据要求沉淀为 WorkEvidence guard fixture；执行模式选择、是否走 adapter 或 Task Project 归 T097 处理。
- [x] 扩展 guard：覆盖 claim 声称 verified 但无 evidence refs、command exitCode 非 0 却成功、fetch timeout/429 被吞、artifact 缺少 dataRef/schema 字段等通用假成功模式。
- [x] 增加 runtime WorkEvidence schema 与 guard 单测：覆盖每个 guard、schema 校验和正常放行路径，并通过 `node --import tsx --test src/runtime/gateway/work-evidence-guard.test.ts` 与 `npx tsc --noEmit`。
- [x] 增加 T096 端到端 fixture：模拟外部 provider 429、timeout、空结果、fallback 成功和 fallback 耗尽，验证 WorkEvidence、最终 payload 状态、attempt history、repair context 和下一轮 context envelope 都能表达真实状态；不重复覆盖 T097 execution mode 路由。
- [x] 扩展真实 AgentServer/backend stream smoke：经 `runWorkspaceRuntimeGateway`、AgentServer `/runs/stream` 协议和 UI runtime callbacks 验证 backend tool/provider events 可被通用 adapter 归一成 WorkEvidence，并进入 direct payload guard、attempt history、repair context、context envelope 和 UI process events。

验收标准：

- [x] Agent backend 仍负责策略和推理；SciForge 只提供证据归一化、失败守门、artifact/ref 持久化和恢复上下文，并保留可复现任务证据链。
- [x] 外部检索类任务在缺少 provider status/fallback/failure 证据时不会被标记为成功。
- [x] 下一轮 repair/continuation 能看到结构化 WorkEvidence 摘要，并据此换 provider、调整 query、请求用户补充或诚实失败；真实 AgentServer stream fixture 已覆盖 provider 429、timeout、empty result、fallback success、fallback exhausted 的 direct backend path。
- [x] 外部 I/O 的 `success` / `partial` / `empty` WorkEvidence 必须带 durable `evidenceRefs` 或 `rawRef`；无 ref 的 direct backend 成功会进入 `repair-needed`，避免不可复现直答伪装成可审计结果。

验收命令：

- `npx tsc --noEmit`
- `node --import tsx --test src/runtime/gateway/backend-tool-work-evidence-adapter.test.ts`
- `node --import tsx --test src/runtime/gateway/work-evidence-guard.test.ts`
- `node --import tsx --test src/ui/src/streamEventPresentation.test.ts`
- `npx tsx tests/smoke/smoke-t096-work-evidence-provider-fixtures.ts`

剩余风险：

- 已覆盖本地 AgentServer stream 协议、runtime direct payload path、stream `WorkEvidence` 到 UI `WorkEvent` atoms 的结构化优先链路，以及 snake_case、nested input/arguments/params、nested response/provider_status/request 字段漂移；长期真实 provider 运行中仍需把新增字段变体继续收敛到通用 adapter。
- Backend tool stream 到 WorkEvidence 的通用 adapter 已覆盖 search/fetch/read/command/validate 事实；低噪声摘要质量仍依赖 backend 是否提供 query/url/status/resultCount/ref 等结构化字段。
- 轻量 adapter 的证据要求已有 guard 与 runtime fixture 覆盖；无 durable refs 的外部 I/O 成功已会 repair-needed，剩余风险是产品运行中 backend 可能给出语义很弱但格式合法的 refs，需要靠后续审计质量测试收敛。

### T095 主对话栏 WorkEvent 原子事件层

状态：已完成本轮实现，继续跟踪后续增强。本任务承接 Cursor Agent 对标体验修复：主对话栏不直接平铺 raw stream，而是先把后台事件归纳成可复用的原子 WorkEvent，再由统一 presenter 决定“显示一句过程摘要、折叠详细内容、二级折叠 raw output”。目标是让复杂多轮任务，例如“检索最近一周 AI + 虚拟细胞的文章，并写总结报告”，在运行中持续显示 `Explored...`、`Searched...`、`Fetched...`、`Read...`、`Wrote...`、`Ran...`、`Waiting...` 等可理解摘要，同时避免把上下文窗口、usage、AgentServer JSON 和脚本 payload 直接淹没主对话。

实现语言原则：

- TypeScript 负责 UI 事件壳、stream presenter、React 展示策略和前端 fixture tests，因为这些逻辑紧贴浏览器主对话栏和 TS domain contract。
- Python 继续作为算法/策略唯一真相源，后续若要让 backend 主动发出结构化 work event hints，应落在 `packages/reasoning/conversation-policy` 或 runtime policy bridge 中；TypeScript 只消费 schema，不复制长期策略算法。
- 原子事件必须是通用 schema / classifier / summarizer / display policy，不得按固定 prompt、固定 scenario、固定工具名、固定 DOM 或固定论文任务做特例补丁。

Todo：

- [x] 定义主对话栏原子事件分类：`plan`、`explore`、`search`、`fetch`、`read`、`write`、`command`、`wait`、`validate`、`artifact`、`recover`、`diagnostic`、`message`、`other`。
- [x] 新增 `src/ui/src/workEventAtoms.ts` 单文件原子事件层：集中维护事件类型、分类、摘要、raw 格式化和主对话栏可见性，后续针对 Search/Read/Fetch 等事件加强时只改这一处。
- [x] 改造 `streamEventPresentation.ts`：保留现有对外 API，但内部使用 WorkEvent 模块生成 worklog counts、operation line、raw output 和 summary，避免大文件继续堆分类规则。
- [x] 改造 `RunningWorkProcess.tsx`：运行中主对话栏只展示最近的高价值操作摘要；详细事件默认折叠，raw output 二级折叠。
- [x] 覆盖通用 fixture：AgentServer taskFiles payload 被显示为简洁写入摘要，不泄露脚本 JSON；上下文窗口和计划事件不进入 running live rows；搜索/读取/写入/执行/等待都有稳定摘要。
- [ ] 后续让 Python conversation policy/runtime 在合适时机发出结构化 `workEvent` hints，减少 TypeScript 对自然语言和 raw tool 文本的启发式归类。
- [ ] 扩展 `validate`、`artifact`、`recover` 的真实端到端 fixture：覆盖验收、产物引用、失败恢复和多轮追问上一轮对象。
- [x] 增加 browser smoke：用通用结构化 running work fixture 验证主对话栏 running 摘要、默认折叠、raw output 二级折叠和最终回答优先级；右侧结果栏对象渲染另行跟踪。

验收标准：

- [x] 主对话栏工作过程展示由原子事件模块驱动，不依赖单一任务或固定场景。
- [x] 默认视图可感知 agent 工作过程，但不平铺 raw JSON、长 stdout 或上下文诊断。
- [x] 相关 unit tests、typecheck 和生产 build 通过。
