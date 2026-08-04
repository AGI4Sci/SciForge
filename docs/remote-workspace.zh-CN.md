# Remote Workspace 架构与使用边界

Remote Workspace 让 SciForge 的 Electron 界面继续运行在用户电脑上，同时把工作区相关的
文件、搜索、Git、终端、Codex runtime 和科学预览后端放到远端 Linux x64 机器。远端目录
是唯一事实来源；SciForge 不维护一份可写的本地镜像，也不依赖 SSHFS、NFS 或 SMB 挂载。

## VPN 与 SSH

Remote SSH domain 仍然是 VPN、SSH 主机密钥、目标授权和跳板配置的唯一所有者。实验室要求
先通过虚拟机登录 VPN 时，现有的“启动/检查 VPN 虚拟机，再通过其中的 SSH 路径连接集群”
机制仍然有效。Workspace Host 不绕过这条路径。Remote SSH 自己的管理面板仍可让用户维护
普通 OpenSSH 别名；但 generic Workbench、Agent 和工作区 session 只接收不透明资源，不会
得到 SSH 别名、用户名、密钥、代理端点或原始 SSH 流。

建立远端工作区时，Remote SSH 会：

1. 校验当前工作区对目标和远端根目录的授权；
2. 确保实验室 VPN 环境已经可用；
3. 探测远端平台和用户级常驻进程能力；
4. 按版本和摘要部署与桌面端同一 cohort 的 Workspace Host；
5. 通过一条受控 SSH 字节流完成握手、请求复用和事件重放。

VPN/MFA 或 SSH 断开后，SciForge 使用不透明 session ID 和最后确认的事件序号重连；它不会
自动接受新的主机密钥，也不会自动输入 VPN 凭据。

## 本地 UI、远端目录

文件树、编辑器、终端面板、Git 面板和科学可视化仍由本地 renderer 绘制，所以交互外观与
本地工作区一致。它们的后端请求通过当前 `WorkspaceHostClient` 发往所选工作区：

- 目录、stat、分段读取、带 revision 的写入和文本搜索在远端执行；
- Git status/diff 针对远端仓库执行；
- 终端进程在远端运行，输出用 cursor 增量读取；
- Codex 仍使用 runtime ID `codex`，但其进程和工作目录跟随 Workspace Host；
- 科学预览的 React/WebGL UI 留在本地，文件解析和大数据读取在远端执行。

切换工作区时，放置决策只发生在 session/composition 边界。各个文件、Git 或终端操作不会
各自判断“本地还是远端”，也不会在远端失败时静默退回本地路径。

本地工作区继续使用原有的本地文件、Git、进程和预览服务。远端工作区携带不透明 locator，
由唯一的 placement router 发往 Workspace Host；本地与远端不会维护两套可写副本。

## Server 生命周期

SciForge 通过探测而不是配置猜测报告下列一种模式：

- `persistent-daemon`：集群允许用户级后台服务和私有 Unix socket。SSH/VPN 临时断开时，
  Workspace Host 和事件日志继续存在，恢复后可重放未确认事件。
- `connection-session`：集群策略不允许常驻服务。使用同一协议，但 Server 只随当前 SSH
  连接存活；UI 会明确显示这一限制，不会宣称会话可以跨断线持续。

Slurm 等调度器拥有的作业可以独立于这两种连接模式继续运行。

## 无网 GPU 的网络出口

网络出口是工作区 session 的显式策略：

- `none`：远端工作区不使用网络；
- `local`：通过用户本地 SciForge 的受限中继访问允许的 HTTPS/Model Router 目标；
- `remote-target`：通过另一个已授权且可联网的目标（例如 CPU 机器）提供出口。

远端 GPU 机器只得到绑定在回环地址上的临时端点和短期 lease，不得到 CPU 目标 ID、SSH
凭据或桌面端密钥。中继仅允许策略许可的出站 CONNECT/HTTPS 目标；lease 到期、授权撤销、
目标 revision 变化或 VPN 丢失都会关闭路由，相关操作以稳定错误失败，不会改走其他出口。

`remote-target` 依赖用户已经授权该机器，并且当前拓扑确实允许 GPU 到 CPU 中继的私有
连接。SciForge 不会把两台原本不互通的集群机器变成可达。

## Domain backend 的作用

Domain package 可以声明可选的 `workspace-server` entrypoint。它与该 domain 的本地 UI
属于同一个 package 和版本，但运行在数据所在的 Workspace Host，适合以下工作：

- 读取远端文件的有限字节范围、切片、tile 或 thumbnail；
- 调用只安装在集群上的解析器和科学依赖；
- 执行需要靠近大文件的数据规整、索引或特征提取；
- 把有界的 observation/wire result 返回给本地可视化。

例如 Life Science Preview 的分子、序列、组学、生物成像和光谱 provider 在远端读取数据，
本地 renderer 只接收受大小限制的结构化结果并负责交互绘制。这样避免为了预览一个大型
显微镜或组学文件而先完整下载到电脑。

Domain backend 通过 manifest 和生成的 composition 自动发现。Host 只依赖通用 SDK
contract，不维护 domain ID switch；桌面端与 Server 的 package cohort 不匹配时会显式
失败或重新部署匹配版本，不会加载不一致的后端。

## 当前支持范围

首个交付范围是 Linux x64 远端、Codex、目录/文件、搜索、Git status/diff、受控终端、
断线重连、显式网络出口，以及 Life Science Preview 的远端 provider。Claude 的远端放置
在其 adapter 和 session 持久化经过验证前不对外宣称支持。

远端 Codex 首期要求桌面端处于 API Model Router 模式且 Router 配置完整；Coding Plan
模式或未配置 Model Router 时，远端文件、Git、终端和科学预览仍可使用，但远端 Codex
明确显示不可用。当前受控终端基于 pipe，不宣称完整 PTY 兼容；远端 Git 首期只提供
status/diff。
