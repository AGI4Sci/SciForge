# =============================================================================
#  SciForge GUI + Computer-Use — secrets / machine-specific config (TEMPLATE)
#
#  复制本文件为  启动-secrets.local.ps1  并填入真实值 (已被 .gitignore 忽略)。
#  Copy this file to  启动-secrets.local.ps1  and fill in real values (gitignored).
# =============================================================================

# --- App-owned Model Router access ------------------------------------------
$env:SCIFORGE_MODEL_ROUTER_BASE_URL = "http://127.0.0.1:3892/v1"
$env:SCIFORGE_MODEL_ROUTER_MODEL = "sciforge-router"
$env:SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = "replace-with-router-runtime-key"

# --- Computer-Use 服务端口 / 行为 --------------------------------------------
$env:CUA_PORT         = "3900"             # HTTP sidecar 端口 (GUI 通过它调用)
$env:CUA_MAX_STEPS    = "15"
# Reflection makes an additional Model Router vision call. Keep it off unless
# Model Router is running and the runtime API key is available here.
$env:CUA_REFLECT      = "false"
$env:CUA_SHOW_OVERLAY = "true"             # 真机执行时显示鼠标高亮 (仅 Windows)

# 说明: 是否允许真机执行由启动脚本控制:
#   默认 (GUI 集成): 允许真机执行, 但每次动作都要在 GUI 里点“同意”才会执行。
#   -SafeDryRun:     纯演练, 任何执行都返回 NEEDS_APPROVAL, 不动鼠标键盘。
# Whether real execution is allowed is controlled by the launcher switch; either
# way every action is gated by the in-app approval prompt before it runs.
