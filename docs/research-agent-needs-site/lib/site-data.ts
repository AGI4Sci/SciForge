export type EngineeringModule = {
  id: string;
  title: string;
  outcome: string;
  problem: string;
  scope: string[];
  requirements: string[];
  acceptance: string[];
};

export type Concept = {
  slug: string;
  kicker: string;
  title: string;
  oneLine: string;
  question: string;
  whyHard: string[];
  model: Array<{ label: string; value: string }>;
  primitives: string[];
  rules: string[];
  acceptance: string[];
  antiPatterns: string[];
  relatedCapabilities: string[];
};

export const homeSignals = [
  { value: "44", label: "个跨领域真实科研需求" },
  { value: "6", label: "个可直接拆工的工程模块" },
  { value: "4", label: "种本质不同的协作拓扑" },
  { value: "3", label: "个 AI 研究闭环" },
];

export const crossCuttingInvariants = [
  {
    title: "版本不可变",
    detail: "正式产物、审批和外部写入都绑定具体版本，修改后不能冒充原版本。",
  },
  {
    title: "身份与最小权限",
    detail: "系统知道是谁在操作，并且只给他完成当前任务所需的权限。",
  },
  {
    title: "幂等与动作回执",
    detail: "同一操作重复请求也只能生效一次，执行后留下可以核对的结果。",
  },
  {
    title: "审计只追加",
    detail: "失败、撤回、修改和人工决定都保留历史，不能被后来的结果覆盖。",
  },
];

export const domainContributions = [
  "论文、公式、图表和科学数据的专业结构",
  "样本、试剂、设备、时间、位置和单位规则",
  "HPC、实验记录系统、仪器和传感器连接",
  "不同学科的检查规则和评测标准",
];

export const engineeringModules: EngineeringModule[] = [
  {
    id: "F1",
    title: "证据与产物版本服务",
    outcome: "保留重要历史版本，让研究人员能查看变化、恢复旧版本，并确认结论、运行和审批使用的是哪一版内容。",
    problem:
      "科研数据、代码和报告会被多次修改。旧内容容易被覆盖，结论引用的版本也容易说不清；如果每次小改都完整复制文件，还会产生大量重复存储。",
    scope: [
      "代码、配置和 Notebook",
      "CSV、TSV、JSON、Parquet 等数据",
      "PDF、图片和研究报告",
      "分析生成的图表与结果文件",
    ],
    requirements: [
      "在提交审阅、批准、运行分析或发布结果时保存重要版本",
      "可以查看创建时间、创建者和修改原因，并恢复任意历史版本",
      "对文本、代码和表格展示主要变化；其他文件明确提示内容已变化",
      "文件只发生少量修改时，不应重复保存大量相同内容",
      "说明某次分析、图表、结论和审批分别使用了哪个版本",
      "已批准内容再次修改后，新版本需要重新审查",
    ],
    acceptance: [
      "历史版本可以准确恢复，新版本不会覆盖旧版本",
      "相同内容不会被重复存储，小幅修改不会按完整文件大小增加空间",
      "正式结论、运行和审批都能找到对应版本",
      "用户能够看懂版本之间的主要变化",
    ],
  },
  {
    id: "F2",
    title: "Computer Use 线程隔离",
    outcome: "多个线程可以同时操作不同界面，每个线程的鼠标、键盘和画面互不干扰。",
    problem:
      "多个 Agent 线程同时使用电脑时，一个线程的点击、输入或焦点切换可能进入另一个线程，造成误操作、数据泄漏或错误提交。",
    scope: [
      "鼠标与键盘输入",
      "窗口焦点与画面",
      "剪贴板、下载文件和登录状态",
      "用户观察与接管",
    ],
    requirements: [
      "每个线程只能看到和操作自己的界面",
      "一个线程的鼠标和键盘事件不能进入其他线程",
      "一个线程切换窗口、卡住或退出时，不影响其他线程",
      "剪贴板、下载文件和登录状态不能在线程间混用",
      "用户可以明确选择要观察或接管的线程",
    ],
    acceptance: [
      "至少四个线程并行操作时，鼠标、键盘、画面和登录状态零串扰",
      "停止任意一个线程，其他线程继续正常运行",
      "系统做不到真实隔离时，必须限制并发，不能假装已经隔离",
    ],
  },
  {
    id: "F3",
    title: "长任务持续运行",
    outcome: "训练、分析和监测任务可以跨数小时或数天持续运行，不依赖用户一直打开客户端。",
    problem:
      "科研任务经常运行很久。电脑休眠、网络中断、客户端退出或服务重启后，任务状态容易丢失，也可能被重复提交。",
    scope: [
      "本地长时间分析任务",
      "HPC 与远程计算任务",
      "任务进度、日志和中间结果",
      "暂停、恢复、取消和失败处理",
    ],
    requirements: [
      "客户端关闭或网络断开后，任务仍能继续运行",
      "用户重新打开客户端后，可以看到真实进度和历史记录",
      "任务可以暂停、恢复和取消",
      "失败后尽量从已有进度继续，不重复执行已经完成的外部操作",
      "需要人工决定时及时通知，并说明当前状态和可选操作",
    ],
    acceptance: [
      "任务连续运行数天，客户端离线和服务重启后状态不丢失",
      "恢复任务不会重复提交已经存在的作业",
      "无法确认是否成功时明确显示“状态未知”，不误报完成",
    ],
  },
  {
    id: "F4",
    title: "多人科研工作区",
    outcome: "多人可以围绕同一份科研对象共同编辑、审阅、决定和交班，并清楚知道谁做了什么。",
    problem:
      "科研协作涉及作者、数据人员、方法专家和负责人。仅共享一个文件，无法说明修改来源、审阅意见、最终决定和当前责任人。",
    scope: [
      "共同编辑和评论",
      "独立审阅与争议仲裁",
      "审批、签名和责任记录",
      "任务交班与负责人切换",
    ],
    requirements: [
      "多人可以同时查看、评论和修改同一科研对象",
      "每次修改、审阅和决定都记录真实参与者",
      "重要冲突必须明确展示并由有责任的人处理",
      "需要独立判断的审阅在提交前互不可见",
      "交班后明确新的负责人，避免无人负责或多人重复操作",
    ],
    acceptance: [
      "多人并发和断网重连不丢失修改",
      "独立审阅在规定时间前不会互相泄漏",
      "任一任务都能找到当前负责人、历史决定和对应版本",
    ],
  },
  {
    id: "F5",
    title: "多客户端同步与通知",
    outcome: "研究人员可以在手机、电脑和网页之间接力工作，看到同一个任务、版本和决定。",
    problem:
      "科研工作发生在办公室、实验室和野外。用户换设备或暂时断网后，容易丢失进度、重复操作或错过需要及时处理的事件。",
    scope: [
      "手机、电脑和网页",
      "跨端任务与版本状态",
      "扫码、拍照、定位和现场记录",
      "离线工作与重要通知",
    ],
    requirements: [
      "不同设备看到同一个任务、对象版本和处理状态",
      "从通知进入后可以直接到达需要处理的内容",
      "手机支持现场扫码、拍照、定位、记录和确认",
      "断网时可以继续记录，恢复网络后安全同步",
      "遇到关键冲突时要求用户确认，不静默覆盖",
    ],
    acceptance: [
      "手机、电脑和网页最终显示一致状态",
      "长时间离线后同步不丢失、不重复记录",
      "用户换设备后能快速回到正确任务和版本",
    ],
  },
  {
    id: "F6",
    title: "连接器与外部写入网关",
    outcome: "Agent 可以连接真实科研系统，在执行外部写入前让用户看清变化，并在执行后留下可核对的结果。",
    problem:
      "科研任务需要连接 HPC、数据库、实验记录系统和仪器。错误写入、重复提交或使用错误账号可能带来真实损失。",
    scope: [
      "HPC 与远程计算系统",
      "数据库和对象存储",
      "ELN、LIMS、EDC 等科研系统",
      "仪器和传感器",
    ],
    requirements: [
      "明确区分读取、生成建议、正式写入和高风险操作",
      "正式写入前展示目标、内容和可能影响",
      "高风险操作必须由有权限的人确认",
      "同一次写入即使重复请求，也只能实际生效一次",
      "执行后保存外部系统返回结果，并确认是否真正成功",
      "无法确认结果时明确显示状态未知，交给用户核对",
    ],
    acceptance: [
      "未经确认的高风险操作不能执行",
      "网络中断和重复请求不会造成重复写入",
      "每次外部写入都能找到确认人、执行时间和外部结果",
    ],
  },
];

const legacyCapabilityToModule: Record<string, string[]> = {
  P1: ["F1"],
  P2: ["F1"],
  P3: ["F3"],
  P4: ["F2"],
  P5: ["F6"],
  P6: ["F4"],
  P7: ["F5"],
  P8: ["F4", "F6"],
  P9: ["F1", "F3"],
  P10: ["F6"],
  P11: ["F3", "F5"],
  P12: ["F3"],
};

export function mapNeedFeatures(codes: string[]) {
  const mapped = codes.flatMap((code) => legacyCapabilityToModule[code] ?? []);
  return engineeringModules.map((module) => module.id).filter((id) => mapped.includes(id));
}

export const concepts: Concept[] = [
  {
    slug: "evidence",
    kicker: "F1 · EVIDENCE",
    title: "证据追溯不是“附一个 URL”",
    oneLine: "科研结论必须连到精确版本与精确位置，并能在上游变化后找到所有受影响下游。",
    question: "一个数字、箭头或结论被质疑时，系统能否在一分钟内重建它的来路？",
    whyHard: [
      "同一论文有预印本、正式版、更正和撤稿；URL 不能唯一代表版本。",
      "证据可能来自 PDF 片段、数据行、Notebook cell、仪器 run 或人工裁决。",
      "支持、反驳、限定和模型推断不能被压成同一种“引用关系”。",
      "上游数据或规则一变，旧图表、报告和批准都可能需要失效。",
    ],
    model: [
      { label: "来源", value: "Artifact → Version → Fragment / Anchor" },
      { label: "产生", value: "Input → Transform / Run → Output" },
      { label: "论证", value: "Evidence → Claim → Assessment" },
      { label: "治理", value: "Decision / Approval → Exact Snapshot" },
    ],
    primitives: [
      "不可变 ArtifactVersion 与内容 hash",
      "跨介质稳定锚点：页/段/bbox/行/列/cell/run",
      "Claim–Evidence 有向关系与证据类型",
      "StatusEvent：更正、撤稿、替换、许可变化",
      "正向影响传播与 Revalidation Required",
      "机器可验与人可读的审计导出",
    ],
    rules: [
      "来源原文、Agent 综合和人类裁决是不同对象。",
      "原始证据只追加版本，不被新结论覆盖。",
      "审批绑定内容 hash；任何绑定内容变化后自动失效。",
      "受限来源产生的摘要、索引和缩略图继承最严格策略。",
    ],
    acceptance: [
      "关键 claim 100% 有证据关系或显式“待证实”。",
      "固定测试集精确定位成功率 ≥99%，不存在的摘录不得通过。",
      "关键图表到输入、代码、参数、环境和审批断链为 0。",
      "关键上游变更的受影响对象召回率 100%。",
    ],
    antiPatterns: [
      "只保存论文首页、DOI 或 URL",
      "给结论一个模型自信度代替科学可信度",
      "来源变化后静默覆盖旧报告",
      "图表有数据文件，却无法定位到数据行和运行",
    ],
    relatedCapabilities: ["F1", "F4", "F6"],
  },
  {
    slug: "isolation",
    kicker: "F2 · COMPUTER USE RUNTIME",
    title: "线程隔离 = 独立虚拟输入与显示会话",
    oneLine: "每个线程必须拥有自己的虚拟显示器、鼠标、键盘队列和窗口焦点；输入事件按 session_id 路由，不能进入其他线程。",
    question: "A、B 两个线程同时操作 GUI 时，如何从架构上保证 A 的鼠标和键盘事件永远不会注入 B？",
    whyHard: [
      "普通 macOS 桌面的焦点、CGEvent、剪贴板和整屏截图都是宿主全局资源。",
      "在同一桌面多开窗口、绘制多个虚拟光标，并没有隔离真实的输入目标。",
      "只分配不同浏览器 tab 仍会共享 profile、下载目录、弹窗和部分系统状态。",
      "需要 macOS 原生 GUI 时，不能靠 pyautogui 并发，必须使用独立 VM 或独立图形登录会话。",
    ],
    model: [
      { label: "线程 A", value: "session-a → display-a + mouse-a + keyboard-a + focus-a" },
      { label: "线程 B", value: "session-b → display-b + mouse-b + keyboard-b + focus-b" },
      { label: "事件路由", value: "{session_id, seq, device, event} → only matching compositor" },
      { label: "画面路由", value: "frame(session_id, seq) → only owning thread / observer" },
    ],
    primitives: [
      "VirtualDesktopSession：线程与虚拟桌面一一绑定",
      "每会话独立 display server / compositor 与 framebuffer",
      "每会话独立 virtual mouse、virtual keyboard 和 event queue",
      "session-scoped focus、clipboard、browser profile、downloads 和 mounts",
      "InputRouter 校验 session_id、递增 seq 和 session 状态",
      "FrameStreamer 只发布指定 session 的画面",
    ],
    rules: [
      "任何输入事件缺少 session_id 时直接拒绝。",
      "宿主全局 CGEvent / pyautogui backend 最多一个 active writer；需要并发时必须换隔离 backend。",
      "浏览器任务至少使用独立 BrowserContext 和独立输入通道；桌面任务使用容器化虚拟桌面或 VM。",
      "业务资源 lease 属于外部写入网关 F6，不与键鼠/显示隔离混成一个功能。",
    ],
    acceptance: [
      "4 个会话同时输入不同随机 token、移动窗口并点击随机控件，其他会话零变化。",
      "A 的输入洪泛不重排、不丢弃 B–D 的事件；A 切焦点不改变 B–D 的焦点。",
      "随机杀死 A 后 B–D 连续运行，帧序列和输入确认无中断。",
      "剪贴板、截图、浏览器 cookie、下载和挂载目录跨会话不可见。",
    ],
    antiPatterns: [
      "在一个宿主桌面画四个虚拟光标",
      "多开四个窗口后继续向宿主全局焦点发送键盘事件",
      "共享浏览器 profile、剪贴板、下载目录或整屏截图",
      "后端不支持隔离，却允许 active writer > 1",
    ],
    relatedCapabilities: ["F2"],
  },
  {
    slug: "collaboration",
    kicker: "RESEARCH COLLABORATION",
    title: "科研协作不只是在线共编",
    oneLine: "共同收敛、独立盲审、顺序交班和跨站点联邦具有不同甚至相反的可见性与控制权规则。",
    question: "团队现在是在一起写、彼此隔离地判断、接管一个运行，还是让数据留在不同机构？",
    whyHard: [
      "共编要求尽快共享，盲审却要求提交前完全不可见。",
      "交班要求任一时刻唯一负责人，不能简单地“大家都能控制”。",
      "多中心研究要求数据留在各域，但结果仍要有可验证 lineage。",
      "评论、确认、科学批准和法定签名不是同一动作。",
    ],
    model: [
      { label: "K1 共同收敛", value: "Shared Artifact + Proposal / Merge" },
      { label: "K2 独立隔离", value: "Sealed Branch → Submit → Unblind → Adjudicate" },
      { label: "K3 顺序接力", value: "One Owner → Offer → Accept → Fence Old Owner" },
      { label: "K4 跨站点联邦", value: "Compute-to-Data + Signed Aggregation" },
    ],
    primitives: [
      "真人、Agent 与设备的统一身份和委托链",
      "主体×资源×动作×状态×上下文的 RBAC + ABAC",
      "版本化提案、语义冲突与不可变审议记录",
      "sealed branch、揭盲条件与第三方仲裁",
      "owner lease、handoff package 与值班升级",
      "跨域策略握手、签名结果与撤回规则",
    ],
    rules: [
      "Draft 可编辑；Under review 只建议；Frozen 只能 amendment。",
      "单位、样本身份、排除规则等关键字段禁止 last-write-wins。",
      "原始独立意见不能被最终仲裁覆盖。",
      "一个 session 只有一个 controller，其他客户端只能观察。",
    ],
    acceptance: [
      "K1：3 人并发、断网重连不丢改动，冲突显式可归因。",
      "K2：揭盲前 API、搜索、通知、缓存、文件名和模型上下文零泄漏。",
      "K3：任一时刻最多一个 owner/controller，offer 与 accept 后才切换。",
      "K4：行级数据不离域，站点输出可签名且具本地 lineage。",
    ],
    antiPatterns: [
      "把共享链接称为多人协作",
      "让两个 Agent 在同一上下文先后回答并称为盲审",
      "交班只发一段聊天总结",
      "复制两份数据到中心后声称联邦计算",
    ],
    relatedCapabilities: ["F1", "F4", "F5"],
  },
  {
    slug: "multi-client",
    kicker: "UBIQUITOUS CLIENT",
    title: "多客户端不是响应式网页",
    oneLine: "手机、桌面和网页应承担不同职责，并围绕同一个任务、对象版本、证据与决定接力。",
    question: "用户换设备后恢复的，是一段聊天，还是精确到版本和 checkpoint 的科研状态？",
    whyHard: [
      "现场手机常离线，却要扫码、拍照、定位并保存可信时间。",
      "桌面掌握私有数据、GPU 和仪器软件，不应把全部数据复制到网页。",
      "高风险审批需要看到最新对象版本，锁屏通知却必须脱敏。",
      "同一批准可能从多个设备重复触发。",
    ],
    model: [
      { label: "手机", value: "Notify · Scan · Capture · Offline · Ack" },
      { label: "桌面", value: "Private Data · Compute · Instrument · Deep Review" },
      { label: "网页", value: "Co-edit · Review · Board · Organization Policy" },
      { label: "共享核心", value: "Task · Version · Evidence · Decision · Checkpoint" },
    ],
    primitives: [
      "带 base version 和 idempotency key 的离线事件",
      "结构化冲突分类与 quarantine",
      "设备密钥、缓存加密、撤权与远程失效",
      "通知 generated→delivered→read→ack→assigned→resolved",
      "深链到 project/task/object version/decision",
      "同一外部动作的 exactly-once 合并",
    ],
    rules: [
      "普通文本可自动合并；样本身份、单位、签名和审批冲突必须人工仲裁。",
      "高风险批准默认在线确认最新版本。",
      "锁屏通知只显示脱敏摘要。",
      "用户离组后的离线写入进入 quarantine，不能直接合并。",
    ],
    acceptance: [
      "在线并发状态 p95 2 秒内可见。",
      "断网 8 小时后重连无静默丢失或重复事件。",
      "桌面发起→手机告警/审批→网页共审后状态完全收敛。",
      "从通知换端后 30 秒内恢复正确 task、version 和 checkpoint。",
    ],
    antiPatterns: [
      "同一个网页做三套响应式尺寸就称为多客户端",
      "跨端复制全部聊天和敏感上下文",
      "离线时对关键字段静默 last-write-wins",
      "从摘要通知直接批准不可逆动作",
    ],
    relatedCapabilities: ["F3", "F4", "F5"],
  },
  {
    slug: "work-graph",
    kicker: "CANONICAL MODEL",
    title: "一个 Research Work Graph",
    oneLine: "科研对象、运行、证据、决定、物理资源和事件必须进入同一条权威关系链，而不是各功能各存一份状态。",
    question: "同一项工作在 Evidence、Workflow、协作和外部写入中，是否只有一个对象身份与状态来源？",
    whyHard: [
      "按“论文 Agent”“数据 Agent”拆分容易复制版本、审批和写入逻辑。",
      "文件名不足以表达 claim、样本、运行、决定和责任。",
      "并行模块会形成不同的完成定义和相互矛盾的状态。",
      "领域对象多样，但 Host 又不能维护不断增长的领域 switch。",
    ],
    model: [
      { label: "工作", value: "Project → Task / Workflow / Protocol" },
      { label: "知识", value: "ArtifactVersion ↔ Evidence ↔ Claim" },
      { label: "运行", value: "Transform / Run → Environment → Output" },
      { label: "治理", value: "Actor / Policy / Decision / Lease / Event" },
    ],
    primitives: [
      "全局稳定 object_id 与不可变 version_id",
      "统一 dependency 与 evidence_links",
      "唯一事件流与状态机",
      "唯一 preview→approval→commit→verify 写入路径",
      "Manifest 驱动的 domain contribution",
      "公共 SDK 合同与 package-owned UI / backend",
    ],
    rules: [
      "每种能力、状态迁移和外部写入只有一个 canonical path。",
      "领域 package 是所有权、版本、安装和发布单元。",
      "Host 只依赖通用 SDK 和扩展点。",
      "领域 importer、schema、validator 和 UI 通过 manifest 发现。",
    ],
    acceptance: [
      "添加或删除领域 package 无需修改中心 feature map。",
      "不存在第二套 Evidence、IPC、MCP、registry 或 fallback 路径。",
      "源代码与打包应用使用同一组合路径。",
      "变更后可自动审计私有跨边界 import 和死入口。",
    ],
    antiPatterns: [
      "为每个 demo 加一个 Host 特例",
      "同一动作同时走 IPC 和 MCP 两条路径",
      "为了兼容保留旧入口并继续双注册",
      "把领域 schema 写进核心 switch",
    ],
    relatedCapabilities: ["F1", "F3", "F4", "F6"],
  },
  {
    slug: "classification",
    kicker: "NEED TAXONOMY",
    title: "不要按 Agent 名称分类需求",
    oneLine: "用生命周期、介质、风险、时效、协作、证据、敏感度和人类责任描述一项需要负责的科研工作。",
    question: "这个需求真正改变了什么、风险多高、需要谁负责、要证明到什么程度？",
    whyHard: [
      "“论文 Agent”可能同时涉及检索、证据、共编、盲审和发布。",
      "同一数据清洗场景可从个人草稿升级为临床正式数据写入。",
      "学科分类无法直接决定隔离、审批、恢复和验收要求。",
      "只写输入/输出会隐藏长期状态、并发资源和失败路径。",
    ],
    model: [
      { label: "L 生命周期", value: "立题→检索→方案→采集→分析→发布→维护" },
      { label: "C 介质", value: "信息→计算→外部系统→组织→物理世界" },
      { label: "R 风险", value: "只读→草稿→受控写入→正式结论→高危物理" },
      { label: "K 协作", value: "单人→共编→盲审→交班→联邦" },
    ],
    primitives: [
      "九维 Need profile",
      "风险与人类决策映射",
      "证据等级 E0–E4",
      "数据敏感度 D0–D3",
      "可量化验收与失败样例",
      "需求—能力多对多映射",
    ],
    rules: [
      "分类单元是一项需要负责的科研工作或决定。",
      "R3/R4 不能由模型自信度放行。",
      "正式科研产物通常至少需要 E2；计算结果通常需要 E3。",
      "不知道、未发现、停止或外部状态不确定都是合法终态。",
    ],
    acceptance: [
      "每个需求能明确映射能力、角色、状态机和验收。",
      "相同平台能力可覆盖至少三类跨学科需求。",
      "正常、歧义、断网、权限、来源变化和污染输入都有样例。",
      "隐藏人工劳动被统计，不把人工补洞算作 Agent 自动完成。",
    ],
    antiPatterns: [
      "按论文/数据/实验创建三个重复平台",
      "只有输入、输出和一句“需要人工确认”",
      "把模型参数规模当作能力边界",
      "为 showcase 硬编码 MIME、领域 ID 或 provider",
    ],
    relatedCapabilities: ["F1", "F2", "F3", "F4", "F5", "F6"],
  },
];

export const loops = [
  {
    id: "data-cleaning",
    title: "实验数据清洗多人会审",
    priority: "P0",
    why: "不依赖真实仪器，却能同时验证证据、协作、审批、隔离执行和跨端通知。",
    capabilities: ["F1", "F2", "F4"],
    stages: [
      "桌面只读导入原始数据",
      "检测异常、单位、重复、身份与泄漏",
      "网页上领域研究者和数据管理员并行审阅",
      "冲突仲裁并批准输入版本、规则和样例 diff",
      "独立执行会话对副本运行",
      "staging 抽样复核",
      "发布清洗数据、异常清单、报告和 lineage",
    ],
    human: ["异常值删除或保留", "缺失值策略", "单位与样本身份", "最终发布"],
    acceptance: [
      "原始文件 hash 100% 不变",
      "注入的单位错误、错连、泄漏和时间错位全部检出",
      "输入或规则变化后旧批准自动失效",
      "增量重算与全量重算一致",
    ],
  },
  {
    id: "baseline-hpc",
    title: "无源码 Baseline + HPC + 独立复现",
    priority: "P0",
    why: "把代码生成升级为能跨数日托管、恢复、解释差异并由清洁环境独立复跑。",
    capabilities: ["F1", "F2", "F3", "F6"],
    stages: [
      "拆解论文 claim、公式、伪代码和缺口",
      "记录实现假设并批准数据与指标",
      "执行环境漂移检查",
      "远程提交并长期监控",
      "失败归因与 checkpoint 恢复",
      "图表逐元素建立证据",
      "清洁环境独立复跑",
      "发布差异说明与复现结论",
    ],
    human: ["数据 pipeline", "指标语义", "资源增配", "是否符合论文原意"],
    acceptance: [
      "连续托管 ≥72 小时不丢状态",
      "同一作业不重复提交且成本不越界",
      "代码、数据、seed、环境、日志和论文数字全链路",
      "独立线程揭盲前互不可见",
    ],
  },
  {
    id: "evidence-review",
    title: "Idea / 结论独立证据审查",
    priority: "P1",
    why: "用 K2 独立隔离避免锚定，再用 K1 共同收敛形成可负责的研究决定。",
    capabilities: ["F1", "F3", "F4"],
    stages: [
      "定义原子 claim 与检索协议",
      "两个 sealed workspace 独立检索和评分",
      "提交后揭盲",
      "对齐遗漏、支持、反驳和限定",
      "第三人仲裁",
      "共同形成研究决定",
      "持续监测新论文、更正和撤稿",
    ],
    human: ["研究范围", "评分 rubric", "争议仲裁", "最终科学判断"],
    acceptance: [
      "揭盲前搜索、通知、缓存、文件名和模型上下文零泄漏",
      "未发现先例带完整检索覆盖边界",
      "原始独立意见不被仲裁覆盖",
      "新来源状态变化后自动标记受影响结论",
    ],
  },
];
