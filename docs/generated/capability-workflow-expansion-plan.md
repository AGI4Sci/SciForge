# Workflow expansion plan

The expansion target is 42 workflows: 12 cross-domain, 12 recovery-boundary, 18 same-domain. 18 are currently ready from package contributions; the rest remain planned and blocked until their fixture/oracle dependencies are implemented.
The executable case projection is `eval-cases/capability/workflow-expansion-cases.jsonl`; the plan file retains fixture, oracle and readiness metadata.

| ID | Category | Business intent | Required actions | Owners | Readiness | Blocker |
| --- | --- | --- | --- | --- | --- | --- |
| `workflow-expansion-same-domain-01` | same-domain | 读取已有资源状态并生成可复核摘要 | `anchored-comments.asset.read`<br>`anchored-comments.feedback.status` | anchored-comments | ready | — |
| `workflow-expansion-same-domain-02` | same-domain | 分别验证空结果与资源不存在时的可解释返回 | `artifact-versions.bundle.verify-v2` | artifact-versions | ready | — |
| `workflow-expansion-same-domain-03` | same-domain | 创建或更新资源后重新读取并核对写入内容 | `biology-room.open-or-create`<br>`biology-room.refresh` | biology-room | ready | — |
| `workflow-expansion-same-domain-04` | same-domain | 使用同一幂等键重复提交写入并确认不产生重复副作用 | `browser-preview.drag`<br>`browser-preview.fill` | browser-preview | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-same-domain-05` | same-domain | 执行数据转换并验证输出结构和关键字段 | `change-inspector.list-changes` | change-inspector | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-same-domain-06` | same-domain | 合并两个关联数据集并验证匹配与缺失记录 | `collaboration.membership.remove`<br>`collaboration.project.create` | collaboration | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-same-domain-07` | same-domain | 创建资源后从列表中确认它可见且身份一致 | `content-space.agent-native-document-read`<br>`content-space.authorize-feature-selection` | content-space | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-same-domain-08` | same-domain | 更新资源元数据后读取并核对版本变化 | `create-loop.status`<br>`create-loop.export-dsl` | create-loop | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-same-domain-09` | same-domain | 删除资源后确认读取返回不存在且没有残留 | `dataset-api.materialize`<br>`dataset-api.metadata` | dataset-api | ready | — |
| `workflow-expansion-same-domain-10` | same-domain | 创建新版本并与旧版本比较变更内容 | `evidence-dag.audit-query`<br>`evidence-dag.resolve-evidence-preview` | evidence-dag | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-same-domain-11` | same-domain | 恢复历史版本并验证当前内容与版本身份 | `extensions.list`<br>`extensions.status` | extensions | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-same-domain-12` | same-domain | 添加评论后读取线程并核对作者和正文 | `git-checkpoints.preview`<br>`git-checkpoints.list` | git-checkpoints | ready | — |
| `workflow-expansion-same-domain-13` | same-domain | 执行计算并验证结果摘要与产物文件 | `project-dag.goal.save`<br>`project-dag.update` | project-dag | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-same-domain-14` | same-domain | 触发计算阻塞并验证诊断信息和无额外副作用 | `remote-ssh.command.execute` | remote-ssh | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-same-domain-15` | same-domain | 生成预览并导出可交付文件 | `research-checkpoints.status`<br>`research-checkpoints.turn-status` | research-checkpoints | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-same-domain-16` | same-domain | 提交评审并打包可追溯的评审证据 | `scientific-compute.status`<br>`scientific-compute.run-baseline` | scientific-compute | ready | — |
| `workflow-expansion-same-domain-17` | same-domain | 创建检查点后恢复任务并核对恢复状态 | `scientific-plotting.map-data`<br>`scientific-plotting.render` | scientific-plotting | ready | — |
| `workflow-expansion-same-domain-18` | same-domain | 检查提供方状态后执行一次受控操作 | `siyuan.document.compose` | siyuan | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-cross-domain-01` | cross-domain | 用研究结果生成带来源标识的图表 | `scientific-plotting.map-data` | paper-radar, scientific-plotting | ready | — |
| `workflow-expansion-cross-domain-02` | cross-domain | 把数据集转换成图表并核对数据血缘 | `dataset-api.confirm-plan`<br>`scientific-plotting.map-data` | dataset-api, scientific-plotting | ready | — |
| `workflow-expansion-cross-domain-03` | cross-domain | 把图表交给评审流程并生成评审包 | `scientific-plotting.compare`<br>`visual-review.update-context` | scientific-plotting, visual-review | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-cross-domain-04` | cross-domain | 把产物加载到预览流程并确认页面状态 | `artifact-versions.content.read-range-v2`<br>`browser-preview.read` | artifact-versions, browser-preview | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-cross-domain-05` | cross-domain | 从指定版本建立检查点并验证可恢复 | `artifact-versions.materialize`<br>`git-checkpoints.restore` | artifact-versions, git-checkpoints | ready | — |
| `workflow-expansion-cross-domain-06` | cross-domain | 把证据节点关联到项目并读回关联关系 | `evidence-dag.export-snapshot-products`<br>`project-dag.goal.save` | evidence-dag, project-dag | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-cross-domain-07` | cross-domain | 把生物分析结果登记为可追溯证据 | `biology-room.open-or-create`<br>`evidence-dag.export-snapshot-products` | biology-room, evidence-dag | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-cross-domain-08` | cross-domain | 把远端资源安全地加载到本地预览 | `remote-ssh.targets.list`<br>`browser-preview.read` | remote-ssh, browser-preview | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-cross-domain-09` | cross-domain | 运行工作流并生成可核验的交付产物 | `create-loop.test-node`<br>`artifact-versions.lifecycle.refresh` | create-loop, artifact-versions | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-cross-domain-10` | cross-domain | 从论文结果构造数据集并核对来源字段 | `dataset-api.list-object-stores` | paper-radar, dataset-api | ready | — |
| `workflow-expansion-cross-domain-11` | cross-domain | 把检查点状态提交给评审并核对版本 | `research-checkpoints.status`<br>`visual-review.read-document` | research-checkpoints, visual-review | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-cross-domain-12` | cross-domain | 从浏览器状态生成受控反馈并确认提交结果 | `browser-preview.select`<br>`anchored-comments.capture` | browser-preview, anchored-comments | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-recovery-boundary-01` | recovery-boundary | 验证空结果被明确报告且任务没有伪造成功 | `anchored-comments.asset.read` | anchored-comments | ready | — |
| `workflow-expansion-recovery-boundary-02` | recovery-boundary | 提交无效输入并确认错误可解释且没有副作用 | `anchored-comments.capture` | anchored-comments | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-recovery-boundary-03` | recovery-boundary | 在无需工具时直接给出结果且不调用能力 |  | anchored-comments | ready | — |
| `workflow-expansion-recovery-boundary-04` | recovery-boundary | 主路径不可用时选择允许的替代能力并完成任务 | `anchored-comments.list` | anchored-comments | ready | — |
| `workflow-expansion-recovery-boundary-05` | recovery-boundary | 拒绝审批后确认操作终止且没有外部副作用 | `browser-preview.fill` | browser-preview | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-recovery-boundary-06` | recovery-boundary | 批准后完成受控写入并核验结果 | `browser-preview.forward` | browser-preview | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-recovery-boundary-07` | recovery-boundary | 遇到一次超时后按上限重试并恢复成功 | `evidence-dag.priority` | evidence-dag | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-recovery-boundary-08` | recovery-boundary | 持续失败时报告明确错误并停止无效重试 | `browser-preview.read-url` | browser-preview | blocked | one or more package fixture/oracle contributions are not ready |
| `workflow-expansion-recovery-boundary-09` | recovery-boundary | 使用过期资源时报告失效并避免写入 | `artifact-versions.list-v2` | artifact-versions | ready | — |
| `workflow-expansion-recovery-boundary-10` | recovery-boundary | 重放同一请求并确认结果稳定且没有重复副作用 | `artifact-versions.read` | artifact-versions | ready | — |
| `workflow-expansion-recovery-boundary-11` | recovery-boundary | 取消进行中的任务并确认没有残留写入 | `artifact-versions.commit` | artifact-versions | ready | — |
| `workflow-expansion-recovery-boundary-12` | recovery-boundary | 跨工作区访问被隔离并确认原工作区不受影响 | `biology-room.refresh` | biology-room | ready | — |

These are task contracts to implement and run. They do not count as live coverage until the Agent run and independent oracle evidence are persisted.
