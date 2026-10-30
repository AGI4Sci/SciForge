# Project DAG 后端运行时制品

## 范围与状态

- `src/dsh-adapter.ts` 导出真实固定 DSH `name/inject/apply(ctx)`；注册官方 Tools，随 Cordis Fiber dispose 解绑。没有私有 `activate/getCapabilityDefinitions` hooks。
- Project `src/core/index.ts` 只接收 `src/ports/index.ts` 的受限 Session 元数据、已提交 Evidence 引用和 Project 命令；原 `runtime.ts` 的 update/saveGoal 静态入口已使用同一核心。原静态 UI/preview/lifecycle 暂保留，不代表运行时 UI 迁移。
- 独立 Node 测试使用官方 Context/Tools + 预编译 ESM + 已安装 Python wheels；真实 SQLite durable receipt、Project compile、重启读回。测试的 Host 权限/Session 服务是合成绑定，不是 SciForge Principal/Broker 集成。
- **SciForge 公共宿主接线 BLOCKED**：基线 process-extension-runner 不支持真实 apply/Context；不复制另一条兼容线的平台代码。composition 排除静态入口、真实 Host 身份/批准/效应、应用 Agent 验收由父代理/兼容线联调。

## 最小宿主接口需求

`ProjectDagHostPort` 是待公共 SDK/兼容线承接的 **SciForge 自定义服务要求**，并非官方 DSH 服务：

1. `open()` 获取作用域绑定 port；`readSession({runtimeId,threadId})` 仅返回身份与 workspace，不返回聊天/完整 thread。
2. `readCommittedSnapshot(identity)` 必须通过现有 `@sciforge/domain-evidence-dag/contract` 的 snapshot-status 验证授权与 committed metadata；不得返回未提交记录。
3. `authorize(actionId,target,{callId,agentId?,signal})` 使用实际连接/Principal lease 校验 workspace/runtime/thread/effect/批准；无 callback 不得部署。agentId 不是权限。
4. `request(route,method,body)` 转发批准的 Project service 操作。Project Python 只按 `threadId+digest` 读取共享 Evidence 存储；Host 必须给予只读授权/OS 隔离，环境过滤不是文件系统 sandbox。
5. `subscribeInvalidation(listener)` 仅投递 Host 授权的 workspace 与 changedFields 元数据，返回精确 disposer；回调 Promise 必须被 Host 观察/记录失败。
6. `close()` 停准入、立即启动由进程拥有的有界 drain/EOF 关闭并确认 PID 退出，不能先等待 active 请求或授权准备才启动时限。超时返回失败并声明 durable accepted 工作需要恢复，不能冒充已取消。adapter 并行启动 detach/close，分别用 `teardownTimeoutMs`（缺省10秒，正安全整数）有界等待；聚合错误并写入官方 logger。官方 Cordis dispose 会记录/吞下 effect 错误，因此 dispose fulfilled 仅代表结构 teardown 已 settle，须同时检查诊断与真实 PID。超时持续 fence late callback，不宣称 subscription 真正释放；Host 必须处理未确认资源，不能因结构卸载删除 durable 恢复记录。

首个变更 dispatch 前取消不产生写入：`core.update(input, signal?)` 在 Session/Evidence 准备 await 后且 POST 前检查；`core.saveGoal(input, signal?)` 在 lane 等待后且 draft 前检查。authorize 返回不是不可撤销 admission。首个变更已派发后命令先到 quiescence，再报告 abort，不回滚 durable receipt/draft，后续 apply/readback 不被取消截断。Python stdio 是 Project 自有 sidecar，不是另一套 DSH runner/插件宿主。无模型授权：任何 Python Judge 路径明确失败，无网络模型调用。

## 独立构建

只用已有 esbuild、Python>=3.10/setuptools>=68（本次实际 Python3.11.16、setuptools84.0.0）。不运行 npm/pip 在线安装。

```sh
node plugins/project-dag/scripts/build.mjs "$SCRATCH/artifact"
python3.11 plugins/project-dag/scripts/build-python.py \
  --scratch "$SCRATCH/python-build" --evidence-source packages/domains/evidence-dag
python3.11 -m venv --without-pip "$SCRATCH/venv"
python3.11 -m pip --python "$SCRATCH/venv/bin/python" install --no-index \
  --find-links "$SCRATCH/python-build/wheels" \
  sciforge-project-dag==1.0.0 sciforge-evidence-dag==1.0.0
```

Evidence 是独立正式依赖 wheel，不 vendor 进 Project wheel，不用相邻源码 PYTHONPATH 作为独立验收环境；正式双插件交付应换成 Evidence 负责人交付的固定 wheel 并重验 hash。build-python 仅把 Python 源码和 pyproject 复制到自有 scratch 供构建，既不修改 Evidence 域，也不复制事实存储。

ESM 多入口使用 esbuild `splitting:true`，index.js/core.js 经同一个 canonical shared chunk 复用 core/Goal lane；必须交付全部 `*.js`，不能仅复制三个入口。内联本域 core/contract 与固定 Evidence **公共合同**的运行 schema、Zod；官方 Cordis/Tools 由宿主提供，保持同一服务身份。无 global 硬编码 lane、主程序/Electron/renderer/catalog 或主工程 TS 运行时读取。

## 复现独立 Node 验证

设 `HOME/TMPDIR` 为自有 scratch。设置 `PROJECT_DAG_PYTHON` 指向上述 venv，`PROJECT_DAG_ARTIFACT` 指向产物，`PROJECT_DAG_CASE_ROOT` 指向新的合成目录：

```sh
"$PROJECT_DAG_PYTHON" -I plugins/project-dag/tests/seed-evidence.py "$PROJECT_DAG_CASE_ROOT"
node plugins/project-dag/tests/independent-node.mjs
node --test plugins/project-dag/tests/final-artifact.test.mjs
PROJECT_DAG_TEST_CACHE="$SCRATCH/cache" node node_modules/vitest/vitest.mjs run \
  plugins/project-dag/tests --config plugins/project-dag/vitest.config.mjs --configLoader runner
python3 -c 'from pathlib import Path; import subprocess; files=sorted(str(p) for p in Path("packages/domains/project-dag/src").rglob("*.test.ts")); assert files; raise SystemExit(subprocess.call(["node", "--import", "tsx", "--test", *files]))'
"$PROJECT_DAG_PYTHON" -m unittest discover -s packages/domains/project-dag/tests -p 'test_*.py' -v
```

测试层级分开：ports fixture 对照/官方 Context contract/独立真实 Python 进程，不把任何一项说成 SciForge Agent。core 对 adapter 的对照只证明一致性，不是原行为证明；静态 update URL 的正式契约测试使用来源为 `376fc34e301b05a3abf5846d9196795ef15c191d` 的固定 runtime 文本夹具及 SHA256 校验，不要求克隆私有 Git 历史；测试仍构建该 runtime 并验证认证只在静态边界。独立进程 fixture 是真实 Evidence 空图 committed Snapshot，其 mutation 检查修改实际文件的 pending 状态/水位并跨已安装 Python reader 验证拒绝，不再仅比较字面 digest。有 claim/artifact 的深入编译语义由既有 Python 回归覆盖；旧双插件非空 formal history 已只读验证，最终 Evidence 交付物的全链组合仍待父代理。

stdio 队列由 canonical `Engine.process_updates` 的单一串行 pump 推进：启动恢复、空闲 due retry 和 EOF drain 不依赖新 POST/GET，stdin 使用 select/字节缓冲，不另开与 SQLite 编译竞争的输入线程。同进程跨 core（含最终公开 ESM 双入口）的 saveGoal 按规范化 Project 根目录串行执行完整 draft/apply；相同路径不同 store 仍会保守互相等待，不保证跨进程锁。子进程环境仅显式选择 HOME/TMPDIR；不是 OS sandbox。

官方 DSH 固定源码 SHA `639ed015397290b3745d163aafe02ffee4aa3f84`；已安装测试包 Tools/SystemPrompt 0.2.0-rc.2、Cordis4.0.4。动态 schema 使用 DSH 支持的结构子集，完整 bounds/refinement 在执行前后由既有 Zod 合同强制校验，未削弱 Evidence 协议。
