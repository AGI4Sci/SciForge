# SciForge 项目协议

最后更新：2026-05-27

当前目标：继续开发 `packages/actions/computer-use`，把它推进为 Codex CLI 可发现、可运行、可验证的 Computer Use 拓展包。拓展包应能在每个线程自己的虚拟桌面里完成复杂可见工作，使用虚拟鼠标和虚拟键盘，不移动用户真实鼠标，不发送全局键盘事件，也不打断用户正常使用电脑。

旧任务历史已在 2026-05-27 同步到 GitHub；旧任务板可从 Git 历史恢复。当前 `PROJECT.md` 只记录下一阶段设计、任务和验收规则。

## 当前范围

- 主要工作范围是 `packages/actions/computer-use`。
- 只有当 package 边界无法独立推进时，才修改 `packages/observe/vision`、runtime 或 GUI。
- 复杂工作必须通过 package CLI/API/stdio/host-port 边界完成，不能用 GUI 私有状态、DOM、accessibility tree、Playwright DOM 或 shell 直写文件冒充 Computer Use 成功。
- “用户能看到”指每个 agent 线程有可观看或可回放的虚拟屏幕、鼠标轨迹、键盘输入、动作时间线、截图帧和 artifact refs；不是指 agent 操作用户当前真实桌面。
- 当前 package-owned target-bound host 是 deterministic test harness，只证明 package contract，不证明真实应用验收。

## 最新算法边界

Computer Use 采用三层循环：

```text
Evidence Loop:
  observe -> inspect/crop/VLM/OCR -> update evidence graph
  repeat until evidence is enough or blocked

Action Loop:
  plan action -> ground -> execute -> verify -> update evidence graph

Task Loop:
  evidence loop -> action loop -> evidence loop -> ... -> complete/blocked
```

边界规则：

- Evidence Loop 只允许不改变屏幕、窗口、viewport、focus、菜单、tab 或应用状态的观察型操作。
- 允许的 evidence 操作包括 recapture、wait until stable、crop、OCR、VLM describe、VLM compare、region detection、visual table/image inspection。
- 任何会改变可见状态的操作都必须进入 Action Loop，包括 scroll、hover、focus、open menu/dropdown、switch tab/window/panel、zoom view、page up/down、任意鼠标或键盘输入。
- 只要进入 Action Loop，就必须记录 before/after evidence、grounding、executor outcome、verification 和 action causality。
- 完成判断必须从当前 evidence ledger 查询得出，不能只依赖历史 trace、旧截图或 action history。

## 不可变规则

- 每个线程必须有自己的 virtual display、virtual mouse、virtual keyboard 和 input lease。
- package workflow 中 `sharedSystemInputUsed`、`systemPointerMoved`、`systemKeyboardEventsSent` 必须保持 false。
- 真实 OS/global input 只能作为明确批准后的诊断路径，不能作为默认实现。
- Planner 不直接输出坐标，只输出探索意图或通用 GUI action；坐标由 grounder/executor adapter 处理。
- VLM 是感知工具，不是 executor、grounder 的唯一来源，也不单独拥有 completion 决策。
- 高风险动作必须 fail closed：发送、删除、支付、发布、上传、权限变更、账户动作、外部提交、破坏性本地动作都必须返回 `needs-confirmation` / `approvalRequest`。
- `done=true` 必须有当前视觉证据、artifact/file evidence、validator 结果和 action causality。
- 不得把 secrets、raw provider payload、inline images、data URLs、API keys 或 Authorization headers 写入 tracked files、trace、manifest 或文档。
- 实现必须通用。复杂 demo 暴露的问题应沉淀为 reusable fixture/probe/test，再修复通用算法。
- Python 仍是 package 核心逻辑的优先实现语言。
- 文件接近 2000 行时，应拆分文件或在本文件新增明确拆分任务。

## 当前任务板

- [x] 更新 Computer Use 设计文档为“每线程虚拟桌面 + 主动视觉探索 + evidence ledger”版本。
  证据：`packages/actions/computer-use/vision_computer_use_agent_mvp.md` 已重写为 v0.3，并明确 Evidence Loop、Action Loop、Task Loop 的边界。

- [ ] 实现 Evidence Ledger MVP。
  输出 `evidence-log.jsonl`、`evidence-snapshot.json`、`evidence-index.json` 和 compact planner brief。记录 observation、region、text、visual-object、vlm-claim、grounding、action、verification、artifact、uncertainty、completion-claim。索引可从 log 重建，log 是唯一真相源。

- [ ] 把现有 action loop 拆成 Evidence Loop / Action Loop / Task Loop。
  Evidence Loop 只能做只读观察；scroll、hover、focus、菜单、tab、zoom、键鼠输入全部转入 Action Loop。completion guard 必须读取 evidence ledger，而不是散落的临时状态。

- [ ] 补 freshness / staleness 规则。
  click、type、press key、scroll、drag 后旧截图、旧 OCR、旧对象位置默认 stale；crop、OCR、VLM describe 不使屏幕 stale；保存文件后目录 listing 必须重新 observe。

- [ ] 让 visible viewer 不再产生不可解释的空白帧。
  viewer 应展示真实或可解释的 frame refs、虚拟鼠标、点击波纹、键盘输入、滚动、保存动作、action timeline、isolation flags 和 artifact refs。

- [ ] 引入 `VirtualDesktopSession` / `SessionManager` 设计骨架。
  每个线程绑定独立 virtual display、virtual input queue、filesystem root、capture stream、replay bundle 和 input lease。没有 isolated input adapter 时 fail closed。

- [ ] 接入首个真实隔离桌面 backend。
  优先使用 Linux desktop + noVNC + LibreOffice/browser，完成 L1 smoke：点击输入框、输入文字、点击按钮、验证屏幕变化，并生成 viewer、trace、input logs 和 isolation flags。

- [ ] 做可见多页 PPT 验收。
  在 package workflow 中完成多页 `.pptx`，记录通用 GUI action、保存动作、最终可见证据、文件证据、PPTX validator、slide count、无宏检查、viewer 和 input logs。PPT 不能成为特例算法。

- [ ] 做可见 Word/DOCX 验收。
  使用 Word 或 Word-compatible isolated target 创建 `.docx`，包含标题、段落、项目符号和表格。若真实 Word 无法安全隔离，写 blocked manifest，并先用 Word-compatible target 验证通用 contract。

- [ ] 做跨应用文档工作流。
  在同一 virtual session 中读取可见资料，创建 Word 报告或 PPT 摘要，保存、预览、返回目录证据。禁止使用 DOM shortcut 或 shell 直写产物冒充 GUI 操作。

- [ ] 做高风险确认 demo。
  用虚拟输入填写安全字段，到发送/上传/删除类动作前返回 `needs-confirmation`，viewer 展示风险动作上下文但不执行。

- [ ] 提升 artifact validator。
  保留 PPTX validator，增加 DOCX validator，并让 artifact evidence、file-list evidence、preview evidence、save causality 在 PPT、Word、CSV、表单、菜单、文件预览工作流中复用。

- [ ] 更新 README 与 CLI 示例。
  只记录已经能跑通并可验证的命令；不要把 roadmap 写成已支持能力。

## 近期 TODO

- [ ] 为 evidence record 定义最小 schema 和 JSONL 写入器。
- [ ] 为 evidence index 实现 `current`、`byType`、`byRef`、`byActionIndex`、`byTag` 等基础索引。
- [ ] 为 planner brief 实现 deterministic query：最新观察、当前文本、当前对象、候选目标、阻塞 uncertainty、最近动作、artifact evidence、completion 缺口。
- [ ] 在现有 target-bound fixture 中记录 evidence log，先不接真实 VLM。
- [ ] 给“状态改变操作不得进入 Evidence Loop”增加 focused regression。
- [ ] 给空白 viewer frame 增加显式失败或解释性 placeholder，避免用户误以为真实截图为空白。
- [ ] 运行 package-local Python 测试：`PYTHONPATH=packages/actions/computer-use python -m pytest packages/actions/computer-use/tests -q`。
- [ ] policy/manifest TypeScript 改动后运行：`node --test --import tsx packages/actions/computer-use/provider-policy.test.ts packages/actions/computer-use/runtime-policy.test.ts`。
- [ ] 每次提交前运行：`git diff --check`。

## 本地模型配置

- 本地 Computer Use 调试可以使用 ignored config，例如 `config.computer-use.local.json`。
- 这些文件可能包含 provider URLs、API keys、model names，绝不能提交或打印。
- 文本规划可以使用便宜的本地/项目文本模型。
- 可选 VLM evidence 必须通过代码中的 allowlist 和 sanitized diagnostics 证明模型存在，不能泄露 provider payload。

## 验证规则

- 纯文档改动：运行 `git diff --check`。
- Computer Use package 代码改动：运行 package-local Python suite。
- policy/manifest TypeScript 改动：运行 focused Node tests。
- 可见复杂工作声明必须包含 trace/result refs、screenshot/viewer refs、final artifact refs、verifier verdict、virtual input logs、evidence ledger 和 isolation flags。
- native 或 real-app blocked 状态可以接受，但必须写 blocked manifest，说明缺失 capability、安全原因或隔离原因。

## 暂缓集成

以下内容等 package-level visible workflow 稳定后再推进：

- SciForge runtime bridge integration
- GUI `gui.present` / `gui.ask_user`
- CU-NEXT L2/L3 acceptance
- browser acceptance
- AgentServer/provider registry migration
- release gates and full-repo verification

## 必读文档

- [`packages/actions/computer-use/README.md`](packages/actions/computer-use/README.md)
- [`packages/actions/computer-use/vision_computer_use_agent_mvp.md`](packages/actions/computer-use/vision_computer_use_agent_mvp.md)
- [`packages/actions/computer-use/KV_GROUND_SERVICE_GUIDE.md`](packages/actions/computer-use/KV_GROUND_SERVICE_GUIDE.md)
- [`packages/observe/vision/README.md`](packages/observe/vision/README.md)

## Worktree 规则

- 开发默认在 `dev` 分支；长期分支尽量只保留 `main` 和 `dev`。
- `config.local.json`、`config.computer-use.local.json`、`.sciforge/**`、package caches、runtime homes 等本地状态不得进入 Git。
- 不使用 `git reset --hard` 或 `git checkout --` 擦除用户改动。
- 只清理明确的 generated caches、temporary workspaces 和 build outputs。
