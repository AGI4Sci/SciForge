# 可复跑 DAG v3 离线演示

_确定性事实层示例，更新于 2026-08-06_

---

这个演示用 Evidence DAG 的公开事实层 API 构建两个完整运行：baseline 输出为 `100`，candidate 输出为 `100.05`。它不访问网络、不调用模型，也不依赖测试 helper，适合用作本地验收和可复跑规范示例。

演示覆盖九类可追溯事实：Input、Code、Environment、Parameter、Tool、Approval、Artifact、Evidence 与 Conclusion。每个运行都会建立事实图、提交不可变 snapshot、从 Conclusion 反向解析完整 lineage，并导出和校验 `.sciforge-rerun.json` 规范。

> 📌 **演示边界：** 本文描述的是可重复生成文件的离线 demo。14 节点真实应用操作、fresh approval 和 Project v13 汇总见[实现说明](./reproducible-dag-v3-implementation.zh-CN.md)与[应用演示视频](./demo/reproducible-dag-v3-app-demo.mp4)。

## ⚙️ 运行

在仓库根目录执行：

```bash
npm run demo:v3 --prefix packages/domains/evidence-dag -- \
  --output /tmp/sciforge-dag-v3-demo
```

也可以在 `packages/domains/evidence-dag` 目录中执行：

```bash
npm run demo:v3 -- --output /tmp/sciforge-dag-v3-demo
```

如果省略 `--output`，结果写入当前目录下的 `reproducible-dag-v3-demo-output`。

## ✅ 验收语义

演示会在写文件前执行断言，任一条件不成立都会以非零状态退出：

- baseline 和 candidate 的九类 lineage coverage 均完整；
- 两份 rerun spec 都能通过校验，且没有阻断复跑的 breakpoint；
- `sameInput`、`sameSpec` 与 `sameExecutionContext` 为 `true`；
- 输出值从 `100` 变为 `100.05`，绝对差值 `0.05` 不超过容差 `0.1`；
- 输出 digest 的变化被明确记录为 observed difference；
- `resultMatch` 为 `true`，`replicationStatus` 为 `matched`，运行关系为 `replicates`。

这里“结果匹配”和“字节摘要相同”是两个不同判断：数值比较器允许容差内的变化，因此结果可复现；同时系统仍保留输出 digest 变化，让差异可解释而不是被吞掉。

## 📦 输出文件

指定目录会包含：

- `lineage.json`：两个运行从结论回溯得到的完整 lineage、coverage 和 snapshot 摘要；
- `baseline.sciforge-rerun.json`：baseline 可复跑规范；
- `candidate.sciforge-rerun.json`：candidate 可复跑规范；
- `comparison.json`：输入、执行上下文、输出比较、差异和复现关系；
- `report.md`：人类可读的中文验收报告；
- `dag-v3-demo.svg`：由真实节点、边和 coverage 数据生成的 DAG 图；
- `index.html`：可直接打开的自包含可视化报告。

所有业务时间和输入事实都是固定值，JSON 使用稳定排序输出。可以运行两次并确认产物完全一致：

```bash
npm run demo:v3 --prefix packages/domains/evidence-dag -- --output /tmp/dag-v3-a
npm run demo:v3 --prefix packages/domains/evidence-dag -- --output /tmp/dag-v3-b
diff -r /tmp/dag-v3-a /tmp/dag-v3-b
```

`diff` 没有输出即表示两次导出的所有产物字节级一致。
