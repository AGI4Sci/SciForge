# K-Dense Scientific Agent Skills 只读 MCP 接入

SciForge v1 将本地已安装的 `K-Dense-AI/scientific-agent-skills` 作为只读 MCP 能力源接入。它默认只做发现、索引、搜索、读取和任务规划；v1.1 增加审批式按需安装入口，但不会自动安装、更新、执行代码或修改第三方 skill 文件。

## 安装方式

推荐方式是在插件页点击 `Install / Repair`，由用户显式确认后安装到当前 workspace：

```text
.agents/skills/scientific-agent-skills
```

默认后端是 `git clone https://github.com/K-Dense-AI/scientific-agent-skills.git`，首次安装使用 `main`，安装后写入 `.sciforge-provenance.json` 记录 source、backend、ref、commit、installedAt、targetPath 和 installerVersion。

如果希望沿用外部 skills CLI，也可以在 SciForge 外部运行：

```bash
npx skills add K-Dense-AI/scientific-agent-skills
```

插件页的 `npx skills add` 后端也仅作为兼容入口：它遵循外部 `skills` CLI 自己的目录策略，完成后 SciForge 重新 discovery，并以实际识别到的 K-Dense 路径为准。未检测到安装时，MCP 工具会返回安装提示，而不是崩溃或静默下载。

## 默认扫描路径

MCP server 会按顺序扫描：

- `SCIFORGE_KDENSE_SKILLS_ROOT`
- 当前 workspace 的 `.agents/skills/scientific-agent-skills/skills`
- 当前 workspace 的 `skills/scientific-agent-skills/skills`
- `~/.agents/skills/scientific-agent-skills/skills`
- `~/.kun/skills/scientific-agent-skills/skills`

如果 `SCIFORGE_KDENSE_SKILLS_ROOT` 指向仓库根目录，SciForge 会同时尝试其 `skills` 子目录。

## MCP 配置

插件页推荐项为 `K-Dense Scientific Agent Skills`。点击添加后，SciForge 只写入 `~/.kun/mcp.json` 中的 `servers.scientific_skills` 配置，不会把 K-Dense 全库加入 `capabilities.skills.roots`，因此不会把全部第三方 skill 展开成常驻 slash command 或 prompt 注入内容。

插件页还会显示 K-Dense 本地状态：

- 是否检测到本地安装
- 已索引 skill 数量和 fingerprint
- 命中的扫描路径
- validation errors 摘要
- 科研绘图精选包可用性

## 科研绘图精选包

v1.2 内置一个轻量精选包，用于让绘图任务优先命中少量相关 skill，而不是把 147 个 skill 常驻展开：

- `scientific-visualization`
- `matplotlib`
- `seaborn`
- `plotly`
- `scientific-schematics`
- `markdown-mermaid-writing`

当任务文本包含绘图、图表、可视化、figure、plot、schematic、Mermaid 等信号时，`scientific_skills_plan` 会优先考虑本地已安装的精选包条目，再合并普通搜索结果。

## 按需安装/启用策略

SciForge 当前不预装 147 个 K-Dense skills，也不把它们加入常驻 skill roots。推荐策略是：

1. 平时只通过 MCP status/search/plan 读取本地索引。
2. 当用户提出明确科研绘图任务，或模型判断任务需要绘图工具时，优先检查精选包。
3. 如果本地缺失所需 skill，提示用户通过插件页显式确认安装 K-Dense。
4. 安装后仍只通过 MCP 只读消费，执行阶段交给 SciForge first-party 受控绘图工具。

内部启动参数：

- `--scientific-skills-mcp-server`
- 可选 `--workspace-root <path>`
- 可选 `--skills-root <path>`

## 可用工具

- `scientific_skills_status`：返回扫描路径、skill 数量、fingerprint 和 validation errors。
- `scientific_skills_search`：本地轻量 BM25/token 搜索，默认 `topK=8`，最大 `topK=20`，支持中文和英文 query。
- `scientific_skills_read`：默认返回 frontmatter、overview 和 resources；`include=["full"]` 时返回受 `maxBytes` 限制的 `SKILL.md` 原文。
- `scientific_skills_plan`：推荐相关 skill、说明依赖风险和下一步 SciForge 受控工具，不输出可直接执行的 shell 或 Python 命令。

## v1 边界

- 只读消费：除用户显式确认的安装入口外，MCP 工具不安装、不更新、不联网、不执行第三方脚本、不修改文件。
- 第三方 `allowed-tools` 仅作为依赖提示，不会转化为 SciForge 权限。
- scripts/resources/references 只作为清单返回，后续执行必须通过 SciForge first-party 受控工具。
- v2 才考虑版本 pin、更新入口、执行沙箱和科研绘图闭环。
