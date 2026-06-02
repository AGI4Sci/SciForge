# Browser Pane Dogfood Runbook

最后更新：2026-06-02

本 runbook 用于真实 dogfood SciForge 右侧 Browser pane 的连续冲浪体验。它只验证用户可见的 Browser pane，且产品验收只接受同一个 `BrowserHostSession` owning `native-embedded` live surface。不得用外部浏览器、host-stream、frame-stream、WebRTC、canvas、HTTP `/frame`、iframe/proxy/snapshot/旧 frame 或系统 popup 冒充 live browser。所有场景都必须保持通用：可以选择任意公开、低风险、无需登录的网站或搜索入口，但不能把通过某个固定站点、固定 URL、固定截图或固定搜索结果当成通过条件。

## 适用范围

每次 run 必须从 SciForge 工作区内的右侧 Browser pane 开始，使用同一个 `BrowserHostSession` 完成导航、输入、点击、滚动、返回、前进、刷新、复制 URL 和 open-external handoff。产品通过条件必须同时满足：`BrowserHostSession` owner、`native-embedded` surface、`singleInteractiveTruth=true`、`secondTruthSource=false`、证据 `refs-first`。Desktop 或 Web shell 只要缺少 native attach，都只能记录 typed `blocked` / `retry` / `handoff` / refusal diagnostic，不能把 stream、canvas、WebRTC 或 HTTP frame 当作 handoff pass。证据 artifact 只做审计和 manual inspection，不能作为第二个可交互画面。

通过条件不是“页面内容正确”，而是 Browser pane 像正常浏览器一样连续可用：动作有可见反馈、输入不丢字、不乱序，滚动和拖拽不出现用户可感知的队列堆积，state/refs 可以滞后但不能阻塞热路径。

## 禁止事项

- 不记录 raw DOM、raw AX tree、raw screenshot bytes、base64、完整 console/network logs、provider payload、cookie、token、password、session secret、机器本地绝对路径或用户私有内容。
- 不把当前页面、当前 URL、当前搜索引擎、当前结果排名、当前截图像素或某次历史网络状态写成验收硬编码。
- 不在 live surface 不可用时切换到 iframe、proxy、静态截图、PDF、document、replay、旧 frame 或系统 popup 继续声称通过。
- 不把 host-stream、frame-stream、WebRTC、canvas、HTTP `/frame`、snapshot、iframe、proxy、`<webview>` 或系统 popup 写成产品 live surface、fallback、handoff pass 或第二个可交互入口；它们只能出现在 forbidden fallback、diagnostic、migration audit 或 refusal 记录中。
- 不让 screenshot、DOM、AX、console/network、search summary 或 state polling 阻塞 click/type/drag/scroll/cursor 热路径。

## 运行前检查

1. 打开 SciForge 工作区，确认右侧 Browser pane 可见。
2. 记录 shell 类型：`desktop` 或 `web`；如果当前 shell 无法 attach native surface，本 run 的产品 live acceptance 必须是 `blocked`，不能降级到 legacy stream。
3. 记录 `sessionId`、writer health、native adapter health、transport、surface type、`singleInteractiveTruth` 和 `secondTruthSource`。
4. 确认 Browser pane topbar 的地址栏、back、forward、reload/stop、open-external 控件可见或可通过正常 UI 到达。
5. 准备一个公开、非敏感查询主题。查询内容必须能写入 evidence；不要使用账号、内部项目名、私有 URL 或个人资料。

## 三个连续冲浪场景

### 场景 A：公开技术资料检索

目标：验证搜索、多个结果打开、返回/前进、可见 loading 和 URL/title state 是否跟上。

真实 UI 步骤：

1. 在 Browser pane 地址栏或页面内搜索框输入一个公开技术主题，例如某类 API、标准、错误码或开源工具概念；不要指定固定搜索站点。
2. 提交搜索，等待首个可交互画面出现。
3. 用鼠标点击一个看起来像公开技术资料的结果。
4. 等待页面可交互，记录首帧时间和 loading 状态变化。
5. 使用 back 返回搜索结果，再用 forward 回到资料页。
6. 点击第二个不同结果或同页的一个文档链接，确认 navigation 继续由同一 `BrowserHostSession` 拥有。
7. 复制当前 URL，并用 open-external handoff 打开一次；handoff 后回到 SciForge Browser pane，确认 pane 中 session 未被替换。

验收重点：

- 输入完整，caret 可见，Enter 或点击提交没有被聊天输入框截获。
- back/forward 后地址栏、title、loading、canGoBack/canGoForward 状态可预测。
- open-external 是显式 handoff 诊断，不改变 Browser pane 的唯一真相源，也不能替代 `native-embedded` pass。

### 场景 B：长文档阅读与页面内查找

目标：验证长页面滚动、页面内输入、文本选择/复制和 state/refs 滞后不会卡住阅读。

真实 UI 步骤：

1. 从场景 A 的资料页进入一个长文档、长 issue、长文章或长参考页；只要求内容公开且无需登录。
2. 连续滚轮向下滚动至少 5 次，每次滚动后观察画面是否即时跟手。
3. 拖动页面滚动条或触控板进行一次较长距离滚动。
4. 使用页面自带搜索框、文档站内搜索框，或浏览器查找快捷键输入一个公开关键词。
5. 清空关键词后重新输入另一个短关键词，确认删除、重输、焦点和 selection 没有异常。
6. 选中页面上一小段公开文本或标题，复制；只记录复制动作是否成功，不记录完整复制内容。
7. reload 当前页面，确认旧画面不会被误标为 ready，loading/progress/blocked/retry 状态真实可见。

验收重点：

- 连续滚动没有明显秒级延迟或过期 frame 堆积。
- 页面内输入不会触发 Browser pane remount、焦点丢失或聊天 composer 捕获。
- refs 生成可以滞后，但用户继续滚动和输入不应被等待 evidence capture 阻塞。

### 场景 C：普通表单交互、拖拽与恢复

目标：验证常见鼠标/键盘编辑、拖拽、resize、tab 切换和失败恢复。

真实 UI 步骤：

1. 打开一个公开、无需登录、无购买风险的普通表单页、演示页、搜索页或设置页；不要提交真实个人信息。
2. 点击一个文本输入框，输入一段公开测试文本，包含英文、中文或符号中的至少两类。
3. 使用 Backspace/Delete、方向键、Cmd/Ctrl+A、复制、粘贴和 Escape，确认都作用在页面焦点内。
4. 操作一个可拖拽控件，例如滑块、分栏、地图/图表拖动、文本选择或页面滚动条；记录拖拽是否丢 pointerdown/move/up。
5. 调整右侧 Browser pane 宽度或切换到另一个右栏 tab 后再切回，确认 surface 仍 attach，焦点和 session 没被重建。
6. 使用 stop/reload/back/forward 各一次；如果页面阻塞、证书失败、网络失败或跨 app handoff，记录 typed blocked/retry/handoff 诊断。

验收重点：

- 键盘快捷键进入页面，而不是聊天 composer 或外层 shell。
- drag path 连续，鼠标按下和释放语义完整。
- resize/tab 切换不会 detach/remount live surface，或能给出明确 reconnect/blocked/retry 状态。

## Bounded Evidence 字段

每次 run 只记录下列有界字段。字段值应短、脱敏、可复核；大 payload 全部写 ref。

- `runId`: 人工生成的短 ID，例如 `browser-dogfood-YYYY-MM-DD-NN`。
- `timestamp`: ISO 时间。
- `operator`: 人或 agent 的短标识。
- `workspace`: 工作区名或脱敏路径别名，不写机器本地绝对路径。
- `shell`: `desktop` 或 `web`。
- `sessionId`: `BrowserHostSession` ID。
- `transport`: 产品通过时必须是 `native-embedded`；host-stream、frame-stream、WebRTC、canvas 或 HTTP `/frame` 只能记录为 forbidden/diagnostic/refusal。
- `surfaceType`: 产品通过时必须是 `BrowserHostSession/native-surface`；stream/canvas/frame/snapshot surface 不能作为 live surface。
- `singleInteractiveTruth`: 产品通过时必须是 `true`。
- `secondTruthSource`: 产品通过时必须是 `false`。
- `surfaceOwnerCheck`: 是否同一个 `BrowserHostSession` owner，是否发现 iframe/proxy/snapshot/旧 frame/legacy stream 伪装。
- `writerHealth`: `healthy`、`degraded`、`blocked`，附短 reason。
- `nativeAdapterHealth`: `healthy`、`unavailable`、`degraded`，附短 reason。
- `scenario`: `A-search-research`、`B-long-doc` 或 `C-form-drag-recovery`。
- `actionCount`: 本场景动作数量。
- `queryClass`: 查询类别，例如 `public technical topic`；不要记录敏感 query。
- `finalUrl`: 可记录公开 URL；若 URL 含 token、email、内部路径或长 query，改为 origin + path hash。
- `stableSelectors`: 最多 5 个稳定 selector 或 role/name 摘要，每个不超过 120 字符。
- `visibleLabels`: 最多 5 个公开可见短标签，每个不超过 80 字符。
- `latency`: 只记录 timing 数字和 p50/p95，不记录 raw logs。
- `refs`: 只记录 `stateRef`、`screenshotRef`、`traceRef`、`consoleLogRef`、`networkLogRef`、`domSnapshotRef`、`axSnapshotRef` 等 ref ID；禁止粘贴 ref 内容。
- `forbiddenFallbacks`: 若发现 host-stream、frame-stream、WebRTC、canvas、HTTP `/frame`、snapshot、iframe、proxy、`<webview>` 或系统 popup，记录短名称和 refusal reason；产品验收必须 fail 或 blocked。
- `diagnostics`: 最多 10 条短诊断，每条不超过 160 字符。
- `result`: `pass`、`partial`、`blocked` 或 `fail`。

## Latency / Transport / Surface / Ref 模板

```yaml
runId: browser-dogfood-YYYY-MM-DD-NN
timestamp: "YYYY-MM-DDTHH:mm:ssZ"
operator: "worker-or-human"
workspace: "sciforge-workspace-alias"
shell: "desktop | web"
sessionId: "browser-host-session-id"
transport: "native-embedded"
surfaceType: "BrowserHostSession/native-surface"
singleInteractiveTruth: true
secondTruthSource: false
surfaceOwnerCheck:
  sameBrowserHostSession: true
  liveSurfaceVisible: true
  forbiddenFallbackSeen: false
  notes: "short bounded note"
health:
  writer: "healthy | degraded | blocked"
  nativeAdapter: "healthy | unavailable | degraded"
scenarioResults:
  - scenario: "A-search-research"
    result: "pass | partial | blocked | fail"
    actionCount: 0
    queryClass: "public technical topic"
    finalUrl: "public URL or origin+pathHash"
    stableSelectors:
      - "role/name or stable selector, <=120 chars"
    visibleLabels:
      - "public short label, <=80 chars"
    latency:
      openToFirstInteractiveMs: 0
      inputVisibleP50Ms: 0
      inputVisibleP95Ms: 0
      scrollFrameP95Ms: 0
      dragAckP95Ms: 0
      stateRefsLagP95Ms: 0
      evidenceCaptureMs: 0
    actionTiming:
      uiEventReceivedAt: "relative or ISO timestamp"
      adapterSentAt: "relative or ISO timestamp"
      hostActionStartAt: "relative or ISO timestamp"
      hostActionEndAt: "relative or ISO timestamp"
      surfacePaintOrAckAt: "relative or ISO timestamp"
      evidenceCaptureStartAt: "relative or ISO timestamp"
      evidenceCaptureEndAt: "relative or ISO timestamp"
    refs:
      stateRef: "ref:..."
      screenshotRef: "ref:..."
      traceRef: "ref:..."
      consoleLogRef: "ref:..."
      networkLogRef: "ref:..."
      domSnapshotRef: "ref:..."
      axSnapshotRef: "ref:..."
    forbiddenFallbacks:
      - name: "host-stream | frame-stream | webrtc | canvas | http-frame | snapshot | iframe | proxy | webview | system-popup"
        observed: false
        disposition: "forbidden | diagnostic-only | refusal"
        reason: "short bounded reason; never a handoff pass"
    bottlenecks:
      - category: "input-routing | surface-attach | forbidden-legacy-stream | state-polling | network-navigation | react-rerender | workspace-writer | native-adapter | unknown"
        severity: "none | low | medium | high | blocker"
        evidence: "bounded timing/ref note only"
    diagnostics:
      - "short bounded diagnostic, no raw payload"
```

## 瓶颈分类

记录用户可感知卡顿时，必须归入至少一个分类；不确定时用 `unknown` 并写明需要的下一步 evidence。

| 分类 | 判断信号 | 记录方式 |
|---|---|---|
| `input-routing` | click/type/press/drag/scroll 到 host action start 前延迟高，或焦点进入聊天 composer | 记录 action timing、focused target 摘要、stable selector |
| `surface-attach` | pane resize、tab 切换、reload 后 live surface 消失、重建或失焦 | 记录 sessionId 是否变化、surface owner check、attach/reconnect ref |
| `forbidden-legacy-stream` | 发现 host-stream、frame-stream、WebRTC、canvas 或 HTTP `/frame` 被当作 live/fallback/handoff pass，或输入/滚动等待旧 stream frame | 记录 forbidden fallback 名称、refusal reason、bounded timing 和 refs；产品结果必须 `blocked` 或 `fail` |
| `state-polling` | URL/title/loading/refs 更新导致 UI 卡顿或 surface remount | 记录 stateRefsLagP95Ms、render count 摘要、traceRef |
| `network-navigation` | 慢站点、重定向、证书、CORS、DNS 或离线导致 loading/stalled | 记录 finalUrl 脱敏摘要、navigation timing、networkLogRef |
| `react-rerender` | refs、diagnostics、topbar 状态更新导致 pane remount 或焦点丢失 | 记录 mount stability、sessionId、traceRef |
| `workspace-writer` | writer health 下降、sidecar 阻塞、action ACK 延迟 | 记录 writer health、last blocked reason、traceRef |
| `native-adapter` | native adapter unavailable/degraded，paint/ack 不返回 | 记录 adapter health、transport、surface type、retry/blocked reason |
| `unknown` | 现有 bounded evidence 不足以归因 | 记录缺失字段和下一次 run 要补的 timing |

## 通过、部分通过和失败

- `pass`: 三个场景都完成，Browser pane 始终由同一 `BrowserHostSession` owning `native-embedded` live surface；`singleInteractiveTruth=true`；`secondTruthSource=false`；无高严重度卡顿；所有证据 refs-first 且脱敏。
- `partial`: 用户任务完成，且仍满足 `BrowserHostSession` + `native-embedded` + `singleInteractiveTruth=true` + `secondTruthSource=false` + refs-first，但出现低/中严重度卡顿、state/refs 明显滞后、某个非关键控件不可用，或 evidence 字段缺少一部分。
- `blocked`: native live surface、writer、native adapter、网络策略或安全确认阻止继续；必须给出 typed blocked/retry/handoff/refusal diagnostic。host-stream、frame-stream、WebRTC、canvas 或 HTTP `/frame` 只能导致 blocked/refusal diagnostic，不能作为 handoff pass。
- `fail`: 出现第二真相源、legacy stream/canvas/frame 被当作产品 live pass、输入丢失/乱序、焦点频繁错投、surface remount 破坏 session、或证据包含 raw DOM/base64/secret。

## 收尾检查

1. 确认没有把 raw DOM、base64、secret、完整截图、完整日志或一次性页面内容写入任务文档。
2. 确认证据均为 bounded fields 和 refs。
3. 确认每个场景都记录 latency、transport、surface、single interactive truth、second truth source、refs 和瓶颈分类。
4. 确认 `sessionId`、surface owner、transport 与 shell 类型一致；产品 pass 只能是 `native-embedded`，Web shell 缺 native attach 时只能 blocked/refusal。
5. 确认 host-stream、frame-stream、WebRTC、canvas 和 HTTP `/frame` 没有作为 handoff pass、fallback pass 或第二个可交互画面。
6. 对文档改动运行：

```bash
git diff --check
```
