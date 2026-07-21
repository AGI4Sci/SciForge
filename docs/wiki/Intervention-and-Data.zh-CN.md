# 干预与数据

## 把 GUI 当作干预面板

SciForge 的 UI 价值不只是展示 Agent 输出，而是让研究者在机器行动前后表达约束：

| 时机 | 可以做什么 |
| --- | --- |
| 规划前 | 补充目标、范围、证据标准和停止条件 |
| 工具调用前 | 批准 / 拒绝命令、文件写入、网络和外部副作用 |
| 执行中 | 提交 user input、暂停、取消、steer，或要求 Agent 重新规划 |
| 文件变更后 | 查看 diff、回滚或要求修正；不要盲目接受整批改动 |
| 产物审阅时 | 在 PDF、图表、Canvas、PPT 和 Evidence DAG 上批注 |
| 结论提交前 | 对关键主张、证据边和不确定性做人工确认 |

面板可以随着模型能力增强而变薄，但审批、追问和“这是不是我想要的”不会消失，只会更聚焦在高影响节点。

## 默认会留下什么

### 工作区内（可随项目版本化）

常见目录包括：

```text
.sciforge/
├── artifacts/          # 生成图像、scientific plot 等 manifest
├── images/             # 图像产物（按 worker 约定）
├── figures/            # scientific plotting 输出
├── figure-references/  # 参考图与风格输入
├── figure-reviews/     # 图表 review packet
├── pdf-annotations/    # PDF 批注与锚点
├── visual-documents/   # Canvas / VisualDocument 数据
├── plan/               # 可交接的计划与 Todo
└── sdd/                # 需求草稿与 trace
```

具体 worker 可能创建额外的 `.sciforge` 子目录；提交前请检查是否包含大文件或敏感数据。

### 应用用户数据（默认不在 workspace）

- Settings：平台用户数据目录中的 `sciforge-settings.json`。
- App logs：`<userData>/logs/`，默认保留约 2 天，可在设置中调整。
- Full traces：`<userData>/full-traces/`，默认保留 30 天；写入前会脱敏已知凭据、Authorization header 和识别到的 secret。
- Paper Radar：`<userData>/paper-radar/` 下的 SQLite 元数据和 profiles。
- Codex / Claude Code 使用各自的 SciForge managed home 或 config dir；旧 `~/.sciforge/runtime` 数据不会被自动删除，可按需备份后手动清理。

平台 userData 根目录：macOS `~/Library/Application Support/SciForge`，Windows `%APPDATA%/SciForge`，Linux `~/.config/SciForge`。

## 数据边界与备份

- SciForge 会把请求、工具结果和必要的生命周期事件发送给你配置的 runtime / Model Router；不要把机密数据放入未审核的 workspace 或 provider。
- trace 是诊断和复盘材料，不等同于原始实验数据；导出前再次检查 prompt、路径、样本名和 provider 返回内容。
- 要迁移研究项目，至少备份 workspace 的 `.sciforge/`、论文/代码文件和必要的 Write workspace；需要恢复会话时再备份平台 userData 与 runtime data dir。
- 卸载应用不会默认删除这些数据。彻底清理前先导出需要保留的 trace、批注和产物。

## Evidence DAG 的使用方式

把一个回答拆成 claim、source、observation、conclusion，并检查 `supports` / `contradicts` 边：

1. 在 Code 或 Write 中完成一个有来源的回合。
2. 打开 Evidence DAG，检查哪些主张只有单一路径、哪些共享同一来源、哪些边较脆弱。
3. 对缺失或冲突证据添加批注，要求 Agent 补充检索或降低结论强度。
4. 只把通过人工审阅的 snapshot 用作报告、图表或下一个 workflow 的输入。

Evidence DAG 是辅助审计，不是自动“证明真理”；研究者仍负责决定证据是否足够。
