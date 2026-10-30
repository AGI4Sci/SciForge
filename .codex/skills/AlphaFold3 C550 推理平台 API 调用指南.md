# AlphaFold3 C550 兼容推理 API 调用指南

保留认证、上传、提交、轮询和 CIF 下载通用流程，不提供内网地址、共享账号、集群 namespace、个人 kubeconfig 或部署数据路径。请先取得运营方配置及调用授权。本仓库不部署模型或授予服务访问权限。

## 显式配置

设置环境变量或在 `alphafold3/.env` 写入可信 shell 赋值。文件会作为代码加载，切勿加载不可信文件或提交凭据。优先使用 HTTPS，URL 不得嵌入凭据。

| 配置 | 用途 |
|---|---|
| `ALPHAFOLD3_AUTH_URL` | 完整认证 HTTP(S) 地址，必需 |
| `ALPHAFOLD3_TASKS_URL` | 完整任务 HTTP(S) 地址，必需 |
| `ALPHAFOLD3_USERNAME` | 用户自己的服务账号，必需 |
| `ALPHAFOLD3_PASSWORD` | 用户自己的密码，必需 |
| `ALPHAFOLD3_MODEL_DIR` | 提交需要的远程模型绝对目录，`--model-dir` 可覆盖 |
| `ALPHAFOLD3_NAMESPACE` | 上传/下载/preflight 使用的 namespace |
| `ALPHAFOLD3_KUBECONFIG` | 上述集群操作需要的可读 kubeconfig，`--kubeconfig` 可覆盖 |
| `ALPHAFOLD3_INPUT_BASE` | 本地 JSON/序列上传需要的远程绝对根目录 |
| `ALPHAFOLD3_OUTPUT_BASE` | 下载需要的远程绝对输出备用目录 |

缺少当前操作需要的配置，脚本在任何 HTTP/kubectl 调用前报出变量名并拒绝。无效 URL、URL 内嵌凭据、相对远程根目录和不可读 kubeconfig 也会本地拒绝。不自动使用个人默认 Kubernetes context。仅 HTTP 提交/轮询已有远程输入，不要求集群配置。

## 推荐流程

以下命令仅在配置完整且取得授权后运行：

```bash
# 本地文件：上传 → 认证 → 提交 → 轮询 → 下载
bash .codex/skills/alphafold3/scripts/alphafold3_submit.sh \
  --json ./my_input.json --output-dir ./outputs/my_run

# 简单序列自动生成完整 AF3 JSON
bash .codex/skills/alphafold3/scripts/alphafold3_submit.sh \
  --sequence MQIFVKTLTG --name My_Protein --output-dir ./outputs/my_run

# 已有远程 JSON：只提交，不访问 Kubernetes
bash .codex/skills/alphafold3/scripts/alphafold3_submit.sh \
  --remote-json "${REMOTE_INPUT_JSON:?请提供远程 JSON 绝对路径}" --no-wait

# 已有远程目录：批量提交
bash .codex/skills/alphafold3/scripts/alphafold3_submit.sh \
  --input-dir "${REMOTE_INPUT_DIR:?请提供远程输入绝对目录}" --no-wait
```

`--json-input` 是 `--json` 别名，`--json-path` 是 `--remote-json` 别名。API `input_json` 是远程路径，不是原始 JSON。任务 GET/POST 必须带 `x-original-model: alphafold3`，认证返回的 token 用于 Bearer header，不能写入日志或仓库。

状态通常为 queued → running → completed / failed。分别报告提交接受、推理终态、坐标下载分析；前两者不等于分子证据。

## 输入、手工 API 与结果

蛋白块应含 `id`、`sequence`、`unpairedMsa`、`pairedMsa` 和 `templates`；服务端支持计算 MSA 时可用空字符串/空数组。复合物使用不同 chain ID。完整 JSON、手工认证/提交/轮询、显式 kubeconfig 下载命令见 [技能说明](./alphafold3/SKILL.md)。

下载优先读取任务返回的 `outputs.output_path`，核实路径属于该任务。备用目录由 `ALPHAFOLD3_OUTPUT_BASE` 显式配置。不猜测临时目录或私有部署布局。保留时间、PVC 共享、token 有效期和调用间隔由运营方确认。`kubectl cp` 使用真实 Pod 名，不用 Deployment 名。CIF 可用 PyMOL、ChimeraX 或 Biopython 分析。

## 离线与联网边界

- `--help` 离线；`--preflight` 配置完整后会真实认证和访问集群，不是离线验证。
- 日志管道使用 `set -o pipefail`，避免 `tee` 掩盖失败。
- 离线回归：`python3 -B .codex/skills/alphafold3/tests/test_submit.py -v`；仅标准库、本地命令替身，建议显式设置自己拥有的 `TMPDIR`/`HOME`。
- 替身响应只证明控制流，不是实际推理或分子证据。
