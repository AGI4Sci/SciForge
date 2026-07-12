# 渐进式 Evidence / Project DAG 构建

## 目标

- 主对话始终优先；DAG 允许暂停、降速或稍后完成，不得阻塞 turn。
- Evidence DAG 只处理 committed watermark 之后的新材料，避免随会话长度重复全量抽取。
- UI 在最后一个 committed snapshot 上叠加 staging graph，并明确区分“已收集、抽取中、待验证、已提交”。
- staging 内容只用于浏览；审计、导出、高风险门控和正式 Project Snapshot 只消费 committed snapshot。
- 当前可见 DAG 高于历史后台任务，但仍低于交互式模型请求。

## 数据流

1. Turn 完成时同步生成轻量 Evidence Material：稳定 item id、规范化文本、显式 URL/DOI/文件引用、工具 lineage 与 watermark。该步骤不调用模型。
2. 后台队列合并同一 Session 的未处理 material，只提交 watermark delta，并保留少量历史锚点用于跨 turn 连边。
3. 分块抽取结果写入 staging graph；新增关系验证完成后原子提交 Evidence Snapshot。
4. Evidence Snapshot 提交后产生 delta manifest，Project DAG 只编译受影响的 Session/Claim。
5. Project prepare 可并行，最终数据库合并与 immutable snapshot commit 串行且事务短小。

## 调度与失败边界

- 不同 Session 可受控并行，同一 Session 按 watermark 串行提交。
- 新任务先获得一次执行机会，再处理到期重试；自动重试有上限并进入熔断状态。
- 新 watermark 会合并尚未开始的旧任务；已经完成的内容寻址分块可复用。
- 用户打开 DAG 面板时仅提升当前 DAG 的后台优先级，不越过 interactive lane。
- 最近活跃会话持续增量构建；旧会话按需补算，不默认全量扫历史。

## UI 语义

- committed：正常实线与完整颜色，可审计。
- collected：灰色轮廓，仅表示材料已进入管线。
- extracting：蓝色半透明节点。
- unverified：蓝色节点与虚线边，详情中显示“临时结果，可能调整”。
- 更新时保留 committed 底图，staging 只作为 overlay；失败时底图仍可使用。

## 验收

- 长会话更新请求不再重复发送完整历史。
- 两个独立 Session 可以并行准备，且同一 Session 不产生乱序 Snapshot。
- 主 turn 活跃时不会启动新的后台 DAG 模型任务。
- staging 节点不能通过 committed snapshot 的审计、预览和高风险门控接口。
- Evidence/Project 面板持续显示阶段、进度、重试和 committed/staging 边界。
