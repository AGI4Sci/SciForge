# 故障排查

## 快速定位

先确认三个状态：

1. **GUI**：应用是否启动，当前工作目录是否正确。
2. **Runtime**：Settings → Agents 的选中 runtime、命令、端口、sandbox 和审批策略是否正确。
3. **Model Router**：Settings → Model Router 的 `/health`、text reasoner profile、public alias 和 key 是否完整。

## 常见问题

### `npm run dev` 失败或重复启动

- 运行 `node --version`，确认 Node.js 20+。
- 删除并重装依赖前先保留 `package-lock.json`：`npm install`。
- 若提示 workspace dev lock 已占用，退出旧 Electron / `npm run dev`，再重试；不要同时启动两个相同工作区实例。
- native module 报错时尝试 `npm run rebuild:electron-native`，然后 `npm run verify:electron-native`。

### Runtime 显示未连接

- SciForge Runtime：确认 `autoStart`、binary path、端口 `8899`、data dir 和 runtime token；有 token 时 GUI 与 runtime 必须一致。
- Codex / Claude Code：在终端运行 `command -v codex` 或 `command -v claude`，确认命令可执行，并按各自官方流程完成登录。
- 选中 runtime 后重启一次应用。失败时查看对应 runtime 日志；不要期待自动切换到另一个 runtime。

### Runtime 已连接但模型无响应

- Model Router Base URL 必须是本机 loopback；默认是 `http://127.0.0.1:3892/v1`。
- 检查 `default.textReasoner` 的 Base URL、API key、model 三项是否都有值。
- 检查 Agent 使用的模型 ID 是否是 Router 的 public alias（例如 `sciforge-router`），而不是只在上游存在的私有名称。
- 确认没有把 provider key 填进 runtime token；前者给 Router，后者只用于本地边界认证。
- 先用只读 prompt 测试，再排查工具或 sandbox；模型超时通常不是文件权限问题。

### 科学文件没有被理解

- 检查文件扩展名和 workspace 引用是否正确；大文件不要直接粘贴进 prompt。
- 若要调用 native translator，配置 `SCIFORGE_SCIMODALITY_SERVICE_URL` 与 token，并确认 sidecar 可访问。
- 未配置 translator 时，只有安全可读文本会内联；二进制输入被降级或拒绝是预期行为。

### Evidence DAG / worker 没有启动

先运行最小服务并查看端口/日志，再从 GUI 重试：

```bash
npm run evidence-dag:start
npm run scientific-plotting:start
npm run model-router:start
```

不同 worker 的 Python / Node 版本和环境变量要求见各自 `packages/workers/*/README.md` 或 `package.json`。

### macOS 阻止未公证应用

源码或本地构建的 app 被 Gatekeeper 拦截时，可在确认来源后运行：

```bash
npm run mac:unquarantine -- '/Applications/SciForge.app'
```

### 去哪里找日志

- GUI / worker 日志：`<userData>/logs/`（macOS 在 `~/Library/Application Support/SciForge/logs`）。
- Full trace：`<userData>/full-traces/`，从设置或 trace 面板导出；导出前检查敏感信息。
- SciForge Runtime 数据和 `config.json`：默认 `~/.sciforge/runtime` 或 Settings 中指定的 `dataDir`。

## 提交问题时附带

请提供：平台与 Node.js 版本、选中的 runtime、Model Router alias、复现步骤、相关时间段日志和最小 workspace 示例。请先删除 API key、Authorization header、样本隐私和真实路径。

## 开发者验证

```bash
npm run typecheck
npm run test
npm run build
```

涉及 runtime 或 UI 时，再执行 `npm run dev` 做一次手动只读冒烟测试。
