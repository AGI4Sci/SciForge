# 测试样例（复杂多轮 trace）

每个 `*.json` 是一条**多轮** agent trace（kun timeline 形状：`message` / `tool_call` /
`tool_result`，item id 仿真实风格而非 `step-N`）。引擎对每条抽一张 DAG（extract + 自动
verify），随后在 UI 下拉框出现。都取材自**真实可核查**的科学问题，便于人工抽查。

| 文件 | 轮数 | 着重考验的结构 |
|---|---|---|
| `vitamin_d_respiratory.json` | 3 | 同一来源跨轮**共享节点**（Martineau）、**矛盾**（VITAL vs 笼统主张）、**作用域细化**（仅对缺乏者有效） |
| `llm_hallucination_scaling.json` | 4 | **矛盾**（scaling 有用 vs 逆缩放 TruthfulQA）、**前置依赖**（先检索接地再可靠）、多源**细化结论** |
| `mediterranean_diet_cvd.json` | 4 | **撤稿/世界更新**风味（PREDIMED 撤稿后重发——阶段二 D 操作预演）、方法学矛盾、**多源汇聚**支持 + 共享来源 |
| `try_me_trace.json` | 4 | **reconcile/what-if + 脆弱面**：keystone 试验两角度推理、双独立队列汇聚、被 2022 re-analysis **矛盾**的 2019 研究、一条**无证据**随口断言（应标 fragile）。灌入后可在 UI 点源试 ⚡What-if、看 ungrounded 标记 |

## 用法

引擎先跑起来（端口 3897，带 LLM env）：

```powershell
cd evidence-dag-engine; $env:PYTHONPATH='src'; $env:PYTHONUTF8='1'; $env:EDAG_STORAGE_DIR='./out/threads'
$env:EDAG_LLM_BASE_URL='http://35.220.164.252:3888/v1'; $env:EDAG_LLM_API_KEY='sk-...'; $env:EDAG_LLM_MODEL='bailian/deepseek-v4-flash'
python -m evidence_dag.server
```

另开一个终端灌入全部样例（每条 extract + 自动 verify，约 30–60s）：

```powershell
python samples/load.py        # 或 $env:EDAG_URL='http://127.0.0.1:3897'; python samples/load.py
```

然后打开 `http://127.0.0.1:3897/`，在下拉框选 `sample-*` 线程查看其证据 DAG、点 claim 看证据回溯。
