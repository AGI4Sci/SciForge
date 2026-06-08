# SciForge 使用与运维

最后更新：2026-06-08

## 边界

本文只记录常用启动和验证命令，不定义产品职责。产品需求和验收标准以 [`../PROJECT.md`](../PROJECT.md) 为准。

脚本真相源是 [`../package.json`](../package.json)。

## 快速启动

安装依赖：

```bash
npm install
```

启动 Web dev：

```bash
npm run dev
```

只启动 UI：

```bash
npm run dev:ui
```

启动 Desktop dev：

```bash
npm run desktop:dev
```

## 常用验证

快速验证：

```bash
npm run verify:fast
```

类型检查：

```bash
npm run typecheck --silent
```

普通测试：

```bash
npm run test
```

Runtime Codex browser 默认验收（允许写出 blocked evidence 证明 fail-closed）：

```bash
npm run smoke:runtime-codex-browser-acceptance
```

Runtime Codex browser release 严格验收（release 前必须拒绝 blocked / partial / failed evidence）：

```bash
npm run smoke:runtime-codex-browser-acceptance:strict
```

文档 / patch 格式检查：

```bash
git diff --check
```

## 当前产品验收提醒

- Web / Vite dev 只能证明 UI 或 diagnostic，不能证明 Desktop native Browser / Computer Use 产品 ready。
- Agent Host 是唯一智能体；它的模型能力统一来自 Model Router `/v1/responses`。
- Model Router 只是多模态 API 边界，不拥有 workflow、工具选择、completion truth 或 final answer。
- SciForge UI 只消费 Codex App Server protocol events，并由 App Server assistant final message 生成 `FinalAnswerEnvelope`；GUI projection 不等于 turn completion。
- Browser 用户级验收需要普通聊天入口、Agent Host completion truth、source page refs / page text refs 和 final answer。
- Computer Use 用户级验收需要普通聊天入口、Agent Host completion truth、before / after action evidence、executor event 和 final answer。
- Artifact / PPT 用户级验收需要 final artifact refs 和 validator refs。

## 配置提醒

- 不要把 secret、provider raw URL、API key 或 raw model slug 写入文档、trace 或长期主上下文。
- Runtime Codex / browser release acceptance 需要在 service 环境设置 `SCIFORGE_RUNTIME_API_KEY`，并把 Runtime / Browser API base 指向 Model Router，例如 `SCIFORGE_MODEL_ROUTER_BASE_URL=http://127.0.0.1:<router>/v1`；配置文件里的 apiKey 不能算作验收凭据。
- `config.local.json` 只作为 Model Router 成员模型配置来源；成员模型 provider、base URL、model 和 key env 使用 `SCIFORGE_TEXT_*` / `SCIFORGE_VISION_*`，不能作为 Runtime Codex 直连 upstream。
- 大对象必须 refs-first。
- 运行期配置以实际代码和本地配置文件为准；本文不列完整配置矩阵。
