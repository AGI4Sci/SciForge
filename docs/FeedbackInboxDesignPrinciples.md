# 反馈收件箱设计原则

最后更新：2026-05-24

反馈收件箱是 SciForge 的用户反馈、GitHub 同步、Runtime Codex repair 和证据审计控制面。它不是普通列表页，也不是 agent host。它的职责是把用户在 GUI 中指出的问题变成可复现、可同步、可交接、可审计的产品数据，并把修复过程以受控方式呈现给用户。

## 定位

反馈收件箱是 issue triage、GitHub sync 和 Codex CLI repair 的主入口，也是全局注释侧栏保存 `annotation-plan` 记录的落点。工作台和非工作台页面都通过同一条注释流程进入收件箱：用户点选一个或多个 GUI 对象，`AnnotationSidebar` 作为 GUI Shell input/presentation surface 承载 plan-only 澄清，保存后生成可审计的 feedback inbox record。

顶部 `注释` 入口不再把注释讨论写入工作台主 composer。工作台主 composer 继续承担执行、研究和普通对话入口；注释侧栏只复用主 conversation kernel 的引用、stream/event 和会话能力，作为 `annotation-plan-only` projection 产出反馈草稿。批量选择、request bundle、GitHub issue、repair queue、系统 Terminal launch、Web Viewer attach、repair log evidence、patch approval 和 post-repair browser recheck 都属于收件箱。

SciForge GUI 仍然是 TUI agent 的展示和控制扩展。repair executor 是 SciForge 后端以 Runtime Codex / Codex CLI profile 调用的服务，不是当前 Codex App 助手。收件箱可以启动 handoff、显示 mirror、发送 guidance、记录确认动作，但不能把 GUI transcript 拼成 agent truth，也不能从 terminal 文本自行推断成功。

## 核心原则

### 1. 本地反馈是产品真相源

本地 feedback bundle、screenshot evidence、GitHub sync state、repair run/result/action/guidance 和 repair log refs 是产品数据。GitHub issue 是协作和同步面，不取代本地批注和证据。Codex repair 不能删除、重写或伪造这些数据来制造成功。

每条反馈必须有稳定本地 ID 和 refs。关联关系要靠 ID、bundle refs、issue number/url、repair run/result ids 和 evidence refs，而不是标题、截图文件名或可变文本。

`annotation-plan` 记录也是本地反馈真相源。它必须保留引用对象列表、页面 URL/route、原始用户描述、plan-only 澄清问答摘要、修改建议、验收标准和 evidence refs；它不能把侧栏中的对话当成 repair 指令、GitHub issue body 或 workspace patch。

### 2. Repair 必须自主完成

主 Codex 助手和 Runtime Codex/Codex CLI repair 是两个隔离角色。主会话可以维护收件箱代码、任务板、文档、测试和 UI 验收，但不能把自己的 root cause 分析、补丁方案、命令序列、测试捷径或隐藏上下文传给 repair CLI。

repair CLI 的输入只能来自这些明确信息源：用户反馈 bundle、截图/DOM/evidence refs、repo 当前文件状态、固定护栏/验收策略、expected tests、以及用户在收件箱 terminal 中显式输入的 guidance。任何 guidance 都必须作为用户输入写入 audit；不能由主会话代写实现提示。

当 repair CLI 遇到 `unsupported call: apply_patch`、provider 超时或 workspace writer 状态漂移时，收件箱只能记录事实、阻塞来源和可见状态，不能把主会话推断出的 workaround 作为隐藏 prompt 注入给 repair CLI。下一次 repair 必须由 CLI 基于可见 repo 和 issue evidence 自主恢复或 fail closed。

### 3. 证据先于叙述

反馈必须同时捕获用户评论、期望/实际行为、目标元素快照、页面运行时上下文和截图证据。目标元素快照至少包含 stable selector、DOM path、role/label/text snippet、bounding box、comment point、URL/route、viewport、scroll、devicePixelRatio、session/run/artifact 摘要。

截图证据应采用整页无损 PNG。原始图保留在 private evidence，scrubbed annotated 图保留在 public evidence。标注图必须框出目标元素并标出评论点位或编号。截图失败时反馈仍可保存，但必须降级为 partial evidence，并把诊断显示给用户。

GitHub issue body 和公开 JSON 不允许内联 `data:image/...`。GitHub 中只引用 scrubbed evidence URL 或 repo/object refs；原始 data URL 只留在本地 bundle。

### 4. 让用户先看到必要信息

收件箱卡片必须 summary-first。默认可见内容只放用户最需要判断的一层：评论摘要、状态、优先级、repair badge、Evidence 完整度、Target 摘要和截图预览。

细节采用渐进展开：期望/实际行为、repair 交接与终端、target selector、runtime refs、evidence refs、diagnostics、tags 都放在 `details` 中。用户需要时能展开，默认不要把所有 refs、坐标、terminal、diagnostics 塞进首屏。

截图预览是可选择证据对象，不是装饰图。缩略图只用于节省布局空间；打开和放大必须指向高清 evidence 图。用户应能复制 ref、打开托管或本地 preview URL，并在 evidence object 列表中切换 raw / annotated / bundle refs。

截图 lightbox 必须是键盘可用路径：打开后焦点进入关闭按钮，`Esc` 可关闭，关闭后焦点回到触发的截图或放大按钮。证据 ref、打开、复制、放大都必须有可见 focus 状态，不能让键盘用户在 overlay 关闭后丢失位置。

截图预览缺失不能让卡片看起来像没有证据组件。若只有 bundle/ref 而没有可预览 image，卡片必须显示 `截图预览缺失`、保留可复制/可打开 ref，并解释是 ref-only、capture failure 还是 diagnostics 指出的其他原因。

### 5. 状态机必须可恢复

反馈状态包括 `comment`、`annotation-plan`、`request`、`open`、`github-open`、`triaged`、`planned`、`fixed`、`blocked`、`needs-discussion`、`wont-fix`、`deleted`。筛选、批量选择、批量标记、生成 request、软删除和恢复都必须依赖本地状态机，刷新后可恢复。

`annotation-plan` 来源的条目默认是 open/draft-ready，不自动进入 repair、code、GitHub sync 或 workspace write 路径。只有用户在收件箱中显式点击 repair/code/sync 类动作，并通过对应确认边界后，才可以把该记录升级为 request、GitHub issue 或 Runtime Codex repair 输入。

删除只能软删除本地条目或取消选择。不能删除 GitHub issue、repair audit、patch、workspace diff、repair log evidence 或截图原始证据。恢复必须保留原有 refs 和 audit。

软删除这类 destructive local queue action 也必须使用收件箱内确认边界，而不是浏览器原生 confirm。确认面板要说明 scope、local effect、不会触碰的 GitHub/repair/evidence 数据，以及取消后的无副作用结果。

### 6. GitHub 同步 fail closed

GitHub repo 默认来自当前 `origin`，但 repo、labels、assignees、milestone、token source、dry-run/real-submit 必须可配置。缺 token、权限不足、rate limit、repo 不存在、网络失败或 body 过长都必须 fail closed，保留本地 feedback 和 pending/failed sync 诊断。

file-backed `config.local.json` 是 GitHub token presence 的权威来源。浏览器 localStorage 可以缓存非敏感 UI 偏好，但不能在文件配置缺 token 时继续把旧 token 呈现为 configured；否则用户会误以为外部同步可用。

提交前应上传或引用 scrubbed annotated evidence。issue body 必须结构化包含 summary、repro steps、expected/actual、target element evidence、screenshot evidence、environment、local IDs/refs、repair policy 和 sync metadata。拉取 GitHub open issues 时要去重，保留 remote number/url/state/labels/updatedAt；远端和本地冲突时显示 conflict，不覆盖用户本地批注。

任何会把数据发给 GitHub 或对象存储的操作都必须有 action-time confirmation：上传 public evidence、创建 GitHub Issue、拉取 open issues 都要先显示 destination、scope、data type 和 side effect。取消必须按动作明确说明没有发生什么：sync 没有向 GitHub 发起读取请求、没有发送 token、也没有改动本地同步缓存；submit 没有发送 token、issue payload 或 evidence；upload 没有上传 evidence 或回写公开 URL。确认之后才允许调用外部 API。Dry-run 可以不创建远端内容，但仍要把本地状态变化说清楚。

卡片上应直接显示 GitHub sync trace：local feedback id、sync status、issue number/url/state、syncedAt/updatedAt、冲突或失败原因，以及可公开的 scrubbed evidence ref。GitHub markdown 和折叠 JSON 都只能发布 public/scrubbed/uploaded evidence；private raw evidence、local-only refs 和 raw screenshot asset 不进入 issue body。

收件箱顶部必须有页面状态诊断，把 workspace writer、provider/env、repair peer sync、GitHub token、用户确认门槛和 screenshot evidence gaps 摆在用户操作之前。缺 token、缺截图预览、peer writer 失联、provider/env 不可用，或下一步需要外部确认/用户 terminal guidance 时，用户不应靠点击失败才发现问题；状态行应给出当前值、影响范围和下一步。workspace writer 行必须显示实际 writer URL，健康时也要显示 URL 和 pid/startedAt，失联或 stale capability 时要显示正在诊断的 URL 和错误/缺失能力。

workspace config 和 `.sciforge/workspace-state.json` 也必须作为页面状态显示。加载期间不能让用户把空列表误解成真的无反馈；状态行应显示 `加载中`，并解释反馈计数、筛选和操作范围会在 workspace snapshot 完成后刷新。hydration 完成后应短暂保留 loading row，避免用户只看到空白闪烁而无法判断状态来源。

### 7. Repair readiness 要拆成可执行与可发布

启动 Runtime Codex repair 前，收件箱必须把 readiness 拆成三层：

- `dispatchReady`：当前 workspace writer 健康、具备 repair handoff/terminal/guidance capability，可以从当前控制面创建 direct Runtime Codex repair run。
- `executionReady`：Runtime provider preflight 可执行，service env 具备必要 key/upstream，不把 config fallback 当成 release-ready。
- `releaseReady`：strict Codex in-app browser acceptance evidence 新鲜且来自当前 run，GitHub/PR/release 可以引用这次证据。

enabled + repair trust 的 peer instance、目标 peer writer health 和 instance manifest 是同步、目标状态镜像、交接审计和发布诊断，不应阻断当前 workspace writer 发起 direct Codex CLI repair。peer 不可用时，terminal 必须写入诊断并继续走当前 writer 的 direct dispatch；provider/env 不可执行时，才写 durable blocked repair result/audit。

本地 dev 场景中，ignored `config.local.json` 可以由 workspace writer 转成 Runtime Codex launch env，供 repair CLI 使用；UI 和长期 evidence 只能显示 `present/ready/missing` 这类状态，不能展示 secret 值或把 secret source 写入 GitHub/docs。当前 writer fallback 必须把 result 写回当前 workspace state，同时仍在隔离 worktree 中运行，不能直接修改用户工作区。

任何真实阻塞都要写 durable blocked repair result/audit，而不是只显示 transient hint。blocked result 应包含 failure kind、readiness rows、provider/browser/peer diagnostics 和下一步命令。

### 8. Repair log evidence 不是第二个工作终端

repair log evidence 的目标是让用户审计 Codex repair 进度。它可以复制、折叠、停止、导出，但不能作为第二个工作终端，也不能作为 completion verdict 的来源。成功/失败边界必须来自 repair result、test refs、patch/diff refs、audit bundle、guard digests 和 human/browser verification。

repair log 可实时直出，但进入 GitHub issue、audit summary 或长期报告前必须 bounded/scrubbed，移除 secret、token、raw provider body 和敏感绝对路径。停止 repair 必须只停止当前可识别 active turn，不能杀错 run。

用户 guidance 是 audit 事件。若 backend 能找到 Runtime Codex native session id，应通过 Codex 原生 resume 继续；如果没有 session id，也必须先持久化 guidance，并标明 resume-unavailable 或 failed-closed。

第一次点击和第一次输入必须先产生本地可见 run：同一反馈卡片 1 秒内应出现 repairRunId、terminalMirrorRef、至少一条 terminal event、当前状态和下一步。启动、发送、复制、导出、停止等按钮被禁用时，禁用原因必须在按钮附近可见；导出和复制成功也必须给出即时反馈。

系统 Terminal 是默认推荐控制面，尤其当 repair 会触及反馈收件箱、Vite、workspace writer 或 repair backend/control surface 时。Web Viewer 只负责 attach/status/input convenience；如果浏览器刷新、切换页面或 Vite HMR 破坏了前端，后台 Codex 进程仍应由系统 Terminal 或 detached session 继续拥有。

repair session header、actions、guidance input、confirmation boundaries 和 safe-mode 提示必须能在窄屏下折行。toolbar 的 status filter、search、selection count、token note 和 action buttons 也必须限制在容器宽度内，必要时整行或两列折行；按钮文案可以换行，但不能撑破页面。延迟帮助 tooltip 未显示时不能参与滚动尺寸，进度圈也必须留在按钮盒内。长 log ref、patch ref、commit ref、GitHub URL 和 evidence ref 要么截断并提供 title/copy，要么在展开区域用 `overflow-wrap:anywhere`，不能撑破卡片或盖住相邻控件。

如果 Runtime Codex 在 `codex exec --json` 边界遇到 `unsupported call: apply_patch`，收件箱要把它解释为 runtime 工具桥限制，并记录 repair CLI 自主恢复或 failed-closed 证据。不能把这种 backend limitation 误呈现成用户没有正确操作 terminal，也不能注入主会话的 workaround。

### 9. Repair 默认只产出 patch 和审计

repair request 必须包含 issue refs、feedback evidence、repo config、base branch、允许写入路径、禁止写入路径、expected tests 和确认策略。Runtime Codex 在隔离 worktree/branch 中运行，开始前记录 base commit、dirty worktree、protected files digest 和 feedback data digest。

默认不 commit、不 push、不 PR、不 merge。commit 需要用户确认且只在隔离 repair worktree 创建本地 commit。push 和 PR 需要第二次单独确认。merge 永远不能自动执行，点击也只能 fail closed 或记录被拒绝审计。

如果 repair 触及反馈收件箱、feedback capture、workspace writer、repair handoff runner 或 repair backend/control surface，必须进入 safe mode。safe mode 下 repair log 仍可读，新的 patch apply / commit / push / PR 需要额外确认或外部控制面复核。

### 10. Browser 验收优先

用户级验收必须使用 Codex in-app browser。terminal smoke、unit test、API probe 和 Playwright-style diagnostics 只能补充。声称修复成功前，必须能对应到真实文件改动、命令输出、browser DOM/截图证据或明确 blocked manifest。

涉及注释、反馈或收件箱的验收必须同时覆盖工作台页面和至少一个非工作台页面：两处都要能从可见 `注释` 入口点选多个对象，进入全局 `AnnotationSidebar`，完成 plan-only 澄清或跳过澄清，保存为反馈收件箱 `annotation-plan` 记录。仅验证旧的“顶部注释 -> 主 composer”路径不能算通过。

post-repair browser recheck 是 first-class repair action。它必须记录结论、时间、verifier、evidence refs，并写回 repair result humanVerification。没有严格、新鲜的 in-app browser evidence 时，不能把 recheck 记成 passed。

### 11. 泛化优先，禁止 case patch

反馈入口不能依赖特定组件名、硬编码 selector、固定 issue id、固定 provider、固定 repo 或当前 demo 文案。目标元素选择、refs、evidence path、GitHub body、repair request、readiness gate 都要能泛化到不同页面、不同元素、不同 repo 配置、不同用户输入和不同 peer instance。

## 当前实现映射

主要代码路径：

- `src/ui/src/feedback/FeedbackCaptureLayer.tsx`：任意元素评论入口和提交。
- `src/ui/src/feedback/captureModel.ts`：target/runtime snapshot、整页 PNG screenshot、annotation、scrub、evidence status。
- `src/runtime/workspace-server.ts`：feedback bundle 持久化、public/private repair evidence 文件、preview、upload、repair run/result/action/guidance APIs。
- `src/ui/src/app/sciforgeApp/FeedbackInboxPage.tsx`：收件箱状态机、summary-first 卡片、GitHub submit/sync、readiness gate、repair handoff、confirmation routing。
- `src/ui/src/feedback/FeedbackScreenshotPreview.tsx`：截图证据对象、高清打开/放大、复制 refs。
- `src/ui/src/app/sciforgeApp/feedbackRepairReadiness.ts`：workspace writer、repair peer、provider preflight、strict browser acceptance readiness。
- `src/ui/src/app/sciforgeApp/feedbackBlockedRepairResult.ts`：blocked repair durable audit。
- `src/ui/src/feedback/FeedbackRepairAuditPanel.tsx`：repair log evidence、evidence completeness、guidance、stop、browser recheck、commit/push/PR/merge gates。
- `src/ui/src/feedback/githubFeedback.ts`：GitHub issue body、screenshot data URL omission、evidence refs、sync conflict。
- `src/runtime/repair-handoff-runner.ts`：Runtime Codex repair handoff、isolated worktree、guard/audit、repair log evidence、provider pre-dispatch gate。
- 当前 workspace writer direct repair 是默认启动面；peer writer/manifest 是可选同步和 target state mirror，不是 direct dispatch 的硬依赖。

目标注释映射：

- 全局 `AnnotationSidebar` 属于 GUI Shell input/presentation，不是 agent host。
- 侧栏消息、引用 token、stream/event 展示和会话状态复用主 conversation kernel，并通过 `annotation-plan-only` envelope 限制输出。
- Plan-only 侧栏禁止 workspace writes、repair/code execution、GitHub side effects 和隐藏 guidance 注入。
- 保存动作只写本地 feedback inbox `annotation-plan` record；repair/code/GitHub sync 只能从收件箱显式启动。

Evidence path policy：

- `repair-evidence/public/feedback-screenshots/<feedback-id>/scrubbed-annotated.png` 可上传/托管，可写进 GitHub markdown。
- `repair-evidence/private/feedback-screenshots/<feedback-id>/raw.png` 本地私有，不进 git，不上传。
- `.sciforge/feedback/<feedback-id>/` 保存本地 bundle 和 data-url 证据，是 workspace-local source of truth。
- `.sciforge/repair-results/<repair-run-id>/` 保存 repair log evidence、patch、plan、tests、audit、blocked preflight evidence。

## 回归检查清单

改动反馈收件箱、capture、GitHub sync 或 repair backend 后，至少检查：

1. 从 Codex in-app browser 真实创建反馈，收件箱能看到同一条反馈；注释流程必须在工作台页面和至少一个非工作台页面各保存一条 `annotation-plan` record。
2. 反馈有 target snapshot、runtime snapshot、raw screenshot、scrubbed annotated screenshot 和 scrubbed status。
3. 截图是整页 PNG；缩略图可以小，打开/放大必须是高清图。
4. GitHub issue body 不包含 inline `data:image/`，但包含 screenshot refs 或 markdown image URL。
5. 缺 token、缺 peer、缺 provider env、peer manifest 不匹配、browser evidence 缺失时都 fail closed，并写 durable blocked audit。
6. repair log evidence 可读、可复制、可折叠、可停止、可导出，但 UI 不从日志文本判断 fixed。
7. commit/push/PR/merge confirmation boundaries 仍然生效，safe mode 仍然要求额外确认。
8. soft delete / restore 不破坏 evidence、GitHub sync state、repair audit 或 repair log refs。
9. 搜索、筛选、选择当前列表、批量操作和 GitHub trace 的作用范围清楚；隐藏选择不能被当前可见列表操作误修改；本地软删除必须先出现收件箱内确认边界，GitHub upload/submit/sync 必须先出现外部操作确认边界，取消时不能发送外部请求或改动本地队列。
10. lightbox 支持关闭按钮 focus、`Esc` 关闭和焦点返回触发按钮；窄屏 toolbar、repair session header/actions、guidance input、safe-mode 行不重叠，页面文档宽度不超过当前 viewport。
11. `npm run typecheck`、touched area targeted tests 和 `git diff --check` 通过。

文档或原则变更时，至少跑 `git diff --check`。
