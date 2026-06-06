# SciForge 使用与运维

最后更新：2026-06-06

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

文档 / patch 格式检查：

```bash
git diff --check
```

## 当前产品验收提醒

- Web / Vite dev 只能证明 UI 或 diagnostic，不能证明 Desktop native Browser / Computer Use 产品 ready。
- Browser 用户级验收需要普通聊天入口、Codex backend completion truth、source page refs / page text refs 和 final answer。
- Computer Use 用户级验收需要普通聊天入口、Codex backend completion truth、before / after action evidence、executor event 和 final answer。
- Artifact / PPT 用户级验收需要 final artifact refs 和 validator refs。

## 配置提醒

- 不要把 secret、provider raw URL、API key 或 raw model slug 写入文档、trace 或长期主上下文。
- 大对象必须 refs-first。
- 运行期配置以实际代码和本地配置文件为准；本文不列完整配置矩阵。
