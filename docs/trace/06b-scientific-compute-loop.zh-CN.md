# 06B 科研计算 / HPC 闭环设计与第一版实现说明

状态：第一版骨架
负责人：王学文
依赖任务：06A 统一 Trace 与 Collector

## 1. 目标

06B 的目标是让 SciForge 能记录和管理科研计算任务的完整生命周期：

- Agent 提交科研计算任务；
- Scheduler 接收任务；
- Monitor 轮询任务状态；
- 任务完成、失败、阻塞、取消或恢复；
- Result Collector 回收结果文件；
- Trace 记录输入、任务状态、结果 Artifact、Evidence、资源消耗和人工验收；
- 同一任务可以复跑，并保留失败原因和复跑关系。

第一版不直接接真实 HPC 集群，也不消耗真实 GPU 或 API 费用，而是提供一个本地小成本 fixture。它的作用是先把 06B 的协议、事件链、baseline Trace 和测试闭环跑通，后续再把本地 scheduler 替换成 Slurm、Kubernetes、SSH worker 或云 GPU adapter。

## 2. 第一版交付内容

本次实现包括：

- `ScientificJobManager` 任务控制骨架；
- `ScientificJobScheduler` 接口；
- `LocalScientificFixtureScheduler` 本地 fixture 调度器；
- `createScientificJobBaselineTrace()` baseline Trace 生成器；
- `createScientificJobBaselineJsonl()` JSONL baseline 导出函数；
- `validateScientificJobBaselineTrace()` 06B baseline 校验函数；
- 成功、阻塞、复跑三类 baseline Trace；
- 人机交互 baseline Trace：用户提交、人工确认、Agent 调度、状态监控、结果回收、人工验收；
- 资源使用记录：人工时间、GPU 小时、API tokens、存储、估算费用；
- 科研验收记录：每条 baseline Trace 都包含人工 review reason；
- 单元测试验证 baseline Trace 能通过 06A closure validation，并能写入现有 JSONL Trace Store。

相关文件：

- `packages/full-trace/src/scientific-job.ts`
- `packages/full-trace/src/scientific-job.test.ts`
- `packages/full-trace/src/index.ts`

## 3. 当前事件链

成功运行 baseline：

```text
USER_INPUT
  -> AGENT_ACTION
  -> JOB_SUBMITTED
  -> JOB_STARTED
  -> TOOL_CALL_COMPLETED(scheduler.poll)
  -> JOB_FINISHED
  -> ARTIFACT_CREATED
  -> EVIDENCE_ATTACHED
  -> RESOURCE_USAGE_RECORDED
  -> HUMAN_REVIEW_RECORDED
```

失败/阻塞 baseline：

```text
USER_INPUT
  -> AGENT_ACTION
  -> JOB_SUBMITTED
  -> JOB_STARTED
  -> TOOL_CALL_COMPLETED(scheduler.poll)
  -> JOB_FAILED(status=blocked)
  -> JOB_CANCELLED
  -> ARTIFACT_CREATED(blocked diagnostic)
  -> EVIDENCE_ATTACHED
  -> RESOURCE_USAGE_RECORDED
  -> HUMAN_REVIEW_RECORDED
```

复跑 baseline：

```text
USER_INPUT
  -> AGENT_ACTION
  -> JOB_SUBMITTED
  -> JOB_STARTED(attempt=1)
  -> TOOL_CALL_COMPLETED(scheduler.poll)
  -> JOB_FAILED(status=blocked)
  -> JOB_CANCELLED
  -> JOB_RESUMED
  -> JOB_STARTED(attempt=2)
  -> TOOL_CALL_COMPLETED(scheduler.poll)
  -> JOB_FINISHED
  -> ARTIFACT_CREATED
  -> EVIDENCE_ATTACHED
  -> RESOURCE_USAGE_RECORDED
  -> HUMAN_REVIEW_RECORDED
```

人机交互 baseline：

```text
USER_INPUT(user submits from UI)
  -> HUMAN_REVIEW_REQUESTED(pre-run confirmation)
  -> HUMAN_REVIEW_RECORDED(pre-run approval with reason)
  -> AGENT_ACTION
  -> TOOL_CALL_REQUESTED(scheduler.submit)
  -> JOB_SUBMITTED
  -> JOB_STARTED
  -> TOOL_CALL_COMPLETED(scheduler.poll)
  -> JOB_FINISHED
  -> TOOL_CALL_COMPLETED(result.collector.collect)
  -> ARTIFACT_CREATED
  -> EVIDENCE_ATTACHED
  -> RESOURCE_USAGE_RECORDED
  -> HUMAN_REVIEW_RECORDED(scientific acceptance with reason)
```

## 4. 为什么这样设计

06B 不应该直接把“提交到某台服务器”写死在业务代码里，因为未来可能接入多种计算后端：

- 本地 CPU fixture；
- SSH 远程服务器；
- Slurm/PBS HPC 集群；
- Kubernetes Job；
- 云 GPU 任务；
- 第三方科研计算 API。

所以第一版定义了 `ScientificJobScheduler` 接口。现在的实现是 `LocalScientificFixtureScheduler`，用于低成本测试；未来真实服务器接入时，只需要新增一个 scheduler adapter，让它实现同样的接口，然后继续产出同样的 06A Trace 事件。

这保证了：

- 当前本地开发不花钱；
- 不需要 DeepSeek、Codex 或 GPU API key 才能跑测试；
- 未来服务器部署时 Trace Schema 不需要改；
- 06C 财务报销可以直接读取 `RESOURCE_USAGE_RECORDED`；
- DAG/Artifact/Evidence 模块可以通过 `links.artifacts`、`links.evidence` 和 `parentEventId` 接入。

## 5. 与 06A 的关系

06B 完全依赖 06A：

- 所有 Job 事件都是 `ScientificTraceEvent`；
- 所有事件都经过 06A 的 `prepareScientificTraceEvent()`；
- 所有 baseline 都经过 06A 的 `validateScientificTraceClosure()`；
- 写入存储时通过 06A 的 `ScientificTraceCollector`；
- JSONL 存储仍复用 `@sciforge/full-trace` 的 `LocalTraceStore`；
- Secret/PII 防护仍由 06A 的 redaction 和 validation 负责。

因此，06B 是 06A 上面的科研计算业务层，而不是另一套日志系统。

## 6. 成本与 API 说明

第一版 fixture 不需要真实 API，也不会产生真实费用：

- `gpuHours = 0`
- `apiTokens = 0`
- `estimatedUsd = 0`
- `storageGb = 0.001`

如果后续接入 DeepSeek、Codex、云 GPU 或 HPC 资源，应只记录资源用量和费用结果，不记录 API key、token、cookie、外发密码、下载凭证等敏感信息。

## 7. 服务器部署预留接口

未来服务器版可以新增类似：

```ts
class SlurmScientificJobScheduler implements ScientificJobScheduler {}
class KubernetesScientificJobScheduler implements ScientificJobScheduler {}
class RemoteGpuScientificJobScheduler implements ScientificJobScheduler {}
```

这些 adapter 负责真实提交、轮询、取消、恢复和结果回收，但输出的 Trace 仍然保持一致：

- `JOB_SUBMITTED`
- `JOB_STARTED`
- `TOOL_CALL_COMPLETED`
- `JOB_FINISHED`
- `JOB_FAILED`
- `JOB_CANCELLED`
- `JOB_RESUMED`
- `ARTIFACT_CREATED`
- `EVIDENCE_ATTACHED`
- `RESOURCE_USAGE_RECORDED`
- `HUMAN_REVIEW_RECORDED`

这样前端、DAG、Artifact、Evidence、Finance 和 Verifier 都不需要关心任务到底运行在本地、服务器还是 HPC 集群上。

## 8. 当前验证方式

运行：

```bash
npm --workspace @sciforge/full-trace run test
npm --workspace @sciforge/full-trace run typecheck
```

当前测试覆盖：

- 成功 baseline Trace；
- 失败/阻塞 baseline Trace；
- 取消/恢复/复跑 baseline Trace；
- 人机交互 baseline Trace；
- baseline JSONL 可解析；
- baseline Trace 可通过 06A closure validation；
- baseline events 可通过 06A Collector 写入 LocalTraceStore；
- Trace 中不出现 credential 或 PII。
