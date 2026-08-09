# Change: Add Federated Research Fabric

## Why

SciForge 已经能够在单个研究者桌面和单个远端工作区内运行 Agent、访问科研文件、连接实验室
VPN/SSH、调用 GPU，并用 Evidence DAG 与 Project DAG 管理证据和项目状态。但跨机构合作仍依赖
人手转发任务、文件、进度和结果：牵头方看不到其他机构的真实执行状态，资源提供方也缺少一种
既能共享算力又不交出 SSH、VPN、原始数据和最终控制权的方式。

如果直接把所有机构当作云端 Agent 的远程工具，会产生三个根本问题：用户电脑或 VPN 断开便
停止协作；云端需要持有过多机构凭据和数据权限；科研结论容易被复制到聊天记录、向量库和本地
数据库等多套事实源。反过来，如果每个机构运行一套完全独立的 SciForge，项目又会出现多个
目标、任务和结论版本，无法可靠回答“整个项目现在进行到哪里”。

本变更提出一套联邦科研协作架构：所有节点使用同一套 SciForge Agent 与领域合同，但以云端
协调节点、机构站点节点和桌面客户端三种角色运行。云端拥有跨机构 Project DAG 和项目协调
状态；机构拥有本地数据、Evidence DAG、资源和最终策略裁决；Agent 通过结构化 WorkOrder、
ExecutionLease、ResultManifest 和 EvidenceCapsule 协作，而不是共享原始凭据或完整对话。

## What Changes

- 定义一个统一的 Federated Agent 合同，使云端、机构和桌面上的 SciForge 节点使用同一套
  能力发现、任务委派、执行观察、取消、结果提交和证据请求语义。
- 定义三个由同一代码库和领域包产生的部署角色：Cloud Coordinator、Institution Site Node
  和 Desktop Console；它们不是三套产品，也不拥有重复的项目事实。
- 增加确定性的 Federation Kernel，统一处理身份、授权、任务幂等、资源租约、事件重放、
  Artifact 完整性、数据出口和审计。Agent 可以提出动作，但不能绕过该内核直接写外部状态。
- 让 Cloud Coordinator 成为跨机构 Goal、Project DAG、WorkOrder、协作进度和已接受结果的
  canonical owner，不直接拥有机构内部文件、SSH/VPN 凭据或详细 Evidence DAG。
- 让每个机构部署一个主动向云端建立出站 mTLS 连接的 Site Node。站点节点在 VPN/机构网络内
  连接 Workspace Host、Slurm/Kubernetes/PBS、存储和仪器，并保留接受或拒绝任务的最终权限。
- 把资源共享表示为有期限的 ResourceOffer 和 ExecutionLease，而不是向其他机构开放 SSH
  账号、内部网络或裸 GPU。
- 建立分层科研记忆：云端保存项目级共享记忆，机构保存私有科研证据，桌面保存偏好和草稿；
  Research Memory Resolver 按身份、任务、snapshot 和预算生成临时 Memory Packet。
- 让结果先在机构内形成 committed Evidence Snapshot，再经过出口策略生成签名
  EvidenceCapsule/ResultManifest；云端只把允许共享的内容编入 Project DAG。
- 复用现有 Remote Workspace、AgentRuntime、Capability Broker、Workspace Host、Evidence
  DAG 和 Project DAG 的 canonical production path，不增加第二套 SSH、Agent、记忆或外部写入
  旁路。
- 提供从人工任务交接到机构 GPU 自动调度的分阶段路线，首个里程碑不要求原始数据跨机构流动。

## Capabilities

### New Capabilities

- `federated-project-coordination`: 定义跨机构项目、成员、WorkOrder、状态事件、Project DAG
  编译、结果接受和人类可见进度。
- `institution-site-node`: 定义机构站点注册、主动出站连接、本地策略裁决、断线恢复、能力发现
  和机构内执行接入。
- `federated-resource-execution`: 定义 ResourceOffer、Reservation、ExecutionLease、本地调度器
  适配、执行状态、结果出口和撤销语义。
- `federated-research-memory`: 定义云端 Project Memory、机构 Evidence Memory、任务范围
  Memory Packet、访问裁剪、新鲜度和失效语义。

### Modified Capabilities

- `agent-runtime`: Site Node 将已经获得 lease 的 WorkOrder 送入现有 runtime-neutral Host；
  Codex/Claude 仍由各自 adapter 负责，不新增 SciForge 自定义模型 Runtime。
- `capability-broker`: 联邦 Agent、桌面 UI 和站点执行都通过同一个 capability、授权、审计和
  external-write 路径；跨机构任务不能新增专属 IPC/MCP 旁路。
- `remote-workspace-host`: 继续负责研究者经 VPN/SSH 打开的交互式远端工作区；Site Node
  复用其靠近数据的执行能力，但不把个人 SSH session 当作全局协调通道。
- `evidence-dag`: 继续拥有机构或 session 内的 Artifact、ExperimentRun、Claim、Finding 和
  provenance，并增加经过策略裁剪的联邦 Evidence Snapshot 身份输出。
- `project-dag`: 增加跨站点 evidence vector、WorkOrder/Result 关系和机构可见性，但不复制
  机构私有 Evidence 节点。
- `domain-module-catalog`: 支持领域 package 声明通用 headless deployment contribution，使
  cloud/site 角色继续通过 manifest 和生成式 composition 发现，而不是核心 feature map。

## Impact

- 主要影响 domain SDK、领域 manifest/composition、AgentRuntime Host、Capability Broker、
  Evidence/Project DAG、Remote SSH/Workspace Host，以及新增的 Federated Research 领域包。
- 第一阶段部署包括一个 Cloud Coordinator、每个试点机构一个 Site Node，以及现有桌面客户端；
  Cloud Coordinator 可以位于公共云、联盟私有云或牵头机构网络。
- 第一阶段只要求项目任务、状态、结果 manifest 和允许共享的派生 Artifact 上云；原始数据默认
  留在机构。
- 站点无法安装常驻节点时，桌面客户端可以临时充当 degraded Site Node，但 UI 必须显示
  “依赖客户端和 VPN 在线”，不能宣称无人值守能力。
- 云端不可用时，机构已经接受的任务可以按 lease 和本地策略继续；需要新授权、已过期租约或
  云端 Project 决策的动作必须等待或失败关闭。
- 不在首期解决机构间结算、实时多人编辑、任意交互式跨机构 shell、原始受限数据自由交换或
  多个独立 Cloud Coordinator 的共识问题。
