# Evidence DAG 独立 DSH 后端制品

这是 24-1/24-2 的 **已验证后端切片**，不是 SciForge 全域迁移/应用验收完成声明。官方 DSH 入口为 `name/inject/apply(ctx)`，不导出私有 runner hooks。插件注册：

- `evidence_dag_update`
- `evidence_dag_snapshot_status`
- `evidence_dag_seal_closure`
- `evidence_dag_poll_artifact_events`
- `evidence_dag_append_sidechain`（`{input: canonical append input}`）
- `evidence_dag_export_snapshot_products`（`{input: canonical export input}`）

静态对照入口 `createStaticEvidenceAdapter(ports)` 不注册工具，复用同一 canonical core 与 ports。对照测试另使用原生 `EvidenceDagRuntime`，比较同一 synthetic Artifact Versions 输入产生的 delta/状态/回执；UI URL 排除在本后端范围之外。

## 事实所有权与持久化

- `core` 复用 Evidence 原生 delta/closure/provisional contract，构建时 bundle；运行制品不加载工作区 TS 或 Electron/宿主源码。
- `runtime` 通过最小 JSON ports 编排；没有完整 `DomainMainRuntimeLifecycleContext`。完整 Host Context 只在 Evidence 原生 `artifact-version-static-ports.ts` 内接线。
- JS owner 持久保存 `deltas.json`、`artifact-version-lifecycle.json` 的链、closure/Snapshot 绑定、cursor/receipts；Artifact Versions 保留自己的权威版本与 outbox，插件不建立第二套上游事实库。
- Python wheel 使用 canonical `evidence_dag` compiler/存储；`runtime_stdio` 只接受 JSON 命令并通过独立 reasoner 请求获取合成/批准的推理响应。不携带环境凭据或 HTTP 模型客户端配置。
- `PythonEvidenceWorker` 验 wheel SHA-256、串行 stdio 命令、防止在 reasoning 响应中插入另一命令；停止时中止 reasoner、停止子进程并等待 OS exit 和回调静默。环境隔离 **不是 OS sandbox**；生产使用仍必须由批准执行器提供隔离与效果授权。
- formal closure 不发布 latest；精确 Snapshot digest 的响应投影与持久读取是恢复依据。重启测试先读旧 Snapshot，reasoner 调用数为零。

Host 在迁移时必须显式授权/迁移原生 Evidence 持久目录（原生 `userDataDir/evidence-dag/`）并停用对应静态执行路径；不能同时把两套 runtime 指向同一事实目录。SciForge 的安装域组合由生成的 `createInstalledDomainHostServiceResolution` 接线，插件不再持有 Evidence Host 私有实现。

## 构建与依赖

在本工作区、只读既有依赖/正确 workspace links 下：

```sh
node plugins/evidence-dag/scripts/build.mjs /absolute/fresh/output
node node_modules/typescript/bin/tsc --noEmit -p plugins/evidence-dag/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p plugins/evidence-dag/tsconfig.json
```

输出 `main/core/runtime/ports/static/python-worker.mjs`、共享 `.mjs` chunks、`sciforge_evidence_dag-1.0.0-py3-none-any.whl`、`artifacts.json`（精确摘要）。JS 运行需要 Node >=22、`zod@4.4.3`、官方 `@deepseek-ai/dsh-tools@0.2.0-rc.2` 与 `@deepseek-ai/cordis@4.0.4`；普通 npm 安装还需满足这些官方包 manifest 的完整 required peers，不能由 type-only/未激活服务推断无需安装。`DEPENDENCIES.json` 是本地已安装依赖指纹与 required-peer 发现记录，**不是锁文件/SRI 或安装批准**。

wheel 构建只用 stdlib，不安装依赖；执行需要 Python >=3.10。`PythonEvidenceWorker` 接受批准的绝对 executable/wheel path、精确摘要、专用 storageRoot/home/tmpDir 和 reasoner，不自动选择模型或启动网络服务。

## 宿主需求与边界

详见 [HOST-PORTS.md](HOST-PORTS.md)。`evidenceDagPorts` 是请求的宿主扩展服务，**尚未交付跨进程桥接**；本地真实 ArtifactVersionService fixture 不是这个桥接。调用传递官方 callId；Host 必须绑定连接身份与实际授权主体，callId 不等于 Principal/Session 权限。取消等待原请求与 cancel 确认静默，不以 timeout/Race 掩盖在途工作。

原生 UI 相关 `view/priority/preview`、科学 provenance 事件订阅、自动 Agent artifact capture 与原生 guards 尚未注册为 DSH 工具。它们保留在原生域、原生回归通过；不把 canonical 源仍存在说成这些 DSH 路径已交付。

## 验证

插件测试使用已安装入口（不使用会触发依赖安装的 package-manager exec）：

```sh
HOME="$S/home" TMPDIR="$S/tmp" XDG_CACHE_HOME="$S/cache" \
  node node_modules/vitest/vitest.mjs run plugins/evidence-dag/tests \
  --config "$S/vitest.config.mjs" --configLoader runner
```

`S` 必须是新建独立 scratch，配置 cacheDir 指向该目录、workspace aliases 指向自己的 worktree。原生文件使用包声明的 `node --import tsx --test`（不是 Vitest），Python 使用 `python -B -m unittest discover`，PYTHONPATH 同时包含 domain 的 python 与 domain root。实际命令、RED/GREEN、退出码及验收分级见 `VERIFICATION.md`。

**未覆盖**：SciForge/Electron 启动、真实 Agent 对话、真实模型/网络业务、UI/hotplug、Project 联调和独立复审。插件套件在 Windows 上使用真实 wheel 和合成 reasoner 回归；POSIX 专属的 `SIGSTOP`/描述符重命名竞态测试只在 POSIX 执行。未提交/push/PR/merge，未安装新依赖，未修改其他工作线。
