# SciForge 真实 Computer Use 联调与端到端验收

本文是可重复执行的产品验收入口。它验证的是 **SciForge 内 Agent** 的真实生产链，不是由外层测试工具直接点击界面。

## 1. 通过标准

必须完整经过：

```text
SciForge Agent
  -> sciforge_discover
  -> managed MCP 五个 Computer Use 工具
  -> computer-use domain / MCP server
  -> Python sidecar
  -> SessionInputChannel / BackendRouter
  -> browser-cdp
  -> SciForge Electron webContents
  -> observe / action / verify / release
```

一次合格验收同时满足：

- 发现五个工具，不能绕过 capability catalog；
- 绑定 `electron-webcontents` 的完整 target；
- `backend=browser-cdp`；
- `requestedIsolation=effectiveIsolation=host-app-scoped`；
- `allowDegraded=false` 且 `degraded=false`；
- 点击 verification 为 `verified`，最终 `finalObservation.semanticTree` 能确认目标页面；
- 无论成功失败都 release；
- session、request、active lease、channel、waiter、cleanup 和 backend handle 全部清零；
- 未使用 Legacy，未降级；`ACTION_OUTCOME_UNKNOWN` 时绝不重放。

外层自动化只允许新建对话、发送验收指令、查看结果，以及在 Host 审批卡上点击 `Allow`。外层直接点击 Settings 不能作为 Computer Use 通过证据。

## 2. 模型接入路径

两种外层 Agent 接入都应支持 Computer Use，但内部边界不同：

| 外层 Agent 模式 | 固定端口 | Python planner 的正确路径 |
|---|---:|---|
| Model API | 3892 | Host Model Router；上游凭据只由 Host 持有 |
| Coding Plan | 3893 | Host Agent model bridge；订阅凭据只由 Codex app-server 持有 |

Coding Plan 下，3892 未监听是正常状态。Python planner 不应再固定请求 `127.0.0.1:3892`，也不能直接获得 Coding Plan bearer。domain 会启动仅绑定 loopback 的临时 bridge，使用随机 bearer 保护 `/v1/responses`，再通过 Host `agentExecution.run` 创建无工具的内部规划回合。

任何 bearer、invocation proof secret、Router runtime key 或上游 API key都不得写入本文、仓库、启动参数输出或验收摘录。每次启动使用新随机值，并确保 Electron 与 sidecar 继承同一父进程环境。

## 3. 启动前只读核对

在目标 worktree 中执行：

```powershell
git status --short --branch
git rev-parse HEAD
git diff --check

$ports = 3892,3893,3900,5173,5174
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $ports -contains $_.LocalPort } |
  Sort-Object LocalPort |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

不要为“清理环境”执行 `reset`、`checkout`、`clean` 或删除现有改动。若端口被占用，先用 PID 和父 PID 确认它确实属于本次独立实例，再终止精确进程树。

Windows 根 `npm run dev` 可能命中随仓库提供的 Linux Node runtime 基线限制。复用已构建依赖时，Electron 开发入口是：

```powershell
node node_modules/electron-vite/bin/electron-vite.js dev
```

Python sidecar 从 worker 目录启动：

```powershell
python -m cua.cli --http
```

两者必须由同一已注入临时环境变量的父环境启动。不要在命令中写死或回显值。Windows 首次 Electron/Vite 构建可能需要约 60–90 秒；只看到 3900 或 5173 时先继续等待，不要立即重复启动。

预期端口：

- 3900：Computer Use Python sidecar；
- 5173、5174：SciForge/Vite；
- Coding Plan 为 3893，且通常没有 3892；
- Model API 为 3892。

## 4. 手工验收提示词

在 SciForge UI 中点击 `New Agent`，粘贴以下任务：

```text
请由你（SciForge 内 Agent）执行一次真实 Computer Use 生产链验收。
1. sciforge_discover 只能使用 text="computer use", providerFamily="managed-mcp", limit=20，不传 scope；原样列出五个工具。
2. 调用 capabilities 与 list_targets，选择当前 SciForge 自有 kind=electron-webcontents 的完整 target。
3. 生成新 UUID。bind 的 input 必须且只能为 {sessionId,target}，target 逐字段复制；禁止传 backend/isolation。
4. bind 后只调用一次 computer_use，instruction="点击左侧 Settings，并确认设置页已打开"，requestedIsolation="host-app-scoped"，allowDegraded=false。必须 browser-cdp；禁止 Legacy、降级、重放；ACTION_OUTCOME_UNKNOWN 时禁止重放。
5. 检查 provenance 和 click verification，并用 run 返回的 finalObservation.semanticTree 确认 Settings 标题。
6. 无论成功失败都 finally release。
7. release 后再次调用 capabilities，原样报告 runtime.counts、activeChannels、activeRequests、cleanupPending、waiters、backendHandles。
完整报告五工具、target、bind、run、verification、release 和资源清理。不得读取或输出凭据。
```

bind、run、release 可能分别出现人工审批。确认工具和参数属于本次验收后可以点 `Allow`。

### 4.1 多 Session BrowserContext 验收

当 SciForge 自有 Electron webContents 不足三个时，使用仓库提供的测试拥有环境；不得伪造多个 target。它创建四个独立 Chromium BrowserContext，每个 context 各含一个 page、cookie、localStorage、状态控件和独立生命周期：

```powershell
npm run computer-use:multisession:harness -- `
  --contexts 5 `
  --ready-file .tmp-cua-multisession/ready.json `
  --runtime-dir .tmp-cua-multisession/chromium
```

`--contexts` 支持 2–8，默认 4；超出范围或未知参数会明确拒绝。每个 context 对应一个独立 target/page 和独立 cookie/localStorage 状态。

将 `ready.json` 中的随机 CDP endpoint 注入独立 SciForge 实例的 `SCIFORGE_CUA_CDP_ENDPOINTS`。仍由 SciForge 内 Agent 按 `surfaces` 数量完成不同 UUID 的 bind、一次有界 `parallel` run、逐项 verification/final semanticTree、finally release 和最终 capabilities。外层不得直接调用 adapter 或 sidecar 代替内 Agent。

并行 run 必须满足：

- 2–8 个预绑定 Session，Session ID 和完整 target ID 分别唯一；
- `requestedIsolation=host-app-scoped`、`allowDegraded=false`；
- 每个 child 拥有独立 request/channel/lease/backend handle；
- 成功 child 的 action 时间区间存在正数公共交集；
- 失败、超时或 target-loss child 不影响其他 target；
- 父 batch cancel 必须锁存到尚未注册的 child，并扇出到已启动 channel；
- 所有 Session finally release，活动资源全零。

这证明的是多个独立 BrowserContext/page 的 target-scoped 输入与存储隔离；不要把多个 page 描述成多个独立 Windows input desktop，也不要把同一 BrowserContext 内的多个 page 描述成 cookie/storage 隔离。

### 4.2 脱敏证据导出

要求 SciForge 内 Agent 将本轮原始工具结果写入一个临时 capture JSON，顶层字段为：

```text
runId
batch              # computer_use parallel 的完整 ServiceResult
releases           # 每个 Session 的 release ServiceResult 数组
finalCapabilities  # release 后 capabilities 的完整 ServiceResult
harnessState       # 可选，测试拥有状态端点的最终读回
```

然后在仓库根目录运行：

```powershell
npm run computer-use:multisession:evidence -- `
  --input .tmp-cua-multisession/capture.json `
  --output output/computer-use-multisession-evidence.json
```

导出器会拒绝重复 Session/target、串行伪并发、缺失 release、未验证的成功动作和任何非零活动资源；URL、CDP endpoint、Authorization、token、secret、API key、截图与本地路径自动脱敏。输出只保留 target/session/request 身份、隔离、动作 outcome、verification、final semanticTree、时间线、release 和资源计数。完成导出后删除原始 capture 和 runtime 临时目录，只保留脱敏 evidence。

验收支持脚本的快速回归入口：

```powershell
npm run computer-use:multisession:test
```

### 4.3 已验证的真实网页小任务

下表记录 2026-08-11 在 Windows 11 上完成的产品级验收。每轮均启动全新的
SciForge、Computer Use sidecar、CDP adapter 和测试拥有的 Chromium；网页动作由
**SciForge 内 Agent** 经 managed MCP 生产链发起。外层自动化只负责新建聊天、选择
`Med`、发送任务和处理 Host 审批。

| 页面与范围 | SciForge 内 Agent 执行的任务 | 准确结果 |
|---|---|---|
| Playwright 官方 TodoMVC，单 BrowserContext | 观察页面，点击待办输入框，输入 `Review SciForge web evidence`，按 Enter 提交，并从最终 semantic tree 读回待办 | 1/1 成功；目标文本只出现一次；release 后活动资源全零 |
| Playwright 官方 TodoMVC，五个独立 BrowserContext | 单次 `parallel[5]` 分别创建 Alpha/Beta/Gamma/Delta/Epsilon 待办，再逐页读回 | 任务层 4/5：Alpha、Beta、Delta、Epsilon 成功且互不串写；Gamma 在任何动作前由规划模型明确失败。五个 child 的完整执行区间公共重叠 33 秒；所有 Session 均 release，活动资源全零 |
| 英文 Wikipedia，单 BrowserContext | 在站内搜索框输入 `CRISPR`，按 Enter 导航到条目，读回标题与简介语义节点 | 成功；Enter 为 `verified/url-changed`，最终状态为 `agent_reported_done`，h1 为 `CRISPR` |
| 英文 Wikipedia，四个独立 BrowserContext | 单次 `parallel[4]` 同时搜索 `CRISPR`、`Cas9`、`Genome editing`、`Bacteriophage`，并读回各条目 h1 | 4/4 成功；四路均为 `browser-cdp`、`host-app-scoped`、无降级、`agent_reported_done`；四个 Enter 均为 `verified/url-changed`。公共执行重叠 `191010.297 ms`，跨 Session 的 committed+verified action 最大重叠 `49.598 ms`；release 后八类活动资源全零 |

这里的“五个工具”是 capability catalog 暴露的五个 managed MCP Computer Use 工具，
不是五次 Wikipedia 搜索。最终 Wikipedia 并发验收包含四个搜索任务。

这些结果证明当前受控 CDP 路径可以完成一组小型、可回读的网页任务：

- 观察目标页面并基于 semantic tree 选择控件；
- 点击并聚焦输入控件；
- 输入文本、发送 Enter 等按键并验证提交或导航；
- 在导航销毁旧 execution context 后只重试只读 readback，不重放 click/key；
- 从最终 revision 的 semantic tree 读回待办文本、页面标题和可见正文线索；
- 在不同 BrowserContext/target 上并发执行，并在 finally 中释放 Session、Request、Lease、Channel 和 backend handle。

验收不等于“任意网站自动化”。它没有证明登录、验证码、支付、上传、下载或第三方
生产账号流程，也没有证明普通未开放调试端点的 Chrome。多个 BrowserContext 提供
target-scoped 页面与存储隔离，但不等同于多个独立 Windows input desktop。

## 5. 结果判读

成功证据至少包含：

```json
{
  "backend": "browser-cdp",
  "requestedIsolation": "host-app-scoped",
  "effectiveIsolation": "host-app-scoped",
  "degraded": false
}
```

点击 outcome 应为 committed，并有 `verification=verified`。`finalObservation` 必须属于点击后的 revision，其脱敏 `semanticTree` 中应出现 Settings 页面标题。仅有“模型说成功”、仅有截图、或仅有 `observationRevision` 都不够。

release 后预期：

```json
{
  "counts": {
    "sessions": 0,
    "requests": 0,
    "activeLeases": 0
  },
  "activeChannels": 0,
  "activeRequests": 0,
  "cleanupPending": 0,
  "waiters": 0,
  "backendHandles": 0
}
```

历史 tombstone 可以非零；它不是活动资源泄漏。

## 6. 常见失败与分类

| 现象 | 分类 | 处理 |
|---|---|---|
| Coding Plan 下 planner 请求 3892 并返回 502 | 产品回归 | Host Agent model bridge 未注册或 sidecar 未被 owner 配置 |
| `CUA_SERVICE_TOKEN is required` | 启动配置失败 | Electron 与 sidecar 没有继承同一组非空随机 token；禁止关闭认证绕过 |
| `sciforge_discover` 返回空 | capability catalog/runtime 注册失败 | 查 domain 启动和 schema diagnostics；不能绕过 catalog 直接调用 |
| `Codex app-server client stopped` 且 turn 未开始 | Coding Plan 环境/生命周期 | 消息未执行；确认 3893 与 app-server 后可安全新建对话重试一次 |
| click committed 但 `unverified` | 产品验证回归 | 检查 renderer settle、URL/焦点/语义树 readback；不能靠外层点击补证据 |
| `ACTION_OUTCOME_UNKNOWN` | 不确定副作用 | 禁止重放；先观察状态并 release |
| release 返回 `SESSION_NOT_FOUND` | 可能是确定性失败后的兜底 | 结合首次 release/自动关闭证据如实记录，不假报成功 |

对每个失败标注为：本次回归、仓库基线、环境/上游限制，或安全边界按设计拒绝。

## 7. 回归测试矩阵

从仓库根目录运行：

```powershell
npm --workspace @sciforge/domain-computer-use test
npm --workspace @sciforge/domain-computer-use run typecheck
npm exec vitest run src/main/runtime/agent-runtime/runtime-mcp-tool-gateway.test.ts
npm exec vitest run src/main/model-access-gateway-sidecar.test.ts src/main/plan-gateway-sidecar.test.ts
npm exec vitest run src/main/runtime/codex/codex-service.test.ts
npx tsc --noEmit -p tsconfig.node.json
npm --workspace @sciforge/domain-sdk run typecheck
```

从 `packages/workers/gui-owl-computer-use` 运行：

```powershell
python -m pytest tests -q
python -m ruff check cua driver tests --select F,E9
```

真实 CDP 故障矩阵必须显式 opt-in，并使用测试拥有的 headless Chromium：

```powershell
$env:CUA_CDP_INTEGRATION='1'
python -m pytest `
  tests/integration/test_cdp_headless_integration.py::test_post_dispatch_transport_loss_is_unknown_and_not_replayed `
  tests/integration/test_cdp_headless_integration.py::test_parallel_batch_parent_cancel_reaches_all_real_cdp_channels `
  tests/integration/test_cdp_headless_integration.py::test_parallel_batch_target_loss_does_not_break_other_real_pages `
  -q
```

最后执行仓库已有的 domain/capability checks，并审查：

```powershell
git diff --check
git diff --stat
git diff
```

确认无凭据、旁路、临时代码、测试硬编码或无关修改后，才允许形成本地提交。推送和创建 PR 是单独授权动作。

## 8. 验收记录模板

每次记录：worktree、branch、HEAD、端口模式、五工具 operationRef/title、target、sessionId、bind、run provenance、verification、finalObservation、release、清理计数、全部测试命令与准确结果、失败分类、diff 自审结论和本地提交哈希。凭据字段一律省略，不使用伪造或占位值冒充真实证据。
