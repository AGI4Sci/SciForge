# =============================================================================
#  SciForge GUI + Computer-Use — secrets / machine-specific config (TEMPLATE)
#
#  复制本文件为  启动-secrets.local.ps1  并填入真实值 (已被 .gitignore 忽略)。
#  Copy this file to  启动-secrets.local.ps1  and fill in real values (gitignored).
# =============================================================================

# --- GUI-Owl 模型部署所在的 GPU 服务器 (启动脚本会自动建 SSH 隧道) -----------
# GUI-Owl is served by vLLM on this box (serve-gui-owl.sh); the launcher forwards
# a local port to it so the Computer-Use service can reach the model.
$env:CUA_SSH_HOST    = "101.126.157.149"   # GPU 服务器地址
$env:CUA_SSH_PORT    = "2222"              # SSH 端口
$env:CUA_SSH_USER    = "root"
$env:CUA_REMOTE_PORT = "4243"              # 远端 vLLM 监听端口
$env:CUA_LOCAL_PORT  = "4243"              # 本地转发端口

# --- Computer-Use 服务 (worker) 调用的模型端点 -------------------------------
# 默认指向上面的本地隧道。生产环境应改为 SciForge model router 的 OpenAI 兼容网关。
$env:CUA_MODEL_BASE_URL = "http://127.0.0.1:$($env:CUA_LOCAL_PORT)/v1"
$env:CUA_MODEL          = "gui-owl"        # served-model-name; 服务器跑 32B (server/serve-gui-owl-32b.sh)
$env:CUA_MODEL_API_KEY  = "EMPTY"          # vLLM 无需鉴权; 走网关时填真实 key

# --- Computer-Use 服务端口 / 行为 --------------------------------------------
$env:CUA_PORT         = "3900"             # HTTP sidecar 端口 (GUI 通过它调用)
$env:CUA_MAX_STEPS    = "15"
# GUI-Owl 32B 端到端足够强, 关闭 reflector 提速 (用 8B 时再设 "true")。
$env:CUA_REFLECT      = "false"
$env:CUA_SHOW_OVERLAY = "true"             # 真机执行时显示鼠标高亮 (仅 Windows)

# 说明: 是否允许真机执行由启动脚本控制:
#   默认 (GUI 集成): 允许真机执行, 但每次动作都要在 GUI 里点“同意”才会执行。
#   -SafeDryRun:     纯演练, 任何执行都返回 NEEDS_APPROVAL, 不动鼠标键盘。
# Whether real execution is allowed is controlled by the launcher switch; either
# way every action is gated by the in-app approval prompt before it runs.
