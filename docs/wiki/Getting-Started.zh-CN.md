# 快速开始

## 选择安装方式

### 使用安装包

从 [GitHub Releases](https://github.com/AGI4Sci/SciForge/releases) 下载对应平台的包：macOS（`.dmg` / `.zip`）、Windows（`.exe`）或 Linux（`.AppImage`）。首次启动后进入设置页配置 Model Router，再选择工作目录。

### 从源码运行

环境要求：Node.js 22.12+；首次安装依赖需要联网。

```bash
git clone https://github.com/AGI4Sci/SciForge.git
cd SciForge
npm install
npm run dev
```

网络较慢时可使用镜像：

```bash
npm install --registry=https://registry.npmmirror.com
```

开发服务器同一工作区只允许一个实例；若提示 dev lock 已被占用，请先退出旧的 `npm run dev` / Electron 进程。

## 首次启动（建议顺序）

1. 打开 **Settings → Model Router**，确认 Router 已启用。
2. 设置本地 Router 地址（默认 `http://127.0.0.1:3892/v1`）、runtime API key（可选但推荐）和 public model alias（默认 `sciforge-router`）。
3. 在默认 provider profile 中填写上游模型的 Base URL、API key 和模型名；这些凭据不会写入 Agent runtime 配置。
4. 在 **Settings → Agents** 保持默认 `Codex`（或显式选择 Claude Code），确认命令、sandbox 和审批策略。macOS GUI 会自动探测 login shell 与常见安装目录，也可以填写绝对可执行路径。
5. 选择一个工作目录，在 **Code** 中新建线程，用一个小任务做冒烟测试，例如：

   > 阅读当前项目的 package.json，列出启动命令；不要修改文件。

   检查 Agent 是否能读取文件、返回工具过程，并在需要时显示审批卡片。

## 第一次科研任务

从一个可验证的小闭环开始：把一篇论文 PDF、一个实验脚本或一个 `.fasta` / `.pdb` 文件放入工作区，让 Agent 先**列出将要做什么和所需证据**，再批准读取、运行或写入。这样可以同时验证 runtime、模型和干预面板。

常用入口：

- **Code**：复现代码、分析日志、运行实验和审查 diff。
- **Write**：PDF 阅读、批注、选区问答、论文草稿和导出。
- **Workflow**：把重复步骤做成可复跑流程，节点运行有日志。
- **Paper Radar / Search**：发现论文并形成可追踪的阅读输入。
- **Evidence DAG / Canvas / Scientific Plotting / PPT Master**：审阅证据、图表和汇报产物。

## 常用命令

```bash
npm run dev          # 开发模式
npm run typecheck    # TypeScript 检查
npm run test         # 单元测试
npm run build        # 生产构建
npm run dist:mac     # macOS 安装包
npm run dist:win     # Windows 安装包
npm run dist:linux   # Linux AppImage
```

## 运行前检查清单

- [ ] Node.js 版本符合要求，`npm install` 完成且没有 native module 错误。
- [ ] Model Router 的 text reasoner profile 已填写完整。
- [ ] 当前 Agent runtime 与要使用的命令（`codex` / `claude`）已显式选择并可执行。
- [ ] 工作目录是你愿意让 Agent 读取或修改的目录；敏感目录不要直接打开。
- [ ] 第一个任务先使用只读目标，再逐步开放写入、网络和外部连接。
