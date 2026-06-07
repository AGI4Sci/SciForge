# SciForge Evolve Plan

最后更新：2026-06-07

## 先回答两个真实任务问题

SciForge 的下一阶段演进只围绕两个产品生死问题，但判断标准不是“某个模块有接口”或“某条 smoke 通过”，而是**真实任务是否完成**：

1. **SciForge 能不能用自己的 Computer Use 能力操纵电脑上的真实软件，并完成一个用户真正想完成的桌面任务？**
2. **SciForge 能不能用自己的内置浏览器完成真实信息检索，并产出可引用、可验收的答案？**

在这两个任务没有被普通聊天入口、真实运行证据、可检查产物和用户级 final answer 证明之前，不要把工作拆成“填写字段”“补 schema”“加 fixture”“优化面板”这类边角料。

## 本地 LLM 配置

本地 dogfood 和真实任务验收使用仓库根目录的 ignored 配置文件：

```text
/Applications/workspace/ailab/research/app/SciForge/config.local.json
```

该文件已经包含 `llm` 和 `codexProxy` 的 provider、base URL、API key、model / defaultModel 配置。运行真实任务时可以读取它作为 LLM API 配置来源；文档、trace、final answer 和长期 evidence 不得写出其中的 secret、raw key 或完整敏感 provider payload。

如果某个 release smoke 要求 `SCIFORGE_RUNTIME_API_KEY` 只能来自 service environment，那是 release gate 的安全策略；它不能替代本地 dogfood 的真实任务验收，也不能成为“不尝试真实任务”的理由。本地演进以 `config.local.json` 驱动任务，release 前再把同一能力迁移到 service-env 合规配置。

## 当前事实快照

我在 2026-06-07 跑了三条默认诊断命令，当前结论是：

| 能力 | 命令 | 当前状态 | 结论 |
| --- | --- | --- | --- |
| Computer Use 操纵真实软件 | `npm run smoke:desktop-computer-use-hard-confirm-product:strict --silent` | `product hard-confirm passed / real T1 blocked` | Electron Desktop 产品 shell、native host、Runtime Codex SSE、host-owned Computer Use package bridge、guard / hard-confirm surface 已有产品证据；真实 T1 仍缺 ordinary Desktop chat 当前运行的 scoped GUI 创建 / 保存 / 验证证据。 |
| Runtime Codex 内置浏览器检索 | `npm run smoke:runtime-codex-browser-local-dogfood --silent` + `npm run smoke:runtime-codex-browser-acceptance --silent` + `npm run smoke:runtime-codex-browser-acceptance:strict --silent` | `ordinary chat release passed` | Runtime Codex ordinary chat 已通过 `browser.open_read` 打开并读取 OpenAI 官方 API changelog，产出 BrowserHostSession source-page / page-text refs、`module.invoke` evidence 和 final-answer artifact；release/strict smoke 当前通过。 |
| Desktop native Browser live | `npm run smoke:desktop-browser-native-live-acceptance --silent` | `passed` | Desktop native Browser live 已不再是 T2 的主要代码 blocker；下一步是 ordinary chat / Runtime Codex acceptance 在 service-env 策略下产生当前运行证据。 |

这意味着：**当前不能对用户宣称 T1 已完成真实桌面软件任务；T2 已有普通聊天 / Runtime Codex release 级当前运行证据。**  
下一轮演进不是继续补边角功能，而是从真实任务出发，失败就只修阻塞真实任务的那个能力缺口。

## 真实任务通过标准

### T1: Desktop Software Task

问题：

> SciForge 能不能操纵电脑上的真实软件，并完成一个可检查的桌面任务？

推荐技术路线：

> **macOS Desktop 优先评估 Appium Mac2 + SciForge native AX sidecar。**

Appium Mac2 适合作为 macOS 真实软件操作的候选 scoped executor adapter：它基于 macOS XCTest / Accessibility 体系，适合 TextEdit、Finder、系统对话框和一部分原生应用的窗口发现、控件定位、点击、输入和断言。SciForge native AX sidecar 则继续负责 SciForge 自己的 target binding、窗口 inventory、AX tree / bounds / role / value evidence、截图 / crop evidence、permission readiness、blocked reason 和 refs-first trace。

两者的分工必须清楚：

- Appium Mac2 只做 macOS app 操作 adapter 候选，不拥有用户任务、completion truth 或 final answer。
- SciForge native AX sidecar 负责把 Appium / AX / screenshot 结果归一成 target-bound evidence refs。
- WindowActionSession / Computer Use 仍是 action、risk、executor lease、before / after evidence 和 stale invalidation owner。
- 高风险动作仍必须走 SciForge hard-confirm / stop / cancel，不允许由 Appium 直接执行。
- Appium Mac2 不能绕过 SciForge target binding 去操作任意全局窗口。
- 如果 Appium Mac2 对某个软件不稳定，允许回退到 SciForge native AX sidecar + scoped input adapter，但仍必须保留同样的 evidence contract。

通过必须满足：

- 用户从普通聊天提出完整任务，不使用 `/computer-use`、fixture、probe 或 legacy diagnostic。
- SciForge Desktop 运行在 Electron 产品路径中，而不是只跑 Vite renderer。
- Codex backend 能识别任务需要 Computer Use，并调用 Computer Use bounded operation。
- Computer Use 绑定一个真实目标软件窗口，例如 TextEdit、LibreOffice、Finder、浏览器或 SciForge 自己的窗口。
- 目标窗口绑定对用户可见，且可以取消或重新选择。
- Computer Use 能读取 fresh target-bound before evidence。
- Computer Use 能通过 scoped executor 对目标软件产生真实、低风险、可见变化，并把任务推进到用户可验收的结果。
- 每个 mutating action 都有 executor event、after evidence 和 stale invalidation。
- 如果动作涉及提交、发送、上传、删除、支付或账号安全，必须返回 `needs-confirmation`，未确认不得执行。
- Codex backend 基于 action evidence、产物 evidence 或最终可见状态生成用户级 final answer。

不能作为通过：

- package-local fixture。
- Python legacy diagnostic。
- Docker/noVNC/VirtualAppScreen/M6 历史路径。
- 只证明 hard-confirm UI 存在。
- 只证明 screenshot / replay viewer 能显示。
- 只证明测试里伪造 trusted evidence 能 pass。

真实验收任务：

```text
请用 SciForge 的 Computer Use 操作当前电脑上的真实软件，完成一个本地文件任务：
创建一份名为 sciforge-computer-use-proof 的简短文档，内容包含标题、三条要点和当前日期，保存到当前 workspace，并在保存后验证文件确实存在且内容正确。
```

首选目标软件可以是 TextEdit、LibreOffice Writer、Pages 或其它当前机器上稳定可用的文档软件。目标可以调整，但任务必须保持“真实软件操作 -> 真实文件产物 -> 验证内容 -> final answer”的形状。

必须看到的证据：

- target window ref。
- before screenshot / AX evidence ref。
- action grounding ref。
- executor event ref。
- after screenshot / AX evidence ref。
- 文件路径 / artifact ref。
- 文件内容验证 ref。
- final answer，说明确实操作了哪个软件、产出了哪个文件、验证了什么、没有做什么。

### T2: Browser Retrieval Task

问题：

> SciForge 能不能用内置浏览器完成真实信息检索，并产出可引用答案？

推荐技术路线：

> **用 Playwright 作为 SciForge 内置 Browser 的首选执行 / 读取 adapter。**

Playwright 应该负责低层浏览器动作：打开搜索页、等待页面 ready、打开来源页、读取 DOM / AX / text、截图、记录 URL / title / loading state，并把结果写成 refs-first evidence。这样可以最快打通真实检索任务，避免把时间耗在脆弱的视觉点击和页面文本提取上。

但 Playwright 必须挂在 SciForge 的 Browser 产品路径下：

- BrowserHostSession / tab scope 仍是 session、surface、action 和 evidence owner。
- Playwright 只能实现 `browser.search_read` / `browser.open_read` 的底层 adapter。
- Browser pane / 内置浏览器必须能展示或引用同一个 session 的状态，不能变成用户看不见的外部自动化。
- Playwright 产出 source page refs、page text refs、screenshot refs 和 adapter trace refs。
- Codex backend 基于这些 refs 生成 completion truth 和 final answer。
- Playwright 不能自己选择最终结论，不能绕过 Codex backend 直接回答用户。
- Playwright 不能替代 Computer Use 的真实桌面软件操纵验收。

通过必须满足：

- 用户从普通聊天提出检索任务，不使用外部搜索工具、系统浏览器或手写 web fetch 替代。
- Codex backend 判断需要 Browser evidence。
- SciForge 内置 Browser / BrowserHostSession 通过 Playwright adapter 打开搜索页或来源页。
- Browser 返回实际打开并读取过的 source page refs / page text refs。
- 搜索结果页本身不能作为完成证据。
- Codex backend 基于当前 source evidence 生成 final answer。
- final answer 给出来源，并说明证据不足、冲突或 blocked 的情况。
- 用户禁止联网或要求只用本地上下文时，不调用 Browser。

不能作为通过：

- 只证明 browser pane 能打开。
- 只证明 iframe / proxy render / screenshot replay。
- 只用 Codex 自带联网能力绕过 SciForge Browser。
- 直接用裸 Playwright / headless browser 完成检索，但没有 BrowserHostSession refs、内置浏览器 session 状态和 SciForge Browser evidence。
- 只返回搜索结果页标题。
- 只跑历史 manifest 或 seed demo。

真实验收任务：

```text
请用 SciForge 内置浏览器检索 OpenAI 官方最近发布的一条产品更新：
打开官方来源页，读取内容，给出 5 条以内中文摘要，列出来源链接，并明确说明哪些页面被实际读取。
```

必须看到的证据：

- Browser session / tab ref。
- Playwright adapter trace ref。
- search result ref。
- source page refs。
- page text refs。
- final answer with citations。
- blocked reason，如果 runtime key、provider proxy、upstream、BrowserHostSession 或 source read 不可用。

## 演进方式

### Step 0: 先尝试真实任务

先不要设计子任务矩阵。直接启动产品路径，使用 `config.local.json` 的 LLM 配置，从普通聊天提交 T1 或 T2。

失败后再跑诊断命令定位 blocker：

```bash
npm run smoke:desktop-computer-use-hard-confirm-product --silent
npm run smoke:runtime-codex-browser-acceptance --silent
npm run smoke:desktop-browser-native-live-acceptance --silent
```

诊断命令只回答“为什么不能完成真实任务”，不是成功标准。

### Step 1: 先打通 T2 浏览器检索任务

推荐先做 Browser，因为它的风险小于真实桌面输入，并且当前 blocked 原因明确：

- 本地 LLM / provider / upstream 使用 `config.local.json`。
- release smoke 的 service-env 要求可以后置，但不能阻止本地任务尝试。
- Playwright 是 T2 的首选执行 / 读取 adapter，用来快速打通导航、来源页读取、截图和 refs-first evidence。
- BrowserHostSession native live acceptance 不能 failed。
- 普通聊天必须能触发 `browser.search_read` / `browser.open_read`。

本步只解决一个问题：

> 普通聊天能否让 SciForge 内置浏览器完成 T2，并让用户相信答案来自实际读取的来源页？

本步不解决：

- 搜索答案质量的复杂 benchmark。
- 多轮深度调研。
- 登录、下载、上传或表单提交。
- 用裸 Playwright 绕过 SciForge BrowserHostSession。

完成后至少复验：

```bash
npm run smoke:runtime-codex-browser-acceptance --silent
npm run smoke:runtime-codex-browser-acceptance:strict
npm run verify:browser:desktop-product-live
```

如果 strict 因 service-env 策略 blocked，但本地 T2 已经使用 `config.local.json` 完成，记录为“local dogfood passed / release gate blocked”，然后补 service-env 适配。

### Step 2: 打通 T1 桌面软件任务

Browser 过后再做 Computer Use，因为它有更高的权限和安全风险。

本步只解决一个问题：

> 普通聊天能否让 SciForge Computer Use 操作真实软件完成 T1，并验证产物？

优先修：

- Electron Desktop 产品路径启动和可观察性。
- native host readiness。
- runtime Codex transport。
- target window binding。
- Appium Mac2 scoped executor adapter 可行性。
- SciForge native AX sidecar 的窗口 inventory、AX evidence、截图 / crop evidence 和 permission readiness。
- before / after evidence。
- 文件保存和内容验证。
- hard-confirm / stop / cancel surface。

完成后至少复验：

```bash
npm run smoke:desktop-computer-use-hard-confirm-product:strict
npm run smoke:computer-use-chat-live-e2e:product-strict
npm run verify:computer-use:desktop-product
```

### Step 3: 只在 T1 / T2 完成后做体验优化

只有 T1 和 T2 都能完成真实任务后，才进入：

- 更自然的目标窗口选择。
- 更好的 evidence 展示。
- 更好的 blocked recovery。
- 更强的视觉 grounding。
- 更复杂的科研 UI 操作。
- 更长链路的跨页面、跨文件或 artifact 验收。

否则这些都是围绕未打通能力的装饰。

## 每轮工作格式

每轮只允许围绕一个真实任务写记录。

建议记录到：

```text
docs/evolve/runs/YYYY-MM-DD-t2-browser-retrieval.md
docs/evolve/runs/YYYY-MM-DD-t1-desktop-software-task.md
```

模板：

```markdown
# Evolve Run: <t2-browser-retrieval | t1-desktop-software-task>

## 本轮真实任务
- T1: 操作真实软件创建并验证文件
- T2: 用内置浏览器检索并产出引用答案

## 用户任务

## LLM 配置来源
- `config.local.json`
- secret 是否被写入 trace: no

## 运行命令

## 视觉观察
- 启动状态：
- 执行中：
- 结果状态：

## 证据
- refs:
- screenshots:
- page text / action events:
- artifact / file validation:
- final answer:

## 结论
- passed / blocked / failed:
- 用户任务是否真正完成：
- 不能 claim pass 的原因：

## 本轮只修一个阻止任务完成的 blocker

## 复验
```

## 判断规则

### 可以打勾

- 普通聊天入口跑通。
- 当前 run 有 evidence refs。
- 用户能看到 Browser / Computer Use 在真实产品界面里工作。
- T1 产生真实文件并完成内容验证，或 T2 产生带来源的真实检索答案。
- final answer 能让用户验收结果。
- 如果 release strict gate blocked，必须说明本地任务是否已完成、release blocker 是什么、下一步怎么补。

### 不能打勾

- 只跑了默认 diagnostic。
- 只跑了 fixture / probe / fake trusted evidence。
- 只看到 UI，但没有 source refs 或 action refs。
- 只看到测试通过，但普通聊天入口不能用。
- T1 没有真实文件或内容验证。
- T2 没有实际读取来源页。
- 只用外部工具完成了搜索或桌面操作，没有经过 SciForge 内置 Browser / Computer Use。

## 当前下一步

继续并行推进 **T1: Desktop Software Task** 和 **T2: Browser Retrieval Task**，但每一步都只补真实验收缺口。

原因：

- T2 本地 BrowserHostSession 来源页读取已经通过，剩余缺口不是 BrowserHostSession source-page 代码，而是 ordinary chat / Runtime Codex release acceptance 在 service-env 策略下产生当前运行证据。
- T1 的安全产品面和 acceptance gate 已经更清楚，剩余缺口是 scoped GUI executor：TextEdit / Finder 等真实软件必须通过 WindowActionSession target binding、before / after evidence、executor event、artifact validator 和 stale invalidation 证明。
- Desktop launcher 现在可以把 ignored local config 中两个非敏感 input adapter 字段投射给 packaged sidecars；provider secret / service-env release 策略仍不能绕过。

当前最小下一步：

- T1: 将 Appium Mac2 作为 WindowActionSession 的 target-bound scoped executor 继续推进；没有 Mac2 server URL 或 executor 注册时必须 fail closed，不能回退成 shared system input 或 workspace file writer。
- T2: 增加 ordinary chat / Runtime Codex acceptance writer，要求当前运行的 `module.invoke(browser.executeBoundedOperation)`、BrowserHostSession source-page refs、page-text refs 和用户级 final answer；strict release 如果仍被 service-env 策略阻断，记录为 release blocker。
