# SciForge Linux/WSL 全功能审计

日期：2026-08-25

审计分支：`codex/linux-full-audit`

基线提交：`291ec895bcd0b022126dc7a4c28d331c929e0b0a`

环境：Ubuntu 24.04.1 LTS（WSL2、Linux x64、WSLg）、Node.js 22.23.2、Electron 42.7.0。

## 范围与证据边界

本轮验证当前电脑可以覆盖的 Linux 源码、Electron 源码运行时、Linux unpacked 产物、WSLg 图形界面、原生 PTY 和隔离 GNOME Keyring 路径。WSL2 不能替代物理 Ubuntu 工作站；硬件、登录会话集成和外部服务均单独列出，不冒充已通过。

测试未使用既有 SciForge profile、Cloud 凭据、Provider 凭据或用户工作区。所有 Electron 测试均使用隔离临时 profile。

## 验证摘要

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| 干净依赖安装 | PASS | `npm ci --prefer-offline`；安装 1,256 个包；lock SHA-256 未变化 |
| 依赖图 | PASS | `npm ls --all --silent`，exit 0 |
| TypeScript | PASS | support packages、SDK、26 个 domain packages、Web、Node 全部通过 |
| Lint | PASS | exit 0 |
| 全仓测试 | PASS | 366 个文件、3,374 项测试 |
| Electron smoke support | PASS | 37/37 |
| Keycloak 合同与安全门禁 | PASS | 31/31 |
| 生产构建 | PASS | main、preload、renderer bundle 全部通过 |
| Electron 源码烟测 | PASS | ready，发现 234 个 capability |
| Linux unpacked 打包 | PASS | Electron 42.7.0、Linux x64、`app.asar` |
| 打包版 Electron 烟测 | PASS | ready，发现 234 个 capability |
| 原生终端 | PASS | 系统 Node 与打包版 Electron 均实际启动 `/bin/bash`；`PTY_OK`，exit 0 |
| Provider 凭据生命周期 | PASS（需 keyring） | 源码版和打包版均完成 `store -> rotate -> delete -> restart-absent` |
| WSLg 可视化启动 | PASS | 真实打包版首次启动窗口无崩溃、空白、重叠或裁切 |
| AlphaFold3 绘图评估 | PASS | 成功生成 JSON、Markdown 和 contact sheet |
| 论文风格绘图回归 | PARTIAL | broker 与数据映射通过；本机缺少论文样式素材、`matplotlib` 和 `pdftoppm` |

## 功能测试矩阵

| 功能区域 | 状态 | 已验证内容 | 剩余边界 |
| --- | --- | --- | --- |
| 首次设置 | PASS | 打包版 WSLg 首次设置、主题/语言/模型选项、布局稳定 | 最小 WSL 镜像无 CJK 字体，中文标签显示缺字方块 |
| 本地账号 | PASS | 源码版和打包版烟测均创建隔离本地身份 | 未迁移真实用户数据 |
| 主工作台 | PASS | 窗口 ready、生成式 composition、234 个 capability | 建议补长时间运行稳定性测试 |
| 设置与主题 | PASS | 自动化测试及 WSLg 首次设置界面 | 未手工验证运行中切换系统主题 |
| 扩展与领域包 | PASS | 26 个包 fresh，独立 tarball 和完整测试通过 | 第三方签名扩展需真实扩展包 |
| 定时任务 | PASS（代码级） | schedule domain 与持久化测试通过 | 物理机休眠/唤醒调度尚需真机 |
| 文件与工作区编辑 | PASS | preview discovery/release 与 workspace edit 持久化 | 大型网络挂载工作区需单测 |
| 终端 | PASS | 真实 Linux `node-pty`、`/bin/bash`、打包 Electron ABI 146 | 未导入用户自定义 shell profile |
| Content Space | PASS（打包 demo 路径） | 隔离烟测完成 Provider discovery 与 instance listing | 真实 OpenContent 账号/Provider 属外部依赖 |
| Provider 凭据 | PASS（真实 Secret Service） | 隔离 GNOME Keyring 跨四次 Electron 重启 | 默认 WSL 登录不会自动启动 keyring 服务 |
| 本地身份与 Keycloak 合同 | PASS | 身份包及 31 项 Keycloak 安全测试 | 本轮 Linux 审计未重复公网 OIDC 登录 |
| Cloud 协作 | PASS（单元/集成级） | collaboration 包包含在 3,374 项测试内 | 真实 A Cloud、WSS、Device、Agent 和多人会议依赖外部环境 |
| Browser Preview | PASS | Markdown Preview 插件成功发现和释放 | 其他预览格式依赖用户文件 |
| Browser Automation / CDP | NOT RUN | adapter 测试存在 | 4 项 headless 测试写死 Windows Edge 路径，WSL 未安装 Chromium |
| Comment / Visual Review | PASS | domain 测试及打包版 visual-review capability | 多用户评审依赖 Cloud 参与者 |
| Create Loop / Paper Radar | PASS | 工作流与 profile 跨烟测重启持久化 | 实时文献/Provider 访问是外部依赖 |
| Project DAG / Evidence DAG | PASS | domain 测试及打包版 Evidence DAG capability | 大型多人项目需要压力测试 |
| Git/研究 Checkpoint 与 History | PASS | 全量 domain 测试 | 审计未修改远端仓库权限 |
| 科学绘图 | PARTIAL | capability、数据映射、打包状态和 AlphaFold3 评估 | 需安装 `matplotlib`、Poppler，并提供可选论文样式素材 |
| Artifact Version / Dossier | PASS | 打包版 artifact-version capability 与全量测试 | 真实团队审批流依赖外部参与者 |
| Remote SSH | PASS（合同级） | remote-ssh 包测试通过 | 当前 WSL 无 SSH server/listener |
| 图像/生命科学预览 | PASS（代码及 capability 级） | 原生图像绑定和 proof chain 通过 | 需代表性大型显微/分子文件 |
| 语音输入 | NOT RUN | WSLg 暴露 PulseAudio 输出 | 未暴露 Linux `/dev/snd` 或麦克风设备 |
| GPU/摄像头 | PARTIAL | WSL 虚拟 DRI 设备存在 | 无 `/dev/video*`；WSL 不代表物理 GPU/摄像头行为 |
| 图像生成 | PASS（合同级） | package 测试通过 | 未使用真实 Provider 凭据或额度 |

## 本轮已修问题

| 问题 | 原因 | 修复 | 验证 |
| --- | --- | --- | --- |
| Linux 可执行文件名错误为 `@sciforgesciforge` | electron-builder 从 scoped npm 包名 `@sciforge/sciforge` 推导了不合适的 Linux 名称 | 将 Linux `executableName` 固定为 `sciforge`，并增加 release-guard 回归测试 | 定向测试 28/28；重建产物存在 `dist/linux-unpacked/sciforge`；打包烟测和原生 PTY 均通过 |

## 环境与部署改进项

| 优先级 | 改进项 | 原因 |
| --- | --- | --- |
| P1 | Linux 安装说明加入 `fonts-noto-cjk` 或等效 CJK 字体 | 最小 Ubuntu 镜像否则无法正常显示中文 |
| P1 | Linux 安装说明加入 GNOME Keyring 或 KWallet 的安装/启动步骤 | Secret Service 不可用时，凭据存储会按设计 fail-closed |
| P1 | 提供包含 `matplotlib` 的受支持 Python 绘图运行时及 Poppler `pdftoppm` | 缺少这些依赖时无法完成论文级渲染 |
| P2 | CDP headless 集成测试支持自动发现 Linux Chromium，不再只认 Windows Edge | 当前 Linux 浏览器自动化缺少运行时证据 |
| P2 | 增加物理 Ubuntu 验收 | 验证 keyring 自动解锁、麦克风、休眠/唤醒、原生 GPU 和桌面集成 |
| P2 | 增加真实 SSH 目标和代表性科学文件 | 合同测试不能证明网络及设备互操作性 |

## 功能精简复核

Windows 精简改动已包含在当前基线中；打包审计未发现 Linux 特有的重复入口。

| 候选项 | 当前结论 |
| --- | --- |
| `New Agent` / `New thread` | 当前基线已统一主入口和术语 |
| 顶部工具栏 / 面板切换器 | 已使用精简工具面；“可配置收藏”可作为后续产品增强 |
| Comment / Visual Review | 保持 Review 分组，但底层 capability 应继续独立 |
| Checkpoint / Version 变体 | 保持 History 分组，底层存储模型不应强行合并 |
| Project DAG / Evidence DAG | 两者均有明确用途；应共享图交互框架，不建议删除任一领域 |
| Browser Preview / Browser Automation | 两者都保留并保持不同名称：一个负责渲染，一个负责控制 |
| Remote Targets / Remote Resources | 保持互相跳转，不合并权限和凭据模型 |
| Mock Content Space Provider | 仅保留隔离测试组合，不作为普通生产 Provider 暴露 |

## 最终结论

本机可测试的 Linux 应用主链健康：全仓测试、生产构建、源码运行时、Linux unpacked 包、WSLg 渲染、打包 capability composition、原生终端及隔离安全凭据持久化均通过。本轮发现并修复了一个 Linux 打包缺陷。

这不等于“Linux 所有功能已完成”。剩余项目需要 Linux 桌面依赖（CJK 字体、Secret Service、Python/Poppler）、Chromium、物理 Ubuntu 硬件，或外部 Cloud/Provider/SSH 账号与服务。
